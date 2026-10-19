/**
 * Path: tests/components/addressBookView.test.tsx
 * Purpose: The branches the address book view owns: the sign-in requirement with no session, the empty book, an address added and one edited, the incomplete address the rule refuses, both save refusals, the default controls in both directions, a refused nomination and removal, a confirmed removal and the book's own retry
 * Lines: 471
 */

import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { ADDRESSES, CUSTOMERS } from "@/data/customers";
import { AddressBookPage } from "@/features/account/AddressBookPage";
import { API_ERROR_CODES } from "@/lib/apiContract";
import { displayName } from "@/lib/customerService";
import type { Address, Customer } from "@/types/account";

import { fieldLabel, descriptionsOfInvalidFields, openSection } from "../helpers/journeyHarness";
import { failNext, renderApp, renderWithProviders, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * The address book's own branches, driven through the real application.
 *
 * The book every case reads belongs to the seeded shopper, whose three addresses hold one default flag each,
 * so the flag a change moves is assertable without a case having to create the book first. Each refusal is
 * armed on the seam's own failure switch and consumed by the request it was armed for, and the case that
 * saves an address places it from the form's own submit event — the path a keyboard takes from a field —
 * rather than from the footer's control. `tests/setup.ts` rebuilds the data source from the frozen seed after
 * every case, so the address a case saves reaches no later case.
 */

// The seeded facts -------------------------------------------------------------------------------

/** The seeded account an email names, or a thrown seed mistake rather than a case that checks less. */
function seededCustomer(email: string): Customer {
  const found = CUSTOMERS.find((customer) => customer.email === email);
  if (found === undefined) throw new Error(`The seeded accounts do not hold "${email}".`);
  return found;
}

/** The account every case signs in as, and the one whose book the cases read. */
const SHOPPER: Customer = seededCustomer(DEMO_ACCOUNTS.CUSTOMER_EMAIL);

/** One address of an account's seeded book, chosen by the default flag it holds. */
function seededAddressOf(customer: Customer, holds: (address: Address) => boolean): Address {
  const found = ADDRESSES.find(
    (address) => customer.addressIds.includes(address.id) && holds(address),
  );
  if (found === undefined) {
    throw new Error(`The seeded book of ${customer.email} holds no address matching the choice.`);
  }
  return found;
}

/** The shopper's three seeded addresses: the two defaults, and the one that holds neither. */
const HOME = seededAddressOf(SHOPPER, (address) => address.isDefaultShipping);
const PARENTS = seededAddressOf(SHOPPER, (address) => address.isDefaultBilling);
const NEITHER = seededAddressOf(
  SHOPPER,
  (address) => !address.isDefaultShipping && !address.isDefaultBilling,
);

/** An address no seeded book holds: one with a second line and a phone, which the seeded books omit. */
const NEW_ADDRESS = {
  line1: "18 Marlow Street",
  line2: "Flat 4",
  city: "Portland",
  region: "OR",
  postalCode: "97205",
  phone: "+1 503 555 0177",
} as const;

// Driving the real screens -----------------------------------------------------------------------

/** Signs in through the real form, clearing the fields first so a remounted screen is not typed onto. */
async function signInAsShopper(user: UserEvent): Promise<void> {
  const address = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
  const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));
  await user.clear(address);
  await user.clear(password);
  await user.type(address, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  await user.type(password, DEMO_ACCOUNTS.PASSWORD);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  expect(await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING })).toBeVisible();
}

/** Signs in as the shopper, opens the address book and waits for the card that proves it rendered. */
async function openAddressBook(user: UserEvent): Promise<void> {
  await signInAsShopper(user);
  await openSection(user, ACCOUNT_COPY.NAV_ADDRESSES_LABEL);
  expect(await screen.findByRole("heading", { name: HOME.label })).toBeVisible();
}

/** One address card, found by the heading it shows: its own label, or its street line and city. */
function addressCard(name: string): HTMLElement {
  const card = screen.getByRole("heading", { name: new RegExp(name) }).closest("li");
  if (card === null) throw new Error(`The address card at "${name}" is not a list item.`);
  return card;
}

/** The one control of a card whose accessible name opens with the action verb and then names the address. */
function cardAction(card: HTMLElement, verb: string): HTMLElement {
  return within(card).getByRole("button", { name: new RegExp(`^${verb}\\b`) });
}

/** The alerts standing outside `scope`: the toast surface is portalled to the body, so this is what a
 *  refusal reported where the customer is looking reaches, as distinct from one reported inside a dialog. */
function alertsOutside(scope: HTMLElement): HTMLElement[] {
  return screen.queryAllByRole("alert").filter((alert) => !scope.contains(alert));
}

