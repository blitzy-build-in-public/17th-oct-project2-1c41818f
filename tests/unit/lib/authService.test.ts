/**
 * Path: tests/unit/lib/authService.test.ts
 * Purpose: Registration, duplicate email, sign-in, session expiry and role checks
 * Lines: 529
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, SESSION_TTL_MS } from "@/constants/config";
import { ACCOUNT_COPY, ADMIN_COPY, FEEDBACK_COPY } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { createSalesProDataSource, salesProDataSource } from "@/data/repositories";
import {
  assertRole,
  authErrorMessage,
  hasRole,
  isAdministrator,
  isAuthenticated,
  isSessionExpired,
  register,
  restoreSession,
  roleHomePath,
  sessionExpiresAt,
  signIn,
  signOut,
  toAuthFieldErrors,
} from "@/lib/authService";
import { API_ERROR_CODES, registerDataSource, resetMockServer } from "@/lib/mockServer";
import {
  createCredentialDigest,
  createSalt,
  sessionToken,
  verifyCredential,
} from "@/utils/strings";

import { FIXED_NOW, FIXED_SESSION_EXPIRY, makeApiError, makeSession } from "../../fixtures";

import type { Credentials, RegistrationInput, Role, Session } from "@/types/account";
import type { ApiError, Result, SessionToken } from "@/types/common";

// The service is exercised against the real seam and the seeded store, never a stand-in: `register` and
// `signIn` reach `POST /api/auth/*` through `src/lib/apiClient.ts`, which dispatches to the in-process
// route table, which reads the data source bound below. Nothing is mocked, so the assertions measure the
// contract a screen receives — a `Result`, its failure code and its field — rather than an imitation.
//
// The demonstration accounts are the ones `src/constants/config.ts` documents and `src/data/customers.ts`
// seeds: an in-browser account store with no real credential behind it, so the shared password read from
// `DEMO_ACCOUNTS` is the only credential this file mentions, and no secret is written into the repository.
//
// The digest arithmetic is deliberately absent: its one home is `src/utils/strings.ts`, and a second
// implementation here is exactly the duplication the plan forbids. This file imports the helpers and
// asserts what they mean for the seed path and the sign-in path.

/** The instant one millisecond after `iso`: the smallest step past an expiry. */
function oneMsAfter(iso: string): string {
  return new Date(Date.parse(iso) + 1).toISOString();
}

/** The payload a successful call resolved with, asserted rather than assumed. */
function valueOf<TValue>(result: Result<TValue>): TValue {
  if (!result.ok) throw new Error(`expected a payload, received the refusal ${result.error.code}`);
  return result.value;
}

/** The failure a refused call resolved with. A case reaches for it after asserting the call failed, so a
 * wrong expectation surfaces as this message rather than as a swallowed error. */
function refusalOf<TValue>(result: Result<TValue>): ApiError {
  if (result.ok) throw new Error("expected a refusal, received a payload");
  return result.error;
}

/** A failure as the seam words one: no sentence and no field of its own, so a case asserts what the copy
 * module and the bridges supply rather than what the builder was handed. */
function authFailure(code: string, status: number, overrides: Partial<ApiError> = {}): ApiError {
  return makeApiError({ status, code, message: "", ...overrides });
}

/** The administrator's own credentials, read from the configuration that seeds them. */
const ADMIN_CREDENTIALS: Credentials = {
  email: DEMO_ACCOUNTS.ADMIN_EMAIL,
  password: DEMO_ACCOUNTS.PASSWORD,
};

/** The shopper's own credentials. */
const CUSTOMER_CREDENTIALS: Credentials = {
  email: DEMO_ACCOUNTS.CUSTOMER_EMAIL,
  password: DEMO_ACCOUNTS.PASSWORD,
};

/** The address a registration case creates. Unique among the seeded accounts, and reused by the cases that
 * create one, because each case is answered from its own store. */
const NEW_ACCOUNT_EMAIL = "nia.adebayo@salespro.test";

/** A password no seeded account holds: the wrong password of the rejected-sign-in cases. */
const WRONG_PASSWORD = `${DEMO_ACCOUNTS.PASSWORD}-wrong`;

