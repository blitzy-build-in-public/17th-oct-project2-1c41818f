/**
 * Path: src/components/charts/LineChart.tsx
 * Purpose: Accessible line and area chart with grid, axis ticks, hover readout and a data-table alternative
 * Lines: 483
 */

import { useCallback, useId, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react";

import { ChartDataTable } from "@/components/charts/ChartDataTable";
import {
  CHART_VIEWBOX_WIDTH,
  DEFAULT_CHART_HEIGHT,
  axisLabelTransform,
  chartSeriesTotal,
  collectBandKeys,
  defaultLabelFormatter,
  gridLineFor,
  hasChartData,
  seriesClassName,
} from "@/components/charts/chartScales";
import type {
  AxisValueFormatter,
  LabelFormatter,
  ValueFormatter,
} from "@/components/charts/chartScales";
import { indexedFiniteValueAt } from "@/components/charts/chartGeometry";
import { READOUT_LIFT, bandCentre, buildPlotModel } from "@/components/charts/lineChartModel";
import { readoutPlacement } from "@/components/charts/readoutPlacement";
import type { Readout } from "@/components/charts/lineChartModel";
import { EmptyState } from "@/components/ui/Feedback";
import { APP_COPY, EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import type { PagingNoun } from "@/constants/content";
import type { ChartSeries } from "@/types/analytics";
import { formatMoney, formatMoneyAxis } from "@/utils/format";

/*
 * Class contract: `src/styles/admin-reports.css` owns this family and `src/styles/data-display.css` owns
 * the `sp-table` primitive the paired table composes, so every class below is consumed by name —
 * `sp-chart` with its `__header`, `__title`, `__controls`, `__frame`, `__svg`, `__grid-line`,
 * `__axis-line`, `__tick`, `__readout`, `__legend` (with `__legend-item`, `__legend-swatch`,
 * `__legend-label`, `__legend-value`), `__point`, `__data` and `__empty`, plus the `sp-chart__series-N`
 * names `seriesClassName` resolves — and no colour, stroke, fill, radius or pixel media query is written
 * here.
 *
 * Two consequences the markup holds to. A line and its area carry the series class alone, because that
 * class holds both the line treatment and the area's wash, and the sheet declares no `sp-chart__line` or
 * `sp-chart__area` to add. And the band rectangles the pointer moves through carry `opacity={0}`, which
 * suppresses their paint without switching off hit testing the way a `none` fill would.
 *
 * The geometry these elements are laid out with is built by `lineChartModel.ts`, which owns the scales,
 * the ticks, the paths, the pointer areas and the paired table's rows.
 *
 * Accessibility: the graphic is one `role="img"` named and described by the paired data table, so no
 * figure is reachable through colour or geometry alone; the frame is the focusable group the arrow keys
 * move the readout through; and the readout is a `role="status"` region inserted together with the words
 * it announces, since a region whose content is swapped in place is announced twice by some screen
 * readers and not at all by others.
 */

/** The separator between the readout's parts, in the treatment the document title already uses. */
const READOUT_SEPARATOR = " · ";

/** The marker radius in viewBox units: frame geometry, not a design value, so no token applies. */
const POINT_RADIUS = 3;

/** The key the data table's leading label column renders under, beside one key per series. */
const LABEL_COLUMN_KEY = "label";

/**
 * Everything {@link LineChart} accepts.
 *
 * Only `series` is required, so the component renders without a router, a provider or any other prop and
 * is directly mountable. The three formatters default to `formatMoney`, `formatMoneyAxis` and the
 * bucket formatter of `chartScales.ts`, so a money series in minor units renders correctly with nothing
 * restated here about rounding. `actions`, `footer` and `emptyMessage` are the slots and wording the
 * composing feature owns: this component never fetches, filters or recomputes what it is handed.
 */
export interface LineChartProps {
  /** The series to plot, in draw order: the first is drawn first and leads the legend. */
  readonly series: readonly ChartSeries[];
  /** The heading, and the graphic's name where no `ariaLabel` is given. */
  readonly title?: string;
  /** A sentence under the heading describing what the chart shows. */
  readonly description?: string;
  /** Controls the composing feature owns, such as its bucket control or series toggle. */
  readonly actions?: ReactNode;
  /** Notes and export affordances the composing feature owns, rendered after the data table. */
  readonly footer?: ReactNode;
  /** The frame height in viewBox units. Defaults to `DEFAULT_CHART_HEIGHT`, 280. */
  readonly height?: number;
  /** Fills the band under each line, closed on the baseline. Off by default. */
  readonly area?: boolean;
  /** Marks each band while there are at most 31 of them. On by default. */
  readonly showPoints?: boolean;
  /** Draws the legend. Defaults to on for more than one series, where the series must be told apart. */
  readonly showLegend?: boolean;
  /** Widens the value domain to carry zero, so no mark is read against a raised baseline. On by default. */
  readonly includeZero?: boolean;
  /** Formats a readout and legend figure. Defaults to `formatMoney`, for money in minor units. */
  readonly formatValue?: ValueFormatter;
  /** Formats a value-axis tick, told the domain the axis spans with it so one axis is written in one notation.
   *  Defaults to `formatMoneyAxis`. */
  readonly formatAxisValue?: AxisValueFormatter;
  /** Formats a band key as axis and row wording. Defaults to `defaultLabelFormatter`. */
  readonly formatLabel?: LabelFormatter;
  /** The graphic's accessible name, in place of `title`. */
  readonly ariaLabel?: string;
  /** The headline the no-data state shows, in place of the shared one. */
  readonly emptyMessage?: string;
  /**
   * The collection the paired table's paging caption counts, named by the surface that knows what its rows
   * are: `PAGING_NOUNS.PERIODS` for a chart bucketed into reporting periods, and `PAGING_NOUNS.PRODUCTS` for
   * one drawn over products. Defaults to the paired table's own default, `PAGING_NOUNS.PRODUCTS`.
   */
  readonly countNoun?: PagingNoun;
}

/** Joins the class names this component composes, leaving out every absent one. */
function joinClassNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/** Whether a copy slot holds words, so an absent or blank one renders no empty box of its own. */
function hasCopy(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** Whether a slot holds something React paints, so a slot given nothing renders nothing. */
function hasNode(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** A viewBox height as it may be drawn with: a finite, whole, positive number, or the shared default. */
function resolveHeight(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : DEFAULT_CHART_HEIGHT;
}

/** The series' own labels as one phrase, or `undefined` when not one of them names anything. */
function seriesPhrase(series: readonly ChartSeries[]): string | undefined {
  const labels = series.map((one) => one.label).filter(hasCopy);
  return labels.length === 0 ? undefined : labels.join(", ");
}

/**
 * The band index a key moves the readout to, or `null` for a key that is not a movement key.
 *
 * Up and Down are deliberately left unhandled: this chart runs along a band axis, so they keep scrolling
 * the page rather than being swallowed by a control with nothing above or below it.
 */
function nextBandIndex(key: string, current: number | null, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return Math.min(current === null ? 0 : current + 1, last);
    case "ArrowLeft":
      return current === null ? last : Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * A line chart over the series it is given: its grid, its axes, a readout the pointer and the keyboard
 * both drive, and the paired data table every figure is also readable in.
 *
 * The component is presentational — it holds no data of its own, fetches nothing and needs no provider.
 * Its one piece of state is which band the readout is showing, and the readout's words are derived from
 * that during render rather than stored as text.
 */
export function LineChart({
  series,
  title,
  description,
  actions,
  footer,
  height,
  area = false,
  showPoints = true,
  showLegend,
  includeZero = true,
  formatValue = formatMoney,
  formatAxisValue = formatMoneyAxis,
  formatLabel = defaultLabelFormatter,
  ariaLabel,
  emptyMessage,
  countNoun,
}: LineChartProps): ReactElement {
  const tableId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const frameHeight = resolveHeight(height);
  const hasData = hasChartData(series);
  const bandKeys = useMemo(() => collectBandKeys(series), [series]);
  const chartName = [title, ariaLabel, seriesPhrase(series)].find(hasCopy) ?? APP_COPY.APP_NAME;
  const showLegendResolved = showLegend ?? series.length > 1;
  const hasHeading = hasCopy(title) || hasCopy(description);

  const model = useMemo(
    () =>
      buildPlotModel({
        series,
        bandKeys,
        height: frameHeight,
        includeZero,
        area,
        showPoints,
        formatValue,
        formatAxisValue,
        formatLabel,
      }),
    [
      series,
      bandKeys,
      frameHeight,
      includeZero,
      area,
      showPoints,
      formatValue,
      formatAxisValue,
      formatLabel,
    ],
  );

  // A legend entry states its series' period total — the same figure the donut's legend states for the same
  // breakdown, and the sum of the rows the paired table carries for it — rather than the single bucket the
  // series happens to end on, which names no period and cannot be read against the other legends. A series
  // with no finite point at all states no figure, having nothing to total.
  const legendEntries = useMemo(
    () =>
      series.map((one, index) => ({
        id: one.id,
        label: one.label,
        className: seriesClassName(one.color, index),
        value: hasChartData([one]) ? chartSeriesTotal([one]) : undefined,
      })),
    [series],
  );

  // The table's React keys are the series' own identities, so a re-render never keys a column by its
  // position; the leading label column carries the constant key beside them.
  const columnKeys = useMemo(() => [LABEL_COLUMN_KEY, ...series.map((one) => one.id)], [series]);

  // Derived rather than stored: re-bucketing can shrink the band list under a band the readout was left
  // standing on, and an index past the end simply shows nothing.
  const activeKey =
    activeIndex !== null && activeIndex < bandKeys.length ? bandKeys[activeIndex] : undefined;

  const readout = useMemo<Readout | null>(() => {
    if (activeKey === undefined) return null;
    // One band is resolved across every series here, and the pointer moves the band on every event: the
    // series are read through the point indexes the model built once, so each figure costs a map hit rather
    // than a scan of the series' points — the same shape the drawing and the paired table read.
    const values = model.pointIndexes.map((index) => indexedFiniteValueAt(index, activeKey));
    const parts = series.map((one, index) => `${one.label} ${formatValue(values[index] ?? 0)}`);
    const highest = values.reduce<number>(
      (top, value) => (value === undefined ? top : Math.min(top, model.valueScale.scale(value))),
      model.plotArea.y + model.plotArea.height,
    );
    const text = [formatLabel(activeKey), ...parts].join(READOUT_SEPARATOR);
    return {
      text,
      // The anchor is the band's centre across the drawing and the lift above the highest marker of the band,
      // both in the drawing's own units: `readoutPlacement` maps them onto the plot box the drawing occupies,
      // holds the block one inside the plot area and bounds the box it places from there — so a long sentence
      // wraps inside the plot instead of reaching the axis' gutter or its label row.
      style: readoutPlacement({
        anchorX: bandCentre(model.bandScale, activeKey),
        anchorY: Math.max(highest - READOUT_LIFT, model.plotArea.y),
        plotArea: model.plotArea,
        width: CHART_VIEWBOX_WIDTH,
        height: frameHeight,
        characters: text.length,
      }),
    };
  }, [activeKey, series, formatValue, formatLabel, model, frameHeight]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const next = nextBandIndex(event.key, activeIndex, bandKeys.length);
      if (next === null) return;
      event.preventDefault();
      setActiveIndex(next);
    },
    [activeIndex, bandKeys.length],
  );

  const handleFocus = useCallback((): void => {
    setActiveIndex((current) => current ?? 0);
  }, []);

  const clearActive = useCallback((): void => {
    setActiveIndex(null);
  }, []);

  // One handler for every band rather than a closure per rectangle: the index travels on the element, so
  // the only thing that differs between bands is the number the attribute carries.
  const handleBandEnter = useCallback((event: MouseEvent<SVGRectElement>): void => {
    const index = Number(event.currentTarget.dataset.bandIndex);
    if (Number.isInteger(index)) setActiveIndex(index);
  }, []);

  return (
    <div className="sp-chart">
      {hasHeading || hasNode(actions) ? (
        <div className="sp-chart__header">
          {hasHeading ? (
            <div>
              {hasCopy(title) ? <h3 className="sp-chart__title">{title}</h3> : null}
              {hasCopy(description) ? <p>{description}</p> : null}
            </div>
          ) : null}
          {hasNode(actions) ? <div className="sp-chart__controls">{actions}</div> : null}
        </div>
      ) : null}

      {hasData ? (
        <div
          className="sp-chart__frame"
          role="group"
          aria-label={chartName}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={clearActive}
          onMouseLeave={clearActive}
        >
          {/* The drawing and its readout share one positioned box, so the readout's percentages and
              the bounds holding them resolve against the box the drawing occupies rather than the
              frame's padding box — which is what keeps the readout, and the width the geometry
              reserves for it, inside the plot on every screen. */}
          <div className="sp-chart__plot">
            <svg
              className="sp-chart__svg"
              viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${frameHeight}`}
              role="img"
              aria-label={chartName}
              aria-describedby={tableId}
            >
              {model.valueTicks.map((tick) => (
                <line
                  key={`grid-${String(tick.value)}`}
                  className="sp-chart__grid-line"
                  {...gridLineFor("vertical", model.plotArea, tick.position)}
                />
              ))}
              <line
                className="sp-chart__axis-line"
                {...gridLineFor(
                  "vertical",
                  model.plotArea,
                  model.plotArea.y + model.plotArea.height,
                )}
              />
              {model.valueTicks.map((tick) => (
                <text
                  key={`value-${String(tick.value)}`}
                  className="sp-chart__tick"
                  {...axisLabelTransform({
                    orientation: "vertical",
                    axis: "value",
                    plotArea: model.plotArea,
                    position: tick.position,
                  })}
                >
                  {tick.label}
                </text>
              ))}
              {model.bandTicks.map((tick) => (
                <text
                  key={`band-${tick.key}`}
                  className="sp-chart__tick"
                  {...axisLabelTransform({
                    orientation: "vertical",
                    axis: "band",
                    plotArea: model.plotArea,
                    position: bandCentre(model.bandScale, tick.key),
                  })}
                >
                  {tick.label}
                </text>
              ))}
              {model.marks.map((mark) => (
                <g key={mark.id}>
                  {mark.areaPath === "" ? null : (
                    <path className={mark.className} d={mark.areaPath} />
                  )}
                  <path className={mark.className} d={mark.linePath} />
                  {mark.markers.map((point, index) => (
                    <circle
                      key={`${mark.id}-${model.bandKeys[index]}`}
                      className={joinClassNames("sp-chart__point", mark.className)}
                      cx={point.x}
                      cy={point.y}
                      r={POINT_RADIUS}
                    />
                  ))}
                </g>
              ))}
              {model.hits.map((hit) => (
                <rect
                  key={hit.key}
                  data-band-index={hit.index}
                  x={hit.x}
                  y={hit.y}
                  width={hit.width}
                  height={hit.height}
                  opacity={0}
                  onMouseEnter={handleBandEnter}
                />
              ))}
            </svg>
            {readout === null ? null : (
              <div
                className="sp-chart__readout"
                role="status"
                aria-live="polite"
                style={readout.style}
              >
                {readout.text}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="sp-chart__frame">
          <EmptyState
            className="sp-chart__empty"
            headingLevel={3}
            title={emptyMessage ?? EMPTY_STATES.dashboardRange.title}
            description={EMPTY_STATES.dashboardRange.description}
          />
        </div>
      )}

      {showLegendResolved && hasData ? (
        <ul className="sp-chart__legend" role="list">
          {legendEntries.map((entry) => (
            <li className="sp-chart__legend-item" key={entry.id}>
              <span
                className={joinClassNames("sp-chart__legend-swatch", entry.className)}
                aria-hidden="true"
              />
              <span className="sp-chart__legend-label">{entry.label}</span>
              {entry.value === undefined ? null : (
                <span className="sp-chart__legend-value">{formatValue(entry.value)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {hasData ? (
        /* The paired table travels sideways inside this box, so the box is a named scroll region a keyboard
         * reaches and the arrow keys scroll, as the shared table's own container is; the name is the caption
         * the table carries, so the region and the table are announced with the same words. */
        <div
          className="sp-chart__data"
          role="region"
          aria-label={chartDataTableCaption(chartName)}
          tabIndex={0}
        >
          <ChartDataTable
            caption={chartDataTableCaption(chartName)}
            tableId={tableId}
            columns={model.dataTable.columns}
            columnKeys={columnKeys}
            rows={model.dataTable.rows}
            countNoun={countNoun}
          />
        </div>
      ) : null}

      {footer}
    </div>
  );
}
