/**
 * Path: src/utils/orderPlacements.ts
 * Purpose: The read credential this browser holds for each order it placed without an account, the seal that proves this browser recorded it, and the merged write two documents' records survive
 * Lines: 348
 */

import { ORDER_PLACEMENT_TTL_MS, STORAGE_KEYS } from "@/constants/config";
import type { Order } from "@/types/commerce";
import type { OrderId } from "@/types/common";
import { parseIso, toIsoDateTime } from "@/utils/dates";
import { keyedDigest, randomHexText } from "@/utils/strings";
import { readStored, writeStored } from "@/utils/storage";

/**
 * Why this lives in Foundations rather than beside `src/lib/orderService.ts`, the file it was split
 * out of: both of its readers are above it — the submission half of the seam,
 * `src/lib/apiOrders.ts`, in Data access, and `src/lib/orderService.ts` itself in Domain services —
 * and it imports Foundations alone (`src/constants/config`, `src/types/commerce.ts`,
 * `src/types/common.ts`, `src/utils/dates.ts`, `src/utils/strings.ts` and `src/utils/storage.ts`),
 * so the dependency runs one way and nothing imports upward. Its concern — the read credential this
 * browser holds for each order it placed without an account, the window that credential is usable in
 * and the seal that proves this browser recorded them — has exactly one home here, and both readers
 * reach it at this path.
 */

// The credential a placement is remembered by ------------------------------------------------------
// The client-side half of the order-read credential `src/lib/apiOrders.ts` keeps at the seam: the value a
// submission mints for itself — `placementToken()` in `src/utils/strings.ts`, `plc_` followed by sixteen
// random bytes no reader of this repository can recompute — is what a confirmation carrying nothing but an
// identifier presents to read its own order back. The submission's idempotency key is deliberately not it:
// that key is derived from the clock and a small counter and its shape is published beside the code that
// mints it, so it identifies the attempt rather than proving the placement. The credential is remembered
// with the window it is usable in, `ORDER_PLACEMENT_TTL_MS` from the instant the order was placed, so a
// value that leaks is worth one window rather than the life of the account.

// The seal that proves this browser recorded it ----------------------------------------------------
// A placement is durable state a read is answered from, so the record carries a seal beside its members: the
// keyed digest of the order it names, the credential recorded for that order and the instant that credential
// stops being usable, under a secret this browser mints for itself and keeps under
// `STORAGE_KEYS.PLACEMENT_SEAL`. An entry whose seal does not verify — one a script wrote into the key, one
// whose credential or window was edited after it was written, one an earlier build wrote in another shape — is
// dropped exactly as an entry with no expiry is, so the credential a read presents is the one the product
// itself recorded for that order and not one anybody could write down. The secret is a second one rather than
// the session table's: a sign-out rotates that one, and a rotation must not reach a guest's own confirmation.
// A browser that refuses storage gets no durability at all here — no secret can be kept there and no record
// can be read back — so only the record this document wrote in its own memory answers a read made inside it.

/** One order this browser placed without an account: the credential its submission minted, the instant that
 * credential stops being usable, and the seal that proves this browser recorded the pair. Exported because the
 * record's shape has one home — this module — and both halves of the placement read it through the functions
 * below. */
export interface Placement {
  readonly orderId: OrderId;
  readonly token: string;
  readonly expiresAt: string;
  /** The keyed digest of this record's own members under this browser's placement seal secret. */
  readonly seal: string;
}

/** How many placements are kept, newest first: the confirmation of a recent order reopens after a
 * reload, while a browser that places order after order cannot grow the payload without bound. */
const KEPT_PLACEMENTS = 20;

