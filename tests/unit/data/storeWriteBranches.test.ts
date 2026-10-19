/**
 * Path: tests/unit/data/storeWriteBranches.test.ts
 * Purpose: The refusals the data source's own write paths and session lookups answer with: a credential it does not hold, an absent or blank token, a token no record stands for, a session whose window has closed, and an account or an address the store does not hold
 * Lines: 252
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, SESSION_TTL_MS } from "@/constants/config";
import { ACCOUNT_COPY, FEEDBACK_COPY, NOT_FOUND_COPY } from "@/constants/content";
import type { AddressId, ApiError, CustomerId, Result, SessionToken } from "@/types/common";
import type { Address, Customer, ProfileUpdateInput, Session } from "@/types/account";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/apiClient";
import { API_PATHS, fillApiPath, type SalesProDataSource } from "@/lib/mockServer";

import { makeAddress } from "../../fixtures";
import { expectRefusal, refusalOf, signInCustomer, startSeam } from "../lib/mockServerHarness";

// The subject is the write half of the store — `src/data/storeWrites.ts`, reached through the data source
// `src/data/repositories.ts` builds over it. Most of these refusals are the store's own judgement: the
// transport resolves the path's account and address against the same reads before it delegates (its own
// `ownedCustomer` and `ownedAddress` guards), and it judges a session's window itself, so the branches below
// are the data source's answers to a caller that asks it directly. Each case therefore drives the data
// source's own contract — the interface `src/lib/apiContract.ts` declares, which is the surface this layer
// is measured by — and, wherever the transport reaches the same refusal, states both so the two are shown to
// agree. Nothing is mocked: the store, its collections and its sessions are the product's own.

/** The store each case is answered from, bound to the seam before every case so no case reads another's
 *  writes: `startSeam` binds a fresh data source over the seeded collections. */
let source: SalesProDataSource;

/** The account the case in progress signed in as through the seam, so its identifier is one the store holds. */
let shopper: Session;

beforeEach(async () => {
  source = startSeam();
  shopper = await signInCustomer();
});

afterEach(() => {
  vi.useRealTimers();
});

// The identifiers and bodies these cases name -----------------------------------------------------

/** An account the seeded store does not hold: nothing in the collections carries this identifier. */
const ABSENT_CUSTOMER = "cus_not_in_the_store" as CustomerId;

/** An address the seeded books do not hold. */
const ABSENT_ADDRESS = "adr_not_in_the_book" as AddressId;

/** A token no session was ever issued for. */
const UNKNOWN_TOKEN = "ses_no_such_record" as SessionToken;

/** A valid address body, so the refusal a case asserts is the one about the account or the address and never
 *  one about the input: the address rule accepts every member of this one. */
const ADDRESS_INPUT = makeAddress({ label: "Studio" });

/** A valid profile edit, for the same reason: every member the rule judges is acceptable. */
const PROFILE_EDIT: ProfileUpdateInput = {
  firstName: "Dana",
  lastName: "Okafor",
  phone: "",
  marketingOptIn: true,
};

/** The failure of a write the data source answers with synchronously, which is every write below. */
function failureOf<TValue>(result: Result<TValue>): ApiError {
  if (result.ok) throw new Error("The write was accepted where the case expects a refusal.");
  return result.error;
}

/** One write the data source is asked to make, with the account it names supplied by the case. */
type StoreWrite = (source: SalesProDataSource, id: CustomerId) => Result<unknown>;

/** The same write as the transport dispatches it, so a case can read the client's answer beside the store's. */
type SeamWrite = (token: SessionToken, id: CustomerId) => Promise<Result<unknown>>;

/** The path that names the absent address in an account's book, which is where both the edit and the removal
 *  routes dispatch and where the transport reads the address before a handler runs. */
function addressPath(id: CustomerId): string {
  return fillApiPath(API_PATHS.CUSTOMER_ADDRESS, { id, addressId: ABSENT_ADDRESS });
}

/** The set-default path for that same pair. */
function defaultAddressPath(id: CustomerId): string {
  return fillApiPath(API_PATHS.CUSTOMER_ADDRESS_DEFAULT, { id, addressId: ABSENT_ADDRESS });
}

