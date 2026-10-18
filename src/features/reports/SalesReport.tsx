/**
 * Path: src/features/reports/SalesReport.tsx
 * Purpose: The sales report: bucketed table, totals row, summary metrics and paired chart
 * Lines: 271
 */

import { useCallback } from "react";
import type { ReactElement, ReactNode } from "react";

import { LineChart } from "@/components/charts/LineChart";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, DATE_RANGE_COPY, EMPTY_STATES, REPORTS_COPY } from "@/constants/content";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
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
import { formatBucketLabel } from "@/utils/dates";
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
 * state of a period with nothing to plot; and the loading, empty and error states are the primitives of
 * `src/components/ui/Feedback.tsx`, each carrying its own class. No colour, radius or shadow literal, and no
 * pixel media query, is written here.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` words no heading for the figures block, so the
 * summary is a definition list of labelled figures with no heading of its own — a labelled figure describes
 * itself, and a sentence invented here would put user-facing copy outside its one home.
 *
 * BLITZY [A11Y]: the empty state reuses the library's `reportRange` sentences, whose own action ("Choose
 * another period") belongs to the range control that `src/features/reports/DateRangePicker.tsx` renders for
 * the page owning the range. This view is handed a range and cannot change it, so the two sentences are
 * rendered without a control: a button promising a period change this view cannot make would resolve nothing.
 * The reader changes the period in the control directly above the report.
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
 * The height the chart-shaped placeholder stands in at, in the frame's own block-size expression: the token
 * arithmetic `src/styles/admin-reports.css` gives the plot frame (the space-20 token three times over), so the
 * placeholder occupies the space the chart will and nothing shifts when the series arrive.
 */
const CHART_PLACEHOLDER_HEIGHT = "calc(var(--space-20) * 3)";

/** How many text lines the table-shaped placeholder stacks: enough rows to read as a table rather than as one. */
const TABLE_PLACEHOLDER_LINES = 6;

/**
 * The level the empty state's headline renders at. A report body sits under the page's own heading, so its
 * empty state is a section of that page rather than a page of its own.
 */
const EMPTY_STATE_HEADING_LEVEL = 3;

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
 * new one. The session token travels with the request, because the report endpoints admit an administrator
 * alone and the seam answers `401` to one that carries no credential — a failure this view renders as its
 * error state with a retry, never hides.
 *
 * Failures arrive as values: they come back as a failed `Result` and are rendered by the alert, so no
 * `try`/`catch` wraps the call. A range that recorded no activity is not a failure but a legitimate answer
 * with no rows, and it renders as the empty state rather than as an empty table.
 *
 * @param props - The period to report on and the cut to bucket it by; see {@link SalesReportProps}.
 * @returns The report body: its period sentence, then the figures, the chart and the table.
 */
export function SalesReport({ range, granularity }: SalesReportProps): ReactElement {
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
  );

  // Derived from the props alone during render, so the period is stated in every state: while the rows are in
  // flight, when the request failed, and when the period recorded nothing.
  const periodSentence = describePeriod(DEFINITION, query);

  // The axis, the readout and the paired data table all word a period through this one formatter, so the
  // bucket's human wording stays `src/utils/dates.ts`'s; a series point's label is already the band's wording,
  // so a key that no longer parses as a date is printed as it stands. The x values are the rows' own `period`
  // cells — the day each bucket opens — which is what makes the axis read a period as the table and export do.
  const formatLabel = useCallback(
    (key: string): string => formatBucketLabel(key, granularity) || key,
    [granularity],
  );

  const isLoading = status === "idle" || status === "loading";
  const failure = status === "error" ? error : null;
  const report = data;

  let content: ReactNode;
  if (isLoading) {
    // Shaped like what is arriving: a plot-height block where the chart will stand, and the text lines of a
    // table-shaped run beneath it.
    content = (
      <>
        <Skeleton variant="block" height={CHART_PLACEHOLDER_HEIGHT} />
        <Skeleton variant="text" lines={TABLE_PLACEHOLDER_LINES} />
      </>
    );
  } else if (failure !== null) {
    content = (
      <Alert tone="danger" error={failure} actionLabel={COMMON_ACTIONS.RETRY} onAction={reload} />
    );
  } else if (report === null) {
    // Neither loading nor failed and still holding no result: `useAsync` sets a payload only by a successful
    // run, so this cannot happen. It renders the shape the content arrives in rather than nothing.
    content = <Skeleton variant="block" height={CHART_PLACEHOLDER_HEIGHT} />;
  } else if (report.rows.length === 0) {
    content = (
      <EmptyState
        className={CLASSES.empty}
        title={EMPTY_STATES.reportRange.title}
        description={EMPTY_STATES.reportRange.description}
        headingLevel={EMPTY_STATE_HEADING_LEVEL}
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
        <LineChart
          series={report.series}
          title={REPORTS_COPY.SALES_CHART_HEADING}
          formatLabel={formatLabel}
        />
        <ReportTable
          kind={DEFINITION.kind}
          definition={DEFINITION}
          rows={report.rows}
          summary={report.summary}
          range={range}
          granularity={granularity}
        />
      </>
    );
  }

  return (
    <div className={CLASSES.body}>
      {hasCopy(periodSentence) ? <p className={CLASSES.period}>{periodSentence}</p> : null}
      {content}
    </div>
  );
}
