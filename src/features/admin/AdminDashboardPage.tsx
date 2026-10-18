/**
 * Path: src/features/admin/AdminDashboardPage.tsx
 * Purpose: The administrator dashboard: dated range, KPI cards, revenue chart, breakdown and tables
 * Lines: 563
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Link } from "react-router-dom";

import { DonutChart } from "@/components/charts/DonutChart";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import {
  ADMIN_COPY,
  COMMON_ACTIONS,
  DATE_RANGE_COPY,
  PAGE_TITLES,
  VALIDATION_MESSAGES,
  documentTitle,
  lastDaysLabel,
  rangeTooLongMessage,
  resolvedRangeLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { BASELINE_OPTIONS } from "@/constants/taxonomy";
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
import { useAsync, useBreakpoint, useDocumentTitle } from "@/state/hooks";
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
import {
  defaultReportRange,
  formatDate,
  formatDateRange,
  fromDateInputValue,
  maxReportRange,
  reportRangePresets,
  resolveBaselineRange,
  toDateInputValue,
  toFieldErrors,
  validateDateRange,
} from "@/utils/dates";
import type { DateRangeErrorCode, DateRangeErrorField, ReportRangePreset } from "@/utils/dates";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class below is adopted by name from the sheet that declares it.
 * `src/styles/admin-reports.css` owns the administrator register this page is written in: `sp-admin__main` for
 * the content column, `sp-kpi-grid`, `sp-dashboard__section` and `sp-dashboard__row` for the block rhythm,
 * `sp-chart__title` and `sp-chart__frame` for the chart family, and `sp-date-range` with its `__presets`,
 * `__fields`, `__summary`, `__error` and `__baseline` regions plus `sp-range-note` for the range control. The
 * primitives bring their own classes from the sheets `src/styles/components.css` loads.
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

/** The wording of every rule `validateDateRange` can break, keyed by the code it reports, so this file writes
 *  no rule sentence and no rule itself. */
const RANGE_MESSAGES: Readonly<Record<DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

/** The field keys the range rule reports under, which are also the `name` each date control carries, so one
 *  error map lands on the control that owns it. No field renders the third, so the alert reads it. */
const FROM_FIELD: DateRangeErrorField = "from";
const TO_FIELD: DateRangeErrorField = "to";
const RANGE_FIELD: DateRangeErrorField = "range";

