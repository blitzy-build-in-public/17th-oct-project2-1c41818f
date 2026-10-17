/**
 * Path: src/lib/pricingService.ts
 * Purpose: Line and order totals, promo application, shipping and tax for the cart and checkout
 * Lines: 599
 */

import {
  DEFAULT_CURRENCY,
  FREE_SHIPPING_METHOD_ID,
  FREE_SHIPPING_THRESHOLD_MINOR,
  SHIPPING_METHODS,
  TAX_RATE,
} from "@/constants/config";
import { PROMO_REJECTION_MESSAGES } from "@/constants/content";
import { PROMO_KIND_LABELS } from "@/constants/taxonomy";
import { getJson, postJson } from "@/lib/apiClient";
import type { ApiError, CategoryId, MinorUnits, Result } from "@/types/common";
import type {
  AppliedPromo,
  CartLine,
  CartPricingRequest,
  PricedCart,
  PricedCartLine,
  PromoCode,
  PromoKind,
  PromoRejectionReason,
  PromoValidationRequest,
  ShippingMethod,
} from "@/types/commerce";
import { clampNumber, sumBy } from "@/utils/collections";
import { roundMinorUnits } from "@/utils/format";
import { validatePromoCodeShape } from "@/utils/validation";

// The order of operations -------------------------------------------------------------------------

/**
 * The arithmetic every total in the product is produced by, in this order and no other:
 *
 * 1. **Line subtotals** — each line's unit price times the whole quantity it holds.
 * 2. **Discounts** — the code's reduction of the goods subtotal, allocated across the lines it reaches.
 * 3. **Shipping** — charged on the subtotal left after the discount, and zero once that subtotal reaches
 *    the configured free-delivery threshold for the configured method, or for a `free_shipping` code.
 * 4. **Tax** — charged on the discounted goods subtotal and never on the delivery charge.
 * 5. **Grand total** — the sum of the four parts: subtotal − discount + shipping + tax.
 *
 * Every figure is a whole number of minor units, and the one decimal rate ever multiplied into a price
 * is the tax rate, rounded once through `src/utils/format.ts`'s single rounding rule.
 */

// Paths, spellings and fixed values ---------------------------------------------------------------

/** The three endpoints this module reads and writes, as the seam's route table names them. */
const CART_PRICE_PATH = "/api/cart/price";
const PROMO_VALIDATION_PATH = "/api/cart/validate-promo";
const SHIPPING_METHODS_PATH = "/api/shipping-methods";

/** The hundred a percentage is expressed in: a `percent` promo's value and the tax rate alike. */
const PERCENT_DENOMINATOR = 100;

/** The control a promo failure belongs to, as the field every surface renders it against. */
const PROMO_CODE_FIELD = "promoCode";

/**
 * What the shape check answers with when it is made here rather than at the seam: the status and code the
 * transport gives a body that broke a field rule. Spelled rather than imported because the module that
 * owns them is not a dependency of this one, and a check made before a request is sent has to fail
 * exactly as the same check made at the seam would.
 */
const VALIDATION_FAILURE = { status: 422, code: "validation-failed" } as const;

/**
 * The method a basket is priced with before the buyer has chosen one: the first configured method, store
 * pickup at no charge. `src/constants/config.ts` is the configured list's single home.
 */
const FALLBACK_SHIPPING_METHOD: ShippingMethod = SHIPPING_METHODS[0];

/**
 * How much each way of discounting takes off the goods subtotal, per `PromoKind`: a `percent` code its
 * value as a percentage of the base, applied as one multiplication and rounded once; a `fixed` code the
 * minor units its value states, never more than the base; and a `free_shipping` code nothing at all,
 * because its whole effect is the delivery charge {@link priceCartLines} waives. One exhaustive table is
 * what makes "what this code is worth" a single answer rather than a branch in each caller.
 */
const PROMO_DISCOUNT_RULES: Readonly<
  Record<PromoKind, (base: MinorUnits, promo: PromoCode) => MinorUnits>
> = {
  percent: (base, promo) => roundMinorUnits((base * promo.value) / PERCENT_DENOMINATOR),
  fixed: (base, promo) => clampNumber(roundMinorUnits(promo.value), 0, Math.max(0, base)),
  free_shipping: () => 0,
};

