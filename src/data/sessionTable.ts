/**
 * Path: src/data/sessionTable.ts
 * Purpose: The durable session table: the record a session is kept as, the seal that proves this browser wrote it, the rotation that puts a copy of the table taken before a sign-out out of reach, and the composed reads and writes that keep a session's own window and its revocation across documents
 * Lines: 359
 */

import { STORAGE_KEYS } from "@/constants/config";
import type { Session } from "@/types/account";
import type { IsoDateTimeString } from "@/types/common";
import { isSessionExpired } from "@/utils/accountRules";
import { toIsoDateTime } from "@/utils/dates";
import { keyedDigest, randomHexText } from "@/utils/strings";
import { readStored, writeStored } from "@/utils/storage";

// The session table is durable state, so it stands beside the store that holds it rather than inside it:
// `src/data/collectionStore.ts` keeps the collections and joins the table to them, and the record, the seal
// that proves this browser wrote one, the rotation that puts every earlier copy out of reach and the reads and
// writes that change the table live here. The store reaches the table through `readSessionTable`,
// `resolveSessionRecord`, `recordSession` and `revokeSession` and nothing else.

// The durable session table --------------------------------------------------------------------------
// A session's window is a fact about the instant it was issued and its revocation is a fact about the instant
// it was ended, so both are durable state, written through the storage util at the points that change it and
// read back when a session is resolved. That is what lets a live session survive a reload, keeps a lapsed one
// lapsed — a token presented after its window has passed is read as the lapsed record it is, never re-dated
// from a clock that reads now — and keeps a sign-out refused.
//
// Every record is written with a seal: the keyed digest of the record's own members under a secret this browser
// mints for itself and keeps under `STORAGE_KEYS.SESSION_SEAL`. A record naming an account, a role or a window
// this store never issued then fails verification and is dropped, so a token the store never minted resolves as
// a token no session was ever issued for rather than authenticating the account the record names. The secret is
// held under its own key rather than inside the table it seals, because a secret stored beside the records it
// proves would be replaced along with them.
//
// A seal proves the members beside it were written here, never when — so the mark a sign-out leaves inside the
// record is not enough on its own: a copy of the table taken while the session was live carries the record
// without its mark and with a seal that still verifies, and writing that copy back would revive the session it
// names. The table is therefore sealed with a secret a sign-out rotates: a fresh secret is minted into the key,
// every record that still stands is re-sealed under it, and the ended one is written carrying its mark. A
// record sealed before that instant verifies under nothing afterwards — not from the table, and not from the
// copy of it a document is still holding in memory — so the token it names resolves as one no session was ever
// issued for, however complete the copy of the table put back is.

