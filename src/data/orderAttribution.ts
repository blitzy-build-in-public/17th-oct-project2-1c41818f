/**
 * Path: src/data/orderAttribution.ts
 * Purpose: Which seeded account owns each of the order history's sixty attributed orders, and where in the trailing window each of them falls
 * Lines: 90
 */

// Not a path the plan maps on its own: it is a §0.5.5 split of `src/data/orders.ts`, made under the plan's
// over-budget rule because that file's own concern — a history spanning two eras, with its volume curve, its
// planning and its order building — cannot be held inside the request's 600-line ceiling, and the ceiling is
// never raised. The concern moved here is the one part of that plan which is a hand-authored anchor table
// rather than generated shape: which of the seeded accounts own the sixty attributed orders and where each of
// them falls. Nothing but `src/data/orders.ts` imports this module, and nothing here knows of a basket, a
// status or a store.

import type { OrderStatus } from "@/types/commerce";
import { sum } from "@/utils/collections";

/** How many of the trailing window's orders belong to a seeded account. The rest of that window, and every
 *  order of the earlier era which precedes it, are placed by guests, which keeps a year of a real shop's
 *  revenue in the totals rather than forty customers' worth of shopping. */
const ATTRIBUTED_ORDER_TOTAL = 60;

/** The accounts the attributed orders belong to: each entry is a position in `CUSTOMERS` and how many orders it holds,
 *  spread through the trailing window by {@link planAttribution}. Sixteen of the forty accounts own no order at all. */
const ATTRIBUTION_PLAN: readonly (readonly [customerIndex: number, orders: number])[] = [
  [1, 5],
  [0, 2],
  [3, 4],
  [4, 3],
  [5, 4],
  [6, 3],
  [7, 3],
  [8, 4],
  [9, 3],
  [10, 3],
  [11, 2],
  [12, 3],
  [13, 2],
  [14, 2],
  [15, 2],
  [16, 2],
  [17, 2],
  [18, 2],
  [19, 2],
  [20, 2],
  [21, 2],
  [22, 1],
  [23, 1],
  [24, 1],
];

/** The account whose earliest attributed order is forced into `cancelled`, because the order history's status
 *  filter needs more than the settled statuses to select. Not the shopper, whose history is kept clear of
 *  cancellation so it can also reach an empty status-filtered result. */
const CANCELLED_HISTORY_CUSTOMER_INDEX = 3;

/** One attributed order: the account it belongs to and, for the single order the plan forces, its status. */
export type Attribution = {
  readonly customerIndex: number;
  readonly forcedStatus: OrderStatus | null;
};

/** Places the attributed orders in the history. Each entry of the plan is walked once per order it holds, so an account
 *  with five orders has them spread through the year rather than five in a row in one month, and the sixty slots fall evenly. */
export function planAttribution(orderTotal: number): ReadonlyMap<number, Attribution> {
  const shares = ATTRIBUTION_PLAN.map((share) => share[1]);
  if (sum(shares) !== ATTRIBUTED_ORDER_TOTAL) {
    throw new Error("The attribution plan does not hold the sixty orders it claims.");
  }
  const customers: number[] = [];
  for (let round = 0; round < Math.max(...shares); round += 1) {
    for (const [customerIndex, orders] of ATTRIBUTION_PLAN) {
      if (orders > round) customers.push(customerIndex);
    }
  }
  const spacing = orderTotal / ATTRIBUTED_ORDER_TOTAL;
  const cancellationAt = customers.indexOf(CANCELLED_HISTORY_CUSTOMER_INDEX);
  const attribution = new Map<number, Attribution>();
  customers.forEach((customerIndex, position) => {
    const slot = Math.floor((position + 0.5) * spacing);
    attribution.set(slot, {
      customerIndex,
      forcedStatus: position === cancellationAt ? "cancelled" : null,
    });
  });
  if (attribution.size !== ATTRIBUTED_ORDER_TOTAL) {
    throw new Error("Two attributed orders were given the same slot in the history.");
  }
  return attribution;
}
