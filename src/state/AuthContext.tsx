/**
 * Path: src/state/AuthContext.tsx
 * Purpose: Session state with sign-in and sign-out actions, role helpers and restore on mount
 * Lines: 555
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";

import { STORAGE_KEYS } from "@/constants/config";
import {
  isAdministrator,
  isAuthenticated,
  isSessionExpired,
  register as registerAccount,
  restoreSession as restoreSessionRequest,
  signIn as signInRequest,
  signOut as signOutRequest,
} from "@/lib/authService";
import { displayName, getProfile } from "@/lib/customerService";
import { useAsync } from "@/state/hooks";
import type {
  Credentials,
  Customer,
  RegistrationInput,
  RegistrationResult,
  Role,
  Session,
} from "@/types/account";
import type {
  ApiError,
  AsyncStatus,
  IsoDateTimeString,
  Result,
  SessionToken,
} from "@/types/common";
import { readStored, removeStored, writeStored } from "@/utils/storage";

/**
 * Who the visitor is: the session this client holds, the account behind it, and the five actions that
 * change either. The header's account menu, the route guards, the checkout's contact prefill and the
 * account screens read it here, and none of them owns the session.
 *
 * The rules are not restated here. `src/lib/authService.ts` owns the session lifecycle and every role
 * and expiry decision — this module calls `signIn`, `signOut`, `register`, `restoreSession`,
 * `isAuthenticated`, `isAdministrator` and `isSessionExpired` rather than repeating one of them — and
 * `src/utils/storage.ts` is the product's only reader and writer of the store. What this file owns is
 * orchestration, and each decision it makes is recorded where it is made.
 *
 * Authentication here is a demonstration account store, not a security boundary: the credential is an
 * opaque `ses_` token the in-browser store issues and no real credential stands behind it. A real
 * deployment moves session issue, expiry and verification behind the server that
 * `src/lib/apiClient.ts` is built to be repointed at, and the rules this file calls move with it.
 */

// What a consumer reads --------------------------------------------------------------------------

/**
 * The session this client holds, as every consumer sees it. `session` is non-null exactly while the
 * visitor is signed in and `customer` is its identity projection; the two are adopted together,
 * because every screen that shows one shows the other.
 */
export interface AuthState {
  /**
   * `idle` before anything has been asked and after a sign-out, `loading` while an action or the
   * mount revalidation is in flight, `success` while a session is held, and `error` when the last
   * action or the revalidation failed — including the case where the session stands and only its
   * identity projection failed.
   */
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

/**
 * Every change this context accepts, one member each, stable for the life of the provider.
 *
 * A consumer receives this object in place of a reducer's `dispatch`, so each transition the session
 * supports is named rather than spelled out at the call site. Each member is a `useCallback` over
 * stable inputs and the object holding them is memoised, so its identity never changes and a control
 * that only ever changes the session is not re-rendered when a session it does not read changes. The
 * five are function-valued properties rather than methods, because a consumer destructures them out
 * of the hook or spreads them into props, and a method separated from its receiver is what the
 * type-aware lint rule this repository's gate treats as an error flags.
 *
 * Failures are values, not exceptions: `signIn` and `register` resolve the `Result` the store answered
 * with and never throw or reject, so a form branches on `ok` and maps a field error with
 * `toAuthFieldErrors` from `src/lib/authService.ts`, while the state records the failure for the page.
 */
export interface AuthActions {
  /**
   * Opens a session for the credentials as typed and adopts it: the token is persisted, the session
   * and its account become the state, and the visitor is signed in by the time the promise resolves,
   * so a caller navigates into a guarded route without racing the guard it navigates into. The
   * credentials are judged by the store alone, because a rejected sign-in must be one sentence rather
   * than a complaint about a single member.
   *
   * @param credentials - The email address and the password as typed.
   * @returns The issued session, or the store's failure — `401` for credentials it refused, `422` for
   *   a body whose members are not both text — which the form renders through `toAuthFieldErrors`.
   */
  readonly signIn: (credentials: Credentials) => Promise<Result<Session>>;

