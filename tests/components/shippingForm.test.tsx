/**
 * Path: tests/components/shippingForm.test.tsx
 * Purpose: The shipping step's own branches, driven through the real application: the visitor whose account holds no book, the delivery rows' windows and charges, the refused advance, the seeded customer's address seeding and adoption, the empty book with its action, the two read failures with their retries, and the step's own controls
 * Lines: 396
 */

import { beforeEach, describe, expect, it } from "vitest";

import { CHECKOUT_COPY, CHECKOUT_STEP_TITLES, transitWindowLabel } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS, FREE_SHIPPING_THRESHOLD_MINOR, SHIPPING_METHODS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  cartButtonLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { ADDRESSES, CUSTOMERS } from "@/data/customers";
import { addressLabel } from "@/lib/customerService";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import type { Address, Customer } from "@/types/account";
import type { ShippingMethod } from "@/types/commerce";
import { formatMoney } from "@/utils/format";

import {
  CHOSEN_METHOD,
  addItemToCart,
  advanceTo,
  field,
  fillShippingAddress,
} from "../helpers/checkoutHarness";
import { fieldLabel, summaryFigures, summaryPanel, textOf } from "../helpers/journeyHarness";
import { failNext, renderApp, resetApiState, screen, within } from "../testUtils";
import type { RenderHarness, UserEvent } from "../testUtils";

/*
 * The real application throughout, answered by the real seeded data and priced by the real service: every
 * case walks the storefront into a one-item basket and drives the checkout by its own controls, so what is
 * asserted is what a shopper is shown rather than what a module computes. A read that could not be answered
 * is reached by arming the seam's own failure switch; an empty book is reached by an account that legitimately
 * holds none, registered through the real form, which is the one way a customer with no saved address exists.
 */

// The seeded facts -------------------------------------------------------------------------------

/** The account every signed-in case walks as, and the book whose addresses the picker reads. */
const SHOPPER = seededCustomer(DEMO_ACCOUNTS.CUSTOMER_EMAIL);

/** One seeded account by its address, or a thrown seed mistake rather than a case that checks less. */
function seededCustomer(email: string): Customer {
  const found = CUSTOMERS.find((customer) => customer.email === email);
  if (found === undefined) throw new Error(`The seeded accounts do not hold "${email}".`);
  return found;
}

/** One address of a customer's seeded book, chosen by the flag it holds. */
function seededAddressOf(customer: Customer, holds: (address: Address) => boolean): Address {
  const found = ADDRESSES.find(
    (address) => customer.addressIds.includes(address.id) && holds(address),
  );
  if (found === undefined) {
    throw new Error(`The seeded book of ${customer.email} holds no address matching the choice.`);
  }
  return found;
}

/** The address the book flags for shipping, which the step opens on, and another entry of the same book,
 *  which is what the picker is used to adopt. */
const SHIPPING_DEFAULT = seededAddressOf(SHOPPER, (address) => address.isDefaultShipping);
const ANOTHER_ADDRESS = seededAddressOf(
  SHOPPER,
  (address) => !address.isDefaultShipping && address.isDefaultBilling,
);

/** A registration address no seeded account holds; its domain is the seeded customer's own. */
const NEW_ACCOUNT_EMAIL = `checkout.steps.probe@${DEMO_ACCOUNTS.CUSTOMER_EMAIL.split("@")[1]}`;

/** The text members a saved address writes into the form, each read back through the control it binds to. */
type AddressTextMember =
  | "fullName"
  | "line1"
  | "line2"
  | "city"
  | "region"
  | "postalCode"
  | "phone";

/** The members a saved address writes into the form, each read back through the control that holds it. */
const HELD_MEMBERS: readonly (readonly [string, AddressTextMember])[] = [
  [CHECKOUT_COPY.FULL_NAME_LABEL, "fullName"],
  [CHECKOUT_COPY.ADDRESS_LINE_1_LABEL, "line1"],
  [CHECKOUT_COPY.ADDRESS_LINE_2_LABEL, "line2"],
  [CHECKOUT_COPY.CITY_LABEL, "city"],
  [CHECKOUT_COPY.REGION_LABEL, "region"],
  [CHECKOUT_COPY.POSTAL_CODE_LABEL, "postalCode"],
  [CHECKOUT_COPY.PHONE_LABEL, "phone"],
];

