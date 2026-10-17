/**
 * Path: src/utils/statistics.ts
 * Purpose: Percentage change, growth, averages, moving averages and percentiles for the dashboard and reports
 * Lines: 432
 */

import type { BaselineKind, ChartPoint } from "@/types/analytics";
import type { MinorUnits } from "@/types/common";
import { averageOf, clampNumber, sum } from "@/utils/collections";
import { roundMinorUnits, type ChangeDirection } from "@/utils/format";

/**
 * The statistical layer of the product: the arithmetic behind the dashboard's KPI cards, its revenue
 * chart and the three reports, and its only home. `src/lib/analyticsService.ts` and
 * `src/lib/reportService.ts` call these helpers rather than dividing figures themselves, which keeps
 * the number a KPI card shows, the number a report table prints and the number its CSV exports from
 * disagreeing.
 *
 * Around it: `averageOf` and `sum` from `src/utils/collections.ts` are the plain mean and total;
 * rendering a figure, and the single rounding rule for money, are `src/utils/format.ts`'s; bucketing a
 * period and resolving a comparison range are `src/utils/dates.ts`'s; the sentence naming a baseline is
 * copy from `src/constants/content.ts`.
 *
 * Money stays integer minor units, leaving through `roundMinorUnits` rather than `Math.round`; and a
 * degenerate input has a stated result rather than `NaN` — a figure that is not finite is dropped
 * wherever a set is averaged, totalled, ranked or smoothed, a zero baseline has no percentage and
 * reports `null`, and a whole of zero has no share and reports `0`.
 */

/** A change at or below this magnitude reads as no change at all: the noise a difference such as
 *  `0.1 + 0.2 - 0.3` leaves behind must not style a KPI as growth. The bound is absolute because it
 *  compares the change itself — a difference, a percentage, a slope — not the figures behind it. */
const CHANGE_EPSILON = 1e-9;

/** The percentile a median is read at, so a median and a percentile at 50 are one computation. */
const MEDIAN_PERCENTILE = 50;

/** The scale a share is stated on: a share is a percentage, and a hundred of them make the whole. */
const PERCENT_SCALE = 100;

/** The figures that are finite, in input order: a set holding a figure that failed to load is read over
 *  the figures that did, so one missing bucket cannot turn a mean, a total or a rank into `NaN`. */
function finiteValues(values: readonly number[]): number[] {
  const usable: number[] = [];
  for (const value of values) {
    if (Number.isFinite(value)) usable.push(value);
  }
  return usable;
}

/** The finite figures in ascending order, as a new array: the order a median, a percentile and a
 *  summary read. The caller's array is never mutated. */
function sortedFiniteValues(values: readonly number[]): number[] {
  return finiteValues(values).sort((left, right) => left - right);
}

// Change and growth ---------------------------------------------------------------------------------

/**
 * Compares two figures and reports the signed change as a percentage of the earlier one's magnitude:
 * `percentChange(150, 100)` is `50` and `percentChange(80, 100)` is `-20`. The denominator is the
 * magnitude of `previous`, so a decline from a negative baseline reports growth the right way round.
 *
 * `null` where no percentage exists — a zero `previous` with differing figures, or either figure not
 * finite — while two zeros are flat and report `0`. This is the rule `formatPercentChange` in
 * `src/utils/format.ts` applies to one pair, so the change a KPI is computed from and the text its
 * card prints are one convention.
 *
 * @param current - The figure for the period being reported.
 * @param previous - The figure for the period it is measured against.
 * @returns The signed change in percent, or `null` when no percentage exists.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const difference = current - previous;
  if (previous === 0) return difference === 0 ? 0 : null;
  return (difference / Math.abs(previous)) * PERCENT_SCALE;
}

/**
 * Reports how a whole series grew from its first figure to its last, as a percentage.
 *
 * The series is read as given — oldest first, the order a chart and a bucketed query build it — so the
 * growth is the change between the ends of the period, not the average of the steps between its
 * buckets. Fewer than two figures have no growth to report and a first figure of zero has no percentage
 * to state, so both are `null` through {@link percentChange}; a non-finite end is `null` as well.
 *
 * @param values - The series in time order; never mutated.
 * @returns The signed growth in percent, or `null` when the series cannot state one.
 */
