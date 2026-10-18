/**
 * Path: src/lib/apiContract.ts
 * Purpose: The contract the in-process API is built on: its error vocabulary, the failure it shapes and the data-source interface it asks for
 * Lines: 447
 */

import type * as Account from "@/types/account";
import type * as Analytics from "@/types/analytics";
import type * as Catalog from "@/types/catalog";
import type * as Commerce from "@/types/commerce";
import type * as Common from "@/types/common";

// Error vocabulary -------------------------------------------------------------------------------

/** Every machine-readable reason a request can fail, one home each, so a service, a page or a test
 * never spells one by hand. A `const` object rather than an `enum`, which `erasableSyntaxOnly`
 * forbids; {@link ApiErrorCode} is derived from it, so the two cannot drift. */
export const API_ERROR_CODES = {
  /** No session token was sent to an endpoint that requires one. */
  UNAUTHENTICATED: "unauthenticated",
  /** A token was sent whose session has passed its expiry. */
  SESSION_EXPIRED: "session-expired",
  /** A token was sent that no session was ever issued for. */
  SESSION_UNKNOWN: "session-unknown",
  /** The email address and password submitted do not match a stored account. */
  INVALID_CREDENTIALS: "invalid-credentials",
  /** The session is valid but lacks the role or the ownership the endpoint requires. */
  FORBIDDEN: "forbidden",
  /** The path matches no endpoint. */
  ROUTE_NOT_FOUND: "route-not-found",
  /** The product named in the path does not exist. */
  PRODUCT_NOT_FOUND: "product-not-found",
  /** The order named in the path does not exist, or does not belong to the caller. */
  ORDER_NOT_FOUND: "order-not-found",
  /** The address named in the path is not one of the account's addresses. */
  ADDRESS_NOT_FOUND: "address-not-found",
  /** The email address already belongs to an account. */
  DUPLICATE_EMAIL: "duplicate-email",
  /** The idempotency key was first used for a different order. */
  IDEMPOTENCY_KEY_CONFLICT: "idempotency-key-conflict",
  /** The submitted card was refused by the demonstration card path. */
  PAYMENT_DECLINED: "payment-declined",
  /** A line asked for more units than it recorded as purchasable. */
  INSUFFICIENT_STOCK: "insufficient-stock",
  /** The submitted body broke a field rule. */
  VALIDATION_FAILED: "validation-failed",
  /** No data source has been bound, so no request can be answered. */
  DATA_SOURCE_UNAVAILABLE: "data-source-unavailable",
} as const;

/** One reason a request can fail, derived from {@link API_ERROR_CODES}. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/** The status each code answers with: 401 without a usable session, 402 for the declined demonstration
 * card, 403 short of authority, 404 an unknown path, product, order or address, 409 on a conflict, 422
 * for a body that broke a field rule and 503 before any data source was bound. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  [API_ERROR_CODES.UNAUTHENTICATED]: 401,
  [API_ERROR_CODES.SESSION_EXPIRED]: 401,
  [API_ERROR_CODES.SESSION_UNKNOWN]: 401,
  [API_ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [API_ERROR_CODES.FORBIDDEN]: 403,
  [API_ERROR_CODES.ROUTE_NOT_FOUND]: 404,
  [API_ERROR_CODES.PRODUCT_NOT_FOUND]: 404,
  [API_ERROR_CODES.ORDER_NOT_FOUND]: 404,
  [API_ERROR_CODES.ADDRESS_NOT_FOUND]: 404,
  [API_ERROR_CODES.DUPLICATE_EMAIL]: 409,
  [API_ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT]: 409,
  [API_ERROR_CODES.PAYMENT_DECLINED]: 402,
  [API_ERROR_CODES.INSUFFICIENT_STOCK]: 422,
  [API_ERROR_CODES.VALIDATION_FAILED]: 422,
  [API_ERROR_CODES.DATA_SOURCE_UNAVAILABLE]: 503,
};

// Shaping an outcome -----------------------------------------------------------------------------

/** A successful outcome, so a handler writes `ok(value)` rather than spelling the shape. */
export function ok<TValue>(value: TValue): Common.Result<TValue> {
  return { ok: true, value };
}

/** A failure at an explicit status, for the two codes that are not the seam's own: a promo rejection,
 * which answers with the `PromoRejectionReason` the pricing rules decided so a cart can name the
 * cause, and the failure a test injects. */
export function shapeError(
  status: number,
  code: string,
  message: string,
  field?: string,
): Common.ApiError {
  return field === undefined ? { status, code, message } : { status, code, message, field };
}

