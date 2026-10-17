/**
 * Path: tests/unit/state/catalogReducer.test.ts
 * Purpose: Load transitions and the query-fingerprint guard that discards a stale response
 * Lines: 555
 */

import { describe, expect, it } from "vitest";

import * as catalogModule from "@/state/catalogReducer";
import {
  catalogActions,
  catalogFingerprint,
  catalogReducer,
  createInitialCatalogState,
  isStaleResult,
} from "@/state/catalogReducer";
import { DEFAULT_FILTER_STATE } from "@/utils/queryParams";

import {
  FIXED_NOW,
  makeApiError,
  makeBrand,
  makeCategory,
  makeFacet,
  makeFacetValue,
  makePageResult,
  makeProduct,
} from "../../fixtures";

import type { CatalogAction, CatalogState } from "@/state/catalogReducer";
import type { Facet, FilterState, Product } from "@/types/catalog";
import type { ApiError, PageResult } from "@/types/common";

// The subject is a pure function of a state and an action: every case below calls it directly, with
// no render, no provider and no clock — the instant a success settled travels with its own action.

// Test data -------------------------------------------------------------------------------------

/** The unfiltered catalogue as `GET /api/products` reads it: the default selection, whole. */
const UNFILTERED_QUERY: FilterState = DEFAULT_FILTER_STATE;
/** That selection's key: every field holds its default, so the canonical form is empty. */
const UNFILTERED_KEY = "";

/** Category and brand identifiers, all four taken from the fixtures' single identifier generator. */
const CAMERAS = makeCategory({ name: "Cameras" }).id;
const LAPTOPS = makeCategory({ name: "Laptops" }).id;
const AURELIA = makeBrand({ name: "Aurelia Audio" }).id;
const NORTHCREST = makeBrand({ name: "Northcrest" }).id;

/** A search for one term: the query a shopper types into the search field. */
const SEARCH_QUERY: FilterState = { ...UNFILTERED_QUERY, q: "lamp" };
/** A faceted browse at its first page, whose results belong to a different request entirely. */
const BROWSE_QUERY: FilterState = {
  ...UNFILTERED_QUERY,
  categoryIds: [LAPTOPS],
  brandIds: [AURELIA, NORTHCREST],
  inStockOnly: true,
};
/** The keys both queries are recognised by, asked of the module rather than typed out here. */
const SEARCH_KEY = catalogFingerprint(SEARCH_QUERY);
const BROWSE_KEY = catalogFingerprint(BROWSE_QUERY);
/** That same browse one page further in: the two requests differ by the page and nothing else. */
const BROWSE_SECOND_PAGE: FilterState = { ...BROWSE_QUERY, page: 2 };
/** Its key, which differs from the first page's because the page is inside the key. */
const BROWSE_SECOND_PAGE_KEY = catalogFingerprint(BROWSE_SECOND_PAGE);

/** The ranked page a search returns, and the facets that came back with it. */
const SEARCH_PRODUCTS: Product[] = [
  makeProduct({ name: "Aurora Desk Lamp" }),
  makeProduct({ name: "Cascade Speaker" }),
  makeProduct({ name: "Trailhead Kettle" }),
];
const SEARCH_PAGE: PageResult<Product> = makePageResult(SEARCH_PRODUCTS);
/** The browse's second page of a larger result set, so both paging flags are true, not false. */
const BROWSE_PRODUCTS: Product[] = [
  makeProduct({ name: "Harbour Monitor Stand" }),
  makeProduct({ name: "Summit Backpack" }),
];
const BROWSE_PAGE: PageResult<Product> = makePageResult(BROWSE_PRODUCTS, { total: 27, page: 2 });
/** That same result set's first page, with its own items, so an assertion tells the two apart. */
const BROWSE_FIRST_PRODUCTS: Product[] = [
  makeProduct({ name: "Coastal Lantern" }),
  makeProduct({ name: "Driftwood Shelf" }),
];
const BROWSE_FIRST_PAGE: PageResult<Product> = makePageResult(BROWSE_FIRST_PRODUCTS, {
  total: 27,
  page: 1,
});
const SEARCH_FACETS: Facet[] = [
  makeFacet({
    id: "brand",
    values: [
      makeFacetValue({ value: AURELIA, label: "Aurelia Audio", count: 3 }),
      makeFacetValue({ value: NORTHCREST, label: "Northcrest", count: 0, selected: true }),
    ],
  }),
];