export function growthRate(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  return percentChange(values[values.length - 1], values[0]);
}

/**
 * Reads a signed change — a difference, a percentage, a slope — as the direction a KPI card or a badge
 * styles. A change at or below {@link CHANGE_EPSILON} is `"flat"`, so noise left by floating-point
 * arithmetic cannot show growth where nothing moved.
 *
 * A figure that is not finite is `"unknown"` rather than `"flat"`: the fourth member of
 * `ChangeDirection`, the union from `src/utils/format.ts` that `PercentChangeDisplay.direction`
 * carries, so a card holds one direction type whichever module produced the comparison.
 *
 * @param change - The signed change to classify.
 * @returns `"up"`, `"down"`, `"flat"`, or `"unknown"` for a change that is not a finite number.
 */
export function changeDirection(change: number): ChangeDirection {
  if (!Number.isFinite(change)) return "unknown";
  if (Math.abs(change) <= CHANGE_EPSILON) return "flat";
  return change > 0 ? "up" : "down";
}

/**
 * States one figure as a percentage of a whole: `shareOf(150, 400)` is `37.5`, the scaled percentage a
 * `sharePercent` and a report's share column carry rather than the `0.375` ratio a `percent` cell does.
 *
 * A whole of zero or less has no share to state, so the result is `0` — the figure `formatShare` in
 * `src/utils/format.ts` renders as `"0.0%"` for the same input, so the number and its rendering agree.
 * A negative part yields a negative share, which is how a bucket or a product that gave back more than
 * it earned is shown, and a part or whole that is not finite yields `0` rather than `NaN`.
 *
 * @param part - The figure being stated as a share.
 * @param total - The whole it is stated against.
 * @returns The share in percent, or `0` when the whole has none to state.
 */
export function shareOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * PERCENT_SCALE;
}

// Averages and centrality ---------------------------------------------------------------------------

/**
 * The average order value of a period: its revenue in minor units divided by the orders that produced
 * it — `averageOrderValue(100000, 3)` is `33333` — which is the figure `KpiSummary.averageOrderValueMinor`
 * and a report's average-order-value metric are read from, so the average the dashboard shows and the
 * one a report states are one calculation.
 *
 * Money is rounded exactly once, by `roundMinorUnits`, because a mean of minor units is rarely whole
 * and an unrounded fraction must not travel on into a total. A period with no orders reports `0`; a
 * fractional or non-finite order count is floored so it cannot inflate the average; and a revenue
 * figure that is not finite settles on `0` through the rounding rule.
 *
 * @param revenueMinor - The period's revenue, in integer minor units.
 * @param orderCount - How many orders that revenue came from.
 * @returns The average order value in integer minor units, or `0` when there are no orders.
 */
export function averageOrderValue(revenueMinor: MinorUnits, orderCount: number): MinorUnits {
  const orders = Number.isFinite(orderCount) ? Math.floor(orderCount) : 0;
  if (orders < 1) return 0;
  return roundMinorUnits(revenueMinor / orders);
}

/**
 * The mean of values that do not each carry the same weight: the average order value of a period
 * assembled from per-bucket averages is weighted by each bucket's order count. `weightedAverage([2, 4],
 * [3, 1])` is `2.5` — each value counts as many times as its weight says — where the plain mean of the
 * two values is `3`.
 *
 * A pair whose value or weight is not finite contributes nothing, so one bucket that failed to load
 * leaves the mean over the buckets that did rather than poisoning it, and a total weight of zero has no
 * mean to state and reports `0`. The result stays unrounded: a weighted mean of minor units is rounded
 * by the caller through `roundMinorUnits`, and a mean of equally weighted figures is
 * `src/utils/collections.ts`'s `averageOf` rather than this.
 *
 * @param values - The figures to average, in the order their weights are given.
 * @param weights - One weight per figure, read by position.
 * @returns The weighted mean, or `0` when no pair carries a finite weight.
 * @throws RangeError when the two collections differ in length, which is a caller's mistake rather than
 * data: the caller builds the pair and can hold them equal.
 */
