/**
 * Path: tests/components/reviewOrder.test.tsx
 * Purpose: The review step the shopper confirms an order on: the order restated section by section, each section's control returning to the step that wrote it, the delivery band's two readings, the code's reduction and the answers a submission can be given
 * Lines: 525
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHECKOUT_COPY, editSectionLabel, paymentDeclinedNote } from "@/constants/checkoutCopy";
import {
  DEMO_CARD_NUMBERS,
  FREE_SHIPPING_METHOD_ID,
  FREE_SHIPPING_THRESHOLD_MINOR,
  SHIPPING_METHODS,
} from "@/constants/config";
import {
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  appliedPromoLabel,
  cartButtonLabel,
  freeShippingProgressLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SORT_OPTIONS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { PROMO_CODES } from "@/data/orders";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import type { PromoCode, ShippingMethod } from "@/types/commerce";
import type { MinorUnits } from "@/types/common";
import { formatMoney, parseMoneyToMinor } from "@/utils/format";

import {
  CHOSEN_METHOD,
  DELIVERY_NAME,
  addItemToCart,
  advanceTo,
  field,
  fillShippingAddress,
} from "../helpers/checkoutHarness";
import {
  CATALOG_COPY,
  moneyFigures,
  quickAddLabel,
  rowAmount,
  settledTiles,
  summaryFigures,
  summaryPanel,
  textOf,
  tileHeadings,
} from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/* The real application throughout, priced by the real service: every figure below is read back off the
   screen, so a case proves what a shopper is shown rather than what a module computes. */

// The order a case walks into ---------------------------------------------------------------------

/** Which offer the basket is walked to: the cheapest the catalogue lists, or the priciest it can sell. */
type Basket = "cheapest" | "priciest";

/** What a case asks of the walk: how many units, which method and which demonstration card. */
interface WalkOptions {
  readonly basket?: Basket;
  readonly quantity?: number;
  readonly method?: ShippingMethod;
  readonly card?: string;
}

/** The sort that offers the highest price first, so the top of the listing is over the delivery threshold. */
const PRICE_DESCENDING_SORT = SORT_OPTIONS[2].value;

/** How far down that order a sellable offer is looked for: the stock cycle leaves some offers unbuyable. */
const PRICIEST_OFFERS_TRIED = 6;

/** The delivery method the price waiver belongs to, read from the configured list rather than restated. */
const FREE_METHOD: ShippingMethod =
  SHIPPING_METHODS.find((method) => method.id === FREE_SHIPPING_METHOD_ID) ?? CHOSEN_METHOD;

/** The holder and security code the payment rule accepts, and the expiry every case here pays with. */
const CARD_HOLDER = DELIVERY_NAME;
const CARD_SECURITY_CODE = "123";
const CARD_EXPIRY_MONTH = String(new Date().getMonth() + 1);
const CARD_EXPIRY_YEAR = String(new Date().getFullYear() + 1);

/** The payment step's five card controls, in the order the step declares them. */
const CARD_CONTROL_LABELS = [
  CHECKOUT_COPY.NAME_ON_CARD_LABEL,
  CHECKOUT_COPY.CARD_NUMBER_LABEL,
  CHECKOUT_COPY.CARD_EXPIRY_MONTH_LABEL,
  CHECKOUT_COPY.CARD_EXPIRY_YEAR_LABEL,
  CHECKOUT_COPY.CARD_SECURITY_CODE_LABEL,
] as const;

/** The digits of the approved number that survive to the review, which is what a card tail is read by. */
const CARD_TAIL = DEMO_CARD_NUMBERS.APPROVED.slice(-4);

/** Writes every judged member of the card. Each control is reached by its own label, because the number and
 *  the security code are masked controls that carry no textbox role for a query to find. */
async function fillCard(user: UserEvent, number: string): Promise<void> {
  const values = [CARD_HOLDER, number, CARD_EXPIRY_MONTH, CARD_EXPIRY_YEAR, CARD_SECURITY_CODE];
  for (const [index, label] of CARD_CONTROL_LABELS.entries()) {
    const control = field(label);
    await user.clear(control);
    await user.type(control, values[index]);
  }
}

/** Chooses the delivery method asked for, by the name its own radio answers to. */
async function chooseMethod(user: UserEvent, method: ShippingMethod): Promise<void> {
  await user.click(await screen.findByRole("radio", { name: new RegExp(method.name, "i") }));
}

