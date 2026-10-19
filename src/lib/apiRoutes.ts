/**
 * Path: src/lib/apiRoutes.ts
 * Purpose: The in-process API's endpoints: the route table, one handler per endpoint and the reading of the bodies they take
 * Lines: 533
 */

import { RELATED_PRODUCTS_LIMIT, SEARCH_SUGGESTION_LIMIT } from "@/constants/config";
import { ACCOUNT_COPY, FEEDBACK_COPY, VALIDATION_MESSAGES } from "@/constants/content";
import type * as Account from "@/types/account";
import type * as Analytics from "@/types/analytics";
import type * as Catalog from "@/types/catalog";
import type * as Common from "@/types/common";
import { FILTER_PARAMS } from "@/utils/queryParams";
import { verifyCredential } from "@/utils/strings";
import {
  firstError,
  hasErrors,
  isRatingValue,
  validateAddress,
  validateProfileUpdate,
  validateRating,
  validateRegistration,
  validateReview,
  validateSearchTerm,
  validatePromoCodeShape,
  validateShippingMethod,
  validateSignIn,
} from "@/utils/validation";

import {
  API_ERROR_CODES,
  API_PATHS,
  failure,
  ok,
  shapeError,
  type AuthorizationLevel,
  type NewProductReviewInput,
  type RouteContext,
  type RouteDefinition,
  type RouteHandler,
} from "@/lib/apiContract";
import { createOrder, forgetRememberedOrders, holdsGuestOrderCredential } from "@/lib/apiOrders";
import {
  fieldProblem,
  invalidFields,
  isMembers,
  memberInteger,
  memberText,
  memberTextOrEmpty,
  memberValue,
  missing,
  promoRejectionWording,
  readAddressInput,
  readAddressKind,
  readAnalyticsQuery,
  readCartLines,
  readCredentials,
  readFilterFields,
  readFilterState,
  readOrderHistory,
  readPaging,
  readProfileUpdate,
  readRegistration,
  readReportKind,
  readReportQuery,
  readRevenueQuery,
  readReviewDraft,
  readTopProductsQuery,
  type RequestMembers,
  DEFAULT_RECENT_ORDERS_LIMIT,
  readLimit,
} from "@/lib/apiRequests";

// The route table --------------------------------------------------------------------------------

/** Declares one route, so {@link RouteId} can be derived from the literal ids the table carries. */
function route<TId extends string>(
  id: TId,
  method: Common.HttpMethod,
  pattern: string,
  authorize: AuthorizationLevel,
  handle: RouteHandler,
): RouteDefinition<TId> {
  return { id, method, pattern, authorize, handle };
}

// Republished here because its only caller reaches the store through this module, beside the route table.
export { clearRememberedOrders } from "@/lib/apiOrders";

// Reading what a path names ----------------------------------------------------------------------

/** The acting session of an authorised route: the one assertion a `customer` or `administrator` handler
 * relies on — a handler on an anonymous route checks the dispatcher's refusal first. */
function sessionOf(context: RouteContext): Account.Session {
  return context.session as Account.Session;
}

/** The body a handler reads, or `undefined` when the request carried something that is not an object.
 * No member is ever assumed to be present: the readers give each one a value the rule that owns it can
 * judge. */
function bodyOf(context: RouteContext): RequestMembers | undefined {
  return isMembers(context.body) ? context.body : undefined;
}

/** The customer a request's path names, or the `403` for a record the session neither owns nor
 * administrates — a record that does not exist answers the same refusal, so a response cannot be read
 * to learn which accounts exist. */
function ownedCustomer(context: RouteContext): Common.Result<Common.CustomerId> {
  const customerId = context.params.id as Common.CustomerId;
  const session = sessionOf(context);
  return session.role === "admin" || session.customerId === customerId
    ? ok(customerId)
    : failure(API_ERROR_CODES.FORBIDDEN, FEEDBACK_COPY.ERROR_STATE_BODY);
}

