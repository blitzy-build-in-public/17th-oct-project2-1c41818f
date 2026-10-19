/**
 * Path: tests/integration/checkoutFlow.test.tsx
 * Purpose: Cart to order through the three steps, the idempotent submission and the cleared cart
 * Lines: 521
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_COPY,
  CHECKOUT_STEP_TITLES,
  demoPaymentNote,
  editSectionLabel,
  paymentDeclinedNote,
  stepProgressLabel,
} from "@/constants/checkoutCopy";
import {
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  FREE_SHIPPING_THRESHOLD_MINOR,
} from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  PROMO_REJECTION_MESSAGES,
  VALIDATION_MESSAGES,
  cartButtonLabel,
  cartItemCountLabel,
  freeShippingProgressLabel,
  lowStockLabel,
  quantityLabel,
  removeLineLabel,
  removePromoLabel,
} from "@/constants/content";
import { ROUTES, accountOrderPath, orderConfirmationPath } from "@/constants/routes";
import { PROMO_KIND_LABELS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { PROMO_CODES } from "@/data/orders";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import { CHECKOUT_FORM_STEPS } from "@/state/checkoutReducer";
import type { MinorUnits } from "@/types/common";
import type { PromoCode } from "@/types/commerce";
import { formatMoney } from "@/utils/format";

import {
  CHOSEN_METHOD,
  CONTACT_EMAIL,
  DELIVERY_NAME,
  addItemToCart,
  advanceTo,
  chooseShippingMethod,
  field,
  fillShippingAddress,
} from "../helpers/checkoutHarness";
import type { CartWalk } from "../helpers/checkoutHarness";
import { moneyFigures, rowAmount, summaryFigures, summaryPanel } from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/* The real application throughout, nothing stubbed but the transport's failure switch: every figure is read
   back off the screen as integer minor units, and no money is typed. */

/** The holder, and a code the card rule accepts; this month with the next year is a pair it accepts. */
const CARD_HOLDER = "Ada Lovelace";
const CARD_CVC = "123";
const CURRENT_MONTH = String(new Date().getMonth() + 1);
const NEXT_YEAR = String(new Date().getFullYear() + 1);

/** The approved number with its check digit moved on by one, which breaks its Luhn checksum. */
const LUHN_FAILING_NUMBER = `${DEMO_CARD_NUMBERS.APPROVED.slice(0, -1)}${String(
  (Number(DEMO_CARD_NUMBERS.APPROVED.slice(-1)) + 1) % 10,
)}`;

/** A spelling no seeded code carries, in the shape the promo field accepts. */
const UNKNOWN_PROMO_CODE = `${PROMO_CODES[0].code}9`;

/** What the seam answers a declined demonstration card with, worded by the copy module that owns it. */
const DECLINED_MESSAGE = paymentDeclinedNote(DEMO_CARD_NUMBERS.APPROVED);

/** What the payment step states about the demonstration, which a refusal must not be mistaken for. */
const DEMO_NOTICE = demoPaymentNote(DEMO_CARD_NUMBERS.APPROVED, DEMO_CARD_NUMBERS.DECLINED);

/** The seeded code a basket of `subtotalMinor` buys with, or the one whose floor it falls short of. */
function seededPromo(subtotalMinor: MinorUnits, want: "applies" | "below-minimum"): PromoCode {
  const usable = PROMO_CODES.filter(
    (code) =>
      code.active &&
      code.appliesTo === "order" &&
      (want === "applies"
        ? code.minSubtotalMinor <= subtotalMinor
        : code.kind !== "free_shipping" && code.minSubtotalMinor > subtotalMinor),
  ).sort((left, right) => left.minSubtotalMinor - right.minSubtotalMinor);
  const promo = usable[0];
  if (promo === undefined) throw new Error(`No seeded code is ${want} for this basket.`);
  return promo;
}

// Walking the storefront -------------------------------------------------------------------------

