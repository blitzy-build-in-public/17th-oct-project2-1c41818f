/**
 * Path: tests/integration/accountFlow.test.tsx
 * Purpose: Sign-in, profile edit, order history and the address book, plus the unauthenticated redirect.
 * Lines: 566
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  A11Y_COPY,
  CART_COPY,
  CHECKOUT_COPY,
  COMMON_ACTIONS,
  DATE_RANGE_COPY,
  EMPTY_STATES,
  FEEDBACK_COPY,
  HEADER_COPY,
  PAGE_TITLES,
  VALIDATION_MESSAGES,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { ORDER_STATUS_OPTIONS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { CUSTOMERS } from "@/data/customers";
import { ORDERS } from "@/data/orders";
import { API_PATHS } from "@/lib/mockServer";
import type { Customer } from "@/types/account";
import type { Order, OrderStatus } from "@/types/commerce";
import type { MinorUnits } from "@/types/common";
import { toDateInputValue } from "@/utils/dates";
import { formatMoney, parseMoneyToMinor } from "@/utils/format";

import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * Each case's facts come from the module that owns them — `DEMO_ACCOUNTS`, the seeded records, the copy library,
 * `ROUTES` — and its only lever on the product is `failNext`, the API seam's own failure switch. The source is
 * bound once for the whole file and keeps what a case writes, so a case signs in with a seeded account or
 * registers one of its own rather than editing the shopper's record for a later case to find changed.
 */

/** The seeded account an email names, or a thrown seed mistake rather than a case that quietly checks less. */
function seededCustomer(email: string): Customer {
  const found = CUSTOMERS.find((customer) => customer.email === email);
  if (found === undefined) throw new Error(`The seeded accounts do not hold "${email}".`);
  return found;
}

/** The account the flows sign in as: the shopper whose own record and orders every case is checked against. */
const SHOPPER: Customer = seededCustomer(DEMO_ACCOUNTS.CUSTOMER_EMAIL);

/** The shopper's own orders: what the history must list, and where each figure the detail shows comes from. */
const SHOPPER_ORDERS: readonly Order[] = ORDERS.filter((order) => order.customerId === SHOPPER.id);

/** The words a status renders as, from the one vocabulary that names every status. */
function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

const NEW_ACCOUNT = { firstName: "Nina", lastName: "Weber", password: DEMO_ACCOUNTS.PASSWORD };

/** An address no seeded account holds, unique within the run because a registration stays in the store. */
function uniqueEmail(tag: string): string {
  return `nina.weber.${tag}@salespro.test`;
}

// Driving the real forms --------------------------------------------------------------------------

/** The pattern a field's label is found by: a required field's label continues past its copy with a marker
 *  and a visually hidden sentence, so its whole text is never the copy alone. */
function fieldLabel(label: string): RegExp {
  return new RegExp(`^${label}`);
}

async function fillRegistration(
  user: UserEvent,
  email: string,
  password: string = NEW_ACCOUNT.password,
): Promise<void> {
  const firstName = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL));
  const lastName = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.LAST_NAME_LABEL));
  await user.type(firstName, NEW_ACCOUNT.firstName);
  await user.type(lastName, NEW_ACCOUNT.lastName);
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), email);
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)), password);
}

async function registerAndLand(user: UserEvent, email: string): Promise<void> {
  await fillRegistration(user, email);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL }));
  expect(await profileScreen()).toBeVisible();
}

/** Signs in through the real form and waits for that screen to leave, wherever the session lands the visitor. */
async function signInAs(
  user: UserEvent,
  email: string,
  password: string = DEMO_ACCOUNTS.PASSWORD,
): Promise<void> {
  await user.type(await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), email);
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)), password);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await waitFor(() => {
    expect(screen.queryByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeNull();
  });
}

async function openSection(user: UserEvent, label: string): Promise<void> {
  await user.click(await screen.findByRole("link", { name: label }));
}

