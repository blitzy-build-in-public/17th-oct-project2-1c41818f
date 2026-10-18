/**
 * Path: tests/unit/lib/catalogSearch.test.ts
 * Purpose: Filtering, cross-filtered facet counts, sort orders, paging and search scoring.
 * Lines: 461
 */

import { describe, expect, it } from "vitest";

import * as config from "@/constants/config";
import * as taxonomy from "@/constants/taxonomy";
import * as catalog from "@/lib/catalogService";
import * as search from "@/lib/searchService";
import * as query from "@/utils/queryParams";

import type { BrandId } from "@/types/common";
import type { Facet, FacetId, FacetQuery, FilterState, Product, SortKey } from "@/types/catalog";

import { FIXED_NOW, makeBrand, makeCategory, makeFilterState, makeProduct } from "../../fixtures";

// The subjects are the catalogue's and the search's pure rules — filtering, cross-filtered facet counting,
// every sort order, paging and the scoring the type-ahead shares with the listing — every one of them a
// function of the collection it is handed, so each case drives it directly.

/** The catalogue's three categories and three brands: the vocabulary its term facets are labelled by. */
const CAMERAS = makeCategory({ name: "Cameras" });
const LAPTOPS = makeCategory({ name: "Laptops" });
const AUDIO = makeCategory({ name: "Audio" });
const CATEGORIES = [CAMERAS, LAPTOPS, AUDIO];
const AURELIA = makeBrand({ name: "Aurelia Audio" });
const NORTHCREST = makeBrand({ name: "Northcrest" });
const ZENITH = makeBrand({ name: "Zenith Optics" });
const BRANDS = [AURELIA, NORTHCREST, ZENITH];
const KESTREL = makeBrand({ name: "Kestrel Optics" });
const KESTREL_CATEGORY = makeCategory({ name: "Kestrel" });
const CATALOGUE_SUMMARY = "Ships assembled and tested before dispatch.";

/** Sixteen products of name, category, brand, price in minor units, average rating, review count and stock:
 *  priced and rated so every declared band and star floor holds its own share, and three of them out of
 *  stock, so a facet count can be stated exactly and checked against the products behind it. */
const CATALOGUE_ROWS = [
  ["Aperture Camera Body", CAMERAS, ZENITH, 2_499, 4.5, 12, 12],
  ["Aperture Prime Lens", CAMERAS, ZENITH, 2_500, 4, 18, 7],
  ["Northcrest Tripod", CAMERAS, NORTHCREST, 7_500, 3.5, 7, 0],
  ["Northcrest Flash Kit", CAMERAS, NORTHCREST, 12_500, 2.5, 25, 20],
  ["Aurelia Camera Strap", CAMERAS, AURELIA, 19_999, 5, 3, 4],
  ["Northcrest Notebook", LAPTOPS, NORTHCREST, 4_900, 3, 9, 15],
  ["Northcrest Keyboard", LAPTOPS, NORTHCREST, 9_999, 4.8, 31, 30],
  ["Aurelia Laptop Stand", LAPTOPS, AURELIA, 1_500, 1.5, 5, 0],
  ["Aurelia Monitor Light", LAPTOPS, AURELIA, 20_000, 4.2, 14, 3],
  ["Zenith Docking Hub", LAPTOPS, ZENITH, 6_000, 3.9, 22, 9],
  ["Aurelia Speaker", AUDIO, AURELIA, 2_499, 4.6, 40, 25],
  ["Aurelia Headphones", AUDIO, AURELIA, 3_000, 2, 11, 11],
  ["Zenith Turntable", AUDIO, ZENITH, 8_000, 4.4, 6, 0],
  ["Northcrest Soundbar", AUDIO, NORTHCREST, 12_000, 4.9, 27, 5],
  ["Zenith Amplifier", AUDIO, ZENITH, 22_000, 1, 2, 8],
  ["Aurelia Radio", AUDIO, AURELIA, 30_000, 3.2, 16, 14],
] as const;

