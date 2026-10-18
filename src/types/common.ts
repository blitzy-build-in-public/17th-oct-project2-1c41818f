/**
 * Path: src/types/common.ts
 * Purpose: Shared primitives: money units, currency, paging, results, API errors, async status and option types
 * Lines: 296
 */

// Money, currency and time ---------------------------------------------------------------------

/**
 * An integer number of minor units — cents — of the product's single currency. Never a float and
 * never the result of decimal arithmetic: every price, subtotal, discount, shipping charge, tax
 * amount and total carries this type, so no total can drift through binary floating-point error.
 * Minor units are formatted for display only at the edge, by `src/utils/format.ts`, which owns the
 * single rounding rule for them.
 */
export type MinorUnits = number;

/**
 * ISO 4217 code of the currency every amount in the product is expressed in. SalesPro prices in
 * one currency, so this is a literal rather than a union, and `src/utils/format.ts` is the only
 * module that renders the code.
 */
export type CurrencyCode = "USD";

/**
 * A calendar date as an ISO 8601 string (`YYYY-MM-DD`), parsed, formatted and bucketed only
 * through `src/utils/dates.ts` so that every date decision has one home.
 */
export type IsoDateString = string;

/**
 * An instant as an ISO 8601 date-time string in the visitor's local time: the shape of every
 * timestamp the product records or displays, parsed only through `src/utils/dates.ts`.
 */
export type IsoDateTimeString = string;

/**
 * A closed date range, inclusive of both ends: the shape the dashboard, the three reports, the
 * range picker and the persisted last-used range pass around. It carries no bucket or granularity,
 * because bucketing belongs to the query that reads the range, so the same range can be
 * re-bucketed without changing.
 */
export interface DateRange {
  readonly from: IsoDateString;
  readonly to: IsoDateString;
}

// Async and results ----------------------------------------------------------------------------

/**
 * The lifecycle of one asynchronous request, from its first render to its settled outcome: `idle`
 * before anything is asked for, `loading` while a skeleton stands in, `success` for the payload or
 * its empty state, and `error` for the failure with its retry action.
 */
export type AsyncStatus = "idle" | "loading" | "success" | "error";

/**
 * The one shape an asynchronous request's lifecycle takes.
 *
 * `data` is non-null only in the `success` state and `error` only in the `error` state; the other
 * field is null there. Both are nullable rather than optional so that a consumer never has to
 * distinguish "absent" from "loaded but empty".
 */
export interface AsyncState<TData> {
  readonly status: AsyncStatus;
  readonly data: TData | null;
  readonly error: ApiError | null;
}

/**
 * A failed request, shaped once at the API seam and surfaced unchanged by every service and page.
 *
 * `status` is the HTTP-shaped status the data layer answers with — 401 unauthenticated, 402 card
 * declined, 403 forbidden, 404 unknown, 409 conflict, 422 validation, 503 no data source bound.
 * `code` is the stable machine-readable reason a caller may branch on, owned by the data layer
 * rather than enumerated here; `"data-source-unavailable"` is the one every page can meet, because
 * it is what a request returns before the seeded source has been bound. `field` names the
 * offending input when the failure belongs to a form field, and is absent otherwise.
 */
export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

/**
 * The outcome of a request: a value on success, an `ApiError` on failure.
 *
 * Failures are values rather than exceptions thrown across the API seam, so no page needs a
 * try/catch around a data call: consumers narrow on `ok`, which is what keeps a failed request
 * rendering an error state instead of crashing the route.
 */
export type Result<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: ApiError };

/**
 * Validation errors keyed by the name of the field that produced them.
 *
 * Every validator in `src/utils/validation.ts` returns this shape and every form renders it. The
 * map is mutable so that a validator can build it a field at a time; an absent key means the field
 * is valid, and a failure belonging to no single field is carried by `ApiError` instead.
 */
export type FieldErrors = Record<string, string>;

// Paging and collections -----------------------------------------------------------------------

/**
 * One page of a paged collection, returned by every listing endpoint and consumed by the shared
 * table and pagination control.
 *
 * `page` is 1-based, `pageSize` is one of the configured sizes in `src/constants/config.ts`
 * (12, 24 or 48), and `pageCount` is how many pages the collection fills at that size, never below
 * `1` — an empty collection is one empty page, and `total` is what reports nothing to show. `hasNext`
 * and `hasPrevious` follow from those two, derived by the service that builds the page, so a consumer
 * reads them instead of recomputing them, and no two surfaces can disagree about a next page.
 */
export interface PageResult<TItem> {
  readonly items: TItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
}

/**
 * A response that returns a collection with nothing to page over.
 *
 * Named `items` so that a consumer reaches into a response the same way whichever wrapper it
 * holds, and kept distinct from `PageResult` so an unlisted collection cannot be mistaken for a
 * truncated one.
 */
export interface CollectionResponse<TItem> {
  readonly items: TItem[];
}

// Options and sorting --------------------------------------------------------------------------

/**
 * One option in a select, a radio group or a filter list: the value that is stored and the label
 * the shopper reads.
 *
 * The value is a string by default so that it round-trips through a query parameter unchanged; a
 * caller holding a literal union passes it as the type argument to keep the union's narrowing.
 */
