/**
 * Path: src/state/authSession.ts
 * Purpose: The session's contract as a consumer reads it, the read that revalidates a stored token, and the projections computed from the state
 * Lines: 302
 */

import { API_PATHS, toApiError } from "@/lib/apiClient";
import {
  isAdministrator,
  isAuthenticated,
  restoreSession as restoreSessionRequest,
} from "@/lib/authService";
import { displayName } from "@/lib/customerService";
import type { Customer, Role, Session } from "@/types/account";
import type {
  ApiError,
  AsyncStatus,
  IsoDateTimeString,
  Result,
  SessionToken,
} from "@/types/common";
import { retry } from "@/utils/async";

/**
 * Why this file exists beside `AuthContext.tsx`: the session's reading half — the contract a consumer
 * sees, the read that decides whether a stored token still names a session, and the projections the
 * provider's state is read through — is a concern of its own, and keeping it beside the provider and its
 * actions pushed that file past the request's 600-line ceiling. The ceiling therefore splits the concern
 * out rather than being raised, the way `src/components/ui/overlayEngine.ts` stands beside `Modal.tsx`
 * and `src/components/charts/chartGeometry.ts` beside `chartScales.ts`. `src/state/AuthContext.tsx` is
 * its only importer and this module imports nothing back from it, so the dependency stays one-way.
 *
 * What it owns, in four parts. The contract: `AuthState`, what a consumer reads of the session, and
 * `AuthValue`, that contract plus the facts derived from it, which is what both consumer hooks resolve
 * to. The read: `readStoredSession`, the retried and classified read a stored token is revalidated
 * through, with the attempts, the backoff and the box a failure is carried in private to this module,
 * and the states a read publishes — `SIGNED_OUT_STATE`, `PENDING_STATE`, `RestoredIdentity` and its
 * `NO_IDENTITY` answer. The projections: `usableSession` and `derivedValue`, with the two helpers they
 * need, computed from the state during render and never stored. And the cancellation an action's request
 * runs under: `runCancellable`, one controller per request, held for the length of the call so a provider
 * that unmounts with a request in flight aborts it rather than letting its answer publish into a tree
 * that is gone.
 *
 * The rules are not restated here either. `src/lib/authService.ts` owns the session lifecycle and every
 * role, authentication and expiry decision — this module calls `restoreSession`, `isAuthenticated` and
 * `isAdministrator` rather than repeating one of them — and `src/utils/storage.ts` stays the product's
 * only reader and writer of the store, which is why the token is handed in rather than read here. What
 * this module decides is how one read's outcome is shaped and how the state projects into what a
 * consumer reads, and each decision is recorded where it is made.
 */

// What a consumer reads --------------------------------------------------------------------------

/**
 * The session this client holds, as every consumer sees it. `session` is non-null exactly while the
 * visitor is signed in and `customer` is its identity projection; the two are adopted together, because
 * every screen that shows one shows the other.
 */
export interface AuthState {
  /** `idle` before anything has been asked and after a sign-out, `loading` while an action or the mount
   *  revalidation is in flight, `success` while a session is held, and `error` when the last action or
   *  the revalidation failed — the session standing while only its identity projection failed included. */
  readonly status: AsyncStatus;

  /** The session in force, or `null` for a visitor who is not signed in. */
  readonly session: Session | null;

  /** The account the session authenticates, or `null` while it is not known. */
  readonly customer: Customer | null;

  /** The failure the last action or the mount revalidation answered with, or `null`. */
  readonly error: ApiError | null;
}

/**
 * Everything a consumer reads, and nothing it writes. The facts below are derived from the state
 * during render and never stored: a role or a name kept beside the session it describes is a second
 * answer to a question the session already answers, and the two drift apart when either changes.
 */
export interface AuthValue extends AuthState {
  /** The role in force: the session's own claim, or `guest` for a visitor who is not signed in. */
  readonly role: Role;

  /** Whether a session worth acting on is held. The guards over `/account/*` read this. */
  readonly isAuthenticated: boolean;

