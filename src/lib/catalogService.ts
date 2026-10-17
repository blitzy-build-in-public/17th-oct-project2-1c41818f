/**
 * Path: src/lib/catalogService.ts
 * Purpose: Filtering, cross-filtered facet counts, sorting and paging over the catalogue
 * Lines: 597
 */

import { RELATED_PRODUCTS_LIMIT, type PageSize } from "@/constants/config";
import {
  FACET_DEFINITIONS,
  type FacetDefinition,
  type FacetDefinitionOption,
} from "@/constants/taxonomy";
import { getJson } from "@/lib/apiClient";
import type {
  Brand,
  Category,
  Facet,
  FacetId,
  FacetQuery,
  FacetValue,
  FilterState,
  Product,
  RelatedProductsResponse,
  SortKey,
} from "@/types/catalog";
import type { PageResult, ProductId, QueryParams, Result, SortDirection } from "@/types/common";
import {
  createComparator,
  normalisePageSize,
  paginate,
  sortBy,
  type Comparator,
  type Selector,
  type SortValue,
} from "@/utils/collections";
import {
  DEFAULT_FILTER_STATE,
  FILTER_PARAMS,
  clearFacet,
  facetValueMatches,
  readFilterState,
  toFacetQuery,
  writeFilterState,
} from "@/utils/queryParams";

/**
 * The catalogue's rules, and the only home of each: what a filter means, which values a facet offers and how
 * their counts are computed, what each sort key orders by, which products are related, and how a listing is
 * paged.
 *
 * Nothing here renders, formats money, reads the URL or touches the seeded collections: a rule takes the
 * products it works on as an argument, so `src/data/repositories.ts` composes these functions over the
 * catalogue it holds. Every function is pure, mutates no argument, keeps no state, and orders
 * deterministically with ties broken by identifier.
 */

// Endpoint paths --------------------------------------------------------------------------------

/** The listing endpoint, which reads the whole filter state — filter, sort and paging — as parameters. */
const PRODUCTS_PATH = "/api/products";

/** The facet endpoint, which reads the filter half of a state and answers the five facets directly. */
const FACETS_PATH = "/api/facets";

/** The path of one product's detail resource. */
function productPath(id: ProductId): string {
  return `${PRODUCTS_PATH}/${id}`;
}

/** The path of one product's related-items resource, which takes the count to answer as `limit`. */
function relatedProductsPath(id: ProductId): string {
  return `${productPath(id)}/related`;
}

// The client API --------------------------------------------------------------------------------

/**
 * What a catalogue request carries beside its own arguments: the abort signal the transport honours, so a view
 * superseding an in-flight request cancels it instead of letting a stale response land.
 */
export interface CatalogRequestOptions {
  readonly signal?: AbortSignal;
}

/**
 * Reads the catalogue: the products the filter selects, in the order its sort names, cut to its page.
 *
 * The sort is sent even when it matches the transport's own default, because a listing with no query term
 * rests at `newest` while an absent sort parameter would be read as `relevance`.
 *
 * @param filter - The filter, sort and paging state, as `src/utils/queryParams.ts` read it from the URL.
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns One page of products, or the shaped failure; never a rejection.
 */
export function listProducts(
  filter: FilterState,
  options: CatalogRequestOptions = {},
): Promise<Result<PageResult<Product>>> {
  return getJson<PageResult<Product>>(PRODUCTS_PATH, {
    query: productQueryParams(filter),
    signal: options.signal,
  });
}

/**
 * Reads one product. An unknown identifier is a value rather than an exception: the endpoint answers `404` with
 * the code `product-not-found`, which this passes through for the detail route's not-found state.
 *
 * @param id - The product to read.
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns The product, or the shaped failure; never a rejection.
 */
export function getProduct(
  id: ProductId,
  options: CatalogRequestOptions = {},
): Promise<Result<Product>> {
  return getJson<Product>(productPath(id), { signal: options.signal });
}