/** One `Product` per row, a day apart each, so `newest` orders a real sequence. */
const CATALOGUE: readonly Product[] = CATALOGUE_ROWS.map((row, index) => {
  const [name, category, brand, priceMinor, ratingAverage, ratingCount, stockOnHand] = row;
  const createdAt = new Date(Date.parse(FIXED_NOW) - index * 86_400_000).toISOString();
  const ids = { categoryId: category.id, brandId: brand.id, summary: CATALOGUE_SUMMARY, tags: [] };
  return makeProduct({
    ...ids,
    name,
    priceMinor,
    ratingAverage,
    ratingCount,
    stockOnHand,
    createdAt,
  });
});
const CATALOGUE_IDS: readonly string[] = CATALOGUE.map((one) => one.id);
const UNFILTERED_QUERY: FacetQuery = query.toFacetQuery(query.DEFAULT_FILTER_STATE);
const VOCABULARY = { categories: CATEGORIES, brands: BRANDS };
/** The brand and category names scoring reads, so no name disagrees with the identifier it belongs to. */
const LOOKUP: search.SearchLookup = {
  brandName: (id) => [...BRANDS, KESTREL].find((brand) => brand.id === id)?.name ?? "",
  categoryName: (id) => [...CATEGORIES, KESTREL_CATEGORY].find((one) => one.id === id)?.name ?? "",
};
/** The filters the generic cross-filtering case sweeps: none, one brand, and a combination of them. */
const FILTER_SWEEP: readonly FilterState[] = [
  makeFilterState(),
  makeFilterState({ brandIds: [AURELIA.id] }),
  makeFilterState({ brandIds: [AURELIA.id, NORTHCREST.id], minRating: 4, inStockOnly: true }),
];

/** The identifiers of a collection, and of the catalogue product, or product, with one name. */
function idsOf(products: readonly Product[]): string[] {
  return products.map((one) => one.id);
}
function idOf(name: string): string {
  return productNamed(name).id;
}
function productNamed(name: string): Product {
  const found = CATALOGUE.find((one) => one.name === name);
  if (found === undefined) throw new Error(`The catalogue holds no product named "${name}".`);
  return found;
}
/** The unfiltered query with `changes` applied, and the five facets a filter produces. */
function withFacets(changes: Partial<FacetQuery>): FacetQuery {
  return { ...UNFILTERED_QUERY, ...changes };
}
function facetsFor(filter: FilterState): Facet[] {
  const canonical = catalog.normaliseProductQuery(filter);
  return catalog.buildFacetResponse(CATALOGUE, canonical, { vocabulary: VOCABULARY });
}
/** The one facet of a response, or a thrown error when the response omits it. */
function facetOf(facets: readonly Facet[], id: FacetId): Facet {
  const found = facets.find((facet) => facet.id === id);
  if (found === undefined) throw new Error(`The response carries no "${id}" facet.`);
  return found;
}
/** Every facet's counts by value, one facet's counts, and one facet value's count. */
function countsOf(facets: readonly Facet[]): Record<string, Record<string, number>> {
  const entries = facets.map((facet) => [facet.id, countsOfFacet(facet)] as const);
  return Object.fromEntries(entries);
}
function countsOfFacet(facet: Facet): Record<string, number> {
  return Object.fromEntries(facet.values.map((one) => [one.value, one.count]));
}
function countOf(facets: readonly Facet[], id: FacetId, value: string): number {
  const offered = facetOf(facets, id).values.find((one) => one.value === value);
  if (offered === undefined) throw new Error(`The "${id}" facet offers no value "${value}".`);
  return offered.count;
}
/** The products matching every filter but `id`, with one of that facet's values applied when one is named:
 *  what its counts are measured against, since a facet is counted with its own selection removed. */
function otherFilteredCount(filter: FilterState, id: FacetId, value: string = ""): number {
  const applied = query.setFacetValues(filter, id, value === "" ? [] : [value]);
  return catalog.filterProducts(CATALOGUE, query.toFacetQuery(applied)).length;
}
/** Compares two sort values ascending: numbers numerically, everything else by code unit. */
function ascending(left: number | string, right: number | string): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const first = String(left);
  const second = String(right);
  return first === second ? 0 : first < second ? -1 : 1;
}
/** The value each absolute sort key orders by, and whether it orders the other way round. `relevance` names
 *  none: it keeps the ranking the search produced, which is checked on its own below. */
const SORT_VALUE: Record<Exclude<SortKey, "relevance">, (one: Product) => number | string> = {
  "price-asc": (one) => one.priceMinor,
  "price-desc": (one) => one.priceMinor,
  "rating-desc": (one) => one.ratingAverage,
  newest: (one) => one.createdAt,
  popularity: (one) => one.ratingCount,
};
const DESCENDING = new Set<SortKey>(["price-desc", "rating-desc", "newest", "popularity"]);
/** The absolute sort keys in the taxonomy's own order, so a loop over these means a key added to
 *  `SORT_OPTIONS` cannot be silently unsorted. */
