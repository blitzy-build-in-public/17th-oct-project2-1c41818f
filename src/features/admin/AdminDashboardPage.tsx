/**
 * Path: src/features/admin/AdminDashboardPage.tsx
 * Purpose: The administrator dashboard: dated range, KPI cards, revenue chart, breakdown and tables
 * Lines: 361
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { DonutChart } from "@/components/charts/DonutChart";
import { PageHeader } from "@/components/layout/PageHeader";
import { DateRangeControl } from "@/components/ui/DateRangeControl";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { STORAGE_KEYS } from "@/constants/config";
import { ADMIN_COPY, COMMON_ACTIONS, PAGE_TITLES, documentTitle } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { KpiCard, type KpiKind } from "@/features/admin/KpiCard";
import { RecentOrdersTable } from "@/features/admin/RecentOrdersTable";
import { SalesChart } from "@/features/admin/SalesChart";
import { TopProductsTable } from "@/features/admin/TopProductsTable";
import {
  DEFAULT_BASELINE_KIND,
  DEFAULT_BUCKET_GRANULARITY,
  DEFAULT_TOP_PRODUCTS_LIMIT,
  DEFAULT_TOP_PRODUCTS_METRIC,
  describeBaseline,
  getKpis,
  getRecentOrders,
  getRevenueSeries,
  getTopProducts,
} from "@/lib/analyticsService";
import { useAuth } from "@/state/AuthContext";
import { useAsync, useBreakpoint, useDocumentTitle, useLocalStorage } from "@/state/hooks";
import { useToast } from "@/state/ToastContext";
import type {
  BaselineKind,
  BucketGranularity,
  ChartSeries,
  KpiSummary,
  Metric,
  ProductPerformance,
  RevenueGroupBy,
} from "@/types/analytics";
import type { ApiError, DateRange } from "@/types/common";
import type { Order } from "@/types/commerce";
import { defaultReportRange, maxReportRange, resolveBaselineRange } from "@/utils/dates";
import { storedRangeOr } from "@/utils/storage";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class below is adopted by name from the sheet that declares it.
 * `src/styles/admin-reports.css` owns the administrator register this page is written in: `sp-admin__main` for
 * the content column, `sp-kpi-grid`, `sp-dashboard__section` and `sp-dashboard__row` for the block rhythm, and
 * `sp-chart__title` and `sp-chart__frame` for the chart family. The range control's own classes — `sp-date-range`
 * with its `__presets`, `__fields`, `__summary`, `__error` and `__baseline` regions, plus `sp-range-note` — are
 * the shared control's, and `src/components/ui/DateRangeControl.tsx` is where that control's contract is
 * written. The primitives bring their own classes from the sheets `src/styles/components.css` loads.
 */

// The page's own vocabulary ----------------------------------------------------------------------

/**
 * The four KPI cards, in the order the grid states them: one card per entry, and each entry is the card's own
 * `KpiKind`, so a figure added to that union fails to compile here until it is given its place. The entries
 * double as React keys, being a figure's identity rather than its position in the grid.
 */
const KPI_ORDER = [
  "revenue",
  "orders",
  "units",
  "average-order-value",
] as const satisfies readonly KpiKind[];

/**
 * The rows the recent-orders table shows: how many placements this window holds is the dashboard's own
 * decision rather than a service rule, so the figure is named here and passed to the read.
 */
const RECENT_ORDERS_LIMIT = 8;

/** The figure one KPI states, read off the summary as the service reported it: money in integer minor units
 *  and a count as a count, because the card owns both formats. */
function kpiValue(kind: KpiKind, summary: KpiSummary): number {
  switch (kind) {
    case "revenue":
      return summary.revenueMinor;
    case "orders":
      return summary.orders;
    case "units":
      return summary.units;
    case "average-order-value":
      return summary.averageOrderValueMinor;
  }
}

/**
 * The four headline figures of the applied range, or the placeholders that stand in for them while the summary
 * is read: one card per entry of {@link KPI_ORDER}, each stating the figure and the comparison the summary
 * carries. Nothing is computed or formatted here — the value is the service's.
 *
 * @param props - The summary as the read reported it, or `null` while it is in flight.
 * @returns The KPI grid.
 */

function KpiGrid({ summary }: { readonly summary: KpiSummary | null }): ReactElement {
  return (
    <div className="sp-kpi-grid">
      {KPI_ORDER.map((kind) =>
        summary === null ? (
          <Skeleton key={kind} variant="card" />
        ) : (
          <KpiCard
            key={kind}
            kpi={kind}
            value={kpiValue(kind, summary)}
            baseline={summary.baseline}
            headingLevel={2}
          />
        ),
      )}
    </div>
  );
}

