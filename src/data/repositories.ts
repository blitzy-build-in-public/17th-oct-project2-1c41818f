/**
 * Path: src/data/repositories.ts
 * Purpose: The only reader of the seeded collections, implementing the data-source interface the transport registers
 * Lines: 522
 */

// This file is the contract half of the data source: every member the transport calls, each one a composition of
// a domain service's own rules over the collections `src/data/collectionStore.ts` holds. That store is a path
// this plan does not map on its own — it is the store half of this file, split out under the plan's over-budget
// rule because the whole concern cannot be held in one file under the request's 600-line ceiling, and the
// ceiling is never raised. The rules are not here: filtering, faceting, search scoring, pricing, order
// construction, aggregation and report building each have exactly one home in `src/lib`, and this file composes
// them rather than restating any of them.

import { MAX_REPORT_RANGE_DAYS, SHIPPING_METHODS } from "@/constants/config";
import { CART_COPY, VALIDATION_MESSAGES } from "@/constants/content";
import { DATE_RANGE_COPY, rangeTooLongMessage } from "@/constants/content-reports";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { BRANDS, CATEGORIES } from "@/data/categories";
import { nextOrderMint, rememberOrder, rememberReview } from "@/data/clientWrites";
import {
  SEARCH_TARGETS,
  accept,
  addBookAddress,
  createStore,
  credentialFor,
  endSession,
  lookUpSession,
  purchaseKey,
  refuse,
  registerAccount,
  rejectPromo,
  removeBookAddress,
  restore,
  setBookDefault,
  signInAccount,
  updateBookAddress,
  updateProfile,
  type DataStore,
} from "@/data/collectionStore";
import { PROMO_CODES } from "@/data/orders";
import { ratingAggregateFor } from "@/data/reviews";
// The deferred analytics and report graph — its loader, the shape it resolves to and the refusal a failed
// fetch answers with — is this file's §0.5.5 split path `src/data/analyticsGraph.ts`.
import {
  loadAnalyticsGraph,
  overAnalyticsGraph,
  unexpectedFailure,
  type DeferredAnalytics,
} from "@/data/analyticsGraph";
import {
  buildFacetResponse,
  filterProducts,
  normaliseProductQuery,
  paginateProducts,
  selectRelated,
  sortProducts,
} from "@/utils/catalogRules";
// The interface is imported as a type only: the data source is bound to the transport at the composition root,
// so no runtime import may join the two modules.
import type {
  CustomerOrderQuery,
  NewProductReviewInput,
  OrderCreationRequest,
  ReportRunQuery,
  SalesProDataSource,
} from "@/lib/mockServer";
import { appendStatusHistory, orderNumber, toOrderLines } from "@/utils/orderRules";
import { decidePromo, normalisePromoCode, priceCartLines } from "@/utils/pricingRules";
import { applyTextMatch, buildSuggestions } from "@/utils/searchRules";
import type { ReportResult } from "@/types/analytics";
import type {
  Facet,
  FacetQuery,
  FilterState,
  Product,
  Review,
  ReviewQuery,
  SearchSuggestion,
} from "@/types/catalog";
import type { PageResult, ProductId, Result } from "@/types/common";
import type { CartLine, Order, PricedCart, PromoCode } from "@/types/commerce";
import { clampNumber, paginate } from "@/utils/collections";
import {
  isWithinRange,
  sortByIso,
  startOfDay,
  toFieldErrors,
  toIsoDate,
  toIsoDateTime,
  validateDateRange,
  type DateRangeErrorCode,
} from "@/utils/dates";
import { DEFAULT_FILTER_STATE, readFilterState, writeFilterState } from "@/utils/queryParams";
import { reviewId as newReviewId, sequenceId as newSequenceId } from "@/utils/strings";

/** The wording for each rule a dated range can break, so a range refused here reads as the same range refused
 * by the transport before a request leaves. */
const RANGE_MESSAGES: Readonly<Record<DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

