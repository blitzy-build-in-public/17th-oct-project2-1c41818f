/**
 * Path: tests/unit/lib/catalogSearchFlow.test.ts
 * Purpose: Search scoring, type-ahead suggestions, the debounced input path and the transport-backed reads.
 * Lines: 482
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as config from "@/constants/config";
import * as taxonomy from "@/constants/taxonomy";
import { BRANDS, CATEGORIES } from "@/data/categories";
import { salesProDataSource } from "@/data/repositories";
import * as catalog from "@/lib/catalogService";
import { failNext, registerDataSource } from "@/lib/mockServer";
import * as search from "@/lib/searchService";
import { debounce } from "@/utils/async";
import * as query from "@/utils/queryParams";

import type { ApiError, Result } from "@/types/common";
import type { Brand, Facet, FacetId, FacetValue, Product, SearchSuggestion } from "@/types/catalog";

import { makeBrand, makeCategory, makeFilterState, makeProduct } from "../../fixtures";

// The subjects are the search's rules — how a term is normalised, tokenised and scored, how the type-ahead
// ranks, groups and highlights what it offers, and how the field's debounce coalesces a burst — plus the
// catalogue's async surface driven through the real transport over the real repositories. Nothing is mocked:
// the only isolation is the seam's own failure switch.

/** The brand the ranking cases measure, a brand no case carries anywhere else, and a matching category. */
const AURELIA = makeBrand({ name: "Aurelia Audio" });
const KESTREL = makeBrand({ name: "Kestrel Optics" });
const KESTREL_CATEGORY = makeCategory({ name: "Kestrel" });
const NO_MATCH_SUMMARY = "Nothing here matches.";
/** The fields a matching fixture overrides so its own summary and tags can never match a token. */
const BARE = { summary: NO_MATCH_SUMMARY, tags: [] };

/** The brand and category names scoring reads, so no name disagrees with the identifier it belongs to. */
const LOOKUP: search.SearchLookup = {
  brandName: (id) => [AURELIA, KESTREL].find((brand) => brand.id === id)?.name ?? "",
  categoryName: (id) => (id === KESTREL_CATEGORY.id ? KESTREL_CATEGORY.name : ""),
};

/** Eight products: six carrying the Aurelia brand whose name the ranking case measures, and two carrying
 *  neither that brand nor any word a matching case searches for. Each summary holds no searchable word, so
 *  a case's matches are decided by the field that case names. */
const AURELIA_NAMES = [
  "Aperture Prime Lens",
  "Aurelia Radio",
  "Aurelia Speaker",
  "Aurelia Headphones",
  "Aurelia Turntable",
  "Aurelia Amplifier",
];
const MATCHINGS: readonly Product[] = [
  ...AURELIA_NAMES.map((name) => makeProduct({ name, brandId: AURELIA.id, ...BARE })),
  makeProduct({ name: "Cascade Speaker", ...BARE }),
  makeProduct({ name: "Trailhead Kettle", ...BARE }),
];

/** The identifiers of a collection, and of the matching product with one name. */
function idsOf(products: readonly Product[]): string[] {
  return products.map((one) => one.id);
}
function productNamed(name: string): Product {
  const found = MATCHINGS.find((one) => one.name === name);
  if (found === undefined) throw new Error(`The table holds no product named "${name}".`);
  return found;
}

/** A product built for a scoring case: no summary or tag that could match, plus whatever `changes` adds. */
function scoringProduct(name: string, changes: Partial<Product> = {}): Product {
  return makeProduct({ name, summary: NO_MATCH_SUMMARY, tags: [], ...changes });
}

/** The payload of a successful result, or the shaped failure of a refused one, both reached without a
 *  `try`/`catch`: a transport case narrows through one of these, and neither ever throws. */
function valueOf<TValue>(result: Result<TValue>, what: string): TValue {
  if (result.ok) return result.value;
  throw new Error(`${what} failed: ${result.error.status} ${result.error.code}`);
}
function failureOf<TValue>(result: Result<TValue>, what: string): ApiError {
  if (!result.ok) return result.error;
  throw new Error(`${what} was answered.`);
}