/** What a catalogue request reports when it fails, and the same shape naming an offending input. */
const SEARCH_ERROR: ApiError = makeApiError({
  status: 503,
  code: "catalogue-unavailable",
  message: "The catalogue could not be loaded.",
});
const FIELD_ERROR: ApiError = makeApiError({
  status: 422,
  code: "invalid-filter",
  message: "The rating filter is out of range.",
  field: "minRating",
});
/** That failure restated with another offending input: every field but `field` is equal. */
const OTHER_FIELD_ERROR: ApiError = { ...FIELD_ERROR, field: "categoryIds" };

/** An hour after the fixed instant, for proving that a discarded result stamped nothing. */
const LATER_INSTANT = new Date(Date.parse(FIXED_NOW) + 3_600_000).toISOString();
/** A success carrying no instant, which the reducer settles on the one the state already holds. */
const SUCCESS_WITHOUT_INSTANT: CatalogAction = {
  type: "catalog/load-succeeded",
  fingerprint: SEARCH_KEY,
  page: SEARCH_PAGE,
  facets: SEARCH_FACETS,
};

/** The state a load for `query` has reached, built through the reducer's own start transition. */
function stateLoading(
  query: FilterState,
  fingerprint: string = catalogFingerprint(query),
): CatalogState {
  return catalogReducer(
    createInitialCatalogState(),
    catalogActions.loadStarted(query, fingerprint),
  );
}

/** A search state once its page has landed, and once a later request for the same query failed. */
const LOADED_SEARCH: CatalogState = catalogReducer(
  stateLoading(SEARCH_QUERY),
  catalogActions.loadSucceeded(SEARCH_KEY, SEARCH_PAGE, SEARCH_FACETS, FIXED_NOW),
);
const FAILED_SEARCH: CatalogState = catalogReducer(
  LOADED_SEARCH,
  catalogActions.loadFailed(SEARCH_KEY, SEARCH_ERROR),
);

// The transitions -------------------------------------------------------------------------------

describe("createInitialCatalogState", () => {
  const initial = createInitialCatalogState();

  it("starts idle, holding no page of results and no error", () => {
    expect(initial.status).toBe("idle");
    expect(initial.page).toBeNull();
    expect(initial.facets).toEqual([]);
    expect(initial.error).toBeNull();
    expect(initial.loadedAt).toBeNull();
  });

  it("holds no key until a load starts, so a result arriving first is stale", () => {
    expect(initial.fingerprint).toBeNull();
    expect(isStaleResult(initial, catalogFingerprint(UNFILTERED_QUERY))).toBe(true);
  });
});

describe("catalog/load-started", () => {
  it("records the request's key and moves the surface to loading", () => {
    const loading = stateLoading(BROWSE_QUERY);
    expect(loading.status).toBe("loading");
    expect(loading.fingerprint).toBe(BROWSE_KEY);
  });

  it("keys a creator-issued load with the very key its result will carry", () => {
    const loading = catalogReducer(
      createInitialCatalogState(),
      catalogActions.loadStarted(SEARCH_QUERY),
    );
    expect(isStaleResult(loading, SEARCH_KEY)).toBe(false);
    expect(isStaleResult(loading, BROWSE_KEY)).toBe(true);
  });

  it("leaves the state object alone when the same load is already in flight", () => {
    const loading = stateLoading(SEARCH_QUERY);
    expect(catalogReducer(loading, catalogActions.loadStarted(SEARCH_QUERY))).toBe(loading);
  });

  it("replaces the key when a newer request supersedes it", () => {
    const superseded = catalogReducer(
      stateLoading(SEARCH_QUERY),
      catalogActions.loadStarted(BROWSE_QUERY),
    );
    expect(superseded.status).toBe("loading");
    expect(superseded.fingerprint).toBe(BROWSE_KEY);
  });

  it("drops the previous error while keeping the result the shopper was reading", () => {
    const restarting = catalogReducer(FAILED_SEARCH, catalogActions.loadStarted(SEARCH_QUERY));
    expect(restarting.status).toBe("loading");
    expect(restarting.error).toBeNull();
    expect(restarting.page).toEqual(SEARCH_PAGE);
    expect(restarting.facets).toEqual(SEARCH_FACETS);
  });
});

