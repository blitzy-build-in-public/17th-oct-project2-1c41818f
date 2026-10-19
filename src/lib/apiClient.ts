/**
 * Path: src/lib/apiClient.ts
 * Purpose: The single transport seam: one typed request function with latency, abort, error shaping and a test double
 * Lines: 486
 */

import type { ApiError, ApiRequestOptions, HttpMethod, QueryParams, Result } from "@/types/common";

import { isSessionRefusal } from "@/lib/apiContract";
import {
  API_PATHS,
  FALLBACK_FAILURE_MESSAGE,
  createAbortError,
  delay,
  getApiLatencyMs,
  handleRequest,
  isAbortError,
  resetMockServer,
} from "@/lib/mockServer";

// The transport's own failures --------------------------------------------------------------------

/**
 * The three failures the transport decides for itself, kept apart from the seam's own vocabulary
 * because none of them is an endpoint's answer: a request that never reached one, or one whose
 * outcome never became a `Result`.
 *
 * Their `status` follows the same convention as the seam's: `499` marks a request that was superseded
 * rather than failed, `400` marks a target the transport refuses to dispatch, and `500` marks
 * anything else that went wrong before the seam answered.
 */
const TRANSPORT_FAILURES = {
  /** `options.signal` was aborted: a newer request replaced this one, so a page shows no error. */
  REQUEST_ABORTED: { status: 499, code: "request-aborted" },
  /** The target is not a path — empty, or a scheme and host rather than a path this seam serves. */
  INVALID_REQUEST_PATH: { status: 400, code: "invalid-request-path" },
  /** The dispatcher threw, or settled with something that is not a `Result`. */
  UNEXPECTED_ERROR: { status: 500, code: "unexpected-error" },
} as const;

/** One of the transport's own failures, named by its key in {@link TRANSPORT_FAILURES}. */
type TransportFailureKind = keyof typeof TRANSPORT_FAILURES;

/** Shapes one of the transport's own failures, worded by the sentence the seam publishes so no sentence
 * is written here and every surface that renders it reads the same. */
function transportFailure(kind: TransportFailureKind): ApiError {
  const { status, code } = TRANSPORT_FAILURES[kind];
  return { status, code, message: FALLBACK_FAILURE_MESSAGE };
}

// Request targets ---------------------------------------------------------------------------------

/** The method a request carries when its caller names none. */
const DEFAULT_HTTP_METHOD: HttpMethod = "GET";

/**
 * Whether a target is a path this transport can dispatch: a non-empty string beginning with a single
 * `/`.
 *
 * A scheme and host (`https://example.test/api/products`), a protocol-relative target
 * (`//example.test/api/products`) and an empty string are all refused instead of being handed to the
 * seam as though they named an endpoint, so a mistyped call fails as a mistyped call rather than as a
 * route that does not exist.
 */
function isServablePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Whether a query member is a list value, narrowed to the string list rather than to `any[]` so the
 * serialiser keeps the element type it repeats the key for. */
function isListMember(member: unknown): member is readonly string[] {
  return Array.isArray(member);
}

/**
 * Serialises a query object into a search string: keys sorted, `undefined` members dropped, an array
 * member repeated once per entry, and every key and value percent-encoded.
 *
 * Deterministic by construction, so two callers holding equal parameters build the identical string
 * and a unit test can compare strings rather than parameters: keys sort by code unit, the entries of
 * one key keep the order the caller gave them, a member holding an empty string is kept while one
 * holding `undefined` is absent, and a list member with no entries contributes no parameter at all.
 * The result carries no leading `?`, and an empty string means there is nothing to append.
 *
 * This is the one place a request's parameters become text, so what the wrappers below send is
 * exactly what a caller handed them — and what a real client would put on the wire.
 *
 * @param query - The request's query members, as a service holds them.
 * @returns The query string, without a leading `?`.
 */
export function buildQueryString(query: QueryParams): string {
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const member = query[key];
    if (member === undefined) continue;
    if (isListMember(member)) {
      for (const entry of member) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(entry)}`);
      }
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(member))}`);
  }
  return parts.join("&");
}

