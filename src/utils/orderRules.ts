/**
 * Path: src/utils/orderRules.ts
 * Purpose: The order rules the checkout and the account read and the seeded repositories compose: order numbering, snapshot construction and the status transitions
 * Lines: 275
 */

import type { IsoDateTimeString } from "@/types/common";
import type {
  Order,
  OrderLine,
  OrderStatus,
  OrderStatusHistoryEntry,
  PricedCart,
  PricedCartLine,
} from "@/types/commerce";
import { parseIso, toIsoDate } from "@/utils/dates";

// Keys and numbers -------------------------------------------------------------------------------

/** The letters every order number opens with, so a reference is recognisable as one at a glance. */
const ORDER_NUMBER_PREFIX = "SP";

/** The digits the sequence is padded to, so the numbers of one day read in the order they were placed. */
const ORDER_NUMBER_SEQUENCE_DIGITS = 4;

/**
 * Builds the human-readable reference an order is known by: `SP-YYMMDD-NNNN`.
 *
 * The two halves answer the two questions a reference is read for — the day it was placed (`251015` for
 * 15 October 2025, derived from `placedAt` through `src/utils/dates.ts` so the number agrees with the
 * date the confirmation and the order history print beside it) and which order of that day it was. This
 * is the only place the format exists: a component renders the number an order carries rather than
 * building one of its own.
 *
 * Deterministic in both arguments, so a seed, a fixture and a test derive the same reference from the
 * same pair, and a sequence below one or a fractional one numbers a first order rather than producing a
 * number no order could hold.
 *
 * @param sequence - The order's position in the collection it was placed into, counting from one.
 * @param placedAt - The ISO 8601 date-time the order was placed at.
 * @returns The order number.
 * @throws TypeError - When `placedAt` is not a date-time this product can parse, because a number built
 * from a date that could not be read would be wrong rather than merely unreadable.
 */
export function orderNumber(sequence: number, placedAt: IsoDateTimeString): string {
  const placedOn = parseIso(placedAt);
  if (placedOn === null) {
    throw new TypeError(`orderNumber needs an ISO 8601 date-time, received "${placedAt}".`);
  }
  const digits = String(wholeCount(sequence)).padStart(ORDER_NUMBER_SEQUENCE_DIGITS, "0");
  return `${ORDER_NUMBER_PREFIX}-${compactDate(toIsoDate(placedOn))}-${digits}`;
}

/** The month and day of a `YYYY-MM-DD` date with the century dropped, which is all the number needs. */
function compactDate(isoDate: string): string {
  return `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`;
}

/** A whole count of one or more: a fractional, negative or non-finite one counts as a first. */
function wholeCount(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1;
}

// The snapshot an order is built from ------------------------------------------------------------

/**
 * Turns the priced cart a buyer reviewed into the immutable lines a placed order keeps.
 *
 * This is the snapshot point, and the reason an order never changes its mind: each line copies the
 * name, the sku, the unit price and the total that price produced at the moment of purchase, so a later
 * rename, price change or withdrawal in the catalogue cannot rewrite what a placed order says it was or
 * what it cost. Nothing reads the catalogue again here, and nothing returns to the live pricing data
 * afterwards. The line keeps the identifier its cart line had and the product it names, which is what
 * makes product performance computable from the order collection later on.
 *
 * @param priced - The priced cart the buyer submitted, as `src/lib/pricingService.ts` returned it.
 * @returns The order lines in the order the buyer assembled them; read-only, because a snapshot that
 * could be edited would not be one.
 */
export function toOrderLines(priced: PricedCart): readonly OrderLine[] {
  return priced.lines.map(toOrderLine);
}

/** One snapshot line: the priced cart line's quantities and amounts under the order's member names. */
function toOrderLine(line: PricedCartLine): OrderLine {
  return {
    id: line.id,
    productId: line.productId,
    productName: line.name,
    sku: line.sku,
    unitPriceMinor: line.unitPriceMinor,
    quantity: line.quantity,
    lineTotalMinor: line.lineTotalMinor,
    imageUrl: line.imageUrl,
  };
}

