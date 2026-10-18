/**
 * Path: src/utils/reportRules.ts
 * Purpose: The report rules the report service and the seeded repositories both compose: the catalogue, row building, summaries, chart series and the CSV matrix for export
 * Lines: 591
 */

import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { REPORTS_COPY, resolvedRangeLabel } from "@/constants/content";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import type { Customer } from "@/types/account";
import type {
  BucketGranularity,
  ChartSeries,
  CsvMatrix,
  ReportCellValue,
  ReportColumn,
  ReportDefinition,
  ReportKind,
  ReportQuery,
  ReportResult,
  ReportRow,
  ReportSummary,
  ReportSummaryItem,
  SalesRecord,
} from "@/types/analytics";
import type { DateRange, MinorUnits } from "@/types/common";
import type { Order } from "@/types/commerce";
import { createComparator, groupBy, sortBy, sumBy, uniqueBy } from "@/utils/collections";
import {
  bucketKey,
  bucketStart,
  defaultReportRange,
  eachBucket,
  formatBandLabel,
  formatDate,
  isWithinPreparedRange,
  prepareRange,
  startOfDay,
  toIsoDateTime,
} from "@/utils/dates";
import { formatCellValueForExport, roundMinorUnits } from "@/utils/format";
import { averageOrderValue, goodsRevenueMinor, periodOrders, shareOf } from "@/utils/statistics";

/**
 * The report rules, and the only home of each: the catalogue the reports view opens on, the rows the three
 * reports are built from, the summary figures stated over those rows, the totals row and the export matrix, the
 * composition the seam's `runReport` calls, and the series charted beside a table.
 *
 * They live here, in the foundations, rather than in the service that publishes them, because two layers need
 * them and the layer order lets a file import only from its own layer or from a layer below it:
 * `src/data/repositories.ts` answers the seam's `runReport` by composing {@link findDefinition} and
 * {@link runReportDefinition} over the collections it holds, and `src/lib/reportService.ts` re-exports every
 * name below, so a caller keeps importing the surface it always did while the data layer reaches this one home
 * from a layer below it.
 *
 * The rows are built once and everything else derives from them, so the three reports cannot disagree:
 * {@link summarise} states the totals from those rows, {@link buildReportSeries} charts them, and
 * {@link toCsvMatrix} flattens them with the definition's own columns. An empty range is a valid result, not a
 * failure: no rows, a zeroed summary and empty series. Column keys, headings and cell formats come from
 * `REPORT_DEFINITIONS`, sentences from the copy module, bucket keys and range rules from `src/utils/dates.ts`,
 * and escaping, clipping and the row cap from `src/utils/csv.ts`, which is handed an already-formatted matrix.
 */

// What a report is built from ---------------------------------------------------------------------

/** The seeded collections one run reads: the fact table, the order lines and the accounts, because the
 *  three reports read different halves of the same data. */
export interface ReportDataInput {
  /** Every seeded order, with its lines, its priced totals and the instant it was placed. */
  readonly orders: readonly Order[];
  /** The daily fact table: one row per day, category and channel, in integer minor units. */
  readonly salesRecords: readonly SalesRecord[];
  /** The seeded accounts, whose creation dates are the new-customer figures. */
  readonly customers: readonly Customer[];
}

/** The request a report is run with: the definition its path selects and the range it runs over. */
export type ReportRunRequest = ReportQuery & { readonly kind: ReportKind };

// The catalogue -----------------------------------------------------------------------------------

/** The cut a run falls back to when neither the query nor the definition names one. */
const DEFAULT_GRANULARITY: BucketGranularity = "day";

/** The catalogue entry for `kind`, or `undefined` when `definitions` declares none. */
export function findDefinition(
  definitions: readonly ReportDefinition[],
  kind: ReportKind,
): ReportDefinition | undefined {
  return definitions.find((definition) => definition.kind === kind);
}

/** The taxonomy's own entry for `kind`: the source of every column key, heading and format read here. */
function definitionFor(kind: ReportKind): ReportDefinition | undefined {
  return findDefinition(REPORT_DEFINITIONS, kind);
}

/** The cut a run uses: the query's own when it asks for one, else the definition's default, else a day. */
function resolveGranularity(
  definition: ReportDefinition | undefined,
  query: ReportQuery,
): BucketGranularity {
  return query.bucket ?? definition?.granularity ?? DEFAULT_GRANULARITY;
}

/** The range and cut the reports view opens on: the trailing `DEFAULT_REPORT_RANGE_DAYS` days and the
 *  cut of `kind`'s definition, the first definition's when no kind is named. */