const ABSOLUTE_SORT_KEYS = taxonomy.SORT_OPTIONS.map((one) => one.value).filter(
  (key): key is Exclude<SortKey, "relevance"> => key !== "relevance",
);
/** Everything every absolute sort key promises: the sequence is monotonic in the key's own value and
 *  direction, every product appears exactly once, a repeat sort is identical — so the tiebreak is total —
 *  `compareBy` produces the same order as `sortProducts`, and the input collection is left where it was. */
function expectAbsoluteOrder(key: Exclude<SortKey, "relevance">): void {
  const byValue = SORT_VALUE[key];
  const down = DESCENDING.has(key);
  const compare = (left: number | string, right: number | string): number =>
    down ? ascending(right, left) : ascending(left, right);
  const sorted = catalog.sortProducts(CATALOGUE, key);
  const values = sorted.map(byValue);
  expect(values).toEqual([...values].sort(compare));
  expect(idsOf(sorted).slice().sort()).toEqual([...CATALOGUE_IDS].sort());
  expect(idsOf(catalog.sortProducts(CATALOGUE, key))).toEqual(idsOf(sorted));
  expect(idsOf([...CATALOGUE].sort(catalog.compareBy(key)))).toEqual(idsOf(sorted));
  expect(idsOf(CATALOGUE)).toEqual(CATALOGUE_IDS);
}

describe("filtering", () => {
  it("keeps every product when nothing is applied, and only the selected categories and brands", () => {
    expect(idsOf(catalog.filterProducts(CATALOGUE, UNFILTERED_QUERY))).toEqual(CATALOGUE_IDS);
    const chosen = withFacets({ categoryIds: [CAMERAS.id, AUDIO.id] });
    const byCategory = catalog.filterProducts(CATALOGUE, chosen);
    expect(byCategory).toHaveLength(11);
    expect(idsOf(byCategory)).not.toContain(idOf("Northcrest Notebook"));
    const byBrand = catalog.filterProducts(CATALOGUE, withFacets({ brandIds: [AURELIA.id] }));
    expect(byBrand).toHaveLength(6);
    expect(byBrand.every((one) => one.brandId === AURELIA.id)).toBe(true);
  });

  it("applies a price band inclusively at both ends and a rating floor inclusively", () => {
    const stand = idOf("Aurelia Laptop Stand");
    const exact = withFacets({ minPriceMinor: 1_500, maxPriceMinor: 1_500 });
    expect(idsOf(catalog.filterProducts(CATALOGUE, exact))).toEqual([stand]);
    const above = catalog.filterProducts(CATALOGUE, withFacets({ minPriceMinor: 1_501 }));
    const below = catalog.filterProducts(CATALOGUE, withFacets({ maxPriceMinor: 1_499 }));
    expect([idsOf(above).includes(stand), idsOf(below).includes(stand)]).toEqual([false, false]);
    const three = catalog.filterProducts(CATALOGUE, withFacets({ minRating: 3 }));
    expect(three).toHaveLength(12);
    expect(idsOf(three)).toContain(idOf("Northcrest Notebook"));
    expect(catalog.filterProducts(CATALOGUE, withFacets({ minRating: 4 }))).toHaveLength(8);
  });

  it("drops the out-of-stock products and every product the shopfront does not sell", () => {
    const left = catalog.filterProducts(CATALOGUE, withFacets({ inStockOnly: true }));
    expect(left).toHaveLength(13);
    const empty = ["Northcrest Tripod", "Aurelia Laptop Stand"].map((name) => idOf(name));
    expect(empty.filter((id) => idsOf(left).includes(id))).toEqual([]);
    const draft = makeProduct({ name: "Aperture Prototype Body", status: "draft" });
    expect(catalog.matchesFilter(draft, UNFILTERED_QUERY)).toBe(false);
    expect(catalog.filterProducts([...CATALOGUE, draft], UNFILTERED_QUERY)).toHaveLength(16);
  });

  it("intersects the facets, keeps a product matching one selected tag, and agrees with its predicate", () => {
    const both = { categoryIds: [AUDIO.id], brandIds: [AURELIA.id], inStockOnly: true };
    const audio = ["Aurelia Speaker", "Aurelia Headphones", "Aurelia Radio"].map((name) =>
      idOf(name),
    );
    expect(idsOf(catalog.filterProducts(CATALOGUE, withFacets(both)))).toEqual(audio);
    const tagged = [makeProduct({ name: "Both Tags", tags: ["desk", "lamp"] })];
    tagged.push(makeProduct({ name: "One Tag", tags: ["desk"] }));
    expect(idsOf(catalog.filterProducts(tagged, withFacets({ tags: ["lamp"] })))).toEqual([
      tagged[0].id,
    ]);
    const chosen = withFacets({
      categoryIds: [AUDIO.id, LAPTOPS.id],
      minRating: 3,
      inStockOnly: true,
    });
    const matched = idsOf(catalog.filterProducts(CATALOGUE, chosen));
    for (const one of CATALOGUE)
      expect(matched.includes(one.id)).toBe(catalog.matchesFilter(one, chosen));
  });

  it("composes a text match ahead of the facet filters", () => {
    const matched = search.applyTextMatch(CATALOGUE, "aperture", LOOKUP);
    const inZenith = withFacets({ brandIds: [ZENITH.id] });
    expect(idsOf(matched)).toEqual(
      ["Aperture Camera Body", "Aperture Prime Lens"].map((n) => idOf(n)),
    );
    const count = (id: BrandId): number =>
      catalog.filterProducts(matched, withFacets({ brandIds: [id] })).length;
    expect([count(ZENITH.id), count(AURELIA.id), inZenith.q]).toEqual([2, 0, ""]);
  });
});

