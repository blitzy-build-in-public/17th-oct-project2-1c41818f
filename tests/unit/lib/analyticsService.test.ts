/**
 * Path: tests/unit/lib/analyticsService.test.ts
 * Purpose: Bucketing boundaries, KPI aggregation and comparison baselines
 * Lines: 535
 */

// The dashboard's rules where they live: the pure aggregations directly, the four administrator-only
// reads through the service and the seam over the seeded source bound once below. Nothing is mocked,
// and no dated expectation is written down against the day the suite runs on: the seeded reads are
// issued over ranges derived from the newest seeded order, and the last block over a pinned re-seed.
// The statistics behind these figures have their own suite, so this file asserts only how the service
// routes through them.
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  CHART_SERIES_TOKEN_REFERENCES,
  DEFAULT_REPORT_RANGE_DAYS,
  DEMO_ACCOUNTS,
  MAX_REPORT_RANGE_DAYS,
} from "@/constants/config";
import { BASELINE_OPTIONS } from "@/constants/taxonomy";
import { salesProDataSource } from "@/data/repositories";
import * as analytics from "@/lib/analyticsService";
import { registerDataSource } from "@/lib/mockServer";
import type { SalesProDataSource } from "@/lib/mockServer";
import type {
  AnalyticsQuery,
  BaselineKind,
  BucketGranularity,
  Metric,
  ProductPerformance,
  ReportKind,
  RevenueQuery,
  TopProductsQuery,
} from "@/types/analytics";
import type { CategoryId, DateRange } from "@/types/common";
import type { Order, OrderStatus } from "@/types/commerce";
import { sumBy } from "@/utils/collections";
import * as dates from "@/utils/dates";
import * as statistics from "@/utils/statistics";

import * as fixtures from "../../fixtures";
import { FACTS, KPI_INPUT, signIn, valueOf } from "../../helpers/analyticsHarness";

// The pinned period, and the comparisons it resolves to ---------------------------------------------

/** The instant the dated expectations are stated against, so no case reads the ambient clock. */
const NOW = new Date(fixtures.FIXED_NOW);
/** The trailing thirty days that instant ends: the period every case below is stated over. */
const RANGE: DateRange = fixtures.FIXED_DATE_RANGE;
/** The equal-length period before RANGE, and the same calendar range a year earlier. */
const PREVIOUS_PERIOD: DateRange = { from: "2025-08-17", to: "2025-09-15" };
const PREVIOUS_YEAR: DateRange = { from: "2024-09-16", to: "2024-10-15" };
/** The three cuts and the two comparisons, as the controls that render them declare them. */
const GRANULARITIES: readonly BucketGranularity[] = ["day", "week", "month"];
const BASELINES: readonly BaselineKind[] = ["previous-period", "previous-year"];

/** A cheap, high-volume product and a dear, low-volume one, so the two rankings disagree: forty units
 *  at $10 lead units while two at $500 lead revenue. */
const CHEAP_NAME = "Trailhead Kettle";
const DEAR_NAME = "Cascade Speaker";
const RANKED_BY_REVENUE: readonly string[] = [DEAR_NAME, CHEAP_NAME];
const RANKED_BY_UNITS: readonly string[] = [CHEAP_NAME, DEAR_NAME];
/** One line of the ranking fixture: what was sold, at what price and how many. */
interface RankedLine {
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
}
const CHEAP_LINE: RankedLine = { name: CHEAP_NAME, unitPriceMinor: 1_000, quantity: 40 };
const DEAR_LINE: RankedLine = { name: DEAR_NAME, unitPriceMinor: 50_000, quantity: 2 };

/** One order carrying one such line, priced through the product's own pricing implementation so the
 *  order's lines and its snapshot agree. */
function rankedOrder(line: RankedLine, number: string, when: string, status: OrderStatus): Order {
  const lines = [fixtures.makeCartLine({ ...line, maxQuantity: line.quantity })];
  const pricedCart = fixtures.makePricedCart({ lines });
  return fixtures.makeOrder({ orderNumber: number, placedAt: when, status, pricedCart });
}

