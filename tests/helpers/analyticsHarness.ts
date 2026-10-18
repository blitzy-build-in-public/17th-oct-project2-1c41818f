/**
 * Path: tests/helpers/analyticsHarness.ts
 * Purpose: The fixture surface both analytics suites read: the pinned period's fact rows, accounts and orders with the KPI input they make, the payload reader for a read that must have succeeded and the seam sign-in that authorises one.
 * Lines: 96
 */

import { expect } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import type { KpiInput } from "@/lib/analyticsService";
import { API_PATHS, handleRequest } from "@/lib/mockServer";
import type { SalesRecord } from "@/types/analytics";
import type { DateRange, Result } from "@/types/common";
import type { Order } from "@/types/commerce";
import * as dates from "@/utils/dates";

import * as fixtures from "../fixtures";

// The pinned period, and the fixture rows both analytics suites build their inputs from ---------------

/** The period the rows below are stated over: the trailing thirty days the fixture clock's instant ends —
 *  `FIXED_DATE_RANGE`, the same constant each analytics suite aliases as its own `RANGE`. */
const RANGE: DateRange = fixtures.FIXED_DATE_RANGE;

/** One fact row. Every total a suite states over these rows is arithmetic a reader can check against the
 *  row beside it. */
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

/** The controlled fact rows every analytics case is stated over. */
export const FACTS: readonly SalesRecord[] = [
  // Inside the period, on its own first and last day: 9,000 and 5,000 net of the discount and refund.
  factRow(RANGE.from, 5, 7, 10_000, 1_000),
  factRow(RANGE.to, 3, 5, 6_000, 0, 1_000),
  // The day before the period, which a comparison reads and one case withholds; the day after it, which
  // no case reads.
  factRow(dates.addDays(RANGE.from, -1), 4, 6, 7_000),
  factRow(dates.addDays(RANGE.to, 1), 50, 50, 999_999),
];

/** One account created inside the period and one created long before it, so a KPI states both sides. */
const NEW_ACCOUNT = fixtures.makeCustomer({
  email: "new@salespro.test",
  createdAt: RANGE.from,
});
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
export const KPI_INPUT: KpiInput = {
  records: FACTS,
  orders: PERIOD_ORDERS,
  customers: [NEW_ACCOUNT, OLD_ACCOUNT],
  query: RANGE,
};

// The two seam calls a suite makes -------------------------------------------------------------------

/** The payload of a read that must have succeeded, so no member of a successful result is reached
 *  through a cast and no case needs a try/catch around a read. */
export function valueOf<TValue>(result: Result<TValue>): TValue {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected a payload, received ${result.error.code}`);
  return result.value;
}

/** Signs an account in through the seam's own route and hands back the token, so a read reaches the
 *  dashboard as the application does rather than with a hand-made session. */
export async function signIn(email: string): Promise<string> {
  const login = handleRequest<{ readonly token: string }>(API_PATHS.AUTH_LOGIN, {
    method: "POST",
    body: { email, password: DEMO_ACCOUNTS.PASSWORD },
  });
  return valueOf(await login).token;
}
