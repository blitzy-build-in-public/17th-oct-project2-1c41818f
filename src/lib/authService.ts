/**
 * Path: src/lib/authService.ts
 * Purpose: Registration, sign-in, sign-out, session restore and role checks for the demonstration account store
 * Lines: 359
 */

import { ACCOUNT_COPY, ADMIN_COPY, FEEDBACK_COPY, VALIDATION_MESSAGES } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import type {
  Credentials,
  RegistrationInput,
  RegistrationResult,
  Role,
  Session,
} from "@/types/account";
import type { ApiError, FieldErrors, Result, SessionToken } from "@/types/common";
import {
  FORM_ERROR_KEY,
  fieldErrorsFromApiError,
  firstError,
  hasErrors,
  validateRegistration,
} from "@/utils/validation";

import { API_ERROR_CODES, API_PATHS, failure, getJson, postJson } from "@/lib/apiClient";

/**
 * The account store's rules: who a session says the visitor is, how an authentication failure is
 * worded, and the session lifetime published from `src/utils/accountRules.ts`, which owns it so the
 * data layer may read it from a layer below this one. Consumers: `src/Router.tsx` and the privileged
 * feature slices, which guard a route with {@link assertRole}; `LoginPage` and `RegisterPage`, which
 * land a signed-in visitor with {@link roleHomePath} and render {@link toAuthFieldErrors} and
 * {@link authErrorMessage}; `src/state/AuthContext.tsx`, which restores a persisted token through
 * {@link restoreSession}; and `src/data/repositories.ts`, which answers a session lookup by the same
 * expiry rule as `isSessionExpired`.
 *
 * This is a demonstration account store, not a security boundary. The product ships no server, so the
 * accounts, their digests and their sessions live in the browser, and the credential a client holds is
 * an opaque `ses_` token carrying a role claim and an expiry. Two consequences are stated rather than
 * implied. The digest — salt, hash and verify — has exactly one home in `src/utils/strings.ts`, and
 * this file neither implements nor wraps it: it never sees a stored digest, and the sign-in endpoint
 * compares the password itself. And a real deployment moves session issue, expiry and verification
 * behind the server that `src/lib/apiClient.ts` is built to be repointed at, leaving the rules exported
 * here unchanged.
 *
 * Two ownership rules keep this file to its own concern. Persisting, restoring and clearing a stored
 * token belong to `src/state/AuthContext.tsx` over `src/utils/storage.ts`, so nothing here reads or
 * writes storage. And authorisation is enforced where the action happens — `src/lib/mockServer.ts`
 * re-checks the session's role on every privileged request — so {@link assertRole} is the convenience
 * `src/Router.tsx` uses to keep a visitor out of a screen it cannot serve, never the control itself.
 *
 * Failures are values: every method here resolves with a `Result` and none of them throws or rejects,
 * so a screen branches on `ok` instead of wrapping a call in `try`/`catch`. A failure carries the
 * `ApiError` the seam shaped — status, code, message and the `field` it belongs to — so a caller can
 * branch on `code` and a form can place the sentence on the control that caused it. The only failure
 * this file shapes for itself is the refusal of input that breaks a rule before it is sent.
 */

// Failure vocabulary ------------------------------------------------------------------------------

/**
 * The authentication codes this module has wording for, taken from the seam's own vocabulary rather
 * than spelled again: {@link authErrorMessage} and {@link toAuthFieldErrors} key their tables by
 * these, and a code the product adds is picked up here by naming its constant.
 *
 * The status each code answers with is deliberately absent: `failure` reads it from the vocabulary the
 * seam publishes, so no status is written in this file at all.
 */
export type AuthFailureCode =
  | typeof API_ERROR_CODES.UNAUTHENTICATED
  | typeof API_ERROR_CODES.SESSION_EXPIRED
  | typeof API_ERROR_CODES.SESSION_UNKNOWN
  | typeof API_ERROR_CODES.INVALID_CREDENTIALS
  | typeof API_ERROR_CODES.FORBIDDEN
  | typeof API_ERROR_CODES.DUPLICATE_EMAIL
  | typeof API_ERROR_CODES.VALIDATION_FAILED;

/** The codes of {@link AuthFailureCode}, in the order the union names them, so a code read off a
 * failure can be recognised as one this module has wording for. */