const CHEAP_ORDER = rankedOrder(CHEAP_LINE, "SP-300101", `${RANGE.from}T10:00:00`, "confirmed");
const DEAR_ORDER = rankedOrder(DEAR_LINE, "SP-300102", `${RANGE.to}T10:00:00`, "confirmed");
const CANCELLED_LINE: RankedLine = { ...DEAR_LINE, quantity: 99 };
const CANCELLED_ORDER = rankedOrder(
  CANCELLED_LINE,
  "SP-300103",
  `${RANGE.from}T11:00:00`,
  "cancelled",
);
const RANKING_ORDERS: readonly Order[] = [CHEAP_ORDER, DEAR_ORDER, CANCELLED_ORDER];

/** The lookup the ranking is handed — an order line names no category of its own — and its query. */
const RANKED_CATEGORY: CategoryId = fixtures.makeCategory().id;
const RANKING_QUERY: TopProductsQuery = { from: RANGE.from, to: RANGE.to };
const RANKING_INPUT: analytics.TopProductsInput = {
  orders: RANKING_ORDERS,
  query: RANKING_QUERY,
  categoryIds: new Map(
    [CHEAP_ORDER, DEAR_ORDER].flatMap((order) =>
      order.lines.map((line) => [line.productId, RANKED_CATEGORY] as const),
    ),
  ),
};

/** The ranking stated for one metric. */
function ranking(metric: Metric): ProductPerformance[] {
  return analytics.computeTopProducts({ ...RANKING_INPUT, query: { ...RANKING_QUERY, metric } });
}

/** The row a ranking states for one product name, so a case reads the product it means rather than a
 *  position a change of metric would move. */
function rowFor(rows: readonly ProductPerformance[], name: string): ProductPerformance {
  const row = rows.find((candidate) => candidate.productName === name);
  expect(row).toBeDefined();
  if (row === undefined) throw new Error(`the ranking states no row for ${name}`);
  return row;
}

/** The sum of one product's own line totals in an order: what that order's revenue for it must state. */
function lineTotalOf(order: Order, name: string): number {
  const lines = order.lines.filter((line) => line.productName === name);
  return lines.reduce((total, line) => total + line.lineTotalMinor, 0);
}

// The seeded source, bound once, and the ranges the reads are issued over ---------------------------

/** The token the dashboard's reads are authorised with, and the shopper's, which they refuse. */
let adminToken = "";
let shopperToken = "";
/** The trailing thirty days of the seeded history — derived from its newest order rather than from the
 *  ambient clock, so it holds activity whenever the suite runs — and a month wholly before it. */
let seededRange: DateRange = RANGE;
let emptyRange: DateRange = RANGE;

/** The session an administrator's read is authorised with. */
function admin(): analytics.AnalyticsRequestOptions {
  return { sessionToken: adminToken };
}

/** A day-bucketed revenue series over a period, split by the grouping a case names. */
function revenueSeries(range: DateRange, groupBy?: RevenueQuery["groupBy"]) {
  return analytics.getRevenueSeries({ ...range, bucket: "day", groupBy }, admin());
}

