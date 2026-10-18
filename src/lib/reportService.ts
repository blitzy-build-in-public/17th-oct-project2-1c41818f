/**
 * Path: src/lib/reportService.ts
 * Purpose: The report catalogue, row building, summaries, chart series and the CSV matrix for export
 * Lines: 125
 */

import { MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import { DATE_RANGE_COPY, VALIDATION_MESSAGES, rangeTooLongMessage } from "@/constants/content";
import { API_ERROR_CODES, API_PATHS, failure, fillApiPath, getJson } from "@/lib/apiClient";
import type {
  BucketGranularity,
  ReportDefinition,
  ReportKind,
  ReportQuery,
  ReportResult,
} from "@/types/analytics";
import type { IsoDateString, Result } from "@/types/common";
import { toFieldErrors, validateDateRange, type DateRangeErrorCode } from "@/utils/dates";
import type { ReportRunRequest } from "@/utils/reportRules";

// The public surface ------------------------------------------------------------------------------
// The report rules this module is named for — the catalogue, the row builders, the summaries, the totals row,
// the export matrix and the composition the seam's `runReport` calls — live in `src/utils/reportRules.ts`, in
// the foundations layer, because the data module answers that endpoint by composing them and a file may import
// only from its own layer or from a layer below it. Every name a consumer imports stays at this path.

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
  toCsvMatrix,
  totalsRowCells,
  type ReportDataInput,
  type ReportRunRequest,
} from "@/utils/reportRules";

// The series charted beside a report, re-exported from the split path this file grew when it reached the
// 600-line ceiling: a consumer importing it from here is served exactly as before.
export { buildReportSeries } from "@/lib/reportSeries";

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
