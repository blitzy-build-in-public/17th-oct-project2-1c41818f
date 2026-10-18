/**
 * Path: tests/unit/lib/seedInvariants.test.ts
 * Purpose: The seeded data's own properties: its determinism across two bootstraps and its invariants (no attributed order and no review dated before its product or the account it belongs to, and nothing seeded dated after the anchor day's first hour).
 * Lines: 223
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { CUSTOMERS } from "@/data/customers";
import { createSalesProDataSource } from "@/data/repositories";
import { PRODUCTS } from "@/data/products";
import { REVIEWS } from "@/data/reviews";
import { getJson } from "@/lib/apiClient";
import {
  API_ERROR_CODES,
  registerDataSource,
  resetMockServer,
  type SalesProDataSource,
} from "@/lib/mockServer";
import type { Product } from "@/types/catalog";
import type { ApiError, Result } from "@/types/common";
import { compareIso } from "@/utils/dates";

import { FIXED_DATE_RANGE, FIXED_NOW, makeFilterState } from "../../fixtures";

// The invariants a seeded cohort must not break: an account predates every order attributed to it, and no
// review precedes the account that wrote it. Both read the data source's own accessors, so no DOM, no
// provider and no rendering take part and the cases run in the node project. They were split out of
// `tests/unit/lib/mockServer.test.ts` per §0.5.5 when the two lanes' additions to that suite met the
// 600-line ceiling; the parent keeps the seam's own contract cases.

/** A row limit past the seeded order count, so a pass reads the whole collection it is about. */
const ALL_ROWS = 10_000;
/** The catalogue page size a determinism pass reads at: the largest configured, so a total spans few pages. */
const PAGE_SIZE = 48;
/** The order rows a determinism pass samples: enough for the invariants that pass asserts. */
const ORDER_SAMPLE = 40;

/** The first entry of a collection a pass reads, or a failure naming the empty collection. */
function firstOf<TItem>(items: readonly TItem[]): TItem {
  const [first] = items;
  if (first === undefined) throw new Error("The collection the pass reads is empty.");
  return first;
}

/** The payload of a request a pass expects to be answered. */
async function valueOf<TValue>(pending: Promise<Result<TValue>>): Promise<TValue> {
  const result = await pending;
  if (!result.ok) throw new Error(`The request was refused with ${result.error.code}.`);
  return result.value;
}

/** The failure of a request a pass expects to be refused. */
async function refusalOf<TValue>(pending: Promise<Result<TValue>>): Promise<ApiError> {
  const result = await pending;
  if (result.ok) throw new Error("The request was answered where the pass expects a refusal.");
  return result.error;
}

/** Asserts one refusal: the status and code the contract sets and the message every failure carries. */
function expectRefusal(error: ApiError, status: number, code: string, label = "the refusal"): void {
  expect(error.status, label).toBe(status);
  expect(error.code, label).toBe(code);
  expect(error.message.length, label).toBeGreaterThan(0);
}

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

/** The product a bootstrap's review read is scoped by: the one the pass's own catalogue page holds with the
 * most reviews, so the scoping the determinism case asserts is asserted over rows rather than over an empty
 * list, and both passes pick the same product without a seeded identifier being written down here. */
function mostReviewed(products: readonly Product[]): Product {
  return products.reduce(
    (best, one) => (one.ratingCount > best.ratingCount ? one : best),
    firstOf(products),
  );
}

/** One independent bootstrap of the seeded data, read through the data source's own accessors. The module
 * registry is reset first, so two passes share no module state and the second is not the first's store. */
async function captureSeed() {
  vi.resetModules();
  const data = await import("@/data/repositories");
  const booted = data.createSalesProDataSource();
  const products = booted.listProducts(makeFilterState({ pageSize: PAGE_SIZE }));
  const reviewed = mostReviewed(products.items);
  return {
    categories: booted.listCategories(),
    brands: booted.listBrands(),
    products,
    reviewed,
    reviews: booted.listProductReviews({ productId: reviewed.id, page: 1, pageSize: PAGE_SIZE }),
    orders: booted.getRecentOrders(ORDER_SAMPLE),
    credential: booted.findSignInCredential(DEMO_ACCOUNTS.CUSTOMER_EMAIL),
    // The two analytics reads answer with a promise of a `Result`, because the modules they aggregate with
    // are fetched on first use, so a pass unwraps the value the equality below compares.
    kpis: await valueOf(booted.getKpis(FIXED_DATE_RANGE)),
    revenue: await valueOf(booted.getRevenueSeries(FIXED_DATE_RANGE)),
    reports: booted.listReportDefinitions(),
  };
}

describe("seed determinism", () => {
  it("boots the same seeded collections twice from a fresh module registry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const first = await captureSeed();
    const second = await captureSeed();
    vi.useRealTimers();
    // The equality alone would also hold for two reads of one already-loaded module, so what proves each
    // pass is a fresh bootstrap is that the range-keyed reads below are non-empty: they only are when the
    // module re-ran its seed under the pinned clock rather than serving the copy loaded at file scope.
    expect(first).toEqual(second);
    expect(first.categories.length).toBeGreaterThan(0);
    expect(first.brands.length).toBeGreaterThan(0);
    expect(first.products.items.length).toBeGreaterThan(0);
    expect(first.reviews.items.length).toBeGreaterThan(0);
    expect(first.orders.length).toBeGreaterThan(0);
    expect(first.reports.length).toBeGreaterThan(0);
    expect(first.revenue.length).toBeGreaterThan(0);
    expect(first.kpis.orders).toBeGreaterThan(0);
    expect(first.credential?.digest.hash).toBe(second.credential?.digest.hash);
    // The reviews read is scoped to the product it names: its rows are that product's own, its total is that
    // product's own review count from the same bootstrap, and they lead with the newest first.
    expect(first.reviews.items.length).toBeGreaterThan(0);
    const own = first.reviewed.id;
    expect(first.reviews.items.every((review) => review.productId === own)).toBe(true);
    expect(first.reviews.total).toBe(first.reviewed.ratingCount);
    const stamps = first.reviews.items.map((review) => review.createdAt);
    expect([...stamps].sort(compareIso).reverse()).toEqual(stamps);
    // An identifier the catalogue does not hold is refused, as the write route on the same path refuses it,
    // rather than answered with the collection.
    expectRefusal(
      await refusalOf(getJson("/api/products/prod_not-in-the-catalogue/reviews")),
      404,
      API_ERROR_CODES.PRODUCT_NOT_FOUND,
      "the reviews of an unknown product",
    );
    for (const order of first.orders) {
      const priced = order.pricedCart;
      for (const line of priced.lines) {
        expect(line.lineSubtotalMinor).toBe(line.unitPriceMinor * line.quantity);
        expect(line.lineTotalMinor).toBe(line.lineSubtotalMinor - line.discountMinor);
      }
      const orderTotal = order.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      const pricedTotal = priced.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      expect(orderTotal).toBe(pricedTotal);
      expect(priced.subtotalMinor).toBe(
        priced.lines.reduce((sum, line) => sum + line.lineSubtotalMinor, 0),
      );
      expect(priced.discountTotalMinor).toBe(
        priced.lines.reduce((sum, line) => sum + line.discountMinor, 0),
      );
      expect(priced.grandTotalMinor).toBe(
        priced.subtotalMinor - priced.discountTotalMinor + priced.shippingMinor + priced.taxMinor,
      );
    }
  });
});
