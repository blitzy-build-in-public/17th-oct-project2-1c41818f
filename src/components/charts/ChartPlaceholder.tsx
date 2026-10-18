/**
 * Path: src/components/charts/ChartPlaceholder.tsx
 * Purpose: The shape of a chart block while its series are on their way: plot, legend and paired data table
 * Lines: 239
 */

import type { ReactElement, ReactNode } from "react";

import { Skeleton } from "@/components/ui/Feedback";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class below is consumed by name, and they are the ones the three renderers already wear, so the
 * placeholder block is laid out by the same rules the chart is: `sp-chart` for the block, `sp-chart__header`
 * with `sp-chart__title`, `sp-card__description` and `sp-chart__controls` for the header the chart renders above
 * its plot — the title and the supporting line under it, which the renderers take from
 * `src/styles/data-display.css`'s card family — `sp-chart__frame` for the bordered plot box, `sp-chart__legend`
 * with `sp-chart__legend-item` and `sp-chart__legend-swatch` for the legend, and `sp-chart__data` for the scroll
 * container holding the paired data table, which is the table primitive's own `sp-table`/`sp-table--compact`/
 * `sp-table__caption`/`sp-table__num` family. `src/styles/admin-reports.css` owns all of those and the frame's
 * own minimum height,
 * and `src/styles/placeholders.css` — split out of that sheet at the 600-line ceiling and loaded by
 * `src/styles/account.css` — owns the three `sp-chart-placeholder__*` blocks this file sizes: the plot at the
 * viewBox ratio the renderers draw at, a legend entry at a series name's measure, and the caption line above
 * the paired table, whose cells take that sheet's shared `sp-placeholder-cell`. Every one of those is a `var()`
 * from tokens.css or a `ch` measure.
 *
 * The block is decorative from end to end: the frame is the region that reports the wait with `aria-busy`, and
 * the legend and the paired table are hidden from assistive technology, because a list of empty entries and a
 * table of empty cells would otherwise be read out as content that has no figures in it yet.
 */

/** The class names this block composes, each taken by name from the sheet that declares it. */
const CLASSES = {
  block: "sp-chart",
  header: "sp-chart__header",
  title: "sp-chart__title",
  description: "sp-card__description",
  controls: "sp-chart__controls",
  frame: "sp-chart__frame",
  plot: "sp-chart-placeholder__plot",
  legend: "sp-chart__legend",
  legendItem: "sp-chart__legend-item",
  legendSwatch: "sp-chart__legend-swatch",
  legendLabel: "sp-chart-placeholder__legend-item",
  data: "sp-chart__data",
  table: "sp-table sp-table--compact",
  caption: "sp-table__caption",
  captionLine: "sp-chart-placeholder__caption",
  cell: "sp-placeholder-cell",
  numeric: "sp-table__num",
} as const;

/** The ratio one column contributes to the placeholder's heading row, so every heading is the same width. */
const HEADING_COLUMNS_PER_FIGURE = 1;

/**
 * How many series a plot holds before its renderer legends them: `LineChart` and `BarChart` draw a legend only
 * where there is more than one series to tell apart, so this is the count a placeholder follows when its caller
 * does not settle the question itself.
 */
const LEGEND_SERIES_FLOOR = 1;

