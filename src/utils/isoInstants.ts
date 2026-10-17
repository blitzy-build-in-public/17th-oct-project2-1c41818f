/**
 * Path: src/utils/isoInstants.ts
 * Purpose: Parses ISO 8601 text into local instants and resolves a range into the bounds a scan compares.
 * Lines: 102
 */

import type { DateRange, IsoDateString } from "@/types/common";

/**
 * The instant level of the date foundation: what an ISO text names, and whether an instant falls inside a
 * range. **Local time:** an ISO text carrying no offset names a local instant, so `"2025-01-30"` is local
 * midnight on the 30th and never slides back a day west of UTC. **A range resolved once:** a range's two
 * bounds are parsed into the instants a comparison needs when the comparison starts, because a scan over
 * a whole collection would otherwise re-parse the same two ends for every record it reads.
 */

/** The two ISO 8601 forms this module reads: a calendar date, and a local date-time whose captures
 * after it are the hour, minute, second and milliseconds. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
/** An explicit `Z` or `±hh:mm` suffix, which marks a value as an instant rather than as local time. */
const OFFSET_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** Whether `value` is exactly a calendar date rather than a date-time, a time or a half-typed one: the
 * check that keeps an `<input type="date">` value from accepting a form it can never render. */
export function isIsoDateText(value: string): boolean {
  return DATE_PATTERN.test(value);
}

/** The instant an ISO date or local date-time names, or `null` when the text names neither. The round
 * trip proves validity — what the construction kept must match what the text asked for — so
 * `2025-02-30`, Feb 29 in a common year and any out-of-range time are rejected, not rolled over. The
 * fields are set from `new Date(0)` rather than handed to the constructor, which maps a year of `0`–`99`
 * into `1901`–`1999` and so could never keep a year below 100. */
function parseLocalIso(value: string): Date | null {
  const match = DATE_PATTERN.exec(value) ?? DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const millis = match[7] ? Number(match[7].padEnd(3, "0")) : 0;
  const date = new Date(0);
  date.setFullYear(+year, +month - 1, +day);
  date.setHours(+hour, +minute, +second, millis);
  const kept =
    date.getFullYear() === +year &&
    date.getMonth() === +month - 1 &&
    date.getDate() === +day &&
    date.getHours() === +hour &&
    date.getMinutes() === +minute &&
    date.getSeconds() === +second;
  return kept ? date : null;
}

/** Parses the ISO `value` as local time unless it carries an offset or `Z`; `null` when the text is
 * not ISO 8601 or names no real day, and never throwing, so a caller branches on `null`. */
export function parseIso(value: string): Date | null {
  const local = parseLocalIso(value);
  if (local) return local;
  if (!OFFSET_SUFFIX_PATTERN.test(value)) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Local midnight of the day an instant falls on: the anchor every range end is normalised to. */
export const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
/** An instant moved by whole local days, across month, year and daylight-saving boundaries. */
export const addDaysToDate = (date: Date, amount: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);

// A range resolved once ---------------------------------------------------------------------------

/** The loop-invariant half of a range: both of its ends resolved to instants, so a scan that reads a
 * whole collection compares the numbers it already has instead of parsing the range for every record. */
export interface PreparedRange {
  readonly startTime: number;
  readonly endTime: number;
}

/** Resolves both ends of `range` once: local midnight of its first day and the midnight that opens the
 * day after its last, which are the two instants {@link isWithinPreparedRange} compares against.
 * `null` when either end names no day, which is what makes every comparison against it `false`. */
export function prepareRange(range: DateRange): PreparedRange | null {
  const start = parseIso(range.from);
  const end = parseIso(range.to);
  if (!start || !end) return null;
  return {
    startTime: startOfLocalDay(start).getTime(),
    endTime: addDaysToDate(end, 1).getTime(),
  };
}

/** Whether the ISO `iso` falls inside the range `prepared` resolved: the day its range opens on is
 * included and the day after its last is not. `false` when the value names no day or the range has
 * none, so an unreadable range matches nothing rather than everything. */
export function isWithinPreparedRange(iso: IsoDateString, prepared: PreparedRange | null): boolean {
  if (prepared === null) return false;
  const date = parseIso(iso);
  if (!date) return false;
  const time = date.getTime();
  return time >= prepared.startTime && time < prepared.endTime;
}
