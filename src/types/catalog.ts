/**
 * Path: src/types/catalog.ts
 * Purpose: Catalogue shapes: product, image, category, brand, review, inventory, facet and filter types
 * Lines: 407
 */

import type {
  BrandId,
  CategoryId,
  CollectionResponse,
  CurrencyCode,
  CustomerId,
  IsoDateTimeString,
  MinorUnits,
  ProductId,
  ReviewId,
} from "@/types/common";

// Ratings --------------------------------------------------------------------------------------

/**
 * An integer star rating from one to five.
 *
 * The single home for the rating domain: a review's score, `FilterState.minRating`, the
 * `minRating` query parameter of `GET /api/products`, the rating facet's values and the review rule
 * in `src/utils/validation.ts` all narrow to this union, so no surface can accept a half star or a
 * value off the scale.
 */
export type RatingValue = 1 | 2 | 3 | 4 | 5;

// Products -------------------------------------------------------------------------------------

/**
 * One specification row on a product detail page: a label and its value, as the specifications
 * table renders them in order.
 *
 * Both fields are display strings rather than typed data, because a specification is free-form per
 * product — material, dimensions, capacity — and nothing computes on it. The rows are seeded in
 * `src/data/products.ts` and rendered verbatim by the detail page.
 */
export interface ProductSpec {
  readonly label: string;
  readonly value: string;
}

/**
 * One image of a product, carrying the alt text and intrinsic size the gallery, the catalogue tile
 * and the cart thumbnail render it at.
 *
 * `url` is a deterministic inline SVG data URI produced by `buildProductImage` in
 * `src/data/products.ts`, so no image file ships with the product and no image request ever leaves
 * the page. That is also why `width` and `height` are declared rather than measured from a loaded
 * file: nothing is loaded to measure.
 *
 * `id` is a plain string rather than a branded identifier because the product's identifier prefixes
 * have none for an image; it is derived from the owning product's id and the image's `position`, so
 * it is stable across builds and unique within the product.
 */
export interface ProductImage {
  readonly id: string;
  readonly productId: ProductId;
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly position: number;
}

/**
 * The catalogue lifecycle of a product.
 *
 * `active` is what the storefront lists, so every catalogue, search and facet query selects it;
 * `draft` and `archived` exist so the seeded catalogue can hold records the shopfront does not
 * show. Availability is derived from inventory — `stockOnHand` against `lowStockThreshold` — and
 * never from this field, so a sold-out product stays `active` and remains findable.
 */
export type ProductStatus = "active" | "draft" | "archived";

/**
 * A product, as the catalogue listing, the search results, the detail route, the home page and the
 * cart all carry it.
 *
 * Money: `priceMinor` and `listPriceMinor` are integer minor units in the product's own `currency`,
 * never floats and never formatted here — `src/utils/format.ts` owns the single rounding and
 * rendering rule. `listPriceMinor` above `priceMinor` is what renders a discount; equality means
 * the product is not discounted, and a lower list price is not a shape the seeds produce.
 *
 * Stock: `stockOnHand` is the single source of the cart's quantity ceiling — it is copied onto a
 * cart line as that line's `maxQuantity` when the line is created, and compared against
 * `lowStockThreshold` to derive the availability the facets and badges show.
 *
 * Ratings: `ratingAverage` and `ratingCount` are derived from the product's review rows when the
 * catalogue is seeded, and are never recomputed per render, so displaying a page of 140 products
 * costs nothing. The average is a one-decimal value between 1 and 5, or 0 when the product has no
 * reviews — which `ratingCount` of zero distinguishes from a product rated zero.
 */
export interface Product {
  readonly id: ProductId;
  readonly sku: string;
  readonly slug: string;
  readonly name: string;
  readonly brandId: BrandId;
  readonly categoryId: CategoryId;
  readonly summary: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly specs: readonly ProductSpec[];
  readonly priceMinor: MinorUnits;
  readonly listPriceMinor: MinorUnits;
  readonly currency: CurrencyCode;
  readonly ratingAverage: number;
  readonly ratingCount: number;
  readonly stockOnHand: number;
  readonly lowStockThreshold: number;
  readonly images: readonly ProductImage[];
  readonly tags: readonly string[];
  readonly status: ProductStatus;
  readonly createdAt: IsoDateTimeString;
}

/**
 * A catalogue category, two levels deep: parents for the navigation and the home page's category
 * showcase, children for facet selection and the category listing route.
 *
 * `parentId === null` marks a parent and any other value names the parent a child hangs under, so
 * the tree is built by grouping children on `parentId` rather than by a separate level field.
 * `position` orders siblings within their level in the navigation, the showcase, the facet list and
 * the category chips, and is stable across builds.
 */
export interface Category {
  readonly id: CategoryId;
  readonly slug: string;
  readonly name: string;
  readonly parentId: CategoryId | null;
  readonly description: string;
  readonly position: number;
}

