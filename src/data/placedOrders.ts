/**
 * Path: src/data/placedOrders.ts
 * Purpose: The orders this browser created, held as durable state and read back into a store a document builds
 * Lines: 156
 */

import { STORAGE_KEYS } from "@/constants/config";
import { ORDER_STATUS_OPTIONS } from "@/constants/taxonomy";
import { purchaseKey, type DataStore } from "@/data/collectionStore";
import type { CustomerId } from "@/types/common";
import type { Order } from "@/types/commerce";
import { sortByIso, startOfDay } from "@/utils/dates";
import { readStored, writeStored } from "@/utils/storage";

// The orders this browser created -------------------------------------------------------------------
// An order a submission creates exists nowhere but the store the request was answered from: the seeded
// history is rebuilt from `src/data/orders.ts` every time a document loads, and it holds only what its
// generator plans. So the orders this browser created are durable state of their own, owned here and
// written through the storage util: written at the one point an order is created, read back at the one
// point a source is built, and re-inserted into that store, which is what lets the confirmation route a
// visitor reloads into — and the account's own history — answer the order again instead of refusing a
// buyer their own order. Seeded orders are deliberately never written: their generator rebuilds them
// identically, so storing them would be a second copy of the same history.

/** How many created orders are kept, newest first: the confirmation of a recent order reopens after a
 * reload, while a browser that places order after order cannot grow the payload without bound. */
const KEPT_PLACED_ORDERS = 20;

/** Whether a value read back is one order record: every member the type declares, read as the kind of
 * value that member is, with a status from the vocabulary `src/constants/taxonomy.ts` declares. Content
 * this build cannot describe is discarded rather than handed to a store as an order, because a restored
 * record is served from `getOrder`, listed in an account's history and grouped per customer — a member of
 * the wrong kind would break those reads rather than merely render oddly. */
function isStoredOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly [member: string]: unknown };
  const customerId = candidate.customerId;
  const status = candidate.status;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.orderNumber === "string" &&
    (customerId === null || typeof customerId === "string") &&
    typeof candidate.email === "string" &&
    typeof status === "string" &&
    ORDER_STATUS_OPTIONS.some((option) => option.value === status) &&
    Array.isArray(candidate.lines) &&
    isRecord(candidate.shippingAddress) &&
    isRecord(candidate.billingAddress) &&
    typeof candidate.shippingMethodId === "string" &&
    isRecord(candidate.payment) &&
    isRecord(candidate.pricedCart) &&
    typeof candidate.placedAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.statusHistory) &&
    typeof candidate.idempotencyKey === "string"
  );
}

/** Whether a value is a record of some shape: what the address, payment and priced-cart members of an
 * order are read as here, because the reads this module restores for serve the order whole rather than
 * reading a member of it. */
function isRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/** Whether a payload read back is the record this module writes: an array whose every entry is an order
 * record. One that fails this is discarded whole, because a partly readable record cannot be told from
 * one this build never wrote. */
function isPlacedOrderList(value: unknown): value is readonly Order[] {
  if (!Array.isArray(value)) return false;
  return (value as readonly unknown[]).every((entry) => isStoredOrder(entry));
}

/** The orders this browser created, newest first: an empty list when nothing is stored, the store cannot
 * be reached, or the payload fails its guard. */
function storedPlacedOrders(): readonly Order[] {
  return readStored<readonly Order[]>(STORAGE_KEYS.PLACED_ORDERS, [], isPlacedOrderList);
}

/**
 * Remembers an order this browser created, so a later document reads it back rather than losing it with
 * the document that placed it.
 *
 * The record is the order as it was created — its identifier, its number, the instant it was placed, its
 * status and its whole status history — because the confirmation prints those and no seed can rebuild
 * them. An order already stored replaces its entry rather than repeating it, the list stays newest first,
 * and the oldest order beyond {@link KEPT_PLACED_ORDERS} is dropped. A refused write is tolerated
 * silently, exactly as every other caller of `writeStored` tolerates it: the order is placed either way,
 * and only its survival past this document depends on the write.
 *
 * @param order - The order the submission created.
 */
export function rememberPlacedOrder(order: Order): void {
  const kept = storedPlacedOrders().filter((placed) => placed.id !== order.id);
  const records: readonly Order[] = [order, ...kept].slice(0, KEPT_PLACED_ORDERS);
  writeStored<readonly Order[]>(STORAGE_KEYS.PLACED_ORDERS, records);
}

/** The number an identifier or a reference ends in: the index `src/utils/strings.ts` wrote as an
 * identifier's suffix, or the position within its day `src/utils/orderRules.ts` wrote into a reference's.
 * Both are read off the record's own text, so a restored order states where it sits without a member
 * stored beside it solely to say so, and text ending in no digits at all — a record this build did not
 * write — counts as a first. */
function trailingNumber(text: string): number {
  const digits = /(\d+)$/.exec(text);
  return digits === null ? 0 : Number(digits[0]);
}

/**
 * Reads the orders this browser created back into a store a document has just built: what the
 * confirmation route, the account's order history and one order's detail all rest on after a reload.
 *
 * Each record is re-inserted as it was written and never rebuilt from the seeds, so a restored order keeps
 * its own identifier, its order number, the instant it was placed, its status and its whole status
 * history. What the store holds beside the collection is restated with it — the identifier index, the
 * per-customer grouping an account's history lists from, the verified-purchase index for an order that
 * names an account, and the collection's own newest-first order — so a read by identifier, a read of one
 * account's history and a read of the whole collection agree with each other and with the document that
 * placed the order.
 *
 * The two counters a later submission numbers itself by are lifted above the restored records:
 * `nextOrderIndex` past every restored identifier, and each day's count to at least the position the
 * restored order's own reference states, so the next order placed can neither collide with a restored
 * order's identifier nor reuse the number of an order the history already holds.
 *
 * @param store - The store a document built, holding the seeded collections and no created order.
 */
export function restorePlacedOrders(store: DataStore): void {
  const restored = storedPlacedOrders().filter((order) => !store.orderById.has(order.id));
  if (restored.length === 0) return;
  // The collection is the history a page lists and the source every aggregate reads, so the restored
  // orders are woven into it rather than appended: it stays newest first, as `createStore` built it.
  const merged = sortByIso([...store.orders, ...restored], (order) => order.placedAt, "desc");
  store.orders.length = 0;
  store.orders.push(...merged);
  // Each account's own history is the collection filtered to it, so the group is restated from the merged
  // collection instead of from the rows the seeds grouped: a created order leads the history it belongs to.
  const owners = new Set<CustomerId>();
  for (const order of restored) {
    store.orderById.set(order.id, order);
    const owner = order.customerId;
    if (owner !== null) owners.add(owner);
    store.nextOrderIndex = Math.max(store.nextOrderIndex, trailingNumber(order.id) + 1);
    const day = startOfDay(order.placedAt);
    const position = trailingNumber(order.orderNumber);
    store.orderSequenceByDay.set(day, Math.max(store.orderSequenceByDay.get(day) ?? 0, position));
  }
  for (const owner of owners) {
    const rows = merged.filter((order) => order.customerId === owner);
    store.ordersByCustomer.set(owner, rows);
    for (const order of rows) {
      for (const line of order.lines)
        store.verifiedPurchases.add(purchaseKey(owner, line.productId));
    }
  }
}
