/**
 * Path: src/lib/apiRequests.ts
 * Purpose: Reads a request for the in-process API: the members a query carries, the vocabularies they are validated against and the refusals they produce
 * Lines: 600
 */

import { MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import {
  NOT_FOUND_COPY,
  PROMO_REJECTION_MESSAGES,
  VALIDATION_MESSAGES,
  quantityRangeMessage,
} from "@/constants/content";
import { DATE_RANGE_COPY, rangeTooLongMessage } from "@/constants/content-reports";
import {
  BASELINE_OPTIONS,
  GRANULARITY_OPTIONS,
  ORDER_STATUS_OPTIONS,
  REPORT_DEFINITIONS,
  SORT_OPTIONS,
} from "@/constants/taxonomy";
import type * as Account from "@/types/account";
import type * as Analytics from "@/types/analytics";
import type * as Catalog from "@/types/catalog";
import type * as Commerce from "@/types/commerce";
import type * as Common from "@/types/common";
import { clampNumber, normalisePageSize } from "@/utils/collections";
import { toFieldErrors, validateDateRange, type DateRangeErrorCode } from "@/utils/dates";
import { isValidIso } from "@/utils/dates";
import { FILTER_PARAMS } from "@/utils/queryParams";
import {
  FORM_ERROR_KEY,
  firstError,
  isRatingValue,
  type PaymentValidationInput,
  type ReviewDraft,
} from "@/utils/validation";

import {
  API_ERROR_CODES,
  failure,
  ok,
  type ApiErrorCode,
  type CustomerOrderQuery,
} from "@/lib/apiContract";

/** The shape a whole number in a request member has: digits, with a sign but nothing else. */
const INTEGER_TEXT_PATTERN = /^[+-]?\d+$/;

/** The most rows one listing request may ask for, so a hand-made `limit` cannot ask the seam to hand
 * back an unbounded collection: there is no server, so this cap is the seam's whole protection. */
const MAX_REQUESTED_ROWS = 100;

/** The rows the dashboard's recent-orders table shows when a request names no limit. */
export const DEFAULT_RECENT_ORDERS_LIMIT = 8;

// Refusing a request -----------------------------------------------------------------------------

/** The 422 a broken field rule answers with: the first field the map names and its message. */
export function invalidFields(errors: Common.FieldErrors): Common.Result<never> {
  const field = Object.keys(errors)[0] ?? FORM_ERROR_KEY;
  const message = firstError(errors) ?? VALIDATION_MESSAGES.REQUIRED;
  return failure(API_ERROR_CODES.VALIDATION_FAILED, message, field);
}

/** The 422 for a request member outside the domain its own code declares, which only a hand-made
 * request reaches: `message` states what is wrong with a member the caller did supply. */
export function fieldProblem(field: string, message?: string): Common.Result<never> {
  const wording = message ?? VALIDATION_MESSAGES.UNSUPPORTED_VALUE;
  return failure(API_ERROR_CODES.VALIDATION_FAILED, wording, field);
}

/** A `404` for a path, a product, an order or an address that does not exist, worded by the
 * not-found copy. */
export function missing(code: ApiErrorCode): Common.Result<never> {
  return failure(code, NOT_FOUND_COPY.BODY);
}

// Reading members --------------------------------------------------------------------------------

/** The named members of a request — a parsed body or a query record — with nothing assumed about the
 * values: one reader set serves both, so a hand-made request is refused where a form would fail. */
export type RequestMembers = Readonly<Record<string, unknown>>;

/** Whether a value is an object with named members, narrowing to a record rather than to `any`. */
export function isMembers(value: unknown): value is RequestMembers {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is an array, narrowed to a list of unknown entries rather than to `any[]`. */
export function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** One member, unread. */
export function memberValue(members: RequestMembers | undefined, key: string): unknown {
  return members?.[key];
}

/** One member read as text: text, a number or a boolean stringified, or a repeat's first entry. */
export function memberText(members: RequestMembers | undefined, key: string): string | undefined {
  const value = members?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return isList(value) ? (typeof value[0] === "string" ? value[0] : undefined) : undefined;
}

/** One member read as text, a missing member reading as the empty string: what the rules then judge. */
export function memberTextOrEmpty(members: RequestMembers | undefined, key: string): string {
  return memberText(members, key) ?? "";
}

/** Every value a member carries, empty entries dropped, so a repeat and an array arrive alike. */
export function memberTextList(
  members: RequestMembers | undefined,
  key: string,
): readonly string[] {
  const value = members?.[key];
  if (typeof value === "string") return value === "" ? [] : [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (!isList(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry : "")).filter((e) => e !== "");
}

/** One member read as a whole number, or `undefined` for anything that is not one. */
export function memberInteger(
  members: RequestMembers | undefined,
  key: string,
): number | undefined {
  const text = memberText(members, key)?.trim();
  if (text === undefined || !INTEGER_TEXT_PATTERN.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

/** One member read as a flag: `undefined` when absent, the boolean, a spelling of true or false, and
 * `null` when present but readable as neither — which a caller refuses rather than reading as false. */
export function memberBoolean(
  members: RequestMembers | undefined,
  key: string,
): boolean | null | undefined {
  const value = members?.[key];
  if (typeof value === "boolean") return value;
  const text = memberText(members, key)?.trim().toLowerCase();
  if (text === undefined || text === "") return undefined;
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

/** One member read as an amount: a whole non-negative number of minor units, or `undefined`. Every
 * price, total and quantity a request carries has to pass this. */
export function memberAmount(members: RequestMembers | undefined, key: string): number | undefined {
  const value = members?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** One member read as an object with named members, or `undefined`. */
export function memberObject(
  members: RequestMembers | undefined,
  key: string,
): RequestMembers | undefined {
  const value = members?.[key];
  return isMembers(value) ? value : undefined;
}

/** One member read as an array of unknown entries, or `undefined`. */
export function memberList(
  members: RequestMembers | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = members?.[key];
  return isList(value) ? value : undefined;
}

/** A `limit` or a count read as a whole number inside `1..ceiling`, defaulting to `fallback`. */
export function readLimit(
  members: RequestMembers,
  key: string,
  fallback: number,
  ceiling: number = MAX_REQUESTED_ROWS,
): number {
  return clampNumber(memberInteger(members, key) ?? fallback, 1, ceiling);
}

// Splitting a path -------------------------------------------------------------------------------

/** A request's query, parsed from its path and merged with whatever the caller passed beside it.
 * Read by the same readers as a body, so a query member and a body member are judged alike. */
export type QueryRecord = RequestMembers;

/** Splits a request path into its pathname and its query, then folds in the query a caller passed
 * beside the path, with the caller's value winning a key both carry. */
export function splitRequest(
  path: string,
  query: Common.QueryParams | undefined,
): { readonly pathname: string; readonly query: QueryRecord } {
  const separator = path.indexOf("?");
  const pathname = separator === -1 ? path : path.slice(0, separator);
  // Prototype-less, so a caller's `__proto__` member reaches no setter and no reader sees it.
  const merged = Object.create(null) as Record<string, unknown>;
  if (separator !== -1) {
    for (const [key, value] of new URLSearchParams(path.slice(separator + 1))) {
      const existing = merged[key];
      if (existing === undefined) merged[key] = value;
      else if (typeof existing === "string") merged[key] = [existing, value];
      else if (isList(existing)) merged[key] = [...existing, value];
    }
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) merged[key] = value;
  }
  return { pathname, query: merged };
}

// Vocabularies -----------------------------------------------------------------------------------

const SORT_KEYS: readonly Catalog.SortKey[] = SORT_OPTIONS.map((option) => option.value);
const ORDER_STATUSES: readonly Commerce.OrderStatus[] = ORDER_STATUS_OPTIONS.map((o) => o.value);
const GRANULARITIES: readonly Analytics.BucketGranularity[] = GRANULARITY_OPTIONS.map(
  (option) => option.value,
);
const BASELINES: readonly Analytics.BaselineKind[] = BASELINE_OPTIONS.map((option) => option.value);
const REPORT_KINDS: readonly Analytics.ReportKind[] = REPORT_DEFINITIONS.map(
  (definition) => definition.kind,
);
/** The two ways a revenue series is split and the two metrics a ranking is ordered by: no option list
 * exists for either, so each is asserted against its union in `src/types/analytics.ts` instead. */
const REVENUE_GROUP_BY_VALUES = [
  "category",
  "channel",
] as const satisfies readonly Analytics.RevenueGroupBy[];
const METRIC_VALUES = ["revenue", "units"] as const satisfies readonly Analytics.Metric[];

/** The rejection wording by code, built from `src/constants/content.ts`'s record rather than restated. */
const PROMO_REJECTION_WORDING: ReadonlyMap<string, string> = new Map(
  Object.entries(PROMO_REJECTION_MESSAGES),
);

/** The wording for each rule a dated range can break: two range sentences, the cap, and the shared
 * required sentence for an absent or unparsable date. */
const RANGE_MESSAGES: Readonly<Record<DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

/** Whether a string is one of a vocabulary's members, preserving the member's type. */
export function isOneOf<TValue extends string>(
  value: string | undefined,
  allowed: readonly TValue[],
): value is TValue {
  return value !== undefined && allowed.some((candidate) => candidate === value);
}

/** One of a vocabulary's members read from a request: `undefined` when absent, the member when it is
 * one, and `null` when the caller sent something else — refused with `422`, naming the member. */
function readVocabulary<TValue extends string>(
  members: RequestMembers,
  key: string,
  allowed: readonly TValue[],
): TValue | null | undefined {
  const text = memberText(members, key)?.trim();
  if (text === undefined || text === "") return undefined;
  return isOneOf(text, allowed) ? text : null;
}

/** One numeric filter member read from a query: `undefined` when absent, the whole number when it is
 * one, and `null` when present but unreadable — which a filter refuses rather than reading as absent. */
function readFilterNumber(query: QueryRecord, key: string): number | null | undefined {
  const text = memberText(query, key)?.trim();
  return text === undefined || text === "" ? undefined : (memberInteger(query, key) ?? null);
}

/** A page and a page size read from a query, the size falling back to the configured default. */
export function readPaging(query: QueryRecord): {
  readonly page: number;
  readonly pageSize: number;
} {
  const page = memberInteger(query, FILTER_PARAMS.PAGE);
  return {
    page: page !== undefined && page > 0 ? page : 1,
    pageSize: normalisePageSize(memberInteger(query, FILTER_PARAMS.PAGE_SIZE)),
  };
}

/** The dated range a query carries, refused by the range rules, a half-given pair included. */
export function readRange(
  query: QueryRecord,
): Common.Result<{ readonly from: string; readonly to: string }> {
  const from = memberText(query, "from")?.trim() ?? "";
  const to = memberText(query, "to")?.trim() ?? "";
  const validation = validateDateRange(from, to);
  return validation.valid
    ? ok({ from, to })
    : invalidFields(toFieldErrors(validation, RANGE_MESSAGES));
}

/** The filter half of a catalogue or facet query, refused when a member is outside the domain it
 * declares. Paging and sort are absent because `GET /api/facets` takes neither. */
export function readFilterFields(query: QueryRecord): Common.Result<Catalog.FacetQuery> {
  const rangeProblem = (field: string) => fieldProblem(field, VALIDATION_MESSAGES.OUT_OF_RANGE);
  const rawRating = readFilterNumber(query, FILTER_PARAMS.MIN_RATING);
  if (rawRating === null) return fieldProblem(FILTER_PARAMS.MIN_RATING);
  const minRating: Catalog.RatingValue | null = isRatingValue(rawRating) ? rawRating : null;
  if (rawRating !== undefined && minRating === null) return rangeProblem(FILTER_PARAMS.MIN_RATING);
  const minPriceMinor = readFilterNumber(query, FILTER_PARAMS.MIN_PRICE);
  if (minPriceMinor === null) return fieldProblem(FILTER_PARAMS.MIN_PRICE);
  const maxPriceMinor = readFilterNumber(query, FILTER_PARAMS.MAX_PRICE);
  if (maxPriceMinor === null) return fieldProblem(FILTER_PARAMS.MAX_PRICE);
  if ((minPriceMinor ?? 0) < 0) return rangeProblem(FILTER_PARAMS.MIN_PRICE);
  if ((maxPriceMinor ?? 0) < 0) return rangeProblem(FILTER_PARAMS.MAX_PRICE);
  // An inverted pair is swapped, not refused, the reading src/utils/queryParams.ts gives the same pair.
  const descending =
    minPriceMinor !== undefined && maxPriceMinor !== undefined && minPriceMinor > maxPriceMinor;
  const inStockOnly = memberBoolean(query, FILTER_PARAMS.IN_STOCK);
  if (inStockOnly === null) return fieldProblem(FILTER_PARAMS.IN_STOCK);
  return ok({
    q: memberText(query, FILTER_PARAMS.QUERY) ?? "",
    categoryIds: memberTextList(query, FILTER_PARAMS.CATEGORY_IDS) as readonly Common.CategoryId[],
    brandIds: memberTextList(query, FILTER_PARAMS.BRAND_IDS) as readonly Common.BrandId[],
    minPriceMinor: descending ? (maxPriceMinor ?? null) : (minPriceMinor ?? null),
    maxPriceMinor: descending ? (minPriceMinor ?? null) : (maxPriceMinor ?? null),
    minRating,
    inStockOnly: inStockOnly ?? false,
    tags: memberTextList(query, FILTER_PARAMS.TAGS),
  });
}

/** A listing's whole query: the filter half, the sort — relevance with a term — and the page. */
export function readFilterState(query: QueryRecord): Common.Result<Catalog.FilterState> {
  const fields = readFilterFields(query);
  if (!fields.ok) return fields;
  const sort = readVocabulary(query, FILTER_PARAMS.SORT, SORT_KEYS);
  if (sort === null) return fieldProblem(FILTER_PARAMS.SORT);
  return ok({ ...fields.value, ...readPaging(query), sort: sort ?? "relevance" });
}

/** The window an order history filters on: absent ends stay absent, a half-given pair is refused. */
function readOptionalRange(
  query: QueryRecord,
): Common.Result<{ readonly from?: string; readonly to?: string }> {
  const from = memberText(query, "from");
  const to = memberText(query, "to");
  if (from === undefined && to === undefined) return ok({});
  const range = readRange(query);
  return range.ok ? ok({ from: range.value.from, to: range.value.to }) : range;
}

/** The filters and paging of a customer's own orders, with the session's customer injected: the
 * endpoint takes no customer id, so ownership follows the token a request carried. */
export function readOrderHistory(
  query: QueryRecord,
  customerId: Common.CustomerId,
): Common.Result<CustomerOrderQuery> {
  const status = readVocabulary(query, "status", ORDER_STATUSES);
  if (status === null) return fieldProblem("status");
  const range = readOptionalRange(query);
  if (!range.ok) return range;
  return ok({ ...readPaging(query), customerId, status, ...range.value });
}

/** The range and cut a KPI request carries, with the comparison baseline it names rather than implies. */
export function readAnalyticsQuery(query: QueryRecord): Common.Result<Analytics.AnalyticsQuery> {
  const range = readRange(query);
  if (!range.ok) return range;
  const bucket = readVocabulary(query, "bucket", GRANULARITIES);
  if (bucket === null) return fieldProblem("bucket");
  const baseline = readVocabulary(query, "baseline", BASELINES);
  if (baseline === null) return fieldProblem("baseline");
  return ok({ ...range.value, bucket, baseline });
}

/** The parameters of a revenue series: the shared range plus how the series is split. */
export function readRevenueQuery(query: QueryRecord): Common.Result<Analytics.RevenueQuery> {
  const analytics = readAnalyticsQuery(query);
  if (!analytics.ok) return analytics;
  const groupBy = readVocabulary(query, "groupBy", REVENUE_GROUP_BY_VALUES);
  if (groupBy === null) return fieldProblem("groupBy");
  return ok({ ...analytics.value, groupBy });
}

/** The report a request runs: the range and the cut. A `baseline` is outside a report's parameters
 * and is not read, because no report states a change against one. */
export function readReportQuery(query: QueryRecord): Common.Result<Analytics.ReportQuery> {
  const analytics = readAnalyticsQuery(query);
  if (!analytics.ok) return analytics;
  return ok({
    from: analytics.value.from,
    to: analytics.value.to,
    bucket: analytics.value.bucket,
  });
}

/** The parameters of a top-products ranking: its range, how many products and which metric ranks them. */
export function readTopProductsQuery(
  query: QueryRecord,
): Common.Result<Analytics.TopProductsQuery> {
  const range = readRange(query);
  if (!range.ok) return range;
  const metric = readVocabulary(query, "metric", METRIC_VALUES);
  if (metric === null) return fieldProblem("metric");
  const limit = memberInteger(query, "limit");
  return ok({
    ...range.value,
    metric,
    limit: limit === undefined ? undefined : clampNumber(limit, 1, MAX_REQUESTED_ROWS),
  });
}

/** The report a `:kind` segment names, or `null` for a kind no definition declares. */
export function readReportKind(kind: string): Analytics.ReportKind | null {
  return isOneOf(kind, REPORT_KINDS) ? kind : null;
}

// Reading a body and settling a payment ---------------------------------------------------------

/** The review a body carries, as the review rule judges it: the rating only when it is one of the
 * five, and `title` and `body` as the empty string when absent, which the rule reports as required. */
export function readReviewDraft(members: RequestMembers | undefined): ReviewDraft {
  const rating = memberValue(members, "rating");
  return {
    rating: isRatingValue(rating) ? rating : undefined,
    title: memberTextOrEmpty(members, "title"),
    body: memberTextOrEmpty(members, "body"),
  };
}

/** The sign-in body, or `undefined` when either member is absent rather than text. */
export function readCredentials(
  members: RequestMembers | undefined,
): Account.Credentials | undefined {
  const email = memberText(members, "email");
  const password = memberText(members, "password");
  return email === undefined || password === undefined ? undefined : { email, password };
}

/** The registration body. A consent flag nobody can read is read as no consent, the safe reading of a
 * boolean; the password is never stored in clear. */
export function readRegistration(members: RequestMembers | undefined): Account.RegistrationInput {
  return {
    email: memberTextOrEmpty(members, "email"),
    password: memberTextOrEmpty(members, "password"),
    firstName: memberTextOrEmpty(members, "firstName"),
    lastName: memberTextOrEmpty(members, "lastName"),
    marketingOptIn: memberBoolean(members, "marketingOptIn") ?? false,
  };
}

/** The editable profile members a body carries, read for `validateProfileUpdate` to judge. */
export function readProfileUpdate(members: RequestMembers | undefined): Account.ProfileUpdateInput {
  return {
    firstName: memberTextOrEmpty(members, "firstName"),
    lastName: memberTextOrEmpty(members, "lastName"),
    phone: memberTextOrEmpty(members, "phone"),
    marketingOptIn: memberBoolean(members, "marketingOptIn") ?? false,
  };
}

/** The address a body carries: a missing member reads as the empty string, which the address rule
 * reports as required, so a half-filled address is refused rather than stored. */
export function readAddressInput(members: RequestMembers | undefined): Account.AddressInput {
  return {
    label: memberTextOrEmpty(members, "label"),
    fullName: memberTextOrEmpty(members, "fullName"),
    line1: memberTextOrEmpty(members, "line1"),
    line2: memberTextOrEmpty(members, "line2"),
    city: memberTextOrEmpty(members, "city"),
    region: memberTextOrEmpty(members, "region"),
    postalCode: memberTextOrEmpty(members, "postalCode"),
    country: memberTextOrEmpty(members, "country"),
    phone: memberTextOrEmpty(members, "phone"),
  };
}

/** Which default a set-default request nominates, or `null` for anything but the two kinds. */
export function readAddressKind(members: RequestMembers | undefined): Account.AddressKind | null {
  const kind = memberText(members, "kind");
  return kind === "shipping" || kind === "billing" ? kind : null;
}

/** The payment a checkout body carries, in the shape the payment rule judges: an invoice is taken as
 * submitted and a card member by member, each expiry half as the number or as the typed digits. */
export function readPaymentInput(
  members: RequestMembers | undefined,
): PaymentValidationInput | undefined {
  const method = memberText(members, "method");
  if (method === "invoice") return { method };
  if (method !== "card") return undefined;
  const card = memberObject(members, "card");
  return {
    method: "card",
    card: {
      number: memberTextOrEmpty(card, "number"),
      nameOnCard: memberTextOrEmpty(card, "nameOnCard"),
      expiryMonth: memberTextOrEmpty(card, "expiryMonth"),
      expiryYear: memberTextOrEmpty(card, "expiryYear"),
      cvc: memberTextOrEmpty(card, "cvc"),
    },
  };
}

/** One cart line as a body carries it, or `undefined` when a member is missing or not usable. */
function readLine(value: unknown): Commerce.CartLine | undefined {
  const members = isMembers(value) ? value : undefined;
  const id = memberText(members, "id");
  const productId = memberText(members, "productId");
  const sku = memberText(members, "sku");
  const name = memberText(members, "name");
  const imageUrl = memberText(members, "imageUrl");
  const addedAt = memberText(members, "addedAt");
  const unitPriceMinor = memberAmount(members, "unitPriceMinor");
  const quantity = memberAmount(members, "quantity");
  const maxQuantity = memberAmount(members, "maxQuantity");
  const identified =
    id !== undefined &&
    productId !== undefined &&
    sku !== undefined &&
    name !== undefined &&
    imageUrl !== undefined &&
    addedAt !== undefined &&
    unitPriceMinor !== undefined;
  if (!identified || quantity === undefined || maxQuantity === undefined) return undefined;
  // The instant is judged by the cart guard's own ISO rule, so an unusable one is refused here.
  if (!isValidIso(addedAt)) return undefined;
  if (quantity < 1 || maxQuantity < 1) return undefined;
  return {
    id: id as Common.LineId,
    productId: productId as Common.ProductId,
    sku,
    name,
    unitPriceMinor,
    quantity,
    maxQuantity,
    imageUrl,
    addedAt,
  };
}

/** The lines a request carries: an absent, empty or non-list member reports as missing, a supplied
 * line takes the unsupported-value sentence, an over-ceiling one `insufficient-stock` instead. */
export function readCartLines(value: unknown): Common.Result<readonly Commerce.CartLine[]> {
  if (!isList(value)) return fieldProblem("lines", VALIDATION_MESSAGES.REQUIRED);
  const lines: Commerce.CartLine[] = [];
  for (const raw of value) {
    const line = readLine(raw);
    if (line === undefined) return fieldProblem("lines");
    if (line.quantity > line.maxQuantity) {
      return failure(
        API_ERROR_CODES.INSUFFICIENT_STOCK,
        quantityRangeMessage(line.maxQuantity),
        "lines",
      );
    }
    lines.push(line);
  }
  return lines.length === 0 ? fieldProblem("lines", VALIDATION_MESSAGES.REQUIRED) : ok(lines);
}

/** The money members a submitted snapshot has to carry, and the amounts each of its lines owns. */
const SNAPSHOT_AMOUNT_KEYS = [
  "subtotalMinor",
  "discountTotalMinor",
  "shippingMinor",
  "taxMinor",
  "grandTotalMinor",
  "freeShippingRemainingMinor",
] as const;
const LINE_AMOUNT_KEYS = [
  "unitPriceMinor",
  "lineSubtotalMinor",
  "discountMinor",
  "lineTotalMinor",
] as const;

/** The priced cart an order is built from, or `undefined` when it is not usable. Every amount is
 * checked and every line read by the shared cart-line reader, but the totals pass on as submitted: an
 * order keeps the amounts the buyer reviewed, which stops a later price change from moving it. */
export function readOrderSnapshot(value: unknown): Commerce.OrderSnapshot | undefined {
  if (!isMembers(value)) return undefined;
  if (!SNAPSHOT_AMOUNT_KEYS.every((key) => memberAmount(value, key) !== undefined))
    return undefined;
  const lines = memberList(value, "lines");
  if (lines === undefined || lines.length === 0) return undefined;
  for (const raw of lines) {
    const line = isMembers(raw) ? raw : undefined;
    if (line === undefined) return undefined;
    if (!LINE_AMOUNT_KEYS.every((key) => memberAmount(line, key) !== undefined)) return undefined;
    if (readLine(line) === undefined) return undefined;
  }
  // The checks above have established every member this assertion states: the totals as whole minor
  // units, the lines by the shared cart-line rule.
  return value as unknown as Commerce.OrderSnapshot;
}

/** The wording for a promo rejection the pricing rules reported, or `undefined` when the failure is not
 * one of the eight reasons: the map above, keyed by the record `src/constants/content.ts` holds. */
export function promoRejectionWording(code: string): string | undefined {
  return PROMO_REJECTION_WORDING.get(code);
}
