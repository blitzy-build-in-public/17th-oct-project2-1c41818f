/**
 * Path: src/components/charts/chartGeometry.ts
 * Purpose: Mark, path and data-table geometry for the charts, with the formatting hooks its scales share
 * Lines: 540
 */

import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import type { ChartPoint, ChartSeries } from "@/types/analytics";
import { bucketStart, formatBucketLabel } from "@/utils/dates";
import { formatCompactNumber, formatPercent } from "@/utils/format";

/**
 * Why this file exists beside `chartScales.ts`: the charts' coordinate maths is one concern but more than
 * one file may hold, so the plan's 600-line ceiling splits it. The scale and axis half — domains, scales,
 * ticks, transforms — lives in `chartScales.ts`; this half holds the shapes and paths a mark is painted
 * from, the rects a bar chart lays out, the arcs a donut splits into, the paired data table every renderer
 * shows as its accessible alternative, and the few hooks both halves need.
 *
 * Every public member here is re-exported from `chartScales.ts` — the path the three renderers and their
 * tests import — so the split is invisible to them. Nothing here imports `chartScales.ts`, which keeps the
 * dependency one-way.
 *
 * The contract every member keeps: pure, `readonly` input it never mutates, a fresh value out, and no read
 * of the document, the clock or the platform. No colour, `stroke`, `fill` or copy lives here either:
 * `src/styles/tokens.css` owns `--chart-series-N`, `src/styles/admin-reports.css` maps it onto the class
 * {@link seriesClassName} names, and every table heading arrives from the renderer.
 */

// Types -------------------------------------------------------------------------------------------

/** Formats one numeric value: an axis tick, a value label, a slice label or a data-table cell. */
export type ValueFormatter = (value: number) => string;

/** Formats one band or bucket key as axis or row wording. */
export type LabelFormatter = (key: string) => string;

/** Which way a chart runs: `vertical` lifts bars off a baseline, `horizontal` extends them sideways. */
export type Orientation = "vertical" | "horizontal";

/** How several series share one band: side by side, or accumulated one on top of another. */
export type BarMode = "grouped" | "stacked";

/** The three readings an axis carries: a count, a ratio between 0 and 1, or a share of a total. */
export type ValueFormatterKind = "number" | "percent" | "share";

/** The frame's inset in pixels: what an axis, its labels and a title reserve around the plot. */
export interface Padding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The rectangle marks are drawn in, in the frame's own coordinate system. */
export interface PlotArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in the frame's coordinate system, where `y` grows downward. */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** One grid line, as the endpoints an SVG `<line>` takes. */
export interface GridLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Where an axis label sits and how it anchors, as the attributes an SVG `<text>` takes. */
export interface AxisLabelTransform {
  readonly x: number;
  readonly y: number;
  readonly textAnchor: "start" | "middle" | "end";
  readonly dominantBaseline: "auto" | "middle" | "hanging";
}

/** A continuous scale over a numeric domain, with the pixel a value maps to and the inverse of that map. */
export interface LinearScale {
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  /** The pixel `value` maps to; a value that is not finite maps as the domain's lower bound. */
  scale(value: number): number;
  /** The inverse of `scale`, exact to a relative `1e-9`. */
  invert(pixel: number): number;
  /** The `1`/`2`/`5` × `10ⁿ` ticks across the domain; `count` defaults to the scale's own. */
  ticks(count?: number): number[];
}

/** A discrete scale over band keys: each key owns a step, a bandwidth inside it and a start pixel. */
export interface BandScale {
  readonly domain: readonly string[];
  readonly range: readonly [number, number];
  /** The distance between two adjacent band starts, and the drawable width of one band inside it. */
  readonly step: number;
  readonly bandwidth: number;
  /** The band's start pixel; an unknown key and an empty domain both read `range[0]`. */
  scale(key: string): number;
  /** The band keys, deduplicated in first-appearance order. */
  ticks(): readonly string[];
}

/** One value-axis tick: what it reads, where it sits and how it is written. */
export interface TickMark {
  readonly value: number;
  readonly position: number;
  readonly label: string;
}

/** One band-axis tick: the key, where it sits and how it is written. */
export interface BandTick {
  readonly key: string;
  readonly position: number;
  readonly label: string;
}

/** One drawn bar. `value` is the point's own value, never a stacked total, so a value label reads it directly. */
export interface BarRect {
  readonly key: string;
  readonly seriesId: string;
  readonly seriesIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number;
}