const AUTH_FAILURE_CODES: readonly AuthFailureCode[] = [
  API_ERROR_CODES.UNAUTHENTICATED,
  API_ERROR_CODES.SESSION_EXPIRED,
  API_ERROR_CODES.SESSION_UNKNOWN,
  API_ERROR_CODES.INVALID_CREDENTIALS,
  API_ERROR_CODES.FORBIDDEN,
  API_ERROR_CODES.DUPLICATE_EMAIL,
  API_ERROR_CODES.VALIDATION_FAILED,
];

/** Whether a `code` read off a failure is one of the authentication codes, narrowing it so the tables
 * of wording and of fields below can be indexed without a cast. */
function isAuthFailureCode(value: string): value is AuthFailureCode {
  return (AUTH_FAILURE_CODES as readonly string[]).includes(value);
}

// Who may do what ---------------------------------------------------------------------------------

/**
 * Whether a session's role claim is one of the roles given.
 *
 * An absent session is never a match, so a guard can ask this before it has one, and the role is read
 * off the session rather than off the current route — which is why a session, and not a path, is the
 * unit of authorisation.
 *
 * @param session - The session to judge, or `undefined` for a visitor who is not signed in.
 * @param roles - One role, or the roles any of which is enough.
 * @returns Whether the session carries one of the roles.
 */
export function hasRole(session: Session | undefined, roles: Role | readonly Role[]): boolean {
  if (session === undefined) return false;
  const allowed: readonly Role[] = typeof roles === "string" ? [roles] : roles;
  return allowed.includes(session.role);
}

/**
 * Whether a session is one worth acting on: present, carrying a token, and claiming a role that grants
 * something.
 *
 * A session claiming `guest` fails this check although it is present, because a guest claim
 * authenticates nobody and reading it as a session would let a stale or hand-made record reach an
 * account screen. The token is checked for content rather than for its `ses_` prefix: the prefix is a
 * readability convention, and whether a token is real is the seam's decision, not this module's.
 *
 * Declared as a type guard, so a caller that asks once may use the session without checking again.
 *
 * @param session - The session to judge, or `undefined` for a visitor who is not signed in.
 * @returns Whether the visitor is signed in as an account that grants something.
 */
export function isAuthenticated(session: Session | undefined): session is Session {
  return session !== undefined && session.token.trim().length > 0 && session.role !== "guest";
}

/** Whether the session belongs to a sales administrator, the only role that reaches the dashboard and
 * the reports. Shorthand for {@link hasRole} with `admin`, so the two can never disagree. */
export function isAdministrator(session: Session | undefined): boolean {
  return hasRole(session, "admin");
}

/**
 * The guard a privileged route and a privileged action call, turning "not signed in" and "wrong role"
 * into the two refusals a screen branches on.
 *
 * The refusals are deliberately different. Without a usable session the answer is `401
 * unauthenticated`, which a screen reads as "sign in first" and handles by sending the visitor to the
 * sign-in screen with the intended path preserved. With a session whose role is not enough the answer
 * is `403 forbidden`, which a screen reads as "not this account" and handles by stating the refusal
 * rather than showing a sign-in form that would not help. Both sentences come from
 * `src/constants/content.ts`, and they are the ones the seam answers the same conditions with, so a
 * guard and an endpoint never word one refusal two ways.
 *
 * Expiry is deliberately not judged here: this function holds no clock, and the authority on whether a
 * token is still accepted is the seam that issued it, which {@link restoreSession} asks. A screen that
 * needs a live session restores it first and guards what came back.
 *
 * @param session - The session to guard, or `undefined` for a visitor who is not signed in.
 * @param required - The role, or the roles any of which admits the caller.
 * @returns The session itself on success, or the shaped refusal: `unauthenticated` naming no field, or
 * `forbidden`.
 */
export function assertRole(
  session: Session | undefined,
  required: Role | readonly Role[],
): Result<Session> {
  if (!isAuthenticated(session)) {
    return failure(API_ERROR_CODES.UNAUTHENTICATED, FEEDBACK_COPY.SIGN_IN_REQUIRED);
  }
  if (!hasRole(session, required)) {
    return failure(API_ERROR_CODES.FORBIDDEN, ADMIN_COPY.NOT_AUTHORIZED_BODY);
  }
  return { ok: true, value: session };
}

// Session lifetime --------------------------------------------------------------------------------

// The expiry rule lives in `src/utils/accountRules.ts`, which both this layer and the data layer may
// read, and is published here because every caller imports the session from this service: the data
// layer that stamps a session's `expiresAt` and the screen that judges a restored one read the same
// single home.
export { isSessionExpired, sessionExpiresAt } from "@/utils/accountRules";