export function weightedAverage(values: readonly number[], weights: readonly number[]): number {
  if (values.length !== weights.length) {
    throw new RangeError("weightedAverage requires one weight per value.");
  }
  let weightedTotal = 0;
  let totalWeight = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const weight = weights[index];
    if (!Number.isFinite(value) || !Number.isFinite(weight)) continue;
    weightedTotal += value * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : weightedTotal / totalWeight;
}

/**
 * The middle figure of a set: the one that splits it in half, so half the figures are lower and half
 * higher. `median([3, 1, 2])` is `2`, and with an even count the two middle figures are averaged —
 * `median([1, 2, 3, 4])` is `2.5` — because a median is defined here as a percentile at 50
 * ({@link percentile}), which is what makes the two agree by construction.
 *
 * A middle figure is read rather than a mean where a few very large figures would drag the average: one
 * enormous order does not move the median order value a customer report states. Figures that are not
 * finite are dropped rather than read as zeros, and a set holding no finite figure yields `null`.
 *
 * @param values - The figures to take the middle of; never mutated.
 * @returns The median, or `null` when the set holds no finite figure.
 */
export function median(values: readonly number[]): number | null {
  return percentile(values, MEDIAN_PERCENTILE);
}

/**
 * The median of a series of minor units — an order value, a cart total, a line price — as integer minor
 * units, rounding the middle through `roundMinorUnits` so a set with an even count cannot hand a report
 * a money figure carrying half a unit. `null` when no figure is finite, through {@link median}, so a
 * report cell renders empty rather than `$0.00` for a customer who has placed no orders.
 *
 * @param values - The money figures, in integer minor units; never mutated.
 * @returns The median in integer minor units, or `null` when no figure is finite.
 */
export function medianMinorUnits(values: readonly MinorUnits[]): MinorUnits | null {
  const middle = median(values);
  return middle === null ? null : roundMinorUnits(middle);
}

/**
 * The figure at a percentile of a set — `percentile(scores, 90)` is the score ninety per cent of the
 * set falls at or below — which is how a distribution is summarised without plotting every figure.
 *
 * **The method is fixed because a service, a chart and a test must not each pick a different one:**
 * figures that are not finite are dropped, the rest are sorted ascending, the rank is
 * `(p / 100) * (n - 1)` and the figure is interpolated linearly between the ranks either side of it —
 * the definition spreadsheets ship as `PERCENTILE.INC`. It makes the cases consumers read most agree by
 * construction: a percentile of 0 is the minimum, of 100 the maximum, of 50 exactly {@link median},
 * even-count average included. A percentile outside `0..100` is clamped to the nearer end rather than
 * rejected, and an empty set, or one holding no finite figure, yields `null`.
 *
 * @param values - The figures to read a percentile from; never mutated.
 * @param percentileRank - The percentile to read, between 0 and 100 inclusive.
 * @returns The figure at that percentile, or `null` when the set holds no finite figure.
 */
export function percentile(values: readonly number[], percentileRank: number): number | null {
  const sorted = sortedFiniteValues(values);
  const highestIndex = sorted.length - 1;
  if (highestIndex < 0) return null;
  const position = (clampNumber(percentileRank, 0, PERCENT_SCALE) / PERCENT_SCALE) * highestIndex;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  if (lowerIndex === upperIndex) return lower;
  const upper = sorted[upperIndex];
  return lower + (upper - lower) * (position - lowerIndex);
}

