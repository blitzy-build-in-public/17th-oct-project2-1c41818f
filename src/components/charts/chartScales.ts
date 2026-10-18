/**
 * Path: src/components/charts/chartScales.ts
 * Purpose: Linear and band scales, nice domains, tick generation and path helpers shared by the charts
 * Lines: 509
 */

import {
  AXIS_NUMBER_FORMAT,
  defaultLabelFormatter,
  estimateLabelWidth,
  type AxisLabelTransform,
  type AxisValueFormatter,
  type BandScale,
  type BandTick,
  type GridLine,
  type LabelFormatter,
  type LinearScale,
  type Orientation,
  type Padding,
  type PlotArea,
  type TickMark,
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
 * `--chart-series-N`, `src/styles/chart-series.css` maps it onto the series classes, and every heading or
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

/**
 * The step a whole-number metric is ticked with at its smallest, in the metric's own units. A count of people,
 * orders or units is only ever an integer, so an axis spanning one is widened and ticked in whole numbers rather
 * than in halves no bucket could hold: a domain of `[0, 1]` ticks at `0` and `1` instead of at fifths.
 */
export const WHOLE_NUMBER_STEP = 1;

/** The clear room two band labels keep between them along their axis, in user units, so a thinned axis still
 *  reads as separate labels rather than as one run of text. */
export const MIN_BAND_LABEL_GAP = 8;

/** At or below this many points a line chart may still mark each one; above it the marks would merge. */
export const POINT_MARK_LIMIT = 31;

/** The default frame inset: room for the value axis, its labels and the band labels. */
export const DEFAULT_PADDING: Padding = { top: 16, right: 24, bottom: 32, left: 56 };

/** The gap an axis keeps between itself and the labels it anchors, in user units: what {@link axisLabelTransform} places
 *  a band label by, and what the bar geometry sizes its band-label gutter with, so the two cannot drift. */
export const TICK_GAP = 8;
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
 * readable figure rather than on the largest datum. `minimumStep` is the smallest step the metric admits — a
 * count asks for {@link WHOLE_NUMBER_STEP}, so its axis cannot tick in fractions of a person — and the chosen
 * step is never below it. Degenerate input has stated results, never `NaN`: an equal pair at zero gives `[0, 0]`,
 * which is one tick on the baseline rather than an axis of invented pennies; an equal non-zero pair is padded by
 * `max(1, |value| × 0.05)` either side; a non-finite bound gives `[0, 1]`; and an inverted pair is read low-to-high.
 */
export function niceDomain(
  min: number,
  max: number,
  tickCount?: number,
  minimumStep?: number,
): readonly [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (low === high) {
    if (low === 0) return [0, 0];
    const pad = Math.max(1, Math.abs(low) * 0.05);
    return [low - pad, low + pad];
  }
  const step = Math.max(
    niceNumber(
      niceNumber(high - low, false) / (resolveCount(tickCount, DEFAULT_TICK_COUNT) - 1),
      true,
    ),
    stepFloor(minimumStep),
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
 * The ascending, deduplicated `1`/`2`/`5` × `10ⁿ` tick values inside `[min, max]`, none of them closer together
 * than `minimumStep` — the step a whole-number metric asks for, so a count axis never ticks at `0.2` of a person.
 * A `count` below two falls back to {@link DEFAULT_TICK_COUNT}, because one tick cannot straddle a range; a
 * `count` below one or a bound that is not finite gives `[]`; equal bounds give that one value; and a range
 * narrower than one step gives its own two ends rather than none.
 */
export function linearTicks(
  min: number,
  max: number,
  count?: number,
  minimumStep?: number,
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || (count !== undefined && count < 1))
    return [];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (low === high) return [low];
  const step = Math.max(
    niceNumber((high - low) / (resolveCount(count, DEFAULT_TICK_COUNT) - 1), true),
    stepFloor(minimumStep),
  );
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
 * inverse, and the ticks across the resolved domain. A zero-width domain — one value and no extent, which is
 * what an all-zero series produces — cannot be inverted, so it maps every value to `range[0]`, the end a value
 * axis starts at and so the baseline that one value lies on, and reads that value back from any pixel.
 * `minimumStep` is the smallest step the metric admits, in the metric's own units, and it reaches both the
 * domain the axis is widened to and the ticks drawn across it; `clamp` holds a value inside the range; without
 * it a value outside the domain maps outside the range, which is what lets a renderer draw an out-of-range mark
 * and trim it. `nice` widens the domain first, and `tickCount` is the count the widening and the ticks aim for.
 */
export function createLinearScale(options: {
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly clamp?: boolean;
  readonly nice?: boolean;
  readonly tickCount?: number;
  readonly minimumStep?: number;
}): LinearScale {
  const tickCount = resolveCount(options.tickCount, DEFAULT_TICK_COUNT);
  const [low, high] =
    options.nice === true
      ? niceDomain(options.domain[0], options.domain[1], tickCount, options.minimumStep)
      : orderDomain(options.domain);
  const [start, end] = options.range;
  const domainSpan = high - low;
  const rangeSpan = end - start;
  const clamp = options.clamp === true;
  const lowerPixel = Math.min(start, end);
  const upperPixel = Math.max(start, end);
  const toPixel = (value: number): number =>
    domainSpan === 0 ? start : start + ((value - low) / domainSpan) * rangeSpan;
  return {
    domain: [low, high],
    range: [start, end],
    scale: (value) => {
      const pixel = toPixel(Number.isFinite(value) ? value : low);
      return clamp ? Math.min(Math.max(pixel, lowerPixel), upperPixel) : pixel;
    },
    invert: (pixel) =>
      domainSpan === 0 || rangeSpan === 0 ? low : low + ((pixel - start) / rangeSpan) * domainSpan,
    ticks: (count) => linearTicks(low, high, count ?? tickCount, options.minimumStep),
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

/**
 * One tick per value on the scale, positioned by the scale and written by the formatter, which is handed the
 * domain the scale spans beside the value: what a formatter needs to write every tick of one axis in one
 * notation, which is why an axis that shortened only its large figures is fixed here and not in a renderer.
 */
export const buildValueTicks = (
  scale: LinearScale,
  formatter: AxisValueFormatter = AXIS_NUMBER_FORMAT,
  count?: number,
): TickMark[] =>
  scale.ticks(count).map((value) => ({
    value,
    position: scale.scale(value),
    label: formatter(value, scale.domain),
  }));

/** What {@link buildBandTicks} thins a run of band labels by: how many labels it may emit, how long the axis is,
 *  and how the room one label needs along that axis is measured. */
export interface BandTickOptions {
  /** The most band labels the axis may carry; a limit below two falls back to {@link MAX_AXIS_LABELS}. */
  readonly maxLabels?: number;
  /** The axis's own length in user units — a plot's width for a horizontal axis, its height for a vertical one.
   *  Absent, negative or not a number, the labels are thinned by count alone. */
  readonly axisLength?: number;
  /** The room one label takes along the axis, in user units. Defaults to {@link estimateLabelWidth}, which is the
   *  rule a label running across the axis needs; a label running down it takes `LABEL_FONT_SIZE` instead. */
  readonly measureLabel?: (label: string) => number;
}

/**
 * One tick per band key, thinned so the labels an axis writes neither overlap nor collide. The count rule is a
 * floor: a stride is chosen so at most `maxLabels` labels are emitted, which is what a ninety-day axis has always
 * been thinned by. Where the options also state the axis's length the width rule joins it — the widest label the
 * axis writes is measured once and two kept labels must sit that room plus {@link MIN_BAND_LABEL_GAP} apart along
 * the axis — so a run of wide labels is thinned further than a run of narrow ones, which is the rule a count
 * alone cannot express and the reason a "Week of Jan 27" axis superimposed its labels.
 *
 * The last key keeps its label, but only where it clears the label before it by that same room; otherwise it
 * replaces that label, so an axis still ends on its last band without two labels sharing the space of one.
 * The rule lives here so no renderer thins its own labels.
 */
export function buildBandTicks(
  scale: BandScale,
  formatter: LabelFormatter = defaultLabelFormatter,
  options: BandTickOptions = {},
): BandTick[] {
  const keys = scale.ticks();
  const limit = resolveCount(options.maxLabels, MAX_AXIS_LABELS);
  const countStride = keys.length <= limit ? 1 : Math.ceil((keys.length - 1) / (limit - 1));
  const room = labelRoom(scale, formatter, options);
  const widthStride = room > 0 && scale.step > 0 ? Math.ceil(room / scale.step) : 1;
  const stride = Math.max(countStride, widthStride);
  const kept = keys.map((_key, index) => index).filter((index) => index % stride === 0);
  const last = keys.length - 1;
  if (kept[kept.length - 1] !== last) {
    if ((last - (kept[kept.length - 1] ?? 0)) * scale.step < room) kept.pop();
    kept.push(last);
  }
  return kept.map((index) => tickOf(scale, formatter, keys[index]));
}

/**
 * {@link Padding} with the room the label at either end of a band axis needs: each horizontal end reserves half
 * the widest label the axis writes, plus {@link MIN_BAND_LABEL_GAP}. A band label is centred on its band, and the
 * band at either end sits half a bandwidth inside the plot, so without that room the first and last labels are
 * painted past the frame and cut by its edge. An end `base` already insets further keeps its own inset, and a run
 * of labels narrower than that inset reserves nothing more, so a chart whose labels already fit its frame is
 * drawn exactly as it was.
 */
export function bandAxisPadding(base: Padding, labels: readonly string[]): Padding {
  const widest = labels.reduce((widest, label) => Math.max(widest, estimateLabelWidth(label)), 0);
  const room = Math.ceil(widest / 2) + MIN_BAND_LABEL_GAP;
  return { ...base, left: Math.max(base.left, room), right: Math.max(base.right, room) };
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

/** A smallest step a metric admits as a floor a chosen step must reach, or `0` — no floor at all — when none
 *  was asked for or the value is not a usable step, so an axis is never widened by a bound it cannot hold. */
const stepFloor = (minimumStep: number | undefined): number =>
  minimumStep !== undefined && Number.isFinite(minimumStep) && minimumStep > 0 ? minimumStep : 0;

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

/**
 * The room two kept band labels must keep between them along the axis: the widest label the axis writes plus
 * {@link MIN_BAND_LABEL_GAP}, or `0` when the caller states no usable axis length and the labels are thinned by
 * count alone. Every label the axis writes is one of the keys measured here — thinning only ever drops a label —
 * so no drawn label is wider than the room the stride was chosen from.
 */
const labelRoom = (
  scale: BandScale,
  formatter: LabelFormatter,
  options: BandTickOptions,
): number => {
  const axisLength = options.axisLength;
  if (axisLength === undefined || !Number.isFinite(axisLength) || axisLength <= 0) return 0;
  const measure = options.measureLabel ?? estimateLabelWidth;
  const widest = scale
    .ticks()
    .reduce((widest, key) => Math.max(widest, measure(formatter(key))), 0);
  return widest + MIN_BAND_LABEL_GAP;
};

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
  AxisLabelTransform,
  AxisValueFormatter,
  BandScale,
  BandTick,
  BarMode,
  BarRect,
  ChartDataRow,
  ChartDataTable,
  GridLine,
  LabelFormatter,
  LinearScale,
  Orientation,
  Padding,
  PlotArea,
  Point2D,
  TableHeadings,
  TickMark,
  ValueFormatter,
  ValueFormatterKind,
} from "@/components/charts/chartGeometry";

export {
  AXIS_NUMBER_FORMAT,
  DEFAULT_INNER_RADIUS_RATIO,
  LABEL_FONT_SIZE,
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
  estimateLabelWidth,
  hasChartData,
  hasThinSlice,
  hasWholeValues,
  polarToCartesian,
  ringShares,
  roundCoordinate,
  seriesClassName,
  stackValues,
  zeroCoordinate,
} from "@/components/charts/chartGeometry";
