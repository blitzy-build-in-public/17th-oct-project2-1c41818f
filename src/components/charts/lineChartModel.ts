/**
 * Path: src/components/charts/lineChartModel.ts
 * Purpose: The line chart's plot model: its scales, axis ticks, series paths, pointer areas and readout placement
 * Lines: 256
 */

import type { CSSProperties } from "react";

import {
  CHART_VIEWBOX_WIDTH,
  DEFAULT_PADDING,
  POINT_MARK_LIMIT,
  WHOLE_NUMBER_STEP,
  bandAxisPadding,
  buildAreaPath,
  buildBandTicks,
  buildLinePath,
  buildSeriesDataTable,
  buildValueTicks,
  chartPointKey,
  computePlotArea,
  createBandScale,
  createLinearScale,
  estimateLabelWidth,
  extendDomainToIncludeZero,
  hasWholeValues,
  seriesClassName,
  zeroCoordinate,
} from "@/components/charts/chartScales";
import { indexSeriesPoints, indexedFiniteValueAt } from "@/components/charts/chartGeometry";
import type { SeriesPointIndex } from "@/components/charts/chartGeometry";
import type {
  AxisValueFormatter,
  BandScale,
  BandTick,
  ChartDataTable,
  LabelFormatter,
  LinearScale,
  PlotArea,
  Point2D,
  TickMark,
  ValueFormatter,
} from "@/components/charts/chartScales";
import { DATE_RANGE_COPY } from "@/constants/content-reports";
import type { ChartSeries } from "@/types/analytics";

/**
 * Why this file exists beside `LineChart.tsx`: the line renderer's coordinate work is one concern but
 * more than one file may hold under the request's 600-line ceiling, so the plan's §0.5.5 split rule is
 * applied here as it already is to `chartScales.ts` and `chartGeometry.ts`. This half builds the model a
 * render is drawn from — the scales, the axis ticks, the series paths, the pointer areas and the readout's
 * placement — and `LineChart.tsx` turns that model into elements. Nothing here imports the renderer, so
 * the dependency runs one way.
 *
 * Every coordinate comes from `@/components/charts/chartScales` over the caller's own data, and nothing
 * here reads an element's size, the document or the clock, so the geometry is a pure function of its
 * arguments and is testable without mounting anything. No colour, `stroke`, `fill` or copy is written
 * here either: `src/styles/tokens.css` owns `--chart-series-N`, `src/styles/chart-series.css` maps it
 * onto the class {@link seriesClassName} names, and the only string that leaves this file is the table's
 * leading column heading, which comes from `src/constants/content.ts`.
 */

/** How far above the highest marker of the active band the readout floats, in viewBox units. */
export const READOUT_LIFT = 10;

/** The domain a chart with no finite point falls back to, so its scales stay defined. */
const EMPTY_DOMAIN: readonly [number, number] = [0, 1];

/** A style object that also carries the readout's three geometry custom properties. */
export type ChartStyle = CSSProperties & Record<`--${string}`, string>;

/** What the readout shows: its words, and the placement already computed into its style. */
export interface Readout {
  readonly text: string;
  readonly style: ChartStyle;
}

/** One series' drawn geometry: the class that colours it, its two paths and its markers. */
export interface SeriesMarks {
  readonly id: string;
  readonly className: string;
  readonly linePath: string;
  readonly areaPath: string;
  readonly markers: readonly Point2D[];
}

