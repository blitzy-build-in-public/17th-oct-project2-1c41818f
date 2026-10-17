/**
 * Path: src/components/charts/chartScales.ts
 * Purpose: Linear and band scales, nice domains, tick generation and path helpers shared by the charts
 * Lines: 389
 */

import {
  AXIS_NUMBER_FORMAT,
  defaultLabelFormatter,
  type AxisLabelTransform,
  type BandScale,
  type BandTick,
  type GridLine,
  type LabelFormatter,
  type LinearScale,
  type Orientation,
  type Padding,
  type PlotArea,
  type TickMark,
  type ValueFormatter,
} from "@/components/charts/chartGeometry";
import type { MinorUnits } from "@/types/common";
import { roundMinorUnits } from "@/utils/format";

/**
 * The coordinate and axis mathematics every chart in this folder is drawn with: the domains an axis is
 * widened to, the linear and band scales a mark is placed by, the plot area a frame is computed into, the
 * ticks and labels an axis is written with, and the transforms that anchor them. It is pure — `readonly`
 * input left unmutated, a fresh value out, no read of the document, the clock or the platform — so the maths
 * is testable without mounting SVG.
 *
 * The mark, path and data-table half of the same contract lives in `src/components/charts/chartGeometry.ts`
 * and is re-exported at the foot of this file, which is the path the three renderers and their tests import.
 * The charts' maths is one concern that the plan's 600-line ceiling splits; nothing here imports anything
 * upward, and the geometry module imports nothing from here.
 *
 * No colour, `stroke`, `fill` or copy appears in either file: `src/styles/tokens.css` owns
 * `--chart-series-N`, `src/styles/admin-reports.css` maps it onto the series classes, and every heading or
 * sentence a chart shows comes from `src/constants/content.ts`.
 */

// Constants ---------------------------------------------------------------------------------------

/** The viewBox width every chart in this folder is drawn at; CSS scales the SVG to its container. */
export const CHART_VIEWBOX_WIDTH = 720;

/** The viewBox height every chart in this folder is drawn at. */
export const DEFAULT_CHART_HEIGHT = 280;

/** The ticks an axis aims for; the step chosen from it lands near that count, not always on it. */
export const DEFAULT_TICK_COUNT = 5;

/** The most band labels an axis may carry at once; beyond it {@link buildBandTicks} thins them. */
export const MAX_AXIS_LABELS = 8;

/** At or below this many points a line chart may still mark each one; above it the marks would merge. */
export const POINT_MARK_LIMIT = 31;

/** The default frame inset: room for the value axis, its labels and the band labels. */
export const DEFAULT_PADDING: Padding = { top: 16, right: 24, bottom: 32, left: 56 };

// Literals no reader should have to decode, and the magnitudes the nice-number rules choose between.
const TICK_GAP = 8;
const TICK_PRECISION = 12;
const DEFAULT_BAND_PADDING = 0.1;
const DEFAULT_BAND_ALIGN = 0.5;
const NICE_MULTIPLES = [1, 2, 5, 10];
const NEAREST_THRESHOLDS = [1.5, 3, 7];
const CEILING_THRESHOLDS = [1, 2, 5];

// Domains -----------------------------------------------------------------------------------------

/**
 * The `1`/`2`/`5` × `10ⁿ` magnitude nearest `value` — `0.7` gives `1`, `12` gives `10`, `25` gives `20` —
 * or, without `round`, the smallest such magnitude reaching it, so `1.4` gives `2` and `12` gives `20`.
 * `0` and any input that is not finite give `0`, because only a magnitude is returned and a sign would mean
 * nothing. The fraction is trimmed to {@link TICK_PRECISION} significant digits first, so a value sitting
 * exactly on a boundary — where dividing by the magnitude lands on `6.999999999999999` rather than `7` —
 * selects the magnitude its decimal form names instead of the one below it.
 */
