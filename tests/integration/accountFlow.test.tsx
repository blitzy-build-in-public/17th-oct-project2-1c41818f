/**
 * Path: tests/integration/accountFlow.test.tsx
 * Purpose: Sign-in, profile edit, order history and the address book, plus the unauthenticated redirect.
 * Lines: 599
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_ACCESS_COPY,
  ACCOUNT_COPY,
  A11Y_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  HEADER_COPY,
  PAGE_TITLES,
  VALIDATION_MESSAGES,
  documentTitle,
} from "@/constants/content";
import { DATE_RANGE_COPY, REPORTS_COPY } from "@/constants/content-reports";
import { ROUTES, accountOrderPath, loginPath } from "@/constants/routes";
import { ORDER_STATUS_OPTIONS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { CUSTOMERS } from "@/data/customers";
import { ORDERS } from "@/data/orders";
import { API_PATHS } from "@/lib/mockServer";
import type { Customer } from "@/types/account";
import type { Order, OrderStatus } from "@/types/commerce";
import type { MinorUnits } from "@/types/common";
import { toDateInputValue } from "@/utils/dates";
import { formatMoney, parseMoneyToMinor } from "@/utils/format";

import { descriptionsOfInvalidFields, fieldLabel, openSection } from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * Each case's facts come from the module that owns them — `DEMO_ACCOUNTS`, the seeded records, the copy library,
 * `ROUTES` — and its only lever on the product is `failNext`, the API seam's own failure switch. `tests/setup.ts`
 * clears the durable record and re-binds a store from the frozen seed after every case, so no case's write reaches
 * a later one: a case signs in with a seeded account or registers its own, never editing the shopper's record.
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

/** An address no seeded account holds, and no other address this file registers: a duplicate is refused. */
function uniqueEmail(tag: string): string {
  return `nina.weber.${tag}@salespro.test`;
}

// Driving the real forms --------------------------------------------------------------------------

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

