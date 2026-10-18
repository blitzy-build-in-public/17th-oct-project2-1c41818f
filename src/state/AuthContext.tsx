/**
 * Path: src/state/AuthContext.tsx
 * Purpose: Session state with sign-in and sign-out actions, role helpers and restore on mount
 * Lines: 535
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
import { FEEDBACK_COPY } from "@/constants/content";
import { watchSessionRefusals } from "@/lib/apiClient";
import { isSessionRefusal } from "@/lib/apiContract";
import {
  authErrorMessage,
  isSessionExpired,
  register as registerAccount,
  signIn as signInRequest,
  signOut as signOutRequest,
} from "@/lib/authService";
import { getProfile } from "@/lib/customerService";
import {
  NO_IDENTITY,
  PENDING_STATE,
  SIGNED_OUT_STATE,
  derivedValue,
  isStoredToken,
  nowInstant,
  readStoredSession,
  usableSession,
} from "@/state/authSession";
import type { AuthState, AuthValue, RestoredIdentity } from "@/state/authSession";
import { useToast } from "@/state/ToastContext";
import { useAsync } from "@/state/hooks";
import type { Credentials, RegistrationInput, RegistrationResult, Session } from "@/types/account";
import type { Result, SessionToken } from "@/types/common";
import { readStored, removeStored, writeStored } from "@/utils/storage";

/**
 * Who the visitor is: the session this client holds, the account behind it, and the five actions that
 * change either. The header's account menu, the route guards, the checkout's contact prefill and the
 * account screens read it here, and none of them owns the session.
 *
 * The rules are not restated here. `src/lib/authService.ts` owns the session lifecycle and every role
 * and expiry decision — this module calls `signIn`, `signOut`, `register` and `isSessionExpired` rather
 * than repeating one of them — and `src/utils/storage.ts` is the product's only reader and writer of the
 * store. What this file owns is orchestration — holding the session, changing it and announcing the
 * change — and each decision it makes is recorded where it is made.
 *
 * The reading half of the session lives beside it: `src/state/authSession.ts` owns the contract a
 * consumer reads (`AuthState` and `AuthValue`), the states a revalidation publishes, the retried read
 * behind the mount revalidation and the projections computed from the state. That split is what keeps
 * this file inside the request's 600-line ceiling, which is never raised; what stays here is the writing
 * half — the two contexts, the provider that holds and changes the session, and the two consumer hooks.
 *
 * Authentication here is a demonstration account store, not a security boundary: the credential is an
 * opaque `ses_` token the in-browser store issues and no real credential stands behind it. A real
 * deployment moves session issue, expiry and verification behind the server that
 * `src/lib/apiClient.ts` is built to be repointed at, and the rules this file calls move with it.
 */

// What a consumer dispatches ---------------------------------------------------------------------

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
   * token, the persisted entry is dropped, the revalidation's answer is discarded with it, and the
   * transition is announced as a notification. The local session is gone whether or not the store
   * answers, because a session the visitor has given up must not stay in use by the client.
   */
  readonly signOut: () => Promise<void>;

  /**
   * Re-asks the store which session the persisted token still names, which is what a surface calls
   * when a request came back `401` and the answer is worth confirming before the visitor is sent back
   * to sign-in. The provider calls it itself for the same reason, from the transport's report of a
   * refusal, so a `401` answered to any request in the product reaches this one decision.
   *
   * A visitor holding no persisted token has nothing to revalidate, so the call resolves without a
   * request, and the outcome arrives through the state rather than through this promise: the
   * revalidation settles in its own time, and a caller that needs to observe it reads `status` and
   * `error` from the value the provider publishes. A refusal clears the stored entry, signs the visitor
   * out and is announced; any other failure keeps the entry and is reported as the state's error,
   * because only a refusal says the credential is no longer accepted.
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

// Provider ---------------------------------------------------------------------------------------

/**
 * Holds the session and provides it, with its actions, to everything below.
 *
 * Two things carry it: the token this client holds — read from storage in the lazy initialiser, adopted
 * whenever an action opens a session and cleared whenever one ends — which is the subject of the mount
 * revalidation and nothing else (every request a signed-in client makes takes its token from the session
 * this context holds, not from here), and the outcome of the most recent action, or `null` while the
 * revalidation is the state's only source. An action's outcome is adopted as soon as it is known, which is
 * what lets a guard reading `isAuthenticated` see the session a sign-in just obtained rather than an answer
 * that arrives a request later.
 *
 * The token is held in a ref rather than in state because nothing renders it, and that is what holds the
 * revalidation's inputs still: the read runs once at mount against whatever token was stored and again only
 * when `restoreSession` asks for it, so a sign-in cannot set a second read of a session the store has just
 * issued going. What reads the token is the read itself, taking the one the client holds at the moment it
 * runs — including one a sign-in has just opened, which is what lets a `401` met later in the document be
 * confirmed and signed out against.
 *
 * That read is `useAsync` over a runner that reads the ref, and it is the one read that decides whether a
 * session already in force still stands, so it writes its verdict into the adopted outcome as well as into
 * the query: a refused or lapsed session clears what an earlier action adopted, which is what stops a guard
 * admitting a visitor the store no longer serves. A visitor holding no token issues no request at all — the
 * runner reports no identity on that branch — so the mount run costs them a render and nothing more. Nothing
 * else is copied into state — the published state is composed from the query and that outcome during render,
 * which is what stops a response settling after the component is gone from setting anything — and the token
 * is hydrated once, in a lazy initialiser, so it is read before the first render.
 *
 * That read is classified and retried rather than treated as one outcome: `session-expired` and
 * `session-unknown` say the credential carried is no longer accepted, so the entry goes and the visitor
 * is signed out, while any other failure — a store that could not answer — says nothing about the token,
 * so the entry stays and the failure is reported for the guard to offer its retry against. `retry`
 * repeats the second class and never the first, because a request the store has already refused would be
 * refused again.
 *
 * Two things follow the transitions, because a transition nothing announces is one the visitor cannot
 * account for: every sign-out this provider performs — an explicit one, a confirmed refusal, and a
 * session the local clock found lapsed — raises the sentence the content library already words for it,
 * and a refusal met by any other request reaches this provider through `watchSessionRefusals`, so the
 * decision to sign out keeps one home. The revalidation's own read is the session endpoint's, which the
 * transport does not report back, so the provider cannot answer its own report for ever.
 *
 * @param props.children - The subtree that may read the session and dispatch its actions.
 * @returns The two providers, state outermost, wrapping the subtree.
 */
