/**
 * Path: tests/unit/lib/sessionTableDurability.test.ts
 * Purpose: The durable session table across documents: a session one document issues is honoured by the next, a sign-out reaches a document that is already open, and the copy of the table taken before that sign-out is refused
 * Lines: 229
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEYS } from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import type { SessionRecord } from "@/data/sessionTable";
import { getJson, postJson } from "@/lib/apiClient";
import {
  API_PATHS,
  registerDataSource,
  resetMockServerState,
  type SalesProDataSource,
} from "@/lib/mockServer";
import type { Session } from "@/types/account";
import type { Result } from "@/types/common";
import { readStored, writeStored } from "@/utils/storage";

import {
  expectRefusal,
  installFakeStorage,
  refusalOf,
  signInCustomer,
  valueOf,
} from "./mockServerHarness";

// The session table's own durability suite, split out of `tests/unit/lib/mockServer.test.ts` and
// `tests/integration/sessionLifecycle.test.tsx` under §0.5.5 for the reason `mockServerDurability.test.ts` was
// split out before it: both files stand at the 600-line ceiling and the ceiling is never raised.
//
// Every case drives the real seam over the seeded data source behind a fake Web Storage, so one document's
// writes are the next document's reads, and every case about two documents builds both itself — the harness's
// one bound source cannot be open twice — and binds the one that is to answer. Nothing here stands in for a
// store, a seal or a clock: what is asserted is what the endpoints answer, what the durable table holds, and
// what a table written back by hand earns.

/** One day in milliseconds, the unit a session's window is moved by. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The table as it stands in the store: the records the durable table holds, each with the seal written beside
 * it and, for a session a sign-out ended, the instant it was ended. */
function storedTable(): readonly SessionRecord[] {
  return readStored<SessionRecord[]>(STORAGE_KEYS.SESSIONS, []);
}

/** The tokens the table holds, in the order it holds them: the one reading that says whether a write kept the
 * records it found or replaced them with its own. */
function storedTokens(): readonly string[] {
  return storedTable().map((record) => record.token);
}

/** Binds a data source built now — one more document on the same storage — and answers it. Registering is what
 * the seam dispatches to, so the document that answers a request is the last one bound: a case signs in through
 * one document and then binds another, which is a document opened on the same storage. */
function bindDocument(): SalesProDataSource {
  const source = createSalesProDataSource();
  registerDataSource(source);
  return source;
}

/** Reads the session the seam answers for a token, or the refusal it earns. */
function readSession(token: string): Promise<Result<Session>> {
  return getJson<Session>(API_PATHS.AUTH_SESSION, { sessionToken: token });
}

/** Ends the session a token names through the endpoint the account menu reaches. */
async function signOut(token: string): Promise<void> {
  expect(
    await valueOf(postJson<void>(API_PATHS.AUTH_LOGOUT, undefined, { sessionToken: token })),
  ).toBeUndefined();
}