describe("sort orders", () => {
  it("keeps the incoming order for a relevance sort, as a copy", () => {
    const sorted = catalog.sortProducts(CATALOGUE, "relevance");
    expect(idsOf(sorted)).toEqual(CATALOGUE_IDS);
    expect(sorted).not.toBe(CATALOGUE);
    expect(catalog.compareBy("relevance")(CATALOGUE[0], CATALOGUE[1])).toBe(0);
  });

  for (const key of ABSOLUTE_SORT_KEYS) it(`orders by ${key}`, () => expectAbsoluteOrder(key));

  it("breaks a tie on the sort value by identifier", () => {
    const tied = CATALOGUE.filter((one) => one.priceMinor === 2_499);
    const inTie = catalog
      .sortProducts(CATALOGUE, "price-asc")
      .filter((one) => one.priceMinor === 2_499);
    expect(tied.length).toBeGreaterThan(1);
    expect(idsOf(inTie)).toEqual(tied.map((one) => one.id).sort(ascending));
  });

  it("orders a text match by score descending, then name, then identifier", () => {
    const tokens = search.tokenise("aurelia");
    const score = (one: Product): number => search.scoreProduct(one, tokens, LOOKUP);
    const admitted = CATALOGUE.filter((one) => score(one) > 0);
    const expected = [...admitted].sort((left, right) => {
      const byScore = score(right) - score(left);
      if (byScore !== 0) return byScore;
      if (left.name !== right.name) return left.name < right.name ? -1 : 1;
      return ascending(left.id, right.id);
    });
    expect(admitted).toHaveLength(6);
    expect(idsOf(search.applyTextMatch(CATALOGUE, "aurelia", LOOKUP))).toEqual(idsOf(expected));
  });
});