/** Every product the transport serves, gathered by paging the whole catalogue at the widest configured
 *  size, so a case can compare an endpoint's answer against the pure rules over the collection it serves
 *  rather than against a count copied out of the seed. */
async function readWholeCatalogue(): Promise<Product[]> {
  const pageSize = config.PAGE_SIZE_OPTIONS[config.PAGE_SIZE_OPTIONS.length - 1];
  const state = { ...query.DEFAULT_FILTER_STATE, pageSize };
  const first = valueOf(await catalog.listProducts(state), "Listing");
  const products = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    const more = valueOf(await catalog.listProducts({ ...state, page }), `Listing page ${page}`);
    products.push(...more.items);
  }
  return products;
}

/** One facet's values, by identifier, or a thrown error when the response omits that facet. */
function facetValuesOf(facets: readonly Facet[], id: FacetId): readonly FacetValue[] {
  const found = facets.find((facet) => facet.id === id);
  if (found === undefined) throw new Error(`The response carries no "${id}" facet.`);
  return found.values;
}

describe("search matching", () => {
  it("normalises a term to its comparison key and tokenises what is matchable in it", () => {
    expect(search.normaliseQuery("  Aurora,  Desk-Lamp  ")).toBe("aurora desk lamp");
    expect([search.normaliseQuery("Desk"), search.normaliseQuery("   ")]).toEqual(["desk", ""]);
    expect(search.tokenise("Aurora Desk Lamp")).toEqual(["aurora", "desk", "lamp"]);
    expect(search.tokenise("USB-C hub")).toEqual(["usb", "hub"]);
    expect(search.tokenise("lamp lamp LAMP")).toEqual(["lamp"]);
    expect([search.tokenise("a b 7"), search.tokenise("")]).toEqual([[], []]);
  });

  it("treats a term holding nothing searchable as blank, and completes the word a token opens", () => {
    for (const blank of ["", "   ", " - ", "a", "7"]) expect(search.isBlankQuery(blank)).toBe(true);
    for (const term of ["au", "lamp"]) expect(search.isBlankQuery(term)).toBe(false);
    const matched = search.applyTextMatch(MATCHINGS, "  ", LOOKUP);
    expect([idsOf(matched), matched === MATCHINGS]).toEqual([idsOf(MATCHINGS), false]);
    expect(search.applyTextMatch(MATCHINGS, "zzzz", LOOKUP)).toEqual([]);
    const lens = productNamed("Aperture Prime Lens").id;
    // "apertur" is only the opening of the name's first word, and the opening is what the whole word a
    // prefix completes answers, so the listing reaches what a type-ahead row for the same term offers.
    expect(idsOf(search.applyTextMatch(MATCHINGS, "apertur", LOOKUP))).toEqual([lens]);
    expect(idsOf(search.applyTextMatch(MATCHINGS, "lens", LOOKUP))).toEqual([lens]);
    const exact = idsOf(search.applyTextMatch(MATCHINGS, "aurelia radio", LOOKUP));
    expect(exact[0]).toBe(productNamed("Aurelia Radio").id);
  });

  it("orders a text match by score descending, then name, then identifier", () => {
    const tokens = search.tokenise("aurelia");
    const score = (one: Product): number => search.scoreProduct(one, tokens, LOOKUP);
    const admitted = MATCHINGS.filter((one) => score(one) > 0);
    const expected = [...admitted].sort((left, right) => {
      const byScore = score(right) - score(left);
      if (byScore !== 0) return byScore;
      if (left.name !== right.name) return left.name < right.name ? -1 : 1;
      return left.id < right.id ? -1 : 1;
    });
    expect(admitted).toHaveLength(6);
    expect(idsOf(search.applyTextMatch(MATCHINGS, "aurelia", LOOKUP))).toEqual(idsOf(expected));
  });

  it("weights a token by the field it lands in, in the documented order", () => {
    const tokens = search.tokenise("kestrel");
    const fields = [
      scoringProduct("Kestrel Notebook"),
      scoringProduct("Field Notebook", { brandId: KESTREL.id }),
      scoringProduct("Field Notebook", { categoryId: KESTREL_CATEGORY.id }),
      scoringProduct("Field Notebook", { tags: ["kestrel"] }),
      scoringProduct("Field Notebook", { summary: "A quiet kestrel finish." }),
    ];
    const scores = fields.map((one) => search.scoreProduct(one, tokens, LOOKUP));
    for (const rank of [0, 1, 2, 3]) expect(scores[rank]).toBeGreaterThan(scores[rank + 1]);
    expect(scores[4]).toBeGreaterThan(0);
    const radio = productNamed("Aurelia Radio");
    expect([
      search.scoreProduct(radio, tokens, LOOKUP),
      search.scoreProduct(radio, [], LOOKUP),
    ]).toEqual([0, 0]);
  });
});