/** An address no seeded account holds, so the sign-in lookup finds no digest for it. */
const UNKNOWN_EMAIL = "nobody.here@salespro.test";

/** A token no store has ever issued for an account: the shape is right and the record is absent. */
const UNKNOWN_TOKEN: SessionToken = sessionToken("account no store has ever held");

/** One day in milliseconds, the margin the expired-token case moves the clock by: a full day is well
 * inside the seven-day lifetime and wider than any time-zone offset. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** A session issued at the fixed instant and expiring one lifetime later, by the product's own rule: every
 * pure expiry and role case builds its boundaries from these two texts rather than from a clock. */
const ACTIVE_SESSION: Session = makeSession({
  issuedAt: FIXED_NOW,
  expiresAt: sessionExpiresAt(FIXED_NOW),
});

/** A sentence standing in for a field rule's own wording. A `422` has no canonical copy — its sentence
 * travels in the failure, because the field rule that produced it words the complaint — so a case that
 * needs one supplies it here rather than asserting against a constant that does not own it. */
const FIELD_SENTENCE = "Enter a last name of at least two characters.";

/** The registration body a case submits: every member valid, with the member the case is about overridden.
 * This is a request body rather than an entity, so it is built here instead of in `tests/fixtures.ts`. */
function registrationInput(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    email: NEW_ACCOUNT_EMAIL,
    password: DEMO_ACCOUNTS.PASSWORD,
    firstName: "Nia",
    lastName: "Adebayo",
    marketingOptIn: false,
    ...overrides,
  };
}

// The application binds `salesProDataSource` in `src/main.tsx` before the first render, and this file does
// the same — but every case then binds a store of its own. Registration WRITES an account and a session
// into the store it is answered from, so a case answered from a store an earlier case wrote to would see
// an address it never created, and the duplicate-address case would pass for the wrong reason.
beforeAll(() => {
  registerDataSource(salesProDataSource);
});

beforeEach(() => {
  resetMockServer();
  registerDataSource(createSalesProDataSource());
});

describe("the credential digest: one helper, shared by the seed path and the sign-in path", () => {
  it("derives an account's own salt from its address, and verifies the password it digested", () => {
    const salt = createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL);
    const digest = createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, salt);

    expect(salt).toMatch(/^[0-9a-f]{16}$/);
    expect(salt).toBe(createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL));
    expect(salt).not.toBe(createSalt(DEMO_ACCOUNTS.CUSTOMER_EMAIL));
    expect(verifyCredential(DEMO_ACCOUNTS.PASSWORD, digest)).toBe(true);
    expect(verifyCredential(WRONG_PASSWORD, digest)).toBe(false);
    // The plain text exists only for the length of the call that digested it: neither member holds it.
    expect(digest.hash).not.toContain(DEMO_ACCOUNTS.PASSWORD);
    expect(digest.salt).not.toContain(DEMO_ACCOUNTS.PASSWORD);
  });

  it("refuses a password whose digest was built under another salt, and one that is not a digest at all", () => {
    const digest = createCredentialDigest(
      DEMO_ACCOUNTS.PASSWORD,
      createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL),
    );
    const otherAccountSalt = createSalt(DEMO_ACCOUNTS.CUSTOMER_EMAIL);

    expect(
      verifyCredential(DEMO_ACCOUNTS.PASSWORD, { salt: otherAccountSalt, hash: digest.hash }),
    ).toBe(false);
    expect(verifyCredential(DEMO_ACCOUNTS.PASSWORD, null)).toBe(false);
    expect(verifyCredential(DEMO_ACCOUNTS.PASSWORD, digest.hash)).toBe(false);
    expect(verifyCredential(DEMO_ACCOUNTS.PASSWORD, { salt: digest.salt })).toBe(false);
  });

  it("agrees with the seeded account, because the seed and the sign-in path call this one helper", async () => {
    const seededDigest = createCredentialDigest(
      DEMO_ACCOUNTS.PASSWORD,
      createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL),
    );

    expect(verifyCredential(DEMO_ACCOUNTS.PASSWORD, seededDigest)).toBe(true);

    // The same password, proved against the digest the store actually holds: the seed wrote what this
    // helper builds for the account's own salt, and the sign-in handler verifies with the same helper. A
    // second implementation on either side would answer one of these two assertions differently.
    expect(valueOf(await signIn(ADMIN_CREDENTIALS)).role).toBe("admin");
  });
});

