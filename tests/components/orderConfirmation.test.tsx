/**
 * Path: tests/components/orderConfirmation.test.tsx
 * Purpose: The confirmation's own branches, driven through the real application and the real seeded order history: the order it restates with its amounts, its codes and its window, the payment an order settled without a card names, the retried read, the refusal a visitor without a session is given, and the states an identifier naming no order reaches
 * Lines: 279
 */

import { beforeEach, describe, expect, it } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  NOT_FOUND_COPY,
  appliedPromoLabel,
} from "@/constants/content";
import { ROUTES, accountOrderPath, loginPath, orderConfirmationPath } from "@/constants/routes";
import { CUSTOMERS } from "@/data/customers";
import { ORDERS } from "@/data/orders";
import { FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import type { Customer } from "@/types/account";
import type { Order } from "@/types/commerce";
import { formatDate } from "@/utils/dates";
import { capitalise } from "@/utils/strings";

import { fieldLabel, rowAmount } from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { RenderHarness, UserEvent } from "../testUtils";

/*
 * The real application throughout, reading the real seeded history: the confirmation is a route that asks the
 * order store for one order and renders what the order keeps, so every case here renders a route and reads what
 * the page shows. An order that names an account is read with a session the sign-in form opened — the seeded
 * customer's own, or the administrator's, which the seam answers for any account's order — and a failure is
 * reached by arming the seam's own switch. No order is placed here: the checkout's own suites prove the
 * hand-over, and this file proves what the page renders once it has an order.
 */

// The seeded orders a case reads ------------------------------------------------------------------

/** One seeded order the history holds, by a fact a case needs, or a thrown seed mistake rather than a case
 *  that checks less. */
function seededOrder(holds: (order: Order) => boolean, description: string): Order {
  const found = ORDERS.find(holds);
  if (found === undefined) throw new Error(`The seeded history holds no order ${description}.`);
  return found;
}

/** The seeded customer whose session a case opens, and whose own order the history holds. */
const SHOPPER = ((): Customer => {
  const found = CUSTOMERS.find((customer) => customer.email === DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  if (found === undefined) throw new Error("The seeded accounts hold no demonstration customer.");
  return found;
})();

/** An order paid for by card and reduced by no code, which states the card, the discount row's absence and
 *  every amount without a reduction. */
const CARD_ORDER = seededOrder(
  (order) => order.payment.last4 !== null && order.pricedCart.appliedPromos.length === 0,
  "paid for by card and reduced by no code",
);

/** An order a code reduced, which states the reduction and names the code beneath it. */
const DISCOUNTED_ORDER = seededOrder(
  (order) => order.pricedCart.discountTotalMinor > 0 && order.pricedCart.appliedPromos.length > 0,
  "reduced by an applied code",
);

/** An order settled without a card, which the page states in the method's own words. */
const INVOICED_ORDER = seededOrder(
  (order) => order.payment.last4 === null,
  "settled without a card",
);

/** The seeded customer's own order, which their session both reads and owns. */
const OWN_ORDER = seededOrder(
  (order) => order.customerId === SHOPPER.id,
  "owned by the seeded customer",
);

/** An identifier no order holds, which a signed-in visitor's read is answered with as a not-found. */
const UNKNOWN_ORDER_ID = "ord_999999";

// Driving the real screens -----------------------------------------------------------------------

/** Opens the application at `route` holding a session the real sign-in form opened for `email`. */
async function openSignedIn(route: string, email: string): Promise<RenderHarness> {
  const signInPage = renderApp({ route: ROUTES.LOGIN });
  const user: UserEvent = signInPage.user;
  // The form is waited for before it is filled, so its disappearance below is the sign-in's own doing.
  await screen.findByRole("heading", { name: ACCOUNT_COPY.SIGN_IN_HEADING });
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), email);
  await user.type(
    screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)),
    DEMO_ACCOUNTS.PASSWORD,
  );
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: ACCOUNT_COPY.SIGN_IN_HEADING })).toBeNull(),
  );
  signInPage.unmount();
  return renderApp({ route });
}

/** The confirmation's own amounts register, found by the heading it states above them. */
function totalsScope(): HTMLElement {
  const heading = screen.getByRole("heading", {
    level: 3,
    name: CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING,
  });
  const scope = heading.parentElement;
  if (scope === null) throw new Error("The confirmation's totals heading stands in no register.");
  return scope;
}

