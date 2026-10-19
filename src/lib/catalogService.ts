/**
 * Path: src/lib/catalogService.ts
 * Purpose: Filtering, cross-filtered facet counts, sorting and paging over the catalogue
 * Lines: 389
 */

import { PAGE_SIZE_OPTIONS, RELATED_PRODUCTS_LIMIT } from "@/constants/config";
import { NOT_FOUND_COPY } from "@/constants/content";
import {
  API_ERROR_CODES,
  API_PATHS,
  failure,
  fillApiPath,
  getJson,
  postJson,
} from "@/lib/apiClient";
import type {
  Brand,
  CategoryNode,
  Facet,
  FacetQuery,
  FilterState,
  Product,
  RelatedProductsResponse,
  Review,
  ReviewInput,
  ReviewQuery,
} from "@/types/catalog";
import type { PageResult, ProductId, QueryParams, Result, SessionToken } from "@/types/common";
import { normaliseProductQuery } from "@/utils/catalogRules";
import {
  DEFAULT_FILTER_STATE,
  FILTER_PARAMS,
  readFilterState,
  writeFilterState,
} from "@/utils/queryParams";

// The public surface ------------------------------------------------------------------------------
// The catalogue's service surface: every read a catalogue screen makes is a function of this module — the
// filtered listing, one product, its related strip and the facets beside it, the category tree and the brands,
// the product a detail route's segment names, and a product's reviews, read and published — so a feature calls
// one of them and names no request path itself. The rules those reads are built on — filter matching,
// cross-filtered facet counts, the sort orders, related products and paging — live in `src/utils/catalogRules.ts`,
// in the foundations layer, because the data module composes them over the collections it holds and a file may
// import only from its own layer or from a layer below it. They are re-exported here, so every name a consumer
// imports stays at this path, as `src/utils/dates.ts` repeats the names of the module its own concern is split
// into.

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

// The reference collections -----------------------------------------------------------------------

/**
 * Reads the category tree: every parent with its children nested beneath it, each node carrying its own
 * product count, the children in position order. Both the navigation and the detail page's breadcrumb trail
 * walk it, so it is a read of the catalogue rather than of any one screen.
 *
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns The category nodes, or the shaped failure; never a rejection.
 */
export function listCategories(
  options: CatalogRequestOptions = {},
): Promise<Result<CategoryNode[]>> {
  return getJson<CategoryNode[]>(API_PATHS.CATEGORIES, { signal: options.signal });
}

/**
 * Every node of the category tree in one list: each parent followed by its own children, in the position order
 * both levels already arrive in.
 *
 * `CategoryNode` is a tree rather than a collection — a parent holds its children in its own `children` array —
 * so a consumer resolving a category by identifier has to walk it first, and this is the one walk: the catalogue
 * route resolves the category its address names with it, and the detail route resolves the category a product
 * belongs to, which is a leaf at either level. Walking recursively means a tree deeper than the two levels
 * `GET /api/categories` answers with would resolve the same way, and no level is re-sorted because each already
 * arrives in `position` order.
 *
 * @param nodes - The tree as {@link listCategories} answered it; never mutated.
 * @returns The same nodes with their descendants, parents and children, each level in position order.
 */
export function flattenCategoryTree(nodes: readonly CategoryNode[]): readonly CategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategoryTree(node.children)]);
}

/**
 * Reads the brands: every brand with the number of products the catalogue holds under it, which the brand facet
 * and the active-filter chips display beside each value.
 *
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns The brands, or the shaped failure; never a rejection.
 */
export function listBrands(options: CatalogRequestOptions = {}): Promise<Result<Brand[]>> {
  return getJson<Brand[]>(API_PATHS.BRANDS, { signal: options.signal });
}

// The product a route's segment names ------------------------------------------------------------------

/**
 * Reports whether a product is the one a detail route's segment names.
 *
 * {@link getProductBySlug} resolves a product under either spelling: the readable `slug` a `/product/:slug`
 * route carries, and the prefixed `id` a link from `src/features/admin/TopProductsTable.tsx` carries. That
 * question is asked by more than one reader — the scan below asks it of every row it pages through, and a page
 * holding a product from an earlier read asks it of that payload before showing it under a segment whose own
 * read is still in flight — so it is answered in one place rather than repeated at each of them.
 *
 * @param product - The product a caller holds.
 * @param segment - The route segment: the product's slug, or its identifier.
 * @returns Whether the product is the one the segment names.
 */
export function isProductSegment(product: Product, segment: string): boolean {
  return product.slug === segment || product.id === segment;
}

/** The page size the slug read walks the listing at: the largest configured size, so the products the term
 *  matches are crossed in as few requests as the catalogue's own sizes allow. */
const SCAN_PAGE_SIZE = PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1];

/** The refusal a segment that names no product the catalogue holds is answered with: the seam's own code and
 *  its own wording, so a caller renders exactly the not-found state the detail endpoint produces for an
 *  identifier it holds nothing for. */
function missingProduct(): Result<never> {
  return failure(API_ERROR_CODES.PRODUCT_NOT_FOUND, NOT_FOUND_COPY.BODY);
}

