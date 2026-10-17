/**
 * Path: tests/unit/utils/statistics.test.ts
 * Purpose: Unit coverage of src/utils/statistics.ts: percentage change, growth, averages, moving averages and percentiles for the dashboard and reports
 * Lines: 583
 */

import { describe, expect, it } from "vitest";

import type { ChartPoint } from "@/types/analytics";
import type { DateRange } from "@/types/common";
import type { Order, OrderStatus } from "@/types/commerce";
import type { ChangeDirection } from "@/utils/format";
// The module under test is imported as a namespace, so every case names the export it exercises and a
// rename or removal in `src/utils/statistics.ts` fails to compile here.
import * as statistics from "@/utils/statistics";

import * as fixtures from "../../fixtures";

// Test data --------------------------------------------------------------------------------------

// The module is pure: nothing here is mocked, nothing reads the clock, and every instant and series
// a case reads is spelled out beside it.

/** The period a period's figures are stated over: the fixtures' trailing thirty days, both ends in. */
const RANGE: DateRange = fixtures.FIXED_DATE_RANGE;
/** Instants on the period's own boundary days, written without an offset so each names a local day
 *  and the ends' inclusivity holds in any time zone rather than only at UTC. */
const ON_FIRST_DAY = "2025-09-16T00:00:00";
const ON_LAST_DAY = "2025-10-15T23:59:59";
const BEFORE_RANGE = "2025-09-15T23:59:59";
const AFTER_RANGE = "2025-10-16T00:00:00";
const MID_RANGE = "2025-10-01T09:00:00";
/** The one day the two mid-period orders share, and a range whose first end names no day at all. */
const MID_RANGE_DAY: DateRange = { from: "2025-10-01", to: "2025-10-01" };
const UNREADABLE_RANGE: DateRange = { from: "15/09/2025", to: "2025-10-15" };

/** One of the period's orders: its order number, the instant it was placed and its status; the
 *  identifier is the fixture's own, derived from the number the way the product derives it. */
function periodOrder(number: string, at: string, status: OrderStatus): Order {
  return fixtures.makeOrder({ orderNumber: number, placedAt: at, status });
}
/** Six orders over one period: one on each boundary day, one before it, one after it, one cancelled
 *  inside it and one refunded inside it. The two mid-period orders share a day and an instant, so the
 *  single-day case below separates them by their status alone; the expected list is deliberately not
 *  their date order. */
const ORDERS: readonly Order[] = [
  periodOrder("SP-100001", ON_LAST_DAY, "confirmed"),
  periodOrder("SP-100002", BEFORE_RANGE, "confirmed"),
  periodOrder("SP-100003", MID_RANGE, "cancelled"),
  periodOrder("SP-100004", MID_RANGE, "refunded"),
  periodOrder("SP-100005", ON_FIRST_DAY, "confirmed"),
  periodOrder("SP-100006", AFTER_RANGE, "confirmed"),
];
const EXPECTED_PERIOD_ORDER_NUMBERS: readonly string[] = ["SP-100001", "SP-100004", "SP-100005"];

/** Two of one seed product at 1,999 minor units each: a basket whose subtotal is its own lines' total,
 *  and the same basket carrying the fixed 998-minor order-level code an applied promo leaves behind. */
const FULL_BASKET_TOTAL = 3_998;
const BASKET_DISCOUNT = 998;
const BASKET = fixtures.makePricedCart({
  lines: [fixtures.makeCartLine({ unitPriceMinor: 1_999, quantity: 2 })],
});
const DISCOUNTED_BASKET = fixtures.makePricedCart({
  lines: [fixtures.makeCartLine({ unitPriceMinor: 1_999, quantity: 2 })],
  promo: fixtures.makePromoCode({ kind: "fixed", value: BASKET_DISCOUNT }),
});

/** Four ascending figures; six figures whose total, mean and middle are all distinct; and figures no
 *  mean, total, rank or middle can use. */