/**
 * Reads the products related to one product: same category, that product excluded, price nearest first. The
 * endpoint answers a named wrapper rather than a bare array, so the response is unwrapped here and a failure
 * passes through with its status and code intact.
 *
 * @param id - The product whose related items are wanted.
 * @param limit - How many to ask for; defaults to the configured strip length. The endpoint clamps it.
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns Up to `limit` related products, or the shaped failure; never a rejection.
 */
export function getRelated(
  id: ProductId,
  limit: number = RELATED_PRODUCTS_LIMIT,
  options: CatalogRequestOptions = {},
): Promise<Result<Product[]>> {
  return getJson<RelatedProductsResponse>(relatedProductsPath(id), {
    query: { limit },
    signal: options.signal,
  }).then(unwrapRelatedProducts);
}

/**
 * Reads the five facets for a filter: each facet's values, how many results each value would leave, and
 * whether the current selection already holds it. Only the filter half of the state is sent, because a facet
 * answers what would be left rather than which page to show.
 *
 * @param filter - The state whose facets are wanted.
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns The facets in the panel's order, or the shaped failure; never a rejection.
 */
export function buildFacets(
  filter: FilterState,
  options: CatalogRequestOptions = {},
): Promise<Result<Facet[]>> {
  return getJson<Facet[]>(FACETS_PATH, {
    query: filterQueryParams(normaliseProductQuery(filter)),
    signal: options.signal,
  });
}

/** The products a related-items response carries, with a failure passed through unchanged. */
function unwrapRelatedProducts(response: Result<RelatedProductsResponse>): Result<Product[]> {
  return response.ok ? { ok: true, value: response.value.items } : response;
}

// Request parameters ----------------------------------------------------------------------------

/**
 * The filter half of a query as request parameters, every member at its default left out. The keys come from
 * `FILTER_PARAMS`, which is also what the URL is written with, so a link into a filtered listing and the
 * request behind it name the same parameters.
 */
function filterQueryParams(query: FacetQuery): QueryParams {
  const params: Record<string, string | number | boolean | readonly string[]> = {};
  if (query.q !== "") params[FILTER_PARAMS.QUERY] = query.q;
  if (query.categoryIds.length > 0) params[FILTER_PARAMS.CATEGORY_IDS] = query.categoryIds;
  if (query.brandIds.length > 0) params[FILTER_PARAMS.BRAND_IDS] = query.brandIds;
  if (query.minPriceMinor !== null) params[FILTER_PARAMS.MIN_PRICE] = query.minPriceMinor;
  if (query.maxPriceMinor !== null) params[FILTER_PARAMS.MAX_PRICE] = query.maxPriceMinor;
  if (query.minRating !== null) params[FILTER_PARAMS.MIN_RATING] = query.minRating;
  if (query.inStockOnly) params[FILTER_PARAMS.IN_STOCK] = true;
  if (query.tags.length > 0) params[FILTER_PARAMS.TAGS] = query.tags;
  return params;
}

/**
 * A listing request's parameters: the canonical filter members, plus the sort and the paging. The state is
 * normalised through `src/utils/queryParams.ts` first — an inverted price range swapped, lists de-duplicated
 * and sorted, a page size outside the configured set replaced, a relevance sort left without a term repaired —
 * rather than a second set of normalisation rules derived here.
 */
function productQueryParams(filter: FilterState): QueryParams {
  const canonical = readFilterState(writeFilterState(filter));
  return {
    ...filterQueryParams(canonical),
    [FILTER_PARAMS.SORT]: canonical.sort,
    [FILTER_PARAMS.PAGE]: canonical.page,
    [FILTER_PARAMS.PAGE_SIZE]: canonical.pageSize,
  };
}

// Filtering -------------------------------------------------------------------------------------

/**
 * Whether a product belongs to the catalogue the storefront lists: `active` is what every catalogue, search and
 * facet query selects, while `draft` and `archived` are records the shopfront does not show. Applying it here
 * keeps the rule true for any collection a caller passes.
 */