describe("register: the account it creates, and the ways it refuses", () => {
  it("creates the account and opens a session with it, so no second request has to follow", async () => {
    const { customer, session } = valueOf(await register(registrationInput()));

    expect(customer.email).toBe(NEW_ACCOUNT_EMAIL);
    expect(customer.role).toBe("customer");
    // Registration is the account's first sign-in, so its session carries the same role and the same
    // account, and its last-login line agrees with the instant the session was issued at.
    expect(session.role).toBe("customer");
    expect(session.customerId).toBe(customer.id);
    expect(session.issuedAt).toBe(customer.lastLoginAt);
    // The token is opaque and the lifetime is the product's own, exactly as a sign-in issues them.
    expect(session.token).toMatch(/^ses_[0-9a-f]{16}$/);
    expect(Date.parse(session.expiresAt) - Date.parse(session.issuedAt)).toBe(SESSION_TTL_MS);
  });

  it("refuses an address that already holds an account with 409, filed on the email field", async () => {
    const failure = refusalOf(
      await register(registrationInput({ email: DEMO_ACCOUNTS.ADMIN_EMAIL })),
    );

    expect(failure.status).toBe(409);
    expect(failure.code).toBe(API_ERROR_CODES.DUPLICATE_EMAIL);
    // The bridge a register form renders: the taken address lands on the control that caused it, so the
    // sentence appears under the field rather than above the form.
    expect(toAuthFieldErrors(failure)).toEqual({ email: ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE });
  });

  it("takes the address it has just created, and frees it again once a fresh store is bound", async () => {
    expect((await register(registrationInput())).ok).toBe(true);
    expect(refusalOf(await register(registrationInput())).code).toBe(
      API_ERROR_CODES.DUPLICATE_EMAIL,
    );

    // What `beforeEach` binds for the next case: a store that has never seen this address answers the same
    // body with a created account, which is what keeps every case here independent of the ones before it.
    resetMockServer();
    registerDataSource(createSalesProDataSource());
    expect((await register(registrationInput())).ok).toBe(true);
  });

  it.each<[string, Partial<RegistrationInput>]>([
    ["an address that is not one", { email: "not-an-address" }],
    ["a password below the demonstration policy", { password: "short" }],
    ["a blank first name", { firstName: "" }],
  ])(
    "refuses %s with 422 naming its own field, before the request is sent",
    async (_label, overrides) => {
      const failure = refusalOf(await register(registrationInput(overrides)));

      expect(failure.status).toBe(422);
      expect(failure.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);
      expect(failure.field).toBe(Object.keys(overrides)[0]);
      expect(failure.message.length).toBeGreaterThan(0);
    },
  );

  it("resolves rather than rejects for every refused body, so no screen needs a try/catch", async () => {
    await expect(register(registrationInput({ email: "not-an-address" }))).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      register(registrationInput({ email: DEMO_ACCOUNTS.ADMIN_EMAIL })),
    ).resolves.toMatchObject({ ok: false });
    await expect(register(registrationInput())).resolves.toMatchObject({ ok: true });
  });
});