/** One donut slice: one per series, valued as the sum of that series' points. */
export interface ArcDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** The slice's fraction of the ring, between 0 and 1. */
  readonly share: number;
  readonly path: string;
  readonly midAngle: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly seriesIndex: number;
  /** The value as a legend or a value label reads it, formatted by the formatter the caller supplied. */
  readonly formattedValue: string;
}

/** One row of a chart's paired data table: the row's key, its heading and one cell per series or slice. */
export interface ChartDataRow {
  readonly key: string;
  readonly label: string;
  readonly cells: readonly string[];
}

/** The data-table alternative every chart exposes, so no figure is reachable by colour or geometry alone. */
export interface ChartDataTable {
  readonly columns: readonly string[];
  readonly rows: readonly ChartDataRow[];
}

/** The headings a table's columns carry: passed in by the renderer, and empty rather than invented when absent. */
export interface TableHeadings {
  readonly labelHeader?: string;
  readonly valueHeader?: string;
  readonly shareHeader?: string;
}

/** What {@link arcPath} takes: the ring, and the angular span one drawing covers. */
export interface ArcOptions {
  readonly cx: number;
  readonly cy: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

// Constants ---------------------------------------------------------------------------------------

/** Below this share a slice gets no inline percentage label, so labels cannot pile up on a thin wedge. */
export const MIN_SLICE_LABEL_SHARE = 0.05;

/** The share of the outer radius a donut's hole takes by default. */
export const DEFAULT_INNER_RADIUS_RATIO = 0.62;

// Literals no reader should have to decode.
const COORDINATE_DECIMALS = 2;
const BAR_INNER_GAP = 0.15;
const SLICE_LABEL_RADIUS_RATIO = 0.5;
const SERIES_CLASS_PREFIX = "sp-chart__series-";
const SHARE_EPSILON = 1e-9;
const FULL_TURN_DEGREES = 360;

// Formatting hooks --------------------------------------------------------------------------------

/**
 * The axis defaults, one per reading: a count shortens to `1.3K`, and a ratio and a share render as
 * percentages, a share without the decimal a label inside a wedge has no room for. Money never reaches an
 * axis through here; a money series formats through `src/utils/format.ts` and passes its own formatter.
 */
const AXIS_VALUE_FORMATTERS: Record<ValueFormatterKind, ValueFormatter> = {
  number: (value) => formatCompactNumber(value),
  percent: (value) => formatPercent(value, 1),
  share: (value) => formatPercent(value, 0),
};

/** {@link AXIS_VALUE_FORMATTERS}`.number`, the formatter a value axis uses unless it is handed another. */
export const AXIS_NUMBER_FORMAT = AXIS_VALUE_FORMATTERS.number;

/** The default axis formatter for a reading, so no renderer writes a raw `String(value)` on an axis. */
export const defaultValueFormatter = (kind: ValueFormatterKind = "number"): ValueFormatter =>
  AXIS_VALUE_FORMATTERS[kind];

/**
 * The one place a bucket key becomes axis wording: `2025-01-30` reads `Jan 30`, `2025-W05` reads
 * `Week of Jan 27` and `2025-01` reads `Jan 2025`. The two non-date key shapes resolve through
 * `bucketStart` first, since neither parses as a day, and any other key reads exactly as itself.
 */
export const defaultLabelFormatter: LabelFormatter = (key) => {
  if (/^\d{4}-W\d{2}$/.test(key)) return formatBucketLabel(bucketStart(key, "week"), "week") || key;
  if (/^\d{4}-\d{2}$/.test(key))
    return formatBucketLabel(bucketStart(key, "month"), "month") || key;
  return formatBucketLabel(key, "day") || key;
};

// Paths -------------------------------------------------------------------------------------------

/**
 * The `d` of a polyline: one `M` and then `L`s, so a single point draws a zero-length move and no points
 * draw nothing at all. A point with a non-finite coordinate is dropped rather than written into the path as
 * `NaN`, which would invalidate the whole `d`.
 */
export const buildLinePath = (points: readonly Point2D[]): string =>
  points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(
      (point, index) => `${index === 0 ? "M" : "L"}${coordinate(point.x)},${coordinate(point.y)}`,
    )
    .join("");

/** The `d` of the band an area encloses: the polyline, out to `baselineY` and back, closed; no finite point or a non-finite baseline gives `""`. */
export const buildAreaPath = (points: readonly Point2D[], baselineY: number): string => {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length === 0 || !Number.isFinite(baselineY)) return "";
  const first = finite[0];
  const last = finite[finite.length - 1];
  const edge = coordinate(baselineY);
  return `${buildLinePath(finite)}L${coordinate(last.x)},${edge}L${coordinate(first.x)},${edge}Z`;
};

