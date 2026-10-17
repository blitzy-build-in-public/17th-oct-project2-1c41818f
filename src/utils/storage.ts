/**
 * Path: src/utils/storage.ts
 * Purpose: Typed, versioned, failure-tolerant localStorage access for the cart, the session and the last-used range
 * Lines: 303
 */

import { STORAGE_KEYS, STORAGE_KEY_PREFIX, STORAGE_VERSION } from "@/constants/config";

/**
 * The keys this module accepts: the three entries of `STORAGE_KEYS` and nothing else, so every key
 * read or written here is the one `src/constants/config.ts` declares and no other application's
 * entry on the same origin is ever touched.
 */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Proves a value read back through {@link readStored} is the shape its caller expects. Supply one
 * whenever the stored shape could have changed between builds: a payload that fails the guard is
 * discarded in favour of the caller's fallback rather than handed back as `T`.
 */
export type StorageValidator<T> = (value: unknown) => value is T;

/**
 * The versioned wrapper every payload is written in. A payload stamped with a version other than the
 * current `STORAGE_VERSION` is treated as absent — a stored shape is never migrated silently, because
 * content the current types do not describe cannot go to a reducer that expects them.
 */
interface StorageEnvelope {
  readonly version: number;
  readonly value: unknown;
}

/** The Web Storage methods this module drives, named so no DOM type reaches its signatures. */
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Every function below performs Web Storage I/O, and the side effect is taken here and nowhere else:
// this module is the only place in the product that reads or writes `localStorage`, so a context or a
// page persists through these functions rather than reaching for the store itself.

/**
 * The global object seen as an optional Web Storage surface. Declaring `localStorage` optional rather
 * than relying on the DOM's non-optional declaration is what lets this module load under the node test
 * project (`tests/unit/**`), which has no `window` and no store at all.
 */
const webStorageScope: { readonly localStorage?: StorageLike | null } = globalThis;

/**
 * The temporary entry the availability probe writes and removes: derived from the product's own
 * namespace, so it is not an invented key, and not a member of `STORAGE_KEYS`, so nothing reads it.
 */
const PROBE_KEY = `${STORAGE_KEY_PREFIX}.probe`;

/** What the probe writes; a value with no meaning anywhere else in the product. */
const PROBE_VALUE = "salespro-storage-probe";

/** The memoised answer of the availability probe, `null` until the first call asks for it. */
let availability: boolean | null = null;

/**
 * Reports whether this environment can persist a value.
 *
 * The answer is probed once and memoised, so it can also go stale: a browser policy that withdraws
 * storage after the probe, or grants it after a negative answer, does not change what this returns
 * during the same page load. Treat it as a hint about what to offer the reader, never as a
 * precondition for a call — every other function here resolves the store when it runs.
 *
 * @returns `true` when a value can be written, read back and removed; `false` in an environment with
 *   no store at all (the node test project) or one that throws when accessed.
 */
export function isStorageAvailable(): boolean {
  const probed = availability ?? probeStorage();
  availability = probed;
  return probed;
}

/**
 * Writes a temporary entry, reads it back and removes it: the only reliable answer to "can this
 * browser persist anything", since a store that refuses writes (a private window, a blocked cookie
 * policy, a full quota) or fails its read-back is unusable here.
 */
function probeStorage(): boolean {
  const store = openStore();
  if (store === null) return false;
  try {
    store.setItem(PROBE_KEY, PROBE_VALUE);
    const echoed = store.getItem(PROBE_KEY) === PROBE_VALUE;
    store.removeItem(PROBE_KEY);
    return echoed;
  } catch {
    // A refused write, a throwing read or a throwing cleanup: the temporary entry is not one of the
    // product's keys and nothing ever reads it, so a failed cleanup leaves no trace behind.
    return false;
  }
}

/**
 * Resolves the store for the call being made, so persistence keeps working when a policy relaxes and
 * stops quietly when it is withdrawn; `null` means this environment has none.
 */