describe("signIn: the session each demonstration account receives", () => {
  it.each<[string, Credentials, Role]>([
    ["the administrator", ADMIN_CREDENTIALS, "admin"],
    ["the shopper", CUSTOMER_CREDENTIALS, "customer"],
  ])(
    "signs %s in with a session carrying that account's own role",
    async (_label, credentials, role) => {
      const session = valueOf(await signIn(credentials));

      expect(session.role).toBe(role);
      expect(session.token).toMatch(/^ses_[0-9a-f]{16}$/);
      expect(session.customerId.length).toBeGreaterThan(0);
    },
  );

  it("issues a session that lapses one lifetime later, by the product's single expiry rule", async () => {
    const session = valueOf(await signIn(CUSTOMER_CREDENTIALS));

    expect(Number.isNaN(Date.parse(session.issuedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(session.expiresAt))).toBe(false);
    expect(Date.parse(session.expiresAt) - Date.parse(session.issuedAt)).toBe(SESSION_TTL_MS);
    // The data source opens every session with `sessionExpiresAt` itself, so the lifetime the store
    // records and the rule this module exports cannot disagree about when a session lapses.
    expect(Date.parse(session.expiresAt)).toBe(Date.parse(sessionExpiresAt(session.issuedAt)));
  });

  it("replays the account's own token on a second sign-in, which is what survives a reload", async () => {
    const first = valueOf(await signIn(CUSTOMER_CREDENTIALS));
    const second = valueOf(await signIn(CUSTOMER_CREDENTIALS));

    expect(second.token).toBe(first.token);
    expect(valueOf(await restoreSession(second.token)).customerId).toBe(first.customerId);
  });
});

describe("a rejected sign-in: one generic failure for both members", () => {
  it("answers a wrong password and an address with no account with the identical failure", async () => {
    const wrongPassword = refusalOf(
      await signIn({ email: DEMO_ACCOUNTS.ADMIN_EMAIL, password: WRONG_PASSWORD }),
    );
    const unknownAddress = refusalOf(
      await signIn({ email: UNKNOWN_EMAIL, password: DEMO_ACCOUNTS.PASSWORD }),
    );

    // Deep equality is the assertion that matters: a response that pointed at one member would differ
    // between these two, and that difference is what a stranger would read to learn which addresses hold
    // accounts. The copy module's one sentence names both members and neither as the cause — asserted
    // against `ACCOUNT_COPY` rather than a sentence retyped here — and no field is named, so the failure
    // belongs above the form rather than under one of its controls.
    expect(wrongPassword).toEqual(unknownAddress);
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.code).toBe(API_ERROR_CODES.INVALID_CREDENTIALS);
    expect(wrongPassword.field).toBeUndefined();
    expect(wrongPassword.message).toBe(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE);
    expect(authErrorMessage(wrongPassword)).toBe(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE);
    expect(toAuthFieldErrors(wrongPassword)).toEqual({ form: ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE });
  });
});

describe("signOut and restoreSession: keeping a visitor signed in across a reload", () => {
  it("reports the session a live token still names, so a stored token is revalidated rather than trusted", async () => {
    const issued = valueOf(await signIn(ADMIN_CREDENTIALS));
    const restored = valueOf(await restoreSession(issued.token));

    expect(restored).toEqual(issued);
    expect(restored.role).toBe("admin");
  });

  it("ends the session on sign-out, so the same token is refused afterwards", async () => {
    const issued = valueOf(await signIn(CUSTOMER_CREDENTIALS));

    expect(valueOf(await signOut(issued.token))).toBeUndefined();

    const refused = refusalOf(await restoreSession(issued.token));
    expect(refused.status).toBe(401);
    expect(refused.code).toBe(API_ERROR_CODES.SESSION_UNKNOWN);
    expect(refused.message).toBe(FEEDBACK_COPY.SIGN_IN_REQUIRED);
  });

  it("answers a token no store ever issued as unknown: sign-out succeeds, restore is refused", async () => {
    // Sign-out is best-effort by nature: the client drops its own session whatever this answers, so an
    // unknown token is not a failure. Asking for the session that token names is the read that fails.
    expect(valueOf(await signOut(UNKNOWN_TOKEN))).toBeUndefined();

    const refused = refusalOf(await restoreSession(UNKNOWN_TOKEN));
    expect(refused.status).toBe(401);
    expect(refused.code).toBe(API_ERROR_CODES.SESSION_UNKNOWN);
  });

  it("refuses an expired token with 401 session-expired, the code a client signs out on", async () => {
    const issued = valueOf(await signIn(CUSTOMER_CREDENTIALS));

    // The seam judges a session against the clock it reads, so the case moves that clock past the session's
    // own expiry — a day beyond it, which is inside the seven-day lifetime and wider than any zone offset.
    // Only `Date` is faked: the transport's wait stays real, so no request is left pending.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(issued.expiresAt) + DAY_MS);
    const refused = refusalOf(await restoreSession(issued.token));
    vi.useRealTimers();

    expect(refused.status).toBe(401);
    expect(refused.code).toBe(API_ERROR_CODES.SESSION_EXPIRED);
    expect(refused.message).toBe(FEEDBACK_COPY.TOAST_SESSION_EXPIRED);
  });
});

