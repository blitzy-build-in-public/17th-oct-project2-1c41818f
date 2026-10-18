/**
 * Path: tests/integration/sessionLifecycle.test.tsx
 * Purpose: The session's lifecycle: the stored token revalidated on mount, the refusal, the lapse and the sign-out that end it and announce it, and the durable issuance table the endpoints answer from.
 * Lines: 461
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, STORAGE_KEYS } from "@/constants/config";
import { ACCOUNT_COPY, A11Y_COPY, COMMON_ACTIONS, FEEDBACK_COPY } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { createSalesProDataSource } from "@/data/repositories";
import { getJson, postJson } from "@/lib/apiClient";
import { API_PATHS, registerDataSource } from "@/lib/mockServer";
import type { Session } from "@/types/account";
import type { ApiError, Result, SessionToken } from "@/types/common";
import { defaultReportRange, toIsoDateTime } from "@/utils/dates";
import { sessionToken } from "@/utils/strings";
import { readStored, writeStored } from "@/utils/storage";

import { failNext, renderApp, resetApiState, screen, waitFor } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * The session's lifecycle, driven from both ends.
 *
 * The first describe mounts the real application through the harness's `renderApp` and reaches each
 * failure by arming the API seam's own switch, so what it observes is what a visitor meets: the guard's
 * error state and its retry, the redirect to sign-in, the entry still in the store or gone, and the
 * sentence announced in a live region. The second binds the store's data source and asks the endpoints
 * directly, so what it observes is what the durable table behind them answers — the reload it exists
 * for. Nothing here stands in for a service, a reducer, a context or a data module, and no case asserts
 * on an internal structure: every assertion is about rendered text, a persisted entry or an endpoint's
 * answer.
 *
 * The two halves share their helpers rather than each spelling them out: the token both use when no
 * store has issued a session, the shopper's credentials, the unwrappers a case reads an endpoint's
 * outcome with, and the pattern a required field's label is found by are written once, below.
 */

// The facts both halves share ---------------------------------------------------------------------

/** The seeded shopper's credentials, the account every sign-in in this file uses. */
const SHOPPER = { email: DEMO_ACCOUNTS.CUSTOMER_EMAIL, password: DEMO_ACCOUNTS.PASSWORD } as const;

/** A token no store has issued a session for: the credential a case hands a store that is refusing to
 *  answer, and the one a store that answers is asked about to prove it knows nothing of it. */
const ABSENT_TOKEN: SessionToken = sessionToken("a session no store has ever held");

/** One day in milliseconds, the unit a session's window is moved by. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The account profile read a signed-in client makes: one account by id, and nothing beneath it. */
const ACCOUNT_READ = /^\/api\/customers\/[^/]+$/;

/** The pattern a field's label is found by: a required field's label continues past its copy with a marker
 *  and a visually hidden sentence, so its whole text is never the copy alone. */
function fieldLabel(label: string): RegExp {
  return new RegExp(`^${label}`);
}

// Driving the application -------------------------------------------------------------------------

/** Signs in through the real form as the seeded shopper; the fields are cleared first so a second sign-in
 *  from a remounted screen is not typed onto a leftover value. */
async function signInAsShopper(user: UserEvent): Promise<void> {
  const email = await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL));
  const password = screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL));
  await user.clear(email);
  await user.clear(password);
  await user.type(email, SHOPPER.email);
  await user.type(password, SHOPPER.password);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
}

/** The history's table, which its own caption names: waiting on it is what proves the orders screen
 *  rendered for the session a case signed in with. */
function listedTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: ACCOUNT_COPY.ORDERS_HEADING });
}

/** The response latency the two cancellation cases stub, in milliseconds: long enough that the request is
 *  still waiting when the provider unmounts, so a request nothing cancelled is answered only after the
 *  window below has passed. */
const STUBBED_LATENCY_MS = 500;

/** Waits out that window: twice the stubbed latency, which is longer than any request the cases start can
 *  take once it is aborted, and long enough that one left to settle past the unmount has been answered —
 *  the outcome the cases assert the absence of. */
async function waitOutRequestWindow(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 2 * STUBBED_LATENCY_MS);
  });
}

// Driving the seam --------------------------------------------------------------------------------

/** The payload a successful call resolved with, asserted rather than assumed. */
function valueOf<TValue>(result: Result<TValue>): TValue {
  if (!result.ok) throw new Error(`Expected a payload, resolved with ${result.error.code}.`);
  return result.value;
}

/** The refusal a refused call resolved with, asserted rather than assumed. */
function refusalOf(result: Result<unknown>): ApiError {
  if (result.ok) throw new Error("Expected a refusal, resolved with a payload.");
  return result.error;
}

