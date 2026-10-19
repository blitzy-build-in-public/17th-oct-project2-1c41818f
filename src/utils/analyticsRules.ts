/**
 * Path: src/utils/analyticsRules.ts
 * Purpose: The aggregation rules the dashboard and the reports read and the seeded repositories compose: period bucketing, KPI aggregation, comparison baselines and top-product performance
 * Lines: 511
 */

import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { ADMIN_COPY, CHANNEL_LABELS as SALES_CHANNEL_LABELS } from "@/constants/content";
import { BASELINE_OPTIONS, CATEGORY_DEFINITIONS } from "@/constants/taxonomy";
import type { Customer } from "@/types/account";
import type {
  AnalyticsQuery,
  BaselineKind,
  BucketGranularity,
  ChartPoint,
  ChartSeries,
  KpiSummary,
  Metric,
  ProductPerformance,
  RevenueGroupBy,
  RevenueQuery,
  SalesChannel,
  SalesRecord,
  TopProductsQuery,
} from "@/types/analytics";
import type { Order } from "@/types/commerce";
import type { CategoryId, DateRange, IsoDateString, MinorUnits, ProductId } from "@/types/common";
import { clampNumber, createComparator, indexBy, sortBy, sum } from "@/utils/collections";
import {
  bucketKey as dateBucketKey,
  bucketStart,
  eachBucket,
  formatBandLabel,
  formatBucketLabel,
  formatDateRange,
  isWithinPreparedRange,
  prepareRange,
  resolveBaselineRange,
  type DateBucket,
  type PreparedRange as Bounds,
} from "@/utils/dates";
import { roundMinorUnits } from "@/utils/format";
import { averageOrderValue, percentChange, periodOrders, shareOf } from "@/utils/statistics";

/**
 * Aggregation for the sales dashboard and the reports: a bucket, a period total, a comparison against a
 * named baseline, a product's share of a period's revenue. Bucket boundaries and range arithmetic belong to
 * `src/utils/dates.ts`; revenue comes from the fact table, product performance from the order lines.
 *
 * The aggregation rules live here, in the foundations, rather than in the service that publishes them,
 * because two layers need them and the layer order lets a file import only from its own layer or from a
 * layer below it: `src/data/repositories.ts` answers the seam's analytics endpoints by composing
 * {@link computeKpis}, {@link computeRevenueSeries} and {@link computeTopProducts} over the collections it
 * holds, and `src/lib/analyticsService.ts` re-exports every name below, so a caller keeps importing the
 * surface it always did while the data layer reaches this one home from a layer below it.
 */

/** The cut a series is bucketed by when its query names none, as `AnalyticsQuery` documents. */
export const DEFAULT_BUCKET_GRANULARITY: BucketGranularity = "day";

/** The comparison a KPI is measured against when its query names none. */
export const DEFAULT_BASELINE_KIND: BaselineKind = "previous-period";

/** The metric the top-products ranking is ordered by when its query names none. */
export const DEFAULT_TOP_PRODUCTS_METRIC: Metric = "revenue";

/** How many products the ranking returns when its query names none: the dashboard table's own length. */
export const DEFAULT_TOP_PRODUCTS_LIMIT = 8;

/** The id the single whole-period series carries: it survives a re-bucket, so a series toggle keeps its
 * selection while the range moves under it. */
const TOTAL_SERIES_ID = "total";

/** What separates a comparison's name from its days; the words come from the vocabulary module. */
const BASELINE_RANGE_SEPARATOR = ": ";

/** The wording of the three channels, owned by the copy module and read here by the fact table's id. */
const CHANNEL_LABELS: Readonly<Record<SalesChannel, string>> = SALES_CHANNEL_LABELS;

/** The category names of the vocabulary by slug: how a fact row's category id becomes a series label. */
const CATEGORY_NAME_BY_SLUG: Readonly<Record<string, string>> = Object.fromEntries(
  CATEGORY_DEFINITIONS.map((definition) => [definition.slug, definition.name]),
);

/** The category a ranked line reports when the caller's lookup does not hold its product — one the
 * catalogue no longer carries; it resolves to no category and no seeded line produces one. */
const UNKNOWN_CATEGORY_ID = "cat_unknown" as CategoryId;

/** Everything {@link computeKpis} reads: the whole collections, because a KPI and its baseline are two
 * periods of one dataset — the fact rows, the orders that converted, and the accounts. */
export interface KpiInput {
  readonly records: readonly SalesRecord[];
  readonly orders: readonly Order[];
  readonly customers: readonly Customer[];
  readonly query: AnalyticsQuery;
}