describe("session lifetime: one expiry rule, judged against an instant", () => {
  it("lapses a session exactly one lifetime after it was issued", () => {
    expect(Date.parse(sessionExpiresAt(FIXED_NOW)) - Date.parse(FIXED_NOW)).toBe(SESSION_TTL_MS);
    // The instant the harness's own session expires at is the one this rule computes, which is how the
    // seeded fixtures and the seeded store read the same lifetime.
    expect(Date.parse(sessionExpiresAt(FIXED_NOW))).toBe(Date.parse(FIXED_SESSION_EXPIRY));
  });

  it("reads an unreadable instant as expired, so a malformed record denies a session rather than granting one", () => {
    expect(sessionExpiresAt("not an instant")).toBe("");
    expect(isSessionExpired(makeSession({ expiresAt: "" }), FIXED_NOW)).toBe(true);
    expect(isSessionExpired(ACTIVE_SESSION, "not an instant")).toBe(true);
  });

  it("holds a session valid up to its expiry and expired from that instant on", () => {
    expect(isSessionExpired(ACTIVE_SESSION, FIXED_NOW)).toBe(false);
    expect(isSessionExpired(ACTIVE_SESSION, oneMsAfter(FIXED_NOW))).toBe(false);
    // The boundary: the rule is half-open — a session is expired AT its expiry instant, which is the same
    // reading the seam applies when it resolves a token.
    expect(isSessionExpired(ACTIVE_SESSION, ACTIVE_SESSION.expiresAt)).toBe(true);
    expect(isSessionExpired(ACTIVE_SESSION, oneMsAfter(ACTIVE_SESSION.expiresAt))).toBe(true);
  });
});

describe("who may do what: the role claim the guards read", () => {
  it.each<[Role, boolean, boolean]>([
    ["guest", false, false],
    ["customer", true, false],
    ["admin", true, true],
  ])("judges a %s claim for exactly what it grants", (role, authenticated, administrator) => {
    const session = makeSession({ role });

    expect(isAuthenticated(session)).toBe(authenticated);
    expect(isAdministrator(session)).toBe(administrator);
  });

  it("denies an absent session and one carrying no token, so a guard can ask before it has one", () => {
    expect(isAuthenticated(undefined)).toBe(false);
    expect(isAdministrator(undefined)).toBe(false);
    expect(hasRole(undefined, "admin")).toBe(false);
    // A record storage could hand back with its token blanked: it authenticates nobody.
    expect(isAuthenticated(makeSession({ token: "" as SessionToken }))).toBe(false);
  });

  it("accepts any role in the set a guard names, and only those", () => {
    expect(hasRole(makeSession({ role: "customer" }), ["customer", "admin"])).toBe(true);
    expect(hasRole(makeSession({ role: "customer" }), "admin")).toBe(false);
    expect(hasRole(makeSession({ role: "admin" }), ["customer", "admin"])).toBe(true);
    expect(hasRole(makeSession({ role: "admin" }), ["guest"])).toBe(false);
  });

  it.each<[Role, string]>([
    ["guest", ROUTES.HOME],
    ["customer", ROUTES.ACCOUNT],
    ["admin", ROUTES.ADMIN],
  ])("lands a %s on the route the routes module owns", (role, path) => {
    expect(roleHomePath(role)).toBe(path);
  });

  it("refuses a visitor with no session with 401 unauthenticated, which a screen reads as 'sign in first'", () => {
    const refused = refusalOf(assertRole(undefined, "admin"));

    expect(refused.status).toBe(401);
    expect(refused.code).toBe(API_ERROR_CODES.UNAUTHENTICATED);
    expect(refused.message).toBe(FEEDBACK_COPY.SIGN_IN_REQUIRED);
    expect(refused.field).toBeUndefined();
  });

  it("refuses the wrong role with 403 forbidden, so a signed-in shopper is told the truth", () => {
    const refused = refusalOf(assertRole(makeSession({ role: "customer" }), "admin"));

    expect(refused.status).toBe(403);
    expect(refused.code).toBe(API_ERROR_CODES.FORBIDDEN);
    expect(refused.message).toBe(ADMIN_COPY.NOT_AUTHORIZED_BODY);
  });

  it("admits the role it names and hands the same session back, so a screen checks once", () => {
    const session = makeSession({ role: "admin" });

    expect(valueOf(assertRole(session, ["customer", "admin"]))).toBe(session);
    expect(valueOf(assertRole(session, "admin")).token).toBe(session.token);
  });

  it("judges the claim and not the clock: the caller pairs the guard with the expiry rule", () => {
    const lapsed = makeSession({ issuedAt: FIXED_NOW, expiresAt: FIXED_SESSION_EXPIRY });

    // The guard holds no clock — expiry is the seam's decision, and `restoreSession` is what asks it — so
    // the refused-with-401 case above is where an expired token is stopped, and a screen that holds a
    // session it has not restored pairs the two rules, which is what the second assertion states.
    expect(assertRole(lapsed, "customer").ok).toBe(true);
    expect(
      isAuthenticated(lapsed) && !isSessionExpired(lapsed, oneMsAfter(FIXED_SESSION_EXPIRY)),
    ).toBe(false);
    expect(() => assertRole(undefined, "admin")).not.toThrow();
  });
});