describe("paging", () => {
  it("accepts only the configured page sizes and clamps the page", () => {
    for (const size of config.PAGE_SIZE_OPTIONS) expect(catalog.resolvePageSize(size)).toBe(size);
    const rejected = [undefined, 0, -12, 13, 25, 24.5, Number.NaN];
    for (const size of rejected)
      expect(catalog.resolvePageSize(size)).toBe(config.DEFAULT_PAGE_SIZE);
    const at = (page: number): number =>
      catalog.paginateProducts(CATALOGUE, makeFilterState({ page })).page;
    expect([at(0), at(-3), at(99)]).toEqual([1, 1, 2]);
  });

  it("reports the envelope of the page it served and normalises the page size", () => {
    const first = catalog.paginateProducts(CATALOGUE, makeFilterState());
    expect([first.total, first.page, first.pageSize, first.pageCount]).toEqual([16, 1, 12, 2]);
    expect([first.items.length, first.hasNext, first.hasPrevious]).toEqual([12, true, false]);
    const second = catalog.paginateProducts(CATALOGUE, makeFilterState({ page: 2 }));
    expect([second.items.length, second.hasNext, second.hasPrevious]).toEqual([4, false, true]);
    const odd = catalog.paginateProducts(CATALOGUE, makeFilterState({ pageSize: 13 }));
    expect(odd.pageSize).toBe(config.DEFAULT_PAGE_SIZE);
    expect(
      catalog.paginateProducts(CATALOGUE, makeFilterState({ pageSize: 24 })).items,
    ).toHaveLength(16);
  });

  it("serves an exact multiple as one page, an empty collection as one, and mutates nothing", () => {
    const onePage = CATALOGUE.slice(0, config.DEFAULT_PAGE_SIZE);
    const served = catalog.paginateProducts(onePage, makeFilterState());
    expect([served.pageCount, served.hasNext]).toEqual([1, false]);
    expect(catalog.paginateProducts(onePage, makeFilterState({ page: 2 })).page).toBe(1);
    const empty = catalog.paginateProducts([], makeFilterState());
    expect([empty.items, empty.total, empty.page, empty.pageCount, empty.hasNext]).toEqual([
      [],
      0,
      1,
      1,
      false,
    ]);
    expect(idsOf(CATALOGUE)).toEqual(CATALOGUE_IDS);
  });

  it("relates a product to its same-category neighbours, nearest in price first", () => {
    const subject = productNamed("Northcrest Tripod");
    const related = catalog.selectRelated(CATALOGUE, subject.id, 3);
    expect(idsOf(related)).toEqual([
      idOf("Aperture Prime Lens"),
      idOf("Northcrest Flash Kit"),
      idOf("Aperture Camera Body"),
    ]);
    expect(related.every((one) => one.categoryId === CAMERAS.id && one.id !== subject.id)).toBe(
      true,
    );
    const distances = related.map((one) => Math.abs(one.priceMinor - subject.priceMinor));
    expect(distances).toEqual([...distances].sort((left, right) => left - right));
    expect(catalog.selectRelated(CATALOGUE, makeProduct({ name: "Absent Body" }).id, 3)).toEqual(
      [],
    );
  });

  it("projects a listing state to its filter half, canonical and default-free", () => {
    const messy = makeFilterState({ q: "  aurora  ", sort: "price-asc", page: 3, pageSize: 48 });
    const state = {
      ...messy,
      categoryIds: [LAPTOPS.id, CAMERAS.id, LAPTOPS.id],
      inStockOnly: true,
    };
    const canonical = catalog.normaliseProductQuery(state);
    const keys = ["brandIds", "categoryIds", "inStockOnly", "maxPriceMinor"];
    expect(Object.keys(canonical).sort()).toEqual([
      ...keys,
      "minPriceMinor",
      "minRating",
      "q",
      "tags",
    ]);
    expect(canonical.q).toBe("aurora");
    expect(canonical.categoryIds).toEqual([CAMERAS.id, LAPTOPS.id]);
    const same = makeFilterState({ q: "aurora", inStockOnly: true });
    const reordered = makeFilterState({ ...same, categoryIds: [LAPTOPS.id, CAMERAS.id] });
    expect(catalog.normaliseProductQuery(reordered)).toEqual(canonical);
  });
});

