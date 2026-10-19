/**
 * Path: tests/unit/lib/analyticsBaseline.test.ts
 * Purpose: The previous-year comparison the dashboard offers, and one period's figures across the four surfaces a live order moves.
 * Lines: 182
 */

// Two behaviours, and no other case covers either: the comparison baseline the dashboard offers — the
// previous year — is answered from the seeded history rather than from nothing, so every KPI change is a
// figure instead of the placeholder a comparison with no baseline states; and one period's orders and revenue
// read the same on the KPI cards, the revenue series and both the sales and customers reports once an order
// has been placed in the session. No case reads the ambient clock: each period is derived from the newest
// seeded order, so the expectations hold whatever day the suite runs, and the one order these cases place is
// placed through the seam as the application places it. Nor does a case read a sibling's write: each binds its
// own freshly seeded source and signs the administrator in for itself, so the order the second case places
// cannot be in the collection the first case's figures are held to, in any order the runner takes them in.
import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, DEMO_CARD_NUMBERS } from "@/constants/config";
import { ORDERS } from "@/data/orders";
import * as analytics from "@/lib/analyticsService";
import { postJson } from "@/lib/apiClient";
import { API_PATHS, handleRequest, type SalesProDataSource } from "@/lib/mockServer";
import { runReport } from "@/lib/reportService";
import type { ReportKind, ReportResult } from "@/types/analytics";
import type { DateRange, Result } from "@/types/common";
import type { Order } from "@/types/commerce";
import { addDays, resolveBaselineRange, startOfDay } from "@/utils/dates";
import { periodOrders } from "@/utils/statistics";

import { orderBody, signInCustomer, startSeam, valueOf } from "./mockServerHarness";

// The seeded source and the session these cases read and write with, bound per case -----------------

/** The data source the seam serves, bound by {@link startSeam} before each case runs. */
let source: SalesProDataSource;
/** The administrator's session, which every analytics and report read requires, signed in before each case
 *  runs. The order the second case places carries the seeded customer's own session, handed over by
 *  {@link signInCustomer}. */
let adminToken = "";

/** The period every case is stated over: the trailing thirty days of the seeded history, ending on its newest
 *  order's own day, derived from the data rather than from the ambient clock. */
function trailingThirtyDays(): DateRange {
  const newest = source.getRecentOrders(1)[0];
  if (newest === undefined)
    throw new Error("The seeded history holds no order to date a period by.");
  const lastDay = startOfDay(newest.placedAt);
  return { from: addDays(lastDay, -29), to: lastDay };
}

/** Signs an account in through the seam's own route and hands back the token, so a read reaches the
 *  dashboard as the application does rather than with a hand-made session. */
async function signIn(email: string): Promise<string> {
  const login = handleRequest<{ readonly token: string }>(API_PATHS.AUTH_LOGIN, {
    method: "POST",
    body: { email, password: DEMO_ACCOUNTS.PASSWORD },
  });
  return (await valueOf(login)).token;
}

/** One report's totals as the payload states them, keyed by the column each row summarises. */
async function totalsOf(
  kind: ReportKind,
  range: DateRange,
): Promise<Readonly<Record<string, number>>> {
  const result: Promise<Result<ReportResult>> = runReport(
    { kind, ...range, bucket: "day" },
    { sessionToken: adminToken },
  );
  const rows = (await valueOf(result)).summary.items;
  return Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
}

/** One period's four surfaces as they stand at the moment this is called: the KPI summary's orders, revenue
 *  and units, the whole-period revenue series' own total, and the two reports' figures for the same period. */
interface PeriodRead {
  readonly kpiOrders: number;
  readonly kpiRevenue: number;
  readonly kpiUnits: number;
  readonly seriesTotal: number;
  readonly salesOrders: number;
  readonly salesNet: number;
  readonly customersOrders: number;
  readonly customersRevenue: number;
}

