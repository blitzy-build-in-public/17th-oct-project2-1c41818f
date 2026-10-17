/**
 * Path: tests/unit/utils/collections.test.ts
 * Purpose: Grouping, sorting, chunking, indexing and pagination helpers, including boundary pages
 * Lines: 584
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, type PageSize } from "@/constants/config";
import type { PageResult, SortDirection } from "@/types/common";
import {
  averageOf,
  chunk,
  clampNumber,
  clampPage,
  compareValues,
  countBy,
  createComparator,
  groupBy,
  indexBy,
  maxBy,
  minBy,
  normalisePageSize,
  pageCountFor,
  pageWindow,
  paginate,
  partition,
  range,
  sortBy,
  sortByKey,
  sum,
  sumBy,
  uniqueBy,
  type PageWindowEntry,
} from "@/utils/collections";

import { makeProduct } from "../../fixtures";

// Test data -------------------------------------------------------------------------------------

/** The page sizes the configuration offers, as the numeric set the assertions read. */
const CONFIGURED_PAGE_SIZES: readonly number[] = PAGE_SIZE_OPTIONS;
/** The middle configured size, so a size assertion names no number of its own. */
const MIDDLE_PAGE_SIZE = PAGE_SIZE_OPTIONS[1];
/** Both sort directions, so a helper that handles only one of them is caught. */
const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

/** One sale row: a plain shape small enough that a grouping assertion reads at a glance. */
interface SaleRow {
  readonly region: string;
  readonly channel: string;
  readonly revenueMinor: number;
}

/**
 * Five sales over three regions and two channels. `north` occurs three times and its last row is the
 * cheapest, so `indexBy` is shown to keep the last item carrying a key rather than the first, while
 * `groupBy` and `countBy` keep first-appearance key order and each group in input order.
 */
const SALES: readonly SaleRow[] = [
  { region: "north", channel: "web", revenueMinor: 1_200 },
  { region: "south", channel: "store", revenueMinor: 800 },
  { region: "north", channel: "store", revenueMinor: 2_400 },
  { region: "north", channel: "web", revenueMinor: 300 },
  { region: "east", channel: "web", revenueMinor: 1_900 },
];

const NO_SALES: readonly SaleRow[] = [];

/** Rows whose sort value is absent twice, so "absent sorts last" is asserted in both directions. */
const PRICE_ROWS = [
  { sku: "AUR", price: 1_500 },
  { sku: "CAS", price: null },
  { sku: "TRL", price: 900 },
  { sku: "ZEN", price: 2_100 },
  { sku: "ORB", price: undefined },
];

/** Two rows sharing the largest value, so a maximum is shown to keep the earlier one. */
const TIED_ROWS = [
  { sku: "first", score: 7 },
  { sku: "second", score: 7 },
  { sku: "third", score: 3 },
];

/** Every sort value absent: the case in which no extreme exists at all. */
const ALL_ABSENT = [
  { sku: "none", price: null },
  { sku: "blank", price: undefined },
];

/** The integers 1..(two pages plus one), so an exact multiple and a short remainder both exist. */
const NUMBERS: readonly number[] = Array.from(
  { length: DEFAULT_PAGE_SIZE * 2 + 1 },
  (_unused, index) => index + 1,
);

const NO_NUMBERS: readonly number[] = [];

/** Three pages: two full and a one-item remainder, the shape every boundary below pages through. */
const EXPECTED_PAGE_COUNT = 3;

/** Products over three pages, so the second page is full and its first item identifies that page. */
const CATALOGUE = Array.from({ length: DEFAULT_PAGE_SIZE * 2 + 3 }, (_unused, index) =>
  makeProduct({ name: `Aurora Desk Lamp ${String(index + 1)}`, priceMinor: 1_000 + index * 100 }),
);
/** The name of the first product on the second page, derived from the configured page size. */
const SECOND_PAGE_FIRST_PRODUCT = `Aurora Desk Lamp ${String(DEFAULT_PAGE_SIZE + 1)}`;

// Helpers ---------------------------------------------------------------------------------------

