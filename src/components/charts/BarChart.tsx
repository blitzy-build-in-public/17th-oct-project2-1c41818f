/**
 * Path: src/components/charts/BarChart.tsx
 * Purpose: Vertical, horizontal, grouped and stacked bars with value labels
 * Lines: 423
 */

import { useCallback, useId, useMemo, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";

import { buildGeometry, readoutStyle, resolveHeight } from "@/components/charts/barGeometry";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import {
  CHART_VIEWBOX_WIDTH,
  DEFAULT_CHART_HEIGHT,
  buildSeriesDataTable,
  chartSeriesTotal,
  defaultLabelFormatter,
  hasChartData,
  seriesClassName,
} from "@/components/charts/chartScales";
import type {
  AxisValueFormatter,
  BarMode,
  LabelFormatter,
  Orientation,
  ValueFormatter,
} from "@/components/charts/chartScales";
import { EmptyState } from "@/components/ui/Feedback";
import { CHART_COLUMN_LABELS, EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import type { PagingNoun } from "@/constants/content";
import type { ChartSeries } from "@/types/analytics";
import { formatMoney, formatMoneyAxis } from "@/utils/format";

/*
 * Class contract. `src/styles/admin-reports.css` owns the whole `.sp-chart*` family this renderer draws with:
 * the block and its `__header`, `__title`, `__controls` and `__frame` regions, the `__svg` sizing, the
 * `__grid-line` and `__axis-line` marks, the `__tick` and `__label` a mark is written with, the `__bar` and
 * the eight `__series-N` classes a series paints through, the transparent `__hit` a band takes the pointer
 * over, the `__readout` placed by its two custom properties, the `__legend` with its swatch, label and value,
 * the `__empty` state, and the `__data` table, which composes the `sp-table` primitive. The supporting line
 * borrows the shared `.sp-card__description`, because that sheet declares no class of its own for it.
 *
 * Nothing here writes a colour, a radius, a shadow, a dash pattern, a pixel media query or a `fill`, `stroke`
 * or `stroke-dasharray` attribute: the sheet maps the `--chart-*` tokens of `src/styles/tokens.css` onto those
 * classes, including the lightness step and the dash rhythm that separate two series without relying on hue.
 * The marks themselves — their scales, labels, value labels and readout offsets — are computed in
 * `src/components/charts/barGeometry.ts`, which imports nothing from here.
 */

/** What separates a readout's band from each series' reading of it. */
const READOUT_SEPARATOR = " · ";

/**
 * The legend-total record of a caller that suppresses nothing: it names no series, so every series keeps the
 * total the chart reads from its own points. It is passed as the prop's default instead of a fresh `{}`,
 * because an object built at every render would recompute the legend items with it.
 */
const DEFAULT_LEGEND_TOTALS: Readonly<Record<string, boolean>> = {};

/** The React key the paired table's leading column renders under, whatever word the caller gives the column. */
const LABEL_COLUMN_KEY = "label";

/** The one line a readout shows: the band's label, then every series' reading of it, so both inputs read alike. */
function readoutText(
  label: string,
  series: readonly ChartSeries[],
  cells: readonly string[],
): string {
  const readings = series.map((one, index) => `${one.label} ${cells[index] ?? ""}`.trim());
  return [label, ...readings].join(READOUT_SEPARATOR);
}

/** Everything {@link BarChart} accepts. */
export interface BarChartProps {
  /** The series to draw. A chart handed none, or one whose points carry no finite value, renders its empty state. */
  readonly series: readonly ChartSeries[];
  /** The chart's heading, above the frame, and the graphic's accessible name when no `ariaLabel` is given. */
  readonly title?: string;
  /** A supporting line under the heading, for the period or the unit the chart is drawn over. */
  readonly description?: string;
  /** Controls that change what is plotted — a bucket control, a series toggle — mounted beside the heading. */
  readonly actions?: ReactNode;
  /** Content below the paired data table, for a note that belongs to the screen the chart sits on. */
  readonly footer?: ReactNode;
  /** The frame's height in SVG user units. Defaults to {@link DEFAULT_CHART_HEIGHT}. */
  readonly height?: number;
  /** Which way the bars run. Defaults to `"vertical"`. */
  readonly orientation?: Orientation;
  /** How several series share one band. Defaults to `"grouped"`. */
  readonly mode?: BarMode;
  /** Whether each bar's value is written at its outer end. Defaults to `true`. */
  readonly showValues?: boolean;
  /** Whether the legend is drawn. Drawn for more than one series unless this is `false`. */
  readonly showLegend?: boolean;
  /**
   * Whether each series' legend entry states its total, keyed by series id.
   *
   * The chart reads a series by the sum of its points, and a series this record does not mention keeps that
   * reading; a series mapped to `false` states no value at all. The exception exists for a series whose
   * figures are per-band counts that must not be added together: a count of returning customers is one
   * customer in each band they appear in, so summing the bands counts them once per band and contradicts the
   * paired data table, which states no total for such a column either. Suppression reaches the legend alone —
   * the swatch and the label are still drawn, because the series must stay tellable apart, and every band's
   * figure stays in its value label, in the readout and in the paired table.
   */
  readonly legendTotals?: Readonly<Record<string, boolean>>;
  /** Whether the value axis is widened to carry zero. Defaults to `true`: an axis starting above zero misleads. */
  readonly includeZero?: boolean;
  /** Reads the value labels, the legend totals and the readout. Defaults to {@link formatMoney}. */
  readonly formatValue?: ValueFormatter;
  /** Reads the value-axis ticks, and is told the domain the axis spans with each one, so one axis is written in
   *  one notation. Defaults to {@link formatMoneyAxis}. */
  readonly formatAxisValue?: AxisValueFormatter;
  /** Writes a band key as axis wording. Defaults to {@link defaultLabelFormatter}. */
  readonly formatLabel?: LabelFormatter;
  /** The graphic's accessible name, in place of the visible title. */
  readonly ariaLabel?: string;
  /** The empty state's wording, in place of the shared one for a period with no activity. */
  readonly emptyMessage?: string;
  /**
   * The paired table's leading column heading — the dimension the bands are drawn along: a period, a product,
   * a channel. Defaults to {@link CHART_COLUMN_LABELS.GROUP_LABEL}, because that alternative is the chart's
   * own statement of its figures and a column of them must say what it holds.
   */
  readonly labelHeader?: string;
  /**
   * The collection the paired table's paging caption counts, named by the surface that knows what its rows
   * are: `PAGING_NOUNS.PERIODS` for one banded by reporting periods, and `PAGING_NOUNS.PRODUCTS` for one
   * banded by products. Defaults to the paired table's own default, `PAGING_NOUNS.PRODUCTS`.
   */
  readonly countNoun?: PagingNoun;
}

/**
 * Bars over a shared baseline: grouped side by side or stacked one on another, vertical or horizontal, each
 * bar's value written at its outer end, a legend naming the series and — for each series whose figures add
 * up — their total, a readout that reports one band under the pointer or the arrow keys, and the paired data
 * table that repeats every figure the graphic draws — so no value is reachable through colour or geometry
 * alone.
 *
 * It reads nothing outside its props: no router, no context, no measured element and no clock, so a caller
 * mounts it with `series` alone. A series whose per-band figures must not be summed is named in `legendTotals`
 * and its legend entry then states no total, which is the one thing about a reading this component takes from
 * its caller rather than from the points. Money arrives as integer minor units and is written only by
 * `src/utils/format.ts`, which the two formatting defaults supply.
 *
 * @param props - The series and the frame, the heading and controls, the wording slots and the formatters.
 * @returns The chart block, or its empty state when the series carry nothing plottable.
 */
export function BarChart({
  series,
  title,
  description,
  actions,
  footer,
  height = DEFAULT_CHART_HEIGHT,
  orientation = "vertical",
  mode = "grouped",
  showValues = true,
  showLegend,
  legendTotals = DEFAULT_LEGEND_TOTALS,
  includeZero = true,
  formatValue = formatMoney,
  formatAxisValue = formatMoneyAxis,
  formatLabel = defaultLabelFormatter,
  ariaLabel,
  emptyMessage,
  labelHeader = CHART_COLUMN_LABELS.GROUP_LABEL,
  countNoun,
}: BarChartProps): ReactElement {
  const titleId = useId();
  const captionId = useId();
  const [activeBand, setActiveBand] = useState<string | null>(null);
  const plotHeight = resolveHeight(height);
  const hasData = hasChartData(series);
  const horizontal = orientation === "horizontal";

  const geometry = useMemo(
    () =>
      buildGeometry({
        series,
        height: plotHeight,
        orientation,
        mode,
        includeZero,
        showValues,
        formatValue,
        formatAxisValue,
        formatLabel,
      }),
    [
      series,
      plotHeight,
      orientation,
      mode,
      includeZero,
      showValues,
      formatValue,
      formatAxisValue,
      formatLabel,
    ],
  );
  // One table model serves both the accessible alternative and the readout, so the two can never disagree
  // about a band's label or a figure's wording. The leading heading is the caller's word for the dimension
  // the bands are drawn along, or the shared one for a group.
  const table = useMemo(
    () => buildSeriesDataTable(series, formatValue, { labelHeader }),
    [series, formatValue, labelHeader],
  );
  // The headings and keys the paired table renders, one column per series after the leading one. Memoised on
  // the same inputs the model is, so the memoised table receives arrays whose identity survives a hover.
  const tableColumns = useMemo(
    () => [table.columns[0], ...series.map((one) => one.label)],
    [table, series],
  );
  const tableColumnKeys = useMemo(
    () => [LABEL_COLUMN_KEY, ...series.map((one) => one.id)],
    [series],
  );
  // A legend entry's figure is the series' own total, except where the caller named the series in
  // `legendTotals` as one whose bands must not be summed: that entry states no value rather than one the
  // paired table below it does not state.
  const legendItems = useMemo(
    () =>
      series.map((one, index) => ({
        id: one.id,
        className: seriesClassName(one.color, index),
        label: one.label,
        total: legendTotals[one.id] === false ? null : formatValue(chartSeriesTotal([one])),
      })),
    [series, formatValue, legendTotals],
  );
  const activeRow = useMemo(
    () => (activeBand === null ? undefined : table.rows.find((row) => row.key === activeBand)),
    [table, activeBand],
  );
  // The readout's one line, held so its placement and its words are the same sentence: the box reserves the
  // width of the text it will hold, and that length is taken from here rather than measured off the rendered
  // box, which this renderer never reads.
  const activeRowText = useMemo(
    () => (activeRow === undefined ? null : readoutText(activeRow.label, series, activeRow.cells)),
    [activeRow, series],
  );

  // The pointer names its band through the region it entered rather than through the mark it landed on, so
  // the gaps between grouped bars and the space above a short bar clear nothing.
  const handleBandEnter = useCallback((event: ReactPointerEvent<SVGRectElement>): void => {
    const key = event.currentTarget.dataset.band;
    if (key !== undefined) setActiveBand(key);
  }, []);
  const handleBandLeave = useCallback((): void => setActiveBand(null), []);
  const handlePlotFocus = useCallback((): void => {
    setActiveBand((current) => current ?? geometry.bandKeys[0] ?? null);
  }, [geometry.bandKeys]);
  const handlePlotBlur = useCallback((): void => setActiveBand(null), []);
  const handlePlotKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const keys = geometry.bandKeys;
      const last = keys.length - 1;
      if (last < 0) return;
      const current = activeBand === null ? -1 : keys.indexOf(activeBand);
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const step = forward ? 1 : backward ? -1 : 0;
      const edge = event.key === "Home" ? 0 : event.key === "End" ? last : null;
      let next: number | null = edge;
      if (step !== 0) {
        next = current < 0 ? (forward ? 0 : last) : Math.min(Math.max(current + step, 0), last);
      }
      if (next === null) return;
      event.preventDefault();
      setActiveBand(keys[next]);
    },
    [geometry.bandKeys, activeBand],
  );

  // The graphic's name is the caller's label or the visible title; where a caller gives neither, the caption
  // names what the table holds — the series drawn — rather than a sentence invented in this file.
  const chartName = ariaLabel ?? title;
  const captionSubject = chartName ?? series.map((one) => one.label).join(", ");
  const legendVisible = series.length > 1 && showLegend !== false;

  const header = (
    <header className="sp-chart__header">
      {title === undefined ? null : (
        <h3 className="sp-chart__title" id={titleId}>
          {title}
        </h3>
      )}
      {description === undefined ? null : <p className="sp-card__description">{description}</p>}
      {actions === undefined ? null : <div className="sp-chart__controls">{actions}</div>}
    </header>
  );
  const trailing = footer === undefined ? null : <footer>{footer}</footer>;

  if (!hasData) {
    return (
      <section className="sp-chart" aria-labelledby={title === undefined ? undefined : titleId}>
        {header}
        <div className="sp-chart__frame">
          <div className="sp-chart__empty">
            <EmptyState
              title={emptyMessage ?? EMPTY_STATES.dashboardRange.title}
              description={EMPTY_STATES.dashboardRange.description}
              headingLevel={3}
            />
          </div>
        </div>
        {trailing}
      </section>
    );
  }

  return (
    <section className="sp-chart" aria-labelledby={title === undefined ? undefined : titleId}>
      {header}
      <div
        className="sp-chart__frame"
        role="group"
        tabIndex={0}
        aria-label={chartName}
        onKeyDown={handlePlotKeyDown}
        onFocus={handlePlotFocus}
        onBlur={handlePlotBlur}
      >
        {/* The drawing and its readout share one positioned box, so the readout's percentages and
              the bounds holding them resolve against the box the drawing occupies rather than the
              frame's padding box — which is what keeps the readout, and the width the geometry
              reserves for it, inside the plot on every screen. */}
        <div className="sp-chart__plot">
          <svg
            className="sp-chart__svg"
            viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${plotHeight}`}
            role="img"
            aria-label={chartName}
            aria-describedby={captionId}
          >
            <g>
              {geometry.gridLines.map((mark) => (
                <line key={mark.tick.value} className="sp-chart__grid-line" {...mark.line} />
              ))}
              <line className="sp-chart__axis-line" {...geometry.axisLine} />
              {geometry.bars.map((mark) => (
                <rect key={mark.id} className={mark.className} {...mark.area} />
              ))}
              {geometry.textMarks.map((mark) => (
                <text key={mark.id} className={mark.className} {...mark.transform}>
                  {mark.text}
                </text>
              ))}
              {geometry.hitRects.map((hit) => (
                <rect
                  key={hit.id}
                  className="sp-chart__hit"
                  data-band={hit.id}
                  {...hit.area}
                  onPointerEnter={handleBandEnter}
                  onPointerLeave={handleBandLeave}
                />
              ))}
            </g>
          </svg>
          {activeRow === undefined || activeRowText === null ? null : (
            <div
              className="sp-chart__readout"
              role="status"
              aria-live="polite"
              style={readoutStyle({
                geometry,
                bandKey: activeRow.key,
                height: plotHeight,
                horizontal,
                characters: activeRowText.length,
              })}
            >
              {activeRowText}
            </div>
          )}
        </div>
      </div>
      {legendVisible ? (
        <ul className="sp-chart__legend" role="list">
          {legendItems.map((item) => (
            <li className="sp-chart__legend-item" key={item.id}>
              <span className={`sp-chart__legend-swatch ${item.className}`} aria-hidden="true" />
              <span className="sp-chart__legend-label">{item.label}</span>
              {item.total === null ? null : (
                <span className="sp-chart__legend-value">{item.total}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sp-chart__data">
        {/* The wrapper is the table primitive's own scroll container: without it a six-column paired table
            sets the minimum width of every box above it, and the chart's card overflows a phone's viewport.
            Because it scrolls, it is also a named region a keyboard can reach and scroll, named by the caption
            the table inside it carries. */}
        <div
          className="sp-table-wrap"
          role="region"
          aria-label={chartDataTableCaption(captionSubject)}
          tabIndex={0}
        >
          <ChartDataTable
            caption={chartDataTableCaption(captionSubject)}
            captionId={captionId}
            columns={tableColumns}
            columnKeys={tableColumnKeys}
            rows={table.rows}
            countNoun={countNoun}
          />
        </div>
      </div>
      {trailing}
    </section>
  );
}
