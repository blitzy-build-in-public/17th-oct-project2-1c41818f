/**
 * Path: tests/integration/catalogBrowseFlow.test.tsx
 * Purpose: The catalogue and search surfaces, from the listing's facets and sort to the suggestions, the product page they open and the addresses that resolve to nothing.
 * Lines: 645
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { loginPath } from "@/constants/routes";
import { formatReviewCount } from "@/utils/format";

import {
  A11Y_COPY,
  API_PATHS,
  AVAILABILITY_PATTERN,
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
  RELATED_PRODUCTS_LIMIT,
  ROUTES,
  SEARCH_COPY,
  SEARCH_SUGGESTION_LIMIT,
  SELECTED_BRAND,
  act,
  announcedTotal,
  buttonNamed,
  categoryPageHeading,
  categoryPath,
  content,
  controlCount,
  currentDestinations,
  desktopViewport,
  facetDrawer,
  facetPanel,
  facetTermControl,
  failNext,
  filtersToPath,
  formatMoney,
  formatRatingValue,
  headingNamed,
  isolateJourneyCases,
  linkNamed,
  mediaQueryList,
  pageBodyRegion,
  productNamed,
  productPath,
  ratingSummaryLabel,
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
  tileHeadings,
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

/*
 * The seam's own simulated latency is the one lever a case has over how long an answer is held in flight:
 * `src/lib/mockServer.ts` reads `VITE_API_LATENCY_MS` per request, and `tests/setup.ts` stubs the suite's own
 * value in at module scope. A pending state a case asserts has to be held long enough for the assertion to
 * see it — at the suite's zero latency an answer can settle in the same flush as the request that asked for
 * it, which left whether the suggestion panel's ring ever painted to the host's scheduling.
 */
const HELD_ANSWER_LATENCY_MS = "1000";
/** The variable the seam reads that latency from. */
const LATENCY_VARIABLE = "VITE_API_LATENCY_MS";
/** The latency the suite runs every read at, which a case that holds one answer restores afterwards. */
const SUITE_API_LATENCY_MS = "0";

/** How a rating summary reads: the copy module's own sentence with both figures left open. */
const RATING_SUMMARY_PATTERN = /^Rated [0-9.]+ from [0-9,]+ reviews?$/;

/** Where a page's rating summaries live: the review list's own and the related strip's tiles each sit in a
 *  named region, so what the pattern leaves outside every region is the product's own summary. */

/** What the review case submits: a star, a title and a body the review rule accepts. */
const SUBMITTED_STAR = "5";
const SUBMITTED_REVIEW_TITLE = "Journey review of the product's own figures";
const SUBMITTED_REVIEW_BODY = "Submitted by this case: the header and the list must move together.";