/** The point `radius` away from `(cx, cy)` at `angleDeg`, measured clockwise from the top of the circle. */
export const polarToCartesian = (
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): Point2D => {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
};

/**
 * The `d` of one ring segment. A sweep of a full turn or more draws a closed ring rather than a malformed
 * one, and an `innerRadius` of `0` draws a wedge out to the centre. A zero or non-finite outer radius, a
 * negative or non-finite inner radius, an inner radius at or beyond the outer one, a non-finite centre,
 * angle or radius, or a zero sweep, gives `""`, because there is no ring to draw.
 */
export function arcPath(options: ArcOptions): string {
  const { cx, cy, outerRadius, innerRadius, startAngle, endAngle } = options;
  const measurable =
    Number.isFinite(cx) &&
    Number.isFinite(cy) &&
    Number.isFinite(outerRadius) &&
    Number.isFinite(innerRadius) &&
    Number.isFinite(startAngle) &&
    Number.isFinite(endAngle);
  if (!measurable || outerRadius <= 0 || innerRadius < 0) return "";
  if (innerRadius > 0 && innerRadius >= outerRadius) return "";
  const sweep = endAngle - startAngle;
  if (sweep === 0) return "";
  if (Math.abs(sweep) >= FULL_TURN_DEGREES) return fullRingPath(cx, cy, outerRadius, innerRadius);
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const flag = sweep > 0 ? 1 : 0;
  const start = pointOf(polarToCartesian(cx, cy, outerRadius, startAngle));
  const outerArc = `A${coordinate(outerRadius)},${coordinate(outerRadius)} 0 ${largeArc},${flag} `;
  const outerEnd = pointOf(polarToCartesian(cx, cy, outerRadius, endAngle));
  if (innerRadius === 0)
    return `M${start}${outerArc}${outerEnd}L${coordinate(cx)},${coordinate(cy)}Z`;
  const innerArc = `A${coordinate(innerRadius)},${coordinate(innerRadius)} 0 ${largeArc},${flag === 1 ? 0 : 1} `;
  const innerEnd = pointOf(polarToCartesian(cx, cy, innerRadius, endAngle));
  const innerStart = pointOf(polarToCartesian(cx, cy, innerRadius, startAngle));
  return `M${start}${outerArc}${outerEnd}L${innerEnd}${innerArc}${innerStart}Z`;
}

// Bands and series --------------------------------------------------------------------------------

/** The band a point belongs to: its own `label` when it carries one, otherwise its `x` as text. */
export const chartPointKey = (point: ChartPoint): string => point.label ?? String(point.x);

/** Every series' band keys as one first-appearance-ordered union, so a line, its bars, its grid and its table share one band order. */
export const collectBandKeys = (series: readonly ChartSeries[]): string[] => [
  ...new Set(series.flatMap((one) => one.points.map(chartPointKey))),
];

/**
 * Whether any series carries a finite point at all: the shared no-data predicate, so the three renderers
 * cannot disagree about what empty means. Deliberately not a total — a series of zeros is a period that
 * genuinely sold nothing, so emptiness is about the absence of points, never their sum.
 */
export const hasChartData = (series: readonly ChartSeries[]): boolean =>
  series.some((one) => one.points.some((point) => Number.isFinite(point.y)));

/** The sum of every finite point across the series, which is what a donut's centre total reads. */
export const chartSeriesTotal = (series: readonly ChartSeries[]): number =>
  series.reduce(
    (total, one) =>
      total + one.points.reduce((sum, point) => sum + (Number.isFinite(point.y) ? point.y : 0), 0),
    0,
  );

/** How many series colours `src/styles/tokens.css` declares: the count {@link seriesClassName} clamps into. */
export const SERIES_COUNT = CHART_SERIES_TOKEN_REFERENCES.length;

/**
 * The class that colours one series: `sp-chart__series-N`, where `N` is the position of the series' token
 * reference among the eight. A reference that is not one of the eight falls back to `index`, and any result
 * outside `1..SERIES_COUNT` is clamped into it. This is the only place the reference-to-class mapping
 * exists; the colour itself lives in the stylesheet, never here.
 */
export function seriesClassName(reference: string | undefined, index: number): string {
  const references: readonly string[] = CHART_SERIES_TOKEN_REFERENCES;
  const position = reference === undefined ? -1 : references.indexOf(reference);
  const fallback = Number.isFinite(index) ? Math.trunc(index) + 1 : 1;
  const oneBased = position >= 0 ? position + 1 : fallback;
  return `${SERIES_CLASS_PREFIX}${Math.min(Math.max(oneBased, 1), SERIES_COUNT)}`;
}