// The catalogue -------------------------------------------------------------------------------------

/** The listing state in its canonical form: the query module's own writer and reader, so an inverted price
 * range is swapped, the lists are de-duplicated and ordered, an unconfigured page size is replaced and a
 * relevance sort left without a term is repaired before anything is filtered on — the same normalisation a
 * request's parameters receive, so a hand-made filter and a link cannot list two different catalogues. */
function canonicalFilter(filter: FilterState): FilterState {
  return readFilterState(writeFilterState(filter));
}

/** One page of the catalogue: the products the term matches, then the filters leave, in the order the sort
 * names, cut to the page. The text match runs first and a relevance sort keeps the order it produced, which is
 * what makes a searched listing rank before it is cut. */
function cataloguePage(store: DataStore, filter: FilterState): PageResult<Product> {
  const query = canonicalFilter(filter);
  const matched = applyTextMatch(store.products, query.q, store.lookup);
  const leaving = filterProducts(matched, normaliseProductQuery(query));
  return paginateProducts(sortProducts(leaving, query.sort), query);
}

/** The five facets for a filter: each counted with its own selection excluded and the collection text-matched
 * when a term is present, so every count describes what choosing a value would leave. The term facets' vocabulary
 * comes from the whole served catalogue — the collection this endpoint lists from — rather than from the matched
 * one being counted over, so a term that matches nothing still offers every category and brand the catalogue
 * holds, each at a count of zero, and the shopper keeps a facet way to widen the search. */
function facetResponse(store: DataStore, query: FacetQuery): Facet[] {
  const canonical = canonicalFilter({ ...DEFAULT_FILTER_STATE, ...query });
  const matched = applyTextMatch(store.products, canonical.q, store.lookup);
  return buildFacetResponse(matched, normaliseProductQuery(canonical), {
    vocabulary: { categories: CATEGORIES, brands: BRANDS },
    catalogue: store.products,
  });
}

/** The type-ahead list for a term: products, brands and categories ranked best first and capped, drawn from the
 * served catalogue so a suggestion names what the catalogue holds. */
function suggestionList(
  store: DataStore,
  query: { readonly q: string; readonly limit: number },
): SearchSuggestion[] {
  return buildSuggestions({
    sources: { products: store.products, categories: CATEGORIES, brands: BRANDS },
    query: query.q,
    targets: SEARCH_TARGETS,
    limit: query.limit,
  });
}

/**
 * One page of a product's own reviews, newest first, optionally narrowed to a single rating.
 *
 * The rows come from the store's per-product index, keyed by the `productId` the query names — resolved by
 * the transport's handler from the identifier the request path carries — so the rows, the `total` and the
 * page count all describe that one product: a product nothing has been written about answers an empty page,
 * and the rating narrowing leaves only that product's rows carrying the rating asked for. The ordering is
 * `src/utils/dates.ts`'s own, so a review a customer submits takes its place by its instant — the newest
 * first — and leads the first page unless the seed already holds a row for that product dated later the
 * same day, which the anchor day it draws as a whole day can.
 */
function reviewPage(store: DataStore, query: ReviewQuery): PageResult<Review> {
  const rows = store.reviewsByProduct.get(query.productId) ?? [];
  const matching =
    query.rating === undefined ? rows : rows.filter((review) => review.rating === query.rating);
  const ordered = sortByIso(matching, (review) => review.createdAt, "desc");
  return paginate(ordered, query.page, query.pageSize);
}

/** Records a submitted review and folds it into the rating its product is served with. Its identifier, its
 * timestamp, its helpful count and its verified-purchase mark are decided here, the mark from the orders this
 * account has placed for the product — the same reading the seeded rows were given. */