describe("catalog/load-succeeded", () => {
  it("applies the page and the facets it was handed, whole and in order", () => {
    expect(LOADED_SEARCH.status).toBe("success");
    expect(LOADED_SEARCH.page).toEqual(SEARCH_PAGE);
    expect(LOADED_SEARCH.page?.items.map((product) => product.id)).toEqual(
      SEARCH_PRODUCTS.map((product) => product.id),
    );
    expect(LOADED_SEARCH.facets).toEqual(SEARCH_FACETS);
    expect(LOADED_SEARCH.error).toBeNull();
  });

  it("carries a later page and both of its paging flags through unchanged", () => {
    const loadedBrowse = catalogReducer(
      stateLoading(BROWSE_QUERY),
      catalogActions.loadSucceeded(BROWSE_KEY, BROWSE_PAGE, SEARCH_FACETS, FIXED_NOW),
    );
    expect(loadedBrowse.page).toEqual(BROWSE_PAGE);
    expect(loadedBrowse.page?.hasNext).toBe(true);
    expect(loadedBrowse.page?.hasPrevious).toBe(true);
  });

  it("stamps the instant the action carried rather than reading a clock", () => {
    expect(LOADED_SEARCH.loadedAt).toBe(FIXED_NOW);
  });

  it("keeps the instant it already holds when the action carries none", () => {
    const restamped = catalogReducer(LOADED_SEARCH, SUCCESS_WITHOUT_INSTANT);
    expect(restamped.loadedAt).toBe(FIXED_NOW);
    expect(restamped.page).toEqual(SEARCH_PAGE);
  });
});

describe("catalog/load-failed", () => {
  it("stores the error verbatim, down to the field a form reads", () => {
    const failed = catalogReducer(
      stateLoading(SEARCH_QUERY),
      catalogActions.loadFailed(SEARCH_KEY, FIELD_ERROR),
    );
    expect(failed.status).toBe("error");
    expect(failed.error).toEqual(FIELD_ERROR);
    expect(failed.error?.field).toBe("minRating");
  });

  it("keeps the page and the facets so an error renders over the last result read", () => {
    expect(FAILED_SEARCH.status).toBe("error");
    expect(FAILED_SEARCH.error).toEqual(SEARCH_ERROR);
    expect(FAILED_SEARCH.page).toEqual(SEARCH_PAGE);
    expect(FAILED_SEARCH.facets).toEqual(SEARCH_FACETS);
  });

  it("retains the key of the failing query, so a superseded failure is discardable too", () => {
    expect(FAILED_SEARCH.fingerprint).toBe(SEARCH_KEY);
    expect(isStaleResult(FAILED_SEARCH, SEARCH_KEY)).toBe(false);
  });

  it("changes nothing when a retry fails the same way", () => {
    expect(catalogReducer(FAILED_SEARCH, catalogActions.loadFailed(SEARCH_KEY, SEARCH_ERROR))).toBe(
      FAILED_SEARCH,
    );
  });

  it("records a retry that fails differently", () => {
    const failed = catalogReducer(
      stateLoading(SEARCH_QUERY),
      catalogActions.loadFailed(SEARCH_KEY, FIELD_ERROR),
    );
    const refailed = catalogReducer(
      failed,
      catalogActions.loadFailed(SEARCH_KEY, OTHER_FIELD_ERROR),
    );
    expect(refailed).not.toBe(failed);
    expect(refailed.error).toEqual(OTHER_FIELD_ERROR);
  });
});

