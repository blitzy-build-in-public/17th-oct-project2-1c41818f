/**
 * Path: tests/components/authContext.test.tsx
 * Purpose: The session context through its own hooks: the mount revalidation across documents, the refusal that ends a session, and the account actions beside them
 * Lines: 270
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, STORAGE_KEYS } from "@/constants/config";
import { CUSTOMERS } from "@/data/customers";
import { API_PATHS, postJson } from "@/lib/apiClient";
import { displayName } from "@/lib/customerService";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import type { Customer } from "@/types/account";
import type { SessionToken } from "@/types/common";
import { readStored, writeStored } from "@/utils/storage";

import { failNext, renderWithProviders, resetApiState, screen, waitFor } from "../testUtils";
import type { RenderHarness } from "../testUtils";

/*
 * What this file proves, and how.
 *
 * The session is driven the way the product drives it: through `useAuth` and `useAuthDispatch`, inside the
 * providers `tests/testUtils.tsx` mounts, with the real account store and the real transport behind them. Each
 * case renders a probe — a component that paints what the hook reports and raises one call per control —
 * interacts through the returned `user`, and asserts on what the probe painted, so no context, service or data
 * module is replaced. The failure states are reached the way the suite reaches them, by arming the API seam
 * with `failNext`.
 */
// Reading what a probe painted ---------------------------------------------------------------------

/** One value the probe painted, under the name a case reads it by. */
function Field({ name, value }: { readonly name: string; readonly value: string }): ReactElement {
  return <span data-testid={`field-${name}`}>{value}</span>;
}

/** The text a probe painted under one name. */
function painted(name: string): string {
  return screen.getByTestId(`field-${name}`).textContent ?? "";
}

/** Waits until the probe paints `value` under `name`, which is how a case reads a settled call. */
async function paints(name: string, value: string): Promise<void> {
  await waitFor(() => {
    expect(painted(name)).toBe(value);
  });
}

/** The control one call is raised through. */
function control(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
} // The session ---------------------------------------------------------------------------------------

/** The credentials the session probe signs in with: the demonstration customer the seed carries. */
const CONTACT_EMAIL = DEMO_ACCOUNTS.CUSTOMER_EMAIL;
const SHOPPER = { email: CONTACT_EMAIL, password: DEMO_ACCOUNTS.PASSWORD } as const;

/** The account read a signed-in client makes, which an armed failure answers instead — the shape the session
 *  suite arms for the same read. */
const ACCOUNT_READ = /^\/api\/customers\/[^/]+$/;

/** The account an email address names in the seed, which the demonstration customer always is. */
function seededAccount(email: string): Customer {
  const account = CUSTOMERS.find((customer) => customer.email === email);
  if (account === undefined) throw new Error(`The seed carries no account for ${email}.`);
  return account;
}

/** The session token this document has persisted, which the cases that reload read back. */
function storedToken(): SessionToken {
  const token = readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null);
  if (token === null) throw new Error("This document persisted no session token.");
  return token;
}

/** Renders the session probe and signs the demonstration shopper in through it, answering both. */
async function signInThroughProbe(): Promise<{
  readonly rendered: RenderHarness;
  readonly token: SessionToken;
}> {
  const rendered = renderWithProviders(<SessionProbe />);
  await rendered.user.click(control("Sign in"));
  await paints("status", "success");
  return { rendered, token: storedToken() };
}

/**
 * A session consumer: it paints what `useAuth()` reports and dispatches one of the five actions per control,
 * recording what each answered with.
 */
function SessionProbe(): ReactElement {
  const session = useAuth();
  const auth = useAuthDispatch();
  const [outcome, setOutcome] = useState("none");

  const calls: readonly (readonly [string, () => void])[] = [
    [
      "Sign in",
      () => {
        void auth.signIn(SHOPPER).then((answer) => {
          setOutcome(answer.ok ? "signed in" : answer.error.code);
        });
      },
    ],
    [
      "Sign out",
      () => {
        void auth.signOut().then(() => {
          setOutcome("signed out");
        });
      },
    ],
    [
      "Revalidate the stored token",
      () => {
        void auth.restoreSession().then(() => {
          setOutcome("revalidated");
        });
      },
    ],
    [
      "Read the account again",
      () => {
        void auth.refresh().then(() => {
          setOutcome("refreshed");
        });
      },
    ],
  ];

  return (
    <div>
      <Field name="status" value={session.status} />
      <Field name="role" value={session.role} />
      <Field name="isAuthenticated" value={String(session.isAuthenticated)} />
      <Field name="displayName" value={session.displayName} />
      <Field name="email" value={session.email ?? ""} />
      <Field name="customer" value={session.customer?.id ?? ""} />
      <Field name="error" value={session.error?.code ?? ""} />
      <Field name="outcome" value={outcome} />
      {calls.map(([label, call]) => (
        <button key={label} type="button" onClick={call}>
          {label}
        </button>
      ))}
    </div>
  );
}

