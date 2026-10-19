/**
 * Path: src/lib/orderService.ts
 * Purpose: Builds orders from a cart snapshot, numbers them, applies the status transitions and carries the placement credential of an account-less one
 * Lines: 389
 */

import { DEFAULT_PAGE_SIZE } from "@/constants/config";
import { VALIDATION_MESSAGES } from "@/constants/content";
import type { Address } from "@/types/account";
import type {
  CreateOrderRequest,
  Order,
  OrderHistoryQuery,
  PaymentInput,
  PricedCart,
} from "@/types/commerce";
import type {
  FieldErrors,
  MinorUnits,
  OrderId,
  PageResult,
  QueryParams,
  Result,
} from "@/types/common";
import { placementToken, prefixedId } from "@/utils/strings";
import {
  FORM_ERROR_KEY,
  firstError,
  hasErrors,
  mergeErrors,
  validatePayment,
  validateShippingSubmission,
} from "@/utils/validation";

import {
  API_ERROR_CODES,
  API_PATHS,
  failure,
  fillApiPath,
  getJson,
  postJson,
} from "@/lib/apiClient";
import { placementTokenFor, rememberPlacement } from "@/utils/orderPlacements";

// The public surface -----------------------------------------------------------------------------
// The order rules this module is named for — the numbering, the snapshot construction and the status machine
// at the head of `src/utils/orderRules.ts` — live in the foundations layer, because the data module seeds
// the order history through them and a file may import only from its own layer or from a layer below it.
// Every name a consumer imports stays at this path.

export {
  ORDER_STATUS_EVENTS,
  appendStatusHistory,
  canTransition,
  nextStatus,
  orderNumber,
  toOrderLines,
} from "@/utils/orderRules";
export type { OrderStatusEvent } from "@/utils/orderRules";

// The orders client's fixed values -----------------------------------------------------------------

/** The page an order history request asks for when its caller names no query of its own. */
const DEFAULT_ORDER_HISTORY: OrderHistoryQuery = { page: 1, pageSize: DEFAULT_PAGE_SIZE };

// What a caller passes beside a request ----------------------------------------------------------

/**
 * What every method here may be handed beside its own arguments.
 *
 * `sessionToken` comes from the signed-in session: it marks a submission as a customer's rather than a
 * guest's, and `GET /api/orders` answers only with one, because the history it hands back belongs to
 * whoever the token authenticates. `GET /api/orders/:id` needs it for an order that names an account;
 * an account-less order is read with the credential this client remembers for it, which `orderToken`
 * overrides. A submission needs neither member: {@link createOrder} mints the placement credential the
 * attempt carries itself, and reads it back through this client rather than through an option. `signal`
 * cancels a request a newer one supersedes, so a page that navigates away mid-request leaves nothing
 * queued behind it.
 */
export interface OrderServiceOptions {
  readonly sessionToken?: string;
  /**
   * The order credential a read presents for an account-less order, overriding the one this client
   * remembers for it: what the seam compares when it decides whether the read may be answered, absent for
   * every caller that holds none.
   */
  readonly orderToken?: string;
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
 * This is an **idempotency key and nothing else**: it names one attempt, and the only thing it authorises
 * is the replay of the order that attempt created. It is deliberately readable — the order prefix, the
 * instant the attempt was made and its counter — because a stored order's key says which placement it came
 * from; a key is not a credential, and the credential a guest's confirmation is read with is the random
 * value {@link createOrder} mints for the attempt, never this.
 *
 * One key per attempt rather than per click: a retry after a failure sends the same key, so an attempt
 * that did reach the seam replays the order it created instead of placing a second.
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

/** The failure a submission this module refuses answers with, asked of the seam's own shaper: the
 * stable code for a body that broke a field rule, at the status the published vocabulary gives it, the
 * first broken field's message and the name of the control it belongs to. */
function refusedSubmission(errors: FieldErrors): Result<never> {
  const field = Object.keys(errors)[0] ?? FORM_ERROR_KEY;
  const message = firstError(errors) ?? VALIDATION_MESSAGES.REQUIRED;
  return failure(API_ERROR_CODES.VALIDATION_FAILED, message, field);
}

// The client -------------------------------------------------------------------------------------

/**
 * Places the order a submission describes and returns the order that was created.
 *
 * The snapshot and the idempotency key are two members of the request {@link buildOrderInput} assembles, so
 * the call takes that assembled request rather than a snapshot-and-key shorthand: the endpoint also requires
 * the contact email, both address snapshots, the delivery method and the payment, and the shorthand could
 * carry none of them.
 *
 * Four things it deliberately does not do. It does not re-read or re-price the cart, because the
 * snapshot was taken before completion and an order records what the buyer reviewed. It does not decide
 * who the order belongs to, because the seam takes the owner from the session the request carries — so a
 * signed-in buyer's order lands in their history and a guest's is placed without an account. It does not
 * build the key, which {@link createIdempotencyKey} mints per attempt and a retry sends unchanged. And it
 * keeps the placement credential out of the request body: the credential travels as the request's own
 * `orderToken`, so no order, payload or stored body ever carries it.
 *
 * The credential itself is minted here, one per attempt, by {@link placementToken} — sixteen random bytes
 * from the browser's own generator, which no reader of the key the attempt submits under can recompute.
 * Recording it is {@link rememberPlacement}'s decision: an order that names an account is read through its
 * session and is given no placement, and a replayed submission leaves the first credential recorded for the
 * order standing, so this client and the seam go on holding the same value.
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
  const orderToken = placementToken();
  const placed = await postJson<Order, CreateOrderRequest>(API_PATHS.ORDERS, input, {
    sessionToken: options.sessionToken,
    orderToken,
    signal: options.signal,
  });
  // The credential this browser holds for an account-less order it just placed, remembered under the order
  // it created, so a later read — the confirmation after a reload, most of all — can present it.
  if (placed.ok) {
    rememberPlacement(placed.value, orderToken);
  }
  return placed;
}

/**
 * Reads one order by its identifier, for the confirmation route and the account's order detail.
 *
 * Both callers are reload-safe because of this call: the confirmation knows only the identifier in its
 * path, so an order is fetched rather than remembered from the flow that placed it. Which credential
 * the read carries depends on the order. An order that names an account is read with `sessionToken`,
 * and one belonging to another customer and an identifier no order holds both answer `404`,
 * deliberately the same answer, so a response cannot be read to learn which orders exist. An
 * account-less order is read with the placement credential this client holds and remembers for it — the
 * random value the submission that created it minted — which is what lets a guest's confirmation reopen
 * after a reload; an explicit `orderToken` overrides the remembered one.
 *
 * @param id - The order's identifier, prefixed `ord_`.
 * @param options - The session token and the order credential, if the caller holds either.
 * @returns The order, or the shaped failure; never a rejection.
 */
export async function getOrder(
  id: OrderId,
  options: OrderServiceOptions = {},
): Promise<Result<Order>> {
  return getJson<Order>(fillApiPath(API_PATHS.ORDER_DETAIL, { id }), {
    sessionToken: options.sessionToken,
    orderToken: options.orderToken ?? placementTokenFor(id) ?? undefined,
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
  return getJson<PageResult<Order>>(API_PATHS.ORDERS, {
    query: historyQueryParams(history),
    sessionToken: options.sessionToken,
    signal: options.signal,
  });
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