/** The separator that joins a serialised query onto a path: nothing when the path already ends where a
 * query would begin, `&` when it already carries one, and `?` otherwise. */
function pathSeparatorFor(path: string): string {
  if (!path.includes("?")) return "?";
  return path.endsWith("?") || path.endsWith("&") ? "" : "&";
}

/**
 * Builds the target a request is dispatched with: its path with the serialised query appended, so a
 * path a caller already built complete (`/api/products?page=2`) is extended rather than broken by a
 * second separator.
 */
function resolveRequestTarget(path: string, query: QueryParams | undefined): string {
  const search = query === undefined ? "" : buildQueryString(query);
  if (search === "") return path;
  return `${path}${pathSeparatorFor(path)}${search}`;
}

/**
 * The options the dispatcher is handed: the resolved method with the query, body, session token,
 * order token and signal passed through.
 *
 * The query travels twice on purpose. It is in the target, so the request the seam answers is the
 * request a real client would send and the transport keeps one record of it; it is also in the
 * options, so the seam reads each member in the type its caller gave it — a number stays a number for
 * a route that reads an amount — instead of the string the URL can only carry.
 *
 * Every member a caller may set is carried over, which is why the list is written out here rather
 * than spread: a request reaches the seam with exactly the members this function names, so a member
 * `src/types/common.ts` adds is passed on only once it is added below — dropping `orderToken` here
 * would leave the order-detail read unable to present the credential of an order it placed.
 */
function dispatcherOptions(options: ApiRequestOptions): ApiRequestOptions {
  return {
    method: options.method ?? DEFAULT_HTTP_METHOD,
    query: options.query,
    body: options.body,
    sessionToken: options.sessionToken,
    orderToken: options.orderToken,
    signal: options.signal,
  };
}

// Shaping a failure -------------------------------------------------------------------------------

/** Reports whether a caught value already carries the `ApiError` fields, so a failure the seam or the
 * data source raised is passed through with its code and `field` intact rather than reworded. */
function isApiErrorShape(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ApiError>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

/** Reports whether a settled value is a `Result`, so an answer that is not one is reported as a
 * transport failure rather than handed to a page as though it were a payload. */
function isResultOf<TValue>(value: unknown): value is Result<TValue> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly ok?: unknown; readonly error?: unknown };
  if (candidate.ok === true) return "value" in value;
  if (candidate.ok === false) return isApiErrorShape(candidate.error);
  return false;
}

/** The failure branch of a `Result`, so a refused request reads as one line wherever it is refused. */
function refuse(error: ApiError): Result<never> {
  return { ok: false, error };
}

/**
 * Shapes anything a request can go wrong with into the `ApiError` a page renders: the single place a
 * failure is given a status, a code and a message, and the function a unit test asserts that mapping
 * through without binding a data source or standing in for the seam.
 *
 * The order of the checks decides what wins. A cancellation is reported as one whatever the target
 * was, so a superseded request is never mistaken for a failure. A value that already carries the
 * `ApiError` fields — the shape the seam and the data source raise — is returned unchanged, `field`
 * included, which is what lets a form place a server-side failure on the control that caused it. A
 * target the transport could not dispatch is a `400`, because the caller handed over a URL rather
 * than a path. Everything else is the transport's `500`, worded by the sentence the seam publishes
 * rather than by one written here.
 *
 * @param cause - What went wrong: the value a request threw, the value the dispatcher settled with
 * instead of a `Result`, or `null` when the transport refused the target before dispatching anything.
 * @param path - The target the failure belongs to, which decides whether the target itself is the
 * problem.
 * @returns The shaped failure; never `null`, never an exception.
 */
export function toApiError(cause: unknown, path: string): ApiError {
  if (isAbortError(cause)) return transportFailure("REQUEST_ABORTED");
  if (isApiErrorShape(cause)) return cause;
  if (!isServablePath(path)) return transportFailure("INVALID_REQUEST_PATH");
  return transportFailure("UNEXPECTED_ERROR");
}

// Reporting a refusal to whoever holds the session -------------------------------------------------

