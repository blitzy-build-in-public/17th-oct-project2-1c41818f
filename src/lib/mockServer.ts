/**
 * Path: src/lib/mockServer.ts
 * Purpose: The in-process API: route table, parsing, sessions, cards, idempotency and failure injection over a registered data source
 * Lines: 508
 */

import { DEFAULT_API_LATENCY_MS } from "@/constants/config";
import { ADMIN_COPY, FEEDBACK_COPY, NOT_FOUND_COPY } from "@/constants/content";
import type * as Account from "@/types/account";
import type * as Common from "@/types/common";
import { createAbortError, delay, isAbortError } from "@/utils/async";
import { parseIso } from "@/utils/dates";

import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  failure,
  shapeError,
  type AuthorizationLevel,
  type RouteContext,
  type RouteDefinition,
  type SalesProDataSource,
} from "@/lib/apiContract";
import { splitRequest } from "@/lib/apiRequests";
import { clearRememberedOrders, routeTable, type RouteId } from "@/lib/apiRoutes";

// The public surface -----------------------------------------------------------------------------
// The seam is one module to its callers: it holds the transport and re-exports every name they
// import — the bound data source, the latency model and failure injection, the session check and the
// dispatcher. `apiContract.ts` carries the error vocabulary and the data-source contract,
// `apiRequests.ts` and `apiRoutes.ts` the endpoints it runs, and `src/lib/apiClient.ts` waits the
// configured latency out once per request before it asks this seam for an answer. The four modules
// measure about 1,833 lines, past the 600-line ceiling, so the concern is split by responsibility
// rather than held in one file, and the split is recorded in `generation-manifest.md` (Part 1 and
// Part 4).

/**
 * The seam's error vocabulary and the shaper that turns one of its codes into a `Result`: the names
 * every machine-readable failure is spelled with, the status each answers with, and the two builders
 * a caller uses instead of writing a status and a code of its own. `src/lib/apiContract.ts` owns them
 * and this file republishes them, so a domain service asks the transport for its refusal — the same
 * vocabulary, the same statuses and the same shape the seam itself answers with.
 */
export { API_ERROR_CODES, API_ERROR_STATUS, failure, shapeError } from "@/lib/apiContract";

/**
 * Every endpoint path, and the builder that fills one of them from the values its captured segments
 * take. Published here for the same reason as the vocabulary above: a domain service builds its
 * request target from the table the route table's patterns come from, so no path literal is written
 * in two places and a path change is a change to one table.
 */
export { API_PATHS, fillApiPath } from "@/lib/apiContract";

/**
 * The neutral sentence every unexpected failure is worded with.
 *
 * `src/constants/content.ts` owns the wording and this file republishes it, so `src/lib/apiClient.ts`
 * reads the sentence through the seam it dispatches to rather than importing the copy module behind
 * it: the transport's own failures and the seam's unreachable-data-source failure say the same thing
 * to a reader, and one module publishes both.
 */
export const FALLBACK_FAILURE_MESSAGE = FEEDBACK_COPY.ERROR_STATE_BODY;

/**
 * The wait that carries the configured simulator latency, the cancellation it settles with, and the
 * predicate that recognises any cancellation — the wait's own error or the platform's `DOMException`.
 *
 * All three are re-exported from `src/utils/async.ts` rather than restated, so an aborted request means
 * one thing in the seam and in the transport above it. `src/lib/apiClient.ts` reads them from here,
 * because the seam is the single module the transport is allowed to depend on: it waits
 * {@link getApiLatencyMs} out through this `delay` before asking the seam for an answer.
 */
export { createAbortError, delay, isAbortError };

export type {
  ApiErrorCode,
  ApiPath,
  CustomerOrderQuery,
  NewProductReviewInput,
  OrderCreationRequest,
  ReportRunQuery,
  SalesProDataSource,
  SignInCredential,
} from "@/lib/apiContract";

/** The header a session token travels in, so the client, the seam and a future server name it once.
 * The in-process seam reads the same value off `ApiRequestOptions.sessionToken`. */
export const SESSION_TOKEN_HEADER = "x-session-token" as const;

// The bound data source --------------------------------------------------------------------------

/** The data source every request is answered from, bound once at the composition root. It is a
 * binding rather than an import, so the transport carries no compile-time dependency on `src/data`
 * and the two can be generated and replaced independently. */
let dataSource: SalesProDataSource | null = null;