describe("cross-filtered facets", () => {
  it("counts every value of every facet over an unfiltered catalogue", () => {
    const counts = countsOf(facetsFor(makeFilterState()));
    expect(counts.category).toEqual({ [CAMERAS.id]: 5, [LAPTOPS.id]: 5, [AUDIO.id]: 6 });
    expect(counts.brand).toEqual({ [AURELIA.id]: 6, [NORTHCREST.id]: 5, [ZENITH.id]: 5 });
    expect(counts.price).toEqual({
      "under-25": 3,
      "25-50": 3,
      "50-100": 4,
      "100-200": 3,
      "200-plus": 3,
    });
    expect(counts.rating).toEqual({ "4": 8, "3": 12, "2": 14 });
    expect(counts.availability).toEqual({ "in-stock": 13 });
  });

  it("counts a facet's own values with its selection removed, and the rest with it applied", () => {
    const facets = facetsFor(makeFilterState({ brandIds: [AURELIA.id] }));
    const counts = countsOf(facets);
    expect(counts.brand).toEqual({ [AURELIA.id]: 6, [NORTHCREST.id]: 5, [ZENITH.id]: 5 });
    expect(counts.category).toEqual({ [CAMERAS.id]: 1, [LAPTOPS.id]: 2, [AUDIO.id]: 3 });
    expect(counts.price).toEqual({
      "under-25": 2,
      "25-50": 1,
      "50-100": 0,
      "100-200": 1,
      "200-plus": 2,
    });
    expect(counts.rating).toEqual({ "4": 3, "3": 4, "2": 5 });
    expect(counts.availability).toEqual({ "in-stock": 5 });
    expect(countOf(facets, "brand", NORTHCREST.id)).toBeGreaterThan(0);
    const both = facetsFor(makeFilterState({ brandIds: [AURELIA.id, NORTHCREST.id] }));
    expect([countOf(both, "brand", ZENITH.id), countOf(both, "availability", "in-stock")]).toEqual([
      5, 9,
    ]);
    expect(countsOf(both).category).toEqual({ [CAMERAS.id]: 3, [LAPTOPS.id]: 4, [AUDIO.id]: 4 });
  });

  it("counts each value against every other filter, for every facet and value", () => {
    for (const filter of FILTER_SWEEP) {
      for (const facet of facetsFor(filter)) {
        for (const value of facet.values) {
          const applied = query.setFacetValues(filter, facet.id, [value.value]);
          expect(value.count).toBe(
            catalog.filterProducts(CATALOGUE, query.toFacetQuery(applied)).length,
          );
        }
      }
    }
  });

  it("accounts for the other-filtered products across the facets whose values cover the catalogue", () => {
    const filter = makeFilterState({ brandIds: [AURELIA.id, NORTHCREST.id], minRating: 3 });
    const facets = facetsFor(filter);
    const sum = (id: FacetId): number =>
      facetOf(facets, id).values.reduce((t, one) => t + one.count, 0);
    for (const id of ["category", "brand", "price"] as const)
      expect(sum(id)).toBe(otherFilteredCount(filter, id));
    // The rating facet's three values are floors rather than bands, so its counts are cumulative and their
    // sum exceeds the collection; the availability facet states the in-stock half of it, which is what its
    // single value accounts for. Each value still counts exactly the products its own filter would leave.
    for (const floor of ["4", "3", "2"] as const) {
      expect(countOf(facets, "rating", floor)).toBe(otherFilteredCount(filter, "rating", floor));
    }
    expect(sum("rating")).toBeGreaterThan(otherFilteredCount(filter, "rating"));
    expect(sum("availability")).toBe(otherFilteredCount(filter, "availability", "in-stock"));
  });

  it("returns the five facets in order, with their kinds and shape, and marks exactly what is applied", () => {
    const facets = facetsFor(makeFilterState());
    const declared = taxonomy.FACET_DEFINITIONS;
    expect(facets.map((one) => [one.id, one.kind])).toEqual(
      declared.map((one) => [one.id, one.kind]),
    );
    expect(facetOf(facets, "availability").values).toEqual([
      { value: "in-stock", label: "In stock only", count: 13, selected: false },
    ]);
    const picked = makeFilterState({ brandIds: [AURELIA.id], minRating: 4, inStockOnly: true });
    const selected = facetsFor({ ...picked, minPriceMinor: 5_000, maxPriceMinor: 9_999 });
    const marked = (id: FacetId): string[] => {
      const values = facetOf(selected, id).values.filter((one) => one.selected);
      return values.map((one) => one.value);
    };
    expect([marked("brand"), marked("price"), marked("rating")]).toEqual([
      [AURELIA.id],
      ["50-100"],
      ["4"],
    ]);
    expect([marked("availability"), marked("category")]).toEqual([["in-stock"], []]);
  });

  it("lists a term facet by identifier unless the vocabulary names it", () => {
    const shape = (id: FacetId): taxonomy.FacetDefinition => ({ id, label: id, kind: "terms" });
    const values = catalog.countFacetValues(CATALOGUE, UNFILTERED_QUERY, shape("brand"));
    const identifiers = values.map((one) => one.value);
    expect(values.every((one) => one.label === one.value)).toBe(true);
    expect(identifiers).toEqual([...identifiers].sort(ascending));
    const named = { categories: [CAMERAS, LAPTOPS], brands: BRANDS };
    const listed = catalog.countFacetValues(CATALOGUE, UNFILTERED_QUERY, shape("category"), {
      vocabulary: named,
    });
    expect(listed.map((one) => one.value)).toEqual([CAMERAS.id, LAPTOPS.id, AUDIO.id]);
    expect(listed.map((one) => one.label)).toEqual([CAMERAS.name, LAPTOPS.name, AUDIO.id]);
  });
});
