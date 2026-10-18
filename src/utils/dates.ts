/**
 * Path: src/utils/dates.ts
 * Purpose: Parses, formats and buckets dates and computes the comparison periods the dashboard and reports use.
 * Lines: 589
 */

import { DEFAULT_REPORT_RANGE_DAYS, MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import type { BaselineKind, BucketGranularity } from "@/types/analytics";
import type { DateRange, FieldErrors, IsoDateString, IsoDateTimeString } from "@/types/common";
import {
  MONTH_DAY_OPTIONS,
  YEAR_OPTIONS,
  formatDate,
  formatYearMonth,
  formatter,
} from "@/utils/dateDisplay";
import {
  addDaysToDate,
  isIsoDateText,
  isWithinPreparedRange,
  parseIso,
  prepareRange,
  startOfLocalDay,
} from "@/utils/isoInstants";

// The public surface ------------------------------------------------------------------------------
// The instant level — what an ISO text parses to, and whether an instant falls inside a range resolved
// once — lives in `src/utils/isoInstants.ts`, because re-parsing both range ends per record is what the
// comparison below stops doing. Every name a consumer imports stays at this path.

export { sortByIso } from "@/utils/isoInstants";

export {
  addHoursToDate,
  isWithinPreparedRange,
  parseIso,
  prepareRange,
  type PreparedRange,
} from "@/utils/isoInstants";

// The display level — the locale and the formatters a date is shown through — lives in
// `src/utils/dateDisplay.ts`, split out of this file when the bucket wording needed the room.

export {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatYearMonth,
  type DateDisplayStyle,
} from "@/utils/dateDisplay";

/**
 * The conventions every date decision here shares. **Local time:** timestamps are ISO 8601 in the
 * visitor's local time, in which "today", bucketing and the comparisons are computed, so
 * `"2025-01-30"` is local midnight on the 30th and never slides back a day west of UTC. **Monday
 * weeks:** a week bucket is an ISO week, which a Sunday start would split in two. **An injectable
 * clock:** any function needing the current time takes an optional `now: Date` last.
 */
/** Milliseconds in a day, the unit the range arithmetic counts in. */
const MS_PER_DAY = 86_400_000;
/** The two bucket keys that are not a plain date: an ISO week and a calendar month. */
const WEEK_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
/** The walk guard per granularity: one more than the most buckets a capped range can touch. */
const MAX_BUCKETS: Readonly<Record<BucketGranularity, number>> = {
  day: MAX_REPORT_RANGE_DAYS,
  week: Math.ceil(MAX_REPORT_RANGE_DAYS / 7) + 1,
  month: Math.ceil(MAX_REPORT_RANGE_DAYS / 28) + 2,
};
/** Pads a component to two digits, as every ISO string this module emits requires. */
const pad2 = (value: number): string => String(value).padStart(2, "0");
/** Pads a year to four digits, so an emitted `YYYY-MM-DD` date keeps the shape its pattern requires. */
const padYear = (value: number): string => String(value).padStart(4, "0");
/** The Monday that opens the ISO week an instant falls in. */
const startOfWeekDate = (date: Date): Date => addDaysToDate(date, -((date.getDay() + 6) % 7));
/** Whole days from one instant to another, counted between local midnights. */
const daysBetweenDates = (from: Date, to: Date): number =>
  Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / MS_PER_DAY);