/** A failure carrying a code the seam owns, shaped at the status {@link API_ERROR_STATUS} sets for it,
 * with `field` naming the offending input when the failure belongs to one control. */
export function failure(code: ApiErrorCode, message: string, field?: string): Common.Result<never> {
  return { ok: false, error: shapeError(API_ERROR_STATUS[code], code, message, field) };
}

// Request and answer types -----------------------------------------------------------------------

/** One account as the seam's sign-in check needs it: the customer record and the salted digest its
 * password is stored as. It reaches no payload, no page and no storage. */
export interface SignInCredential {
  readonly customer: Account.Customer;
  readonly digest: Account.CredentialDigest;
}

/** The review a signed-in customer submits, with the two names the seam supplies: the product from the
 * path and the customer from the session, never from the body. */
export interface NewProductReviewInput extends Catalog.ReviewInput {
  readonly productId: Common.ProductId;
  readonly customerId: Common.CustomerId;
}

/** A customer's own order history: the endpoint's filters with the session's customer injected, so
 * ownership follows the token a request carried rather than a parameter a caller could set. */
export interface CustomerOrderQuery extends Commerce.OrderHistoryQuery {
  readonly customerId: Common.CustomerId;
}

/** The parameters of a report run: the dated range query plus the definition the path selects. */
export interface ReportRunQuery extends Analytics.ReportQuery {
  readonly kind: Analytics.ReportKind;
}

/**
 * An order as the seam submits it: `CreateOrderRequest` with its two client-decided members replaced
 * by the two the seam decides.
 *
 * The owner comes from the session and never from the body, so a submission cannot place an order
 * against another account. The payment is the outcome the seam settled — the demonstration's decision,
 * the brand and the last four digits — because a card number is read, validated and discarded at the
 * seam and must never reach the data module or an order. The snapshot is passed on exactly as
 * submitted: an order is built from the cart the buyer reviewed, not from a cart re-read afterwards,
 * so a later price change cannot move what a placed order says it cost.
 */
export type OrderCreationRequest = Omit<Commerce.CreateOrderRequest, "payment"> & {
  readonly customerId: Common.CustomerId | null;
  readonly payment: Commerce.PaymentSummary;
};

// Endpoint paths ----------------------------------------------------------------------------------

/**
 * Every endpoint path the product calls, one entry per path, written once: `src/lib/apiRoutes.ts`
 * builds its route table's patterns from these strings and the eight domain services build their
 * request targets from them, so the vocabulary a request is named with has a single home and a path
 * change is a change to this table alone.
 *
 * A pattern is the path as §0.6.3 states it, with a captured segment written `:name` — the name a
 * handler reads out of `RouteContext.params` and the name a caller fills through {@link fillApiPath}.
 * Two methods that share one path (`GET` and `POST /api/orders`, the two
 * `/api/products/:id/reviews` and the two `/api/customers/:id/addresses` forms) share one entry,
 * because the pattern is what is written here and the method belongs to the route that answers it.
 */
export const API_PATHS = {
  /** The catalogue listing, with search and filtering as its parameters. */
  PRODUCTS: "/api/products",
  /** One product's detail resource. */
  PRODUCT_DETAIL: "/api/products/:id",
  /** One product's same-category suggestions, nearest in price first. */
  PRODUCT_RELATED: "/api/products/:id/related",
  /** One product's reviews: listed, and the target a new review is posted to. */
  PRODUCT_REVIEWS: "/api/products/:id/reviews",
  /** The five facet values and their counts for a filter. */
  FACETS: "/api/facets",
  /** Type-ahead suggestions drawn from product names, brands and categories. */
  SEARCH_SUGGEST: "/api/search/suggest",
  /** The category tree with its product counts. */
  CATEGORIES: "/api/categories",
  /** The brands with their product counts. */
  BRANDS: "/api/brands",
  /** Prices a basket: line totals, discounts, shipping, tax and the grand total. */
  CART_PRICE: "/api/cart/price",
  /** Validates a promo code against the basket it would discount. */
  CART_VALIDATE_PROMO: "/api/cart/validate-promo",
  /** The configured delivery methods and their prices. */
  SHIPPING_METHODS: "/api/shipping-methods",
  /** Order creation, and the signed-in customer's own order history. */
  ORDERS: "/api/orders",
  /** One order's detail resource. */
  ORDER_DETAIL: "/api/orders/:id",
  /** Creates an account and opens a session with it. */
  AUTH_REGISTER: "/api/auth/register",
  /** Opens a session for credentials the seam proves. */
  AUTH_LOGIN: "/api/auth/login",
  /** Ends the session a token names. */
  AUTH_LOGOUT: "/api/auth/logout",
  /** Reports the session a stored token still names. */
  AUTH_SESSION: "/api/auth/session",
  /** One account's profile: read, and updated by `PATCH`. */
  CUSTOMER_DETAIL: "/api/customers/:id",
  /** One account's address book: listed, and added to by `POST`. */
  CUSTOMER_ADDRESSES: "/api/customers/:id/addresses",
  /** One address of that book: replaced by `PATCH` and removed by `DELETE`. */
  CUSTOMER_ADDRESS: "/api/customers/:id/addresses/:addressId",
  /** Nominates the address the path names as the default of the kind its body states. */
  CUSTOMER_ADDRESS_DEFAULT: "/api/customers/:id/addresses/:addressId/default",
  /** The KPI summary for a period, with the comparison baseline the query names. */
  ANALYTICS_KPIS: "/api/analytics/kpis",
  /** The revenue series for a period, split by the grouping the query names. */
  ANALYTICS_REVENUE: "/api/analytics/revenue",
  /** The best-performing products in a period, ranked by the metric asked for. */
  ANALYTICS_TOP_PRODUCTS: "/api/analytics/top-products",
  /** The most recently placed orders. */
  ANALYTICS_RECENT_ORDERS: "/api/analytics/recent-orders",
  /** The report catalogue and the columns each report is built from. */
  REPORT_DEFINITIONS: "/api/reports/definitions",
  /** Runs the report the captured kind names (`sales`, `products` or `customers`). */
  REPORT_RUN: "/api/reports/:kind",
} as const;