beforeAll(async () => {
  registerDataSource(salesProDataSource);
  adminToken = await signIn(DEMO_ACCOUNTS.ADMIN_EMAIL);
  shopperToken = await signIn(DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  const newest = salesProDataSource.getRecentOrders(1)[0];
  if (newest === undefined) return;
  const lastDay = dates.startOfDay(newest.placedAt);
  seededRange = { from: dates.addDays(lastDay, -29), to: lastDay };
  // Eight hundred days before the pinned period clears the seeded history's own span — the widest accepted
  // range plus the year before it, 731 days — and the fixtures' rows alike, while sitting in the past.
  const offset = -800;
  emptyRange = {
    from: dates.addDays(fixtures.FIXED_DATE_RANGE.from, offset),
    to: dates.addDays(fixtures.FIXED_DATE_RANGE.to, offset),
  };
});

// Bucketing a period -------------------------------------------------------------------------------

describe("the bucket a moment falls in: bucketKey and bucketLabel", () => {
  it.each(GRANULARITIES)("keys every %s instant as its own bucket and none past it", (cut) => {
    const buckets = dates.eachBucket(RANGE, cut);
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      // Both ends of a bucket are inside it, and the day after it is not: the boundaries a series,
      // a table row and a comparison period are all cut on.
      expect(analytics.bucketKey(`${bucket.start}T00:00:00`, cut)).toBe(bucket.key);
      expect(analytics.bucketKey(`${bucket.end}T23:59:59`, cut)).toBe(bucket.key);
      expect(analytics.bucketKey(dates.addDays(bucket.end, 1), cut)).not.toBe(bucket.key);
    }
  });

  it("walks contiguous, gapless, unrepeated buckets that cover the range exactly", () => {
    const buckets = dates.eachBucket(RANGE, "week");
    const keys = buckets.map((bucket) => bucket.key);
    expect(keys).toEqual([...new Set(keys)]);
    expect(dates.compareIso(buckets[0].start, RANGE.from)).toBeLessThanOrEqual(0);
    expect(dates.compareIso(buckets[buckets.length - 1].end, RANGE.to)).toBeGreaterThanOrEqual(0);
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index].start).toBe(dates.addDays(buckets[index - 1].end, 1));
    }
  });

  it("changes the key at a day, a month, a year and a leap February boundary", () => {
    const lastDay = analytics.bucketKey("2025-12-31", "day");
    expect(lastDay).not.toBe(analytics.bucketKey("2026-01-01", "day"));
    expect(analytics.bucketKey("2025-12-31", "month")).toBe("2025-12");
    expect(analytics.bucketKey("2026-01-01", "month")).toBe("2026-01");
    expect(dates.bucketEnd("2024-02", "month")).toBe("2024-02-29");
    expect(dates.bucketEnd("2025-02", "month")).toBe("2025-02-28");
    // A week is an ISO week, so a key carries the year its own Thursday falls in: 29 December 2025 is
    // the Monday that opens 2026-W01, while the Sunday before it still belongs to 2025.
    expect(analytics.bucketKey("2025-12-29", "week")).toBe("2026-W01");
    expect(analytics.bucketKey("2025-12-28", "week")).not.toBe(
      analytics.bucketKey("2025-12-29", "week"),
    );
    expect(analytics.bucketKey("not-a-day", "day")).toBe("");
  });

  it.each([
    ["2025-10-15", "day", "Oct 15"],
    ["2025-W42", "week", "Week of Oct 13"],
    ["2025-10", "month", "Oct 2025"],
  ] as const)("labels the %s bucket of %s as %s", (key, cut, label) => {
    expect(analytics.bucketLabel(key, cut)).toBe(label);
  });

  it("moves and measures days over calendar parts, and reads a range's own ends as inside it", () => {
    expect(dates.differenceInDays(RANGE.from, RANGE.to)).toBe(DEFAULT_REPORT_RANGE_DAYS - 1);
    expect(dates.isWithinRange(`${RANGE.to}T23:59:59`, RANGE)).toBe(true);
    expect(dates.isWithinRange(dates.addDays(RANGE.to, 1), RANGE)).toBe(false);
    expect(dates.clampRange({ from: "2025-01-01", to: "2025-12-31" }, RANGE)).toEqual(RANGE);
  });
});

// The range a report is asked for ------------------------------------------------------------------

describe("the range a report is asked for: defaultReportRange and validateDateRange", () => {
  it("opens on the trailing configured days, ending on the injected day", () => {
    const range = dates.defaultReportRange(NOW);
    expect(range).toEqual(RANGE);
    expect(dates.daysInRange(range)).toBe(DEFAULT_REPORT_RANGE_DAYS);
  });

  it("refuses an inverted, a future and an over-long range, and accepts exactly the cap", () => {
    const inverted = dates.validateDateRange(RANGE.to, RANGE.from, NOW);
    expect(inverted.valid).toBe(false);
    expect(inverted.problems).toEqual([{ field: "range", code: "range-inverted" }]);

    const tomorrow = dates.addDays(dates.startOfDay(fixtures.FIXED_NOW), 1);
    const future = dates.validateDateRange(tomorrow, dates.addDays(tomorrow, 4), NOW);
    expect(future.problems.map((problem) => [problem.field, problem.code])).toEqual([
      ["from", "range-in-future"],
      ["to", "range-in-future"],
    ]);

    const capped = { from: dates.addDays(RANGE.to, -(MAX_REPORT_RANGE_DAYS - 1)), to: RANGE.to };
    const accepted = dates.validateDateRange(capped.from, capped.to, NOW);
    expect(accepted).toEqual({ valid: true, days: MAX_REPORT_RANGE_DAYS, problems: [] });
    const over = dates.validateDateRange(dates.addDays(capped.from, -1), capped.to, NOW);
    expect(over.problems).toEqual([{ field: "range", code: "range-too-long" }]);
  });
});