function insertReview(store: DataStore, input: NewProductReviewInput): Review {
  const customer = store.customerById.get(input.customerId);
  const review: Review = {
    id: newReviewId(`${input.productId} ${input.customerId} ${store.reviews.length + 1}`),
    productId: input.productId,
    customerId: input.customerId,
    // Denormalised onto the row so the review list renders without a second lookup, as the seed does; an
    // account the store does not hold contributes an empty name rather than failing a value-typed read.
    customerName: customer === undefined ? "" : `${customer.firstName} ${customer.lastName}`,
    rating: input.rating,
    title: input.title,
    body: input.body,
    createdAt: toIsoDateTime(new Date()),
    helpfulCount: 0,
    verifiedPurchase: store.verifiedPurchases.has(purchaseKey(input.customerId, input.productId)),
  };
  store.reviews.push(review);
  const rows = store.reviewsByProduct.get(input.productId);
  if (rows === undefined) store.reviewsByProduct.set(input.productId, [review]);
  else rows.unshift(review);
  foldRating(store, input.productId);
  // The row is recorded once the store holds it, so the next document lists it and derives this product's
  // figures from it rather than serving the seed's rows and the seed's rating again.
  rememberReview(review);
  return review;
}

/** Folds a product's rows back into the rating it is served with: how many it has and their mean to one
 * decimal, so a submitted review shows on the detail page and on every tile beside it without either
 * recomputing anything. The mean and the count are `src/data/reviews.ts`'s own rule, so the aggregate the
 * write folds in and the one a load derives from the same rows cannot drift apart. */
function foldRating(store: DataStore, productId: ProductId): void {
  const product = store.productById.get(productId);
  if (product === undefined) return;
  const rows = store.reviewsByProduct.get(productId) ?? [];
  const updated: Product = { ...product, ...ratingAggregateFor(rows) };
  store.productById.set(productId, updated);
  const index = store.productIndexById.get(productId);
  if (index !== undefined) store.products[index] = updated;
}

// Commerce ------------------------------------------------------------------------------------------

/** Whether a submitted line can be priced at all: its recorded ceiling is what the cart clamps every quantity
 * against, so a quantity outside one-to-that-ceiling is stock that is not there. */
function unpriceableLine(lines: readonly CartLine[]): boolean {
  return lines.some(
    (line) =>
      !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > line.maxQuantity,
  );
}

/** The stored code a submitted spelling names, or `undefined`: the comparison rule — trimmed and upper-cased —
 * is reached from its one home, `src/lib/pricingService.ts`, so a submitted spelling and a stored one are
 * matched by one implementation, and whether the code may apply is that service's decision. */
function findPromoCode(code: string | null): PromoCode | undefined {
  const normalised = normalisePromoCode(code);
  if (normalised === null) return undefined;
  return PROMO_CODES.find((promo) => normalisePromoCode(promo.code) === normalised);
}

/** The refusal a code earns against a basket, or `null` when it applies: the decision order, the reasons and
 * the eligibility rules belong to the pricing service, and the catalogue fact a `category`-scoped code is
 * narrowed by belongs to the store. The rule that whitespace alone is no code at all is that service's too,
 * reached through its own normaliser rather than restated. */
function promoRefusal(
  store: DataStore,
  code: string | null,
  promo: PromoCode | undefined,
  lines: readonly CartLine[],
): Result<never> | null {
  const normalised = normalisePromoCode(code);
  if (normalised === null) return null;
  const reason = decidePromo({
    code: normalised,
    promo,
    lines,
    today: toIsoDate(new Date()),
    categoryIdsByProductId: store.categoryByProduct,
  });
  return reason === undefined ? null : rejectPromo(reason);
}

/** A basket priced through the product's one pricing implementation: the lines priced, the code applied and the
 * method charged for, with every amount the cart, the checkout and the placed order copy from. */
