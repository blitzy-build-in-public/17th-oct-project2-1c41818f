/**
 * Path: tests/unit/data/seedBranches.test.ts
 * Purpose: The seed generators' own guards — a draw from an empty list and a product date built from a day that is not one — together with the seeded history's facts that the guards it never reaches rest on: every order dates at an instant that parses, every order carries a configured delivery method, the documented shopper's history is clear of a cancellation, and every account an attributed order names holds a default of each kind
 * Lines: 198
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { DATA_SEED, createSeededRandom, inventoryStatusOf } from "@/data/products";
import { createdAtFor } from "@/data/productRules";
import type { SalesProDataSource } from "@/lib/mockServer";
import type { Address, Customer } from "@/types/account";
import type { Order } from "@/types/commerce";
import { parseIso } from "@/utils/dates";

import { makeProduct } from "../../fixtures";
import { startSeam } from "../lib/mockServerHarness";

// The subjects are the seed generators: the deterministic draw surface `src/data/products.ts` builds, the
// catalogue rule `src/data/productRules.ts` dates a product with, and the order history `src/data/orders.ts`
// places. Each guard that a caller can reach is driven directly; each one a seeded collection makes
// unreachable is pinned where it belongs, on the facts of that collection, so a seed change that made such a
// guard live fails here rather than passing unnoticed.

/** A row limit past the seeded order count, so a pass reads the whole history it is about. */
const ALL_ROWS = 10_000;

/** The history's orders that name an account: the attributed ones, in the order the store serves them. */
function attributedOrders(store: SalesProDataSource): readonly Order[] {
  return store.getRecentOrders(ALL_ROWS).filter((order) => order.customerId !== null);
}

/** The attributed orders one account owns. */
function attributedOrdersOwnedBy(
  store: SalesProDataSource,
  owner: Customer["id"],
): readonly Order[] {
  return attributedOrders(store).filter((order) => order.customerId === owner);
}

/** The documented shopper, whose own history is the one the seed keeps clear of a cancellation. */
function documentedShopper(store: SalesProDataSource): Customer {
  const shopper = store.findSignInCredential(DEMO_ACCOUNTS.CUSTOMER_EMAIL)?.customer;
  if (shopper === undefined) {
    throw new Error("The seeded accounts do not hold the documented shopper.");
  }
  return shopper;
}

/** The store each case is answered from, bound afresh before it so no case reads another's writes. */
let source: SalesProDataSource;

beforeEach(() => {
  source = startSeam();
});

describe("the seeded draw surface", () => {
  it("refuses a draw from a list that holds nothing, rather than answering `undefined`", () => {
    const rand = createSeededRandom(DATA_SEED);

    // A pick answers an item of the list, so an empty list is refused instead of leaving a caller to narrow
    // an absence it cannot see.
    expect(() => rand.pick([])).toThrow(TypeError);
    expect(() => rand.pick([])).toThrow(/non-empty list/);
  });

  it("draws inside the list and the range it is given", () => {
    const rand = createSeededRandom(DATA_SEED);
    const items = ["alpha", "beta", "gamma", "delta"] as const;

    expect(items).toContain(rand.pick(items));
    expect([...rand.shuffle(items)].sort()).toEqual([...items].sort());
    expect(rand.int(1, 6)).toBeGreaterThanOrEqual(1);
    expect(rand.int(1, 6)).toBeLessThanOrEqual(6);
    expect(rand.next()).toBeGreaterThanOrEqual(0);
    expect(rand.next()).toBeLessThan(1);
    // A draw of a count at or above the list's own length is the list itself, without repetition.
    expect(new Set(rand.pickMany(items, 9)).size).toBe(items.length);
  });
});