export function defaultReportQuery(
  definitions: readonly ReportDefinition[],
  kind?: ReportKind,
): ReportQuery {
  const definition = kind === undefined ? definitions[0] : findDefinition(definitions, kind);
  return { ...defaultReportRange(), bucket: definition?.granularity ?? DEFAULT_GRANULARITY };
}

/** The period a report covers, as the range label the copy module composes from both ends formatted by
 *  `formatDate` — the same label the control that set the period reads — and `""` when an end cannot be
 *  parsed, so a heading never reads as a half-empty range. */
export function summarisePeriodLabel(query: ReportQuery): string {
  const from = formatDate(query.from);
  const to = formatDate(query.to);
  return from === "" || to === "" ? "" : resolvedRangeLabel(from, to);
}

// Rows --------------------------------------------------------------------------------------------

/** The totals of the named columns over `rows`, in one pass: a cell that is absent or holds text reads
 *  as `0`, only a finite number contributes, and every total passes through the one rounding rule. */
function sumColumns(rows: readonly ReportRow[], keys: readonly string[]): MinorUnits[] {
  const totals = keys.map(() => 0);
  for (const row of rows) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = row.cells[keys[index]];
      if (typeof value === "number" && Number.isFinite(value)) totals[index] += value;
    }
  }
  return totals.map((total) => roundMinorUnits(total));
}

/** The scale a share is converted across: a `percent` cell is a ratio, `shareOf` states a percentage. */
const PERCENT_SCALE = 100;

/** The price one unit went for: revenue over units, rounded once, and `0` when nothing sold. */
function averageUnitPrice(revenueMinor: MinorUnits, units: number): MinorUnits {
  return units > 0 ? roundMinorUnits(revenueMinor / units) : 0;
}

/** The sales report's rows: one per period the range enumerates, oldest first, so the period set is a
 *  function of the range alone and two reports over one range state the same periods. A period counts
 *  only the days of it inside the range, and states zeros when the fact table records nothing in it; a
 *  range the fact table holds no record in at all is a report of no rows, which is what makes an empty
 *  range a well-formed report. The `period` cell holds the day the period opens, so a partly covered
 *  month is still labelled by its own first day. */
export function buildSalesRows(
  input: ReportDataInput,
  query: ReportQuery,
  granularity: BucketGranularity,
): ReportRow[] {
  const range: DateRange = { from: query.from, to: query.to };
  const bounds = prepareRange(range);
  const records = input.salesRecords.filter((record) => isWithinPreparedRange(record.date, bounds));
  // Read once, before the periods are walked: a range nothing traded in is no rows at all rather than
  // every bucket of it zeroed, which is the report an empty range states.
  if (records.length === 0) return [];
  const byPeriod = groupBy(records, (record) => bucketKey(record.date, granularity));
  const rows: ReportRow[] = [];
  for (const bucket of eachBucket(range, granularity)) {
    const periodRecords = byPeriod.get(bucket.key) ?? [];
    const sums = { orders: 0, units: 0, grossRevenue: 0, discounts: 0, refunds: 0, netRevenue: 0 };
    for (const record of periodRecords) {
      sums.orders += record.orders;
      sums.units += record.units;
      sums.grossRevenue += record.grossRevenueMinor;
      sums.discounts += record.discountMinor;
      sums.refunds += record.refundMinor;
      sums.netRevenue += record.netRevenueMinor;
    }
    sums.grossRevenue = roundMinorUnits(sums.grossRevenue);
    sums.discounts = roundMinorUnits(sums.discounts);
    sums.refunds = roundMinorUnits(sums.refunds);
    sums.netRevenue = roundMinorUnits(sums.netRevenue);
    rows.push({
      id: bucket.key,
      cells: { period: bucketStart(bucket.key, granularity), ...sums },
    });
  }
  return rows;
}

/** One product's trade over a range: what it sold, what it earned and what it is called. */
interface ProductTally {
  readonly productId: string;
  readonly name: string;
  readonly units: number;
  readonly revenueMinor: MinorUnits;
}

/** The product-performance report's rows: one per product sold in the range, most revenue first, ties
 *  broken on the name so a range reproduces its order exactly.
 *
 * The rows are scanned from the order collection, because a fact row is keyed by category and channel and
 * carries no product: an order line is the only record of which product sold and what it cost then, and
 * it keeps the price it was charged at. */
