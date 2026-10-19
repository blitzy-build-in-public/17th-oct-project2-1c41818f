/**
 * Path: tests/components/cartPage.test.tsx
 * Purpose: The cart route's own contract: the lines it holds with the figures the pricing service produced, the wait a re-price reports while the rows stay usable, the line at its stock ceiling, the line dropped from a pair, the empty cart the clear control leaves with the keyboard handed on, the way on to the checkout while a price stands and its refusal while one does not, and the code the page withdraws
 * Lines: 378
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { STORAGE_KEYS } from "@/constants/config";
import {
  A11Y_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  PAGE_TITLES,
  PROMO_REJECTION_MESSAGES,
  appliedPromoLabel,
  cartButtonLabel,
  cartItemCountLabel,
  lowStockLabel,
  quantityLabel,
  removeLineLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { PROMO_CODES } from "@/data/orders";
import { PRODUCTS } from "@/data/products";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import { createCartLine, createInitialCartState, toCart } from "@/state/cartReducer";
import type { CartLine, PromoCode } from "@/types/commerce";
import { writeStored } from "@/utils/storage";

import {
  headingNamed,
  moneyFigures,
  pageBodyRegion,
  rowAmount,
  summaryFigures,
  summaryPanel,
} from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";

/*
 * The cart route, mounted as the application mounts it — the real providers, the real persisted cart and the
 * real pricing request — and driven only through what the route puts on screen. The cart is put into place
 * through `src/utils/storage.ts`, the product's own durability seam and the only way a cart arrives at a
 * fresh mount, so every line is one `createCartLine` built from the seeded catalogue rather than a literal.
 *
 * Each case arms its failure at the seam rather than at a component: `failNext` is the switch
 * `src/lib/apiClient.ts` honours, and the one-shot arm is spent by the first matching request. A re-price the
 * cart page asks for is issued before the checkout's own pass over the same basket — the page's effect is a
 * child of that provider's, and React commits a child's effects first — so an arm placed just before an edit
 * is the cart page's request that meets it.
 */

beforeEach(resetApiState);

afterEach(() => {
  vi.stubEnv("VITE_API_LATENCY_MS", "0");
  vi.useRealTimers();
  resetApiState();
});

// The basket a case holds --------------------------------------------------------------------------

/** The field a promo failure is filed against, as the pricing service spells it. */
const PROMO_CODE_FIELD = "promoCode";

/** One seeded line, with the product it was built from, so a case states its own figures. */
interface SeededLine {
  readonly line: CartLine;
  readonly name: string;
  readonly unitPriceMinor: number;
}

/**
 * A line of the seeded catalogue: the cheapest product that holds more than the units asked for, so the row's
 * own quantity control still has room to grow, built through `createCartLine` so the line carries the price,
 * the sku and the ceiling the cart clamps every change against.
 *
 * @param quantity - The units the line holds.
 * @returns The line and the product's name and unit price.
 */
function seededLine(quantity: number): SeededLine {
  const product = [...PRODUCTS]
    .filter((candidate) => candidate.priceMinor > 0 && candidate.stockOnHand > quantity)
    .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  if (product === undefined) {
    throw new Error(`No seeded product holds more than ${String(quantity)} units at a price.`);
  }
  const line = createCartLine(product, quantity);
  if (line === null) throw new Error(`No line could be built for "${product.name}".`);
  return { line, name: product.name, unitPriceMinor: product.priceMinor };
}

/** A line holding every unit the product has left, so the row stands at its stock ceiling. */
function cappedLine(): SeededLine {
  const product = [...PRODUCTS]
    .filter((candidate) => candidate.priceMinor > 0 && candidate.stockOnHand > 1)
    .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  if (product === undefined) {
    throw new Error("No seeded product holds more than one unit at a price.");
  }
  const line = createCartLine(product, product.stockOnHand);
  if (line === null) throw new Error(`No line could be built for "${product.name}".`);
  return { line, name: product.name, unitPriceMinor: product.priceMinor };
}

/** One unit of a seeded product as a line, built through the cart's own constructor. */
function oneUnitOf(product: (typeof PRODUCTS)[number]): SeededLine {
  const line = createCartLine(product, 1);
  if (line === null) throw new Error(`No line could be built for "${product.name}".`);
  return { line, name: product.name, unitPriceMinor: product.priceMinor };
}

/** Two lines of the seeded catalogue, each from a different product, so a case can drop one of a pair. */
function seededPair(): readonly [SeededLine, SeededLine] {
  const products = [...PRODUCTS]
    .filter((candidate) => candidate.priceMinor > 0 && candidate.stockOnHand > 1)
    .sort((left, right) => left.priceMinor - right.priceMinor);
  const chosen = products.slice(0, 2);
  const first = chosen[0];
  const second = chosen[1];
  if (first === undefined || second === undefined) {
    throw new Error("The seeded catalogue holds fewer than two buyable products.");
  }
  return [oneUnitOf(first), oneUnitOf(second)];
}