describe("catalog/reset", () => {
  it("returns the surface to its initial shape", () => {
    const reset = catalogReducer(LOADED_SEARCH, catalogActions.reset());
    expect(reset).toEqual(createInitialCatalogState());
    expect(reset.page).toBeNull();
    expect(reset.facets).toEqual([]);
  });
});

// The fingerprint and the staleness guard --------------------------------------------------------

/** Selections that must each key apart from the unfiltered catalogue and from one another. */
const DISTINCT_QUERIES: [string, FilterState][] = [
  ["a search term", { ...UNFILTERED_QUERY, q: "lamp" }],
  ["another search term", { ...UNFILTERED_QUERY, q: "kettle" }],
  ["a category selection", { ...UNFILTERED_QUERY, categoryIds: [LAPTOPS] }],
  ["a brand selection", { ...UNFILTERED_QUERY, brandIds: [AURELIA] }],
  ["a lower price bound", { ...UNFILTERED_QUERY, minPriceMinor: 2_500 }],
  ["a rating floor", { ...UNFILTERED_QUERY, minRating: 4 }],
  ["the availability toggle", { ...UNFILTERED_QUERY, inStockOnly: true }],
  ["a tag", { ...UNFILTERED_QUERY, tags: ["lighting"] }],
];

describe("catalogFingerprint", () => {
  it("keys one query the same way however often and however it is built", () => {
    const rebuilt: FilterState = {
      inStockOnly: BROWSE_QUERY.inStockOnly,
      brandIds: [...BROWSE_QUERY.brandIds],
      categoryIds: [...BROWSE_QUERY.categoryIds],
      tags: [...BROWSE_QUERY.tags],
      q: BROWSE_QUERY.q,
      minRating: BROWSE_QUERY.minRating,
      minPriceMinor: BROWSE_QUERY.minPriceMinor,
      maxPriceMinor: BROWSE_QUERY.maxPriceMinor,
      sort: BROWSE_QUERY.sort,
      page: BROWSE_QUERY.page,
      pageSize: BROWSE_QUERY.pageSize,
    };
    expect(catalogFingerprint(BROWSE_QUERY)).toBe(BROWSE_KEY);
    expect(catalogFingerprint(rebuilt)).toBe(BROWSE_KEY);
  });

  it("keys the unfiltered catalogue by the empty filter that selection writes", () => {
    expect(catalogFingerprint(UNFILTERED_QUERY)).toBe(UNFILTERED_KEY);
    expect(catalogFingerprint({ ...UNFILTERED_QUERY, q: "   " })).toBe(UNFILTERED_KEY);
  });

  it("erases the order and the repetition of a facet's selected values", () => {
    const ascending = catalogFingerprint({ ...UNFILTERED_QUERY, categoryIds: [CAMERAS, LAPTOPS] });
    const shuffled = catalogFingerprint({
      ...UNFILTERED_QUERY,
      categoryIds: [LAPTOPS, CAMERAS, LAPTOPS],
    });
    expect(shuffled).toBe(ascending);

    const ordered = catalogFingerprint({ ...UNFILTERED_QUERY, brandIds: [AURELIA, NORTHCREST] });
    const reordered = catalogFingerprint({
      ...UNFILTERED_QUERY,
      brandIds: [NORTHCREST, AURELIA, NORTHCREST],
    });
    expect(reordered).toBe(ordered);
  });

  it("erases the order of a price range given back to front", () => {
    const ascending = catalogFingerprint({
      ...UNFILTERED_QUERY,
      minPriceMinor: 1_000,
      maxPriceMinor: 9_000,
    });
    const inverted = catalogFingerprint({
      ...UNFILTERED_QUERY,
      minPriceMinor: 9_000,
      maxPriceMinor: 1_000,
    });
    expect(inverted).toBe(ascending);
  });

  it("keys a page, a sort and a page size apart, as the whole request is inside the key", () => {
    const keys = [
      catalogFingerprint({ ...UNFILTERED_QUERY, page: 2 }),
      catalogFingerprint({ ...UNFILTERED_QUERY, sort: "price-asc" }),
      catalogFingerprint({ ...UNFILTERED_QUERY, pageSize: 24 }),
    ];
    expect(keys.filter((key) => key === UNFILTERED_KEY)).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(DISTINCT_QUERIES)("keys %s apart from the unfiltered catalogue", (_label, query) => {
    expect(catalogFingerprint(query)).not.toBe(UNFILTERED_KEY);
  });

  it("keys every distinct selection differently, so the guard cannot confuse two queries", () => {
    const keys = DISTINCT_QUERIES.map(([, query]) => catalogFingerprint(query));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isStaleResult", () => {
  it("accepts the key the state is currently describing", () => {
    expect(isStaleResult(stateLoading(BROWSE_QUERY), BROWSE_KEY)).toBe(false);
  });

  it("rejects any other key", () => {
    expect(isStaleResult(stateLoading(BROWSE_QUERY), SEARCH_KEY)).toBe(true);
  });
});

describe("a result for a superseded query", () => {
  it("discards a late success, leaving nothing of it in the state", () => {
    const loadingBrowse = stateLoading(BROWSE_QUERY);
    const afterLateSearch = catalogReducer(
      loadingBrowse,
      catalogActions.loadSucceeded(SEARCH_KEY, SEARCH_PAGE, SEARCH_FACETS, LATER_INSTANT),
    );
    expect(afterLateSearch).toBe(loadingBrowse);
    expect(afterLateSearch.status).toBe("loading");
    expect(afterLateSearch.page).toBeNull();
    expect(afterLateSearch.facets).toEqual([]);
    expect(afterLateSearch.loadedAt).toBeNull();
  });

  it("then applies the current query's own result", () => {
    const loadingBrowse = catalogReducer(LOADED_SEARCH, catalogActions.loadStarted(BROWSE_QUERY));
    const afterLateSearch = catalogReducer(
      loadingBrowse,
      catalogActions.loadSucceeded(SEARCH_KEY, SEARCH_PAGE, SEARCH_FACETS, LATER_INSTANT),
    );
    expect(afterLateSearch).toBe(loadingBrowse);

    const settled = catalogReducer(
      afterLateSearch,
      catalogActions.loadSucceeded(BROWSE_KEY, BROWSE_PAGE, SEARCH_FACETS, FIXED_NOW),
    );
    expect(settled.status).toBe("success");
    expect(settled.loadedAt).toBe(FIXED_NOW);
    expect(settled.page).toEqual(BROWSE_PAGE);
    expect(settled.page?.items.map((product) => product.id)).toEqual(
      BROWSE_PRODUCTS.map((product) => product.id),
    );
  });

  it("discards a late failure, then records the current query's own", () => {
    const loadingBrowse = stateLoading(BROWSE_QUERY);
    const afterLateFailure = catalogReducer(
      loadingBrowse,
      catalogActions.loadFailed(SEARCH_KEY, SEARCH_ERROR),
    );
    expect(afterLateFailure).toBe(loadingBrowse);
    expect(afterLateFailure.status).toBe("loading");
    expect(afterLateFailure.error).toBeNull();

    const failed = catalogReducer(
      afterLateFailure,
      catalogActions.loadFailed(BROWSE_KEY, SEARCH_ERROR),
    );
    expect(failed.status).toBe("error");
    expect(failed.error).toEqual(SEARCH_ERROR);
  });
});

describe("a result for a superseded page", () => {
  it("keys two requests differing only by their page apart", () => {
    expect(BROWSE_SECOND_PAGE_KEY).not.toBe(BROWSE_KEY);
    expect(isStaleResult(stateLoading(BROWSE_SECOND_PAGE), BROWSE_KEY)).toBe(true);
  });

  it("discards a page-1 response that lands while page 2 is loading", () => {
    const loadingSecondPage = stateLoading(BROWSE_SECOND_PAGE);
    const afterLateFirstPage = catalogReducer(
      loadingSecondPage,
      catalogActions.loadSucceeded(BROWSE_KEY, BROWSE_FIRST_PAGE, SEARCH_FACETS, LATER_INSTANT),
    );
    expect(afterLateFirstPage).toBe(loadingSecondPage);
    expect(afterLateFirstPage.status).toBe("loading");
    expect(afterLateFirstPage.page).toBeNull();
    expect(afterLateFirstPage.loadedAt).toBeNull();
  });

  it("treats a page change as a new load rather than the load already in flight", () => {
    const loadingFirstPage = stateLoading(BROWSE_QUERY);
    const loadingSecondPage = catalogReducer(
      loadingFirstPage,
      catalogActions.loadStarted(BROWSE_SECOND_PAGE),
    );
    expect(loadingSecondPage).not.toBe(loadingFirstPage);
    expect(loadingSecondPage.status).toBe("loading");
    expect(loadingSecondPage.fingerprint).toBe(BROWSE_SECOND_PAGE_KEY);

    const settled = catalogReducer(
      loadingSecondPage,
      catalogActions.loadSucceeded(BROWSE_SECOND_PAGE_KEY, BROWSE_PAGE, SEARCH_FACETS, FIXED_NOW),
    );
    expect(settled.status).toBe("success");
    expect(settled.loadedAt).toBe(FIXED_NOW);
    expect(settled.page).toEqual(BROWSE_PAGE);
    expect(settled.page?.items.map((product) => product.id)).toEqual(
      BROWSE_PRODUCTS.map((product) => product.id),
    );
    expect(settled.page?.page).toBe(2);
  });

  it("still leaves a repeat of the load already in flight alone", () => {
    const loadingSecondPage = stateLoading(BROWSE_SECOND_PAGE);
    expect(catalogReducer(loadingSecondPage, catalogActions.loadStarted(BROWSE_SECOND_PAGE))).toBe(
      loadingSecondPage,
    );
  });
});

// What this state must not hold ------------------------------------------------------------------

/** Every field of `FilterState`, each of which the URL owns and this state must not hold. */
const FILTER_FIELDS: (keyof FilterState)[] = [
  "q",
  "categoryIds",
  "brandIds",
  "minPriceMinor",
  "maxPriceMinor",
  "minRating",
  "inStockOnly",
  "tags",
  "sort",
  "page",
  "pageSize",
];

/**
 * The ten of those names the state holds nothing under at all. `page` is the eleventh and the one name
 * both shapes declare: the state's own `page` is the loaded page of results, not the number the URL
 * carries, so no key check can settle it and the type assertion in the case below does.
 */
const FILTER_KEY_NAMES = FILTER_FIELDS.filter((field) => field !== "page");

/** The filter writers, every one of which belongs to `src/utils/queryParams.ts` and not to this module. */
const FILTER_SETTERS = ["setQuery", "toggleFacetValue", "setPriceRange", "withPage", "withSort"];

describe("the state the URL owns", () => {
  const settledBrowse = catalogReducer(
    stateLoading(BROWSE_QUERY),
    catalogActions.loadSucceeded(BROWSE_KEY, BROWSE_PAGE, SEARCH_FACETS, FIXED_NOW),
  );

  it("holds no filter value, no sort and no numeric page of its own", () => {
    expect(Object.keys(settledBrowse).sort()).toEqual([
      "error",
      "facets",
      "fingerprint",
      "loadedAt",
      "page",
      "status",
    ]);
    expect(FILTER_KEY_NAMES.filter((field) => field in settledBrowse)).toEqual([]);
    expect(typeof settledBrowse.page).not.toBe("number");
  });

  it("exposes no query field for a filter value to be read back out of", () => {
    expect("query" in settledBrowse).toBe(false);
  });

  it("exposes no filter setter, only the four load transitions", () => {
    expect(FILTER_SETTERS.filter((name) => name in catalogModule)).toEqual([]);
    expect(Object.keys(catalogActions).sort()).toEqual([
      "loadFailed",
      "loadStarted",
      "loadSucceeded",
      "reset",
    ]);
  });
});

describe("an unrecognised action", () => {
  it("fails loudly rather than quietly returning the state unchanged", () => {
    const unknownAction = { type: "catalog/set-query", q: "lamp" } as unknown as CatalogAction;
    expect(() => catalogReducer(createInitialCatalogState(), unknownAction)).toThrow(
      /Unhandled catalogue action/,
    );
  });
});