export function buildProductPerformanceRows(
  input: ReportDataInput,
  query: ReportQuery,
): ReportRow[] {
  const range: DateRange = { from: query.from, to: query.to };
  const lines = periodOrders(input.orders, range).flatMap((order) => order.lines);
  const tallies: ProductTally[] = [...groupBy(lines, (line) => line.productId)].map(
    ([productId, productLines]) => ({
      productId,
      name: productLines[0].productName,
      units: sumBy(productLines, (line) => line.quantity),
      revenueMinor: roundMinorUnits(sumBy(productLines, (line) => line.lineTotalMinor)),
    }),
  );
  const totalRevenue = roundMinorUnits(sumBy(tallies, (tally) => tally.revenueMinor));
  const byRevenueAndName = createComparator<ProductTally>([
    { select: (tally) => tally.revenueMinor, direction: "desc" },
    { select: (tally) => tally.name, direction: "asc" },
  ]);
  return sortBy(tallies, byRevenueAndName).map((tally) => ({
    id: tally.productId,
    cells: {
      product: tally.name,
      unitsSold: tally.units,
      revenue: tally.revenueMinor,
      revenueShare: shareOf(tally.revenueMinor, totalRevenue) / PERCENT_SCALE,
      averageUnitPrice: averageUnitPrice(tally.revenueMinor, tally.units),
    },
  }));
}

/** The customers who ordered in a period without being created in it: an order placed without a session
 *  carries no customer and counts towards nothing here. */
function countReturningCustomers(orders: readonly Order[], newcomers: readonly Customer[]): number {
  const newIds = new Set<string>(newcomers.map((customer) => customer.id));
  return uniqueBy(orders, (order) => order.customerId).filter(
    (order) => order.customerId !== null && !newIds.has(order.customerId),
  ).length;
}

/** The customer report's rows: one per period that either gained an account or took an order, oldest
 *  first.
 *
 * `returningCustomers` counts the customers who ordered in the period without being created in it, so an
 * account created and used in one period is new rather than returning, and `averageOrderValue` divides
 * the period's revenue by its orders through the shared helper. `orders` and `revenue` are stated over
 * the period's one order population, from `periodOrders` in `src/utils/statistics.ts`, and `revenue` is
 * what those orders' goods brought net of the discounts that applied to them, through `goodsRevenueMinor`:
 * delivery and tax are not revenue, so this is the basis the dashboard's Revenue and Average-order-value
 * figures and the product-performance report's revenue also state — one range, one figure under the label.
 * A period that did neither produces no row. */
export function buildCustomerRows(
  input: ReportDataInput,
  query: ReportQuery,
  granularity: BucketGranularity,
): ReportRow[] {
  const range: DateRange = { from: query.from, to: query.to };
  const bounds = prepareRange(range);
  const dayOf = (value: string): string => bucketKey(startOfDay(value), granularity);
  const ordered = periodOrders(input.orders, range);
  const ordersByPeriod = groupBy(ordered, (order) => dayOf(order.placedAt));
  const newcomers = input.customers.filter((customer) =>
    isWithinPreparedRange(customer.createdAt, bounds),
  );
  const newcomersByPeriod = groupBy(newcomers, (customer) => dayOf(customer.createdAt));
  // Read once, before the periods are walked: a range that neither took an order nor gained an account
  // is no rows at all rather than every bucket of it zeroed, which is the report an empty range states.
  if (ordered.length === 0 && newcomers.length === 0) return [];
  const rows: ReportRow[] = [];
  for (const bucket of eachBucket(range, granularity)) {
    const bucketOrders = ordersByPeriod.get(bucket.key) ?? [];
    const periodNewcomers = newcomersByPeriod.get(bucket.key) ?? [];
    const revenueMinor = roundMinorUnits(sumBy(bucketOrders, goodsRevenueMinor));
    rows.push({
      id: bucket.key,
      cells: {
        period: bucketStart(bucket.key, granularity),
        newCustomers: periodNewcomers.length,
        returningCustomers: countReturningCustomers(bucketOrders, periodNewcomers),
        orders: bucketOrders.length,
        revenue: revenueMinor,
        averageOrderValue: averageOrderValue(revenueMinor, bucketOrders.length),
      },
    });
  }
  return rows;
}

/** The rows of the report `kind` names for the range `query` asks for: an exhaustive dispatch, each
 *  kind's rows from its own function so no report's rules hide in a branch shared with another. */
export function buildRows(
  kind: ReportKind,
  input: ReportDataInput,
  query: ReportQuery,
): ReportRow[] {
  switch (kind) {
    case "sales":
      return buildSalesRows(input, query, resolveGranularity(definitionFor(kind), query));
    case "products":
      return buildProductPerformanceRows(input, query);
    case "customers":
      return buildCustomerRows(input, query, resolveGranularity(definitionFor(kind), query));
  }
}