function openStore(): StorageLike | null {
  try {
    return webStorageScope.localStorage ?? null;
  } catch {
    // Reading the property is what throws where storage is withheld (a blocked third-party frame, a
    // locked-down profile), so the throw is this module's unavailable answer.
    return null;
  }
}

/** Reads one raw entry, or `null` when it is absent or the store refuses the read. */
function readRawItem(key: StorageKey): string | null {
  const store = openStore();
  if (store === null) return null;
  try {
    return store.getItem(key);
  } catch {
    // A store that throws on read cannot be used: the caller's fallback is the answer.
    return null;
  }
}

/** Writes one raw entry, replacing whatever the key held; `false` when the store refused the write. */
function writeRawItem(key: StorageKey, payload: string): boolean {
  const store = openStore();
  if (store === null) return false;
  try {
    store.setItem(key, payload);
    return true;
  } catch {
    // The caller keeps its in-memory state; the refused write is reported by the return value.
    return false;
  }
}

/**
 * Removes one raw entry; `false` when no store can be reached or the store refused the drop, `true`
 * when the entry is gone — dropped, or never there to drop.
 */
function removeRawItem(key: StorageKey): boolean {
  const store = openStore();
  if (store === null) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    // An entry the store refuses to drop is reported rather than raised: persistence is best-effort,
    // and the caller keeps the in-memory state that is already the product's source of truth.
    return false;
  }
}

/** Wraps a value in the versioned envelope; `null` when the value cannot be serialised at all. */
function encodeEnvelope<T>(value: T): string | null {
  const envelope: StorageEnvelope = { version: STORAGE_VERSION, value };
  try {
    return JSON.stringify(envelope) ?? null;
  } catch {
    // A cyclic value or a bigint: the caller's write reports failure rather than storing a payload
    // that could never be read back into the shape it says it holds.
    return null;
  }
}

/**
 * Narrows content of unknown provenance to the envelope shape this module writes, accepting any
 * numeric version so a payload from an older build is recognisable rather than merely absent.
 */
function isEnvelopeShape(value: unknown): value is StorageEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly version?: unknown; readonly value?: unknown };
  return typeof candidate.version === "number" && "value" in candidate;
}

/** Decodes a raw payload into the envelope it holds; `null` when it is not one this module wrote. */
function decodeEnvelope(raw: string): StorageEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isEnvelopeShape(parsed) ? parsed : null;
  } catch {
    // Unparseable content is not this build's payload: the caller's fallback is the answer, and the
    // unreadable content is never returned from here or written into a message.
    return null;
  }
}

/**
 * Reads and decodes one key's payload; `null` covers an absent entry, an unavailable store and
 * undecodable content. A payload carrying a stale version comes back as it stands, so
 * {@link getStoredVersion} can report it and {@link readStored} can turn it into a fallback.
 */
function readEnvelope(key: StorageKey): StorageEnvelope | null {
  const raw = readRawItem(key);
  if (raw === null || raw.length === 0) return null;
  return decodeEnvelope(raw);
}

/**
 * Reads a stored value, or the caller's fallback when there is nothing usable to read.
 *
 * Reads from the store. The fallback is returned — never an exception, never a partly decoded value —
 * for every degrading case: no store, a refused read, a key never written, unparseable content, a
 * payload written by a different `STORAGE_VERSION` (never migrated silently), and a value the
 * supplied guard rejects.
 *
 * @param key - The product-owned key to read.
 * @param fallback - What to return when nothing usable is stored, returned exactly as given, so a
 *   caller passing an object or an array hands back that same reference.
 * @param isValid - Optional guard proving the payload is `T`. Supply one whenever the stored shape
 *   could have changed between builds: without one TypeScript has nothing to check the payload
 *   against, and the value is handed back as `T` by assertion.
 * @returns The stored value, or `fallback`.
 */