export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  // The notification surface a session transition is announced through. `ToastProvider` is mounted above
  // this provider in `src/App.tsx`, and its helpers are stable, so reading it here costs no re-render.
  const { info } = useToast();

  /** Announces a session transition in the informational register: nothing has failed for the visitor to
   *  act on, and the sentence comes from the content library rather than being written here. */
  const announce = useCallback(
    (message: string): void => {
      info(message);
    },
    [info],
  );

  // The token alone is persisted, never the session: the role and the expiry it carries are the
  // store's to state, and every read and write of the entry goes through `src/utils/storage.ts`.
  //
  // It is held in a ref rather than in state because nothing renders it: the revalidation is its only
  // reader, and a token in state would be a dependency of that read, so a sign-in would fire a second
  // full revalidation — a session read and an identity read — for a session the store has just issued.
  // `useRef`'s argument is evaluated on every render, so the storage read is taken once in the lazy
  // initialiser and handed to the ref, which then carries it for the life of the provider.
  const [storedTokenAtMount] = useState<SessionToken | null>(() =>
    readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null, isStoredToken),
  );
  const tokenRef = useRef<SessionToken | null>(storedTokenAtMount);
  const [adopted, setAdopted] = useState<AuthState | null>(null);

  /**
   * Adopts a token the store has just issued: it is persisted through `src/utils/storage.ts`, and it
   * becomes the token this client revalidates.
   *
   * That second half is what keeps a refusal reachable mid-session. The held token is the subject of every
   * revalidation, so a session opened in this document is one a `401` met later in the same document can be
   * confirmed and signed out against; while the token is persisted and nothing else, a refusal reported
   * after a sign-in would have nothing to ask the store about, and the visitor would sit in error states as
   * a signed-in visitor the store no longer serves.
   *
   * @param token - The session token the store issued.
   */
  const adoptToken = useCallback((token: SessionToken): void => {
    tokenRef.current = token;
    writeStored(STORAGE_KEYS.SESSION, token);
  }, []);

  const restore = useAsync<RestoredIdentity>(
    async (signal: AbortSignal): Promise<Result<RestoredIdentity>> => {
      // The token is read from the ref at run time, which is what holds this run's inputs still: a sign-in
      // or a sign-out changes the ref and nothing this hook compares. A run holding no token has no request
      // to make, which is what lets the mount run be issued for every visitor and stay cheap for one with
      // nothing stored; a run that has one asks about the token the client holds now, including one a
      // sign-in has just opened.
      const token = tokenRef.current;
      if (token === null) return { ok: true, value: NO_IDENTITY };

      const answer = await readStoredSession(token, signal);
      if (!answer.ok) {
        const failure = answer.error;
        // Before any mutation: a superseded run changes nothing — not the entry, not the state, not an
        // announcement — because the run that replaced it owns all three from here on.
        if (signal.aborted) return { ok: false, error: failure };
        if (isSessionRefusal(failure)) {
          // The refusal is the one failure that says the session is over: the entry goes, so no later
          // load asks with it again; the session an action adopted is cleared, so no guard admits a
          // visitor the store no longer serves; and the change is announced to explain the redirect.
          removeStored(STORAGE_KEYS.SESSION);
          tokenRef.current = null;
          setAdopted({ status: "error", session: null, customer: null, error: failure });
          announce(authErrorMessage(failure));
          return { ok: false, error: failure };
        }
        // Any other failure says nothing about the token, so the entry stays and nothing is adopted: the
        // composition below reports it, and the guard offers the standard retry instead of a sign-out.
        return { ok: false, error: failure };
      }

      const session = answer.value;
      if (isSessionExpired(session, nowInstant())) {
        // A session the store still records but which has lapsed: nothing stays stored and nothing is
        // adopted — the outcome an earlier action adopted included — so the visitor is signed out here
        // and on every later load.
        if (signal.aborted) return { ok: true, value: NO_IDENTITY };
        removeStored(STORAGE_KEYS.SESSION);
        tokenRef.current = null;
        setAdopted(SIGNED_OUT_STATE);
        announce(FEEDBACK_COPY.TOAST_SESSION_EXPIRED);
        return { ok: true, value: NO_IDENTITY };
      }

      // The session lookup accepts no options, so there is nothing to cancel it with; the identity read
      // does, and the signal `useAsync` supplies is forwarded into it, so a request that could outlive
      // this component is aborted rather than left to settle into nothing.
      const profile = await getProfile(session.customerId, {
        sessionToken: session.token,
        signal,
      });
      // A superseded run adopts nothing: the session it read belongs to a token no longer stored.
      if (signal.aborted) return { ok: true, value: NO_IDENTITY };
      if (!profile.ok) return profile;
      return { ok: true, value: { session, customer: profile.value } };
    },
    // An empty deps list, and the default options: this runs once at mount, against whatever token the
    // lazy initialiser read, and again only when `restoreSession` calls `reload()`. Keying it on the token
    // would make every sign-in fire a second full revalidation — a session read and an identity read — for
    // a session the store has just issued and no consumer needs re-checked.
    [],
  );

  /**
   * The state this provider publishes: what the last action adopted, or what the mount revalidation
   * resolved, or a signed-out visitor when there was nothing to revalidate.
   *
   * Composed during render rather than copied into state from an effect, which is what keeps a settled
   * response from writing a value a newer render has already moved past. An action's outcome wins because
   * it is the newest thing the visitor asked for, and the revalidation writes the sign-out it confirms
   * into that same outcome — so a refused or lapsed session clears what an earlier action adopted. A
   * failure that is not a refusal says nothing about the token, so it is reported as a failure rather
   * than as a silent sign-out, and the guard turns it into the standard retry.
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

  const signIn = useCallback(
    async (credentials: Credentials): Promise<Result<Session>> => {
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
        tokenRef.current = null;
        setAdopted(SIGNED_OUT_STATE);
        return answer;
      }

      adoptToken(session.token);
      const profile = await getProfile(session.customerId, { sessionToken: session.token });
      setAdopted(
        profile.ok
          ? { status: "success", session, customer: profile.value, error: null }
          : { status: "error", session, customer: null, error: profile.error },
      );
      return answer;
    },
    [adoptToken],
  );

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
        tokenRef.current = null;
        setAdopted(SIGNED_OUT_STATE);
        return answer;
      }

      adoptToken(session.token);
      setAdopted({ status: "success", session, customer, error: null });
      return answer;
    },
    [adoptToken],
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
    tokenRef.current = null;
    setAdopted(SIGNED_OUT_STATE);
    // The revalidation's own answer is discarded with the session, so a restored identity does not
    // linger in memory behind the signed-out state, and anything still in flight is aborted.
    resetRestore();
    // Announced for a session the visitor gave up as for one that lapsed: both end signed out, and a
    // sign-out nothing announces leaves the header's change unexplained.
    announce(FEEDBACK_COPY.TOAST_SIGNED_OUT);
  }, [announce, resetRestore]);

  const restoreSession = useCallback((): Promise<void> => {
    reloadRestore();
    // The outcome arrives through the state rather than through this promise: the run it starts
    // settles in its own time, and a caller that needs to observe it reads `status` and `error` from
    // the value the provider publishes.
    return Promise.resolve();
  }, [reloadRestore]);

  // The transport's report of a refusal met by any request in the product: the same revalidation a
  // surface would ask for, so the decision to sign out keeps one home. The revalidation's own read is
  // the session endpoint's, which the transport does not report back, so this cannot answer itself.
  useEffect(() => watchSessionRefusals(() => void restoreSession()), [restoreSession]);

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