  /**
   * Creates an account and adopts the session opened with it, so a registered visitor is signed in
   * immediately and no second request follows: the created account travels in the same answer as its
   * session, which makes registration the one path that adopts an identity without asking for it.
   *
   * @param input - The registration body: email and password, first and last name, and the marketing
   *   consent choice.
   * @returns The created account with its session, or the store's failure: `409` for an email address
   *   that already belongs to an account, `422` for input that broke a rule.
   */
  readonly register: (input: RegistrationInput) => Promise<Result<RegistrationResult>>;

  /**
   * Ends the session and returns the state to a signed-out visitor: the store is asked to retire the
   * token, the persisted entry is dropped and the revalidation's answer is discarded with it. The
   * local session is gone whether or not the store answers, because a session the visitor has given
   * up must not stay in use by the client.
   */
  readonly signOut: () => Promise<void>;

  /**
   * Re-asks the store which session the persisted token still names, which is what a surface calls
   * when a request came back `401` and the answer is worth confirming before the visitor is sent back
   * to sign-in. A visitor holding no persisted token has nothing to revalidate, so the call resolves
   * without a request, and the outcome arrives through the state rather than through this promise:
   * the revalidation settles in its own time, and a caller that needs to observe it reads `status`
   * and `error` from the value the provider publishes.
   */
  readonly restoreSession: () => Promise<void>;

