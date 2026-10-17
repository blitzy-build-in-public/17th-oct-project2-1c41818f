/**
 * Path: src/lib/mockServer.ts
 * Purpose: The in-process API: route table, parsing, sessions, cards, idempotency and failure injection over a registered data source
 * Lines: 353
 */

import { DEFAULT_API_LATENCY_MS } from "@/constants/config";
import { ACCOUNT_COPY, ADMIN_COPY, FEEDBACK_COPY, NOT_FOUND_COPY } from "@/constants/content";
import type * as Account from "@/types/account";
import type * as Common from "@/types/common";
import { delay } from "@/utils/async";
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
// The seam is one module to its callers even though its parts live together: this file holds the
// transport — the bound data source, the simulated latency and failure, the session check and the
// dispatcher — and repeats here every name a consumer imports, so nothing outside needs a second
// path. `src/lib/apiContract.ts` carries the error vocabulary and the data-source contract, and
// `src/lib/apiRequests.ts` and `src/lib/apiRoutes.ts` carry the endpoint layer the dispatcher runs.

export { API_ERROR_CODES, API_ERROR_STATUS } from "@/lib/apiContract";
export type {
  ApiErrorCode,
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

/** Returns the seam to its unbound state and forgets every injected failure and remembered order key,
 * which is what a test does between cases: until a source is bound again, every request answers
 * `503 data-source-unavailable`. */
export function resetMockServer(): void {
  dataSource = null;
  injectedFailures = [];
  clearRememberedOrders();
}

/**
 * The response delay in milliseconds: `VITE_API_LATENCY_MS` when the build or the test environment
 * sets it to a non-negative number, and {@link DEFAULT_API_LATENCY_MS} otherwise.
 *
 * The variable is read defensively, because Vite types the environment as an index-signed record: an
 * absent, unparsable or negative value falls back to the default rather than disabling the delay or
 * producing `NaN`, which is what keeps `VITE_API_LATENCY_MS=0` the one way to run without waiting.
 */
export function getApiLatencyMs(): number {
  const raw = (import.meta.env as { readonly VITE_API_LATENCY_MS?: unknown }).VITE_API_LATENCY_MS;
  if (typeof raw === "string" || typeof raw === "number") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
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

/** Resolves the session a request carries: the token, the session the store still holds for it, and
 * whether that session has expired. A token the store knows nothing about is `unknown` rather than
 * `none`, so a stale token and a missing one answer different codes. */
function lookUpSession(source: SalesProDataSource, token: string | undefined): SessionLookup {
  if (token === undefined || token.trim() === "") return { kind: "none" };
  const session = source.getSession(token);
  if (session === undefined) return { kind: "unknown" };
  return isExpired(session) ? { kind: "expired", session } : { kind: "active", session };
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
    lookup.kind === "expired" ? FEEDBACK_COPY.TOAST_SESSION_EXPIRED : ACCOUNT_COPY.SIGN_IN_HEADING;
  return shapeError(API_ERROR_STATUS[code], code, message);
}

/** Whether a request may proceed at a route's level: `anonymous` always may, `customer` needs an
 * active session, and `administrator` needs one whose role claim is `admin`. The check lives here and
 * not only in the router, because hiding a control is not access control. */
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

/** The parameters a pattern captures from a path, or `null` when the two do not match: a `:name`
 * segment captures one non-empty segment and every other segment has to be identical. */
function captureSegments(
  pattern: string,
  pathname: string,
): Readonly<Record<string, string>> | null {
  const expected = patternSegments(pattern);
  const actual = patternSegments(pathname);
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
 * a literal one.
 */
function findRoute(
  method: Common.HttpMethod,
  pathname: string,
): {
  readonly route: RouteDefinition<RouteId>;
  readonly params: Readonly<Record<string, string>>;
} | null {
  let best: RouteDefinition<RouteId> | null = null;
  let bestParams: Readonly<Record<string, string>> = {};
  let bestStaticCount = -1;
  for (const candidate of routeTable) {
    if (candidate.method !== method) continue;
    const params = captureSegments(candidate.pattern, pathname);
    if (params === null) continue;
    const statics = patternSegments(candidate.pattern).filter((one) => !one.startsWith(":"));
    if (statics.length > bestStaticCount) {
      best = candidate;
      bestParams = params;
      bestStaticCount = statics.length;
    }
  }
  return best === null ? null : { route: best, params: bestParams };
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
 * The order the checks run in is the order a server would apply them: the caller's query is parsed
 * from the path, the response is delayed by the simulated latency, a request that arrives before any
 * data source is bound is refused with `503`, an unmatched path with `404`, an armed test failure is
 * consumed, and only then is the session resolved and the route's authority enforced before the
 * endpoint runs. A request aborted while its delay is pending rejects with the abort error, which is
 * the only way this function does not return a `Result`: a cancelled request has no outcome to report.
 */
export async function handleRequest<TValue>(
  path: string,
  options: Common.ApiRequestOptions = {},
): Promise<Common.Result<TValue>> {
  const outcome: Common.Result<unknown> = await dispatch(path, options);
  // The seam is untyped by design: a caller names the payload type its path answers with, the way a
  // client of a real HTTP API asserts the shape it knows the endpoint returns.
  return outcome as Common.Result<TValue>;
}

/** Runs one request through the seam and returns the outcome before it is given the caller's payload
 * type. */
async function dispatch(
  path: string,
  options: Common.ApiRequestOptions,
): Promise<Common.Result<unknown>> {
  const { pathname, query } = splitRequest(path, options.query);
  const method = options.method ?? "GET";
  await delay(getApiLatencyMs(), options.signal);
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
