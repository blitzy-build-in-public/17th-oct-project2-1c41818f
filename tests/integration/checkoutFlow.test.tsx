/**
 * Path: tests/integration/checkoutFlow.test.tsx
 * Purpose: Cart to order through the three steps, the idempotent submission and the cleared cart
 * Lines: 611
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  FREE_SHIPPING_THRESHOLD_MINOR,
  SHIPPING_METHODS,
} from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  CATALOG_COPY,
  CHECKOUT_COPY,
  CHECKOUT_STEP_TITLES,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  PROMO_REJECTION_MESSAGES,
  VALIDATION_MESSAGES,
  cartButtonLabel,
  cartItemCountLabel,
  demoPaymentNote,
  editSectionLabel,
  freeShippingProgressLabel,
  lowStockLabel,
  quantityLabel,
  removeLineLabel,
  removePromoLabel,
  stepProgressLabel,
} from "@/constants/content";
import { ROUTES, accountOrderPath, orderConfirmationPath, productPath } from "@/constants/routes";
import { PROMO_KIND_LABELS, SORT_OPTIONS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { PROMO_CODES } from "@/data/orders";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import { CHECKOUT_FORM_STEPS } from "@/state/checkoutReducer";
import type { MinorUnits } from "@/types/common";
import type { PromoCode } from "@/types/commerce";
import { formatMoney, parseMoneyToMinor } from "@/utils/format";

import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/* The real application throughout: every figure is read back off the screen in integer minor units. */

/** The contact address a guest's checkout is filled with, and the name its delivery address is under. */
const CONTACT_EMAIL = DEMO_ACCOUNTS.CUSTOMER_EMAIL;
const DELIVERY_NAME = "Ada Lovelace";

/** The holder, and a code the card rule accepts; this month with the next year is a pair it accepts. */
const CARD_HOLDER = "Ada Lovelace";
const CARD_CVC = "123";
const CURRENT_MONTH = String(new Date().getMonth() + 1);
const NEXT_YEAR = String(new Date().getFullYear() + 1);

/** The approved number with its check digit moved on by one, which breaks its Luhn checksum. */
const LUHN_FAILING_NUMBER = `${DEMO_CARD_NUMBERS.APPROVED.slice(0, -1)}${String(
  (Number(DEMO_CARD_NUMBERS.APPROVED.slice(-1)) + 1) % 10,
)}`;

/** The last configured delivery method, which always charges, so choosing it re-prices the basket. */
const CHOSEN_METHOD = SHIPPING_METHODS[SHIPPING_METHODS.length - 1];

/** The sort key that lists the catalogue cheapest first, and the prefix every product link carries. */
const CHEAPEST_FIRST_SORT = SORT_OPTIONS[1].value;
const PRODUCT_PATH_PREFIX = productPath("");

/** A spelling no seeded code carries, in the shape the promo field accepts. */
const UNKNOWN_PROMO_CODE = `${PROMO_CODES[0].code}9`;

/** What the seam answers a declined demonstration card with, worded by the copy module that owns it. */
const DECLINED_MESSAGE = demoPaymentNote(DEMO_CARD_NUMBERS.APPROVED, DEMO_CARD_NUMBERS.DECLINED);

// Reading what a surface states in money ---------------------------------------------------------

/** Every money figure a region prints, in the order it prints them: a figure the formatter round-trips. */
function moneyFigures(scope: HTMLElement): readonly MinorUnits[] {
  const figures: MinorUnits[] = [];
  for (const node of scope.querySelectorAll("*")) {
    const text = (node.textContent ?? "").trim();
    const minor = parseMoneyToMinor(text);
    if (node.children.length === 0 && minor > 0 && formatMoney(minor) === text) figures.push(minor);
  }
  return figures;
}

/** The figures an order summary states, in integer minor units. */
type SummaryFigures = Readonly<
  Record<"subtotal" | "discount" | "shipping" | "tax" | "total", MinorUnits>
>;

/** The summary panel the surface under test renders, named by the heading that surface states; the cart's and
 *  the checkout's are two regions under two names, so a caller names the one it means. */
function summaryPanel(name: string = CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING): HTMLElement {
  return screen.getByRole("region", { name });
}

/** The amount a summary row states for `label`, or `0` when the region prints no such row. */
function rowAmount(scope: HTMLElement, label: string): MinorUnits {
  const row = within(scope).queryAllByText(label)[0]?.parentElement;
  if (row === null || row === undefined) return 0;
  const text = row.textContent ?? "";
  return parseMoneyToMinor(text.slice(text.indexOf(label) + label.length));
}