/** The panel the header's account trigger controls, which is read from the id it points at. */
function accountPanel(): HTMLElement {
  const trigger = screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL });
  const panelId = trigger.getAttribute("aria-controls");
  const panel = panelId === null ? null : document.getElementById(panelId);
  if (panel === null) {
    throw new Error("The account menu is not reachable through its trigger's aria-controls.");
  }
  return panel;
}

async function openAccountMenu(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL }));
}

// Reading what a screen shows ---------------------------------------------------------------------

/** The history's table, which its own caption names: waiting on it is what proves the screen rendered. */
function listedTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING });
}

/** The profile's own heading, waited for: a case that lands in the account area has arrived by it. */
function profileScreen(): Promise<HTMLElement> {
  return screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
}

/** The order numbers the history currently lists, read from the table's own body rows. */
function listedOrderNumbers(): string[] {
  const table = screen.getByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent?.trim() ?? "");
}

/** The minor units the figure beside `label` renders as, read from the row that holds both. */
function displayedAmount(scope: HTMLElement, label: string): MinorUnits {
  const row = within(scope).getByText(label).parentElement;
  if (row === null) throw new Error(`No row holds the "${label}" figure.`);
  return parseMoneyToMinor(row.textContent);
}

/** The block a labelled heading opens, which is how the order detail's sections are reached. */
function sectionFor(heading: string): HTMLElement {
  const parent = screen.getByRole("heading", { name: heading }).parentElement;
  if (parent === null) throw new Error(`The "${heading}" section has no frame.`);
  return parent;
}

/** One address card, found by the street line it shows, which is `addressLabel`'s own fallback name. */
function addressCard(line1: string): HTMLElement {
  const card = screen.getByRole("heading", { name: new RegExp(line1) }).closest("li");
  if (card === null) throw new Error(`The address card at "${line1}" is not a list item.`);
  return card;
}

/** The one control of a card whose accessible name opens with the action verb and then names the address. */
function cardAction(card: HTMLElement, verb: string): HTMLElement {
  return within(card).getByRole("button", { name: new RegExp(`^${verb}\\b`) });
}

function defaultControl(line1: string, label: string): HTMLElement {
  return within(addressCard(line1)).getByLabelText(label);
}

/** Waits for exactly one badge of a kind to be marked, and for it to sit on the named address's card. */
async function expectOneBadge(label: string, line1: string): Promise<void> {
  await waitFor(() => {
    expect(within(addressCard(line1)).getAllByText(label)).toHaveLength(1);
    expect(screen.getAllByText(label)).toHaveLength(1);
  });
}

/** The fields a case fills in the address dialog; the country stays on the set's own home country. */
interface AddressDraft {
  readonly fullName: string;
  readonly line1: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
}

function addressDraft(line1: string, city: string): AddressDraft {
  return { fullName: "Nina Weber", line1, city, region: "OR", postalCode: "97205" };
}

/** Fills the address dialog's required fields and saves it, waiting for the close and for the card behind it. */
async function addAddress(user: UserEvent, draft: AddressDraft): Promise<void> {
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL }));
  const dialog = await screen.findByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL });
  const country = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.COUNTRY_LABEL));
  expect(country).toHaveValue(SUPPORTED_COUNTRIES[0].code);
  const fullName = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.FULL_NAME_LABEL));
  const street = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL));
  const city = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.CITY_LABEL));
  const region = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.REGION_LABEL));
  const postalCode = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.POSTAL_CODE_LABEL));
  await user.type(fullName, draft.fullName);
  await user.type(street, draft.line1);
  await user.type(city, draft.city);
  await user.type(region, draft.region);
  await user.type(postalCode, draft.postalCode);
  await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeNull();
  });
  // The book is re-read after a save, so the card that proves it landed is awaited before a case goes on.
  await screen.findByText(draft.line1);
}

