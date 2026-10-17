/**
 * Path: src/utils/format.ts
 * Purpose: Formats money, numbers, percentages and compact values for display across every module
 * Lines: 599
 */

import { DEFAULT_CURRENCY } from "@/constants/config";
import type { ReportCellFormat, ReportCellValue } from "@/types/analytics";
import type { CurrencyCode, MinorUnits } from "@/types/common";
import { formatDate } from "@/utils/dates";

/**
 * The boundary this module owns: every figure a surface shows is rendered here, and money only here — a
 * consumer passes integer minor units and never divides by 100 itself. Dates belong to
 * `src/utils/dates.ts` (a `date` cell is dispatched to its `formatDate`), text helpers to
 * `src/utils/strings.ts`, CSV escaping to `src/utils/csv.ts`, and every sentence to
 * `src/constants/content.ts`, which receives a formatted number rather than assembling one.
 * {@link EMPTY_CELL_TEXT} marks an absent value and renders empty, so absence never reads as a zero;
 * {@link EMPTY_VALUE_PLACEHOLDER} marks a figure that is not finite and renders a dash, never "NaN",
 * "Infinity" or a signed zero. Every function below is pure, total and free of hidden state.
 */

/** The one locale numbers render in; the product ships one language and one currency. */
const LOCALE = "en-US";
/** The most fraction digits `Intl.NumberFormat` accepts, which bounds every digits argument below. */
const MAX_FRACTION_DIGITS = 20;
/** The default fraction digits of a plain number: enough for a rate, a share and an average. */
const DEFAULT_FRACTION_DIGITS = 3;
/** The fraction digits money carries: the minor unit of the currency, always two. */
const MONEY_FRACTION_DIGITS = 2;
/** Below this major amount compact money keeps its cents instead of shortening `$12.34` to `$12.3`. */
const COMPACT_MONEY_MINIMUM_MAJOR = 1_000;
/** How many minor units make one major unit: the single place the factor is written. */
const MINOR_UNITS_PER_MAJOR = 100;

/** What a cell with nothing to show renders: empty, so an absent value never reads as a zero. */
export const EMPTY_CELL_TEXT = "";
/** What a figure that is not a finite number renders: a dash, never "NaN", "Infinity" or "-0". */
export const EMPTY_VALUE_PLACEHOLDER = "—";

/** A figure a display formatter accepts, or `null`/`undefined` from a record not fully loaded. */
export type DisplayNumber = number | null | undefined;

/** How `formatNumber` shapes a figure: `digits` bounds the fraction digits (default 3), `grouping` adds
 *  thousands separators (default true) and `fixed` pads to exactly `digits` rather than trimming to it. */
export interface NumberDisplayOptions {
  readonly digits?: number;
  readonly grouping?: boolean;
  readonly fixed?: boolean;
}

/** Which way a change moved, as a KPI card styles it, or `unknown` when a figure it needs is absent. */
export type ChangeDirection = "up" | "down" | "flat" | "unknown";

/** A period-over-period change, ready for a KPI card: the figures compared, their difference, the signed
 *  percentage and the signed text. `changePercent` is `null` when the baseline is zero, because the
 *  ratio is then undefined rather than infinite; `direction` still reports which way the figures moved. */
export interface PercentChangeDisplay {
  readonly current: number;
  readonly previous: number;
  readonly difference: number;
  readonly changePercent: number | null;
  readonly direction: ChangeDirection;
  readonly text: string;
}

/** A rating as its parts: the average, `value` carrying its decimal, the review count and whether the
 *  product has been reviewed at all. The sentence those parts form is copy from
 *  `src/constants/content.ts`, so this module reports figures and never writes the wording. */
export interface RatingDisplay {
  readonly average: number;
  readonly value: string;
  readonly count: number;
  readonly hasReviews: boolean;
}

/** The three availability levels the storefront distinguishes: the literals `InventoryStatus` declares
 *  in `src/types/catalog.ts`, so a caller may pass this status to either. */
