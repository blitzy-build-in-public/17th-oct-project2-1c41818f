/**
 * Path: tests/integration/shoppingFlow.test.tsx
 * Purpose: Home, catalogue, search and add-to-cart, including their empty and error states.
 * Lines: 787
 */

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * Four slices of the product driven through the real application: `renderApp` mounts `src/App.tsx`, the
 * providers, the pages and the seeded data source, so a case asserts what a visitor sees. Query state lives
 * only in the URL, which is why every case asserts the rendered result set and why the reload case remounts
 * through `src/utils/queryParams.ts`'s own writers — a `MemoryRouter` never touches `window.location`. The
 * empty state is reached by a term that matches nothing and the error state through the seam's own failure
 * switch. Every input comes from the seeded records or the copy module, so no figure and no sentence is typed.
 */

// The case's inputs, taken from the records the application is answered from --------------------------

/**
 * The words a case asserts by, the sort it chooses and the records it acts on: the copy module owns every
 * sentence, the taxonomy owns the sort keys, and the seeded collections own the subjects.
 */
const {
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
const { HOME_COPY } = content;
const TRUST_CLAIMS = [
  HOME_COPY.TRUST_REVIEWS_CLAIM,
  HOME_COPY.TRUST_CART_CLAIM,
  HOME_COPY.TRUST_CHECKOUT_CLAIM,
] as const;
const PRICE_ASCENDING_SORT: SortKey = "price-asc";
const SELECTED_BRAND = BRANDS[0];
const OTHER_BRAND = BRANDS[1];
/** A product the storefront can sell, so its buy controls act rather than report themselves unavailable. */
const SELLABLE_PRODUCT = PRODUCTS.find((product) => product.stockOnHand > 1) ?? PRODUCTS[0];
/** The separator a facet writes between a term and its count inside the control's own name. */
const FACET_COUNT_SEPARATOR = " \u00b7 ";
const MONEY_PATTERN = /\$[0-9][0-9,]*\.[0-9]{2}/;
/** How an availability line reads, in the copy module's own words: plenty, low, or none. */
const AVAILABILITY_PATTERN = new RegExp(
  `^(${CATALOG_COPY.IN_STOCK_LABEL}|${CATALOG_COPY.OUT_OF_STOCK_LABEL}|Only [0-9]+ left in stock)$`,
);

// Reading the rendered surface -----------------------------------------------------------------------

/** An element's text, with the whitespace its markup introduces collapsed. */
function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The results region both listing surfaces render: the heading over the grid names it, and the footer's
 *  own headings sit outside it. */
function resultsRegion(): HTMLElement {
  return screen.getByRole("region", { name: CATALOG_COPY.RESULTS_REGION_LABEL });
}

/** Every product tile the page is showing, in the order it renders them: the tiles' own names. A listing
 *  that is still loading, that failed or that matched nothing shows none. */
function tileHeadings(): HTMLElement[] {
  return within(resultsRegion()).queryAllByRole("heading", { level: 3 });
}

/** The names of the rendered tiles, in order. */
function tileNames(): string[] {
  return tileHeadings().map((heading) => textOf(heading));
}

/** The money each tile shows as minor units and in order: a tile's first amount is the price a price sort
 *  orders by. */
function tilePricesMinor(): number[] {
  return tileHeadings().map((heading) => {
    const money = MONEY_PATTERN.exec((heading.closest("li") ?? heading).textContent ?? "");
    return money === null ? 0 : parseMoneyToMinor(money[0]);
  });
}

/** The number a piece of count wording states, read from the template the copy module builds it with. */
function statedCount(text: string): number | null {
  const noun = productCountLabel(2).replace("2 ", "");
  const match = new RegExp(`([0-9][0-9,]*) ${noun}\\b`).exec(text);
  return match === null ? null : Number(match[1].replace(/,/g, ""));
}

/** The count a facet control announces in its own accessible name, or `-1` when it announces none. */
function controlCount(control: HTMLElement): number {
  return statedCount(control.getAttribute("aria-label") ?? "") ?? -1;
}

/** The checkbox a facet renders for a term, found by the name the panel builds for that control. */
function facetTermControl(scope: HTMLElement, termName: string): HTMLElement {
  return within(scope).getByRole("checkbox", {
    name: new RegExp(`^${termName}${FACET_COUNT_SEPARATOR}`),
  });
}

/** The result total the surface announces, awaited: the polite region is present from the first render and
 *  is given its text once the request lands. */
async function announcedTotal(): Promise<number> {
  let total = -1;
  await waitFor(() => expect((total = readAnnouncedTotal())).toBeGreaterThanOrEqual(0));
  return total;
}

/** The total the polite live region states right now, or `-1` before a page has announced one. */
function readAnnouncedTotal(): number {
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
async function settledTiles(): Promise<string[]> {
  await waitFor(() => expect(tileNames().length).toBeGreaterThan(0));
  return tileNames();
}

/** The seeded record behind a name the page rendered, so a relation a case asserts is the data's own. */
function productNamed(name: string): Product {
  const record = PRODUCTS.find((product) => product.name === name);
  if (record === undefined) throw new Error(`No seeded product is named "${name}".`);
  return record;
}

/** One showcase tile as its data: the element, the category it names and the count it states. */
function showcaseTile(entry: HTMLElement): {
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
async function headingNamed(name: string | RegExp, level = 1): Promise<HTMLElement> {
  return screen.findByRole("heading", { level, name });
}

/** The facet drawer, opened when it is not already up: below the extra-large stop the panel is the
 *  drawer's contents, so the facets are reached the way a phone reaches them. */
async function facetDrawer(user: UserEvent): Promise<HTMLElement> {
  const open = screen.queryByRole("dialog", { name: SEARCH_COPY.FILTER_PANEL_HEADING });
  if (open !== null) return open;
  const trigger = new RegExp(`^${SEARCH_COPY.OPEN_FILTERS_LABEL}`);
  await user.click(screen.getByRole("button", { name: trigger }));
  return screen.findByRole("dialog", { name: SEARCH_COPY.FILTER_PANEL_HEADING });
}

/** The link a name reaches, which is how every destination in the product is offered. */
function linkNamed(name: string | RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

/** The header navigation's current destination(s), read from the attribute the sheet paints the state from. */
function currentDestinations(): HTMLElement[] {
  const nav = screen.getByRole("navigation", { name: A11Y_COPY.MAIN_NAV_LABEL });
  return within(nav)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
}

/** The button a name reaches. */
function buttonNamed(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** A `MediaQueryList` answering `matches`, which is all `useMediaQuery` reads from it: how a case states a
 *  viewport width, which jsdom lays nothing out to infer. `tests/setup.ts` installs its own shim after every
 *  case, so an override here cannot reach the case after it. */
function mediaQueryList(query: string, matches: boolean): MediaQueryList {
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
function desktopViewport(): void {
  window.matchMedia = (query: string) => mediaQueryList(query, query.includes("min-width"));
}

describe("the shopper's browse-and-add journey", () => {
  beforeEach(() => {
    resetApiState();
  });

  // A case's armed failure or clock must not reach the next one: the setup file clears the seam between
  // cases and this puts the clock back as well.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the landing route's four sections from the seeded catalogue", async () => {
    renderApp({ route: ROUTES.HOME });

    expect(await headingNamed(HOME_COPY.HERO_HEADLINE)).toBeInTheDocument();
    const hero = screen.getByRole("region", { name: HOME_COPY.HERO_HEADLINE });
    const primary = within(hero).getByRole("link", { name: HOME_COPY.HERO_PRIMARY_ACTION_LABEL });
    const secondary = within(hero).getByRole("link", {
      name: HOME_COPY.HERO_SECONDARY_ACTION_LABEL,
    });
    expect(primary).toHaveAttribute("href", ROUTES.CATALOG);
    expect(secondary).toHaveAttribute("href", ROUTES.SEARCH);
    for (const claim of TRUST_CLAIMS) expect(screen.getByText(claim)).toBeInTheDocument();

    const featured = await screen.findByRole("region", { name: HOME_COPY.FEATURED_TITLE });
    const strip = await within(featured).findAllByRole("heading", { level: 3 });
    expect(strip.length).toBeGreaterThan(0);
    expect(strip.length).toBeLessThanOrEqual(RELATED_PRODUCTS_LIMIT);
    for (const heading of strip) {
      const tile = within(heading).getByRole("link");
      expect(tile).toHaveAttribute("href", productPath(productNamed(textOf(heading)).slug));
    }

    const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });
    const tiles = await within(showcase).findAllByRole("listitem");
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(statedCount(textOf(tile))).not.toBeNull();

    const promo = screen.getByRole("region", { name: HOME_COPY.PROMO_HEADING });
    const action = within(promo).getByRole("link", { name: HOME_COPY.PROMO_ACTION_LABEL });
    expect(action).toHaveAttribute("href", ROUTES.CATALOG);
  });

  it("scopes the catalogue to the category a showcase tile names", async () => {
    const { user } = renderApp({ route: ROUTES.HOME });
    const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });

    // The tile to follow is the one whose count is a leaf category's own: the catalogue is larger than any
    // one category and a parent holds nothing, so the tile's count is what the listing behind it announces.
    const tiles = (await within(showcase).findAllByRole("listitem")).map(showcaseTile);
    const tile = tiles.find((entry) => entry.count > 0 && entry.count < PRODUCTS.length);
    if (tile === undefined)
      throw new Error("The showcase offered no category that scopes the catalogue.");

    await user.click(within(tile.entry).getByRole("link"));

    // The scoped listing replaces the whole catalogue's, so the count it announces is awaited rather than
    // read on the frame the navigation lands on; the page it shows is the count, cut to the page size.
    await waitFor(() => expect(readAnnouncedTotal()).toBe(tile.count));
    expect(tileNames()).toHaveLength(Math.min(tile.count, DEFAULT_PAGE_SIZE));
    const chips = screen.getByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING });
    expect(within(chips).getByText(tile.label)).toBeInTheDocument();

    // The scoped listing is a catalogue listing, so the header marks the catalogue destination and nothing
    // else while the visitor is on it.
    const current = currentDestinations();
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(HEADER_COPY.NAV_CATALOG_LABEL);
  });

  it("marks the catalogue destination current on a category's own route", async () => {
    const category = CATEGORY_DEFINITIONS.find((definition) => definition.parentSlug !== null);
    if (category === undefined) throw new Error("The taxonomy declares no category listing.");

    // The route is loaded directly rather than reached from a tile: a category's own pathname, `/category/<slug>`,
    // is not inside `/catalog` as a path, which is the case the header's rule has to cover for the one
    // destination two routes reach.
    renderApp({ route: categoryPath(category.slug) });
    await settledTiles();

    const current = currentDestinations();
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(HEADER_COPY.NAV_CATALOG_LABEL);
  });

  it("pages the catalogue and marks the page it is showing", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    const total = await announcedTotal();
    expect(total).toBeGreaterThan(DEFAULT_PAGE_SIZE);

    const firstPage = await settledTiles();
    expect(firstPage).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(buttonNamed("1")).toHaveAttribute("aria-current", "page");

    await user.click(buttonNamed(COMMON_ACTIONS.NEXT));

    await waitFor(() => {
      expect(tileNames()).toHaveLength(firstPage.length);
      expect(tileNames()).not.toEqual(firstPage);
    });
    expect(buttonNamed("2")).toHaveAttribute("aria-current", "page");
    expect(await announcedTotal()).toBe(total);
  });

  it("keeps every other brand's count meaningful while one brand is applied", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    const before = await announcedTotal();
    const dialog = await facetDrawer(user);

    for (const definition of FACET_DEFINITIONS) {
      expect(within(dialog).getByRole("group", { name: definition.label })).toBeInTheDocument();
    }

    const brand = facetTermControl(dialog, SELECTED_BRAND.name);
    const selected = controlCount(brand);
    expect(selected).toBeGreaterThan(0);
    expect(controlCount(facetTermControl(dialog, OTHER_BRAND.name))).toBeGreaterThan(0);

    await user.click(brand);

    await waitFor(() => expect(readAnnouncedTotal()).toBe(selected));
    expect(selected).toBeLessThan(before);
    // The rule this case exists for: a facet is counted with its own selection excluded, so applying one
    // brand leaves the other brands' counts standing instead of driving every one of them to zero.
    expect(controlCount(facetTermControl(dialog, OTHER_BRAND.name))).toBeGreaterThan(0);

    const chips = screen.getByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING });
    await user.click(
      within(chips).getByRole("button", { name: removeFilterLabel(SELECTED_BRAND.name) }),
    );

    await waitFor(() => expect(readAnnouncedTotal()).toBe(before));
  });

  it("orders the visible prices when the ascending-price sort is chosen", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await announcedTotal();

    const sort = screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL);
    await user.selectOptions(sort, PRICE_ASCENDING_SORT);

    expect(sort).toHaveValue(PRICE_ASCENDING_SORT);
    await waitFor(() => {
      const prices = tilePricesMinor();
      expect(prices.length).toBeGreaterThan(1);
      expect(prices).toEqual([...prices].sort((left, right) => left - right));
    });
  });

  it("reloads a searched, filtered and sorted URL to the identical result set", async () => {
    const { user, unmount } = renderApp({ route: ROUTES.SEARCH });

    const field = await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);
    await user.type(field, SELECTED_BRAND.name);
    await user.keyboard("{Enter}");
    await announcedTotal();

    await user.click(facetTermControl(await facetDrawer(user), SELECTED_BRAND.name));
    await user.selectOptions(
      screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL),
      PRICE_ASCENDING_SORT,
    );
    const rendered = await settledTiles();

    unmount();

    const term = setQuery(DEFAULT_FILTER_STATE, SELECTED_BRAND.name);
    const filtered = toggleFacetValue(term, "brand", SELECTED_BRAND.id);
    renderApp({ route: filtersToPath(ROUTES.SEARCH, withSort(filtered, PRICE_ASCENDING_SORT)) });

    await waitFor(() => expect(tileNames()).toEqual(rendered));
  });

  it("suggests a capped, grouped list and takes the keyboard's choice to a product", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const field = await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);
    await user.type(field, SELECTED_BRAND.name);

    const list = await screen.findByRole("listbox", { name: SEARCH_COPY.SUGGESTIONS_LIST_LABEL });
    const options = within(list).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(SEARCH_SUGGESTION_LIMIT);
    expect(within(list).getAllByRole("group").length).toBeGreaterThan(0);

    await user.keyboard("{ArrowDown}");
    expect(within(list).getByRole("option", { selected: true })).toBeInTheDocument();
    await user.keyboard("{Enter}");

    // The best-ranked row for a typed brand name is one of that brand's products, so the choice opens a
    // product page — the page is re-read on every attempt, because the heading it shows is a new element.
    await waitFor(() => {
      const landed = screen.getByRole("heading", { level: 1 });
      expect(productNamed(textOf(landed)).brandId).toBe(SELECTED_BRAND.id);
    });
  });

  it("opens a product from the catalogue with its fields, tabs and related strip", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await settledTiles();

    const heading = tileHeadings().find((entry) => productNamed(textOf(entry)).ratingCount > 0);
    if (heading === undefined) throw new Error("The page rendered no reviewed product.");
    const product = productNamed(textOf(heading));
    await user.click(within(heading).getByRole("link"));

    expect(await headingNamed(product.name)).toBeInTheDocument();
    expect(screen.getByText(product.description)).toBeInTheDocument();
    for (const feature of product.features) {
      expect(screen.getAllByText(feature).length).toBeGreaterThan(0);
    }
    expect(
      screen.getAllByText(formatMoney(product.priceMinor, product.currency)).length,
    ).toBeGreaterThan(0);
    if (product.listPriceMinor > product.priceMinor) {
      const list = formatMoney(product.listPriceMinor, product.currency);
      expect(screen.getAllByText(list).length).toBeGreaterThan(0);
    }
    const rated = ratingSummaryLabel(formatRatingValue(product.ratingAverage), product.ratingCount);
    expect(screen.getAllByText(rated).length).toBeGreaterThan(0);
    expect(screen.getAllByText(AVAILABILITY_PATTERN).length).toBeGreaterThan(0);

    // The gallery's strip is keyboard navigable from the thumbnail it marks as the picture on show.
    const gallery = screen.getByRole("group", { name: product.name });
    const thumbs = within(gallery).getAllByRole("button");
    expect(thumbs).toHaveLength(product.images.length);
    expect(thumbs[0]).toHaveAttribute("aria-current", "true");
    thumbs[0].focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(thumbs[1]).toHaveAttribute("aria-current", "true"));

    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.SPECIFICATIONS_HEADING }));
    for (const spec of product.specs) {
      expect(screen.getAllByText(spec.label).length).toBeGreaterThan(0);
    }

    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
    const reviews = screen.getByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    expect(within(reviews).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByLabelText(CATALOG_COPY.REVIEWS_RATING_FILTER_LABEL)).toBeInTheDocument();

    // Every related product is drawn from the category the product being read sits in.
    const related = await screen.findByRole("region", { name: CATALOG_COPY.RELATED_HEADING });
    const relatedTiles = await within(related).findAllByRole("heading", { level: 3 });
    expect(relatedTiles.length).toBeGreaterThan(0);
    expect(relatedTiles.length).toBeLessThanOrEqual(RELATED_PRODUCTS_LIMIT);
    for (const tile of relatedTiles) {
      expect(productNamed(textOf(tile)).categoryId).toBe(product.categoryId);
    }
  });

  it("moves the header badge from a card's quick add, merging a repeat into one line", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await settledTiles();

    // WCAG 2.5.3 (Label in Name): the words a control shows have to be inside the name it answers to. An
    // empty cart draws no badge, so the name has the word alone to carry.
    const emptyCart = buttonNamed(cartButtonLabel(0));
    expect(emptyCart.getAttribute("aria-label")).toContain(textOf(emptyCart));

    const tile = tileHeadings()[0];
    const product = productNamed(textOf(tile));
    const quickAdd = within(tile.closest("li") ?? tile).getByRole("button", {
      name: quickAddLabel(product.name),
    });
    const drawerName = { name: CART_COPY.MINI_CART_HEADING };
    const rowsOf = (scope: HTMLElement): HTMLElement[] =>
      within(scope).getAllByRole("spinbutton", { name: quantityLabel(product.name) });

    await user.click(quickAdd);

    // The add reports itself where it was performed — the badge moves and the message names the product —
    // and it leaves the drawer closed: the drawer is a modal whose background is inert, so opening it on
    // the shopper's behalf would cost a dismissal before the next add.
    const badge = await screen.findByRole("button", { name: cartButtonLabel(1) });
    expect(await screen.findByText(addedToCartMessage(product.name))).toBeInTheDocument();
    expect(screen.queryByRole("dialog", drawerName)).toBeNull();

    // The badge is the way in, and the dialog dismisses on Escape and hands the focus back to it.
    await user.click(badge);

    expect(rowsOf(await screen.findByRole("dialog", drawerName))).toHaveLength(1);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", drawerName)).toBeNull());
    expect(badge).toHaveFocus();

    // The second add is the same product again, so it lands in the line the cart already holds and needs
    // no dismissal first.
    await user.click(quickAdd);

    const secondBadge = await screen.findByRole("button", { name: cartButtonLabel(2) });
    expect(screen.queryByRole("dialog", drawerName)).toBeNull();

    // The same rule once a badge is drawn: its digit is visible text, so the name has to carry the words
    // "Cart 2" as well as the count it spells out.
    expect(secondBadge.getAttribute("aria-label")).toContain(textOf(secondBadge));

    // And no two navigation landmarks answer to one name: the shell draws the header's row and the mobile
    // panel under two labels, and only the width decides which of them the visitor meets.
    const landmarkNames = screen
      .getAllByRole("navigation", { hidden: true })
      .map((landmark) => landmark.getAttribute("aria-label"));
    expect(landmarkNames).toEqual(
      expect.arrayContaining([A11Y_COPY.MAIN_NAV_LABEL, A11Y_COPY.MOBILE_NAV_LABEL]),
    );
    expect(new Set(landmarkNames).size).toBe(landmarkNames.length);

    await user.click(secondBadge);

    const rows = rowsOf(await screen.findByRole("dialog", drawerName));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveValue(2);
  });

  it("states an out-of-stock quick add's refusal without changing the cart", async () => {
    // The tile to activate is the catalogue's own: a product its tile cannot sell, found among the tiles
    // the listing renders rather than through a search term, whose matching rules belong to another module.
    const { user } = renderApp({
      route: filtersToPath(ROUTES.CATALOG, { ...DEFAULT_FILTER_STATE, pageSize: 48 }),
    });
    await settledTiles();

    const heading = tileHeadings().find((entry) =>
      textOf(entry.closest("li") ?? entry).includes(CATALOG_COPY.OUT_OF_STOCK_LABEL),
    );
    if (heading === undefined) {
      throw new Error("The listing showed no product the storefront cannot sell.");
    }
    const quickAdd = within(heading.closest("li") ?? heading).getByRole("button", {
      name: quickAddLabel(textOf(heading)),
    });
    // The state the control reports itself unavailable in, which is the state the refusal explains.
    expect(quickAdd).toHaveAttribute("aria-disabled", "true");

    await user.click(quickAdd);

    // A control the shopper can reach either acts or explains itself: the refusal is announced, and the
    // cart holds nothing and no drawer is opened.
    const announcement = await screen.findByRole("alert");
    expect(announcement).toHaveTextContent(CATALOG_COPY.OUT_OF_STOCK_LABEL);
    expect(screen.getByRole("button", { name: cartButtonLabel(0) })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: CART_COPY.MINI_CART_HEADING })).toBeNull();
  });

  it("adds the quantity the detail page's stepper holds", async () => {
    const { user } = renderApp({ route: productPath(SELLABLE_PRODUCT.slug) });
    const stepper = await screen.findByRole("spinbutton", {
      name: quantityLabel(SELLABLE_PRODUCT.name),
    });

    const more = `${quantityLabel(SELLABLE_PRODUCT.name)}: ${COMMON_ACTIONS.ADD}`;
    await user.click(buttonNamed(more));
    expect(stepper).toHaveValue(2);

    await user.click(buttonNamed(CATALOG_COPY.ADD_TO_CART_LABEL));

    expect(await screen.findByRole("button", { name: cartButtonLabel(2) })).toBeInTheDocument();
  });

  it("offers a way out of a search that matches nothing", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    await user.type(await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL), "zzzqqqxyz");
    await user.keyboard("{Enter}");

    expect(await headingNamed(EMPTY_STATES.searchResults.title, 2)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATES.searchResults.description)).toBeInTheDocument();
    expect(linkNamed(EMPTY_STATES.searchResults.actionLabel)).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );

    // That action is a plain anchor the router does not own, so its destination is asserted rather than
    // followed; the recovery chips beside it are the route's own way into a listing that holds something.
    const category = CATEGORY_DEFINITIONS.find((definition) => definition.parentSlug === null);
    if (category === undefined) throw new Error("The taxonomy declares no parent category.");
    await user.click(linkNamed(category.name));

    expect(await headingNamed(categoryPageHeading(category.name))).toBeInTheDocument();
    await waitFor(() => expect(tileNames().length).toBeGreaterThan(0));
  });

  // A term holding nothing searchable filters nothing — that is the search's own documented reading — so the
  // catalogue stands rather than the route claiming a match, and the notice says the address's term was not
  // applied. Both terms here hold no token: one is a lone character, the other punctuation only.
  it.each(["q", "<<>>&&\"\"''%%;;--"])(
    "says the term %s was not applied rather than listing the catalogue as its answer",
    async (ignored) => {
      renderApp({ route: filtersToPath(ROUTES.SEARCH, setQuery(DEFAULT_FILTER_STATE, ignored)) });

      const notice = await screen.findByRole("status", {
        name: SEARCH_COPY.QUERY_NOT_APPLIED_TITLE,
      });
      expect(notice).toHaveTextContent(SEARCH_COPY.QUERY_NOT_APPLIED_TITLE);
      expect(notice).toHaveTextContent(SEARCH_COPY.QUERY_NOT_APPLIED_DESCRIPTION);
      // The term filters nothing, so the catalogue is listed as it is without one, and the page says the term
      // was not applied rather than leaving the listing to read as that term's own answer.
      expect(await settledTiles()).toHaveLength(DEFAULT_PAGE_SIZE);
    },
  );

  it("renders the seam's own failure with a retry that recovers", async () => {
    const failure = failNext({ path: API_PATHS.PRODUCTS });
    const { user } = renderApp({ route: ROUTES.CATALOG });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    expect(tileNames()).toHaveLength(0);

    failure.disarm();
    await user.click(buttonNamed(COMMON_ACTIONS.RETRY));

    await waitFor(() => expect(tileNames().length).toBeGreaterThan(0));
  });

  it("removes only the value a chip's removal names, leaving the facet's other values applied", async () => {
    // Two brands of one facet applied is the state in which clearing the wrong thing shows.
    const brands = { ...DEFAULT_FILTER_STATE, brandIds: [SELECTED_BRAND.id, OTHER_BRAND.id] };
    const { user } = renderApp({ route: filtersToPath(ROUTES.CATALOG, brands) });
    const chips = await screen.findByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING });
    // The load that carries the chips also carries the facets the panel reads, so the panel is opened after it.
    await announcedTotal();

    await user.click(
      within(chips).getByRole("button", { name: removeFilterLabel(OTHER_BRAND.name) }),
    );

    // The named value alone went: the other brand still chips, and the facet beneath still holds it.
    expect(within(chips).getByText(SELECTED_BRAND.name)).toBeInTheDocument();
    expect(within(chips).queryByText(OTHER_BRAND.name)).toBeNull();
    const panel = await facetDrawer(user);
    expect(facetTermControl(panel, SELECTED_BRAND.name)).toBeChecked();
    expect(facetTermControl(panel, OTHER_BRAND.name)).not.toBeChecked();
    await waitFor(() =>
      expect(readAnnouncedTotal()).toBe(controlCount(facetTermControl(panel, SELECTED_BRAND.name))),
    );
  });

  it("escapes an empty category route through the empty state's own action", async () => {
    // A parent the taxonomy declares without children holds no product, so its route legitimately lists nothing.
    const parents = CATEGORY_DEFINITIONS.filter((definition) => definition.parentSlug === null);
    const empty = parents.find(
      (parent) => !CATEGORY_DEFINITIONS.some((child) => child.parentSlug === parent.slug),
    );
    if (empty === undefined)
      throw new Error("The taxonomy declares no category that lists nothing.");
    const picked = { ...DEFAULT_FILTER_STATE, sort: PRICE_ASCENDING_SORT };
    const { user } = renderApp({ route: filtersToPath(categoryPath(empty.slug), picked) });

    expect(await headingNamed(EMPTY_STATES.catalogue.title, 2)).toBeInTheDocument();
    // The empty state's one action is inside the results region, not the chip row's own clear-all above it.
    await user.click(
      within(resultsRegion()).getByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL }),
    );

    // It leaves the category route rather than being written back by the route's own scope guard: the whole
    // catalogue lists, the cleared filter is gone and the sort the visitor chose crosses with the hand-off.
    await waitFor(() => expect(readAnnouncedTotal()).toBe(PRODUCTS.length));
    expect(await headingNamed(PAGE_TITLES.CATALOG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: categoryPageHeading(empty.name) })).toBeNull();
    expect(screen.queryByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING })).toBeNull();
    expect(screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL)).toHaveValue(PRICE_ASCENDING_SORT);
  });
});
it("announces one failed search once, with one recovery action, and recovers on retry", async () => {
  // The desktop presentation is the one carrying the facet column beside the results, which is where the same
  // failure was announced a second time; the panel the case does not see is the drawer's contents.
  desktopViewport();
  const { user } = renderApp({ route: ROUTES.SEARCH });
  await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);

  // A term the seeded catalogue holds, so the retry's own answer is observable: the read that failed is the
  // one this query asks for, and the recovery it offers has a result to restore.
  const failure = failNext({ path: API_PATHS.PRODUCTS });
  await user.type(screen.getByLabelText(SEARCH_COPY.FIELD_LABEL), "jacket");
  await user.keyboard("{Enter}");

  // One failed read is one announcement carrying the retry that resolves it, and the whole screen offers that
  // one action: the results region owns the failure, and the facet column beside it repeats neither.
  expect(await screen.findAllByRole("alert")).toHaveLength(1);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
  expect(screen.getAllByRole("button", { name: COMMON_ACTIONS.RETRY })).toEqual([
    within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }),
  ]);
  expect(tileNames()).toHaveLength(0);

  failure.disarm();
  await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

  await waitFor(() => expect(tileNames().length).toBeGreaterThan(0));
});

