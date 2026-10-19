/**
 * Path: tests/unit/utils/storage.test.ts
 * Purpose: The typed, versioned and failure-tolerant storage contract src/utils/storage.ts offers over the durable and the tab-scoped Web Storage areas
 * Lines: 467
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_STORAGE_KEYS, STORAGE_KEYS, STORAGE_VERSION } from "@/constants/config";
import { FIXED_DATE, FIXED_DATE_RANGE, FIXED_EARLIER_DATE, FIXED_NOW } from "../../fixtures";

import type { DateRange } from "@/types/common";

/*
 * Every case drives the real module over a Web Storage stand-in installed on `globalThis` — the one surface
 * `src/utils/storage.ts` reads — and installs nothing else: no service, context, reducer or store of the
 * product's own is replaced. The stand-in is put back by the case's own teardown, so a case answers on its own
 * and in any order, and the module is taken from a fresh registry each time because the availability probe's
 * answer is memoised per module instance and a case about the probe cannot share an instance that has already
 * answered it. Nothing outside the store is asserted: the outcomes are the values the module returns and the
 * entries the store then holds.
 */

/** The two areas the module reads, named once so a helper and a case agree on the spelling. */
type StorageAreaName = "localStorage" | "sessionStorage";

/** What the two areas held before the first case replaced them, put back after every case. */
const ORIGINAL_AREAS: readonly [StorageAreaName, PropertyDescriptor | undefined][] = [
  ["localStorage", Object.getOwnPropertyDescriptor(globalThis, "localStorage")],
  ["sessionStorage", Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")],
];

/**
 * A Web Storage stand-in over an entries map, with a switch per operation so a case can make any one of them
 * refuse. It is the fake transactions.test.ts keeps for the cart's own seam, given a read switch and a
 * removal switch because the session area and the sweep are asserted here too.
 */
interface FakeStore {
  readonly entries: Map<string, string>;
  readonly store: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Makes every later write throw, as a full quota does. */
  refuseWrites(): void;
  /** Makes every later read throw, as a profile that withdraws the store does. */
  refuseReads(): void;
  /** Makes every later removal throw. */
  refuseRemovals(): void;
}

/** Builds an empty stand-in: three working operations until a case refuses one of them. */
function createStore(): FakeStore {
  const entries = new Map<string, string>();
  let writesRefused = false;
  let readsRefused = false;
  let removalsRefused = false;
  return {
    entries,
    store: {
      getItem(key: string): string | null {
        if (readsRefused) throw new DOMException("Storage is unavailable.", "SecurityError");
        return entries.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        if (writesRefused) throw new DOMException("Quota exceeded.", "QuotaExceededError");
        entries.set(key, value);
      },
      removeItem(key: string): void {
        if (removalsRefused) throw new DOMException("The drop was refused.", "SecurityError");
        entries.delete(key);
      },
    },
    refuseWrites: () => {
      writesRefused = true;
    },
    refuseReads: () => {
      readsRefused = true;
    },
    refuseRemovals: () => {
      removalsRefused = true;
    },
  };
}

/** Installs `value` as the named area, whatever it is: a working store, `null`, or nothing at all. */
function installArea(area: StorageAreaName, value: unknown): void {
  Object.defineProperty(globalThis, area, { configurable: true, writable: true, value });
}

/** Installs an area that throws the moment its property is read, as a blocked cookie policy does. */
function installUnreadableArea(area: StorageAreaName): void {
  Object.defineProperty(globalThis, area, {
    configurable: true,
    get() {
      throw new DOMException("Storage is blocked.", "SecurityError");
    },
  });
}

/** Puts both areas back exactly as the environment had them, so no case outlives its own store. */
function restoreAreas(): void {
  for (const [area, descriptor] of ORIGINAL_AREAS) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, area);
    else Object.defineProperty(globalThis, area, descriptor);
  }
}

/**
 * Loads the module under test into a fresh registry, so the probe it memoises has not answered yet. Without
 * this a case about the probe would depend on whether an earlier case in the file had already asked.
 */