/** One path of {@link API_PATHS}, captured segments included. */
export type ApiPath = (typeof API_PATHS)[keyof typeof API_PATHS];

/**
 * Builds the target of one request from a pattern of {@link API_PATHS} and the values its captured
 * segments take: `/api/products/:id` filled with `{ id: "prod_1" }` is `/api/products/prod_1`.
 *
 * Every captured value is percent-encoded, so an identifier that carries a character a path segment
 * cannot carry verbatim still fills exactly one segment instead of splitting the path or naming a
 * different resource. A pattern with no captured segment is returned unchanged, so a caller needs no
 * knowledge of which shape of pattern it holds.
 *
 * @param pattern - The path pattern to fill, as {@link API_PATHS} declares it.
 * @param params - The value of each captured segment, keyed by the name the pattern gives it.
 * @returns The concrete path a request is dispatched with, every captured value encoded.
 * @throws Error when `pattern` names a captured segment `params` holds no value for: a target with a
 * segment left unfilled names no resource, and dispatching it as though it did would turn a caller's
 * mistake into a `404` no reader can trace back to its cause.
 */
export function fillApiPath(
  pattern: string,
  params: Readonly<Record<string, string>> = {},
): string {
  return pattern
    .split("/")
    .map((segment) => (segment.startsWith(":") ? capturedValue(segment, pattern, params) : segment))
    .join("/");
}

/** One captured segment's value, encoded, or the reason the pattern cannot be filled. */
function capturedValue(
  segment: string,
  pattern: string,
  params: Readonly<Record<string, string>>,
): string {
  const name = segment.slice(1);
  const value = params[name];
  if (value === undefined) {
    throw new Error(
      `Cannot build ${pattern}: no value was given for the captured segment "${name}".`,
    );
  }
  return encodeURIComponent(value);
}

// How a handler is called ------------------------------------------------------------------------

/** What a request needs before it is answered: `anonymous` for the storefront, `customer` for a
 * signed-in shopper's own records, and `administrator` for the dashboard and the reports. */
export type AuthorizationLevel = "anonymous" | "customer" | "administrator";

/**
 * Everything a handler is given: the path parameters it captured, the query and body it read, the
 * session the dispatcher resolved and the source it answers from.
 *
 * `session` is null on an anonymous request, and every handler on a `customer` or `administrator`
 * route reads it through {@link sessionOf}, which states the one assertion the dispatcher has already
 * made. `token` travels as text, and its brand is asserted where a store method takes one.
 */
export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
  readonly token: string | undefined;
  readonly session: Account.Session | null;
  /** The refusal a missing, unknown or expired session is answered with, so the session endpoint can
   * answer with exactly the same failure the dispatcher would have produced. */
  readonly sessionProblem: Common.ApiError | null;
  readonly source: SalesProDataSource;
}

/** What answers one endpoint: it parses what it needs from the context, delegates to the data source
 * and frames the payload. It never throws: a failure is a value. A read whose modules are fetched on
 * first use answers with a promise, so a handler may be either shape and the dispatcher awaits it. */
export type RouteHandler = (
  context: RouteContext,
) => Common.Result<unknown> | Promise<Common.Result<unknown>>;