// Summaries and the export matrix -----------------------------------------------------------------

/** The summary items for `definition`, from the totals a kind's rows state: each figure keyed by the
 *  column it belongs to and labelled by that column, so the table and the export read one list. */
function summaryItems(
  definition: ReportDefinition,
  totals: readonly (readonly [string, ReportCellValue])[],
): ReportSummaryItem[] {
  const items: ReportSummaryItem[] = [];
  for (const [key, value] of totals) {
    const column = definition.columns.find((candidate) => candidate.key === key);
    if (column === undefined) continue;
    items.push({ key: column.key, label: column.label, value, format: column.format });
  }
  return items;
}

/** The totals a sales report states: each figure of its table summed over the periods it shows. */
function summariseSales(
  rows: readonly ReportRow[],
  definition: ReportDefinition,
): ReportSummaryItem[] {
  const keys = ["orders", "units", "grossRevenue", "discounts", "refunds", "netRevenue"];
  const totals = sumColumns(rows, keys);
  const items = keys.map((key, index) => [key, totals[index]] as const);
  return summaryItems(definition, items);
}

/** The totals a product report states: units and revenue summed, and the average unit price over the
 *  range; `revenueShare` is absent deliberately, because a share of the range's revenue says nothing. */
function summariseProducts(
  rows: readonly ReportRow[],
  definition: ReportDefinition,
): ReportSummaryItem[] {
  const [units, revenueMinor] = sumColumns(rows, ["unitsSold", "revenue"]);
  return summaryItems(definition, [
    ["unitsSold", units],
    ["revenue", revenueMinor],
    ["averageUnitPrice", averageUnitPrice(revenueMinor, units)],
  ]);
}

/** The totals a customer report states, with `returningCustomers` absent deliberately: summing the
 *  periods' counts would count a customer who ordered in two periods twice. */
function summariseCustomers(
  rows: readonly ReportRow[],
  definition: ReportDefinition,
): ReportSummaryItem[] {
  const [newCount, orders, revenueMinor] = sumColumns(rows, ["newCustomers", "orders", "revenue"]);
  return summaryItems(definition, [
    ["newCustomers", newCount],
    ["orders", orders],
    ["revenue", revenueMinor],
    ["averageOrderValue", averageOrderValue(revenueMinor, orders)],
  ]);
}

/**
 * The figures the report `kind` states beside its rows, keyed by the column each belongs to and in the
 * column order the definition declares.
 *
 * One function produces both the metrics a report shows and the totals row its table ends with, which is
 * what makes the export match the screen: the table renders a cell from the item whose key is the
 * column's key, `toCsvMatrix` writes the same item, and neither computes a total itself. An empty range
 * totals to zero, because zero is what nothing came to.
 *
 * @param _query - The run the rows came from: every total is read from the rows alone, so the query is
 * accepted for the shape the run composes with and is deliberately not read.
 * @returns The summary items, in the definition's column order.
 */
export function summarise(
  kind: ReportKind,
  rows: readonly ReportRow[],
  _query: ReportQuery,
): ReportSummary {
  const definition = definitionFor(kind) ?? REPORT_DEFINITIONS[0];
  switch (kind) {
    case "sales":
      return { items: summariseSales(rows, definition) };
    case "products":
      return { items: summariseProducts(rows, definition) };
    case "customers":
      return { items: summariseCustomers(rows, definition) };
  }
}

/** The totals row a report's table ends with, one cell per column in the table's own column order: the
 *  definition's totals-row label in the leading column, the summary's figure for every column it states
 *  one for, and an empty cell for a column with no total. */
export function totalsRowCells(
  definition: ReportDefinition,
  summary: ReportSummary,
): readonly ReportCellValue[] {
  const totals = new Map(summary.items.map((item) => [item.key, item.value] as const));
  return definition.columns.map((column, index) =>
    index === 0 ? REPORTS_COPY.TOTALS_ROW_LABEL : (totals.get(column.key) ?? null),
  );
}

/** The flattened export matrix `src/utils/csv.ts` serialises: the definition's own headings, one row per
 *  report row, then the totals row, so the file a reader opens is the table they were reading and the
 *  totals row is the one the table renders rather than a second sum.
 *
 * Cells are rendered by `formatCellValueForExport`, which writes money as the plain decimal a spreadsheet
 * can sum — the same figure the table shows, written for the reader a download serves — while escaping,
 * clipping and the row cap are left to the CSV module, which owns them. */