function priceRequest(
  store: DataStore,
  request: {
    readonly lines: readonly CartLine[];
    readonly promoCode: string | null;
    readonly shippingMethodId: string | null;
  },
): Result<PricedCart> {
  if (unpriceableLine(request.lines)) {
    return refuse("insufficient-stock", VALIDATION_MESSAGES.QUANTITY_RANGE, "lines");
  }
  // The pricing read checks the real shelf, not only the ceiling each line declares, so a basket prices only
  // while the catalogue can still cover it and an order placed from the priced cart cannot be refused for stock.
  if (!request.lines.every((line) => canFulfil(store, line))) {
    return refuse("insufficient-stock", VALIDATION_MESSAGES.QUANTITY_RANGE, "lines");
  }
  const promo = findPromoCode(request.promoCode);
  const refusal = promoRefusal(store, request.promoCode, promo, request.lines);
  if (refusal !== null) return refusal;
  return accept(
    priceCartLines({
      lines: request.lines,
      promo,
      shippingMethodId: request.shippingMethodId,
      shippingMethods: SHIPPING_METHODS,
      categoryIdsByProductId: store.categoryByProduct,
    }),
  );
}

/** The code a basket submitted, or the reason it will not apply: the same decision the pricing path takes, so
 * checking a code and pricing with it can never disagree. */
function promoValidation(
  store: DataStore,
  request: { readonly code: string; readonly lines: readonly CartLine[] },
): Result<PromoCode> {
  const promo = findPromoCode(request.code);
  const refusal = promoRefusal(store, request.code, promo, request.lines);
  if (refusal !== null) return refusal;
  return promo === undefined ? rejectPromo("unknown") : accept(promo);
}

/** Whether a line can still be bought: the product exists and holds at least the quantity the line asks for.
 * The check reads the catalogue as it stands rather than the ceiling a line declares, so the pricing read and
 * order creation ask the shelf the same question and cannot disagree. Both submitted line shapes carry the
 * pair it needs — a cart line names the product and the quantity, an order line copies them — so one rule
 * serves both. The shelf is deliberately not rewritten by an order — catalogue and inventory administration are
 * outside this product's scope — so an order takes a snapshot and never a decrement. */
function canFulfil(
  store: DataStore,
  line: { readonly productId: ProductId; readonly quantity: number },
): boolean {
  const product = store.productById.get(line.productId);
  return product !== undefined && product.stockOnHand >= line.quantity;
}

/** Builds and stores an order from the settled request: its lines are the snapshot's, so a later catalogue edit
 * cannot rewrite what it bought or what it cost, and its status opens with the entry a freshly placed order
 * carries. The order is written to this browser's durable record as it is created, so it is not lost with the
 * document that placed it. A repeat of one submission never reaches here twice: the transport's idempotency
 * store answers the second one from the first order. */
function createOrderIn(store: DataStore, request: OrderCreationRequest): Result<Order> {
  const lines = toOrderLines(request.snapshot);
  if (!lines.every((line) => canFulfil(store, line))) {
    return refuse("insufficient-stock", CART_COPY.AVAILABILITY_WARNING, "snapshot");
  }
  const placedAt = toIsoDateTime(new Date());
  const day = startOfDay(placedAt);
  // The marks are read here rather than derived from this store alone, because the store was rebuilt from the
  // seed: its own index and day count would mint the identifier and number the document beside it just used.
  const mint = nextOrderMint(day, store.nextOrderIndex, store.orderSequenceByDay.get(day) ?? 0);
  const draft: Order = {
    id: newSequenceId("ord", mint.index),
    orderNumber: orderNumber(mint.sequence, placedAt),
    customerId: request.customerId,
    email: request.email,
    status: "pending",
    lines,
    shippingAddress: request.shippingAddress,
    billingAddress: request.billingAddress,
    shippingMethodId: request.shippingMethodId,
    payment: request.payment,
    pricedCart: request.snapshot,
    placedAt,
    updatedAt: placedAt,
    statusHistory: [],
    idempotencyKey: request.idempotencyKey,
  };
  const order = appendStatusHistory(draft, "pending", placedAt);
  store.nextOrderIndex = mint.index + 1;
  store.orderSequenceByDay.set(day, mint.sequence);
  store.orders.unshift(order);
  store.orderById.set(order.id, order);
  const owner = order.customerId;
  if (owner !== null) {
    const rows = store.ordersByCustomer.get(owner);
    if (rows === undefined) store.ordersByCustomer.set(owner, [order]);
    else rows.unshift(order);
    for (const line of order.lines) store.verifiedPurchases.add(purchaseKey(owner, line.productId));
  }
  // The order and the marks it was minted from are written once the store holds it, so the next document
  // resolves this one on the confirmation route and keeps numbering past it.
  rememberOrder(order, mint);
  return accept(order);
}