/** Where each role lands after signing in, read from `src/constants/routes.ts` so no path is written
 * here and a route change moves this table with it. */
const ROLE_HOME_PATHS: Readonly<Record<Role, string>> = {
  guest: ROUTES.HOME,
  customer: ROUTES.ACCOUNT,
  admin: ROUTES.ADMIN,
};

/**
 * The path a role lands on once it is signed in, or the storefront for a visitor with no account.
 *
 * The mapping is a table keyed by every role rather than a chain of conditions, so a role added to
 * `Role` fails to compile here until its landing path is decided. Consumers: `LoginPage` and
 * `RegisterPage`, which navigate here when no intended path was preserved, and `src/Router.tsx` for a
 * signed-in visitor who opens the sign-in screen.
 *
 * @param role - The role of the session being landed.
 * @returns The route path that role belongs on.
 */
export function roleHomePath(role: Role): string {
  return ROLE_HOME_PATHS[role];
}

// Wording an authentication failure ---------------------------------------------------------------

/**
 * The canonical sentence for each code whose wording this module owns, read from
 * `src/constants/content.ts` so no user-facing sentence is written twice.
 *
 * One deliberate absence: `validation-failed` has no entry, because its sentence belongs to the field
 * rule that produced it and travels in the failure's own message — a fixed sentence here would replace
 * a specific complaint with a generic one. Every other entry carries the sentence the seam answers its
 * condition with, so a guard and an endpoint word one refusal the same way.
 */
const AUTH_FAILURE_MESSAGES: Readonly<Partial<Record<AuthFailureCode, string>>> = {
  unauthenticated: FEEDBACK_COPY.SIGN_IN_REQUIRED,
  "session-expired": FEEDBACK_COPY.TOAST_SESSION_EXPIRED,
  "session-unknown": FEEDBACK_COPY.SIGN_IN_REQUIRED,
  "invalid-credentials": ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE,
  forbidden: ADMIN_COPY.NOT_AUTHORIZED_BODY,
  "duplicate-email": ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE,
};

/** The control each code's failure belongs to when the failure itself names none, so a taken email
 * address lands on the email field rather than above the form. `invalid-credentials` is deliberately
 * absent: a rejected sign-in names neither member, because a failure that pointed at one would tell a
 * stranger which email addresses have accounts. */
const AUTH_FAILURE_FIELDS: Readonly<Partial<Record<AuthFailureCode, string>>> = {
  "duplicate-email": "email",
};

/** The field a failure belongs to: the one it names, or the one its code implies. */
function authFailureField(error: ApiError): string | undefined {
  const named = error.field ?? "";
  if (named.length > 0) return named;
  return isAuthFailureCode(error.code) ? AUTH_FAILURE_FIELDS[error.code] : undefined;
}

/**
 * The sentence a visitor reads for an authentication failure.
 *
 * A code whose wording this module owns resolves from {@link AUTH_FAILURE_MESSAGES}; anything else keeps
 * the sentence the seam already wrote, and a failure carrying no sentence at all falls back to the
 * neutral one, so a screen never renders an empty alert. The rejected sign-in is the case worth naming:
 * `invalid-credentials` resolves to a single generic sentence that does not say which of the two
 * members was wrong, so neither this function nor a screen built on it discloses which email addresses
 * have accounts.
 *
 * @param error - The failure a method here returned.
 * @returns The sentence to show; never empty, never a field name, never a credential.
 */
export function authErrorMessage(error: ApiError): string {
  const canonical = isAuthFailureCode(error.code) ? AUTH_FAILURE_MESSAGES[error.code] : undefined;
  if (canonical !== undefined) return canonical;
  return error.message.length > 0 ? error.message : FEEDBACK_COPY.ERROR_STATE_BODY;
}

/**
 * The field-keyed error map a form renders for an authentication failure: the bridge from an `ApiError`
 * to the shape every field rule already produces.
 *
 * A failure that names a field is filed under it, a failure whose code implies one — a taken email
 * address — is filed under that field, and a failure belonging to neither is filed under the shared
 * form key in `src/utils/validation.ts`, so a screen shows it above its fields instead of losing it.
 * The map is built by `fieldErrorsFromApiError`, the single mapper of an `ApiError` into field errors,
 * and reused here rather than restated.
 *
 * @param error - The failure a method here returned.
 * @returns A one-entry map: the offending field, or the form key, to the sentence to show. Consumers:
 * `LoginPage`, `RegisterPage` and the account forms that submit through this service.
 */
