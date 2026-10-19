/**
 * Path: src/lib/reportSeries.ts
 * Purpose: The series charted beside a report's table: the band of each row, its wording, and one series per charted column
 * Lines: 16
 */

/*
 * The compatibility path for a report's chart series: the chart's half of the report contract lives in
 * `src/utils/reportRules.ts`, beside the rows it charts, because the seeded repositories build a report and a
 * data module may import only from its own layer or from a layer below it. This module keeps an import of
 * `@/lib/reportSeries` resolving to the concern it names by re-exporting `buildReportSeries` from there, and
 * it holds no rule of its own: the rule the concern carries — a band is identified and worded by its period,
 * never by the figure plotted in it — is stated where it is implemented.
 */

export { buildReportSeries } from "@/utils/reportRules";