/** The address a request's path names within the book `customerId` owns, or the `404` for an id that
 * names none of them: read from the source, so another account's id refuses the same way. */
function ownedAddress(
  context: RouteContext,
  customerId: Common.CustomerId,
): Common.Result<Common.AddressId> {
  const addressId = context.params.addressId as Common.AddressId;
  const holds = context.source.listAddresses(customerId).some((one) => one.id === addressId);
  return holds ? ok(addressId) : missing(API_ERROR_CODES.ADDRESS_NOT_FOUND);
}

// Handlers ---------------------------------------------------------------------------------------

function listProducts(context: RouteContext): Common.Result<unknown> {
  const query = readFilterState(context.query);
  return query.ok ? ok(context.source.listProducts(query.value)) : query;
}

function getProduct(context: RouteContext): Common.Result<unknown> {
  const product = context.source.getProduct(context.params.id as Common.ProductId);
  return product === undefined ? missing(API_ERROR_CODES.PRODUCT_NOT_FOUND) : ok(product);
}

function listRelatedProducts(context: RouteContext): Common.Result<unknown> {
  const limit = readLimit(context.query, "limit", RELATED_PRODUCTS_LIMIT, RELATED_PRODUCTS_LIMIT);
  const response: Catalog.RelatedProductsResponse = {
    items: context.source.listRelatedProducts(context.params.id as Common.ProductId, limit),
  };
  return ok(response);
}

/** One page of the reviews of the product the path names, in the endpoint's newest-first order, with the
 * rating narrowing the query may carry. The identifier travels in the query this handler builds rather than
 * being left to the data source, which cannot reach the captured segment; an identifier the catalogue holds
 * nothing under is refused with the endpoint's own `product-not-found`, exactly as the write route on the
 * same path refuses it, so a read can never report an empty page for a product that does not exist. */
function listProductReviews(context: RouteContext): Common.Result<unknown> {
  const productId = context.params.id as Common.ProductId;
  if (context.source.getProduct(productId) === undefined) {
    return missing(API_ERROR_CODES.PRODUCT_NOT_FOUND);
  }
  const rawRating = memberInteger(context.query, "rating");
  const rating: Catalog.RatingValue | null = isRatingValue(rawRating) ? rawRating : null;
  if (rating === null) {
    // A member the caller supplied is judged by the rating rule itself: outside the five, the range
    // sentence; not a whole number, the unsupported-value one. A blank member is no filter at all.
    const supplied = memberText(context.query, "rating")?.trim() ?? "";
    if (supplied !== "") return invalidFields(validateRating(supplied));
  }
  const query: Catalog.ReviewQuery = {
    productId,
    ...readPaging(context.query),
    rating: rating ?? undefined,
  };
  return ok(context.source.listProductReviews(query));
}

function insertProductReview(context: RouteContext): Common.Result<unknown> {
  const productId = context.params.id as Common.ProductId;
  if (context.source.getProduct(productId) === undefined) {
    return missing(API_ERROR_CODES.PRODUCT_NOT_FOUND);
  }
  const body = bodyOf(context);
  const draft = readReviewDraft(body);
  const rating = draft.rating;
  // Only a rating nobody sent is reported as missing: a supplied 0 or 6 is outside the five, a
  // fractional one is not a whole number, and one sent as text is not the rating the field takes,
  // so the rule judges the member as it arrived, not the narrowed draft this write needs.
  if (rating === undefined) {
    const ratingErrors = validateRating(memberValue(body, "rating"));
    return hasErrors(ratingErrors) ? invalidFields(ratingErrors) : fieldProblem("rating");
  }
  const errors = validateReview(draft);
  if (hasErrors(errors)) return invalidFields(errors);
  const input: NewProductReviewInput = {
    productId,
    customerId: sessionOf(context).customerId,
    rating,
    title: draft.title,
    body: draft.body,
  };
  return ok(context.source.insertProductReview(input));
}