export type AvailabilityLevel = "in-stock" | "low-stock" | "out-of-stock";

/** A stock pair turned into the level a badge styles, with the rule applied in one place: nothing on
 *  hand is `out-of-stock`, stock at or below the low-stock threshold is `low-stock` and anything above
 *  it is `in-stock`; only a positive count is purchasable. The figures travel with the level, so no
 *  caller compares a threshold itself. */
export interface AvailabilityDisplay {
  readonly status: AvailabilityLevel;
  readonly available: boolean;
  readonly stockOnHand: number;
  readonly lowStockThreshold: number;
}

/** The `Intl.NumberFormat` instances, one per option set: a table of a hundred cells must reuse them
 *  rather than build one per cell, which is measurable. */
const FORMATTERS = new Map<string, Intl.NumberFormat>();

/** The `en-US` formatter for one option set, built on first use and reused thereafter. */
function formatter(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cached = FORMATTERS.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, options);
  FORMATTERS.set(key, created);
  return created;
}

/** Plural selection for counts, and the ordinal selection {@link formatOrdinal} reads. */
const COUNT_PLURALS = new Intl.PluralRules(LOCALE);
const ORDINAL_PLURALS = new Intl.PluralRules(LOCALE, { type: "ordinal" });
/** The ordinal suffix each `en-US` plural category takes. */
const ORDINAL_SUFFIXES: Readonly<Record<Intl.LDMLPluralRule, string>> = {
  zero: "th",
  one: "st",
  two: "nd",
  few: "rd",
  many: "th",
  other: "th",
};

/** The finite amount behind `value`, or `null` when there is no figure to render; a zero keeps one sign,
 *  so no formatter below can print `-0`. */
function amountOf(value: DisplayNumber): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}

/** The whole non-negative count behind `value`: a quantity, a stock level, a rank and a review count are
 *  integer counts, and an absent or broken figure reads as zero. */
function wholeCountOf(value: DisplayNumber): number {
  const amount = amountOf(value);
  return amount === null ? 0 : Math.max(0, Math.trunc(amount));
}

/** The digits argument of a formatter, confined to the range `Intl.NumberFormat` accepts. */
function fractionDigitsOf(digits: number, fallback: number): number {
  return Number.isFinite(digits)
    ? Math.min(MAX_FRACTION_DIGITS, Math.max(0, Math.trunc(digits)))
    : fallback;
}

/** A cell's text as it stands: text is itself, a number its plain digits, an absent cell empty. */
function textOf(value: ReportCellValue | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL_TEXT;
  return typeof value === "string" ? value : String(value);
}

/** A machine-readable figure with exactly `digits` fraction digits, no grouping and no symbol: the form
 *  a money field and a CSV money cell need, and empty when there is no figure. */
