/**
 * Path: tests/unit/lib/analyticsSeries.test.ts
 * Purpose: The band wording of a charted period's series: one band per bucket, and no two bands of one run worded alike.
 * Lines: 74
 */

// What a series' band wording must guarantee: one band per bucket of the run, no two of its bands worded
// alike, and the run's figures totalling what the KPI states for the same period. A chart keys a band by its
// wording, so two buckets worded alike fold into one band and the chart states the figure of whichever of
// them it found first. It needs no seam, no session and no clock: the run is the product's own widest range
// and the facts are the seeded ones, so the expectations hold whatever day the suite runs.
import { describe, expect, it } from "vitest";

import { seededSalesRecords } from "@/data/salesHistory";
import { computeKpis, computeRevenueSeries } from "@/lib/analyticsService";
import type { ChartSeries, SalesRecord } from "@/types/analytics";
import type { DateRange } from "@/types/common";
import {
  bucketCount,
  eachBucket,
  formatBucketLabel,
  formatDate,
  maxReportRange,
} from "@/utils/dates";

/** The widest range the product accepts — a year and a day, whose first and last days fall on one calendar
 *  day a year apart and therefore word alike whenever a day's wording leaves its year out. */
const WIDEST: DateRange = maxReportRange();

/** The seeded facts as one whole-period series over a day-bucketed range: no split is asked for, so the
 *  series stands even when the range holds nothing, and the range alone decides the buckets. */
function daySeries(
  range: DateRange,
  records: readonly SalesRecord[] = seededSalesRecords(),
): ChartSeries {
  const [series] = computeRevenueSeries({ records, query: { ...range, bucket: "day" } });
  return series;
}

describe("the band wording of a charted period", () => {
  it("words every bucket of the widest range once, so no two of its bands fold into one", () => {
    const { points } = daySeries(WIDEST);
    const labels = points.map((point) => point.label);

    expect(points).toHaveLength(bucketCount(WIDEST, "day"));
    expect(new Set(labels).size).toBe(labels.length);
    expect([labels[0], labels.at(-1)]).toEqual([formatDate(WIDEST.from), formatDate(WIDEST.to)]);
    expect(points.map((point) => point.x)).toEqual(
      eachBucket(WIDEST, "day").map((bucket) => bucket.key),
    );
  });

  it("plots a whole period that totals what the KPI states for it", () => {
    const { points } = daySeries(WIDEST);
    const plotted = points.reduce((total, point) => total + point.y, 0);
    const kpis = computeKpis({
      records: seededSalesRecords(),
      orders: [],
      customers: [],
      query: WIDEST,
    });
    expect(plotted).toBe(kpis.revenueMinor);
  });

  it("words a day of a run that stays inside one calendar year without its year", () => {
    const year = WIDEST.to.slice(0, 4);
    const range: DateRange = { from: `${year}-01-01`, to: `${year}-01-30` };
    const { points } = daySeries(range, []);
    const days = eachBucket(range, "day").map((bucket) => bucket.key);
    expect(points.map((point) => point.label)).toEqual(
      days.map((day) => formatBucketLabel(day, "day")),
    );
  });
});