async function freshStorage(): Promise<typeof import("@/utils/storage")> {
  vi.resetModules();
  return import("@/utils/storage");
}

/** The payload a durable round-trip stores: a range, the shape the last-used report key carries. */
const STORED_RANGE: DateRange = FIXED_DATE_RANGE;

/** What a read answers when nothing usable is stored; asserted by identity, as the module documents. */
const FALLBACK_RANGE: DateRange = { from: FIXED_EARLIER_DATE, to: FIXED_DATE };

/** The session payload the tab-scoped cases round-trip: a marker with an instant in it. */
const SESSION_MARKER = FIXED_NOW;

/** A payload that cannot be serialised at all: the cyclic object `JSON.stringify` refuses. */
function cyclicPayload(): Record<string, unknown> {
  const cyclic: Record<string, unknown> = { name: "cyclic" };
  cyclic.self = cyclic;
  return cyclic;
}

/** Raw entries the module did not write, each one a case the decoder has to refuse. */
const FOREIGN_PAYLOADS: readonly [string, string][] = [
  ["content that is not JSON", "{ not json at all"],
  ["an empty entry", ""],
  ["a bare number", "5"],
  ["the JSON literal null", "null"],
  ["an object with no numeric version", JSON.stringify({ version: "1", value: STORED_RANGE })],
  ["an envelope with no value member", JSON.stringify({ version: STORAGE_VERSION })],
];

/** A stored payload the guard under test rejects, and one it accepts, over the same builder. */
const RANGE_GUARD_CASES: readonly [string, string][] = [
  ["a pair whose ends are text", JSON.stringify({ version: STORAGE_VERSION, value: STORED_RANGE })],
  [
    "a pair whose end is a number",
    JSON.stringify({ version: STORAGE_VERSION, value: { from: FIXED_DATE, to: 30 } }),
  ],
  ["a value that is not a pair at all", JSON.stringify({ version: STORAGE_VERSION, value: "30d" })],
];

/** What a case installs in place of an area, and how it does it. */
const ABSENT_AREAS: readonly [string, () => void][] = [
  ["no area at all", () => installArea("localStorage", undefined)],
  ["an area that is null", () => installArea("localStorage", null)],
  ["an area whose property throws", () => installUnreadableArea("localStorage")],
];

/** Reads a range back through the module's own guard, so a case states the shape it expects. */
function isDateRange(value: unknown): value is DateRange {
  if (typeof value !== "object" || value === null) return false;
  const { from, to } = value as { readonly from?: unknown; readonly to?: unknown };
  return typeof from === "string" && typeof to === "string";
}