/** Everything {@link computeRevenueSeries} reads: the fact rows, and the range and split to bucket. */
export interface RevenueSeriesInput {
  readonly records: readonly SalesRecord[];
  readonly query: RevenueQuery;
}

/** Everything {@link computeTopProducts} reads: the orders and range to scan, and the category of each
 * product, supplied by the caller because an order line names no category. */
export interface TopProductsInput {
  readonly orders: readonly Order[];
  readonly query: TopProductsQuery;
  readonly categoryIds: ReadonlyMap<ProductId, CategoryId>;
}

/** The key of the bucket `at` falls in at `granularity`: `2025-01-30`, `2025-W05` or `2025-01`, delegated
 * to `src/utils/dates.ts`, which owns every bucket boundary in the product. A local date-time is read as
 * the day it falls on, and `""` is returned for a value that names no day. */
export function bucketKey(at: IsoDateString, granularity: BucketGranularity): string {
  return dateBucketKey(at, granularity);
}

/** The label a bucket's key shows on an axis or in a table: its own day, `Week of Jan 27` for a week named
 * by its Monday, `Jan 2025` for a month. The key is resolved to the day it opens first, because a key is a
 * grouping string rather than a date, and the wording is `src/utils/dates.ts`'s — which words a bucket the
 * selected `range` clips by the days of it the range covers, so a first band of a partial week states its
 * two days rather than the week's own opening day. */
export function bucketLabel(
  key: string,
  granularity: BucketGranularity,
  range?: DateRange,
): string {
  return formatBucketLabel(bucketStart(key, granularity), granularity, range);
}

/** The word a comparison is named by — "Previous period" or "Previous year" — read from the vocabulary
 * the baseline control also renders, so a card and its control cannot label one comparison two ways. */
export function baselineLabel(baseline: BaselineKind): string {
  const option = BASELINE_OPTIONS.find((candidate) => candidate.value === baseline);
  return option?.label ?? baseline;
}

/** The days a comparison reads: the equal-length period immediately before `from`–`to`, or the same
 * calendar range a year earlier, both through `src/utils/dates.ts`, which owns that arithmetic. */
export function resolveBaseline(
  from: IsoDateString,
  to: IsoDateString,
  baseline: BaselineKind,
): DateRange {
  return resolveBaselineRange({ from, to }, baseline);
}

/** Names a comparison and the days it covers, so a dashboard states what a KPI is measured against:
 * `"Previous period: Aug 17 – Sep 15, 2025"`. The word is the vocabulary's, the days
 * `src/utils/dates.ts`'s, and an unreadable range leaves the comparison named alone. */
export function describeBaseline(baseline: BaselineKind, range: DateRange): string {
  const days = formatDateRange(range.from, range.to);
  const name = baselineLabel(baseline);
  return days === "" ? name : `${name}${BASELINE_RANGE_SEPARATOR}${days}`;
}

/**
 * The shared dated query every analytics read travels with, with the cut and the comparison resolved to
 * their documented defaults. The range is passed on rather than judged here: its rules belong to
 * `src/utils/dates.ts` and are applied by the control that owns the range and by the seam, which answers a
 * broken one with `422` naming the offending `field`.
 */
export function toAnalyticsQuery(
  from: IsoDateString,
  to: IsoDateString,
  bucket: BucketGranularity = DEFAULT_BUCKET_GRANULARITY,
  baseline: BaselineKind = DEFAULT_BASELINE_KIND,
): AnalyticsQuery {
  return { from, to, bucket, baseline };
}

/** The parameters of a revenue series: the range and cut, plus how the series is split. A query naming no
 * `groupBy` asks for one total series. */
export function toRevenueQuery(
  from: IsoDateString,
  to: IsoDateString,
  bucket: BucketGranularity = DEFAULT_BUCKET_GRANULARITY,
  groupBy?: RevenueGroupBy,
): RevenueQuery {
  return { from, to, bucket, groupBy };
}

/** The parameters of a top-products ranking: its range, how many products and which metric ranks them,
 * defaulted to the rows the dashboard shows and to revenue. */
export function toTopProductsQuery(
  from: IsoDateString,
  to: IsoDateString,
  limit: number = DEFAULT_TOP_PRODUCTS_LIMIT,
  metric: Metric = DEFAULT_TOP_PRODUCTS_METRIC,
): TopProductsQuery {
  return { from, to, limit, metric };
}

