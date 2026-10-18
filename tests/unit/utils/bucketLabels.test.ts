/**
 * Path: tests/unit/utils/bucketLabels.test.ts
 * Purpose: The wording of a bucket the selected range clips: the chart's axis label and the report's period cell
 * Lines: 233
 */

import { describe, expect, it } from "vitest";

import type { BucketGranularity } from "@/types/analytics";
import type { DateRange, IsoDateString } from "@/types/common";
import * as dates from "@/utils/dates";

/*
 * A §0.5.5 split of `tests/unit/utils/formatting.test.ts`, which was at the 600-line ceiling with the bucket
 * labels inside it: the wording of a bucket that the range it is charted over clips — the axis label, the report
 * table's period cell and the period cell the same report's download states — is its own case table here. Every
 * function is reached through `@/utils/dates`, their one home, and every expectation is a literal string, so a
 * wording that changes without the reader seeing it fails here.
 */

/** The range every expectation is anchored on: the product's default trailing window, as the live app resolves
 *  it — 2026-09-19 to 2026-10-18 — whose first week holds Sep 19 and 20 alone and whose first month holds
 *  Sep 19 to 30. */
const CUT_RANGE: DateRange = { from: "2026-09-19", to: "2026-10-18" };
/** A range that crosses a year boundary, so a covered span crossing one is stated with both years. */
const YEAR_CROSSING_RANGE: DateRange = { from: "2025-12-31", to: "2026-01-06" };

/** One bucket and the axis wording it reads as over one range. */
interface AxisCase {
  readonly bucket: IsoDateString;
  readonly cut: BucketGranularity;
  /** The period the bucket is charted over; absent for a chart that states none. */
  readonly range?: DateRange;
  readonly label: string;
}

/** One bucket and the word a report's period cell shows for it. */
interface CellCase {
  readonly bucket: IsoDateString;
  readonly cut: BucketGranularity;
  readonly range: DateRange;
  readonly label: string;
}

describe("formatBucketLabel: a bucket the range clips", () => {
  it.each<AxisCase>([
    // The default range's first bucket at each cut: one week holds two days, one month holds twelve, a day
    // holds itself.
    { bucket: "2026-09-14", cut: "week", range: CUT_RANGE, label: "Sep 19 – 20" },
    { bucket: "2026-09-01", cut: "month", range: CUT_RANGE, label: "Sep 19 – 30" },
    { bucket: "2026-09-19", cut: "day", range: CUT_RANGE, label: "Sep 19" },
    // A bucket the range clips at its far end, which is the same rule at the range's other edge.
    {
      bucket: "2026-10-12",
      cut: "week",
      range: { from: "2026-09-19", to: "2026-10-16" },
      label: "Oct 12 – 16",
    },
    // A covered span whose two days fall in different years states both, because a range may cross one.
    {
      bucket: "2025-12-29",
      cut: "week",
      range: YEAR_CROSSING_RANGE,
      label: "Dec 31, 2025 – Jan 4, 2026",
    },
    // A bucket the range covers whole keeps the wording of the period it opens.
    { bucket: "2026-09-21", cut: "week", range: CUT_RANGE, label: "Week of Sep 21" },
    {
      bucket: "2026-10-01",
      cut: "month",
      range: { from: "2026-09-19", to: "2026-10-31" },
      label: "Oct 2026",
    },
    // A range that is absent, inverted or unreadable leaves the wording as the bucket's own period.
    { bucket: "2026-09-14", cut: "week", label: "Week of Sep 14" },
    {
      bucket: "2026-09-14",
      cut: "week",
      range: { from: "2026-10-18", to: "2026-09-19" },
      label: "Week of Sep 14",
    },
    {
      bucket: "2026-09-14",
      cut: "week",
      range: { from: "garbage", to: CUT_RANGE.to },
      label: "Week of Sep 14",
    },
    // A value that names no day is worded as nothing, never as "Invalid Date".
    { bucket: "garbage", cut: "week", range: CUT_RANGE, label: "" },
  ])("words $bucket at $cut as $label", ({ bucket, cut, range, label }) => {
    expect(dates.formatBucketLabel(bucket, cut, range)).toBe(label);
  });
});

describe("formatBucketCell: the report's period cell", () => {
  it.each<CellCase>([
    // A bucket the range covers whole shows the day it opens, which is the wording the cell has always had.
    {
      bucket: "2026-09-14",
      cut: "week",
      range: { from: "2026-09-14", to: "2026-10-18" },
      label: "Sep 14, 2026",
    },
    {
      bucket: "2026-09-01",
      cut: "month",
      range: { from: "2026-09-01", to: "2026-10-18" },
      label: "Sep 1, 2026",
    },
    // A bucket the range clips states the days of it the range covers, in the cell's own date style.
    { bucket: "2026-09-14", cut: "week", range: CUT_RANGE, label: "Sep 19 – 20, 2026" },
    { bucket: "2026-09-01", cut: "month", range: CUT_RANGE, label: "Sep 19 – 30, 2026" },
    {
      bucket: "2025-12-29",
      cut: "week",
      range: YEAR_CROSSING_RANGE,
      label: "Dec 31, 2025 – Jan 4, 2026",
    },
    // A range that cannot be read, or is inverted, leaves the day the bucket opens.
    {
      bucket: "2026-09-14",
      cut: "week",
      range: { from: "garbage", to: CUT_RANGE.to },
      label: "Sep 14, 2026",
    },
    {
      bucket: "2026-09-14",
      cut: "week",
      range: { from: CUT_RANGE.to, to: CUT_RANGE.from },
      label: "Sep 14, 2026",
    },
    // A value that names no day is worded as nothing, never as "Invalid Date".
    { bucket: "garbage", cut: "week", range: CUT_RANGE, label: "" },
  ])("words $bucket at $cut as $label", ({ bucket, cut, range, label }) => {
    expect(dates.formatBucketCell(bucket, cut, range)).toBe(label);
  });
});