// Bars --------------------------------------------------------------------------------------------

/** The cumulative end value of each series at `key`, in series order; a series with no point there contributes `0`. */
export const stackValues = (series: readonly ChartSeries[], key: string): number[] => {
  let running = 0;
  return series.map((one) => (running += valueAt(one, key)));
};

/** The pixel `0` sits at, clamped into the range: the baseline bars grow from and fall to. */
export const zeroCoordinate = (scale: LinearScale): number => {
  const [start, end] = scale.range;
  return Math.min(Math.max(scale.scale(0), Math.min(start, end)), Math.max(start, end));
};

/**
 * One rect per band and then per series. `grouped` splits a band's bandwidth between the series and centres
 * each bar in its slot; `stacked` gives every series the whole bandwidth and starts each bar where the one
 * below it ended, read from {@link stackValues}. `orientation` decides which rectangle side the value scale
 * governs, so a horizontal chart needs no transposition. A zero or negative value still produces a rect, and
 * a rect reaching past the frame is trimmed to `plotArea` rather than painted over the axis.
 */
export function buildBarRects(options: {
  readonly series: readonly ChartSeries[];
  readonly bandScale: BandScale;
  readonly valueScale: LinearScale;
  readonly orientation: Orientation;
  readonly mode: BarMode;
  readonly plotArea: PlotArea;
}): BarRect[] {
  const { series, bandScale, valueScale, orientation, mode, plotArea } = options;
  const slot = bandScale.bandwidth / Math.max(1, series.length);
  const bar = mode === "grouped" ? slot * (1 - BAR_INNER_GAP) : bandScale.bandwidth;
  const vertical = orientation === "vertical";
  return bandScale.ticks().flatMap((key) => {
    const ends = mode === "stacked" ? stackValues(series, key) : [];
    const origin = bandScale.scale(key);
    return series.map((one, index) => {
      const from = valueScale.scale(mode === "stacked" && index > 0 ? ends[index - 1] : 0);
      const to = valueScale.scale(mode === "stacked" ? ends[index] : valueAt(one, key));
      const offset = mode === "grouped" ? index * slot + (slot - bar) / 2 : 0;
      const low = Math.min(from, to);
      const extent = Math.abs(to - from);
      const rect: BarRect = {
        key,
        seriesId: one.id,
        seriesIndex: index,
        x: vertical ? origin + offset : low,
        y: vertical ? low : origin + offset,
        width: vertical ? bar : extent,
        height: vertical ? extent : bar,
        value: valueAt(one, key),
      };
      return trimToPlotArea(rect, plotArea);
    });
  });
}

// Donut -------------------------------------------------------------------------------------------

/**
 * One slice per series, valued as the sum of that series' positive points and ordered as the series arrive,
 * with each slice's mid-angle label position. A total that is not a positive finite number yields no slices
 * at all, so a share is never divided by zero, and a series totalling zero or less draws none, having no
 * area. The closing slice ends exactly on the full turn, so a ring has no hairline gap.
 */
