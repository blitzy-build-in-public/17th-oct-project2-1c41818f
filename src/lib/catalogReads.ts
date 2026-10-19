/**
 * Path: src/lib/catalogReads.ts
 * Purpose: The catalogue's reads that are not a filtered listing — the category tree and the walk over it, the brands, the product a route's segment names, and a product's reviews
 * Lines: 240
 */

import { PAGE_SIZE_OPTIONS } from "@/constants/config";
import { NOT_FOUND_COPY } from "@/constants/content";
import {
  API_ERROR_CODES,
  API_PATHS,
  failure,
  fillApiPath,
  getJson,
  postJson,
} from "@/lib/apiClient";
import { listProducts } from "@/lib/catalogService";
import type { CatalogRequestOptions } from "@/lib/catalogService";
import type {
  Brand,
  CategoryNode,
  Product,
  Review,
  ReviewInput,
  ReviewQuery,
} from "@/types/catalog";
import type { PageResult, ProductId, Result, SessionToken } from "@/types/common";
import { DEFAULT_FILTER_STATE } from "@/utils/queryParams";

/*
 * The catalogue's reads, kept beside `src/lib/catalogService.ts` rather than inside it: filtering and reading a
 * catalogue is one concern, and one file may not exceed 600 lines, so that file holds the catalogue's rules —
 * what a filter means, which values a facet offers and how their counts are computed, what each sort key orders
 * by, which products are related — and the reads that are not a filtered listing live here. Every one of them is
 * reached through `src/lib/apiClient.ts`: a module imports only from its own layer or a layer below, so a
 * feature calls a function of the catalogue's service surface and never names a request path itself.
 *
 * Deliberately not re-exported from `catalogService.ts`, unlike `src/lib/reportSeries.ts`: the slug read below
 * is built on that module's `listProducts`, so a re-export would close an import cycle between the two. The
 * dependency runs one way — this module imports the catalogue's rules, and a consumer imports these reads from
 * here.
 */

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
