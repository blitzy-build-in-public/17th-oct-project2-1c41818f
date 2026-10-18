/**
 * Path: tests/integration/shoppingFlow.test.tsx
 * Purpose: Home, catalogue, search and add-to-cart, including their empty and error states
 * Lines: 299
 */

import { describe, expect, it } from "vitest";

import {
  A11Y_COPY,
  API_PATHS,
  CART_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  DEFAULT_FILTER_STATE,
  DEFAULT_PAGE_SIZE,
  EMPTY_STATES,
  FEEDBACK_COPY,
  HOME_COPY,
  PRICE_ASCENDING_SORT,
  PRODUCTS,
  RELATED_PRODUCTS_LIMIT,
  ROUTES,
  SEARCH_COPY,
  SELLABLE_PRODUCT,
  SELECTED_BRAND,
  TRUST_CLAIMS,
  addedToCartMessage,
  announcedTotal,
  buttonNamed,
  cartButtonLabel,
  controlCount,
  facetDrawer,
  facetTermControl,
  failNext,
  filtersToPath,
  headingNamed,
  isolateJourneyCases,
  linkNamed,
  productNamed,
  productPath,
  quantityLabel,
  quickAddLabel,
  readAnnouncedTotal,
  renderApp,
  screen,
  setQuery,
  settledTiles,
  showcaseTile,
  statedCount,
  textOf,
  tileHeadings,
  tileNames,
  tilePricesMinor,
  toggleFacetValue,
  waitFor,
  within,
  withSort,
} from "../helpers/journeyHarness";

/*
 * The home, catalogue and search slices of the product driven through the real application: `renderApp` mounts
 * `src/App.tsx`, the providers, the pages and the seeded data source, so a case asserts what a visitor sees. The
 * add-to-cart journey is the card's quick add, the detail page's stepper and the mini-cart the header badge
 * opens, together with the refusal a product the storefront cannot sell states; the catalogue is entered from a
 * showcase tile, a search is filtered and sorted, and the empty and failed reads a listing can reach are the
 * search's own no-match answer and the seam's armed failure. Every input comes from the seeded records or the
 * copy module, so no figure and no sentence is typed.
 */

/** A term no seeded product matches: the query whose own answer is the empty state. */
const NO_MATCH_TERM = "zzzqqqxyz";

describe("the shopper's home and add-to-cart journey", () => {
  isolateJourneyCases();

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

    await waitFor(() => expect(readAnnouncedTotal()).toBe(tile.count));
    expect(tileNames()).toHaveLength(Math.min(tile.count, DEFAULT_PAGE_SIZE));
    const chips = screen.getByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING });
    expect(within(chips).getByText(tile.label)).toBeInTheDocument();
  });

  it("lists a searched, brand-filtered and price-sorted set whose prices ascend", async () => {
    // The whole address is written through the query module's own writers, so the case states the query the
    // URL carries and the page reads it back rather than typing into a field whose value could drift.
    const query = toggleFacetValue(
      setQuery(DEFAULT_FILTER_STATE, SELECTED_BRAND.name),
      "brand",
      SELECTED_BRAND.id,
    );
    const { user } = renderApp({
      route: filtersToPath(ROUTES.SEARCH, withSort(query, PRICE_ASCENDING_SORT)),
    });

    const total = await announcedTotal();
    expect(total).toBeGreaterThan(1);
    expect(screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL)).toHaveValue(PRICE_ASCENDING_SORT);
    await settledTiles();
    const prices = tilePricesMinor();
    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((left, right) => left - right));

    // The facet the address applies is a filter, so every product the listing offers is that brand's own:
    // the seeded record behind a rendered name is where the brand the tile was filtered by is read from.
    for (const heading of tileHeadings()) {
      expect(productNamed(textOf(heading)).brandId).toBe(SELECTED_BRAND.id);
    }

    // A facet is counted with its own selection excluded, so the brand control reports the filtered total.
    const brand = facetTermControl(await facetDrawer(user), SELECTED_BRAND.name);
    await waitFor(() => expect(controlCount(brand)).toBe(total));
  });

  it("offers the catalogue as the way out of a search that matches nothing", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    await user.type(await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL), NO_MATCH_TERM);
    await user.keyboard("{Enter}");

    // The listing is empty because the query legitimately matched nothing, so the page explains that and
    // offers the one action that leaves it rather than drawing an empty grid.
    expect(await headingNamed(EMPTY_STATES.searchResults.title, 2)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATES.searchResults.description)).toBeInTheDocument();
    expect(linkNamed(EMPTY_STATES.searchResults.actionLabel)).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
  });

  it("reports the seam's failed catalogue read and recovers on its retry", async () => {
    const failure = failNext({ path: API_PATHS.PRODUCTS });
    const { user } = renderApp({ route: ROUTES.CATALOG });

    // The armed failure answers the listing's own read, so the error state is the one the visitor meets and
    // no tile is drawn behind it.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    expect(tileHeadings()).toHaveLength(0);

    failure.disarm();
    await user.click(buttonNamed(COMMON_ACTIONS.RETRY));

    await waitFor(() => expect(tileHeadings().length).toBeGreaterThan(0));
  });
});