describe("type-ahead suggestions", () => {
  /** The route builders a suggestion's target is built from, as the search field supplies them. */
  const TARGETS = {
    productTarget: (slug: string): string => `/product/${slug}`,
    categoryTarget: (slug: string): string => `/category/${slug}`,
    brandTarget: (id: string): string => `/search?brand=${id}`,
  };
  /** More product candidates than the cap keeps, and one mixed list the ranking cases share. */
  const MANY = Array.from({ length: config.SEARCH_SUGGESTION_LIMIT + 4 }, (_unused, index) =>
    makeProduct({ name: `Aurora Desk Lamp ${index + 1}` }),
  );
  const SUGGESTIONS: readonly SearchSuggestion[] = [
    { text: "Speakers", kind: "category", target: "/category/speakers" },
    { text: "Aurelia Audio", kind: "brand", target: "/search?brand=aurelia" },
    { text: "Aurelia Speaker Stand", kind: "product", target: "/product/stand" },
    { text: "Aurelia Speaker", kind: "product", target: "/product/speaker" },
  ];
  const asked = (
    products: readonly Product[],
    brands: readonly Brand[],
    term: string,
    limit?: number,
  ) =>
    search.buildSuggestions({
      sources: { products, categories: [], brands },
      query: term,
      targets: TARGETS,
      limit,
    });

  it("orders and groups suggestions by tier, then text, then target", () => {
    const ranked = search.rankSuggestions(SUGGESTIONS, "aurelia");
    const texts = ["Aurelia Speaker", "Aurelia Speaker Stand", "Aurelia Audio", "Speakers"];
    expect(ranked.map((one) => one.text)).toEqual(texts);
    const kept = search.rankSuggestions(SUGGESTIONS, "   ").map((one) => one.target);
    expect(kept).toEqual(SUGGESTIONS.map((one) => one.target));
    const tied: readonly SearchSuggestion[] = [
      { text: "Aurelia Speaker", kind: "product", target: "/product/z" },
      { text: "Aurelia Speaker", kind: "product", target: "/product/a" },
    ];
    expect(search.rankSuggestions(tied, "aurelia").map((one) => one.target)).toEqual([
      "/product/a",
      "/product/z",
    ]);
    const groups = search.groupSuggestionsByKind(ranked);
    expect(groups.map((group) => group.kind)).toEqual(["product", "brand", "category"]);
    expect(groups.flatMap((group) => group.items.map((one) => one.text))).toEqual(texts);
    expect(groups.flatMap((group) => group.items)).toHaveLength(SUGGESTIONS.length);
    expect(search.groupSuggestionsByKind([SUGGESTIONS[0]]).map((group) => group.kind)).toEqual([
      "category",
    ]);
    expect(search.groupSuggestionsByKind([])).toEqual([]);
  });

  it("caps the list at the configured limit and honours a smaller one", () => {
    const sources = { products: MANY, categories: [], brands: [KESTREL] };
    const capped = search.buildSuggestions({ sources, query: "aurora", targets: TARGETS });
    expect(capped).toHaveLength(config.SEARCH_SUGGESTION_LIMIT);
    for (const limit of [1, 3]) {
      const narrower = { sources, query: "aurora", targets: TARGETS, limit };
      expect(search.buildSuggestions(narrower)).toHaveLength(limit);
    }
  });

  it("builds every kind of suggestion with the caller's route builders, one row per wording", () => {
    const radio = productNamed("Aurelia Radio");
    expect(asked([radio], [], "aurelia radio")).toEqual([
      { text: radio.name, kind: "product", target: TARGETS.productTarget(radio.slug) },
    ]);
    const byBrand = asked([], [KESTREL], "kestrel");
    expect(byBrand).toEqual([
      { text: KESTREL.name, kind: "brand", target: TARGETS.brandTarget(KESTREL.id) },
    ]);
    const repeated = [makeProduct({ name: "Aurora Lamp" }), makeProduct({ name: "aurora lamp" })];
    expect(asked(repeated, [], "aurora")).toHaveLength(1);
    expect(asked(repeated, [], "   ")).toEqual([]);
  });

  it("marks the matched words, reproduces the value exactly, and marks nothing without a token", () => {
    const segments = search.highlightSegments("Aurelia Speaker Stand", ["speaker"]);
    expect(segments.map((one) => one.matched)).toEqual([false, false, true, false, false]);
    expect(segments.map((one) => one.text).join("")).toBe("Aurelia Speaker Stand");
    const shouted = search.highlightSegments("SPEAKER Cabinet", ["speaker"]);
    expect(shouted.map((one) => one.matched)).toEqual([true, false, false]);
    expect(search.highlightSegments("Aurelia", ["speaker"])).toEqual([
      { text: "Aurelia", matched: false },
    ]);
    const unmatched = search.highlightSegments("Aurelia Speaker", []);
    expect(unmatched.map((one) => one.matched)).toEqual([false, false, false]);
    expect(search.highlightSegments("", ["speaker"])).toEqual([]);
  });

  // The rule that keeps the panel and the listing from disagreeing: whatever product a row offers for a
  // term, the listing reaches that product for the same term. Each case names a term whose word the
  // panel completes, and every product it is offered for must be there when the term itself is searched.
  it.each(["aur", "kett", "speak", "apertur"])(
    "reaches in the listing every product the term %s is offered for",
    (term) => {
      const offered = asked(MATCHINGS, [AURELIA, KESTREL], term).filter(
        (one) => one.kind === "product",
      );
      const reached = idsOf(search.applyTextMatch(MATCHINGS, term, LOOKUP));
      expect(offered.length).toBeGreaterThan(0);
      for (const one of offered) expect(reached).toContain(productNamed(one.text).id);
    },
  );
});