/** Asserts the envelope of one page: the page served, the size applied and the flags they imply. */
function expectPage<TItem>(
  pageResult: PageResult<TItem>,
  items: readonly TItem[],
  servedPage: number,
  pageSize: PageSize = DEFAULT_PAGE_SIZE,
): void {
  expect(pageResult.page).toBe(servedPage);
  expect(pageResult.pageSize).toBe(pageSize);
  expect(pageResult.total).toBe(items.length);
  expect(pageResult.pageCount).toBe(pageCountFor(items.length, pageSize));
  expect(pageResult.hasNext).toBe(servedPage < pageResult.pageCount);
  expect(pageResult.hasPrevious).toBe(servedPage > 1);
}

/** One page-button entry of a window, as the pagination control reads it. */
function pageEntry(page: number, isCurrent: boolean): PageWindowEntry {
  return { kind: "page", page, isCurrent };
}

/** The page buttons a window offers, in render order. */
function pageNumbers(entries: readonly PageWindowEntry[]): number[] {
  return entries.flatMap((entry) => (entry.kind === "page" ? [entry.page] : []));
}

/** The inclusive runs of hidden pages a window reports, rendered as spans. */
function gapSpans(entries: readonly PageWindowEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "gap" ? [`${String(entry.from)}-${String(entry.to)}`] : [],
  );
}

// Grouping and indexing -------------------------------------------------------------------------

describe("groupBy, countBy and indexBy", () => {
  it("groups by a key in first-read order, keeping each group in input order", () => {
    const byRegion = groupBy(SALES, (row) => row.region);
    expect([...byRegion.keys()]).toEqual(["north", "south", "east"]);
    expect(byRegion.get("north")).toEqual([SALES[0], SALES[2], SALES[3]]);
    expect(byRegion.get("south")).toEqual([SALES[1]]);
    expect(byRegion.get("east")).toEqual([SALES[4]]);
  });

  it("counts and indexes in first-read order, keeping the last item carrying a key", () => {
    expect([...countBy(SALES, (row) => row.region).entries()]).toEqual([
      ["north", 3],
      ["south", 1],
      ["east", 1],
    ]);
    expect([...countBy(SALES, (row) => row.channel).entries()]).toEqual([
      ["web", 3],
      ["store", 2],
    ]);
    const byRegion = indexBy(SALES, (row) => row.region);
    expect([...byRegion.keys()]).toEqual(["north", "south", "east"]);
    expect(byRegion.get("north")).toBe(SALES[3]);
    expect(byRegion.get("south")).toBe(SALES[1]);
  });

  it("returns empty maps for an empty collection with no key read at all", () => {
    expect(groupBy(NO_SALES, (row) => row.region).size).toBe(0);
    expect(countBy(NO_SALES, (row) => row.region).size).toBe(0);
    expect(indexBy(NO_SALES, (row) => row.region).size).toBe(0);
    expect(groupBy(NO_SALES, (row) => row.region).get("north")).toBeUndefined();
  });
});

describe("uniqueBy and partition", () => {
  it("keeps the first occurrence of a duplicate key and the input order", () => {
    expect(uniqueBy(SALES, (row) => row.channel)).toEqual([SALES[0], SALES[1]]);
    expect(uniqueBy(SALES, (row) => row.region)).toEqual([SALES[0], SALES[1], SALES[4]]);
  });

  it("returns a collection with no duplicates intact, in a new array, and an empty one empty", () => {
    const distinct = uniqueBy(SALES, (row) => row.revenueMinor);
    expect(distinct).toEqual(SALES);
    expect(distinct).not.toBe(SALES);
    expect(uniqueBy(NO_SALES, (row) => row.region)).toEqual([]);
  });

  it("splits on the predicate, keeping input order and every element exactly once", () => {
    const [large, small] = partition(SALES, (row) => row.revenueMinor >= 1_000);
    expect(large).toEqual([SALES[0], SALES[2], SALES[4]]);
    expect(small).toEqual([SALES[1], SALES[3]]);
    expect([...large, ...small]).toHaveLength(SALES.length);
    expect(new Set([...large, ...small]).size).toBe(SALES.length);
  });

  it("returns one empty side for an all-match and a no-match collection", () => {
    expect(partition(SALES, () => true)).toEqual([[...SALES], []]);
    expect(partition(SALES, () => false)).toEqual([[], [...SALES]]);
    expect(partition(NO_SALES, () => true)).toEqual([[], []]);
  });
});