  /**
   * Re-reads the identity projection of the session in force: how the header's name and the account
   * screens are refreshed after a profile edit, and how a projection that failed is retried.
   *
   * A visitor holding no usable session is left untouched. A projection that fails keeps the session
   * and reports the failure, because the account as it last read is still the best answer available.
   */
  readonly refresh: () => Promise<void>;
}

// Contexts ---------------------------------------------------------------------------------------

/** The session state, private to this module: consumers reach it through `useAuth()`. The `null`
 *  default is the "no provider above this consumer" sentinel the hook turns into an error naming what
 *  is missing, rather than a silently signed-out visitor that hides a wiring mistake. */
const AuthStateContext = createContext<AuthValue | null>(null);

/**
 * The actions, private to this module: consumers reach them through `useAuthDispatch()`. State and
 * actions travel in two contexts on purpose: a control that only ever changes the session reads this
 * one, whose value holds callbacks that are stable for the life of the provider and is therefore
 * created once and never replaced, so such a control is not re-rendered when the session changes.
 * One context carrying both would re-render every one of them on every sign-in and sign-out.
 */
const AuthActionsContext = createContext<AuthActions | null>(null);

// The states this module publishes ---------------------------------------------------------------

/** The state of a visitor who is not signed in, shared rather than allocated per render. */
const SIGNED_OUT_STATE: AuthState = { status: "idle", session: null, customer: null, error: null };

/** The state while an action or the mount revalidation is in flight. */
const PENDING_STATE: AuthState = { status: "loading", session: null, customer: null, error: null };

/**
 * What one session revalidation resolves to: the session a stored token still names and the account
 * behind it, or two nulls when there is nothing to adopt — no token to ask with, or a token the local
 * expiry rule has already retired. The two travel together because a session without its account is
 * not a state a screen can render.
 */
interface RestoredIdentity {
  readonly session: Session | null;
  readonly customer: Customer | null;
}

/** The answer a revalidation with nothing to adopt resolves to. */
const NO_IDENTITY: RestoredIdentity = { session: null, customer: null };

// Projections ------------------------------------------------------------------------------------

/**
 * Whether a stored payload is a session token: a non-empty string, or the `null` a store holding none
 * reads back as. The content is judged no further — the `ses_` prefix proves nothing, and whether a
 * token is real is the store's decision, which `restoreSession` asks. So content another build wrote
 * cannot reach the lookup as though it were a token.
 */
function isStoredToken(value: unknown): value is SessionToken | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

/**
 * The instant a session's expiry is judged against, in the ISO 8601 form `isSessionExpired` parses
 * back to the same moment. The clock is read here because expiry is a fact about now rather than
 * about the record, and it is read in UTC rather than through the local-time helper in
 * `src/utils/dates.ts`, which is outside this file's dependency set: the parser behind
 * `isSessionExpired` reads both forms, so neither reading changes the answer.
 */
function nowInstant(): IsoDateTimeString {
  return new Date().toISOString();
}

/**
 * The session this module treats as one worth acting on, or `null`. `src/lib/authService.ts` decides
 * what that means — a session holding no token, or claiming the `guest` role no account is ever
 * stored as, authenticates nobody — so a record that cannot be used is reported as a visitor who is
 * not signed in rather than rendered as a session.
 */
function usableSession(session: Session | null): Session | null {
  return session !== null && isAuthenticated(session) ? session : null;
}

/**
 * The value a consumer reads, derived from the state during render: every member beyond the state is
 * a projection of the session or of the account, computed here and never stored. A name and an email
 * the client does not have are reported as absent rather than invented, and a visitor holding no
 * usable session reports the `guest` role and no identity.
 */
function derivedValue(state: AuthState): AuthValue {
  const session = usableSession(state.session);
  const account = session === null ? null : state.customer;
  const administrator = session !== null && isAdministrator(session);
  const name = account === null ? "" : displayName(account);
  return {
    status: state.status,
    session: state.session,
    customer: state.customer,
    error: state.error,
    role: session === null ? "guest" : session.role,
    isAuthenticated: session !== null,
    isAdministrator: administrator,
    isCustomer: session !== null && session.role === "customer",
    displayName: name,
    email: account === null ? null : account.email,
  };
}

// Provider ---------------------------------------------------------------------------------------

/**
 * Holds the session and provides it, with its actions, to everything below.
 *
 * Two pieces of state carry it. The first is the token read from storage, which is the subject of the
 * mount revalidation and nothing else — every request a signed-in client makes takes its token from
 * the session this context holds, not from here. The second is the outcome of the most recent action,
 * or `null` while the revalidation is the state's only source; an action's outcome is adopted as soon
 * as it is known, which is the decision that lets a guard reading `isAuthenticated` see the session a
 * sign-in just obtained rather than an answer that arrives a request later.
 *
 * The mount revalidation is `useAsync`, keyed on the stored token and enabled only while one is held:
 * a visitor with nothing stored stays `idle` and no request is issued for them, while a stored token
 * is revalidated by the store that issued it rather than trusted from storage. Its outcome is not
 * copied into state — the published state is composed from the query and the adopted outcome during
 * render — which is what stops a response that settles after the component is gone from setting
 * anything. Hydration happens once, in a lazy initialiser, so the token is read before the first
 * render rather than arriving in an effect a frame later.
 *
 * @param props.children - The subtree that may read the session and dispatch its actions.
 * @returns The two providers, state outermost, wrapping the subtree.
 */
export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  // The token alone is persisted, never the session: the role and the expiry it carries are the
  // store's to state, and every read and write of the entry goes through `src/utils/storage.ts`.
  const [storedToken, setStoredToken] = useState<SessionToken | null>(() =>
    readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null, isStoredToken),
  );
  const [adopted, setAdopted] = useState<AuthState | null>(null);

  const restore = useAsync<RestoredIdentity>(
    async (signal: AbortSignal): Promise<Result<RestoredIdentity>> => {
      // `enabled` keeps this run out of the way while nothing is stored; the branch is what makes the
      // run total rather than conditional on an option the caller cannot see.
      if (storedToken === null) return { ok: true, value: NO_IDENTITY };

      const answer = await restoreSessionRequest(storedToken);
      if (!answer.ok) {
        // The lookup failed, so nothing here can vouch for the stored token: the entry goes, and the
        // next load starts from a signed-out visitor instead of asking with it again. The failure is
        // returned rather than absorbed, so the outcome is reported instead of degrading silently.
        removeStored(STORAGE_KEYS.SESSION);
        setStoredToken(null);
        return answer;
      }

      const session = answer.value;
      if (isSessionExpired(session, nowInstant())) {
        // A session the store still records but which has lapsed: nothing is adopted and nothing
        // stays stored, so the visitor is signed out on every later load as well as on this one.
        removeStored(STORAGE_KEYS.SESSION);
        setStoredToken(null);
        return { ok: true, value: NO_IDENTITY };
      }

      // The session lookup accepts no options, so there is nothing to cancel it with; the identity
      // read does, and the signal `useAsync` supplies is forwarded into it, so a request that could
      // outlive this component is aborted rather than left to settle into nothing.
      const profile = await getProfile(session.customerId, {
        sessionToken: session.token,
        signal,
      });
      if (!profile.ok) return profile;
      return { ok: true, value: { session, customer: profile.value } };
    },
    [storedToken],
    { enabled: storedToken !== null },
  );

  /**
   * The state this provider publishes: what the last action adopted, or what the mount revalidation
   * resolved, or a signed-out visitor when there was nothing to revalidate.
   *
   * Composed during render rather than copied into state from an effect, which is what keeps a settled
   * response from writing a value a newer render has already moved past. An action's outcome wins
   * because it is the newest thing the visitor asked for; a revalidation's failure is reported as a
   * failure rather than as a silent sign-out, so a visitor whose stored session has lapsed learns why.
   */
  const state = useMemo<AuthState>(() => {
    if (adopted !== null) return adopted;
    switch (restore.status) {
      case "idle":
        return SIGNED_OUT_STATE;
      case "loading":
        return PENDING_STATE;
      case "success": {
        const identity = restore.data;
        if (identity === null || identity.session === null) return SIGNED_OUT_STATE;
        return {
          status: "success",
          session: identity.session,
          customer: identity.customer,
          error: null,
        };
      }
      case "error":
        return { status: "error", session: null, customer: null, error: restore.error };
    }
  }, [adopted, restore.data, restore.error, restore.status]);

  // The state the actions read, held in a ref: a callback cannot depend on the state without changing
  // identity every time the session does, and an action whose identity changes re-renders every
  // consumer of the actions — the re-render the split contexts exist to avoid. Kept current by an
  // effect rather than during render, so no render writes it.
  const stateRef = useRef<AuthState>(SIGNED_OUT_STATE);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const value = useMemo<AuthValue>(() => derivedValue(state), [state]);

  const signIn = useCallback(async (credentials: Credentials): Promise<Result<Session>> => {
    const before = stateRef.current;
    setAdopted({ ...before, status: "loading", error: null });
    const answer = await signInRequest(credentials);
    if (!answer.ok) {
      // A refused sign-in leaves whatever session was already in force alone and records the failure,
      // which the form maps onto its fields through `toAuthFieldErrors`.
      setAdopted({
        status: "error",
        session: before.session,
        customer: before.customer,
        error: answer.error,
      });
      return answer;
    }

    const session = answer.value;
    if (isSessionExpired(session, nowInstant())) {
      // The store issued a session the local expiry rule judges lapsed — the one direction the two
      // clocks can disagree about. Nothing is adopted and nothing is persisted, so the visitor is not
      // signed in; the store's own answer is still what the form receives, because a refusal the
      // store did not make is not invented here.
      removeStored(STORAGE_KEYS.SESSION);
      setAdopted(SIGNED_OUT_STATE);
      return answer;
    }

    writeStored(STORAGE_KEYS.SESSION, session.token);
    const profile = await getProfile(session.customerId, { sessionToken: session.token });
    setAdopted(
      profile.ok
        ? { status: "success", session, customer: profile.value, error: null }
        : { status: "error", session, customer: null, error: profile.error },
    );
    return answer;
  }, []);

  const register = useCallback(
    async (input: RegistrationInput): Promise<Result<RegistrationResult>> => {
      const before = stateRef.current;
      setAdopted({ ...before, status: "loading", error: null });
      const answer = await registerAccount(input);
      if (!answer.ok) {
        setAdopted({
          status: "error",
          session: before.session,
          customer: before.customer,
          error: answer.error,
        });
        return answer;
      }

      const { session, customer } = answer.value;
      if (isSessionExpired(session, nowInstant())) {
        removeStored(STORAGE_KEYS.SESSION);
        setAdopted(SIGNED_OUT_STATE);
        return answer;
      }

      writeStored(STORAGE_KEYS.SESSION, session.token);
      setAdopted({ status: "success", session, customer, error: null });
      return answer;
    },
    [],
  );

  // Both come from `useAsync` and are stable for the life of the provider, which is what keeps the
  // actions object below created once.
  const resetRestore = restore.reset;
  const reloadRestore = restore.reload;

  const signOut = useCallback(async (): Promise<void> => {
    const session = stateRef.current.session;
    if (session !== null) {
      // Best effort by nature: the store is asked to retire the token and a refusal changes nothing
      // for the visitor, whose session this client drops either way. Awaiting it keeps the promise
      // honest — the request has been answered by the time a caller navigates.
      await signOutRequest(session.token);
    }
    removeStored(STORAGE_KEYS.SESSION);
    setStoredToken(null);
    setAdopted(SIGNED_OUT_STATE);
    // The revalidation's own answer is discarded with the session, so a restored identity does not
    // linger in memory behind the signed-out state, and anything still in flight is aborted.
    resetRestore();
  }, [resetRestore]);

  const restoreSession = useCallback((): Promise<void> => {
    reloadRestore();
    // The outcome arrives through the state rather than through this promise: the run it starts
    // settles in its own time, and a caller that needs to observe it reads `status` and `error` from
    // the value the provider publishes.
    return Promise.resolve();
  }, [reloadRestore]);

  const refresh = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const session = usableSession(current.session);
    if (session === null) return;
    const profile = await getProfile(session.customerId, { sessionToken: session.token });
    setAdopted(
      profile.ok
        ? { status: "success", session, customer: profile.value, error: null }
        : {
            status: "error",
            // The session stands — the store issued it and every request still carries it — so only
            // the projection failed, and the account as it last read is kept.
            session,
            customer: current.customer,
            error: profile.error,
          },
    );
  }, []);

  const actions = useMemo<AuthActions>(
    () => ({ signIn, register, signOut, restoreSession, refresh }),
    [signIn, register, signOut, restoreSession, refresh],
  );

  return (
    <AuthStateContext value={value}>
      <AuthActionsContext value={actions}>{children}</AuthActionsContext>
    </AuthStateContext>
  );
}