export function buildDonutArcs(options: {
  readonly series: readonly ChartSeries[];
  readonly cx: number;
  readonly cy: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly formatValue?: ValueFormatter;
}): ArcDatum[] {
  const { series, cx, cy, outerRadius, innerRadius } = options;
  const format = options.formatValue ?? AXIS_NUMBER_FORMAT;
  const values = series.map((one) =>
    one.points.reduce(
      (sum, point) => sum + (Number.isFinite(point.y) && point.y > 0 ? point.y : 0),
      0,
    ),
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  const arcs: ArcDatum[] = [];
  let cursor = 0;
  series.forEach((one, index) => {
    const value = values[index];
    if (value <= 0) return;
    const share = value / total;
    const startAngle = cursor * FULL_TURN_DEGREES;
    const closesRing = cursor + share >= 1 - SHARE_EPSILON;
    const endAngle = closesRing ? FULL_TURN_DEGREES : (cursor + share) * FULL_TURN_DEGREES;
    const midAngle = startAngle + (endAngle - startAngle) / 2;
    const radius = innerRadius + (outerRadius - innerRadius) * SLICE_LABEL_RADIUS_RATIO;
    const label = polarToCartesian(cx, cy, radius, midAngle);
    cursor += share;
    arcs.push({
      id: one.id,
      label: one.label,
      value,
      share,
      path: arcPath({ cx, cy, outerRadius, innerRadius, startAngle, endAngle }),
      midAngle,
      labelX: label.x,
      labelY: label.y,
      seriesIndex: index,
      formattedValue: format(value),
    });
  });
  return arcs;
}

// Data tables -------------------------------------------------------------------------------------

/**
 * One row per band key, one cell per series, and the series labels as the columns. A band a series does not
 * carry displays the formatted zero, because a sparse revenue series means no revenue in that period rather
 * than a missing figure. The leading column heading is `options.labelHeader`, which the renderer takes from
 * `src/constants/content.ts`; absent, it renders empty rather than invented.
 */
export function buildSeriesDataTable(
  series: readonly ChartSeries[],
  formatValue: ValueFormatter,
  options: TableHeadings = {},
): ChartDataTable {
  const rows = collectBandKeys(series).map((key) => ({
    key,
    label: pointLabelAt(series, key) ?? defaultLabelFormatter(key),
    cells: series.map((one) => formatValue(valueAt(one, key))),
  }));
  return { columns: [options.labelHeader ?? "", ...series.map((one) => one.label)], rows };
}

/** One row per slice, carrying the slice's label, its formatted value and its formatted share. */
export function buildSliceDataTable(
  arcs: readonly ArcDatum[],
  formatValue: ValueFormatter,
  shareFormatter: ValueFormatter,
  options: TableHeadings = {},
): ChartDataTable {
  return {
    columns: [options.labelHeader ?? "", options.valueHeader ?? "", options.shareHeader ?? ""],
    rows: arcs.map((arc) => ({
      key: arc.id,
      label: arc.label,
      cells: [formatValue(arc.value), shareFormatter(arc.share)],
    })),
  };
}

// Internal helpers --------------------------------------------------------------------------------

/** `0` for either signed zero, so a coordinate never carries a sign it does not mean. */
const normalizeZero = (value: number): number => (value === 0 ? 0 : value);

/** A coordinate as the short text an SVG path carries: two decimals, with either signed zero written `0`. */
const coordinate = (value: number): string =>
  String(normalizeZero(Number(value.toFixed(COORDINATE_DECIMALS))));

/** A point as the `x,y` pair an SVG command takes. */
const pointOf = (point: Point2D): string => `${coordinate(point.x)},${coordinate(point.y)}`;

/** The value a series carries at a band: `0` when it has no point there or the point is not finite. */
const valueAt = (series: ChartSeries, key: string): number => {
  const point = series.points.find((candidate) => chartPointKey(candidate) === key);
  return point !== undefined && Number.isFinite(point.y) ? point.y : 0;
};

/** The display label the series give a band, if any of them gives one at all. */
const pointLabelAt = (series: readonly ChartSeries[], key: string): string | undefined =>
  series
    .map((one) => one.points.find((point) => chartPointKey(point) === key))
    .find((point) => point !== undefined)?.label;

/** A bar trimmed to the frame, so a value outside the domain cannot paint over the axis. */
const trimToPlotArea = (rect: BarRect, plotArea: PlotArea): BarRect => {
  const left = Math.max(rect.x, plotArea.x);
  const top = Math.max(rect.y, plotArea.y);
  const right = Math.min(rect.x + rect.width, plotArea.x + plotArea.width);
  const bottom = Math.min(rect.y + rect.height, plotArea.y + plotArea.height);
  return {
    ...rect,
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
};

/** A closed ring as two half arcs out and two back, because one arc cannot close on the point it starts from. */
const fullRingPath = (cx: number, cy: number, outerRadius: number, innerRadius: number): string => {
  const outerTop = pointOf(polarToCartesian(cx, cy, outerRadius, 0));
  const outerBottom = pointOf(polarToCartesian(cx, cy, outerRadius, 180));
  const outerArc = `A${coordinate(outerRadius)},${coordinate(outerRadius)} 0 1,1 `;
  if (innerRadius <= 0) return `M${outerTop}${outerArc}${outerBottom}${outerArc}${outerTop}Z`;
  const innerTop = pointOf(polarToCartesian(cx, cy, innerRadius, 0));
  const innerBottom = pointOf(polarToCartesian(cx, cy, innerRadius, 180));
  const innerArc = `A${coordinate(innerRadius)},${coordinate(innerRadius)} 0 1,0 `;
  return `M${outerTop}${outerArc}${outerBottom}${outerArc}${outerTop}L${innerTop}${innerArc}${innerBottom}${innerArc}${innerTop}Z`;
};