function listFacets(context: RouteContext): Common.Result<unknown> {
  const query = readFilterFields(context.query);
  return query.ok ? ok(context.source.buildFacets(query.value)) : query;
}

/** Answers `GET /api/search/suggest`, parsing the request into `Catalog.SuggestionQuery` — the one shape
 * `src/types/catalog.ts` declares for this endpoint's parameters and both sides of the seam read — with
 * its optional `limit` resolved from the endpoint's declared default for the data source it asks. The term
 * it carries is the listing read's own `q`, judged by the same free-text rule the catalogue's filter member
 * is judged by, so one term cannot be served here where the listing refuses it. */
function listSuggestions(context: RouteContext): Common.Result<unknown> {
  const term = memberTextOrEmpty(context.query, FILTER_PARAMS.QUERY);
  const termProblem = validateSearchTerm(term, FILTER_PARAMS.QUERY);
  if (hasErrors(termProblem)) return invalidFields(termProblem);
  const query: Catalog.SuggestionQuery = {
    q: term,
    limit: readLimit(context.query, "limit", SEARCH_SUGGESTION_LIMIT, SEARCH_SUGGESTION_LIMIT),
  };
  const response: Catalog.SearchSuggestionResponse = {
    suggestions: context.source.listSuggestions({
      q: query.q,
      limit: query.limit ?? SEARCH_SUGGESTION_LIMIT,
    }),
  };
  return ok(response);
}

function listCategories(context: RouteContext): Common.Result<unknown> {
  return ok(context.source.listCategories());
}

function listBrands(context: RouteContext): Common.Result<unknown> {
  return ok(context.source.listBrands());
}

function listShippingMethods(context: RouteContext): Common.Result<unknown> {
  return ok(context.source.listShippingMethods());
}

function priceCart(context: RouteContext): Common.Result<unknown> {
  const body = bodyOf(context);
  const lines = readCartLines(memberValue(body, "lines"));
  if (!lines.ok) return lines;
  const shippingMethodId = memberText(body, "shippingMethodId") ?? null;
  // One parameter, one rule: the order path judges this same id with this same rule, so a method
  // the store does not deliver by cannot be quoted for either. A blank or absent member is what a
  // checkout that has not chosen a method yet sends, and it resolves exactly as it always has.
  if (shippingMethodId !== null && shippingMethodId.trim().length > 0) {
    const methodErrors = validateShippingMethod(shippingMethodId);
    if (hasErrors(methodErrors)) return invalidFields(methodErrors);
  }
  return context.source.priceCart({
    lines: lines.value,
    promoCode: memberText(body, "promoCode") ?? null,
    shippingMethodId,
  });
}

function validatePromoCode(context: RouteContext): Common.Result<unknown> {
  const body = bodyOf(context);
  const code = memberTextOrEmpty(body, "code");
  const shapeErrors = validatePromoCodeShape(code);
  if (hasErrors(shapeErrors)) {
    const message = firstError(shapeErrors) ?? VALIDATION_MESSAGES.REQUIRED;
    return failure(API_ERROR_CODES.VALIDATION_FAILED, message, "promoCode");
  }
  const lines = readCartLines(memberValue(body, "lines"));
  if (!lines.ok) return lines;
  const outcome = context.source.validatePromoCode({ code, lines: lines.value });
  if (outcome.ok) return outcome;
  const wording = promoRejectionWording(outcome.error.code);
  if (wording === undefined) return outcome;
  const message = outcome.error.message.length > 0 ? outcome.error.message : wording;
  return { ok: false, error: shapeError(409, outcome.error.code, message, "promoCode") };
}

function listOrders(context: RouteContext): Common.Result<unknown> {
  const query = readOrderHistory(context.query, sessionOf(context).customerId);
  return query.ok ? ok(context.source.listOrders(query.value)) : query;
}

