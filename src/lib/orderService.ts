/**
 * Path: src/lib/orderService.ts
 * Purpose: Builds orders from a cart snapshot, numbers them and applies the status transitions
 * Lines: 593
 */

import { DEFAULT_PAGE_SIZE } from "@/constants/config";
import { VALIDATION_MESSAGES } from "@/constants/content";
import type { Address } from "@/types/account";
import type {
  CreateOrderRequest,
  Order,
  OrderHistoryQuery,
  OrderLine,
  OrderStatus,
  OrderStatusHistoryEntry,
  PaymentInput,
  PricedCart,
  PricedCartLine,
} from "@/types/commerce";
import type {
  ApiError,
  FieldErrors,
  IsoDateTimeString,
  MinorUnits,
  OrderId,
  PageResult,
  QueryParams,
  Result,
} from "@/types/common";
import { parseIso, toIsoDate } from "@/utils/dates";
import { prefixedId } from "@/utils/strings";
import {
  FORM_ERROR_KEY,
  firstError,
  hasErrors,
  mergeErrors,
  validatePayment,
  validateShippingSubmission,
} from "@/utils/validation";

import { getJson, postJson } from "@/lib/apiClient";

// The orders endpoints ---------------------------------------------------------------------------

/** The orders collection: the path a submission is posted to and the one a customer's own history is
 * read from. The in-process seam owns the route table, so this module names the path it calls and
 * neither imports the other. */
const ORDERS_PATH = "/api/orders";

/** The status a submission this module refuses answers with: the seam's own validation failure, `422`. */
const VALIDATION_FAILED_STATUS = 422;

/** The code such a refusal carries — the seam's stable reason for a body that broke a field rule.
 * Spelled here rather than imported, so this module depends on the contract's meaning and not on the
 * transport's internals. */
const VALIDATION_FAILED_CODE = "validation-failed";

/** The page an order history request asks for when its caller names no query of its own. */
const DEFAULT_ORDER_HISTORY: OrderHistoryQuery = { page: 1, pageSize: DEFAULT_PAGE_SIZE };

// What a caller passes beside a request ----------------------------------------------------------

/**
 * What every method here may be handed beside its own arguments.
 *
 * `sessionToken` comes from the signed-in session: it is what marks a submission as a customer's rather
 * than a guest's, and what makes the two account endpoints answer at all — without it `GET /api/orders`
 * and `GET /api/orders/:id` are refused with `401`, because the orders they hand back belong to whoever
 * the token authenticates. `signal` cancels a request a newer one supersedes, so a page that navigates
 * away mid-request leaves nothing queued behind it.
 */
export interface OrderServiceOptions {
  readonly sessionToken?: string;
  readonly signal?: AbortSignal;
}

/**
 * Everything a submission needs beside the snapshot: the contact email, the two address snapshots, the
 * delivery method and the payment.
 *
 * Gathering them in one shape is what lets {@link buildOrderInput} write the request body once. Both
 * addresses travel as snapshots rather than as references to the address book, and the card is read at
 * the seam and discarded, so nothing here outlives the request that carried it.
 */
export interface OrderContact {
  readonly email: string;
  readonly shippingAddress: Address;
  readonly billingAddress: Address;
  readonly shippingMethodId: string;
  readonly payment: PaymentInput;
}

// Keys and numbers -------------------------------------------------------------------------------

/** How many keys this module has minted, so two attempts inside the same millisecond still differ: the
 * only state here, holding no domain data at all, and needed because a suite runs on frozen timers where
 * the instant below never advances. */
let mintedKeys = 0;

/**
 * Mints the key one checkout attempt is submitted under.
 *
 * One key per attempt rather than per click: a retry after a failure sends the same key, so an attempt
 * that did reach the seam replays the order it created instead of placing a second. The prefix is the
 * order prefix and the suffix reads as what it is, so a stored order's key says which placement it came
 * from.
 *
 * Two keys cannot collide — the instant separates attempts made in different milliseconds and the
 * counter below separates attempts made in the same one — and no randomness is used, so a failed case
 * stays reproducible.
 *
 * @returns A fresh idempotency key, prefixed `ord_`.
 */
export function createIdempotencyKey(): string {
  mintedKeys += 1;
  return prefixedId("ord", `attempt ${Date.now().toString(36)} ${String(mintedKeys)}`);
}

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

// The totals a placed order keeps -----------------------------------------------------------------

/** The five amounts an order is read for, named as the priced cart names them, so a surface can hold
 * the totals without holding the lines. */
export interface OrderTotalsSummary {
  readonly subtotalMinor: MinorUnits;
  readonly discountTotalMinor: MinorUnits;
  readonly shippingMinor: MinorUnits;
  readonly taxMinor: MinorUnits;
  readonly grandTotalMinor: MinorUnits;
}