/**
 * The listeners a refusal is reported to, in subscription order.
 *
 * The subscription lives here because this is the only module that sees every request's answer: a page's
 * own read and the session's own revalidation both pass through {@link request}, so the module holding
 * the session learns of a refusal without a feature slice having to reach across for it. A client of a
 * real server puts the same reporting in one HTTP interceptor, which is the shape this keeps.
 */
const sessionRefusalListeners = new Set<(error: ApiError) => void>();

/**
 * Subscribes to the refusals the transport meets: the listener is called with the failure of every
 * request that resolved `session-expired` or `session-unknown`, so the module that holds the session can
 * confirm the refusal with the store and sign the visitor out when it stands.
 *
 * The transport reports and decides nothing. It holds no session and no opinion about who the visitor
 * is, so the sign-out decision stays in one place (`src/state/AuthContext.tsx`) rather than being taken
 * wherever a request happens to be sent from.
 *
 * @param listener - Called with the refusal's failure, once per refused request. Nothing else travels:
 *   the request's path, body and payload say nothing about the session.
 * @returns The unsubscribe function, so a caller that unmounts stops listening.
 */
export function watchSessionRefusals(listener: (error: ApiError) => void): () => void {
  sessionRefusalListeners.add(listener);
  return (): void => {
    sessionRefusalListeners.delete(listener);
  };
}

/** The path of a target without its query string, which is the form a path comparison has to read. */
function pathnameOf(path: string): string {
  const separator = path.indexOf("?");
  return separator === -1 ? path : path.slice(0, separator);
}

/**
 * Reports a refusal to {@link watchSessionRefusals}' subscribers and returns the outcome it was given,
 * so each settle path of {@link request} tails one call with `return`.
 *
 * One request is deliberately not reported: the session endpoint's own read. That read is the session's
 * holder asking the store for its verdict, so reporting it back would be the holder answering itself,
 * and a listener that revalidates on a refusal would answer with the very refused read it was told
 * about, for ever.
 *
 * @param path - The request's target as the caller wrote it; only its pathname is compared.
 * @param outcome - What the request resolved to, returned unchanged and reported when it is a refusal.
 * @returns The same outcome, so a caller needs no second look at it.
 */
function reportSessionRefusal<TValue>(path: string, outcome: Result<TValue>): Result<TValue> {
  if (outcome.ok) return outcome;
  if (!isSessionRefusal(outcome.error)) return outcome;
  if (pathnameOf(path) === API_PATHS.AUTH_SESSION) return outcome;
  for (const listener of sessionRefusalListeners) listener(outcome.error);
  return outcome;
}

/**
 * Shapes the failure a rejected promise is reported as: the one home of it, so a caller that awaits a
 * promise directly instead of reading a `Result` has no reason to form the error itself, and the state
 * layers that catch one report it in the vocabulary this file owns.
 *
 * A rejection is a case the shipped transport leaves to its caller's defensive branch. Everything
 * {@link request} dispatches is resolved as a value — the dispatcher's throw and every refusal the seam
 * reports alike — so this is reached only where a caller awaits something the transport did not resolve
 * itself, and it is what keeps such a rejection from leaving a surface loading forever.
 *
 * It reports the transport's own `500 unexpected-error`, the failure of a request that reached no
 * endpoint, because no endpoint refused it, and takes it from {@link transportFailure} so the
 * sentence it carries is the one the seam publishes: a surface renders that `message` verbatim —
 * `src/components/ui/Feedback.tsx`, and the state layers that pass a failure into it — because a
 * runtime exception's own message is a framework's account of itself, not copy a shopper can read.
 *
 * The cause is therefore taken for the caller's shape and never read: the parameter documents what a
 * caller passes through, and nothing of it reaches the failure.
 *
 * @param _cause - What the rejected promise reported: the value it rejected with, deliberately unread
 * because no part of a runtime exception belongs on a rendered surface.
 * @returns The shaped failure, in the fields a refused request carries; never `null`, never an exception.
 */
export function toRejectionError(_cause: unknown): ApiError {
  return transportFailure("UNEXPECTED_ERROR");
}

