/**
 * Path: src/components/charts/barGeometry.ts
 * Purpose: The bar renderer's own geometry: its scales, its marks, its value labels and its readout placement
 * Lines: 446
 */

import type { CSSProperties } from "react";

import {
  CHART_VIEWBOX_WIDTH,
  DEFAULT_CHART_HEIGHT,
  DEFAULT_PADDING,
  LABEL_FONT_SIZE,
  TICK_GAP,
  WHOLE_NUMBER_STEP,
  axisLabelTransform,
  bandAxisPadding,
  buildBandTicks,
  buildBarRects,
  buildValueTicks,
  collectBandKeys,
  computePlotArea,
  createBandScale,
  createLinearScale,
  estimateLabelWidth,
  extendDomainToIncludeZero,
  gridLineFor,
  hasWholeValues,
  seriesClassName,
  stackValues,
  zeroCoordinate,
} from "@/components/charts/chartScales";
import type {
  AxisLabelTransform,
  AxisValueFormatter,
  BandScale,
  BarMode,
  BarRect,
  GridLine,
  LabelFormatter,
  LinearScale,
  Orientation,
  Padding,
  PlotArea,
  TickMark,
  ValueFormatter,
} from "@/components/charts/chartScales";
import type { ChartSeries } from "@/types/analytics";

/**
 * Why this file exists beside `BarChart.tsx`: the bar renderer is one concern but more than one file may
 * hold, so the plan's 600-line ceiling splits it. This half is the mathematics — the frame the bars are
 * drawn in, the two scales they are placed by, the marks a render paints, the labels written against them
 * and the offset a readout takes over a band; `BarChart.tsx` keeps the props surface, the interaction and
 * the markup. The split is one-way: this file imports nothing from the renderer.
 *
 * The contract the whole file keeps: pure, `readonly` input it never mutates, a fresh value out, and no read
 * of the document, the clock or the platform — so the geometry is testable without mounting SVG. No colour,
 * `stroke`, `fill` or copy appears here either: `src/styles/tokens.css` owns the series tokens,
 * `src/styles/admin-reports.css` maps them onto the classes named below, and every word a chart shows
 * arrives as a formatter the renderer supplies.
 */

// Constants ---------------------------------------------------------------------------------------

/**
 * The bar thickness a value label needs before it is drawn, per orientation. A vertical bar is labelled
 * across itself, so it must be as wide as a compact money figure is long — about 38 units at this frame's
 * viewBox, two thirds of which keeps a gap between the labels of neighbouring bars — while a horizontal bar
 * is labelled beside itself and need only be as tall as one line of the sheet's smallest type. Measured on
 * the bar's shorter side, so the thin segment of a stack loses its label rather than landing on the segment
 * beside it; either way the figure stays in the paired data table.
 */
const MIN_LABEL_BAR_SIZE: Readonly<Record<Orientation, number>> = { vertical: 32, horizontal: 16 };

/** The gap between a bar's outer end and its value label, so the label never touches the bar it names. */
const VALUE_LABEL_GAP = 8;

/**
 * The insets the two orientations are drawn with, each reserving the room a value label needs beyond the end
 * of the tallest bar — above the plot for a vertical chart, to its right for a horizontal one, where a
 * compact money figure is about sixty user units long — and a horizontal chart's leading side taking the room
 * a vertical chart spends on its value axis, because the label a band carries is written down it.
 */
const VERTICAL_PADDING: Padding = { ...DEFAULT_PADDING, top: 28 };

/**
 * The gutter a horizontal chart's band labels are written in when they are short: the leading inset a run of
 * bucket or segment names such as "Week of Jan 27" has always been drawn in, so a chart whose labels fit it
 * renders exactly as it did and {@link bandLabelGutter} widens it only for a label that needs the room.
 */
const MIN_BAND_LABEL_GUTTER = 120;

/**
 * The narrowest plot a horizontal chart is drawn with, in user units — a quarter of this frame's width, which
 * is what a bar needs to be read against another — and so the point past which {@link bandLabelGutter} stops
 * widening the leading gutter. A band label longer than the frame can spare is written beyond the frame's
 * leading edge rather than leaving every bar it is drawn beside without a plot to be read across.
 */
