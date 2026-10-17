/**
 * Path: src/types/analytics.ts
 * Purpose: Analytics shapes: sales facts, KPI summaries, chart series, report definitions, columns and results
 * Lines: 406
 */

import type { Order } from "@/types/commerce";
import type {
  CategoryId,
  CollectionResponse,
  IsoDateString,
  IsoDateTimeString,
  MinorUnits,
  ProductId,
} from "@/types/common";

// Sales facts and periods -------------------------------------------------------------------------

/**
 * The three channels the seeded sales fact table spans: the website, the mobile app and the store.
 *
 * The set is closed because every bucketed revenue figure is grouped by channel as well as by
 * category. Which records carry which channel is data, owned by `src/data/salesHistory.ts`, and no
 * label or ordering is declared here.
 */
export type SalesChannel = "web" | "mobile" | "store";

/**
 * One row of the daily sales fact table: what a single category sold through a single channel on a
 * single day.
 *
 * Keyed by category and channel, and deliberately carrying no product key. That is the decision the
 * analytics layer turns on: the dashboard's revenue questions — how much came in, in which buckets,
 * split how — are answered by this table, while product performance for a period is computed from the
 * order collection, where every `OrderLine` names the product it sold. A product-keyed fact table
 * would have restated the orders for no question the product asks.
 *
 * The rows are generated from the same seeded generator as the orders, so the two reconcile: the
 * revenue a period reports and the orders placed in it agree instead of drifting apart. There is one
 * row per day, category and channel.
 *
 * Money: every amount is integer minor units. `netRevenueMinor` is `grossRevenueMinor` less
 * `discountMinor` and `refundMinor`, computed once when the row is generated rather than by each
 * reader, and `date` is the day the fact belongs to.
 */
export interface SalesRecord {
  readonly date: IsoDateString;
  readonly categoryId: CategoryId;
  readonly channel: SalesChannel;
  readonly orders: number;
  readonly units: number;
  readonly grossRevenueMinor: MinorUnits;
  readonly discountMinor: MinorUnits;
  readonly refundMinor: MinorUnits;
  readonly netRevenueMinor: MinorUnits;
}

/**
 * How finely a period is cut for a series or a report table: by day, by week or by month.
 *
 * The bucket changes granularity without changing the filtered data — one range and one filter
 * answer with the same totals however they are cut — which is why the granularity travels with the
 * query rather than inside a range. Bucket boundaries are computed only by `src/utils/dates.ts`,
 * reached through `analyticsService.bucketKey`, so no chart, table or report derives a key itself.
 */
export type BucketGranularity = "day" | "week" | "month";

/**
 * What a change percentage is measured against: the equal-length period immediately before the
 * selected range, or the same range one year earlier.
 *
 * The `baseline` parameter of `GET /api/analytics/kpis`. It exists so a comparison is asked for
 * rather than assumed: week-over-week and year-over-year are different claims, and a dashboard that
 * does not state which one it is making is not readable.
 */
export type BaselineKind = "previous-period" | "previous-year";

// Key performance indicators ----------------------------------------------------------------------

/**
 * The comparison a KPI is measured against, carried with its own dates.
 *
 * The baseline is named and dated rather than implied: `kind` says which comparison was asked for
 * and `from`/`to` say which days were read, so a KPI card can label what it compares against instead
 * of gesturing at a previous period. A change is a signed percentage — positive growth, negative
 * decline — and `0` means flat, never missing, so no consumer has to treat zero as absent.
 */
export interface KpiBaseline {
  readonly kind: BaselineKind;
  readonly from: IsoDateString;
  readonly to: IsoDateString;
  readonly revenueChangePercent: number;
  readonly ordersChangePercent: number;
  readonly unitsChangePercent: number;
  readonly averageOrderValueChangePercent: number;
}

/**
 * The headline figures the dashboard shows for one period, with the baseline they are compared to.
 *
 * Every value is produced by `src/lib/analyticsService.ts` from the fact table and the customer
 * collection; no component recomputes an aggregate. `averageOrderValueMinor` is derived from
 * `revenueMinor` and `orders` by `src/utils/statistics.ts`, so the average the dashboard shows and
 * the one a report states come from one calculation. `conversionRate` is a fraction between 0 and 1
 * — orders against visitors in the range — and not a percentage string or a scaled number, because
 * only `src/utils/format.ts` renders a percentage. Every money figure is in minor units.
 */
export interface KpiSummary {
  readonly from: IsoDateString;
  readonly to: IsoDateString;
  readonly revenueMinor: MinorUnits;
  readonly orders: number;
  readonly units: number;
  readonly averageOrderValueMinor: MinorUnits;
  readonly newCustomers: number;
  readonly conversionRate: number;
  readonly baseline: KpiBaseline;
}

// Chart series ------------------------------------------------------------------------------------

/**
 * One plotted point: where it sits and what it carries.
 *
 * `x` is a bucket key from `src/utils/dates.ts` or a category or channel label, supplied by the
 * service that built the series — a chart plots what it is handed and derives nothing. `y` is a raw
 * count, or money in the minor units its series declares, and is formatted only at the edge by
 * `src/utils/format.ts`. `label` is the display text a hover readout and the accessible data-table
 * alternative show, so a point never has to be explained by geometry alone.
 */