/** What one period's fact rows total: the three figures a KPI states and a comparison is made on. */
interface PeriodFigures {
  readonly revenueMinor: MinorUnits;
  readonly orders: number;
  readonly units: number;
}

/** The figures a prepared range's fact rows total, in one pass, with the money rounded once. */
function periodFigures(records: readonly SalesRecord[], bounds: Bounds | null): PeriodFigures {
  let revenueMinor = 0;
  let orders = 0;
  let units = 0;
  for (const record of records) {
    if (!isWithinPreparedRange(record.date, bounds)) continue;
    revenueMinor += record.netRevenueMinor;
    orders += record.orders;
    units += record.units;
  }
  return { revenueMinor: roundMinorUnits(revenueMinor), orders, units };
}

/** The accounts that ordered in a prepared range: an order without an account converts nobody. */
function convertedVisitors(orders: readonly Order[], bounds: Bounds | null): number {
  const converted = new Set<string>();
  for (const order of orders) {
    if (order.customerId === null || !isWithinPreparedRange(order.placedAt, bounds)) continue;
    converted.add(order.customerId);
  }
  return converted.size;
}

/** The share of the account base that ordered: no traffic is collected, so the base is the only
 * visitor-side figure to divide by, it converts nobody when empty, and it stays in `0..1`. */
function conversionRate(converted: number, visitorBase: number): number {
  if (visitorBase <= 0) return 0;
  return clampNumber(converted / visitorBase, 0, 1);
}

/**
 * The headline figures of one period, with the comparison they are measured against.
 *
 * Revenue, orders and units come from the fact rows, so a card and the chart beside it are cut from one
 * dataset; average order value is the period's revenue over its orders; new customers are the accounts
 * created in the period; and the conversion rate is the accounts that ordered against the account base. An
 * empty range yields zeros rather than an absent summary, and a comparison a zero baseline cannot state
 * reports no change.
 */
export function computeKpis(input: KpiInput): KpiSummary {
  const { records, orders, customers, query } = input;
  const baseline = query.baseline ?? DEFAULT_BASELINE_KIND;
  const bounds = prepareRange({ from: query.from, to: query.to });
  const baselineRange = resolveBaseline(query.from, query.to, baseline);
  const current = periodFigures(records, bounds);
  const previous = periodFigures(records, prepareRange(baselineRange));
  const averageOrderValueMinor = averageOrderValue(current.revenueMinor, current.orders);
  const previousAverageOrderValueMinor = averageOrderValue(previous.revenueMinor, previous.orders);
  let newCustomers = 0;
  for (const customer of customers) {
    if (isWithinPreparedRange(customer.createdAt, bounds)) newCustomers += 1;
  }
  return {
    from: query.from,
    to: query.to,
    revenueMinor: current.revenueMinor,
    orders: current.orders,
    units: current.units,
    averageOrderValueMinor,
    newCustomers,
    conversionRate: conversionRate(convertedVisitors(orders, bounds), customers.length),
    baseline: {
      kind: baseline,
      from: baselineRange.from,
      to: baselineRange.to,
      // Each change is the comparison's own reading, kept exactly as `percentChange` answers it: `null`
      // when the earlier period holds nothing to compare against, which the card renders as its placeholder
      // rather than as a flat `0`. A baseline the fact table cannot reach therefore reports no percentage
      // instead of a false one, and a genuine 0.0% is a figure the comparison actually produced.
      revenueChangePercent: percentChange(current.revenueMinor, previous.revenueMinor),
      ordersChangePercent: percentChange(current.orders, previous.orders),
      unitsChangePercent: percentChange(current.units, previous.units),
      averageOrderValueChangePercent: percentChange(
        averageOrderValueMinor,
        previousAverageOrderValueMinor,
      ),
    },
  };
}

/** One group of a revenue series: the id its points are read by, its label, and what it earned. */
interface SeriesGroup {
  readonly id: string;
  readonly label: string;
  readonly totalMinor: MinorUnits;
}

/** The order a chart's series are listed in: what each earned, largest first, ties by id, so one period
 * produces one legend however the rows arrived. */
const SERIES_ORDER = createComparator<SeriesGroup>([
  { select: (group) => group.totalMinor, direction: "desc" },
  { select: (group) => group.id },
]);

/** The group a fact row falls in for the requested split: the whole period, a channel or a category. */
function seriesKeyOf(record: SalesRecord, groupBy: RevenueGroupBy | undefined): string {
  switch (groupBy) {
    case "category":
      return record.categoryId;
    case "channel":
      return record.channel;
    case undefined:
      return TOTAL_SERIES_ID;
  }
}

