/**
 * Path: tests/components/accountViews.test.tsx
 * Purpose: The branches the account views own: registration's preserved path, reveal, field refusals, signed-in panel and refused submission, the profile's read refusal and its three save refusals with a confirmed save and a read-only identity line, and the order detail's refusals with a discounted and an invoiced order
 * Lines: 470
 */

import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  PAGE_TITLES,
  PAYMENT_METHOD_LABELS,
  VALIDATION_MESSAGES,
  signedInMessage,
} from "@/constants/content";
import { ROUTES, accountOrderPath, loginPath, registerPath } from "@/constants/routes";
import { CUSTOMERS } from "@/data/customers";
import { ORDERS } from "@/data/orders";
import { OrderHistoryPage } from "@/features/account/OrderHistoryPage";
import { ProfilePage } from "@/features/account/ProfilePage";
import { API_ERROR_CODES } from "@/lib/apiContract";
import { displayName } from "@/lib/customerService";
import type { Customer } from "@/types/account";
import type { Order } from "@/types/commerce";
import type { MinorUnits } from "@/types/common";
import { parseMoneyToMinor } from "@/utils/format";

import { descriptionsOfInvalidFields, fieldLabel, openSection } from "../helpers/journeyHarness";
import { failNext, renderApp, renderWithProviders, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * What this file drives, and how.
 *
 * Every branch below lives under a real route and is reached the way a visitor reaches it: the preserved
 * path arrives through the address bar, the profile and the history are re-read by navigating, and each
 * refusal is armed on the seam's own failure switch and consumed by the request it was armed for. One
 * branch stands apart — the warning a view renders for the instant a guard has not yet turned a
 * session-less visitor away — so those views are mounted directly with the harness's providers, because no
 * route draws that frame.
 *
 * Every fact a case is checked against comes from the module that owns it: the seeded accounts, their orders,
 * the copy library and the route builders. `tests/setup.ts` rebuilds the data source from the frozen seed
 * after every case, so a write no case makes reaches a later one and no case depends on which ran first.
 */

// The seeded facts -------------------------------------------------------------------------------

/** The seeded account an email names, or a thrown seed mistake rather than a case that checks less. */
function seededCustomer(email: string): Customer {
  const found = CUSTOMERS.find((customer) => customer.email === email);
  if (found === undefined) throw new Error(`The seeded accounts do not hold "${email}".`);
  return found;
}

/** The account every case signs in as, and the one a save is checked against. */
const SHOPPER: Customer = seededCustomer(DEMO_ACCOUNTS.CUSTOMER_EMAIL);

/** The name the profile, the header and the registration greeting read the shopper by. */
const SHOPPER_NAME = displayName(SHOPPER);

/** The shopper's own orders: the record every figure the history and the detail show comes from. */
const SHOPPER_ORDERS: readonly Order[] = ORDERS.filter((order) => order.customerId === SHOPPER.id);

/** An email no seeded account holds and no other case in this file registers: a duplicate is refused. */
function uniqueEmail(tag: string): string {
  return `nina.weber.${tag}@salespro.test`;
}

// Driving the real screens -----------------------------------------------------------------------

/** Signs in through the real form, clearing the fields first so a remounted screen is not typed onto. */
async function signInAs(user: UserEvent, email: string): Promise<void> {
  const address = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
  const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));
  await user.clear(address);
  await user.clear(password);
  await user.type(address, email);
  await user.type(password, DEMO_ACCOUNTS.PASSWORD);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await waitFor(() => {
    expect(screen.queryByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeNull();
  });
}

/** Signs in as the shopper and waits for the profile screen the sign-in lands on. */
async function signInAsShopper(user: UserEvent): Promise<void> {
  await signInAs(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  expect(await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING })).toBeVisible();
}

/** Fills the four judged fields of the registration form; the consent switch opens off. */
async function fillRegistration(user: UserEvent, email: string): Promise<void> {
  await user.type(await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL)), "Nina");
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.LAST_NAME_LABEL)), "Weber");
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), email);
  await user.type(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)), "Shopper1234");
}

/** Registers the account the form holds, leaving the case to assert where the registration landed. */
async function registerAccount(user: UserEvent, email: string): Promise<void> {
  await fillRegistration(user, email);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL }));
}

/** The order history's table, which its own caption names: waiting on it proves the screen rendered. */
function listedTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING });
}

/** The first order the history lists: its own link, and the record behind the number it prints. */
async function firstListedOrder(): Promise<{ readonly link: HTMLElement; readonly order: Order }> {
  const table = await listedTable();
  const link = within(within(table).getAllByRole("row")[1]).getByRole("link");
  const number = link.textContent?.trim() ?? "";
  const order = SHOPPER_ORDERS.find((candidate) => candidate.orderNumber === number);
  if (order === undefined) throw new Error(`The history lists an unknown order: ${number}`);
  return { link, order };
}

