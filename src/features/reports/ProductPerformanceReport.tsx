/**
 * Path: src/features/reports/ProductPerformanceReport.tsx
 * Purpose: The product-performance report: units, revenue and share by product
 * Lines: 324
 */

import { useCallback, useMemo } from "react";
import type { ReactElement } from "react";

import { BarChart } from "@/components/charts/BarChart";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, EMPTY_STATES } from "@/constants/content";
import { DATE_RANGE_COPY, REPORTS_COPY, productChartBoundNote } from "@/constants/content-reports";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { ReportBodyPlaceholder } from "@/features/reports/ReportPlaceholder";
import { ReportTable } from "@/features/reports/ReportTable";
import { findDefinition, runReport } from "@/lib/reportService";
import { useAuth } from "@/state/AuthContext";
import { useAsync } from "@/state/hooks";
import type {
  BucketGranularity,
  ChartSeries,
  ReportDefinition,
  ReportKind,
  ReportResult,
} from "@/types/analytics";
import type { DateRange, IsoDateString, Result } from "@/types/common";
import { formatDateRange } from "@/utils/dates";
import { formatCellValue } from "@/utils/format";

/*
 * Class contract. `src/styles/admin-reports.css` declares the report
 * shell this view fills — `sp-report__body`, the block that stacks the summary figures, the paired chart and
 * the table; `sp-report__summary` with its `__summary-item`, `__summary-label` and `__summary-value` regions,
 * the register a report states its figures in; and `sp-report__empty`, the block a period with no activity
 * composes its empty state in. The chart's own `.sp-chart` family and the table's `.sp-report-table` family
 * travel with the components that render them, and the loading state is `ReportPlaceholder`'s, which shapes the
 * figures, the chart and the table at this report's own counts. No colour, radius, shadow or pixel media query
 * is written here.
 *
 * The view renders no heading of its own: the report selector mounts it as its selected panel, which
 * `src/components/ui/Tabs.tsx` labels with the report's own name, so the region already carries an accessible
 * name and the first heading inside it is the paired chart's. The empty state's headline takes that same
 * level, so the first heading keeps its level whether the period recorded activity or not.
 */

// The run this view performs ---------------------------------------------------------------------

/** The report this view runs: the kind the vocabulary module declares the product-performance report under. */
const REPORT_KIND: ReportKind = "products";

/**
 * The definition the run is reported against: the vocabulary module's own entry for that kind, resolved once
 * so the figures, the chart and the table all read one column set, one name and one description.
 *
 * The fallback mirrors `src/lib/reportService.ts`, which resolves a definition the same way and answers with
 * the catalogue's first entry when a kind declares none, so an unreadable catalogue leaves a renderable view
 * rather than a blank route.
 */
const DEFINITION: ReportDefinition =
  findDefinition(REPORT_DEFINITIONS, REPORT_KIND) ?? REPORT_DEFINITIONS[0];

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  body: "sp-report__body",
  summary: "sp-report__summary",
  summaryItem: "sp-report__summary-item",
  summaryLabel: "sp-report__summary-label",
  summaryValue: "sp-report__summary-value",
  empty: "sp-report__empty",
} as const;

/**
 * How many products the chart plots. The run's rows arrive ordered by revenue, so the chart takes their head:
 * an axis draws a handful of bands before its labels stop being readable, while the table beside it pages
 * every row the run produced. The note under the chart states the bound, so the head of a ranking is never
 * read as the whole of it.
 */
const CHART_PRODUCT_LIMIT = 8;

/**
 * The figures a product-performance run states above its table, which is what the loading summary stands in
 * with: one entry per figure `src/lib/reportService.ts` totals for this kind — the products that sold, the
 * units they moved and the revenue they brought — so the grid reserves the row of three it fills.
 */
const SUMMARY_FIGURE_COUNT = 3;

/**
 * The series the product chart draws: the range's revenue per product, the single series
 * `src/lib/reportService.ts` builds for this kind, and so the number of legend entries and paired-table figures
 * the placeholder stands in with — the bounds above decide how many bands it plots.
 */
const CHART_SERIES_COUNT = 1;

/**
 * The level the empty state's headline renders at: the report body is a section of the page, one level below
 * its `h1`, so a period with no activity states itself at that section's level rather than deeper.
 */
const EMPTY_HEADING_LEVEL = 2;

/**
 * What joins the resolved period and the caveat under the chart. Neither half is worded here: the period is
 * `src/utils/dates.ts`'s and the caveat is `src/constants/content-reports.ts`'s.
 */
const SENTENCE_SEPARATOR = ". ";

// Reading the run --------------------------------------------------------------------------------