describe("the session table across documents", () => {
  /** The fake Web Storage the case in progress installed, put back by the hook below in every outcome. */
  let storage: ReturnType<typeof installFakeStorage> | null = null;

  beforeEach(() => {
    resetMockServerState();
  });

  afterEach(() => {
    storage?.restore();
    storage = null;
  });

  it("honours a session one document opened once the next document re-reads the table", async () => {
    storage = installFakeStorage();
    // Both documents are built while the table holds nothing, so neither has the session in its own registry:
    // what answers below is the record the second one reads back, not one it happened to be holding.
    const issuing = createSalesProDataSource();
    const reading = createSalesProDataSource();
    registerDataSource(issuing);

    const issued = await signInCustomer();
    registerDataSource(reading);

    expect(await valueOf(readSession(issued.token))).toEqual(issued);
    // The record is the one document's own write, with this browser's seal beside it: nothing else ever wrote
    // the table, so a second document can only have proved the row the first one left.
    expect(storedTokens()).toEqual([issued.token]);
  });

  it("refuses a token a sign-out ended, in a document that is already open", async () => {
    storage = installFakeStorage();
    const issuing = createSalesProDataSource();
    const reading = createSalesProDataSource();
    registerDataSource(issuing);
    const issued = await signInCustomer();

    // The second document is open and has answered for the token before it is given up, which is the state the
    // finding is about: from here it is not rebuilt, so only a read of the record can tell it anything.
    registerDataSource(reading);
    expect((await valueOf(readSession(issued.token))).token).toBe(issued.token);

    registerDataSource(issuing);
    await signOut(issued.token);

    registerDataSource(reading);
    expectRefusal(await refusalOf(readSession(issued.token)), 401, "session-unknown");
    // And the guarded read a signed-in visitor makes is refused with it, rather than answered from the record
    // this document is still holding.
    expectRefusal(
      await refusalOf(getJson<unknown>(API_PATHS.ORDERS, { sessionToken: issued.token })),
      401,
      "session-unknown",
    );
  });

  it("refuses the copy of the table taken while the session was live", async () => {
    storage = installFakeStorage();
    const issued = await signInCustomer();

    // The copy a script in the page takes while the session is live: the row exactly as this browser wrote it,
    // its seal included, with no revocation mark — the mark the sign-out is about to add is the only member that
    // would distinguish the copy from the table it came from.
    const copy = storedTable();
    expect(storedTokens()).toEqual([issued.token]);
    expect(copy[0]?.revokedAt).toBeUndefined();

    await signOut(issued.token);

    // The write-back, through the product's own writer: the whole pre-sign-out table, verbatim.
    expect(writeStored(STORAGE_KEYS.SESSIONS, copy)).toBe(true);

    // The document that ended the session refuses the token from its own memory...
    expectRefusal(await refusalOf(readSession(issued.token)), 401, "session-unknown");

    // ...and so does a document that loads next, whose registry is built from the copy that was put back: the
    // record's seal was minted under the secret the sign-out rotated away, so the row is not one this browser
    // can prove and the token resolves as one no session was ever issued for.
    bindDocument();
    expectRefusal(await refusalOf(readSession(issued.token)), 401, "session-unknown");

    // The copy is refused for a guarded read as well, which is where it would have reached the account.
    expectRefusal(
      await refusalOf(getJson<unknown>(API_PATHS.ORDERS, { sessionToken: issued.token })),
      401,
      "session-unknown",
    );

    // The store recovers: the next sign-in writes a table that no longer holds the copy at all, and that session
    // stands — the refusal is a fact about the copy, not about the table it was written over.
    const later = await signInCustomer();
    expect((await valueOf(readSession(later.token))).token).toBe(later.token);
    expect(storedTokens()).toEqual([later.token]);
  });

  it("keeps a record another document wrote when this one writes the table", async () => {
    storage = installFakeStorage();
    // Both documents are built before either writes, so the second one's own copy of the table is the empty one
    // it read at load — the state a stale document is in when it is the next to write.
    const first = createSalesProDataSource();
    const second = createSalesProDataSource();
    registerDataSource(first);
    const issuedByFirst = await signInCustomer();

    registerDataSource(second);
    const issuedBySecond = await signInCustomer();

    // Neither record was dropped: the write is what the table already held plus what this document had, so one
    // tab's issuance does not sign another tab out.
    expect((await valueOf(readSession(issuedByFirst.token))).token).toBe(issuedByFirst.token);
    expect((await valueOf(readSession(issuedBySecond.token))).token).toBe(issuedBySecond.token);
    expect([...storedTokens()].sort()).toEqual([issuedByFirst.token, issuedBySecond.token].sort());
  });

  it("still answers a lapsed session as the lapsed one it is, where the table no longer holds it", async () => {
    storage = installFakeStorage();
    const lapsed = await signInCustomer();

    // Eight days on, the record's window has passed and the next sign-in writes the table again: a lapsed record
    // authenticates nobody, so it is left out of that write, and the only place it is still held is this
    // document's memory — which is what lets the transport word `session-expired` rather than `session-unknown`.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(lapsed.expiresAt) + DAY_MS));
    const fresh = await signInCustomer();
    expect(storedTokens()).not.toContain(lapsed.token);

    expectRefusal(await refusalOf(readSession(lapsed.token)), 401, "session-expired");
    // The record that lapsed says nothing about the session issued after it, which is live and keeps its own
    // window rather than the lapsed one's.
    expect((await valueOf(readSession(fresh.token))).token).toBe(fresh.token);
  });

  it("serves a session from its own memory where the browser refuses to hold anything", async () => {
    storage = installFakeStorage();
    // Every write is refused from here on and every read answers nothing, which is the browser whose store is
    // unavailable: the secret this document mints for itself is never stored, so it is the only one its own
    // records can be proved by, and the registry in memory is what answers.
    const store = globalThis.localStorage;
    store.setItem = (): void => {
      throw new Error("The store refuses the write.");
    };

    const issued = await signInCustomer();

    expect((await valueOf(readSession(issued.token))).token).toBe(issued.token);
    // Nothing is durable, which is the state this case exists for rather than a failure of the write.
    expect(storage.keys()).toEqual([]);

    // And a sign-out still ends it here: the refusal stands in memory even though no table carries the mark.
    await signOut(issued.token);
    expectRefusal(await refusalOf(readSession(issued.token)), 401, "session-unknown");
  });
});