/** One page of a customer's own orders, newest first, narrowed by the one status and the inclusive window the
 * query carries. A cancelled order is still the customer's order, so the history lists every status. */
function listCustomerOrders(store: DataStore, query: CustomerOrderQuery): PageResult<Order> {
  const rows = store.ordersByCustomer.get(query.customerId) ?? [];
  const range =
    query.from !== undefined && query.to !== undefined ? { from: query.from, to: query.to } : null;
  const matching = rows.filter(
    (order) =>
      (query.status === undefined || order.status === query.status) &&
      (range === null || isWithinRange(order.placedAt, range)),
  );
  return paginate(matching, query.page, query.pageSize);
}

// Analytics and reports -----------------------------------------------------------------------------

// The graph the readings below run over — the reduction that builds a sales fact table, the aggregation rules
// and the report composition, fetched on first use — is this file's §0.5.5 split path
// `src/data/analyticsGraph.ts`, which holds the loader, the shape it resolves to and the refusal a failed fetch
// answers with, because this file's own 33-member contract and that concern cannot both be held inside the
// request's 600-line ceiling. The members below reach it through `overAnalyticsGraph` and, for a report run,
// `loadAnalyticsGraph`.

/** The refusal a dated range earns, or `null` when it can run: the rules are `src/utils/dates.ts`'s and the
 * wording the copy module's, so the same range is refused with the same sentence and the same field whether it
 * is caught here or by the transport before a request leaves. */
function rangeRefusal(query: ReportRunQuery): Result<never> | null {
  const validation = validateDateRange(query.from, query.to);
  if (validation.valid) return null;
  const errors = toFieldErrors(validation, RANGE_MESSAGES);
  const field = Object.keys(errors)[0] ?? "range";
  return refuse("validation-failed", errors[field] ?? VALIDATION_MESSAGES.REQUIRED, field);
}

/** One report run: the rows the table shows, the totals it states and the series charted beside it, from the
 * report service's single composition over the collections, so the three can never disagree. The definition
 * lookup is the deferred graph's own, so a kind no definition declares is refused here exactly as it was. */
function runReportOver(
  store: DataStore,
  graph: DeferredAnalytics,
  query: ReportRunQuery,
): Result<ReportResult> {
  const refusal = rangeRefusal(query);
  if (refusal !== null) return refusal;
  const definition = graph.findDefinition(REPORT_DEFINITIONS, query.kind);
  if (definition === undefined) {
    return refuse("validation-failed", VALIDATION_MESSAGES.REQUIRED, "kind");
  }
  return accept(
    graph.runReportDefinition(
      query.kind,
      {
        orders: store.orders,
        salesRecords: graph.salesRecordsFor(store.orders),
        customers: store.customers,
      },
      query,
      definition,
    ),
  );
}

// The data source -----------------------------------------------------------------------------------

/**
 * Builds a fresh data source over the seeded collections: one independent store per call, so two sources answer
 * alike — the determinism `tests/unit/lib/mockServer.test.ts` measures by comparing two passes — and a write
 * through either is invisible to the other. The orders this browser created are read into the store as it is
 * built, so a document that loads after a submission answers that order again instead of losing it with the
 * document that placed it.
 *
 * Every member's contract is the one `SalesProDataSource` declares: what it returns, what it refuses with and
 * which read it serves. Nothing here reaches `src/lib/apiClient.ts` or a service's async method, which would
 * close a loop back into the transport; the members call the services' pure rules instead. The four analytics
 * and report members reach their modules through `src/data/analyticsGraph.ts`'s loader, which fetches them on first use, so the
 * part of this store's reach that no first route reads is also the part the entry chunk does not carry.
 */