  /** Whether that session is a sales administrator's — the one role the dashboard and reports admit. */
  readonly isAdministrator: boolean;

  /** Whether that session is a shopper's: every role that is neither `guest` nor `admin`. */
  readonly isCustomer: boolean;

  /** The account's full name for the header and the account screens, or `""` while it is not known. */
  readonly displayName: string;

  /** The account's email address, which the checkout prefills its contact field with; `null` while
   *  the identity projection is not known. */
  readonly email: string | null;
}

// The states this module publishes ---------------------------------------------------------------

/** The state of a visitor who is not signed in, shared rather than allocated per render. */
export const SIGNED_OUT_STATE: AuthState = {
  status: "idle",
  session: null,
  customer: null,
  error: null,
};

/** The state while an action or the mount revalidation is in flight. */
export const PENDING_STATE: AuthState = {
  status: "loading",
  session: null,
  customer: null,
  error: null,
};

/**
 * What one session revalidation resolves to: the session a stored token still names and the account
 * behind it, or two nulls when there is nothing to adopt — no token to ask with, or a token the local
 * expiry rule has already retired. The two travel together because a session without its account is
 * not a state a screen can render.
 */
export interface RestoredIdentity {
  readonly session: Session | null;
  readonly customer: Customer | null;
}

/** The answer a revalidation with nothing to adopt resolves to. */
export const NO_IDENTITY: RestoredIdentity = { session: null, customer: null };

// Retrying the mount revalidation -----------------------------------------------------------------

/**
 * How many times the mount revalidation asks the store which session the stored token still names: a
 * store that could not answer is worth asking again, while a refusal is decided on the first attempt and
 * never repeated, and three attempts bound the wait a visitor on a guarded route sees.
 */
const REVALIDATION_ATTEMPTS = 3;

/**
 * The backoff base between those attempts, in milliseconds: the second follows 200 ms after the first and
 * the third 400 ms after that, so a store that cannot answer is retried twice within 600 ms.
 */
const REVALIDATION_BACKOFF_MS = 200;

/**
 * The failure of one session read, boxed as the `Error` this repository throws. A seam failure is a value
 * rather than an exception, so it has to be carried inside a real error to be classified at all, and
 * `status` is the member {@link retry}'s own predicate reads to tell a failure worth another attempt from
 * one the store has already decided.
 */
class SessionReadFailure extends Error {
  /** The failure the store answered with, exactly as the seam shaped it. */
  readonly failure: ApiError;

  /** That failure's status, so the box is classified as the failure itself would be. */
  readonly status: number;

  /**
   * @param failure - The failure the session read resolved with.
   */
  constructor(failure: ApiError) {
    super(failure.message);
    this.name = "SessionReadFailure";
    this.failure = failure;
    this.status = failure.status;
  }
}

/**
 * Asks the store which session `token` still names, retrying a store that could not answer and reporting
 * the outcome as a value: the read the mount revalidation is built on, and the one place the classification
 * of its failures starts.
 *
 * @param token - The token read back from persistence.
 * @param signal - The revalidation's cancellation, honoured before an attempt and between attempts.
 * @returns The session the store answered with, or the failure it answered with; never a rejection.
 */
export async function readStoredSession(
  token: SessionToken,
  signal: AbortSignal,
): Promise<Result<Session>> {
  try {
    return await retry(
      async (): Promise<Result<Session>> => {
        const outcome = await restoreSessionRequest(token);
        // Thrown only so that `retry` can classify it: its predicate never repeats a 4xx, which keeps a
        // refusal immediate — the store has already answered no — while a store that could not answer is
        // asked again.
        if (!outcome.ok) throw new SessionReadFailure(outcome.error);
        return outcome;
      },
      { attempts: REVALIDATION_ATTEMPTS, baseDelayMs: REVALIDATION_BACKOFF_MS, signal },
    );
  } catch (cause: unknown) {
    // No exception crosses a module boundary: the box is unwrapped back into the value it carries, and
    // anything else thrown is shaped the way the transport shapes its own failures.
    return {
      ok: false,
      error:
        cause instanceof SessionReadFailure
          ? cause.failure
          : toApiError(cause, API_PATHS.AUTH_SESSION),
    };
  }
}

