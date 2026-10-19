/**
 * Path: src/utils/dateDisplay.ts
 * Purpose: The locale, the formatter cache and the day, month and relative-time formatters a date is shown through
 * Lines: 103
 */

import type { IsoDateString, IsoDateTimeString } from "@/types/common";
import { LOCALE } from "@/utils/formatPrimitives";
import { parseIso } from "@/utils/isoInstants";

/**
 * Why this file exists beside `src/utils/dates.ts`: that module's display surface is one concern, and one file
 * may not exceed 600 lines, so the concern is split along its own seam — the display half here, the arithmetic
 * and wording half in the module named — rather than the ceiling raised. This half owns the machinery a date
 * shown on a surface is written with — the one locale, the `Intl.DateTimeFormat` cache, the relative-time
 * formatters and the day, month and calendar formatters — while `src/utils/dates.ts` owns the wording that
 * resolves a bucket against a range, the range arithmetic, the buckets and the validator. Nothing here imports
 * that module, so the dependency runs one way, and every name a consumer reaches through it is re-exported from
 * `src/utils/dates.ts`, so no consumer's import path changes.
 */

// The locale and the formatter cache ------------------------------------------------------------------

/** The locale is declared once, in `src/utils/formatPrimitives.ts`, imported here so the figure and date
 *  families cannot drift apart, and re-exported so this path still resolves it. */
export { LOCALE };

/** How much of a date {@link formatDate} spells out. */
export type DateDisplayStyle = "short" | "medium" | "long";
/** The option sets the formatters are built from: one per style, the date and time a timestamp shows,
 *  and the partial forms a range label and a chart axis use. */
const DATE_OPTIONS: Readonly<Record<DateDisplayStyle, Intl.DateTimeFormatOptions>> = {
  short: { month: "numeric", day: "numeric", year: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  long: { month: "long", day: "numeric", year: "numeric" },
};
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
/** The day-and-month style a range label and a chart axis are written in; `src/utils/dates.ts` builds its
 * range and bucket wording with this set through {@link formatter}. */
export const MONTH_DAY_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const MONTH_YEAR_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
/** The year alone, as the range label above writes it once for a span that shares one. */
export const YEAR_OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric" };
/** The `en-US` formatters, built once per option set and reused; the relative pair says "yesterday"
 * for a day and "5 minutes ago" for a count. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const RELATIVE_AUTO = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const RELATIVE_COUNTING = new Intl.RelativeTimeFormat(LOCALE, { numeric: "always" });
/** Unit sizes {@link formatRelativeTime} chooses between: a month counts as 30 days, a year as 365. */
const SECONDS = {
  MINUTE: 60,
  HOUR: 3_600,
  DAY: 86_400,
  WEEK: 604_800,
  MONTH: 2_592_000,
  YEAR: 31_536_000,
} as const;

/** An `en-US` formatter for one option set, taken from the cache once it has been built: the one home of
 * the cache, which `src/utils/dates.ts` reaches for the styles it words a range and a bucket in. */
export function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(LOCALE, options);
  FORMATTERS.set(key, created);
  return created;
}

// The formatters a surface shows a date through -------------------------------------------------------

/** Formats the ISO `iso` as `1/30/2025` for the `short` style, `Jan 30, 2025` for `medium`, the
 * default, or `January 30, 2025` for `long`; `""` when unparsable, never "Invalid Date". */
export function formatDate(iso: IsoDateString, style: DateDisplayStyle = "medium"): string {
  const date = parseIso(iso);
  return date ? formatter(style, DATE_OPTIONS[style]).format(date) : "";
}
/** Formats the ISO `iso` with its local time, e.g. `Jan 30, 2025, 2:45 PM`, where the minute matters. */
export function formatDateTime(iso: IsoDateTimeString): string {
  const date = parseIso(iso);
  return date ? formatter("date-time", DATE_TIME_OPTIONS).format(date) : "";
}
/** Formats the month and year of the ISO `iso`, e.g. `Jan 2025`, the monthly bucket label; `""` if bad. */
export function formatYearMonth(iso: IsoDateString): string {
  const date = parseIso(iso);
  return date ? formatter("month-year", MONTH_YEAR_OPTIONS).format(date) : "";
}
/** Describes how long ago the ISO `iso` was relative to `now` — `2 days ago`, `yesterday` — or how far
 * ahead it is; `""` if unparsable. A month counts as 30 days and a year as 365, so it is approximate. */
export function formatRelativeTime(iso: IsoDateTimeString, now: Date = new Date()): string {
  const date = parseIso(iso);
  if (!date) return "";
  const elapsed = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(elapsed);
  const count = (unit: number): number => Math.round(elapsed / unit);
  if (magnitude < 45) return RELATIVE_AUTO.format(0, "second");
  if (magnitude < 45 * SECONDS.MINUTE)
    return RELATIVE_COUNTING.format(count(SECONDS.MINUTE), "minute");
  if (magnitude < 22 * SECONDS.HOUR) return RELATIVE_COUNTING.format(count(SECONDS.HOUR), "hour");
  if (magnitude < 7 * SECONDS.DAY) return RELATIVE_AUTO.format(count(SECONDS.DAY), "day");
  if (magnitude < 5 * SECONDS.WEEK) return RELATIVE_AUTO.format(count(SECONDS.WEEK), "week");
  if (magnitude < SECONDS.YEAR) return RELATIVE_AUTO.format(count(SECONDS.MONTH), "month");
  return RELATIVE_AUTO.format(count(SECONDS.YEAR), "year");
}