// The headline figures of a period -----------------------------------------------------------------

describe("the headline figures of a period: computeKpis", () => {
  it("totals the period's fact rows, ignoring the day either side of it", () => {
    const summary = analytics.computeKpis(KPI_INPUT);
    // 9,000 and 5,000 net of the discount and the refund those two rows carry, and the 999,999 of the
    // day after the period ends in neither this figure nor the comparison's.
    expect(summary.from).toBe(RANGE.from);
    expect(summary.to).toBe(RANGE.to);
    expect(summary.revenueMinor).toBe(14_000);
    expect(summary.orders).toBe(8);
    expect(summary.units).toBe(12);
    // The average routes through the statistics helper and the money rounding rule, never a division.
    expect(summary.averageOrderValueMinor).toBe(statistics.averageOrderValue(14_000, 8));
    expect(summary.averageOrderValueMinor).toBe(1_750);
    // One account created inside the period, of two, and only the orders placed by an account convert:
    // the guest order converts nobody.
    expect(summary.newCustomers).toBe(1);
    expect(summary.conversionRate).toBe(0.5);
  });

  it("dates and states the comparison it is measured against rather than implying one", () => {
    const { baseline } = analytics.computeKpis(KPI_INPUT);
    expect(baseline.kind).toBe("previous-period");
    expect(baseline.from).toBe(PREVIOUS_PERIOD.from);
    expect(baseline.to).toBe(PREVIOUS_PERIOD.to);
    // The period earned 14,000 against the comparison's 7,000, on 8 orders against 4 and 12 units
    // against 6, at the same average of 1,750 — every change the statistics helpers state.
    expect(baseline.revenueChangePercent).toBe(statistics.percentChange(14_000, 7_000));
    expect(baseline.revenueChangePercent).toBe(100);
    expect(baseline.ordersChangePercent).toBe(100);
    expect(baseline.unitsChangePercent).toBe(100);
    expect(baseline.averageOrderValueChangePercent).toBe(statistics.percentChange(1_750, 1_750));
    // The two averages are the same figure, so the comparison states a flat 0 for it rather than the null
    // a percentage it could not state takes: 0 is the flat figure `changeDirection` reads as no change.
    const averageChange = baseline.averageOrderValueChangePercent ?? Number.NaN;
    expect(averageChange).toBe(0);
    expect(statistics.changeDirection(averageChange)).toBe("flat");
    expect(dates.compareIso(baseline.to, RANGE.from)).toBeLessThan(0);
  });

  it("states no percentage for a comparison whose window holds no row, and never a flat zero", () => {
    const query: AnalyticsQuery = { ...RANGE, baseline: "previous-year" };
    const summary = analytics.computeKpis({ ...KPI_INPUT, query });
    // The previous-year window of RANGE lies a year before every fact row, so the comparison has no
    // baseline to state a ratio against: each change is the null `percentChange` reports for a baseline of
    // nothing, and not the 0 a period that genuinely did not move states, while the period's own figures
    // stand as its rows report them.
    expect(summary.revenueMinor).toBe(14_000);
    expect(summary.orders).toBe(8);
    expect(summary.units).toBe(12);
    expect(summary.averageOrderValueMinor).toBe(1_750);
    expect(summary.baseline.kind).toBe("previous-year");
    expect(summary.baseline.from).toBe(PREVIOUS_YEAR.from);
    expect(summary.baseline.to).toBe(PREVIOUS_YEAR.to);
    expect(summary.baseline.revenueChangePercent).toBeNull();
    expect(summary.baseline.ordersChangePercent).toBeNull();
    expect(summary.baseline.unitsChangePercent).toBeNull();
    expect(summary.baseline.averageOrderValueChangePercent).toBeNull();
  });

  it("states zeros, and no figure that is not finite, for a period holding nothing at all", () => {
    const query: AnalyticsQuery = { from: emptyRange.from, to: emptyRange.to };
    const summary = analytics.computeKpis({ records: FACTS, orders: [], customers: [], query });
    // No orders and no baseline of any gives no average, no ratio and no percentage; each is stated as
    // zero rather than as an absent member or a NaN that a KPI card would have to render around.
    expect(summary.revenueMinor).toBe(0);
    expect(summary.orders).toBe(0);
    expect(summary.units).toBe(0);
    expect(summary.averageOrderValueMinor).toBe(0);
    expect(summary.newCustomers).toBe(0);
    expect(summary.conversionRate).toBe(0);
    const figures = Object.values(summary).filter((member) => typeof member === "number");
    expect(figures.every((figure) => Number.isFinite(figure))).toBe(true);
  });
});