/** Binds a store built now: the document a reload creates, reading the durable table the mint wrote. */
function openDocument(): void {
  registerDataSource(createSalesProDataSource());
}

/** Signs the seeded shopper in through the endpoint and answers the session it minted. */
async function mintSession(): Promise<Session> {
  return valueOf(await postJson<Session>(API_PATHS.AUTH_LOGIN, SHOPPER));
}

/** Reads the session the seam answers for a token, or the refusal it earns. */
async function readSession(token: string): Promise<Result<Session>> {
  return await getJson<Session>(API_PATHS.AUTH_SESSION, { sessionToken: token });
}

/** The session table as it stands in the store. */
function storedTable(): readonly Session[] {
  return readStored<Session[]>(STORAGE_KEYS.SESSIONS, []);
}

/** Moves one token's record into the past by whole days, keeping the seven-day window it was issued with
 *  coherent, and writes the table back — the state a visitor reloads into a day after their session lapsed. */
function backdate(token: string, days: number): void {
  const shift = days * DAY_MS;
  const moved = storedTable().map((session) =>
    session.token === token
      ? {
          ...session,
          issuedAt: toIsoDateTime(new Date(Date.parse(session.issuedAt) - shift)),
          expiresAt: toIsoDateTime(new Date(Date.parse(session.expiresAt) - shift)),
        }
      : session,
  );
  expect(moved.some((session) => session.token === token)).toBe(true);
  expect(writeStored(STORAGE_KEYS.SESSIONS, moved)).toBe(true);
}