/** The seal secret's shape: a non-blank string, the only payload this module reads back from its own key. */
function isSealSecret(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** How many random bytes the seal secret is minted from when this browser holds none: thirty-two, 256 bits. */
const SEAL_SECRET_BYTES = 32;

/**
 * The secret this browser seals its placement records with: the one held under
 * `STORAGE_KEYS.PLACEMENT_SEAL`, minted and written there when it is absent.
 *
 * It is read whenever one is needed rather than held for the life of the document, so a document that finds
 * the key gone mints a fresh secret instead of sealing new records with a value no longer standing. What the
 * key holds after the write is what is returned, so a second document minting at the same instant cannot leave
 * this one sealing records under a secret no later reader will find. A browser that refuses storage is not
 * refused its orders for this: no secret can be kept there, nothing durable can be read back there anyway, and
 * the record this document wrote still answers a read made inside it.
 */
function readSealSecret(): string {
  const held = readStored<string>(STORAGE_KEYS.PLACEMENT_SEAL, "", isSealSecret);
  if (held !== "") return held;
  const minted = randomHexText(SEAL_SECRET_BYTES);
  // Best-effort, like every write through the storage util: a refused write costs this document's records
  // their durability, which is the state a browser holding no storage is in already.
  writeStored(STORAGE_KEYS.PLACEMENT_SEAL, minted);
  const adopted = readStored<string>(STORAGE_KEYS.PLACEMENT_SEAL, "", isSealSecret);
  return adopted === "" ? minted : adopted;
}

/** The text one placement is sealed over: its own members in the record's own terms — the order it names, the
 * credential recorded for it and the instant that credential stops being usable — so an edited credential, an
 * edited window, and an identifier pointing the record at another order each change this text and the seal
 * written beside it no longer verifies. */
function sealText(placement: Omit<Placement, "seal">): string {
  return JSON.stringify([placement.orderId, placement.token, placement.expiresAt]);
}

/** The seal of one placement: the keyed digest of its own text under this browser's placement secret. */
function sealOf(placement: Omit<Placement, "seal">, secret: string): string {
  return keyedDigest(secret, sealText(placement));
}

/** Seals a placement for the list: the record exactly as it is stored, its seal proving the members beside it
 * were recorded here. The one place a seal is minted, so every record this module writes is proved by the same
 * rule that reads one back. */
function sealPlacement(placement: Omit<Placement, "seal">): Placement {
  return { ...placement, seal: sealOf(placement, readSealSecret()) };
}

/** A row read back from the durable list: the members a placement is made of, each read as the type it was
 * written as, with the seal this module writes beside them. This is the shape guard's answer and not the
 * record's type — a row holding no usable seal is dropped by {@link storedPlacements} rather than handed back
 * as a credential — which is why its seal is read as optional here and has to be proved first. */
interface StoredRow {
  readonly orderId: OrderId;
  readonly token: string;
  readonly expiresAt: string;
  readonly seal?: string;
}

/** Whether a value read back is one row of the durable list: the identifier, the credential and an expiry this
 * module can read, each present as text, with the seal absent or read as a string.
 *
 * Content the current build does not describe is discarded rather than read in part: an entry with no expiry,
 * or one whose expiry cannot be parsed, is not a row and takes the whole payload with it — the entry an earlier
 * build wrote, carrying a submission's idempotency key as its credential and no expiry at all, must read
 * nothing rather than being honoured as a credential that never lapses. A row that reads as a row but cannot be
 * proved is dropped on its own by {@link storedPlacements}, so an entry a script wrote over this list cannot
 * take the records beside it down with it. */
function isStoredRow(value: unknown): value is StoredRow {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    readonly orderId?: unknown;
    readonly token?: unknown;
    readonly expiresAt?: unknown;
    readonly seal?: unknown;
  };
  return (
    typeof candidate.orderId === "string" &&
    typeof candidate.token === "string" &&
    typeof candidate.expiresAt === "string" &&
    parseIso(candidate.expiresAt) !== null &&
    (candidate.seal === undefined || typeof candidate.seal === "string")
  );
}

/**
 * Whether a stored value is the payload this module writes: a list whose every entry is a row.
 *
 * Every member of every entry is guarded, so a payload of another shape — or one holding a single entry that is
 * not a row — is discarded whole rather than read in part, which is what keeps a value this build cannot
 * describe out of the read that would present it. Whether a row's seal is the one this browser wrote is judged
 * after this guard, one row at a time, so a single unprovable entry does not discard the list it sits in.
 */
function isPlacementList(value: unknown): value is StoredRow[] {
  return Array.isArray(value) && value.every(isStoredRow);
}

/** The placement a row holds, or `undefined` when the row cannot be proved to have been recorded here: the seal
 * beside its members has to be the one those members produce under this browser's secret, so an entry naming an
 * order, a credential or a window this browser never recorded — or one whose credential or window was edited
 * after it was written — is dropped rather than honoured as a credential. */
