/**
 * Path: src/lib/pricingService.ts
 * Purpose: Line and order totals, promo application, shipping and tax for the cart and checkout
 * Lines: 177
 */

import { FEEDBACK_COPY, PROMO_REJECTION_MESSAGES, VALIDATION_MESSAGES } from "@/constants/content";
import { API_ERROR_CODES, API_PATHS, failure, getJson, postJson } from "@/lib/apiClient";
import type { ApiError, Result } from "@/types/common";
import type {
  CartLine,
  CartPricingRequest,
  PricedCart,
  PromoCode,
  PromoRejectionReason,
  PromoValidationRequest,
  ShippingMethod,
} from "@/types/commerce";
import { normalisePromoCode } from "@/utils/pricingRules";
import { firstError, hasErrors, validatePromoCodeShape } from "@/utils/validation";

// The public surface ------------------------------------------------------------------------------
// The pricing rules this module is named for — the order of operations stated at the head of
// `src/utils/pricingRules.ts`, the line and order totals, the promo decision, the delivery charge and the
// tax — live in the foundations layer, because the data module prices its seeded order history through them
// and a file may import only from its own layer or from a layer below it. Every name a consumer imports
// stays at this path.

export {
  applyPromo,
  chargeForMethod,
  clampDiscount,
  computeTax,
  decidePromo,
  freeShippingProgress,
  lineSubtotalMinor,
  normalisePromoCode,
  priceCartLines,
  resolveShipping,
  roundToMinor,
} from "@/utils/pricingRules";
export type {
  ApplyPromoOptions,
  FreeShippingProgress,
  PriceCartInput,
  PromoDecisionInput,
} from "@/utils/pricingRules";

// Spellings and fixed values ----------------------------------------------------------------------

/** The control a promo failure belongs to, as the field every surface renders it against. */
const PROMO_CODE_FIELD = "promoCode";

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

// Reading a promo failure -------------------------------------------------------------------------

/**
 * The sentence a surface states when a price or validation failure refused the code the basket holds, or
 * `undefined` when the failure is not about that code at all and the surface must leave it alone.
 *
 * The seam files a code it will not apply against the control the code belongs to — `"promoCode"` — with
 * the `PromoRejectionReason` as the failure's `code`, so the field is what identifies a refusal and the
 * code names its cause: the sentence is then the reason's own wording from `src/constants/content.ts`. The
 * shape rule refuses a spelling that is not a code at all against that same field, and carries the
 * sentence to read in its own message, which is why one reader serves both.
 *
 * What a surface does with the sentence is the same everywhere, because the code the basket holds is one
 * the seam will not honour: the code is withdrawn and this sentence states why the figures changed, which
 * is what leaves the retry beside a price failure one that can succeed. `undefined` means the failure is
 * about something else — an unbound data source, a line the catalogue can no longer cover, a superseded
 * request — and nothing about the code should change.
 *
 * @param error - The failure a promo check or a price request answered with.
 * @returns The sentence to state, or `undefined` when the failure is not about the code the basket holds.
 */
export function promoRefusalMessage(error: ApiError): string | undefined {
  if (error.field !== PROMO_CODE_FIELD) return undefined;
  if (isPromoRejectionReason(error.code)) return PROMO_REJECTION_MESSAGES[error.code];
  const carried = error.message.trim();
  return carried.length > 0 ? carried : FEEDBACK_COPY.ERROR_STATE_BODY;
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
 * {@link promoRefusalMessage} — and a line that can no longer be priced answers `422` naming its field.
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
  return postJson<PricedCart, CartPricingRequest>(API_PATHS.CART_PRICE, body, options);
}

/**
 * Checks a code against the basket it is about to discount: the cart's one way to find out whether a code
 * applies before it stores one, and so before it re-prices anything.
 *
 * The spelling is normalised and its shape checked here first, so a code that is not four to sixteen letters
 * or digits is refused without a request and answered exactly as the seam would have answered it — the shape
 * rule's message, `422`, against the `promoCode` field. What a shape cannot decide is whether a code is still
 * open, above the basket's floor, within its uses or aimed at goods this basket holds: that is the data
 * layer's answer, and it arrives as a `409` whose `code` is the reason (see {@link promoRefusalMessage}).
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
  const shapeErrors = validatePromoCodeShape(normalisedCode);
  if (hasErrors(shapeErrors)) {
    const message = firstError(shapeErrors) ?? VALIDATION_MESSAGES.REQUIRED;
    return Promise.resolve(failure(API_ERROR_CODES.VALIDATION_FAILED, message, PROMO_CODE_FIELD));
  }
  const body: PromoValidationRequest = { code: normalisedCode, lines };
  return postJson<PromoCode, PromoValidationRequest>(API_PATHS.CART_VALIDATE_PROMO, body, options);
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
  return getJson<ShippingMethod[]>(API_PATHS.SHIPPING_METHODS, options);
}