function isSellable(product: Product): boolean {
  return product.status === "active";
}

/** Whether an amount in minor units falls in an inclusive band whose ends may each be open. */
function isInPriceBand(amount: number, minimum: number | null, maximum: number | null): boolean {
  if (minimum !== null && amount < minimum) return false;
  if (maximum !== null && amount > maximum) return false;
  return true;
}

/**
 * Whether a product is left by a filter: the predicate every listing and facet count is built from.
 *
 * A facet applies only when it holds something — an empty list, an absent bound, no rating floor and a false
 * flag each filter nothing — so one predicate serves the whole panel. Category and brand match the product's
 * own identifiers, the price band compares `priceMinor` in minor units, the rating compares the seeded
 * `ratingAverage` against the floor, availability is stock on hand, and the tags are an intersection. The query
 * term is deliberately not part of it: matching and ranking text belongs to `src/lib/searchService.ts`, which
 * the data layer applies to the collection before filtering.
 *
 * @param product - The product to test; never mutated.
 * @param query - The filter half of a query, as the URL or the endpoint carries it.
 * @returns Whether the product is left by the filter.
 */
export function matchesFilter(product: Product, query: FacetQuery): boolean {
  if (!isSellable(product)) return false;
  if (query.categoryIds.length > 0 && !query.categoryIds.includes(product.categoryId)) return false;
  if (query.brandIds.length > 0 && !query.brandIds.includes(product.brandId)) return false;
  if (!isInPriceBand(product.priceMinor, query.minPriceMinor, query.maxPriceMinor)) return false;
  if (query.minRating !== null && product.ratingAverage < query.minRating) return false;
  if (query.inStockOnly && product.stockOnHand <= 0) return false;
  if (query.tags.length > 0 && !query.tags.some((tag) => product.tags.includes(tag))) return false;
  return true;
}

/**
 * The products a filter leaves, in the order they were given: one pass, the input untouched, a new array. The
 * order is preserved because it is meaningful downstream — a search ranks its matches before this runs, and a
 * relevance sort keeps that ranking.
 *
 * @param products - The collection to filter; never mutated.
 * @param query - The filter to apply.
 * @returns The products the filter leaves, in input order.
 */
export function filterProducts(products: readonly Product[], query: FacetQuery): Product[] {
  return products.filter((product) => matchesFilter(product, query));
}

// Sorting ---------------------------------------------------------------------------------------

// The sort keys' selectors: the price a product sells at (not what it was listed at), the seeded average
// rating, the review count that stands in for popularity because a product carries no units-sold figure, the
// day it was added as an ISO 8601 string that orders without being parsed, and the identifier that breaks
// every remaining tie so two runs order a collection identically.
const priceOf = (product: Product): number => product.priceMinor;
const ratingOf = (product: Product): number => product.ratingAverage;
const reviewCountOf = (product: Product): number => product.ratingCount;
const createdAtOf = (product: Product): string => product.createdAt;
const idOf = (product: Product): string => product.id;

/** One key of a product sort: the value to order by, and, where it is not ascending, its direction. */
interface SortField {
  readonly select: Selector<Product, SortValue>;
  readonly direction?: SortDirection;
}

/**
 * What each sort key orders by, most significant first, ending on the identifier. `relevance` names no key at
 * all: relevance is the ranking `src/lib/searchService.ts` produced, and re-ordering by anything here would
 * destroy it.
 */
const SORT_ORDERS: Readonly<Record<SortKey, readonly SortField[]>> = {
  relevance: [],
  "price-asc": [{ select: priceOf }, { select: idOf }],
  "price-desc": [{ select: priceOf, direction: "desc" }, { select: idOf }],
  "rating-desc": [
    { select: ratingOf, direction: "desc" },
    { select: reviewCountOf, direction: "desc" },
    { select: idOf },
  ],
  newest: [{ select: createdAtOf, direction: "desc" }, { select: idOf }],
  popularity: [
    { select: reviewCountOf, direction: "desc" },
    { select: ratingOf, direction: "desc" },
    { select: idOf },
  ],
};

