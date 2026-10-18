/**
 * Path: src/lib/catalogService.ts
 * Purpose: Filtering, cross-filtered facet counts, sorting and paging over the catalogue
 * Lines: 169
 */

import { RELATED_PRODUCTS_LIMIT } from "@/constants/config";
import { API_PATHS, fillApiPath, getJson } from "@/lib/apiClient";
import type {
  Facet,
  FacetQuery,
  FilterState,
  Product,
  RelatedProductsResponse,
} from "@/types/catalog";
import type { PageResult, ProductId, QueryParams, Result } from "@/types/common";
import { normaliseProductQuery } from "@/utils/catalogRules";
import { FILTER_PARAMS, readFilterState, writeFilterState } from "@/utils/queryParams";

// The public surface ------------------------------------------------------------------------------
// The catalogue's rules — filter matching, cross-filtered facet counts, the sort orders, related products and
// paging — live in `src/utils/catalogRules.ts`, in the foundations layer, because the data module composes them
// over the collections it holds and a file may import only from its own layer or from a layer below it. Every
// name a consumer imports stays at this path, as `src/utils/dates.ts` repeats the names of the module its own
// concern is split into.

export {
  buildFacetResponse,
  compareBy,
  countFacetValues,
  filterProducts,
  matchesFilter,
  normaliseProductQuery,
  paginateProducts,
  resolvePageSize,
  selectRelated,
  sortProducts,
  type FacetCountOptions,
  type FacetResponseOptions,
  type FacetVocabulary,
} from "@/utils/catalogRules";

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
  return getJson<PageResult<Product>>(API_PATHS.PRODUCTS, {
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
  return getJson<Product>(fillApiPath(API_PATHS.PRODUCT_DETAIL, { id }), {
    signal: options.signal,
  });
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
  return getJson<RelatedProductsResponse>(fillApiPath(API_PATHS.PRODUCT_RELATED, { id }), {
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
  return getJson<Facet[]>(API_PATHS.FACETS, {
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