/** The order an identifier names, decided in the order the answers matter rather than the order the facts are
 * known in, so that no answer tells a caller who cannot present a usable credential whether an identifier
 * exists at all:
 *
 * 1. An account-less order presented with the credential recorded for it when it was placed is answered. That
 *    credential is all a session-less buyer's own confirmation holds, and it is the only caller answered
 *    without a session.
 * 2. A caller whose session the store resolved is answered by ownership: its own order, or any order for an
 *    administrator. Every other combination — another account's order, and an identifier no order holds — is
 *    the one `404`, so a response cannot be read to learn which order identifiers exist.
 * 3. Every other caller — one presenting no credential at all, one presenting a session token the store could
 *    not resolve, and one presenting a foreign or lapsed placement credential — is refused identically, with
 *    the refusal the session lookup earned. For a request that presented nothing that is the `401`
 *    `unauthenticated` this endpoint answers a session-less caller, so an identifier an order holds and one it
 *    does not are answered alike; a foreign id is never `403`.
 *
 * The answers are exactly the `401`, `403` and `404` the endpoint's contract allows: the `403` belongs to the
 * routes that gate a level before a handler runs, and answering a foreign order with it here would tell the
 * caller the record exists. */
function getOrder(context: RouteContext): Common.Result<unknown> {
  const orderId = context.params.id as Common.OrderId;
  const order = context.source.getOrder(orderId);
  // The placement credential is judged before the session: it is all a session-less buyer's own confirmation
  // holds, and it proves the order was created here.
  if (
    order !== undefined &&
    order.customerId === null &&
    holdsGuestOrderCredential(orderId, context.orderToken)
  ) {
    return ok(order);
  }
  if (context.session !== null) {
    const session = sessionOf(context);
    if (order === undefined) return missing(API_ERROR_CODES.ORDER_NOT_FOUND);
    if (session.role === "admin" || order.customerId === session.customerId) return ok(order);
    return missing(API_ERROR_CODES.ORDER_NOT_FOUND);
  }
  // The refusal the lookup earned, which for a caller that presented no token is the `401 unauthenticated` it
  // is answered with either way; the dispatcher resolves every request's token before a handler runs, so a
  // request with no session beside it always carries that refusal.
  return { ok: false, error: context.sessionProblem as Common.ApiError };
}
function registerCustomer(context: RouteContext): Common.Result<unknown> {
  const input = readRegistration(bodyOf(context));
  const errors = validateRegistration(input);
  if (hasErrors(errors)) return invalidFields(errors);
  const outcome = context.source.registerCustomer(input);
  if (outcome.ok) return outcome;
  const message =
    outcome.error.message.length > 0 ? outcome.error.message : ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE;
  return { ok: false, error: { ...outcome.error, message } };
}

function signIn(context: RouteContext): Common.Result<unknown> {
  const body = bodyOf(context);
  const credentials = readCredentials(body);
  if (credentials === undefined) return invalidFields(validateSignIn(body));
  const credential = context.source.findSignInCredential(credentials.email);
  if (credential === undefined || !verifyCredential(credentials.password, credential.digest)) {
    // One generic sentence for both members, so a response cannot be read to learn which email
    // addresses have accounts.
    return failure(API_ERROR_CODES.INVALID_CREDENTIALS, ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE);
  }
  return context.source.signIn(credentials);
}

function signOut(context: RouteContext): Common.Result<unknown> {
  const token = context.token;
  if (token !== undefined) {
    context.source.signOut(token as Common.SessionToken);
    // The session ended here, so what its submissions were retained for ends with it.
    forgetRememberedOrders(token);
  }
  return ok(undefined);
}

function readSession(context: RouteContext): Common.Result<unknown> {
  if (context.sessionProblem !== null) return { ok: false, error: context.sessionProblem };
  return context.source.restoreSession(context.token as Common.SessionToken);
}

function getCustomer(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  if (!owned.ok) return owned;
  const customer = context.source.getCustomer(owned.value);
  return customer === undefined
    ? failure(API_ERROR_CODES.FORBIDDEN, FEEDBACK_COPY.ERROR_STATE_BODY)
    : ok(customer);
}