export function readStored<T>(key: StorageKey, fallback: T, isValid?: StorageValidator<T>): T {
  const envelope = readEnvelope(key);
  if (envelope === null || envelope.version !== STORAGE_VERSION) return fallback;
  if (isValid !== undefined && !isValid(envelope.value)) return fallback;
  // A supplied guard has already rejected anything it does not recognise; without one, `T` is the
  // caller's assertion about a payload this module did not produce.
  return envelope.value as T;
}

/**
 * Reports whether {@link readStored} would find a usable value under the key.
 *
 * Reads from the store. A payload written by an older build, and content that cannot be decoded, do
 * not count as stored, because `readStored` returns its fallback for both; use
 * {@link getStoredVersion} to tell "never written" from "written by an older build".
 *
 * @param key - The product-owned key to test.
 * @returns `true` when the key holds a payload that decodes and carries the current version.
 */
export function hasStored(key: StorageKey): boolean {
  const envelope = readEnvelope(key);
  return envelope !== null && envelope.version === STORAGE_VERSION;
}

/**
 * Stores a value under a key inside the versioned envelope, replacing whatever was there.
 *
 * Writes to the store. A refusal is reported rather than raised, because persistence is best-effort:
 * the in-memory state the caller holds is already the product's source of truth, and the application
 * works with no store at all.
 *
 * @param key - The product-owned key to write.
 * @param value - The value to store, in the shape `T` describes. It has to be JSON-serialisable:
 *   JSON drops a function member and a member holding `undefined`, and cannot encode a cyclic
 *   reference or a `bigint`, so such a value is reported as a refused write.
 * @returns `true` when the value was written, `false` when it was not — no store, a refused write (a
 *   full quota is the ordinary case), or a value that cannot be serialised.
 */
export function writeStored<T>(key: StorageKey, value: T): boolean {
  const payload = encodeEnvelope(value);
  if (payload === null) return false;
  return writeRawItem(key, payload);
}

/**
 * Removes the value stored under a key, if any. Writes to the store.
 *
 * A store that is not there at all, or one that refuses to drop the entry, is reported as `false`
 * rather than raised: persistence is not the source of truth for anything here.
 *
 * @param key - The product-owned key to clear.
 * @returns `true` when the entry is gone — dropped, or never there to drop — and `false` when no
 *   store can be reached or the store refused to drop it.
 */
export function removeStored(key: StorageKey): boolean {
  return removeRawItem(key);
}

/**
 * Removes every entry this product owns: the keys of `STORAGE_KEYS`, and nothing else in the store.
 *
 * Writes to the store. Anything another application on the same origin wrote is left exactly as it
 * was, which is why this walks the product's own keys instead of calling the store's `clear`. Every
 * key is attempted even when one is refused, so a single stubborn entry cannot leave the rest of the
 * product's entries behind.
 *
 * @returns `true` when every entry is gone, and `false` when at least one could not be dropped.
 */
export function clearStoredKeys(): boolean {
  let everyKeyDropped = true;
  for (const key of Object.values(STORAGE_KEYS)) {
    if (!removeRawItem(key)) everyKeyDropped = false;
  }
  return everyKeyDropped;
}

/**
 * Reports the version stamped on a stored payload, so a caller can decide what to tell the reader.
 *
 * Reads from the store. This is how a screen tells "you have no saved cart" from "your saved cart was
 * written by an older build and has been discarded", and the decision stays with the caller: this
 * module produces no copy, because the message belongs to `src/constants/content.ts` and the toast
 * layer that renders it.
 *
 * @param key - The product-owned key to inspect.
 * @returns The stored version, including one that differs from the current `STORAGE_VERSION`, or
 *   `undefined` when nothing is stored there or the content is not a payload this module wrote.
 */
export function getStoredVersion(key: StorageKey): number | undefined {
  return readEnvelope(key)?.version;
}
