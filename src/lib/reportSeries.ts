/**
 * Path: src/lib/reportSeries.ts
 * Purpose: The series charted beside a report's table: the band of each row, its wording, and one series per charted column
 * Lines: 116
 */

import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import type {
  BucketGranularity,
  ChartSeries,
  ReportColumn,
  ReportDefinition,
  ReportKind,
  ReportRow,
} from "@/types/analytics";
import { formatBucketLabel } from "@/utils/dates";

/*
 * A §0.5.5 split of `src/lib/reportService.ts`, which was at the 600-line ceiling with this concern inside it:
 * the report service keeps the catalogue, the rows, the summaries and the export matrix, and the chart's half
 * of the contract lives here. `reportService` imports and re-exports `buildReportSeries`, so every consumer's
 * path still resolves the whole contract and nothing else changed.
 *
 * The concern itself is one rule: a band is identified and worded by its period, never by the figure plotted
 * in it. `chartPointKey` in `src/components/charts/chartGeometry.ts` takes a band's identity from a point's
 * `label` whenever it carries one, so a plotted figure written there in place of the period collapses every
 * bucket that recorded the same number into a single band, drops the buckets that lose the collision, and
 * leaves the axis, the readout and the paired data table with no bucket to name — which is what this file
 * exists to prevent. `x` is the band's key, `label` is its wording, and the figure is `y` alone, rendered by
 * each chart through its own value formatter.
 */

/** The column a report leads with: the one its definition marks as the figure its table totals. */
function headlineColumn(definition: ReportDefinition): ReportColumn | undefined {
  return definition.columns.find((column) => column.isTotal === true);
}

/** The band a row is charted in: the row's axis cell as text, and the row's own stable id for an axis that
 *  holds something other than text — never a plotted figure, because two periods that recorded the same
 *  number are two periods. */
function bandKeyOf(row: ReportRow, axisKey: string): string {
  const axis = row.cells[axisKey];
  return typeof axis === "string" ? axis : row.id;
}

/** A band's display wording: the bucket the axis cell opens, said in the wording of the cut that ran, and the
 *  key as it stands when that cell holds no date — a product's name is already the wording it reads by, so
 *  every band carries one. The wording is also the band's identity, which is why it is never the figure. */
function bandLabelOf(key: string, granularity: BucketGranularity): string {
  return formatBucketLabel(key, granularity) || key;
}

/** One charted column: its identity, its heading and a point per row whose band is named, not valued. */
function seriesOfColumn(
  rows: readonly ReportRow[],
  column: ReportColumn,
  seriesIndex: number,
  axisKey: string,
  granularity: BucketGranularity,
): ChartSeries {
  return {
    id: column.key,
    label: column.label,
    color: CHART_SERIES_TOKEN_REFERENCES[seriesIndex % CHART_SERIES_TOKEN_REFERENCES.length],
    points: rows.map((row) => {
      const key = bandKeyOf(row, axisKey);
      const value = row.cells[column.key];
      return {
        x: key,
        y: typeof value === "number" ? value : 0,
        label: bandLabelOf(key, granularity),
      };
    }),
  };
}

/**
 * The series charted beside the report `kind`'s table, built from the rows the table already shows.
 *
 * Deriving the chart from the rows rather than from a second pass over the collections is what stops the
 * two disagreeing, and a series keeps its `id` as the column key, so a re-bucketed view keeps its series
 * identity. The sales and product reports plot the column their definition marks as the table's total;
 * the customer report plots its two counts side by side.
 *
 * @param kind - The report the rows came from, which decides how many series are drawn.
 * @param rows - The rows the table shows, one band each for the period-keyed reports.
 * @param definition - The definition that ran: the source of the columns, their headings and their formats.
 * @param granularity - The cut the rows were bucketed by, which is what a period band is named in. Defaults
 *   to the definition's own cut, which is the cut a run that asked for none used.
 * @returns One series per charted column, each point's band keyed by its period and worded by that cut.
 */
export function buildReportSeries(
  kind: ReportKind,
  rows: readonly ReportRow[],
  definition: ReportDefinition,
  granularity: BucketGranularity = definition.granularity,
): ChartSeries[] {
  switch (kind) {
    case "sales": {
      const headline = headlineColumn(definition);
      return headline === undefined
        ? []
        : [seriesOfColumn(rows, headline, 0, "period", granularity)];
    }
    case "products": {
      const headline = headlineColumn(definition);
      return headline === undefined
        ? []
        : [seriesOfColumn(rows, headline, 0, "product", granularity)];
    }
    case "customers":
      return definition.columns
        .filter((column) => column.key === "newCustomers" || column.key === "returningCustomers")
        .map((column, index) => seriesOfColumn(rows, column, index, "period", granularity));
  }
}