export function toAuthFieldErrors(error: ApiError): FieldErrors {
  const field = authFailureField(error);
  const named = field === undefined || field === error.field ? error : { ...error, field };
  return fieldErrorsFromApiError(named, authErrorMessage(error));
}

// The client surface ------------------------------------------------------------------------------

/** The `422` a locally refused input becomes: the first field the map names and its sentence, asked of
 * the seam's own shaper at the status the published vocabulary gives that code — the same refusal the
 * seam would answer the same body with, which is the rule the seam re-applies to whatever does reach
 * it, so a form cannot tell a local refusal from a server one. */
function refusedInput(errors: FieldErrors): Result<never> {
  const field = Object.keys(errors)[0] ?? FORM_ERROR_KEY;
  const message = firstError(errors) ?? VALIDATION_MESSAGES.REQUIRED;
  return failure(API_ERROR_CODES.VALIDATION_FAILED, message, field);
}

/**
 * Creates an account and opens a session with it, so a registered customer is signed in immediately and
 * no second request has to follow.
 *
 * The input is judged by `validateRegistration` before it is sent: a password outside the demonstration
 * policy, an address that is not an email address or a missing name is refused here, as the same value
 * the seam would answer with, so a malformed form never reaches the transport. The uniqueness of the
 * address is deliberately not judged here, because only the store knows it; a taken address comes back
 * as `409 duplicate-email`, which {@link toAuthFieldErrors} files on the email field.
 *
 * @param input - The registration body: email and password, first and last name, and the marketing
 * consent choice.
 * @returns The created account with the session opened for it, or the shaped failure: `422` for input
 * that broke a rule, `409` for an address already taken.
 */
export async function register(input: RegistrationInput): Promise<Result<RegistrationResult>> {
  const errors = validateRegistration(input);
  if (hasErrors(errors)) return refusedInput(errors);
  return await postJson<RegistrationResult, RegistrationInput>(API_PATHS.AUTH_REGISTER, input);
}

/**
 * Opens a session for existing credentials.
 *
 * The credentials travel as typed and are judged by the seam, which compares the password against the
 * stored digest through the one digest helper in `src/utils/strings.ts` — a home this module never
 * reaches. Nothing is validated here on purpose: a rejected sign-in must be one generic sentence rather
 * than a complaint about a single member, so a local rule that marked a field would be the very
 * disclosure this endpoint avoids. Both a wrong password and an address with no account answer the
 * same `401 invalid-credentials` failure.
 *
 * @param credentials - The email address and the password as typed.
 * @returns The issued session, or the shaped failure: `401 invalid-credentials`, or `422` for a body
 * whose two members are not both text.
 */
export async function signIn(credentials: Credentials): Promise<Result<Session>> {
  return await postJson<Session, Credentials>(API_PATHS.AUTH_LOGIN, credentials);
}

/**
 * Ends the session a token names, so the token is no longer accepted by any endpoint.
 *
 * The call is best-effort by nature, and a caller treats it as such: it drops its own session state
 * whatever this returns, because a session the visitor has given up must not stay in use by the client.
 * A failure is still returned rather than swallowed, so a caller that wants to report one can.
 *
 * @param token - The session token to end.
 * @returns Nothing on success — the seam answers `204` with an empty payload — or the shaped failure.
 */
export async function signOut(token: SessionToken): Promise<Result<void>> {
  return await postJson<void>(API_PATHS.AUTH_LOGOUT, undefined, { sessionToken: token });
}

/**
 * Reports the session a stored token still names, which is how a reload keeps a visitor signed in:
 * `src/state/AuthContext.tsx` restores the persisted token on mount by asking this, so the session is
 * revalidated by the authority that issued it instead of being trusted from storage.
 *
 * A token that has expired and a token the store has never seen are both failures rather than
 * exceptions — `401 session-expired` and `401 session-unknown` — so a caller reads one `Result` and
 * signs the visitor out on either, instead of catching a rejection to find out which happened.
 * Clearing the stored token when this fails is the caller's job; this module touches no storage.
 *
 * @param token - The session token read back from persistence.
 * @returns The session, or the shaped failure: `401 session-expired`, `401 session-unknown`, or any
 * other failure the transport reports.
 */
export async function restoreSession(token: SessionToken): Promise<Result<Session>> {
  return await getJson<Session>(API_PATHS.AUTH_SESSION, { sessionToken: token });
}