/** The wording of every reason a code can be refused, keyed by the reason — built from the record in
 * `src/constants/content.ts`, whose keys are exactly the members of `PromoRejectionReason`, so the two
 * cannot drift and no reason is spelled by hand here. */
const PROMO_REJECTION_WORDING: ReadonlyMap<string, string> = new Map(
  Object.entries(PROMO_REJECTION_MESSAGES),
);

/** Reports whether a failure's code is one of the eight reasons a code can be refused, narrowing the
 * string to the union so a caller can index the wording with it. */
function isPromoRejectionReason(code: string): code is PromoRejectionReason {
  return PROMO_REJECTION_WORDING.has(code);
}

// Reading a basket --------------------------------------------------------------------------------

/**
 * The spelling a code is compared and sent in: trimmed of the whitespace a paste brings and upper-cased,
 * because a code is matched case-insensitively while its shape is upper-case. Every entry point normalises
 * before it matches or sends, so a shopper who types `summer20` is refused for what the code is worth and
 * not for the case they typed. Whitespace alone normalises to `null` — no code at all.
 */
function normalisePromoCode(code: string | null | undefined): string | null {
  const normalised = (code ?? "").trim().toUpperCase();
  return normalised.length === 0 ? null : normalised;
}

/**
 * The lines a code reaches: every line of an `order`-scoped code, and, for a `category`-scoped one, the
 * lines whose product sits in one of the code's categories.
 *
 * A cart line carries no category — it is a priced snapshot, not a catalogue reference — so the caller
 * supplies `categoryIdsByProductId`: the products it priced, each with the category it sits in. The data
 * layer owns the catalogue and is the caller that holds this fact; a caller that supplies none is taken to
 * be pricing a code whose scope cannot be narrowed, so every line counts as eligible.
 */
function eligibleLineIds(
  promo: PromoCode,
  lines: readonly CartLine[],
  categoryIdsByProductId: ReadonlyMap<string, CategoryId> | undefined,
): ReadonlySet<string> {
  if (promo.appliesTo === "order" || categoryIdsByProductId === undefined) {
    return new Set(lines.map((line) => line.id));
  }
  const covered = new Set<string>(promo.categoryIds);
  const eligible = new Set<string>();
  for (const line of lines) {
    const categoryId = categoryIdsByProductId.get(line.productId);
    if (categoryId !== undefined && covered.has(categoryId)) {
      eligible.add(line.id);
    }
  }
  return eligible;
}

/**
 * Shares an amount across weights in whole minor units and exactly: each share is its proportional part
 * rounded down, and the remainder the rounding leaves is handed out one minor unit at a time, largest
 * fractional part first, ties going to the earlier line.
 *
 * This is what makes `PricedCartLine.discountMinor` well defined — the shares sum to the amount the code
 * took off, so a cart's lines and the order's discount cannot differ by a cent — and a line weighted zero
 * never takes one of the remainders, because an integer remainder is always smaller than the number of
 * parts that produced it.
 */
function allocateProportionally(amountMinor: MinorUnits, weights: readonly number[]): MinorUnits[] {
  const shares = weights.map(() => 0);
  const total = sumBy(weights, (weight) => weight);
  const amount = Math.max(0, roundMinorUnits(amountMinor));
  if (amount === 0 || total <= 0) {
    return shares;
  }
  const remainders: { index: number; fraction: number }[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const exact = (amount * weights[index]) / total;
    const whole = Math.floor(exact);
    shares[index] = whole;
    allocated += whole;
    remainders.push({ index, fraction: exact - whole });
  }
  remainders.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let leftover = amount - allocated;
  for (const { index } of remainders) {
    if (leftover <= 0) break;
    shares[index] += 1;
    leftover -= 1;
  }
  return shares;
}

// Line and subtotal arithmetic --------------------------------------------------------------------

/**
 * One line's goods subtotal: its unit price times the quantity it holds, in whole minor units.
 *
 * The line is priced as its snapshot stands and is never written to. A quantity that is not a whole
 * number, is negative or exceeds the ceiling the line records as purchasable is priced at its bound: the
 * arithmetic's job is a price for what may be bought, and the reducer and the seam have already refused a
 * payload outside those bounds.
 */