/**
 * The comparator a sort key orders products by: a plain function of two products, so a loaded collection can be
 * sorted with it — the shared table, the order-history table and the report tables do — as well as a request
 * passing the key to the data layer.
 *
 * @param sortKey - One of the six `SORT_OPTIONS` keys.
 * @returns A comparator usable with `sortBy` and with `Array.prototype.sort`.
 */
export function compareBy(sortKey: SortKey): Comparator<Product> {
  return createComparator<Product>(SORT_ORDERS[sortKey]);
}

/**
 * The products in the order a sort key names, as a new array. A relevance sort returns the incoming order
 * unchanged and in the same positions, because that order is the search ranking: the data layer composes a text
 * match, this function and then the page, so the relevance case must not touch the order.
 *
 * @param products - The collection to order; never mutated.
 * @param sortKey - The order to apply.
 * @returns The products in the requested order.
 */
export function sortProducts(products: readonly Product[], sortKey: SortKey): Product[] {
  if (sortKey === "relevance") return [...products];
  return sortBy(products, compareBy(sortKey));
}

// Facets ----------------------------------------------------------------------------------------

/**
 * The catalogue's own names for the values of the two facets whose terms come from the data they filter: the
 * data layer — which answers `GET /api/categories` and `GET /api/brands` from the same collections — hands the
 * records in here rather than this module keeping a second vocabulary or inventing a label.
 */
export interface FacetVocabulary {
  readonly categories: readonly Category[];
  readonly brands: readonly Brand[];
}

/** A facet value's name, as an identifier facet's vocabulary entry supplies it. */
interface NamedTerm {
  readonly id: string;
  readonly name: string;
}

/** One facet whose terms the catalogue supplies: how it reads a product's term, and how it names its terms.
 * A third such facet is one more row in the table below and nothing else. */
interface TermFacet {
  readonly termOf: (product: Product) => string;
  readonly termsOf: (vocabulary: FacetVocabulary) => readonly NamedTerm[];
}

/** The term facets, by identifier. */
const TERM_FACETS: Readonly<Partial<Record<FacetId, TermFacet>>> = {
  category: {
    termOf: (product) => product.categoryId,
    termsOf: (vocabulary) => vocabulary.categories,
  },
  brand: {
    termOf: (product) => product.brandId,
    termsOf: (vocabulary) => vocabulary.brands,
  },
};

/**
 * How the availability facet decides its single value: the vocabulary names that value in the shopper's words
 * without carrying the test it stands for, and stock is a product's own property rather than a declared bound.
 */
const BOOLEAN_VALUE_TESTS: Readonly<Partial<Record<FacetId, (product: Product) => boolean>>> = {
  availability: (product) => product.stockOnHand > 0,
};

/**
 * What a facet count may be given beside its own arguments: the vocabulary naming the category and brand terms.
 * Omitted, those facets offer the catalogue's own values labelled by the identifier itself.
 */
export interface FacetCountOptions {
  readonly vocabulary?: FacetVocabulary;
}

/** What a whole facet response may be given: the vocabulary above, and the definitions to render, which default
 * to `FACET_DEFINITIONS`, the product's only facet vocabulary. */
export interface FacetResponseOptions extends FacetCountOptions {
  readonly definitions?: readonly FacetDefinition[];
}

/** The state a facet query describes, as the shape the query module works on: paging and sort take their
 * documented defaults, because a facet request carries neither and depends on neither. */
function asFilterState(query: FacetQuery): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...query };
}

/**
 * The query with one facet's own selection removed and every other facet's kept: the cross-filtered counting
 * rule.
 *
 * A facet's counts describe what choosing a value would leave given everything else applied, so the selected
 * facet is cleared before its own values are counted — otherwise selecting one brand would drive every other
 * brand's count to zero. Clearing goes through the accessors in `src/utils/queryParams.ts`, so no facet is
 * special-cased by name here.
 */