function provedPlacement(row: StoredRow, secret: string): Placement | undefined {
  const seal = row.seal;
  if (seal === undefined || seal !== sealOf(row, secret)) return undefined;
  return { orderId: row.orderId, token: row.token, expiresAt: row.expiresAt, seal };
}

/** The placements this browser holds, newest first: an empty list when nothing is stored, the store cannot be
 * reached, or the payload fails its guard; every row of the payload is proved against this browser's seal
 * secret before it is admitted, so a record this browser did not write is not held rather than handed back. */
function storedPlacements(): readonly Placement[] {
  const rows = readStored<StoredRow[]>(STORAGE_KEYS.ORDER_TOKENS, [], isPlacementList);
  const secret = readSealSecret();
  const placements: Placement[] = [];
  for (const row of rows) {
    const proved = provedPlacement(row, secret);
    if (proved !== undefined) placements.push(proved);
  }
  return placements;
}

/** The placements written while this document has been open, by the order each was written for.
 *
 * The durable list above is what carries a placement across a reload; this is what answers a read in a
 * document that has no store to write to at all — Web Storage refused or absent, which is the state a unit
 * case runs in — and it is why a refused write does not cost the buyer the order they just placed. The two
 * are written together and judged the same way, so a reader never sees one without the other. Every record
 * here was sealed by this module in this document, which is why one is held without being proved again: the
 * durable half is the part a document that did not write it reads back, and the part the seal exists for. */
const writtenHere = new Map<OrderId, Placement>();

/**
 * The record this browser stored for one order, exactly as it was written, or `null` when it stored none.
 *
 * What this document wrote comes first and the durable list follows, because both hold the same record and
 * the durable half is what a later document reads: a read made in the document that placed the order is
 * therefore answered without reaching the store at all. A durable entry this browser cannot prove it wrote
 * is not a record at all — {@link storedPlacements} never hands one back — so an entry somebody else wrote
 * into the key answers nothing.
 *
 * @param orderId - The identifier the record is held under.
 * @returns The stored record, or `null` when this browser stored none for that order.
 */
export function placementFor(orderId: OrderId): Placement | null {
  return writtenHere.get(orderId) ?? storedPlacements().find((p) => p.orderId === orderId) ?? null;
}

/**
 * The instant a placement stops being usable, as the ISO text the record keeps: the instant the order was
 * placed moved on by {@link ORDER_PLACEMENT_TTL_MS}.
 *
 * The window is measured from the order's own placement instant rather than from the clock of this call, so
 * the client that placed the order and the seam that created it compute the same expiry from the same fact.
 * An order whose placement instant cannot be read is still given a window, measured from this call's clock:
 * a credential that never lapses is the state the window exists to end.
 */
function expiryOf(order: Order): string {
  const placedAt = parseIso(order.placedAt) ?? new Date();
  return toIsoDateTime(new Date(placedAt.getTime() + ORDER_PLACEMENT_TTL_MS));
}

/** Whether a placement's window is still open: a placement whose expiry cannot be read is refused, because
 * an unreadable expiry is not a licence to read an order. */