/** Puts the basket into the stored cart the application hydrates from, the way a reload would find it. */
function storedCart(lines: readonly CartLine[], promoCode: string | null = null): void {
  writeStored(STORAGE_KEYS.CART, toCart(createInitialCartState({ lines, promoCode })));
}

/** The control that adds a unit to a line, named by the line's own product as the row names it. */
function addUnitControl(name: string): HTMLElement {
  return screen.getByRole("button", { name: `${quantityLabel(name)}: ${COMMON_ACTIONS.ADD}` });
}

/** A seeded code an order-scoped basket always reaches, so the page has a code it can be made to withdraw. */
function appliedCode(): PromoCode {
  const code = PROMO_CODES.find(
    (promo) =>
      promo.active &&
      promo.appliesTo === "order" &&
      promo.minSubtotalMinor === 0 &&
      promo.usageCount < promo.usageLimit,
  );
  if (code === undefined) throw new Error("No seeded code applies to any basket.");
  return code;
}

// The route's states ------------------------------------------------------------------------------

describe("the cart route", () => {
  it("lists the lines it holds with the figures the pricing service produced", async () => {
    const item = seededLine(2);
    storedCart([item.line]);
    renderApp({ route: ROUTES.CART });

    await headingNamed(CART_COPY.PAGE_HEADING);
    expect(document.title).toContain(PAGE_TITLES.CART);
    expect(screen.getByText(cartItemCountLabel(2))).toBeInTheDocument();

    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    const figures = await summaryFigures(summary);
    expect(figures.subtotal).toBe(item.unitPriceMinor * 2);
    expect(figures.total).toBe(
      figures.subtotal - figures.discount + figures.shipping + figures.tax,
    );
    // No code is held, so nothing is taken off the goods, and the route offers no delivery choice to quote.
    expect(within(summary).queryByText(CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBeNull();
    expect(
      within(summary).getByText(CART_COPY.SUMMARY_SHIPPING_AT_CHECKOUT_LABEL),
    ).toBeInTheDocument();

    // The row states one unit's price and the line's own total, which is the subtotal of a one-line basket.
    const row = screen.getByText(item.name).closest("li");
    if (row === null) throw new Error("The cart listed no row for the seeded line.");
    const rowFigures = moneyFigures(row);
    expect(rowFigures[rowFigures.length - 1]).toBe(figures.subtotal);
    expect(rowFigures).toContain(item.unitPriceMinor);
  });

  it("keeps the rows and the figures it has while a re-price is in flight, and reports the wait", async () => {
    const item = seededLine(1);
    storedCart([item.line]);
    const { user } = renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    const before = await summaryFigures(summary);

    // The edit's own request is answered slowly, so the wait it asks for is the state under test.
    vi.stubEnv("VITE_API_LATENCY_MS", "2000");
    await user.click(addUnitControl(item.name));

    const figuresRegion = summary.querySelector<HTMLElement>("[aria-busy]");
    if (figuresRegion === null) throw new Error("The summary states no busy region.");
    expect(figuresRegion).toHaveAttribute("aria-busy", "true");
    // The price last answered with stays in hand, so no region of the route is emptied by a re-price.
    expect(within(figuresRegion).getByText(CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeInTheDocument();
    expect(screen.getByText(item.name)).toBeInTheDocument();

    await waitFor(() =>
      expect(rowAmount(summary, CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBe(
        before.subtotal + item.unitPriceMinor,
      ),
    );
    expect(figuresRegion).toHaveAttribute("aria-busy", "false");
  });

  it("empties the cart through the clear control, states it, and hands the keyboard to the page body", async () => {
    const item = seededLine(1);
    storedCart([item.line]);
    const { user } = renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));

    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.CLEAR }));

    expect(await screen.findByText(EMPTY_STATES.cart.title)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATES.cart.description)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EMPTY_STATES.cart.actionLabel })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
    expect(await screen.findByText(FEEDBACK_COPY.TOAST_CART_CLEARED)).toBeInTheDocument();
    // There is no basket left to list or to price, and the header's badge reads nothing added.
    expect(screen.queryByText(item.name)).toBeNull();
    expect(screen.queryByRole("region", { name: CART_COPY.SUMMARY_HEADING })).toBeNull();
    expect(screen.getByRole("button", { name: cartButtonLabel(0) })).toBeInTheDocument();
    // The control that held the focus left the document with the lines, so the page's own body takes it.
    await waitFor(() => expect(pageBodyRegion()).toHaveFocus());
  });

  it("reports a refused price with its retry, refuses the way on while it stands, and prices the basket again", async () => {
    const item = seededLine(1);
    storedCart([item.line]);
    const { user } = renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    await summaryFigures(summary);

    const refusal = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    await user.click(addUnitControl(item.name));

    const alert = await within(summary).findByRole("alert");
    expect(alert).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);
    refusal.disarm();

    // The rows are not hidden behind the failure: a cart the shopper can still correct keeps its controls.
    expect(screen.getByText(item.name)).toBeInTheDocument();
    expect(screen.getByLabelText(quantityLabel(item.name))).toBeEnabled();

    // A basket whose price could not be read has no total to check out with, so the way on is refused in place.
    const checkout = screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL });
    expect(checkout).toHaveAttribute("aria-disabled", "true");
    await user.click(checkout);
    expect(
      screen.getByRole("heading", { level: 1, name: CART_COPY.PAGE_HEADING }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING })).toBeNull();

    // The alert's retry restores the figures, and the control the refusal held back with them.
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    await waitFor(() => expect(within(summary).queryByRole("alert")).toBeNull());
    const figures = await summaryFigures(summary);
    expect(figures.subtotal).toBe(item.unitPriceMinor * 2);
    expect(figures.total).toBe(
      figures.subtotal - figures.discount + figures.shipping + figures.tax,
    );
    expect(
      screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL }),
    ).not.toHaveAttribute("aria-disabled");
    // The retry left with the failure it reported, so the keyboard is handed to the region that survives it.
    await waitFor(() => expect(pageBodyRegion()).toHaveFocus());
  });

  it("withdraws the code a refusal names, states the reason, and prices the basket without it", async () => {
    const item = seededLine(1);
    const code = appliedCode();
    storedCart([item.line], code.code);
    const { user } = renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);

    // The panel states the code the cart carries, and the basket is priced with what it took off.
    expect(await screen.findByText(appliedPromoLabel(code.code))).toBeInTheDocument();
    const withCode = await summaryFigures(summary);
    expect(withCode.subtotal + withCode.shipping + withCode.tax - withCode.total).toBeGreaterThan(
      0,
    );

    // The re-price this edit asks for is refused against the code the basket holds, as the seam files it.
    const refusal = failNext({
      code: "below-minimum",
      field: PROMO_CODE_FIELD,
      message: PROMO_REJECTION_MESSAGES["below-minimum"],
      method: "POST",
      path: API_PATHS.CART_PRICE,
    });
    await user.click(addUnitControl(item.name));

    // The reason reaches the shopper on the transient-outcome surface, which outlives the alert it comes with.
    const notifications = await screen.findByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
    expect(
      await within(notifications).findByText(PROMO_REJECTION_MESSAGES["below-minimum"]),
    ).toBeInTheDocument();
    refusal.disarm();

    // Withdrawn rather than left failing, so the panel returns to figures a shopper can read and act on.
    await waitFor(() => expect(screen.queryByText(appliedPromoLabel(code.code))).toBeNull());
    await waitFor(() => expect(within(summary).queryByRole("alert")).toBeNull());
    const withoutCode = await summaryFigures(summary);
    expect(withoutCode.subtotal).toBe(item.unitPriceMinor * 2);
    expect(withoutCode.subtotal + withoutCode.shipping + withoutCode.tax - withoutCode.total).toBe(
      0,
    );
    expect(withoutCode.total).toBe(
      withoutCode.subtotal - withoutCode.discount + withoutCode.shipping + withoutCode.tax,
    );
  });

  it("lets the shopper on to the checkout while the basket has a price", async () => {
    const item = seededLine(1);
    storedCart([item.line]);
    const { user } = renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));

    // The way on is offered without the refusal a failed price puts on it, and following it leaves this route.
    const checkout = screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL });
    expect(checkout).not.toHaveAttribute("aria-disabled");
    await user.click(checkout);
    expect(
      await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING }),
    ).toBeInTheDocument();
  });

  it("says a line is at its stock ceiling and refuses to add past it", async () => {
    const item = cappedLine();
    storedCart([item.line]);
    renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));

    // The row states what is left of the product, and the control that would grow the line is refused at the bound.
    expect(screen.getByText(lowStockLabel(item.line.quantity))).toBeInTheDocument();
    expect(addUnitControl(item.name)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText(quantityLabel(item.name))).toHaveValue(item.line.quantity);
    // A line at its ceiling is still a line the shopper can drop, so the way out is not withdrawn with the bound.
    expect(screen.getByRole("button", { name: removeLineLabel(item.name) })).toBeEnabled();
  });

  it("drops one line through its own control, states the outcome, and leaves the other line usable", async () => {
    const [dropped, kept] = seededPair();
    storedCart([dropped.line, kept.line]);
    const { user } = renderApp({ route: ROUTES.CART });
    await headingNamed(CART_COPY.PAGE_HEADING);
    expect(
      screen.getByText(cartItemCountLabel(dropped.line.quantity + kept.line.quantity)),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: removeLineLabel(dropped.name) }));

    // The line leaves the list, the outcome is stated on the transient-outcome surface, and the other line stays.
    await waitFor(() => expect(screen.queryByText(dropped.name)).toBeNull());
    expect(await screen.findByText(FEEDBACK_COPY.TOAST_REMOVED_FROM_CART)).toBeInTheDocument();
    expect(screen.getByText(kept.name)).toBeInTheDocument();
    expect(screen.getByText(cartItemCountLabel(kept.line.quantity))).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATES.cart.title)).toBeNull();

    const summary = summaryPanel(CART_COPY.SUMMARY_HEADING);
    const figures = await summaryFigures(summary);
    expect(figures.subtotal).toBe(kept.unitPriceMinor * kept.line.quantity);
  });
});