describe("the session read's refusals", () => {
  beforeEach(() => {
    resetApiState();
  });

  it("keeps the stored token and offers the guard's retry when the session read cannot be answered", async () => {
    writeStored(STORAGE_KEYS.SESSION, ABSENT_TOKEN);
    // The read is retried, so every attempt is armed: three arms are the three attempts the read makes.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      failNext({ routeId: "auth.session", status: 500, code: "unexpected-error" });
    }

    const { user } = renderApp({ route: ROUTES.ACCOUNT_ORDERS });

    // The guard stayed on the guarded route with the section's error state, not the sign-in screen.
    const retry = await screen.findByRole(
      "button",
      { name: COMMON_ACTIONS.RETRY },
      { timeout: 4000 },
    );
    expect(retry).toBeVisible();
    expect(screen.queryByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeNull();
    // A failure that says nothing about the credential is not an expiry: the entry is still held.
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBe(ABSENT_TOKEN);

    // The retry asks the store again, which refuses this token as one it never issued: that refusal ends
    // the session, so the visitor is turned away and the entry goes.
    await user.click(retry);
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
  });

  it("signs a refused session out, clears the token and announces the expiry", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });

    // The visitor signs in with the store answering normally, so the session in force is a real one and
    // the token this client holds is the one the store issued.
    await signInAsShopper(user);
    await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).not.toBeNull();

    // The store then refuses the section's own read — the `401` a surface meets, which is what tells the
    // product a request was refused — as well as the session read the transport's report starts.
    const armed = failNext({ path: API_PATHS.ORDERS, status: 401, code: "session-expired" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      failNext({ routeId: "auth.session", status: 401, code: "session-expired" });
    }
    await user.click(screen.getByRole("link", { name: ACCOUNT_COPY.NAV_ORDERS_LABEL }));

    // The refusal ends the session: the persisted entry is gone and the visitor is back at sign-in.
    await waitFor(() => {
      expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
    });
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();

    // The transition is announced in a live region rather than happening silently.
    const announcement = await screen.findByText(FEEDBACK_COPY.TOAST_SESSION_EXPIRED);
    expect(announcement).toBeVisible();
    expect(announcement.closest('[role="status"]')).not.toBeNull();

    // Nothing is left armed, so the sign-in that follows is answered by the store itself — and it lands on
    // the path the redirect preserved, which is what proves `returnTo` carried the orders route.
    armed.disarm();
    await signInAsShopper(user);
    expect(await listedTable()).toBeVisible();
  });

  it("signs a stored session out when the store refuses the read that revalidates it", async () => {
    // A first document signs the visitor in, which is where the stored token comes from.
    const first = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(first.user);
    await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
    const token = readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null);
    expect(token).not.toBeNull();
    first.unmount();

    // A fresh document holding that token asks the store to revalidate it, and the store refuses it.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      failNext({ routeId: "auth.session", status: 401, code: "session-expired" });
    }
    renderApp({ route: ROUTES.ACCOUNT_ORDERS });

    await waitFor(() => {
      expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
    });
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
    const announcement = await screen.findByText(FEEDBACK_COPY.TOAST_SESSION_EXPIRED);
    expect(announcement.closest('[role="status"]')).not.toBeNull();
  });

  it("announces a sign-out from the header's account menu", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });

    await user.click(screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL }));
    await user.click(await screen.findByRole("button", { name: COMMON_ACTIONS.SIGN_OUT }));

    const announcement = await screen.findByText(FEEDBACK_COPY.TOAST_SIGNED_OUT);
    expect(announcement).toBeVisible();
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
  });

  it("revalidates once per mount: the guard's retry asks the store again and a sign-in asks it nothing", async () => {
    // A token the store holds no session for, so the read the retry starts is refused and the visitor is
    // turned away — the state a sign-in starts from.
    writeStored(STORAGE_KEYS.SESSION, ABSENT_TOKEN);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      failNext({ routeId: "auth.session", status: 500, code: "unexpected-error" });
    }

    const { user } = renderApp({ route: ROUTES.ACCOUNT_ORDERS });
    const retry = await screen.findByRole(
      "button",
      { name: COMMON_ACTIONS.RETRY },
      { timeout: 4000 },
    );

    // Counting starts here, and it is the seam's own entry point that counts: every request in the product
    // is dispatched through `handleRequest`, so a request nobody expects cannot hide from this list.
    const seam = await import("@/lib/mockServer");
    const dispatched = vi.spyOn(seam, "handleRequest");
    const requests = (): readonly { readonly method: string; readonly path: string }[] =>
      dispatched.mock.calls.map(([path, options]) => ({ method: options?.method ?? "GET", path }));
    const sessionReads = (calls: readonly { readonly path: string }[]): number =>
      calls.filter((call) => call.path === API_PATHS.AUTH_SESSION).length;

    // The guard's retry is the revalidation asked for by hand: it asks the store about the token this client
    // holds — the exact one per click — and the refusal it earns is the sign-out, so the entry goes too.
    await user.click(retry);
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
    expect(sessionReads(requests())).toBe(1);
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();

    // The sign-in that follows is the case the finding is about: the store issues a session, the visitor
    // lands signed in on the route the redirect preserved, and the requests made for it are its own — the
    // login and the one account read behind it. No `GET /api/auth/session` follows, because the revalidation
    // runs once per mount and not again for the token a sign-in has just opened. The catalogue and facet
    // reads in the same window belong to the landing route, not to the session.
    const beforeSignIn = requests().length;
    await signInAsShopper(user);
    expect(await listedTable()).toBeVisible();
    const signInCalls = requests().slice(beforeSignIn);

    // Signed in: the guarded route rendered for a customer session and the header offers its account menu.
    expect(screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL })).toBeVisible();

    // Exactly the requests a sign-in needs, and nothing re-asking the store which session the token names.
    expect(signInCalls.filter((call) => call.path === API_PATHS.AUTH_LOGIN)).toEqual([
      { method: "POST", path: API_PATHS.AUTH_LOGIN },
    ]);
    const accountReads = signInCalls.filter((call) => ACCOUNT_READ.test(call.path));
    expect(accountReads.map((call) => call.method)).toEqual(["GET"]);
    expect(sessionReads(signInCalls)).toBe(0);
  });
});

// An action's request outliving its provider: the seam's latency is stubbed so the request is still in
// flight when the tree goes, which is the only way the cancellation is observable — the provider is the
// application root, so unmounting it is what a case has to do. Every assertion below is about what the
// store answered and what the client persisted, never about a controller the product holds internally:
// a request cancelled during the wait never reaches the data source, so the store's own table shows it.
describe("cancelling an action's request when the provider unmounts", () => {
  beforeEach(() => {
    resetApiState();
  });

  // The stub is this describe's mechanism, so it is put back after each of its cases: `tests/setup.ts`
  // sets the suite's zero latency once at module scope and unstubs no environment between tests.
  afterEach(() => {
    vi.stubEnv("VITE_API_LATENCY_MS", "0");
  });

  it("issues no session when a sign-in's request is cancelled by the unmount", async () => {
    vi.stubEnv("VITE_API_LATENCY_MS", String(STUBBED_LATENCY_MS));
    const { user, unmount } = renderApp({ route: ROUTES.LOGIN });

    await signInAsShopper(user);
    unmount();
    await waitOutRequestWindow();

    // The answer was cancelled, so nothing was adopted for it and no token was persisted: the visitor
    // ends signed out on both counts, exactly as one who never submitted does.
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
    // And the store never issued one: the request was aborted during the wait that precedes dispatch,
    // which is what the durable table behind the endpoint shows.
    expect(storedTable()).toHaveLength(0);
  });

  it("drops the local token but leaves the store's record when a sign-out is cancelled", async () => {
    // The sign-in runs at the suite's own zero latency, so the profile this case starts from is reached
    // normally and only the sign-out below is slow.
    const { user, unmount } = renderApp({ route: ROUTES.LOGIN });
    await signInAsShopper(user);
    await screen.findByRole("heading", { name: ACCOUNT_COPY.PROFILE_HEADING });
    const token = readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null);
    expect(token).not.toBeNull();

    vi.stubEnv("VITE_API_LATENCY_MS", String(STUBBED_LATENCY_MS));
    await user.click(screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL }));
    await user.click(await screen.findByRole("button", { name: COMMON_ACTIONS.SIGN_OUT }));
    unmount();
    await waitOutRequestWindow();

    // A session the visitor has given up is dropped from the client whatever the request did...
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
    // ...while the store was never told about it: the cancelled request left the record it would have
    // retired standing, so this is the case the two behaviours are told apart by.
    expect(storedTable().some((session) => session.token === token)).toBe(true);
  });
});