/**
 * What {@link summarise} reports about one series: how many finite figures it holds, their total, the
 * smallest and largest of them, their mean and their middle.
 */
export interface SeriesSummary {
  /** How many finite figures the series holds. */
  readonly count: number;
  /** Their total, exact and unrounded. */
  readonly sum: number;
  /** The smallest figure, or `null` when the series holds no finite figure. */
  readonly min: number | null;
  /** The largest figure, or `null` when the series holds no finite figure. */
  readonly max: number | null;
  /** The mean of the finite figures, as `averageOf` reports it, and `0` for a series holding none. */
  readonly average: number;
  /** The middle figure, as {@link median} reports it, or `null` when the series holds none. */
  readonly median: number | null;
}

/** What a series with no finite figure summarises to: nothing to total or average, and no extreme or
 *  middle to state, so a report cell reading one of those renders empty rather than zero. */
const EMPTY_SUMMARY: SeriesSummary = {
  count: 0,
  sum: 0,
  min: null,
  max: null,
  average: 0,
  median: null,
};

/**
 * Every figure a report or a KPI states about one series, from one read of it. One call rather than
 * five is what keeps a report's summary row and its chart describing the same numbers: the sales report
 * reads a period's bucketed revenue and the product-performance report its units, and both state the
 * five figures from here. The mean is `src/utils/collections.ts`'s `averageOf` and the middle is
 * {@link median}, so neither is computed anywhere else.
 *
 * A series of minor units is summarised here as well, with one caveat for its callers: `sum`, `min` and
 * `max` are already exact integers, while `average` and `median` may carry half a unit, because a mean
 * of counts is not money. A money consumer rounds those through `roundMinorUnits` — {@link
 * averageOrderValue} and {@link medianMinorUnits} are the two that do — and nothing here rounds.
 *
 * @param values - The figures to summarise; never mutated.
 * @returns The count, total, extremes, mean and median of the series' finite figures.
 */
export function summarise(values: readonly number[]): SeriesSummary {
  const sorted = sortedFiniteValues(values);
  if (sorted.length === 0) return EMPTY_SUMMARY;
  return {
    count: sorted.length,
    sum: sum(sorted),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    average: averageOf(sorted),
    median: percentile(sorted, MEDIAN_PERCENTILE),
  };
}

// Smoothing -----------------------------------------------------------------------------------------

/**
 * The average of the last `window` figures at each point, for the smoothed line a revenue chart draws
 * over the raw one: a daily series over a year is noisy enough to hide its own trend.
 *
 * **The series keeps its length and its x axis**: one point is returned per point given, carrying that
 * point's `x` and `label`, so the smoothed line shares the raw line's buckets and the points line up
 * index for index. A window reaching back before the series starts is therefore partial — the first
 * point is its own average, the second the mean of the first two, and so on until the window is full —
 * while a window longer than the series keeps widening to the whole of it rather than reporting nothing.
 *
 * A window of one or less leaves every figure as it stands, as a copy the caller cannot reach the input
 * through, and a fractional or non-finite window is read as a whole number of at least one. Each mean is
 * `averageOf` over the window's finite figures, so a window holding none averages to `0`; a smoothed
 * value stays unrounded, because it is drawn rather than totalled and every total the product shows
 * comes from the unsmoothed figures.
 *
 * @param points - The series in time order, as a chart consumes it; never mutated.
 * @param window - How many figures one average covers.
 * @returns New points, one per input point, with the smoothed `y`.
 */
export function movingAverage(points: readonly ChartPoint[], window: number): ChartPoint[] {
  const period = Number.isFinite(window) ? Math.max(1, Math.floor(window)) : 1;
  const figures = points.map((point) => point.y);
  return points.map((point, index) => ({
    ...point,
    y: averageOf(finiteValues(figures.slice(Math.max(0, index - period + 1), index + 1))),
  }));
}