/** One address card, found by the street line its own heading shows. */
function addressCard(line1: string): HTMLElement {
  const card = screen.getByRole("heading", { name: new RegExp(line1) }).closest("li");
  if (card === null) throw new Error(`The address card at "${line1}" is not a list item.`);
  return card;
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

    // A wrong password is refused with one sentence that names neither member and marks neither control: pointing at one would tell a stranger which addresses have accounts.
    const email = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));
    await user.type(email, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    await user.type(password, `${DEMO_ACCOUNTS.PASSWORD}x`);
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE)).toBeVisible();
    // The refusal names no field, so the keyboard goes to the alert that states it rather than to a control.
    expect((await screen.findByRole("alert")).parentElement).toHaveFocus();
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(password).not.toHaveAttribute("aria-invalid", "true");

    // Signing in from the screen the guard sent the visitor to lands on the path they asked for.
    await user.clear(password);
    await user.type(password, DEMO_ACCOUNTS.PASSWORD);
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
    expect(await listedTable()).toBeVisible();
  });

  it("marks a malformed sign-in address at its own field, and keeps the credential refusal generic", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    const email = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));

    // The address's shape is judged where it was typed, in the shared validator's own words, and linked to the control rather than only reported above the form.
    await user.type(email, "not-an-email");
    await user.type(password, DEMO_ACCOUNTS.PASSWORD);
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
    const shape = await screen.findByText(VALIDATION_MESSAGES.EMAIL_FORMAT);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toContain(shape.id);
    expect(screen.queryByText(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE)).toBeNull();

    // An address that is well formed but names no account is the refusal the generic sentence covers, and it still marks neither control: pointing at one would tell a stranger where accounts are.
    await user.clear(email);
    await user.type(email, "stranger@salespro.test");
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE)).toBeVisible();
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(password).not.toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the tab title on the route, and continues a signed-in visitor to a path they can reach", async () => {
    const signedIn = renderApp({ route: ROUTES.LOGIN });
    await signInAs(signedIn.user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    expect(await profileScreen()).toBeVisible();
    signedIn.unmount();

    // The sign-in route again, with the session in storage and an account path in hand: that path is one this
    // customer can open so it stays the destination, and the tab names the route because the bar still says `/login`.
    const returning = renderApp({ route: loginPath(ROUTES.ACCOUNT_ORDERS) });
    const continuation = await screen.findByRole("link", { name: COMMON_ACTIONS.CONTINUE });
    expect(continuation).toHaveAttribute("href", ROUTES.ACCOUNT_ORDERS);
    await waitFor(() => {
      expect(document.title).toBe(documentTitle(PAGE_TITLES.SIGN_IN));
    });
    await returning.user.click(continuation);
    expect(await listedTable()).toBeVisible();
  });

  it("refuses a signed-in customer the privileged route, and offers a way out of it", async () => {
    const signedIn = renderApp({ route: ROUTES.LOGIN });
    await signInAs(signedIn.user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    expect(await profileScreen()).toBeVisible();
    signedIn.unmount();

    // The privileged route with the customer's session in storage: the guard refuses in place, at the address
    // that was asked for — `/admin` stays in the bar while this refusal is what it draws, reload included.
    const refused = renderApp({ route: ROUTES.ADMIN });
    expect(
      await screen.findByRole("heading", { name: ACCOUNT_ACCESS_COPY.HEADING, level: 1 }),
    ).toBeVisible();
    expect(screen.getByText(ACCOUNT_ACCESS_COPY.BODY)).toBeVisible();
    expect(screen.queryByRole("heading", { name: PAGE_TITLES.DASHBOARD, level: 1 })).toBeNull();
    await waitFor(() => {
      expect(document.title).toBe(documentTitle(ACCOUNT_ACCESS_COPY.HEADING));
    });

    // The screen is the refusal's, not the sign-in route's. `MemoryRouter` writes no `window.location`, so what
    // stands in for the bar is that the sign-in screen is absent — which the old redirect would have drawn instead.
    expect(screen.queryByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeNull();
    expect(screen.queryByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL))).toBeNull();

    // Nothing here leads back in, so the refusal cannot be walked in a circle: the way on is the account this role holds.
    expect(screen.queryByRole("link", { name: COMMON_ACTIONS.CONTINUE })).toBeNull();
    expect(screen.getByRole("link", { name: ACCOUNT_ACCESS_COPY.CONTINUE_LABEL })).toHaveAttribute(
      "href",
      ROUTES.ACCOUNT,
    );
    await refused.user.click(screen.getByRole("button", { name: COMMON_ACTIONS.SIGN_OUT }));
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
  });

  it("refuses a preserved path that carries a query string as well as its route", async () => {
    const signedIn = renderApp({ route: ROUTES.LOGIN });
    await signInAs(signedIn.user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    expect(await profileScreen()).toBeVisible();
    signedIn.unmount();

    // The guard refuses at the address that was asked for, search string and all, instead of handing the path
    // over to another route: `/admin/reports?bucket=week` is where this refusal is rendered.
    renderApp({ route: `${ROUTES.ADMIN_REPORTS}?bucket=week` });
    expect(
      await screen.findByRole("heading", { name: ACCOUNT_ACCESS_COPY.HEADING, level: 1 }),
    ).toBeVisible();
    expect(screen.queryByRole("tablist", { name: REPORTS_COPY.SELECTOR_LABEL })).toBeNull();
  });

  it("judges the registration form and refuses an address that already has an account", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    const submit = await screen.findByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL });
    const email = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));

    // The four judged fields each report through the description its control names; the consent switch carries no rule and reports none.
    await user.click(submit);
    const missing = descriptionsOfInvalidFields(document.body);
    expect(missing).toHaveLength(4);
    missing.forEach((description) => expect(description).toContain(VALIDATION_MESSAGES.REQUIRED));
    // The first control the rule refused is where the keyboard lands, before the fields the rule accepted.
    expect(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL))).toHaveFocus();
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

  it("saves an address, marks it the default shipping one and removes it again", async () => {
    const line1 = "12 Alder Way";
    const { user } = renderApp({ route: ROUTES.REGISTER });
    await registerAndLand(user, uniqueEmail("addresses"));
    await openSection(user, ACCOUNT_COPY.NAV_ADDRESSES_LABEL);
    expect(await screen.findByText(EMPTY_STATES.addresses.title)).toBeVisible();

    // The empty state's own action opens the dialog, and the labels the checkout copy owns fill its fields.
    await user.click(screen.getByRole("button", { name: EMPTY_STATES.addresses.actionLabel }));
    const dialog = await screen.findByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL });
    const fill = (label: string): HTMLElement => within(dialog).getByLabelText(fieldLabel(label));
    await user.type(fill(CHECKOUT_COPY.FULL_NAME_LABEL), "Nina Weber");
    await user.type(fill(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL), line1);
    await user.type(fill(CHECKOUT_COPY.CITY_LABEL), "Portland");
    await user.type(fill(CHECKOUT_COPY.REGION_LABEL), "OR");
    await user.type(fill(CHECKOUT_COPY.POSTAL_CODE_LABEL), "97205");
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));

    // The book is re-read after a save, so the card the dialog leaves behind is awaited; that card then carries the shipping flag and exactly one badge of that kind.
    expect(await screen.findByText(line1)).toBeVisible();
    const card = addressCard(line1);
    await user.click(within(card).getByLabelText(ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL));
    await waitFor(() =>
      expect(within(card).getAllByText(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE)).toHaveLength(1),
    );

    // The removal is the dialog's own confirmation, and the book states its empty state again once the card has gone.
    const remove = new RegExp(`^${COMMON_ACTIONS.REMOVE}\\b`);
    await user.click(within(card).getByRole("button", { name: remove }));
    const confirm = await screen.findByRole("dialog", {
      name: ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE,
    });
    await user.click(
      within(confirm).getByRole("button", { name: ACCOUNT_COPY.CONFIRM_REMOVE_ADDRESS_LABEL }),
    );
    await waitFor(() => expect(screen.queryByText(line1)).toBeNull());
    expect(screen.getByText(EMPTY_STATES.addresses.title)).toBeVisible();
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

    // Every line the order was placed with, at the price it was placed at: the priced cart the order keeps,
    // whose own line subtotal is the goods value each row prints, and whose name, sku, quantity and price are the row's.
    const items = sectionFor(ACCOUNT_COPY.ORDER_DETAIL_ITEMS_HEADING);
    const lines = within(items).getAllByRole("listitem");
    const priced = order.pricedCart.lines;
    expect(lines).toHaveLength(priced.length);
    const printedAmounts: MinorUnits[] = priced.map((line, index) => {
      expect(within(lines[index]).getByText(line.name)).toBeVisible();
      const goods = formatMoney(line.lineSubtotalMinor, order.pricedCart.currency);
      expect(within(lines[index]).getByText(goods)).toBeVisible();
      const amountCell = lines[index].lastElementChild;
      if (amountCell === null) throw new Error("An itemised row prints no amount.");
      return parseMoneyToMinor(amountCell.textContent);
    });

    // What the screen shows reconciles with itself as well as with the record behind it: the rows' goods values
    // sum to the Subtotal row, so the promotion lands once, in the signed discount row read by magnitude here.
    const subtotal = displayedAmount(items, CART_COPY.SUMMARY_SUBTOTAL_LABEL);
    const shipping = displayedAmount(items, CART_COPY.SUMMARY_SHIPPING_LABEL);
    const tax = displayedAmount(items, CART_COPY.SUMMARY_TAX_LABEL);
    const total = displayedAmount(items, CART_COPY.SUMMARY_TOTAL_LABEL);
    const discount = within(items).queryByText(CART_COPY.SUMMARY_DISCOUNT_LABEL)
      ? displayedAmount(items, CART_COPY.SUMMARY_DISCOUNT_LABEL)
      : 0;
    expect(subtotal).toBe(order.pricedCart.subtotalMinor);
    expect(total).toBe(order.pricedCart.grandTotalMinor);
    expect(printedAmounts).toEqual(priced.map((line) => line.lineSubtotalMinor));
    expect(printedAmounts.reduce((sum, amount) => sum + amount, 0)).toBe(subtotal);
    expect(subtotal - discount + shipping + tax).toBe(total);

    // Both addresses the order was placed with read the country's name, never the code the address stores, which is how the review step and the address book read theirs.
    const addresses = sectionFor(ACCOUNT_COPY.ORDER_DETAIL_ADDRESS_HEADING).parentElement;
    if (addresses === null)
      throw new Error("The order detail's address blocks have no shared frame.");
    const placedWith = [order.shippingAddress, order.billingAddress];
    const blocks = within(addresses).getAllByRole("heading", { level: 3 });
    expect(blocks).toHaveLength(placedWith.length);
    placedWith.forEach((address, index) => {
      const country = SUPPORTED_COUNTRIES.find((entry) => entry.code === address.country);
      if (country === undefined) {
        throw new Error(
          `The order names a country the configured list does not hold: ${address.country}`,
        );
      }
      // The claim can fail: the name the product declares for the code is not the code the address stores.
      expect(country.label).not.toBe(country.code);
      const block = blocks[index].parentElement;
      if (block === null) throw new Error("An address block has no frame.");
      expect(within(block).getByText(country.label)).toBeVisible();
      expect(within(block).queryByText(country.code)).toBeNull();
    });

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

    // The shopper's history is kept clear of cancellation by the seed, so this filter legitimately matches nothing and reaches the filtered empty state rather than the account's own.
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

    // The whole history fits one page, which is why the rows changing is asserted through the filter, not paging.
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

  it("answers another account's order with the way back rather than a retry that cannot", async () => {
    // A record this session holds no readable copy of: the seam answers it `404`, exactly as it answers an identifier no order carries, so asking for it again cannot produce the order.
    const foreign = ORDERS.find(
      (order) => order.customerId !== null && order.customerId !== SHOPPER.id,
    );
    if (foreign === undefined) throw new Error("The seed holds no other account's order.");
    const { user } = renderApp({ route: accountOrderPath(foreign.id) });
    await signInAs(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(within(failure).queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    const back = screen.getByRole("link", { name: ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL });
    expect(back.getAttribute("href")).toBe(ROUTES.ACCOUNT_ORDERS);
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
