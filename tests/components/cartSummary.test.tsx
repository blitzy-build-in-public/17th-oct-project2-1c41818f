/**
 * Path: tests/components/cartSummary.test.tsx
 * Purpose: The cart's summary panel through its own props: the placeholder a basket with no price yet stands in, the amount rows, the delivery the basket has and has not been charged for, the free-delivery band either way, the rows a code earns, the refused price with its retry, and the promo entry's whole contract — the shapes its own rule refuses, the refusal the seam files against the field, a failure that names no control, and the code it stores and withdraws
 * Lines: 408
 */

import { describe, expect, it, vi } from "vitest";

import {
  CART_COPY,
  COMMON_ACTIONS,
  PROMO_REJECTION_MESSAGES,
  VALIDATION_MESSAGES,
  appliedPromoLabel,
  freeShippingProgressLabel,
  promoCodeLengthMessage,
  removePromoLabel,
} from "@/constants/content";
import { FREE_SHIPPING_THRESHOLD_MINOR, STORAGE_KEYS } from "@/constants/config";
import { PROMO_CODES } from "@/data/orders";
import { PRODUCTS } from "@/data/products";
import { CartSummary } from "@/features/cart/CartSummary";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import { priceCart } from "@/lib/pricingService";
import { createCartLine, createInitialCartState, toCart } from "@/state/cartReducer";
import type { MinorUnits } from "@/types/common";
import type { CartLine, PricedCart, PromoCode } from "@/types/commerce";
import { formatMoney } from "@/utils/format";
import { writeStored } from "@/utils/storage";
import { PROMO_CODE_MAX_LENGTH, PROMO_CODE_MIN_LENGTH } from "@/utils/validation";

