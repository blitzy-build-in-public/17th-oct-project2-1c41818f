/**
 * Path: tests/integration/catalogBrowseFlow.test.tsx
 * Purpose: The catalogue listing's own surfaces, from its paging, category scope, facets, sort and focus hand-off to the search listing's empty, unapplied-term and failed-read states.
 * Lines: 479
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  API_PATHS,
  CATALOG_COPY,
  CATEGORY_DEFINITIONS,
  COMMON_ACTIONS,
  DEFAULT_FILTER_STATE,
  DEFAULT_PAGE_SIZE,
  EMPTY_STATES,
  FACET_DEFINITIONS,
  FEEDBACK_COPY,
  HEADER_COPY,
  HOME_COPY,
  OTHER_BRAND,
  PAGE_TITLES,
  PRICE_ASCENDING_SORT,
  PRODUCTS,
  ROUTES,
  SEARCH_COPY,
  SELECTED_BRAND,
  SORT_OPTIONS,
  act,
  announcedTotal,
  buttonNamed,
  categoryPageHeading,
  categoryPath,
  controlCount,
  currentDestinations,
  desktopViewport,
  facetDrawer,
  facetPanel,
  facetTermControl,
  failNext,
  filtersToPath,
  headingNamed,
  isolateJourneyCases,
  linkNamed,
  mediaQueryList,
  pageBodyRegion,
  readAnnouncedTotal,
  removeFilterLabel,
  renderApp,
  resetApiState,
  resultsRegion,
  screen,
  setQuery,
  settledTiles,
  showcaseTile,
  textOf,
  tileNames,
  tilePricesMinor,
  toggleFacetValue,
  waitFor,
  within,
  withSort,
} from "../helpers/journeyHarness";

/*
 * The catalogue and search slices of the product driven through the real application: `renderApp` mounts
 * `src/App.tsx`, the providers, the pages and the seeded data source, so a case asserts what a visitor sees.
 * Query state lives only in the URL, which is why every case asserts the rendered result set and why the reload
 * case remounts through `src/utils/queryParams.ts`'s own writers — a `MemoryRouter` never touches
 * `window.location`. The empty states are reached by a term or a category that lists nothing and the error
 * states through the seam's own failure switch. Every input comes from the seeded records or the copy module, so
 * no figure and no sentence is typed.
 */

// The two inputs these cases add to the harness's own -------------------------------------------------

/**
 * The term a shopper submits from the term-less search page: one the catalogue answers with several products
 * whose relevance order and newest order differ, which is what tells the two entry points to one query apart.
 */
const SEARCHED_TERM = "headphones";

/** The sort key that needs a term to rank, which is the option a term-less listing cannot apply. */
const RELEVANCE_SORT = "relevance";

/** The names a sort control offers, read from the options it renders rather than counted. */
function offeredSortNames(control: HTMLElement): string[] {
  return within(control)
    .queryAllByRole("option")
    .map((option) => textOf(option));
}