/** The name a category id shows: an id carries its slug after the prefix, and a category no definition
 * holds is shown as it stands. */
function categoryLabelOf(categoryId: CategoryId): string {
  const separator = categoryId.indexOf("_");
  const slug = separator === -1 ? categoryId : categoryId.slice(separator + 1);
  return CATEGORY_NAME_BY_SLUG[slug] ?? slug;
}

/** The label a group's id shows: a category's name, a channel's wording, or the whole period's. */
function seriesLabelOf(id: string, groupBy: RevenueGroupBy | undefined): string {
  switch (groupBy) {
    case "category":
      return categoryLabelOf(id as CategoryId);
    case "channel":
      return CHANNEL_LABELS[id as SalesChannel] ?? id;
    case undefined:
      return ADMIN_COPY.CHART_SERIES_TOTAL_LABEL;
  }
}

/** The groups to draw, ordered by what each earned. */
function seriesGroups(
  totals: ReadonlyMap<string, ReadonlyMap<string, number>>,
  groupBy: RevenueGroupBy | undefined,
): SeriesGroup[] {
  const groups: SeriesGroup[] = [];
  for (const [id, byBucket] of totals) {
    groups.push({ id, label: seriesLabelOf(id, groupBy), totalMinor: sum([...byBucket.values()]) });
  }
  return sortBy(groups, SERIES_ORDER);
}

/**
 * The wording of every band of one run, resolved once per run by `src/utils/dates.ts` from the run's own
 * `keys` and its `range`, so no two bands of one run word alike and a bucket the range clipped states the
 * days of it the range holds.
 *
 * One entry per bucket, built once: a band words the same for every series of a run, and wording it per
 * point would word each band once per series — twelve categories over 366 days is 4,392 calls of the same
 * 366 bands, and `formatBandLabel` re-reads the run's calendar years and the range's days on every call, so
 * the count of calls is the cost.
 */
function bandLabels(
  buckets: readonly DateBucket[],
  granularity: BucketGranularity,
  keys: readonly string[],
  range: DateRange,
): ReadonlyMap<string, string> {
  return new Map(
    buckets.map((bucket) => [bucket.key, formatBandLabel(bucket.key, granularity, keys, range)]),
  );
}

/** One point of a series: the bucket's key, the net revenue it earned — zero for a bucket the group did not
 * sell in — and the band's label, read from the run's own wording so no two bands of one run word alike. */
function seriesPoint(
  bucket: DateBucket,
  byBucket: ReadonlyMap<string, number> | undefined,
  labels: ReadonlyMap<string, string>,
): ChartPoint {
  return {
    x: bucket.key,
    y: roundMinorUnits(byBucket?.get(bucket.key) ?? 0),
    label: labels.get(bucket.key) ?? bucket.key,
  };
}

/**
 * A period's net revenue as one series per group, bucketed at the requested cut.
 *
 * The buckets are the ones `src/utils/dates.ts` builds for the range, so a bucket with no activity is
 * present carrying zero and the axis never silently compresses. A group with no activity is left out, while
 * a request asking for no split answers with one whole-period series even when the range holds nothing.
 * Colours are the token references of `src/constants/config.ts` in order — never a colour literal, because
 * the tokens own every design value.
 */
export function computeRevenueSeries(input: RevenueSeriesInput): ChartSeries[] {
  const { records, query } = input;
  const range: DateRange = { from: query.from, to: query.to };
  const bounds = prepareRange(range);
  const granularity = query.bucket ?? DEFAULT_BUCKET_GRANULARITY;
  const buckets = eachBucket(range, granularity);
  const keys = buckets.map((bucket) => bucket.key);
  const labels = bandLabels(buckets, granularity, keys, range);
  const totals = new Map<string, Map<string, number>>();
  // The whole-period series stands even when the range holds nothing, so an empty period is a drawn
  // zero line rather than an absent chart.
  if (query.groupBy === undefined) totals.set(TOTAL_SERIES_ID, new Map<string, number>());
  for (const record of records) {
    if (!isWithinPreparedRange(record.date, bounds)) continue;
    const group = seriesKeyOf(record, query.groupBy);
    let byBucket = totals.get(group);
    if (byBucket === undefined) {
      byBucket = new Map<string, number>();
      totals.set(group, byBucket);
    }
    const key = bucketKey(record.date, granularity);
    byBucket.set(key, (byBucket.get(key) ?? 0) + record.netRevenueMinor);
  }
  return seriesGroups(totals, query.groupBy).map((group, index) => ({
    id: group.id,
    label: group.label,
    color: CHART_SERIES_TOKEN_REFERENCES[index % CHART_SERIES_TOKEN_REFERENCES.length],
    points: buckets.map((bucket) => seriesPoint(bucket, totals.get(group.id), labels)),
  }));
}