/** The seal secret's shape: a non-blank string, the only payload this module reads back from its own key. */
function isSealSecret(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** How many random bytes the seal secret is minted from when this browser holds none: thirty-two, 256 bits. */
const SEAL_SECRET_BYTES = 32;

/** What this document minted for itself when the key held no secret, `null` until it did: held so a browser
 * that refuses storage seals and proves under one value for the life of the document, because with no key to
 * read back a secret minted per call would make every record written here unprovable a moment later. A value
 * the key does hold always wins over it, so a secret another document has rotated to is the one this document
 * goes on to write under. */
let mintedSealSecret: string | null = null;

/** The secret this browser seals its session records with and the one a record is proved against: the value
 * held under its own key, read again whenever one is needed rather than held for the life of the document, so
 * a document that finds the key rotated — or gone — follows the value that stands rather than one that no
 * longer does. Only while the key holds nothing is the secret this document minted used, and then it is minted
 * once, so every record written here can still be proved by it.
 *
 * A browser that refuses the write is not refused its sessions: nothing durable can be read back there anyway,
 * and the registry a request is answered from is in memory, sealed and proved under this document's own secret
 * rather than a stored one. */
function readSealSecret(): string {
  const held = readStored<string>(STORAGE_KEYS.SESSION_SEAL, "", isSealSecret);
  if (held !== "") return held;
  mintedSealSecret ??= randomHexText(SEAL_SECRET_BYTES);
  // Best-effort, like every write through the storage util: a refused write costs this document's records
  // their durability, which is the state a browser holding no storage is in already.
  writeStored(STORAGE_KEYS.SESSION_SEAL, mintedSealSecret);
  return mintedSealSecret;
}

/** Rotates the seal: a fresh secret is minted for this browser, put under the key and answered, so every
 * record sealed before this instant stops verifying and only what is re-sealed under the fresh one stands.
 * This is what a sign-out does to make revocation outlive the record that carries it — a copy of the table
 * taken earlier is a set of records sealed under the secret just replaced, so no copy can put a session a
 * visitor has given up back, however faithfully it reproduces the table and the record's other members. */
function rotateSealSecret(): string {
  const minted = randomHexText(SEAL_SECRET_BYTES);
  mintedSealSecret = minted;
  writeStored(STORAGE_KEYS.SESSION_SEAL, minted);
  return minted;
}

/** The members one record's seal covers: a session and, when a sign-out ended it, the instant it was ended.
 * Exported so a caller of this module can hold a record's members — the store reads them without the seal — and
 * so a record this module writes is described by the same type the seal is computed over. */
export type SessionMembers = Session & { readonly revokedAt?: IsoDateTimeString };

/**
 * A session as the table holds it: the members a session is made of, the seal that proves this browser wrote
 * them and — for a session a sign-out ended — the instant it was ended.
 *
 * `revokedAt` is what makes a revocation durable: the record stays in the table carrying the mark, so the
 * refusal outlives the document that asked for it, while a record dropped at sign-out could be revived by a
 * copy of the table that put it back. The mark travels inside the record and the secret the table is sealed
 * under is rotated with it, so neither the mark nor the record it sits in can be reproduced by a copy taken
 * before the sign-out. A record carrying a mark authenticates nobody whatever it claims, and
 * `src/data/collectionStore.ts` is where it is refused.
 */
export interface SessionRecord extends SessionMembers {
  /** The keyed digest of this record's own members under this browser's seal secret. */
  readonly seal: string;
}

/** The text one record is sealed over: its own members in the record's own terms — the token, the account and
 * role it names, its window and the instant a sign-out ended it, when one has — so an edited token, account,
 * role, window or revocation mark changes this text and the seal written beside it no longer verifies. */
function sealText(record: SessionMembers): string {
  return JSON.stringify([
    record.token,
    record.customerId,
    record.role,
    record.issuedAt,
    record.expiresAt,
    record.revokedAt ?? "",
  ]);
}

/** The seal of one record: the keyed digest of its own text under `secret`. */
function sealOf(record: SessionMembers, secret: string): string {
  return keyedDigest(secret, sealText(record));
}

/** Whether one record's seal is the one its own members produce under `secret`: the only thing that admits a
 * record for a token, and it is asked of a record wherever it comes from, so a record sealed before a rotation
 * stops proving at that instant even when nothing else about it changed — which is what leaves a copy of the
 * table taken earlier, in storage or in a document's own memory, with no record to admit. */
function proves(record: SessionRecord, secret: string): boolean {
  return record.seal === sealOf(record, secret);
}

/** One record's members without the seal written beside them: what a record is re-sealed from, and what a
 * revocation mark is put on. Every member the types describe is copied and nothing else, so content a row
 * carries that this build does not know is dropped rather than written back. */
function membersOf(record: SessionMembers): SessionMembers {
  return {
    token: record.token,
    customerId: record.customerId,
    role: record.role,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
  };
}

/** The record as the table holds it: the members given and the seal those members produce under `secret`. The
 * one place a seal is minted, so the site that issues a session, the site that revokes one and the rotation
 * that re-seals the records surviving a sign-out cannot write a record the guard that reads one back refuses. */
function sealedRecord(members: SessionMembers, secret: string): SessionRecord {
  return { ...members, seal: sealOf(members, secret) };
}

/** A row read back from the table: the members a session is made of with the two members the table writes
 * beside them, each read as the type it was written as. This is the shape guard's answer and not the registry's
 * type — a row holding no usable seal is dropped by {@link readSessionTable} rather than admitted — which is
 * why its seal is read as optional here and has to be proven before a row becomes a record. */
interface StoredRow extends SessionMembers {
  readonly seal?: string;
}

/** Whether a value read back is one row of the table: every member a session is made of, each read as the
 * string it was written as, with a `role` of `guest`, `customer` or `admin` and the seal and the revocation
 * mark absent or read as strings. Content the current types do not describe is discarded rather than handed to
 * the registry as a session, because a session's `customerId` and `role` are what a request reaches through. */
function isStoredRow(value: unknown): value is StoredRow {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly [member: string]: unknown };
  const role = candidate.role;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.customerId === "string" &&
    (role === "guest" || role === "customer" || role === "admin") &&
    typeof candidate.issuedAt === "string" &&
    typeof candidate.expiresAt === "string" &&
    (candidate.seal === undefined || typeof candidate.seal === "string") &&
    (candidate.revokedAt === undefined || typeof candidate.revokedAt === "string")
  );
}