/** A cart holding the units asked for of one product, optionally with the checkout open on its first step. */
async function cartWithItems(walk: CartWalk = {}, atCheckout = false) {
  const harness = renderApp({ route: ROUTES.CATALOG });
  const name = await addItemToCart(harness.user, walk);
  await harness.user.click(
    screen.getByRole("button", { name: cartButtonLabel(walk.quantity ?? 1) }),
  );
  await harness.user.click(
    await screen.findByRole("link", { name: CART_COPY.MINI_CART_VIEW_CART_LABEL }),
  );
  await screen.findByRole("heading", { name: CART_COPY.PAGE_HEADING });
  expect(await screen.findByText(cartItemCountLabel(walk.quantity ?? 1))).toBeInTheDocument();
  if (atCheckout) {
    await harness.user.click(
      screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
    expect(
      await within(summaryPanel()).findByText(cartItemCountLabel(walk.quantity ?? 1)),
    ).toBeInTheDocument();
  }
  return { ...harness, name };
}

// Filling the checkout's steps -------------------------------------------------------------------

/** Signs the seeded shopper in, leaving the session persisted for the render that follows. */
async function signInAsShopper(user: UserEvent): Promise<void> {
  await user.type(
    await screen.findByLabelText(new RegExp(ACCOUNT_COPY.EMAIL_LABEL)),
    DEMO_ACCOUNTS.CUSTOMER_EMAIL,
  );
  await user.type(field(ACCOUNT_COPY.PASSWORD_LABEL), DEMO_ACCOUNTS.PASSWORD);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
}

/** Waits for the shopper's contact and saved address to reach the shipping step as its own reads settle. */
async function awaitSavedShipping(): Promise<void> {
  await waitFor(() => expect(field(ACCOUNT_COPY.EMAIL_LABEL)).toHaveValue(CONTACT_EMAIL));
  const picker = (): HTMLElement =>
    screen.getByRole("group", { name: CHECKOUT_COPY.SAVED_ADDRESS_LABEL });
  await waitFor(() => expect(picker()).toBeInTheDocument());
  await waitFor(() => expect(field(CHECKOUT_COPY.FULL_NAME_LABEL)).not.toHaveValue(""));
}

/** The card members the payment rule judges, as the payment values hold them. */
type CardFill = Readonly<Record<"number" | "expiryMonth" | "expiryYear" | "cvc", string>>;

/** The card this file pays with, and the three faulted cards that each break one member's rule. */
const CARD: CardFill = {
  number: DEMO_CARD_NUMBERS.APPROVED,
  expiryMonth: CURRENT_MONTH,
  expiryYear: NEXT_YEAR,
  cvc: CARD_CVC,
};

/** The labels the payment step's five card controls carry, in the order the step declares them: the holder,
 *  the number, the expiry's two halves and the security code. */
const CARD_CONTROL_LABELS = [
  CHECKOUT_COPY.NAME_ON_CARD_LABEL,
  CHECKOUT_COPY.CARD_NUMBER_LABEL,
  CHECKOUT_COPY.CARD_EXPIRY_MONTH_LABEL,
  CHECKOUT_COPY.CARD_EXPIRY_YEAR_LABEL,
  CHECKOUT_COPY.CARD_SECURITY_CODE_LABEL,
] as const;

/** Writes every judged member of the card, in the order the payment step declares its five controls: holder,
 *  number, the expiry's two halves and the security code. Each control is reached by its own label rather
 *  than by its role, because the number and the security code are masked controls and a masked control
 *  carries no textbox role for a query to find. */
async function fillCard(user: UserEvent, fill: CardFill): Promise<void> {
  const values = [CARD_HOLDER, fill.number, fill.expiryMonth, fill.expiryYear, fill.cvc];
  const controls = CARD_CONTROL_LABELS.map((label) => field(label));
  expect(controls).toHaveLength(values.length);
  for (const [index, control] of controls.entries()) {
    await user.clear(control);
    await user.type(control, values[index]);
  }
}

/** Walks the three steps from a filled shipping step to the review, paying with the card given. */
async function reachReview(user: UserEvent, card: CardFill = CARD): Promise<void> {
  await chooseShippingMethod(user);
  await advanceTo(
    user,
    CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
    CHECKOUT_COPY.PAYMENT_STEP_HEADING,
  );
  await fillCard(user, card);
  await advanceTo(user, CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL, CHECKOUT_COPY.REVIEW_STEP_HEADING);
}

beforeEach(resetApiState);

afterEach(() => {
  vi.useRealTimers();
  resetApiState();
});

describe("the cart", () => {
  it("prices what it holds, keeps a line at its stock ceiling and empties into the empty state", async () => {
    const { name, unmount } = await cartWithItems({ quantity: 3 });
    const summary = await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));
    const row = screen.getByText(name).closest("li") as HTMLElement;
    const figures = moneyFigures(row);
    // The row's money reads in the order its grid places it: one unit's price, then the line's total.
    expect(figures[0] * 3).toBe(summary.subtotal);
    expect(figures[figures.length - 1]).toBe(summary.subtotal);
    expect(summary.subtotal - summary.discount + summary.shipping + summary.tax).toBe(
      summary.total,
    );

    const progress = screen.getByRole("progressbar");
    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD_MINOR - summary.subtotal);
    const band =
      remaining === 0
        ? CART_COPY.FREE_DELIVERY_EARNED_LABEL
        : freeShippingProgressLabel(formatMoney(remaining));
    expect(progress).toHaveAccessibleName(band);
    expect(Number(progress.getAttribute("aria-valuenow"))).toBeCloseTo(
      (FREE_SHIPPING_THRESHOLD_MINOR - remaining) / FREE_SHIPPING_THRESHOLD_MINOR,
      5,
    );

    // The cart is durable: the line a reload reads back is the line that was added.
    unmount();
    const reloaded = renderApp({ route: ROUTES.CART });
    const field = await screen.findByLabelText<HTMLInputElement>(quantityLabel(name));
    await reloaded.user.clear(field);
    await reloaded.user.type(field, field.max);
    expect(
      screen.getByRole("button", { name: `${quantityLabel(name)}: ${COMMON_ACTIONS.ADD}` }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(lowStockLabel(Number(field.max)))).toBeInTheDocument();

    await reloaded.user.click(screen.getByRole("button", { name: removeLineLabel(name) }));
    expect(await screen.findByText(EMPTY_STATES.cart.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EMPTY_STATES.cart.actionLabel })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
  });
});

