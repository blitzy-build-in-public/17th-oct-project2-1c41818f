/**
 * Path: tests/unit/lib/analyticsQueries.test.ts
 * Purpose: The query builders a dated read is assembled with, and the fallbacks a defensive read carries.
 * Lines: 162
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
import { API_PATHS, handleRequest, registerDataSource } from "@/lib/mockServer";
import type { SalesRecord } from "@/types/analytics";
import type { CategoryId, DateRange, Result } from "@/types/common";
import type { Order } from "@/types/commerce";
import * as dates from "@/utils/dates";

import * as fixtures from "../../fixtures";

// The pinned period, and the data the fallbacks are stated over --------------------------------------

/** The trailing thirty days the fixed instant ends: the period these cases are stated over. */
const RANGE: DateRange = fixtures.FIXED_DATE_RANGE;
/** A category id no definition in the vocabulary holds, for the labelling fallback a reader sees. */
const ORPHAN_CATEGORY = "cat_unknown-slug" as CategoryId;

/** One fact row. Every total below is arithmetic a reader can check against the row beside it. */
function factRow(
  date: string,
  orders: number,
  units: number,
  gross: number,
  discount = 0,
  refund = 0,
): SalesRecord {
  const fields = { date, orders, units, grossRevenueMinor: gross, discountMinor: discount };
  return fixtures.makeSalesRecord({ ...fields, refundMinor: refund });
}

const FACTS: readonly SalesRecord[] = [
  // Inside the period, on its own first and last day: 9,000 and 5,000 net of the discount and refund.
  factRow(RANGE.from, 5, 7, 10_000, 1_000),
  factRow(RANGE.to, 3, 5, 6_000, 0, 1_000),
  // The day before the period, which the fallback case below withholds from the comparison, and the day
  // after it, which no case here reads.
  factRow(dates.addDays(RANGE.from, -1), 4, 6, 7_000),
  factRow(dates.addDays(RANGE.to, 1), 50, 50, 999_999),
];

/** One account created inside the period and one created long before it, so a KPI states both sides. */
const NEW_ACCOUNT = fixtures.makeCustomer({ email: "new@salespro.test", createdAt: RANGE.from });
const OLD_ACCOUNT = fixtures.makeCustomer({ email: "old@salespro.test" });

/** One order of the period, placed by the account named or by a guest, and the four the KPIs read. */
function periodOrder(customerId: Order["customerId"], placedAt: string, number: string): Order {
  return fixtures.makeOrder({ orderNumber: number, customerId, placedAt });
}

const PERIOD_ORDERS: readonly Order[] = [
  periodOrder(NEW_ACCOUNT.id, `${RANGE.from}T09:30:00`, "SP-300001"),
  periodOrder(NEW_ACCOUNT.id, `${RANGE.to}T10:00:00`, "SP-300002"),
  periodOrder(null, `${RANGE.from}T11:00:00`, "SP-300003"),
  periodOrder(OLD_ACCOUNT.id, `${dates.addDays(RANGE.to, 1)}T10:00:00`, "SP-300004"),
];

/** Everything `computeKpis` reads for RANGE: the fact rows, the orders that converted through it and
 *  the account base they convert a share of. */
const KPI_INPUT: analytics.KpiInput = {
  records: FACTS,
  orders: PERIOD_ORDERS,
  customers: [NEW_ACCOUNT, OLD_ACCOUNT],
  query: RANGE,
};

// The seeded source, bound once, and the range the reads are issued over ---------------------------------

/** The token the dashboard's reads are authorised with. */
let adminToken = "";
/** The trailing thirty days of the seeded history — derived from its newest order rather than from the
 *  ambient clock, so it holds activity whenever the suite runs. */
let seededRange: DateRange = RANGE;

/** The payload of a read that must have succeeded, so no member of a successful result is reached
 *  through a cast and no case needs a try/catch around a read. */
function valueOf<TValue>(result: Result<TValue>): TValue {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected a payload, received ${result.error.code}`);
  return result.value;
}

/** The session an administrator's read is authorised with. */
function admin(): analytics.AnalyticsRequestOptions {
  return { sessionToken: adminToken };
}

/** Signs an account in through the seam's own route and hands back the token, so a read reaches the
 *  dashboard as the application does rather than with a hand-made session. */
async function signIn(email: string): Promise<string> {
  const login = handleRequest<{ readonly token: string }>(API_PATHS.AUTH_LOGIN, {
    method: "POST",
    body: { email, password: DEMO_ACCOUNTS.PASSWORD },
  });
  return valueOf(await login).token;
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
