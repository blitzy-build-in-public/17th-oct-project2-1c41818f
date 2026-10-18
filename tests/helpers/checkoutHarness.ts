/**
 * Path: tests/helpers/checkoutHarness.ts
 * Purpose: The harness both checkout suites drive the rendered checkout through: the storefront walk into a basket, the field lookup and the shipping step's inputs, each declared once.
 * Lines: 116
 */

import { expect } from "vitest";

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import { DEMO_ACCOUNTS, SHIPPING_METHODS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  CATALOG_COPY,
  cartItemCountLabel,
  quantityLabel,
} from "@/constants/content";
import { productPath } from "@/constants/routes";
import { SORT_OPTIONS, SUPPORTED_COUNTRIES } from "@/constants/taxonomy";

import { screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/** The contact address a guest's checkout is filled with, and the name its delivery address is under. */
export const CONTACT_EMAIL = DEMO_ACCOUNTS.CUSTOMER_EMAIL;
export const DELIVERY_NAME = "Ada Lovelace";

/** The last configured delivery method, which always charges, so choosing it re-prices the basket. */
export const CHOSEN_METHOD = SHIPPING_METHODS[SHIPPING_METHODS.length - 1];

/** The sort key that lists the catalogue cheapest first, which is how a case walks into a lower-priced offer. */
const CHEAPEST_FIRST_SORT = SORT_OPTIONS[1].value;

/** The prefix every product link carries, which is how the catalogue's offers are told from other links. */
const PRODUCT_PATH_PREFIX = productPath("");

// Walking the storefront -------------------------------------------------------------------------

/** The catalogue's product links, in the order the listing offers them. */
export function productLinks(): HTMLElement[] {
  return screen
    .queryAllByRole("link")
    .filter((link) => (link.getAttribute("href") ?? "").startsWith(PRODUCT_PATH_PREFIX));
}

/** The first product link the listing offers, once the listing it leads has rendered. This one wait asks for more
 *  than the suite's ceiling in `tests/setup.ts`, because it is the suite's first paint: the catalogue's lazy route
 *  and the seeded collections behind it are evaluated in a cold module registry, measured at about two seconds on
 *  an idle host and longer while the other files run. */
export async function firstProductLink(): Promise<HTMLElement> {
  await waitFor(() => expect(productLinks().length).toBeGreaterThan(0), { timeout: 10_000 });
  const link = productLinks()[0];
  if (link === undefined) throw new Error("The catalogue rendered no product link.");
  return link;
}

/** What a walk into the catalogue asks for. */
export type CartWalk = { readonly quantity?: number; readonly cheapest?: boolean };

/** Walks into the catalogue's first product, adds the units asked for, asserts the mini-cart's count and returns
 *  the cart row's name. */
export async function addItemToCart(user: UserEvent, walk: CartWalk = {}): Promise<string> {
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

// Filling the checkout's steps -------------------------------------------------------------------

/** The control a field's own label names; a required field's label ends with its marker, so it is a pattern. */
export function field(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(label));
}

/** Fills the shipping step's contact and address controls, and the country from the configured list. */
export async function fillShippingAddress(user: UserEvent): Promise<void> {
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
export async function chooseShippingMethod(user: UserEvent): Promise<void> {
  await user.click(await screen.findByRole("radio", { name: new RegExp(CHOSEN_METHOD.name, "i") }));
}

/** Advances the step in force through the control the flow gives it, and waits for the step that follows. */
export async function advanceTo(user: UserEvent, label: string, heading: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: label }));
  await screen.findByRole("heading", { name: heading });
}