const MIN_HORIZONTAL_PLOT_WIDTH = 200;

/**
 * {@link VERTICAL_PADDING}, with the two insets a horizontal chart's own labels need: the room a value label
 * takes beyond the end of the longest bar on the trailing side, and the leading gutter its band labels are
 * written in, which {@link bandLabelGutter} measures for each render rather than fixing here.
 */
const HORIZONTAL_PADDING: Padding = {
  ...DEFAULT_PADDING,
  top: 28,
  right: 72,
  left: MIN_BAND_LABEL_GUTTER,
};

/** A value this close to nothing is nothing: no extent, and so no label to write. */
const VALUE_EPSILON = 1e-9;

/** The decimals a readout's offset carries, so the custom properties it sets are identical every render. */
const PERCENT_DECIMALS = 2;

// Types -------------------------------------------------------------------------------------------

/** The placement a readout takes, in the custom properties `src/styles/admin-reports.css` substitutes. */
type ReadoutStyle = CSSProperties & Record<`--${string}`, string>;

/** The four sides of a mark's rectangle. */
type MarkArea = Pick<BarRect, "x" | "y" | "width" | "height">;

/** One bar as it is drawn: its identity, its band, the series class it paints through and its rectangle. */
interface BarMark {
  readonly id: string;
  readonly bandKey: string;
  readonly className: string;
  readonly area: MarkArea;
}

/** One band's pointer region. */
interface BandHitRect {
  readonly id: string;
  readonly area: MarkArea;
}

/** One text mark: its identity, the class that paints it, the words it shows and the transform anchoring it. */
interface ChartTextMark {
  readonly id: string;
  readonly className: string;
  readonly text: string;
  readonly transform: AxisLabelTransform;
}

/** A grid line with the tick that drew it, so the mark keeps a stable key across renders. */
interface GridLineMark {
  readonly tick: TickMark;
  readonly line: GridLine;
}

/** The geometry one render is drawn from: the scales, the marks placed by them and the words that read them. */
export interface BarGeometry {
  readonly bandKeys: readonly string[];
  readonly plotArea: PlotArea;
  readonly bandScale: BandScale;
  readonly valueScale: LinearScale;
  readonly baseline: number;
  readonly axisLine: GridLine;
  readonly gridLines: readonly GridLineMark[];
  readonly bars: readonly BarMark[];
  readonly textMarks: readonly ChartTextMark[];
  readonly hitRects: readonly BandHitRect[];
}

/** Everything {@link buildGeometry} needs: the series, the frame, and the readings the marks are written with. */
export interface BarGeometryOptions {
  readonly series: readonly ChartSeries[];
  readonly height: number;
  readonly orientation: Orientation;
  readonly mode: BarMode;
  readonly includeZero: boolean;
  readonly showValues: boolean;
  readonly formatValue: ValueFormatter;
  readonly formatAxisValue: AxisValueFormatter;
  readonly formatLabel: LabelFormatter;
}

// Helpers -----------------------------------------------------------------------------------------

/**
 * Whether a bar is roomy enough to carry its own value label: it must have an extent at all, because a
 * zero-length bar has no outer end to write beyond, and its shorter side must reach the thickness
 * {@link MIN_LABEL_BAR_SIZE} asks of that orientation, which the segment of a stack rarely does.
 */
function hasLabelRoom(rect: BarRect, orientation: Orientation): boolean {
  const thickness = Math.min(rect.width, rect.height);
  return Math.abs(rect.value) > VALUE_EPSILON && thickness >= MIN_LABEL_BAR_SIZE[orientation];
}