export function niceNumber(value: number, round: boolean): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  const fraction = Number((Math.abs(value) / magnitude).toPrecision(TICK_PRECISION));
  const thresholds = round ? NEAREST_THRESHOLDS : CEILING_THRESHOLDS;
  const index = thresholds.findIndex((bound) => (round ? fraction < bound : fraction <= bound));
  return (index < 0 ? 10 : NICE_MULTIPLES[index]) * magnitude;
}

/**
 * Widens `[min, max]` to `1`/`2`/`5` × `10ⁿ` bounds carrying about `tickCount` steps, so an axis ends on a
 * readable figure rather than on the largest datum. Degenerate input has stated results, never `NaN`: an
 * equal pair at zero gives `[0, 1]`, an equal non-zero pair is padded by `max(1, |value| × 0.05)` either
 * side, a non-finite bound gives `[0, 1]`, and an inverted pair is read low-to-high.
 */
export function niceDomain(
  min: number,
  max: number,
  tickCount?: number,
): readonly [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (low === high) {
    if (low === 0) return [0, 1];
    const pad = Math.max(1, Math.abs(low) * 0.05);
    return [low - pad, low + pad];
  }
  const step = niceNumber(
    niceNumber(high - low, false) / (resolveCount(tickCount, DEFAULT_TICK_COUNT) - 1),
    true,
  );
  if (!Number.isFinite(step) || step <= 0) return [low, high];
  return [
    normalizeZero(Math.floor(low / step) * step),
    normalizeZero(Math.ceil(high / step) * step),
  ];
}

/** {@link niceDomain} for money, with both bounds passed through `roundMinorUnits` so no tick lands on a fractional cent. */
export function niceMoneyDomain(
  min: MinorUnits,
  max: MinorUnits,
  tickCount?: number,
): readonly [MinorUnits, MinorUnits] {
  const [low, high] = niceDomain(min, max, tickCount);
  return [roundMinorUnits(low), roundMinorUnits(high)];
}

/** Widens a domain so it carries `0`, which is what a bar height, an area and a total are all read against. */
export function extendDomainToIncludeZero(
  domain: readonly [number, number],
): readonly [number, number] {
  const [low, high] = orderDomain(domain);
  return [Math.min(low, 0), Math.max(high, 0)];
}

/**
 * The ascending, deduplicated `1`/`2`/`5` × `10ⁿ` tick values inside `[min, max]`. A `count` below two falls
 * back to {@link DEFAULT_TICK_COUNT}, because one tick cannot straddle a range; a `count` below one or a
 * bound that is not finite gives `[]`; equal bounds give that one value; and a range narrower than one step
 * gives its own two ends rather than none.
 */
export function linearTicks(min: number, max: number, count?: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || (count !== undefined && count < 1))
    return [];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (low === high) return [low];
  const step = niceNumber((high - low) / (resolveCount(count, DEFAULT_TICK_COUNT) - 1), true);
  if (!Number.isFinite(step) || step <= 0) return [low, high];
  const first = Math.ceil(low / step);
  const ticks = Array.from({ length: Math.floor(high / step) - first + 1 }, (_item, offset) =>
    normalizeZero(Number(((first + offset) * step).toPrecision(TICK_PRECISION))),
  );
  const distinct = [...new Set(ticks)];
  return distinct.length < 2 ? [low, high] : distinct;
}

// Scales ------------------------------------------------------------------------------------------

/**
 * Builds the continuous scale a value axis is drawn with: a linear map from `domain` onto `range`, its
 * inverse, and the ticks across the resolved domain. A zero-width domain cannot be inverted, so it maps
 * every value to the range's midpoint and inverts every pixel back to its one value. `clamp` holds a value
 * inside the range; without it a value outside the domain maps outside the range, which is what lets a
 * renderer draw an out-of-range mark and trim it. `nice` widens the domain first, and `tickCount` is the
 * count the widening and the ticks aim for.
 */