/** Binds the data source every request is answered from: called by `src/main.tsx` before the first
 * render and by `tests/testUtils.tsx` for the integration tests. */
export function registerDataSource(source: SalesProDataSource): void {
  dataSource = source;
}

/** Whether a data source has been bound, so a caller can tell "no data yet" from a real failure. */
export function isDataSourceRegistered(): boolean {
  return dataSource !== null;
}

/**
 * Forgets the per-case state a test leaves behind in the seam: the failures armed and not yet consumed
 * ({@link failNext}) and every remembered order key, so a later case is answered by its own request
 * rather than by an earlier case's arm or replayed submission. The bound data source stays bound, which
 * is what lets the test harness's per-case teardown call it between cases of one file: the source every
 * later case is answered from is bound once and must survive that reset. {@link resetMockServer} is the
 * stronger reset, and returns the seam to its unbound state as well.
 */
export function resetMockServerState(): void {
  injectedFailures = [];
  clearRememberedOrders();
}

/** Returns the seam to its unbound state and forgets every injected failure and remembered order key,
 * which is what a test does between cases: until a source is bound again, every request answers
 * `503 data-source-unavailable`. The per-case state has one home, {@link resetMockServerState}. */
export function resetMockServer(): void {
  dataSource = null;
  resetMockServerState();
}

/** The longest delay the host timer applies: `setTimeout` clamps anything above it to roughly a
 * millisecond, so a larger setting would report a delay no request ever waits out. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The only form a configured latency may take: digits alone, so a signed, fractional, exponent,
 * padded or radix-prefixed notation is refused rather than coerced into a number it never meant. */
const LATENCY_PATTERN = /^[0-9]+$/;

/** The value the last warning named, so a page making a hundred requests reports one misconfigured
 * variable once rather than once per read. */
let reportedLatencyValue: string | null = null;

/**
 * The milliseconds a configured latency means, or `null` for a value no delay can be made of: a number
 * only when it is a whole, safe, non-negative integer inside the timer's range, and a string only when
 * it is digits alone — surrounding whitespace aside — within that same range.
 *
 * @param raw - The value `import.meta.env.VITE_API_LATENCY_MS` holds, whatever its type.
 * @returns The delay in milliseconds, or `null` when the value cannot be applied as one.
 */
function parseLatencyValue(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) return null;
    return raw > MAX_TIMER_DELAY_MS ? null : raw;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!LATENCY_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed > MAX_TIMER_DELAY_MS ? null : parsed;
}

/** Reports a set-but-unusable `VITE_API_LATENCY_MS` once per distinct value, naming the variable, the
 * value it holds and the default that takes its place: the developer diagnostic for a misconfiguration
 * that would otherwise surface only as a missing response delay. */
function reportUnusableLatencyValue(raw: unknown): void {
  const shown = typeof raw === "string" ? raw.trim() : String(raw);
  if (shown === reportedLatencyValue) return;
  reportedLatencyValue = shown;
  const message =
    `VITE_API_LATENCY_MS is set to "${shown}", which is not a whole number of ms ` +
    `between 0 and ${MAX_TIMER_DELAY_MS}; using the default of ${DEFAULT_API_LATENCY_MS} ms instead.`;
  console.warn(message);
}

/**
 * The response delay in milliseconds: `VITE_API_LATENCY_MS` when the build or the test environment sets
 * it to a whole number of milliseconds the host timer can apply, and {@link DEFAULT_API_LATENCY_MS}
 * otherwise.
 *
 * The variable is read defensively, because Vite types the environment as an index-signed record and a
 * mistyped value must not silently remove the delay: a value that is absent, blank, unparsable,
 * fractional, signed, written in another notation, negative or above the timer's range falls back to
 * the default rather than disabling the delay or producing `NaN`, which is what keeps
 * `VITE_API_LATENCY_MS=0` the one way to run without waiting. A value that is set and cannot be used is
 * reported once on the console, because nothing else in the product can see a misconfigured build
 * environment.
 *
 * @returns The configured delay in milliseconds, or {@link DEFAULT_API_LATENCY_MS} when the variable is
 * unset or holds a value this build cannot apply; never `NaN`, never negative.
 */
export function getApiLatencyMs(): number {
  const raw = (import.meta.env as { readonly VITE_API_LATENCY_MS?: unknown }).VITE_API_LATENCY_MS;
  if (raw === undefined) return DEFAULT_API_LATENCY_MS;
  const parsed = parseLatencyValue(raw);
  if (parsed !== null) return parsed;
  reportUnusableLatencyValue(raw);
  return DEFAULT_API_LATENCY_MS;
}