describe("promo codes", () => {
  it("refuses the codes the basket cannot use, then discounts it with one it can", async () => {
    const { user } = await cartWithItems({ cheapest: true });
    const before = await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));
    const promoField = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);
    const refusals = [
      { code: UNKNOWN_PROMO_CODE, message: PROMO_REJECTION_MESSAGES.unknown },
      {
        code: seededPromo(before.subtotal, "below-minimum").code,
        message: PROMO_REJECTION_MESSAGES["below-minimum"],
      },
    ];

    for (const refusal of refusals) {
      await user.clear(promoField);
      expect(promoField).toHaveAttribute("aria-invalid", "false");
      await user.type(promoField, refusal.code);
      await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));
      expect(await screen.findByText(refusal.message)).toBeInTheDocument();
      expect(promoField).toHaveAttribute("aria-invalid", "true");
      const describedBy = promoField.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(describedBy)?.textContent).toBe(refusal.message);
    }

    // Neither attempt took anything off, so the basket still states the identity with no discount.
    const unchanged = await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));
    expect(unchanged.discount).toBe(0);
    expect(unchanged.total).toBe(before.total);

    const promo = seededPromo(before.subtotal, "applies");
    await user.clear(promoField);
    await user.type(promoField, promo.code);
    await user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));
    const label = `${promo.code} · ${PROMO_KIND_LABELS[promo.kind]}`;
    await waitFor(() =>
      expect(rowAmount(summaryPanel(CART_COPY.SUMMARY_HEADING), label)).toBeGreaterThan(0),
    );
    const after = await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING), label);
    expect(after.discount).toBeGreaterThan(0);
    expect(after.total).toBeLessThan(before.total);
    expect(after.total).toBe(after.subtotal - after.discount + after.shipping + after.tax);

    await user.click(await screen.findByRole("button", { name: removePromoLabel(promo.code) }));
    const restored = await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));
    expect(restored.total).toBe(before.total);
  });
});

describe("the mini-cart", () => {
  it("opens from the header badge, edits a quantity, gives the focus back and takes the order to its confirmation", async () => {
    const harness = renderApp({ route: ROUTES.CATALOG });
    const name = await addItemToCart(harness.user);
    const badge = screen.getByRole("button", { name: cartButtonLabel(1) });
    await harness.user.click(badge);

    const drawer = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
    expect(within(drawer).getByText(name)).toBeInTheDocument();
    await harness.user.click(
      within(drawer).getByRole("button", { name: `${quantityLabel(name)}: ${COMMON_ACTIONS.ADD}` }),
    );
    expect(await screen.findByRole("button", { name: cartButtonLabel(2) })).toBeInTheDocument();

    await harness.user.keyboard("{Escape}");
    await waitFor(() => expect(drawer).not.toBeInTheDocument());
    expect(badge).toHaveFocus();

    await harness.user.click(screen.getByRole("button", { name: cartButtonLabel(2) }));
    await harness.user.click(
      await screen.findByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });

    // The mini-cart entry is a way into the whole order, so the walk carries on to the confirmation and the
    // cleared cart rather than stopping where the checkout begins.
    await fillShippingAddress(harness.user);
    await reachReview(harness.user);
    await harness.user.click(screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL }));
    await screen.findByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU);
    expect(screen.queryByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL })).toBeNull();

    await harness.user.click(screen.getByRole("button", { name: cartButtonLabel(0) }));
    const cleared = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
    expect(within(cleared).getByText(EMPTY_STATES.cart.title)).toBeInTheDocument();
  });
});