/** Whether a slot holds something React paints, so a header is left out rather than drawn empty. */
function hasSlot(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** Whether a string holds words a reader can see, so a blank title is left out. */
function hasCopy(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** Everything {@link ChartPlaceholder} accepts. */
export interface ChartPlaceholderProps {
  /**
   * The title the arriving chart renders above its plot, in place of a placeholder line.
   *
   * A chart's title is content the page already holds before the read — `REPORTS_COPY.SALES_CHART_HEADING`
   * and the dashboard's own heading — so passing it renders the header the chart itself will render, rather
   * than a bar the same height as it.
   */
  readonly title?: string;
  /** The sentence under the title, when the caller states one. */
  readonly description?: string;
  /**
   * The controls the header holds, when the caller already renders them.
   *
   * The dashboard renders its bucket and series controls before the read answers, so a reader can change the
   * question while the previous answer is still in flight; they are handed in here so the header they sit in
   * is the chart's own.
   */
  readonly actions?: ReactNode;
  /**
   * The line the chart renders under its plot and its paired table, when the caller states one: the period note
   * a report's chart closes its block with.
   */
  readonly footer?: ReactNode;
  /**
   * How many series the arriving chart draws: the legend entries this stands in for, and the figures its
   * paired data table holds beside each band.
   */
  readonly series: number;
  /**
   * Whether the arriving chart draws a legend, when the renderer's own rule does not settle it.
   *
   * The line and bar renderers draw a legend only where there is more than one series to tell apart, which is
   * what this defaults to, so a single-series plot leaves the block out — and with it the height the legend
   * would have occupied. The ring draws one whatever it holds, so the caller rendering one says so.
   */
  readonly legend?: boolean;
  /**
   * How many bands the arriving chart plots: the rows its paired data table holds, one per band.
   *
   * It is the count the axis will carry — the buckets a period covers, the products a range ranked — so a
   * caller that knows its query states it rather than letting the table come up short.
   */
  readonly rows: number;
  /**
   * How many columns the paired data table has, when it is not one figure per series. Defaults to `series`
   * figures beside the band's own label, which is what the line and bar renderers draw; a breakdown renders
   * three whatever it holds.
   */
  readonly columns?: number;
  /**
   * Whether the paired data table carries a heading row. Defaults to `true`, which the line and bar renderers
   * draw; a breakdown's table names its bands in their own rows and carries none.
   */
  readonly hasHead?: boolean;
}

/**
 * The loading state of one chart block: the plot, the legend under it and the paired data table every figure
 * is also readable in, each occupying the space it will occupy once the series land.
 *
 * It is deliberate about the three things that decide those heights. The plot is a block carrying the viewBox
 * ratio the three renderers share, inside the frame's own padding, so it is exactly as tall as the drawing it
 * stands in for at every width — and the frame's own minimum height floors it exactly where it floors the
 * drawing. The legend is drawn exactly where the arriving chart draws one, which for the line and bar renderers
 * is more than one series: a plot with a single series shows no legend, and reserving one would move everything
 * below it. The paired table's rows are the count the caller states, each at the compact cell height the table
 * primitive gives it, because a chart's paired table grows with its bands and a placeholder that guessed the
 * count would move everything below it when the bands arrived.
 *
 * It renders the header the chart renders when the caller supplies any of its parts, and it writes no live
 * region: the frame carries `aria-busy`, which is what states the wait, and the legend and the table are
 * hidden from assistive technology rather than announced empty.
 *
 * @param props - The header's parts, the series count, whether a legend is drawn, and the band count;
 * see {@link ChartPlaceholderProps}.
 * @returns The decorative chart block.
 */
export function ChartPlaceholder({
  title,
  description,
  actions,
  footer,
  series,
  legend,
  rows,
  columns,
  hasHead = true,
}: ChartPlaceholderProps): ReactElement {
  const seriesCount = Number.isFinite(series) ? Math.max(0, Math.trunc(series)) : 0;
  const rowCount = Number.isFinite(rows) ? Math.max(0, Math.trunc(rows)) : 0;
  const figures = seriesCount + HEADING_COLUMNS_PER_FIGURE;
  const columnCount =
    columns !== undefined && Number.isFinite(columns) ? Math.max(1, Math.trunc(columns)) : figures;
  const hasHeader = hasCopy(title) || hasCopy(description) || hasSlot(actions);
  const legendVisible = legend ?? seriesCount > LEGEND_SERIES_FLOOR;

  return (
    <div className={CLASSES.block}>
      {hasHeader ? (
        <div className={CLASSES.header}>
          {hasCopy(title) || hasCopy(description) ? (
            <div>
              {hasCopy(title) ? <h3 className={CLASSES.title}>{title}</h3> : null}
              {hasCopy(description) ? <p className={CLASSES.description}>{description}</p> : null}
            </div>
          ) : null}
          {hasSlot(actions) ? <div className={CLASSES.controls}>{actions}</div> : null}
        </div>
      ) : null}

      <div className={CLASSES.frame} aria-busy="true">
        <Skeleton className={CLASSES.plot} variant="card" />
      </div>

      {legendVisible ? (
        <ul className={CLASSES.legend} aria-hidden="true">
          {/* The entries are interchangeable decorative rows with no identity for a key to preserve, which is
              the same reason the shared skeleton keys its own lines by position. */}
          {Array.from({ length: seriesCount }, (_entry, index) => (
            <li className={CLASSES.legendItem} key={`chart-placeholder-legend-${String(index)}`}>
              <span className={CLASSES.legendSwatch} />
              <Skeleton className={CLASSES.legendLabel} variant="text" />
            </li>
          ))}
        </ul>
      ) : null}

      <div className={CLASSES.data} aria-hidden="true">
        <table className={CLASSES.table}>
          <caption className={CLASSES.caption}>
            <Skeleton className={CLASSES.captionLine} variant="text" />
          </caption>
          {hasHead ? (
            <thead>
              <tr>
                {Array.from({ length: columnCount }, (_column, index) => (
                  <th key={`chart-placeholder-head-${String(index)}`}>
                    <Skeleton className={CLASSES.cell} variant="text" />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {Array.from({ length: rowCount }, (_row, rowIndex) => (
              <tr key={`chart-placeholder-row-${String(rowIndex)}`}>
                {Array.from({ length: columnCount }, (_cell, columnIndex) => (
                  <td
                    className={columnIndex === 0 ? undefined : CLASSES.numeric}
                    key={`chart-placeholder-cell-${String(columnIndex)}`}
                  >
                    <Skeleton className={CLASSES.cell} variant="text" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasSlot(footer) ? footer : null}
    </div>
  );
}