export interface ChartPoint {
  readonly x: string | number;
  readonly y: number;
  readonly label?: string;
}

/**
 * One plotted series: its identity, the name and colour it is drawn with, and its points.
 *
 * `color` is a CSS custom-property reference declared in `src/styles/tokens.css` — `var(--chart-series-1)`
 * and its siblings — and never a colour literal, because the tokens are the single source of every
 * design value and a hard-coded colour cannot follow a palette or a contrast fix. `id` stays stable
 * across a re-bucket of the same data, which is what lets a series toggle keep one line selected
 * while the range moves under it.
 */
export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly points: readonly ChartPoint[];
}

/**
 * The named wrapper `GET /api/analytics/revenue` returns, so the revenue chart, the breakdown donut
 * and a report's paired chart all reach their series by the same key.
 */
export interface ChartSeriesResponse {
  readonly series: readonly ChartSeries[];
}

/**
 * How a revenue series is split: into one series per category or one per sales channel, as the
 * `groupBy` parameter of `GET /api/analytics/revenue` asks.
 *
 * Absent, the endpoint answers with a single total series, which is why there is no `"none"` member
 * to pass — an unset parameter and an explicit total are the same request.
 */
export type RevenueGroupBy = "category" | "channel";

// Product performance -----------------------------------------------------------------------------

/**
 * What the top-products ranking is ordered by: revenue earned or units sold.
 *
 * The `metric` parameter of `GET /api/analytics/top-products`, and the toggle on the dashboard's
 * top-products table. The two orders genuinely differ — a cheap, high-volume line can lead units
 * while the list by revenue is led by something else — so the ranking is asked for rather than
 * inferred, and `ProductPerformance.rank` is the position under the metric that was asked for.
 */
export type Metric = "revenue" | "units";

/**
 * How one product performed over a period: what it sold, what it earned and where it ranks.
 *
 * Derived by scanning the seeded order collection over the orders placed inside the range, because
 * `SalesRecord` carries no product key and an order line is the only record of which product sold.
 *
 * `rank` is 1-based under the requested `Metric`, and `sharePercent` is this product's percentage of
 * the period's revenue, so the ranking and the share together answer what is selling without the
 * reader dividing anything. `grossRevenueMinor` is what the lines came to before discounts,
 * `discountMinor` the part of the period's discounts those lines carried, and `netRevenueMinor` the
 * difference, all at the prices the orders recorded and all in minor units.
 */
export interface ProductPerformance {
  readonly productId: ProductId;
  readonly productName: string;
  readonly sku: string;
  readonly categoryId: CategoryId;
  readonly units: number;
  readonly orders: number;
  readonly grossRevenueMinor: MinorUnits;
  readonly discountMinor: MinorUnits;
  readonly netRevenueMinor: MinorUnits;
  readonly rank: number;
  readonly sharePercent: number;
}

/**
 * The named wrapper `GET /api/analytics/top-products` returns, for the dashboard's top-products
 * table and the product-performance report alike.
 */
export type TopProductsResponse = CollectionResponse<ProductPerformance>;

/**
 * The named wrapper `GET /api/analytics/recent-orders` returns for the dashboard's recent-orders
 * table. The orders are the same `Order` shape the account's history renders, so one status badge
 * and one order summary serve both surfaces.
 */
export type RecentOrdersResponse = CollectionResponse<Order>;

// Query parameters --------------------------------------------------------------------------------

/**
 * The range and cut every analytics request shares: the KPI summary, the revenue series and the top
 * products.
 *
 * The range rules belong to `src/utils/dates.ts` and are applied by the controls that own the range,
 * not by the services that receive this shape: `from` is not after `to`, neither is in the future,
 * the span is at most 366 days, and the default is the trailing 30 days. `bucket` defaults to `day`
 * at the data layer and `baseline` to `previous-period`. Period boundaries are the visitor's local
 * time, which the dashboard and the reports state.
 */
export interface AnalyticsQuery {
  readonly from: IsoDateString;
  readonly to: IsoDateString;
  readonly bucket?: BucketGranularity;
  readonly baseline?: BaselineKind;
}

/**
 * The parameters of `GET /api/analytics/revenue`: the shared dated range plus how the series is
 * split. A range that is not asked to be split answers with one total series.
 */
export type RevenueQuery = AnalyticsQuery & { readonly groupBy?: RevenueGroupBy };

/**
 * The parameters of `GET /api/analytics/top-products`: the dated range, how many products to return
 * and which metric ranks them.
 *
 * `limit` defaults at the data layer to the number of rows the dashboard's table shows, and `metric`
 * to `revenue`. The range rules are the ones `AnalyticsQuery` documents.
 */
export interface TopProductsQuery {
  readonly from: IsoDateString;
  readonly to: IsoDateString;
  readonly limit?: number;
  readonly metric?: Metric;
}