describe("the customer accounts flow", () => {
  beforeEach(() => {
    resetApiState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns a visitor with no session away from an account route and returns them to it", async () => {
    const { user } = renderApp({ route: ROUTES.ACCOUNT_ORDERS });

    // The guard redirected: the protected view is not there, and the sign-in screen is.
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
    expect(screen.queryByRole("heading", { name: ACCOUNT_COPY.ORDERS_HEADING })).toBeNull();

    // A wrong password is refused with one sentence that names neither member, and marks neither control:
    // a refusal that pointed at one would tell a stranger which addresses have accounts.
    const email = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));
    await user.type(email, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    await user.type(password, `${DEMO_ACCOUNTS.PASSWORD}x`);
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE)).toBeVisible();
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(password).not.toHaveAttribute("aria-invalid", "true");

    // Signing in from the screen the guard sent the visitor to lands on the path they asked for.
    await user.clear(password);
    await user.type(password, DEMO_ACCOUNTS.PASSWORD);
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
    expect(await listedTable()).toBeVisible();
  });

  it("judges the registration form and refuses an address that already has an account", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    const submit = await screen.findByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL });
    const email = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));

    // The four judged fields each report; the consent switch carries no rule and reports none.
    await user.click(submit);
    const missing = screen.getAllByRole("alert");
    expect(missing).toHaveLength(4);
    missing.forEach((node) => expect(node).toHaveTextContent(VALIDATION_MESSAGES.REQUIRED));
    expect(email).toHaveAttribute("aria-invalid", "true");

    await fillRegistration(user, uniqueEmail("policy"), "short1");
    await user.click(submit);
    expect(await screen.findByText(VALIDATION_MESSAGES.PASSWORD_POLICY)).toBeVisible();

    // Uniqueness is the store's answer, and it lands on the control that caused it.
    await user.clear(email);
    await user.clear(password);
    await fillRegistration(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    await user.click(submit);
    expect(await screen.findByText(ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE)).toBeVisible();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("registers a customer, lands in the account area and shows the empty order history", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    await registerAndLand(user, uniqueEmail("orders"));
    await openSection(user, ACCOUNT_COPY.NAV_ORDERS_LABEL);
    expect(await screen.findByRole("heading", { name: ACCOUNT_COPY.ORDERS_HEADING })).toBeVisible();

    // A freshly registered customer holds nothing, so this is the empty state's deterministic case.
    expect(await screen.findByText(EMPTY_STATES.orders.title)).toBeVisible();
    expect(screen.getByText(EMPTY_STATES.orders.description)).toBeVisible();
    await user.click(screen.getByRole("button", { name: EMPTY_STATES.orders.actionLabel }));
    expect(await screen.findByRole("heading", { name: PAGE_TITLES.CATALOG })).toBeVisible();
  });

  it("shows the signed-in customer only their own account and orders, down to one order's figures", async () => {
    expect(SHOPPER_ORDERS.length).toBeGreaterThan(0);
    const { user, unmount } = renderApp({ route: ROUTES.LOGIN });
    await signInAs(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);

    // The profile is the session's own account, read from the seeded record rather than assumed.
    expect(await screen.findByDisplayValue(SHOPPER.email)).toBeVisible();
    expect(screen.getByDisplayValue(SHOPPER.firstName)).toBeVisible();
    expect(screen.getByDisplayValue(SHOPPER.lastName)).toBeVisible();

    await openSection(user, ACCOUNT_COPY.NAV_ORDERS_LABEL);
    const table = await listedTable();
    await waitFor(() => {
      expect(listedOrderNumbers()).toHaveLength(SHOPPER_ORDERS.length);
    });
    // Every number the history lists is one of this customer's own, and every one of theirs is listed once.
    const listed = listedOrderNumbers();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(SHOPPER_ORDERS.map((order) => order.orderNumber).sort());

    // The row's own link is followed rather than a path assembled by hand, so the link is part of the case.
    const link = within(within(table).getAllByRole("row")[1]).getByRole("link");
    const number = link.textContent?.trim() ?? "";
    const order = SHOPPER_ORDERS.find((candidate) => candidate.orderNumber === number);
    if (order === undefined) throw new Error(`The history lists an unknown order: ${number}`);
    await user.click(link);
    expect(await screen.findByRole("heading", { name: number })).toBeVisible();

    // Every line the order was placed with, at the price it was placed at: the snapshot, not the catalogue.
    const items = sectionFor(ACCOUNT_COPY.ORDER_DETAIL_ITEMS_HEADING);
    const lines = within(items).getAllByRole("listitem");
    expect(lines).toHaveLength(order.lines.length);
    order.lines.forEach((line, index) => {
      expect(within(lines[index]).getByText(line.productName)).toBeVisible();
      const lineTotal = formatMoney(line.lineTotalMinor, order.pricedCart.currency);
      expect(within(lines[index]).getByText(lineTotal)).toBeVisible();
    });

    // What the screen shows reconciles with itself as well as with the record behind it. The discount is
    // rendered signed and the parser reads its magnitude, which is why it is subtracted here.
    const subtotal = displayedAmount(items, CART_COPY.SUMMARY_SUBTOTAL_LABEL);
    const shipping = displayedAmount(items, CART_COPY.SUMMARY_SHIPPING_LABEL);
    const tax = displayedAmount(items, CART_COPY.SUMMARY_TAX_LABEL);
    const total = displayedAmount(items, CART_COPY.SUMMARY_TOTAL_LABEL);
    const discount = within(items).queryByText(CART_COPY.SUMMARY_DISCOUNT_LABEL)
      ? displayedAmount(items, CART_COPY.SUMMARY_DISCOUNT_LABEL)
      : 0;
    expect(subtotal).toBe(order.pricedCart.subtotalMinor);
    expect(total).toBe(order.pricedCart.grandTotalMinor);
    expect(subtotal - discount + shipping + tax).toBe(total);

    // The status the order now stands at is the one the timeline marks, and it reads in words as well.
    const timeline = sectionFor(ACCOUNT_COPY.ORDER_DETAIL_HISTORY_HEADING);
    const steps = within(timeline).getAllByRole("listitem");
    expect(steps).toHaveLength(order.statusHistory.length);
    order.statusHistory.forEach((entry, index) => {
      expect(within(steps[index]).getByText(statusLabel(entry.status))).toBeVisible();
    });
    const current = steps.filter((step) => step.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain(statusLabel(order.status));

    // The only fact stored between visits is the token, and the store revalidates it on this mount.
    unmount();
    renderApp({ route: ROUTES.ACCOUNT });
    expect(await screen.findByDisplayValue(SHOPPER.email)).toBeVisible();
  });

  it("refuses an invalid phone number and saves a valid profile", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAs(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    const phone = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.PHONE_LABEL));
    const save = screen.getByRole("button", { name: COMMON_ACTIONS.SAVE_CHANGES });

    await user.clear(phone);
    await user.type(phone, "12345");
    await user.click(save);
    const message = await screen.findByText(VALIDATION_MESSAGES.PHONE_FORMAT);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    // Linked, not merely adjacent: the control is described by the element that carries the message.
    expect(phone.getAttribute("aria-describedby")).toContain(message.id);
    expect(screen.queryByText(FEEDBACK_COPY.TOAST_PROFILE_SAVED)).toBeNull();

    const lastName = "Okafor-Clarke";
    const lastNameField = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.LAST_NAME_LABEL));
    await user.clear(phone);
    await user.type(phone, "+1 503 555 0142");
    await user.clear(lastNameField);
    await user.type(lastNameField, lastName);
    await user.click(save);

    // The confirmation is announced, so it is not only painted where the reader happens to be looking.
    const confirmations = await screen.findAllByText(FEEDBACK_COPY.TOAST_PROFILE_SAVED);
    const announced = confirmations.filter(
      (node) => node.closest('[role="status"]') !== null || node.closest('[role="alert"]') !== null,
    );
    expect(announced.length).toBeGreaterThan(0);
    // The header names the account from the projection the save refreshed, so it carries the new name too.
    await openAccountMenu(user);
    await waitFor(() => {
      expect(within(accountPanel()).getByText(`${SHOPPER.firstName} ${lastName}`)).toBeVisible();
    });
  });

  it("drives the history's own controls, and reloads it when the seam refuses a read", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAs(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    await openSection(user, ACCOUNT_COPY.NAV_ORDERS_LABEL);
    const status = await screen.findByLabelText(
      fieldLabel(ACCOUNT_COPY.ORDERS_STATUS_FILTER_LABEL),
    );

    // The shopper's history is kept clear of cancellation by the seed, so this filter legitimately matches
    // nothing and reaches the filtered empty state rather than the account's own.
    await user.selectOptions(status, "cancelled");
    expect(await screen.findByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL })).toBeVisible();
    expect(screen.queryByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING })).toBeNull();

    // A status the shopper does hold, asserted row by row rather than by a figure the seed could change.
    const held = SHOPPER_ORDERS[0].status;
    const heldOrders = SHOPPER_ORDERS.filter((order) => order.status === held);
    await user.selectOptions(status, held);
    await waitFor(() => {
      expect(listedOrderNumbers()).toHaveLength(heldOrders.length);
    });
    const table = screen.getByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING });
    within(table)
      .getAllByRole("row")
      .slice(1)
      .forEach((row) => expect(within(row).getByText(statusLabel(held))).toBeVisible());
    await user.selectOptions(status, "");
    await waitFor(() => {
      expect(listedOrderNumbers()).toHaveLength(SHOPPER_ORDERS.length);
    });

    // The whole history fits one page, and the control reports exactly that: one current page, nowhere to
    // move to. That is why the rows changing is asserted through the filter rather than by paging forward.
    const pager = screen.getByRole("navigation", { name: A11Y_COPY.PAGINATION_LABEL });
    expect(within(pager).getAllByRole("button", { current: "page" })).toHaveLength(1);
    expect(within(pager).getByRole("button", { name: COMMON_ACTIONS.NEXT })).toBeDisabled();

    // The latest day the shopper ordered on, typed into the pair of bounds the control carries.
    const days = SHOPPER_ORDERS.map((order) => toDateInputValue(order.placedAt)).sort();
    const day = days[days.length - 1];
    const placedThatDay = SHOPPER_ORDERS.filter(
      (order) => toDateInputValue(order.placedAt) === day,
    );
    await user.type(screen.getByLabelText(fieldLabel(DATE_RANGE_COPY.FROM_LABEL)), day);
    await user.type(screen.getByLabelText(fieldLabel(DATE_RANGE_COPY.TO_LABEL)), day);
    await waitFor(() => {
      expect(listedOrderNumbers()).toHaveLength(placedThatDay.length);
    });
    expect([...listedOrderNumbers()].sort()).toEqual(
      placedThatDay.map((order) => order.orderNumber).sort(),
    );
    expect(placedThatDay.length).toBeLessThan(SHOPPER_ORDERS.length);

    // The next read of the customer's own orders is the one the seam refuses.
    failNext({ method: "GET", path: API_PATHS.ORDERS });
    await openSection(user, ACCOUNT_COPY.NAV_PROFILE_LABEL);
    expect(await profileScreen()).toBeVisible();
    await openSection(user, ACCOUNT_COPY.NAV_ORDERS_LABEL);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeVisible();
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_BODY)).toBeVisible();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    await waitFor(() => {
      expect(listedOrderNumbers()).toHaveLength(SHOPPER_ORDERS.length);
    });
  });

  it("manages the address book: a refusal, an add, an edit, defaults and a confirmed removal", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    await registerAndLand(user, uniqueEmail("address"));
    await openSection(user, ACCOUNT_COPY.NAV_ADDRESSES_LABEL);

    // A book holding nothing says so and offers the one action that helps.
    expect(await screen.findByText(EMPTY_STATES.addresses.title)).toBeVisible();
    await user.click(screen.getByRole("button", { name: EMPTY_STATES.addresses.actionLabel }));
    const dialog = await screen.findByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL });

    // Everything but the name is missing, and each missing member is reported on its own control.
    const fullName = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.FULL_NAME_LABEL));
    await user.type(fullName, "Nina Weber");
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));
    const missing = within(dialog).getAllByRole("alert");
    expect(missing).toHaveLength(4);
    missing.forEach((node) => expect(node).toHaveTextContent(VALIDATION_MESSAGES.REQUIRED));
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.CANCEL }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeNull();
    });

    const first = addressDraft("12 Alder Way", "Portland");
    const second = addressDraft("88 Cedar Lane", "Austin");
    const relocated = addressDraft("14 Alder Way", "Portland");
    await addAddress(user, first);
    await addAddress(user, second);

    // The address the dialog was opened on is the one the edit replaces, and the card shows the change.
    await user.click(cardAction(addressCard(first.line1), COMMON_ACTIONS.EDIT));
    const editDialog = await screen.findByRole("dialog", { name: new RegExp(first.line1) });
    const line1 = within(editDialog).getByLabelText(fieldLabel(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL));
    await user.clear(line1);
    await user.type(line1, relocated.line1);
    await user.click(within(editDialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: new RegExp(first.line1) })).toBeNull();
    });
    expect(await screen.findByText(relocated.line1)).toBeVisible();
    expect(screen.queryByText(first.line1)).toBeNull();

    // One default of each kind, and naming another address one moves that flag rather than adding a second.
    await user.click(defaultControl(second.line1, ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL));
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE, second.line1);
    await user.click(defaultControl(second.line1, ACCOUNT_COPY.SET_DEFAULT_BILLING_LABEL));
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_BILLING_BADGE, second.line1);
    await user.click(defaultControl(second.line1, ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL));
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE, second.line1);
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_BILLING_BADGE, second.line1);

    // Removing the address that holds the billing default has to be confirmed first.
    const remove = cardAction(addressCard(second.line1), COMMON_ACTIONS.REMOVE);
    const dialogName = { name: ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE };
    await user.click(remove);
    const confirm = await screen.findByRole("dialog", dialogName);
    expect(confirm.contains(document.activeElement)).toBe(true);
    await user.click(within(confirm).getByRole("button", { name: COMMON_ACTIONS.CANCEL }));

    // A declined confirmation leaves both the card and the focus exactly where they were.
    await waitFor(() => {
      expect(screen.queryByRole("dialog", dialogName)).toBeNull();
    });
    await waitFor(() => {
      expect(remove).toHaveFocus();
    });
    expect(screen.getByText(second.line1)).toBeVisible();

    await user.click(remove);
    const confirmed = await screen.findByRole("dialog", dialogName);
    await user.click(
      within(confirmed).getByRole("button", { name: ACCOUNT_COPY.CONFIRM_REMOVE_ADDRESS_LABEL }),
    );
    await waitFor(() => {
      expect(screen.queryByText(second.line1)).toBeNull();
    });
    // The default the removed address held falls to the address that remains.
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_BILLING_BADGE, relocated.line1);
  });

  it("signs out, sends an account route back to sign-in and drops the account controls", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAs(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    expect(await profileScreen()).toBeVisible();

    await openAccountMenu(user);
    expect(accountPanel()).not.toHaveAttribute("hidden");
    await user.click(within(accountPanel()).getByRole("button", { name: COMMON_ACTIONS.SIGN_OUT }));

    // The session is gone, so the guard over the account area turns the visitor away again.
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
    await openAccountMenu(user);
    const panel = accountPanel();
    expect(within(panel).getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toBeVisible();
    expect(within(panel).queryByRole("button", { name: COMMON_ACTIONS.SIGN_OUT })).toBeNull();
    const accountLink = { name: HEADER_COPY.ACCOUNT_MENU_PROFILE_LABEL };
    expect(within(panel).queryByRole("link", accountLink)).toBeNull();
  });
});