export function lineSubtotalMinor(line: CartLine): MinorUnits {
  const ceiling = Math.max(0, Math.trunc(line.maxQuantity));
  const quantity = clampNumber(Math.trunc(line.quantity), 0, ceiling);
  return roundMinorUnits(line.unitPriceMinor * quantity);
}

/** The goods subtotal of a set of lines, summed from {@link lineSubtotalMinor} rather than from any stored
 * figure, so the subtotal a cart shows is the subtotal its lines add up to. */
function subtotalOfLines(lines: readonly CartLine[]): MinorUnits {
  return sumBy(lines, lineSubtotalMinor);
}

/** This module's name for the codebase's single rounding rule, so a figure computed here is rounded the one
 * way every other money figure in the product is and no caller reaches for `Math.round`. */
export function roundToMinor(value: number): MinorUnits {
  return roundMinorUnits(value);
}

/**
 * Confines a discount to what it can actually take off: never negative, never more than the subtotal it is
 * applied to, and always whole minor units. This is what stops a code worth more than the basket from
 * turning a total into a refund.
 */
export function clampDiscount(subtotalMinor: MinorUnits, discountMinor: MinorUnits): MinorUnits {
  return clampNumber(roundToMinor(discountMinor), 0, Math.max(0, roundToMinor(subtotalMinor)));
}

// Applying a promo code ---------------------------------------------------------------------------

/** What a caller supplies so that a `category`-scoped code reaches only the lines it covers: the products
 * in the basket, each with the category it sits in. See {@link eligibleLineIds}. */
export interface ApplyPromoOptions {
  readonly categoryIdsByProductId?: ReadonlyMap<string, CategoryId>;
  /** The per-line goods subtotals the caller already computed, parallel to `lines`; derived when omitted. */
  readonly lineSubtotalsMinor?: readonly MinorUnits[];
  /** The lines the code reaches, as {@link eligibleLineIds} derived them; derived here when omitted. */
  readonly eligibleLineIds?: ReadonlySet<string>;
}

/**
 * The discount a code takes off a goods subtotal, as the applied promo a summary panel, a confirmation or an
 * order detail renders: the code, its kind, the wording for that kind and the amount in minor units, clamped
 * to its base and `0` for a `free_shipping` code, whose whole effect is the delivery charge
 * {@link priceCartLines} waives. `PricedCart.discountTotalMinor` is the sum of the amounts of the applied
 * promos, so an amount reported here is always part of that total. The label is built once, from the code and
 * the wording for its kind in `src/constants/taxonomy.ts`. `subtotalMinor` is the goods subtotal the code
 * applies to, before any discount: wholly for an `order`-scoped code, and the part its own categories cover
 * for a `category`-scoped one, which is why {@link ApplyPromoOptions.categoryIdsByProductId} must be supplied
 * to narrow one. The per-line subtotals and the eligible set supplied through `options` are used as given, so
 * {@link priceCartLines} pays for neither twice, and a subtotal list not parallel to `lines` is ignored.
 */
export function applyPromo(
  subtotalMinor: MinorUnits,
  promo: PromoCode,
  lines: readonly CartLine[],
  options: ApplyPromoOptions = {},
): AppliedPromo {
  const goodsSubtotalMinor = Math.max(0, roundToMinor(subtotalMinor));
  const eligible =
    options.eligibleLineIds ?? eligibleLineIds(promo, lines, options.categoryIdsByProductId);
  const suppliedSubtotals = options.lineSubtotalsMinor;
  const lineSubtotals =
    suppliedSubtotals?.length === lines.length ? suppliedSubtotals : lines.map(lineSubtotalMinor);
  const eligibleSubtotalMinor = lines.reduce(
    (total, line, index) => (eligible.has(line.id) ? total + lineSubtotals[index] : total),
    0,
  );
  const base =
    promo.appliesTo === "category"
      ? clampNumber(eligibleSubtotalMinor, 0, goodsSubtotalMinor)
      : goodsSubtotalMinor;
  return {
    code: promo.code,
    kind: promo.kind,
    label: `${promo.code} · ${PROMO_KIND_LABELS[promo.kind]}`,
    amountMinor: clampDiscount(base, PROMO_DISCOUNT_RULES[promo.kind](base, promo)),
  };
}