/** Proves a session marker is the text the case stored, so a read of it is asserted as a shape. */
function isMarker(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

afterEach(() => {
  restoreAreas();
});

describe("the durable area", () => {
  it("writes a value in the versioned envelope, reads it back and drops it again", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    installArea("localStorage", fake.store);

    expect(storage.writeStored(STORAGE_KEYS.REPORT_RANGE, STORED_RANGE)).toBe(true);
    // What the store holds is the envelope, stamped with the version in force.
    expect(JSON.parse(fake.entries.get(STORAGE_KEYS.REPORT_RANGE) ?? "")).toEqual({
      version: STORAGE_VERSION,
      value: STORED_RANGE,
    });
    expect(storage.readStored<DateRange>(STORAGE_KEYS.REPORT_RANGE, FALLBACK_RANGE)).toEqual(
      STORED_RANGE,
    );
    expect(storage.hasStored(STORAGE_KEYS.REPORT_RANGE)).toBe(true);
    expect(storage.getStoredVersion(STORAGE_KEYS.REPORT_RANGE)).toBe(STORAGE_VERSION);

    expect(storage.removeStored(STORAGE_KEYS.REPORT_RANGE)).toBe(true);
    expect(fake.entries.has(STORAGE_KEYS.REPORT_RANGE)).toBe(false);
    expect(storage.hasStored(STORAGE_KEYS.REPORT_RANGE)).toBe(false);
    expect(storage.getStoredVersion(STORAGE_KEYS.REPORT_RANGE)).toBeUndefined();
    // A key never written and one just dropped read the same, and both hand back the caller's own fallback.
    expect(storage.readStored<DateRange>(STORAGE_KEYS.REPORT_RANGE, FALLBACK_RANGE)).toBe(
      FALLBACK_RANGE,
    );
    // Dropping what is not there is still the entry being gone.
    expect(storage.removeStored(STORAGE_KEYS.REPORT_RANGE)).toBe(true);
  });

  it.each(FOREIGN_PAYLOADS)("answers the fallback for %s", async (_label, raw) => {
    const storage = await freshStorage();
    const fake = createStore();
    fake.entries.set(STORAGE_KEYS.REPORT_RANGE, raw);
    installArea("localStorage", fake.store);

    expect(storage.readStored<DateRange>(STORAGE_KEYS.REPORT_RANGE, FALLBACK_RANGE)).toBe(
      FALLBACK_RANGE,
    );
    expect(storage.hasStored(STORAGE_KEYS.REPORT_RANGE)).toBe(false);
    expect(storage.getStoredVersion(STORAGE_KEYS.REPORT_RANGE)).toBeUndefined();
  });

  it("treats a payload an older build wrote as absent and still names its version", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    const older = STORAGE_VERSION - 1;
    fake.entries.set(
      STORAGE_KEYS.REPORT_RANGE,
      JSON.stringify({ version: older, value: STORED_RANGE }),
    );
    installArea("localStorage", fake.store);

    // The shape is never migrated silently: the caller's fallback answers instead of the older payload.
    expect(storage.readStored<DateRange>(STORAGE_KEYS.REPORT_RANGE, FALLBACK_RANGE)).toBe(
      FALLBACK_RANGE,
    );
    expect(storage.hasStored(STORAGE_KEYS.REPORT_RANGE)).toBe(false);
    // The version is still reported, which is what lets a screen tell "never saved" from "saved by an older build".
    expect(storage.getStoredVersion(STORAGE_KEYS.REPORT_RANGE)).toBe(older);
  });

  it.each(RANGE_GUARD_CASES)(
    "hands back a stored %s only while the guard accepts it",
    async (_label, raw) => {
      const storage = await freshStorage();
      const fake = createStore();
      fake.entries.set(STORAGE_KEYS.REPORT_RANGE, raw);
      installArea("localStorage", fake.store);

      const accepted = storage.readStored<DateRange>(
        STORAGE_KEYS.REPORT_RANGE,
        FALLBACK_RANGE,
        isDateRange,
      );
      const shape = JSON.parse(raw) as { readonly value: unknown };
      if (isDateRange(shape.value)) {
        expect(accepted).toEqual(shape.value);
      } else {
        // A payload the guard refuses is discarded for the fallback rather than handed back as the wrong shape.
        expect(accepted).toBe(FALLBACK_RANGE);
      }
      // Without a guard the payload is the caller's own assertion about what it stored.
      expect(storage.readStored<unknown>(STORAGE_KEYS.REPORT_RANGE, null)).toEqual(shape.value);
    },
  );

  it("reports a value it cannot serialise as a refused write", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    installArea("localStorage", fake.store);

    expect(storage.writeStored(STORAGE_KEYS.CART, cyclicPayload())).toBe(false);
    // Nothing is stored, so a read answers the fallback and the key reports no version.
    expect(fake.entries.size).toBe(0);
    expect(storage.readStored(STORAGE_KEYS.CART, "none")).toBe("none");
    expect(storage.getStoredVersion(STORAGE_KEYS.CART)).toBeUndefined();
  });

  it("reports a store that refuses a write, a read or a drop as the caller's fallback", async () => {
    const storage = await freshStorage();
    const envelope = JSON.stringify({ version: STORAGE_VERSION, value: "ses_demo" });

    // A store that refuses the write loses the value and says so; the caller keeps its in-memory state.
    const refusingWrites = createStore();
    refusingWrites.refuseWrites();
    installArea("localStorage", refusingWrites.store);
    expect(storage.writeStored(STORAGE_KEYS.SESSION, "ses_demo")).toBe(false);
    expect(refusingWrites.entries.size).toBe(0);

    // A store that refuses the read answers the fallback rather than raising at the caller.
    const refusingReads = createStore();
    refusingReads.refuseReads();
    refusingReads.entries.set(STORAGE_KEYS.SESSION, envelope);
    installArea("localStorage", refusingReads.store);
    expect(storage.readStored(STORAGE_KEYS.SESSION, "none")).toBe("none");
    expect(storage.hasStored(STORAGE_KEYS.SESSION)).toBe(false);
    expect(storage.getStoredVersion(STORAGE_KEYS.SESSION)).toBeUndefined();

    // A store that refuses the drop reports it, for the key and for the sweep alike.
    const refusingRemovals = createStore();
    refusingRemovals.refuseRemovals();
    refusingRemovals.entries.set(STORAGE_KEYS.SESSION, envelope);
    installArea("localStorage", refusingRemovals.store);
    expect(storage.removeStored(STORAGE_KEYS.SESSION)).toBe(false);
    expect(storage.clearStoredKeys()).toBe(false);
    expect(refusingRemovals.entries.has(STORAGE_KEYS.SESSION)).toBe(true);
  });

  it.each(ABSENT_AREAS)("degrades to its fallbacks where there is %s", async (_label, absent) => {
    const storage = await freshStorage();
    absent();

    // The probe is what a caller asks before offering persistence; it answers no, and never throws.
    expect(storage.isStorageAvailable()).toBe(false);
    expect(storage.writeStored(STORAGE_KEYS.CART, "unwritable")).toBe(false);
    expect(storage.readStored(STORAGE_KEYS.CART, "none")).toBe("none");
    expect(storage.hasStored(STORAGE_KEYS.CART)).toBe(false);
    expect(storage.getStoredVersion(STORAGE_KEYS.CART)).toBeUndefined();
    expect(storage.removeStored(STORAGE_KEYS.CART)).toBe(false);
    // The sweep attempts every key and reports the failure rather than raising one.
    expect(storage.clearStoredKeys()).toBe(false);
    // The tab-scoped area is resolved per call, so it degrades exactly as the durable one does.
    expect(storage.writeSessionStored(SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY, "marker")).toBe(
      false,
    );
    expect(storage.readSessionStored(SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY, "none")).toBe(
      "none",
    );
  });

  it("answers the probe true where a value can be written, read back and removed", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    installArea("localStorage", fake.store);

    expect(storage.isStorageAvailable()).toBe(true);
    // The probe leaves nothing behind: the entry it wrote is temporary and not one of the product's keys.
    expect([...fake.entries.keys()]).toEqual([]);
  });

  it("answers the probe false where the store refuses the probe's own write", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    fake.refuseWrites();
    installArea("localStorage", fake.store);

    // A store that cannot be written to cannot persist anything, so persistence is reported unavailable.
    expect(storage.isStorageAvailable()).toBe(false);
  });

  it("sweeps the product's own keys and leaves every other entry where it was", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    installArea("localStorage", fake.store);

    expect(storage.writeStored(STORAGE_KEYS.CART, "cart")).toBe(true);
    expect(storage.writeStored(STORAGE_KEYS.REPORT_RANGE, STORED_RANGE)).toBe(true);
    fake.entries.set("another-application.entry", "kept");

    expect(storage.clearStoredKeys()).toBe(true);
    expect(storage.hasStored(STORAGE_KEYS.CART)).toBe(false);
    expect(storage.hasStored(STORAGE_KEYS.REPORT_RANGE)).toBe(false);
    // The sweep walks the product's own key set; another writer on the same origin keeps its entry.
    expect(fake.entries.get("another-application.entry")).toBe("kept");

    // A key the caller never touched is reported gone rather than as an unperformed drop.
    expect(storage.removeStored(STORAGE_KEYS.ORDER_TOKENS)).toBe(true);
  });
});