function withoutFacetSelection(query: FacetQuery, facetId: FacetId): FacetQuery {
  return toFacetQuery(clearFacet(asFilterState(query), facetId));
}

/**
 * The test deciding whether a product holds one value of a facet, or `null` for a value the vocabulary describes
 * in no way a count could read: a term facet's value is the product's own term, a declared value carries the
 * rule it stands for — a rating floor, or the bounds of a price band — and availability states its own test.
 */
function valueTestFor(
  definition: FacetDefinition,
  option: FacetDefinitionOption,
): ((product: Product) => boolean) | null {
  const termFacet = TERM_FACETS[definition.id];
  if (termFacet !== undefined) return (product) => termFacet.termOf(product) === option.value;
  const booleanTest = BOOLEAN_VALUE_TESTS[definition.id];
  if (booleanTest !== undefined) return booleanTest;
  const { minRating, minMinor, maxMinor } = option;
  if (minRating !== undefined) return (product) => product.ratingAverage >= minRating;
  if (minMinor !== undefined || maxMinor !== undefined) {
    const minimum = minMinor ?? null;
    const maximum = maxMinor ?? null;
    return (product) => isInPriceBand(product.priceMinor, minimum, maximum);
  }
  return null;
}

/**
 * The values a term facet offers, each labelled and ordered as the vocabulary lists it, with any value the
 * vocabulary does not name last and ordered by identifier. Only values the collection holds are offered, so the
 * panel never presents a choice that leads nowhere; a selection naming a value the catalogue does not hold is
 * reported among the active filter chips instead.
 */
function catalogueTermOptions(
  facetId: FacetId,
  products: readonly Product[],
  vocabulary: FacetVocabulary | undefined,
): readonly FacetDefinitionOption[] {
  const termFacet = TERM_FACETS[facetId];
  if (termFacet === undefined) return [];
  const present = new Set(products.map((product) => termFacet.termOf(product)));
  const named = vocabulary === undefined ? [] : termFacet.termsOf(vocabulary);
  const options: FacetDefinitionOption[] = [];
  const namedValues = new Set<string>();
  for (const term of named) {
    if (!present.has(term.id)) continue;
    namedValues.add(term.id);
    options.push({ value: term.id, label: term.name });
  }
  for (const value of [...present].filter((term) => !namedValues.has(term)).sort()) {
    options.push({ value, label: value });
  }
  return options;
}

/** The values a facet offers: the ones the vocabulary declares where it declares any, otherwise the terms
 * the catalogue holds. */
function facetValueSources(
  definition: FacetDefinition,
  products: readonly Product[],
  vocabulary: FacetVocabulary | undefined,
): readonly FacetDefinitionOption[] {
  return definition.options ?? catalogueTermOptions(definition.id, products, vocabulary);
}

/** How many products a test accepts, counted in one pass without building a list of matches. */
function countMatching(products: readonly Product[], test: (product: Product) => boolean): number {
  let count = 0;
  for (const product of products) {
    if (test(product)) count += 1;
  }
  return count;
}

/**
 * One facet's values, each with the number of results choosing it would leave and whether the current query
 * already holds it. Counts are computed over the catalogue with this facet's own selection removed and every
 * other facet's applied, which keeps the remaining values meaningful while a facet is in use; the `selected`
 * flag is read from the query as it stands, through the same accessors the URL is written with, so the panel and
 * the query string cannot disagree about what is applied. A value the filters have emptied out keeps its place
 * with a count of zero rather than disappearing.
 *
 * @param products - The catalogue to count over — the text-matched collection when a query term is present,
 * since free-text matching is `src/lib/searchService.ts`'s to apply.
 * @param query - The filter as the panel holds it, this facet's own selection included.
 * @param definition - The facet to count, carrying its heading and either declared values or none.
 * @param options - The vocabulary naming an identifier facet's terms.
 * @returns The facet's values, in the order the vocabulary lists them.
 */