// Driving the real screens -----------------------------------------------------------------------

/** Fills the sign-in form and submits it, waiting for the account screen the store lands the visitor on. */
async function signIn(user: UserEvent): Promise<void> {
  const email = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
  await user.type(email, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  await user.type(
    screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)),
    DEMO_ACCOUNTS.PASSWORD,
  );
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
}

/** Registers an account of its own through the real form, which opens a session with it. */
async function register(user: UserEvent): Promise<void> {
  const first = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL));
  await user.type(first, "Cadence");
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.LAST_NAME_LABEL)), "Reed");
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), NEW_ACCOUNT_EMAIL);
  await user.type(
    screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)),
    DEMO_ACCOUNTS.PASSWORD,
  );
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL }));
  await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
}

/**
 * Opens the application as the seeded customer: the real sign-in form opens the session, and the storefront
 * is then reopened at the catalogue with that stored session, which is the application a returning customer
 * finds. Reopening rather than navigating keeps the case on the storefront a checkout is reached from.
 */
async function openAsShopper(): Promise<RenderHarness> {
  const signInPage = renderApp({ route: ROUTES.LOGIN });
  await signIn(signInPage.user);
  signInPage.unmount();
  return renderApp({ route: ROUTES.CATALOG });
}

/** Opens the application as a freshly registered customer, whose address book holds nothing yet. */
async function openAsNewAccount(): Promise<RenderHarness> {
  const registerPage = renderApp({ route: ROUTES.REGISTER });
  await register(registerPage.user);
  registerPage.unmount();
  return renderApp({ route: ROUTES.CATALOG });
}

/** Walks the catalogue into a one-item basket and lands on the shipping step of the checkout. */
async function openShippingStep(user: UserEvent): Promise<void> {
  await addItemToCart(user, { cheapest: true });
  await user.click(screen.getByRole("button", { name: cartButtonLabel(1) }));
  await user.click(await screen.findByRole("link", { name: CART_COPY.MINI_CART_VIEW_CART_LABEL }));
  await screen.findByRole("heading", { name: CART_COPY.PAGE_HEADING });
  await user.click(screen.getByRole("link", { name: CART_COPY.PROCEED_TO_CHECKOUT_LABEL }));
  await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
}

/** Chooses the delivery method whose own radio answers to `name`, and returns that radio. */
async function chooseMethod(user: UserEvent, name: string): Promise<HTMLElement> {
  const radio = await screen.findByRole("radio", { name: new RegExp(name) });
  await user.click(radio);
  return radio;
}

/** One delivery row's own label, found by the radio it belongs to, or a thrown step mistake. */
function methodRow(radio: HTMLElement): HTMLElement {
  const row = radio.closest("label");
  if (row === null) throw new Error("A delivery row rendered outside its own label.");
  return row;
}

/** The radio one saved address is offered under, named by the label its option restates. */
async function savedAddressRadio(address: Address): Promise<HTMLElement> {
  return await screen.findByRole("radio", { name: new RegExp(addressLabel(address)) });
}

/** Asserts every member the form holds is the one the address named. */
function expectAddressHeld(address: Address): void {
  for (const [label, member] of HELD_MEMBERS) {
    expect(field(label)).toHaveValue(address[member]);
  }
  expect(field(CHECKOUT_COPY.COUNTRY_LABEL)).toHaveValue(address.country);
}

beforeEach(resetApiState);