export function createLinearScale(options: {
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly clamp?: boolean;
  readonly nice?: boolean;
  readonly tickCount?: number;
}): LinearScale {
  const tickCount = resolveCount(options.tickCount, DEFAULT_TICK_COUNT);
  const [low, high] =
    options.nice === true
      ? niceDomain(options.domain[0], options.domain[1], tickCount)
      : orderDomain(options.domain);
  const [start, end] = options.range;
  const domainSpan = high - low;
  const rangeSpan = end - start;
  const clamp = options.clamp === true;
  const lowerPixel = Math.min(start, end);
  const upperPixel = Math.max(start, end);
  const toPixel = (value: number): number =>
    domainSpan === 0 ? start + rangeSpan / 2 : start + ((value - low) / domainSpan) * rangeSpan;
  return {
    domain: [low, high],
    range: [start, end],
    scale: (value) => {
      const pixel = toPixel(Number.isFinite(value) ? value : low);
      return clamp ? Math.min(Math.max(pixel, lowerPixel), upperPixel) : pixel;
    },
    invert: (pixel) =>
      domainSpan === 0 || rangeSpan === 0 ? low : low + ((pixel - start) / rangeSpan) * domainSpan,
    ticks: (count) => linearTicks(low, high, count ?? tickCount),
  };
}

/**
 * Builds the discrete scale a band axis is drawn with: one step per deduplicated key, a bandwidth inside it
 * and the start pixel of each band, with the padding taken out as a gap between bands and leftover space
 * shared down the range by `align`. An empty domain gives `step` and `bandwidth` of `0` and reads `range[0]`
 * for every lookup, and an unknown key reads `range[0]` too, so a missing key cannot throw.
 */
export function createBandScale(options: {
  readonly domain: readonly string[];
  readonly range: readonly [number, number];
  readonly padding?: number;
  readonly align?: number;
}): BandScale {
  const keys = uniqueKeys(options.domain);
  const [start, end] = options.range;
  const rangeSpan = end - start;
  const padding = clampUnit(options.padding, DEFAULT_BAND_PADDING);
  const align = clampUnit(options.align, DEFAULT_BAND_ALIGN);
  const step = keys.length === 0 ? 0 : rangeSpan / Math.max(1, keys.length - padding + padding * 2);
  const origin = start + (rangeSpan - step * (keys.length - padding)) * align;
  const positions = new Map<string, number>();
  keys.forEach((key, index) => {
    positions.set(key, origin + index * step);
  });
  return {
    domain: keys,
    range: [start, end],
    step,
    bandwidth: step * (1 - padding),
    scale: (key) => positions.get(key) ?? start,
    ticks: () => keys,
  };
}

/** Subtracts the padding from the frame, clamping to at least `1`×`1`, so no dimension is ever negative or zero. */
export function computePlotArea(options: {
  readonly width: number;
  readonly height: number;
  readonly padding?: Padding;
}): PlotArea {
  const padding = options.padding ?? DEFAULT_PADDING;
  const x = insetOf(padding.left);
  const y = insetOf(padding.top);
  return {
    x,
    y,
    width: Math.max(1, insetOf(options.width) - x - insetOf(padding.right)),
    height: Math.max(1, insetOf(options.height) - y - insetOf(padding.bottom)),
  };
}

// Ticks, labels and axis transforms ---------------------------------------------------------------

/** One tick per value on the scale, positioned by the scale and written by the formatter. */
export const buildValueTicks = (
  scale: LinearScale,
  formatter: ValueFormatter = AXIS_NUMBER_FORMAT,
  count?: number,
): TickMark[] =>
  scale
    .ticks(count)
    .map((value) => ({ value, position: scale.scale(value), label: formatter(value) }));

/**
 * One tick per band key, thinned by a stride so at most `maxLabels` labels are emitted and the first and last
 * band always keep theirs — the anti-collision rule a ninety-day axis needs, kept here so no renderer thins
 * its own labels. A limit below two falls back to {@link MAX_AXIS_LABELS}.
 */