describe("the tab's own session area", () => {
  it("round-trips a value through the session area and refuses what its guard rejects", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    installArea("sessionStorage", fake.store);

    expect(
      storage.writeSessionStored(SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY, SESSION_MARKER),
    ).toBe(true);
    expect(
      storage.readSessionStored(SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY, "none", isMarker),
    ).toBe(SESSION_MARKER);
    // The session write lands in the session area only: the durable area holds nothing of it.
    expect([...fake.entries.keys()]).toEqual([SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY]);
    expect(storage.readStored(STORAGE_KEYS.REPORT_RANGE, "none")).toBe("none");

    // A payload the guard refuses is discarded for the fallback, exactly as the durable read does.
    expect(
      storage.readSessionStored(
        SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY,
        "none",
        (value): value is string => value === "a marker no case stores",
      ),
    ).toBe("none");
  });

  it("answers the fallback for a session entry it did not write or an older build wrote", async () => {
    const storage = await freshStorage();
    const fake = createStore();
    const key = SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY;
    installArea("sessionStorage", fake.store);

    // Nothing was ever stored under the key.
    expect(storage.readSessionStored(key, "none", isMarker)).toBe("none");

    // Content that decodes to no envelope this module wrote.
    fake.entries.set(key, "not json");
    expect(storage.readSessionStored(key, "none", isMarker)).toBe("none");

    // A payload stamped by an older build, which is never migrated silently.
    fake.entries.set(key, JSON.stringify({ version: STORAGE_VERSION - 1, value: SESSION_MARKER }));
    expect(storage.readSessionStored(key, "none", isMarker)).toBe("none");

    // The current version, which is the one readable entry of the four.
    fake.entries.set(key, JSON.stringify({ version: STORAGE_VERSION, value: SESSION_MARKER }));
    expect(storage.readSessionStored(key, "none", isMarker)).toBe(SESSION_MARKER);
  });

  it("reports a session write it could not perform, and a value it cannot serialise", async () => {
    const storage = await freshStorage();
    const key = SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY;

    const refusingWrites = createStore();
    refusingWrites.refuseWrites();
    installArea("sessionStorage", refusingWrites.store);
    expect(storage.writeSessionStored(key, SESSION_MARKER)).toBe(false);
    expect(refusingWrites.entries.size).toBe(0);

    const working = createStore();
    installArea("sessionStorage", working.store);
    expect(storage.writeSessionStored(key, cyclicPayload())).toBe(false);
    expect(working.entries.size).toBe(0);

    // A store that refuses the read answers the fallback rather than raising at the caller.
    const refusingReads = createStore();
    refusingReads.refuseReads();
    refusingReads.entries.set(
      key,
      JSON.stringify({ version: STORAGE_VERSION, value: SESSION_MARKER }),
    );
    installArea("sessionStorage", refusingReads.store);
    expect(storage.readSessionStored(key, "none", isMarker)).toBe("none");
  });
});

