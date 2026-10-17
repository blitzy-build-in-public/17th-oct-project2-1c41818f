/**
 * Path: tests/unit/utils/queryParams.test.ts
 * Purpose: Filter state to URL and back, with normalisation and default omission
 * Lines: 508
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/constants/config";
import { FACET_DEFINITIONS, SORT_OPTIONS, type FacetDefinition } from "@/constants/taxonomy";
import type { FacetId, FilterState } from "@/types/catalog";
import {
  DEFAULT_FILTER_STATE,
  activeFilterEntries,
  clearAllFilters,
  clearFacet,
  countActiveFilters,
  facetValueMatches,
  filtersToPath,
  filtersToSearchString,
  hasActiveFilters,
  readFilterState,
  setFacetValues,
  setInStockOnly,
  setPriceRange,
  setQuery,
  setRating,
  toFacetQuery,
  toggleFacetValue,
  toggleTag,
  withPage,
  withSort,
  writeFilterState,
  type ActiveFilterEntry,
} from "@/utils/queryParams";

import { makeFilterState } from "../../fixtures";

// Test data -------------------------------------------------------------------------------------

/** Hand-built identifiers, asserted the one way `src/types/common.ts` documents: the cast is the
 * visible signal that these values did not come from the generators in `src/utils/strings.ts`. */
type CategoryIdentifier = FilterState["categoryIds"][number];
type BrandIdentifier = FilterState["brandIds"][number];

/** Three category and two brand identifiers, listed in the canonical order the module writes. */
const CATEGORY_IDS = ["cat_audio", "cat_cameras", "cat_laptops"] as CategoryIdentifier[];
const BRAND_IDS = ["brd_aurelia-audio", "brd_northcrest"] as BrandIdentifier[];
/** The same selections listed the other way round, which canonical writing has to erase. */
const SHUFFLED_CATEGORY_IDS = [...CATEGORY_IDS].reverse();
const SHUFFLED_BRAND_IDS = [...BRAND_IDS].reverse();

/** The page size that is not the default, so no assertion states a size of its own. */
const OTHER_PAGE_SIZE = PAGE_SIZE_OPTIONS[1];
/** The facet vocabulary as its declared interface, so an entry's optional values are read uniformly. */
const FACET_VOCABULARY: readonly FacetDefinition[] = FACET_DEFINITIONS;
/** Every facet the panel declares, in its own order, which the chip ordering is measured against. */
const FACET_IDS: readonly FacetId[] = FACET_VOCABULARY.map((definition) => definition.id);
/** The fields a facet request takes: the state's whole filter half, without the sort or the paging. */
const FILTER_QUERY_KEYS = (Object.keys(DEFAULT_FILTER_STATE) as (keyof FilterState)[]).filter(
  (key) => key !== "sort" && key !== "page" && key !== "pageSize",
);

/** The star floors the rating filter keeps, and the values it must drop to no filter at all. */
const RATING_FLOORS = [1, 2, 3, 4, 5] as const;
const OFF_SCALE_RATINGS = ["0", "6", "3.5", "abc", ""] as const;
/** Page sizes that are not one of the configured three, in every malformed spelling a URL carries. */
const UNSETTABLE_PAGE_SIZES = ["13", "0", "24.5", "abc"] as const;

/**
 * A fully populated selection — a term, every facet, a tag, a sort that is not the default, a page
 * past the first and a page size that is not the default — in the canonical form the module writes.
 */
const FULL_STATE = makeFilterState({
  q: "lamp",
  categoryIds: CATEGORY_IDS,
  brandIds: BRAND_IDS,
  minPriceMinor: 5_000,
  maxPriceMinor: 9_999,
  minRating: 4,
  inStockOnly: true,
  tags: ["lighting"],
  sort: "price-asc",
  page: 3,
  pageSize: OTHER_PAGE_SIZE,
});
/** The same selection with both identifier lists listed backwards. */
const SHUFFLED_STATE = makeFilterState({
  ...FULL_STATE,
  categoryIds: SHUFFLED_CATEGORY_IDS,
  brandIds: SHUFFLED_BRAND_IDS,
});
/** The same facets without tags, so clearing one facet is seen against the four that remain. */
const FACET_STATE = makeFilterState({ ...FULL_STATE, tags: [], page: 4 });