/** Reads the period's four surfaces, in the order the dashboard reads them. */
async function readPeriod(range: DateRange, token: string): Promise<PeriodRead> {
  const kpis = await valueOf(
    analytics.getKpis({ ...range, bucket: "day" }, { sessionToken: token }),
  );
  const series = await valueOf(
    analytics.getRevenueSeries({ ...range, bucket: "month" }, { sessionToken: token }),
  );
  const sales = await totalsOf("sales", range);
  const customers = await totalsOf("customers", range);
  return {
    kpiOrders: kpis.orders,
    kpiRevenue: kpis.revenueMinor,
    kpiUnits: kpis.units,
    seriesTotal: series.flatMap((each) => each.points).reduce((total, point) => total + point.y, 0),
    salesOrders: sales.orders ?? 0,
    salesNet: sales.netRevenue ?? 0,
    customersOrders: customers.orders ?? 0,
    customersRevenue: customers.revenue ?? 0,
  };
}

beforeEach(async () => {
  // Bound per case rather than once for the file: the seam re-seeds the collection a case reads, so what a
  // sibling case placed is not in it.
  source = startSeam();
  adminToken = await signIn(DEMO_ACCOUNTS.ADMIN_EMAIL);
});

// The comparison the dashboard offers ---------------------------------------------------------------

describe("the comparison the dashboard offers: a previous-year baseline over the seeded history", () => {
  it("states a change for every figure, measured against a window that holds activity", async () => {
    const range = trailingThirtyDays();
    const summary = await valueOf(
      analytics.getKpis({ ...range, baseline: "previous-year" }, { sessionToken: adminToken }),
    );
    const previous = resolveBaselineRange(range, "previous-year");
    // The comparison is named by its own dates, and it is the calendar year before the period, not an
    // equal-length window: what the baseline the dashboard offers is held to.
    expect(summary.baseline.kind).toBe("previous-year");
    expect([summary.baseline.from, summary.baseline.to]).toEqual([previous.from, previous.to]);
    // A window holding no order states a null change — the placeholder a KPI card renders as "no comparable
    // data" — so a finite figure on all four is the baseline being answered from the history rather than
    // from nothing, and the seeded orders under the window are what that figure is a ratio of.
    const changes = [
      summary.baseline.revenueChangePercent,
      summary.baseline.ordersChangePercent,
      summary.baseline.unitsChangePercent,
      summary.baseline.averageOrderValueChangePercent,
    ];
    expect(changes.every((change) => change !== null && Number.isFinite(change))).toBe(true);
    expect(periodOrders(ORDERS, previous).length).toBeGreaterThan(0);
    // The period's own figures stand as they always did: the baseline is a second reading, not a second
    // period replacing the one the administrator asked for.
    expect(summary.from).toBe(range.from);
    expect(summary.to).toBe(range.to);
    expect(summary.orders).toBe(periodOrders(ORDERS, range).length);
  });
});

// One period, one order count, one revenue ----------------------------------------------------------

describe("one period, one set of figures: an order placed in the session against every surface", () => {
  it("moves the KPIs, the series and both reports together, by the order's own goods", async () => {
    const range = trailingThirtyDays();
    const before = await readPeriod(range, adminToken);
    const session = await signInCustomer();
    const placed = await valueOf(
      postJson<Order>(
        API_PATHS.ORDERS,
        await orderBody("analytics-baseline-live-order", DEMO_CARD_NUMBERS.APPROVED),
        { sessionToken: session.token },
      ),
    );
    // The order lands on the anchor day, which is the period's own last day, so every surface below reads it.
    expect(periodOrders([placed], range)).toHaveLength(1);
    const after = await readPeriod(range, adminToken);
    const goods = placed.pricedCart.subtotalMinor - placed.pricedCart.discountTotalMinor;
    const units = placed.lines.reduce((total, line) => total + line.quantity, 0);
    // One period, one order count and one revenue: the dashboard's two surfaces and the two reports whose
    // figures are drawn from the orders state the same thing about the sale.
    expect(after.kpiOrders).toBe(before.kpiOrders + 1);
    expect([after.salesOrders, after.customersOrders]).toEqual([after.kpiOrders, after.kpiOrders]);
    expect([after.kpiRevenue, after.seriesTotal, after.salesNet, after.customersRevenue]).toEqual([
      before.kpiRevenue + goods,
      before.seriesTotal + goods,
      before.salesNet + goods,
      after.kpiRevenue,
    ]);
    expect([after.kpiUnits, after.seriesTotal]).toEqual([
      before.kpiUnits + units,
      after.kpiRevenue,
    ]);
  });
});