/** Where a bar's value label sits: past its outer end, and below itself for a value under the baseline. */
function valueLabelTransform(rect: BarRect, orientation: Orientation): AxisLabelTransform {
  const positive = rect.value >= 0;
  if (orientation === "vertical") {
    const edge = positive ? rect.y : rect.y + rect.height;
    return {
      x: rect.x + rect.width / 2,
      y: positive ? edge - VALUE_LABEL_GAP : edge + VALUE_LABEL_GAP,
      textAnchor: "middle",
      dominantBaseline: positive ? "auto" : "hanging",
    };
  }
  const edge = positive ? rect.x + rect.width : rect.x;
  return {
    x: positive ? edge + VALUE_LABEL_GAP : edge - VALUE_LABEL_GAP,
    y: rect.y + rect.height / 2,
    textAnchor: positive ? "start" : "end",
    dominantBaseline: "middle",
  };
}

/**
 * The gutter a horizontal chart reserves for its band labels: the widest label its band axis holds, measured by
 * {@link estimateLabelWidth} — the one home of that rule — plus the gap that axis keeps to the plot, and never
 * less than {@link MIN_BAND_LABEL_GUTTER} nor so much that {@link MIN_HORIZONTAL_PLOT_WIDTH} is left for the
 * bars. A band label is anchored at its own end and written away from the plot's leading edge, so a gutter
 * narrower than this cuts its leading glyphs, and a report's product names run two to three times the width a
 * bucket name needs. Every label the axis writes is one of the keys these were read from — the anti-collision
 * rule only ever drops a label — so no drawn label is wider than the gutter measured from them all.
 */
function bandLabelGutter(labels: readonly string[]): number {
  const widest = labels.reduce((widest, label) => Math.max(widest, estimateLabelWidth(label)), 0);
  const most = Math.max(
    MIN_BAND_LABEL_GUTTER,
    CHART_VIEWBOX_WIDTH - HORIZONTAL_PADDING.right - MIN_HORIZONTAL_PLOT_WIDTH,
  );
  return Math.min(Math.max(widest + TICK_GAP, MIN_BAND_LABEL_GUTTER), most);
}

/**
 * One pointer region per band: the whole band along the categorical axis and the whole plot across it, so a
 * pointer anywhere over a band names it, gaps between grouped bars and the space above a short bar included.
 * The regions tile the plot without overlapping, since a band starts one step after the band before it.
 */
function buildBandHitRects(
  bandScale: BandScale,
  plotArea: PlotArea,
  orientation: Orientation,
): BandHitRect[] {
  return bandScale.ticks().map((key) => {
    const start = bandScale.scale(key);
    return {
      id: key,
      area:
        orientation === "vertical"
          ? { x: start, y: plotArea.y, width: bandScale.step, height: plotArea.height }
          : { x: plotArea.x, y: start, width: plotArea.width, height: bandScale.step },
    };
  });
}

/** Every value plotted: each point of a grouped chart, each accumulated end of a stacked one. */
function plottedValues(
  series: readonly ChartSeries[],
  bandKeys: readonly string[],
  mode: BarMode,
): number[] {
  if (mode === "stacked") return bandKeys.flatMap((key) => stackValues(series, key));
  return series.flatMap((one) =>
    one.points.filter((point) => Number.isFinite(point.y)).map((point) => point.y),
  );
}

/**
 * The domain the value axis spans, read from the values actually plotted and widened to carry zero unless the
 * caller asked for a deliberate zoom — where a bar reaching past the frame is trimmed to the plot rather than
 * painted over the axis. A pair that is equal — the shape an empty input and an all-zero one both reach — is
 * resolved to the single value it holds, whose axis draws one tick on the baseline, so an axis is never drawn
 * from `NaN` and never from a span of invented figures either.
 */
function valueDomain(values: readonly number[], includeZero: boolean): readonly [number, number] {
  const low = values.length === 0 ? 0 : Math.min(...values);
  const high = values.length === 0 ? 0 : Math.max(...values);
  return includeZero ? extendDomainToIncludeZero([low, high]) : [low, high];
}