describe("formatBucketCellForExport: the period cell the same report's file states", () => {
  it.each<CellCase>([
    // A bucket the range covers whole states the day it opens, unchanged from the raw value the file has
    // always held: a day bucket, and a month the range opens on its own first day.
    { bucket: "2026-09-19", cut: "day", range: CUT_RANGE, label: "2026-09-19" },
    {
      bucket: "2026-09-01",
      cut: "month",
      range: { from: "2026-09-01", to: "2026-10-18" },
      label: "2026-09-01",
    },
    // A bucket the range clips states the days of it the range covers, both ends raw and ISO — the days the
    // table's own cell words, so a file recovered from a month-bucketed run names the period it holds.
    { bucket: "2026-09-01", cut: "month", range: CUT_RANGE, label: "2026-09-19 – 2026-09-30" },
    { bucket: "2026-10-01", cut: "month", range: CUT_RANGE, label: "2026-10-01 – 2026-10-18" },
    { bucket: "2026-09-14", cut: "week", range: CUT_RANGE, label: "2026-09-19 – 2026-09-20" },
    {
      bucket: "2025-12-29",
      cut: "week",
      range: YEAR_CROSSING_RANGE,
      label: "2025-12-31 – 2026-01-04",
    },
    // A range that cannot be read, or is inverted, leaves the day the bucket opens.
    {
      bucket: "2026-09-01",
      cut: "month",
      range: { from: "garbage", to: CUT_RANGE.to },
      label: "2026-09-01",
    },
    {
      bucket: "2026-09-01",
      cut: "month",
      range: { from: CUT_RANGE.to, to: CUT_RANGE.from },
      label: "2026-09-01",
    },
    // A value that names no bucket states nothing, so the caller's own rendering of it stands.
    { bucket: "Total", cut: "month", range: CUT_RANGE, label: "" },
    { bucket: "garbage", cut: "week", range: CUT_RANGE, label: "" },
  ])("states $bucket at $cut as $label", ({ bucket, cut, range, label }) => {
    expect(dates.formatBucketCellForExport(bucket, cut, range)).toBe(label);
  });
});

/** One band of a run and the wording it takes over that run: the run's own keys, and the range it charts. */
interface BandCase {
  /** The key the band carries: a bucket key (`2026-W38`, `2026-09`) or the day the bucket opens. */
  readonly key: string;
  readonly cut: BucketGranularity;
  readonly keys: readonly string[];
  readonly range: DateRange;
  readonly label: string;
}

/*
 * `formatBandLabel` is reached by both callers that chart a run: the dashboard's revenue series, whose keys
 * are bucket keys, and a report's rows, whose period cells hold the day a bucket opens. A clipped band must
 * read the same either way — the one wording for the one band — so each case below is stated for both key
 * forms at once.
 */
describe("formatBandLabel: one run's band, whichever key form charts it", () => {
  const WEEK_KEYS = ["2026-W38", "2026-W39", "2026-W40", "2026-W41", "2026-W42"];
  const MONTH_KEYS = ["2026-09", "2026-10"];
  const DAY_KEYS = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"];

  it.each<BandCase>([
    // The clipped first week and month, by bucket key and by the day the bucket opens.
    { key: "2026-W38", cut: "week", keys: WEEK_KEYS, range: CUT_RANGE, label: "Sep 19 – 20" },
    { key: "2026-09-14", cut: "week", keys: WEEK_KEYS, range: CUT_RANGE, label: "Sep 19 – 20" },
    { key: "2026-09", cut: "month", keys: MONTH_KEYS, range: CUT_RANGE, label: "Sep 19 – 30" },
    { key: "2026-09-01", cut: "month", keys: MONTH_KEYS, range: CUT_RANGE, label: "Sep 19 – 30" },
    // A bucket the range covers whole keeps the wording of the period it opens, either way.
    { key: "2026-W39", cut: "week", keys: WEEK_KEYS, range: CUT_RANGE, label: "Week of Sep 21" },
    { key: "2026-09-21", cut: "week", keys: WEEK_KEYS, range: CUT_RANGE, label: "Week of Sep 21" },
    // A day of a run that leaves one calendar year carries its year, either way.
    {
      key: "2025-12-31",
      cut: "day",
      keys: ["2025-12-31", "2026-01-02"],
      range: YEAR_CROSSING_RANGE,
      label: "Dec 31, 2025",
    },
    {
      key: "2026-01-02",
      cut: "day",
      keys: ["2025-12-31", "2026-01-02"],
      range: YEAR_CROSSING_RANGE,
      label: "Jan 2, 2026",
    },
    // Days inside the range keep the day wording; a key neither wording reads stands as it is.
    { key: "2026-09-21", cut: "day", keys: DAY_KEYS, range: CUT_RANGE, label: "Sep 21" },
    { key: "garbage", cut: "week", keys: WEEK_KEYS, range: CUT_RANGE, label: "garbage" },
  ])("words $key at $cut as $label", ({ key, cut, keys, range, label }) => {
    expect(dates.formatBandLabel(key, cut, keys, range)).toBe(label);
  });
});
