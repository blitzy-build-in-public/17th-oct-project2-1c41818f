/**
 * Path: src/lib/apiRoutes.ts
 * Purpose: The in-process API's endpoints: the route table, one handler per endpoint and the reading of the bodies they take
 * Lines: 600
 */

import {
  DEMO_CARD_NUMBERS,
  RELATED_PRODUCTS_LIMIT,
  SEARCH_SUGGESTION_LIMIT,
} from "@/constants/config";
import {
  ACCOUNT_COPY,
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
  demoPaymentNote,
} from "@/constants/content";
import type * as Account from "@/types/account";
import type * as Analytics from "@/types/analytics";
import type * as Catalog from "@/types/catalog";
import type * as Commerce from "@/types/commerce";
import type * as Common from "@/types/common";
import { toIsoDateTime } from "@/utils/dates";
import { verifyCredential } from "@/utils/strings";
import {
  hasErrors,
  isRatingValue,
  mergeErrors,
  validateAddress,
  validatePayment,
  validateProfileUpdate,
  validateRegistration,
  validateReview,
  validatePromoCodeShape,
  validateShippingSubmission,
  validateSignIn,
  type PaymentValidationInput,
} from "@/utils/validation";

import {
  API_ERROR_CODES,
  failure,
  ok,
  shapeError,
  type AuthorizationLevel,
  type NewProductReviewInput,
  type OrderCreationRequest,
  type RouteContext,
  type RouteDefinition,
  type RouteHandler,
} from "@/lib/apiContract";
import {
  fieldProblem,
  invalidFields,
  isMembers,
  memberBoolean,
  memberInteger,
  memberObject,
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
  readOrderSnapshot,
  readPaging,
  readPaymentInput,
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

// Settling a payment and remembering an order ----------------------------------------------------

/** The card brand a demonstration payment is recorded as, read from the number's leading digits, or a
 * plain `"Card"` for a scheme the demonstration does not recognise. */
function cardBrand(digits: string): string {
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (digits.startsWith("6")) return "Discover";
  return "Card";
}

/**
 * The payment an order records, decided here and not by the store: the number is read, validated and
 * reduced to its brand, its last four digits and a decision, so no number reaches the data module, an
 * order or a payload. One configured number is declined, with the demonstration note as its message,
 * and every other card that passed the payment rules is authorised; an invoice is recorded as accepted
 * with no card and no authorisation instant, because nothing authorised anything.
 */
function settlePayment(payment: PaymentValidationInput): Common.Result<Commerce.PaymentSummary> {
  if (payment.method !== "card") {
    return ok({
      method: "invoice",
      status: "authorised",
      brand: null,
      last4: null,
      authorisedAt: null,
    });
  }
  const digits = (payment.card?.number ?? "").replace(/\D/g, "");
  if (digits === DEMO_CARD_NUMBERS.DECLINED) {
    return failure(
      API_ERROR_CODES.PAYMENT_DECLINED,
      demoPaymentNote(DEMO_CARD_NUMBERS.APPROVED, DEMO_CARD_NUMBERS.DECLINED),
    );
  }
  return ok({
    method: "card",
    status: "authorised",
    brand: cardBrand(digits),
    last4: digits.slice(-4),
    authorisedAt: toIsoDateTime(new Date()),
  });
}

/** The orders already created, by the key they were submitted with and the identity of that
 * submission. Only a created order is remembered, so a declined attempt can be corrected and resent
 * under the same key — which the checkout's retained key needs — while a repeat of a submission that
 * did create an order replays it instead of placing a second. */
const rememberedOrders = new Map<
  string,
  { readonly fingerprint: string; readonly outcome: Common.Result<Commerce.Order> }
>();

/** Forgets every remembered order, so a fresh case cannot replay an order an earlier one created. */
export function clearRememberedOrders(): void {
  rememberedOrders.clear();
}

/** The identity of a submission for the idempotency store: everything an order is built from, except
 * the card, whose digits must not be retained anywhere, and except the authorisation instant, which
 * differs between two identical submissions. */
function orderFingerprint(request: OrderCreationRequest): string {
  return JSON.stringify({
    snapshot: request.snapshot,
    email: request.email,
    shippingAddress: request.shippingAddress,
    billingAddress: request.billingAddress,
    shippingMethodId: request.shippingMethodId,
    customerId: request.customerId,
    payment: { ...request.payment, authorisedAt: null },
  });
}
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
  const limit = readLimit(context.query, "limit", RELATED_PRODUCTS_LIMIT);
  const response: Catalog.RelatedProductsResponse = {
    items: context.source.listRelatedProducts(context.params.id as Common.ProductId, limit),
  };
  return ok(response);
}