// The comparison a KPI names -----------------------------------------------------------------------

describe("the comparison a KPI names: resolveBaseline, baselineLabel and describeBaseline", () => {
  it.each(BASELINES)("resolves %s to the dated period its date utility owns", (kind) => {
    const expected = kind === "previous-period" ? PREVIOUS_PERIOD : PREVIOUS_YEAR;
    expect(analytics.resolveBaseline(RANGE.from, RANGE.to, kind)).toEqual(expected);
    expect(dates.resolveBaselineRange(RANGE, kind)).toEqual(expected);
    expect(dates.compareIso(expected.to, RANGE.from)).toBeLessThan(0);
    const option = BASELINE_OPTIONS.find((candidate) => candidate.value === kind);
    expect(analytics.baselineLabel(kind)).toBe(option?.label);
  });

  it("names a comparison with the days it reads, and alone for a range it cannot read", () => {
    const days = dates.formatDateRange(PREVIOUS_PERIOD.from, PREVIOUS_PERIOD.to);
    const named = `${analytics.baselineLabel("previous-period")}: ${days}`;
    expect(analytics.baselineLabel("previous-period")).not.toBe(
      analytics.baselineLabel("previous-year"),
    );
    expect(analytics.describeBaseline("previous-period", PREVIOUS_PERIOD)).toBe(named);
    expect(analytics.describeBaseline("previous-year", { from: "", to: "" })).toBe(
      analytics.baselineLabel("previous-year"),
    );
  });
});

// What each product sold and earned -----------------------------------------------------------------

describe("what each product sold and earned: computeTopProducts", () => {
  it("orders by the metric asked for, and the two orders differ visibly", () => {
    const byRevenue = ranking("revenue");
    const byUnits = ranking("units");
    expect(byRevenue.map((row) => row.productName)).toEqual(RANKED_BY_REVENUE);
    expect(byUnits.map((row) => row.productName)).toEqual(RANKED_BY_UNITS);
    expect(byRevenue[0].productName).not.toBe(byUnits[0].productName);
    expect(byRevenue.map((row) => row.rank)).toEqual([1, 2]);
    // The metric a query leaves unanswered ranks by revenue, the documented default.
    expect(analytics.computeTopProducts(RANKING_INPUT).map((row) => row.productName)).toEqual(
      RANKED_BY_REVENUE,
    );
  });

  it("aggregates each product's own lines, and drops a cancelled order's", () => {
    const rows = ranking("revenue");
    const dear = rowFor(rows, DEAR_NAME);
    const cheap = rowFor(rows, CHEAP_NAME);
    expect(dear.units).toBe(DEAR_LINE.quantity);
    expect(dear.orders).toBe(1);
    expect(dear.grossRevenueMinor).toBe(lineTotalOf(DEAR_ORDER, DEAR_NAME));
    expect(dear.netRevenueMinor).toBe(dear.grossRevenueMinor - dear.discountMinor);
    expect(cheap.units).toBe(CHEAP_LINE.quantity);
    expect(cheap.grossRevenueMinor).toBe(lineTotalOf(CHEAP_ORDER, CHEAP_NAME));
    expect(cheap.categoryId).toBe(RANKED_CATEGORY);
    // The cancelled order's ninety-nine units are in neither ranking's units nor its revenue.
    expect(rows.map((row) => row.units)).toEqual([DEAR_LINE.quantity, CHEAP_LINE.quantity]);
    // Each row states its own share of the period's revenue, so the ranking's shares make the whole.
    const total = rows.reduce((running, row) => running + row.netRevenueMinor, 0);
    expect(rows.map((row) => row.sharePercent)).toEqual(
      rows.map((row) => statistics.shareOf(row.netRevenueMinor, total)),
    );
    expect(rows.reduce((running, row) => running + row.sharePercent, 0)).toBeCloseTo(100, 9);
  });

  it("honours the limit it is asked for, takes a wider one, and ranks nothing for an empty period", () => {
    const capped: analytics.TopProductsInput = {
      ...RANKING_INPUT,
      query: { ...RANKING_QUERY, metric: "revenue", limit: 1 },
    };
    expect(analytics.computeTopProducts(capped)).toHaveLength(1);
    expect(ranking("units")).toHaveLength(RANKING_ORDERS.length - 1);
    const empty = { from: emptyRange.from, to: emptyRange.to };
    expect(analytics.computeTopProducts({ ...RANKING_INPUT, query: empty })).toEqual([]);
  });
});

