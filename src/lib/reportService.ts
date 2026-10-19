/**
 * Path: src/lib/reportService.ts
 * Purpose: The report catalogue, row building, summaries, chart series and the CSV matrix for export
 * Lines: 220
 */

import { MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import {
  DATE_RANGE_COPY,
  REPORTS_COPY,
  VALIDATION_MESSAGES,
  rangeTooLongMessage,
} from "@/constants/content";
import { API_ERROR_CODES, API_PATHS, failure, fillApiPath, getJson } from "@/lib/apiClient";
import type {
  BucketGranularity,
  CsvMatrix,
  ReportCellValue,
  ReportDefinition,
  ReportKind,
  ReportQuery,
  ReportResult,
  ReportRow,
  ReportSummary,
} from "@/types/analytics";
import type { DateRange, IsoDateString, Result } from "@/types/common";
import { formatBucketCellForExport, toFieldErrors, validateDateRange } from "@/utils/dates";
import type { DateRangeErrorCode } from "@/utils/dates";
import { formatCellValueForExport } from "@/utils/format";
import type { ReportRunRequest } from "@/utils/reportRules";

// The public surface ------------------------------------------------------------------------------
// The report rules this module is named for — the catalogue, the row builders, the summaries and the
// composition the seam's `runReport` calls — live in `src/utils/reportRules.ts`, in the foundations layer,
// because the data module answers that endpoint by composing them and a file may import only from its own layer
// or from a layer below it. The export matrix lives here instead, with the service that publishes it, because
// only the view that downloads a report reads it and the rules module sits at the 600-line ceiling. Every name a
// consumer imports stays at this path.

export {
  buildCustomerRows,
  buildProductPerformanceRows,
  buildRows,
  buildSalesRows,
  defaultReportQuery,
  findDefinition,
  runReportDefinition,
  summarise,
  summarisePeriodLabel,
  type ReportDataInput,
  type ReportRunRequest,
} from "@/utils/reportRules";

// The series charted beside a report: one file may not exceed 600 lines, so the chart's half of the report
// contract lives in `src/lib/reportSeries.ts`, and this path re-exports it for a consumer that imports it here.
export { buildReportSeries } from "@/lib/reportSeries";

// The export matrix -------------------------------------------------------------------------------

/**
 * The run a CSV matrix is written for: the range its rows were read over and the cut they were bucketed by.
 *
 * The period column's wording is the one cell that needs the run rather than the row, because a bucket the
 * range clips states the days of it the range holds — `2026-09-19 – 2026-09-30` for a month the range opens
 * inside. The product's export always supplies it; the run is optional so that a caller writing a matrix from
 * rows alone keeps the row-for-row behaviour it had.
 */
export interface ReportCsvRun {
  /** The range the rows were read over: what a bucket the range clips is worded against. */
  readonly range: DateRange;
  /** The cut the rows were bucketed by, which is what the bucket in a period cell is read at. */
  readonly granularity: BucketGranularity;
}

/** The key the period column carries in every definition that has one, so the wording below is attached to the
 *  column of dates rather than to a column's position in the table. */
const PERIOD_COLUMN_KEY = "period";

/** The totals row a report's table ends with, one cell per column in the table's own column order: the
 *  definition's totals-row label in the leading column, the summary's figure for every column it states one
 *  for, and an empty cell for a column with no total. */
export function totalsRowCells(
  definition: ReportDefinition,
  summary: ReportSummary,
): readonly ReportCellValue[] {
  const totals = new Map(summary.items.map((item) => [item.key, item.value] as const));
  return definition.columns.map((column, index) =>
    index === 0 ? REPORTS_COPY.TOTALS_ROW_LABEL : (totals.get(column.key) ?? null),
  );
}

/**
 * The flattened export matrix `src/utils/csv.ts` serialises: the definition's own headings, one row per report
 * row, then the totals row, so the file a reader opens is the table they were reading and the totals row is the
 * one the table renders rather than a second sum.
 *
 * Cells are rendered by `formatCellValueForExport`, which writes money as the plain decimal a spreadsheet can
 * sum — the same figure the table shows, written for the reader a download serves — while escaping, clipping and
 * the row cap are left to the CSV module, which owns them. With a `run`, the period column's cells are written
 * by `formatBucketCellForExport`, the export twin of the wording the table's own period cell uses, so a bucket
 * the run's range clips states the days the range holds instead of the day the bucket nominally opens; every
 * other cell, and every cell of the totals row, is written as it is without a run. A period cell the run's own
 * wording cannot read — a value naming no bucket — keeps that rendering, which is what leaves a totals row's
 * label intact.
 *
 * @param definition - The definition that ran: the source of the columns, their headings and their formats.
 * @param rows - Every row the run produced, in the order the table states them.
 * @param summary - The figures the run states, whose totals row closes the matrix.
 * @param run - The run the rows came from, whose range and cut word the period column; omitted, every cell is
 *   written from its own value alone.
 * @returns The header row, the body rows and the totals row the CSV module serialises.
 */
export function toCsvMatrix(
  definition: ReportDefinition,
  rows: readonly ReportRow[],
  summary: ReportSummary,
  run?: ReportCsvRun,
): CsvMatrix {
  const { columns } = definition;
  const totals = totalsRowCells(definition, summary);
  return {
    header: columns.map((column) => column.label),
    rows: [
      ...rows.map((row) =>
        columns.map((column) => {
          const value = row.cells[column.key];
          if (run === undefined || column.key !== PERIOD_COLUMN_KEY) {
            return formatCellValueForExport(value, column.format);
          }
          const period =
            typeof value === "string"
              ? formatBucketCellForExport(value, run.granularity, run.range)
              : "";
          return period === "" ? formatCellValueForExport(value, column.format) : period;
        }),
      ),
      columns.map((column, index) => formatCellValueForExport(totals[index], column.format)),
    ],
  };
}

// The client API ----------------------------------------------------------------------------------

/** What a caller adds to a request: the token every administrator endpoint requires, and the signal that
 *  abandons a superseded run. */
export interface ReportRequestOptions {
  /** The signed-in session's token. */
  readonly sessionToken?: string;
  /** Aborts a superseded request, so a re-ranged view leaves no older answer behind. */
  readonly signal?: AbortSignal;
}

/** The wording for each rule a range can break, from the copy module, so a range refused here reads as
 *  the seam words the same refusal. */
const RANGE_MESSAGES: Readonly<Record<DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

/** The refusal `query` earns for a range that breaks a rule, or `null` when it is usable: the seam's own
 *  field-rule failure, built through the vocabulary the seam publishes, because `validateDateRange`'s
 *  rules are applied here before the request leaves, so a picker gets its field error without a round
 *  trip. */
function unusableRange(query: ReportQuery): Result<never> | null {
  const validation = validateDateRange(query.from, query.to);
  if (validation.valid) return null;
  const errors = toFieldErrors(validation, RANGE_MESSAGES);
  const field = Object.keys(errors)[0] ?? "range";
  return failure(API_ERROR_CODES.VALIDATION_FAILED, errors[field] ?? "", field);
}

/** The report catalogue as the server offers it. The endpoint is administrator-only, so a caller without
 *  the role is answered `403` and one without a session `401`, both as shaped failures. */
export function listReportDefinitions(
  options: ReportRequestOptions = {},
): Promise<Result<ReportDefinition[]>> {
  return getJson<ReportDefinition[]>(API_PATHS.REPORT_DEFINITIONS, {
    sessionToken: options.sessionToken,
    signal: options.signal,
  });
}

/**
 * Runs one report over a range, asked for either as the request object or as its parts —
 * `runReport(kind, from, to, bucket)` — and refuses a range that breaks a rule before the request leaves,
 * so a picker gets the field it broke without a round trip. A usable range is run by the seam, which
 * answers `404` for a kind no definition declares; an empty range returns a result with no rows.
 *
 * @param requestOrKind - The kind and the range, or the kind alone with the range given separately.
 * @param options - The session token the endpoint requires, and the abort signal of a superseded run.
 * @returns The run report, or the failure the seam answered with.
 */
export async function runReport(
  requestOrKind: ReportRunRequest | ReportKind,
  fromOrOptions?: IsoDateString | ReportRequestOptions,
  to?: IsoDateString,
  bucket?: BucketGranularity,
  options?: ReportRequestOptions,
): Promise<Result<ReportResult>> {
  const request: ReportRunRequest =
    typeof requestOrKind === "string"
      ? {
          kind: requestOrKind,
          from: typeof fromOrOptions === "string" ? fromOrOptions : "",
          to: to ?? "",
          bucket,
        }
      : requestOrKind;
  const settings: ReportRequestOptions =
    typeof fromOrOptions === "object" ? fromOrOptions : (options ?? {});
  const refusal = unusableRange(request);
  if (refusal !== null) return refusal;
  return getJson<ReportResult>(fillApiPath(API_PATHS.REPORT_RUN, { kind: request.kind }), {
    query: { from: request.from, to: request.to, bucket: request.bucket },
    sessionToken: settings.sessionToken,
    signal: settings.signal,
  });
}