/** The summary the detail page states for the product, read synchronously so a case can await an assertion. */
function detailRatingSummary(): HTMLElement {
  const regions = screen.queryAllByRole("region");
  const found = screen
    .getAllByText(RATING_SUMMARY_PATTERN)
    .filter((element) => !regions.some((region) => region.contains(element)));
  const first = found[0];
  if (first === undefined || found.length > 1)
    throw new Error(`The product page stated ${String(found.length)} rating summaries of its own.`);
  return first;
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

  it("hands the focus to the page body when a facet panel action takes its own control away", async () => {
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

    // The panel's own clear-all, with two facets applied: the same rule over both controls it removes.
    await user.click(facetTermControl(panel, SELECTED_BRAND.name));
    await user.click(facetTermControl(panel, OTHER_BRAND.name));
    await waitFor(() => expect(readAnnouncedTotal()).toBeLessThan(unfiltered));
    await user.click(within(panel).getByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL }));

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

    // The panel's first answer is held while the case watches it arrive, so the loading ring it announces is
    // asserted rather than raced.
    vi.stubEnv(LATENCY_VARIABLE, HELD_ANSWER_LATENCY_MS);
    try {
      await user.type(field, SELECTED_BRAND.name);
      expect(await screen.findByText(A11Y_COPY.LOADING_ANNOUNCEMENT)).toBeInTheDocument();
    } finally {
      vi.stubEnv(LATENCY_VARIABLE, SUITE_API_LATENCY_MS);
    }

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

  it("keeps the product when its category tree cannot be read, and shortens the trail to it", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await settledTiles();
    const heading = tileHeadings()[0];
    const product = productNamed(textOf(heading));

    // The page's own read of the tree is the one this case refuses: the product's read is answered normally, so
    // the page renders the product it was asked for with the trail it can build without the tree — the
    // shortened home-to-product trail, which is also the render a product page paints while the tree is still
    // in flight. Asserting it here is what makes that render a property of the case rather than of timing.
    const refusal = failNext({ routeId: "categories.list" });
    await user.click(within(heading).getByRole("link"));

    expect(await headingNamed(product.name)).toBeInTheDocument();
    const trail = await screen.findByRole("navigation", { name: A11Y_COPY.BREADCRUMB_LABEL });
    expect(within(trail).getAllByRole("listitem")).toHaveLength(2);
    expect(within(trail).getAllByRole("link")).toEqual([
      within(trail).getByRole("link", { name: PAGE_TITLES.HOME }),
    ]);
    expect(within(trail).getByText(product.name)).toBeInTheDocument();
    refusal.disarm();
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

  it("moves the product's own rating summary with the review the list gains", async () => {
    const product = PRODUCTS.find((entry) => entry.ratingCount > 0);
    if (product === undefined) throw new Error("The seeded catalogue holds no reviewed product.");

    // The review form is offered to a signed-in customer alone, so the session is taken through the real sign-in
    // screen with this product as the path it returns to, which is where the review prompt's own link leads.
    const { user } = renderApp({ route: loginPath(productPath(product.slug)) });
    await user.type(
      await screen.findByLabelText(content.ACCOUNT_COPY.EMAIL_LABEL, { exact: false }),
      DEMO_ACCOUNTS.CUSTOMER_EMAIL,
    );
    await user.type(
      screen.getByLabelText(content.ACCOUNT_COPY.PASSWORD_LABEL, { exact: false }),
      DEMO_ACCOUNTS.PASSWORD,
    );
    await user.click(
      screen.getByRole("button", { name: content.ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }),
    );
    await screen.findByRole("heading", { level: 1, name: product.name });

    // The aggregate the page states before the write, read from the seeded record rather than typed.
    const seededSummary = textOf(detailRatingSummary());
    expect(seededSummary).toBe(
      ratingSummaryLabel(formatRatingValue(product.ratingAverage), product.ratingCount),
    );

    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
    const reviews = screen.getByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    await waitFor(() =>
      expect(within(reviews).getAllByText(formatReviewCount(product.ratingCount))).not.toHaveLength(
        0,
      ),
    );

    const form = screen.getByRole("form", { name: CATALOG_COPY.WRITE_REVIEW_LABEL });
    await user.click(within(form).getByRole("radio", { name: SUBMITTED_STAR }));
    await user.type(
      within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_TITLE_LABEL),
      SUBMITTED_REVIEW_TITLE,
    );
    await user.type(
      within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_BODY_LABEL),
      SUBMITTED_REVIEW_BODY,
    );
    await user.click(
      within(form).getByRole("button", { name: CATALOG_COPY.REVIEW_FORM_SUBMIT_LABEL }),
    );

    // One write, two surfaces: the list gains the row the store now holds, and the summary above it states the
    // review set that row belongs to, so the page stops contradicting the list it is showing.
    const movedCount = formatReviewCount(product.ratingCount + 1);
    await waitFor(() => {
      expect(within(reviews).getAllByText(movedCount)).not.toHaveLength(0);
      expect(textOf(detailRatingSummary())).toContain(movedCount);
    });
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
