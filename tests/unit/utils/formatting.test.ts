/**
 * Path: tests/unit/utils/formatting.test.ts
 * Purpose: Money, number and percentage formatting, including rounding edge cases
 * Lines: 574
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_CURRENCY } from "@/constants/config";
import type { BucketGranularity, ReportCellFormat, ReportCellValue } from "@/types/analytics";
import type { CurrencyCode, MinorUnits } from "@/types/common";
import * as dates from "@/utils/dates";
import * as format from "@/utils/format";
// The two modules under test and the shared builders are imported as namespaces, as tests/fixtures.ts
// does: this file exercises twenty-eight of format.ts's exports and twelve of dates.ts's, and a named
// list of forty specifiers would cost forty lines of import before a single expectation.
import * as fixtures from "../../fixtures";

// Money is asserted through the invariants every conforming rendering satisfies rather than through a
// memorised locale string: the digits and the decimal point are checked at the scale the amount was
// rendered at, so a wrong scale (1999 minor units printed as "1,999.00") fails, while a currency
// symbol or a grouping separator is free to differ.

/** The digits and decimal point of a formatted figure, with its symbol, sign and grouping removed. */
function digitsOf(formatted: string): string {
  return formatted.replace(/[^0-9.]/g, "");
}

/** The instant `offsetMs` from the fixed one, as the ISO text the parser accepts: derived from that
 *  instant rather than the clock, so the relative-time cases hold in any time zone. */
