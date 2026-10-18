/**
 * Path: tests/integration/checkoutPricingFailure.test.tsx
 * Purpose: The checkout's refused price request: the seam's failure reported with a retry, the basket priced
 * again, and the steps beyond it still reached.
 * Lines: 64
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { COMMON_ACTIONS } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";

import {
  addItemToCart,
  advanceTo,
  chooseShippingMethod,
  fillShippingAddress,
} from "../helpers/checkoutHarness";
import { summaryFigures, summaryPanel } from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, within } from "../testUtils";

/*
 * The failure path this file drives: the seam's failure is announced with a retry, the retry prices the basket
 * again, and the steps past payment are still reached. Every reader the walk needs comes from the shared
 * harness, so the two checkout suites declare no reader twice and neither imports the other.
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