/**
 * The geometry one render is drawn from, computed in one pass so the bars, the grid, the axis, the labels and
 * the pointer regions all read one band order and one pair of scales. A horizontal chart builds its scales
 * with their ranges swapped rather than transposing a coordinate afterwards, and nothing here reads a measured
 * pixel: the frame is the viewBox the marks are drawn in. The one reading taken of the content rather than the
 * frame is the room the band labels take, which sets the frame's insets before the plot is computed: a
 * horizontal chart's leading gutter, because a product name is longer than any fixed gutter and a clipped one
 * names nothing, and a vertical chart's two horizontal ends, because the first and last band label are centred
 * half a label nearer the frame's edges than the plot reaches.
 *
 * @param options - The series, the frame's height, the orientation, the mode and the three formatters.
 * @returns The scales and every mark placed by them.
 */
export function buildGeometry(options: BarGeometryOptions): BarGeometry {
  const { series, height, orientation, mode, includeZero } = options;
  const horizontal = orientation === "horizontal";
  const bandKeys = collectBandKeys(series);
  // The labels the band axis will write are read before the frame is computed, because they are what the frame's
  // room for them is measured from: a horizontal chart's leading gutter, which narrows the value direction alone
  // because the band axis the labels belong to runs down the frame rather than across it, and a vertical chart's
  // two horizontal ends, which the first and last centred label overhang.
  const bandLabels = bandKeys.map((key) => options.formatLabel(key));
  const padding = horizontal
    ? { ...HORIZONTAL_PADDING, left: bandLabelGutter(bandLabels) }
    : bandAxisPadding(VERTICAL_PADDING, bandLabels);
  const plotArea = computePlotArea({
    width: CHART_VIEWBOX_WIDTH,
    height,
    padding,
  });
  const acrossStart = horizontal ? plotArea.y : plotArea.x;
  const acrossSpan = horizontal ? plotArea.height : plotArea.width;
  const downStart = horizontal ? plotArea.x : plotArea.y;
  const downSpan = horizontal ? plotArea.width : plotArea.height;
  // The value axis runs in the frame's own direction for a horizontal chart, leading edge to trailing edge,
  // and against it for a vertical one, where the frame's `y` grows downward and the bars must grow up.
  const bandRange: readonly [number, number] = [acrossStart, acrossStart + acrossSpan];
  const valueRange: readonly [number, number] = horizontal
    ? [downStart, downStart + downSpan]
    : [downStart + downSpan, downStart];
  const bandScale = createBandScale({ domain: bandKeys, range: bandRange });
  // A series of whole numbers is a count of people, orders or units, so its axis is ticked in whole numbers
  // rather than at fractions of one; a metric that carries decimals — money in minor units is whole too, and
  // its steps are far larger than a minor unit — keeps the step the ladder chooses.
  const valueScale = createLinearScale({
    domain: valueDomain(plottedValues(series, bandKeys, mode), includeZero),
    range: valueRange,
    nice: true,
    minimumStep: hasWholeValues(series) ? WHOLE_NUMBER_STEP : undefined,
  });
  const baseline = zeroCoordinate(valueScale);
  const rects = buildBarRects({ series, bandScale, valueScale, orientation, mode, plotArea });
  const valueTicks = buildValueTicks(valueScale, options.formatAxisValue);
  // A band key names where a band starts; its label belongs over the region the bars are drawn in. A label is
  // thinned by the room it takes along the axis it is written across — the plot's width for a vertical chart —
  // and by one line of type where it is written down that axis, which is a horizontal chart's band axis.
  const bandTicks = buildBandTicks(bandScale, options.formatLabel, {
    axisLength: horizontal ? plotArea.height : plotArea.width,
    measureLabel: horizontal ? () => LABEL_FONT_SIZE : estimateLabelWidth,
  }).map((tick) => ({
    key: tick.key,
    label: tick.label,
    position: tick.position + bandScale.bandwidth / 2,
  }));
  const axisTicks: Array<{ id: string; text: string; axis: "value" | "band"; position: number }> = [
    ...valueTicks.map((tick) => ({
      id: `value-${String(tick.value)}`,
      text: tick.label,
      axis: "value" as const,
      position: tick.position,
    })),
    ...bandTicks.map((tick) => ({
      id: `band-${tick.key}`,
      text: tick.label,
      axis: "band" as const,
      position: tick.position,
    })),
  ];
  // A segment of a stack ends where the segment above it begins, so a value label written past its outer end
  // lands on the neighbouring segment's fill — where the sheet's label colour, which is drawn for a surface,
  // is unreadable — and a label drawn inside the segment fares no better over that same fill. A stack
  // therefore labels no segment: the readout reports every series' value for the band the visitor points at or
  // steps through, the legend totals the series, and the paired data table carries all of them.
  const labelsBars = options.showValues && mode === "grouped";
  const textMarks: ChartTextMark[] = [
    ...axisTicks.map((tick) => ({
      id: tick.id,
      className: "sp-chart__tick",
      text: tick.text,
      transform: axisLabelTransform(orientation, tick.axis, plotArea, tick.position),
    })),
    ...rects
      .filter((rect) => labelsBars && hasLabelRoom(rect, orientation))
      .map((rect) => ({
        id: `value-${rect.seriesId}-${rect.key}`,
        className: "sp-chart__label",
        text: options.formatValue(rect.value),
        transform: valueLabelTransform(rect, orientation),
      })),
  ];
  const gridLines = valueTicks
    // The baseline is the axis the bars stand on, so a grid line landing on it is left out rather than drawn
    // twice in the same place.
    .filter((tick) => Math.abs(tick.position - baseline) > VALUE_EPSILON)
    .map((tick) => ({ tick, line: gridLineFor(orientation, plotArea, tick.position) }));
  return {
    bandKeys,
    plotArea,
    bandScale,
    valueScale,
    baseline,
    axisLine: gridLineFor(orientation, plotArea, baseline),
    gridLines,
    textMarks,
    bars: rects.map((rect) => ({
      id: `${rect.seriesId}-${rect.key}`,
      bandKey: rect.key,
      className: `sp-chart__bar ${seriesClassName(series[rect.seriesIndex]?.color, rect.seriesIndex)}`,
      area: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    })),
    hitRects: buildBandHitRects(bandScale, plotArea, orientation),
  };
}