/** How many days the given month of the given year holds. */
const lastDayOfMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate();
/** The `YYYY-MM-DD` text of a local instant, its year padded to the four digits that shape requires. */
const isoOf = (date: Date): IsoDateString =>
  `${padYear(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
/** The `YYYY-MM-DDTHH:mm:ss` text of a local instant; it carries no offset, being local time. */
const isoDateTimeOf = (date: Date): IsoDateTimeString =>
  `${isoOf(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
/** The Monday of ISO week 1 of a year: Jan 4 always falls in it, by the ISO week rule. */
const weekOneMonday = (year: number): Date => startOfWeekDate(new Date(year, 0, 4));

/** The ISO week-numbering year and 1-based week an instant falls in. */
function isoWeekParts(date: Date): { readonly year: number; readonly week: number } {
  const thursday = addDaysToDate(startOfWeekDate(date), 3);
  const year = thursday.getFullYear();
  return { year, week: Math.round(daysBetweenDates(weekOneMonday(year), thursday) / 7) + 1 };
}
/** The day the bucket after the one a start day opens begins. */
function nextBucketDay(date: Date, granularity: BucketGranularity): Date {
  switch (granularity) {
    case "day":
      return addDaysToDate(date, 1);
    case "week":
      return addDaysToDate(date, 7);
    case "month":
      return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  }
}
/** The bucket a start day opens: its key, and the first and last days it covers, both inclusive. */
function bucketSpan(start: Date, granularity: BucketGranularity): DateBucket {
  const startText = isoOf(start);
  const year = start.getFullYear();
  const month = start.getMonth();
  const end =
    granularity === "month"
      ? new Date(year, month, lastDayOfMonth(year, month))
      : addDaysToDate(start, granularity === "week" ? 6 : 0);
  return { key: bucketKey(startText, granularity), start: startText, end: isoOf(end) };
}

// Parsing and emitting ---------------------------------------------------------------------------

/** Whether `value` is a string this module can parse: the guard for `unknown` from storage or a form. */
export function isValidIso(value: unknown): boolean {
  return typeof value === "string" && parseIso(value) !== null;
}
/** The `YYYY-MM-DD` text of `date`'s local day, the stored form of every range end; `""` if invalid. */
export function toIsoDate(date: Date): IsoDateString {
  return Number.isNaN(date.getTime()) ? "" : isoOf(date);
}
/** The local `YYYY-MM-DDTHH:mm:ss` text of `date`, stored for every timestamp; `""` if invalid. */
export function toIsoDateTime(date: Date): IsoDateTimeString {
  return Number.isNaN(date.getTime()) ? "" : isoDateTimeOf(date);
}
/** The `<input type="date">` value for the stored `iso`, so a date round-trips through the control as
 * the same calendar day rather than shifting by a time zone; `""` when unparsable. */
export function toDateInputValue(iso: IsoDateString): IsoDateString {
  const date = parseIso(iso);
  return date ? isoOf(startOfLocalDay(date)) : "";
}
/** The stored date an `<input type="date">` `value` names, the inverse of {@link toDateInputValue}:
 * the value when it is exactly a parsable date and `""` for an emptied or half-typed control. */
export function fromDateInputValue(value: string): IsoDateString {
  return isIsoDateText(value) && parseIso(value) !== null ? value : "";
}

// Display ----------------------------------------------------------------------------------------

/** Formats the closed `from`–`to` range as one label — `"Jan 1 – Jan 30, 2025"`, collapsing the year
 * when the ends share it and writing one date when they are the same day; `""` when either is bad. */
export function formatDateRange(from: IsoDateString, to: IsoDateString): string {
  const start = parseIso(from);
  const end = parseIso(to);
  if (!start || !end) return "";
  if (daysBetweenDates(start, end) === 0) return formatDate(from);
  if (start.getFullYear() !== end.getFullYear()) return `${formatDate(from)} – ${formatDate(to)}`;
  const dayText = formatter("month-day", MONTH_DAY_OPTIONS);
  const yearText = formatter("year", YEAR_OPTIONS).format(end);
  return `${dayText.format(start)} – ${dayText.format(end)}, ${yearText}`;
}
/** The days `range` covers of the bucket `key` names, or `null` when it covers that bucket whole or cannot
 *  be read: the span a clipped bucket is worded by, both of its ends whole days. */
function coveredSpan(
  key: string,
  granularity: BucketGranularity,
  range: DateRange,
): DateBucket | null {
  const start = bucketStart(key, granularity);
  const end = bucketEnd(key, granularity);
  if (start === "" || end === "" || !isValidIso(range.from) || !isValidIso(range.to)) return null;
  if (compareIso(range.from, range.to) > 0) return null;
  const from = startOfDay(compareIso(range.from, start) > 0 ? range.from : start);
  const to = startOfDay(compareIso(range.to, end) < 0 ? range.to : end);
  const covered = from !== "" && to !== "" && compareIso(from, to) <= 0;
  return covered && (from !== start || to !== end) ? { key, start: from, end: to } : null;
}

/** The wording of the days a range covers of a bucket: its two days in the axis's own month-day style, with
 *  the month written once where the span shares one — `Sep 19 – 20` — and both dates whole where the span
 *  crosses a year (`Dec 31, 2025 – Jan 4, 2026`). `withYear` states the year a report's calendar cell writes
 *  and an axis leaves off; `""` when either day cannot be parsed. */
function coveredLabel(span: DateBucket, withYear: boolean): string {
  const start = parseIso(span.start);
  const end = parseIso(span.end);
  if (!start || !end) return "";
  if (start.getFullYear() !== end.getFullYear()) {
    return `${formatDate(span.start)} – ${formatDate(span.end)}`;
  }
  const day = formatter("month-day", MONTH_DAY_OPTIONS);
  if (start.getTime() === end.getTime()) return day.format(start);
  const last = start.getMonth() === end.getMonth() ? String(end.getDate()) : day.format(end);
  const spanText = `${day.format(start)} – ${last}`;
  return withYear ? `${spanText}, ${formatter("year", YEAR_OPTIONS).format(end)}` : spanText;
}

/** Formats the axis label of the bucket `iso` falls in at `granularity`: `Jan 30` by day, `Week of Jan 27`
 * by ISO week, named by its Monday, and `Jan 2025` by month; `""` when unparsable. Given the `range` a view
 * charts, a bucket the range clips is worded by the days of it the range covers instead — `Sep 19 – 20`, both
 * years when such a span crosses one — so a band never implies data outside the selected period; a range that
 * is absent, inverted or unreadable leaves every label as it was. */
export function formatBucketLabel(
  iso: IsoDateString,
  granularity: BucketGranularity,
  range?: DateRange,
): string {
  const date = parseIso(iso);
  if (!date) return "";
  const key = bucketKey(iso, granularity);
  const covered = key === "" || range === undefined ? null : coveredSpan(key, granularity, range);
  if (covered !== null) return coveredLabel(covered, false);
  switch (granularity) {
    case "day":
      return formatter("month-day", MONTH_DAY_OPTIONS).format(date);
    case "week":
      return `Week of ${formatter("month-day", MONTH_DAY_OPTIONS).format(startOfWeekDate(date))}`;
    case "month":
      return formatYearMonth(isoOf(date));
  }
}
/** The word a report's period cell shows for the bucket `iso` falls in at `granularity`: the day the bucket
 *  opens, as `formatDate` writes it, or — when `range` clips the bucket — the days of it the range covers in
 *  that same calendar style (`Sep 19 – 20, 2026`). The cell's own value stays the bucket's ISO day, so the
 *  column's sort, the row's identity and the CSV export are unchanged; only the words are qualified. */
export function formatBucketCell(
  iso: IsoDateString,
  granularity: BucketGranularity,
  range: DateRange,
): string {
  const key = bucketKey(iso, granularity);
  if (key === "") return "";
  const covered = coveredSpan(key, granularity, range);
  return covered === null ? formatDate(bucketStart(key, granularity)) : coveredLabel(covered, true);
}

/** Whether a run's `keys` leave one calendar year: the one cut whose wording can repeat inside a run,
 *  because a week or a month key cannot. A key not opening with four characters names no year. */
const leavesOneCalendarYear = (keys: readonly string[]): boolean =>
  new Set(keys.filter((key) => key.length >= 4).map((key) => key.slice(0, 4))).size > 1;

/** Formats the band the key `key` names as one of a run, over the period that run covered. Two rules decide
 *  the wording, and both need the run rather than the key alone: a day of a run whose periods leave one
 *  calendar year carries its year, so no two days of one run word alike, and a bucket the run's `range` clips
 *  is worded by the days of it the range covers. Every other key is worded by {@link formatBucketLabel},
 *  resolved to the day its bucket opens; a key neither wording reads is returned as it stands. */
export function formatBandLabel(
  key: string,
  granularity: BucketGranularity,
  keys: readonly string[],
  range?: DateRange,
): string {
  // The two callers chart a run by two key forms: the dashboard's series carries bucket keys (`2026-W38`,
  // `2026-09`) and a report's rows carry the day each bucket opens. `coveredSpan` reads a bucket key, so a
  // key that re-keys to one is resolved and a key that is one already is used as it stands — reading only
  // one of the two forms is how a clipped band lost its wording on the dashboard.
  const bucketAt = bucketKey(key, granularity) || key;
  const covered = range === undefined ? null : coveredSpan(bucketAt, granularity, range);
  if (covered !== null) return coveredLabel(covered, false) || key;
  const at = bucketStart(key, granularity) || startOfDay(key);
  const carriesYear = granularity === "day" && leavesOneCalendarYear(keys);
  return (carriesYear ? formatDate(at) : formatBucketLabel(at, granularity)) || key;
}

// Range arithmetic -------------------------------------------------------------------------------

/** The calendar date the ISO `iso` falls on, normalised to `YYYY-MM-DD`: what every range end stores;
 * `""` when unparsable. */
export function startOfDay(iso: IsoDateString): IsoDateString {
  const date = parseIso(iso);
  return date ? isoOf(startOfLocalDay(date)) : "";
}
/** The last day a range can reach: a range ends on a date, so this is the date {@link startOfDay} returns. */
export function endOfDay(iso: IsoDateString): IsoDateString {
  return startOfDay(iso);
}
/** The Monday that opens the ISO week of `iso`: the first day of every weekly bucket; `""` if unparsable. */
export function startOfWeek(iso: IsoDateString): IsoDateString {
  const date = parseIso(iso);
  return date ? isoOf(startOfWeekDate(date)) : "";
}
/** The Sunday that closes the ISO week of `iso`, six days after {@link startOfWeek}; `""` if unparsable. */
export function endOfWeek(iso: IsoDateString): IsoDateString {
  const start = startOfWeek(iso);
  return start ? addDays(start, 6) : "";
}
/** The first day of the month of `iso`, the start a month-to-date range opens on; `""` if unparsable. */
export function startOfMonth(iso: IsoDateString): IsoDateString {
  const date = parseIso(iso);
  return date ? isoOf(new Date(date.getFullYear(), date.getMonth(), 1)) : "";
}
/** The last day of the month of `iso`, so no caller needs a month-length table; `""` when unparsable. */
export function endOfMonth(iso: IsoDateString): IsoDateString {
  const date = parseIso(iso);
  if (!date) return "";
  const year = date.getFullYear();
  const month = date.getMonth();
  return isoOf(new Date(year, month, lastDayOfMonth(year, month)));
}
/** Moves `iso` by `amount` whole days, negative to move back, over calendar parts rather than a
 * millisecond count, so month and year edges are crossed safely; `""` when unparsable. */
export function addDays(iso: IsoDateString, amount: number): IsoDateString {
  const date = parseIso(iso);
  return date ? isoOf(addDaysToDate(date, amount)) : "";
}
/** Moves `iso` by `amount` whole months, negative to move back, clamping the day to the target month's
 * length: `Jan 31` plus a month is `Feb 28`, never a day in March; `""` when unparsable. */
export function addMonths(iso: IsoDateString, amount: number): IsoDateString {
  const date = parseIso(iso);
  if (!date) return "";
  const shifted = date.getMonth() + amount;
  const year = date.getFullYear() + Math.floor(shifted / 12);
  const month = ((shifted % 12) + 12) % 12;
  return isoOf(new Date(year, month, Math.min(date.getDate(), lastDayOfMonth(year, month))));
}
/** Whole days from the ISO `from` to the ISO `to`, counted between local midnights and signed:
 * positive when `to` is later. An unparsable value yields `0`, so arithmetic cannot produce `NaN`. */
export function differenceInDays(from: IsoDateString, to: IsoDateString): number {
  const start = parseIso(from);
  const end = parseIso(to);
  return start && end ? daysBetweenDates(start, end) : 0;
}
/** How many days the closed `range` covers, both ends included; `0` for an unparsable or inverted range. */
export function daysInRange(range: DateRange): number {
  if (!isValidIso(range.from) || !isValidIso(range.to)) return 0;
  const span = differenceInDays(range.from, range.to);
  return span < 0 ? 0 : span + 1;
}
/** Whether the ISO `iso` falls inside the closed `range`, both ends included; `false` when either is bad.
 * The range is resolved here, so a caller scanning a whole collection prepares it once through
 * {@link prepareRange} and compares with {@link isWithinPreparedRange} instead. */
export function isWithinRange(iso: IsoDateString, range: DateRange): boolean {
  return isWithinPreparedRange(iso, prepareRange(range));
}
/** Clamps `range` into `bounds`, so a preset or a persisted range cannot reach past the data it queries.
 * An unparsable input yields `bounds`; a range outside them collapses to the nearest bound day. */
export function clampRange(range: DateRange, bounds: DateRange): DateRange {
  if (!isValidIso(range.from) || !isValidIso(range.to)) return bounds;
  if (!isValidIso(bounds.from) || !isValidIso(bounds.to)) return bounds;
  if (compareIso(range.to, bounds.from) < 0) return { from: bounds.from, to: bounds.from };
  if (compareIso(range.from, bounds.to) > 0) return { from: bounds.to, to: bounds.to };
  return {
    from: compareIso(range.from, bounds.from) < 0 ? bounds.from : range.from,
    to: compareIso(range.to, bounds.to) > 0 ? bounds.to : range.to,
  };
}
/** Orders the ISO `a` and `b` by the instant each names; negative when `a` is earlier, `0` the same
 * instant. An unparsable value sorts last, and two of them compare equal. */
export function compareIso(a: IsoDateString, b: IsoDateString): number {
  const left = parseIso(a);
  const right = parseIso(b);
  if (!left) return right ? 1 : 0;
  if (!right) return -1;
  return left.getTime() - right.getTime();
}
// Buckets ----------------------------------------------------------------------------------------

/** One bucket of a range: the `key` consumers group by, and the `start` and `end` days it covers. */
export interface DateBucket {
  readonly key: string;
  readonly start: IsoDateString;
  readonly end: IsoDateString;
}
/** The grouping key of the bucket `iso` falls in at `granularity`: `2025-01-30` by day, `2025-W05` by
 * ISO week — the week-numbering year first, so a key is unambiguous around New Year — and `2025-01` by
 * month. Analytics and the reports group by these strings, so no other module derives one; `""` if bad. */
export function bucketKey(iso: IsoDateString, granularity: BucketGranularity): string {
  const date = parseIso(iso);
  if (!date) return "";
  switch (granularity) {
    case "day":
      return isoOf(date);
    case "week": {
      const { year, week } = isoWeekParts(date);
      return `${year}-W${pad2(week)}`;
    }
    case "month":
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }
}
/** The first day of the bucket `key` names at `granularity`, so a row grouped by a key can state its
 * period; `""` when the key has none of the three forms or names no such week or month. */
export function bucketStart(key: string, granularity: BucketGranularity): IsoDateString {
  switch (granularity) {
    case "day":
      return isValidIso(key) ? startOfDay(key) : "";
    case "week": {
      const match = WEEK_KEY_PATTERN.exec(key);
      if (!match) return "";
      const week = Number(match[2]);
      return week < 1 || week > 53
        ? ""
        : addDays(isoOf(weekOneMonday(Number(match[1]))), (week - 1) * 7);
    }
    case "month": {
      const match = MONTH_KEY_PATTERN.exec(key);
      if (!match) return "";
      const month = Number(match[2]);
      return month < 1 || month > 12 ? "" : `${match[1]}-${pad2(month)}-01`;
    }
  }
}
/** The last day of the bucket `key` names: its own day by day, Sunday by week, month end by month. */
export function bucketEnd(key: string, granularity: BucketGranularity): IsoDateString {
  const start = bucketStart(key, granularity);
  if (!start) return "";
  switch (granularity) {
    case "day":
      return start;
    case "week":
      return addDays(start, 6);
    case "month":
      return endOfMonth(start);
  }
}
/** Every bucket the `range` touches at `granularity`, each with its key and the days it covers. Bounded by
 * the widest range the product accepts ({@link MAX_REPORT_RANGE_DAYS}), so it cannot loop without end. */
export function eachBucket(
  range: DateRange,
  granularity: BucketGranularity,
): readonly DateBucket[] {
  const from = parseIso(range.from);
  const to = parseIso(range.to);
  if (!from || !to) return [];
  const lastDay = startOfLocalDay(to).getTime();
  const buckets: DateBucket[] = [];
  let cursor = granularity === "week" ? startOfWeekDate(from) : startOfLocalDay(from);
  for (let left = MAX_BUCKETS[granularity]; left > 0 && cursor.getTime() <= lastDay; left -= 1) {
    buckets.push(bucketSpan(cursor, granularity));
    cursor = nextBucketDay(cursor, granularity);
  }
  return buckets;
}
/** How many buckets the `range` touches at `granularity`, counted by calendar arithmetic rather than by
 * building them; `0` when an end cannot be parsed. */
export function bucketCount(range: DateRange, granularity: BucketGranularity): number {
  const from = parseIso(range.from);
  const to = parseIso(range.to);
  if (!from || !to) return 0;
  switch (granularity) {
    case "day":
      return daysInRange(range);
    case "week":
      return Math.floor(daysBetweenDates(startOfWeekDate(from), startOfWeekDate(to)) / 7) + 1;
    case "month":
      return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
  }
}

// Ranges and comparison periods ------------------------------------------------------------------

/** The range the dashboard and the reports open on: the trailing {@link DEFAULT_REPORT_RANGE_DAYS} days
 * ending on `now`'s day, both ends included. */
export function defaultReportRange(now: Date = new Date()): DateRange {
  const to = toIsoDate(now);
  return { from: addDays(to, -(DEFAULT_REPORT_RANGE_DAYS - 1)), to };
}
/** The widest range the product accepts: the trailing {@link MAX_REPORT_RANGE_DAYS} days ending today. */
export function maxReportRange(now: Date = new Date()): DateRange {
  const to = toIsoDate(now);
  return { from: addDays(to, -(MAX_REPORT_RANGE_DAYS - 1)), to };
}
/** The comparison period before `range`: the same number of days ending the day before it starts, so the
 * two neither gap nor overlap; an unmeasurable range is returned unchanged, never inverted. */
export function previousPeriodRange(range: DateRange): DateRange {
  const days = daysInRange(range);
  if (days === 0) return range;
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}
/** The same `range` one calendar year earlier. A leap day clamps to Feb 28 in a common year, so that
 * period can be a day shorter: what a calendar shift does. */
export function previousYearRange(range: DateRange): DateRange {
  return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
}
/** The comparison range `kind` names for `range`: `previous-period` the equal-length one before,
 * `previous-year` the same calendar range a year back. */
export function resolveBaselineRange(range: DateRange, kind: BaselineKind): DateRange {
  switch (kind) {
    case "previous-period":
      return previousPeriodRange(range);
    case "previous-year":
      return previousYearRange(range);
  }
}
/** The key a preset is identified by; a trailing preset names how many days it reaches back. */
export type ReportRangePresetKey = `last-${number}-days` | "this-month" | "this-year";
/** One preset of the range control: its key, the range it resolves to and the days it covers. */
export interface ReportRangePreset {
  readonly key: ReportRangePresetKey;
  readonly range: DateRange;
  readonly days: number;
}
/** The trailing presets, whose middle entry reaches back the configured default, not 30 typed again. */
const TRAILING_PRESET_DAYS = [7, DEFAULT_REPORT_RANGE_DAYS, 90] as const;
/** The presets the range control offers, computed against `now`: the trailing 7,
 * {@link DEFAULT_REPORT_RANGE_DAYS} and 90 days, the month to date and the year to date. Only data is
 * returned, because the wording belongs to the copy module. */
export function reportRangePresets(now: Date = new Date()): readonly ReportRangePreset[] {
  const today = toIsoDate(now);
  const trailing = TRAILING_PRESET_DAYS.map(
    (days): ReportRangePreset => ({
      key: `last-${days}-days`,
      range: { from: addDays(today, -(days - 1)), to: today },
      days,
    }),
  );
  const month: DateRange = { from: startOfMonth(today), to: today };
  const year: DateRange = { from: `${today.slice(0, 4)}-01-01`, to: today };
  return [
    ...trailing,
    { key: "this-month", range: month, days: daysInRange(month) },
    { key: "this-year", range: year, days: daysInRange(year) },
  ];
}

// Validation -------------------------------------------------------------------------------------

/** The field a range problem attaches to: one of the two ends, or the range as a whole. */
export type DateRangeErrorField = "from" | "to" | "range";
/** The rule a range broke; each maps to one sentence of the copy module the caller renders. */
export type DateRangeErrorCode =
  | "date-invalid"
  | "range-inverted"
  | "range-in-future"
  | "range-too-long";
/** One broken rule: the field that carries it and the rule it is. */
export interface DateRangeProblem {
  readonly field: DateRangeErrorField;
  readonly code: DateRangeErrorCode;
}
/** The outcome of validating a range: whether it is usable, what it broke, and the inclusive day count,
 * `0` when the ends cannot be measured. */
export interface DateRangeValidation {
  readonly valid: boolean;
  readonly days: number;
  readonly problems: readonly DateRangeProblem[];
}
/** Validates `from`–`to` against the rules every dated query holds: both ends are real dates, `from` is not
 * after `to`, neither end is after `now`'s day, and the span is at most {@link MAX_REPORT_RANGE_DAYS} days —
 * exactly the cap is accepted. The rules live here alone and a broken rule's wording belongs to the copy
 * module, so this returns codes for `toFieldErrors`. */
export function validateDateRange(
  from: IsoDateString,
  to: IsoDateString,
  now: Date = new Date(),
): DateRangeValidation {
  const problems: DateRangeProblem[] = [];
  const start = parseIso(from);
  const end = parseIso(to);
  if (!start) problems.push({ field: "from", code: "date-invalid" });
  if (!end) problems.push({ field: "to", code: "date-invalid" });
  if (!start || !end) return { valid: false, days: 0, problems };
  if (compareIso(from, to) > 0) {
    problems.push({ field: "range", code: "range-inverted" });
    return { valid: false, days: 0, problems };
  }
  const days = daysInRange({ from, to });
  const today = startOfLocalDay(now).getTime();
  if (startOfLocalDay(start).getTime() > today) {
    problems.push({ field: "from", code: "range-in-future" });
  }
  if (startOfLocalDay(end).getTime() > today) {
    problems.push({ field: "to", code: "range-in-future" });
  }
  if (days > MAX_REPORT_RANGE_DAYS) problems.push({ field: "range", code: "range-too-long" });
  return { valid: problems.length === 0, days, problems };
}
/** Whether `range` reaches past `now`'s day, which no dated query accepts; `false` when an end cannot be
 * parsed, which {@link validateDateRange} reports. */
export function hasFutureDate(range: DateRange, now: Date = new Date()): boolean {
  if (!isValidIso(range.from) || !isValidIso(range.to)) return false;
  const today = toIsoDate(now);
  return compareIso(range.from, today) > 0 || compareIso(range.to, today) > 0;
}
/** Whether `range` covers more days than the product accepts, so a control can disable a preset it would
 * have to reject; `false` for an unparsable or inverted range, which the validator reports. */
export function exceedsMaxRange(range: DateRange): boolean {
  return daysInRange(range) > MAX_REPORT_RANGE_DAYS;
}
/** Resolves the `validation` into the field-keyed error map a form renders, taking its wording from the
 * caller's `messages`; the first problem on a field wins, since that is the first to correct. */
export function toFieldErrors(
  validation: DateRangeValidation,
  messages: Readonly<Record<DateRangeErrorCode, string>>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const problem of validation.problems) {
    if (!(problem.field in errors)) errors[problem.field] = messages[problem.code];
  }
  return errors;
}