// The administrator-only reads, through the service and the seam ------------------------------------

describe("the administrator-only reads, through the service and the seam", () => {
  it("reads the newest orders first and never more than the limit it was given", async () => {
    const orders = valueOf(await analytics.getRecentOrders(5, admin()));
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.length).toBeLessThanOrEqual(5);
    const placedAt = orders.map((order) => order.placedAt);
    for (let index = 1; index < placedAt.length; index += 1) {
      expect(placedAt[index - 1] >= placedAt[index]).toBe(true);
    }
  });

  it("reads a series per group, coloured by a token reference and holding one point per bucket", async () => {
    const buckets = dates.eachBucket(seededRange, "day").map((bucket) => bucket.key);
    const byCategory = valueOf(await revenueSeries(seededRange, "category"));
    expect(byCategory.length).toBeGreaterThan(0);
    for (const series of byCategory) {
      expect(CHART_SERIES_TOKEN_REFERENCES).toContain(series.color);
      expect(series.points.map((point) => point.x)).toEqual(buckets);
    }
    // The three channels the fact table spans, and the whole period's own series for no split at all.
    expect(valueOf(await revenueSeries(seededRange, "channel")).length).toBeLessThanOrEqual(3);
    expect(valueOf(await revenueSeries(seededRange))).toHaveLength(1);
  });

  it("makes the whole-period series total what the KPI states for the same range", async () => {
    const query: RevenueQuery = { ...seededRange, bucket: "month" };
    const series = valueOf(await analytics.getRevenueSeries(query, admin()));
    expect(series).toHaveLength(1);
    const plotted = series[0].points.reduce((total, point) => total + point.y, 0);
    expect(plotted).toBe(valueOf(await analytics.getKpis(query, admin())).revenueMinor);
  });

  it("ranks a period's products, capped at the limit the query asked for", async () => {
    const query = { ...seededRange, limit: 3, metric: "revenue" } as const;
    const rows = valueOf(await analytics.getTopProducts(query, admin()));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.map((row) => row.rank)).toEqual(rows.map((_row, index) => index + 1));
    const revenue = rows.map((row) => row.netRevenueMinor);
    expect(revenue).toEqual([...revenue].sort((left, right) => right - left));
  });

  it("answers a period with no activity with an empty ranking rather than a failure", async () => {
    const result = await analytics.getTopProducts({ ...emptyRange }, admin());
    expect(valueOf(result)).toEqual([]);
  });

  it("refuses the dashboard without a session and for a shopper's session, as values not exceptions", async () => {
    const anonymous = await analytics.getKpis(RANGE.from, RANGE.to);
    const shopper = await analytics.getKpis(RANGE.from, RANGE.to, { sessionToken: shopperToken });
    expect(anonymous.ok).toBe(false);
    expect(shopper.ok).toBe(false);
    if (anonymous.ok || shopper.ok) return;
    expect(anonymous.error.status).toBe(401);
    expect(shopper.error.status).toBe(403);
  });

  it("refuses a range whose first end follows its second, naming the field it broke", async () => {
    const inverted: AnalyticsQuery = { from: RANGE.to, to: RANGE.from };
    const result = await analytics.getKpis(inverted, admin());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(422);
    expect(result.error.field).toBeDefined();
  });

  it("answers the same query twice with deep-equal results, so one range reads one way", async () => {
    const query: RevenueQuery = { ...seededRange, bucket: "week", groupBy: "category" };
    const first = valueOf(await analytics.getRevenueSeries(query, admin()));
    expect(valueOf(await analytics.getRevenueSeries(query, admin()))).toEqual(first);
  });
});