// The durable table behind the endpoints is exercised here rather than through a screen: an issuance that
// a reload keeps is a fact about the store, and every assertion below is about what an endpoint answers.
describe("durable session issuance at the seam", () => {
  beforeEach(() => {
    window.localStorage.clear();
    openDocument();
  });

  it("restores a token in a fresh source with its own issue instant, never re-dating it", async () => {
    const minted = await mintSession();

    openDocument();

    const restored = valueOf(await readSession(minted.token));

    expect(restored.issuedAt).toBe(minted.issuedAt);
    expect(restored.expiresAt).toBe(minted.expiresAt);
    expect(restored).toEqual(minted);
  });

  it("refuses a token whose window has passed with 401 session-expired", async () => {
    const minted = await mintSession();
    // Eight days back: the record's seven-day window ended a day before now, so the token it names has
    // lapsed — the reload case the declared refusal was unreachable for.
    backdate(minted.token, 8);

    openDocument();

    const refused = refusalOf(await readSession(minted.token));

    expect(refused.status).toBe(401);
    expect(refused.code).toBe("session-expired");
  });

  it("refuses a token the store holds no session for with 401 session-unknown", async () => {
    const refused = refusalOf(await readSession(ABSENT_TOKEN));

    expect(refused.status).toBe(401);
    expect(refused.code).toBe("session-unknown");
  });

  it("drops the record on sign-out, so the next document refuses the token", async () => {
    const minted = await mintSession();

    const ended = await postJson<void>(API_PATHS.AUTH_LOGOUT, undefined, {
      sessionToken: minted.token,
    });
    expect(valueOf(ended)).toBeUndefined();
    expect(storedTable().some((session) => session.token === minted.token)).toBe(false);

    openDocument();

    const refused = refusalOf(await readSession(minted.token));

    expect(refused.status).toBe(401);
    expect(refused.code).toBe("session-unknown");
  });

  it("keeps the account's own role and refuses the widened administrator read", async () => {
    const minted = await mintSession();

    // The edit an outsider can make to the durable table: the row's role claim, with the token, the account
    // it names and the window left exactly as this store wrote them.
    const widened: Session[] = storedTable().map((session) =>
      session.token === minted.token ? { ...session, role: "admin" } : session,
    );
    expect(writeStored(STORAGE_KEYS.SESSIONS, widened)).toBe(true);

    openDocument();

    const restored = valueOf(await readSession(minted.token));
    expect(restored.role).toBe("customer");

    // A protected administrator read, asked for the way the dashboard asks: the token a rewritten claim
    // rides on reaches nothing the account does not hold.
    const range = defaultReportRange();
    const denied = refusalOf(
      await getJson<unknown>(`${API_PATHS.ANALYTICS_KPIS}?from=${range.from}&to=${range.to}`, {
        sessionToken: minted.token,
      }),
    );
    expect(denied.status).toBe(403);
  });
});

describe("the guard's wait for the first answer", () => {
  beforeEach(() => {
    resetApiState();
  });

  it("takes no decision from a guard whose screen is gone before its own turn", async () => {
    // The guard waits one turn for the session before it may read the absence of one as an answer. This mount
    // is thrown away inside that turn — synchronously, so the turn it queued is still pending — which is the
    // case the guard's own cancellation exists for: the discarded mount decides nothing, and the mount that
    // follows decides from the session it reads.
    const abandoned = renderApp({ route: ROUTES.ACCOUNT });
    abandoned.unmount();
    await Promise.resolve();

    renderApp({ route: ROUTES.ACCOUNT });
    expect(await screen.findByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeVisible();
  });
});