// The request pipeline ----------------------------------------------------------------------------

/**
 * Sends one request and reports its outcome as a value: the one function every read and every write in
 * the product passes through, whichever module asked for it.
 *
 * Failures are values and never exceptions, which is what lets a page leave out a `try`/`catch` around
 * a data call. An invalid target, a dispatcher that threw, an answer that is not a `Result` and every
 * failure the seam reports all resolve to `{ ok: false, error }`, so nothing thrown escapes this
 * function: no rejection is left unhandled and no failure is swallowed.
 *
 * Two requests are refused before the seam sees them — a target that is not a path, and a signal that
 * has already aborted, which is answered with `request-aborted` (`499`). A caller treats that code as
 * a superseded request and renders no error, because the newer request owns the state from there.
 *
 * The configured simulator latency is waited out here, once, from the value the seam publishes, before
 * the seam is asked for an answer. A request cancelled while that wait is pending resolves to
 * `request-aborted` (`499`) like any other supersession and never rejects, because the wait's abort
 * error is shaped back into a value by the catch below.
 *
 * A refusal the store answered with — `session-expired` or `session-unknown` — is reported to every
 * listener subscribed through {@link watchSessionRefusals} before it is returned, so whoever holds the
 * session learns that the credential a request carried is no longer accepted. The report is one-way and
 * the outcome is handed back untouched, so a caller branches on the same `Result` it would have received
 * anyway. The session endpoint's own read is the one exception, for the reason {@link reportSessionRefusal}
 * states.
 *
 * Two things deliberately do not live here: the domain rules of filtering, faceting, searching,
 * pricing, ordering, aggregation and reporting, each of which has one home in a service of this folder;
 * and any queue, retry or cache, because a caller that needs to supersede a request cancels it through
 * the abort signal, and the views bound how many requests they keep in flight.
 *
 * @param path - The request path, with or without a query string of its own.
 * @param options - The method, query, body, session token and abort signal. `method` defaults to
 * `GET`, and a query is serialised onto the target as well as passed to the seam.
 * @returns The payload a caller named with `TValue`, or the shaped failure; never a rejection.
 */
export async function request<TValue>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Result<TValue>> {
  if (!isServablePath(path)) return refuse(toApiError(null, path));
  const { signal } = options;
  if (signal?.aborted === true) return refuse(toApiError(createAbortError(), path));
  try {
    await delay(getApiLatencyMs(), signal);
    const settled: unknown = await handleRequest<TValue>(
      resolveRequestTarget(path, options.query),
      dispatcherOptions(options),
    );
    return reportSessionRefusal(
      path,
      isResultOf<TValue>(settled) ? settled : refuse(toApiError(settled, path)),
    );
  } catch (cause: unknown) {
    return reportSessionRefusal(path, refuse(toApiError(cause, path)));
  }
}

// The typed entry points --------------------------------------------------------------------------

/**
 * What a wrapper takes: everything a request may carry except the method and the body, which the
 * wrapper sets itself, so a caller cannot ask for a `POST` through {@link getJson} and cannot pass a
 * body to a method that has none.
 */
type RequestCallOptions = Omit<ApiRequestOptions, "method" | "body">;

/**
 * Reads a resource.
 *
 * @param path - The request path; a query passed in `options` becomes the path's search string.
 * @param options - The query, the session token and the abort signal.
 * @returns The payload a caller named with `TValue`, or the shaped failure.
 */
export function getJson<TValue>(
  path: string,
  options: RequestCallOptions = {},
): Promise<Result<TValue>> {
  return request<TValue>(path, { ...options, method: "GET" });
}

/**
 * Creates a resource from the body given.
 *
 * @param path - The request path; a query passed in `options` becomes the path's search string.
 * @param body - The request body, carried as the caller typed it.
 * @param options - The query, the session token and the abort signal.
 * @returns The payload a caller named with `TValue` — often the created resource — or the failure.
 */
export function postJson<TValue, TBody = unknown>(
  path: string,
  body: TBody,
  options: RequestCallOptions = {},
): Promise<Result<TValue>> {
  return request<TValue>(path, { ...options, body, method: "POST" });
}