describe("the shopper's catalogue and search journey", () => {
  isolateJourneyCases();

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

  it("hands the focus to the page body when a clearing action takes its own control away", async () => {
    // Every `min-width` query satisfied is the desktop stop, where the panel is the sticky column the
    // handoff serves first: applying a facet there leaves the focus on the control the shopper is working,
    // and clearing one hands it to the region the cleared listing holds.
    window.matchMedia = (query: string): MediaQueryList =>
      mediaQueryList(query, query.includes("min-width"));
    const { user } = renderApp({ route: ROUTES.CATALOG });
    const unfiltered = await announcedTotal();
    const panel = facetPanel();
    const brand = facetTermControl(panel, SELECTED_BRAND.name);

    await user.click(brand);
    await waitFor(() => expect(readAnnouncedTotal()).toBeLessThan(unfiltered));
    expect(brand).toHaveFocus();

    // One facet's own Clear unmounts with the filter it clears, so the focus lands on the page body rather
    // than on the document body it would otherwise be dropped onto.
    const group = brand.closest("fieldset");
    if (group === null) throw new Error("The facet control sits in no group.");
    await user.click(within(group).getByRole("button"));

    await waitFor(() => expect(readAnnouncedTotal()).toBe(unfiltered));
    expect(pageBodyRegion()).toHaveFocus();
    expect(document.body).not.toHaveFocus();

    // The chips row's clear-all above the results, with two facets applied: it unmounts the whole row that holds
    // it, so the same rule hands the focus to the page body rather than dropping it on the document.
    await user.click(facetTermControl(panel, SELECTED_BRAND.name));
    await user.click(facetTermControl(panel, OTHER_BRAND.name));
    await waitFor(() => expect(readAnnouncedTotal()).toBeLessThan(unfiltered));
    const chips = await screen.findByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING });
    await user.click(within(chips).getByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL }));

    await waitFor(() => expect(readAnnouncedTotal()).toBe(unfiltered));
    expect(pageBodyRegion()).toHaveFocus();
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

  it("offers no relevance option until the query carries a term to rank", async () => {
    const relevance = SORT_OPTIONS.find((option) => option.value === RELEVANCE_SORT);
    if (relevance === undefined) throw new Error("The taxonomy declares no relevance sort option.");

    const { unmount } = renderApp({ route: ROUTES.CATALOG });
    await announcedTotal();

    // Relevance ranks against a term, so a term-less listing is not offered an option it cannot apply.
    expect(offeredSortNames(screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL))).not.toContain(
      relevance.label,
    );

    unmount();
    renderApp({
      route: filtersToPath(ROUTES.SEARCH, setQuery(DEFAULT_FILTER_STATE, SEARCHED_TERM)),
    });
    await settledTiles();

    // The same key applies once a term is present, so the control offers it there.
    expect(offeredSortNames(screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL))).toContain(
      relevance.label,
    );
  });

  it("ranks the first search a shopper submits as the same query loaded directly", async () => {
    const submittedSearch = renderApp({ route: ROUTES.SEARCH });
    const field = await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);
    await submittedSearch.user.type(field, SEARCHED_TERM);
    await submittedSearch.user.keyboard("{Enter}");

    const submitted = await settledTiles();
    const termState = setQuery(DEFAULT_FILTER_STATE, SEARCHED_TERM);
    // The submit introduces the term onto a state resting at the term-less default, so the new query's own
    // default applies in its place rather than being pinned into the address: the control holds that sort.
    expect(termState.sort).toBe(RELEVANCE_SORT);
    expect(filtersToPath(ROUTES.SEARCH, termState)).toBe(`${ROUTES.SEARCH}?q=${SEARCHED_TERM}`);
    expect(screen.getByLabelText(CATALOG_COPY.SORT_GROUP_LABEL)).toHaveValue(termState.sort);
    submittedSearch.unmount();

    // One query, one ranking: the address the submit leaves, loaded directly, renders the identical tile order.
    const directLoad = renderApp({ route: filtersToPath(ROUTES.SEARCH, termState) });
    await waitFor(() => expect(tileNames()).toEqual(submitted));
    directLoad.unmount();

    // The term-less default the old submit pinned in would have ordered the search the other way instead, which
    // this term's own results tell apart.
    renderApp({
      route: filtersToPath(ROUTES.SEARCH, withSort(termState, DEFAULT_FILTER_STATE.sort)),
    });
    await waitFor(() => expect(tileNames()).toHaveLength(submitted.length));
    expect(tileNames()).not.toEqual(submitted);
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
    // The empty state's one action is inside the results region, not the chip row's own clear-all above it, and
    // it wears the catalogue empty state's wording so the two controls on this viewport are named apart.
    await user.click(
      within(resultsRegion()).getByRole("button", {
        name: EMPTY_STATES.catalogue.actionLabel,
      }),
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
  // Under the desktop presentation the facet column stands beside the results, so one failed read is announced
  // once with its single retry and the column beside it repeats neither; the panel the case does not see is the
  // drawer's contents.
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