function at(offsetMs: number): string {
  return new Date(Date.parse(fixtures.FIXED_NOW) + offsetMs).toISOString();
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** The product's single currency, named once here exactly as the format functions take it. */
const CURRENCY: CurrencyCode = DEFAULT_CURRENCY;
/** What the module renders for a figure that is not finite, and for a cell with nothing to show. */
const PLACEHOLDER = format.EMPTY_VALUE_PLACEHOLDER;
const EMPTY_CELL = format.EMPTY_CELL_TEXT;
/** Figures no formatter could render, and the subset a function taking a plain `number` accepts. */
const UNUSABLE: (number | null | undefined)[] = [Number.NaN, Number.POSITIVE_INFINITY, null];
const UNUSABLE_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

/** Minor-unit amounts whose round trip through the major form and a rendered string must be exact:
 *  1, 99, 1999 and 12345 each lose precision under a naive `minor / 100 * 100`. */
const MINOR_AMOUNTS: { readonly minor: MinorUnits }[] = [
  { minor: 0 },
  { minor: 1 },
  { minor: 99 },
  { minor: 1999 },
  { minor: 99_999_999_999 },
];

/** Rounds of an exact half away from zero on either sign, a remainder to the nearest integer, and
 *  already-integral values through unchanged. */
const ROUNDING_CASES: { readonly input: number; readonly expected: MinorUnits }[] = [
  { input: 0, expected: 0 },
  { input: 1, expected: 1 },
  { input: 12.4, expected: 12 },
  { input: 12.5, expected: 13 },
  { input: -12.5, expected: -13 },
  { input: 0.5, expected: 1 },
  { input: -0.5, expected: -1 },
];

/** A major amount and the minor units it is worth, including a sub-cent remainder on either sign. */
const CONVERSION_CASES: { readonly major: number; readonly minor: MinorUnits }[] = [
  { major: 0, minor: 0 },
  { major: 0.004, minor: 0 },
  { major: 0.005, minor: 1 },
  { major: 12.99, minor: 1299 },
  { major: 19.99, minor: 1999 },
  { major: 1299.5, minor: 129_950 },
  { major: -19.99, minor: -1999 },
];

/** Minor units and the digits a money surface renders them with. */
const MONEY_CASES: { readonly minor: number; readonly digits: string }[] = [
  { minor: 0, digits: "0.00" },
  { minor: 1, digits: "0.01" },
  { minor: 100, digits: "1.00" },
  { minor: 1999, digits: "19.99" },
  { minor: 129_900, digits: "1299.00" },
];

/** Text a person typed or a field held, and the minor units it names. */
const PARSE_CASES: { readonly input: string; readonly expected: MinorUnits }[] = [
  { input: "0.005", expected: 1 },
  { input: "19", expected: 1900 },
  { input: "19.99", expected: 1999 },
  { input: "$1,299.50", expected: 129_950 },
  { input: "1.299,50", expected: 129_950 },
  { input: "1,284", expected: 128_400 },
  { input: "-$19.99", expected: -1999 },
];

/** Figures a number formatter shapes, with the option set that shapes each. */
type NumberCase = { value: number; options?: format.NumberDisplayOptions; expected: string };
const NUMBER_CASES: NumberCase[] = [
  { value: 1234.5, expected: "1,234.5" },
  { value: 1234.5678, expected: "1,234.568" },
  { value: 2, options: { digits: 2, fixed: true }, expected: "2.00" },
  { value: 1234.5, options: { grouping: false }, expected: "1234.5" },
  { value: 0.001, options: { digits: 3 }, expected: "0.001" },
];

/** Ratios and the percentage text each renders as, at the digit count the call asks for. */
type PercentCase = { ratio: number; digits?: number; expected: string };
const PERCENT_CASES: PercentCase[] = [
  { ratio: 0, expected: "0.0%" },
  { ratio: 0.125, expected: "12.5%" },
  { ratio: 0.5, digits: 0, expected: "50%" },
  { ratio: 1, expected: "100.0%" },
];

/** A pair of figures to compare, the difference and the text `formatPercentChange` reports for them. */
type ChangeCase = {
  current: number;
  previous: number;
  delta: number;
  rate: number;
  dir: string;
  text: string;
};
const CHANGE_CASES: ChangeCase[] = [
  { current: 150, previous: 100, delta: 50, rate: 50, dir: "up", text: "+50.0%" },
  { current: 100, previous: 150, delta: -50, rate: -100 / 3, dir: "down", text: "-33.3%" },
  { current: 100, previous: 100, delta: 0, rate: 0, dir: "flat", text: "0.0%" },
  { current: 50, previous: -100, delta: 150, rate: 150, dir: "up", text: "+150.0%" },
];

/** Stock pairs and the level, purchasability and clamped count each reports. */
type StockCase = {
  stock: number;
  threshold: number;
  status: string;
  available: boolean;
  count: number;
};
const AVAILABILITY_CASES: StockCase[] = [
  { stock: 0, threshold: 5, status: "out-of-stock", available: false, count: 0 },
  { stock: -3, threshold: 5, status: "out-of-stock", available: false, count: 0 },
  { stock: 1, threshold: 5, status: "low-stock", available: true, count: 1 },
  { stock: 5, threshold: 5, status: "low-stock", available: true, count: 5 },
  { stock: 6, threshold: 5, status: "in-stock", available: true, count: 6 },
];

/** One report cell per `ReportCellFormat` member, plus the absent and non-numeric cases. */
type CellCase = { value: ReportCellValue | undefined; format: ReportCellFormat; text: string };
const CELL_CASES: CellCase[] = [
  { value: "Aurora Desk Lamp", format: "text", text: "Aurora Desk Lamp" },
  { value: 42, format: "text", text: "42" },
  { value: 1284, format: "integer", text: "1,284" },
  { value: 1999, format: "money", text: format.formatMoney(1999, CURRENCY) },
  { value: 0.125, format: "percent", text: "12.5%" },
  { value: 1299, format: "compact-number", text: "1.3K" },
  { value: fixtures.FIXED_DATE, format: "date", text: dates.formatDate(fixtures.FIXED_DATE) },
  { value: "2025-W05", format: "date", text: "2025-W05" },
  { value: null, format: "money", text: EMPTY_CELL },
];

/** The same cells through the export renderer, whose figures stay machine-readable. */
const EXPORT_CELL_CASES: CellCase[] = [
  { value: fixtures.FIXED_DATE, format: "date", text: fixtures.FIXED_DATE },
  { value: 1284.9, format: "integer", text: "1284" },
  { value: 129_950, format: "money", text: "1299.50" },
  { value: 0.125, format: "percent", text: "12.5" },
  { value: 129_900, format: "compact-number", text: "129900" },
];

describe("roundMinorUnits: the product's single rounding rule", () => {
  it.each(ROUNDING_CASES)("rounds $input to $expected", ({ input, expected }) => {
    expect(format.roundMinorUnits(input)).toBe(expected);
  });
  it("normalises a negative zero to zero", () => {
    // `Math.round(-0.4)` is `-0`, which `toBe` distinguishes from `0`; the rule returns zero itself.
    expect(Object.is(format.roundMinorUnits(-0.4), 0)).toBe(true);
    expect(Object.is(format.roundMinorUnits(-0), 0)).toBe(true);
  });
  it.each(UNUSABLE_NUMBERS)("settles %s on zero rather than propagating it", (input) => {
    expect(format.roundMinorUnits(input)).toBe(0);
  });
});

describe("toMinorUnits and fromMinorUnits: a major amount and its minor units", () => {
  it.each(CONVERSION_CASES)("reads $major as $minor minor units", ({ major, minor }) => {
    expect(format.toMinorUnits(major)).toBe(minor);
  });
  it("reads minor units back exactly and settles a broken amount on zero", () => {
    expect(format.fromMinorUnits(0)).toBe(0);
    expect(format.fromMinorUnits(1)).toBe(0.01);
    expect(format.fromMinorUnits(1999)).toBe(19.99);
    expect(format.fromMinorUnits(129_950)).toBe(1299.5);
    expect(format.fromMinorUnits(Number.NaN)).toBe(0);
    expect(format.toMinorUnits(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it.each(MINOR_AMOUNTS)(
    "survives the round trip through the major form at $minor",
    ({ minor }) => {
      expect(format.toMinorUnits(format.fromMinorUnits(minor))).toBe(minor);
    },
  );
  it("sums line amounts as minor units without floating-point drift", () => {
    // The line amounts are 110, 235, 7 and 1999 minor units: summing those is an integer sum, while
    // summing their major forms reaches 329.99999999999994 for the first line alone.
    const lineMinors = [1.1, 2.35, 0.07, 19.99].map(format.toMinorUnits);
    expect(lineMinors).toEqual([110, 235, 7, 1999]);
    expect(3 * format.toMinorUnits(1.1)).toBe(330);
    const total = lineMinors.reduce((sum, minor) => sum + minor, 0);
    expect(total).toBe(2351);
    expect(Number.isInteger(total)).toBe(true);
  });
});

describe("formatMoney and formatMoneyCompact: minor units as a surface shows them", () => {
  it.each(MONEY_CASES)(
    "renders $minor minor units with the digits $digits",
    ({ minor, digits }) => {
      const formatted = format.formatMoney(minor, CURRENCY);
      expect(digitsOf(formatted)).toBe(digits);
      expect(formatted).not.toBe("");
    },
  );
  it("keeps the currency marker and the scale exact at both ends of the range", () => {
    expect(format.formatMoney(1999)).toContain("$");
    expect(format.formatMoney(1999)).toBe(format.formatMoney(1999, CURRENCY));
    const negative = format.formatMoney(-1999, CURRENCY);
    expect(negative).not.toBe(format.formatMoney(1999, CURRENCY));
    expect(digitsOf(negative)).toBe("19.99");
    expect(negative).toContain("-");
    const large = format.formatMoney(99_999_999_999, CURRENCY);
    expect(digitsOf(large)).toBe("999999999.99");
    expect(large).not.toMatch(/[eE]/);
    expect(format.formatMoneyCompact(99_999, CURRENCY)).toBe(format.formatMoney(99_999, CURRENCY));
  });
  it.each(UNUSABLE)("renders the unusable amount %s as the placeholder", (minor) => {
    expect(format.formatMoney(minor, CURRENCY)).toBe(PLACEHOLDER);
    expect(format.formatMoney(minor, CURRENCY)).not.toMatch(/NaN|Infinity/);
    expect(format.formatMoneyCompact(minor, CURRENCY)).toBe(PLACEHOLDER);
  });
  it.each([
    { minor: 100_000, suffix: "K" },
    { minor: 129_900, suffix: "K" },
    { minor: 123_456_789, suffix: "M" },
    { minor: 150_000_000_000_000, suffix: "T" },
  ])("shortens $minor with its $suffix magnitude", ({ minor, suffix }) => {
    const short = format.formatMoneyCompact(minor, CURRENCY);
    expect(short).toContain(suffix);
    expect(short.length).toBeLessThan(format.formatMoney(minor, CURRENCY).length);
  });
});

describe("parseMoneyToMinor: reading money a person typed or a field held", () => {
  it.each(PARSE_CASES)("reads $input as $expected minor units", ({ input, expected }) => {
    expect(format.parseMoneyToMinor(input)).toBe(expected);
  });
  it("reads a number, refuses text holding no digit and writes a form value back", () => {
    expect(format.parseMoneyToMinor(1299.5)).toBe(129_950);
    expect(format.parseMoneyToMinor(null)).toBe(0);
    expect(format.parseMoneyToMinor(undefined)).toBe(0);
    expect(format.parseMoneyToMinor("")).toBe(0);
    expect(format.parseMoneyToMinor("abc")).toBe(0);
    expect(format.parseMoneyToMinor("$")).toBe(0);
    expect(format.parseMoneyToMinor(format.formatMoney(-1999, CURRENCY))).toBe(-1999);
    expect(format.formatMinorAsInput(129_900)).toBe("1299.00");
    expect(format.formatMinorAsInput(0)).toBe("0.00");
    expect(format.formatMinorAsInput(null)).toBe(EMPTY_CELL);
  });
  it.each(MINOR_AMOUNTS)("round-trips $minor through the rendered and typed forms", ({ minor }) => {
    expect(format.parseMoneyToMinor(format.formatMoney(minor, CURRENCY))).toBe(minor);
    expect(format.parseMoneyToMinor(format.formatMinorAsInput(minor))).toBe(minor);
  });
  it("keeps a remaining charge at zero and an absent figure at the placeholder", () => {
    const remaining = format.formatFreeShippingRemaining;
    expect(remaining(2500, CURRENCY)).toBe(format.formatMoney(2500, CURRENCY));
    expect(digitsOf(remaining(-500, CURRENCY))).toBe("0.00");
    expect(remaining(null, CURRENCY)).toBe(PLACEHOLDER);
  });
});

describe("the number formatters", () => {
  it.each(NUMBER_CASES)("renders $value as $expected", ({ value, options, expected }) => {
    expect(format.formatNumber(value, options)).toBe(expected);
  });
  it.each(UNUSABLE)("renders the unusable figure %s as the placeholder", (value) => {
    expect(format.formatNumber(value)).toBe(PLACEHOLDER);
    expect(format.formatInteger(value)).toBe(PLACEHOLDER);
    expect(format.formatCompactNumber(value)).toBe(PLACEHOLDER);
  });
  it("negates, groups, truncates and ranks a figure as its surface needs", () => {
    expect(format.formatNumber(-1234.5)).toBe(`-${format.formatNumber(1234.5)}`);
    expect(format.formatInteger(0)).toBe("0");
    expect(format.formatInteger(1284)).toBe("1,284");
    expect(format.formatInteger(-1284)).toBe("-1,284");
    expect(format.formatInteger(1284.6)).toBe("1,285");
    expect(format.formatQuantity(12)).toBe("12");
    expect(format.formatQuantity(3.7)).toBe("3");
    expect(format.formatQuantity(-5)).toBe("0");
    expect(format.formatOrdinal(1)).toBe("1st");
    expect(format.formatOrdinal(2)).toBe("2nd");
    expect(format.formatOrdinal(3)).toBe("3rd");
    expect(format.formatOrdinal(11)).toBe("11th");
    expect(format.formatOrdinal(22)).toBe("22nd");
    expect(format.formatOrdinal(111)).toBe("111th");
  });
  it.each([
    { value: 999, expected: "999" },
    { value: 1299, expected: "1.3K" },
    { value: 1234567, expected: "1.2M" },
    { value: 1_000_000_000, expected: "1B" },
  ])("shortens $value to $expected", ({ value, expected }) => {
    expect(format.formatCompactNumber(value)).toBe(expected);
  });
});

describe("the percentage formatters", () => {
  it.each(PERCENT_CASES)("renders the ratio $ratio as $expected", ({ ratio, digits, expected }) => {
    expect(format.formatPercent(ratio, digits)).toBe(expected);
  });
  it("treats its argument as a ratio, never a scaled percentage", () => {
    expect(format.formatPercent(1)).toBe("100.0%");
    expect(format.formatPercent(0.5)).toBe("50.0%");
    expect(format.formatScaledPercent(50)).toBe("50.0%");
    expect(format.formatScaledPercent(12.5)).toBe("12.5%");
    expect(format.formatPercentagePoints(2.5)).toBe("+2.5 pts");
    expect(format.formatPercentagePoints(-2.5)).toBe("-2.5 pts");
    expect(format.formatPercentagePoints(0)).toBe("0.0 pts");
    expect(format.formatPercent(Number.NaN)).toBe(PLACEHOLDER);
    expect(format.formatPercent(null)).toBe(PLACEHOLDER);
    expect(format.formatScaledPercent(Number.POSITIVE_INFINITY)).toBe(PLACEHOLDER);
    expect(format.formatPercent(Number.NaN)).not.toMatch(/NaN/);
  });
  it.each(CHANGE_CASES)("reports $current against $previous as $text", (changeCase) => {
    const change = format.formatPercentChange(changeCase.current, changeCase.previous);
    expect(change.current).toBe(changeCase.current);
    expect(change.previous).toBe(changeCase.previous);
    expect(change.difference).toBe(changeCase.delta);
    expect(change.changePercent).toBeCloseTo(changeCase.rate, 10);
    expect(change.direction).toBe(changeCase.dir);
    expect(change.text).toBe(changeCase.text);
  });
  it("has no percentage to state for a zero baseline or an unusable figure", () => {
    // Growth from a zero baseline has no ratio at all: a null change, never Infinity or NaN.
    const fromNothing = format.formatPercentChange(100, 0);
    expect(fromNothing.changePercent).toBeNull();
    expect(fromNothing.direction).toBe("up");
    expect(fromNothing.text).toBe(PLACEHOLDER);
    const flat = format.formatPercentChange(0, 0);
    expect(flat.changePercent).toBe(0);
    expect(flat.direction).toBe("flat");
    expect(flat.text).toBe("0.0%");
    const unknown = format.formatPercentChange(Number.NaN, 100);
    expect(unknown.changePercent).toBeNull();
    expect(unknown.direction).toBe("unknown");
    expect(unknown.text).toBe(PLACEHOLDER);
    expect(unknown.text).not.toMatch(/NaN|Infinity/);
  });
  it.each([
    { value: 150, total: 400, expected: "37.5%" },
    { value: 0, total: 400, expected: "0.0%" },
    { value: 400, total: 400, expected: "100.0%" },
    { value: 150, total: 0, expected: "0.0%" },
    { value: null, total: 400, expected: PLACEHOLDER },
    { value: 150, total: Number.NaN, expected: PLACEHOLDER },
  ])("renders $value of $total as $expected", ({ value, total, expected }) => {
    expect(format.formatShare(value, total)).toBe(expected);
  });
});

describe("the domain display helpers", () => {
  it("reports a rating as its parts so one computation feeds every surface", () => {
    expect(format.formatRatingValue(4)).toBe("4.0");
    expect(format.formatRatingValue(4.53)).toBe("4.5");
    expect(format.formatRatingValue(4.567)).toBe("4.6");
    expect(format.formatRatingValue(null)).toBe(PLACEHOLDER);
    expect(format.formatRating(4.5, 12)).toEqual({
      average: 4.5,
      value: "4.5",
      count: 12,
      hasReviews: true,
    });
    expect(format.formatRating(0, 0)).toEqual({
      average: 0,
      value: "0.0",
      count: 0,
      hasReviews: false,
    });
    expect(format.formatRating(null, null)).toEqual({
      average: 0,
      value: PLACEHOLDER,
      count: 0,
      hasReviews: false,
    });
  });
  it.each([
    { count: 0, expected: "0 reviews" },
    { count: 1, expected: "1 review" },
    { count: 2, expected: "2 reviews" },
    { count: -3, expected: "0 reviews" },
  ])("states $count as $expected", ({ count, expected }) => {
    expect(format.formatReviewCount(count)).toBe(expected);
  });
  it.each([
    { list: 2000, price: 1650, expected: 18 },
    { list: 5000, price: 4000, expected: 20 },
    { list: 1000, price: 1000, expected: 0 },
    { list: 1000, price: 1200, expected: 0 },
    { list: Number.NaN, price: 500, expected: 0 },
  ])("reports $list against $price as $expected percent off", ({ list, price, expected }) => {
    const discount = format.formatDiscount(list, price);
    expect(discount).toBe(expected);
    expect(discount).toBeLessThanOrEqual(100);
  });
  it.each(AVAILABILITY_CASES)(
    "reports $stock on hand against a threshold of $threshold as $status",
    ({ stock, threshold, status, available, count }) => {
      expect(format.formatAvailability(stock, threshold)).toEqual({
        status,
        available,
        stockOnHand: count,
        lowStockThreshold: threshold,
      });
    },
  );
});

describe("the report cells the table and the export both read", () => {
  it.each(CELL_CASES)("renders a $format cell holding $value as $text", (cell) => {
    expect(format.formatCellValue(cell.value, cell.format)).toBe(cell.text);
  });
  it("renders what it was handed when there is no figure to format", () => {
    expect(format.formatCellValue(null, "integer")).toBe(EMPTY_CELL);
    expect(format.formatCellValue(undefined, "money")).toBe(EMPTY_CELL);
    expect(format.formatCellValue(null, "integer")).not.toBe("0");
    expect(format.formatCellValue(null, "percent")).not.toBe("0.0%");
    expect(format.formatCellValue("n/a", "money")).toBe("n/a");
    expect(format.formatCellValue("n/a", "integer")).toBe("n/a");
    expect(format.formatCellValue("n/a", "percent")).toBe("n/a");
    expect(format.formatCellValue("n/a", "compact-number")).toBe("n/a");
  });
  it.each(EXPORT_CELL_CASES)("exports a $format cell holding $value as $text", (cell) => {
    expect(format.formatCellValueForExport(cell.value, cell.format)).toBe(cell.text);
  });
  it("exports money as the plain decimal a spreadsheet can sum", () => {
    const exported = format.formatCellValueForExport(129_950, "money");
    const blank = format.formatCellValueForExport(null, "money");
    expect(digitsOf(exported)).toBe("1299.50");
    expect(exported).not.toContain("$");
    expect(format.parseMoneyToMinor(exported)).toBe(129_950);
    expect(blank).toBe(EMPTY_CELL);
  });
});

describe("the date display surface", () => {
  it("parses an ISO day and an ISO date-time as local time", () => {
    const day = dates.parseIso(fixtures.FIXED_DATE);
    expect(day?.getFullYear()).toBe(2025);
    expect(day?.getMonth()).toBe(9);
    expect(day?.getDate()).toBe(15);
    expect(day?.getHours()).toBe(0);
    const moment = dates.parseIso(`${fixtures.FIXED_DATE}T14:45:30`);
    expect(moment?.getHours()).toBe(14);
    expect(moment?.getSeconds()).toBe(30);
    expect(dates.parseIso(fixtures.FIXED_NOW)?.getTime()).toBe(Date.parse(fixtures.FIXED_NOW));
  });
  it.each([
    { value: "2025-13-45", reason: "a month and day that do not exist" },
    { value: "2025-02-30", reason: "a day February never has" },
    { value: "2023-02-29", reason: "Feb 29 in a common year" },
    { value: "2025-10", reason: "a partial date" },
    { value: "2025-10-15T25:00:00", reason: "an hour past the end of the day" },
    { value: "", reason: "an empty string" },
    { value: "yesterday", reason: "a word that is not a date" },
  ])("rejects $value ($reason)", ({ value }) => {
    expect(dates.parseIso(value)).toBeNull();
    expect(dates.isValidIso(value)).toBe(false);
  });
  it("accepts both ISO spellings and emits the stored forms, blanking an invalid date", () => {
    expect(dates.isValidIso(fixtures.FIXED_DATE)).toBe(true);
    expect(dates.isValidIso(`${fixtures.FIXED_DATE}T14:45:00`)).toBe(true);
    expect(dates.isValidIso(20251015)).toBe(false);
    expect(dates.isValidIso(null)).toBe(false);
    expect(dates.isValidIso({})).toBe(false);
    const moment = new Date(2025, 9, 15, 9, 5, 3);
    expect(dates.toIsoDate(moment)).toBe(fixtures.FIXED_DATE);
    expect(dates.toIsoDateTime(moment)).toBe(`${fixtures.FIXED_DATE}T09:05:03`);
    expect(dates.toIsoDate(new Date(Number.NaN))).toBe("");
    expect(dates.toIsoDateTime(new Date(Number.NaN))).toBe("");
  });
  it.each([
    { iso: fixtures.FIXED_EARLIER_DATE },
    { iso: fixtures.FIXED_DATE },
    { iso: fixtures.FIXED_LATER_DATE },
  ])("round-trips $iso through the date input value", ({ iso }) => {
    expect(dates.toDateInputValue(iso)).toBe(iso);
    expect(dates.fromDateInputValue(dates.toDateInputValue(iso))).toBe(iso);
  });
  it("reads only a whole date back from a date input control", () => {
    expect(dates.toDateInputValue(`${fixtures.FIXED_DATE}T23:00:00`)).toBe(fixtures.FIXED_DATE);
    expect(dates.toDateInputValue("not-a-date")).toBe("");
    expect(dates.fromDateInputValue(`${fixtures.FIXED_DATE}T12:00:00`)).toBe("");
    expect(dates.fromDateInputValue("2025-10-1")).toBe("");
    expect(dates.fromDateInputValue("")).toBe("");
  });
  it("spells a day in each documented style and blanks one it cannot parse", () => {
    expect(dates.formatDate("2025-01-30", "short")).toBe("1/30/2025");
    expect(dates.formatDate("2025-01-30", "medium")).toBe("Jan 30, 2025");
    expect(dates.formatDate("2025-01-30", "long")).toBe("January 30, 2025");
    const short = dates.formatDate(fixtures.FIXED_DATE, "short");
    const medium = dates.formatDate(fixtures.FIXED_DATE);
    const long = dates.formatDate(fixtures.FIXED_DATE, "long");
    expect(new Set([short, medium, long]).size).toBe(3);
    expect(short).toMatch(/^10\/15\/2025$/);
    expect(medium).toMatch(/^[A-Z][a-z]{2} 15, 2025$/);
    expect(long).toContain("October");
    expect(dates.formatDate("garbage")).toBe("");
    expect(dates.formatDate("2025-13-45")).toBe("");
  });
  it("carries the local time of a date-time and blanks an unusable one", () => {
    const formatted = dates.formatDateTime(`${fixtures.FIXED_DATE}T14:45:00`);
    expect(formatted).toContain("2025");
    expect(formatted).toMatch(/2:45/);
    expect(formatted).toMatch(/(AM|PM)/);
    expect(dates.formatDateTime("garbage")).toBe("");
  });
  it("collapses a range sharing a year and spells both ends when it does not", () => {
    const range = fixtures.FIXED_DATE_RANGE;
    const shared = dates.formatDateRange(range.from, range.to);
    expect(shared).toContain(" – ");
    expect(shared.endsWith(", 2025")).toBe(true);
    expect(shared.split("2025")).toHaveLength(2);
    expect(dates.formatDateRange(fixtures.FIXED_DATE, fixtures.FIXED_DATE)).toBe(
      dates.formatDate(fixtures.FIXED_DATE),
    );
    const spanning = dates.formatDateRange("2024-12-30", "2025-01-02");
    expect(spanning).toContain("2024");
    expect(spanning).toContain("2025");
    expect(dates.formatDateRange("garbage", fixtures.FIXED_DATE)).toBe("");
    expect(dates.formatDateRange(fixtures.FIXED_DATE, "garbage")).toBe("");
  });
  it("labels each bucket granularity, a month and year, and blanks what it cannot parse", () => {
    const granularities: BucketGranularity[] = ["day", "week", "month"];
    const labels = granularities.map((granularity) =>
      dates.formatBucketLabel(fixtures.FIXED_DATE, granularity),
    );
    expect(labels).toEqual(["Oct 15", "Week of Oct 13", "Oct 2025"]);
    expect(new Set(labels).size).toBe(3);
    expect(dates.formatYearMonth(fixtures.FIXED_DATE)).toBe("Oct 2025");
    expect(dates.formatYearMonth("garbage")).toBe("");
    expect(dates.formatBucketLabel("garbage", "day")).toBe("");
    expect(dates.formatBucketLabel("2025-W42", "week")).toBe("");
  });
});

describe("formatRelativeTime: how long ago an instant was", () => {
  it("describes every band it documents and distinguishes past from future", () => {
    const now = new Date(fixtures.FIXED_NOW);
    expect(dates.formatRelativeTime(fixtures.FIXED_NOW, now)).toBe("now");
    expect(dates.formatRelativeTime(at(-5 * MINUTE_MS), now)).toBe("5 minutes ago");
    expect(dates.formatRelativeTime(at(-DAY_MS), now)).toBe("yesterday");
    expect(dates.formatRelativeTime(at(-2 * DAY_MS), now)).toBe("2 days ago");
    expect(dates.formatRelativeTime(at(DAY_MS), now)).toBe("tomorrow");
    expect(dates.formatRelativeTime(at(-400 * DAY_MS), now)).toMatch(/year/);
    const past = dates.formatRelativeTime(at(-3 * DAY_MS), now);
    const future = dates.formatRelativeTime(at(3 * DAY_MS), now);
    expect(past).not.toBe(future);
    expect(past).not.toBe("");
    expect(future).not.toBe("");
    expect(dates.formatRelativeTime(at(-3 * DAY_MS), now)).toBe(past);
    expect(dates.formatRelativeTime("garbage", now)).toBe("");
  });
});