/**
 * The revenue breakdown: the same series the line chart plots, drawn as one slice per group in the sheet's
 * minimum-height frame. A period that sold nothing is the donut's own empty state, so no empty branch is
 * written here; while the series are in flight the frame holds a placeholder, because a ring drawn from no data
 * yet would claim the period earned nothing.
 *
 * @param props - The series to plot, or `null` while they are in flight.
 * @returns The breakdown block.
 */
function RevenueBreakdown({
  series,
}: {
  readonly series: readonly ChartSeries[] | null;
}): ReactElement {
  const headingId = useId();
  // A wedge's percentage needs room the frame only has from the medium stop: below it the drawing is small
  // enough that the labels collide with the centre total. The legend and the paired data table state the same
  // shares, so hiding them there leaves no figure reachable through the drawing alone.
  const hasRoomForSliceLabels = useBreakpoint().current !== "sm";

  return (
    <section className="sp-dashboard__section" aria-labelledby={headingId}>
      <h2 className="sp-chart__title" id={headingId}>
        {ADMIN_COPY.BREAKDOWN_HEADING}
      </h2>
      {series === null ? (
        <div className="sp-chart__frame" aria-busy="true">
          <Skeleton variant="card" />
        </div>
      ) : (
        <DonutChart
          ariaLabel={ADMIN_COPY.BREAKDOWN_HEADING}
          series={series}
          showPercentages={hasRoomForSliceLabels}
        />
      )}
    </section>
  );
}

/**
 * The administrator dashboard: the dated range it is read over, the four headline figures, the revenue over
 * time, where it came from, and the period's best-performing products and most recent orders.
 *
 * The page owns the entire query — the range, the bucket, the split, the comparison and the ranking metric —
 * and performs all four reads, so no figure is fetched twice and none is recomputed: every number on screen is
 * the service's, and one `getRevenueSeries` result feeds both the line chart and the breakdown ring.
 *
 * The control over those two state values is the shared one, `src/components/ui/DateRangeControl.tsx`, which
 * the reports slice renders as well: this page hands it the range and the comparison in force and takes back
 * whatever a reader applies or chooses, so one range rule serves both surfaces instead of one copy each. The
 * range itself is the product's persisted last-used one — adopted at mount through `storedRangeOr` over
 * `STORAGE_KEYS.REPORT_RANGE` and written back by the one handler below — so a range applied on either
 * administrator surface is what the next visit to either opens on.
 *
 * The four states every data page renders are explicit. A pending read is each block's own skeleton, driven by
 * the flag passed down; a failure is the single page-level alert this view owns, whose retry re-runs every read
 * that failed; a range that recorded nothing is the dashboard's empty state with the one action that helps; a
 * filled period is the dashboard itself. Authorisation is the session's, not this page's: `src/Router.tsx`
 * guards the route and `src/lib/mockServer.ts` re-checks the administrator role on every analytics endpoint,
 * answering `403` without one, so the session token travels with each read.
 *
 * @returns The dashboard.
 */