// The status vocabulary and its transitions ------------------------------------------------------

/** The statuses whose trade came back, so no figure is left to state: a `cancelled` order's lines were
 *  voided before they went anywhere, and a `refunded` order's money was returned after they did. */
const GIVEN_BACK_STATUSES: readonly OrderStatus[] = ["cancelled", "refunded"];

/**
 * Reports whether an order's trade came back, which is what decides whether a period's figures state it.
 *
 * A cancelled order's lines were voided and a refunded order's money was returned, so neither is trade a
 * period can count. The daily fact table removes the whole net of an order this reports `true` for, states
 * none of its units and attributes none of its count to a row, and the one order population every dashboard
 * and report figure is stated over — `periodOrders` in `src/utils/statistics.ts` — keeps the orders it
 * reports `false` for. This is the single home of that rule, which is why the reduction's refund column and
 * the population the reports count cannot come to different conclusions about which orders still stand.
 *
 * @param status - The status an order holds.
 * @returns Whether the order's goods were voided or its money returned, so none of it is trade.
 */
export function isGivenBack(status: OrderStatus): boolean {
  return GIVEN_BACK_STATUSES.includes(status);
}

/** Every event that moves an order on, one home each, so nothing in the product spells one by hand. A
 * `const` object rather than an `enum`, which `erasableSyntaxOnly` forbids; {@link OrderStatusEvent} is
 * derived from it, so the two cannot drift. */
export const ORDER_STATUS_EVENTS = {
  /** The order is accepted and payment is authorised: `pending` becomes `confirmed`. */
  CONFIRM: "confirm",
  START_PROCESSING: "start-processing",
  SHIP: "ship",
  DELIVER: "deliver",
  /** The order is called off before it was dispatched, from any status that still allows it. */
  CANCEL: "cancel",
  /** The money goes back. No workflow in this product triggers this one: `refunded` is carried as data
   * and as a label, and nothing issues a refund. */
  REFUND: "refund",
} as const;

/** One event that can move an order on, derived from {@link ORDER_STATUS_EVENTS}. */
export type OrderStatusEvent = (typeof ORDER_STATUS_EVENTS)[keyof typeof ORDER_STATUS_EVENTS];

/** The status each event aims at, before the transition table decides whether it may be reached. */
const EVENT_TARGETS: Readonly<Record<OrderStatusEvent, OrderStatus>> = {
  [ORDER_STATUS_EVENTS.CONFIRM]: "confirmed",
  [ORDER_STATUS_EVENTS.START_PROCESSING]: "processing",
  [ORDER_STATUS_EVENTS.SHIP]: "shipped",
  [ORDER_STATUS_EVENTS.DELIVER]: "delivered",
  [ORDER_STATUS_EVENTS.CANCEL]: "cancelled",
  [ORDER_STATUS_EVENTS.REFUND]: "refunded",
};

/**
 * Where an order may go from where it stands — the whole of the product's status rule, stated once as
 * data so {@link canTransition} and {@link nextStatus} cannot disagree about it.
 *
 * An order walks forward through confirmation, picking, dispatch and delivery; it can be cancelled from
 * any status that has not yet been dispatched, because calling off a parcel already on its way is a
 * return rather than a cancellation and returns are out of scope; and it can be refunded once the goods
 * are settled — delivered or cancelled. `refunded` is terminal, because no workflow in this product
 * moves an order out of it. The type is exhaustive over `OrderStatus`, so a status added to the union
 * fails to compile here rather than slipping through unhandled.
 */
const STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
};

