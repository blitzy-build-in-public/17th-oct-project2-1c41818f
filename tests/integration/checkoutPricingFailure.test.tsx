/**
 * Path: tests/integration/checkoutPricingFailure.test.tsx
 * Purpose: The checkout's refused price request — the seam's failure reported with a retry, the basket priced
 * again and the steps beyond it still reached — and a code the seam refuses mid-flow, withdrawn with its
 * reason stated.
 * Lines: 132
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_CARD_NUMBERS, STORAGE_KEYS } from "@/constants/config";
import { COMMON_ACTIONS, PROMO_REJECTION_MESSAGES, appliedPromoLabel } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { PROMO_CODES } from "@/data/orders";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import { isCartState, toCart } from "@/state/cartReducer";
import { toIsoDate } from "@/utils/dates";
import { readStored, writeStored } from "@/utils/storage";

import {
  addItemToCart,
  advanceTo,
  chooseShippingMethod,
  field,
  fillShippingAddress,
} from "../helpers/checkoutHarness";
import { findSummaryPanel, summaryFigures, summaryPanel } from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, within } from "../testUtils";

/*
 * The failure paths this file drives: the seam's failure is announced with a retry, the retry prices the basket
 * again and the steps past payment are still reached; and a code the seam refuses is withdrawn with its reason
 * stated, which is what leaves the flow placeable. Every reader the walk needs comes from the shared harness,
 * so the two checkout suites declare no reader twice and neither imports the other; the refusal case reaches
 * the persisted cart through `src/utils/storage.ts`, because a code whose window has closed is one this file
 * has to put into a stored cart itself.
 */

beforeEach(resetApiState);

afterEach(() => {
  vi.useRealTimers();
  resetApiState();
});

describe("a refused price request", () => {
  it("reports the seam's failure with a retry, then prices the basket again", async () => {
    // The failure is armed with nothing else in flight, so the checkout's own price request meets it.
    const cart = renderApp({ route: ROUTES.CATALOG });
    await addItemToCart(cart.user);
    cart.unmount();
    const armed = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    const { user } = renderApp({ route: ROUTES.CHECKOUT });

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);
    await user.click(within(failure).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    const figures = await summaryFigures(summaryPanel());
    expect(figures.total).toBe(
      figures.subtotal - figures.discount + figures.shipping + figures.tax,
    );
    armed.disarm();

    await fillShippingAddress(user);
    await chooseShippingMethod(user);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );
  });
});

describe("a code the seam refuses mid-flow", () => {
  it("withdraws it, states the reason and leaves the flow placeable", async () => {
    // A basket left open across a code's end date: the persisted cart is what carries the closed code in,
    // so the case sets one cart up, then writes the code into it the way a reload would have found it.
    const cart = renderApp({ route: ROUTES.CATALOG });
    await addItemToCart(cart.user);
    cart.unmount();
    const closed = PROMO_CODES.find(
      (promo) => promo.active && promo.endsAt < toIsoDate(new Date()),
    );
    if (closed === undefined) throw new Error("No seeded code's window has closed.");
    const stored = readStored(STORAGE_KEYS.CART, null, isCartState);
    if (stored === null) throw new Error("The cart the walk filled was not persisted.");
    writeStored(STORAGE_KEYS.CART, toCart({ ...stored, promoCode: closed.code }));

    const { user } = renderApp({ route: ROUTES.CHECKOUT });

    // The reason reaches the shopper on the transient-outcome surface, which outlives the alert a refused
    // price request leaves behind.
    expect(await screen.findByText(PROMO_REJECTION_MESSAGES.expired)).toBeInTheDocument();

    // The code was withdrawn rather than left failing, and the basket was priced again without it: no
    // applied-code row stands and the figures are the code-less ones. The region the figures are read from
    // is the route's own, so the read waits for it there rather than racing the placeholder it loads behind.
    const figures = await summaryFigures(await findSummaryPanel());
    expect(screen.queryByText(appliedPromoLabel(closed.code))).toBeNull();
    expect(figures.discount).toBe(0);
    expect(figures.total).toBe(
      figures.subtotal - figures.discount + figures.shipping + figures.tax,
    );

    // With the code gone the flow is placeable: the review step offers the submit the refusal had closed.
    const card = [
      [CHECKOUT_COPY.NAME_ON_CARD_LABEL, "Ada Lovelace"],
      [CHECKOUT_COPY.CARD_NUMBER_LABEL, DEMO_CARD_NUMBERS.APPROVED],
      [CHECKOUT_COPY.CARD_EXPIRY_MONTH_LABEL, String(new Date().getMonth() + 1)],
      [CHECKOUT_COPY.CARD_EXPIRY_YEAR_LABEL, String(new Date().getFullYear() + 1)],
      [CHECKOUT_COPY.CARD_SECURITY_CODE_LABEL, "123"],
    ] as const;
    await fillShippingAddress(user);
    await chooseShippingMethod(user);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );
    for (const [label, value] of card) await user.type(field(label), value);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );

    const placeOrder = screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL });
    expect(placeOrder).toBeEnabled();
  });
});