/** The figures a summary states once priced; `discountLabel` names the row a single applied code is stated in. */
async function summaryFigures(scope: HTMLElement, discountLabel?: string): Promise<SummaryFigures> {
  await waitFor(() =>
    expect(rowAmount(scope, CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeGreaterThan(0),
  );
  return {
    subtotal: rowAmount(scope, CART_COPY.SUMMARY_SUBTOTAL_LABEL),
    discount: discountLabel === undefined ? 0 : rowAmount(scope, discountLabel),
    shipping: rowAmount(scope, CART_COPY.SUMMARY_SHIPPING_LABEL),
    tax: rowAmount(scope, CART_COPY.SUMMARY_TAX_LABEL),
    total: rowAmount(scope, CART_COPY.SUMMARY_TOTAL_LABEL),
  };
}

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

/** The catalogue's product links, in the order the listing offers them. */
function productLinks(): HTMLElement[] {
  return screen
    .queryAllByRole("link")
    .filter((link) => (link.getAttribute("href") ?? "").startsWith(PRODUCT_PATH_PREFIX));
}

/** The first product link the listing offers, once the listing it leads has rendered. This wait asks for more than
 *  the suite's ceiling in `tests/setup.ts`: a cold module registry measures about two seconds on an idle host. */
async function firstProductLink(): Promise<HTMLElement> {
  await waitFor(() => expect(productLinks().length).toBeGreaterThan(0), { timeout: 10_000 });
  const link = productLinks()[0];
  if (link === undefined) throw new Error("The catalogue rendered no product link.");
  return link;
}

/** What a walk into the catalogue asks for. */
type CartWalk = { readonly quantity?: number; readonly cheapest?: boolean };

/** Walks into the catalogue's first product, adds the units asked for, asserts the mini-cart's count and returns
 *  the cart row's name. */
async function addItemToCart(user: UserEvent, walk: CartWalk = {}): Promise<string> {
  if (walk.cheapest === true) {
    const before = (await firstProductLink()).textContent;
    const sort = screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL);
    await user.selectOptions(sort, CHEAPEST_FIRST_SORT);
    await waitFor(() => expect(productLinks()[0]?.textContent).not.toBe(before));
  }
  const link = await firstProductLink();
  const name = (link.textContent ?? "").trim();
  await user.click(link);
  await screen.findByRole("heading", { level: 1, name });
  const stepper = screen.queryByLabelText<HTMLInputElement>(quantityLabel(name));
  if ((walk.quantity ?? 1) > 1 && stepper !== null) {
    await user.clear(stepper);
    await user.type(stepper, String(walk.quantity));
  }
  await user.click(screen.getByRole("button", { name: CATALOG_COPY.ADD_TO_CART_LABEL }));
  const drawer = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
  expect(within(drawer).getByText(cartItemCountLabel(walk.quantity ?? 1))).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(drawer).not.toBeInTheDocument());
  return name;
}

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

/** The control a field's own label names; a required field's label ends with its marker, so it is a pattern. */
function field(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(label));
}

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

// Filling the checkout's steps -------------------------------------------------------------------

/** Fills the shipping step's contact and address controls, and the country from the configured list. */
async function fillShippingAddress(user: UserEvent): Promise<void> {
  const entries = [
    [ACCOUNT_COPY.EMAIL_LABEL, CONTACT_EMAIL],
    [CHECKOUT_COPY.FULL_NAME_LABEL, DELIVERY_NAME],
    [CHECKOUT_COPY.ADDRESS_LINE_1_LABEL, "12 Beacon Street"],
    [CHECKOUT_COPY.CITY_LABEL, "Boston"],
    [CHECKOUT_COPY.REGION_LABEL, "MA"],
    [CHECKOUT_COPY.POSTAL_CODE_LABEL, "02108"],
  ] as const;
  for (const [label, value] of entries) await user.type(field(label), value);
  await user.selectOptions(field(CHECKOUT_COPY.COUNTRY_LABEL), SUPPORTED_COUNTRIES[0].code);
}

/** Chooses the delivery method every advance here picks, the one that always charges. */
async function chooseShippingMethod(user: UserEvent): Promise<void> {
  await user.click(await screen.findByRole("radio", { name: new RegExp(CHOSEN_METHOD.name, "i") }));
}

/** Advances the step in force through the control the flow gives it, and waits for the step that follows. */
async function advanceTo(user: UserEvent, label: string, heading: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: label }));
  await screen.findByRole("heading", { name: heading });
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

/** Writes every judged member of the card, in the order the payment step declares its five controls: holder,
 *  number, the expiry's two halves and the security code. */
async function fillCard(user: UserEvent, fill: CardFill): Promise<void> {
  const values = [CARD_HOLDER, fill.number, fill.expiryMonth, fill.expiryYear, fill.cvc];
  const controls = screen.getAllByRole("textbox");
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
  it("opens from the header badge, edits a quantity, gives the focus back and reaches the checkout", async () => {
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
    expect(screen.getByText(CHECKOUT_COPY.ERROR_SUMMARY_HEADING)).toBeInTheDocument();
    expect(screen.getAllByText(VALIDATION_MESSAGES.REQUIRED).length).toBeGreaterThan(0);
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

    // The demonstration card the seam declines places nothing, and says so where it can be corrected.
    await user.click(screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL }));
    expect(await screen.findByText(DECLINED_MESSAGE)).toBeInTheDocument();
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

describe("an order read refused for want of a session", () => {
  it("offers the sign-in that resolves it instead of a retry that cannot", async () => {
    const route = orderConfirmationPath("ord_999999");
    renderApp({ route });
    expect(await screen.findByRole("alert")).toHaveTextContent(FEEDBACK_COPY.SIGN_IN_REQUIRED);
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    const signIn = screen.getByRole("link", { name: COMMON_ACTIONS.SIGN_IN });
    expect(signIn).toHaveAttribute("href", `${ROUTES.LOGIN}?returnTo=${encodeURIComponent(route)}`);
  });
});