/**
 * The running total of a series: each point replaced by the sum of the figures up to and including it,
 * which is what a cumulative revenue line and a year-to-date column show. The first point keeps its own
 * figure and the last carries the series' total, so the series ends where `summarise(...).sum` ends.
 *
 * One pass rather than a slice per point, keeping the series' length, its `x` and its `label` like
 * {@link movingAverage}. A figure that is not finite is skipped rather than added, so one bucket that
 * failed to load cannot blank the rest of the line, the raw series drawn beside it still showing the gap.
 *
 * @param points - The series in time order; never mutated.
 * @returns New points, one per input point, with the running total as `y`.
 */
export function cumulativeSeries(points: readonly ChartPoint[]): ChartPoint[] {
  const cumulative: ChartPoint[] = [];
  let running = 0;
  for (const point of points) {
    if (Number.isFinite(point.y)) running += point.y;
    cumulative.push({ ...point, y: running });
  }
  return cumulative;
}

// KPI comparison ------------------------------------------------------------------------------------

/**
 * One KPI as a card reads it: the figure for the period, the figure it is measured against, the
 * difference between them, the signed change in percent, the direction to style, and which baseline the
 * two figures come from.
 *
 * The baseline is named rather than implied — `baselineKind` is the comparison that was asked for, the
 * equal-length period immediately before the selected range or the same range a year earlier. The
 * ranges behind the two figures come from `resolveBaselineRange` in `src/utils/dates.ts` and the
 * sentence naming them from `src/constants/content.ts`; this shape reports figures only.
 */
export interface KpiComparison {
  /** The figure for the period being reported, echoed as given. */
  readonly value: number;
  /** The figure for the baseline period, echoed as given. */
  readonly baselineValue: number;
  /** `value - baselineValue`, or `0` when either figure is not finite. */
  readonly difference: number;
  /** The signed change in percent, or `null` when the baseline states none. */
  readonly changePercent: number | null;
  /** Which way the figures moved, and `"unknown"` when they cannot be compared. */
  readonly direction: ChangeDirection;
  /** The comparison the two figures come from, so a card can name it. */
  readonly baselineKind: BaselineKind;
}

/**
 * Compares a figure with the same figure from a named baseline and reports what a KPI card needs as
 * numbers: the two figures, their difference, the signed change in percent and the direction — the last
 * two from {@link percentChange} and {@link changeDirection}, so a KPI card's figure, a report's figure
 * and the text either prints cannot disagree.
 *
 * A baseline of zero is the case a percentage cannot state: with both figures zero the change is `0` and
 * the direction `"flat"`, and with only the baseline zero `changePercent` is `null` while the direction
 * still reports the way the figures moved, because growth from nothing has no ratio. A figure that is
 * not finite cannot be compared at all: both are echoed as given while `difference` is `0`,
 * `changePercent` is `null` and the direction is `"unknown"` — the state `format.ts` renders as a
 * placeholder.
 *
 * Both figures are plain numbers, so one helper compares money in minor units, order counts, units sold
 * and rates; nothing is scaled or rounded here, because a comparison of money compares integers.
 *
 * @param value - The figure for the period being reported.
 * @param baselineValue - The same figure for the baseline period.
 * @param baselineKind - Which comparison the baseline figure comes from.
 * @returns The comparison a KPI card renders through `src/utils/format.ts`.
 */
export function compareToBaseline(
  value: number,
  baselineValue: number,
  baselineKind: BaselineKind,
): KpiComparison {
  if (!Number.isFinite(value) || !Number.isFinite(baselineValue)) {
    return {
      value,
      baselineValue,
      difference: 0,
      changePercent: null,
      direction: "unknown",
      baselineKind,
    };
  }
  const difference = value - baselineValue;
  return {
    value,
    baselineValue,
    difference,
    changePercent: percentChange(value, baselineValue),
    direction: changeDirection(difference),
    baselineKind,
  };
}
