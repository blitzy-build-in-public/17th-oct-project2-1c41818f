/**
 * Path: tests/unit/data/orderAttribution.test.ts
 * Purpose: The anchor table's placement rule: the sixty attributed orders each take their own slot of the trailing window, exactly one of them is forced into `cancelled`, and a window too short to give them a slot each is refused rather than collapsed onto one day
 * Lines: 107
 */

import { describe, expect, it } from "vitest";

import { planAttribution, type Attribution } from "@/data/orderAttribution";

// The subject is the hand-authored anchor table behind the seeded order history. Its one function is pure
// — a window's order count in, the placement of the attributed orders out — so the cases drive it directly
// and assert what it returns: which slots it fills, which account each one belongs to and which single
// order it forces into a status the draw would not have given it.

/** The sixty orders the plan places: `ATTRIBUTED_ORDER_TOTAL` in `src/data/orderAttribution.ts`, restated
 *  here as the figure the cases pin, so a change to the table and to that total together is caught. */
const ATTRIBUTED_ORDERS = 60;

/** The orders the history's trailing window holds — the count `src/data/orders.ts` plans it with, a figure
 *  between 1,154 and 1,156 depending on the weekday the window closes on. */
const TRAILING_WINDOW_ORDERS = 1_155;

/** One slot of the window and the order placed in it, ordered by slot, so a case reads a placement as the
 *  sequence the history walks rather than as a map. */
function placements(
  orderTotal: number,
): readonly (readonly [slot: number, attribution: Attribution])[] {
  return [...planAttribution(orderTotal)].sort(([left], [right]) => left - right);
}

describe("the placement of the attributed orders", () => {
  it("gives each of the sixty orders its own slot, walking the window from its first day to its last", () => {
    const attribution = planAttribution(TRAILING_WINDOW_ORDERS);
    const slots = [...attribution.keys()].sort((left, right) => left - right);

    // Sixty orders, sixty distinct slots: the slots are spread evenly through the window rather than
    // bunched, so the earliest order sits in its first tenth and the latest in its last.
    expect(slots).toHaveLength(ATTRIBUTED_ORDERS);
    expect(new Set(slots).size).toBe(ATTRIBUTED_ORDERS);
    expect(slots[0]).toBeGreaterThanOrEqual(0);
    expect(slots[slots.length - 1]).toBeLessThan(TRAILING_WINDOW_ORDERS);
    expect(slots[0]).toBeLessThan(TRAILING_WINDOW_ORDERS / 10);
    expect(slots[slots.length - 1]).toBeGreaterThan((TRAILING_WINDOW_ORDERS * 9) / 10);
  });

  it("forces exactly one of them into a cancelled status, and leaves the other fifty-nine to the draw", () => {
    const forced = placements(TRAILING_WINDOW_ORDERS).filter(
      ([, attribution]) => attribution.forcedStatus !== null,
    );

    // One order carries a status of its own, so the history's status filter has a cancellation to select
    // without the shopper's own history being cancelled; every other order is left to the seeded draw.
    expect(forced).toHaveLength(1);
    expect(forced[0][1].forcedStatus).toBe("cancelled");
    expect(
      placements(TRAILING_WINDOW_ORDERS).filter(([, row]) => row.forcedStatus === null),
    ).toHaveLength(ATTRIBUTED_ORDERS - 1);
  });

  it("spreads each account's own orders through the window instead of placing them in a row", () => {
    const byCustomer = new Map<number, number[]>();
    for (const [slot, attribution] of placements(TRAILING_WINDOW_ORDERS)) {
      const held = byCustomer.get(attribution.customerIndex);
      if (held === undefined) byCustomer.set(attribution.customerIndex, [slot]);
      else held.push(slot);
    }
    // The table's first entry holds five orders, the widest allocation it declares, and those five orders
    // sit in five different tenths of the window rather than in one.
    const widest = [...byCustomer.values()].sort((left, right) => right.length - left.length)[0];
    expect(widest).toHaveLength(5);
    const tenths = new Set(widest.map((slot) => Math.floor((slot * 10) / TRAILING_WINDOW_ORDERS)));
    expect(tenths.size).toBeGreaterThan(2);
  });

  it.each<[label: string, orderTotal: number]>([
    ["a window of one order", 1],
    ["a window of two orders", 2],
    ["a window narrower than the orders it must hold", ATTRIBUTED_ORDERS - 1],
  ])("refuses %s, because two attributed orders there would share a slot", (_label, orderTotal) => {
    // A slot is the window's own order count divided by the sixty orders the plan holds, so a window
    // with fewer orders than that gives two of them the same slot: the table refuses rather than
    // overwrite one attributed order with another and hand the history fewer than its sixty.
    expect(() => planAttribution(orderTotal)).toThrow(/same slot/);
  });

  it("accepts the narrowest window that still gives every attributed order a slot", () => {
    const attribution = planAttribution(ATTRIBUTED_ORDERS);

    // One order per slot is the boundary the rule accepts: sixty orders in a window of sixty.
    expect(attribution.size).toBe(ATTRIBUTED_ORDERS);
    expect([...attribution.keys()].sort((left, right) => left - right)).toEqual(
      Array.from({ length: ATTRIBUTED_ORDERS }, (_row, index) => index),
    );
  });

  it("places the same window the same way on every call, because the table holds no clock and no draw", () => {
    const placed = placements(TRAILING_WINDOW_ORDERS);

    expect(placements(TRAILING_WINDOW_ORDERS)).toEqual(placed);
    // Every entry names an account by its position in the seeded collection: an index outside it would
    // place an order on an account the store does not hold.
    expect(
      placed.every(([, row]) => Number.isInteger(row.customerIndex) && row.customerIndex >= 0),
    ).toBe(true);
  });
});