describe("the shipping step a visitor is shown", () => {
  it("takes an address the visitor types, offering no book and the way back to the cart", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await openShippingStep(user);

    // No book is read for a visitor, so the picker's own legend is nowhere on the step, the first
    // configured country is seeded into the closed list, and the return control names the cart.
    expect(screen.queryByText(CHECKOUT_COPY.SAVED_ADDRESS_LABEL)).toBeNull();
    expect(field(CHECKOUT_COPY.COUNTRY_LABEL)).toHaveValue(SUPPORTED_COUNTRIES[0].code);
    expect(screen.getByRole("link", { name: CHECKOUT_COPY.BACK_TO_CART_LABEL })).toHaveAttribute(
      "href",
      ROUTES.CART,
    );

    // The two optional members the harness leaves empty are typed here, so both write through.
    await user.type(field(CHECKOUT_COPY.ADDRESS_LINE_2_LABEL), "Apartment 4B");
    await user.type(field(CHECKOUT_COPY.PHONE_LABEL), "+1 617 555 0134");
    expect(field(CHECKOUT_COPY.ADDRESS_LINE_2_LABEL)).toHaveValue("Apartment 4B");
    expect(field(CHECKOUT_COPY.PHONE_LABEL)).toHaveValue("+1 617 555 0134");

    // The step is left by its own submit control once the flow's rules are answered.
    await fillShippingAddress(user);
    await chooseMethod(user, CHOSEN_METHOD.name);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );
  });

  it.each([...SHIPPING_METHODS])(
    "states what $name does, its window and what this basket pays for it",
    async (method: ShippingMethod) => {
      const { user } = renderApp({ route: ROUTES.CATALOG });
      await openShippingStep(user);

      // The basket the cheapest offer makes is short of the threshold, so no waiver applies and every row
      // states that method's own charge beside its description and the window it covers.
      const figures = await summaryFigures(summaryPanel());
      expect(figures.subtotal).toBeLessThan(FREE_SHIPPING_THRESHOLD_MINOR);

      const radio = await screen.findByRole("radio", { name: new RegExp(method.name) });
      const window = transitWindowLabel(method.minDays, method.maxDays);
      const charge =
        method.priceMinor === 0
          ? CHECKOUT_COPY.FREE_DELIVERY_CHARGE_LABEL
          : formatMoney(method.priceMinor);
      const stated = [method.name, method.description, window, charge].filter(
        (part) => part.length > 0,
      );
      expect(textOf(methodRow(radio))).toBe(stated.join(" · "));

      // Choosing the row is what marks it as the chosen method.
      await user.click(radio);
      expect(radio).toBeChecked();
    },
  );

  it("refuses to leave the step, naming each control that is at fault in the step's own summary", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await openShippingStep(user);

    await user.click(screen.getByRole("button", { name: CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL }));

    // The step stays, and its summary names the contact, the address and the method the flow requires
    // rather than restating one generic sentence for all of them.
    const summary = await screen.findByRole("alert", {
      name: CHECKOUT_COPY.ERROR_SUMMARY_HEADING,
    });
    expect(
      screen.getByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING }),
    ).toBeVisible();
    expect(
      within(summary).getByRole("link", { name: new RegExp(ACCOUNT_COPY.EMAIL_LABEL) }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByRole("link", { name: new RegExp(CHECKOUT_COPY.FULL_NAME_LABEL) }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByRole("link", {
        name: new RegExp(CHECKOUT_COPY.SHIPPING_METHOD_LEGEND),
      }),
    ).toBeInTheDocument();
  });

  it("states each service's own charge while the basket has no figures, and prices it on the retry", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });

    // The failure is armed for the first price the basket is given, so the checkout holds no figures while
    // the rows still state what each configured service costs.
    const failure = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    await openShippingStep(user);

    const economy = SHIPPING_METHODS.find((method) => method.priceMinor > 0);
    if (economy === undefined) throw new Error("The configured delivery methods charge nothing.");
    const row = methodRow(await screen.findByRole("radio", { name: new RegExp(economy.name) }));
    expect(textOf(row)).toContain(formatMoney(economy.priceMinor));

    // The panel states that the basket could not be priced and offers the one control that resolves it.
    const retry = screen.getByRole("button", { name: COMMON_ACTIONS.RETRY });
    await user.click(retry);
    await summaryFigures(summaryPanel());
    failure.disarm();
  });

  it("reports a delivery list that could not be read, and lists the services again on its retry", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });

    // The failure is armed before the step mounts, so the one read the rows are built from meets it.
    const failure = failNext({ routeId: "shipping.list" });
    await openShippingStep(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    const radio = await screen.findByRole("radio", { name: new RegExp(SHIPPING_METHODS[0].name) });
    expect(radio).toBeInTheDocument();
    failure.disarm();
  });
});