/**
 * A category with its children nested beneath it and its own product count: the tree
 * `GET /api/categories` returns, and the shape the navigation, the category showcase, the category
 * facet and the catalogue route's breadcrumb walk.
 *
 * The recursion terminates at a leaf, which an empty `children` array marks rather than a null, so
 * a consumer can iterate every node's children without a presence check. Each node carries its own
 * `position`, so a level is sorted where it is rendered instead of being re-sorted after a flatten.
 *
 * `productCount` belongs to every node rather than to the top level alone — a leaf reports the
 * products the catalogue holds in it and a parent the rolled-up total beneath it — so the count of a
 * child reached through `children` is readable from this type, as the payload answers it.
 */
export interface CategoryNode extends Category {
  readonly productCount: number;
  readonly children: readonly CategoryNode[];
}

/**
 * A brand, as the brand facet, the active-filter chips, the catalogue tile and the detail page's
 * brand line render it.
 *
 * `productCount` is derived once when the catalogue is seeded, by counting the products that carry
 * the brand, and is never recomputed per render — the brand facet displays it beside every value.
 */
export interface Brand {
  readonly id: BrandId;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly productCount: number;
}

// Reviews --------------------------------------------------------------------------------------

/**
 * A customer's review of a product, as the review list on the detail page, the rating facet and the
 * product's rating aggregate use it.
 *
 * `customerName` is denormalised onto the row so the review list renders without a second lookup,
 * and `verifiedPurchase` records whether the named customer's order history held the product when
 * the review was seeded. `rating` is a `RatingValue`, and the product's `ratingAverage` and
 * `ratingCount` are derived from these rows at seed time.
 */
export interface Review {
  readonly id: ReviewId;
  readonly productId: ProductId;
  readonly customerId: CustomerId;
  readonly customerName: string;
  readonly rating: RatingValue;
  readonly title: string;
  readonly body: string;
  readonly createdAt: IsoDateTimeString;
  readonly helpfulCount: number;
  readonly verifiedPurchase: boolean;
}

/**
 * The body of `POST /api/products/:id/reviews`: what a signed-in customer submits, and nothing else.
 *
 * The limits are enforced by `src/utils/validation.ts` — rating an integer from 1 to 5, title 3 to
 * 80 characters, body 10 to 1,200 — and re-rejected by `src/lib/mockServer.ts` with `422` naming
 * the offending `field`, so the same rules hold whether a caller goes through the form or straight
 * at the seam. The review's author, identifier, timestamp, helpful count and verified-purchase flag
 * are decided by the data layer and are deliberately not part of this input.
 */
export interface ReviewInput {
  readonly rating: RatingValue;
  readonly title: string;
  readonly body: string;
}

/**
 * The read side of one product's reviews: the product whose reviews are wanted, which page to fetch,
 * and the optional rating narrowing.
 *
 * `productId` names the product the rows belong to, which is what scopes the read: the transport's
 * handler resolves it from the `:id` the request path carries, and the data layer answers that
 * product's reviews alone, so `PageResult.total` counts them and a product with none answers an empty
 * page.
 *
 * `rating` is absent for the unfiltered list the reviews tab opens with, and present to show
 * exactly that many stars. It cannot express "4 and up" — the catalogue's minimum-rating filter,
 * `FilterState.minRating`, is what narrows a listing that way.
 */
export interface ReviewQuery {
  readonly productId: ProductId;
  readonly page: number;
  readonly pageSize: number;
  readonly rating?: RatingValue;
}

// Inventory ------------------------------------------------------------------------------------

/**
 * How available a product is on the shelf, in the three states the storefront distinguishes.
 */
export type InventoryStatus = "in-stock" | "low-stock" | "out-of-stock";

/**
 * The availability view of a product's stock.
 *
 * Derived from the product's own `stockOnHand` and `lowStockThreshold` by one rule, stated here
 * once: `available` is `stockOnHand > 0`; `status` is `"out-of-stock"` at zero, `"low-stock"` at or
 * below the threshold and `"in-stock"` above it. Both derived fields are carried rather than
 * recomputed, because the availability facet, the catalogue tile's badge, the detail page's
 * message and the cart's warning all read them, and none of those surfaces may disagree with
 * another about whether a product can be bought.
 */
export interface Inventory {
  readonly productId: ProductId;
  readonly stockOnHand: number;
  readonly lowStockThreshold: number;
  readonly status: InventoryStatus;
  readonly available: boolean;
}

// Facets ---------------------------------------------------------------------------------------

/**
 * The five facets the filter panel renders, one per filter family.
 */
export type FacetId = "category" | "brand" | "price" | "rating" | "availability";

/**
 * How a facet's values are chosen and rendered: a term list of identifiers, a numeric range, or a
 * yes-or-no toggle.
 */
export type FacetKind = "terms" | "range" | "boolean";