/**
 * Reads the amounts a placed order stands at, without recomputing any of them.
 *
 * Every figure comes from the priced cart the order keeps, which `src/lib/pricingService.ts` computed
 * once at the moment the order was placed. That is what makes a total stable — a later price, tax rate
 * or shipping charge cannot move a number already written down — and why nothing is multiplied, applied
 * or rounded here: a surface that added the totals up itself would be a second implementation of the
 * arithmetic, which is how two screens come to disagree about what an order cost.
 *
 * @param order - The order to summarise.
 * @returns The order's subtotal, discount, shipping, tax and grand total, in minor units.
 */
export function summariseOrderTotals(order: Order): OrderTotalsSummary {
  const { subtotalMinor, discountTotalMinor, shippingMinor, taxMinor, grandTotalMinor } =
    order.pricedCart;
  return { subtotalMinor, discountTotalMinor, shippingMinor, taxMinor, grandTotalMinor };
}

// The submission guard ---------------------------------------------------------------------------

/** What a checkout tracks about the attempt it is making: whether one is in flight, and the key the
 * tracked attempt was submitted under, so a caller can tell a retry (`lastKey` equal to the key it
 * holds) from a new attempt. It is `undefined` before the first submission. */
export interface OrderSubmitGuardState {
  readonly submitting: boolean;
  readonly lastKey: string | undefined;
}

/**
 * Whether a submission may begin: the client-side half of the guard against placing an order twice.
 *
 * It refuses a submission already in flight and a key with nothing in it. What it deliberately does not
 * refuse is a repeat of the tracked attempt's key: that is a retry, and the checkout keeps its key across
 * a failed attempt precisely so an attempt that did reach the seam replays the order it created rather
 * than placing a second — refusing it here would strand a buyer whose order was already recorded.
 *
 * A guard is not the control, which is what its name says: it shortens the window in which a second
 * submission can be attempted, while the idempotency key is what makes a repeat harmless if one is
 * attempted anyway. The seam holds the key's outcome; this module mints the key and asks whether the
 * attempt may start.
 *
 * @param previous - What the checkout tracks about the attempt behind this one.
 * @param idempotencyKey - The key this submission would be sent under.
 * @returns Whether the submission may begin.
 */
export function canSubmitOrder(previous: OrderSubmitGuardState, idempotencyKey: string): boolean {
  if (previous.submitting) {
    return false;
  }
  return idempotencyKey.trim() !== "";
}

// Assembling a submission ------------------------------------------------------------------------

/**
 * Assembles the body of an order submission from the snapshot the buyer reviewed and the details the
 * checkout collected, so the shape of the request is written once and cannot drift from the endpoint
 * that reads it.
 *
 * Nothing is recomputed and nothing is re-read: the snapshot is the cart as it was priced for review,
 * and both addresses are the values that were submitted, so a placed order cannot inherit a change made
 * to the cart, the catalogue or the address book afterwards.
 *
 * @param snapshot - The priced cart the buyer reviewed.
 * @param contact - The address, contact, delivery and payment details the checkout collected.
 * @param idempotencyKey - The key the attempt is submitted under, from {@link createIdempotencyKey}.
 * @returns The request body, ready to hand to {@link createOrder}.
 */
export function buildOrderInput(
  snapshot: PricedCart,
  contact: OrderContact,
  idempotencyKey: string,
): CreateOrderRequest {
  return {
    snapshot,
    email: contact.email,
    shippingAddress: contact.shippingAddress,
    billingAddress: contact.billingAddress,
    shippingMethodId: contact.shippingMethodId,
    payment: contact.payment,
    idempotencyKey,
  };
}

// Refusing a submission before it is sent --------------------------------------------------------

/** The rules a submission is judged by before it is sent: the shipping step's address, contact email
 * and delivery method, the payment, a snapshot holding lines, and a key to submit under. These are the
 * rules the seam runs over the body it receives, applied early so a buyer is told about a broken field
 * without a request being made; the seam re-runs them and remains the authority. */
function submissionErrors(input: CreateOrderRequest): FieldErrors {
  return mergeErrors(
    validateShippingSubmission({
      address: input.shippingAddress,
      email: input.email,
      shippingMethodId: input.shippingMethodId,
    }),
    validatePayment(input.payment),
    holdsAnOrder(input.snapshot) ? {} : { snapshot: VALIDATION_MESSAGES.REQUIRED },
    input.idempotencyKey.trim() === "" ? { idempotencyKey: VALIDATION_MESSAGES.REQUIRED } : {},
  );
}

/** Whether a submission carries a snapshot an order can be built from: a priced cart holding at least
 * one line, which is also the shape the seam refuses to build an order without. */