/** Adds the units asked for of the offer asked for and returns the name the cart now holds them under. */
async function addOne(user: UserEvent, basket: Basket, quantity: number): Promise<string> {
  if (basket === "cheapest") return addItemToCart(user, { cheapest: true, quantity });
  await user.selectOptions(
    screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL),
    PRICE_DESCENDING_SORT,
  );
  await settledTiles();
  for (const heading of tileHeadings().slice(0, PRICIEST_OFFERS_TRIED)) {
    const name = textOf(heading);
    const tile = heading.closest("li") ?? heading;
    const quickAdd = within(tile).getByRole("button", { name: quickAddLabel(name) });
    if (quickAdd.getAttribute("aria-disabled") === "true") continue;
    await user.click(quickAdd);
    await screen.findByRole("button", { name: cartButtonLabel(1) });
    return name;
  }
  throw new Error("The listing offered no sellable product at the top of the price order.");
}

/** Adds the units asked for and opens the cart on them. */
async function openCart(user: UserEvent, basket: Basket, quantity: number): Promise<string> {
  const name = await addOne(user, basket, quantity);
  await user.click(screen.getByRole("button", { name: cartButtonLabel(quantity) }));
  await user.click(await screen.findByRole("link", { name: CART_COPY.MINI_CART_VIEW_CART_LABEL }));
  await screen.findByRole("heading", { name: CART_COPY.PAGE_HEADING });
  return name;
}

/** Renders the application at the catalogue and walks it through the three steps onto the review. */
async function renderReview(
  options: WalkOptions = {},
): Promise<{ readonly name: string; readonly user: UserEvent }> {
  const basket = options.basket ?? "cheapest";
  const quantity = options.quantity ?? 1;
  const harness = renderApp({ route: ROUTES.CATALOG });
  const name = await openCart(harness.user, basket, quantity);
  await harness.user.click(screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL }));
  await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
  await fillShippingAddress(harness.user);
  await chooseMethod(harness.user, options.method ?? CHOSEN_METHOD);
  await advanceTo(
    harness.user,
    CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
    CHECKOUT_COPY.PAYMENT_STEP_HEADING,
  );
  await fillCard(harness.user, options.card ?? DEMO_CARD_NUMBERS.APPROVED);
  await advanceTo(
    harness.user,
    CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
    CHECKOUT_COPY.REVIEW_STEP_HEADING,
  );
  await screen.findByText(name);
  return { name, user: harness.user };
}

/** One of the review's own sections, found by the heading that names it. */
function section(heading: string): HTMLElement {
  const node = screen.getByRole("heading", { level: 3, name: heading }).closest("section");
  if (node === null) throw new Error(`The review rendered no section under "${heading}".`);
  return node;
}

/** The review's single line, and the money it prints out of the run of its own text: its net total. */
function firstLine(): { readonly item: HTMLElement; readonly figures: readonly MinorUnits[] } {
  const item = within(section(CHECKOUT_COPY.REVIEW_ITEMS_HEADING)).getAllByRole("listitem")[0];
  if (item === undefined) throw new Error("The review listed no item.");
  return { item, figures: moneyFigures(item) };
}

/** The price a line was added at, read from the quantity-and-price span that states it. */
function unitPriceOf(item: HTMLElement, quantity: number): MinorUnits {
  const atPrice = within(item).getByText(new RegExp(`^${quantity} × `));
  return parseMoneyToMinor(textOf(atPrice).replace(/^[\d.,]+\s*×\s*/, ""));
}

/** The reduction a line carries, read from the discount the line states for itself. */
function discountOf(item: HTMLElement): MinorUnits {
  const stated = within(item).getByText(new RegExp(`^${CART_COPY.SUMMARY_DISCOUNT_LABEL} `));
  return parseMoneyToMinor(textOf(stated));
}

/** The seeded code a basket of `subtotalMinor` buys: an active order-scoped code worth an amount, whose floor
 *  the basket clears, so the reduction it takes off is a figure rather than a waiver. */
function seededPromo(subtotalMinor: MinorUnits): PromoCode {
  const usable = PROMO_CODES.filter(
    (code) =>
      code.active &&
      code.appliesTo === "order" &&
      code.kind !== "free_shipping" &&
      code.minSubtotalMinor <= subtotalMinor,
  ).sort((left, right) => left.minSubtotalMinor - right.minSubtotalMinor);
  const promo = usable[0];
  if (promo === undefined) throw new Error("No seeded code discounts a basket this size.");
  return promo;
}

beforeEach(resetApiState);
afterEach(resetApiState);