/**
 * Updates part of a resource from the body given.
 *
 * @param path - The request path; a query passed in `options` becomes the path's search string.
 * @param body - The members to change, carried as the caller typed them.
 * @param options - The query, the session token and the abort signal.
 * @returns The payload a caller named with `TValue` — often the updated resource — or the failure.
 */
export function patchJson<TValue, TBody = unknown>(
  path: string,
  body: TBody,
  options: RequestCallOptions = {},
): Promise<Result<TValue>> {
  return request<TValue>(path, { ...options, body, method: "PATCH" });
}

/**
 * Removes a resource.
 *
 * @param path - The request path; a query passed in `options` becomes the path's search string.
 * @param options - The query, the session token and the abort signal.
 * @returns The payload a caller named with `TValue` — an empty payload where the seam answers with
 * none — or the shaped failure.
 */
export function deleteJson<TValue>(
  path: string,
  options: RequestCallOptions = {},
): Promise<Result<TValue>> {
  return request<TValue>(path, { ...options, method: "DELETE" });
}

// The seam's published vocabulary -----------------------------------------------------------------

/**
 * The error vocabulary and the reading of it that a domain service or a screen asks for its own refusal,
 * republished from the seam this file dispatches to, so `src/lib/*Service.ts` and `src/features/**` reach
 * both through the one module they already import.
 *
 * The words are the same everywhere by construction: `API_ERROR_CODES` names every machine-readable
 * reason a request can fail, `API_ERROR_STATUS` gives the status each of those codes answers with, and
 * {@link failure}/{@link shapeError} build the `Result` a caller resolves in place of a request that
 * breaks a rule before it is sent. A service therefore refuses a malformed body in exactly the shape
 * the seam refuses the same body with, and no status or code literal is written outside the contract
 * module that owns them.
 *
 * {@link isSessionFailure} and {@link isNotFoundFailure} are the other half of that reading: they answer
 * whether a failure is one a repeat of the request could answer differently, which is what lets a screen
 * offer the action that resolves the state — a sign-in, or the way back — instead of a retry that cannot.
 */
export {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  failure,
  isNotFoundFailure,
  isSessionFailure,
  shapeError,
} from "@/lib/mockServer";

/**
 * Every endpoint path, and the builder that fills one from the values its captured segments take,
 * republished from the seam for the same reason as the vocabulary above: a domain service reads its
 * request target from the one table the route table's patterns also come from, so a path change is a
 * change to that table and to nothing else.
 */
export { API_PATHS, fillApiPath } from "@/lib/mockServer";

// The test double ---------------------------------------------------------------------------------

/**
 * Returns the transport to its unbound state between tests: the injected failures are disarmed and the
 * bound data source is forgotten, so every request answers the seam's `503 data-source-unavailable`
 * until a source is bound again.
 *
 * The name says what a test resets — the client it drives — while the work belongs to the seam the
 * client dispatches to, which is why this delegates rather than keeping state of its own: the
 * transport holds none.
 */
export function resetApiClient(): void {
  resetMockServer();
}

/**
 * The failure-injection controls a test drives, re-exported so this module stays the single seam a
 * suite binds and arms.
 *
 * `failNext` arms the next request matching its matcher to fail instead of being answered, and the arm
 * is consumed by the first request it applies to, so a test can fail exactly one call. A matcher names
 * any of `method`, `path`, `routeId`, `status`, `code`, `message` and `field`; a string `path` must
 * equal the request's path exactly, so a `RegExp` is what matches a family of paths. A matcher that
 * names no path applies to the next request of any kind, and answers `503 data-source-unavailable`
 * unless it names a status of its own.
 *
 * Along with the reset defined above, the three exist for tests only: nothing the application renders
 * calls them, and a product screen has no failure switch a user could reach. Both the integration
 * tests and `tests/testUtils.tsx` reach them through here rather than through the seam's own module,
 * so the seam a test drives and the seam the application calls are the same one.
 */
export { clearInjectedFailures, failNext, type RequestFailureMatcher } from "@/lib/mockServer";