function updateCustomer(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  if (!owned.ok) return owned;
  const input = readProfileUpdate(bodyOf(context));
  const errors = validateProfileUpdate(input);
  return hasErrors(errors)
    ? invalidFields(errors)
    : context.source.updateCustomer(owned.value, input);
}

function listAddresses(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  return owned.ok ? ok(context.source.listAddresses(owned.value)) : owned;
}

function addAddress(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  if (!owned.ok) return owned;
  const input = readAddressInput(bodyOf(context));
  const errors = validateAddress(input);
  return hasErrors(errors) ? invalidFields(errors) : context.source.addAddress(owned.value, input);
}

function updateAddress(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  if (!owned.ok) return owned;
  const address = ownedAddress(context, owned.value);
  if (!address.ok) return address;
  const input = readAddressInput(bodyOf(context));
  const errors = validateAddress(input);
  return hasErrors(errors)
    ? invalidFields(errors)
    : context.source.updateAddress(owned.value, address.value, input);
}

function removeAddress(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  if (!owned.ok) return owned;
  const address = ownedAddress(context, owned.value);
  return address.ok ? context.source.removeAddress(owned.value, address.value) : address;
}

function setDefaultAddress(context: RouteContext): Common.Result<unknown> {
  const owned = ownedCustomer(context);
  if (!owned.ok) return owned;
  const address = ownedAddress(context, owned.value);
  if (!address.ok) return address;
  const kind = readAddressKind(bodyOf(context));
  if (kind === null) return fieldProblem("kind");
  return context.source.setDefaultAddress(owned.value, address.value, { kind });
}

async function getKpis(context: RouteContext): Promise<Common.Result<unknown>> {
  const query = readAnalyticsQuery(context.query);
  if (!query.ok) return query;
  const kpis = await context.source.getKpis(query.value);
  return kpis.ok ? ok(kpis.value) : kpis;
}

async function getRevenueSeries(context: RouteContext): Promise<Common.Result<unknown>> {
  const query = readRevenueQuery(context.query);
  if (!query.ok) return query;
  const series = await context.source.getRevenueSeries(query.value);
  if (!series.ok) return series;
  const response: Analytics.ChartSeriesResponse = { series: series.value };
  return ok(response);
}

async function getTopProducts(context: RouteContext): Promise<Common.Result<unknown>> {
  const query = readTopProductsQuery(context.query);
  if (!query.ok) return query;
  const items = await context.source.getTopProducts(query.value);
  if (!items.ok) return items;
  const response: Analytics.TopProductsResponse = { items: items.value };
  return ok(response);
}

function getRecentOrders(context: RouteContext): Common.Result<unknown> {
  const response: Analytics.RecentOrdersResponse = {
    items: context.source.getRecentOrders(
      readLimit(context.query, "limit", DEFAULT_RECENT_ORDERS_LIMIT),
    ),
  };
  return ok(response);
}

function listReports(context: RouteContext): Common.Result<unknown> {
  return ok(context.source.listReportDefinitions());
}

async function runReport(context: RouteContext): Promise<Common.Result<unknown>> {
  const kind = readReportKind(context.params.kind);
  if (kind === null) return missing(API_ERROR_CODES.ROUTE_NOT_FOUND);
  const query = readReportQuery(context.query);
  if (!query.ok) return query;
  const report = await context.source.runReport({ ...query.value, kind });
  return report.ok ? ok(report.value) : report;
}

// The route table --------------------------------------------------------------------------------

/** Every endpoint the in-process API answers, with the level its caller needs. Each row takes its
 * pattern from `API_PATHS`, the table the callers of these endpoints also build their targets from, so
 * a path has one home. A static segment always beats a captured one, so the table's order never
 * decides which route matches. */