describe("the two error bridges a form renders", () => {
  it("files a taken address on the email field even when the failure names no field", () => {
    const taken = authFailure(API_ERROR_CODES.DUPLICATE_EMAIL, 409, {
      message: ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE,
    });

    expect(toAuthFieldErrors(taken)).toEqual({ email: ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE });
  });

  it("files a 422 on the field it names, and a rejected sign-in above the fields", () => {
    // A `422` belongs to the control the rule refused, and keeps the sentence that rule wrote; a rejected
    // sign-in belongs to neither member, so it lands on the shared form key instead of accusing one.
    expect(
      toAuthFieldErrors(
        authFailure(API_ERROR_CODES.VALIDATION_FAILED, 422, {
          message: FIELD_SENTENCE,
          field: "lastName",
        }),
      ),
    ).toEqual({ lastName: FIELD_SENTENCE });
    expect(
      toAuthFieldErrors(
        authFailure(API_ERROR_CODES.INVALID_CREDENTIALS, 401, {
          message: ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE,
        }),
      ),
    ).toEqual({ form: ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE });
  });

  it.each<[string, string, number, string]>([
    ["an absent session", API_ERROR_CODES.UNAUTHENTICATED, 401, FEEDBACK_COPY.SIGN_IN_REQUIRED],
    [
      "an expired session",
      API_ERROR_CODES.SESSION_EXPIRED,
      401,
      FEEDBACK_COPY.TOAST_SESSION_EXPIRED,
    ],
    ["an unknown token", API_ERROR_CODES.SESSION_UNKNOWN, 401, FEEDBACK_COPY.SIGN_IN_REQUIRED],
    [
      "a rejected sign-in",
      API_ERROR_CODES.INVALID_CREDENTIALS,
      401,
      ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE,
    ],
    ["a taken address", API_ERROR_CODES.DUPLICATE_EMAIL, 409, ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE],
    ["the wrong role", API_ERROR_CODES.FORBIDDEN, 403, ADMIN_COPY.NOT_AUTHORIZED_BODY],
  ])("words %s with the copy module's own sentence", (_label, code, status, expected) => {
    // Each failure carries no sentence of its own, so the wording can only come from the copy module.
    expect(authErrorMessage(authFailure(code, status))).toBe(expected);
  });

  it("keeps a field rule's own sentence and falls back to the neutral one for anything else", () => {
    expect(
      authErrorMessage(
        authFailure(API_ERROR_CODES.VALIDATION_FAILED, 422, { message: FIELD_SENTENCE }),
      ),
    ).toBe(FIELD_SENTENCE);
    expect(authErrorMessage(authFailure("unexpected-error", 500))).toBe(
      FEEDBACK_COPY.ERROR_STATE_BODY,
    );
  });

  it("keeps the sentence of a failure it has no wording for, and files it above the fields", () => {
    const unmapped = authFailure("unexpected-error", 500, { message: FIELD_SENTENCE });

    expect(authErrorMessage(unmapped)).toBe(FIELD_SENTENCE);
    expect(toAuthFieldErrors(unmapped)).toEqual({ form: FIELD_SENTENCE });
  });
});