/**
 * One selectable value of a facet, with the number of results choosing it would leave.
 *
 * `value` is the string the URL carries: a category or brand identifier for a `terms` value, a
 * stable encoding of the numeric bounds for a `range` value, and `"true"` or `"false"` for a
 * `boolean` value — so every kind of facet writes and reads the same query shape.
 *
 * `count` is computed with this facet's own selection excluded, the rule `src/lib/catalogService.ts`
 * implements: without it, selecting one brand would drive every other brand's count to zero and
 * make the remaining choices look empty. `count` may legitimately be zero, which is what renders a
 * value the current filters have emptied out. `label` is the shopper's own wording, supplied by
 * `src/constants/taxonomy.ts`, and `selected` reports whether the current query already holds this
 * value.
 */
export interface FacetValue {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly selected: boolean;
}

/**
 * One facet of the filter panel: its identity, its heading, the kind of control it needs and its
 * selectable values.
 *
 * `label` is the facet's heading from `src/constants/taxonomy.ts`, and `kind` tells the panel both
 * which control to render and how to read `values[].value`. `values` is present even when the
 * current query leaves nothing to choose, in which case it is empty and the panel renders the
 * facet's disabled heading rather than an unlabelled control.
 */
export interface Facet {
  readonly id: FacetId;
  readonly label: string;
  readonly kind: FacetKind;
  readonly values: readonly FacetValue[];
}

// Query state ----------------------------------------------------------------------------------

/**
 * The six orders a catalogue listing or a set of search results can be put in.
 *
 * `relevance` is meaningful only while a query term is present, and the sort control falls back to
 * `newest` when the term is cleared; the others are absolute orders that do not depend on the
 * query. The labelled list pairing each key with the wording a shopper reads lives in
 * `src/constants/taxonomy.ts`, so no label is declared here.
 */
export type SortKey =
  | "relevance"
  | "price-asc"
  | "price-desc"
  | "rating-desc"
  | "newest"
  | "popularity";

/**
 * The complete filter, sort and paging state of a catalogue or search query.
 *
 * The URL is this shape's store: `src/utils/queryParams.ts` is its only reader and writer, and no
 * component mirrors it into React state. That is what makes a filtered, sorted, searched URL reload
 * to the identical result set. Three rules keep the round trip lossless and canonical: `null` means
 * unset, never `undefined`, so every value survives being written to the query string and read
 * back; an inverted price range is swapped rather than rejected and defaults are omitted from the
 * URL, so equivalent selections share one URL instead of multiplying it; and `pageSize` is one of
 * the configured sizes — 12, 24 or 48, from `src/constants/config.ts` — with `page` clamped to the
 * page count on read.
 *
 * `catalogReducer` stores only what a request produced — the loaded page, the facets and the load
 * status, keyed by a fingerprint of this state — and never a copy of these fields, so a filter value
 * has exactly one home and the query and its results cannot drift apart.
 */
export interface FilterState {
  readonly q: string;
  readonly categoryIds: readonly CategoryId[];
  readonly brandIds: readonly BrandId[];
  readonly minPriceMinor: MinorUnits | null;
  readonly maxPriceMinor: MinorUnits | null;
  readonly minRating: RatingValue | null;
  readonly inStockOnly: boolean;
  readonly tags: readonly string[];
  readonly sort: SortKey;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The parameters `GET /api/facets` accepts: the filter half of `FilterState`, with sort and paging
 * omitted because a facet request answers what would be left rather than which page to show.
 *
 * Derived from `FilterState` rather than restated, so the facet endpoint and the product endpoint
 * cannot disagree about what a filter parameter is. `GET /api/products` takes `FilterState`'s
 * fields, sort and paging included, as its own query parameters.
 */
export type FacetQuery = Omit<FilterState, "sort" | "page" | "pageSize">;

// Search suggestions and related products ------------------------------------------------------

/**
 * What a type-ahead suggestion points at, which is also what its row is grouped under.
 */
export type SuggestionKind = "product" | "brand" | "category";

/**
 * One suggestion offered under the search field.
 *
 * `target` is the route path the suggestion navigates to — a product's detail path, a category's
 * listing path, or the search route scoped to a brand — built by the path builders in
 * `src/constants/routes.ts` rather than written out as a path string here.
 */
export interface SearchSuggestion {
  readonly text: string;
  readonly kind: SuggestionKind;
  readonly target: string;
}

/**
 * The named wrapper `GET /api/search/suggest` returns, so the suggestion list is reached by key
 * rather than as a bare array.
 */
export interface SearchSuggestionResponse {
  readonly suggestions: readonly SearchSuggestion[];
}

/**
 * The parameters of a suggestion request: the partial term, and how many suggestions to offer.
 *
 * `limit` defaults to 8 at the data layer, and the debounced type-ahead in
 * `src/features/search/SearchBar.tsx` never asks for more than the cap the data layer allows.
 */
export interface SuggestionQuery {
  readonly q: string;
  readonly limit?: number;
}

/**
 * The wrapper `GET /api/products/:id/related` returns: products from the same category, price
 * nearest the product being viewed first.
 */
export type RelatedProductsResponse = CollectionResponse<Product>;