// Deciding whether a code applies -----------------------------------------------------------------

/** Everything the promo decision reads: the code as it arrived, the stored code it names, the basket it
 * would discount, the date the decision is taken on and the code the basket already carries. */
export interface PromoDecisionInput {
  /** The code as it was typed or submitted; matched after normalisation. */
  readonly code: string;
  /** The stored code that spelling names, or `undefined` when no code carries it. */
  readonly promo: PromoCode | undefined;
  /** The basket the code would discount, which decides its floor and its eligible goods. */
  readonly lines: readonly CartLine[];
  /** The local calendar date the decision is taken on, as `YYYY-MM-DD`: a code's window is a pair of
   *  calendar dates, so the calendar in play is the shopper's, as every date in this product is. */
  readonly today: string;
  /** The code the basket already carries, when the caller knows it. A caller holding no basket omits it,
   *  and that is the one input whose absence makes `already-applied` unreachable. */
  readonly alreadyAppliedCode?: string | null;
  /** See {@link ApplyPromoOptions.categoryIdsByProductId}: what a `category`-scoped code is narrowed by. */
  readonly categoryIdsByProductId?: ReadonlyMap<string, CategoryId>;
}

/**
 * Whether a code applies to a basket and, where it does not, which of the eight reasons it is — decided here
 * and nowhere else, in this order:
 *
 * 1. **Shape** — a spelling that is not four to sixteen upper-case letters or digits is not one the product
 *    issued, so it is `unknown`.
 * 2. **Existence** — no stored code carries the spelling: `unknown`.
 * 3. **Active window** — the code was withdrawn (`inactive`), has not opened yet (`not-started`) or has
 *    closed (`expired`). The window includes both of its own dates.
 * 4. **Minimum subtotal** — the basket's goods subtotal is below the code's floor: `below-minimum`.
 * 5. **Usage limit** — the code has been used as often as it may be: `usage-limit`.
 * 6. **Already applied** — the basket already carries the code: `already-applied`.
 * 7. **Eligible goods** — a `category`-scoped code whose categories hold nothing here:
 *    `ineligible-category`.
 *
 * `undefined` means the code applies. Both dates are `YYYY-MM-DD` strings, which compare exactly as text, so
 * the window needs no calendar arithmetic, and the subtotal is summed from the lines rather than taken from
 * a caller, so the floor is judged against the same goods the discount would be applied to.
 */
export function decidePromo(input: PromoDecisionInput): PromoRejectionReason | undefined {
  const code = normalisePromoCode(input.code);
  if (code === null || validatePromoCodeShape(code) !== undefined) return "unknown";
  const { promo } = input;
  if (promo === undefined) return "unknown";
  if (!promo.active) return "inactive";
  if (input.today < promo.startsAt) return "not-started";
  if (input.today > promo.endsAt) return "expired";
  if (subtotalOfLines(input.lines) < promo.minSubtotalMinor) return "below-minimum";
  if (promo.usageCount >= promo.usageLimit) return "usage-limit";
  const appliedCode = normalisePromoCode(input.alreadyAppliedCode);
  if (appliedCode !== null && appliedCode === code) return "already-applied";
  const eligible = eligibleLineIds(promo, input.lines, input.categoryIdsByProductId);
  if (promo.appliesTo === "category" && eligible.size === 0) return "ineligible-category";
  return undefined;
}

// Shipping and tax --------------------------------------------------------------------------------

/**
 * The delivery method a basket is charged for, resolved from the method the buyer chose.
 *
 * The returned method is the stored method carrying the price *this basket* pays: its own stored price
 * normally, and `0` once the discounted subtotal reaches `FREE_SHIPPING_THRESHOLD_MINOR` for the configured
 * `FREE_SHIPPING_METHOD_ID`. The configured list keeps the stored price and `PricedCart.shippingMinor` is
 * the charge, so the two are never confused and nothing here rewrites a configured price.
 *
 * An id that names no method, including `null` before the buyer has chosen one, resolves to the first method
 * of the list, so a basket always has a charge and a grand total to show. A caller that supplies no list at
 * all is priced against the configured set.
 */