describe("chunk", () => {
  it("splits into whole chunks with a short final chunk, at a size of one and beyond the length", () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    expect(chunk(NO_NUMBERS, 4)).toEqual([]);
  });

  it.each([0, -3, 2.5, Number.NaN])("rejects a chunk size of %s", (size) => {
    expect(() => chunk([1, 2, 3], size)).toThrow(RangeError);
  });

  it("hands back copies, so mutating a chunk cannot reach the source", () => {
    const source = [1, 2, 3, 4];
    const chunks = chunk(source, 2);
    chunks[0].push(99);
    chunks[1].length = 0;
    expect(source).toEqual([1, 2, 3, 4]);
    expect(chunks).toEqual([[1, 2, 99], []]);
  });
});

// Ordering --------------------------------------------------------------------------------------

describe("compareValues", () => {
  it("orders numbers ascending and reports equal values as zero", () => {
    expect(compareValues(2, 5)).toBeLessThan(0);
    expect(compareValues(5, 2)).toBeGreaterThan(0);
    expect(compareValues(5, 5)).toBe(0);
  });

  it("orders strings by UTF-16 code unit rather than by locale", () => {
    expect(compareValues("apple", "banana")).toBeLessThan(0);
    expect(compareValues("banana", "apple")).toBeGreaterThan(0);
    expect(compareValues("Zebra", "apple")).toBeLessThan(0);
    expect(compareValues("same", "same")).toBe(0);
  });

  it("places absent values last in either direction and treats two of them as equal", () => {
    expect(compareValues(null, 1)).toBeGreaterThan(0);
    expect(compareValues(1, null)).toBeLessThan(0);
    expect(compareValues(undefined, "a")).toBeGreaterThan(0);
    expect(compareValues(Number.NaN, 1)).toBeGreaterThan(0);
    expect(compareValues(null, undefined)).toBe(0);
    expect(sortByKey(PRICE_ROWS, (row) => row.price, "desc").at(-1)?.sku).toBe("ORB");
  });
});