/**
 * The parameters of `GET /api/reports/:kind`: the dated range and the cut the report is bucketed by.
 *
 * The same range rules as `AnalyticsQuery` apply, enforced and defaulted in the same place, and the
 * report states that its period boundaries are the visitor's local time.
 */
export interface ReportQuery {
  readonly from: IsoDateString;
  readonly to: IsoDateString;
  readonly bucket?: BucketGranularity;
}

// Report definitions and results ------------------------------------------------------------------

/**
 * The three reports the product offers, and the `:kind` path values of `GET /api/reports/:kind`: the
 * sales report by bucket, the product-performance report by product and the customer report by
 * customer.
 *
 * The definitions themselves — name, description, columns and default granularity — live in
 * `src/constants/taxonomy.ts`, so this union carries the domain and none of the wording.
 */
export type ReportKind = "sales" | "products" | "customers";

/**
 * How a cell is rendered, declared once on the column that owns it.
 *
 * The format travels with the column rather than being baked into a value, so the table and the CSV
 * export render the same cell the same way from one source. The renderers are `src/utils/format.ts`
 * for `integer`, `money`, `percent` and `compact-number`, and `src/utils/dates.ts` for `date`; `text`
 * is rendered as it stands.
 */
export type ReportCellFormat = "text" | "integer" | "money" | "percent" | "date" | "compact-number";

/**
 * A cell's raw value: a string, a number, or `null` for a cell with nothing to show, which renders
 * empty rather than as a zero.
 *
 * Values arrive unformatted — money cells hold minor units and percent cells hold fractions — so the
 * table and the export format one number each rather than parse a printed string back into one.
 */
export type ReportCellValue = string | number | null;

/**
 * One column of a report: the key its cells are read by, the heading it shows, how its values are
 * rendered, and whether it can be sorted.
 *
 * `key` indexes `ReportRow.cells`, which keeps a row a plain record instead of an array whose order
 * has to stay matched to the columns. `align` is declared rather than guessed from the format so a
 * column of numbers lines up down the table, and `isTotal` marks the column that carries the totals
 * row a report ends with.
 */
export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly format: ReportCellFormat;
  readonly align: "start" | "end";
  readonly sortable: boolean;
  readonly isTotal?: boolean;
}

/**
 * One row of a report: a stable key and its cells, read by column key.
 *
 * `id` is the row key the shared `DataTable` requires — a bucket key, a product id — and never an
 * array index, because an index shifts when the range, the sort or the page changes and React would
 * then reuse the wrong row's DOM.
 */
export interface ReportRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, ReportCellValue>>;
}

/**
 * A report as the catalogue lists it: what it is called, what it answers, its columns and how it is
 * cut.
 *
 * The definition supplies its own columns, so the table a reader sorts and the CSV they export are
 * built from one list of headings, keys and formats and cannot disagree. `granularity` is the cut
 * used when the query asks for no other, and `requiresRange` marks the definitions that cannot run
 * without an explicitly chosen range.
 */
export interface ReportDefinition {
  readonly id: string;
  readonly kind: ReportKind;
  readonly name: string;
  readonly description: string;
  readonly columns: readonly ReportColumn[];
  readonly granularity: BucketGranularity;
  readonly requiresRange: boolean;
}

/**
 * One metric shown beside a report: the figure, its heading and how it is rendered.
 *
 * The shape pairs a column with its cell, because a summary metric is read the same way — a
 * labelled, formatted number — while belonging to no column of the table below it.
 */
export interface ReportSummaryItem {
  readonly key: string;
  readonly label: string;
  readonly value: ReportCellValue;
  readonly format: ReportCellFormat;
}

/**
 * The metrics a report states above its table, in the order they are shown.
 */
export interface ReportSummary {
  readonly items: readonly ReportSummaryItem[];
}

/**
 * A run report: its rows, its summary metrics and the series charted beside it, from one computation.
 *
 * One shape carrying all three is what keeps the table, the chart and the export from disagreeing:
 * they read the same computed rows instead of each aggregating the data again. `from`, `to` and
 * `granularity` echo what was actually run — the range after its rules were enforced and the cut
 * that was used — so a report can state its own period even when it was reached from a link that
 * carried only part of it. `generatedAt` is when the rows were built, in local time.
 */
export interface ReportResult {
  readonly definitionId: string;
  readonly kind: ReportKind;
  readonly from: IsoDateString;
  readonly to: IsoDateString;
  readonly granularity: BucketGranularity;
  readonly rows: readonly ReportRow[];
  readonly summary: ReportSummary;
  readonly series: readonly ChartSeries[];
  readonly generatedAt: IsoDateTimeString;
}

/**
 * The flattened, already-formatted export matrix `reportService.toCsvMatrix` hands to
 * `src/utils/csv.ts`: a header row and the body rows, every value a string.
 *
 * Strings because the values are formatted before they leave the report service — a money cell
 * arrives as the text the reader saw in the table, not as minor units — so `src/utils/csv.ts` holds
 * no formatting logic and does only what a CSV writer should: escaping the separator and the quotes,
 * capping the row count and clipping long cell text, both limits declared in
 * `src/constants/config.ts`.
 */
export interface CsvMatrix {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}