export function buildBandTicks(
  scale: BandScale,
  formatter: LabelFormatter = defaultLabelFormatter,
  maxLabels?: number,
): BandTick[] {
  const keys = scale.ticks();
  const limit = resolveCount(maxLabels, MAX_AXIS_LABELS);
  if (keys.length <= limit) return keys.map((key) => tickOf(scale, formatter, key));
  const stride = Math.ceil((keys.length - 1) / (limit - 1));
  const kept = keys.filter((_key, index) => index % stride === 0);
  const last = keys[keys.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept.map((key) => tickOf(scale, formatter, key));
}

/**
 * Where an axis label sits and how it anchors: an axis running vertically carries its labels beside it,
 * anchored at their end and centred on the tick, and one running horizontally carries them beneath it,
 * anchored at their middle and hanging from it, so no renderer hard-codes a tick anchor.
 */
export function axisLabelTransform(
  orientation: Orientation,
  axis: "value" | "band",
  plotArea: PlotArea,
  position: number,
): AxisLabelTransform {
  const vertical = (axis === "value") === (orientation === "vertical");
  if (vertical) {
    return { x: plotArea.x - TICK_GAP, y: position, textAnchor: "end", dominantBaseline: "middle" };
  }
  return {
    x: position,
    y: plotArea.y + plotArea.height + TICK_GAP,
    textAnchor: "middle",
    dominantBaseline: "hanging",
  };
}

/** The grid line at a tick: across the plot for a vertical chart, down it for a horizontal one. */
export function gridLineFor(
  orientation: Orientation,
  plotArea: PlotArea,
  position: number,
): GridLine {
  if (orientation === "vertical") {
    return { x1: plotArea.x, y1: position, x2: plotArea.x + plotArea.width, y2: position };
  }
  return { x1: position, y1: plotArea.y, x2: position, y2: plotArea.y + plotArea.height };
}

// Internal helpers --------------------------------------------------------------------------------

/** The count a caller asked for, or `fallback` when it is absent, not finite or below two. */
const resolveCount = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value >= 2 ? Math.trunc(value) : fallback;

/** A frame or padding value as it may be used: an inset is a non-negative, finite number of pixels. */
const insetOf = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/** A fraction clamped into `0..1`, falling back when it is absent or not finite. */
const clampUnit = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.min(1, Math.max(0, value));

/** `0` for either signed zero, so a tick never carries a sign it does not mean. */
const normalizeZero = (value: number): number => (value === 0 ? 0 : value);

/** A domain ordered low-to-high, or `[0, 1]` when a bound is not finite. */
const orderDomain = (domain: readonly [number, number]): readonly [number, number] => {
  const [first, second] = domain;
  if (!Number.isFinite(first) || !Number.isFinite(second)) return [0, 1];
  return first > second ? [second, first] : [first, second];
};

/** The keys of a band domain in first-appearance order without repeats, so a repeated key cannot shift a band. */
const uniqueKeys = (domain: readonly string[]): string[] => [...new Set(domain)];

/** One band's tick, positioned by the scale and written by the formatter. */
const tickOf = (scale: BandScale, formatter: LabelFormatter, key: string): BandTick => ({
  key,
  position: scale.scale(key),
  label: formatter(key),
});

// The geometry half of the charts' maths, re-exported so a renderer, a chart test or another component
// reaches the whole contract at this one path. The implementations live in chartGeometry.ts, which imports
// nothing from this file, so the dependency runs one way: types first, then the paths and marks they place.
export type {
  ArcDatum,
  ArcOptions,
  BarMode,
  BarRect,
  ChartDataRow,
  ChartDataTable,
  Point2D,
  TableHeadings,
  ValueFormatterKind,
} from "@/components/charts/chartGeometry";

export {
  DEFAULT_INNER_RADIUS_RATIO,
  MIN_SLICE_LABEL_SHARE,
  SERIES_COUNT,
  arcPath,
  buildAreaPath,
  buildBarRects,
  buildDonutArcs,
  buildLinePath,
  buildSeriesDataTable,
  buildSliceDataTable,
  chartPointKey,
  chartSeriesTotal,
  collectBandKeys,
  defaultLabelFormatter,
  defaultValueFormatter,
  hasChartData,
  polarToCartesian,
  seriesClassName,
  stackValues,
  zeroCoordinate,
} from "@/components/charts/chartGeometry";