const RANKED_FIGURES = [1, 2, 3, 4];
const SIX_FIGURES: readonly number[] = [4, 8, 15, 16, 23, 42];
const UNUSABLE_FIGURES: readonly number[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

/** Every member of a summary, stated for `SIX_FIGURES`, and what a series with no finite figure
 *  summarises to. */
const EXPECTED_SUMMARY: statistics.SeriesSummary = {
  count: 6,
  sum: 108,
  min: 4,
  max: 42,
  average: 18,
  median: 15.5,
};
const EMPTY_SUMMARY: statistics.SeriesSummary = {
  count: 0,
  sum: 0,
  min: null,
  max: null,
  average: 0,
  median: null,
};

/** The four days the smoothing and running-total cases plot, and the two series they plot. */
const SERIES_DAYS = ["2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04"];
function pointsFor(figures: readonly number[]): ChartPoint[] {
  return figures.map((y, index) =>
    fixtures.makeChartPoint({ x: SERIES_DAYS[index], y, label: SERIES_DAYS[index] }),
  );
}
/** Reads a plotted series' figures back, so a smoothing assertion states the numbers it asserts. */
function figuresOf(points: readonly ChartPoint[]): number[] {
  return points.map((point) => point.y);
}
/** Four buckets rising by two, so a window's arithmetic is readable at a glance. */
const FIGURES_SERIES = pointsFor([2, 4, 6, 8]);

/** A KPI read for a rise from 100 to 150 over the previous period, every member named; and growth
 *  from a baseline of nothing, which has a difference and a direction but no percentage. */
const RISE_COMPARISON: statistics.KpiComparison = {
  value: 150,
  baselineValue: 100,
  difference: 50,
  changePercent: 50,
  direction: "up",
  baselineKind: "previous-period",
};
const NO_BASELINE_COMPARISON: statistics.KpiComparison = {
  value: 50,
  baselineValue: 0,
  difference: 50,
  changePercent: null,
  direction: "up",
  baselineKind: "previous-period",
};

// The period's orders and its goods revenue -------------------------------------------------------

describe("periodOrders: the orders a period states its figures over", () => {
  it("keeps both ends of the range inclusive, drops a cancelled order and what sits outside it", () => {
    expect(statistics.periodOrders(ORDERS, RANGE).map((order) => order.orderNumber)).toEqual(
      EXPECTED_PERIOD_ORDER_NUMBERS,
    );
  });

  it("reads a single-day range as that day alone, and one naming no day as nothing", () => {
    expect(
      statistics.periodOrders(ORDERS, MID_RANGE_DAY).map((order) => order.orderNumber),
    ).toEqual(["SP-100004"]);
    expect(statistics.periodOrders(ORDERS, UNREADABLE_RANGE)).toEqual([]);
  });

  it("hands back a new collection and leaves the caller's as it was", () => {
    const source = [...ORDERS];
    const selected = statistics.periodOrders(source, RANGE);
    expect(selected).not.toBe(source);
    expect(selected).toHaveLength(EXPECTED_PERIOD_ORDER_NUMBERS.length);
    expect(source).toEqual(ORDERS);
  });
});

describe("goodsRevenueMinor: what an order's goods brought", () => {
  it("states a basket's subtotal less its discount, which is its own lines' total", () => {
    const order = fixtures.makeOrder({ pricedCart: BASKET });
    const lineTotalMinor = order.lines.reduce((total, line) => total + line.lineTotalMinor, 0);
    expect(lineTotalMinor).toBe(FULL_BASKET_TOTAL);
    expect(statistics.goodsRevenueMinor(order)).toBe(FULL_BASKET_TOTAL);
  });

  it("takes the order's discount off the goods and leaves delivery and tax outside", () => {
    const order = fixtures.makeOrder({ pricedCart: DISCOUNTED_BASKET });
    expect(order.pricedCart.discountTotalMinor).toBe(BASKET_DISCOUNT);
    expect(order.pricedCart.grandTotalMinor).toBeGreaterThan(FULL_BASKET_TOTAL);
    expect(statistics.goodsRevenueMinor(order)).toBe(FULL_BASKET_TOTAL - BASKET_DISCOUNT);
  });

  it("reports 0 for a basket holding no line, and settles a non-finite amount on 0", () => {
    const empty = fixtures.makeOrder({ pricedCart: fixtures.makePricedCart({ lines: [] }) });
    expect(statistics.goodsRevenueMinor(empty)).toBe(0);
    const broken = fixtures.makeOrder({
      pricedCart: { ...fixtures.makePricedCart({ lines: [] }), subtotalMinor: Number.NaN },
    });
    expect(statistics.goodsRevenueMinor(broken)).toBe(0);
  });
});

// Change, growth and share ------------------------------------------------------------------------

describe("percentChange: a signed change as a percentage of the earlier figure", () => {
  // A rise, a fall, no change, a decline from a negative baseline, two zeros, and the two cases with
  // no percentage at all: a zero baseline that moved reports null, never an infinity or a NaN.
  it.each([
    { current: 150, previous: 100, expected: 50 },
    { current: 80, previous: 100, expected: -20 },
    { current: 100, previous: 100, expected: 0 },
    { current: -50, previous: -100, expected: 50 },
    { current: 0, previous: 0, expected: 0 },
    { current: 50, previous: 0, expected: null },
    { current: 0, previous: 100, expected: -100 },
  ])("reports $expected for $current against $previous", ({ current, previous, expected }) => {
    expect(statistics.percentChange(current, previous)).toBe(expected);
  });

  it.each([
    { current: Number.NaN, previous: 100 },
    { current: 100, previous: Number.NaN },
    { current: Number.POSITIVE_INFINITY, previous: 100 },
    { current: 100, previous: Number.NEGATIVE_INFINITY },
  ])("reports no percentage for $current against $previous", ({ current, previous }) => {
    expect(statistics.percentChange(current, previous)).toBeNull();
  });
});

describe("growthRate: a series' first figure to its last", () => {
  // A rise, a fall, a six-bucket series, no change, fewer than two figures, a zero start, two zeros.
  it.each([
    { name: "a rise to the last figure", series: [100, 150], expected: 50 },
    { name: "a fall to the last figure", series: [200, 150], expected: -25 },
    { name: "six buckets", series: [4, 8, 15, 16, 23, 42], expected: 950 },
    { name: "a series that did not move", series: [100, 100, 100], expected: 0 },
    { name: "a single figure", series: [100], expected: null },
    { name: "an empty series", series: [], expected: null },
    { name: "a zero starting figure", series: [0, 50], expected: null },
    { name: "two zeros", series: [0, 0], expected: 0 },
  ])("reports $expected for $name", ({ series, expected }) => {
    expect(statistics.growthRate(series)).toBe(expected);
  });

  it("reads the ends rather than the steps, reports nothing for a non-finite end, and does not mutate", () => {
    const series = [100, 200, 100];
    expect(statistics.growthRate(series)).toBe(0);
    expect(statistics.growthRate([100, 200, 300, 400])).toBe(300);
    expect(statistics.growthRate([100, Number.NaN])).toBeNull();
    expect(statistics.growthRate([Number.NaN, 50])).toBeNull();
    expect(series).toEqual([100, 200, 100]);
  });
});

describe("changeDirection: a signed change as the direction it is styled by", () => {
  // The module's documented no-change bound first, then a change just above it on either sign: a
  // change at or below 1e-9 is flat, so floating-point noise cannot style a KPI as growth.
  it.each<{ readonly change: number; readonly direction: ChangeDirection }>([
    { change: 5, direction: "up" },
    { change: -5, direction: "down" },
    { change: 0, direction: "flat" },
    { change: 1e-9, direction: "flat" },
    { change: -1e-9, direction: "flat" },
    { change: 1e-8, direction: "up" },
    { change: -1e-8, direction: "down" },
  ])("reads $change as $direction", ({ change, direction }) => {
    expect(statistics.changeDirection(change)).toBe(direction);
  });

  it("treats floating-point noise as no change and every non-finite change as unknown", () => {
    expect(statistics.changeDirection(0.1 + 0.2 - 0.3)).toBe("flat");
    const changes = [5, -5, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    expect(changes.map((change) => statistics.changeDirection(change))).toEqual([
      "up",
      "down",
      "flat",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });
});

describe("shareOf: one figure as a percentage of a whole", () => {
  // A plain fraction, a whole equal to its part, an empty part, and then a part above its whole,
  // which reads as the percentage above 100 it is, and a negative part, which reads as negative.
  it.each([
    { part: 150, total: 400, expected: 37.5 },
    { part: 1, total: 4, expected: 25 },
    { part: 400, total: 400, expected: 100 },
    { part: 0, total: 400, expected: 0 },
    { part: 500, total: 400, expected: 125 },
    { part: -50, total: 200, expected: -25 },
  ])("states $part of $total as $expected percent", ({ part, total, expected }) => {
    expect(statistics.shareOf(part, total)).toBe(expected);
  });

  it("states 0 for a whole of zero or less and for a figure that is not finite, never an infinity", () => {
    expect(statistics.shareOf(50, 0)).toBe(0);
    expect(statistics.shareOf(0, 0)).toBe(0);
    expect(statistics.shareOf(50, -4)).toBe(0);
    expect(statistics.shareOf(Number.NaN, 400)).toBe(0);
    expect(statistics.shareOf(Number.POSITIVE_INFINITY, 400)).toBe(0);
    expect(statistics.shareOf(400, Number.NaN)).toBe(0);
    expect(statistics.shareOf(400, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

// Averages and centrality -------------------------------------------------------------------------

describe("averageOrderValue: a period's revenue over the orders that produced it", () => {
  it.each([
    { revenueMinor: 100_000, orderCount: 3, expected: 33_333 },
    { revenueMinor: 1_000, orderCount: 3, expected: 333 },
    { revenueMinor: 0, orderCount: 7, expected: 0 },
    { revenueMinor: 1, orderCount: 3, expected: 0 },
  ])(
    "states $expected minor units for $revenueMinor over $orderCount orders",
    ({ revenueMinor, orderCount, expected }) => {
      expect(statistics.averageOrderValue(revenueMinor, orderCount)).toBe(expected);
    },
  );

  it("rounds the half away from zero, the money module's single rounding rule", () => {
    expect(statistics.averageOrderValue(101, 2)).toBe(51);
    expect(statistics.averageOrderValue(103, 2)).toBe(52);
    expect(statistics.averageOrderValue(99, 2)).toBe(50);
  });

  it("reports 0 with no order to average over, floors a fractional count and settles a broken revenue", () => {
    expect(statistics.averageOrderValue(1_000, 0)).toBe(0);
    expect(statistics.averageOrderValue(1_000, -3)).toBe(0);
    expect(statistics.averageOrderValue(1_000, 0.5)).toBe(0);
    expect(statistics.averageOrderValue(1_000, Number.NaN)).toBe(0);
    expect(statistics.averageOrderValue(1_000, 3.9)).toBe(statistics.averageOrderValue(1_000, 3));
    expect(statistics.averageOrderValue(Number.NaN, 3)).toBe(0);
    expect(statistics.averageOrderValue(Number.POSITIVE_INFINITY, 3)).toBe(0);
  });
});

describe("weightedAverage: a mean over figures that do not carry the same weight", () => {
  it("applies each figure's weight, which is what makes it weighted", () => {
    expect(statistics.weightedAverage([2, 4], [3, 1])).toBe(2.5);
    expect(statistics.weightedAverage([2, 4], [1, 3])).toBe(3.5);
    expect(statistics.weightedAverage([2, 4], [1, 1])).toBe(3);
  });

  it("reports 0 when the weights total zero, and leaves an unrounded mean to its caller", () => {
    expect(statistics.weightedAverage([1, 2], [0, 0])).toBe(0);
    expect(statistics.weightedAverage([5, 5], [1, -1])).toBe(0);
    expect(statistics.weightedAverage([], [])).toBe(0);
    expect(statistics.weightedAverage([1, 2], [1, 1])).toBe(1.5);
  });

  it("leaves out a pair that is not finite, and refuses a collection that is not one weight per figure", () => {
    expect(statistics.weightedAverage([1, Number.NaN, 3], [1, 5, 1])).toBe(2);
    expect(statistics.weightedAverage([1, 3], [Number.NaN, 2])).toBe(3);
    expect(() => statistics.weightedAverage([1, 2], [1])).toThrow(RangeError);
    expect(() => statistics.weightedAverage([1], [1, 2, 3])).toThrow(/one weight per value/);
  });
});

describe("percentile: the figure at a rank", () => {
  it.each([
    { rank: 0, expected: 1 },
    { rank: 25, expected: 1.75 },
    { rank: 50, expected: 2.5 },
    { rank: 75, expected: 3.25 },
    { rank: 100, expected: 4 },
  ])("reads rank $rank of [1, 2, 3, 4] as $expected", ({ rank, expected }) => {
    expect(statistics.percentile(RANKED_FIGURES, rank)).toBe(expected);
  });

  it("is the middle figure at 50, an even count's averaged pair included, and interpolates in between", () => {
    expect(statistics.percentile(RANKED_FIGURES, 50)).toBe(statistics.median(RANKED_FIGURES));
    expect(statistics.percentile(SIX_FIGURES, 50)).toBe(statistics.median(SIX_FIGURES));
    expect(statistics.percentile([10, 20, 30, 40], 90)).toBe(37);
    expect(statistics.percentile([0, 100], 25)).toBe(25);
  });

  it("clamps a rank outside 0 to 100 to the nearer end and sorts a copy of what it was given", () => {
    expect(statistics.percentile(RANKED_FIGURES, -10)).toBe(1);
    expect(statistics.percentile(RANKED_FIGURES, 150)).toBe(4);
    const figures = [4, 1, 3, 2];
    expect(statistics.percentile(figures, 0)).toBe(1);
    expect(statistics.percentile(figures, 100)).toBe(4);
    expect(figures).toEqual([4, 1, 3, 2]);
  });

  it("drops a figure that is not finite, reads a single figure at every rank, and reports null when none is left", () => {
    expect(statistics.percentile([4, Number.NaN, 2, 6], 0)).toBe(2);
    expect(statistics.percentile([4, Number.NaN, 2, 6], 100)).toBe(6);
    expect(statistics.percentile([7], 0)).toBe(7);
    expect(statistics.percentile([7], 50)).toBe(7);
    expect(statistics.percentile([7], 100)).toBe(7);
    expect(statistics.percentile([], 50)).toBeNull();
    expect(statistics.percentile(UNUSABLE_FIGURES, 50)).toBeNull();
  });
});

describe("median and medianMinorUnits: the figure that splits a set in half", () => {
  it("takes the middle figure of an odd count and the mean of the two middle figures of an even one", () => {
    expect(statistics.median([3, 1, 2])).toBe(2);
    expect(statistics.median([1, 2, 3, 4])).toBe(2.5);
    expect(statistics.median([42])).toBe(42);
  });

  it("reads a set unsorted, an outlier unable to drag the middle the way it drags a mean", () => {
    const orderValues = [1_000, 12_000, 2_000];
    const mean = orderValues.reduce((total, value) => total + value, 0) / orderValues.length;
    expect(statistics.median(orderValues)).toBe(2_000);
    expect(statistics.median(orderValues)).toBeLessThan(mean);
    expect(orderValues).toEqual([1_000, 12_000, 2_000]);
  });

  it("drops a figure that is not finite, and reports null when no figure is left", () => {
    expect(statistics.median([Number.NaN, 5, 1])).toBe(3);
    expect(statistics.median([])).toBeNull();
    expect(statistics.median(UNUSABLE_FIGURES)).toBeNull();
  });

  it("rounds money through the single rounding rule, so no half unit reaches a report", () => {
    expect(statistics.medianMinorUnits([1, 2, 3, 4])).toBe(3);
    expect(statistics.medianMinorUnits([1_000, 1_001])).toBe(1_001);
    expect(statistics.medianMinorUnits([1_000])).toBe(1_000);
    expect(statistics.medianMinorUnits([Number.NaN, Number.NaN])).toBeNull();
  });
});

describe("summarise: every figure one read of a series states", () => {
  it("states every member of the summary for a known series, and nothing at all for one with no figure", () => {
    expect(statistics.summarise(SIX_FIGURES)).toEqual(EXPECTED_SUMMARY);
    expect(statistics.summarise([])).toEqual(EMPTY_SUMMARY);
    expect(statistics.summarise(UNUSABLE_FIGURES)).toEqual(EMPTY_SUMMARY);
  });

  it("summarises a single figure as that figure, with no spread at all", () => {
    expect(statistics.summarise([5])).toEqual({
      count: 1,
      sum: 5,
      min: 5,
      max: 5,
      average: 5,
      median: 5,
    });
  });

  it("counts only the finite figures when the series holds a gap", () => {
    expect(statistics.summarise([1, Number.NaN, 3])).toEqual({
      count: 2,
      sum: 4,
      min: 1,
      max: 3,
      average: 2,
      median: 2,
    });
  });

  it("leaves the mean and the middle unrounded for a money caller, and the series as it was", () => {
    const figures = [1, 2];
    const summary = statistics.summarise(figures);
    expect(summary.sum).toBe(3);
    expect(summary.average).toBe(1.5);
    expect(summary.median).toBe(1.5);
    expect(figures).toEqual([1, 2]);
  });
});

// Smoothing and running totals --------------------------------------------------------------------

describe("movingAverage: the average of the last window's figures at each point", () => {
  it("smooths over the last window's figures, a partial window at the start, keeping length and keys", () => {
    const smoothed = statistics.movingAverage(FIGURES_SERIES, 2);
    expect(figuresOf(smoothed)).toEqual([2, 3, 5, 7]);
    expect(smoothed).toHaveLength(FIGURES_SERIES.length);
    expect(smoothed.map((point) => point.x)).toEqual(SERIES_DAYS);
    expect(smoothed.map((point) => point.label)).toEqual(SERIES_DAYS);
    expect(smoothed[1]).toEqual({ ...FIGURES_SERIES[1], y: 3 });
  });

  it.each([1, 0, -3, Number.NaN])(
    "leaves every figure as it stands for a window of %s",
    (window) => {
      expect(figuresOf(statistics.movingAverage(FIGURES_SERIES, window))).toEqual([2, 4, 6, 8]);
    },
  );

  it("reads a fractional window as a whole number and keeps widening past a short series", () => {
    expect(figuresOf(statistics.movingAverage(FIGURES_SERIES, 2.7))).toEqual([2, 3, 5, 7]);
    expect(figuresOf(statistics.movingAverage(FIGURES_SERIES, 3))).toEqual([2, 3, 4, 6]);
    expect(figuresOf(statistics.movingAverage(FIGURES_SERIES, 10))).toEqual([2, 3, 4, 5]);
  });

  it("averages only the window's finite figures, however one leaves it, and returns empty for empty", () => {
    expect(figuresOf(statistics.movingAverage(pointsFor([1, Number.NaN, 3]), 2))).toEqual([
      1, 1, 3,
    ]);
    expect(figuresOf(statistics.movingAverage(pointsFor([1, Number.NaN, 3, 5]), 2))).toEqual([
      1, 1, 3, 4,
    ]);
    expect(figuresOf(statistics.movingAverage(pointsFor([Number.NaN, 2]), 1))).toEqual([0, 2]);
    expect(statistics.movingAverage([], 3)).toEqual([]);
  });

  it("hands back new points and leaves the series it was given untouched", () => {
    const smoothed = statistics.movingAverage(FIGURES_SERIES, 2);
    expect(smoothed).not.toBe(FIGURES_SERIES);
    expect(smoothed[0]).not.toBe(FIGURES_SERIES[0]);
    expect(figuresOf(FIGURES_SERIES)).toEqual([2, 4, 6, 8]);
  });
});

describe("cumulativeSeries: the running total of a series", () => {
  it("replaces each figure with the total up to and including it, the first point keeping its own", () => {
    const figures = [4, 8, 15, 16];
    const cumulative = figuresOf(statistics.cumulativeSeries(pointsFor(figures)));
    expect(cumulative[0]).toBe(figures[0]);
    expect(figuresOf(statistics.cumulativeSeries(pointsFor([1, 2, 3])))).toEqual([1, 3, 6]);
    expect(cumulative.at(-1)).toBe(statistics.summarise(figures).sum);
  });

  it("keeps x and label, skips a figure that is not finite, and returns an empty series empty", () => {
    const series = pointsFor([1, Number.NaN, 3]);
    const cumulative = statistics.cumulativeSeries(series);
    expect(figuresOf(cumulative)).toEqual([1, 1, 4]);
    expect(cumulative.map((point) => point.label)).toEqual(SERIES_DAYS.slice(0, 3));
    expect(cumulative[2]).toEqual({ ...series[2], y: 4 });
    expect(statistics.cumulativeSeries([])).toEqual([]);
  });

  it("hands back new points and leaves the series it was given untouched", () => {
    const series = pointsFor([1, 2, 3]);
    const cumulative = statistics.cumulativeSeries(series);
    expect(cumulative).not.toBe(series);
    expect(cumulative[0]).not.toBe(series[0]);
    expect(figuresOf(series)).toEqual([1, 2, 3]);
  });
});

// KPI comparison ----------------------------------------------------------------------------------

describe("compareToBaseline: a figure against the same figure from a named baseline", () => {
  it("reports both figures, their difference, the signed change and the direction of a rise", () => {
    expect(statistics.compareToBaseline(150, 100, "previous-period")).toEqual(RISE_COMPARISON);
  });

  it("reads a fall as a negative change and the down direction", () => {
    expect(statistics.compareToBaseline(80, 100, "previous-year")).toEqual({
      value: 80,
      baselineValue: 100,
      difference: -20,
      changePercent: -20,
      direction: "down",
      baselineKind: "previous-year",
    });
  });

  it("reports a flat comparison as no change, and growth from nothing by direction alone", () => {
    expect(statistics.compareToBaseline(100, 100, "previous-period")).toEqual({
      value: 100,
      baselineValue: 100,
      difference: 0,
      changePercent: 0,
      direction: "flat",
      baselineKind: "previous-period",
    });
    expect(statistics.compareToBaseline(0, 0, "previous-period").direction).toBe("flat");
    expect(statistics.compareToBaseline(50, 0, "previous-period")).toEqual(NO_BASELINE_COMPARISON);
  });

  it("cannot compare a figure that is not finite, echoing what it was given", () => {
    expect(statistics.compareToBaseline(Number.NaN, 100, "previous-year")).toEqual({
      value: Number.NaN,
      baselineValue: 100,
      difference: 0,
      changePercent: null,
      direction: "unknown",
      baselineKind: "previous-year",
    });
    const brokenBaseline = statistics.compareToBaseline(
      100,
      Number.NEGATIVE_INFINITY,
      "previous-period",
    );
    expect(brokenBaseline.baselineValue).toBe(Number.NEGATIVE_INFINITY);
    expect(brokenBaseline.difference).toBe(0);
    expect(brokenBaseline.changePercent).toBeNull();
    expect(brokenBaseline.direction).toBe("unknown");
  });

  it.each([
    { value: 150, baselineValue: 100 },
    { value: 80, baselineValue: 100 },
    { value: 100, baselineValue: 100 },
    { value: 50, baselineValue: 0 },
    { value: 0, baselineValue: 0 },
  ])(
    "takes its percentage and direction from percentChange and changeDirection for $value against $baselineValue",
    ({ value, baselineValue }) => {
      const comparison = statistics.compareToBaseline(value, baselineValue, "previous-period");
      expect(comparison.changePercent).toBe(statistics.percentChange(value, baselineValue));
      expect(comparison.direction).toBe(statistics.changeDirection(comparison.difference));
      expect(comparison.baselineKind).toBe("previous-period");
    },
  );
});