/** One card of the confirmation, found by the heading it states. */
function sectionNamed(heading: string): HTMLElement {
  const node = screen.getByRole("heading", { name: heading }).closest("section");
  if (node === null) throw new Error(`The confirmation rendered no section under "${heading}".`);
  return node;
}

beforeEach(resetApiState);

describe("the order a confirmation restates", () => {
  it("states a seeded order's number, its date, its window, its lines, its address and its amounts", async () => {
    await openSignedIn(orderConfirmationPath(CARD_ORDER.id), DEMO_ACCOUNTS.ADMIN_EMAIL);

    // The opening block names the order, the day it was placed and the window its own method puts it in.
    expect(await screen.findByText(CARD_ORDER.orderNumber)).toBeVisible();
    expect(screen.getByText(formatDate(CARD_ORDER.placedAt))).toBeVisible();
    expect(
      screen.getByText(new RegExp(`^${CHECKOUT_COPY.CONFIRMATION_ESTIMATE_LABEL}`)),
    ).toBeVisible();

    // Every line is restated as it was priced, and the address reads in postal order.
    for (const line of CARD_ORDER.pricedCart.lines)
      expect(screen.getByText(line.name)).toBeVisible();
    expect(screen.getByText(CARD_ORDER.shippingAddress.line1)).toBeVisible();
    const locality = `${CARD_ORDER.shippingAddress.city}, ${CARD_ORDER.shippingAddress.region} ${CARD_ORDER.shippingAddress.postalCode}`;
    expect(screen.getByText(locality)).toBeVisible();

    // The amounts reconcile with no reduction, because this order was reduced by no code.
    const totals = totalsScope();
    const subtotal = rowAmount(totals, CART_COPY.SUMMARY_SUBTOTAL_LABEL);
    const shipping = rowAmount(totals, CART_COPY.SUMMARY_SHIPPING_LABEL);
    const tax = rowAmount(totals, CART_COPY.SUMMARY_TAX_LABEL);
    const total = rowAmount(totals, CART_COPY.SUMMARY_TOTAL_LABEL);
    expect(subtotal).toBeGreaterThan(0);
    expect(subtotal + shipping + tax).toBe(total);
    expect(within(totals).queryByText(CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBeNull();

    // The payment card states the tail the order kept and never a number that could be charged.
    const last4 = CARD_ORDER.payment.last4;
    if (last4 === null) throw new Error("The seeded order kept no card tail.");
    const payment = sectionNamed(CHECKOUT_COPY.CONFIRMATION_PAYMENT_HEADING);
    expect(within(payment).getByText(new RegExp(last4))).toBeVisible();

    // The account that owns nothing here is offered the storefront and the home page, not a history that
    // does not hold this order.
    expect(
      screen.getByRole("link", { name: CHECKOUT_COPY.CONFIRMATION_CONTINUE_SHOPPING_LABEL }),
    ).toHaveAttribute("href", ROUTES.CATALOG);
    expect(
      screen.getByRole("link", { name: CHECKOUT_COPY.CONFIRMATION_HOME_LABEL }),
    ).toHaveAttribute("href", ROUTES.HOME);
    expect(
      screen.queryByRole("link", { name: CHECKOUT_COPY.CONFIRMATION_ORDER_HISTORY_LABEL }),
    ).toBeNull();
  });

  it("names the code that reduced a seeded order, and states the reduction it took", async () => {
    await openSignedIn(orderConfirmationPath(DISCOUNTED_ORDER.id), DEMO_ACCOUNTS.ADMIN_EMAIL);
    await screen.findByText(DISCOUNTED_ORDER.orderNumber);

    // The reduction has a row of its own, carries its sign as markup, and reconciles with the total.
    const totals = totalsScope();
    const subtotal = rowAmount(totals, CART_COPY.SUMMARY_SUBTOTAL_LABEL);
    const discount = rowAmount(totals, CART_COPY.SUMMARY_DISCOUNT_LABEL);
    const shipping = rowAmount(totals, CART_COPY.SUMMARY_SHIPPING_LABEL);
    const tax = rowAmount(totals, CART_COPY.SUMMARY_TAX_LABEL);
    const total = rowAmount(totals, CART_COPY.SUMMARY_TOTAL_LABEL);
    expect(discount).toBeGreaterThan(0);
    expect(subtotal - discount + shipping + tax).toBe(total);

    // Each applied code is named beneath the amounts, which is what says which code earned the reduction.
    const promo = DISCOUNTED_ORDER.pricedCart.appliedPromos[0];
    if (promo === undefined) throw new Error("The seeded order kept no applied code.");
    expect(within(totals).getByText(appliedPromoLabel(promo.code))).toBeVisible();
  });

  it("states an order settled without a card in the method's own words", async () => {
    await openSignedIn(orderConfirmationPath(INVOICED_ORDER.id), DEMO_ACCOUNTS.ADMIN_EMAIL);
    await screen.findByText(INVOICED_ORDER.orderNumber);

    const payment = sectionNamed(CHECKOUT_COPY.CONFIRMATION_PAYMENT_HEADING);
    expect(within(payment).getByText(capitalise(INVOICED_ORDER.payment.method))).toBeVisible();
  });

  it("offers the order's own history to the account that owns it, and reads a failed read again on its retry", async () => {
    // The failure is armed before the read is made, so the one request the route issues meets it.
    const failure = failNext({ path: /\/api\/orders\// });
    const { user } = await openSignedIn(
      orderConfirmationPath(OWN_ORDER.id),
      DEMO_ACCOUNTS.CUSTOMER_EMAIL,
    );

    // A read that could have answered differently is offered the retry that resolves it, with the hint that
    // advises a second attempt beside it and no sign-in, because a session was not what was missing.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);
    expect(screen.getByText(FEEDBACK_COPY.ERROR_STATE_HINT)).toBeVisible();
    expect(screen.queryByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toBeNull();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    // The order arrives, and the session that owns it is offered that account's history beside the links.
    expect(await screen.findByText(OWN_ORDER.orderNumber)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("link", { name: CHECKOUT_COPY.CONFIRMATION_ORDER_HISTORY_LABEL }),
    ).toHaveAttribute("href", accountOrderPath(OWN_ORDER.id));
    failure.disarm();
  });
});

describe("an order a confirmation cannot show", () => {
  it("asks a visitor with no session to sign in, rather than offering a retry that cannot resolve it", async () => {
    const route = orderConfirmationPath(OWN_ORDER.id);
    renderApp({ route });

    // An account's order read without a session is refused for want of one, so the offer is the sign-in that
    // ends in a session, carrying this path back rather than a retry that could not answer differently.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.SIGN_IN_REQUIRED);
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    expect(screen.queryByText(FEEDBACK_COPY.ERROR_STATE_HINT)).toBeNull();
    expect(screen.getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toHaveAttribute(
      "href",
      loginPath(route),
    );
    expect(screen.getByRole("link", { name: NOT_FOUND_COPY.ACTION_LABEL })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
  });

  it("offers the catalogue, and no retry, for an identifier no order holds", async () => {
    await openSignedIn(orderConfirmationPath(UNKNOWN_ORDER_ID), DEMO_ACCOUNTS.CUSTOMER_EMAIL);

    // An order the store does not hold is an answer, not a failure to retry: repeating the request would
    // spend it on the same answer, so the one offer is the way back to the catalogue.
    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    expect(screen.queryByText(FEEDBACK_COPY.ERROR_STATE_HINT)).toBeNull();
    expect(screen.queryByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toBeNull();
    expect(screen.getByRole("link", { name: NOT_FOUND_COPY.ACTION_LABEL })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
  });

  it("shows the product's own not-found wording for an address that names no order at all", async () => {
    // A blank segment trims to no identifier, which is the address a hand-edited link reaches: no order is
    // asked for, and the page states the wording the product keeps for an address that matches nothing.
    renderApp({ route: orderConfirmationPath(" ") });

    expect(await screen.findByText(NOT_FOUND_COPY.TITLE)).toBeVisible();
    expect(screen.getByText(NOT_FOUND_COPY.BODY)).toBeVisible();
    expect(screen.getByRole("link", { name: NOT_FOUND_COPY.ACTION_LABEL })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