export function toCsvMatrix(
  definition: ReportDefinition,
  rows: readonly ReportRow[],
  summary: ReportSummary,
): CsvMatrix {
  const { columns } = definition;
  const totals = totalsRowCells(definition, summary);
  return {
    header: columns.map((column) => column.label),
    rows: [
      ...rows.map((row) =>
        columns.map((column) => formatCellValueForExport(row.cells[column.key], column.format)),
      ),
      columns.map((column, index) => formatCellValueForExport(totals[index], column.format)),
    ],
  };
}

// The composition the data source runs ------------------------------------------------------------

/**
 * A whole report run: its rows, the summary, the chart beside it and when it was built.
 *
 * This is the single entry point `src/data/repositories.ts` calls to satisfy the seam's `runReport`, so
 * the rows the table shows, the totals it states and the series it draws come from one read of the seeded
 * collections. An empty range is a valid result and not an error: no rows, a zeroed summary, empty
 * series. The result echoes the range it ran over and the cut actually used, so a report reached from a
 * link carrying part of its query can still state its own period.
 */
export function runReportDefinition(
  kind: ReportKind,
  input: ReportDataInput,
  query: ReportQuery,
  definition: ReportDefinition,
  now: Date = new Date(),
): ReportResult {
  const rows = buildRows(kind, input, query);
  return {
    definitionId: definition.id,
    kind,
    from: query.from,
    to: query.to,
    granularity: resolveGranularity(definition, query),
    rows,
    summary: summarise(kind, rows, query),
    series: buildReportSeries(kind, rows, definition, resolveGranularity(definition, query), {
      from: query.from,
      to: query.to,
    }),
    generatedAt: toIsoDateTime(now),
  };
}

// The series charted beside the table -------------------------------------------------------------

/*
 * The chart's half of the report contract, beside the rows it charts. It is the concern
 * `src/lib/reportSeries.ts` was split out of `src/lib/reportService.ts` to carry, and that file now re-exports
 * {@link buildReportSeries} from here, so every consumer's path still resolves the whole contract.
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

/** The period cells one run is charted over: the keys its bands' wording is read against, so a day of a run
 *  that leaves one calendar year carries its year. A row without a period cell contributes none, and the
 *  reading of a key's calendar year and of the days a clipped band covers is `src/utils/dates.ts`'s. */
function runKeysOf(rows: readonly ReportRow[]): string[] {
  return rows.map((row) => String(row.cells.period ?? ""));
}

/**
 * The wording of every band of one run, resolved once per run: which bands carry their year, and what a band
 * the range clipped states, are facts about the run rather than about a point, and wording each point would
 * re-read them once per charted column — `src/utils/dates.ts`'s `formatBandLabel` is the one home for that
 * rule, shared with the dashboard's series, and a band words the same for every column charted beside it.
 */
function bandLabeller(
  granularity: BucketGranularity,
  keys: readonly string[],
  range: DateRange | undefined,
): (key: string) => string {
  const labels = new Map<string, string>();
  return (key: string): string => {
    const known = labels.get(key);
    if (known !== undefined) return known;
    const text = formatBandLabel(key, granularity, keys, range);
    labels.set(key, text);
    return text;
  };
}

/** One charted column: its identity, its heading and a point per row whose band is named, not valued. A band
 *  is worded by the run's own labeller, so no two bands of one run word alike. */
function seriesOfColumn(
  rows: readonly ReportRow[],
  column: ReportColumn,
  seriesIndex: number,
  axisKey: string,
  labelOf: (key: string) => string,
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
        label: labelOf(key),
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
 * @param range - The range the rows were read over, which is what words a band the range clips; absent, every
 *   band is worded as whole.
 * @returns One series per charted column, each point's band keyed by its period and worded by that cut — a
 *   day carrying its year when the run's own periods leave one calendar year, and a band the range clipped
 *   stating the days of it the range holds.
 */
export function buildReportSeries(
  kind: ReportKind,
  rows: readonly ReportRow[],
  definition: ReportDefinition,
  granularity: BucketGranularity = definition.granularity,
  range?: DateRange,
): ChartSeries[] {
  const labelOf = bandLabeller(granularity, runKeysOf(rows), range);
  switch (kind) {
    case "sales": {
      const headline = headlineColumn(definition);
      return headline === undefined ? [] : [seriesOfColumn(rows, headline, 0, "period", labelOf)];
    }
    case "products": {
      const headline = headlineColumn(definition);
      return headline === undefined ? [] : [seriesOfColumn(rows, headline, 0, "product", labelOf)];
    }
    case "customers":
      return definition.columns
        .filter((column) => column.key === "newCustomers" || column.key === "returningCustomers")
        .map((column, index) => seriesOfColumn(rows, column, index, "period", labelOf));
  }
}