/** The frame a labelled heading sits in, which is how the profile's identity line and the order detail's
 *  sections are reached. */
function sectionFor(heading: string): HTMLElement {
  const parent = screen.getByRole("heading", { name: heading }).parentElement;
  if (parent === null) throw new Error(`The "${heading}" heading has no frame.`);
  return parent;
}

/** The minor units the figure beside `label` renders as, read from the row that holds both. */
function displayedAmount(scope: HTMLElement, label: string): MinorUnits {
  const row = within(scope).getByText(label).parentElement;
  if (row === null) throw new Error(`No row holds the "${label}" figure.`);
  return parseMoneyToMinor(row.textContent);
}

describe("the account views' own branches", () => {
  it.each([
    {
      label: "the profile",
      View: ProfilePage,
      absent: (): HTMLElement | null =>
        screen.queryByRole("button", { name: COMMON_ACTIONS.SAVE_CHANGES }),
    },
    {
      label: "the order history",
      View: OrderHistoryPage,
      absent: (): HTMLElement | null =>
        screen.queryByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING }),
    },
  ] as const)(
    "states the sign-in requirement where $label renders with no session",
    async ({ absent, View }) => {
      renderWithProviders(<View />, { route: ROUTES.ACCOUNT });

      // A guarded route sends a visitor away before this shows, so the warning is the last frame of a
      // visitor whose session has gone: it must say why, and must not render controls it cannot fill.
      expect(await screen.findByText(FEEDBACK_COPY.SIGN_IN_REQUIRED)).toBeVisible();
      expect(absent()).toBeNull();
    },
  );

  it("carries a preserved path into registration and lands the new account on it", async () => {
    const { user } = renderApp({ route: registerPath(ROUTES.ACCOUNT_ORDERS) });

    // The way on to the sign-in screen carries the same path, so a visitor who already has an account
    // arrives where this one will.
    expect(
      await screen.findByRole("link", { name: ACCOUNT_COPY.GO_TO_SIGN_IN_LABEL }),
    ).toHaveAttribute("href", loginPath(ROUTES.ACCOUNT_ORDERS));

    await registerAccount(user, uniqueEmail("preserved"));

    // A customer's session can open the preserved path, so the registration lands there rather than on the
    // account, and the account it created holds no orders yet.
    expect(await screen.findByRole("heading", { name: ACCOUNT_COPY.ORDERS_HEADING })).toBeVisible();
    expect(await screen.findByText(EMPTY_STATES.orders.title)).toBeVisible();
  });

  it("refuses a preserved path that is not a path of its own", async () => {
    const { user } = renderApp({ route: registerPath("//evil.example/account") });

    // A protocol-relative address is not a path this application may navigate to, so the link across to
    // sign-in carries none and the registration lands on the account instead.
    expect(
      await screen.findByRole("link", { name: ACCOUNT_COPY.GO_TO_SIGN_IN_LABEL }),
    ).toHaveAttribute("href", ROUTES.LOGIN);

    await registerAccount(user, uniqueEmail("refused-path"));

    expect(
      await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING }),
    ).toBeVisible();
  });

  it("reveals the password behind its own toggle and reports the state it is in", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    expect(await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL))).toHaveAttribute(
      "type",
      "password",
    );

    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SHOW_PASSWORD_LABEL }));

    expect(await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL))).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByRole("button", { name: ACCOUNT_COPY.HIDE_PASSWORD_LABEL })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("states a registration the store could not answer above the fields and keeps what was typed", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    const email = uniqueEmail("unanswered");
    await fillRegistration(user, email);
    const refusal = "The registration service is not answering.";
    failNext({ routeId: "auth.register", message: refusal });
    await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL }));

    // The refusal names no control, so it is stated above the fields and the keyboard lands on the notice
    // rather than on a form the visitor has already left.
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeVisible();
    expect(within(alert).getByText(refusal)).toBeVisible();
    expect(alert.parentElement).toHaveFocus();

    // Nothing was created, so the form still holds what was typed and the visitor can correct and resend.
    expect(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL))).toHaveValue(email);
    expect(screen.getByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL })).toBeEnabled();
  });

  it("greets a signed-in visitor on the registration route and continues them to the path they can reach", async () => {
    const first = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(first.user);
    first.unmount();

    renderApp({ route: registerPath(ROUTES.ACCOUNT_ORDERS) });

    // The registration a visitor already holds is not offered again: the panel says who is signed in and
    // offers the way on, which is the path they asked for because a customer may open it.
    expect(await screen.findByText(signedInMessage(SHOPPER_NAME))).toBeVisible();
    expect(screen.getByRole("heading", { name: PAGE_TITLES.ACCOUNT })).toBeVisible();
    expect(screen.getByRole("link", { name: COMMON_ACTIONS.CONTINUE })).toHaveAttribute(
      "href",
      ROUTES.ACCOUNT_ORDERS,
    );
    expect(screen.queryByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL })).toBeNull();
  });

  it("judges the registration fields before sending and files the store's own refusal on the address", async () => {
    const { user } = renderApp({ route: ROUTES.REGISTER });
    const submit = await screen.findByRole("button", { name: ACCOUNT_COPY.REGISTER_SUBMIT_LABEL });

    // Nothing filled: each judged member is reported on its own control, and the keyboard lands on the
    // first one the rule refused rather than on a notice the form does not carry.
    await user.click(submit);
    const missing = descriptionsOfInvalidFields(document.body);
    expect(missing).toHaveLength(4);
    missing.forEach((description) => expect(description).toContain(VALIDATION_MESSAGES.REQUIRED));
    expect(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL))).toHaveFocus();

    // A password below the policy is refused in the rule's own words, before anything is sent.
    await fillRegistration(user, uniqueEmail("policy"));
    const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));
    await user.clear(password);
    await user.type(password, "short1");
    await user.click(submit);
    expect(await screen.findByText(VALIDATION_MESSAGES.PASSWORD_POLICY)).toBeVisible();

    // Uniqueness is the store's own answer, and it lands on the control that caused it.
    const email = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    await user.clear(email);
    await user.clear(password);
    await user.type(email, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    await user.type(password, DEMO_ACCOUNTS.PASSWORD);
    await user.click(submit);
    expect(await screen.findByText(ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE)).toBeVisible();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("offers the profile read's retry when the store refuses it, and shows the form once it answers", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);

    // Leaving the profile and returning is what makes the refused read the one this screen's own mount
    // makes, so the arm is consumed by it alone.
    await openSection(user, ACCOUNT_COPY.NAV_ADDRESSES_LABEL);
    expect(
      await screen.findByRole("heading", { name: ACCOUNT_COPY.ADDRESS_BOOK_HEADING }),
    ).toBeVisible();
    failNext({ routeId: "customers.detail" });
    await openSection(user, ACCOUNT_COPY.NAV_PROFILE_LABEL);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeVisible();
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_BODY)).toBeVisible();
    expect(screen.queryByDisplayValue(SHOPPER.email)).toBeNull();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(await screen.findByDisplayValue(SHOPPER.email)).toBeVisible();
  });

  it("files a refused save on the control the store named, and states one that names none as a toast", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    const phone = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.PHONE_LABEL));
    await user.clear(phone);
    await user.type(phone, "+1 503 555 0177");
    const save = screen.getByRole("button", { name: COMMON_ACTIONS.SAVE_CHANGES });

    // A refusal naming a control belongs on that control: it is linked to it through the control's own
    // description, and nothing is announced as a whole-form failure.
    const named = "That number is not one we can call.";
    failNext({
      routeId: "customers.update",
      status: 422,
      code: API_ERROR_CODES.VALIDATION_FAILED,
      field: "phone",
      message: named,
    });
    await user.click(save);
    const message = await screen.findByText(named);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone.getAttribute("aria-describedby")).toContain(message.id);
    expect(screen.queryByRole("alert")).toBeNull();

    // A refusal naming no control has nowhere to sit in the form, so it is reported where the customer is
    // looking — the toast — while the correction they typed is kept for the next submission.
    const wholeForm = "The profile service is not answering.";
    failNext({ routeId: "customers.update", message: wholeForm });
    await user.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(wholeForm);
    expect(screen.queryByText(named)).toBeNull();
    expect(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PHONE_LABEL))).toHaveValue(
      "+1 503 555 0177",
    );
    expect(screen.queryByText(FEEDBACK_COPY.TOAST_PROFILE_SAVED)).toBeNull();
  });

  it("saves an edited name and the marketing choice, confirms it once, and keeps the email read-only", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    const email = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveValue(SHOPPER.email);

    const firstName = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL));
    await user.clear(firstName);
    await user.type(firstName, "Nadia");
    const lastName = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.LAST_NAME_LABEL));
    await user.clear(lastName);
    await user.type(lastName, "Nash");
    const optIn = screen.getByRole("switch", { name: ACCOUNT_COPY.MARKETING_OPT_IN_LABEL });
    const wasOptedIn = optIn.getAttribute("aria-checked") === "true";
    await user.click(optIn);
    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.SAVE_CHANGES }));

    // The confirmation the customer is looking at is announced as well as painted, and a save confirms
    // itself once: the profile raises no toast beside the sentence it writes.
    const confirmation = await screen.findByText(FEEDBACK_COPY.TOAST_PROFILE_SAVED);
    expect(confirmation.closest('[role="status"]')).not.toBeNull();
    // The form adopted the record the store answered with, so what it shows is what was stored.
    expect(
      screen.getByRole("switch", { name: ACCOUNT_COPY.MARKETING_OPT_IN_LABEL }),
    ).toHaveAttribute("aria-checked", String(!wasOptedIn));
    expect(within(sectionFor(ACCOUNT_COPY.PROFILE_HEADING)).getByText("Nadia Nash")).toBeVisible();
    expect(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL))).toHaveValue(SHOPPER.email);
  });

  it("refuses an invalid profile at its own control without sending it", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    const firstName = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL));
    await user.clear(firstName);

    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.SAVE_CHANGES }));

    // The rule runs before the body is sent: the control is marked and described, nothing is confirmed,
    // and the form still holds what the customer typed rather than a record re-read from the store.
    const message = await screen.findByText(VALIDATION_MESSAGES.REQUIRED);
    expect(firstName).toHaveAttribute("aria-invalid", "true");
    expect(firstName.getAttribute("aria-describedby")).toContain(message.id);
    expect(screen.queryByText(FEEDBACK_COPY.TOAST_PROFILE_SAVED)).toBeNull();
    expect(screen.getByLabelText(fieldLabel(ACCOUNT_COPY.FIRST_NAME_LABEL))).toHaveValue("");
  });

  it("offers the order read's retry when the store could not answer, and opens the order once it does", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    await openSection(user, ACCOUNT_COPY.NAV_ORDERS_LABEL);
    const { link, order } = await firstListedOrder();

    failNext({ routeId: "orders.detail" });
    await user.click(link);

    // A store that could not answer says nothing about the credential, so asking again can help: the state
    // offers the retry and the way back to the history beside it.
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeVisible();
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_BODY)).toBeVisible();
    expect(
      screen.getByRole("link", { name: ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL }),
    ).toHaveAttribute("href", ROUTES.ACCOUNT_ORDERS);

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(await screen.findByRole("heading", { name: order.orderNumber })).toBeVisible();
  });

  it("answers a refused order read that names the session with the way to sign in rather than a retry", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    await openSection(user, ACCOUNT_COPY.NAV_ORDERS_LABEL);
    const { link, order } = await firstListedOrder();

    // A refusal that names the session is answered by signing in, and asking again cannot: no retry is
    // offered, and the link carries this order so the visitor arrives back at it.
    failNext({ routeId: "orders.detail", status: 401, code: API_ERROR_CODES.SESSION_EXPIRED });
    await user.click(link);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeVisible();
    expect(within(alert).queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
    expect(screen.getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toHaveAttribute(
      "href",
      loginPath(accountOrderPath(order.id)),
    );
    expect(screen.queryByRole("link", { name: ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL })).toBeNull();
  });

  it("renders a discounted order's own discount row and an invoiced order's payment method", async () => {
    const discounted = SHOPPER_ORDERS.find((order) => order.pricedCart.discountTotalMinor > 0);
    if (discounted === undefined) {
      throw new Error("The seed holds no discounted order for the shopper.");
    }
    const invoiced = ORDERS.find((order) => order.payment.method === "invoice");
    if (invoiced === undefined) throw new Error("The seed holds no invoiced order.");

    // An administrator reads any order, which is how the two orders' own shapes are reached here.
    const first = renderApp({ route: ROUTES.LOGIN });
    await signInAs(first.user, DEMO_ACCOUNTS.ADMIN_EMAIL);
    // An administrator's sign-in lands on the dashboard, which is the home its role holds.
    expect(
      await screen.findByRole("heading", { name: PAGE_TITLES.DASHBOARD, level: 1 }),
    ).toBeVisible();
    first.unmount();

    const discountedView = renderApp({ route: accountOrderPath(discounted.id) });
    expect(await screen.findByRole("heading", { name: discounted.orderNumber })).toBeVisible();
    const items = sectionFor(ACCOUNT_COPY.ORDER_DETAIL_ITEMS_HEADING);
    expect(displayedAmount(items, CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBe(
      discounted.pricedCart.discountTotalMinor,
    );
    discountedView.unmount();

    // An order settled without a card states the method it was settled by rather than a masked tail.
    renderApp({ route: accountOrderPath(invoiced.id) });
    expect(await screen.findByRole("heading", { name: invoiced.orderNumber })).toBeVisible();
    const payment = sectionFor(ACCOUNT_COPY.ORDER_DETAIL_PAYMENT_HEADING);
    expect(within(payment).getByText(PAYMENT_METHOD_LABELS.invoice)).toBeVisible();
  });
});