export function createSalesProDataSource(): SalesProDataSource {
  const store = createStore();
  return {
    // The catalogue: filtered, faceted, sorted, searched and paged by the catalogue and search services.
    listProducts: (filter) => cataloguePage(store, filter),
    getProduct: (id) => store.productById.get(id),
    listRelatedProducts: (id, limit) => selectRelated(store.products, id, limit),
    listProductReviews: (query) => reviewPage(store, query),
    insertProductReview: (input) => insertReview(store, input),
    buildFacets: (query) => facetResponse(store, query),
    listSuggestions: (query) => suggestionList(store, query),
    listCategories: () => store.categories,
    listBrands: () => store.brands,
    // Commerce: delivery, pricing, promo eligibility, order creation and a customer's own history.
    listShippingMethods: () => SHIPPING_METHODS,
    priceCart: (request) => priceRequest(store, request),
    validatePromoCode: (request) => promoValidation(store, request),
    createOrder: (request) => createOrderIn(store, request),
    listOrders: (query) => listCustomerOrders(store, query),
    getOrder: (id) => store.orderById.get(id),
    // Identity: the account store, the session registry and the address books, all over the store module.
    registerCustomer: (input) => registerAccount(store, input),
    signIn: (credentials) => signInAccount(store, credentials),
    signOut: (token) => {
      endSession(store, token);
    },
    restoreSession: (token) => restore(store, token),
    getSession: (token) => lookUpSession(store, token),
    getCustomer: (id) => store.customerById.get(id),
    findSignInCredential: (email) => credentialFor(store, email),
    updateCustomer: (id, input) => updateProfile(store, id, input),
    listAddresses: (id) => store.books.get(id) ?? [],
    addAddress: (id, input) => addBookAddress(store, id, input),
    updateAddress: (id, addressId, input) => updateBookAddress(store, id, addressId, input),
    removeAddress: (id, addressId) => removeBookAddress(store, id, addressId),
    setDefaultAddress: (id, addressId, request) =>
      setBookDefault(store, id, addressId, request.kind),
    // Analytics and reports: the fact rows of the orders this store serves, reduced from that same collection
    // by the analytics module, so an order placed in this browser moves the KPIs, the chart and the sales
    // report together with the order collection they are checked against — the first read of either fetches
    // the modules.
    getKpis: (query) =>
      overAnalyticsGraph((graph) =>
        graph.computeKpis({
          records: graph.salesRecordsFor(store.orders),
          orders: store.orders,
          customers: store.customers,
          query,
        }),
      ),
    getRevenueSeries: (query) =>
      overAnalyticsGraph((graph) =>
        graph.computeRevenueSeries({
          records: graph.salesRecordsFor(store.orders),
          query,
        }),
      ),
    getTopProducts: (query) =>
      overAnalyticsGraph((graph) =>
        graph.computeTopProducts({
          orders: store.orders,
          query,
          categoryIds: store.categoryByProduct,
        }),
      ),
    getRecentOrders: (limit) =>
      store.orders.slice(0, clampNumber(Math.floor(limit), 0, store.orders.length)),
    listReportDefinitions: () => REPORT_DEFINITIONS,
    runReport: async (query) => {
      const graph = await loadAnalyticsGraph();
      return graph === null ? unexpectedFailure() : runReportOver(store, graph, query);
    },
  };
}

/** The data source `src/main.tsx` binds before the first render and `tests/testUtils.tsx` binds for the
 * integration tests. Nothing else imports this module: the transport is bound to the data, never joined to it by
 * an import. */
export const salesProDataSource: SalesProDataSource = createSalesProDataSource();