/** One product's running totals while a period's orders are scanned: mutable because a line writes it, private to {@link computeTopProducts}, and `netRevenueMinor` is derived once from {@link netRevenueOf} after the scan. */
interface ProductTally {
  readonly productId: ProductId;
  readonly productName: string;
  readonly sku: string;
  readonly orderIds: Set<string>;
  units: number;
  grossRevenueMinor: MinorUnits;
  discountMinor: MinorUnits;
  netRevenueMinor: MinorUnits;
}

/** What one product's lines came to, rounded once through the single money rule. */
function netRevenueOf(tally: ProductTally): MinorUnits {
  return roundMinorUnits(tally.grossRevenueMinor - tally.discountMinor);
}

/** The order a ranking is stated in: the requested metric descending, then the net revenue those lines came to, then the name and the id, so one period produces one table. */
function rankingOrder(metric: Metric) {
  return createComparator<ProductTally>([
    {
      select: (tally) => (metric === "units" ? tally.units : tally.netRevenueMinor),
      direction: "desc",
    },
    { select: (tally) => tally.netRevenueMinor, direction: "desc" },
    { select: (tally) => tally.productName },
    { select: (tally) => tally.productId },
  ]);
}

/**
 * What each product sold and earned over the period, ranked by the requested metric.
 *
 * Read from the order collection and never from the fact table, which is keyed by category and channel and
 * carries no product key: an order line names the product it sold, its quantity and the price it went for.
 * An amount is the line's own — the subtotal and the discount the order's priced cart snapshotted, and
 * their difference as its net revenue — so a later price change cannot move what a placed order earned,
 * and a line the priced cart did not record falls back to its unit price. The orders it ranks are a
 * period's population from `periodOrders` in `src/utils/statistics.ts`, the one home for the status
 * rule, so an order whose trade came back — a cancelled one, whose lines were voided, or a refunded one,
 * whose money was returned — is in no surface's figures, and each row states its share of the period's
 * revenue across every product sold, adding to 100 across the ranking.
 */
export function computeTopProducts(input: TopProductsInput): ProductPerformance[] {
  const { orders, categoryIds, query } = input;
  const range: DateRange = { from: query.from, to: query.to };
  const metric = query.metric ?? DEFAULT_TOP_PRODUCTS_METRIC;
  const limit = clampNumber(
    Math.floor(query.limit ?? DEFAULT_TOP_PRODUCTS_LIMIT),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const tallies = new Map<ProductId, ProductTally>();
  for (const order of periodOrders(orders, range)) {
    const pricedLines = indexBy(order.pricedCart.lines, (line) => line.id);
    for (const line of order.lines) {
      const priced = pricedLines.get(line.id);
      const grossRevenueMinor = priced?.lineSubtotalMinor ?? line.unitPriceMinor * line.quantity;
      const discountMinor = priced?.discountMinor ?? 0;
      const tally = tallies.get(line.productId);
      if (tally === undefined) {
        tallies.set(line.productId, {
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          orderIds: new Set([order.id]),
          units: line.quantity,
          grossRevenueMinor,
          discountMinor,
          netRevenueMinor: 0,
        });
        continue;
      }
      tally.orderIds.add(order.id);
      tally.units += line.quantity;
      tally.grossRevenueMinor += grossRevenueMinor;
      tally.discountMinor += discountMinor;
    }
  }
  for (const tally of tallies.values()) tally.netRevenueMinor = netRevenueOf(tally);
  const ranked = sortBy([...tallies.values()], rankingOrder(metric));
  const periodRevenueMinor = sum(ranked.map((tally) => tally.netRevenueMinor));
  return ranked.slice(0, limit).map((tally, index) => ({
    productId: tally.productId,
    productName: tally.productName,
    sku: tally.sku,
    categoryId: categoryIds.get(tally.productId) ?? UNKNOWN_CATEGORY_ID,
    units: tally.units,
    orders: tally.orderIds.size,
    grossRevenueMinor: roundMinorUnits(tally.grossRevenueMinor),
    discountMinor: roundMinorUnits(tally.discountMinor),
    netRevenueMinor: tally.netRevenueMinor,
    rank: index + 1,
    sharePercent: shareOf(tally.netRevenueMinor, periodRevenueMinor),
  }));
}