describe("the order the review restates", () => {
  it("states the line, the address, the method, the card and the amounts a guest is about to be charged", async () => {
    const { name } = await renderReview();

    const headings = [
      CHECKOUT_COPY.REVIEW_ITEMS_HEADING,
      CHECKOUT_COPY.REVIEW_SHIPPING_HEADING,
      CHECKOUT_COPY.REVIEW_DELIVERY_METHOD_HEADING,
      CHECKOUT_COPY.REVIEW_PAYMENT_HEADING,
      CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING,
    ];
    for (const heading of headings) expect(section(heading)).toBeInTheDocument();
    // The two addresses are one, so nothing is restated under a billing heading of its own.
    expect(screen.queryByText(CHECKOUT_COPY.REVIEW_BILLING_HEADING)).toBeNull();

    // The line states what was bought at the price it was bought at, and the two figures multiply out:
    // the quantity and the unit price the line was added at, then the net amount it is charged.
    const { item, figures: line } = firstLine();
    expect(within(item).getByText(name)).toBeInTheDocument();
    expect(line).toHaveLength(1);
    expect(unitPriceOf(item, 1)).toBe(line[0]);

    // The address reads as the member lines that were filled, in postal order: no blank line stands in for
    // the second street line or the phone number the shopper left empty.
    const shipping = section(CHECKOUT_COPY.REVIEW_SHIPPING_HEADING);
    expect(within(shipping).getByText(DELIVERY_NAME)).toBeInTheDocument();
    expect(within(shipping).getByText(SUPPORTED_COUNTRIES[0].label)).toBeInTheDocument();
    expect(within(shipping).getByText(DELIVERY_NAME).parentElement?.children).toHaveLength(4);

    // The chosen method is named with what it does and what this basket pays for it.
    const delivery = section(CHECKOUT_COPY.REVIEW_DELIVERY_METHOD_HEADING);
    expect(within(delivery).getByText(CHOSEN_METHOD.name)).toBeInTheDocument();
    expect(within(delivery).getByText(CHOSEN_METHOD.description)).toBeInTheDocument();
    expect(moneyFigures(delivery)).toContain(CHOSEN_METHOD.priceMinor);

    // The card reads as its holder and its tail, and the number typed never reaches the screen.
    const payment = section(CHECKOUT_COPY.REVIEW_PAYMENT_HEADING);
    expect(within(payment).getByText(CARD_HOLDER)).toBeInTheDocument();
    expect(within(payment).getByText(new RegExp(CARD_TAIL))).toBeInTheDocument();
    expect(within(payment).queryByText(DEMO_CARD_NUMBERS.APPROVED)).toBeNull();

    // The amounts are the pricing service's own figures, reconciled rather than added up here.
    const totals = section(CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING);
    const figures = await summaryFigures(totals);
    expect(figures.subtotal).toBe(line[0]);
    expect(figures.discount).toBe(0);
    expect(figures.shipping).toBe(CHOSEN_METHOD.priceMinor);
    expect(figures.subtotal - figures.discount + figures.shipping + figures.tax).toBe(
      figures.total,
    );

    // Nothing is waived for delivery on a basket this size, so the band states what is still owed.
    const remaining = FREE_SHIPPING_THRESHOLD_MINOR - figures.subtotal;
    expect(figures.subtotal).toBeLessThan(FREE_SHIPPING_THRESHOLD_MINOR);
    expect(
      within(totals).getByText(freeShippingProgressLabel(formatMoney(remaining))),
    ).toBeInTheDocument();
    expect(within(totals).queryByText(CART_COPY.FREE_DELIVERY_EARNED_LABEL)).toBeNull();

    // One control places the order, and it stands enabled because the flow says the order may be placed.
    const placeOrder = screen.getAllByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL });
    expect(placeOrder).toHaveLength(1);
    expect(placeOrder[0]).toBeEnabled();
  });

  it("counts the units a line holds against the price it was added at", async () => {
    const { name } = await renderReview({ quantity: 2 });
    const { item, figures: line } = firstLine();
    const unitPrice = unitPriceOf(item, 2);
    expect(unitPrice * 2).toBe(line[0]);

    const figures = await summaryFigures(section(CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING));
    expect(figures.subtotal).toBe(line[0]);
    expect(figures.subtotal - figures.discount + figures.shipping + figures.tax).toBe(
      figures.total,
    );
    expect(screen.getByText(name)).toBeInTheDocument();
  });

  it("returns to the step a section came from, keeping every value that step collected", async () => {
    const { user } = await renderReview();

    await user.click(
      screen.getByRole("button", {
        name: editSectionLabel(CHECKOUT_COPY.REVIEW_DELIVERY_METHOD_HEADING),
      }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
    expect(field(CHECKOUT_COPY.FULL_NAME_LABEL)).toHaveValue(DELIVERY_NAME);
    expect(field(CHECKOUT_COPY.COUNTRY_LABEL)).toHaveValue(SUPPORTED_COUNTRIES[0].code);
    expect(screen.getByRole("radio", { name: new RegExp(CHOSEN_METHOD.name, "i") })).toBeChecked();

    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );
    await user.click(
      screen.getByRole("button", { name: editSectionLabel(CHECKOUT_COPY.REVIEW_PAYMENT_HEADING) }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.PAYMENT_STEP_HEADING });
    expect(field(CHECKOUT_COPY.CARD_NUMBER_LABEL)).toHaveValue(DEMO_CARD_NUMBERS.APPROVED);
    expect(field(CHECKOUT_COPY.NAME_ON_CARD_LABEL)).toHaveValue(CARD_HOLDER);

    // The items are not a step, so their section's control is the way back to the cart the lines came from.
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );
    const items = section(CHECKOUT_COPY.REVIEW_ITEMS_HEADING);
    expect(
      within(items).getByRole("link", { name: CHECKOUT_COPY.BACK_TO_CART_LABEL }),
    ).toHaveAttribute("href", ROUTES.CART);
    expect(
      within(section(CHECKOUT_COPY.REVIEW_SHIPPING_HEADING)).getByRole("button", {
        name: editSectionLabel(CHECKOUT_COPY.REVIEW_SHIPPING_HEADING),
      }),
    ).toBeInTheDocument();
    expect(
      within(items).getByRole("link", { name: CHECKOUT_COPY.BACK_TO_CART_LABEL }),
    ).toBeInTheDocument();
  });

  it.each([
    {
      title: "a basket short of the threshold is told what is still owed and pays the charge",
      basket: "cheapest" as Basket,
      method: CHOSEN_METHOD,
      band: "shortfall",
      freeDelivery: false,
    },
    {
      title: "a basket that clears the threshold on the free service reads the delivery as earned",
      basket: "priciest" as Basket,
      method: FREE_METHOD,
      band: "earned",
      freeDelivery: true,
    },
    {
      title:
        "a basket that clears the threshold on a service that still charges states no band at all",
      basket: "priciest" as Basket,
      method: CHOSEN_METHOD,
      band: "none",
      freeDelivery: false,
    },
  ])("$title", async ({ basket, method, band, freeDelivery }) => {
    const { name } = await renderReview({ basket, method });
    const totals = section(CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING);
    const figures = await summaryFigures(totals);
    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD_MINOR - figures.subtotal);
    const shortfall = freeShippingProgressLabel(formatMoney(remaining));
    const earned = CART_COPY.FREE_DELIVERY_EARNED_LABEL;

    // The state's own premise: what the basket owes toward the threshold, and what it pays for delivery.
    if (band === "shortfall") {
      expect(figures.subtotal).toBeLessThan(FREE_SHIPPING_THRESHOLD_MINOR);
      expect(remaining).toBeGreaterThan(0);
    } else {
      expect(figures.subtotal).toBeGreaterThanOrEqual(FREE_SHIPPING_THRESHOLD_MINOR);
      expect(remaining).toBe(0);
    }
    expect(figures.shipping).toBe(freeDelivery ? 0 : method.priceMinor);

    // The band states the shortfall, the waiver, or nothing, and never the sentence its state rules out.
    if (band === "none") {
      expect(within(totals).queryByText(shortfall)).toBeNull();
    } else {
      expect(within(totals).getByText(band === "earned" ? earned : shortfall)).toBeInTheDocument();
    }
    expect(within(totals).queryByText(band === "earned" ? shortfall : earned)).toBeNull();

    // Either way the basket is priced in full, and the band decides no figure of its own.
    expect(within(section(CHECKOUT_COPY.REVIEW_ITEMS_HEADING)).getByText(name)).toBeInTheDocument();
    expect(figures.subtotal - figures.discount + figures.shipping + figures.tax).toBe(
      figures.total,
    );
  });

  it("reports a price read that failed while the delivery method was chosen, and prices again on its retry", async () => {
    const { name, user } = await renderReview();

    await user.click(
      screen.getByRole("button", {
        name: editSectionLabel(CHECKOUT_COPY.REVIEW_DELIVERY_METHOD_HEADING),
      }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });

    // The failure is armed with nothing else in flight, so the re-price the method change starts meets it.
    const failure = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    await chooseMethod(user, FREE_METHOD);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );

    // A basket whose figures are unknown states the failure and offers the one control that resolves it.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);
    expect(screen.getByText(FEEDBACK_COPY.ERROR_STATE_HINT)).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(await screen.findByText(name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    failure.disarm();
  });

  it("places the order once and holds the single control busy until the confirmation arrives", async () => {
    const { user } = await renderReview();
    const placeOrder = screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL });

    await user.click(placeOrder);

    // The attempt stands as it was committed: the control is disabled and reports itself busy, its label is
    // the in-flight wording, and the band it sits in states why it stays disabled.
    expect(placeOrder).toBeDisabled();
    expect(placeOrder).toHaveAttribute("aria-busy", "true");
    expect(placeOrder).toHaveTextContent(CHECKOUT_COPY.SUBMITTING_LABEL);
    const band = placeOrder.parentElement;
    if (band === null) throw new Error("The place-order control sits in no band.");
    expect(band.textContent).toContain(CHECKOUT_COPY.DUPLICATE_SUBMISSION_NOTICE);
    expect(band.textContent).not.toContain(CHECKOUT_COPY.PLACE_ORDER_LABEL);

    // A second press while the attempt runs lands on a control that offers nothing to press.
    const again = screen.queryByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL });
    if (again !== null) await user.click(again);

    await screen.findByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU);
    expect(screen.queryByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL })).toBeNull();
  });

  it("reports a refused submission on the step itself and moves the keyboard to the refusal", async () => {
    const { user } = await renderReview({ card: DEMO_CARD_NUMBERS.DECLINED });
    await user.click(screen.getByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL }));

    const refusal = await screen.findByRole("alert", {
      name: CHECKOUT_COPY.ERROR_SUMMARY_HEADING,
    });
    expect(refusal).toHaveTextContent(paymentDeclinedNote(DEMO_CARD_NUMBERS.APPROVED));
    expect(refusal.parentElement).toHaveFocus();
    expect(screen.getAllByRole("button", { name: CHECKOUT_COPY.PLACE_ORDER_LABEL })).toHaveLength(
      1,
    );
    expect(screen.queryByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU)).toBeNull();
  });

  it("subtracts the code that applies from the line, the goods and the total, and names the code", async () => {
    const harness = renderApp({ route: ROUTES.CATALOG });
    const name = await openCart(harness.user, "cheapest", 1);
    const priced = await summaryFigures(summaryPanel(CART_COPY.SUMMARY_HEADING));
    const promo = seededPromo(priced.subtotal);

    const promoField = screen.getByLabelText<HTMLInputElement>(CART_COPY.PROMO_FIELD_LABEL);
    await harness.user.type(promoField, promo.code);
    await harness.user.click(screen.getByRole("button", { name: CART_COPY.PROMO_APPLY_LABEL }));
    const code = appliedPromoLabel(promo.code);

    await harness.user.click(
      screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL }),
    );
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
    await fillShippingAddress(harness.user);
    await chooseMethod(harness.user, CHOSEN_METHOD);
    await advanceTo(
      harness.user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );
    await fillCard(harness.user, DEMO_CARD_NUMBERS.APPROVED);
    await advanceTo(
      harness.user,
      CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL,
      CHECKOUT_COPY.REVIEW_STEP_HEADING,
    );
    await screen.findByText(name);

    // The line states the reduction it carries beside its gross figures, and the two reconcile.
    const { item, figures: line } = firstLine();
    const lineDiscount = discountOf(item);
    const unitPrice = unitPriceOf(item, 1);
    expect(lineDiscount).toBeGreaterThan(0);
    expect(line).toHaveLength(1);
    expect(unitPrice - lineDiscount).toBe(line[0]);

    // The goods subtotal is unchanged by the code and the reduction is stated once, in its own row.
    const totals = section(CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING);
    const figures = await summaryFigures(totals, CART_COPY.SUMMARY_DISCOUNT_LABEL);
    expect(figures.subtotal).toBe(priced.subtotal);
    expect(figures.subtotal).toBe(unitPrice);
    expect(figures.discount).toBe(lineDiscount);
    expect(rowAmount(totals, CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBeGreaterThan(0);
    expect(figures.subtotal - figures.discount + figures.shipping + figures.tax).toBe(
      figures.total,
    );

    // The code that earned the reduction is named beneath the amounts, once.
    expect(within(totals).getAllByText(code)).toHaveLength(1);
  });
});
