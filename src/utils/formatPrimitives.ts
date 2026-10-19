/**
 * Path: src/utils/formatPrimitives.ts
 * Purpose: The locale, the formatter cache and the figure primitives every formatter in src/utils/format.ts is built from
 * Lines: 112
 */

import type { ReportCellValue } from "@/types/analytics";

/**
 * Why this file exists beside `src/utils/format.ts`: that module's formatting surface is one concern, and one
 * file may not exceed 600 lines, so the concern is split along its own seam — the primitives half here, the
 * display half in the module named — rather than the ceiling raised. This half owns the machinery every formatter
 * in the other half is written with — the one locale, the `Intl.NumberFormat` cache, the coercions a figure is
 * read through, and the machine-readable writers a CSV cell and a form field take their text from — while
 * `src/utils/format.ts` owns the display formatters a surface shows. Nothing here imports that module, so the
 * dependency runs one way, and the three members a consumer reaches by name through `format.ts` — the two
 * sentinels and {@link DisplayNumber} — are re-exported there, so every existing import path still resolves them.
 */

// Configuration -----------------------------------------------------------------------------------

/** The one locale numbers render in; the date family reads this same declaration, so the product's single
 *  language and currency cannot drift between the two formatting families. */
export const LOCALE = "en-US";

/** The most fraction digits `Intl.NumberFormat` accepts, which bounds every digits argument below. */
const MAX_FRACTION_DIGITS = 20;

/** What a cell with nothing to show renders: empty, so an absent value never reads as a zero. */
export const EMPTY_CELL_TEXT = "";

/** What a figure that is not a finite number renders: a dash, never "NaN", "Infinity" or "-0". */
export const EMPTY_VALUE_PLACEHOLDER = "—";

/** A figure a display formatter accepts, or `null`/`undefined` from a record not fully loaded. */
export type DisplayNumber = number | null | undefined;

// The formatter cache -----------------------------------------------------------------------------

/** The `Intl.NumberFormat` instances, one per option set: a table of a hundred cells must reuse them
 *  rather than build one per cell, which is measurable. */
const FORMATTERS = new Map<string, Intl.NumberFormat>();

/** The `en-US` formatter for one option set, built on first use and reused thereafter. */
export function formatter(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cached = FORMATTERS.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, options);
  FORMATTERS.set(key, created);
  return created;
}

// Figure primitives -------------------------------------------------------------------------------

/** The finite amount behind `value`, or `null` when there is no figure to render; a zero keeps one sign,
 *  so no formatter can print `-0`. */
export function amountOf(value: DisplayNumber): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}

/** The whole non-negative count behind `value`: a quantity, a stock level, a rank and a review count are
 *  integer counts, and an absent or broken figure reads as zero. */
export function wholeCountOf(value: DisplayNumber): number {
  const amount = amountOf(value);
  return amount === null ? 0 : Math.max(0, Math.trunc(amount));
}

/** The digits argument of a formatter, confined to the range `Intl.NumberFormat` accepts. */
export function fractionDigitsOf(digits: number, fallback: number): number {
  return Number.isFinite(digits)
    ? Math.min(MAX_FRACTION_DIGITS, Math.max(0, Math.trunc(digits)))
    : fallback;
}

/** A cell's text as it stands: text is itself, a number its plain digits, an absent cell empty. */
export function textOf(value: ReportCellValue | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL_TEXT;
  return typeof value === "string" ? value : String(value);
}

/** A machine-readable figure with exactly `digits` fraction digits, no grouping and no symbol: the form
 *  a money field and a CSV money cell need, and empty when there is no figure. */
export function fixedText(value: DisplayNumber, digits: number): string {
  const amount = amountOf(value);
  if (amount === null) return EMPTY_CELL_TEXT;
  return formatter(`fixed:${digits}`, {
    useGrouping: false,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** A machine-readable figure trimmed to at most `digits` fraction digits, ungrouped and unsigned: the
 *  form a CSV integer, percent or count cell needs. */
export function plainText(value: DisplayNumber, digits: number): string {
  const amount = amountOf(value);
  if (amount === null) return EMPTY_CELL_TEXT;
  return formatter(`plain:${digits}`, {
    useGrouping: false,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** A signed figure for a change or a point difference: `+5.0`, `-2.5` and `0.0` for no change. */
export function signedText(value: number, digits: number): string {
  return formatter(`signed:${digits}`, {
    signDisplay: "exceptZero",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
