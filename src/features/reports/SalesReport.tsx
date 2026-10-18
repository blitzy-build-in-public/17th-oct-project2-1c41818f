/**
 * Path: src/features/reports/SalesReport.tsx
 * Purpose: The sales report: bucketed table, totals row, summary metrics and paired chart
 * Lines: 312
 */

import { useCallback } from "react";
import type { ReactElement, ReactNode } from "react";

import { LineChart } from "@/components/charts/LineChart";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, EMPTY_STATES, PAGING_NOUNS } from "@/constants/content";
import { DATE_RANGE_COPY, REPORTS_COPY } from "@/constants/content-reports";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { ReportBodyPlaceholder } from "@/features/reports/ReportPlaceholder";
import { findDefinition, runReport, summarisePeriodLabel } from "@/lib/reportService";
import { useAuth } from "@/state/AuthContext";
import { useAsync } from "@/state/hooks";
import type {
  BucketGranularity,
  ReportDefinition,
  ReportKind,
  ReportQuery,
  ReportResult,
} from "@/types/analytics";
import type { DateRange } from "@/types/common";
import { bucketCount, formatBucketLabel } from "@/utils/dates";
import { formatCellValue } from "@/utils/format";

import { ReportTable } from "./ReportTable";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of the report shell, and no file
 * under `src/features/**` may import a stylesheet — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class below is adopted by name, and this comment is the list the sheet owes the file:
 * `sp-report__body` is the grid this view stacks its period sentence, its figures, its chart and its table in;
 * `sp-report__summary` is that figures block, one column on a phone, two from the small stop and four from the
 * large one, with `sp-report__summary-item`, `sp-report__summary-label` and `sp-report__summary-value` for one
 * figure; `sp-report__empty` is the padding a period that recorded no activity stands in; and `sp-range-note`
 * is the caption sentence stating the period and whose clock its days follow.
 *
 * Everything else the view shows belongs to the components it composes. `ReportTable` owns the CSV export
 * action and its note, the sortable table, its caption, its paging and the totals row closing it, so no table
 * is configured and no export control is written here; `LineChart` owns the plot, the axis ticks, the readout,
 * the legend, the paired `.sp-chart__data` table every figure is also readable in and the fixed-height no-data
 * state of a period with nothing to plot; the loading state is `ReportPlaceholder`'s, which shapes the figures,
 * the chart and the table at this report's own counts; and the empty and error states are the primitives of
 * `src/components/ui/Feedback.tsx`, each carrying its own class. No colour, radius or shadow literal, and no
 * pixel media query, is written here.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content-reports.ts` words no heading for the figures block, so the
 * summary is a definition list of labelled figures with no heading of its own — a labelled figure describes
 * itself, and a sentence invented here would put user-facing copy outside its one home.
 */

/**
 * The report this view runs, named once so the run below asks for the definition's own kind rather than
 * repeating the string.
 */
const KIND: ReportKind = "sales";

/**
 * The vocabulary entry this view delivers: the sales report's name and description, its columns with their
 * headings and cell formats, and the cut a query that asks for none is bucketed by. Resolved once at module
 * scope, so the identity the table, the chart and the export are configured from never changes between
 * renders. The fallback mirrors `reportService`, which resolves a definition the same way.
 */
const DEFINITION: ReportDefinition =
  findDefinition(REPORT_DEFINITIONS, KIND) ?? REPORT_DEFINITIONS[0];

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  body: "sp-report__body",
  period: "sp-range-note",
  summary: "sp-report__summary",
  summaryItem: "sp-report__summary-item",
  summaryLabel: "sp-report__summary-label",
  summaryValue: "sp-report__summary-value",
  empty: "sp-report__empty",
} as const;

/**
 * What joins the parts of the period sentence. Neither part is worded here — the description is the
 * vocabulary module's, the period is `src/utils/dates.ts`'s and the note is the copy module's — so this file
 * authors no sentence, only the punctuation between three it was handed.
 */
const PERIOD_SEPARATOR = " · ";

/**
 * The figures a sales run states above its table, which is what the loading summary stands in with: one entry
 * per figure `src/lib/reportService.ts` totals for this kind — its orders, units, gross revenue, discounts,
 * refunds and net revenue — so the grid reserves the two rows of four it fills with six entries.
 */
const SUMMARY_FIGURE_COUNT = 6;

/**
 * The series the sales chart draws: one line — the range's net revenue per period — which is the single series
 * `src/lib/reportService.ts` builds for this kind, and so the number of legend entries the placeholder stands
 * in with.
 */
const CHART_SERIES_COUNT = 1;

/**
 * The level the empty state's headline renders at: the report body is a section of the page, one level below
 * its `h1`, so a range that recorded no activity states itself at that section's level rather than deeper.
 */
const EMPTY_STATE_HEADING_LEVEL = 2;

/**
 * Whether a sentence holds words a reader can see, so a part that is absent leaves no stray separator behind.
 *
 * @param value - The copy a caller or a dependency supplied, if any.
 * @returns True when the value holds something other than whitespace.
 */
function hasCopy(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * The sentence under the page's heading: what the report answers, the period it covers and whose clock its
 * days follow, each already worded elsewhere — the definition's description from the vocabulary module, the
 * period from `summarisePeriodLabel`, which formats both ends through `src/utils/dates.ts`, and the local-time
 * note from the copy module. A part that is absent or unreadable is left out rather than rendered as a gap.
 *
 * @param definition - The report definition whose description leads the sentence.
 * @param query - The range the run was asked for, as the page holds it.
 * @returns The sentence, or `""` when no part of it can be stated.
 */
function describePeriod(definition: ReportDefinition, query: ReportQuery): string {
  return [definition.description, summarisePeriodLabel(query), DATE_RANGE_COPY.LOCAL_TIME_NOTE]
    .filter((part) => part !== "")
    .join(PERIOD_SEPARATOR);
}

/**
 * Everything {@link SalesReport} accepts.
 *
 * The page owns the report selector and the range, so this view is a pure projection of one query — the range
 * it is handed at the cut it is handed — over one run. It holds no range, no bucket and no report choice of
 * its own: a page that wants a different period or a different cut passes a different range or granularity,
 * which re-runs the report.
 */
export interface SalesReportProps {
  /** The period every figure covers: the two days the run is asked for and the table's caption states. */
  readonly range: DateRange;
  /** The cut the rows are bucketed by, and the wording the chart's axis, readout and paired table use. */
  readonly granularity: BucketGranularity;
  /** The one action this report's no-activity state offers, asked of the page that owns the period: it widens
   *  the range to the widest the product accepts, so a period that recorded nothing has a way out. */
  readonly onWidenRange: () => void;
}

/**
 * The sales report: the figures the period came to, the chart they are drawn in, and the bucketed table a
 * reader sorts and exports.
 *
 * One read feeds all of it. `runReport` answers a `ReportResult` whose `rows`, `summary` and `series` are one
 * computation, so the figures above the table, the totals row closing it, the line beside it and the CSV a
 * reader takes away cannot state different numbers: the table's cells and totals are `ReportTable`'s own
 * reading of that result, and its export is `reportService.toCsvMatrix` over the same rows.
 *
 * The read is owned here rather than by the page, because the period and the cut are exactly what it depends
 * on: `useAsync` is keyed on them, so a changed range or bucket re-runs it and cancels the request it
 * supersedes through the abort signal, rather than letting an answer for the previous period land under the
 * new one. It keeps the result it last answered with, so a moved period or a changed cut moves the figures
 * in place — the same summary block, chart and table, reporting the wait through the region's busy state —
 * instead of emptying the report and re-creating those containers around the reader. The session token
 * travels with the request, because the report endpoints admit an administrator alone and the seam answers
 * `401` to one that carries no credential — a failure this view renders as its error state with a retry,
 * never hides.
 *
 * Failures arrive as values: they come back as a failed `Result` and are rendered by the alert, so no
 * `try`/`catch` wraps the call. A range that recorded no activity is not a failure but a legitimate answer
 * with no rows, and it renders as the empty state rather than as an empty table.
 *
 * @param props - The period to report on, the cut to bucket it by and the action its empty state offers; see
 * {@link SalesReportProps}.
 * @returns The report body: its period sentence, then the figures, the chart and the table.
 */
export function SalesReport({ range, granularity, onWidenRange }: SalesReportProps): ReactElement {
  const { session } = useAuth();
  // The credential the report endpoints require, read from the session rather than kept here: the state layer
  // owns the session. The seam re-checks the role on every request, so the guard above this view is
  // convenience and this token is not the control.
  const sessionToken = session?.token;

  // The query this render is about, built from the two props: it is the run's request, the identity of the run
  // below and the period the sentence states. Nothing derived from it is stored — a changed range or cut is a
  // new render and the run follows it — and only its own primitives go into the dependency list.
  const query: ReportQuery = { from: range.from, to: range.to, bucket: granularity };

  const { status, data, error, reload } = useAsync<ReportResult>(
    (signal) =>
      runReport(
        { kind: DEFINITION.kind, from: query.from, to: query.to, bucket: query.bucket },
        { sessionToken, signal },
      ),
    [query.from, query.to, query.bucket, sessionToken],
    // A moved period or a changed cut re-runs this view over the rows it is already showing, so the run
    // keeps the last answered result in hand: the report table and the chart keep their rows and their
    // figure block, and the region's `aria-busy` reports the wait until the new run's figures land. A view
    // the selector has just mounted has no earlier run behind it, so its own first load still renders the
    // placeholders.
    { keepPreviousData: true },
  );

  // Derived from the props alone during render, so the period is stated in every state: while the rows are in
  // flight, when the request failed, and when the period recorded nothing.
  const periodSentence = describePeriod(DEFINITION, query);

  // The axis, the readout and the paired data table all word a period through this one formatter, so the
  // bucket's human wording stays `src/utils/dates.ts`'s, told the period the run covers — a bucket the range
  // clips is worded by the days of it the range holds; a series point's label is already the band's wording,
  // so a key that no longer parses as a date is printed as it stands. The x values are the rows' own `period`
  // cells — the day each bucket opens — which is what makes the axis read a period as the table and export do.
  const formatLabel = useCallback(
    (key: string): string => formatBucketLabel(key, granularity, range) || key,
    [granularity, range],
  );

  const isLoading = status === "idle" || status === "loading";
  const failure = status === "error" ? error : null;

  // The run on screen: the payload while the read holds one, and — because this view asks the read to keep
  // the payload it last answered with — the figures of the previous run for as long as the run that
  // supersedes it takes. `null` therefore means the view has no run behind it yet, which is the one case
  // that renders the placeholders.
  const report = data;

  let content: ReactNode;
  if (failure !== null) {
    // The failure takes the region whatever the previous run left there: a period whose figures could not
    // be read is not a period to keep showing earlier ones for, and the retry is the way on from it.
    content = (
      <Alert tone="danger" error={failure} actionLabel={COMMON_ACTIONS.RETRY} onAction={reload} />
    );
  } else if (report === null) {
    // Nothing has arrived and nothing failed: the first run of this view is in flight, or this is the
    // render before the hook has started it. Shaped like what is arriving — the figures the run will state,
    // then the plot, the legend and the paired table at the buckets this period and cut resolve to, then a
    // page of the table with its totals row.
    content = (
      <ReportBodyPlaceholder
        chart={{
          title: REPORTS_COPY.SALES_CHART_HEADING,
          rows: bucketCount({ from: query.from, to: query.to }, granularity),
          series: CHART_SERIES_COUNT,
        }}
        definition={DEFINITION}
        figures={SUMMARY_FIGURE_COUNT}
      />
    );
  } else if (report.rows.length === 0) {
    // A range that recorded no activity is a well-formed answer, not a failure, and the state offers the one
    // action that resolves it. The action belongs to the page, which owns the period, and all it does is widen
    // the period to the widest this product accepts — so the label names the widening rather than the choice
    // "Choose another period" would promise: narrowing a period is the range control's job above the report.
    content = (
      <EmptyState
        className={CLASSES.empty}
        title={EMPTY_STATES.reportRange.title}
        description={EMPTY_STATES.reportRange.description}
        headingLevel={EMPTY_STATE_HEADING_LEVEL}
        actionLabel={EMPTY_STATES.dashboardRange.actionLabel}
        onAction={onWidenRange}
      />
    );
  } else {
    content = (
      <>
        <dl className={CLASSES.summary}>
          {report.summary.items.map((item) => (
            <div className={CLASSES.summaryItem} key={item.key}>
              <dt className={CLASSES.summaryLabel}>{item.label}</dt>
              <dd className={CLASSES.summaryValue}>{formatCellValue(item.value, item.format)}</dd>
            </div>
          ))}
        </dl>
        {/* The chart's bands are the periods the run holds, one row each in its paired table, so the pager
            under that table counts periods — the same collection the report table below it counts. */}
        <LineChart
          series={report.series}
          title={REPORTS_COPY.SALES_CHART_HEADING}
          formatLabel={formatLabel}
          countNoun={PAGING_NOUNS.PERIODS}
        />
        {/* The run's own period, not the page's prop: this view keeps the last answered run on screen while
            a superseded one is in flight, so a caption, a run identity or a download named by the prop would
            state a period the rows below it do not cover. */}
        <ReportTable
          isBusy={isLoading}
          kind={DEFINITION.kind}
          definition={DEFINITION}
          rows={report.rows}
          summary={report.summary}
          range={{ from: report.from, to: report.to }}
          granularity={report.granularity}
        />
      </>
    );
  }

  return (
    // The region carries the busy state while the run is in flight: the placeholders inside it are written
    // against it, and so are the figures of a run a newer one supersedes — the table and the chart stay as
    // they were, the table marking its own rows busy, until the new figures land.
    <div className={CLASSES.body} {...(isLoading ? { "aria-busy": true } : {})}>
      {hasCopy(periodSentence) ? <p className={CLASSES.period}>{periodSentence}</p> : null}
      {content}
    </div>
  );
}