/** One row of the route table: the route's stable name, what it answers for and who may ask. */
export interface RouteDefinition<TId extends string = string> {
  readonly id: TId;
  readonly method: Common.HttpMethod;
  readonly pattern: string;
  readonly authorize: AuthorizationLevel;
  readonly handle: RouteHandler;
}

// Data source contract ---------------------------------------------------------------------------

/**
 * Everything the in-process API asks of its data: the seeded collections, the domain rules that read
 * them and the session registry, behind one interface.
 *
 * `src/data/repositories.ts` implements it over the seeded collections, `src/main.tsx` binds that
 * implementation before the first render and `tests/testUtils.tsx` binds a double for the integration
 * tests. The seam declares the contract and imports no implementation of it: the transport is written
 * four phases before the data module exists, and the two are joined at the composition root rather
 * than by an import. A method that can fail says why through a `Result`, which the seam passes to the
 * surface unchanged.
 *
 * The four analytics and report members answer with a promise of one: the modules they run over — the
 * seeded daily sales fact table, the aggregation rules and the report composition — are fetched on
 * first use rather than shipped with the shell, so each of them resolves its modules before it
 * answers and refuses with the seam's generic `500` when that fetch fails.
 *
 * The credential check belongs to the seam and not to the store: `signIn` opens and records a session
 * for credentials the seam has already proved, and deliberately performs no comparison of its own. The
 * digest arithmetic has exactly one home — `verifyCredential` in `src/utils/strings.ts`, which
 * `src/data/customers.ts` also uses to seed the 40 customers and 2 administrators — so the seam looks
 * the account and its digest up through {@link SalesProDataSource.findSignInCredential}, compares the
 * submitted password with that helper, answers `401` when it fails, and only then asks the store to
 * open the session.
 */
export interface SalesProDataSource {
  // Catalogue — the seeded catalogue, filtered, faceted, sorted and searched.
  listProducts(query: Catalog.FilterState): Common.PageResult<Catalog.Product>;
  getProduct(id: Common.ProductId): Catalog.Product | undefined;
  /** Up to `limit` products from the same category, nearest in price first. */
  listRelatedProducts(id: Common.ProductId, limit: number): Catalog.Product[];
  /** One page of the reviews of the product its query names, newest first, optionally narrowed to a single
   * rating. The product travels in the query rather than as an argument, because the data source cannot
   * reach the captured segment the dispatcher resolved. */
  listProductReviews(query: Catalog.ReviewQuery): Common.PageResult<Catalog.Review>;
  insertProductReview(input: NewProductReviewInput): Catalog.Review;
  /** The five facets for `query`, each counted with its own selection excluded. */
  buildFacets(query: Catalog.FacetQuery): Catalog.Facet[];
  listSuggestions(query: {
    readonly q: string;
    readonly limit: number;
  }): Catalog.SearchSuggestion[];
  /** The category tree, children nested under their parents, with a product count on every node. */
  listCategories(): readonly Catalog.CategoryNode[];
  listBrands(): readonly Catalog.Brand[];

  // Commerce — delivery, pricing, promo eligibility and orders.
  listShippingMethods(): readonly Commerce.ShippingMethod[];
  /** Prices the submitted lines; fails with `409` and the `PromoRejectionReason` as its code when the
   * promo no longer applies, and `422` naming `field` when a line cannot be priced. */
  priceCart(request: {
    readonly lines: readonly Commerce.CartLine[];
    readonly promoCode: string | null;
    readonly shippingMethodId: string | null;
  }): Common.Result<Commerce.PricedCart>;
  /** Checks a code against the basket it is about to discount; fails with `409`, the
   * `PromoRejectionReason` as its code and `field` `"promoCode"`, so a cart names the cause —
   * `unknown`, `inactive`, `not-started`, `expired`, `below-minimum`, `usage-limit`,
   * `already-applied` or `ineligible-category` — rather than one message for all eight. */
  validatePromoCode(request: {
    readonly code: string;
    readonly lines: readonly Commerce.CartLine[];
  }): Common.Result<Commerce.PromoCode>;
  /** Builds and stores an order from the settled request: numbers it, snapshots its lines, addresses
   * and totals, and fails with `422` when a line can no longer be bought. */
  createOrder(request: OrderCreationRequest): Common.Result<Commerce.Order>;
  /** One page of `query.customerId`'s own orders, with the filters the query carries applied. */
  listOrders(query: CustomerOrderQuery): Common.PageResult<Commerce.Order>;
  /** The order `id` names, or `undefined`; the seam decides whether the caller may read it. */
  getOrder(id: Common.OrderId): Commerce.Order | undefined;