/**
 * The supporting line under the chart's heading: the days the run covers, then the caveat naming whose clock
 * a period boundary follows.
 *
 * Both halves are worded elsewhere — `formatDateRange` renders the period and `DATE_RANGE_COPY` supplies the
 * caveat — and a period that cannot be rendered leaves the caveat alone rather than a stray separator.
 *
 * @param from - The first day of the run, as the result echoes it.
 * @param to - The last day of the run, as the result echoes it.
 * @returns The sentence, or the caveat alone when the period is unreadable.
 */
function describePeriod(from: IsoDateString, to: IsoDateString): string {
  const period = formatDateRange(from, to);
  return period === ""
    ? DATE_RANGE_COPY.LOCAL_TIME_NOTE
    : [period, DATE_RANGE_COPY.LOCAL_TIME_NOTE].join(SENTENCE_SEPARATOR);
}

/**
 * The series the chart plots: the run's own series, each taken down to its leading points.
 *
 * The run built them from the rows it had already ordered by revenue, so this moves no figure and no series
 * identity — it drops the points past the bound, which is what keeps an unbounded ranking out of an axis that
 * cannot draw it.
 *
 * Each point is also taken without the display text the run wrote on it. A report series names a point by the
 * figure it carries, which is what a period axis wants, because its key is a date nobody needs repeated;
 * this chart's bands are products, and a band is named by its key — the product — through the chart's own
 * labelling, so that the readout and the chart's paired data table identify which product a bar is rather
 * than printing its revenue twice. No figure is lost by it: the value travels in `y` and every money string
 * the chart shows is rendered by the formatter the series is drawn with.
 *
 * @param series - The series the run returned.
 * @param limit - How many points each series is drawn to.
 * @returns The series as the run built them, each carrying its leading points, unnamed.
 */
function boundSeries(series: readonly ChartSeries[], limit: number): readonly ChartSeries[] {
  return series.map((one) => ({
    ...one,
    points: one.points.slice(0, limit).map(({ label: _figureText, ...point }) => point),
  }));
}

/**
 * Everything {@link ProductPerformanceReport} accepts.
 *
 * The period and the cut are the page's, not this view's: the report selector owns the range control and the
 * bucket control, so this view runs exactly the query it is handed and holds no query state of its own. A
 * changed prop re-runs the report; nothing else about the view can.
 */
export interface ProductPerformanceReportProps {
  /** The period every figure covers. */
  readonly range: DateRange;
  /** The cut the run is bucketed by. */
  readonly granularity: BucketGranularity;
  /** The one action this report's no-activity state offers, asked of the page that owns the period: it widens
   *  the range to the widest the product accepts, so a period that recorded nothing has a way out. */
  readonly onWidenRange: () => void;
}

/**
 * The product-performance report: what each product sold, what it earned and what share of the period's
 * revenue that is.
 *
 * One run answers the whole view. `runReport` resolves `GET /api/reports/products` for the period and the
 * cut, and the single `ReportResult` that comes back is read three times over — the summary figures, the
 * chart beside them and the table with its export — which is what makes the figures on screen and the rows
 * in the download one computation rather than three that agree by accident. Nothing here recomputes a total,
 * a share or a bucket boundary: rows, summary, series and the export matrix all come from
 * `src/lib/reportService.ts`, every figure is rendered by `src/utils/format.ts`, and sorting, paging and the
 * export control belong to `ReportTable`.
 *
 * Four states are rendered in the order they can occur: the alert with its retry when the run failed, the
 * placeholders while this view's own first run is in flight, the empty state when the period recorded no
 * activity, and the report. A run that supersedes a report already on screen keeps the previous run's figures
 * there, under the region's busy state, so a moved range or a changed cut moves the figures in place rather
 * than emptying the report and re-creating its chart and its table.
 *
 * @param props - The period to run over, the cut to run it by and the action its empty state offers; see
 * {@link ProductPerformanceReportProps}.
 * @returns The report body: its summary figures, its chart and its table.
 */