/** Whether a payload read back is the session table: an array whose every entry is a row. One that fails this
 * is discarded whole, because a partly readable table cannot be told from one this build never wrote. A row
 * that reads as a row but cannot be proved is dropped on its own — {@link readSessionTable} — so a record
 * written over this table cannot take the records beside it down with it. */
function isSessionTable(value: unknown): value is StoredRow[] {
  if (!Array.isArray(value)) return false;
  return (value as unknown[]).every((entry) => isStoredRow(entry));
}

/** The record a row holds, or `undefined` when the row cannot be proved to have been written here: the seal
 * beside its members has to be the one those members produce under this browser's secret, so a row naming a
 * token, an account, a role or a window this store never issued — or one a sign-out's rotation has since put
 * out of reach — is dropped rather than honoured. */
function provedRow(row: StoredRow, secret: string): SessionRecord | undefined {
  const seal = row.seal;
  if (seal === undefined || seal !== sealOf(row, secret)) return undefined;
  return { ...membersOf(row), seal };
}

/** The session table as the registry holds it, or an empty registry when nothing usable is read back: no store,
 * a refused read, a payload this build cannot read as a table. Every row that survives the guard is proved
 * against this browser's seal secret before it is admitted, so a record this browser did not write — a
 * hand-written one naming another account's `customerId`, one whose account, role, window or revocation mark was
 * edited after it was written, or one sealed before a sign-out rotated the secret — is not admitted, and the
 * token it names resolves as one no session was ever issued for. A record a sign-out revoked is admitted with
 * its mark, because refusing it is the store's judgement and the mark is what keeps the refusal durable; and a
 * record whose window has lapsed is admitted too, so the transport can still answer it as the lapsed session it
 * is rather than as one no session was ever issued for.
 *
 * @returns The records the table holds, keyed by the token each names.
 */
function readSessionTable(): Map<string, SessionRecord> {
  const rows = readStored<StoredRow[]>(STORAGE_KEYS.SESSIONS, [], isSessionTable);
  const secret = readSealSecret();
  const sessions = new Map<string, SessionRecord>();
  for (const row of rows) {
    const record = provedRow(row, secret);
    if (record !== undefined) sessions.set(record.token, record);
  }
  return sessions;
}

/** The records this browser stands behind, keyed by token: every row the durable table holds and the given
 * secret proves, and then this document's own records — the ones its registry holds and the same secret proves
 * — laid over them. This is what keeps one document from dropping another's: what the table holds is read back
 * and kept rather than replaced by whichever document writes last.
 *
 * A record the table no longer proves is admitted by neither side, so a copy of the table sealed before a
 * sign-out's rotation is dropped instead of written back as a live session, and the unmarked copy of a revoked
 * session a document is still holding in memory is dropped with it. The one thing this document's own record
 * outweighs the table on is a revocation: a session ended here stays ended even where the table still holds an
 * earlier, unrevoked row for it, which is what a refused write of the mark would otherwise leave behind.
 *
 * @param registry - The records this document holds, as the store keeps them.
 * @param secret - The secret standing when this set is taken, the one every record admitted here is proved by.
 * @returns The members of every record that still stands.
 */
function recordsStandingNow(
  registry: ReadonlyMap<string, SessionRecord>,
  secret: string,
): Map<string, SessionMembers> {
  const standing = new Map<string, SessionMembers>();
  for (const [token, row] of readSessionTable()) standing.set(token, membersOf(row));
  for (const [token, held] of registry) {
    if (!proves(held, secret)) continue;
    if (standing.has(token) && held.revokedAt === undefined) continue;
    standing.set(token, membersOf(held));
  }
  return standing;
}