/** A frame-relative offset as the percentage a readout's custom properties are set in, held inside the frame. */
function percentOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Number(Math.min(Math.max((value / total) * 100, 0), 100).toFixed(PERCENT_DECIMALS));
}

/**
 * Where the readout sits over the active band: its inline offset at the band's centre and its block offset at
 * the outer end of that band's bars, both as percentages of the frame — the box the stylesheet clamps them
 * inside. Percentages keep the placement free of any measured pixel, so it is the same wherever the chart is
 * rendered and however wide its container turns out to be.
 *
 * @param geometry - The geometry the active band was drawn from.
 * @param bandKey - The band the readout is reporting.
 * @param height - The frame's height in user units, the readout's own percentage basis.
 * @param horizontal - Whether the bars run sideways, which swaps the two offsets.
 * @returns The readout's placement, as the two custom properties it is set with.
 */
export function readoutStyle(
  geometry: BarGeometry,
  bandKey: string,
  height: number,
  horizontal: boolean,
): ReadoutStyle {
  const centre = geometry.bandScale.scale(bandKey) + geometry.bandScale.bandwidth / 2;
  const edges = geometry.bars
    .filter((mark) => mark.bandKey === bandKey)
    .map((mark) => (horizontal ? mark.area.x + mark.area.width : mark.area.y));
  const spans = edges.length === 0 ? [centre] : edges;
  const outer = horizontal ? Math.max(...spans) : Math.min(...spans);
  const inline = horizontal ? outer : centre;
  const block = horizontal ? centre : outer;
  return {
    "--sp-chart-readout-x": `${percentOf(inline, CHART_VIEWBOX_WIDTH)}%`,
    "--sp-chart-readout-y": `${percentOf(block, height)}%`,
  };
}

/** The frame height a render uses: the caller's value where it is a usable number of units, else the default. */
export function resolveHeight(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CHART_HEIGHT;
}
