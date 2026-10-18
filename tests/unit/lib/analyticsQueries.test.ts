/**
 * Path: tests/unit/lib/analyticsQueries.test.ts
 * Purpose: The query builders a dated read is assembled with, and the fallbacks a defensive read carries.
 * Lines: 95
 */

// The service's read builders and the fallbacks those reads carry: the cut, the comparison and the ranking
// a caller leaves unanswered, a percentage no baseline of data can state, and a category the vocabulary
// does not hold named by its own slug. The seeded source is bound once below and the one range the seam's
// reads are issued over is derived from its newest order rather than from the ambient clock, so the
// expectations hold whatever day the suite runs. The aggregations and the four administrator-only reads
// have their own suite, so this file asserts only how a read is assembled and what it states when there
// is nothing to state.
import { beforeAll, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { salesProDataSource } from "@/data/repositories";
import * as analytics from "@/lib/analyticsService";
import { registerDataSource } from "@/lib/mockServer";
import type { CategoryId, DateRange } from "@/types/common";
import * as dates from "@/utils/dates";

import * as fixtures from "../../fixtures";
import { FACTS, KPI_INPUT, signIn, valueOf } from "../../helpers/analyticsHarness";

// The pinned period, and the category a labelling fallback names ------------------------------------

/** The trailing thirty days the fixed instant ends: the period these cases are stated over. */
const RANGE: DateRange = fixtures.FIXED_DATE_RANGE;
/** A category id no definition in the vocabulary holds, for the labelling fallback a reader sees. */
const ORPHAN_CATEGORY = "cat_unknown-slug" as CategoryId;

// The seeded source, bound once, and the range the reads are issued over ---------------------------------

/** The token the dashboard's reads are authorised with. */
let adminToken = "";
/** The trailing thirty days of the seeded history — derived from its newest order rather than from the
 *  ambient clock, so it holds activity whenever the suite runs. */
let seededRange: DateRange = RANGE;

/** The session an administrator's read is authorised with. */
function admin(): analytics.AnalyticsRequestOptions {
  return { sessionToken: adminToken };
}

beforeAll(async () => {
  registerDataSource(salesProDataSource);
  adminToken = await signIn(DEMO_ACCOUNTS.ADMIN_EMAIL);
  const newest = salesProDataSource.getRecentOrders(1)[0];
  if (newest === undefined) return;
  const lastDay = dates.startOfDay(newest.placedAt);
  seededRange = { from: dates.addDays(lastDay, -29), to: lastDay };
});

// The builders a dated read is assembled with, and the fallbacks a defensive read carries ---------

describe("the builders a dated read is assembled with", () => {
  it("states the cut, the comparison and the ranking a caller leaves unanswered", () => {
    const dated = analytics.toAnalyticsQuery(RANGE.from, RANGE.to);
    expect(dated).toEqual({ ...RANGE, bucket: "day", baseline: "previous-period" });
    const revenue = analytics.toRevenueQuery(RANGE.from, RANGE.to);
    expect(revenue).toEqual({ ...RANGE, bucket: "day" });
    const ranked = analytics.toTopProductsQuery(RANGE.from, RANGE.to);
    expect(ranked.limit).toBe(analytics.DEFAULT_TOP_PRODUCTS_LIMIT);
    expect(ranked.metric).toBe(analytics.DEFAULT_TOP_PRODUCTS_METRIC);
  });

  it("reads a query naming no cut by day, and refuses the positional form that carries no session", async () => {
    const series = valueOf(await analytics.getRevenueSeries({ ...seededRange }, admin()));
    const days = dates.eachBucket(seededRange, "day").map((bucket) => bucket.key);
    expect(series[0].points.map((point) => point.x)).toEqual(days);
    // The ranking's positional form takes no options, so it carries no session and the
    // administrator-only endpoint refuses it; a caller holding a session uses the query form.
    const positional = await analytics.getTopProducts(seededRange.from, seededRange.to, 2);
    expect(positional.ok).toBe(false);
    if (positional.ok) return;
    expect(positional.error.status).toBe(401);
  });

  it("states no percentage against a baseline of nothing, and no infinity in its place", () => {
    const records = FACTS.filter((record) => record.date !== dates.addDays(RANGE.from, -1));
    const summary = analytics.computeKpis({ ...KPI_INPUT, records });
    // A comparison period that sold nothing has no ratio: growth from nothing leaves the period's own
    // figure standing and states no percentage rather than an infinity no card can render.
    expect(summary.revenueMinor).toBe(14_000);
    expect(summary.baseline.revenueChangePercent).toBeNull();
  });

  it("names a category the vocabulary does not hold by its own slug", () => {
    const orphan = fixtures.makeSalesRecord({ date: RANGE.to, categoryId: ORPHAN_CATEGORY });
    const query = { from: RANGE.from, to: RANGE.to, groupBy: "category" } as const;
    const series = analytics.computeRevenueSeries({ records: [orphan], query });
    expect(series[0].label).toBe("unknown-slug");
  });
});