function isLive(placement: Placement, now: Date = new Date()): boolean {
  const expiresAt = parseIso(placement.expiresAt);
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

/**
 * Whether a placement admits the credential a read presented: the record's window is still open and the value
 * presented is the credential it holds.
 *
 * It is the one comparison of a presented credential against a recorded one, so the seam's own copy of the
 * record and the durable one are judged by the same rule — and by the same window — rather than by two that
 * could drift apart.
 *
 * @param placement - The record held for the order, `null` or absent when none is.
 * @param presented - The credential the read presented, `undefined` when it presented none.
 * @returns `true` only when that record's credential is what was presented and the window is open.
 */
export function placementAdmitsCredential(
  placement: Placement | null | undefined,
  presented: string | undefined,
): boolean {
  if (placement === null || placement === undefined) return false;
  if (presented === undefined || presented.trim() === "") return false;
  return placement.token === presented && isLive(placement);
}

/**
 * Remembers the placement of an order this browser created, under the credential its submission carried,
 * so the buyer's own confirmation can be reopened after a reload.
 *
 * Only an order that names no account is recorded, because an order that names an account is read
 * through the session that owns it and needs no other credential. **The first credential recorded for an
 * order stands**: a repeat of a submission whose idempotency key already placed this order is answered
 * with the order it created and mints a fresh credential of its own, and that repeat's credential is
 * dropped rather than written, so the seam's record of the placement and the client's own stay one value.
 * A credential with nothing in it records nothing, because there is nothing to prove a later read with.
 * The record carries the instant its credential stops being usable — {@link ORDER_PLACEMENT_TTL_MS} measured
 * from the order's own placement instant, so both halves of the placement compute one expiry from one fact —
 * which is what makes a placement a window rather than a credential held for ever, and it is written sealed,
 * so a record this browser did not write is never read back as a credential.
 * What is written is the list {@link mergedPlacements} composes: the durable records as they stand at this
 * instant, so a document that writes second keeps the records a document that wrote first left behind.
 * A refused write is tolerated silently, exactly as every other caller of `writeStored` tolerates it: the
 * order is placed either way, and the record this document holds still answers a read made inside it.
 *
 * @param order - The order that was created.
 * @param token - The credential the submission that created it was sent under, `undefined` when the
 * submission presented none.
 * @returns The record held for that order — the one this call wrote, or the one an earlier call left — and
 * `null` when the order names an account or the credential is blank.
 */
export function rememberPlacement(order: Order, token: string | undefined): Placement | null {
  if (order.customerId !== null || token === undefined || token.trim() === "") return null;
  const existing = placementFor(order.id);
  if (existing !== null) return existing;
  const placement = sealPlacement({ orderId: order.id, token, expiresAt: expiryOf(order) });
  writtenHere.set(placement.orderId, placement);
  writeStored<readonly Placement[]>(STORAGE_KEYS.ORDER_TOKENS, mergedPlacements(placement));
  return placement;
}

/**
 * The list one new placement is written as: the durable records as they stand at the moment of the write —
 * read again here rather than carried from the document that is writing — beside the new record, trimmed to
 * {@link KEPT_PLACEMENTS} and ordered newest first.
 *
 * **The first credential recorded for an order stands**: an order the durable list already holds a record for
 * keeps it, so a repeat of a submission, which mints a credential of its own, cannot displace the value the
 * order was first recorded with. An entry whose window has lapsed is not carried forward, because a lapsed
 * credential reads nothing and carrying it would only fill the list with records nothing can be read with; an
 * entry this browser cannot prove is not carried either, because {@link storedPlacements} never hands one back.
 * Newest first is by the record's own window — the placement instant moved on by one constant — so a document
 * whose placement is older cannot put that older record ahead of a newer one, which is what keeps the trim
 * from dropping the record a later document placed.
 *
 * A read and a write are two steps with nothing between them but the gap in which another document can write,
 * so this states the rule every writer here applies rather than making the pair atomic: each write merges the
 * list it finds instead of replacing it with a list of its own.
 */
function mergedPlacements(fresh: Placement): readonly Placement[] {
  const held = storedPlacements().filter(
    (entry) => entry.orderId !== fresh.orderId && isLive(entry),
  );
  return [fresh, ...held]
    .sort((left, right) => windowEnd(right) - windowEnd(left))
    .slice(0, KEPT_PLACEMENTS);
}

/** The instant a placement's window ends, in milliseconds: read through the same parse the guard has already
 * proved, so an entry whose window cannot be read — which the guard discards — sorts last rather than throwing
 * here. */
function windowEnd(placement: Placement): number {
  return parseIso(placement.expiresAt)?.getTime() ?? 0;
}

/**
 * The credential this browser holds for an order it placed without an account, or `null` when it holds none
 * that is still usable: the client-side half of the seam's order-read credential, and the only thing a
 * confirmation route carrying an identifier but no session can present.
 *
 * A placement past its window answers `null` exactly as an absent one does, so the client sends no credential
 * for it, the same way it sends none for an order it never placed.
 *
 * @param orderId - The identifier the read asks for.
 * @returns The credential stored for that order while its window is open, `null` otherwise.
 */
export function placementTokenFor(orderId: OrderId): string | null {
  const placement = placementFor(orderId);
  return placement !== null && isLive(placement) ? placement.token : null;
}

/**
 * Forgets every placement this browser holds — the records this document wrote and the durable list alike —
 * so a fresh case starts with none: the store is rewritten empty through the same util every other write
 * uses, which is what keeps a case from reading an order an earlier case placed.
 */
export function clearPlacements(): void {
  writtenHere.clear();
  writeStored<readonly Placement[]>(STORAGE_KEYS.ORDER_TOKENS, []);
}