describe("a sign-in the store cannot open a session for", () => {
  it("refuses an email its credential map does not hold, as the transport refuses the same request", () => {
    const refusal = failureOf(
      source.signIn({ email: "no.account@salespro.test", password: DEMO_ACCOUNTS.PASSWORD }),
    );

    // The store's own answer carries no field, because the refusal belongs to the form rather than to a
    // control, and the sentence is the one sentence both wrong answers are worded with.
    expectRefusal(refusal, 401, "invalid-credentials");
    expect(refusal.message).toBe(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE);
    expect(refusal.field).toBeUndefined();
  });

  it("answers the transport's own refusal for that email, with the same code and the same sentence", async () => {
    const refusal = await refusalOf(
      postJson<Session>(API_PATHS.AUTH_LOGIN, {
        email: "no.account@salespro.test",
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );

    // The transport proves the credential before it asks the store to open a session, so a caller never
    // learns which email addresses have accounts: one refusal covers both members.
    expectRefusal(refusal, 401, "invalid-credentials");
    expect(refusal.message).toBe(ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE);
  });
});

describe("a session lookup a token cannot be resolved for", () => {
  it.each<[label: string, token: string | undefined]>([
    ["no token at all", undefined],
    ["an empty token", ""],
    ["a token of whitespace alone", "   "],
  ])("answers no session for %s", (_label, token) => {
    // The lookup is what a request's token is resolved through, so an absent or blank one is no session at
    // all rather than a lookup of the empty string.
    expect(source.getSession(token)).toBeUndefined();
  });

  it("refuses a token no record stands for, and reports the same refusal through the transport", async () => {
    const refusal = failureOf(source.restoreSession(UNKNOWN_TOKEN));

    expectRefusal(refusal, 401, "session-unknown");
    expect(refusal.message).toBe(FEEDBACK_COPY.SIGN_IN_REQUIRED);

    const throughSeam = await refusalOf(
      getJson<Session>(API_PATHS.AUTH_SESSION, { sessionToken: UNKNOWN_TOKEN }),
    );
    expectRefusal(throughSeam, 401, "session-unknown");
    expect(throughSeam.message).toBe(refusal.message);
  });

  it("refuses a session whose window has closed, while still naming the lapsed record it holds", async () => {
    const issued = await signInCustomer();
    // The record keeps the instants it was written with, so a token presented after its window has passed is
    // read as the lapsed record it is rather than re-dated from a clock that reads now. The clock is moved
    // past that window rather than the record edited, so the record under test is the one the store issued.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.now() + SESSION_TTL_MS + 60_000));

    try {
      const refusal = failureOf(source.restoreSession(issued.token));

      expectRefusal(refusal, 401, "session-expired");
      expect(refusal.message).toBe(FEEDBACK_COPY.TOAST_SESSION_EXPIRED);

      // Expiry is not judged by the lookup itself: the record is still named, with the issue instant it was
      // given, which is what lets the transport tell a lapsed session from one that was never issued.
      expect(source.getSession(issued.token)?.issuedAt).toBe(issued.issuedAt);

      const throughSeam = await refusalOf(
        getJson<Session>(API_PATHS.AUTH_SESSION, { sessionToken: issued.token }),
      );
      expectRefusal(throughSeam, 401, "session-expired");
      expect(throughSeam.message).toBe(refusal.message);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a write the store is asked to make for an account it does not hold", () => {
  it("refuses a profile edit, as the transport refuses the same path", async () => {
    const refusal = failureOf(source.updateCustomer(ABSENT_CUSTOMER, PROFILE_EDIT));

    expectRefusal(refusal, 403, "forbidden");
    expect(refusal.message).toBe(FEEDBACK_COPY.ERROR_STATE_BODY);

    const throughSeam = await refusalOf(
      patchJson<Customer>(
        fillApiPath(API_PATHS.CUSTOMER_DETAIL, { id: ABSENT_CUSTOMER }),
        PROFILE_EDIT,
        { sessionToken: shopper.token },
      ),
    );
    // A record that does not exist answers the refusal a record another account owns does, so a response
    // cannot be read to learn which accounts exist.
    expectRefusal(throughSeam, 403, "forbidden");
    expect(throughSeam.message).toBe(refusal.message);
  });

  it.each<[label: string, write: (source: SalesProDataSource) => Result<unknown>]>([
    ["adding an address", (store) => store.addAddress(ABSENT_CUSTOMER, ADDRESS_INPUT)],
    [
      "editing an address",
      (store) => store.updateAddress(ABSENT_CUSTOMER, ABSENT_ADDRESS, ADDRESS_INPUT),
    ],
    ["removing an address", (store) => store.removeAddress(ABSENT_CUSTOMER, ABSENT_ADDRESS)],
    [
      "making an address the default",
      (store) => store.setDefaultAddress(ABSENT_CUSTOMER, ABSENT_ADDRESS, { kind: "shipping" }),
    ],
  ])("refuses %s for that account", (_label, write) => {
    // Every address write resolves the account's book first, and an account the store does not hold has no
    // book to change: the same `403` the transport answers that path with.
    const refusal = failureOf(write(source));

    expectRefusal(refusal, 403, "forbidden");
    expect(refusal.message).toBe(FEEDBACK_COPY.ERROR_STATE_BODY);
  });
});

describe("a write the store is asked to make for an address its book does not hold", () => {
  it.each<[string, StoreWrite, SeamWrite]>([
    [
      "editing it",
      (store, id) => store.updateAddress(id, ABSENT_ADDRESS, ADDRESS_INPUT),
      (token, id) => patchJson<Address>(addressPath(id), ADDRESS_INPUT, { sessionToken: token }),
    ],
    [
      "removing it",
      (store, id) => store.removeAddress(id, ABSENT_ADDRESS),
      (token, id) => deleteJson<unknown>(addressPath(id), { sessionToken: token }),
    ],
    [
      "making it the default",
      (store, id) => store.setDefaultAddress(id, ABSENT_ADDRESS, { kind: "billing" }),
      (token, id) =>
        postJson<Address>(defaultAddressPath(id), { kind: "billing" }, { sessionToken: token }),
    ],
  ])(
    "refuses %s, as the transport refuses the same path",
    async (_label, write, throughTransport) => {
      const held = source.listAddresses(shopper.customerId).map((address: Address) => address.id);

      const refusal = failureOf(write(source, shopper.customerId));

      expectRefusal(refusal, 404, "address-not-found");
      expect(refusal.message).toBe(NOT_FOUND_COPY.BODY);
      // The book an account holds is untouched by the refusal: an address no book carried is not removed from
      // it or edited into it, and the account keeps every reference it held.
      expect(
        source.listAddresses(shopper.customerId).map((address: Address) => address.id),
      ).toEqual(held);

      // The transport resolves the path's address against the same book before a handler runs, so a client
      // reads the same code and the same sentence as a caller of the data source.
      const throughSeam = await refusalOf(throughTransport(shopper.token, shopper.customerId));
      expectRefusal(throughSeam, 404, "address-not-found");
      expect(throughSeam.message).toBe(refusal.message);
    },
  );
});