describe("the catalogue's facet control under a burst", () => {
  /** The category facet value the burst writes, and the label the panel offers it under. */
  const AUDIO_CATEGORY =
    CATEGORY_DEFINITIONS.find((definition) => definition.slug === "audio") ??
    CATEGORY_DEFINITIONS[0];

  beforeEach(() => {
    resetApiState();
  });

  it("leaves the facet unselected after ten clicks delivered in one task", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    const total = await announcedTotal();
    const control = facetTermControl(await facetDrawer(user), AUDIO_CATEGORY.name);

    // Ten clicks are ten toggles, so the facet is left unselected and the listing unfiltered: a click composing
    // from its render's params instead of from the write before it would leave an odd parity behind.
    act(() => {
      for (let click = 0; click < 10; click += 1) control.click();
    });

    expect(control).not.toBeChecked();
    await waitFor(() => expect(readAnnouncedTotal()).toBe(total));
  });
});

/*
 * The state every surface that can resolve nothing shares: the catch-all route, a category segment naming no
 * category and a product segment naming no product render the one view `src/components/ui/NotFoundView.tsx`
 * owns, so each names itself in the tab and heads itself with the page's one `<h1>`. The segments are written
 * out because a case's whole subject is an address that resolves to nothing.
 */
describe("an address the product cannot serve", () => {
  it.each([
    ["an unmatched address", "/this-route-does-not-exist"],
    ["a category the catalogue does not hold", "/category/does-not-exist"],
    ["a product the catalogue does not hold", "/product/does-not-exist"],
  ])("names %s in the tab and in its only heading", async (_case, route) => {
    renderApp({ route });

    expect(
      await screen.findByRole("heading", { level: 1, name: content.NOT_FOUND_COPY.TITLE }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // The tab is written by a passive effect after the view commits, so it is awaited to the same settle the
    // heading above is, rather than read on the frame the heading appears in.
    await waitFor(() =>
      expect(document.title).toBe(content.documentTitle(content.PAGE_TITLES.NOT_FOUND)),
    );
    expect(screen.getByText(content.NOT_FOUND_COPY.BODY)).toBeVisible();
  });
});