describe("the checkout steps", () => {
  it("marks the step in force, refuses an incomplete address, then advances and re-prices the method", async () => {
    const { user } = await cartWithItems({}, true);
    expect(screen.getByRole("listitem", { current: true })).toHaveTextContent(
      CHECKOUT_STEP_TITLES[0],
    );
    expect(screen.getByText(CHECKOUT_STEP_TITLES[1])).toBeInTheDocument();
    expect(screen.getByText(CHECKOUT_STEP_TITLES[2])).toBeInTheDocument();
    expect(document.title).toContain(stepProgressLabel(1, CHECKOUT_FORM_STEPS.length));

    await user.click(screen.getByRole("button", { name: CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL }));
    const summary = screen.getByRole("alert", { name: CHECKOUT_COPY.ERROR_SUMMARY_HEADING });
    const entries = within(summary).getAllByRole<HTMLAnchorElement>("link");
    expect(screen.getAllByText(VALIDATION_MESSAGES.REQUIRED).length).toBeGreaterThan(0);
    expect(summary).toHaveTextContent(CHECKOUT_COPY.FULL_NAME_LABEL);
    for (const { hash } of entries) expect(document.getElementById(hash.slice(1))).not.toBeNull();
    expect(summary.parentElement).toHaveFocus();
    // A second press of the same control refuses again, and the summary takes the keyboard back.
    await user.click(screen.getByRole("button", { name: CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL }));
    expect(summary.parentElement).toHaveFocus();
    expect(screen.queryByText(CHECKOUT_COPY.PAYMENT_STEP_HEADING)).not.toBeInTheDocument();

    await fillShippingAddress(user);
    const before = await summaryFigures(summaryPanel());
    expect(before.shipping).toBe(0);
    await chooseShippingMethod(user);
    await waitFor(() =>
      expect(rowAmount(summaryPanel(), CART_COPY.SUMMARY_SHIPPING_LABEL)).toBe(
        CHOSEN_METHOD.priceMinor,
      ),
    );
    const after = await summaryFigures(summaryPanel());
    expect(after.total).toBe(before.total + CHOSEN_METHOD.priceMinor);
    expect(after.total).toBe(after.subtotal - after.discount + after.shipping + after.tax);

    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );

    // An earlier step keeps every value it collected, so returning to it retypes nothing.
    await user.click(screen.getByRole("button", { name: CHECKOUT_STEP_TITLES[0] }));
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
    expect(field(CHECKOUT_COPY.FULL_NAME_LABEL)).toHaveValue(DELIVERY_NAME);
  });

  it("fills the form from a signed-in shopper's saved address and refuses an invalid card", async () => {
    const signIn = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(signIn.user);
    signIn.unmount();

    const { user } = await cartWithItems({}, true);
    await awaitSavedShipping();
    await chooseShippingMethod(user);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );

    const refusals = [
      { card: { ...CARD, number: LUHN_FAILING_NUMBER }, message: VALIDATION_MESSAGES.CARD_NUMBER },
      {
        card: { ...CARD, cvc: CARD_CVC.slice(1) },
        message: VALIDATION_MESSAGES.CARD_SECURITY_CODE,
      },
    ];
    for (const refusal of refusals) {
      await fillCard(user, refusal.card);
      await user.click(
        screen.getByRole("button", { name: CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL }),
      );
      expect((await screen.findAllByText(refusal.message)).length).toBeGreaterThan(0);
      expect(screen.queryByText(CHECKOUT_COPY.REVIEW_STEP_HEADING)).not.toBeInTheDocument();
    }

    await fillCard(user, CARD);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );
  });
});

