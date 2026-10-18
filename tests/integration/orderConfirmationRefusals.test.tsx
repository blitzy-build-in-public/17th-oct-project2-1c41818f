/**
 * Path: tests/integration/orderConfirmationRefusals.test.tsx
 * Purpose: The confirmation route's two refusals as a visitor meets them: an identifier no order holds answered as not-found, and an account's own order read without a session answered with the sign-in that resolves it
 * Lines: 49
 */

import { afterEach, describe, expect, it } from "vitest";

import { COMMON_ACTIONS, FEEDBACK_COPY, NOT_FOUND_COPY } from "@/constants/content";
import { ROUTES, orderConfirmationPath } from "@/constants/routes";

import { renderApp, resetApiState, screen } from "../testUtils";

// The confirmation route's two refusals, each needing nothing but a route and the renderer, so they stand
// without the cart, promo and checkout helpers the checkout flow's other subjects are driven through: an
// identifier no order holds reads as not-found, and an account's own order read without a session is answered
// with the sign-in that resolves it.

afterEach(() => {
  resetApiState();
});

describe("an order read refused for want of a session", () => {
  it("offers the sign-in that resolves it instead of a retry that cannot", async () => {
    // The seeded order the demonstration customer owns: read without a session it is refused for want of a
    // session, so the state offers the sign-in that ends in one rather than a retry that cannot.
    const route = orderConfirmationPath("ord_1147");
    renderApp({ route });
    expect(await screen.findByRole("alert")).toHaveTextContent(FEEDBACK_COPY.SIGN_IN_REQUIRED);
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    const signIn = screen.getByRole("link", { name: COMMON_ACTIONS.SIGN_IN });
    expect(signIn).toHaveAttribute("href", `${ROUTES.LOGIN}?returnTo=${encodeURIComponent(route)}`);
  });

  it("answers an identifier no order holds as not-found, never as a sign-in problem", async () => {
    // The existence of the order is decided before the session is judged: a mistyped confirmation address
    // reads as the not-found it is, with the way back to the catalogue rather than a sign-in prompt, and no
    // retry the seam has already spent.
    const route = orderConfirmationPath("ord_999999");
    renderApp({ route });
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_FOUND_COPY.BODY);
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    expect(screen.queryByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toBeNull();
    expect(screen.getByRole("link", { name: NOT_FOUND_COPY.ACTION_LABEL })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
  });
});