export function resolveShipping(
  subtotalMinorAfterDiscount: MinorUnits,
  shippingMethodId: string | null,
  methods: readonly ShippingMethod[] = SHIPPING_METHODS,
): ShippingMethod {
  const candidates: readonly ShippingMethod[] =
    methods.length > 0 ? methods : [FALLBACK_SHIPPING_METHOD];
  const method = candidates.find((candidate) => candidate.id === shippingMethodId) ?? candidates[0];
  const subtotalMinor = Math.max(0, roundToMinor(subtotalMinorAfterDiscount));
  const waived =
    method.id === FREE_SHIPPING_METHOD_ID && subtotalMinor >= FREE_SHIPPING_THRESHOLD_MINOR;
  return waived ? { ...method, priceMinor: 0 } : method;
}

/**
 * The tax on a taxable goods subtotal, at the rate `src/constants/config.ts` owns.
 *
 * One multiplication by the decimal rate and one rounding through the codebase's single rounding rule, so no
 * figure is the residue of accumulated decimal arithmetic. Tax is charged on goods alone — a delivery charge
 * is not taxed — which is why the caller passes the discounted subtotal and not the total. A base or a rate
 * that is negative or not a number is taxed as nothing rather than producing a figure.
 */
export function computeTax(taxableMinor: MinorUnits, taxRate: number = TAX_RATE): MinorUnits {
  const base = Math.max(0, roundToMinor(taxableMinor));
  const rate = Number.isFinite(taxRate) ? Math.max(0, taxRate) : 0;
  return roundToMinor(base * rate);
}

// Pricing a cart ----------------------------------------------------------------------------------

/** The basket a priced cart is computed from: the lines, the code that applies, the method chosen and the
 *  catalogue facts a `category`-scoped code is narrowed by. */
export interface PriceCartInput {
  readonly lines: readonly CartLine[];
  /** The code the basket carries, already resolved to a stored code that applies, or `undefined`. */
  readonly promo: PromoCode | undefined;
  /** The method the buyer chose, or `null` before they have chosen one. */
  readonly shippingMethodId: string | null;
  /** The methods a checkout may offer; the configured set when the caller supplies none. */
  readonly shippingMethods?: readonly ShippingMethod[];
  /** See {@link ApplyPromoOptions.categoryIdsByProductId}. */
  readonly categoryIdsByProductId?: ReadonlyMap<string, CategoryId>;
}

/** The shortfall to free delivery, in minor units: zero once the discounted subtotal reaches the configured
 * threshold, and what is still owed until then — the figure the cart's progress indicator reports. */
function freeShippingRemainingMinor(discountedSubtotalMinor: MinorUnits): MinorUnits {
  return Math.max(0, FREE_SHIPPING_THRESHOLD_MINOR - Math.max(0, discountedSubtotalMinor));
}

/**
 * Prices a basket: the one function in the product that produces a `PricedCart`, and so the one place a
 * subtotal, a discount, a delivery charge, a tax amount or a grand total is computed. Every screen that shows
 * a total reads one of these, so a cart and the order placed from it cannot disagree about the order's cost.
 *
 * The order of operations documented at the head of this module is applied here and nowhere else, and a
 * `free_shipping` code waives the whole delivery charge whatever the method and whatever the subtotal; the
 * lines are read and never written. The per-line subtotals and the eligible set are derived once here and
 * handed to {@link applyPromo}, which derives neither again; `shippingMethodId` echoes a method the caller
 * chose and stays `null` while none has been chosen, so a summary never names a method nobody picked.
 */
