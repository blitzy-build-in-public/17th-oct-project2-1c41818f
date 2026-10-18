/**
 * Path: src/features/admin/AdminDashboardPage.tsx
 * Purpose: The administrator dashboard: dated range, KPI cards, revenue chart, breakdown and tables
 * Lines: 369
 */

import { useCallback, useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { ChartPlaceholder } from "@/components/charts/ChartPlaceholder";
import { DonutChart } from "@/components/charts/DonutChart";
import { PageHeader } from "@/components/layout/PageHeader";
import { DateRangeControl } from "@/components/ui/DateRangeControl";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { STORAGE_KEYS } from "@/constants/config";
import { COMMON_ACTIONS, PAGE_TITLES, documentTitle } from "@/constants/content";
import { ADMIN_COPY } from "@/constants/content-reports";
import { ROUTES } from "@/constants/routes";
import { KpiCard, KpiCardPlaceholder, type KpiKind } from "@/features/admin/KpiCard";
import { RecentOrdersTable } from "@/features/admin/RecentOrdersTable";
import { SalesChart, seriesCountFor } from "@/features/admin/SalesChart";
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
import { useAsync, useDocumentTitle, useLocalStorage } from "@/state/hooks";
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
 * The columns a breakdown's paired data table holds: the slice's own name and the two figures the renderer puts
 * beside it, which is the shape the donut's table keeps however many slices the split draws.
 */
const BREAKDOWN_TABLE_COLUMNS = 3;

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

/** Everything {@link KpiGrid} renders with. */
interface KpiGridProps {
  /** The summary as the read reported it: `null` while it is in flight, and after a run that failed. */
  readonly summary: KpiSummary | null;
  /** The failure the read reported, or `null` when it answered. A failure takes the grid's place. */
  readonly error: ApiError | null;
  /** Called when the reader asks for the four figures again: the KPI read's own `reload`. */
  readonly onRetry: () => void;
}

/**
 * The four headline figures of the applied range, or the placeholders that stand in for them while the summary
 * is read: one card per entry of {@link KPI_ORDER}, each stating the figure and the comparison the summary
 * carries. Nothing is computed or formatted here — the value is the service's.
 *
 * A read the page could not answer is this block's own failure rather than the page's: the alert stands where
 * the cards would, carrying the seam's message and the one retry that re-runs the KPI read alone, so the chart,
 * the breakdown and both tables are left exactly as they are.
 *
 * @param props - The summary, the failure the read reported, and the retry that re-runs it.
 * @returns The four cards as one grid, or the alert that stands in for them.
 */
function KpiGrid({ summary, error, onRetry }: KpiGridProps): ReactElement {
  if (error !== null) {
    return (
      <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={onRetry} tone="danger" />
    );
  }

  return (
    <div className="sp-kpi-grid">
      {KPI_ORDER.map((kind) =>
        summary === null ? (
          <KpiCardPlaceholder key={kind} />
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
  groupBy,
}: {
  readonly series: readonly ChartSeries[] | null;
  readonly groupBy: RevenueGroupBy;
}): ReactElement {
  const headingId = useId();
  // Every wedge carries its percentage at every width: the figures stand on the surface beside the ring, so
  // they need no room on the fill itself and none of them can collide with the centre total's hole.

  return (
    <section className="sp-dashboard__section" aria-labelledby={headingId}>
      <h2 className="sp-chart__title" id={headingId}>
        {ADMIN_COPY.BREAKDOWN_HEADING}
      </h2>
      {series === null ? (
        // The ring stands in as a block of the same shape: the plot at the drawing's own ratio, then the legend
        // and paired table the donut renders beneath it. The table names its bands in their own rows rather
        // than in a heading row, and holds one row per slice, which is one per series the split draws — the
        // same count the revenue chart above is standing in with.
        <ChartPlaceholder
          columns={BREAKDOWN_TABLE_COLUMNS}
          hasHead={false}
          legend
          rows={seriesCountFor(groupBy)}
          series={seriesCountFor(groupBy)}
        />
      ) : (
        <DonutChart ariaLabel={ADMIN_COPY.BREAKDOWN_HEADING} series={series} />
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
 * The four states every data page renders are explicit, and each belongs to the surface that owns the read. A
 * pending read is that block's own skeleton, driven by the flag passed down; a failure is that block's own
 * alert, holding the seam's message and the one retry that re-runs that read alone, so a read that could not be
 * answered takes its own place on the page and leaves the others — the four figures, the chart and both tables —
 * exactly as they were, and that alert is the failure's only announcement rather than a notice raised beside a
 * region already stating the message in full; a range that recorded nothing is the dashboard's empty state with
 * the one action that helps; a filled period is the dashboard itself. Authorisation is the session's, not this
 * page's: `src/Router.tsx` guards the route and `src/lib/mockServer.ts` re-checks the administrator role on every
 * analytics endpoint, answering `403` without one, so the session token travels with each read.
 *
 * @returns The dashboard.
 */
export function AdminDashboardPage(): ReactElement {
  const { session } = useAuth();
  const sessionToken = session?.token;
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

  const summary = kpis.data;
  const series = revenue.data ?? [];
  const baselineSentence = describeBaseline(baseline, resolveBaselineRange(range, baseline));

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

  // Each block is handed its own read's state — the payload, the failure and that read's own reload — and no
  // block ever sees another read's failure, so the page decides nothing on a surface's behalf. The ring draws
  // the chart's read, so that read's one failure is stated in the chart's block and the ring stands down while
  // that read has no answer rather than wording the same failure a second time.
  const renderBlocks = (): ReactElement => (
    <>
      <KpiGrid summary={summary} error={kpis.error} onRetry={kpis.reload} />
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
        error={revenue.error}
        onRetry={revenue.reload}
      />
      {revenue.error === null ? (
        <RevenueBreakdown series={revenue.status === "success" ? series : null} groupBy={groupBy} />
      ) : null}
      <div className="sp-dashboard__row">
        <RecentOrdersTable
          orders={recentOrders.data ?? []}
          headingLevel={2}
          isLoading={recentOrders.status !== "success"}
          placeholderRowCount={RECENT_ORDERS_LIMIT}
          error={recentOrders.error}
          onRetry={recentOrders.reload}
        />
        <TopProductsTable
          products={topProducts.data ?? []}
          metric={metric}
          onMetricChange={setMetric}
          headingLevel={2}
          isLoading={topProducts.status !== "success"}
          placeholderRowCount={DEFAULT_TOP_PRODUCTS_LIMIT}
          error={topProducts.error}
          onRetry={topProducts.reload}
        />
      </div>
    </>
  );

  const renderBody = (): ReactElement => {
    // A range that recorded nothing is the dashboard's own empty state, with the one action that helps; every
    // other state belongs to the surface that owns the read.
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
