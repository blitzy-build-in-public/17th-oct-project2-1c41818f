/**
 * Path: tests/unit/lib/seedInvariants.test.ts
 * Purpose: The seeded data's own invariants: no attributed order and no review dated before its product or the account it belongs to, and nothing seeded dated after the anchor day's first hour.
 * Lines: 89
 */

import { beforeEach, describe, expect, it } from "vitest";

import { CUSTOMERS } from "@/data/customers";
import { createSalesProDataSource } from "@/data/repositories";
import { PRODUCTS } from "@/data/products";
import { REVIEWS } from "@/data/reviews";
import { registerDataSource, resetMockServer, type SalesProDataSource } from "@/lib/mockServer";
import { compareIso } from "@/utils/dates";

// The invariants a seeded cohort must not break: an account predates every order attributed to it, and no
// review precedes the account that wrote it. Both read the data source's own accessors, so no DOM, no
// provider and no rendering take part and the cases run in the node project. They were split out of
// `tests/unit/lib/mockServer.test.ts` per §0.5.5 when the two lanes' additions to that suite met the
// 600-line ceiling; the parent keeps the seam's own contract cases, and the seed-determinism proof lives
// there, because §0.5.5 names that suite as its single home.

/** A row limit past the seeded order count, so a pass reads the whole collection it is about. */
const ALL_ROWS = 10_000;

/** The data source the case in progress is read from, bound by the hook below. */
let source: SalesProDataSource;

beforeEach(() => {
  resetMockServer();
  source = createSalesProDataSource();
  registerDataSource(source);
});

describe("the seeded facts' invariants", () => {
  it("dates no attributed order before the account that placed it was created", () => {
    // The cohort of accounts `src/data/customers.ts` dates inside the trailing year owns no order, because
    // `ATTRIBUTION_PLAN` in `src/data/orders.ts` stops at index 24, and that is what keeps the seed's own
    // invariant: an account predates every order attributed to it, so no seeded order is placed before the
    // account that placed it existed.
    let attributed = 0;
    for (const order of source.getRecentOrders(ALL_ROWS)) {
      const customerId = order.customerId;
      if (customerId === null) continue;
      const account = source.getCustomer(customerId);
      if (account === undefined) throw new Error(`The seeded accounts do not hold ${customerId}.`);
      expect(compareIso(order.placedAt, account.createdAt)).toBeGreaterThanOrEqual(0);
      attributed += 1;
    }
    // An equality over no order at all would hold without proving anything, so the sample is required.
    expect(attributed).toBeGreaterThan(0);
  });

  it("dates no review before the product it reviews, and none after the anchor day's first hour", () => {
    // Both bounds hold at once: a row follows the product it reviews, and a row on the anchor day takes the
    // day's first hour, so no seeded review is dated after the moment a reader opens the app — the ordering
    // a submitted review has to win against.
    const byId = new Map(PRODUCTS.map((product) => [product.id, product]));
    const anchorHour = new Date();
    anchorHour.setHours(0, 0, 0, 0);
    let checked = 0;
    for (const review of REVIEWS) {
      const product = byId.get(review.productId);
      if (product === undefined) throw new Error(`The catalogue holds no ${review.productId}.`);
      expect(compareIso(review.createdAt, product.createdAt)).toBeGreaterThanOrEqual(0);
      expect(Date.parse(review.createdAt)).toBeLessThanOrEqual(
        anchorHour.getTime() + 86_400_000 - 1,
      );
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("dates no review before the account that wrote it was created", () => {
    // Authors are drawn from the whole customer base, the cohort `src/data/customers.ts` dates inside the
    // trailing year included, so each row's own day is clamped to its author's account age: no seeded
    // review precedes the account that wrote it.
    const accounts = new Map(CUSTOMERS.map((customer) => [customer.id, customer]));
    let dated = 0;
    for (const review of REVIEWS) {
      const account = accounts.get(review.customerId);
      if (account === undefined) throw new Error(`No seeded account holds ${review.customerId}.`);
      expect(compareIso(review.createdAt, account.createdAt)).toBeGreaterThanOrEqual(0);
      dated += 1;
    }
    // An equality over no review at all would hold without proving anything, so the sample is required.
    expect(dated).toBeGreaterThan(0);
  });
});