export function priceCartLines(input: PriceCartInput): PricedCart {
  const { lines, promo } = input;
  const lineSubtotals = lines.map((line) => lineSubtotalMinor(line));
  const subtotalMinor = sumBy(lineSubtotals, (amount) => amount);
  const eligible =
    promo === undefined ? undefined : eligibleLineIds(promo, lines, input.categoryIdsByProductId);
  const appliedPromo =
    promo === undefined
      ? undefined
      : applyPromo(subtotalMinor, promo, lines, {
          categoryIdsByProductId: input.categoryIdsByProductId,
          lineSubtotalsMinor: lineSubtotals,
          eligibleLineIds: eligible,
        });
  const discountTotalMinor = appliedPromo?.amountMinor ?? 0;
  const discountedSubtotalMinor = Math.max(0, subtotalMinor - discountTotalMinor);

  const shippingMethods = input.shippingMethods ?? SHIPPING_METHODS;
  const shippingMethod = resolveShipping(
    discountedSubtotalMinor,
    input.shippingMethodId,
    shippingMethods,
  );
  const shippingMinor = promo?.kind === "free_shipping" ? 0 : shippingMethod.priceMinor;
  const taxMinor = computeTax(discountedSubtotalMinor);

  const weights = lines.map((line, index) =>
    eligible !== undefined && !eligible.has(line.id) ? 0 : lineSubtotals[index],
  );
  const discountShares = allocateProportionally(discountTotalMinor, weights);
  const pricedLines: PricedCartLine[] = lines.map((line, index) => {
    const lineSubtotal = lineSubtotals[index];
    const discountMinor = discountShares[index];
    return {
      ...line,
      lineSubtotalMinor: lineSubtotal,
      discountMinor,
      lineTotalMinor: lineSubtotal - discountMinor,
    };
  });

  return {
    lines: pricedLines,
    subtotalMinor,
    discountTotalMinor,
    shippingMinor,
    taxMinor,
    grandTotalMinor: subtotalMinor - discountTotalMinor + shippingMinor + taxMinor,
    appliedPromos: appliedPromo === undefined ? [] : [appliedPromo],
    freeShippingRemainingMinor: freeShippingRemainingMinor(discountedSubtotalMinor),
    currency: DEFAULT_CURRENCY,
    shippingMethodId:
      input.shippingMethodId !== null && shippingMethod.id === input.shippingMethodId
        ? shippingMethod.id
        : null,
  };
}

/** How far a basket is from free delivery: what is still owed, how full the progress indicator is and
 *  whether the threshold is already met. */
export interface FreeShippingProgress {
  readonly remainingMinor: MinorUnits;
  /** The share of the threshold the basket has covered, from 0 to 1; 1 when the threshold is 0. */
  readonly ratio: number;
  readonly qualifies: boolean;
}

/**
 * The free-delivery position of a priced cart, derived from the figure {@link priceCartLines} computed and the
 * configured threshold: what a cart's progress bar draws and what its label says is still owed. The threshold
 * arithmetic lives here rather than in a component, so the bar, the label and the charge the buyer pays agree.
 *
 * A threshold of `0` puts every basket at free delivery, so `ratio` is `1` and `qualifies` is `true`: this is
 * the guard the module's other degenerate inputs get, and a positive threshold needs no clamp at all.
 */
export function freeShippingProgress(priced: PricedCart): FreeShippingProgress {
  const remainingMinor = Math.max(0, roundToMinor(priced.freeShippingRemainingMinor));
  const thresholdMinor = FREE_SHIPPING_THRESHOLD_MINOR;
  const coveredMinor = Math.max(0, thresholdMinor - remainingMinor);
  return {
    remainingMinor,
    ratio: thresholdMinor > 0 ? coveredMinor / thresholdMinor : 1,
    qualifies: remainingMinor === 0,
  };
}

// Reading a promo failure -------------------------------------------------------------------------

/**
 * The reason a failed promo request names, read from the failure's `code`, or `undefined` when the failure
 * is not one of the eight — an unbound data source, a malformed body or a superseded request.
 *
 * The seam answers a code it will not apply with the reason as the failure's `code` and the field
 * `"promoCode"`, so this turns a failed `Result<PromoCode>` back into a cause a cart can name rather than
 * one flat message for eight different ones.
 */
export function promoRejectionReason(error: ApiError): PromoRejectionReason | undefined {
  return isPromoRejectionReason(error.code) ? error.code : undefined;
}

/** The sentence a shopper reads for a promo failure, from `src/constants/content.ts`, or `undefined` when
 * the failure is not one of the eight and the failure's own message is what should be shown instead. */