// Consumer hooks ---------------------------------------------------------------------------------

/**
 * Reads the session: its status, the session in force, the account behind it and the derived facts a
 * screen branches on. Returns the provider's memoised value, so two components calling this while
 * nothing about the session changed receive the same object, and an unrelated parent render does not
 * re-render a consumer. A component that only ever changes the session reads `useAuthDispatch()`,
 * which is what keeps it out of the session's renders.
 *
 * @returns The session as `AuthValue`.
 * @throws When called above every `AuthProvider` — an application wiring mistake, not a state a
 *   visitor can reach — naming the missing provider.
 */
export function useAuth(): AuthValue {
  const value = useContext(AuthStateContext);
  if (value === null) {
    throw new Error("useAuth must be called from a component within an AuthProvider.");
  }
  return value;
}

/**
 * Reads the five actions that change the session. Returns the provider's memoised action object,
 * whose members are stable for the life of the provider, so a component can list one in a dependency
 * array or hand it to a memoised child without re-rendering that child on every session change.
 * Nothing returned here reads the session, which lets a sign-out button render independently of it.
 *
 * @returns The session's actions as `AuthActions`.
 * @throws When called above every `AuthProvider`, naming the missing provider.
 */
export function useAuthDispatch(): AuthActions {
  const actions = useContext(AuthActionsContext);
  if (actions === null) {
    throw new Error("useAuthDispatch must be called from a component within an AuthProvider.");
  }
  return actions;
}
