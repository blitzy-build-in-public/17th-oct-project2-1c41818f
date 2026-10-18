/**
 * Path: src/lib/reportSeries.ts
 * Purpose: The series charted beside a report's table: the band of each row, its wording, and one series per charted column
 * Lines: 16
 */

/*
 * The split path `docs/architecture.md` records for `src/lib/reportService.ts`, kept so that an import of
 * `@/lib/reportSeries` still resolves to the concern it names: the chart's half of the report contract now
 * lives in `src/utils/reportRules.ts`, beside the rows it charts, because the seeded repositories build a
 * report and a data module may import only from its own layer or from a layer below it. The rule the concern
 * holds — a band is identified and worded by its period, never by the figure plotted in it — is stated where
 * it is implemented.
 */

export { buildReportSeries } from "@/utils/reportRules";
