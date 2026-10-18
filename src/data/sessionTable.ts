/**
 * Path: src/data/sessionTable.ts
 * Purpose: The durable session table: the record, the guards that read it back, and the two writes that keep a session's own window across documents
 * Lines: 60
 */

import { STORAGE_KEYS } from "@/constants/config";
import type { Session } from "@/types/account";
import { readStored, writeStored } from "@/utils/storage";

// The session table is durable state, so it stands beside the store that holds it rather than inside it:
// `src/data/collectionStore.ts` keeps the collections and joins the table to them, and the record, the guards
// that read one back and the two writes that change the table live here. The store reaches the table through
// `readSessionTable` and `writeSessionTable` and nothing else.

// The durable session table --------------------------------------------------------------------------
// A session's window is a fact about the instant it was issued, so the registry that holds the records is
// durable state, written through the storage util at the two points that change it and read back when a store
// is built. That is what lets a live session survive a reload and keeps a lapsed one lapsed: a token presented
// after its window has passed is read as the lapsed record it is, never re-dated from a clock that reads now.

/** Whether a value read back is one session record: every member the type declares, each read as the string it
 * was written as, with a `role` of `guest`, `customer` or `admin`. Content the current types do not describe is
 * discarded rather than handed to the registry as a session, because a session's `customerId` and `role` are
 * what a request reaches through. */
function isStoredSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly [member: string]: unknown };
  const role = candidate.role;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.customerId === "string" &&
    (role === "guest" || role === "customer" || role === "admin") &&
    typeof candidate.issuedAt === "string" &&
    typeof candidate.expiresAt === "string"
  );
}

/** Whether a payload read back is the session table: an array whose every entry is a session record. One that
 * fails this is discarded whole, because a partly readable table cannot be told from one this build never
 * wrote. */
function isSessionTable(value: unknown): value is Session[] {
  if (!Array.isArray(value)) return false;
  return (value as unknown[]).every((entry) => isStoredSession(entry));
}

/** The session table as the store holds it, or an empty registry when nothing usable is read back: no store, a
 * refused read, a payload this build cannot read as a table. */
function readSessionTable(): Map<string, Session> {
  const rows = readStored<Session[]>(STORAGE_KEYS.SESSIONS, [], isSessionTable);
  return new Map(rows.map((session): [string, Session] => [session.token, session]));
}

/** Writes the registry's current records as the session table: best-effort, like every write through the
 * storage util, so a browser that refuses storage keeps the registry a request is answered from. */
function writeSessionTable(sessions: Map<string, Session>): void {
  writeStored(STORAGE_KEYS.SESSIONS, [...sessions.values()]);
}

export { readSessionTable, writeSessionTable };