/** Opens the address dialog from the section's own action and answers it. */
async function openAddressDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL }));
  return await screen.findByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL });
}

/**
 * The dialog's own form: the region its submit event is raised on. jsdom implements no implicit submission,
 * so a case that needs the path a keyboard takes from a field dispatches the event a browser would raise.
 */
function dialogForm(dialog: HTMLElement): HTMLFormElement {
  const form = dialog.querySelector("form");
  if (form === null) throw new Error("The address dialog renders no form to submit.");
  return form;
}

/** Types the whole of {@link NEW_ADDRESS} into the dialog's fields, in the order the form renders them. */
async function fillAddress(user: UserEvent, dialog: HTMLElement): Promise<void> {
  const fill = async (label: string, value: string): Promise<void> => {
    await user.type(within(dialog).getByLabelText(fieldLabel(label)), value);
  };
  await fill(CHECKOUT_COPY.FULL_NAME_LABEL, displayName(SHOPPER));
  await fill(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL, NEW_ADDRESS.line1);
  await fill(CHECKOUT_COPY.ADDRESS_LINE_2_LABEL, NEW_ADDRESS.line2);
  await fill(CHECKOUT_COPY.CITY_LABEL, NEW_ADDRESS.city);
  await fill(CHECKOUT_COPY.REGION_LABEL, NEW_ADDRESS.region);
  await fill(CHECKOUT_COPY.POSTAL_CODE_LABEL, NEW_ADDRESS.postalCode);
  await fill(CHECKOUT_COPY.PHONE_LABEL, NEW_ADDRESS.phone);
}

/** A telephone number as the account screens print one, which the cards carrying none do not match. */
const PHONE_PATTERN = /\+\d[\d\s()-]{4,}/;

/** An email no seeded account holds and no other case here registers: a duplicate is refused. */
function uniqueEmail(tag: string): string {
  return `nina.weber.${tag}@salespro.test`;
}

/** Registers an account of its own through the real form, so its book is one nothing has been saved to. */
async function registerAccount(user: UserEvent, email: string): Promise<void> {
  await user.type(await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL)), "Nina");
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.LAST_NAME_LABEL)), "Weber");
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), email);
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)), "Shopper1234");
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL }));
  expect(await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING })).toBeVisible();
}

/** Waits for exactly one badge of a kind, and for it to sit on the named card. */
async function expectOneBadge(label: string, on: string): Promise<void> {
  await waitFor(() => {
    expect(within(addressCard(on)).getAllByText(label)).toHaveLength(1);
    expect(screen.getAllByText(label)).toHaveLength(1);
  });
}