/**
 * The canonical URL of {@link FULL_STATE}: keys sorted, list values comma-joined in their canonical
 * order, and every field holding a default left out, as `src/utils/queryParams.ts` documents it.
 */
const FULLY_POPULATED_QUERY =
  "?brandIds=brd_aurelia-audio%2Cbrd_northcrest&categoryIds=cat_audio%2Ccat_cameras%2Ccat_laptops&inStock=true&maxPrice=9999&minPrice=5000&minRating=4&page=3&pageSize=24&q=lamp&sort=price-asc&tags=lighting";

/** A facet chip, the shape {@link facetEntry} returns. */
type FacetEntry = Extract<ActiveFilterEntry, { kind: "facet" }>;

/** The chip a state holds for one facet, or `undefined` when the state applies none for it. */
function facetEntry(state: FilterState, facetId: FacetId): FacetEntry | undefined {
  return activeFilterEntries(state).find(
    (entry): entry is FacetEntry => entry.kind === "facet" && entry.facetId === facetId,
  );
}

/** The wording the taxonomy gives a facet value, so no assertion re-types a label of its own. */
function declaredLabel(facetId: FacetId, value: string): string | undefined {
  return FACET_VOCABULARY.find((definition) => definition.id === facetId)?.options?.find(
    (option) => option.value === value,
  )?.label;
}

/** Removes one chip through the module's own remover: a facet by its value, a tag by its text. */
function removeEntry(state: FilterState, entry: ActiveFilterEntry): FilterState {
  return entry.kind === "tag"
    ? toggleTag(state, entry.value)
    : toggleFacetValue(state, entry.facetId, entry.value);
}