// Cancelling an action's request -----------------------------------------------------------------

/**
 * Runs one action's request under a controller of its own, held in `registry` for the length of the call
 * and released in the `finally`: what lets the caller's signal cancel the request at all, and what lets
 * the provider's unmount abort every request still in flight when its tree goes. A request cancelled
 * through a signal settles as the transport's shaped `request-aborted` failure, never as a rejection, so
 * the action above it reads one `Result` either way.
 *
 * One controller per request, never one for the provider's lifetime: `src/main.tsx` mounts the
 * application under `StrictMode`, which unmounts the provider once between two mounts in development, so
 * a controller shared by that lifetime would be aborted by the trial cleanup and every request the
 * document made afterwards would be refused before it was ever dispatched.
 *
 * It lives here rather than beside the provider for the reason this module exists at all: the writing
 * half that uses it is what pushed `src/state/AuthContext.tsx` to the request's 600-line ceiling, so the
 * helper it needs is split out rather than the ceiling raised.
 *
 * @param registry - The set holding one provider's live requests.
 * @param run - The work, handed the signal that cancels it.
 * @returns Whatever `run` resolves with.
 */
export async function runCancellable<TValue>(
  registry: Set<AbortController>,
  run: (signal: AbortSignal) => Promise<TValue>,
): Promise<TValue> {
  const controller = new AbortController();
  registry.add(controller);
  try {
    return await run(controller.signal);
  } finally {
    registry.delete(controller);
  }
}

// Projections ------------------------------------------------------------------------------------

/**
 * Whether a stored payload is a session token: a non-empty string, or the `null` a store holding none
 * reads back as. The content is judged no further — the `ses_` prefix proves nothing, and whether a token
 * is real is the store's decision, which `restoreSession` asks.
 */
export function isStoredToken(value: unknown): value is SessionToken | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

/**
 * The instant a session's expiry is judged against, in the ISO 8601 form `isSessionExpired` parses back to
 * the same moment. The clock is read here because expiry is a fact about now rather than about the record,
 * and in UTC because `src/utils/dates.ts` is outside this file's dependency set: the parser behind
 * `isSessionExpired` reads both forms, so neither reading changes the answer.
 */
export function nowInstant(): IsoDateTimeString {
  return new Date().toISOString();
}

/**
 * The session this module treats as one worth acting on, or `null`. `src/lib/authService.ts` decides what
 * that means — a session holding no token, or claiming the `guest` role no account is ever stored as,
 * authenticates nobody — so a record that cannot be used is reported as a visitor who is not signed in.
 */
export function usableSession(session: Session | null): Session | null {
  return session !== null && isAuthenticated(session) ? session : null;
}

/**
 * The value a consumer reads, derived from the state during render: every member beyond the state is a
 * projection of the session or of the account, computed here and never stored. A name and an email the
 * client does not have are reported as absent rather than invented, and a visitor holding no usable
 * session reports the `guest` role and no identity.
 *
 * `session` and `customer` are those projections and never the raw members of the state: the interface
 * promises `session` is non-null exactly while the visitor is signed in, so a record that authenticates
 * nobody is reported as no session rather than handed to a consumer that would send its token on a request.
 */
export function derivedValue(state: AuthState): AuthValue {
  const session = usableSession(state.session);
  const account = session === null ? null : state.customer;
  const administrator = session !== null && isAdministrator(session);
  const name = account === null ? "" : displayName(account);
  return {
    status: state.status,
    session,
    customer: account,
    error: state.error,
    role: session === null ? "guest" : session.role,
    isAuthenticated: session !== null,
    isAdministrator: administrator,
    isCustomer: session !== null && session.role === "customer",
    displayName: name,
    email: account === null ? null : account.email,
  };
}