const ROUTES = [
  route("products.list", "GET", API_PATHS.PRODUCTS, "anonymous", listProducts),
  route("products.detail", "GET", API_PATHS.PRODUCT_DETAIL, "anonymous", getProduct),
  route("products.related", "GET", API_PATHS.PRODUCT_RELATED, "anonymous", listRelatedProducts),
  route("reviews.list", "GET", API_PATHS.PRODUCT_REVIEWS, "anonymous", listProductReviews),
  route("reviews.create", "POST", API_PATHS.PRODUCT_REVIEWS, "customer", insertProductReview),
  route("facets.list", "GET", API_PATHS.FACETS, "anonymous", listFacets),
  route("search.suggest", "GET", API_PATHS.SEARCH_SUGGEST, "anonymous", listSuggestions),
  route("categories.list", "GET", API_PATHS.CATEGORIES, "anonymous", listCategories),
  route("brands.list", "GET", API_PATHS.BRANDS, "anonymous", listBrands),
  route("cart.price", "POST", API_PATHS.CART_PRICE, "anonymous", priceCart),
  route(
    "cart.validatePromo",
    "POST",
    API_PATHS.CART_VALIDATE_PROMO,
    "anonymous",
    validatePromoCode,
  ),
  route("shipping.list", "GET", API_PATHS.SHIPPING_METHODS, "anonymous", listShippingMethods),
  route("orders.create", "POST", API_PATHS.ORDERS, "anonymous", createOrder),
  route("orders.list", "GET", API_PATHS.ORDERS, "customer", listOrders),
  route("orders.detail", "GET", API_PATHS.ORDER_DETAIL, "anonymous", getOrder),
  route("auth.register", "POST", API_PATHS.AUTH_REGISTER, "anonymous", registerCustomer),
  route("auth.login", "POST", API_PATHS.AUTH_LOGIN, "anonymous", signIn),
  route("auth.logout", "POST", API_PATHS.AUTH_LOGOUT, "anonymous", signOut),
  route("auth.session", "GET", API_PATHS.AUTH_SESSION, "anonymous", readSession),
  route("customers.detail", "GET", API_PATHS.CUSTOMER_DETAIL, "customer", getCustomer),
  route("customers.update", "PATCH", API_PATHS.CUSTOMER_DETAIL, "customer", updateCustomer),
  route("addresses.list", "GET", API_PATHS.CUSTOMER_ADDRESSES, "customer", listAddresses),
  route("addresses.create", "POST", API_PATHS.CUSTOMER_ADDRESSES, "customer", addAddress),
  route("addresses.update", "PATCH", API_PATHS.CUSTOMER_ADDRESS, "customer", updateAddress),
  route("addresses.remove", "DELETE", API_PATHS.CUSTOMER_ADDRESS, "customer", removeAddress),
  route(
    "addresses.setDefault",
    "POST",
    API_PATHS.CUSTOMER_ADDRESS_DEFAULT,
    "customer",
    setDefaultAddress,
  ),
  route("analytics.kpis", "GET", API_PATHS.ANALYTICS_KPIS, "administrator", getKpis),
  route("analytics.revenue", "GET", API_PATHS.ANALYTICS_REVENUE, "administrator", getRevenueSeries),
  route("analytics.top", "GET", API_PATHS.ANALYTICS_TOP_PRODUCTS, "administrator", getTopProducts),
  route(
    "analytics.recent",
    "GET",
    API_PATHS.ANALYTICS_RECENT_ORDERS,
    "administrator",
    getRecentOrders,
  ),
  route("reports.list", "GET", API_PATHS.REPORT_DEFINITIONS, "administrator", listReports),
  route("reports.run", "GET", API_PATHS.REPORT_RUN, "administrator", runReport),
] as const satisfies readonly RouteDefinition[];

/** The table the dispatcher matches a request against. */
export const routeTable = ROUTES;

/** One route id, derived from the table so a matcher or a test names one the table declares. */
export type RouteId = (typeof ROUTES)[number]["id"];