export function promoRejectionMessage(error: ApiError): string | undefined {
  return isPromoRejectionReason(error.code) ? PROMO_REJECTION_MESSAGES[error.code] : undefined;
}

// The API seam ------------------------------------------------------------------------------------

/** What a pricing request may carry besides its body: the signal a superseded request is cancelled through,
 *  which is how a cart stops waiting for a price a newer edit replaced. */
export interface PricingRequestOptions {
  readonly signal?: AbortSignal;
}

/**
 * Prices a basket through the API seam: the cart's and the checkout's one way to turn a snapshot of lines, a
 * code and a chosen method into the `PricedCart` every surface displays.
 *
 * A failure is a value, never an exception. A code that no longer applies answers `409` with the
 * `PromoRejectionReason` as its `code` and `"promoCode"` as its `field` — read with
 * {@link promoRejectionReason} — and a line that can no longer be priced answers `422` naming its field.
 *
 * @param lines - The basket to price, as the cart holds it.
 * @param promoCode - The code the cart carries, or `undefined` for none; normalised before it is sent.
 * @param shippingMethodId - The method the buyer chose, or `null` before one is chosen.
 * @param options - The abort signal, for a price a newer one supersedes.
 * @returns The priced cart, or the shaped failure.
 */
export function priceCart(
  lines: readonly CartLine[],
  promoCode: string | undefined,
  shippingMethodId: string | null,
  options: PricingRequestOptions = {},
): Promise<Result<PricedCart>> {
  const body: CartPricingRequest = {
    lines,
    promoCode: normalisePromoCode(promoCode),
    shippingMethodId,
  };
  return postJson<PricedCart, CartPricingRequest>(CART_PRICE_PATH, body, options);
}

/**
 * Checks a code against the basket it is about to discount: the cart's one way to find out whether a code
 * applies before it stores one, and so before it re-prices anything.
 *
 * The spelling is normalised and its shape checked here first, so a code that is not four to sixteen letters
 * or digits is refused without a request and answered exactly as the seam would have answered it — the shape
 * rule's message, `422`, against the `promoCode` field. What a shape cannot decide is whether a code is still
 * open, above the basket's floor, within its uses or aimed at goods this basket holds: that is the data
 * layer's answer, and it arrives as a `409` whose `code` is the reason (see {@link promoRejectionReason}).
 *
 * @param code - The code as the shopper typed it; normalised before it is checked or sent.
 * @param lines - The basket the code would discount, which decides its floor and its eligible goods.
 * @param options - The abort signal, for a check a newer one supersedes.
 * @returns The stored code when it applies, or the shaped failure naming why it does not.
 */
export function validatePromoCode(
  code: string,
  lines: readonly CartLine[],
  options: PricingRequestOptions = {},
): Promise<Result<PromoCode>> {
  const normalisedCode = normalisePromoCode(code) ?? "";
  const shapeMessage = validatePromoCodeShape(normalisedCode);
  if (shapeMessage !== undefined) {
    const failure: Result<PromoCode> = {
      ok: false,
      error: {
        status: VALIDATION_FAILURE.status,
        code: VALIDATION_FAILURE.code,
        message: shapeMessage,
        field: PROMO_CODE_FIELD,
      },
    };
    return Promise.resolve(failure);
  }
  const body: PromoValidationRequest = { code: normalisedCode, lines };
  return postJson<PromoCode, PromoValidationRequest>(PROMO_VALIDATION_PATH, body, options);
}

/**
 * The delivery methods a checkout may offer, with their names, their descriptions, their own stored prices
 * and their delivery windows.
 *
 * The cart and the checkout's shipping step both read the list from here rather than fetching it for
 * themselves, so a method is named and described identically wherever it appears. The price on a method is
 * the price it is offered at; what a particular basket is charged for it is `PricedCart.shippingMinor`, which
 * {@link resolveShipping} decides.
 *
 * @param options - The abort signal, for a list a newer request supersedes.
 * @returns The methods, or the shaped failure.
 */
export function listShippingMethods(
  options: PricingRequestOptions = {},
): Promise<Result<ShippingMethod[]>> {
  return getJson<ShippingMethod[]>(SHIPPING_METHODS_PATH, options);
}