/** One band's pointer area: the rectangle a pointer move selects that band with. */
export interface BandHit {
  readonly key: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Everything one render of the plot draws, all of it derived from the props that produced it. */
export interface PlotModel {
  readonly bandKeys: readonly string[];
  readonly bandScale: BandScale;
  readonly valueScale: LinearScale;
  readonly plotArea: PlotArea;
  readonly valueTicks: readonly TickMark[];
  readonly bandTicks: readonly BandTick[];
  readonly marks: readonly SeriesMarks[];
  readonly hits: readonly BandHit[];
  readonly dataTable: ChartDataTable;
  /**
   * Each series' points keyed by band, built once with the model: the readout resolves a band through one
   * map hit per series rather than a scan of the series' points, and nothing else needs a band identity.
   */
  readonly pointIndexes: readonly SeriesPointIndex[];
}

/** What {@link buildPlotModel} is handed: the series, the resolved frame and the formatters. */
export interface PlotModelOptions {
  readonly series: readonly ChartSeries[];
  readonly bandKeys: readonly string[];
  readonly height: number;
  readonly includeZero: boolean;
  readonly area: boolean;
  readonly showPoints: boolean;
  readonly formatValue: ValueFormatter;
  readonly formatAxisValue: AxisValueFormatter;
  readonly formatLabel: LabelFormatter;
}

/**
 * The y a series carries at a band, or `undefined` when it has no finite point there.
 *
 * The one-off form of {@link indexedFiniteValueAt}: a caller resolving many (series, band) pairs — the
 * readout resolving one band across twelve series, the model drawing twelve series across 366 bands —
 * builds the indexes once with {@link indexSeriesPoints} instead.
 */
export function finiteValueAt(series: ChartSeries, key: string): number | undefined {
  const point = series.points.find((candidate) => chartPointKey(candidate) === key);
  return point !== undefined && Number.isFinite(point.y) ? point.y : undefined;
}

/** The finite extent of every series' points, or `undefined` when not one of them is a number. */
function finiteExtent(series: readonly ChartSeries[]): readonly [number, number] | undefined {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  series.forEach((one) =>
    one.points.forEach((point) => {
      if (!Number.isFinite(point.y)) return;
      low = Math.min(low, point.y);
      high = Math.max(high, point.y);
    }),
  );
  return low <= high ? [low, high] : undefined;
}

/** The pixel a band is centred on, which is where its mark, its axis label and the readout all sit. */
export function bandCentre(scale: BandScale, key: string): number {
  return scale.scale(key) + scale.bandwidth / 2;
}

/**
 * Builds everything one render of the plot draws, from the series it is handed.
 *
 * The bands come from `collectBandKeys`, the band scale spreads them across the plot width, and the value
 * scale spans the finite extent of the series, widened to carry zero when the axis is asked to.
 * A band a series does not carry is drawn, and tabulated, as zero: a sparse revenue series means no
 * revenue in that period rather than a missing figure. Markers are drawn only while a series carries at
 * most `POINT_MARK_LIMIT` bands, because past it they would merge into the line they mark.
 *
 * The band labels are worded before the frame is computed, because two of its insets are the room the first
 * and last centred label need and the axis thins its labels by the room they take across the plot. A metric of
 * whole numbers — a count of people, orders or units — is ticked in whole numbers, and its axis, like every
 * value axis here, is written by the formatter the caller supplies, handed the domain it spans.
 *
 * @param options - The series, the band keys, the resolved frame and the formatters to write it with.
 * @returns The scales, the axis ticks, the series marks, the pointer areas and the paired data table.
 */
export function buildPlotModel(options: PlotModelOptions): PlotModel {
  const {
    series,
    bandKeys,
    height,
    includeZero,
    area,
    showPoints,
    formatValue,
    formatAxisValue,
    formatLabel,
  } = options;
  const bandLabels = bandKeys.map((key) => formatLabel(key));
  const plotArea = computePlotArea({
    width: CHART_VIEWBOX_WIDTH,
    height,
    padding: bandAxisPadding(DEFAULT_PADDING, bandLabels),
  });
  const bandScale = createBandScale({
    domain: bandKeys,
    range: [plotArea.x, plotArea.x + plotArea.width],
  });
  const extent = finiteExtent(series) ?? EMPTY_DOMAIN;
  const valueScale = createLinearScale({
    domain: includeZero ? extendDomainToIncludeZero(extent) : extent,
    range: [plotArea.y + plotArea.height, plotArea.y],
    nice: true,
    minimumStep: hasWholeValues(series) ? WHOLE_NUMBER_STEP : undefined,
  });
  const baselineY = includeZero ? zeroCoordinate(valueScale) : plotArea.y + plotArea.height;
  // Each series is indexed once for the whole model: the marks below ask for a (series, band) pair for every
  // band of every series, which is what made twelve categories over a 366-day range the costliest to draw.
  const pointIndexes = series.map(indexSeriesPoints);
  const marks = series.map((one, index) => {
    const points = pointIndexes[index];
    const positions: Point2D[] = bandKeys.map((key) => ({
      x: bandCentre(bandScale, key),
      y: valueScale.scale(indexedFiniteValueAt(points, key) ?? 0),
    }));
    return {
      id: one.id,
      className: seriesClassName(one.color, index),
      linePath: buildLinePath(positions),
      areaPath: area ? buildAreaPath(positions, baselineY) : "",
      markers: showPoints && positions.length <= POINT_MARK_LIMIT ? positions : [],
    };
  });
  // Each band's pointer area spans its whole step, so adjacent bands tile without a gap a pointer could
  // fall through, while the first and last are trimmed to the plot rather than overhanging the axis.
  const half = bandScale.step / 2;
  const hits = bandKeys.map((key, index) => {
    const centre = bandCentre(bandScale, key);
    const left = Math.max(plotArea.x, centre - half);
    const right = Math.min(plotArea.x + plotArea.width, centre + half);
    return {
      key,
      index,
      x: left,
      y: plotArea.y,
      width: Math.max(0, right - left),
      height: plotArea.height,
    };
  });
  return {
    bandKeys,
    bandScale,
    valueScale,
    plotArea,
    valueTicks: buildValueTicks(valueScale, formatAxisValue),
    // A band label is written across the axis and centred on its band, so the thinning measures the room one
    // takes along the plot and the frame reserves half of the widest at either end.
    bandTicks: buildBandTicks(bandScale, formatLabel, {
      axisLength: plotArea.width,
      measureLabel: estimateLabelWidth,
    }),
    marks,
    hits,
    dataTable: buildSeriesDataTable(series, formatValue, { labelHeader: DATE_RANGE_COPY.LABEL }),
    pointIndexes,
  };
}