function holdsAnOrder(snapshot: PricedCart): boolean {
  const lines: unknown = snapshot?.lines;
  return Array.isArray(lines) && lines.length > 0;
}

/** The failure a submission this module refuses answers with, shaped as the seam shapes the same
 * refusal: `422`, the stable code for a body that broke a field rule, the first broken field's message
 * and the name of the control it belongs to. */
function refusedSubmission(errors: FieldErrors): Result<never> {
  const error: ApiError = {
    status: VALIDATION_FAILED_STATUS,
    code: VALIDATION_FAILED_CODE,
    message: firstError(errors) ?? VALIDATION_MESSAGES.REQUIRED,
    field: Object.keys(errors)[0] ?? FORM_ERROR_KEY,
  };
  return { ok: false, error };
}

// The client -------------------------------------------------------------------------------------

/**
 * Places the order a submission describes and returns the order that was created.
 *
 * Three things it deliberately does not do. It does not re-read or re-price the cart, because the
 * snapshot was taken before completion and an order records what the buyer reviewed. It does not decide
 * who the order belongs to, because the seam takes the owner from the session the request carries — so a
 * signed-in buyer's order lands in their history and a guest's is placed without an account. And it does
 * not build the key, which {@link createIdempotencyKey} mints per attempt and a retry sends unchanged.
 *
 * Every outcome is a value: `402` for a declined demonstration card, `409` for a key repeated with a
 * different body, `422` naming the offending control in `field` for a body that broke a field rule, and
 * the existing order for an identical repeat of a key that already placed one.
 *
 * @param input - The submission, assembled by {@link buildOrderInput}.
 * @param options - The session token and abort signal, if the caller holds any.
 * @returns The placed order, or the shaped failure; never a rejection.
 */
export async function createOrder(
  input: CreateOrderRequest,
  options: OrderServiceOptions = {},
): Promise<Result<Order>> {
  const errors = submissionErrors(input);
  if (hasErrors(errors)) {
    return refusedSubmission(errors);
  }
  return postJson<Order, CreateOrderRequest>(ORDERS_PATH, input, {
    sessionToken: options.sessionToken,
    signal: options.signal,
  });
}

/**
 * Reads one order by its identifier, for the confirmation route and the account's order detail.
 *
 * Both callers are reload-safe because of this call: the confirmation knows only the identifier in its
 * path, so an order is fetched rather than remembered from the flow that placed it. Ownership is decided
 * by the seam against the session the request carries, never here and never by an argument — an order
 * belonging to another customer and an identifier no order holds both answer `404`, deliberately the
 * same answer, so a response cannot be read to learn which orders exist.
 *
 * @param id - The order's identifier, prefixed `ord_`.
 * @param options - The session token, without which the endpoint answers `401`.
 * @returns The order, or the shaped failure; never a rejection.
 */
export async function getOrder(
  id: OrderId,
  options: OrderServiceOptions = {},
): Promise<Result<Order>> {
  return getJson<Order>(orderDetailPath(id), {
    sessionToken: options.sessionToken,
    signal: options.signal,
  });
}

/**
 * Reads one page of the signed-in customer's own order history.
 *
 * The endpoint takes no customer id and this function never sends one: the seam scopes the query to the
 * customer its session token authenticates, so no argument a caller could change reaches another
 * customer's orders. The filters are the ones the history screen offers — one status, and an inclusive
 * window on when the order was placed — and either end of the window on its own is refused by the seam,
 * because a half-given range is not a range.
 *
 * @param history - The page and filters; the first page at the configured width when omitted.
 * @param options - The session token, without which the endpoint answers `401`.
 * @returns One page of the customer's orders, or the shaped failure; never a rejection.
 */
export async function listOrders(
  history: OrderHistoryQuery = DEFAULT_ORDER_HISTORY,
  options: OrderServiceOptions = {},
): Promise<Result<PageResult<Order>>> {
  return getJson<PageResult<Order>>(ORDERS_PATH, {
    query: historyQueryParams(history),
    sessionToken: options.sessionToken,
    signal: options.signal,
  });
}

/** The path of one order: the collection's path with the identifier appended, encoded as the route
 * builders in `src/constants/routes.ts` encode a path segment. */
function orderDetailPath(id: OrderId): string {
  return `${ORDERS_PATH}/${encodeURIComponent(id)}`;
}

/** The history's query string: the page and each filter a caller named, with an unset one left out. */
function historyQueryParams(history: OrderHistoryQuery): QueryParams {
  return {
    page: history.page,
    pageSize: history.pageSize,
    status: optionalText(history.status),
    from: optionalText(history.from),
    to: optionalText(history.to),
  };
}

/** A filter as a query parameter: blank and whitespace-only text is no filter at all, rather than a
 * value the endpoint would refuse. */
function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  return text === "" ? undefined : text;
}
