/**
 * Path: tests/integration/checkoutPricingFailure.test.tsx
 * Purpose: The checkout's refused price request: the seam's failure reported with a retry, the basket priced
 * again, and the steps beyond it still reached.
 * Lines: 187
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS, SHIPPING_METHODS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  cartItemCountLabel,
} from "@/constants/content";
import { ROUTES, productPath } from "@/constants/routes";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import type { MinorUnits } from "@/types/common";
import { parseMoneyToMinor } from "@/utils/format";

import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * Why the refused price request is a suite of its own.
 *
 * The case drives the checkout from the storefront to the payment step with one armed failure in between, so it
 * needs the walk into the catalogue and the readers of a summary the flow file also declares. A concern that
 * cannot fit under the 600-line ceiling is split into a second file rather than the ceiling raised (§0.5.1,
 * §0.5.5), and a split suite carries the helpers it needs itself, as `tests/unit/lib/pricingSurface.test.ts`
 * records of its own copies: nothing here is imported from `tests/integration/checkoutFlow.test.tsx`, which
 * keeps the rest of the checkout flow.
 */

/** The contact address a guest's checkout is filled with, and the name its delivery address is under. */
const CONTACT_EMAIL = DEMO_ACCOUNTS.CUSTOMER_EMAIL;
const DELIVERY_NAME = "Ada Lovelace";

/** The last configured delivery method, which always charges, so choosing it re-prices the basket. */
const CHOSEN_METHOD = SHIPPING_METHODS[SHIPPING_METHODS.length - 1];

/** The prefix every product link carries, which is how the catalogue's offers are told from other links. */
const PRODUCT_PATH_PREFIX = productPath("");

// Reading what a surface states in money -----------------------------------------------------------

/** The figures an order summary states, in integer minor units. */
type SummaryFigures = Readonly<
  Record<"subtotal" | "discount" | "shipping" | "tax" | "total", MinorUnits>
>;

/** The summary panel the surface under test renders, named by the heading that surface states: the cart's
 *  panel and the checkout's totals panel are two regions under two names, so a caller names the one it
 *  means, and the checkout's name stands as the default because most call sites read that panel. */
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

/** The figures a summary states once priced. No code is applied here, so the discount is stated as none. */
async function summaryFigures(scope: HTMLElement): Promise<SummaryFigures> {
  await waitFor(() =>
    expect(rowAmount(scope, CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeGreaterThan(0),
  );
  return {
    subtotal: rowAmount(scope, CART_COPY.SUMMARY_SUBTOTAL_LABEL),
    discount: 0,
    shipping: rowAmount(scope, CART_COPY.SUMMARY_SHIPPING_LABEL),
    tax: rowAmount(scope, CART_COPY.SUMMARY_TAX_LABEL),
    total: rowAmount(scope, CART_COPY.SUMMARY_TOTAL_LABEL),
  };
}

// Walking the storefront -------------------------------------------------------------------------

/** The catalogue's product links, in the order the listing offers them. */
function productLinks(): HTMLElement[] {
  return screen
    .queryAllByRole("link")
    .filter((link) => (link.getAttribute("href") ?? "").startsWith(PRODUCT_PATH_PREFIX));
}

/** The first product link the listing offers, once the listing it leads has rendered. This one wait asks for
 *  more than the suite's own ceiling in `tests/setup.ts`, because it is the file's first paint: the catalogue's
 *  lazy route and the seeded collections behind it are evaluated in a cold module registry, measured at about
 *  two seconds on an idle host and longer while the other files run. */
async function firstProductLink(): Promise<HTMLElement> {
  await waitFor(() => expect(productLinks().length).toBeGreaterThan(0), { timeout: 10_000 });
  const link = productLinks()[0];
  if (link === undefined) throw new Error("The catalogue rendered no product link.");
  return link;
}

/** Walks into the product the catalogue offers first, adds one unit from the detail page, asserts the count the
 *  mini-cart the add opens states, and dismisses it — returning the cart row's name. */
async function addItemToCart(user: UserEvent): Promise<string> {
  const link = await firstProductLink();
  const name = (link.textContent ?? "").trim();
  await user.click(link);
  await screen.findByRole("heading", { level: 1, name });
  await user.click(screen.getByRole("button", { name: CATALOG_COPY.ADD_TO_CART_LABEL }));
  const drawer = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
  expect(within(drawer).getByText(cartItemCountLabel(1))).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(drawer).not.toBeInTheDocument());
  return name;
}

// Filling the checkout's steps -------------------------------------------------------------------

/** The control a field's own label names: a required field's label ends with its marker, so a field's
 *  name is matched as a pattern rather than as the exact text. */
function field(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(label));
}

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

beforeEach(resetApiState);

afterEach(() => {
  vi.useRealTimers();
  resetApiState();
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