describe("the last-used report range", () => {
  /** Stored payloads no consumer may adopt: each one answers the fallback it is handed. */
  const UNUSABLE_RANGES: readonly [string, unknown][] = [
    ["nothing stored at all", undefined],
    ["the JSON literal null", null],
    ["a number in place of a pair", 30],
    ["a pair with no ends", {}],
    ["a pair with one end", { from: FIXED_EARLIER_DATE }],
    ["a pair whose from is not text", { from: 30, to: FIXED_DATE }],
    ["a pair whose to is not text", { from: FIXED_EARLIER_DATE, to: null }],
    ["a pair whose days run backwards", { from: FIXED_DATE, to: FIXED_EARLIER_DATE }],
  ];

  it.each(UNUSABLE_RANGES)("opens on the fallback for %s", async (_label, stored) => {
    const storage = await freshStorage();

    expect(storage.storedRangeOr(stored, FALLBACK_RANGE)).toBe(FALLBACK_RANGE);
  });

  it("adopts a stored pair whose days the range rules accept", async () => {
    const storage = await freshStorage();

    const adopted = storage.storedRangeOr(STORED_RANGE, FALLBACK_RANGE);
    expect(adopted).toEqual(STORED_RANGE);
    // The pair is adopted as it stands rather than being rebuilt from the fallback's days.
    expect(adopted).not.toEqual(FALLBACK_RANGE);
  });
});