// Failure injection ------------------------------------------------------------------------------

/** What an injected failure is armed against, and what it answers with. Every member is optional: an
 * empty matcher arms the next request of any kind. A string `path` must equal the request's pathname
 * exactly; a `RegExp` is tested against it. */
export interface RequestFailureMatcher {
  readonly method?: Common.HttpMethod;
  readonly path?: string | RegExp;
  readonly routeId?: RouteId;
  readonly status?: number;
  readonly code?: string;
  readonly message?: string;
  readonly field?: string;
}

/** The failures armed and not yet consumed, in the order they were armed. */
let injectedFailures: RequestFailureMatcher[] = [];

/** Arms the next request matching `matcher` to fail instead of being answered. The arm is consumed by
 * the first matching request and then disarmed, so a suite can fail exactly one call. */
export function failNext(matcher: RequestFailureMatcher = {}): void {
  injectedFailures.push(matcher);
}

/** Disarms every failure armed and not yet consumed, for a test that changes its mind. */
export function clearInjectedFailures(): void {
  injectedFailures = [];
}

/** The failure an armed matcher answers with. The defaults are what an unreachable data source looks
 * like — `503` and `data-source-unavailable` — because that is the failure every page's error state is
 * written for and the one the empty and error paths of the integration tests exercise. */
function injectedError(matcher: RequestFailureMatcher): Common.ApiError {
  return shapeError(
    matcher.status ?? API_ERROR_STATUS[API_ERROR_CODES.DATA_SOURCE_UNAVAILABLE],
    matcher.code ?? API_ERROR_CODES.DATA_SOURCE_UNAVAILABLE,
    matcher.message ?? FEEDBACK_COPY.ERROR_STATE_BODY,
    matcher.field,
  );
}

/** Whether an armed matcher applies to a request: every condition it names has to hold, and a matcher
 * that names none applies to any request. */
function matcherApplies(
  matcher: RequestFailureMatcher,
  routeId: string,
  method: Common.HttpMethod,
  pathname: string,
): boolean {
  if (matcher.method !== undefined && matcher.method !== method) return false;
  if (matcher.routeId !== undefined && matcher.routeId !== routeId) return false;
  if (matcher.path === undefined) return true;
  return typeof matcher.path === "string" ? matcher.path === pathname : matcher.path.test(pathname);
}

/** The failure the next matching armed arm answers with, consumed; `null` when nothing is armed for
 * this request. */
function consumeInjectedFailure(
  routeId: string,
  method: Common.HttpMethod,
  pathname: string,
): Common.ApiError | null {
  const index = injectedFailures.findIndex((matcher) =>
    matcherApplies(matcher, routeId, method, pathname),
  );
  if (index === -1) return null;
  const [matcher] = injectedFailures.splice(index, 1);
  return matcher === undefined ? null : injectedError(matcher);
}

// Sessions and authorisation ---------------------------------------------------------------------

/** The session a request carries, or the reason it carries none. The three refusals are kept apart
 * because a client signs out on one of them and the session endpoint has to report which happened. */
type SessionLookup =
  | { readonly kind: "none" }
  | { readonly kind: "unknown" }
  | { readonly kind: "expired"; readonly session: Account.Session }
  | { readonly kind: "active"; readonly session: Account.Session };

/** A lookup that found no usable session: the three ways a request can arrive without one. */
type SessionRefusal = Exclude<SessionLookup, { readonly kind: "active" }>;

/**
 * Whether a stored record authenticates somebody: it carries a token with content and claims a role
 * other than `guest`. This is the rule `authService.isAuthenticated` owns and words the same way — a
 * guest claim authenticates nobody, and reading it as a session would let a stale or hand-made record
 * reach an account screen.
 *
 * It is restated here rather than imported because `src/lib/authService.ts` asks this seam through
 * `src/lib/apiClient.ts`, which imports this file, so the import would close a module cycle; and the
 * domain services sit a layer above the transport, which imports downward only. Applying the rule
 * where a token is resolved is what keeps the route gate and a handler's session from disagreeing
 * about one record.
 *
 * @param session - The record the store holds for a request's token.
 * @returns Whether that record is a session worth acting on.
 */
function authenticatesAnyone(session: Account.Session): boolean {
  return session.token.trim().length > 0 && session.role !== "guest";
}