  // Identity — the account store and the session registry.
  /** Creates the account described; fails with `409` when the email already belongs to one. */
  registerCustomer(input: Account.RegistrationInput): Common.Result<Account.RegistrationResult>;
  /** Opens and records the session for credentials the seam has already proved. */
  signIn(credentials: Account.Credentials): Common.Result<Account.Session>;
  signOut(token: Common.SessionToken): void;
  /** The session a stored token still names; fails with `401` and the code `session-unknown` for a
   * token no session was issued for and `session-expired` for one past its expiry. */
  restoreSession(token: Common.SessionToken): Common.Result<Account.Session>;
  /** The session recorded for `token` — whether or not it has expired, because expiry is the seam's
   * decision, so it can tell `session-expired` from `session-unknown` — or `undefined` when the token
   * names no session. A token this process has not issued is rebuilt from the account store, because a
   * session issued before a page reload must be restorable from the token alone. */
  getSession(token: string | undefined): Account.Session | undefined;
  /** The account `id` names, or `undefined`; the seam decides whether the caller may read it. */
  getCustomer(id: Common.CustomerId): Account.Customer | undefined;
  /** The account an email address identifies and the digest its password is stored as: the one lookup
   * the seam's sign-in check needs, and the only place a digest leaves the account store. */
  findSignInCredential(email: string): SignInCredential | undefined;
  updateCustomer(
    id: Common.CustomerId,
    input: Account.ProfileUpdateInput,
  ): Common.Result<Account.Customer>;
  listAddresses(customerId: Common.CustomerId): readonly Account.Address[];
  addAddress(
    customerId: Common.CustomerId,
    input: Account.AddressInput,
  ): Common.Result<Account.Address>;
  /** Replaces an address's members, leaving its default flags as they are. The seam resolves the
   * path's id against the account's book before delegating and answers `404` with the code
   * `address-not-found` for an id the book does not hold, so an implementation is never asked to
   * edit another account's address and never restates the refusal. */
  updateAddress(
    customerId: Common.CustomerId,
    addressId: Common.AddressId,
    input: Account.AddressInput,
  ): Common.Result<Account.Address>;
  /** Removes an address; the default flags fall to the most recently added address that remains. The
   * seam resolves the path's id against the account's book before delegating and answers `404` with
   * the code `address-not-found` for an id the book does not hold, so an implementation is never asked
   * to remove another account's address and never restates the refusal. */
  removeAddress(customerId: Common.CustomerId, addressId: Common.AddressId): Common.Result<void>;
  /** Makes an address the default of `request.kind`, clearing the previous default of that kind. The
   * seam resolves the path's id against the account's book before delegating and answers `404` with
   * the code `address-not-found` for an id the book does not hold, so an implementation is never asked
   * to default another account's address and never restates the refusal. */
  setDefaultAddress(
    customerId: Common.CustomerId,
    addressId: Common.AddressId,
    request: Account.DefaultAddressRequest,
  ): Common.Result<Account.Address>;

  // Analytics and reports — the scans that live with the collections they read, reaching the modules
  // they are written in on first use rather than with the shell.
  /** The KPI summary for `query`'s period, with the comparison baseline it names: it fetches the
   * aggregation modules the first time one of these reads is made, and fails with `500` and the code
   * `unexpected-error` when that fetch fails. */
  getKpis(query: Analytics.AnalyticsQuery): Promise<Common.Result<Analytics.KpiSummary>>;
  /** The revenue series for `query`, over the seeded daily fact rows; deferred like
   * {@link SalesProDataSource.getKpis}. */
  getRevenueSeries(query: Analytics.RevenueQuery): Promise<Common.Result<Analytics.ChartSeries[]>>;
  /** The products `query` ranks highest over the seeded orders; deferred like
   * {@link SalesProDataSource.getKpis}. */
  getTopProducts(
    query: Analytics.TopProductsQuery,
  ): Promise<Common.Result<Analytics.ProductPerformance[]>>;
  /** The most recently placed orders, newest first, at most `limit` of them. It reads the order
   * collection the source already holds, so it answers without fetching anything. */
  getRecentOrders(limit: number): Commerce.Order[];
  listReportDefinitions(): readonly Analytics.ReportDefinition[];
  /** Runs the report `query.kind` names over its range; fails with `422` for a range that breaks a
   * rule, `422` naming `kind` for a kind no definition declares, and the `unexpected-error` failure
   * {@link SalesProDataSource.getKpis} states when the report modules cannot be fetched. */
  runReport(query: ReportRunQuery): Promise<Common.Result<Analytics.ReportResult>>;
}
