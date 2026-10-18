/**
 * Path: tests/integration/shoppingFlow.test.tsx
 * Purpose: Home, catalogue, search and add-to-cart, including their empty and error states.
 * Lines: 517
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  RELATED_PRODUCTS_LIMIT,
  SEARCH_SUGGESTION_LIMIT,
} from "@/constants/config";
import * as content from "@/constants/content";
import { ROUTES, productPath } from "@/constants/routes";
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
  CATALOG_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  HOME_COPY,
  SEARCH_COPY,
  cartButtonLabel,
  categoryPageHeading,
  productCountAnnouncement,
  productCountLabel,
  quantityLabel,
  ratingSummaryLabel,
  removeFilterLabel,
} = content;
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

/** The facet drawer, opened when it is not already up: below the medium breakpoint the panel is the
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

/** The button a name reaches. */
function buttonNamed(name: string): HTMLElement {
  return screen.getByRole("button", { name });
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

    const tile = tileHeadings()[0];
    const product = productNamed(textOf(tile));
    const quickAdd = within(tile.closest("li") ?? tile).getByRole("button", {
      name: CATALOG_COPY.QUICK_ADD_LABEL,
    });
    const name = { name: CART_COPY.MINI_CART_HEADING };
    const rowsOf = (scope: HTMLElement): HTMLElement[] =>
      within(scope).getAllByRole("spinbutton", { name: quantityLabel(product.name) });

    await user.click(quickAdd);

    expect(await screen.findByRole("button", { name: cartButtonLabel(1) })).toBeInTheDocument();
    expect(rowsOf(await screen.findByRole("dialog", name))).toHaveLength(1);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", name)).toBeNull());

    // The second add is the same product again, so it lands in the line the cart already holds.
    await user.click(quickAdd);

    expect(await screen.findByRole("button", { name: cartButtonLabel(2) })).toBeInTheDocument();
    await user.click(buttonNamed(cartButtonLabel(2)));
    const rows = rowsOf(await screen.findByRole("dialog", name));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveValue(2);
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

    expect(await headingNamed(EMPTY_STATES.searchResults.title, 3)).toBeInTheDocument();
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
});