export function AdminDashboardPage(): ReactElement {
  const { session } = useAuth();
  const sessionToken = session?.token;
  const toast = useToast();
  useDocumentTitle(documentTitle(PAGE_TITLES.DASHBOARD));

  // The trailing window, taken once per mount from one reading of the clock, and the last-used range both
  // administrator surfaces read and write through `useLocalStorage`: the stored days are this page's range
  // while the range rules accept them, and this window is what an absent or unusable payload opens on. The
  // payload's shape and the rules are one shared reading, `storedRangeOr` in `src/utils/storage.ts`.
  const fallbackRange = useMemo<DateRange>(() => defaultReportRange(), []);
  const [storedRange, setStoredRange] = useLocalStorage<DateRange>(
    STORAGE_KEYS.REPORT_RANGE,
    fallbackRange,
  );

  // The range this page is read over: the product's last-used one while the range rules accept it.
  const [range, setRange] = useState<DateRange>(() => storedRangeOr(storedRange, fallbackRange));
  const [bucket, setBucket] = useState<BucketGranularity>(DEFAULT_BUCKET_GRANULARITY);
  const [groupBy, setGroupBy] = useState<RevenueGroupBy>("category");
  const [baseline, setBaseline] = useState<BaselineKind>(DEFAULT_BASELINE_KIND);
  const [metric, setMetric] = useState<Metric>(DEFAULT_TOP_PRODUCTS_METRIC);

  // The four reads of one range, each abortable through `useAsync` so a control change cancels the request it
  // supersedes rather than letting a slow answer land on a newer query. Each carries the session token the
  // seam authorises the endpoint with.
  const kpis = useAsync<KpiSummary>(
    (signal) =>
      getKpis({ from: range.from, to: range.to, bucket, baseline }, { signal, sessionToken }),
    [range.from, range.to, bucket, baseline, sessionToken],
  );
  const revenue = useAsync<ChartSeries[]>(
    (signal) =>
      getRevenueSeries(
        { from: range.from, to: range.to, bucket, groupBy },
        { signal, sessionToken },
      ),
    [range.from, range.to, bucket, groupBy, sessionToken],
  );
  const topProducts = useAsync<ProductPerformance[]>(
    (signal) =>
      getTopProducts(
        { from: range.from, to: range.to, limit: DEFAULT_TOP_PRODUCTS_LIMIT, metric },
        { signal, sessionToken },
      ),
    [range.from, range.to, metric, sessionToken],
  );
  const recentOrders = useAsync<Order[]>(
    (signal) => getRecentOrders(RECENT_ORDERS_LIMIT, { signal, sessionToken }),
    [sessionToken],
  );

  const reads = [kpis, revenue, topProducts, recentOrders];
  const anyPending = reads.some((read) => read.status === "idle" || read.status === "loading");
  const allSettled = reads.every((read) => read.status === "success");
  const firstError = kpis.error ?? revenue.error ?? topProducts.error ?? recentOrders.error;
  const summary = kpis.data;
  const series = revenue.data ?? [];
  const baselineSentence = describeBaseline(baseline, resolveBaselineRange(range, baseline));

  /** Re-runs only the reads that failed, so the alert's one action restores the whole dashboard. */
  const retryFailedReads = useCallback((): void => {
    for (const read of [kpis, revenue, topProducts, recentOrders]) {
      if (read.status === "error") read.reload();
    }
  }, [kpis, revenue, topProducts, recentOrders]);

  const announcedErrorRef = useRef<ApiError | null>(null);
  const hasRenderedRef = useRef(false);
  useEffect(() => {
    if (allSettled) hasRenderedRef.current = true;
  }, [allSettled]);
  // A failure announces itself twice over: the alert below holds the retry, and a refresh on an already-read
  // dashboard also raises a toast, because a reader whose figures were replaced by an error may not be looking
  // at the block region. A first load's failure is the alert alone, and each distinct failure speaks once.
  useEffect(() => {
    if (firstError === null) {
      announcedErrorRef.current = null;
      return;
    }
    if (announcedErrorRef.current === firstError) return;
    announcedErrorRef.current = firstError;
    if (hasRenderedRef.current) toast.error(firstError.message);
  }, [firstError, toast]);

  /** Applies a range: the page's own range and the stored last-used one together, so the two can never
   *  disagree about what was last read and the next visit to either administrator surface opens on it. */
  const applyRange = useCallback(
    (next: DateRange): void => {
      setRange(next);
      setStoredRange(next);
    },
    [setStoredRange],
  );

  /** The empty state's one action: the widest range the product accepts, applied and remembered alike. */
  const widenPeriod = useCallback((): void => {
    applyRange(maxReportRange());
  }, [applyRange]);

  const renderBlocks = (): ReactElement => (
    <>
      <KpiGrid summary={summary} />
      <SalesChart
        series={series}
        bucket={bucket}
        onBucketChange={setBucket}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        baselineLabel={baselineSentence}
        from={range.from}
        to={range.to}
        title={ADMIN_COPY.CHART_HEADING}
        headingLevel={2}
        isLoading={revenue.status !== "success"}
      />
      <RevenueBreakdown series={revenue.status === "success" ? series : null} />
      <div className="sp-dashboard__row">
        <RecentOrdersTable
          orders={recentOrders.data ?? []}
          headingLevel={2}
          isLoading={recentOrders.status !== "success"}
        />
        <TopProductsTable
          products={topProducts.data ?? []}
          metric={metric}
          onMetricChange={setMetric}
          headingLevel={2}
          isLoading={topProducts.status !== "success"}
        />
      </div>
    </>
  );

  const renderBody = (): ReactElement => {
    if (anyPending) return renderBlocks();
    if (firstError !== null) {
      return (
        <Alert
          actionLabel={COMMON_ACTIONS.RETRY}
          error={firstError}
          onAction={retryFailedReads}
          tone="danger"
        />
      );
    }
    if (summary !== null && summary.orders === 0 && summary.revenueMinor === 0) {
      return <EmptyState headingLevel={2} onAction={widenPeriod} surface="dashboardRange" />;
    }
    return renderBlocks();
  };

  return (
    <div className="sp-admin__main">
      <PageHeader
        title={PAGE_TITLES.DASHBOARD}
        description={ADMIN_COPY.SUBHEADING}
        actions={
          <Link className="sp-btn sp-btn--secondary" to={ROUTES.ADMIN_REPORTS}>
            {PAGE_TITLES.REPORTS}
          </Link>
        }
      />
      <DateRangeControl
        value={range}
        onChange={applyRange}
        baseline={baseline}
        onBaselineChange={setBaseline}
      />
      {renderBody()}
    </div>
  );
}