describe("the debounced type-ahead path", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once with the last arguments when a burst settles, and once more on flush", () => {
    vi.useFakeTimers();
    const run = vi.fn<(term: string) => void>();
    const debounced = debounce(run, config.SEARCH_SUGGESTION_DEBOUNCE_MS);
    const immediate = debounced("au");
    expect(immediate).toBeUndefined();
    debounced("aur");
    debounced("aurora");
    vi.advanceTimersByTime(config.SEARCH_SUGGESTION_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledWith("aurora");
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(config.SEARCH_SUGGESTION_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
    debounced("aurelia");
    debounced.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("aurelia");
    debounced.flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops a pending call when it is cancelled", () => {
    vi.useFakeTimers();
    const run = vi.fn<(term: string) => void>();
    const debounced = debounce(run, config.SEARCH_SUGGESTION_DEBOUNCE_MS);
    debounced("aurora");
    debounced.cancel();
    vi.advanceTimersByTime(config.SEARCH_SUGGESTION_DEBOUNCE_MS);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the catalogue transport", () => {
  let served: readonly Product[] = [];

  beforeAll(async () => {
    registerDataSource(salesProDataSource);
    served = await readWholeCatalogue();
  });

  it("reads one product and answers an unknown identifier as a 404 value", async () => {
    const known = valueOf(await catalog.getProduct(served[0].id), "Reading a served product");
    expect(known.id).toBe(served[0].id);
    const missing = await catalog.getProduct(makeProduct({ name: "Absent Body" }).id);
    const error = failureOf(missing, "A product the catalogue does not hold");
    expect([error.status, error.code]).toEqual([404, "product-not-found"]);
  });

  it("lists what the pure pipeline produces over the collection it serves", async () => {
    const subject = served[0];
    const filter = makeFilterState({
      categoryIds: [subject.categoryId],
      sort: "price-asc",
      pageSize: 24,
    });
    const listed = valueOf(await catalog.listProducts(filter), "Listing");
    const filtered = catalog.filterProducts(served, catalog.normaliseProductQuery(filter));
    expect(listed).toEqual(
      catalog.paginateProducts(catalog.sortProducts(filtered, filter.sort), filter),
    );
    expect(listed.total).toBe(served.filter((one) => one.categoryId === subject.categoryId).length);
    const searched = makeFilterState({ q: "aurora", sort: "relevance", pageSize: 24 });
    expect(await search.search(searched)).toEqual(await catalog.listProducts(searched));
  });

  it("carries every optional filter member into the listing a search requests", async () => {
    // The subject is an in-stock, well-rated, tagged product, because a case that narrows on all of them
    // at once has to start from a product that survives its own filter. The price band is the product's
    // own price at both ends, so a listing that dropped that member would answer a broader page.
    const subject = served.find(
      (one) => one.stockOnHand > 0 && one.ratingAverage >= 4 && one.tags.length > 0,
    );
    if (subject === undefined) {
      throw new Error("The served catalogue holds no in-stock, rated and tagged product.");
    }
    const filter = makeFilterState({
      categoryIds: [subject.categoryId],
      brandIds: [subject.brandId],
      minPriceMinor: subject.priceMinor,
      maxPriceMinor: subject.priceMinor,
      minRating: 4,
      inStockOnly: true,
      tags: [subject.tags[0]],
      pageSize: config.PAGE_SIZE_OPTIONS[config.PAGE_SIZE_OPTIONS.length - 1],
    });
    const listed = valueOf(await catalog.listProducts(filter), "A listing carrying every filter");
    const searched = valueOf(await search.search(filter), "A search carrying every filter");
    const expected = catalog.paginateProducts(
      catalog.sortProducts(
        catalog.filterProducts(served, catalog.normaliseProductQuery(filter)),
        filter.sort,
      ),
      filter,
    );
    // The two client entry points build the same request from one state, and the transport answers it
    // with what the pure pipeline over the collection it serves produces: a member either entry point
    // left out would answer a page this filter does not.
    expect(searched).toEqual(listed);
    expect(listed).toEqual(expected);
    expect(listed.total).toBeGreaterThan(0);
    expect(idsOf(listed.items)).toContain(subject.id);
    for (const one of listed.items) {
      expect([one.categoryId, one.brandId]).toEqual([subject.categoryId, subject.brandId]);
      expect([one.priceMinor, one.stockOnHand > 0, one.ratingAverage >= 4]).toEqual([
        subject.priceMinor,
        true,
        true,
      ]);
    }
  });

  it("relates a product to its same-category neighbours, nearest in price first", async () => {
    const subject = served[0];
    const limit = config.RELATED_PRODUCTS_LIMIT;
    const items = valueOf(await catalog.getRelated(subject.id, limit), "Related");
    expect(
      items.every((one) => one.categoryId === subject.categoryId && one.id !== subject.id),
    ).toBe(true);
    expect([items.length > 0, items.length <= limit]).toEqual([true, true]);
    const distances = items.map((one) => Math.abs(one.priceMinor - subject.priceMinor));
    expect(distances).toEqual([...distances].sort((left, right) => left - right));
    expect(idsOf(items)).toEqual(idsOf(catalog.selectRelated(served, subject.id, limit)));
    const wide = valueOf(await catalog.getRelated(subject.id, limit * 10), "Related");
    expect(wide.length).toBeLessThanOrEqual(limit);
  });

  it("counts every facet value the way its own listing would", async () => {
    const filter = makeFilterState({ categoryIds: [served[0].categoryId], inStockOnly: true });
    const facets = valueOf(await catalog.buildFacets(filter), "Facets");
    expect(facets.map((one) => one.id)).toEqual(taxonomy.FACET_DEFINITIONS.map((one) => one.id));
    for (const facet of facets) {
      const declared = taxonomy.FACET_DEFINITIONS.find((one) => one.id === facet.id);
      expect(facet.kind).toBe(declared?.kind);
      for (const value of facet.values) {
        const applied = query.setFacetValues(filter, facet.id, [value.value]);
        const narrowed = valueOf(await catalog.listProducts(applied), `Listing ${facet.id}`);
        expect(value.count).toBe(narrowed.total);
      }
    }
  });

  it("still offers every category and brand at count zero when a term matches no product", async () => {
    const filter = makeFilterState({ q: "zzzzqqq" });
    expect(valueOf(await catalog.listProducts(filter), "Listing").total).toBe(0);
    const facets = valueOf(await catalog.buildFacets(filter), "Facets");
    const held = (ids: readonly string[]): string[] => [...new Set(ids)].sort();
    expect(
      facetValuesOf(facets, "category")
        .map((one) => one.value)
        .sort(),
    ).toEqual(held(served.map((one) => one.categoryId)));
    expect(
      facetValuesOf(facets, "brand")
        .map((one) => one.value)
        .sort(),
    ).toEqual(held(served.map((one) => one.brandId)));
    // Each value is named by the vocabulary the endpoint serves categories and brands from, so the group the
    // term facets render carries the shopper's words rather than an identifier.
    const named = (records: readonly { id: string; name: string }[]): Map<string, string> =>
      new Map(records.map((record) => [record.id, record.name]));
    for (const [id, records] of [
      ["category", CATEGORIES],
      ["brand", BRANDS],
    ] as const)
      expect(
        facetValuesOf(facets, id).every((one) => one.label === named(records).get(one.value)),
      ).toBe(true);
    // Every facet keeps its rows, and every count is the counted collection's — empty here — so the wider
    // vocabulary supplies the values without widening a single count.
    expect(
      facets.every(
        (facet) =>
          facet.values.length > 0 && facet.values.every((one) => one.count === 0 && !one.selected),
      ),
    ).toBe(true);
  });

  it("answers a suggestion request within the cap, and a blank term without one", async () => {
    const response = await search.suggest("au");
    const suggestions = valueOf(response, "Suggestions");
    const shaped = suggestions.every((one) => one.text !== "" && one.target.startsWith("/"));
    const capped = suggestions.length <= config.SEARCH_SUGGESTION_LIMIT;
    expect([suggestions.length > 0, capped, shaped]).toEqual([true, true, true]);
    expect(valueOf(await search.suggest("au", 2), "Suggestions").length).toBeLessThanOrEqual(2);
    expect(await search.suggest("au")).toEqual(response);
    expect(await search.suggest("   ")).toEqual({ ok: true, value: [] });
  });

  it("resolves a superseded request and an armed failure to shaped values", async () => {
    const controller = new AbortController();
    controller.abort();
    const limit = config.SEARCH_SUGGESTION_LIMIT;
    const aborted = await search.suggest("aurora", limit, controller.signal);
    const error = failureOf(aborted, "A superseded request");
    expect([error.status, error.code]).toEqual([499, "request-aborted"]);
    failNext({ method: "GET", path: "/api/products" });
    const refused = await catalog.listProducts(query.DEFAULT_FILTER_STATE);
    const refusal = failureOf(refused, "An armed failure");
    expect([refusal.status, refusal.code]).toEqual([503, "data-source-unavailable"]);
  });
});
