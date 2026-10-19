/**
 * Path: tests/integration/orderConfirmationRefusals.test.tsx
 * Purpose: The confirmation route's refusal as a visitor meets it: an order read without a usable credential — an identifier no order holds included, which is answered exactly as one that holds an order — offers the sign-in that resolves it instead of a retry that cannot
 * Lines: 49
 */

import { afterEach, describe, expect, it } from "vitest";

import { COMMON_ACTIONS, FEEDBACK_COPY } from "@/constants/content";
import { ROUTES, orderConfirmationPath } from "@/constants/routes";

import { renderApp, resetApiState, screen } from "../testUtils";

// The confirmation route's two refusals, each needing nothing but a route and the renderer, so they stand
// without the cart, promo and checkout helpers the checkout flow's other subjects are driven through: an
// identifier no order holds is answered exactly as one that holds an order, so no response can be read to
// learn which order identifiers exist, and an account's own order read without a session is answered with
// the sign-in that resolves it.

afterEach(() => {
  resetApiState();
});

describe("an order read refused for want of a credential", () => {
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

  it("answers an identifier no order holds exactly as one that holds an order", async () => {
    // Deliberately the same refusal (finding `r5-order-detail-existence-oracle`): the credential is judged
    // before existence, so a response cannot be read to learn which order identifiers exist, and a mistyped
    // address meets the sign-in a foreign one does rather than a not-found that told it something.
    const route = orderConfirmationPath("ord_999999");
    renderApp({ route });
    expect(await screen.findByRole("alert")).toHaveTextContent(FEEDBACK_COPY.SIGN_IN_REQUIRED);
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    expect(screen.getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toHaveAttribute(
      "href",
      `${ROUTES.LOGIN}?returnTo=${encodeURIComponent(route)}`,
    );
  });
});
