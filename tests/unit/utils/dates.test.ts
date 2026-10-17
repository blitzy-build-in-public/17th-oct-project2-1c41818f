/**
 * Path: tests/unit/utils/dates.test.ts
 * Purpose: The range arithmetic, bucket boundaries and comparison periods of src/utils/dates.ts, in its
 * own suite because the two suites that touch the module sit at the per-file 600-line ceiling
 * Lines: 599
 */

// A pure-function suite: it reaches no DOM, mocks no module and reads no ambient clock — every rule
// needing the current day is handed the injected TODAY below. Each expectation comes from a calendar
// fact or the contract the export's JSDoc states, never from the module's own answer, so a rule
// broken in the source fails here.
import { describe, expect, it } from "vitest";

import { DEFAULT_REPORT_RANGE_DAYS, MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import { DATE_RANGE_COPY, VALIDATION_MESSAGES, rangeTooLongMessage } from "@/constants/content";
import type { BaselineKind, BucketGranularity } from "@/types/analytics";
import type { DateRange } from "@/types/common";
// The subject and the shared builders are imported as namespaces, as the two sibling suites import
// theirs, so every name below is unambiguously an export of the module under test.
import * as dates from "@/utils/dates";
import * as fixtures from "../../fixtures";

// Test data --------------------------------------------------------------------------------------

/** The injectable "now": local midday on 15 October 2025. It is built from local components rather
 * than from a Z-suffixed instant, so every rule that resolves a local day sees 15 October in every
 * time zone this suite runs in. */
const TODAY = new Date(2025, 9, 15, 12, 0, 0);
/** The local day of {@link TODAY} as the text the range helpers take. */
const TODAY_ISO = "2025-10-15";
/** Ten days, the range the comparison-period assertions are measured from. */
const TEN_DAY_RANGE: DateRange = { from: "2025-10-01", to: "2025-10-10" };
/** Fifteen days, the closed range the membership, resolution and clamping rules are measured on. */
const CLOSED_RANGE: DateRange = { from: "2025-10-01", to: "2025-10-15" };
/** Calendar 2025, the bounds a range is clamped into, and two ranges that straddle the day cap. */
const YEAR_BOUNDS: DateRange = { from: "2025-01-01", to: "2025-12-31" };
const OVER_CAP_RANGE: DateRange = { from: "2024-01-01", to: "2025-01-01" };
const AT_CAP_RANGE: DateRange = { from: "2024-10-15", to: TODAY_ISO };
const PAST_CAP_RANGE: DateRange = { from: "2024-10-14", to: TODAY_ISO };
/** Ranges no rule can measure: neither end parses, and only the end does not. */
const UNPARSABLE_RANGE: DateRange = { from: "nope", to: "nope" };
const UNPARSABLE_END_RANGE: DateRange = { from: "2025-10-01", to: "nope" };
/** Every text a date rule has to refuse: empty, a word, an impossible month, an impossible day, and a
 * real date written in a convention this product does not read. */
const UNPARSABLE_VALUES = ["", "nope", "2025-13-45", "2025-02-30", "15/10/2025"] as const;
/** Every granularity, so "each one refuses it" needs no second list. */
const GRANULARITIES: readonly BucketGranularity[] = ["day", "week", "month"];
/** The wording each broken range rule renders, assembled the way the two consumers of `toFieldErrors`
 * assemble it, so a filed error is compared against the sentence the product shows for that rule. */
const RANGE_MESSAGES: Readonly<Record<dates.DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

// The case tables --------------------------------------------------------------------------------

/** Dates an instant is floored to, in either form a range end can arrive in. */
const DAY_CASES: { readonly value: string; readonly day: string }[] = [
  { value: "2025-10-15", day: "2025-10-15" },
  { value: "2025-10-15T12:00:00", day: "2025-10-15" },
  { value: "2025-10-15T23:59:59", day: "2025-10-15" },
];

/** The ISO week of each date, hand-derived from the rule that week 1 holds 4 January: 1 January 2025
 * is a Wednesday, so its week opens on Monday 30 December 2024 and 5 January 2025 closes it. Mondays
 * and Sundays are listed deliberately — a Sunday start would split every one of these weeks in two. */
const WEEK_CASES: { readonly value: string; readonly from: string; readonly to: string }[] = [
  { value: "2024-12-30", from: "2024-12-30", to: "2025-01-05" },
  { value: "2025-01-01", from: "2024-12-30", to: "2025-01-05" },
  { value: "2025-01-05", from: "2024-12-30", to: "2025-01-05" },
  { value: "2025-10-15", from: "2025-10-13", to: "2025-10-19" },
  { value: "2024-12-29", from: "2024-12-23", to: "2024-12-29" },
];

/** The month of each date, February in a common year and in the leap year 2024 among them. */
const MONTH_CASES: { readonly value: string; readonly from: string; readonly to: string }[] = [
  { value: "2025-01-01", from: "2025-01-01", to: "2025-01-31" },
  { value: "2025-10-15", from: "2025-10-01", to: "2025-10-31" },
  { value: "2025-02-10", from: "2025-02-01", to: "2025-02-28" },
  { value: "2024-02-10", from: "2024-02-01", to: "2024-02-29" },
];

/** Whole-day shifts, across a month end, a leap day and the turn of a year. */
const SHIFT_CASES: { readonly value: string; readonly by: number; readonly to: string }[] = [
  { value: "2025-10-31", by: 1, to: "2025-11-01" },
  { value: "2025-03-01", by: -1, to: "2025-02-28" },
  { value: "2024-02-28", by: 1, to: "2024-02-29" },
  { value: "2024-12-31", by: 1, to: "2025-01-01" },
  { value: "2025-01-01", by: -365, to: "2024-01-02" },
];

/** Whole-month shifts. A day the target month does not hold clamps to its last day — 31 January plus
 * a month is 28 February, never 3 March — and a shift past December rolls the year, either way. */
const MONTH_SHIFTS: { readonly value: string; readonly by: number; readonly to: string }[] = [
  { value: "2025-01-31", by: 1, to: "2025-02-28" },
  { value: "2024-01-31", by: 1, to: "2024-02-29" },
  { value: "2025-03-31", by: -1, to: "2025-02-28" },
  { value: "2025-12-15", by: 1, to: "2026-01-15" },
  { value: "2025-01-31", by: 13, to: "2026-02-28" },
  { value: "2025-01-01", by: -1, to: "2024-12-01" },
];

/** The key a date falls under. The week rows are the New Year boundary: the week holding 1 January
 * 2025 is numbered in 2025 although it opens in December 2024, and the week holding 29 December 2025
 * is numbered in 2026 although that whole week lies in December. 4 January always falls in week 1. */
const BUCKET_KEY_CASES: {
  readonly value: string;
  readonly granularity: BucketGranularity;
  readonly key: string;
}[] = [
  { value: "2025-10-15", granularity: "day", key: "2025-10-15" },
  { value: "2025-10-15", granularity: "month", key: "2025-10" },
  { value: "2025-01-05", granularity: "month", key: "2025-01" },
  { value: "2024-12-30", granularity: "week", key: "2025-W01" },
  { value: "2025-01-01", granularity: "week", key: "2025-W01" },
  { value: "2025-12-29", granularity: "week", key: "2026-W01" },
  { value: "2026-01-01", granularity: "week", key: "2026-W01" },
  { value: "2027-01-04", granularity: "week", key: "2027-W01" },
  { value: "2026-12-31", granularity: "week", key: "2026-W53" },
  { value: "2027-01-03", granularity: "week", key: "2026-W53" },
  { value: "2025-10-15", granularity: "week", key: "2025-W42" },
  { value: "2024-12-29", granularity: "week", key: "2024-W52" },
];

/** The days a bucket key covers: the Monday and Sunday of an ISO week, a whole month — a common
 * February and the leap one — and a single day. */
const BUCKET_SPAN_CASES: {
  readonly key: string;
  readonly granularity: BucketGranularity;
  readonly start: string;
  readonly end: string;
}[] = [
  { key: "2025-W01", granularity: "week", start: "2024-12-30", end: "2025-01-05" },
  { key: "2024-W01", granularity: "week", start: "2024-01-01", end: "2024-01-07" },
  { key: "2026-W01", granularity: "week", start: "2025-12-29", end: "2026-01-04" },
  { key: "2026-W53", granularity: "week", start: "2026-12-28", end: "2027-01-03" },
  { key: "2025-02", granularity: "month", start: "2025-02-01", end: "2025-02-28" },
  { key: "2024-02", granularity: "month", start: "2024-02-01", end: "2024-02-29" },
  { key: "2025-12", granularity: "month", start: "2025-12-01", end: "2025-12-31" },
  { key: "2025-10-15", granularity: "day", start: "2025-10-15", end: "2025-10-15" },
];

/** What each baseline name resolves to for {@link TEN_DAY_RANGE}: the ten days before it, and the
 * same ten days a year earlier. */
const BASELINE_CASES: { readonly kind: BaselineKind; readonly expected: DateRange }[] = [
  { kind: "previous-period", expected: { from: "2025-09-21", to: "2025-09-30" } },
  { kind: "previous-year", expected: { from: "2024-10-01", to: "2024-10-10" } },
];

describe("the day a value falls on: startOfDay and endOfDay", () => {
  it.each(DAY_CASES)("floors $value to the date $day", ({ value, day }) => {
    expect(dates.startOfDay(value)).toBe(day);
    expect(dates.endOfDay(value)).toBe(day);
  });

  it("leaves a value it cannot parse with no day at all", () => {
    for (const value of UNPARSABLE_VALUES) {
      expect(dates.startOfDay(value)).toBe("");
      expect(dates.endOfDay(value)).toBe("");
    }
  });
});

describe("the week and the month a date opens: startOfWeek, endOfWeek, startOfMonth, endOfMonth", () => {
  it.each(WEEK_CASES)("runs $value's week from $from through $to", ({ value, from, to }) => {
    expect(dates.startOfWeek(value)).toBe(from);
    expect(dates.endOfWeek(value)).toBe(to);
    // Six days apart, so the two ends are the closed seven-day week and nothing shorter.
    expect(dates.differenceInDays(from, to)).toBe(6);
  });

  it.each(MONTH_CASES)("runs the month of $value from $from through $to", ({ value, from, to }) => {
    expect(dates.startOfMonth(value)).toBe(from);
    expect(dates.endOfMonth(value)).toBe(to);
  });

  it("leaves a value it cannot parse with no week and no month", () => {
    for (const value of UNPARSABLE_VALUES) {
      expect(dates.startOfWeek(value)).toBe("");
      expect(dates.endOfWeek(value)).toBe("");
      expect(dates.startOfMonth(value)).toBe("");
      expect(dates.endOfMonth(value)).toBe("");
    }
  });
});

describe("moving a date: addDays and addMonths", () => {
  it.each(SHIFT_CASES)("moves $value by $by day(s) to $to", ({ value, by, to }) => {
    expect(dates.addDays(value, by)).toBe(to);
    // The inverse shift returns the day it started from, so neither direction drifts.
    expect(dates.addDays(to, -by)).toBe(value);
  });

  it.each(MONTH_SHIFTS)("moves $value by $by month(s) to $to", ({ value, by, to }) => {
    expect(dates.addMonths(value, by)).toBe(to);
  });

  it("leaves a value it cannot parse with no moved date", () => {
    for (const value of UNPARSABLE_VALUES) {
      expect(dates.addDays(value, 1)).toBe("");
      expect(dates.addMonths(value, 1)).toBe("");
    }
  });
});

// Spans, buckets and keys ------------------------------------------------------------------------

describe("measuring a span: differenceInDays and daysInRange", () => {
  it("counts whole days between two dates and signs the difference", () => {
    expect(dates.differenceInDays("2025-10-01", "2025-10-15")).toBe(14);
    expect(dates.differenceInDays("2025-10-15", "2025-10-01")).toBe(-14);
    expect(dates.differenceInDays("2025-10-15", "2025-10-15")).toBe(0);
    expect(dates.differenceInDays("2025-12-31", "2026-01-01")).toBe(1);
    // 2024 is a leap year, so the same calendar pair a year apart is 366 days apart here.
    expect(dates.differenceInDays("2024-02-28", "2025-02-28")).toBe(366);
  });

  it("counts a range's own two ends, so a single day is one day", () => {
    expect(dates.daysInRange({ from: "2025-10-15", to: "2025-10-15" })).toBe(1);
    expect(dates.daysInRange(TEN_DAY_RANGE)).toBe(10);
    expect(dates.daysInRange(CLOSED_RANGE)).toBe(15);
    expect(dates.daysInRange(YEAR_BOUNDS)).toBe(365);
    expect(dates.daysInRange(OVER_CAP_RANGE)).toBe(367);
  });

  it("settles an unmeasurable span on zero rather than on NaN", () => {
    expect(dates.daysInRange(UNPARSABLE_RANGE)).toBe(0);
    expect(dates.daysInRange(UNPARSABLE_END_RANGE)).toBe(0);
    expect(dates.daysInRange({ from: "2025-10-15", to: "2025-10-01" })).toBe(0);
    expect(dates.differenceInDays("2025-10-01", "nope")).toBe(0);
    expect(dates.differenceInDays("nope", "2025-10-01")).toBe(0);
    expect(dates.differenceInDays("nope", "nope")).toBe(0);
  });
});

describe("the bucket key a date falls in: bucketKey", () => {
  it.each(BUCKET_KEY_CASES)("keys $value at $granularity as $key", (row) => {
    expect(dates.bucketKey(row.value, row.granularity)).toBe(row.key);
  });

  it("keys nothing it cannot parse, at every granularity", () => {
    for (const value of UNPARSABLE_VALUES) {
      for (const granularity of GRANULARITIES) {
        expect(dates.bucketKey(value, granularity)).toBe("");
      }
    }
  });
});

describe("the days a bucket key covers: bucketStart and bucketEnd", () => {
  it.each(BUCKET_SPAN_CASES)("reads $key at $granularity as $start through $end", (row) => {
    expect(dates.bucketStart(row.key, row.granularity)).toBe(row.start);
    expect(dates.bucketEnd(row.key, row.granularity)).toBe(row.end);
  });

  it("refuses a key of the wrong shape, or one past the last week or month", () => {
    const refused: readonly (readonly [string, BucketGranularity])[] = [
      ["2025-W54", "week"],
      ["2025-W00", "week"],
      ["2025-W01", "day"],
      ["2025-10-15", "week"],
      ["2025-13", "month"],
      ["2025-00", "month"],
      ["2025-02", "day"],
      ["nope", "month"],
    ];
    for (const [key, granularity] of refused) {
      expect(dates.bucketStart(key, granularity)).toBe("");
      expect(dates.bucketEnd(key, granularity)).toBe("");
    }
  });
});

describe("the buckets a range touches: eachBucket and bucketCount", () => {
  it("walks whole ISO weeks, so the last bucket is not clipped to the range's end", () => {
    expect(dates.eachBucket({ from: "2024-12-30", to: "2025-01-06" }, "week")).toEqual([
      { key: "2025-W01", start: "2024-12-30", end: "2025-01-05" },
      { key: "2025-W02", start: "2025-01-06", end: "2025-01-12" },
    ]);
  });

  it("opens a week bucket on the Monday before a range that starts mid-week", () => {
    // 1 October 2025 is a Wednesday, so the week bucket holding it opens on Monday 29 September.
    expect(dates.eachBucket(CLOSED_RANGE, "week")).toEqual([
      { key: "2025-W40", start: "2025-09-29", end: "2025-10-05" },
      { key: "2025-W41", start: "2025-10-06", end: "2025-10-12" },
      { key: "2025-W42", start: "2025-10-13", end: "2025-10-19" },
    ]);
  });

  it("walks one bucket per day, each keyed by its own date", () => {
    expect(dates.eachBucket({ from: "2025-10-01", to: "2025-10-03" }, "day")).toEqual([
      { key: "2025-10-01", start: "2025-10-01", end: "2025-10-01" },
      { key: "2025-10-02", start: "2025-10-02", end: "2025-10-02" },
      { key: "2025-10-03", start: "2025-10-03", end: "2025-10-03" },
    ]);
  });

  it("walks calendar months, each ending on the month's own last day", () => {
    // The walk opens on the range's own first day and then on the first of each month, and a bucket's
    // end is its month's last day — never the range's end, and never a day into the month after.
    expect(dates.eachBucket({ from: "2025-01-01", to: "2025-03-01" }, "month")).toEqual([
      { key: "2025-01", start: "2025-01-01", end: "2025-01-31" },
      { key: "2025-02", start: "2025-02-01", end: "2025-02-28" },
      { key: "2025-03", start: "2025-03-01", end: "2025-03-31" },
    ]);
    expect(dates.eachBucket({ from: "2024-02-05", to: "2024-02-20" }, "month")).toEqual([
      { key: "2024-02", start: "2024-02-05", end: "2024-02-29" },
    ]);
  });

  it("counts the buckets a range touches without building them, agreeing with the walk", () => {
    expect(dates.bucketCount({ from: "2025-10-01", to: "2025-10-03" }, "day")).toBe(3);
    expect(dates.bucketCount({ from: "2024-12-30", to: "2025-01-06" }, "week")).toBe(2);
    expect(dates.bucketCount(CLOSED_RANGE, "week")).toBe(3);
    expect(dates.bucketCount({ from: "2025-01-15", to: "2025-03-02" }, "month")).toBe(3);
    expect(dates.bucketCount({ from: "2025-01-31", to: "2025-02-01" }, "month")).toBe(2);
    expect(dates.bucketCount({ from: "2025-10-15", to: "2025-10-15" }, "month")).toBe(1);
    // The trailing default range opens on 16 September, so it touches September and October.
    expect(dates.eachBucket(fixtures.FIXED_DATE_RANGE, "month")).toHaveLength(2);
    expect(dates.bucketCount(fixtures.FIXED_DATE_RANGE, "month")).toBe(2);
  });

  it("walks nothing and counts nothing when an end cannot be parsed", () => {
    for (const granularity of GRANULARITIES) {
      expect(dates.eachBucket(UNPARSABLE_END_RANGE, granularity)).toEqual([]);
      expect(dates.eachBucket(UNPARSABLE_RANGE, granularity)).toEqual([]);
      expect(dates.bucketCount(UNPARSABLE_END_RANGE, granularity)).toBe(0);
    }
  });
});

describe("the comparison periods: previousPeriodRange, previousYearRange, resolveBaselineRange", () => {
  it("puts the previous period immediately before the range and gives it the same length", () => {
    const previous = dates.previousPeriodRange(TEN_DAY_RANGE);
    expect(previous).toEqual({ from: "2025-09-21", to: "2025-09-30" });
    expect(dates.daysInRange(previous)).toBe(10);
    // The range starts the day after the previous period ends, so the two neither gap nor overlap.
    expect(dates.differenceInDays(previous.to, TEN_DAY_RANGE.from)).toBe(1);
    // A single day is measured against the one before it, and the two are the same length as well.
    expect(dates.previousPeriodRange({ from: "2025-10-15", to: "2025-10-15" })).toEqual({
      from: "2025-10-14",
      to: "2025-10-14",
    });
  });

  it("reaches back across a month boundary without shortening the period", () => {
    const previous = dates.previousPeriodRange({ from: "2025-03-01", to: "2025-03-31" });
    expect(previous).toEqual({ from: "2025-01-29", to: "2025-02-28" });
    expect(dates.daysInRange(previous)).toBe(31);
  });

  it("returns an unmeasurable range unchanged rather than inverting it", () => {
    expect(dates.previousPeriodRange(UNPARSABLE_RANGE)).toEqual(UNPARSABLE_RANGE);
    expect(dates.previousPeriodRange(UNPARSABLE_END_RANGE)).toEqual(UNPARSABLE_END_RANGE);
    expect(dates.previousPeriodRange({ from: "2025-10-15", to: "2025-10-01" })).toEqual({
      from: "2025-10-15",
      to: "2025-10-01",
    });
  });

  it("clamps a leap day to 28 February when the comparison year is a common one", () => {
    expect(dates.previousYearRange({ from: "2024-02-29", to: "2024-03-31" })).toEqual({
      from: "2023-02-28",
      to: "2023-03-31",
    });
    // A February that loses its leap day makes the comparison period a day shorter.
    expect(dates.daysInRange({ from: "2024-02-01", to: "2024-02-29" })).toBe(29);
    expect(dates.previousYearRange({ from: "2024-02-01", to: "2024-02-29" })).toEqual({
      from: "2023-02-01",
      to: "2023-02-28",
    });
    expect(dates.daysInRange({ from: "2023-02-01", to: "2023-02-28" })).toBe(28);
  });

  it("shifts an ordinary range back one calendar year", () => {
    expect(dates.previousYearRange({ from: "2025-03-31", to: "2025-04-30" })).toEqual({
      from: "2024-03-31",
      to: "2024-04-30",
    });
    expect(dates.previousYearRange(TEN_DAY_RANGE)).toEqual({
      from: "2024-10-01",
      to: "2024-10-10",
    });
  });

  it.each(BASELINE_CASES)("resolves $kind to the period it names", (row) => {
    expect(dates.resolveBaselineRange(TEN_DAY_RANGE, row.kind)).toEqual(row.expected);
  });
});

describe("the ranges the product opens on: defaultReportRange and maxReportRange", () => {
  it("opens on the trailing default period, ending on the injected day", () => {
    const range = dates.defaultReportRange(TODAY);
    expect(range).toEqual({ from: "2025-09-16", to: TODAY_ISO });
    // The shared fixture ends on the same day the suite injects as "today".
    expect(range).toEqual(fixtures.FIXED_DATE_RANGE);
    expect(dates.daysInRange(range)).toBe(DEFAULT_REPORT_RANGE_DAYS);
  });

  it("caps a range at the configured maximum and no wider", () => {
    const range = dates.maxReportRange(TODAY);
    expect(range).toEqual({ from: "2024-10-15", to: TODAY_ISO });
    expect(dates.daysInRange(range)).toBe(MAX_REPORT_RANGE_DAYS);
    expect(dates.daysInRange(AT_CAP_RANGE)).toBe(MAX_REPORT_RANGE_DAYS);
  });
});

describe("the presets of the range control: reportRangePresets", () => {
  it("offers the trailing 7, 30 and 90 days, the month to date and the year to date", () => {
    expect(dates.reportRangePresets(TODAY)).toEqual([
      { key: "last-7-days", range: { from: "2025-10-09", to: TODAY_ISO }, days: 7 },
      { key: "last-30-days", range: { from: "2025-09-16", to: TODAY_ISO }, days: 30 },
      { key: "last-90-days", range: { from: "2025-07-18", to: TODAY_ISO }, days: 90 },
      { key: "this-month", range: { from: "2025-10-01", to: TODAY_ISO }, days: 15 },
      { key: "this-year", range: { from: "2025-01-01", to: TODAY_ISO }, days: 288 },
    ]);
  });

  it("states for each preset the days it covers and the day every one of them ends on", () => {
    const presets = dates.reportRangePresets(TODAY);
    for (const preset of presets) {
      expect(dates.daysInRange(preset.range)).toBe(preset.days);
      expect(preset.range.to).toBe(TODAY_ISO);
    }
    // The middle trailing preset reaches back the configured default, not a second 30 typed out.
    expect(presets[1].days).toBe(DEFAULT_REPORT_RANGE_DAYS);
    expect(presets[1].range.from).toBe("2025-09-16");
  });
});

// Membership, clamping and ordering -------------------------------------------------------------

describe("whether a value falls in a range: isWithinRange, prepareRange, isWithinPreparedRange", () => {
  it("includes both ends of the range and excludes the days around it", () => {
    for (const value of ["2025-10-01", "2025-10-08", "2025-10-15"]) {
      expect(dates.isWithinRange(value, CLOSED_RANGE)).toBe(true);
    }
    for (const value of ["2025-09-30", "2025-10-16"]) {
      expect(dates.isWithinRange(value, CLOSED_RANGE)).toBe(false);
    }
  });

  it("counts the last day of the range to the end of that day", () => {
    const prepared: dates.PreparedRange = {
      startTime: new Date(2025, 9, 1).getTime(),
      endTime: new Date(2025, 9, 16).getTime(),
    };
    expect(dates.isWithinPreparedRange("2025-10-15T23:59:59", prepared)).toBe(true);
    expect(dates.isWithinPreparedRange("2025-09-30T23:59:59", prepared)).toBe(false);
    expect(dates.isWithinPreparedRange("2025-10-16T00:00:00", prepared)).toBe(false);
  });

  it("resolves a range once into the two instants a scan compares against", () => {
    expect(dates.prepareRange(CLOSED_RANGE)).toEqual({
      startTime: new Date(2025, 9, 1).getTime(),
      endTime: new Date(2025, 9, 16).getTime(),
    });
  });

  it("matches nothing against a range that did not resolve", () => {
    expect(dates.prepareRange(UNPARSABLE_RANGE)).toBeNull();
    expect(dates.prepareRange(UNPARSABLE_END_RANGE)).toBeNull();
    expect(dates.isWithinPreparedRange(TODAY_ISO, null)).toBe(false);
    expect(dates.isWithinPreparedRange("nope", dates.prepareRange(CLOSED_RANGE))).toBe(false);
    expect(dates.isWithinRange(TODAY_ISO, UNPARSABLE_RANGE)).toBe(false);
    expect(dates.isWithinRange(TODAY_ISO, UNPARSABLE_END_RANGE)).toBe(false);
  });
});

describe("clamping a range into its bounds: clampRange", () => {
  it("trims a range that reaches past the bounds and leaves one inside them alone", () => {
    expect(dates.clampRange({ from: "2024-01-01", to: "2027-01-01" }, YEAR_BOUNDS)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(dates.clampRange(TEN_DAY_RANGE, YEAR_BOUNDS)).toEqual(TEN_DAY_RANGE);
  });

  it("collapses a range wholly outside the bounds to their nearest day", () => {
    expect(dates.clampRange({ from: "2024-01-01", to: "2024-06-30" }, YEAR_BOUNDS)).toEqual({
      from: "2025-01-01",
      to: "2025-01-01",
    });
    expect(dates.clampRange({ from: "2026-01-01", to: "2026-06-30" }, YEAR_BOUNDS)).toEqual({
      from: "2025-12-31",
      to: "2025-12-31",
    });
  });

  it("returns the bounds unchanged when either range cannot be parsed", () => {
    expect(dates.clampRange(UNPARSABLE_RANGE, YEAR_BOUNDS)).toEqual(YEAR_BOUNDS);
    expect(dates.clampRange(UNPARSABLE_END_RANGE, YEAR_BOUNDS)).toEqual(YEAR_BOUNDS);
    expect(dates.clampRange(TEN_DAY_RANGE, UNPARSABLE_RANGE)).toEqual(UNPARSABLE_RANGE);
  });
});

describe("ordering dates: compareIso and sortByIso", () => {
  it("signs the comparison by which instant is the earlier one", () => {
    expect(dates.compareIso("2025-10-01", "2025-10-15")).toBeLessThan(0);
    expect(dates.compareIso("2025-10-15", "2025-10-01")).toBeGreaterThan(0);
    expect(dates.compareIso("2025-09-30", "2025-10-15")).toBeLessThan(0);
    expect(dates.compareIso("2025-10-15", "2025-10-15")).toBe(0);
    expect(dates.compareIso("2025-10-15", "2025-10-15T00:00:00")).toBe(0);
  });

  it("sorts a value it cannot parse last, and two of them together", () => {
    expect(dates.compareIso("nope", "2025-10-15")).toBeGreaterThan(0);
    expect(dates.compareIso("2025-10-15", "nope")).toBeLessThan(0);
    expect(dates.compareIso("nope", "2025-13-45")).toBe(0);
  });

  it("orders items by the date each carries, both ways, without touching the input", () => {
    const items = [
      { id: "b", at: "2025-10-05" },
      { id: "e", at: "2025-10-05" },
      { id: "a", at: "2025-10-01" },
      { id: "c", at: "nope" },
      { id: "d", at: "2025-10-15" },
    ];
    const read = (item: (typeof items)[number]): string => item.at;
    // "b" before "e" in both directions: equal dates keep the order they arrived in.
    expect(dates.sortByIso(items, read).map((item) => item.id)).toEqual(["a", "b", "e", "d", "c"]);
    expect(dates.sortByIso(items, read, "desc").map((item) => item.id)).toEqual([
      "d",
      "b",
      "e",
      "a",
      "c",
    ]);
    expect(items.map((item) => item.id)).toEqual(["b", "e", "a", "c", "d"]);
  });
});

describe("the guards a range control checks: hasFutureDate and exceedsMaxRange", () => {
  it("flags a range that reaches past the injected day", () => {
    expect(dates.hasFutureDate({ from: "2025-10-01", to: "2025-10-20" }, TODAY)).toBe(true);
    expect(dates.hasFutureDate({ from: "2025-10-16", to: "2025-10-20" }, TODAY)).toBe(true);
    // Today itself is allowed, on either end.
    expect(dates.hasFutureDate({ from: "2025-10-01", to: TODAY_ISO }, TODAY)).toBe(false);
    expect(dates.hasFutureDate({ from: TODAY_ISO, to: TODAY_ISO }, TODAY)).toBe(false);
    expect(dates.hasFutureDate(UNPARSABLE_RANGE, TODAY)).toBe(false);
    expect(dates.hasFutureDate(UNPARSABLE_END_RANGE, TODAY)).toBe(false);
  });

  it("flags a range of more days than the product accepts, and nothing else", () => {
    expect(dates.exceedsMaxRange(YEAR_BOUNDS)).toBe(false);
    expect(dates.exceedsMaxRange(AT_CAP_RANGE)).toBe(false);
    expect(dates.exceedsMaxRange(PAST_CAP_RANGE)).toBe(true);
    expect(dates.exceedsMaxRange(OVER_CAP_RANGE)).toBe(true);
    expect(dates.exceedsMaxRange(UNPARSABLE_RANGE)).toBe(false);
    expect(dates.exceedsMaxRange({ from: "2025-10-15", to: "2025-10-01" })).toBe(false);
  });
});

describe("range problems as form errors: toFieldErrors", () => {
  it("files an inverted range on the range itself, with that rule's wording", () => {
    const errors = dates.toFieldErrors(
      dates.validateDateRange("2025-10-01", "2025-09-01", TODAY),
      RANGE_MESSAGES,
    );
    expect(errors).toEqual({ range: RANGE_MESSAGES["range-inverted"] });
  });

  it("names both ends when neither can be read as a date", () => {
    const errors = dates.toFieldErrors(
      dates.validateDateRange("nope", "2025-13-45", TODAY),
      RANGE_MESSAGES,
    );
    expect(errors).toEqual({
      from: RANGE_MESSAGES["date-invalid"],
      to: RANGE_MESSAGES["date-invalid"],
    });
  });

  it("files nothing at all for a range that is usable", () => {
    expect(
      dates.toFieldErrors(dates.validateDateRange("2025-10-01", TODAY_ISO, TODAY), RANGE_MESSAGES),
    ).toEqual({});
  });

  it("keeps the first problem a field carries, because a field shows one sentence", () => {
    const validation: dates.DateRangeValidation = {
      valid: false,
      days: 0,
      problems: [
        { field: "range", code: "range-too-long" },
        { field: "range", code: "range-inverted" },
        { field: "from", code: "range-in-future" },
      ],
    };
    expect(dates.toFieldErrors(validation, RANGE_MESSAGES)).toEqual({
      range: RANGE_MESSAGES["range-too-long"],
      from: RANGE_MESSAGES["range-in-future"],
    });
  });
});