describe("the shipping step a signed-in customer is shown", () => {
  it("opens on the address the book flags for shipping, and adopts another when the picker is used", async () => {
    const { user } = await openAsShopper();
    await openShippingStep(user);

    // The book was read, so the flagged address seeds the fields and its own row is the one marked.
    const flagged = await savedAddressRadio(SHIPPING_DEFAULT);
    expect(flagged).toBeChecked();
    expectAddressHeld(SHIPPING_DEFAULT);

    // Choosing another entry writes that address into the fields, which stay the shopper's to edit.
    const adopted = await savedAddressRadio(ANOTHER_ADDRESS);
    await user.click(adopted);
    expect(adopted).toBeChecked();
    expect(flagged).not.toBeChecked();
    expectAddressHeld(ANOTHER_ADDRESS);
  });

  it("starts an address of the shopper's own, clearing the typed members and keeping the country", async () => {
    const { user } = await openAsShopper();
    await openShippingStep(user);
    await savedAddressRadio(SHIPPING_DEFAULT);

    const start = screen.getByRole("button", { name: CHECKOUT_COPY.USE_NEW_ADDRESS_LABEL });
    await user.click(start);

    // Every typed member is gone while the country the closed list offers stays, and the picker is left
    // with nothing chosen — which is what takes the control's own way back away.
    expect(field(CHECKOUT_COPY.FULL_NAME_LABEL)).toHaveValue("");
    expect(field(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL)).toHaveValue("");
    expect(field(CHECKOUT_COPY.CITY_LABEL)).toHaveValue("");
    expect(field(CHECKOUT_COPY.COUNTRY_LABEL)).toHaveValue(SHIPPING_DEFAULT.country);
    expect(screen.queryByRole("button", { name: CHECKOUT_COPY.USE_NEW_ADDRESS_LABEL })).toBeNull();
  });

  it("keeps the address it already holds when the shopper returns to the step", async () => {
    const { user } = await openAsShopper();
    await openShippingStep(user);
    await savedAddressRadio(SHIPPING_DEFAULT);
    await chooseMethod(user, CHOSEN_METHOD.name);
    await advanceTo(
      user,
      CHECKOUT_COPY.CONTINUE_TO_PAYMENT_LABEL,
      CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    );

    // The indicator reaches the step already worked on, and the address it collected is still there: the
    // form is reseeded on no render, so nothing already answered for is written over.
    await user.click(screen.getByRole("button", { name: CHECKOUT_STEP_TITLES[0] }));
    await screen.findByRole("heading", { name: CHECKOUT_COPY.SHIPPING_STEP_HEADING });
    expectAddressHeld(SHIPPING_DEFAULT);
    expect(await savedAddressRadio(SHIPPING_DEFAULT)).toBeChecked();
  });

  it("offers the book's own empty state, whose one action moves the keyboard to the first field", async () => {
    const { user } = await openAsNewAccount();
    await openShippingStep(user);

    // A freshly registered account holds no address, so the picker states it and offers the one useful
    // action, while the country list still opens on the first configured country.
    expect(await screen.findByText(EMPTY_STATES.addresses.title)).toBeVisible();
    expect(screen.getByText(EMPTY_STATES.addresses.description)).toBeVisible();
    expect(screen.queryByText(CHECKOUT_COPY.SAVED_ADDRESS_LABEL)).toBeNull();
    expect(field(CHECKOUT_COPY.COUNTRY_LABEL)).toHaveValue(SUPPORTED_COUNTRIES[0].code);

    await user.click(screen.getByRole("button", { name: EMPTY_STATES.addresses.actionLabel }));
    expect(field(CHECKOUT_COPY.FULL_NAME_LABEL)).toHaveFocus();
  });

  it("reports a book that could not be read above the form, and reads it again on its retry", async () => {
    const { user } = await openAsShopper();

    // The failure is armed once the session is in hand and before the step mounts, so the read the picker
    // makes meets it.
    const failure = failNext({ routeId: "addresses.list" });
    await openShippingStep(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FALLBACK_FAILURE_MESSAGE);
    // A book that could not be read is no reason to withhold the form, which is still the shopper's.
    expect(field(CHECKOUT_COPY.ADDRESS_LINE_1_LABEL)).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(await savedAddressRadio(SHIPPING_DEFAULT)).toBeInTheDocument();
    failure.disarm();
  });
});