/** Resolves the session a request carries: the token, the session the store still holds for it, and
 * whether that session has expired. A token the store knows nothing about is `unknown` rather than
 * `none`, so a stale token and a missing one answer different codes; and a record the store still
 * holds but that authenticates nobody, which its role claim or its blank token member decides
 * ({@link authenticatesAnyone}), is `none` as well, so every caller refuses it as absent rather than
 * reading it as a session. An expired session is reported as expired whether or not it authenticates
 * anybody, because `expired` is what a client signs out on. */
function lookUpSession(source: SalesProDataSource, token: string | undefined): SessionLookup {
  if (token === undefined || token.trim() === "") return { kind: "none" };
  const session = source.getSession(token);
  if (session === undefined) return { kind: "unknown" };
  if (isExpired(session)) return { kind: "expired", session };
  return authenticatesAnyone(session) ? { kind: "active", session } : { kind: "none" };
}

/** Whether a session has passed its expiry: a session whose `expiresAt` cannot be parsed is treated as
 * expired, because an unreadable expiry is not a licence to stay signed in. */
function isExpired(session: Account.Session, now: Date = new Date()): boolean {
  const expiresAt = parseIso(session.expiresAt);
  return expiresAt === null || expiresAt.getTime() <= now.getTime();
}

/** The refusal a lookup that found no usable session is answered with: the three 401s, worded by the
 * copy module, with the expired one telling the visitor to sign in again. */
function sessionRefusal(lookup: SessionRefusal): Common.ApiError {
  const code =
    lookup.kind === "none"
      ? API_ERROR_CODES.UNAUTHENTICATED
      : lookup.kind === "unknown"
        ? API_ERROR_CODES.SESSION_UNKNOWN
        : API_ERROR_CODES.SESSION_EXPIRED;
  const message =
    lookup.kind === "expired"
      ? FEEDBACK_COPY.TOAST_SESSION_EXPIRED
      : FEEDBACK_COPY.SIGN_IN_REQUIRED;
  return shapeError(API_ERROR_STATUS[code], code, message);
}

/** Whether a request may proceed at a route's level: `anonymous` always may, `customer` needs a lookup
 * that resolved to an active session — one {@link authenticatesAnyone} has already judged to
 * authenticate somebody — and `administrator` needs that session's role claim to be `admin`. The
 * check lives here and not only in the router, because hiding a control is not access control. */
function authorizeRoute(
  level: AuthorizationLevel,
  lookup: SessionLookup,
): Common.Result<Account.Session | null> {
  if (lookup.kind === "active") {
    if (level === "administrator" && lookup.session.role !== "admin") {
      return failure(API_ERROR_CODES.FORBIDDEN, ADMIN_COPY.NOT_AUTHORIZED_BODY);
    }
    return { ok: true, value: lookup.session };
  }
  return level === "anonymous"
    ? { ok: true, value: null }
    : { ok: false, error: sessionRefusal(lookup) };
}

// Matching a request -----------------------------------------------------------------------------

/** One matched route: its id, the method it matched with and the path parameters it captured. */
export interface RouteMatch {
  readonly routeId: RouteId;
  readonly method: Common.HttpMethod;
  readonly params: Readonly<Record<string, string>>;
}

/** A pattern's segments, with the slashes dropped: `/api/products/:id` becomes `["api","products",":id"]`. */
function patternSegments(pattern: string): readonly string[] {
  return pattern.split("/").filter((segment) => segment !== "");
}

/** One row of {@link routeTable} beside the parts of its pattern that never change: the row's segments
 * and how many of them are literals rather than `:name` captures, which is the figure the precedence
 * rule compares. */
interface IndexedRoute {
  readonly route: RouteDefinition<RouteId>;
  readonly segments: readonly string[];
  readonly staticCount: number;
}

/**
 * The route table, segmented once at module load. Every pattern in it is a constant of this module, so
 * its split and its static count are too: deriving them here is what keeps a request from re-splitting
 * all of the table's patterns — and the pathname against each of them — before a handler runs. Only the
 * patterns are precomputed; no request's own result is remembered, so the seam still holds no cache.
 */
const indexedRoutes: readonly IndexedRoute[] = routeTable.map((row) => {
  const segments = patternSegments(row.pattern);
  return {
    route: row,
    segments,
    staticCount: segments.filter((segment) => !segment.startsWith(":")).length,
  };
});

/** The parameters a pattern's segments capture from a path's, or `null` when the two do not match: a
 * `:name` segment captures one non-empty segment and every other segment has to be identical. Both
 * arrays arrive already split, because a pattern's segments are derived once and a request's are
 * derived once for the request. */