export function countFacetValues(
  products: readonly Product[],
  query: FacetQuery,
  definition: FacetDefinition,
  options: FacetCountOptions = {},
): FacetValue[] {
  const matching = filterProducts(products, withoutFacetSelection(query, definition.id));
  const state = asFilterState(query);
  return facetValueSources(definition, products, options.vocabulary).map((option) => {
    const test = valueTestFor(definition, option);
    return {
      value: option.value,
      label: option.label,
      count: test === null ? 0 : countMatching(matching, test),
      selected: facetValueMatches(state, definition.id, option.value),
    };
  });
}

/**
 * All five facets for a filter, in the order the filter panel renders them.
 *
 * @param products - The catalogue to count over, text-matched when a query term is present.
 * @param query - The filter as the panel holds it.
 * @param options - The vocabulary naming the identifier facets' terms, and the definitions to render.
 * @returns The facets, each with its values, counts and selections.
 */
export function buildFacetResponse(
  products: readonly Product[],
  query: FacetQuery,
  options: FacetResponseOptions = {},
): Facet[] {
  const definitions = options.definitions ?? FACET_DEFINITIONS;
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    values: countFacetValues(products, query, definition, options),
  }));
}

// Related products ------------------------------------------------------------------------------

/**
 * The products related to one product: the same category, that product excluded, nearest in price first, with
 * ties broken by name and then by identifier so the strip is identical in every run. Same-category neighbours
 * are the whole rule — a product carries no recommendation signal of its own — so a strip is drawn from the
 * collection a caller passes and the product being viewed is never its own relation.
 *
 * @param products - The catalogue to draw from; never mutated.
 * @param id - The product the strip is for; an identifier the collection does not hold yields none.
 * @param limit - How many to return; a count below one yields none.
 * @returns Up to `limit` related products, nearest in price first.
 */
export function selectRelated(
  products: readonly Product[],
  id: ProductId,
  limit: number,
): Product[] {
  const subject = products.find((product) => product.id === id);
  if (subject === undefined) return [];
  const count = Number.isFinite(limit) ? Math.floor(limit) : 0;
  if (count < 1) return [];
  const candidates = products.filter(
    (product) =>
      product.id !== subject.id &&
      product.categoryId === subject.categoryId &&
      isSellable(product),
  );
  return sortBy(
    candidates,
    createComparator<Product>([
      { select: (product) => Math.abs(product.priceMinor - subject.priceMinor) },
      { select: (product) => product.name },
      { select: (product) => product.id },
    ]),
  ).slice(0, count);
}

// Paging ----------------------------------------------------------------------------------------

/**
 * Cuts a listing to one page and reports the paging that produced it. The page is clamped to the pages that
 * exist and the size validated against the configured set by `src/utils/collections.ts`, which owns both rules.
 *
 * @param products - The whole filtered collection; never mutated.
 * @param query - The state whose page and page size are read.
 * @returns The page's products with the total, page count and next-and-previous flags.
 */
export function paginateProducts(
  products: readonly Product[],
  query: FilterState,
): PageResult<Product> {
  return paginate(products, query.page, query.pageSize);
}

/** The page size a request resolves to: one of the configured sizes, or the default for anything else. */
export function resolvePageSize(pageSize?: number): PageSize {
  return normalisePageSize(pageSize);
}

/**
 * The filter half of a listing state: every facet, the query term and the tags, with the sort and the paging
 * dropped. This is what `GET /api/facets` takes and what the filter rules match on, read back from the state's
 * canonical form so the terms a facet counts are the terms the listing filtered by.
 *
 * @param filter - The listing state to project.
 * @returns The state's filter members, canonical.
 */
export function normaliseProductQuery(filter: FilterState): FacetQuery {
  return toFacetQuery(filter);
}