describe("placing the order", () => {
  it("restates it, places one, keeps the confirmation across a reload and leaves the cart empty", async () => {
    const signIn = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(signIn.user);
    signIn.unmount();

    const { user, name, unmount } = await cartWithItems({}, true);
    await awaitSavedShipping();
    await reachReview(user, { ...CARD, number: DEMO_CARD_NUMBERS.DECLINED });

    // The review body replaces its placeholder once the basket is priced, which is what this waits on.
    expect(await screen.findByText(name)).toBeInTheDocument();
    const sections = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(sections).toContain(CHECKOUT_COPY.REVIEW_ITEMS_HEADING);
    expect(sections).toContain(CHECKOUT_COPY.REVIEW_SHIPPING_HEADING);
    expect(sections).toContain(CHECKOUT_COPY.REVIEW_DELIVERY_METHOD_HEADING);
    expect(sections).toContain(CHECKOUT_COPY.REVIEW_PAYMENT_HEADING);

    // The review restates the card as typed, behind the mask only its last four digits survive.
    expect(screen.getByText(new RegExp(DEMO_CARD_NUMBERS.DECLINED.slice(-4)))).toBeInTheDocument();

    // The declined card places nothing and states the decline itself: once, and not the demo note.
    await user.click(screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL }));
    expect(await screen.findByText(DECLINED_MESSAGE)).toBeInTheDocument();
    expect(screen.getAllByText(DECLINED_MESSAGE)).toHaveLength(1);
    expect(screen.queryByText(DEMO_NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU)).not.toBeInTheDocument();

    // The edit control beside a section returns to the step that wrote it, keeping what it holds.
    await user.click(
      screen.getByRole("button", { name: editSectionLabel(CHECKOUT_COPY.REVIEW_PAYMENT_HEADING) }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.PAYMENT_STEP_HEADING });
    await fillCard(user, CARD);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );
    // The corrected card makes the refusal stale, so it is not stated above a placeable review.
    expect(screen.queryByText(DECLINED_MESSAGE)).not.toBeInTheDocument();
    const reviewed = await summaryFigures(summaryPanel());

    // The single submission: the control is disabled and busy as the attempt stands, so a second press lands nowhere.
    const placeOrder = screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL });
    await user.click(placeOrder);
    expect(placeOrder).toBeDisabled();
    expect(placeOrder).toHaveAttribute("aria-busy", "true");
    const whileSubmitting = screen.queryByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL });
    if (whileSubmitting !== null) await user.click(whileSubmitting);

    await screen.findByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU);
    expect(screen.getAllByText(CHECKOUT_COPY.CONFIRMATION_ORDER_NUMBER_LABEL)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL })).toBeNull();
    const history = await screen.findByRole("link", {
      name: CHECKOUT_COPY.CONFIRMATION_ORDER_HISTORY_LABEL,
    });
    const orderId = (history.getAttribute("href") ?? "").slice(accountOrderPath("").length);
    expect(await summaryFigures(document.body)).toEqual(reviewed);

    // The delivery block reads the country's name the shipping step's selection resolves to, not the code the
    // address stores, so the confirmation's address reads as the review step's and the address book's do.
    const country = SUPPORTED_COUNTRIES[0];
    expect(country.label).not.toBe(country.code);
    const delivery = screen
      .getByRole("heading", { name: CHECKOUT_COPY.CONFIRMATION_ADDRESS_HEADING })
      .closest("section");
    if (delivery === null) throw new Error("The confirmation's delivery block has no frame.");
    expect(within(delivery).getByText(country.label)).toBeInTheDocument();
    expect(within(delivery).queryByText(country.code)).toBeNull();

    // The confirmation stands on the route alone: a reload reads the order by its identifier.
    unmount();
    const reloaded = renderApp({ route: orderConfirmationPath(orderId) });
    await screen.findByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU);
    expect(screen.getAllByText(CHECKOUT_COPY.CONFIRMATION_ORDER_NUMBER_LABEL)).toHaveLength(1);
    expect(await summaryFigures(document.body)).toEqual(reviewed);

    // Completion gave the cart its own clear: the badge reads nothing added and the drawer says so.
    await reloaded.user.click(screen.getByRole("button", { name: cartButtonLabel(0) }));
    const cleared = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
    expect(within(cleared).getByText(EMPTY_STATES.cart.title)).toBeInTheDocument();
  });
});

describe("a checkout the seam refuses", () => {
  it("reports the failed price read and reconciles the summary on its retry", async () => {
    const { unmount } = await cartWithItems();
    unmount();
    // The failure is armed with nothing else in flight, so the checkout's own price request meets it.
    const failure = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    const { user } = renderApp({ route: ROUTES.CHECKOUT });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    const figures = await summaryFigures(summaryPanel());
    expect(figures.total).toBe(
      figures.subtotal - figures.discount + figures.shipping + figures.tax,
    );
    failure.disarm();
  });
});
