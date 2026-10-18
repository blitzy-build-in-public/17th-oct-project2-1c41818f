/**
 * Path: src/components/charts/DonutChart.tsx
 * Purpose: Donut with legend, percentage labels and a centre total
 * Lines: 599
 */

import { useCallback, useId, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from "react";

import {
  CHART_VIEWBOX_WIDTH,
  DEFAULT_CHART_HEIGHT,
  DEFAULT_INNER_RADIUS_RATIO,
  DEFAULT_PADDING,
  MIN_SLICE_LABEL_SHARE,
  buildDonutArcs,
  buildSliceDataTable,
  chartSeriesTotal,
  computePlotArea,
  hasChartData,
  polarToCartesian,
  seriesClassName,
} from "@/components/charts/chartScales";
import type { ArcDatum, Padding, ValueFormatter } from "@/components/charts/chartScales";
import { EmptyState } from "@/components/ui/Feedback";
import { CHART_COLUMN_LABELS, EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import type { ChartSeries } from "@/types/analytics";
import type { MinorUnits } from "@/types/common";
import { formatMoney, formatMoneyCompact, formatPercent, formatShare } from "@/utils/format";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of this family — the sheet
 * `src/main.tsx` loads with the other seven — and no file under `src/components/**` may import a stylesheet,
 * so every class below is consumed by name: `sp-chart` for the frame's grid, `sp-chart__header` with its
 * `__title` and `__controls`, `sp-chart__frame` for the plot's box, `sp-chart__svg` for the drawing,
 * `sp-chart__slice` beside one of the eight `sp-chart__series-N` classes for a segment's colour,
 * `sp-chart__label` for the percentage inside a wedge, `sp-chart__readout`, `sp-chart__legend` with its item,
 * swatch, label and value, `sp-chart__center` with `sp-chart__center-value` for the hole's total, and
 * `sp-chart__data` with `sp-chart__empty` for a range that sold nothing. The table composes `sp-table`,
 * `sp-table--compact`, `sp-table__caption`, `sp-table__num`, a `th[scope="col"]` header row and a
 * `th[scope="row"]` from `src/styles/data-display.css`.
 *
 * No appearance lives here, and none may be moved here: the sheet paints every mark from the
 * `--chart-series-N` tokens `src/styles/tokens.css` declares and clamps the readout inside the frame. This
 * file writes no colour, `stroke`, `fill`, `stroke-dasharray` or shadow and reads no element's size, so the
 * ring's geometry is a function of its props alone and the chart is testable without a layout engine. A slice
 * carries no dash of its own — its stroke is the gap between two segments, which a pattern would break — so a
 * slice is told from its neighbour by that gap, by the legend swatches that do repeat the pattern, and by the
 * legend's and the table's names and figures.
 *
 * The decisions this contract rests on:
 *   - The centre total is the sheet's `sp-chart__center` overlay rather than SVG text, which the contract
 *     above forbids: real text in the document, so it is announced. Its size is the sheet's too and does not
 *     shrink with the drawing, so below roughly a 400px-wide chart the hole is smaller than the overlay; the
 *     fix for that is a container-relative size in the sheet, never a measurement or a breakpoint here.
 *   - The ring is inset the same on both axes rather than by {@link DEFAULT_PADDING}, whose left and bottom
 *     margins exist for an axis and its labels: on that frame the ring, and the total in its hole, would sit
 *     off the middle of the drawing the overlay is anchored to.
 *   - The readout is placed by the sheet's `--sp-chart-readout-x`, `-y` and `-w`: a point of the drawing
 *     mapped onto the box the drawing occupies, and the text's own `ch` measure as the width the sheet's
 *     clamp reserves. The anchor is the box's top-left corner, because that clamp bounds a left edge — a
 *     centred box would be pulled off its slice by the reserve and could still hang past the frame. Nothing
 *     is measured, which would take state written from an effect.
 *   - It is anchored on the slice's mid-angle at the ring's outer edge, where it can cover that slice's own
 *     percentage label while it is up. That is deliberate: it states the same label, value and share, and no
 *     other anchor both stays inside the frame and leaves the centre total alone.
 *   - The paired table names its three columns, with the wording `src/constants/content.ts` owns.
 */

/** The largest share of the outer radius the hole may take; at the outer radius there is no ring to draw. */
const MAX_INNER_RADIUS_RATIO = 0.95;

/** The digits a legend entry, the readout and the paired table write a share with. */
const SHARE_DIGITS = 1;

/** The digits a percentage inside a wedge carries: one fewer than the legend, because a label has less room. */
const SLICE_LABEL_DIGITS = 0;

/**
 * The share formatter the paired table reads, handed a slice's fraction of the ring rather than a value and a
 * total. `formatShare` states the same reading from a value and a total, so a slice's share is written one
 * way whether it is computed from the whole or read from the geometry.
 */
const formatSliceShare: ValueFormatter = (share) => formatPercent(share, SHARE_DIGITS);

/** The keys the paired table's column cells render under, in the order the columns are stated. */
const SLICE_COLUMN_KEYS = ["group", "value", "share"] as const;

/** A style object that also carries the custom properties `src/styles/admin-reports.css` positions by. */
type DonutChartStyle = CSSProperties & Record<`--${string}`, string>;

/**
 * The ring's own inset, the same on both axes.
 *
 * `DEFAULT_PADDING` reserves room for a value axis and its band labels, which a line or a bar chart needs and
 * a ring does not: centred on that frame the ring, and the total drawn in its hole, would sit off the middle
 * of the drawing — and `src/styles/admin-reports.css` anchors `sp-chart__center`, the overlay the total is
 * rendered in, on that middle. Both dimensions therefore take the shared inset's smaller value, which leaves
 * the ring centred on the frame the centre total is centred in.
 */
const DONUT_PADDING: Padding = {
  top: DEFAULT_PADDING.top,
  right: DEFAULT_PADDING.right,
  bottom: DEFAULT_PADDING.top,
  left: DEFAULT_PADDING.right,
};

/**
 * Whether a slot holds something React paints, so the heading row is left out rather than rendered as an
 * empty band. `false`, `null`, `undefined` and the empty string paint nothing.
 *
 * @param node - The slot's value.
 * @returns True when the slot should be rendered.
 */
function hasSlot(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/**
 * Whether a text slot carries words, narrowing the value for the branch that renders it.
 *
 * @param value - The text the caller passed, or nothing.
 * @returns True when the value is a non-blank string.
 */
function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * The class that colours one slice: its series class, looked up by the slice's series id so a slice keeps its
 * colour when a series is dropped from the breakdown, falling back to the arc's position for a slice whose
 * series the caller has replaced between the read and the render.
 *
 * @param classNamesBySeriesId - Each series' class, keyed by the id the geometry carries onto its slice.
 * @param slice - The slice being drawn.
 * @returns The `sp-chart__series-N` class the stylesheet paints that slice with.
 */
function sliceClassName(
  classNamesBySeriesId: ReadonlyMap<string, string>,
  slice: ArcDatum,
): string {
  return classNamesBySeriesId.get(slice.id) ?? seriesClassName(undefined, slice.seriesIndex);
}

/**
 * The drawing's height in the frame's own coordinate system.
 *
 * @param height - The caller's height, or nothing.
 * @returns The caller's height when it is a positive, finite number, and the shared default otherwise.
 */
function resolveHeight(height: number | undefined): number {
  return height !== undefined && Number.isFinite(height) && height > 0
    ? height
    : DEFAULT_CHART_HEIGHT;
}

/**
 * The hole's share of the outer radius, clamped so a ring is always drawn: a ratio at or beyond one would put
 * the hole at the outer radius, where the geometry has no ring to draw.
 *
 * @param ratio - The caller's ratio, or nothing.
 * @returns The ratio, clamped into `0..MAX_INNER_RADIUS_RATIO`, or the shared default when it is absent or
 *   not finite.
 */
function resolveHoleRatio(ratio: number | undefined): number {
  if (ratio === undefined || !Number.isFinite(ratio)) return DEFAULT_INNER_RADIUS_RATIO;
  return Math.min(Math.max(ratio, 0), MAX_INNER_RADIUS_RATIO);
}

/**
 * The custom properties the readout is placed by, in the frame's own box.
 *
 * The anchor is a point of the drawing, so it is mapped onto the box the drawing occupies rather than onto
 * the frame's padding box: a bare percentage of the frame would place the readout a padding-width away from
 * the slice it describes.
 *
 * The anchor is also the box's own top-left corner, not its centre. `src/styles/admin-reports.css` clamps the
 * readout's inline start between zero and the frame's width less the reserved width, and that clamp bounds a
 * left edge: an offset is what it holds inside the frame, and a box centred on its anchor would be pushed off
 * the slice by a reserve wider than the text and could still hang past the frame. That is why the width is
 * given as the text's own `ch` measure plus its horizontal padding — a reserve, deliberately on the generous
 * side — rather than measured, which would also take state written from an effect.
 *
 * @param anchorX - The anchor's horizontal position in the drawing's own units.
 * @param anchorY - The anchor's vertical position in the drawing's own units.
 * @param width - The drawing's width in those units.
 * @param height - The drawing's height in those units.
 * @param characters - The number of characters the readout's words take.
 * @returns The style object the readout element carries.
 */
function readoutPlacement(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  characters: number,
): DonutChartStyle {
  const origin = "var(--space-4)";
  const span = `(100% - 2 * ${origin})`;
  const ratio = (value: number): string => Math.min(Math.max(value, 0), 1).toFixed(4);
  return {
    "--sp-chart-readout-x": `calc(${origin} + ${span} * ${ratio(anchorX / width)})`,
    "--sp-chart-readout-y": `calc(${origin} + ${span} * ${ratio(anchorY / height)})`,
    "--sp-chart-readout-w": `calc(${characters}ch + 2 * var(--space-3))`,
  };
}

/**
 * Names a chart the caller has not named: a ring of revenue by category has no name but the categories it
 * splits, so the series labels are its own subject rather than a sentence invented here.
 *
 * @param series - The plotted series, in ring order.
 * @returns The labels joined into one phrase, or an empty string when there are no series.
 */
function seriesLabels(series: readonly ChartSeries[]): string {
  return series.map((one) => one.label).join(", ");
}

/**
 * Everything {@link DonutChart} accepts.
 *
 * Only `series` is required, and nothing else is reached from the environment: the component reads no
 * router, no context and no element size, so a chart renders from its props alone in a page, in a test and
 * in a report alike.
 */
export interface DonutChartProps {
  /**
   * The slices, one per series, in ring order — **one slice per series, valued as the sum of that series'
   * positive points**, which is the shape a breakdown produces: a caller holding a single series of many
   * points gets one full ring rather than many segments, and a series summing to zero or less draws none.
   */
  readonly series: readonly ChartSeries[];
  /** The chart's heading, rendered as the frame's own `h3`. */
  readonly title?: string;
  /** The sentence under the heading that says what the ring shows. */
  readonly description?: string;
  /** The controls that change what is plotted, placed beside the heading in the header row. */
  readonly actions?: ReactNode;
  /** A note under everything, such as the range the figures cover. Rendered whether or not there is data. */
  readonly footer?: ReactNode;
  /**
   * The drawing's height in the frame's own coordinate system: the sheet scales the SVG to its container, so
   * this sets the aspect ratio and not a pixel height.
   */
  readonly height?: number;
  /**
   * The hole's share of the outer radius, clamped into `0..0.95`. The default makes a ring rather than a pie,
   * which is what leaves the middle free for the centre total.
   */
  readonly innerRadiusRatio?: number;
  /**
   * Whether each slice with room for one carries its percentage inside the wedge: slices below
   * {@link MIN_SLICE_LABEL_SHARE} are left unlabelled rather than crowded.
   */
  readonly showPercentages?: boolean;
  /** Whether the legend under the frame is rendered. The paired table is rendered regardless. */
  readonly showLegend?: boolean;
  /**
   * The centre total's label — "Total", "Revenue" — rendered only when given, because the sentence belongs to
   * the caller's surface and not to the chart.
   */
  readonly centreLabel?: string;
  /** Formats a slice's value in the legend, in the readout and in the paired table. Defaults to money. */
  readonly formatValue?: ValueFormatter;
  /** Formats the centre total, whose shorter form suits the hole's width. Defaults to compact money. */
  readonly formatTotalValue?: ValueFormatter;
  /**
   * The chart's accessible name, naming the plot's keyboard group and the drawing alike. Defaults to the
   * heading, then the description, then the labels of the series it plots.
   */
  readonly ariaLabel?: string;
  /**
   * The headline of the no-data state, in place of the library's wording for a period that sold nothing; the
   * explanation under it stays the library's, so no sentence is written at this call site.
   */
  readonly emptyMessage?: string;
  /** The paired table's leading column heading: the group each slice is, or the caller's word. */
  readonly labelHeader?: string;
}

/**
 * A donut: one slice per series, a legend, a percentage inside each wedge with room for one, and the ring's
 * total in its hole.
 *
 * Each slice takes its paint from a `sp-chart__series-N` class the stylesheet maps onto a token rather than
 * from a colour written here. Hovering or focusing a slice shows a readout stating its label, its value and
 * its share, and the same three readings sit in the legend and in the paired data table under the frame, so
 * no figure is reachable through colour or geometry alone.
 *
 * The plot is one tab stop rather than one per slice: ArrowLeft and ArrowRight walk the ring in order and
 * wrap at either end, Home and End reach the first and last slice, focus selects the slice the plot was left
 * on, and leaving the plot clears the readout. The plot is a named `group`, so assistive technology announces
 * what those keys walk.
 *
 * A ring with no slice at all — no finite point, or a total that is not positive, which is the all-zero
 * breakdown of a period that sold nothing produces — renders the library's no-data state in the frame's own
 * box instead and draws no drawing, no legend and no table, so the frame keeps its height and nothing divides
 * by a total of zero.
 *
 * @param props - The slices and the chart's presentation; see {@link DonutChartProps}.
 * @returns The frame's heading, the plot with its centre total and readout, the legend and the paired table.
 */
export function DonutChart({
  series,
  title,
  description,
  actions,
  footer,
  height,
  innerRadiusRatio,
  showPercentages = true,
  showLegend = true,
  centreLabel,
  formatValue = formatMoney,
  formatTotalValue = formatMoneyCompact,
  ariaLabel,
  emptyMessage,
  labelHeader = CHART_COLUMN_LABELS.GROUP_LABEL,
}: DonutChartProps): ReactElement {
  const baseId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const resolvedHeight = resolveHeight(height);

  // The ring's centre and radii, computed from the viewBox the sheet scales: no element is measured, so the
  // geometry is decided by the props alone and every arc can be checked without a layout engine.
  const geometry = useMemo(() => {
    const plotArea = computePlotArea({
      width: CHART_VIEWBOX_WIDTH,
      height: resolvedHeight,
      padding: DONUT_PADDING,
    });
    const outerRadius = Math.max(1, Math.min(plotArea.width, plotArea.height) / 2);
    return {
      centreX: plotArea.x + plotArea.width / 2,
      centreY: plotArea.y + plotArea.height / 2,
      outerRadius,
      innerRadius: outerRadius * resolveHoleRatio(innerRadiusRatio),
    };
  }, [resolvedHeight, innerRadiusRatio]);

  const arcs = useMemo(
    () =>
      buildDonutArcs({
        series,
        cx: geometry.centreX,
        cy: geometry.centreY,
        outerRadius: geometry.outerRadius,
        innerRadius: geometry.innerRadius,
        formatValue,
      }),
    [series, geometry, formatValue],
  );

  // The ring's total, in the minor units a revenue breakdown plots: the centre total reads it directly, so no
  // caller derives the same sum again.
  const total = useMemo<MinorUnits>(() => chartSeriesTotal(series), [series]);
  const isEmpty = !hasChartData(series) || arcs.length === 0;

  const classNamesBySeriesId = useMemo(() => {
    const bySeriesId = new Map<string, string>();
    series.forEach((one, index) => {
      bySeriesId.set(one.id, seriesClassName(one.color, index));
    });
    return bySeriesId;
  }, [series]);

  const legendItems = useMemo(
    () =>
      arcs.map((arc) => ({
        id: arc.id,
        label: arc.label,
        formattedValue: arc.formattedValue,
        formattedShare: formatShare(arc.value, total, SHARE_DIGITS),
        className: sliceClassName(classNamesBySeriesId, arc),
      })),
    [arcs, classNamesBySeriesId, total],
  );

  const dataTable = useMemo(
    () =>
      buildSliceDataTable(arcs, formatValue, formatSliceShare, {
        labelHeader,
        valueHeader: CHART_COLUMN_LABELS.VALUE_LABEL,
        shareHeader: CHART_COLUMN_LABELS.SHARE_LABEL,
      }),
    [arcs, formatValue, labelHeader],
  );

  const captionId = `${baseId}-data`;
  const accessibleName = useMemo(
    () => ariaLabel ?? title ?? description ?? seriesLabels(series),
    [ariaLabel, title, description, series],
  );
  const caption = useMemo(
    () => chartDataTableCaption(title ?? accessibleName),
    [title, accessibleName],
  );

  // The slice the pointer or the keys last reached. A slice the data no longer has — a re-bucketed range
  // that dropped a group — leaves nothing selected rather than a slice at an index that now belongs to
  // another group.
  const activeArc = activeIndex === null ? null : (arcs[activeIndex] ?? null);

  // The readout's words, assembled once so the width the sheet's clamp is given and the text a reader sees
  // cannot drift apart.
  const readoutText =
    activeArc === null
      ? null
      : `${activeArc.label} ${activeArc.formattedValue} ${formatShare(activeArc.value, total, SHARE_DIGITS)}`;

  const readoutStyle = useMemo<DonutChartStyle | undefined>(() => {
    if (activeArc === null || readoutText === null) return undefined;
    const anchor = polarToCartesian(
      geometry.centreX,
      geometry.centreY,
      geometry.outerRadius,
      activeArc.midAngle,
    );
    return readoutPlacement(
      anchor.x,
      anchor.y,
      CHART_VIEWBOX_WIDTH,
      resolvedHeight,
      readoutText.length,
    );
  }, [activeArc, readoutText, geometry, resolvedHeight]);

  const clearActive = useCallback((): void => setActiveIndex(null), []);
  const selectSlice = useCallback((index: number): void => setActiveIndex(index), []);
  const selectFirstSlice = useCallback((): void => setActiveIndex((current) => current ?? 0), []);

  const walkSlice = useCallback((offset: number, count: number): void => {
    setActiveIndex((current) => {
      const from = current !== null && current < count ? current : 0;
      return (from + offset + count) % count;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const count = arcs.length;
      if (count === 0) return;
      switch (event.key) {
        case "ArrowRight":
          walkSlice(1, count);
          break;
        case "ArrowLeft":
          walkSlice(-1, count);
          break;
        case "Home":
          setActiveIndex(0);
          break;
        case "End":
          setActiveIndex(count - 1);
          break;
        default:
          return;
      }
      // The plot owns these keys while it is focused, so an arrow does not also scroll the page under it.
      event.preventDefault();
    },
    [arcs.length, walkSlice],
  );

  const header =
    hasText(title) || hasText(description) || hasSlot(actions) ? (
      <div className="sp-chart__header">
        <div>
          {hasText(title) ? <h3 className="sp-chart__title">{title}</h3> : null}
          {hasText(description) ? <p>{description}</p> : null}
        </div>
        {hasSlot(actions) ? <div className="sp-chart__controls">{actions}</div> : null}
      </div>
    ) : null;

  // The no-data state opens at the level the chart's own heading would have taken: with a title the chart's
  // <h3> stands above it and the state nests one level under it, and without one the state is the block's
  // first heading, so the page's outline never skips a level.
  if (isEmpty) {
    return (
      <div className="sp-chart">
        {header}
        <div className="sp-chart__frame">
          <div className="sp-chart__empty">
            <EmptyState
              title={hasText(emptyMessage) ? emptyMessage : EMPTY_STATES.dashboardRange.title}
              description={EMPTY_STATES.dashboardRange.description}
              headingLevel={hasText(title) ? 4 : 3}
            />
          </div>
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="sp-chart">
      {header}
      <div
        className="sp-chart__frame"
        role="group"
        aria-label={accessibleName}
        tabIndex={0}
        onBlur={clearActive}
        onFocus={selectFirstSlice}
        onKeyDown={handleKeyDown}
        onMouseLeave={clearActive}
      >
        <svg
          className="sp-chart__svg"
          viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${resolvedHeight}`}
          role="img"
          aria-label={accessibleName}
          aria-describedby={captionId}
        >
          {arcs.map((arc) => (
            <path
              key={arc.id}
              className={`sp-chart__slice ${sliceClassName(classNamesBySeriesId, arc)}`}
              d={arc.path}
              onMouseEnter={() => selectSlice(arc.seriesIndex)}
            />
          ))}
          {/* The wedge's percentage is drawn over its own slice, so it must not swallow the pointer: without
              this the most natural place to hover a wedge — its middle, where the label sits — would show no
              readout at all, and the label states what the readout states anyway. */}
          {showPercentages
            ? arcs
                .filter((arc) => arc.share >= MIN_SLICE_LABEL_SHARE)
                .map((arc) => (
                  <text
                    key={arc.id}
                    className="sp-chart__label"
                    x={arc.labelX}
                    y={arc.labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                  >
                    {formatShare(arc.value, total, SLICE_LABEL_DIGITS)}
                  </text>
                ))
            : null}
        </svg>
        <div className="sp-chart__center">
          <span className="sp-chart__center-value">{formatTotalValue(total)}</span>
          {/* The caption under the total carries no class: the sheet names none for it, and the one label
              class it declares means a figure written on the plot, which a query for the wedge labels reads. */}
          {hasText(centreLabel) ? <span>{centreLabel}</span> : null}
        </div>
        {readoutText === null ? null : (
          <div className="sp-chart__readout" role="status" aria-live="polite" style={readoutStyle}>
            {readoutText}
          </div>
        )}
      </div>
      {showLegend ? (
        <ul className="sp-chart__legend" role="list">
          {legendItems.map((item) => (
            <li key={item.id} className="sp-chart__legend-item">
              <span className={`sp-chart__legend-swatch ${item.className}`} aria-hidden="true" />
              <span className="sp-chart__legend-label">{item.label}</span>
              <span className="sp-chart__legend-value">{item.formattedValue}</span>
              <span className="sp-chart__legend-label">{item.formattedShare}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sp-chart__data">
        <table className="sp-table sp-table--compact" id={captionId}>
          <caption className="sp-table__caption">{caption}</caption>
          <thead>
            <tr>
              {dataTable.columns.map((heading, index) => (
                <th key={SLICE_COLUMN_KEYS[index]} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataTable.rows.map((row) => {
              const [formattedValue, formattedShare] = row.cells;
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td className="sp-table__num">{formattedValue}</td>
                  <td className="sp-table__num">{formattedShare}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