// One period, one set of figures -------------------------------------------------------------------

/** The two seeded periods the figures below are stated over: one month, and the trailing year. */
const MONTH: DateRange = fixtures.FIXED_DATE_RANGE;
const TRAILING_YEAR: DateRange = { ...MONTH, from: dates.addDays(MONTH.to, -364) };

/** The six figures the fact rows of each period total, in the order the sales report states them: the
 *  pinned draw's own, re-seeded under FIXED_NOW below because the seed anchors its window to the day it
 *  loads. They stay literal: the collection, the three reports and the KPI summary must agree with them. */
const SEEDED_TOTALS: readonly (readonly [DateRange, readonly number[]])[] = [
  [MONTH, [101, 679, 13_433_470, 267_241, 2_527_281, 10_638_948]],
  [TRAILING_YEAR, [983, 7_204, 134_174_504, 2_340_007, 18_873_672, 112_960_825]],
];

/** The units one seeded order's lines sold, which the fact rows count and the product report sums. */
const unitsOf = (order: Order) => sumBy(order.lines, (line) => line.quantity);

describe("one period, one set of figures: the fact rows against the orders they came from", () => {
  /** The pinned draw this block reads: the seeded collection re-booted at FIXED_NOW and the source over it. */
  let pinnedOrders: readonly Order[];
  let pinnedSource: SalesProDataSource;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixtures.FIXED_NOW));
    vi.resetModules();
    pinnedOrders = (await import("@/data/orders")).ORDERS;
    const repositories = await import("@/data/repositories");
    pinnedSource = repositories.createSalesProDataSource();
    // Warm the pin's deferred graph here, so its reads keep the pinned draw once the registry goes back.
    valueOf(await pinnedSource.getKpis({ ...MONTH, bucket: "day" }));
    vi.useRealTimers();
    // The re-seed replaced the registry's data modules, so hand it back for reads that resolve them later.
    vi.resetModules();
  });

  it.each(SEEDED_TOTALS)("totals %o on the period's own basis", async (range, totals) => {
    const [orders, units, gross, discounts, refunds, net] = totals;
    const standing = statistics.periodOrders(pinnedOrders, range);
    // `runReport` answers a promise — the read fetches its modules on first use — so both helpers await.
    const reported = async (kind: ReportKind) =>
      valueOf(await pinnedSource.runReport({ kind, ...range, bucket: "day" })).summary.items;
    const stated = async (kind: ReportKind, key: string) =>
      (await reported(kind)).find((item) => item.key === key)?.value;
    // The sales report sums the fact rows' six columns over the range in its own column order, and the
    // identities below are what the reduction those columns came from must satisfy.
    expect((await reported("sales")).map((item) => item.value)).toEqual(totals);
    expect(gross - discounts - refunds).toBe(net);
    expect([orders, units]).toEqual([standing.length, sumBy(standing, unitsOf)]);
    expect(net).toBe(sumBy(standing, statistics.goodsRevenueMinor));
    // One range, every surface: the pin's own KPI read and the three reports state the same figures.
    const kpis = valueOf(await pinnedSource.getKpis({ ...range, bucket: "day" }));
    expect([kpis.orders, kpis.units, kpis.revenueMinor]).toEqual([orders, units, net]);
    expect([await stated("products", "unitsSold"), await stated("products", "revenue")]).toEqual([
      units,
      net,
    ]);
    expect(await stated("customers", "orders")).toBe(orders);
    expect(await stated("customers", "revenue")).toBe(net);
  });
});