describe("the session context's lifecycle", () => {
  beforeEach(resetApiState);

  it("revalidates the token a previous document stored, so the visitor is signed in after a reload", async () => {
    const account = seededAccount(CONTACT_EMAIL);
    const document = await signInThroughProbe();
    document.rendered.unmount();

    renderWithProviders(<SessionProbe />);

    // A second document holding the token the store issued reads the session and the account behind it.
    await paints("role", "customer");
    expect(painted("status")).toBe("success");
    expect(painted("displayName")).toBe(displayName(account));
    expect(painted("customer")).toBe(account.id);
    expect(painted("email")).toBe(CONTACT_EMAIL);
    // The token that stands is the one the store issued: a reload revalidates it rather than rotating it.
    expect(storedToken()).toBe(document.token);
  });

  it("keeps the stored token and reports the failure when the account read cannot be answered", async () => {
    const document = await signInThroughProbe();
    document.rendered.unmount();

    // The next document revalidates that token: the session reads, the account behind it does not.
    failNext({ path: ACCOUNT_READ });
    renderWithProviders(<SessionProbe />);

    await paints("status", "error");
    expect(painted("error").length).toBeGreaterThan(0);
    expect(painted("role")).toBe("guest");
    // A store that could not answer says nothing about the credential, so the entry stays for the retry.
    expect(storedToken()).toBe(document.token);
  });

  it("signs out the visitor whose stored session the store has ended", async () => {
    const document = await signInThroughProbe();
    document.rendered.unmount();

    // The credential is retired at the store — the sign-out another document performs — and this document is
    // then reloaded still holding it.
    const ended = await postJson<void>(API_PATHS.AUTH_LOGOUT, undefined, {
      sessionToken: document.token,
    });
    expect(ended.ok).toBe(true);
    expect(writeStored(STORAGE_KEYS.SESSION, document.token)).toBe(true);

    renderWithProviders(<SessionProbe />);

    // A refusal is the one failure that says the session is over, so the entry goes with it and the guard is
    // looking at a guest rather than at a session the store no longer serves.
    await paints("role", "guest");
    expect(painted("isAuthenticated")).toBe("false");
    expect(painted("email")).toBe("");
    expect(readStored<SessionToken | null>(STORAGE_KEYS.SESSION, null)).toBeNull();
  });

  it("adopts the session a sign-in opens even when the account behind it cannot be read", async () => {
    failNext({ path: ACCOUNT_READ });
    const { user } = renderWithProviders(<SessionProbe />);
    await paints("status", "idle");

    await user.click(control("Sign in"));

    // The store's own answer is not invented here: the session it issued is adopted, and only the account as
    // the header and the account screens read it is missing.
    await paints("outcome", "signed in");
    await paints("role", "customer");
    expect(painted("status")).toBe("error");
    expect(painted("displayName")).toBe("");
    expect(painted("email")).toBe("");
    expect(storedToken().length).toBeGreaterThan(0);
  });

  it("keeps the session and the account it last read when a later account read fails", async () => {
    const account = seededAccount(CONTACT_EMAIL);
    const { user } = renderWithProviders(<SessionProbe />);
    await user.click(control("Sign in"));
    await paints("displayName", displayName(account));

    failNext({ path: ACCOUNT_READ });
    await user.click(control("Read the account again"));

    await paints("status", "error");
    expect(painted("role")).toBe("customer");
    expect(painted("displayName")).toBe(displayName(account));
    expect(painted("customer")).toBe(account.id);
  });

  it("leaves a visitor holding no session alone when the account read is asked for again", async () => {
    const { user } = renderWithProviders(<SessionProbe />);
    await paints("status", "idle");

    await user.click(control("Read the account again"));

    // Nothing was asked of the store and nothing changed: a visitor holding no usable session is left as they
    // were rather than read into an error.
    await paints("outcome", "refreshed");
    expect(painted("status")).toBe("idle");
    expect(painted("role")).toBe("guest");
  });

  it("asks the store nothing to sign out a visitor holding no session", async () => {
    const seam = await import("@/lib/mockServer");
    const dispatched = vi.spyOn(seam, "handleRequest");
    const { user } = renderWithProviders(<SessionProbe />);
    await paints("status", "idle");

    await user.click(control("Sign out"));

    await paints("outcome", "signed out");
    // There is no session to retire, so no request leaves — and the visitor is signed out either way.
    const ended = dispatched.mock.calls.filter(([path]) => path === API_PATHS.AUTH_LOGOUT);
    expect(ended).toHaveLength(0);
    expect(painted("status")).toBe("idle");
    expect(painted("role")).toBe("guest");
  });
});
