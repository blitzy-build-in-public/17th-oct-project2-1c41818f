/**
 * Path: src/lib/analyticsService.ts
 * Purpose: Period bucketing, KPI aggregation, comparison baselines and top-product performance
 * Lines: 158
 */

import { API_PATHS, getJson } from "@/lib/apiClient";
import type {
  AnalyticsQuery,
  ChartSeries,
  ChartSeriesResponse,
  KpiSummary,
  ProductPerformance,
  RecentOrdersResponse,
  RevenueQuery,
  TopProductsQuery,
  TopProductsResponse,
} from "@/types/analytics";
import type { Order } from "@/types/commerce";
import type { IsoDateString, QueryParams, Result } from "@/types/common";
import { toAnalyticsQuery, toTopProductsQuery } from "@/utils/analyticsRules";

// The public surface ------------------------------------------------------------------------------
// The aggregation rules this module is named for — the bucketing and its labels, the named baselines, the three
// query builders and the three aggregations — live in `src/utils/analyticsRules.ts`, in the foundations layer,
// because the data module answers the analytics endpoints by composing them and a file may import only from its
// own layer or from a layer below it. Every name a consumer imports stays at this path.

export {
  DEFAULT_BASELINE_KIND,
  DEFAULT_BUCKET_GRANULARITY,
  DEFAULT_TOP_PRODUCTS_LIMIT,
  DEFAULT_TOP_PRODUCTS_METRIC,
  baselineLabel,
  bucketKey,
  bucketLabel,
  computeKpis,
  computeRevenueSeries,
  computeTopProducts,
  describeBaseline,
  resolveBaseline,
  toAnalyticsQuery,
  toRevenueQuery,
  toTopProductsQuery,
  type KpiInput,
  type RevenueSeriesInput,
  type TopProductsInput,
} from "@/utils/analyticsRules";

// The client API ----------------------------------------------------------------------------------

/** What an analytics read may carry beside its parameters: the signal that cancels a superseded request,
 * and the session token the seam authorises the read with. */
export interface AnalyticsRequestOptions {
  readonly signal?: AbortSignal;
  readonly sessionToken?: string;
}

/** The transport options a read passes on: the query this module owns, and the caller's signal and
 * session token. */
function callOptions(params: QueryParams, options: AnalyticsRequestOptions | undefined) {
  return { query: params, signal: options?.signal, sessionToken: options?.sessionToken };
}

/** The shared range and cut as request members; an unresolved one is dropped by the seam's serialiser
 * and defaulted by the data layer, so both sides apply one default. */
function analyticsParams(query: AnalyticsQuery): QueryParams {
  return { from: query.from, to: query.to, bucket: query.bucket, baseline: query.baseline };
}

/**
 * Reads a period's KPI summary with the comparison the query names, administrator-only at the seam, which
 * answers `403` without an administrator session and `422` with `field` for a range that breaks a rule.
 * The `from`–`to` form resolves the cut and the comparison, leaving no baseline implied.
 */
export function getKpis(
  query: AnalyticsQuery,
  options?: AnalyticsRequestOptions,
): Promise<Result<KpiSummary>>;
export function getKpis(
  from: IsoDateString,
  to: IsoDateString,
  options?: AnalyticsRequestOptions,
): Promise<Result<KpiSummary>>;
export function getKpis(
  rangeOrQuery: AnalyticsQuery | IsoDateString,
  toOrOptions?: IsoDateString | AnalyticsRequestOptions,
  options?: AnalyticsRequestOptions,
): Promise<Result<KpiSummary>> {
  if (typeof rangeOrQuery !== "string") {
    const carried = typeof toOrOptions === "string" ? {} : (toOrOptions ?? {});
    const params = analyticsParams(rangeOrQuery);
    return getJson<KpiSummary>(API_PATHS.ANALYTICS_KPIS, callOptions(params, carried));
  }
  const to = typeof toOrOptions === "string" ? toOrOptions : rangeOrQuery;
  const carried = typeof toOrOptions === "string" ? options : toOrOptions;
  const params = analyticsParams(toAnalyticsQuery(rangeOrQuery, to));
  return getJson<KpiSummary>(API_PATHS.ANALYTICS_KPIS, callOptions(params, carried ?? {}));
}

/** Reads a period's net revenue as one series per group: per category, per channel, or one whole-period
 * series when the query asks for no split, ordered as {@link computeRevenueSeries} orders it.
 * The range, the bucket and the grouping travel as one named object, not four positional arguments. */
export async function getRevenueSeries(
  query: RevenueQuery,
  options?: AnalyticsRequestOptions,
): Promise<Result<ChartSeries[]>> {
  const params: QueryParams = {
    from: query.from,
    to: query.to,
    bucket: query.bucket,
    groupBy: query.groupBy,
  };
  const result = await getJson<ChartSeriesResponse>(
    API_PATHS.ANALYTICS_REVENUE,
    callOptions(params, options),
  );
  return result.ok ? { ok: true, value: [...result.value.series] } : result;
}

/** Reads the period's best-performing products, ranked by the requested metric and capped at its limit.
 * Both call forms are supported: `(query, options?)`, and `(from, to, limit?)` resolving the documented
 * defaults. Administrator-only; the rows are the ones {@link computeTopProducts} builds. */
export function getTopProducts(
  query: TopProductsQuery,
  options?: AnalyticsRequestOptions,
): Promise<Result<ProductPerformance[]>>;
export function getTopProducts(
  from: IsoDateString,
  to: IsoDateString,
  limit?: number,
): Promise<Result<ProductPerformance[]>>;
export async function getTopProducts(
  queryOrFrom: TopProductsQuery | IsoDateString,
  toOrOptions?: IsoDateString | AnalyticsRequestOptions,
  limit?: number,
): Promise<Result<ProductPerformance[]>> {
  const query =
    typeof queryOrFrom === "string"
      ? toTopProductsQuery(queryOrFrom, toOrOptions as IsoDateString, limit)
      : queryOrFrom;
  const call = callOptions({ ...query }, typeof toOrOptions === "string" ? undefined : toOrOptions);
  const result = await getJson<TopProductsResponse>(API_PATHS.ANALYTICS_TOP_PRODUCTS, call);
  return result.ok ? { ok: true, value: [...result.value.items] } : result;
}

/** Reads the most recently placed orders, newest first, at most `limit` of them: the dashboard's
 * recent-orders table. A limit outside the requestable range is confined by the seam rather than here. */
export async function getRecentOrders(
  limit: number,
  options?: AnalyticsRequestOptions,
): Promise<Result<Order[]>> {
  const result = await getJson<RecentOrdersResponse>(
    API_PATHS.ANALYTICS_RECENT_ORDERS,
    callOptions({ limit }, options),
  );
  return result.ok ? { ok: true, value: [...result.value.items] } : result;
}
