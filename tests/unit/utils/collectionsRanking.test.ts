/**
 * Path: tests/unit/utils/collectionsRanking.test.ts
 * Purpose: Keyed indexing, reversal, frequency ranking and top-N selection helpers, including count boundaries, ties and absent values
 * Lines: 167
 */

import { describe, expect, it } from "vitest";

import { frequencyOf, keyBy, reverseCopy, sortByKey, topN } from "@/utils/collections";

// Test data -------------------------------------------------------------------------------------

/** One sale row: a plain shape small enough that a ranking assertion reads at a glance. */
interface SaleRow {
  readonly region: string;
  readonly revenueMinor: number;
}

/**
 * Five sales over three regions. `north` occurs three times and its last row is the cheapest of them, so
 * `keyBy` is shown to keep the last item carrying a key rather than the first, `frequencyOf` to rank the
 * repeated region first, and `topN` to take the best revenue rather than the earliest row.
 */
const SALES: readonly SaleRow[] = [
  { region: "north", revenueMinor: 1_200 },
  { region: "south", revenueMinor: 800 },
  { region: "north", revenueMinor: 2_400 },
  { region: "north", revenueMinor: 300 },
  { region: "east", revenueMinor: 1_900 },
];

const NO_SALES: readonly SaleRow[] = [];

/** One scored row: a label beside the numeric value a ranking reads off it. */
interface ScoredRow {
  readonly sku: string;
  readonly score: number;
}

/** Two rows sharing the largest score, so equal values are shown to keep input order. */
const TIED_ROWS: readonly ScoredRow[] = [
  { sku: "first", score: 7 },
  { sku: "second", score: 7 },
  { sku: "third", score: 3 },
];

/**
 * Five scored rows with a row of each rank and two absent scores: `topN` ranks numbers, so `NaN` is how an
 * absent value reaches it, and one block carries both the descending and the ascending expectation.
 */
const SCORED: readonly ScoredRow[] = [
  { sku: "zen", score: 9 },
  { sku: "none", score: Number.NaN },
  { sku: "aur", score: 5 },
  { sku: "blank", score: Number.NaN },
  { sku: "cas", score: 7 },
];

/** The sales in revenue order, best revenue first: the sorted copy every top-N prefix is read against. */
const DESCENDING_SALES: readonly SaleRow[] = sortByKey(SALES, (row) => row.revenueMinor, "desc");

// Helpers ---------------------------------------------------------------------------------------

/** Reads the revenue a sale is ranked by. */
function revenueOf(row: SaleRow): number {
  return row.revenueMinor;
}

/** Reads the score a row is ranked by. */
function scoreOf(row: ScoredRow): number {
  return row.score;
}

/** The labels of a ranked collection, which is what an order assertion reads. */
function skusOf(rows: readonly ScoredRow[]): string[] {
  return rows.map((row) => row.sku);
}

// Keyed indexing and reversal -------------------------------------------------------------------

describe("keyBy and reverseCopy", () => {
  it("keys the last item carrying a value, as an own property even for a prototype name", () => {
    const keyed = keyBy(SALES, (row) => row.region);
    expect(keyed.north).toBe(SALES[3]);
    expect(keyed.south).toBe(SALES[1]);
    expect(keyed.east).toBe(SALES[4]);
    expect(keyBy(NO_SALES, (row) => row.region)).toEqual({});
    const keyedByName = keyBy(
      [
        { id: "__proto__", at: 1 },
        { id: "__proto__", at: 2 },
      ],
      (row) => row.id,
    );
    expect(Object.getOwnPropertyDescriptor(keyedByName, "__proto__")?.value).toEqual({
      id: "__proto__",
      at: 2,
    });
    expect(Object.getPrototypeOf(keyedByName)).toBe(Object.prototype);
  });

  it("reverses into a new array, leaving the collection it read in place", () => {
    const reversed = reverseCopy(SALES);
    expect(reversed.map((row) => row.region)).toEqual(["east", "north", "north", "south", "north"]);
    expect(reversed).not.toBe(SALES);
    expect(reversed[4]).toBe(SALES[0]);
    expect(SALES.map((row) => row.region)).toEqual(["north", "south", "north", "north", "east"]);
    expect(reverseCopy(NO_SALES)).toEqual([]);
  });
});

// Frequency ranking -----------------------------------------------------------------------------

describe("frequencyOf", () => {
  it("ranks a value by how often it occurs, most frequent first and ties in first-appearance order", () => {
    expect(frequencyOf(SALES, (row) => row.region)).toEqual([
      { value: "north", count: 3 },
      { value: "south", count: 1 },
      { value: "east", count: 1 },
    ]);
    expect(frequencyOf(TIED_ROWS, scoreOf)).toEqual([
      { value: 7, count: 2 },
      { value: 3, count: 1 },
    ]);
    expect(frequencyOf(NO_SALES, (row) => row.region)).toEqual([]);
  });
});

// Top-N selection -------------------------------------------------------------------------------

describe("topN", () => {
  it("takes the best-first prefix, agreeing with a sorted copy", () => {
    expect(topN(SALES, revenueOf, 2)).toEqual(DESCENDING_SALES.slice(0, 2));
    expect(topN(SALES, revenueOf, 2).map((row) => row.revenueMinor)).toEqual([2_400, 1_900]);
    expect(topN(SALES, revenueOf, SALES.length)).toEqual(DESCENDING_SALES);
    expect(topN(SALES, revenueOf, SALES.length + 5)).toEqual(DESCENDING_SALES);
    expect(topN(NO_SALES, revenueOf, 3)).toEqual([]);
  });

  it("takes nothing for a count below one or an unreadable one, and floors a fractional count", () => {
    for (const count of [0, -3, Number.NaN, 0.5]) {
      expect(topN(SALES, revenueOf, count)).toEqual([]);
    }
    expect(topN(SALES, revenueOf, 2.7)).toEqual(DESCENDING_SALES.slice(0, 2));
    expect(topN(SALES, revenueOf, 2.7).map((row) => row.revenueMinor)).toEqual([2_400, 1_900]);
  });

  it("keeps input order between ties and takes an absent value last, in either direction", () => {
    expect(skusOf(topN(TIED_ROWS, scoreOf, 2))).toEqual(["first", "second"]);
    expect(topN(TIED_ROWS, scoreOf, 2)).toEqual(sortByKey(TIED_ROWS, scoreOf, "desc").slice(0, 2));
    expect(skusOf(topN(SCORED, scoreOf, 3))).toEqual(["zen", "cas", "aur"]);
    expect(skusOf(topN(SCORED, scoreOf, SCORED.length))).toEqual([
      "zen",
      "cas",
      "aur",
      "none",
      "blank",
    ]);
    expect(skusOf(topN(SCORED, scoreOf, SCORED.length, { direction: "asc" }))).toEqual([
      "aur",
      "cas",
      "zen",
      "none",
      "blank",
    ]);
  });
});