describe("the query state round trip", () => {
  it("reads back every field a fully populated selection writes", () => {
    const search = filtersToSearchString(FULL_STATE);
    expect(search.startsWith("?")).toBe(true);
    expect(readFilterState(search)).toEqual(FULL_STATE);
    expect(readFilterState(new URLSearchParams(search))).toEqual(FULL_STATE);
  });

  it("builds one query for a link and for the navigation that follows a filter", () => {
    const path = filtersToPath("/catalog", FULL_STATE);
    expect(path).toBe(`/catalog${filtersToSearchString(FULL_STATE)}`);
    expect(path.slice("/catalog".length)).toBe(filtersToSearchString(FULL_STATE));
    expect(filtersToPath("/catalog", DEFAULT_FILTER_STATE)).toBe("/catalog");
  });

  it("is a fixed point: writing a URL that was read changes nothing", () => {
    const written = filtersToSearchString(FULL_STATE);
    expect(written).toBe(FULLY_POPULATED_QUERY);
    const rewritten = filtersToSearchString(readFilterState(written));
    expect(rewritten).toBe(written);
    expect(readFilterState(rewritten)).toEqual(FULL_STATE);
  });

  it("reads an empty query, and writes one, as the canonical empty selection", () => {
    expect(readFilterState("")).toEqual(DEFAULT_FILTER_STATE);
    expect(readFilterState("?")).toEqual(DEFAULT_FILTER_STATE);
    expect(filtersToSearchString(DEFAULT_FILTER_STATE)).toBe("");
    expect(writeFilterState(DEFAULT_FILTER_STATE).toString()).toBe("");
    const spelledOut = makeFilterState({
      page: 1,
      sort: DEFAULT_FILTER_STATE.sort,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(filtersToSearchString(spelledOut)).toBe("");
  });
});

describe("canonical identity and normalisation", () => {
  it("orders identifier lists, so two spellings of one selection share one URL", () => {
    expect(filtersToSearchString(SHUFFLED_STATE)).toBe(filtersToSearchString(FULL_STATE));
    const read = readFilterState(filtersToSearchString(SHUFFLED_STATE));
    expect(read.categoryIds).toEqual([...CATEGORY_IDS]);
    expect(read.brandIds).toEqual([...BRAND_IDS]);
  });

  it("keeps one entry for a repeated identifier", () => {
    const doubled = makeFilterState({ categoryIds: [...CATEGORY_IDS, ...CATEGORY_IDS] });
    const single = makeFilterState({ categoryIds: CATEGORY_IDS });
    expect(filtersToSearchString(doubled)).toBe(filtersToSearchString(single));
    expect(readFilterState(filtersToSearchString(doubled)).categoryIds).toEqual([...CATEGORY_IDS]);
  });

  it("accepts a list however the URL carried it: repeated keys or one joined value", () => {
    const repeated = readFilterState("?categoryIds=cat_cameras&categoryIds=cat_audio");
    const joined = readFilterState("?categoryIds=cat_audio%2Ccat_cameras%2Ccat_laptops");
    expect(repeated.categoryIds).toEqual(["cat_audio", "cat_cameras"]);
    expect(joined.categoryIds).toEqual([...CATEGORY_IDS]);
  });

  it("collapses a selection built through the writers onto the same selection written out", () => {
    const composed = setInStockOnly(
      setRating(
        toggleFacetValue(setQuery(DEFAULT_FILTER_STATE, "  lamp  "), "brand", BRAND_IDS[1]),
        4,
      ),
      true,
    );
    const written = makeFilterState({
      q: "lamp",
      brandIds: [BRAND_IDS[1]],
      minRating: 4,
      inStockOnly: true,
    });
    expect(filtersToSearchString(composed)).toBe(filtersToSearchString(written));
    expect(readFilterState(filtersToSearchString(composed)).q).toBe("lamp");
  });

  it("swaps an inverted price range rather than rejecting or dropping it", () => {
    const inverted = setPriceRange(makeFilterState(), 9_000, 2_000);
    expect(inverted.minPriceMinor).toBe(2_000);
    expect(inverted.maxPriceMinor).toBe(9_000);
    expect(filtersToSearchString(inverted)).toBe(
      filtersToSearchString(setPriceRange(makeFilterState(), 2_000, 9_000)),
    );
    const read = readFilterState("?minPrice=9000&maxPrice=2000");
    expect(read.minPriceMinor).toBe(2_000);
    expect(read.maxPriceMinor).toBe(9_000);
  });

  it("drops a price bound at the floor, which excludes nothing, keeping the other side", () => {
    const floored = setPriceRange(makeFilterState(), 0, 9_000);
    expect(floored.minPriceMinor).toBeNull();
    expect(floored.maxPriceMinor).toBe(9_000);
    expect(filtersToSearchString(floored)).toBe("?maxPrice=9000");
  });

  it.each(RATING_FLOORS)("round-trips the %i-star floor", (rating) => {
    const state = setRating(makeFilterState(), rating);
    expect(state.minRating).toBe(rating);
    expect(readFilterState(filtersToSearchString(state)).minRating).toBe(rating);
  });

  it.each(OFF_SCALE_RATINGS)("drops the rating %s to no filter at all", (raw) => {
    expect(readFilterState(`?minRating=${raw}`).minRating).toBeNull();
    expect(filtersToSearchString(readFilterState(`?minRating=${raw}`))).toBe("");
  });

  it("clears the rating filter when no star is given", () => {
    expect(setRating(makeFilterState({ minRating: 4 }), null).minRating).toBeNull();
    expect(setRating(makeFilterState({ minRating: 4 })).minRating).toBeNull();
  });

  it("normalises the page to a whole number at or above the first", () => {
    expect(readFilterState("?page=0").page).toBe(1);
    expect(readFilterState("?page=-4").page).toBe(1);
    expect(readFilterState("?page=2.7").page).toBe(2);
    expect(readFilterState("?page=abc").page).toBe(1);
    expect(withPage(makeFilterState(), 0).page).toBe(1);
  });

  it("carries a page past the last until a caller knows the page count", () => {
    // No ceiling is invented here: clampPage() in @/utils/collections.ts owns the last page once the
    // result total is known, and this module applies it only when it is handed a page count.
    expect(readFilterState("?page=9").page).toBe(9);
    expect(readFilterState("?page=9", 3).page).toBe(3);
    expect(withPage(makeFilterState({ page: 5 }), 4, 2).page).toBe(2);
  });

  it.each(PAGE_SIZE_OPTIONS)("round-trips the configured page size %i", (size) => {
    const state = makeFilterState({ pageSize: size });
    expect(readFilterState(filtersToSearchString(state)).pageSize).toBe(size);
  });

  it.each(UNSETTABLE_PAGE_SIZES)("falls back to the default size for %s", (raw) => {
    expect(readFilterState(`?pageSize=${raw}`).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("keeps every identifier of a multi-select facet and the canonical tag order", () => {
    const multi = makeFilterState({
      categoryIds: CATEGORY_IDS,
      brandIds: BRAND_IDS,
      tags: ["desk", "lighting"],
    });
    const read = readFilterState(filtersToSearchString(multi));
    expect(read.categoryIds).toHaveLength(CATEGORY_IDS.length);
    expect(read.brandIds).toHaveLength(BRAND_IDS.length);
    expect(read.tags).toEqual(["desk", "lighting"]);
    expect(read).toEqual(multi);
  });
});

describe("the facet projection", () => {
  it("drops the sort and the paging, keeping the whole filter half", () => {
    const query = toFacetQuery(FULL_STATE);
    expect(Object.keys(query).sort()).toEqual([...FILTER_QUERY_KEYS].sort());
    expect(query.q).toBe(FULL_STATE.q);
  });

  it("normalises the projection, so two spellings of one filter project alike", () => {
    expect(toFacetQuery(SHUFFLED_STATE)).toEqual(toFacetQuery(FULL_STATE));
    const doubled = makeFilterState({ categoryIds: [...CATEGORY_IDS, ...CATEGORY_IDS] });
    expect(toFacetQuery(doubled).categoryIds).toEqual([...CATEGORY_IDS]);
  });
});

describe("the composed writers", () => {
  it("sets the search term, trims it, and returns the listing to its first page", () => {
    const searched = setQuery(
      makeFilterState({ page: 4, brandIds: BRAND_IDS, sort: "price-asc" }),
      "  lamp  ",
    );
    expect(searched.q).toBe("lamp");
    expect(searched.page).toBe(1);
    expect(searched.brandIds).toEqual([...BRAND_IDS]);
    expect(searched.sort).toBe("price-asc");
  });

  it("repairs a relevance sort left without a term, and keeps the one chosen", () => {
    const relevance = makeFilterState({ q: "lamp", sort: "relevance" });
    expect(setQuery(relevance, "").sort).toBe(DEFAULT_FILTER_STATE.sort);
    expect(setQuery(makeFilterState({ q: "lamp", sort: "price-desc" }), "").sort).toBe(
      "price-desc",
    );
    expect(readFilterState("?q=lamp&sort=relevance").sort).toBe("relevance");
    expect(readFilterState("?sort=relevance").sort).toBe(DEFAULT_FILTER_STATE.sort);
    expect(readFilterState("?sort=sideways").sort).toBe(DEFAULT_FILTER_STATE.sort);
  });

  it.each(SORT_OPTIONS.map((option) => option.value))("round-trips the sort key %s", (sortKey) => {
    const state = withSort(makeFilterState({ q: "lamp" }), sortKey);
    expect(readFilterState(filtersToSearchString(state)).sort).toBe(sortKey);
  });

  it("reorders a listing without moving it to another page, omitting the default sort", () => {
    const sorted = withSort(makeFilterState({ page: 3 }), "price-asc");
    expect(sorted.page).toBe(3);
    expect(filtersToSearchString(sorted)).toBe("?page=3&sort=price-asc");
    expect(filtersToSearchString(withSort(DEFAULT_FILTER_STATE, DEFAULT_FILTER_STATE.sort))).toBe(
      "",
    );
  });

  it("adds a facet value that is absent, removes one already applied, and returns on a repeat", () => {
    const applied = toggleFacetValue(DEFAULT_FILTER_STATE, "category", CATEGORY_IDS[0]);
    expect(applied.categoryIds).toEqual([CATEGORY_IDS[0]]);
    expect(filtersToSearchString(toggleFacetValue(applied, "category", CATEGORY_IDS[0]))).toBe(
      filtersToSearchString(DEFAULT_FILTER_STATE),
    );
    const both = toggleFacetValue(applied, "category", CATEGORY_IDS[1]);
    expect(both.categoryIds).toEqual([CATEGORY_IDS[0], CATEGORY_IDS[1]]);
    const withoutSecond = toggleFacetValue(both, "category", CATEGORY_IDS[1]);
    expect(withoutSecond.categoryIds).toEqual([CATEGORY_IDS[0]]);
    expect(filtersToSearchString(withoutSecond)).toBe(filtersToSearchString(applied));
  });

  it("holds the state when a facet value names nothing that facet holds", () => {
    const held = toggleFacetValue(FULL_STATE, "rating", "9");
    expect(held).toBe(FULL_STATE);
    expect(filtersToSearchString(held)).toBe(FULLY_POPULATED_QUERY);
  });

  it("toggles a tag, and writes nothing for a blank one", () => {
    const tagged = toggleTag(DEFAULT_FILTER_STATE, "  Lighting ");
    expect(tagged.tags).toEqual(["Lighting"]);
    expect(filtersToSearchString(tagged)).toBe("?tags=Lighting");
    expect(toggleTag(tagged, "Lighting").tags).toEqual([]);
    expect(filtersToSearchString(toggleTag(tagged, "   "))).toBe(filtersToSearchString(tagged));
  });

  it("writes every facet writer through the same canonical form", () => {
    expect(filtersToSearchString(setRating(makeFilterState(), RATING_FLOORS[2]))).toBe(
      "?minRating=3",
    );
    expect(filtersToSearchString(setInStockOnly(makeFilterState(), true))).toBe("?inStock=true");
    expect(filtersToSearchString(setPriceRange(makeFilterState(), 2_500, 2_500))).toBe(
      "?maxPrice=2500&minPrice=2500",
    );
    expect(setInStockOnly(makeFilterState({ page: 5 }), true).page).toBe(1);
  });

  it("applies a group of values to one facet at once, as a preset does", () => {
    const bands = ["under-25", "100-200"] as const;
    const upperBand = FACET_VOCABULARY.find(
      (definition) => definition.id === "price",
    )?.options?.find((option) => option.value === bands[1]);
    const merged = setFacetValues(DEFAULT_FILTER_STATE, "price", bands);
    // The lowest band's floor is the price floor itself, which excludes nothing and is no bound.
    expect(merged.minPriceMinor).toBeNull();
    expect(merged.maxPriceMinor).toBe(upperBand?.maxMinor);
    expect(filtersToSearchString(merged)).toBe(`?maxPrice=${String(upperBand?.maxMinor)}`);
    expect(setFacetValues(makeFilterState({ minRating: 4 }), "rating", []).minRating).toBeNull();
  });

  it("applies a bounded price value that names no declared band as its own bounds", () => {
    const applied = toggleFacetValue(makeFilterState(), "price", "2500-9999");
    expect(applied.minPriceMinor).toBe(2_500);
    expect(applied.maxPriceMinor).toBe(9_999);
    expect(filtersToSearchString(applied)).toBe("?maxPrice=9999&minPrice=2500");
    expect(facetValueMatches(applied, "price", "2500-9999")).toBe(true);
  });

  it("holds the state for a price value that decodes to no range at all", () => {
    expect(toggleFacetValue(makeFilterState(), "price", "not-a-range")).toEqual(
      DEFAULT_FILTER_STATE,
    );
  });

  it("applies a boolean facet's declared value as well as its literal", () => {
    const declared = FACET_VOCABULARY.find((definition) => definition.id === "availability")
      ?.options?.[0];
    const on = setFacetValues(DEFAULT_FILTER_STATE, "availability", [declared?.value ?? "true"]);
    expect(on.inStockOnly).toBe(true);
    expect(setFacetValues(on, "availability", ["no"]).inStockOnly).toBe(false);
  });

  it("clears one facet and leaves the rest of the selection standing", () => {
    const withoutBrand = clearFacet(FACET_STATE, "brand");
    expect(withoutBrand.brandIds).toEqual([]);
    expect(withoutBrand.categoryIds).toEqual([...CATEGORY_IDS]);
    expect(withoutBrand.minRating).toBe(FACET_STATE.minRating);
    expect(withoutBrand.inStockOnly).toBe(true);
    expect(withoutBrand.page).toBe(1);
  });

  it("clears every facet one at a time back to the term, the sort and the page size", () => {
    const cleared = FACET_IDS.reduce((state, facetId) => clearFacet(state, facetId), FACET_STATE);
    expect(cleared).toEqual(
      makeFilterState({
        q: FACET_STATE.q,
        sort: FACET_STATE.sort,
        page: 1,
        pageSize: FACET_STATE.pageSize,
      }),
    );
  });

  it("clears every filter while keeping the term, the sort and the page size", () => {
    const cleared = clearAllFilters(FULL_STATE);
    expect(cleared).toEqual(
      makeFilterState({
        q: FULL_STATE.q,
        sort: FULL_STATE.sort,
        page: 1,
        pageSize: FULL_STATE.pageSize,
      }),
    );
    expect(cleared.tags).toEqual([]);
    expect(clearAllFilters()).toEqual(DEFAULT_FILTER_STATE);
  });

  it("writes canonical parameters and leaves the state it was handed untouched", () => {
    const state = makeFilterState({ categoryIds: CATEGORY_IDS, page: 2 });
    const snapshot = { ...state };
    const params = writeFilterState(state);
    expect(params.getAll("categoryIds")).toEqual([CATEGORY_IDS.join(",")]);
    expect(params.get("page")).toBe("2");
    expect(params.get("sort")).toBeNull();
    expect(state).toEqual(snapshot);
  });
});

describe("the applied-filter chips", () => {
  it("lists no chip for the empty selection, and none for a term on its own", () => {
    expect(activeFilterEntries(DEFAULT_FILTER_STATE)).toEqual([]);
    expect(countActiveFilters(DEFAULT_FILTER_STATE)).toBe(0);
    expect(hasActiveFilters(makeFilterState({ q: "lamp" }))).toBe(false);
  });

  it("lists one chip per applied filter, in the panel's order with the tags last", () => {
    const entries = activeFilterEntries(FULL_STATE);
    // One chip per applied value: three categories, two brands, the price band, the rating, the
    // availability toggle, and the tag.
    expect(entries).toHaveLength(CATEGORY_IDS.length + BRAND_IDS.length + 4);
    const facetIds = entries
      .filter((entry): entry is FacetEntry => entry.kind === "facet")
      .map((entry) => entry.facetId);
    const firstSeen = facetIds.filter((facetId, index) => facetIds.indexOf(facetId) === index);
    expect(firstSeen).toEqual(FACET_IDS.filter((facetId) => facetIds.includes(facetId)));
    expect(entries[entries.length - 1]).toEqual({ kind: "tag", value: "lighting" });
    expect(countActiveFilters(FULL_STATE)).toBe(entries.length);
    expect(hasActiveFilters(FULL_STATE)).toBe(true);
  });

  it("labels each chip from the vocabulary the panel reads", () => {
    const price = facetEntry(FULL_STATE, "price");
    expect(price?.value).toBe("50-100");
    expect(price?.label).toBe(declaredLabel("price", price?.value ?? ""));
    const rating = facetEntry(FULL_STATE, "rating");
    expect(rating?.label).toBe(declaredLabel("rating", rating?.value ?? ""));
    const availability = facetEntry(FULL_STATE, "availability");
    expect(availability?.value).toBe("true");
    expect(availability?.label).toBe(declaredLabel("availability", "in-stock"));
    // The catalogue supplies the terms of these two, so the panel labels their values itself.
    expect(facetEntry(FULL_STATE, "category")?.label).toBeNull();
    expect(facetEntry(FULL_STATE, "brand")?.label).toBeNull();
  });

  it("encodes a price range matching no declared band as its own bounds", () => {
    const offBand = facetEntry(
      makeFilterState({ minPriceMinor: 2_500, maxPriceMinor: 9_999 }),
      "price",
    );
    expect(offBand?.value).toBe("2500-9999");
    expect(offBand?.label).toBeNull();
  });

  it("marks a facet value selected only when the state applies it", () => {
    expect(facetValueMatches(FULL_STATE, "category", CATEGORY_IDS[0])).toBe(true);
    expect(facetValueMatches(FULL_STATE, "category", "cat_toys-games")).toBe(false);
    expect(facetValueMatches(FULL_STATE, "rating", "3")).toBe(false);
    expect(facetValueMatches(FULL_STATE, "rating", "9")).toBe(false);
  });

  it("removes exactly the filter a chip names, through the module's own remover", () => {
    const before = countActiveFilters(FULL_STATE);
    for (const entry of activeFilterEntries(FULL_STATE)) {
      const without = removeEntry(FULL_STATE, entry);
      expect(countActiveFilters(without)).toBe(before - 1);
      expect(activeFilterEntries(without)).not.toContainEqual(entry);
    }
  });
});