export function ProductPerformanceReport({
  range,
  granularity,
  onWidenRange,
}: ProductPerformanceReportProps): ReactElement {
  const { session } = useAuth();
  const sessionToken = session?.token ?? "";

  // The run. `useAsync` starts it when the period, the cut or the session changes and aborts the request it
  // supersedes, so a moved range leaves no older answer behind. A failed run resolves a `Result` value rather
  // than throwing, which is why no `try`/`catch` belongs around it.
  const load = useCallback(
    (signal: AbortSignal): Promise<Result<ReportResult>> =>
      runReport(
        { kind: REPORT_KIND, from: range.from, to: range.to, bucket: granularity },
        { sessionToken, signal },
      ),
    [granularity, range.from, range.to, sessionToken],
  );
  const { data, status, error, reload } = useAsync<ReportResult>(
    load,
    [range.from, range.to, granularity, sessionToken],
    // A moved range or a changed cut re-runs this view over the figures it is already showing, so the run
    // keeps the result it last answered with: the summary, the chart and the table stay as they were and the
    // region's busy state reports the wait until the new run's figures land. A view the selector has just
    // mounted has no earlier run behind it, and its own first load still renders the placeholders.
    { keepPreviousData: true },
  );

  // The chart's series, bounded once per run. The chart memoises its own geometry on this array, so the slice
  // is taken here rather than rebuilt on every render of the view.
  const series = useMemo(() => boundSeries(data?.series ?? [], CHART_PRODUCT_LIMIT), [data]);

  if (error !== null) {
    // The run failed: the message the seam shaped, and the retry that runs the same query again. The failure
    // takes the region whatever the previous run left there, because a period whose figures could not be read
    // is not a period to keep showing earlier ones for.
    return (
      <div className={CLASSES.body}>
        <Alert tone="danger" error={error} actionLabel={COMMON_ACTIONS.RETRY} onAction={reload} />
      </div>
    );
  }

  if (data === null) {
    // Nothing has arrived and nothing failed, so this view's first run is in flight — or this is the first
    // render, before the hook has started it. The block takes the shape of what is arriving: the figures the run
    // will state, then the plot, the legend and the paired table at the products the chart is bounded to, then a
    // page of the table with its export row. The block around them is what reports that the region is filling:
    // every piece inside it is decorative and announces nothing of its own.
    return (
      <div className={CLASSES.body} aria-busy="true">
        <ReportBodyPlaceholder
          chart={{
            title: REPORTS_COPY.PRODUCT_CHART_HEADING,
            description: describePeriod(range.from, range.to),
            footer: productChartBoundNote(CHART_PRODUCT_LIMIT),
            rows: CHART_PRODUCT_LIMIT,
            series: CHART_SERIES_COUNT,
          }}
          definition={DEFINITION}
          figures={SUMMARY_FIGURE_COUNT}
        />
      </div>
    );
  }

  if (data.rows.length === 0) {
    // A period with no activity is a well-formed report and not a failure: nothing sold, so the summary
    // totals zero and the chart has no series to draw. The state explains that with the words the content
    // module holds for a reporting range, and it carries the one action that resolves it — the page's, since
    // the period is the page's, and all it does is widen the period to the widest this product accepts. The
    // label says so rather than "Choose another period", which would promise a choice this control does not
    // give: narrowing a period is the range control's job above the reports.
    return (
      <div className={CLASSES.body}>
        <EmptyState
          title={EMPTY_STATES.reportRange.title}
          description={EMPTY_STATES.reportRange.description}
          headingLevel={EMPTY_HEADING_LEVEL}
          className={CLASSES.empty}
          actionLabel={EMPTY_STATES.dashboardRange.actionLabel}
          onAction={onWidenRange}
        />
      </div>
    );
  }

  const isBusy = status === "loading";

  return (
    // The region carries the busy state while the run is in flight: the placeholders inside it are written
    // against it, and so are the figures of a run a newer one supersedes — the summary, the chart and the
    // table stay as they were, the table marking its own rows busy, until the new figures land.
    <div className={CLASSES.body} {...(isBusy ? { "aria-busy": true } : {})}>
      {/* One figure per metric the run stated, each labelled and formatted from the column it belongs to, so
          the figures above the table and the totals row inside it name and render the same things one way. */}
      <dl className={CLASSES.summary}>
        {data.summary.items.map((item) => (
          <div className={CLASSES.summaryItem} key={item.key}>
            <dt className={CLASSES.summaryLabel}>{item.label}</dt>
            <dd className={CLASSES.summaryValue}>{formatCellValue(item.value, item.format)}</dd>
          </div>
        ))}
      </dl>

      {/* The ranking as bars: the run's revenue series, bounded to the leading products, drawn across the
          frame rather than up it because the bands are product names. No control is mounted beside the
          heading, because the selector, the period and the cut all belong to the page above this view. The
          bands are what the definition's first column holds, so the chart's paired table takes that column's
          own word for them rather than the chart's word for a group. */}
      <BarChart
        series={series}
        title={REPORTS_COPY.PRODUCT_CHART_HEADING}
        description={describePeriod(data.from, data.to)}
        orientation="horizontal"
        labelHeader={DEFINITION.columns[0].label}
        footer={productChartBoundNote(CHART_PRODUCT_LIMIT)}
      />

      {/* The table and its export, built from the run the chart was built from: the same definition, the same
          rows and the same summary, so the download cannot state a figure the screen does not. */}
      <ReportTable
        isBusy={isBusy}
        kind={REPORT_KIND}
        definition={DEFINITION}
        rows={data.rows}
        summary={data.summary}
        range={{ from: data.from, to: data.to }}
        granularity={data.granularity}
      />
    </div>
  );
}