export interface SelectOption<TValue extends string = string> {
  readonly value: TValue;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * Options gathered under a heading, as a grouped select or a sectioned facet panel renders them.
 * An empty group is valid: the surface renders its heading with the empty state it chooses.
 */
export interface OptionGroup<TValue extends string = string> {
  readonly label: string;
  readonly options: readonly SelectOption<TValue>[];
}

/**
 * The direction of a sort, as the sort control writes it to the URL and the listing services apply
 * it.
 */
export type SortDirection = "asc" | "desc";

// Transport ------------------------------------------------------------------------------------

/**
 * The HTTP methods the internal API routes: `GET` to read, `POST` to create, `PATCH` to update
 * partially and `DELETE` to remove. Deliberately not the whole verb set, because nothing else is
 * handled.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * A request's query object, as a service hands it to the API seam, with a list value serialising
 * as a repeated parameter.
 *
 * This is the request-side shape only: reading and writing the browser's own query string is a
 * separate concern, owned by the module that works on `URLSearchParams`.
 */
export type QueryParams = Readonly<
  Record<string, string | number | boolean | readonly string[] | undefined>
>;

/**
 * Everything a request may carry besides its path, as the single request seam accepts it.
 *
 * `method` defaults to `"GET"` at the seam. `signal` is the abort path that cancels a request a
 * newer one supersedes — type-ahead suggestions use it on every keystroke — and it is how any
 * request that can outlive its component is stopped. `sessionToken` becomes the session header and
 * is absent for anonymous requests; it stays a plain string here so that no caller has to brand
 * the token it was handed. `orderToken` becomes the order header on the one read that asks for an
 * order placed without an account, and is absent everywhere else.
 */
export interface ApiRequestOptions<TBody = unknown> {
  readonly method?: HttpMethod;
  readonly query?: QueryParams;
  readonly body?: TBody;
  readonly signal?: AbortSignal;
  readonly sessionToken?: string;
  /**
   * The credential a client holds for an account-less order it placed, sent as the `x-order-token`
   * header and read by the seam when it decides whether a caller may read that order. Absent for
   * every request that asks for nothing of the kind, and a plain string, so no caller has to brand
   * it.
   */
  readonly orderToken?: string;
}

// Identity -------------------------------------------------------------------------------------

/**
 * The phantom key that carries an identifier's brand. Declared ambient, so it is fully erased and
 * contributes nothing at runtime; it exists only so that the identifier aliases below are nominal
 * types rather than bare strings.
 */
declare const brand: unique symbol;

/**
 * Nominal-typing helper: a value type tagged with the prefix that identifies what it names.
 *
 * The brand is phantom — it adds no runtime property and costs nothing — and it makes an
 * unprefixed string fail to type-check where an identifier is expected, so a product id cannot be
 * passed where an order id belongs. The generators in `src/utils/strings.ts` are a brand's only
 * producers; a hand-built identifier in a fixture or a seed is asserted with a single `as` cast,
 * and that cast is the visible signal that the value did not come from a generator.
 */
export type Brand<TValue, TBrand extends string> = TValue & { readonly [brand]: TBrand };

/** Product identifier, prefixed `prod_`. */
export type ProductId = Brand<string, "prod_">;

/** Category identifier, prefixed `cat_`. */
export type CategoryId = Brand<string, "cat_">;

/** Brand identifier, prefixed `brd_`. */
export type BrandId = Brand<string, "brd_">;

/** Customer identifier, prefixed `cus_`. */
export type CustomerId = Brand<string, "cus_">;

/** Address identifier, prefixed `adr_`. */
export type AddressId = Brand<string, "adr_">;

/** Order identifier, prefixed `ord_`. */
export type OrderId = Brand<string, "ord_">;

/** Line identifier, prefixed `line_`, shared by cart lines and the order lines built from them. */
export type LineId = Brand<string, "line_">;

/** Review identifier, prefixed `rev_`. */
export type ReviewId = Brand<string, "rev_">;

/** Promo code identifier, prefixed `prom_`. */
export type PromoCodeId = Brand<string, "prom_">;

/** Session token, prefixed `ses_`, issued at sign-in and sent on every authenticated request. */
export type SessionToken = Brand<string, "ses_">;

// Notifications --------------------------------------------------------------------------------

/**
 * The three registers a transient outcome can be reported in: an action that
 * completed, an action that failed, and a neutral note.
 *
 * A string union rather than an `enum`, because the compiler runs with
 * `erasableSyntaxOnly`, which forbids syntax it cannot erase.
 */
export type ToastKind = "success" | "error" | "info";

/**
 * One queued notification, complete enough for the viewport to render as it
 * stands.
 *
 * `durationMs` is the queue's duration policy for this message: the viewport's
 * timer honours it, while the behaviour around that timer — pausing while the
 * pointer or the keyboard focus rests on the item, and then asking the queue to
 * remove it — belongs to the viewport.
 */
export interface ToastMessage {
  /** Stable handle for this message: handed out by `notify`, accepted by `dismiss`. */
  readonly id: number;
  /** Which register the message is reported in. */
  readonly kind: ToastKind;
  /** The message text, supplied by the caller and never composed here. */
  readonly message: string;
  /** Short heading rendered above the message when the caller supplies one. */
  readonly title?: string;
  /** How long the message may stay on screen, in milliseconds. */
  readonly durationMs: number;
}