describe("the address book view's own branches", () => {
  it("states the sign-in requirement where the address book renders with no session", async () => {
    renderWithProviders(<AddressBookPage />, { route: ROUTES.ACCOUNT });

    // A guarded route sends a visitor away before this shows, so the warning is the last frame of a visitor
    // whose session has gone: it must say why and must not offer an action the book cannot answer.
    expect(await screen.findByText(FEEDBACK_COPY.SIGN_IN_REQUIRED)).toBeVisible();
    expect(screen.queryByRole("button", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeNull();
    expect(screen.queryByRole("heading", { name: HOME.label })).toBeNull();
  });

  it("saves an address with a second line and a phone, taken from the form's own submit event", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    const dialog = await openAddressDialog(user);
    await fillAddress(user, dialog);

    // The form is placed by its own submit event — the path a keyboard takes from a field — rather than by
    // the footer's control, which calls the same save directly.
    fireEvent.submit(dialogForm(dialog));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeNull();
    });
    // The two optional members the seeded books omit appear on the card that was saved.
    await screen.findByText(NEW_ADDRESS.line1);
    const card = addressCard(NEW_ADDRESS.line1);
    expect(within(card).getByText(NEW_ADDRESS.line2)).toBeVisible();
    expect(within(card).getByText(NEW_ADDRESS.phone)).toBeVisible();
  });

  it("files a refused save on the control the store named, and states one that names none in the dialog", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    await fillAddress(user, await openAddressDialog(user));
    const dialog = screen.getByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL });

    // A refusal naming a control is attached to it, the keyboard follows it there, and nothing is stated
    // as a whole-form failure.
    const named = "That postal code is outside the delivery area.";
    failNext({
      routeId: "addresses.create",
      status: 422,
      code: API_ERROR_CODES.VALIDATION_FAILED,
      field: "postalCode",
      message: named,
    });
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));

    const message = await within(dialog).findByText(named);
    const postal = within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.POSTAL_CODE_LABEL));
    expect(postal).toHaveAttribute("aria-invalid", "true");
    expect(postal.getAttribute("aria-describedby")).toContain(message.id);
    expect(postal).toHaveFocus();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(alertsOutside(dialog)).toHaveLength(0);

    // A refusal naming no control has nowhere to sit in the form, so the dialog states it and the toast
    // beside it reports it where the customer is looking; the book is left exactly as it was.
    const wholeForm = "The address book service is not answering.";
    failNext({ routeId: "addresses.create", message: wholeForm });
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));

    const alert = await within(dialog).findByRole("alert");
    expect(within(alert).getByText(wholeForm)).toBeVisible();
    await waitFor(() => {
      expect(alertsOutside(dialog)).toHaveLength(1);
    });
    expect(screen.getByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeVisible();
    expect(screen.queryByText(NEW_ADDRESS.line1)).toBeNull();
  });

  it("keeps the default flags when a set-default control is turned off", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    const card = addressCard(PARENTS.label);
    const billing = within(card).getByLabelText(ACCOUNT_COPY.SET_DEFAULT_BILLING_LABEL);
    expect(billing).toBeChecked();

    await user.click(billing);

    // The endpoint nominates an address for one kind and never clears one, so the control stands checked,
    // the address keeps the flag it held and no request is made for it.
    expect(billing).toBeChecked();
    expect(within(card).getAllByText(ACCOUNT_COPY.DEFAULT_BILLING_BADGE)).toHaveLength(1);
    expect(screen.getAllByText(ACCOUNT_COPY.DEFAULT_BILLING_BADGE)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a refused nomination and a refused removal without changing the book", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    const card = addressCard(NEITHER.label);

    const nominationRefusal = "The nomination could not be recorded.";
    failNext({ routeId: "addresses.setDefault", message: nominationRefusal });
    await user.click(within(card).getByLabelText(ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL));

    // The toggle is disabled for the request, so the outcome is reported where the customer is looking and
    // the flag it asked for is not marked — the one the book already holds stays where it was.
    expect(await screen.findByText(nominationRefusal)).toBeVisible();
    expect(within(card).queryByText(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE)).toBeNull();
    expect(
      within(addressCard(HOME.label)).getAllByText(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE),
    ).toHaveLength(1);

    const removalRefusal = "The address could not be removed.";
    failNext({ routeId: "addresses.remove", message: removalRefusal });
    await user.click(cardAction(card, COMMON_ACTIONS.REMOVE));
    const confirm = await screen.findByRole("dialog", {
      name: ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE,
    });
    await user.click(
      within(confirm).getByRole("button", { name: ACCOUNT_COPY.CONFIRM_REMOVE_ADDRESS_LABEL }),
    );

    // The confirmation stands while the removal did not happen, the outcome is reported where the customer
    // is looking, and the card is exactly where it was once the dialog is declined.
    expect(await screen.findByText(removalRefusal)).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE }),
    ).toBeVisible();
    await user.click(within(confirm).getByRole("button", { name: COMMON_ACTIONS.CANCEL }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE }),
      ).toBeNull();
    });
    expect(screen.getByRole("heading", { name: NEITHER.label })).toBeVisible();
  });

  it("refuses an address the rules cannot accept without asking the store", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    const dialog = await openAddressDialog(user);

    // Nothing but the country is filled, so the shared address rule refuses before anything is sent: each
    // missing member is reported on its own control, and no form-wide notice is raised for a refusal the
    // fields already carry.
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));

    const missing = descriptionsOfInvalidFields(dialog);
    expect(missing).toHaveLength(5);
    missing.forEach((description) => expect(description).toContain(VALIDATION_MESSAGES.REQUIRED));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    // The dialog stands with the refusal in it, and the book behind it is untouched.
    expect(screen.getByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeVisible();
    expect(screen.queryByText(NEW_ADDRESS.line1)).toBeNull();
  });

  it("edits a saved address, then moves each default and leaves a checked control alone", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    const relocated = "165B Beacon Street";

    // The card's own action opens the dialog on the address it names, and the heading says which one it is.
    await user.click(cardAction(addressCard(NEITHER.label), COMMON_ACTIONS.EDIT));
    const editing = await screen.findByRole("dialog", {
      name: new RegExp(`^${COMMON_ACTIONS.EDIT} ${NEITHER.label}`),
    });
    const line1 = within(editing).getByLabelText(fieldLabel(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL));
    expect(line1).toHaveValue(NEITHER.line1);
    await user.clear(line1);
    await user.type(line1, relocated);
    await user.click(within(editing).getByRole("button", { name: COMMON_ACTIONS.SAVE }));

    // The edit replaced the address it was opened on, so the card shows the changed street under the label
    // it already carried.
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: new RegExp(NEITHER.label) })).toBeNull();
    });
    await screen.findByText(relocated);
    expect(within(addressCard(NEITHER.label)).getByText(relocated)).toBeVisible();
    expect(screen.queryByText(NEITHER.line1)).toBeNull();

    // A default moves to the address whose control was turned on, and then stays where a second turn off
    // the control cannot move it: the endpoint nominates and never clears.
    await user.click(
      within(addressCard(NEITHER.label)).getByLabelText(ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL),
    );
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE, NEITHER.label);
    await user.click(
      within(addressCard(NEITHER.label)).getByLabelText(ACCOUNT_COPY.SET_DEFAULT_SHIPPING_LABEL),
    );
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_SHIPPING_BADGE, NEITHER.label);

    await user.click(
      within(addressCard(HOME.label)).getByLabelText(ACCOUNT_COPY.SET_DEFAULT_BILLING_LABEL),
    );
    await expectOneBadge(ACCOUNT_COPY.DEFAULT_BILLING_BADGE, HOME.label);
  });

  it("shows an account's empty book and saves its first address from the fields it needs", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    await registerAccount(user, uniqueEmail("first-address"));
    await openSection(user, ACCOUNT_COPY.NAV_ADDRESSES_LABEL);

    // A book holding nothing is the empty state's own case, and it is the one control offering the action
    // then: the section withholds its own, so the same action is not offered twice.
    const emptyState = (await screen.findByText(EMPTY_STATES.addresses.title)).closest(
      '[role="status"]',
    );
    if (!(emptyState instanceof HTMLElement)) {
      throw new Error("The empty state is not the live region it renders as.");
    }
    expect(
      within(emptyState).getByRole("button", { name: EMPTY_STATES.addresses.actionLabel }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: EMPTY_STATES.addresses.actionLabel }),
    ).toHaveLength(1);
    await user.click(
      within(emptyState).getByRole("button", { name: EMPTY_STATES.addresses.actionLabel }),
    );

    // The required members alone: the two lines the form treats as optional are left empty, and the card
    // that results states no number and no second street line.
    const dialog = await screen.findByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL });
    await user.type(
      within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.FULL_NAME_LABEL)),
      displayName(SHOPPER),
    );
    await user.type(
      within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL)),
      NEW_ADDRESS.line1,
    );
    await user.type(
      within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.CITY_LABEL)),
      NEW_ADDRESS.city,
    );
    await user.type(
      within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.REGION_LABEL)),
      NEW_ADDRESS.region,
    );
    await user.type(
      within(dialog).getByLabelText(fieldLabel(CHECKOUT_COPY.POSTAL_CODE_LABEL)),
      NEW_ADDRESS.postalCode,
    );
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: ACCOUNT_COPY.ADD_ADDRESS_LABEL })).toBeNull();
    });
    await screen.findByText(NEW_ADDRESS.line1);
    const card = addressCard(NEW_ADDRESS.line1);
    expect(
      within(card).getByText(
        `${NEW_ADDRESS.city}, ${NEW_ADDRESS.region} ${NEW_ADDRESS.postalCode}`,
      ),
    ).toBeVisible();
    expect(within(card).queryByText(PHONE_PATTERN)).toBeNull();
    expect(within(card).queryByText(NEW_ADDRESS.line2)).toBeNull();
  });

  it("removes an address on its confirmation and hands the keyboard back to the section", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await openAddressBook(user);
    const card = addressCard(NEITHER.label);

    await user.click(cardAction(card, COMMON_ACTIONS.REMOVE));
    const confirm = await screen.findByRole("dialog", {
      name: ACCOUNT_COPY.REMOVE_ADDRESS_DIALOG_TITLE,
    });
    await user.click(
      within(confirm).getByRole("button", { name: ACCOUNT_COPY.CONFIRM_REMOVE_ADDRESS_LABEL }),
    );

    // The card leaves with the confirmation, and the keyboard lands on the section that survives it rather
    // than on the document body, which is where the control it was on would otherwise drop it.
    expect(await screen.findByText(FEEDBACK_COPY.TOAST_ADDRESS_REMOVED)).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByText(NEITHER.line1)).toBeNull();
    });
    expect(screen.getByRole("heading", { name: ACCOUNT_COPY.ADDRESS_BOOK_HEADING })).toHaveFocus();
    expect(screen.getByRole("heading", { name: HOME.label })).toBeVisible();
  });

  it("offers the book's retry when the store cannot answer, and lists it once the read is answered", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);

    failNext({ routeId: "addresses.list" });
    await openSection(user, ACCOUNT_COPY.NAV_ADDRESSES_LABEL);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeVisible();
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_BODY)).toBeVisible();
    expect(screen.queryByRole("heading", { name: HOME.label })).toBeNull();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(await screen.findByRole("heading", { name: HOME.label })).toBeVisible();
    expect(screen.getByRole("heading", { name: PARENTS.label })).toBeVisible();
  });
});
