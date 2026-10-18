/**
 * Path: tests/helpers/journeyHarness.tsx
 * Purpose: The harness both journey files read the rendered application through: the copy, records and seam they assert by, the test-utils surface they drive it with, and one reader per rendered surface.
 * Lines: 297
 */

import { act } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  RELATED_PRODUCTS_LIMIT,
  SEARCH_SUGGESTION_LIMIT,
} from "@/constants/config";
import * as content from "@/constants/content";
import { ROUTES, categoryPath, productPath } from "@/constants/routes";
import { CATEGORY_DEFINITIONS, FACET_DEFINITIONS } from "@/constants/taxonomy";
import { BRANDS } from "@/data/categories";
import { PRODUCTS } from "@/data/products";
import { API_PATHS } from "@/lib/apiClient";
import type { Product, SortKey } from "@/types/catalog";
import { formatMoney, formatRatingValue, parseMoneyToMinor } from "@/utils/format";
import {
  DEFAULT_FILTER_STATE,
  filtersToPath,
  setQuery,
  toggleFacetValue,
  withSort,
} from "@/utils/queryParams";

import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * Both journey files reach the product through this one surface, so neither of them imports the product's own
 * modules and no reader or input below has a second declaration anywhere: what is listed here is one binding
 * each, re-exported rather than reimplemented.
 */
export {
  act,
  API_PATHS,
  categoryPath,
  CATEGORY_DEFINITIONS,
  content,
  DEFAULT_FILTER_STATE,
  DEFAULT_PAGE_SIZE,
  FACET_DEFINITIONS,
  failNext,
  filtersToPath,
  formatMoney,
  formatRatingValue,
  PRODUCTS,
  productPath,
  RELATED_PRODUCTS_LIMIT,
  renderApp,
  resetApiState,
  ROUTES,
  screen,
  SEARCH_SUGGESTION_LIMIT,
  setQuery,
  toggleFacetValue,
  waitFor,
  within,
  withSort,
};

// The case's inputs, taken from the records the application is answered from --------------------------

/**
 * The words a case asserts by, the sort it chooses and the records it acts on: the copy module owns every
 * sentence, the taxonomy owns the sort keys, and the seeded collections own the subjects.
 */
export const {
  A11Y_COPY,
  CATALOG_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  HEADER_COPY,
  PAGE_TITLES,
  SEARCH_COPY,
  addedToCartMessage,
  cartButtonLabel,
  categoryPageHeading,
  productCountAnnouncement,
  productCountLabel,
  quantityLabel,
  quickAddLabel,
  ratingSummaryLabel,
  removeFilterLabel,
} = content;
export const { HOME_COPY } = content;
export const TRUST_CLAIMS = [
  HOME_COPY.TRUST_REVIEWS_CLAIM,
  HOME_COPY.TRUST_CART_CLAIM,
  HOME_COPY.TRUST_CHECKOUT_CLAIM,
] as const;
export const PRICE_ASCENDING_SORT: SortKey = "price-asc";
export const SELECTED_BRAND = BRANDS[0];
export const OTHER_BRAND = BRANDS[1];
/** A product the storefront can sell, so its buy controls act rather than report themselves unavailable. */
export const SELLABLE_PRODUCT = PRODUCTS.find((product) => product.stockOnHand > 1) ?? PRODUCTS[0];
/** The separator a facet writes between a term and its count inside the control's own name. */
const FACET_COUNT_SEPARATOR = " \u00b7 ";
const MONEY_PATTERN = /\$[0-9][0-9,]*\.[0-9]{2}/;
/** How an availability line reads, in the copy module's own words: plenty, low, or none. */
export const AVAILABILITY_PATTERN = new RegExp(
  `^(${CATALOG_COPY.IN_STOCK_LABEL}|${CATALOG_COPY.OUT_OF_STOCK_LABEL}|Only [0-9]+ left in stock)$`,
);

// Reading the rendered surface -----------------------------------------------------------------------

/** An element's text, with the whitespace its markup introduces collapsed. */
export function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The results region both listing surfaces render: the heading over the grid names it, and the footer's
 *  own headings sit outside it. */
export function resultsRegion(): HTMLElement {
  return screen.getByRole("region", { name: CATALOG_COPY.RESULTS_REGION_LABEL });
}

/** The page body region the catalogue hands the focus to when an action removes the control that raised it:
 *  the column holding the chips, the toolbar and the results, which carries `tabindex="-1"` for that reason
 *  alone and so is reachable by no role. */
export function pageBodyRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>(".sp-page__body");
  if (region === null) throw new Error("The catalogue rendered no page body region.");
  return region;
}

/** The facet panel's own element, whichever placement it is in: the sticky column from the medium stop up,
 *  and the drawer's contents below it. */
export function facetPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>(".sp-facets");
  if (panel === null) throw new Error("The catalogue rendered no facet panel.");
  return panel;
}

/** Every product tile the page is showing, in the order it renders them: the tiles' own names. A listing
 *  that is still loading, that failed or that matched nothing shows none. */
export function tileHeadings(): HTMLElement[] {
  return within(resultsRegion()).queryAllByRole("heading", { level: 3 });
}

/** The names of the rendered tiles, in order. */
export function tileNames(): string[] {
  return tileHeadings().map((heading) => textOf(heading));
}