function fixedText(value: DisplayNumber, digits: number): string {
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
function plainText(value: DisplayNumber, digits: number): string {
  const amount = amountOf(value);
  if (amount === null) return EMPTY_CELL_TEXT;
  return formatter(`plain:${digits}`, {
    useGrouping: false,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** A signed figure for a change or a point difference: `+5.0`, `-2.5` and `0.0` for no change. */
function signedText(value: number, digits: number): string {
  return formatter(`signed:${digits}`, {
    signDisplay: "exceptZero",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** The direction a difference reports: growth, decline, or no change. */
function directionOf(difference: number): ChangeDirection {
  if (difference === 0) return "flat";
  return difference > 0 ? "up" : "down";
}

/** Builds a change display from the figures and the direction it is given, so each branch of
 *  {@link formatPercentChange} states only what it decides. A `null` change renders the placeholder. */
function changeDisplay(
  current: number,
  previous: number,
  direction: ChangeDirection,
  changePercent: number | null,
  places: number,
): PercentChangeDisplay {
  return {
    current,
    previous,
    difference: current - previous,
    changePercent,
    direction,
    text: changePercent === null ? EMPTY_VALUE_PLACEHOLDER : `${signedText(changePercent, places)}%`,
  };
}

/** Narrows a union exhaustively: a member left unhandled fails to compile where this is called. It is
 *  unreachable at runtime and returns the empty cell text rather than throwing if it is ever reached. */
function assertExhaustive(_format: never): string {
  return EMPTY_CELL_TEXT;
}

// Rounding and conversion ------------------------------------------------------------------------

/**
 * The single rounding rule for minor units, and the only place a computed figure becomes money: round
 * half away from zero, so `12.5` is `13` and `-12.5` is `-13`. Everything that produces a `MinorUnits`
 * — a tax amount, a discount, a share of a cart, a parsed form value — passes through here instead of
 * calling `Math.round`, so no two totals round differently. A figure that is not a finite number
 * settles on `0`, and `-0` normalises to `0`.
 */
export function roundMinorUnits(value: number): MinorUnits {
  const amount = amountOf(value);
  if (amount === null) return 0;
  const magnitude = Math.round(Math.abs(amount));
  if (magnitude === 0) return 0;
  return amount < 0 ? -magnitude : magnitude;
}

/** The minor units of a major amount — `12.99` becomes `1299` — through the rounding rule above. */
export function toMinorUnits(amount: number): MinorUnits {
  const value = amountOf(amount);
  return value === null ? 0 : roundMinorUnits(value * MINOR_UNITS_PER_MAJOR);
}

/** The major amount of a minor value — `1299` becomes `12.99` — for a calculation needing the decimal
 *  form; a figure that is not finite reads as `0`. */
export function fromMinorUnits(minor: MinorUnits): number {
  const value = amountOf(minor);
  return value === null ? 0 : value / MINOR_UNITS_PER_MAJOR;
}

// Money ------------------------------------------------------------------------------------------

/**
 * Formats integer minor units as money — `129900` becomes `"$1,299.00"` — with the currency's symbol,
 * `en-US` grouping and its two fraction digits. `currency` defaults to the product's single currency
 * and changes only the symbol the platform prints. An absent or non-finite figure renders {@link
 * EMPTY_VALUE_PLACEHOLDER}, never `"$NaN"`.
 */
export function formatMoney(
  minor: DisplayNumber,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const amount = amountOf(minor);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  return formatter(`money:${currency}`, { style: "currency", currency }).format(
    amount / MINOR_UNITS_PER_MAJOR,
  );
}

/** Formats minor units in the shortened form a chart axis, a KPI card and a `compact-number` cell need:
 *  `129900` becomes `"$1.3K"`. Below a thousand major units the cents are kept — `1234` becomes
 *  `"$12.34"` — because shortening a cart total to `"$12.3"` loses more than it gains. */
export function formatMoneyCompact(
  minor: DisplayNumber,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const amount = amountOf(minor);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  const major = amount / MINOR_UNITS_PER_MAJOR;
  if (Math.abs(major) < COMPACT_MONEY_MINIMUM_MAJOR) return formatMoney(amount, currency);
  return formatter(`money-compact:${currency}`, {
    style: "currency",
    currency,
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(major);
}

/** Writes minor units the way a form field holds them — `129900` becomes `"1299.00"` — with no symbol
 *  and no grouping, so the value can also go into a numeric input, and empty when there is nothing to
 *  hold. {@link parseMoneyToMinor} reads this form and a human-typed one back, so a field round-trips. */
export function formatMinorAsInput(minor: DisplayNumber): string {
  const amount = amountOf(minor);
  if (amount === null) return EMPTY_CELL_TEXT;
  return fixedText(amount / MINOR_UNITS_PER_MAJOR, MONEY_FRACTION_DIGITS);
}

/**
 * Reads a money amount a person typed or a field held and returns its minor units through {@link
 * roundMinorUnits}: `"$1,299.50"`, `"1299.5"`, `"1.299,50"` and the number `1299.5` all become `129950`.
 * A leading minus sign marks a negative, a single comma is read as a thousands separator and a single
 * point as the decimal point, while a value carrying both takes the last separator as the decimal one.
 * Text holding no digit returns `0`, so a form rejects an unusable value through
 * `src/utils/validation.ts` rather than relying on this conversion to do it.
 */
export function parseMoneyToMinor(input: string | number | null | undefined): MinorUnits {
  if (typeof input === "number") return toMinorUnits(input);
  if (input === null || input === undefined) return 0;
  const text = input.trim();
  const digitsOnly = text.replace(/[^0-9.,]/g, "");
  if (!/[0-9]/.test(digitsOnly)) return 0;
  const lastPoint = digitsOnly.lastIndexOf(".");
  const lastComma = digitsOnly.lastIndexOf(",");
  const decimalAt = lastPoint >= 0 && lastComma >= 0 ? Math.max(lastPoint, lastComma) : lastPoint;
  const major =
    decimalAt < 0
      ? Number.parseFloat(stripSeparators(digitsOnly))
      : Number.parseFloat(
          `${stripSeparators(digitsOnly.slice(0, decimalAt)) || "0"}.${
            stripSeparators(digitsOnly.slice(decimalAt + 1)) || "0"
          }`,
        );
  if (!Number.isFinite(major)) return 0;
  const magnitude = toMinorUnits(major);
  return text.startsWith("-") ? -magnitude : magnitude;
}

/** Drops every thousands separator from a run of digits, leaving the digits behind. */
function stripSeparators(text: string): string {
  return text.replace(/[.,]/g, "");
}

/** Formats what is still owed before shipping is free, which is what the cart's progress label reads,
 *  keeping a negative remainder at `"$0.00"` and an absent figure at {@link EMPTY_VALUE_PLACEHOLDER}.
 *  The amount is computed by `src/lib/pricingService.ts` against the configured threshold: this module
 *  holds no threshold and applies no pricing rule, and the sentence around the figure is copy from
 *  `src/constants/content.ts`. */
export function formatFreeShippingRemaining(
  remainingMinor: DisplayNumber,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const amount = amountOf(remainingMinor);
  return amount === null ? EMPTY_VALUE_PLACEHOLDER : formatMoney(Math.max(0, amount), currency);
}

// Numbers ----------------------------------------------------------------------------------------

/** Formats a figure with `en-US` grouping — `1234.5` becomes `"1,234.5"` — taking its fraction digits
 *  from `options`; a non-finite figure renders {@link EMPTY_VALUE_PLACEHOLDER}. The default of three
 *  digits keeps a rate, a share and an average legible without padding them out. */
export function formatNumber(value: DisplayNumber, options: NumberDisplayOptions = {}): string {
  const amount = amountOf(value);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  const digits = fractionDigitsOf(options.digits ?? DEFAULT_FRACTION_DIGITS, DEFAULT_FRACTION_DIGITS);
  const grouping = options.grouping ?? true;
  const fixed = options.fixed ?? false;
  return formatter(`number:${digits}:${grouping}:${fixed}`, {
    useGrouping: grouping,
    minimumFractionDigits: fixed ? digits : 0,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Formats a whole count with grouping — `1284` becomes `"1,284"` — which is what a badge, a table row
 *  and a heading show; a non-finite figure renders {@link EMPTY_VALUE_PLACEHOLDER}. */
export function formatInteger(value: DisplayNumber): string {
  const amount = amountOf(value);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  return formatter("integer", { useGrouping: true, maximumFractionDigits: 0 }).format(amount);
}

/** Formats a figure in the shortened form a chart axis and a `compact-number` cell use — `1299` becomes
 *  `"1.3K"`, `1234567` becomes `"1.2M"` — while a non-finite figure renders {@link
 *  EMPTY_VALUE_PLACEHOLDER}. Money shortens through {@link formatMoneyCompact} instead. */
export function formatCompactNumber(value: DisplayNumber): string {
  const amount = amountOf(value);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  return formatter("compact", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(amount);
}

/** Formats a quantity as the plain whole number a stepper shows: no grouping and no fraction digits,
 *  with a negative or absent figure at `"0"`, because a quantity is never negative. */
export function formatQuantity(value: DisplayNumber): string {
  return String(wholeCountOf(value));
}

/** Formats a 1-based position as its ordinal — `1` becomes `"1st"`, `22` becomes `"22nd"` — for the
 *  rank a top-products or product-performance table shows; an absent figure reads as `"0th"`. */
export function formatOrdinal(value: DisplayNumber): string {
  const count = wholeCountOf(value);
  return `${formatInteger(count)}${ORDINAL_SUFFIXES[ORDINAL_PLURALS.select(count)]}`;
}

// Percentages and change -------------------------------------------------------------------------

/** Formats a ratio as a percentage — `0.125` becomes `"12.5%"` — and the convention is fixed: **the
 *  argument is a ratio between 0 and 1, never a scaled percentage**, because that is what
 *  `KpiSummary.conversionRate` and a `percent` report cell carry. {@link formatScaledPercent} is the
 *  scaled form, and a non-finite ratio renders {@link EMPTY_VALUE_PLACEHOLDER}. */
export function formatPercent(ratio: DisplayNumber, digits: number = 1): string {
  const amount = amountOf(ratio);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  const places = fractionDigitsOf(digits, 1);
  return formatter(`percent:${places}`, {
    style: "percent",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(amount);
}

/** Formats a figure that is already scaled — `12.5` becomes `"12.5%"` — for the values the product
 *  carries as percentages rather than ratios, such as `sharePercent`, a KPI change and a report's share
 *  column. A non-finite figure renders {@link EMPTY_VALUE_PLACEHOLDER}. */
export function formatScaledPercent(percent: DisplayNumber, digits: number = 1): string {
  const amount = amountOf(percent);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  return `${formatNumber(amount, { digits, fixed: true })}%`;
}

/**
 * Compares two figures and returns the signed change a KPI card shows: the difference, the change as a
 * percentage of the earlier figure's magnitude, the direction to style and the signed text (`"+5.0%"`).
 * A zero baseline is the case that cannot be a percentage — when both figures are zero the change is
 * `"0.0%"` and `flat`, and when only the baseline is zero `changePercent` is `null` with {@link
 * EMPTY_VALUE_PLACEHOLDER} as its text, because growth from nothing has no percentage, never
 * `Infinity` or `NaN`. A figure that is not finite yields `unknown` with the same placeholder.
 * Aggregate growth across a collection belongs to `src/utils/statistics.ts`; this renders one pair.
 */
export function formatPercentChange(
  current: number,
  previous: number,
  digits: number = 1,
): PercentChangeDisplay {
  const from = amountOf(previous);
  const to = amountOf(current);
  const places = fractionDigitsOf(digits, 1);
  if (from === null || to === null) return changeDisplay(0, 0, "unknown", null, places);
  const difference = to - from;
  const direction = directionOf(difference);
  if (from === 0) {
    return difference === 0
      ? changeDisplay(to, from, direction, 0, places)
      : changeDisplay(to, from, direction, null, places);
  }
  return changeDisplay(to, from, direction, (difference / Math.abs(from)) * 100, places);
}

/** Formats a difference between two already-scaled percentages in percentage points — `2.5` becomes
 *  `"+2.5 pts"` — which is how a rate compares with the rate it is measured against, such as a
 *  conversion rate or a share against its baseline, where a relative percentage would mislead. A
 *  non-finite difference renders {@link EMPTY_VALUE_PLACEHOLDER}. */
export function formatPercentagePoints(points: DisplayNumber, digits: number = 1): string {
  const amount = amountOf(points);
  if (amount === null) return EMPTY_VALUE_PLACEHOLDER;
  return `${signedText(amount, fractionDigitsOf(digits, 1))} pts`;
}

/** Formats one value's share of a whole as a percentage — `formatShare(150, 400)` is `"37.5%"` — for a
 *  donut label, a share column and a progress caption. A total of zero or less has no share to state,
 *  so the result is `"0.0%"`; a non-finite value or total renders {@link EMPTY_VALUE_PLACEHOLDER}. */
export function formatShare(value: DisplayNumber, total: number, digits: number = 1): string {
  const part = amountOf(value);
  const whole = amountOf(total);
  if (part === null || whole === null) return EMPTY_VALUE_PLACEHOLDER;
  return whole <= 0 ? formatScaledPercent(0, digits) : formatPercent(part / whole, digits);
}

// Domain display values --------------------------------------------------------------------------

/** Formats a rating average with a fixed decimal — `4` becomes `"4.0"`, `4.53` becomes `"4.5"` — for
 *  the stars' text alternative and for the summary `src/constants/content.ts` composes from it; a
 *  non-finite average renders {@link EMPTY_VALUE_PLACEHOLDER}. */
export function formatRatingValue(average: DisplayNumber, digits: number = 1): string {
  return formatNumber(average, { digits, fixed: true });
}

/** Reports a rating as its parts — the average with an absent one read as `0`, the formatted value, the
 *  review count and whether the product has been reviewed at all — so a card, a detail page and a live
 *  region read one computation. The sentence around those parts is copy from
 *  `src/constants/content.ts`, which takes {@link RatingDisplay.value} and the count. */
export function formatRating(average: DisplayNumber, count: DisplayNumber): RatingDisplay {
  const value = amountOf(average);
  const reviews = wholeCountOf(count);
  return {
    average: value ?? 0,
    value: formatRatingValue(average),
    count: reviews,
    hasReviews: reviews > 0,
  };
}

/** Formats a review count with its noun in the right number — `1` becomes `"1 review"`, `128` becomes
 *  `"128 reviews"` — for a heading and a live region that state a count on its own; the form comes from
 *  `Intl.PluralRules`, and a negative or absent count reads as `"0 reviews"`. A sentence that already
 *  carries the noun, such as the rating summary, is copy from `src/constants/content.ts`. */
export function formatReviewCount(count: DisplayNumber): string {
  const reviews = wholeCountOf(count);
  const noun = COUNT_PLURALS.select(reviews) === "one" ? "review" : "reviews";
  return `${formatInteger(reviews)} ${noun}`;
}

/** Reports how much of a list price a current price saves, as a whole percentage — `2000` against a
 *  `1650` price saves `18` — for the discount a product tile and a cart line show. Nothing is saved
 *  when there is no list price above the price, so an equal, inverted, zero or non-finite pair returns
 *  `0`; the label around the percentage is copy from `src/constants/content.ts`. Both amounts are minor
 *  units, never decimals. */
export function formatDiscount(listMinor: MinorUnits, priceMinor: MinorUnits): number {
  const list = amountOf(listMinor);
  const price = amountOf(priceMinor);
  if (list === null || price === null || list <= 0 || price >= list) return 0;
  return Math.round(((list - price) / list) * 100);
}

/** Turns a stock pair into the availability level a badge styles, applying the rule in one place: a
 *  count of zero is `out-of-stock`, a count at or below the low-stock threshold is `low-stock` and a
 *  count above it is `in-stock`; only a positive count is purchasable. The literals are the ones
 *  `InventoryStatus` declares in `src/types/catalog.ts`, and the figures travel with the level so no
 *  caller compares a threshold itself. Negative and non-finite inputs read as zero. */
export function formatAvailability(
  stockOnHand: number,
  lowStockThreshold: number,
): AvailabilityDisplay {
  const stock = wholeCountOf(stockOnHand);
  const threshold = wholeCountOf(lowStockThreshold);
  const available = stock > 0;
  const status: AvailabilityLevel = !available
    ? "out-of-stock"
    : stock <= threshold
      ? "low-stock"
      : "in-stock";
  return { status, available, stockOnHand: stock, lowStockThreshold: threshold };
}

// Report cells -----------------------------------------------------------------------------------

/** Renders one report cell from its column's declared format, the dispatch a report table and its CSV
 *  export both use so a value cannot be rendered two ways. A `money` cell holds minor units, a
 *  `compact-number` cell a plain figure, a `percent` cell a ratio (per `src/types/analytics.ts`) and a
 *  `date` cell an ISO day rendered by `src/utils/dates.ts`; any value that is not the type its format
 *  expects, a bucket key such as `2025-W05` included, is shown as the text it holds so a row never
 *  blanks. An absent cell renders {@link EMPTY_CELL_TEXT}: nothing to show is not the same as a zero.
 *  {@link formatCellValueForExport} writes the machine-readable form of the same cell. */
export function formatCellValue(
  value: ReportCellValue | undefined,
  format: ReportCellFormat,
): string {
  switch (format) {
    case "text":
      return textOf(value);
    case "integer":
      return typeof value === "number" ? formatInteger(value) : textOf(value);
    case "money":
      return typeof value === "number" ? formatMoney(value) : textOf(value);
    case "percent":
      return typeof value === "number" ? formatPercent(value) : textOf(value);
    case "compact-number":
      return typeof value === "number" ? formatCompactNumber(value) : textOf(value);
    case "date":
      return typeof value === "string" ? formatDate(value) || value : textOf(value);
    default:
      return assertExhaustive(format);
  }
}

/** The text of one numeric export cell: `render` over the finite figure it holds, {@link
 *  EMPTY_VALUE_PLACEHOLDER} for a figure that is not finite, and the text it holds for a value that is
 *  no figure at all. */
function exportedFigure(
  value: ReportCellValue | undefined,
  render: (figure: number) => string,
): string {
  if (typeof value !== "number") return textOf(value);
  return Number.isFinite(value) ? render(value) : EMPTY_VALUE_PLACEHOLDER;
}

/** Renders one report cell for the CSV export: the value {@link formatCellValue} renders, written
 *  machine-readable because a column of `"$1,299.00"` cannot be summed by a spreadsheet. A money cell
 *  exports a plain decimal (`"1299.00"`), an integer cell the table's own whole figure ungrouped
 *  (`"1285"` for a fractional `1284.9`), a `compact-number` cell the full figure, a percent cell the
 *  scaled number without its percent sign (`"12.5"`) and a text cell as it stands; a figure that is not
 *  finite exports {@link EMPTY_VALUE_PLACEHOLDER} in both renderers, the dash the table shows, rather
 *  than an empty cell or a fabricated zero. Three departures from the display form are deliberate: a
 *  `compact-number` cell exports the full figure, a `date` cell the stored ISO text, and a money cell
 *  the plain decimal a spreadsheet can sum. `reportService.toCsvMatrix` uses this; a surface showing a
 *  reader a figure uses {@link formatCellValue}. */
export function formatCellValueForExport(
  value: ReportCellValue | undefined,
  format: ReportCellFormat,
): string {
  switch (format) {
    case "text":
    case "date":
      return textOf(value);
    case "integer":
      return exportedFigure(value, (figure) => plainText(figure, 0));
    case "money":
      return exportedFigure(value, (figure) =>
        fixedText(fromMinorUnits(figure), MONEY_FRACTION_DIGITS),
      );
    case "percent":
      return exportedFigure(value, (figure) => plainText(figure * 100, 1));
    case "compact-number":
      return exportedFigure(value, (figure) => plainText(figure, DEFAULT_FRACTION_DIGITS));
    default:
      return assertExhaustive(format);
  }
}