/**
 * Reads the product a detail route's segment names.
 *
 * The route carries the product's readable slug (`/product/:slug`) while `GET /api/products/:id` keys its
 * lookup by the prefixed identifier (`prod_…`), and neither spelling can be derived from the other on the
 * client — an identifier's suffix is cut and disambiguated with a hash once a name passes its readable
 * maximum — so asking the detail endpoint with the segment answers `404 product-not-found` for a product the
 * catalogue holds. The listing answers instead, and it answers exactly: every word of a product's slug is a
 * word of that product's own name, so the product is always inside the set the query term matches, and the
 * scan below walks that whole set — page by page, to the last page the payload reports — until it reaches the
 * row whose `slug` or `id` is the segment. Which page the product ranks on is therefore irrelevant to the
 * answer: the scan, and not the ranking, is what makes the read exact.
 *
 * The identifier spelling is accepted beside the slug because `src/features/admin/TopProductsTable.tsx` links
 * a product by its identifier. A segment naming no product the catalogue sells resolves the refusal above.
 *
 * @param segment - The route segment: the product's slug, or its identifier.
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns The product, or the shaped failure; never a rejection.
 */
export async function getProductBySlug(
  segment: string,
  options: CatalogRequestOptions = {},
): Promise<Result<Product>> {
  const wanted = segment.trim();
  if (wanted === "") return missingProduct();
  return scanListingFor(wanted, options.signal);
}

/**
 * Walks the listing's term-matched pages, best match first, until one of them holds the segment asked for.
 *
 * The term is the segment itself, the sort keeps the ranking the match produced, and the page size is the
 * largest configured one. A payload reporting a next page is followed, so a product the term ranks last is
 * still found. `src/data/repositories.ts` matches a term with `src/lib/searchService.ts` before it filters,
 * sorts and pages, so each page read here is a page of the same result set a search for the segment would
 * show, and the set is walked to its end rather than sampled.
 *
 * @param segment - The slug or the identifier being looked for, already trimmed and non-empty.
 * @param signal - The abort signal of a request a newer one supersedes.
 * @returns The matching product, the listing's own failure, or the refusal when no page holds it.
 */
async function scanListingFor(segment: string, signal?: AbortSignal): Promise<Result<Product>> {
  for (let page = 1; ; page += 1) {
    const listing = await listProducts(
      {
        ...DEFAULT_FILTER_STATE,
        q: segment,
        sort: "relevance",
        pageSize: SCAN_PAGE_SIZE,
        page,
      },
      { signal },
    );
    if (!listing.ok) return listing;
    const found = listing.value.items.find((one) => isProductSegment(one, segment));
    if (found !== undefined) return { ok: true, value: found };
    if (!listing.value.hasNext) return missingProduct();
  }
}

// A product's reviews ---------------------------------------------------------------------------------

/**
 * What a review submission may be handed beside its own arguments: the abort signal every read here takes,
 * and the session token the write authenticates with.
 *
 * The token comes from the session `src/state/AuthContext.tsx` holds and is required by the endpoint, which
 * answers `401` to a request that carries none. It is the transport's own member, so no second shape is
 * declared for it, and this module forwards it while remembering nothing: two callers may pass two tokens and
 * nothing here is shared between them.
 */
export interface CatalogReviewWriteOptions extends CatalogRequestOptions {
  readonly sessionToken: SessionToken;
}

/**
 * Reads one page of a product's reviews, newest first, optionally narrowed to the single rating the review
 * list's filter holds. The endpoint needs no session, so nothing but the signal travels beside the query.
 *
 * @param productId - The product whose reviews are wanted.
 * @param query - The page, its size and the rating to narrow to; the product travels in the path, so the
 *   query carries the paging and the rating alone.
 * @param options - The abort signal of a request a newer one supersedes.
 * @returns One page of reviews, or the shaped failure; never a rejection.
 */
export function listProductReviews(
  productId: ProductId,
  query: Omit<ReviewQuery, "productId">,
  options: CatalogRequestOptions = {},
): Promise<Result<PageResult<Review>>> {
  return getJson<PageResult<Review>>(fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: productId }), {
    query: { page: query.page, pageSize: query.pageSize, rating: query.rating },
    signal: options.signal,
  });
}

/**
 * Publishes a review and answers with the row the data layer stored, which is what the review list is
 * refreshed from rather than a row assembled by the caller.
 *
 * The endpoint requires a customer's session — an anonymous request answers `401` — and re-runs the review rule
 * over the body, answering `422` with the offending `field` named, so a form marks the control that caused the
 * refusal without a second copy of the rule. The author, the timestamp, the helpful count and the
 * verified-purchase flag are the data layer's answer, so none of them is sent from here.
 *
 * @param productId - The product being reviewed.
 * @param input - The rating, title and body the customer submitted.
 * @param options - The session token the write authenticates with, and the abort signal beside it.
 * @returns The stored review, or the shaped failure; never a rejection.
 */
export function submitProductReview(
  productId: ProductId,
  input: ReviewInput,
  options: CatalogReviewWriteOptions,
): Promise<Result<Review>> {
  return postJson<Review, ReviewInput>(
    fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: productId }),
    input,
    { sessionToken: options.sessionToken, signal: options.signal },
  );
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