import { CHOSEN_METHOD } from "../helpers/checkoutHarness";
import { rowAmount, summaryPanel } from "../helpers/journeyHarness";
import { failNext, renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * The summary panel mounted on its own, inside the real providers, and handed its figures as props. Every
 * price below comes from `src/lib/pricingService.ts` — the one module that produces a `PricedCart` — so a case
 * asserts the panel against the product's own arithmetic rather than against a figure written here, and the
 * only value a case assembles itself is the pair of codes a run of discount rows is driven with.
 *
 * The panel keeps the request's lifecycle as a prop and reads the cart's own code from the context, so the
 * promo entry is driven through the form the panel renders: its spellings, the seam's answer, and the control
 * that withdraws an accepted code.
 */

/** The field a promo failure is filed against, as the pricing service spells it. */
const PROMO_CODE_FIELD = "promoCode";

/** The retry the panel offers where its figures go, which a case observes rather than performs. */
const noRetry = (): void => undefined;

/** The failure a case hands the panel when the price it asked for was refused. */
const noError = null;

/** One of the seeded lines a case prices, built by the cart's own constructor. */
function seededLine(units: number, atLeastMinor = 0): CartLine {
  const product = [...PRODUCTS]
    .filter(
      (candidate) =>
        candidate.priceMinor > 0 &&
        candidate.stockOnHand >= units &&
        candidate.priceMinor * units >= atLeastMinor,
    )
    .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  if (product === undefined) {
    throw new Error(`No seeded product holds ${String(units)} units at that price.`);
  }
  const line = createCartLine(product, units);
  if (line === null) throw new Error(`No line could be built for "${product.name}".`);
  return line;
}

/** A basket small enough to be short of free delivery, and one that has reached the threshold. */
const SMALL_LINE = seededLine(2);
const BULK_LINE = seededLine(5, FREE_SHIPPING_THRESHOLD_MINOR);

/** A basket priced by the product's own pricing service, with the failure it cannot accept thrown. */
async function pricedCart(
  lines: readonly CartLine[],
  promoCode?: string,
  shippingMethodId: string | null = null,
): Promise<PricedCart> {
  const result = await priceCart(lines, promoCode, shippingMethodId);
  if (!result.ok) throw new Error(`The basket could not be priced: ${result.error.message}`);
  return result.value;
}

/**
 * Puts a basket into the stored cart the panel's provider hydrates from: a code is checked against the goods
 * a basket holds, so a case that drives the promo entry gives the panel a basket to check against rather than
 * the empty one a request validation refuses.
 */
function storedBasket(lines: readonly CartLine[]): void {
  writeStored(STORAGE_KEYS.CART, toCart(createInitialCartState({ lines })));
}

/** The seeded code that takes a percentage off the goods and applies to any basket. */
function goodsCode(): PromoCode {
  const code = PROMO_CODES.find(
    (promo) =>
      promo.active &&
      promo.kind === "percent" &&
      promo.appliesTo === "order" &&
      promo.minSubtotalMinor === 0 &&
      promo.usageCount < promo.usageLimit,
  );
  if (code === undefined) throw new Error("No seeded code discounts any basket.");
  return code;
}

/** The seeded code that waives the delivery charge, whose saving is on the charge and not on the goods. */
function deliveryCode(): PromoCode {
  const code = PROMO_CODES.find(
    (promo) =>
      promo.active &&
      promo.kind === "free_shipping" &&
      promo.minSubtotalMinor <= BULK_LINE.unitPriceMinor * BULK_LINE.quantity &&
      promo.usageCount < promo.usageLimit,
  );
  if (code === undefined) throw new Error("No seeded code waives this basket's delivery.");
  return code;
}

/** The figures region of the panel: the one element inside it that carries the request's busy state. */
function figuresRegion(summary: HTMLElement): HTMLElement {
  const region = summary.querySelector<HTMLElement>("[aria-busy]");
  if (region === null) throw new Error("The summary states no busy figures region.");
  return region;
}

/** A basket with codes applied, with the amount the panel's own rows will add up to. */
interface CodedBasket {
  readonly pricedCart: PricedCart;
  readonly codesAmountMinor: MinorUnits;
}

/** The basket one code discounts: the amount its own row states is the code's whole effect. */
async function basketWithOneCode(): Promise<CodedBasket> {
  const priced = await pricedCart([BULK_LINE], goodsCode().code);
  const codesAmountMinor = priced.appliedPromos.reduce((sum, promo) => sum + promo.amountMinor, 0);
  return { pricedCart: priced, codesAmountMinor };
}

/**
 * The basket two codes ride on, assembled from the two prices the product produces for it: the one the goods
 * code discounted, and the one the delivery code was applied to. Only the pairing is written here — each code
 * is one `src/lib/pricingService.ts` accepted for this basket, and its amount is that service's figure.
 */
async function basketWithTwoCodes(): Promise<CodedBasket> {
  const goods = await pricedCart([BULK_LINE], goodsCode().code);
  const delivery = await pricedCart([BULK_LINE], deliveryCode().code);
  if (goods.appliedPromos.length !== 1 || delivery.appliedPromos.length !== 1) {
    throw new Error("The seeded codes did not each apply once to this basket.");
  }
  // The delivery code's whole effect is the charge it waives, so its goods amount is the service's own zero.
  if (delivery.appliedPromos.some((promo) => promo.amountMinor !== 0)) {
    throw new Error("The delivery code reduced the goods, which the pricing rules do not.");
  }
  return {
    pricedCart: {
      ...goods,
      appliedPromos: [...goods.appliedPromos, ...delivery.appliedPromos],
      discountTotalMinor: goods.discountTotalMinor + delivery.discountTotalMinor,
    },
    codesAmountMinor: goods.discountTotalMinor + delivery.discountTotalMinor,
  };
}

/** The two baskets a case drives the discount rows with: a code alone, and a code beside a second one. */
const CODED_BASKETS = [
  { basket: basketWithOneCode, name: "one code applied", showsTotalDiscountRow: false },
  { basket: basketWithTwoCodes, name: "two codes applied", showsTotalDiscountRow: true },
] as const;

// The figures ------------------------------------------------------------------------------------

describe("the summary panel's figures", () => {
  it("stands a placeholder rather than zeroes in while the basket has no price yet", () => {
    renderWithProviders(
      <CartSummary error={null} onRetry={noRetry} pricedCart={null} status="loading" />,
    );

    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    // Nothing has been quoted, so no amount row stands — a total that has not been given is not zero.
    expect(within(summary).queryByText(CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeNull();
    expect(within(summary).queryByText(CART_COPY.SUMMARY_TOTAL_LABEL)).toBeNull();
    expect(figuresRegion(summary)).toHaveAttribute("aria-busy", "true");
    // The panel itself stands whatever the request is doing, so a code can be corrected at any moment.
    expect(screen.getByLabelText(CART_COPY.PROMO_FIELD_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL })).toBeInTheDocument();
  });

  it("states the amounts, the delivery it has not been charged for, and the shortfall to free delivery", async () => {
    const priced = await pricedCart([SMALL_LINE]);
    renderWithProviders(
      <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
    );

    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    expect(rowAmount(summary, CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBe(priced.subtotalMinor);
    expect(rowAmount(summary, CART_COPY.SUMMARY_TAX_LABEL)).toBe(priced.taxMinor);
    expect(rowAmount(summary, CART_COPY.SUMMARY_TOTAL_LABEL)).toBe(priced.grandTotalMinor);
    expect(figuresRegion(summary)).toHaveAttribute("aria-busy", "false");
    // No delivery method has been chosen, so the row says where the charge is settled instead of quoting one.
    expect(priced.shippingMethodId).toBeNull();
    expect(
      within(summary).getByText(CART_COPY.SUMMARY_SHIPPING_AT_CHECKOUT_LABEL),
    ).toBeInTheDocument();
    // The band states the shortfall the pricing service computed, and the bar is filled to its share.
    expect(screen.getByRole("progressbar")).toHaveAccessibleName(
      freeShippingProgressLabel(formatMoney(priced.freeShippingRemainingMinor)),
    );
    // The one figure a cart change moves is the one the panel announces.
    expect(screen.getByRole("status")).toHaveTextContent(
      `${CART_COPY.SUMMARY_TOTAL_LABEL} ${formatMoney(priced.grandTotalMinor)}`,
    );
  });

  it("charges the delivery the basket was priced with once a method has been chosen, and reports free delivery earned", async () => {
    const priced = await pricedCart([BULK_LINE], undefined, CHOSEN_METHOD.id);
    // The basket reached the free-delivery threshold and the method it was priced with still charges.
    expect(priced.freeShippingRemainingMinor).toBe(0);
    expect(priced.shippingMinor).toBeGreaterThan(0);
    renderWithProviders(
      <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
    );

    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    expect(rowAmount(summary, CART_COPY.SUMMARY_SHIPPING_LABEL)).toBe(priced.shippingMinor);
    expect(screen.getByRole("progressbar")).toHaveAccessibleName(
      CART_COPY.FREE_DELIVERY_EARNED_LABEL,
    );
    expect(rowAmount(summary, CART_COPY.SUMMARY_TOTAL_LABEL)).toBe(priced.grandTotalMinor);
  });

  it.each(CODED_BASKETS)(
    "names each code the basket applied and states the total discount only beneath a run of them ($name)",
    async ({ basket, showsTotalDiscountRow }) => {
      const { pricedCart: priced, codesAmountMinor } = await basket();
      renderWithProviders(
        <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
      );

      const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
      for (const promo of priced.appliedPromos) {
        expect(rowAmount(summary, promo.label)).toBe(promo.amountMinor);
      }
      if (showsTotalDiscountRow) {
        expect(rowAmount(summary, CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBe(codesAmountMinor);
      } else {
        expect(within(summary).queryByText(CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBeNull();
      }
      expect(rowAmount(summary, CART_COPY.SUMMARY_TOTAL_LABEL)).toBe(priced.grandTotalMinor);
      expect(priced.grandTotalMinor).toBe(
        priced.subtotalMinor - priced.discountTotalMinor + priced.shippingMinor + priced.taxMinor,
      );
    },
  );

  it("reports a refused price where the figures go, and asks for the figures again through its own retry", async () => {
    // The failure is the seam's own answer to a price request, armed for one call and taken from it.
    const armed = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    const refused = await priceCart([SMALL_LINE], undefined, null);
    armed.disarm();
    if (refused.ok) throw new Error("The armed price request was answered.");

    const retry = vi.fn();
    const { user } = renderWithProviders(
      <CartSummary error={refused.error} onRetry={retry} pricedCart={null} status="error" />,
    );

    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    const alert = within(summary).getByRole("alert");
    expect(alert).toHaveTextContent(refused.error.message);
    // The failure stands where the figures would, so no amount row is stated beneath an unreadable price.
    expect(within(summary).queryByText(CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeNull();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

// The promo entry ---------------------------------------------------------------------------------

describe("the promo entry", () => {
  /** The spellings the field's own rule refuses, each with the sentence it states for them. */
  const SHAPE_REFUSALS = [
    { message: VALIDATION_MESSAGES.REQUIRED, name: "nothing typed", spelling: "   " },
    {
      message: promoCodeLengthMessage(PROMO_CODE_MIN_LENGTH, PROMO_CODE_MAX_LENGTH),
      name: "too few characters",
      spelling: "AB",
    },
    {
      message: VALIDATION_MESSAGES.PROMO_CODE_FORMAT,
      name: "characters a code is never built from",
      spelling: "AB-CD",
    },
  ] as const;

  it.each(SHAPE_REFUSALS)(
    "refuses a code with $name against the field itself, without a code being stored",
    async ({ message, spelling }) => {
      const priced = await pricedCart([SMALL_LINE]);
      storedBasket([SMALL_LINE]);
      const { user } = renderWithProviders(
        <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
      );
      const field = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);

      await user.type(field, spelling);
      await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));

      // The reason is the control's own message, which is what marks it invalid and describes it.
      expect(field).toHaveAttribute("aria-invalid", "true");
      const describedBy = field.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(describedBy)?.textContent).toBe(message);
    },
  );

  it("states a failure that names no control in the band, leaving the field itself unmarked", async () => {
    const armed = failNext({ method: "POST", path: API_PATHS.CART_VALIDATE_PROMO });
    const priced = await pricedCart([SMALL_LINE]);
    storedBasket([SMALL_LINE]);
    const { user } = renderWithProviders(
      <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
    );
    const field = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);

    await user.type(field, goodsCode().code);
    await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));

    // A form-wide message belongs in the band, where the panel states it as a warned alert.
    expect(await screen.findByText(FALLBACK_FAILURE_MESSAGE)).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(appliedPromoLabel(goodsCode().code))).toBeNull();
    armed.disarm();
  });

  it("files a code the seam refuses against the field the shopper typed it into", async () => {
    storedBasket([SMALL_LINE]);
    const priced = await pricedCart([SMALL_LINE]);
    // The seam refuses a code against the field it belongs to, in one of its own refusal reasons.
    const armed = failNext({
      code: "below-minimum",
      field: PROMO_CODE_FIELD,
      message: PROMO_REJECTION_MESSAGES["below-minimum"],
      method: "POST",
      path: API_PATHS.CART_VALIDATE_PROMO,
    });
    const { user } = renderWithProviders(
      <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
    );
    const field = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);

    await user.type(field, goodsCode().code);
    await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));
    armed.disarm();

    // The reason reaches the control itself, which is what marks it invalid and describes it, and no code is stored.
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    const describedBy = field.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(
      PROMO_REJECTION_MESSAGES["below-minimum"],
    );
    expect(screen.queryByText(appliedPromoLabel(goodsCode().code))).toBeNull();
  });

  it("corrects itself as the code is edited, clearing the refusal it was stating", async () => {
    const priced = await pricedCart([SMALL_LINE]);
    storedBasket([SMALL_LINE]);
    const { user } = renderWithProviders(
      <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
    );
    const field = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);

    await user.type(field, "AB");
    await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));
    expect(field).toHaveAttribute("aria-invalid", "true");

    await user.type(field, "CD");

    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(field).not.toHaveAccessibleDescription();
  });

  it("stores a code the seam accepts, states it with the control that withdraws it, and gives the field back the keyboard", async () => {
    const code = goodsCode();
    const priced = await pricedCart([SMALL_LINE]);
    storedBasket([SMALL_LINE]);
    const { user } = renderWithProviders(
      <CartSummary error={noError} onRetry={noRetry} pricedCart={priced} status="success" />,
    );
    const field = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);

    await user.type(field, code.code);
    await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));

    // The panel states the code the cart now holds, beside the one control that takes it off again.
    expect(await screen.findByText(appliedPromoLabel(code.code))).toBeInTheDocument();
    expect(field).toHaveValue("");
    await user.click(screen.getByRole("button", { name: removePromoLabel(code.code) }));

    // Withdrawn through the cart's own state, and the control that was used left with the code it withdrew.
    await waitFor(() => expect(screen.queryByText(appliedPromoLabel(code.code))).toBeNull());
    expect(field).toHaveFocus();
  });
});