/** Whether two ranges cover the same two days: what marks a preset as the one in force. */
function isSameRange(left: DateRange, right: DateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

/** The wording of one preset, by the key `src/utils/dates.ts` derives it under: the month- and year-to-date
 *  presets have their own names in the copy module and a trailing preset is named for its days. */
function presetLabel(preset: ReportRangePreset): string {
  switch (preset.key) {
    case "this-month":
      return DATE_RANGE_COPY.THIS_MONTH_PRESET_LABEL;
    case "this-year":
      return DATE_RANGE_COPY.THIS_YEAR_PRESET_LABEL;
    default:
      return lastDaysLabel(preset.days);
  }
}

/** The baseline a select reported, or `null` for a value outside the offered choices, so a string cannot
 *  reach a query as a comparison the service cannot resolve. */
function toBaselineKind(value: string): BaselineKind | null {
  return BASELINE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

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

/** Everything {@link DashboardRangeControl} renders with. */
interface DashboardRangeControlProps {
  /** The applied range, owned by the page: the days every read beneath the control runs over. */
  readonly value: DateRange;
  /** Reports a range the reader applied: a preset, or a pair of dates the range rules accept. */
  readonly onChange: (range: DateRange) => void;
  /** The comparison in force, shown as the select's selection and never left for a figure to imply. */
  readonly baseline: BaselineKind;
  /** Reports the comparison the reader chose. */
  readonly onBaselineChange: (baseline: BaselineKind) => void;
}

/**
 * The dashboard's range control: the presets, the two date fields, the range they resolve to in words, and the
 * named comparison the KPI cards are measured against.
 *
 * That it is this page's own control is a boundary rather than a duplication: the reports view's picker lives
 * in `src/features/reports/DateRangePicker.tsx`, no feature slice imports another, and the two share their
 * primitives plus the range arithmetic in `src/utils/dates.ts` rather than a module — `reportRangePresets`
 * supplies the presets, `validateDateRange` judges a pair of dates, `formatDateRange` states the applied range
 * and `resolveBaselineRange` resolves the period the comparison names. The picker's persisted last-used range
 * is deliberately absent, its only declared consumer being that picker; a shared control belongs in
 * `src/components` behind a plan amendment, never in a cross-slice import.
 *
 * The applied range belongs to the page; the fields hold a draft while they are edited, and a pair the rules
 * refuse is shown to the reader with the sentence for the rule it broke rather than clamped or swapped.
 *
 * @param props - The applied range, the two callbacks and the comparison in force.
 * @returns The range and baseline control.
 */
function DashboardRangeControl({
  value,
  onChange,
  baseline,
  onBaselineChange,
}: DashboardRangeControlProps): ReactElement {
  // Taken once per mount, from one reading of the clock, so a preset cannot move out from under the reader
  // who just pressed it.
  const presets = useMemo<readonly ReportRangePreset[]>(() => reportRangePresets(), []);

  // What the reader is typing, or `null` while the fields show the applied range: the applied range stays the
  // page's, so the days every figure was computed from exist in exactly one component.
  const [draft, setDraft] = useState<DateRange | null>(null);
  // Whether a refusal has been shown: a half-typed date is not an error yet, so the messages appear once the
  // reader asks to apply what the fields hold, and go again as soon as they change it.
  const [showErrors, setShowErrors] = useState(false);

  const fieldRange = draft ?? value;
  const validation = useMemo(
    () => validateDateRange(fieldRange.from, fieldRange.to),
    [fieldRange.from, fieldRange.to],
  );
  const fieldErrors = showErrors ? toFieldErrors(validation, RANGE_MESSAGES) : {};
  const rangeError = showErrors ? fieldErrors[RANGE_FIELD] : undefined;
  const hasPendingDraft = draft !== null && !isSameRange(draft, value);
  const comparisonRange = resolveBaselineRange({ from: value.from, to: value.to }, baseline);

  const applyRange = useCallback(
    (next: DateRange): void => {
      setDraft(null);
      setShowErrors(false);
      onChange(next);
    },
    [onChange],
  );

  /** Applies what the fields hold, or reports the rule it broke: the validator owns the rule, so a refused
   *  pair never reaches the page as a range to display. */
  const commitDraft = useCallback((): void => {
    if (draft === null) return;
    if (!validation.valid) {
      setShowErrors(true);
      return;
    }
    applyRange(draft);
  }, [applyRange, draft, validation]);

  /** One field's half of the draft, keeping the other end as it stands. */
  const changeFrom = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const parsed = fromDateInputValue(event.target.value);
      setDraft((previous) => ({ from: parsed, to: previous?.to ?? value.to }));
      setShowErrors(false);
    },
    [value.to],
  );

  /** The end date's half of the draft; see {@link changeFrom}. */
  const changeTo = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const parsed = fromDateInputValue(event.target.value);
      setDraft((previous) => ({ from: previous?.from ?? value.from, to: parsed }));
      setShowErrors(false);
    },
    [value.from],
  );

  const changeBaseline = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const kind = toBaselineKind(event.target.value);
      if (kind !== null) onBaselineChange(kind);
    },
    [onBaselineChange],
  );

  return (
    <div className="sp-date-range" role="group" aria-label={DATE_RANGE_COPY.LABEL}>
      <div className="sp-date-range__presets">
        {presets.map((preset) => (
          <Button
            key={preset.key}
            className="sp-date-range__preset"
            variant="secondary"
            size="sm"
            aria-pressed={isSameRange(preset.range, value)}
            onClick={() => {
              applyRange(preset.range);
            }}
          >
            {presetLabel(preset)}
          </Button>
        ))}
      </div>
      <div className="sp-date-range__fields">
        <Input
          type="date"
          name={FROM_FIELD}
          label={DATE_RANGE_COPY.FROM_LABEL}
          value={toDateInputValue(fieldRange.from)}
          onChange={changeFrom}
          errors={fieldErrors}
        />
        <Input
          type="date"
          name={TO_FIELD}
          label={DATE_RANGE_COPY.TO_LABEL}
          value={toDateInputValue(fieldRange.to)}
          onChange={changeTo}
          errors={fieldErrors}
        />
      </div>
      <Button variant="secondary" onClick={commitDraft} disabled={!hasPendingDraft}>
        {DATE_RANGE_COPY.APPLY_LABEL}
      </Button>
      <p className="sp-date-range__summary" aria-live="polite">
        {formatDateRange(value.from, value.to)}
      </p>
      {rangeError === undefined ? null : (
        <Alert className="sp-date-range__error" tone="danger">
          {rangeError}
        </Alert>
      )}
      <div className="sp-date-range__baseline">
        <Select
          label={ADMIN_COPY.BASELINE_CONTROL_LABEL}
          options={BASELINE_OPTIONS}
          value={baseline}
          onChange={changeBaseline}
        />
        <p className="sp-date-range__summary">
          {resolvedRangeLabel(formatDate(comparisonRange.from), formatDate(comparisonRange.to))}
        </p>
      </div>
      <p className="sp-range-note">{DATE_RANGE_COPY.LOCAL_TIME_NOTE}</p>
    </div>
  );
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

  const [range, setRange] = useState<DateRange>(() => defaultReportRange());
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

  /** The empty state's one action: the widest range the product accepts. */
  const widenPeriod = useCallback((): void => {
    setRange(maxReportRange());
  }, []);

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
      <DashboardRangeControl
        value={range}
        onChange={setRange}
        baseline={baseline}
        onBaselineChange={setBaseline}
      />
      {renderBody()}
    </div>
  );
}