function captureSegments(
  expected: readonly string[],
  actual: readonly string[],
): Readonly<Record<string, string>> | null {
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    const value = actual[index];
    if (segment === undefined || value === undefined || value === "") return null;
    if (segment.startsWith(":")) params[segment.slice(1)] = value;
    else if (segment !== value) return null;
  }
  return params;
}

/**
 * The route a request is answered by, with the parameters it captured, or `null` for a path no route
 * matches. The most static matching pattern wins, so `/api/reports/definitions` is preferred over
 * `/api/reports/:kind` whatever order the table lists them in, and a captured segment never swallows
 * a literal one. The request's pathname is split once and compared against the table's precomputed
 * segments, so the request pays one split of its own path and no split of any pattern.
 */
function findRoute(
  method: Common.HttpMethod,
  pathname: string,
): {
  readonly route: RouteDefinition<RouteId>;
  readonly params: Readonly<Record<string, string>>;
} | null {
  const actual = patternSegments(pathname);
  let best: IndexedRoute | null = null;
  let bestParams: Readonly<Record<string, string>> = {};
  for (const candidate of indexedRoutes) {
    if (candidate.route.method !== method) continue;
    const params = captureSegments(candidate.segments, actual);
    if (params === null) continue;
    if (best === null || candidate.staticCount > best.staticCount) {
      best = candidate;
      bestParams = params;
    }
  }
  return best === null ? null : { route: best.route, params: bestParams };
}

/** The route a method and a path name, without answering it: how a test asserts matching without going
 * through a service. */
export function matchRoute(method: Common.HttpMethod, path: string): RouteMatch | null {
  const separator = path.indexOf("?");
  const pathname = separator === -1 ? path : path.slice(0, separator);
  const found = findRoute(method, pathname);
  return found === null ? null : { routeId: found.route.id, method, params: found.params };
}

// The dispatcher ---------------------------------------------------------------------------------

/**
 * Answers one request and reports its outcome as a value: nothing throws across this seam, so no page
 * needs a try/catch around a data call.
 *
 * The response delay is not applied here: `src/lib/apiClient.ts` waits the configured simulator
 * latency out once, before it asks this seam for an answer, so this function returns as soon as it has
 * one. The dispatcher runs synchronously now that the wait has moved, and its outcome is published as
 * a promise all the same, so a caller waits the same way and nothing the dispatcher does escapes
 * synchronously.
 *
 * The order the checks run in is the order a server would apply them: the caller's query is parsed
 * from the path, a request that arrives before any data source is bound is refused with `503`, an
 * unmatched path with `404`, an armed test failure is consumed, and only then is the session resolved
 * and the route's authority enforced before the endpoint runs.
 */
export function handleRequest<TValue>(
  path: string,
  options: Common.ApiRequestOptions = {},
): Promise<Common.Result<TValue>> {
  // The seam is untyped by design: a caller names the payload type its path answers with, the way a
  // client of a real HTTP API asserts the shape it knows the endpoint returns.
  return Promise.resolve().then(() => dispatch(path, options) as Common.Result<TValue>);
}

/** Runs one request through the seam and returns the outcome before it is given the caller's payload
 * type. */
function dispatch(path: string, options: Common.ApiRequestOptions): Common.Result<unknown> {
  const { pathname, query } = splitRequest(path, options.query);
  const method = options.method ?? "GET";
  const source = dataSource;
  if (source === null) {
    return failure(API_ERROR_CODES.DATA_SOURCE_UNAVAILABLE, FEEDBACK_COPY.ERROR_STATE_BODY);
  }
  const found = findRoute(method, pathname);
  if (found === null) {
    return failure(API_ERROR_CODES.ROUTE_NOT_FOUND, NOT_FOUND_COPY.BODY);
  }
  const injected = consumeInjectedFailure(found.route.id, method, pathname);
  if (injected !== null) return { ok: false, error: injected };
  const lookup = lookUpSession(source, options.sessionToken);
  const authorized = authorizeRoute(found.route.authorize, lookup);
  if (!authorized.ok) return authorized;
  const context: RouteContext = {
    params: found.params,
    query,
    body: options.body,
    token: options.sessionToken,
    session: authorized.value,
    sessionProblem: lookup.kind === "active" ? null : sessionRefusal(lookup),
    source,
  };
  return found.route.handle(context);
}