describe("a product's reported availability", () => {
  it("reports the level the stock it holds implies, with the figures that imply it", () => {
    const cases: readonly [stock: number, threshold: number, status: string, available: boolean][] =
      [
        [0, 8, "out-of-stock", false],
        [8, 8, "low-stock", true],
        [9, 8, "in-stock", true],
      ];

    for (const [stock, threshold, status, available] of cases) {
      const product = makeProduct({ stockOnHand: stock, lowStockThreshold: threshold });

      const inventory = inventoryStatusOf(product);

      // The level is the shared rule's own and the figures travel with it, so no caller compares a
      // threshold itself: a count of zero is out of stock, one at the threshold is low and none is
      // purchasable until a unit is on the shelf.
      expect(inventory).toEqual({
        productId: product.id,
        stockOnHand: stock,
        lowStockThreshold: threshold,
        status,
        available,
      });
    }
  });
});

describe("a product's seeded date", () => {
  it.each<[label: string, day: string]>([
    ["a blank day", ""],
    ["a value that is not a day at all", "not-a-day"],
    ["a day whose month does not exist", "2025-13-40"],
  ])(
    "refuses %s, because a product needs a real day to be dated inside its window",
    (_label, day) => {
      const rand = createSeededRandom(DATA_SEED);

      expect(() => createdAtFor(day, rand)).toThrow(TypeError);
      expect(() => createdAtFor(day, rand)).toThrow(/ISO day/);
    },
  );

  it("dates a product inside the trailing window ending on the day it is given", () => {
    const anchorDay = "2025-06-15";
    const rand = createSeededRandom(DATA_SEED);

    const at = parseIso(createdAtFor(anchorDay, rand));

    expect(at).not.toBeNull();
    // Never after the anchor day, and at a trading hour rather than at midnight, so a seeded product reads as
    // one added during a working day.
    expect(at === null || at.getTime() <= Date.parse(`${anchorDay}T23:59:59`)).toBe(true);
    expect(at?.getHours()).toBeGreaterThanOrEqual(8);
    expect(at?.getHours()).toBeLessThanOrEqual(20);
  });
});

describe("the seeded order history's own facts", () => {
  it("dates every order and every move of its history at an instant that parses", () => {
    const orders = source.getRecentOrders(ALL_ROWS);

    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(parseIso(order.placedAt)).not.toBeNull();
      expect(parseIso(order.updatedAt)).not.toBeNull();
      // A move is what a customer's own history is read back through, so an unreadable one would be a hole in
      // it rather than a value a screen can render.
      for (const entry of order.statusHistory) {
        expect(parseIso(entry.at)).not.toBeNull();
      }
    }
  });

  it("charges every order one of the configured delivery methods", () => {
    const configured = new Set(source.listShippingMethods().map((method) => method.id));
    const charged = new Set(
      source.getRecentOrders(ALL_ROWS).map((order) => order.shippingMethodId),
    );

    // The weighted draw the history splits its orders with covers the configured methods exactly, so every
    // order carries one of them rather than falling past the end of the list.
    expect([...charged].sort()).toEqual([...configured].sort());
  });

  it("keeps the documented shopper's own orders clear of a cancellation", () => {
    const orders = attributedOrdersOwnedBy(source, documentedShopper(source).id);

    expect(orders.length).toBeGreaterThan(0);
    // The shopper's history is the one a status filter has to be able to narrow to nothing, so no order of
    // theirs is cancelled or refunded — which is the draw the history would otherwise rewrite a status for.
    expect(orders.map((order) => order.status)).not.toContain("cancelled");
    expect(orders.map((order) => order.status)).not.toContain("refunded");
  });

  it("forces a cancelled order into another account's history, so the status filter has one to select", () => {
    const cancelled = attributedOrders(source).filter((order) => order.status === "cancelled");

    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("gives every account an attributed order names a default of each kind in its book", () => {
    const owners = new Set(attributedOrders(source).map((order) => order.customerId));

    expect(owners.size).toBeGreaterThan(0);
    for (const owner of owners) {
      if (owner === null) throw new Error("An attributed order names no account.");
      const book = source.listAddresses(owner);
      // An order confirms to the defaults its owner's book records, so a book holds an address of each kind
      // rather than leaving the order to fall back on the first one it finds.
      expect(book.length).toBeGreaterThan(0);
      expect(book.some((address: Address) => address.isDefaultShipping)).toBe(true);
      expect(book.some((address: Address) => address.isDefaultBilling)).toBe(true);
    }
  });
});
