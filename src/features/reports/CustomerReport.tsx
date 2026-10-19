/**
 * Path: src/features/reports/CustomerReport.tsx
 * Purpose: The customer report: new against returning customers, order frequency and value
 * Lines: 339
 */

import { useCallback } from "react";
import type { ReactElement } from "react";

import { BarChart } from "@/components/charts/BarChart";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, EMPTY_STATES, FEEDBACK_COPY, PAGING_NOUNS } from "@/constants/content";
import { DATE_RANGE_COPY, REPORTS_COPY } from "@/constants/content-reports";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { ReportBodyPlaceholder } from "@/features/reports/ReportPlaceholder";
import { ReportTable } from "@/features/reports/ReportTable";
import { findDefinition, runReport, summarisePeriodLabel } from "@/lib/reportService";
// The reports endpoints are administrator-only, so the token is this view's own to carry: `src/lib/apiRoutes.ts`
// registers `GET /api/reports/:kind` at the administrator level and the seam answers `401` to a request that
// brings none, which is a screen that can never load rather than an authorisation that holds. `useAuth` is the
// product's single home for the session and its role claims, and the account area's views read it the same way.
import { useAuth } from "@/state/AuthContext";
import { useAsync } from "@/state/hooks";
import type { BucketGranularity, ReportKind, ReportResult } from "@/types/analytics";
import type { DateRange, IsoDateString } from "@/types/common";
import { bucketCount, formatBucketLabel } from "@/utils/dates";
import { formatCellValue, formatCompactNumber, formatInteger } from "@/utils/format";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of the report and chart families,
 * and this comment is the list the sheet owes the file, each class named with the sheet that declares it:
 * `sp-report__body` is the block a report stacks its figures, its chart and its table in;
 * `sp-report__summary` with `__summary-item`, `__summary-label` and `__summary-value` is the summary-metrics
 * block; `sp-report__empty` is the block a range that recorded no activity composes `.sp-empty` inside; and
 * `sp-range-note` is the caption-sized line stating the period the figures cover.
 *
 * Everything else belongs to the components this file composes. `ReportTable` owns the definition's columns,
 * the `aria-sort` semantics, the caption, the paging, the totals row and the product's single CSV export, so no
 * column list, comparator, total or export control is written here. `BarChart` owns the frame, the grid, the
 * axis and its ticks, the bars, the text-and-swatch legend, the readout and the paired `.sp-chart__data` table
 * that repeats every figure it draws — so no second data alternative and no legend is built here — and the
 * fixed-height no-data state a period with nothing to plot renders. The loading state is `ReportPlaceholder`'s,
 * which shapes the figures, the chart and the table at this report's own counts, so no skeleton is written here.
 *
 * The chart is a bar chart and not a ring, and the reason is what the customer report's rows are. They are one
 * per period, and the two series `reportService.buildReportSeries` draws are that period's new and returning
 * counts; a ring draws one segment per series, valued as the sum of that series' points, which would add the
 * per-period customer counts together and count a customer who ordered in two periods twice — the very caveat
 * `summarise` states when it leaves `returningCustomers` out of the totals. Grouped bars keep the time axis the
 * range control owns and set the period's two counts side by side, each with the figure it carries.
 *
 * Both formatters below are passed because the chart's own defaults are money's: a customer count rendered by
 * `formatMoney` would read `$0.12` for twelve people. The value labels, the legend totals and the readout take
 * `formatInteger`, the value axis takes `formatCompactNumber`, and the band labels take `formatBucketLabel`
 * bound to the cut the run actually used and to the band's own wording — the chart's own label default reads
 * every key as a day, which would label a monthly run "Sep 1" rather than "Sep 2025".
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content-reports.ts` holds no wording for a summary-metrics block, so the
 * figures this report states are rendered as a description list with no heading of its own rather than under a
 * title this file would have to invent; one key in content-reports.ts is all that block needs to be titled.
 */

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  body: "sp-report__body",
  summary: "sp-report__summary",
  summaryItem: "sp-report__summary-item",
  summaryLabel: "sp-report__summary-label",
  summaryValue: "sp-report__summary-value",
  empty: "sp-report__empty",
  rangeNote: "sp-range-note",
} as const;

/**
 * The report this view runs, named once so the kind is not repeated as a bare literal through the query, the
 * table and its export.
 */
const REPORT_KIND: ReportKind = "customers";

/**
 * What joins the period the figures cover and the caveat about whose clock they follow. Neither sentence is
 * authored here — the period is `summarisePeriodLabel`'s and the caveat is `DATE_RANGE_COPY`'s — so this
 * constant is only the punctuation between two that were handed over.
 */
const SENTENCE_SEPARATOR = ". ";

/**
 * The figures a customer run states above its table, which is what the loading summary stands in with: one
 * entry per figure `src/lib/reportService.ts` totals for this kind — the new and returning customers, the
 * orders they placed and the revenue and average order value those orders carried — so the grid reserves the
 * row of four it fills with four entries.
 */
const SUMMARY_FIGURE_COUNT = 4;

/**
/**
 * The series the customer report's chart draws: new against returning customers per period, the two series
 * `src/lib/reportService.ts` builds for this kind, and so the number of legend entries and paired-table figures
 * the placeholder stands in with.
 */
const CHART_SERIES_COUNT = 2;

/**
 * The chart's legend totals, keyed by series id. Only one of the report's two charted counts adds up: the
 * accounts a period wins are disjoint from another period's, so `newCustomers` states its total, while
 * `returningCustomers` counts the customers who ordered in a period without being created in it — the same
 * customer, then, in every period they ordered in — so its periods must not be added together. That is the
 * caveat `summarise` in `src/lib/reportService.ts` states when it leaves the column out of the report's
 * totals, and the reason the table's totals cell and the export's totals row state nothing for it either.
 * The legend states no figure for it for that same reason, so the chart's reading of the column and the
 * paired table's reading of it agree.
 */
const LEGEND_TOTALS: Readonly<Record<string, boolean>> = { returningCustomers: false };

/**
 * The line under the chart: the period the figures cover, then the caveat that a period boundary is a whole day
 * on the visitor's own clock. A period that cannot be resolved contributes nothing rather than a half-empty
 * sentence, so the caveat stands alone instead.
 *
 * @param from - The first day of the range that ran.
 * @param to - The last day of it.
 * @returns The note's text, every sentence of it worded by the module that owns it.
 */
function periodNote(from: IsoDateString, to: IsoDateString): string {
  const period = summarisePeriodLabel({ from, to });
  if (period === "") return DATE_RANGE_COPY.LOCAL_TIME_NOTE;
  return `${period}${SENTENCE_SEPARATOR}${DATE_RANGE_COPY.LOCAL_TIME_NOTE}`;
}

/** Everything {@link CustomerReport} accepts. */
export interface CustomerReportProps {
  /**
   * The period to report on, owned by `src/features/reports/ReportsPage.tsx` beside its range control: this
   * view runs over the range it is given and changes nothing about it, so a range that recorded no activity is
   * widened by the page through the callback below rather than by a control this view would have to hold.
   */
  readonly range: DateRange;
  /**
   * The cut the period is bucketed by — day, week or month — also the page's, because the bucket control sits
   * with the range control. It travels into the run and into the chart's band labels, so a re-bucketed view
   * states its buckets in the wording of the cut that produced them.
   */
  readonly granularity: BucketGranularity;
  /**
   * The one action this report's no-activity state offers, asked of the page that owns the period: it widens
   * the range to the widest the product accepts, so a period that recorded nothing has a way out.
   */
  readonly onWidenRange: () => void;
}

/**
 * The customer report for one period: what the period gained and what it served, as new against returning
 * customers, and what those customers' orders were worth.
 *
 * It is a projection of one run and nothing more. The rows, the summary figures, the charted series and the file
 * the table exports all come from the single `ReportResult` that `reportService.runReport` answers with, so the
 * three surfaces cannot state different figures for one range; nothing is aggregated here, because the period's
 * counts, the orders they carried, the revenue and the average order value are the service's own row and summary
 * output. Nor is anything derived here: where a figure the report states is computed, it is computed by
 * `summarise` in the service, which is also why `returningCustomers` appears in the table and not in the summary
 * — summed over periods it would count one customer twice.
 *
 * Every state this view can be in renders in the order it can occur: the failure the seam answered with,
 * carrying the retry that runs the range again; the placeholders a first run shows; the empty state of a
 * period that gained no account and took no order; and then the report itself — its figures, its chart and its
 * table, because a reader wants the headline before the detail. A run that supersedes a report already on
 * screen keeps the previous run's figures there, under the region's busy state, so a moved range or a changed
 * cut moves the figures in place rather than emptying the report and re-creating its chart and its table.
 *
 * @param props - The page's range and its bucket, and the action its no-activity state offers; see
 * {@link CustomerReportProps}.
 * @returns The report's body: its summary figures, its paired chart and its table with the export.
 */
export function CustomerReport({
  range,
  granularity,
  onWidenRange,
}: CustomerReportProps): ReactElement {
  const { session } = useAuth();
  const sessionToken = session?.token;
  const { from, to } = range;
  const definition = findDefinition(REPORT_DEFINITIONS, REPORT_KIND);

  // One report over one range, re-issued whenever the range, the bucket or the session changes and aborted the
  // moment a newer run starts, so a slow answer for a range the reader has already left cannot settle into this
  // view. The run waits for a session the way every other session-scoped read in the product does, because the
  // seam admits an administrator session to these endpoints and answers `401` to a request without one; the
  // token is carried for that reason alone and this view decides nothing about the role, which the route guard
  // and the seam both enforce. A visitor who never signs in is therefore presented as a pending run and is sent
  // to sign in by the guard over `/admin/*` long before a report is owed to them.
  const request = useAsync<ReportResult>(
    (signal) =>
      runReport({ kind: REPORT_KIND, from, to, bucket: granularity }, { sessionToken, signal }),
    [from, to, granularity, sessionToken],
    // A moved range or a changed cut re-runs this view over the figures it is already showing, so the run
    // keeps the result it last answered with: the summary, the chart and the table stay as they were and the
    // region's busy state reports the wait until the new run's figures land. A view the selector has just
    // mounted has no earlier run behind it, and its own first load still renders the placeholders.
    { enabled: session !== null, keepPreviousData: true },
  );

  // A band key read as axis wording. The key is the period's own wording — `src/lib/reportSeries.ts` keys and
  // words every band by its period — so a wording that is already readable is passed through and a raw bucket
  // key, or a product's name, is read by `src/utils/dates.ts` over the range the run covers, which is what
  // qualifies a band the range clipped; the `|| key` fallback is the one `defaultLabelFormatter` in
  // `src/components/charts/chartScales.ts` applies for the same reason.
  const formatBandLabel = useCallback(
    (key: string): string => formatBucketLabel(key, granularity, range) || key,
    [granularity, range],
  );

  // The catalogue is a compile-time list that carries this kind, so an absent definition is a defect rather than
  // a state a reader can reach. It is still rendered as a failure instead of falling back to another report's
  // columns, which would put the wrong table under this report's name.
  if (definition === undefined) {
    return (
      <div className={CLASSES.body}>
        <Alert
          tone="danger"
          title={FEEDBACK_COPY.ERROR_STATE_TITLE}
          actionLabel={COMMON_ACTIONS.RETRY}
          onAction={request.reload}
        >
          {FEEDBACK_COPY.ERROR_STATE_BODY}
        </Alert>
      </div>
    );
  }

  if (request.status === "error" && request.error !== null) {
    // The failure takes the region whatever the previous run left there: a period whose figures could not be
    // read is not a period to keep showing earlier ones for, and the retry is the way on from it.
    return (
      <div className={CLASSES.body}>
        <Alert
          tone="danger"
          error={request.error}
          actionLabel={COMMON_ACTIONS.RETRY}
          onAction={request.reload}
        />
      </div>
    );
  }

  // The run on screen: the payload while the read holds one, and — because this view asks the read to keep
  // the payload it last answered with — the figures of the previous run for as long as the run that
  // supersedes it takes. `null` therefore means the view has no run behind it yet, which is the one case that
  // renders the placeholders.
  const result = request.data;

  if (result === null) {
    return (
      <div className={CLASSES.body} aria-busy="true">
        {/* Shaped like what is arriving: the figures the run will state, then the plot, the legend, the paired
            table at the buckets this period and cut resolve to, and a page of the table with its export row. */}
        <ReportBodyPlaceholder
          chart={{
            title: REPORTS_COPY.CUSTOMER_CHART_HEADING,
            description: definition.description,
            footer: <p className={CLASSES.rangeNote}>{periodNote(from, to)}</p>,
            rows: bucketCount({ from, to }, granularity),
            series: CHART_SERIES_COUNT,
          }}
          definition={definition}
          figures={SUMMARY_FIGURE_COUNT}
        />
      </div>
    );
  }

  // A period that gained no account and took no order: the run succeeded and holds no rows, so the state says
  // so and offers the one action that resolves it. The period is the page's, so the action is the page's too,
  // and all it does is widen the period to the widest this product accepts — the label names that widening
  // rather than the choice "Choose another period" would promise, which belongs to the range control above.
  // The state wears the block's own padding class itself, as the sibling views' states do, so the three tabs
  // render one state rather than one state at two sizes.
  if (result.rows.length === 0) {
    return (
      <div className={CLASSES.body}>
        <EmptyState
          title={EMPTY_STATES.reportRange.title}
          description={EMPTY_STATES.reportRange.description}
          headingLevel={2}
          className={CLASSES.empty}
          actionLabel={EMPTY_STATES.dashboardRange.actionLabel}
          onAction={onWidenRange}
        />
      </div>
    );
  }

  const isBusy = request.status === "loading";

  return (
    // The region carries the busy state while the run is in flight: the placeholders inside it are written
    // against it, and so are the figures of a run a newer one supersedes — the summary, the chart and the
    // table stay as they were, the table marking its own rows busy, until the new figures land.
    <div className={CLASSES.body} {...(isBusy ? { "aria-busy": true } : {})}>
      {/* One labelled figure per summary item, each rendered from its column's own format, so a money figure
          here reads as the same figure the table states below it. */}
      <dl className={CLASSES.summary}>
        {result.summary.items.map((item) => (
          <div className={CLASSES.summaryItem} key={item.key}>
            <dt className={CLASSES.summaryLabel}>{item.label}</dt>
            <dd className={CLASSES.summaryValue}>{formatCellValue(item.value, item.format)}</dd>
          </div>
        ))}
      </dl>
      {/* The bands are periods, which is what the definition's first column holds, so the chart's paired
          table names that column with the report's own word for it rather than an empty heading, and the
          pager beneath it counts those periods rather than products. */}
      <BarChart
        series={result.series}
        title={REPORTS_COPY.CUSTOMER_CHART_HEADING}
        description={definition.description}
        labelHeader={definition.columns[0].label}
        countNoun={PAGING_NOUNS.PERIODS}
        footer={<p className={CLASSES.rangeNote}>{periodNote(result.from, result.to)}</p>}
        formatValue={formatInteger}
        formatAxisValue={formatCompactNumber}
        formatLabel={formatBandLabel}
        legendTotals={LEGEND_TOTALS}
        emptyMessage={EMPTY_STATES.reportRange.title}
      />
      {/* The run's own period, not the page's prop: this view keeps the last answered run on screen while a
          superseded one is in flight, so a caption, a run identity or a download named by the prop would state
          a period the rows below it do not cover. */}
      <ReportTable
        isBusy={isBusy}
        kind={REPORT_KIND}
        definition={definition}
        rows={result.rows}
        summary={result.summary}
        range={{ from: result.from, to: result.to }}
        granularity={result.granularity}
      />
    </div>
  );
}