/**
 * The record this browser stands behind for one token, or `undefined` when it stands behind none: the token's
 * row in the durable table when one is proved there, and otherwise the record this document holds — proved when
 * it was read here or when it was written here. A revocation this document holds is the one answer that comes
 * ahead of the table, so a session ended in this document stays ended even where the write that would carry the
 * mark to the table was refused.
 *
 * The table is read on every lookup rather than trusted from memory, so a sign-out, a rotation or a session
 * another document opened reaches a document that is already open, without a reload. A record the current secret
 * no longer proves stands on neither side: the copy of the table a sign-out rotated away is dropped with the
 * rows it holds, and a copy this document is still holding in memory is dropped by the proof here — so a token
 * whose record was sealed before a sign-out resolves as one no session was ever issued for, in the document that
 * is open and in the one that loads next.
 *
 * @param registry - The records this document holds, as the store keeps them.
 * @param token - The token a request presented.
 * @returns The record the token names, or `undefined` when this browser stands behind none.
 */
function resolveSessionRecord(
  registry: ReadonlyMap<string, SessionRecord>,
  token: string,
): SessionRecord | undefined {
  const secret = readSealSecret();
  const held = registry.get(token);
  if (held !== undefined && held.revokedAt !== undefined && proves(held, secret)) return held;
  const durable = readSessionTable().get(token);
  if (durable !== undefined) return durable;
  return held !== undefined && proves(held, secret) ? held : undefined;
}

/** Adopts a set of records as this document's registry, in place, and writes them as the session table, each
 * sealed under `secret`: the members are what is held between the two, so the seal is minted once, at this one
 * write. A record whose window has lapsed is left out of the table — a lapsed record authenticates nobody, so
 * carrying it into every later write would only let the table grow with each sign-in — while the registry keeps
 * it, so the transport can still answer a lapsed token as the expired session it is rather than as one no
 * session was ever issued for. Best-effort, like every write through the storage util, so a browser that refuses
 * storage keeps the registry a request is answered from.
 *
 * @param registry - The records this document holds, adopted in place as the records just written.
 * @param records - The members to write, keyed by the token each names.
 * @param secret - The secret every record is sealed under as it is written.
 */
function writeTable(
  registry: Map<string, SessionRecord>,
  records: ReadonlyMap<string, SessionMembers>,
  secret: string,
): void {
  const now = toIsoDateTime(new Date());
  const held: SessionRecord[] = [];
  registry.clear();
  for (const [token, members] of records) {
    const record = sealedRecord(members, secret);
    registry.set(token, record);
    if (!isSessionExpired(record, now)) held.push(record);
  }
  writeStored(STORAGE_KEYS.SESSIONS, held);
}

/**
 * Records a session this document has just issued: the record is sealed under the secret standing now and
 * written into the table as this browser's own, so the instant the session was issued is durable and the record
 * is one the store that reads it back can prove. The one mint site for an issuance, so registration and sign-in
 * — the two arrivals through `src/data/collectionStore.ts`'s `openSession` — cannot write a record two ways.
 *
 * @param registry - The records this document holds, as the store keeps them.
 * @param session - The session the store has just issued.
 */
function recordSession(registry: Map<string, SessionRecord>, session: Session): void {
  const secret = readSealSecret();
  const records = recordsStandingNow(registry, secret);
  records.set(session.token, session);
  writeTable(registry, records, secret);
}

/**
 * Ends the session a token names: the record is marked revoked and written, and this browser's seal secret is
 * rotated, so every record sealed before this instant — a copy of the table taken while the session was live
 * included — stops verifying and the ended token resolves as one no session was ever issued for. The records
 * that still stand, another document's live sessions among them, are re-sealed under the fresh secret and
 * written, so the rotation costs a sign-out no session but the ended one and the copies it exists to kill.
 *
 * The record is kept rather than dropped because a copy of the table could otherwise put it back: the revocation
 * travels inside the record, and the secret that record and every copy of it were sealed under is gone. The
 * refusal is in memory as well — the registry keeps the marked record — so a document that has not re-read the
 * table still refuses the token.
 *
 * @param registry - The records this document holds, as the store keeps them.
 * @param token - The token the visitor has given up.
 * @returns Whether this document ended a session: a token no record stands for changes nothing here.
 */
function revokeSession(registry: Map<string, SessionRecord>, token: string): boolean {
  const standing = readSealSecret();
  // The composed set answers for a token exactly as {@link resolveSessionRecord} does — the table's row first,
  // this document's own record where the table holds none — so the table is read once for both.
  const records = recordsStandingNow(registry, standing);
  const record = records.get(token);
  if (record === undefined) return false;
  records.set(token, { ...record, revokedAt: toIsoDateTime(new Date()) });
  writeTable(registry, records, rotateSealSecret());
  return true;
}

export { readSessionTable, resolveSessionRecord, recordSession, revokeSession };
