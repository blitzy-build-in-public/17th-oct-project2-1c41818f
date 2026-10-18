/**
 * Path: tests/integration/accountAddressBook.test.tsx
 * Purpose: The address book's own flow: a refused save, two adds, an edit, both default flags and a
 * confirmed removal.
 * Lines: 248
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  VALIDATION_MESSAGES,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";

import { renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * Why the address book is a suite of its own.
 *
 * Its case drives the dialog's refusal, two adds, an edit, both default flags and a confirmed removal, and it
 * needs readers no other account case uses: the card, the action on it, its default control and the save that
 * waits for the book to be re-read. A concern that cannot fit under the 600-line ceiling is split into a second
 * file rather than the ceiling raised (§0.5.1, §0.5.5), and a split suite carries the helpers it needs itself,
 * as `tests/unit/lib/pricingSurface.test.ts` records of its own copies: nothing here is imported from
 * `tests/integration/accountFlow.test.tsx`, which keeps the rest of the account flow.
 */

// Driving the address book ------------------------------------------------------------------------

/** The pattern a field's label is found by: a required field's label continues past its copy with its
 *  marker, so its whole text is never the copy alone. */
function fieldLabel(label: string): RegExp {
  return new RegExp(`^${label}`);
}

/** The description each of a scope's invalid controls is read by: the text of the ids its own
 *  `aria-describedby` names, joined in the order they are read, and empty when it names none. */
function descriptionsOfInvalidFields(scope: ParentNode): readonly string[] {
  return [...scope.querySelectorAll('[aria-invalid="true"]')].map((control) =>
    (control.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

const NEW_ACCOUNT = { firstName: "Nina", lastName: "Weber", password: DEMO_ACCOUNTS.PASSWORD };

/** An address no seeded account holds, unique within the run because a registration stays in the store. */
function uniqueEmail(tag: string): string {
  return `nina.weber.${tag}@salespro.test`;
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

/** The profile's own heading, waited for: a case that lands in the account area has arrived by it. */
function profileScreen(): Promise<HTMLElement> {
  return screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
}

async function openSection(user: UserEvent, label: string): Promise<void> {
  await user.click(await screen.findByRole("link", { name: label }));
}

// Reading an address card -------------------------------------------------------------------------

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

describe("the account address book", () => {
  beforeEach(() => {
    resetApiState();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const addressLine1 = within(dialog).getByLabelText(
      fieldLabel(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL),
    );
    await user.type(fullName, "Nina Weber");
    await user.click(within(dialog).getByRole("button", { name: COMMON_ACTIONS.SAVE }));
    const missing = descriptionsOfInvalidFields(dialog);
    expect(missing).toHaveLength(4);
    missing.forEach((description) => expect(description).toContain(VALIDATION_MESSAGES.REQUIRED));
    // The save's refusal names no form whole, so the keyboard lands on the first control it refused.
    expect(addressLine1).toHaveFocus();
    // Correcting one field of that standing refusal leaves the keyboard in the field: the refusal is the
    // same one, so it claims nothing a second time.
    await user.type(addressLine1, "12 Alder Way");
    expect(addressLine1).toHaveFocus();
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
});