function listProductReviews(context: RouteContext): Common.Result<unknown> {
  const rawRating = memberInteger(context.query, "rating");
  const rating: Catalog.RatingValue | null = isRatingValue(rawRating) ? rawRating : null;
  if (rawRating !== undefined && rating === null) return fieldProblem("rating");
  const query: Catalog.ReviewQuery = { ...readPaging(context.query), rating: rating ?? undefined };
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
  if (rating === undefined) return fieldProblem("rating");
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

function listSuggestions(context: RouteContext): Common.Result<unknown> {
  const response: Catalog.SearchSuggestionResponse = {
    suggestions: context.source.listSuggestions({
      q: memberText(context.query, "q") ?? "",
      limit: readLimit(context.query, "limit", SEARCH_SUGGESTION_LIMIT, SEARCH_SUGGESTION_LIMIT),
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
  return context.source.priceCart({
    lines: lines.value,
    promoCode: memberText(body, "promoCode") ?? null,
    shippingMethodId: memberText(body, "shippingMethodId") ?? null,
  });
}

function validatePromoCode(context: RouteContext): Common.Result<unknown> {
  const body = bodyOf(context);
  const code = memberTextOrEmpty(body, "code");
  const shape = validatePromoCodeShape(code);
  if (shape !== undefined) {
    return failure(API_ERROR_CODES.VALIDATION_FAILED, shape, "promoCode");
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

/** The address snapshot an order carries, read by the same readers the address book uses. */
function readSubmittedAddress(members: RequestMembers | undefined): Account.Address {
  return {
    id: memberTextOrEmpty(members, "id") as Common.AddressId,
    ...readAddressInput(members),
    isDefaultShipping: memberBoolean(members, "isDefaultShipping") ?? false,
    isDefaultBilling: memberBoolean(members, "isDefaultBilling") ?? false,
  };
}

/** The order a submission asks for: the shipping half judged by the shipping rule, the payment by the
 * payment rule, the snapshot by its amounts and the key by its presence. The customer comes from the
 * session, never the body. */
function readOrderRequest(context: RouteContext): Common.Result<OrderCreationRequest> {
  const body = bodyOf(context);
  const shippingAddress = readSubmittedAddress(memberObject(body, "shippingAddress"));
  const billingAddress = readSubmittedAddress(memberObject(body, "billingAddress"));
  const email = memberTextOrEmpty(body, "email");
  const shippingMethodId = memberTextOrEmpty(body, "shippingMethodId");
  const idempotencyKey = memberTextOrEmpty(body, "idempotencyKey");
  const payment = readPaymentInput(memberObject(body, "payment"));
  const snapshot = readOrderSnapshot(memberValue(body, "snapshot"));
  const errors = mergeErrors(
    validateShippingSubmission({ address: shippingAddress, email, shippingMethodId }),
    payment === undefined ? { method: VALIDATION_MESSAGES.REQUIRED } : validatePayment(payment),
    snapshot === undefined ? { snapshot: VALIDATION_MESSAGES.REQUIRED } : {},
    idempotencyKey.trim() === "" ? { idempotencyKey: VALIDATION_MESSAGES.REQUIRED } : {},
  );
  if (hasErrors(errors) || payment === undefined || snapshot === undefined) {
    return invalidFields(errors);
  }
  const settled = settlePayment(payment);
  if (!settled.ok) return settled;
  return ok({
    snapshot,
    email,
    shippingAddress,
    billingAddress,
    shippingMethodId,
    idempotencyKey,
    customerId: context.session?.customerId ?? null,
    payment: settled.value,
  });
}

function createOrder(context: RouteContext): Common.Result<unknown> {
  const request = readOrderRequest(context);
  if (!request.ok) return request;
  const fingerprint = orderFingerprint(request.value);
  const remembered = rememberedOrders.get(request.value.idempotencyKey);
  if (remembered !== undefined) {
    return remembered.fingerprint === fingerprint
      ? remembered.outcome
      : failure(API_ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT, FEEDBACK_COPY.ERROR_STATE_BODY);
  }
  const created = context.source.createOrder(request.value);
  if (created.ok) {
    rememberedOrders.set(request.value.idempotencyKey, { fingerprint, outcome: created });
  }
  return created;
}

function listOrders(context: RouteContext): Common.Result<unknown> {
  const query = readOrderHistory(context.query, sessionOf(context).customerId);
  return query.ok ? ok(context.source.listOrders(query.value)) : query;
}

/** An order that names no account is answered to whoever holds its identifier; a foreign id is `404`,
 * never `403`; the level admits a session-less caller, which is all a guest's confirmation carries. */
function getOrder(context: RouteContext): Common.Result<unknown> {
  const order = context.source.getOrder(context.params.id as Common.OrderId);
  if (order !== undefined && order.customerId === null) return ok(order);
  if (context.sessionProblem !== null) return { ok: false, error: context.sessionProblem };
  if (order === undefined) return missing(API_ERROR_CODES.ORDER_NOT_FOUND);
  const session = sessionOf(context);
  if (session.role === "admin" || order.customerId === session.customerId) return ok(order);
  return missing(API_ERROR_CODES.ORDER_NOT_FOUND);
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
  if (token !== undefined) context.source.signOut(token as Common.SessionToken);
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

function getKpis(context: RouteContext): Common.Result<unknown> {
  const query = readAnalyticsQuery(context.query);
  return query.ok ? ok(context.source.getKpis(query.value)) : query;
}

function getRevenueSeries(context: RouteContext): Common.Result<unknown> {
  const query = readRevenueQuery(context.query);
  if (!query.ok) return query;
  const response: Analytics.ChartSeriesResponse = {
    series: context.source.getRevenueSeries(query.value),
  };
  return ok(response);
}

function getTopProducts(context: RouteContext): Common.Result<unknown> {
  const query = readTopProductsQuery(context.query);
  if (!query.ok) return query;
  const response: Analytics.TopProductsResponse = {
    items: context.source.getTopProducts(query.value),
  };
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

function runReport(context: RouteContext): Common.Result<unknown> {
  const kind = readReportKind(context.params.kind);
  if (kind === null) return missing(API_ERROR_CODES.ROUTE_NOT_FOUND);
  const query = readReportQuery(context.query);
  if (!query.ok) return query;
  return context.source.runReport({ ...query.value, kind });
}

// The route table --------------------------------------------------------------------------------

/** Every endpoint the in-process API answers, with the level its caller needs. A static segment always
 * beats a captured one, so the table's order never decides which route matches. */
const ROUTES = [
  route("products.list", "GET", "/api/products", "anonymous", listProducts),
  route("products.detail", "GET", "/api/products/:id", "anonymous", getProduct),
  route("products.related", "GET", "/api/products/:id/related", "anonymous", listRelatedProducts),
  route("reviews.list", "GET", "/api/products/:id/reviews", "anonymous", listProductReviews),
  route("reviews.create", "POST", "/api/products/:id/reviews", "customer", insertProductReview),
  route("facets.list", "GET", "/api/facets", "anonymous", listFacets),
  route("search.suggest", "GET", "/api/search/suggest", "anonymous", listSuggestions),
  route("categories.list", "GET", "/api/categories", "anonymous", listCategories),
  route("brands.list", "GET", "/api/brands", "anonymous", listBrands),
  route("cart.price", "POST", "/api/cart/price", "anonymous", priceCart),
  route("cart.validatePromo", "POST", "/api/cart/validate-promo", "anonymous", validatePromoCode),
  route("shipping.list", "GET", "/api/shipping-methods", "anonymous", listShippingMethods),
  route("orders.create", "POST", "/api/orders", "anonymous", createOrder),
  route("orders.list", "GET", "/api/orders", "customer", listOrders),
  route("orders.detail", "GET", "/api/orders/:id", "anonymous", getOrder),
  route("auth.register", "POST", "/api/auth/register", "anonymous", registerCustomer),
  route("auth.login", "POST", "/api/auth/login", "anonymous", signIn),
  route("auth.logout", "POST", "/api/auth/logout", "anonymous", signOut),
  route("auth.session", "GET", "/api/auth/session", "anonymous", readSession),
  route("customers.detail", "GET", "/api/customers/:id", "customer", getCustomer),
  route("customers.update", "PATCH", "/api/customers/:id", "customer", updateCustomer),
  route("addresses.list", "GET", "/api/customers/:id/addresses", "customer", listAddresses),
  route("addresses.create", "POST", "/api/customers/:id/addresses", "customer", addAddress),
  route(
    "addresses.update",
    "PATCH",
    "/api/customers/:id/addresses/:addressId",
    "customer",
    updateAddress,
  ),
  route(
    "addresses.remove",
    "DELETE",
    "/api/customers/:id/addresses/:addressId",
    "customer",
    removeAddress,
  ),
  route(
    "addresses.setDefault",
    "POST",
    "/api/customers/:id/addresses/:addressId/default",
    "customer",
    setDefaultAddress,
  ),
  route("analytics.kpis", "GET", "/api/analytics/kpis", "administrator", getKpis),
  route("analytics.revenue", "GET", "/api/analytics/revenue", "administrator", getRevenueSeries),
  route("analytics.top", "GET", "/api/analytics/top-products", "administrator", getTopProducts),
  route(
    "analytics.recent",
    "GET",
    "/api/analytics/recent-orders",
    "administrator",
    getRecentOrders,
  ),
  route("reports.list", "GET", "/api/reports/definitions", "administrator", listReports),
  route("reports.run", "GET", "/api/reports/:kind", "administrator", runReport),
] as const satisfies readonly RouteDefinition[];

/** The table the dispatcher matches a request against. */
export const routeTable = ROUTES;

/** One route id, derived from the table so a matcher or a test names one the table declares. */
export type RouteId = (typeof ROUTES)[number]["id"];