describe("createComparator and sortBy", () => {
  it.each(SORT_DIRECTIONS)("sorts by one key %s, keeping absent values last", (direction) => {
    const sorted = sortByKey(PRICE_ROWS, (row) => row.price, direction);
    const present = sorted.filter((row) => typeof row.price === "number");
    const absent = sorted.filter((row) => row.price === null || row.price === undefined);
    expect(present.map((row) => row.sku)).toEqual(
      direction === "asc" ? ["TRL", "AUR", "ZEN"] : ["ZEN", "AUR", "TRL"],
    );
    expect(absent.map((row) => row.sku)).toEqual(["CAS", "ORB"]);
  });

  it("keeps equal keys in input order in either direction", () => {
    const comparator = createComparator<(typeof TIED_ROWS)[number]>([
      { select: (row) => row.score, direction: "desc" },
    ]);
    expect(sortBy(TIED_ROWS, comparator).map((row) => row.sku)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("compares every pair equal when it is given no key, leaving input order", () => {
    const rows = [...SALES];
    expect(sortBy(rows, createComparator<SaleRow>([]))).toEqual(rows);
    expect(sortBy([], createComparator<SaleRow>([]))).toEqual([]);
  });

  it("leaves its input untouched and sorts a copy", () => {
    const rows = SALES.map((row) => ({ ...row }));
    const rowsCopy = structuredClone(rows);
    const descending = sortByKey(rows, (row) => row.revenueMinor, "desc");
    expect(rows).toEqual(rowsCopy);
    expect(descending).not.toBe(rows);
    expect(descending.map((row) => row.revenueMinor)).toEqual([2_400, 1_900, 1_200, 800, 300]);
    expect(groupBy(rows, (row) => row.region).get("north")).toEqual([
      rowsCopy[0],
      rowsCopy[2],
      rowsCopy[3],
    ]);
  });
});

describe("minBy and maxBy", () => {
  it("finds the extreme value without letting an absent one win, agreeing with a sorted copy", () => {
    const ascending = sortByKey(SALES, (row) => row.revenueMinor);
    expect(minBy(PRICE_ROWS, (row) => row.price)?.sku).toBe("TRL");
    expect(maxBy(PRICE_ROWS, (row) => row.price)?.sku).toBe("ZEN");
    expect(minBy(SALES, (row) => row.revenueMinor)).toBe(ascending[0]);
    expect(maxBy(SALES, (row) => row.revenueMinor)).toBe(ascending.at(-1));
  });

  it("keeps the first of equal values and yields nothing when no value is present", () => {
    expect(minBy(TIED_ROWS, (row) => row.score)?.sku).toBe("third");
    expect(maxBy(TIED_ROWS, (row) => row.score)?.sku).toBe("first");
    expect(minBy(NO_SALES, (row) => row.revenueMinor)).toBeUndefined();
    expect(maxBy(NO_SALES, (row) => row.revenueMinor)).toBeUndefined();
    expect(minBy(ALL_ABSENT, (row) => row.price)).toBeUndefined();
    expect(maxBy(ALL_ABSENT, (row) => row.price)).toBeUndefined();
  });
});

// Aggregation -----------------------------------------------------------------------------------

describe("sum, sumBy and averageOf", () => {
  it("totals numbers exactly and returns zero rather than NaN for an empty collection", () => {
    expect(sum([1_200, 800, 2_400])).toBe(4_400);
    expect(sumBy(SALES, (row) => row.revenueMinor)).toBe(6_600);
    expect(sum(NO_NUMBERS)).toBe(0);
    expect(sumBy(NO_SALES, (row) => row.revenueMinor)).toBe(0);
  });

  it("averages a collection and avoids a NaN mean for an empty one", () => {
    expect(averageOf([1_200, 800, 2_400])).toBeCloseTo(1_466.67, 1);
    expect(averageOf(NO_NUMBERS)).toBe(0);
  });
});

describe("clampNumber", () => {
  it("returns a value at each bound and inside them, confining one that falls outside", () => {
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(0, 0, 10)).toBe(0);
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(10, 0, 10)).toBe(10);
    expect(clampNumber(99, 0, 10)).toBe(10);
  });

  it("reads an inverted pair of bounds in order rather than trusting it", () => {
    expect(clampNumber(5, 10, 2)).toBe(5);
    expect(clampNumber(11, 10, 2)).toBe(10);
    expect(clampNumber(1, 10, 2)).toBe(2);
  });

  it("treats a non-finite bound as no constraint and a non-finite value as the lower bound", () => {
    expect(clampNumber(-1_000, 0, Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampNumber(500, 0, Number.POSITIVE_INFINITY)).toBe(500);
    expect(clampNumber(5, 0, Number.NaN)).toBe(5);
    expect(clampNumber(Number.NaN, 3, 8)).toBe(3);
  });
});

describe("range", () => {
  it("runs from the start up to but excluding the end", () => {
    expect(range(1, 4)).toEqual([1, 2, 3]);
    expect(range(0, 5, 2)).toEqual([0, 2, 4]);
  });

  it("yields a single-element sequence, nothing for equal bounds and nothing descending the wrong way", () => {
    expect(range(2, 3)).toEqual([2]);
    expect(range(5, 5)).toEqual([]);
    expect(range(3, 0, -1)).toEqual([3, 2, 1]);
    expect(range(0, 5, -1)).toEqual([]);
  });

  it("rejects a non-finite bound and a zero or fractional step", () => {
    expect(() => range(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => range(Number.NaN, 3)).toThrow(RangeError);
    expect(() => range(0, 5, 0)).toThrow(RangeError);
    expect(() => range(0, 5, 0.5)).toThrow(RangeError);
  });
});

// Paging ----------------------------------------------------------------------------------------

describe("normalisePageSize", () => {
  it.each(CONFIGURED_PAGE_SIZES)("keeps the configured size %s as it is", (size) => {
    expect(normalisePageSize(size)).toBe(size);
    expect(CONFIGURED_PAGE_SIZES).toContain(normalisePageSize(size));
  });

  it.each([7, 1, 0, -12, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to the default for a size the configuration does not offer: %s",
    (requested) => {
      expect(normalisePageSize(requested)).toBe(DEFAULT_PAGE_SIZE);
      expect(CONFIGURED_PAGE_SIZES).toContain(normalisePageSize(requested));
    },
  );

  it("falls back to the default for an absent size and for the text a query string carries", () => {
    const requestedFromUrl = "48" as unknown as number;
    expect(normalisePageSize()).toBe(DEFAULT_PAGE_SIZE);
    expect(normalisePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalisePageSize(requestedFromUrl)).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("pageCountFor and clampPage", () => {
  it("counts one page for an empty collection, so a page number stays in range", () => {
    expect(pageCountFor(0, DEFAULT_PAGE_SIZE)).toBe(1);
    expect(pageCountFor(-4, DEFAULT_PAGE_SIZE)).toBe(1);
    expect(pageCountFor(Number.NaN, DEFAULT_PAGE_SIZE)).toBe(1);
  });

  it("rounds a partial page up and an exact multiple to the multiple", () => {
    expect(pageCountFor(DEFAULT_PAGE_SIZE - 1, DEFAULT_PAGE_SIZE)).toBe(1);
    expect(pageCountFor(DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)).toBe(1);
    expect(pageCountFor(DEFAULT_PAGE_SIZE + 1, DEFAULT_PAGE_SIZE)).toBe(2);
    expect(pageCountFor(DEFAULT_PAGE_SIZE * 2, DEFAULT_PAGE_SIZE)).toBe(2);
    expect(pageCountFor(DEFAULT_PAGE_SIZE * 2 + 1, DEFAULT_PAGE_SIZE)).toBe(3);
  });

  it.each([
    [0, 5, 1],
    [-3, 5, 1],
    [1, 5, 1],
    [2, 5, 2],
    [5, 5, 5],
    [9, 5, 5],
  ])("clamps page %s of %s pages to %s", (requested, pageCount, expected) => {
    expect(clampPage(requested, pageCount)).toBe(expected);
  });

  it("never returns a page below the first and reads an unusable page as the first", () => {
    expect(clampPage(Number.NaN, 3)).toBe(1);
    expect(clampPage(4, 0)).toBe(1);
    expect(clampPage(4, Number.NaN)).toBe(1);
    for (const requested of [-100, -1, 0, 0.5]) {
      expect(clampPage(requested, 3)).toBeGreaterThanOrEqual(1);
    }
  });

  it("agrees with the page count and the clamped page paginate reports", () => {
    const totals = [0, 1, DEFAULT_PAGE_SIZE - 1, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE + 1, 49];
    for (const total of totals) {
      const items = Array.from({ length: total }, (_unused, index) => index);
      const pageResult = paginate(items, 1);
      expect(pageResult.pageCount).toBe(pageCountFor(total, DEFAULT_PAGE_SIZE));
      expect(clampPage(pageResult.pageCount + 5, pageResult.pageCount)).toBe(pageResult.pageCount);
    }
  });
});

describe("paginate", () => {
  it("serves the first page and reports no previous page", () => {
    const pageResult = paginate(NUMBERS, 1);
    expectPage(pageResult, NUMBERS, 1);
    expect(pageResult.items).toEqual(NUMBERS.slice(0, DEFAULT_PAGE_SIZE));
    expect(pageResult.hasNext).toBe(true);
    expect(pageResult.hasPrevious).toBe(false);
  });

  it("clamps a page at or below zero to the first page", () => {
    for (const requested of [0, -1, -50]) {
      const pageResult = paginate(NUMBERS, requested);
      expectPage(pageResult, NUMBERS, 1);
      expect(pageResult.items).toHaveLength(DEFAULT_PAGE_SIZE);
      expect(pageResult.hasPrevious).toBe(false);
    }
  });

  it("clamps a page past the end to the last page, which holds the short remainder", () => {
    const pageResult = paginate(NUMBERS, 99);
    expectPage(pageResult, NUMBERS, EXPECTED_PAGE_COUNT);
    expect(pageResult.items).toEqual(NUMBERS.slice(-1));
    expect(pageResult.hasNext).toBe(false);
    expect(pageResult.hasPrevious).toBe(true);
  });

  it("serves an empty collection as one empty page", () => {
    const pageResult = paginate(NO_NUMBERS, 4);
    expectPage(pageResult, NO_NUMBERS, 1);
    expect(pageResult.pageCount).toBe(1);
    expect(pageResult.page).toBe(clampPage(4, pageResult.pageCount));
    expect(pageResult.items).toEqual([]);
    expect(pageResult.hasNext).toBe(false);
    expect(pageResult.hasPrevious).toBe(false);
  });

  it("fills the last page of an exact multiple and stops there", () => {
    const exact = NUMBERS.slice(0, DEFAULT_PAGE_SIZE * 2);
    const pageResult = paginate(exact, 2);
    expectPage(pageResult, exact, 2);
    expect(pageResult.pageCount).toBe(2);
    expect(pageResult.items).toEqual(exact.slice(DEFAULT_PAGE_SIZE));
    expect(pageResult.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(pageResult.hasNext).toBe(false);
    expect(pageResult.hasPrevious).toBe(true);
  });

  it("pages at a configured size and falls back to the default for one it does not offer", () => {
    const configured = paginate(NUMBERS, 2, MIDDLE_PAGE_SIZE);
    const fallback = paginate(NUMBERS, 1, 7);
    expectPage(configured, NUMBERS, 2, MIDDLE_PAGE_SIZE);
    expect(configured.items).toEqual(NUMBERS.slice(MIDDLE_PAGE_SIZE));
    expectPage(fallback, NUMBERS, 1);
    expect(fallback.pageSize).toBe(normalisePageSize(7));
  });

  it("slices the caller's own elements in order without mutating the collection", () => {
    const numbers = [...NUMBERS];
    const numbersCopy = structuredClone(numbers);
    const pageResult = paginate(numbers, 2);
    expect(numbers).toEqual(numbersCopy);
    expect(pageResult.items).toEqual(numbersCopy.slice(DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE * 2));
    expect(pageResult.items).not.toBe(numbers);
    expect(pageResult.items[0]).toBe(DEFAULT_PAGE_SIZE + 1);
  });

  it("pages a collection of products and names the first item of a known page", () => {
    const pageResult = paginate(CATALOGUE, 2);
    expectPage(pageResult, CATALOGUE, 2);
    expect(pageResult.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(pageResult.items[0]).toBe(CATALOGUE[DEFAULT_PAGE_SIZE]);
    expect(pageResult.items[0].name).toBe(SECOND_PAGE_FIRST_PRODUCT);
    expect(pageResult.items[0].priceMinor).toBe(1_000 + DEFAULT_PAGE_SIZE * 100);
  });

  it("pages a literal array of primitives", () => {
    const pageResult = paginate([2, 3, 5, 7, 11], 1);
    expectPage(pageResult, [2, 3, 5, 7, 11], 1);
    expect(pageResult.items).toEqual([2, 3, 5, 7, 11]);
    expect(pageResult.hasNext).toBe(false);
  });
});

// Page windows ----------------------------------------------------------------------------------

describe("pageWindow", () => {
  it("opens on the first page with the window at the front and the tail as one gap", () => {
    const window = pageWindow(1, 10);
    expect(window[0]).toEqual(pageEntry(1, true));
    expect(pageNumbers(window)).toEqual([1, 2, 3, 4, 5, 10]);
    expect(gapSpans(window)).toEqual(["6-9"]);
    expect(window.at(-1)).toEqual(pageEntry(10, false));
  });

  it("centres the window on a middle page, bracketed by the first and the last page", () => {
    const window = pageWindow(5, 10);
    expect(pageNumbers(window)).toEqual([1, 3, 4, 5, 6, 7, 10]);
    expect(gapSpans(window)).toEqual(["2-2", "8-9"]);
    expect(window.filter((entry) => entry.kind === "page" && entry.isCurrent)).toHaveLength(1);
  });

  it("closes on the last page with the head as one gap", () => {
    const window = pageWindow(10, 10);
    expect(pageNumbers(window)).toEqual([1, 6, 7, 8, 9, 10]);
    expect(gapSpans(window)).toEqual(["2-5"]);
    expect(window.at(-1)).toEqual(pageEntry(10, true));
  });

  it("returns one current page for a single-page result, whichever page was asked for", () => {
    expect(pageWindow(1, 1)).toEqual([pageEntry(1, true)]);
    expect(pageWindow(99, 1)).toEqual([pageEntry(1, true)]);
  });

  it("honours the requested width and holds the current page inside the pages that exist", () => {
    for (const maxButtons of [1, 2, 3, 5, 8]) {
      for (const pageCount of [1, 2, 7, 10, 25]) {
        for (const requested of [1, 2, 5, pageCount, pageCount + 9]) {
          const window = pageWindow(requested, pageCount, maxButtons);
          const numbers = pageNumbers(window);
          const current = clampPage(requested, pageCount);
          expect(new Set(numbers).size).toBe(numbers.length);
          expect(numbers).toContain(current);
          expect(window.filter((entry) => entry.kind === "page" && entry.isCurrent)).toHaveLength(
            1,
          );
          expect(window[0]).toEqual(pageEntry(1, current === 1));
          expect(window.at(-1)).toEqual(pageEntry(pageCount, current === pageCount));
          expect(numbers.length).toBeLessThanOrEqual(Math.min(maxButtons, pageCount) + 2);
        }
      }
    }
  });
});