/** The money each tile shows as minor units and in order: a tile's first amount is the price a price sort
 *  orders by. */
export function tilePricesMinor(): number[] {
  return tileHeadings().map((heading) => {
    const money = MONEY_PATTERN.exec((heading.closest("li") ?? heading).textContent ?? "");
    return money === null ? 0 : parseMoneyToMinor(money[0]);
  });
}

/** The number a piece of count wording states, read from the template the copy module builds it with. */
export function statedCount(text: string): number | null {
  const noun = productCountLabel(2).replace("2 ", "");
  const match = new RegExp(`([0-9][0-9,]*) ${noun}\\b`).exec(text);
  return match === null ? null : Number(match[1].replace(/,/g, ""));
}

/** The count a facet control announces in its own accessible name, or `-1` when it announces none. */
export function controlCount(control: HTMLElement): number {
  return statedCount(control.getAttribute("aria-label") ?? "") ?? -1;
}

/** The checkbox a facet renders for a term, found by the name the panel builds for that control. */
export function facetTermControl(scope: HTMLElement, termName: string): HTMLElement {
  return within(scope).getByRole("checkbox", {
    name: new RegExp(`^${termName}${FACET_COUNT_SEPARATOR}`),
  });
}

/** The result total the surface announces, awaited: the polite region is present from the first render and
 *  is given its text once the request lands. */
export async function announcedTotal(): Promise<number> {
  let total = -1;
  await waitFor(() => expect((total = readAnnouncedTotal())).toBeGreaterThanOrEqual(0));
  return total;
}

/** The total the polite live region states right now, or `-1` before a page has announced one. */
export function readAnnouncedTotal(): number {
  const template = productCountAnnouncement(1);
  const prefix = template.slice(0, template.indexOf("1"));
  for (const region of screen.getAllByRole("status")) {
    const text = textOf(region);
    if (!text.startsWith(prefix)) continue;
    const digits = /^[0-9][0-9,]*/.exec(text.slice(prefix.length));
    if (digits !== null) return Number(digits[0].replace(/,/g, ""));
  }
  return -1;
}

/** The rendered result set, awaited: a listing is held back until the query it answers lands. */
export async function settledTiles(): Promise<string[]> {
  await waitFor(() => expect(tileNames().length).toBeGreaterThan(0));
  return tileNames();
}

/** The seeded record behind a name the page rendered, so a relation a case asserts is the data's own. */
export function productNamed(name: string): Product {
  const record = PRODUCTS.find((product) => product.name === name);
  if (record === undefined) throw new Error(`No seeded product is named "${name}".`);
  return record;
}

/** One showcase tile as its data: the element, the category it names and the count it states. */
export function showcaseTile(entry: HTMLElement): {
  readonly entry: HTMLElement;
  readonly label: string;
  readonly count: number;
} {
  return {
    entry,
    label: textOf(within(entry).getByRole("heading", { level: 3 })),
    count: statedCount(textOf(entry)) ?? 0,
  };
}

/** A heading of a level, awaited: a page's own title lands with the data it names. */
export async function headingNamed(name: string | RegExp, level = 1): Promise<HTMLElement> {
  return screen.findByRole("heading", { level, name });
}

/** The facet drawer, opened when it is not already up: below the extra-large stop the panel is the
 *  drawer's contents, so the facets are reached the way a phone reaches them. */
export async function facetDrawer(user: UserEvent): Promise<HTMLElement> {
  const open = screen.queryByRole("dialog", { name: SEARCH_COPY.FILTER_PANEL_HEADING });
  if (open !== null) return open;
  const trigger = new RegExp(`^${SEARCH_COPY.OPEN_FILTERS_LABEL}`);
  await user.click(screen.getByRole("button", { name: trigger }));
  return screen.findByRole("dialog", { name: SEARCH_COPY.FILTER_PANEL_HEADING });
}

/** The link a name reaches, which is how every destination in the product is offered. */
export function linkNamed(name: string | RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

/** The header navigation's current destination(s), read from the attribute the sheet paints the state from. */
export function currentDestinations(): HTMLElement[] {
  const nav = screen.getByRole("navigation", { name: A11Y_COPY.MAIN_NAV_LABEL });
  return within(nav)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
}

/** The button a name reaches. */
export function buttonNamed(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** A `MediaQueryList` answering `matches`, which is all `useMediaQuery` reads from it: how a case states a
 *  viewport width, which jsdom lays nothing out to infer. `tests/setup.ts` installs its own shim after every
 *  case, so an override here cannot reach the case after it. */
export function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  const noop = (): void => undefined;
  return {
    media: query,
    matches,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

/** The desktop presentation: every `min-width` query satisfied, which is the viewport the facet panel is the
 *  column beside the results at rather than the contents of the drawer the small stops reach it through. */
export function desktopViewport(): void {
  window.matchMedia = (query: string) => mediaQueryList(query, query.includes("min-width"));
}

/**
 * Registers the isolation both journey files open their cases with: the seam is handed back in the state a fresh
 * case expects, so a failure an earlier case armed and never triggered cannot answer this case's request, and
 * the clock goes back to real timers with it. `tests/setup.ts` clears the seam between cases as well; what this
 * adds is that the case opens against a seam of its own, from the one place both files register it.
 */
export function isolateJourneyCases(): void {
  beforeEach(() => {
    resetApiState();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