/**
 * Reports whether an order standing at `from` may move to `to`: the question a surface asks before it
 * offers an action. A status is never a move from itself, because re-recording where an order already
 * stands is not a transition — which keeps a history free of entries that report no change.
 *
 * @param from - The status the order holds now.
 * @param to - The status being asked about.
 * @returns Whether the move is one an order may make.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STATUS_TRANSITIONS[from].some((status) => status === to);
}

/**
 * Applies one event to the status an order holds: the product's only status-transition rule, so every
 * surface that moves an order on reaches one implementation rather than its own idea of what may follow
 * what.
 *
 * An event that does not apply leaves the order where it is rather than failing — an order already
 * shipped cannot be cancelled, and one already refunded cannot be refunded again — so the result is the
 * status it came in with. A caller that needs to know beforehand asks {@link canTransition} about the
 * event's target, and one that needs to record the move appends it with {@link appendStatusHistory},
 * which applies the same rule.
 *
 * @param current - The status the order holds now.
 * @param event - The event that happened.
 * @returns The status the order holds afterwards, which is `current` when the event does not apply.
 */
export function nextStatus(current: OrderStatus, event: OrderStatusEvent): OrderStatus {
  switch (event) {
    case ORDER_STATUS_EVENTS.CONFIRM:
      return move(current, EVENT_TARGETS[ORDER_STATUS_EVENTS.CONFIRM]);
    case ORDER_STATUS_EVENTS.START_PROCESSING:
      return move(current, EVENT_TARGETS[ORDER_STATUS_EVENTS.START_PROCESSING]);
    case ORDER_STATUS_EVENTS.SHIP:
      return move(current, EVENT_TARGETS[ORDER_STATUS_EVENTS.SHIP]);
    case ORDER_STATUS_EVENTS.DELIVER:
      return move(current, EVENT_TARGETS[ORDER_STATUS_EVENTS.DELIVER]);
    case ORDER_STATUS_EVENTS.CANCEL:
      return move(current, EVENT_TARGETS[ORDER_STATUS_EVENTS.CANCEL]);
    case ORDER_STATUS_EVENTS.REFUND:
      return move(current, EVENT_TARGETS[ORDER_STATUS_EVENTS.REFUND]);
    default:
      return unreachableEvent(event);
  }
}

/** The status an event's target is reached with when the move is legal, and the one already held when
 * it is not. */
function move(current: OrderStatus, target: OrderStatus): OrderStatus {
  return canTransition(current, target) ? target : current;
}

/** Proof at compile time that every event was handled: an event added to the vocabulary fails to
 * type-check here rather than falling through unhandled. */
function unreachableEvent(event: never): never {
  throw new Error(`Unhandled order status event: ${JSON.stringify(event)}`);
}

/**
 * Records a status on an order: the entry the order detail renders as its timeline, plus the order
 * updated to stand at that status.
 *
 * Two things may be recorded and nothing else. The first is the order's own opening status — the entry a
 * freshly placed order carries, which is where it starts rather than a move from anywhere and is
 * therefore accepted exactly once. The second is a status it may legally move to, judged by the same
 * table {@link nextStatus} applies, so a caller that skips the rule cannot write an impossible timeline.
 * Anything else returns the order unchanged, which a caller sees by comparing references.
 *
 * The order is never mutated: the result is a new order with the entry appended, the status advanced and
 * `updatedAt` set to the instant it moved, and anything still holding the earlier order keeps it.
 *
 * @param order - The order to record against, left untouched.
 * @param status - The status being recorded.
 * @param at - The ISO 8601 instant the order reached it.
 * @param note - A short explanation for a step worth explaining, omitted when blank.
 * @returns A new order standing at `status`, or `order` itself when the status may not be recorded.
 */
export function appendStatusHistory(
  order: Order,
  status: OrderStatus,
  at: IsoDateTimeString,
  note?: string,
): Order {
  if (!recordsStatus(order, status)) {
    return order;
  }
  const entry: OrderStatusHistoryEntry =
    note === undefined || note.trim() === "" ? { status, at } : { status, at, note };
  return {
    ...order,
    status,
    updatedAt: at,
    statusHistory: [...order.statusHistory, entry],
  };
}

/** Whether a status may be written onto an order: its own status once, as the opening entry, and any
 * status it may legally move to from there. */
function recordsStatus(order: Order, status: OrderStatus): boolean {
  if (status === order.status) {
    return !order.statusHistory.some((entry) => entry.status === status);
  }
  return canTransition(order.status, status);
}
