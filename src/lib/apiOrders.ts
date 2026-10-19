/**
 * Path: src/lib/apiOrders.ts
 * Purpose: The submission half of `POST /api/orders` — the demonstration card decision, the idempotency store, the placement credential and the reading of an order request.
 * Lines: 332
 */

import { paymentDeclinedNote } from "@/constants/checkoutCopy";
import { DEMO_CARD_NUMBERS } from "@/constants/config";
import { IDEMPOTENCY_CONFLICT_MESSAGE, VALIDATION_MESSAGES } from "@/constants/content";
import type * as Account from "@/types/account";
import type * as Commerce from "@/types/commerce";
import type * as Common from "@/types/common";
import { toIsoDateTime } from "@/utils/dates";
import { createCredentialDigest } from "@/utils/strings";
import {
  hasErrors,
  mergeErrors,
  validateAddress,
  validatePayment,
  validateShippingSubmission,
  type PaymentValidationInput,
} from "@/utils/validation";

import {
  API_ERROR_CODES,
  failure,
  ok,
  type OrderCreationRequest,
  type RouteContext,
} from "@/lib/apiContract";
import {
  clearPlacements,
  placementAdmitsCredential,
  placementFor,
  rememberPlacement,
} from "@/utils/orderPlacements";
import {
  invalidFields,
  isMembers,
  memberBoolean,
  memberObject,
  memberTextOrEmpty,
  memberValue,
  readAddressInput,
  readOrderSnapshot,
  readPaymentInput,
  type RequestMembers,
} from "@/lib/apiRequests";

// Settling a payment and remembering an order ----------------------------------------------------

/** The card brand a demonstration payment is recorded as, read from the number's leading digits, or a
 * plain `"Card"` for a scheme the demonstration does not recognise. */
function cardBrand(digits: string): string {
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (digits.startsWith("6")) return "Discover";
  return "Card";
}

/**
 * The payment an order records, decided here and not by the store: the number is read, validated and
 * reduced to its brand, its last four digits and a decision, so no number reaches the data module, an
 * order or a payload. One configured number is declined, and the refusal says so in its own words —
 * nothing was ordered, and which demonstration number is approved — rather than repeating the payment
 * step's notice; every other card that passed the payment rules is authorised, and an invoice is
 * recorded as accepted with no card and no authorisation instant, because nothing authorised anything.
 */
function settlePayment(payment: PaymentValidationInput): Common.Result<Commerce.PaymentSummary> {
  if (payment.method !== "card") {
    return ok({
      method: "invoice",
      status: "authorised",
      brand: null,
      last4: null,
      authorisedAt: null,
    });
  }
  const digits = (payment.card?.number ?? "").replace(/\D/g, "");
  if (digits === DEMO_CARD_NUMBERS.DECLINED) {
    return failure(
      API_ERROR_CODES.PAYMENT_DECLINED,
      paymentDeclinedNote(DEMO_CARD_NUMBERS.APPROVED),
    );
  }
  return ok({
    method: "card",
    status: "authorised",
    brand: cardBrand(digits),
    last4: digits.slice(-4),
    authorisedAt: toIsoDateTime(new Date()),
  });
}

/** One remembered submission: the identity of the body that created the order and the answer that body
 * received, so a repeat of it replays rather than placing a second order. */
interface RememberedSubmission {
  readonly fingerprint: string;
  readonly outcome: Common.Result<Commerce.Order>;
}

/** The orders already created, by the session scope they were submitted under and then by the key they
 * were submitted with. Only a created order is remembered, so a declined attempt can be corrected and
 * resent under the same key — which the checkout's retained key needs — while a repeat of a submission
 * that did create an order replays it instead of placing a second.
 *
 * A submission is retained for the session that made it: the scope is the token of the live session the
 * request carried ({@link orderScope}), so the same key sent by two sessions is two separate
 * submissions and one customer's order is never replayed to another. That retention ends with the
 * session it belongs to — {@link forgetRememberedOrders} drops a scope when a route signs the session
 * out and when a request arrives carrying a token that names no live session — while
 * {@link clearRememberedOrders} clears every scope, which is what a fresh case needs. A guest checkout
 * carries no session at all, so its submissions share the one session-less scope `null`, where the
 * double-submission guard still holds. */
const rememberedOrders = new Map<string | null, Map<string, RememberedSubmission>>();

/**
 * Whether a caller may read an account-less order: it presents the credential recorded against that order
 * when the order was placed, so a caller that cannot present it is refused exactly as a foreign
 * account-owned order is.
 *
 * The record read is the one `src/utils/orderPlacements.ts` holds — what this document wrote first, and
 * the durable list a document that has since been reloaded reads back — which is what reopens a guest's own
 * confirmation after a reload, while a shared link opens nothing.
 *
 * The match is judged against the credential that module recorded and never against the order's
 * `idempotencyKey` member, so a payload that a reader already legitimately holds — an order returned to its
 * own customer or to an administrator — cannot be replayed as the credential of an order that reader was
 * refused, and a seeded account-less order, which no submission here ever recorded a credential for,
 * matches nothing.
 *
 * @param orderId - The identifier the request asks for.
 * @param presented - The credential the request presented, `undefined` when it presented none.
 * @returns `true` only when that order was created here and the text presented is the credential it was
 * recorded with.
 */
export function holdsGuestOrderCredential(
  orderId: Common.OrderId,
  presented: string | undefined,
): boolean {
  return placementAdmitsCredential(placementFor(orderId), presented);
}

/** Forgets every remembered placement: the orders a submission created here, so no case replays one an
 * earlier case created, and the credential each account-less order was recorded with — what this document
 * wrote and the durable record alike — so no case reads one an earlier case placed. */
export function clearRememberedOrders(): void {
  rememberedOrders.clear();
  clearPlacements();
}

/** Forgets what one session scope remembered: the entries a session that has ended left behind, so a
 * later request carrying its token inherits none of them. */
export function forgetRememberedOrders(scope: string | null): void {
  rememberedOrders.delete(scope);
}

/** The scope a request's submissions are remembered under: the token of the live session it carries, or
 * `null` when it carries none, which is the guest checkout's one session-less scope. */
function orderScope(context: RouteContext): string | null {
  return context.session === null ? null : (context.token ?? null);
}

/** A submission the order endpoint has read: the order it asks for and the fingerprint
 * {@link cardDigestOf} takes of the card members that are not payment secrets, which is what lets
 * {@link orderFingerprint} tell two submissions under one key apart when only the cardholder's name or
 * the card's expiry differs. The card itself is not kept: {@link settlePayment} has already reduced it
 * to the payment summary an order records, and the PAN and the security code leave this module with the
 * request that carried them. */
interface OrderSubmission {
  readonly request: OrderCreationRequest;
  readonly cardDigest: string | null;
}

/** The fingerprint of the non-sensitive card members a submission carried — the cardholder's name and
 * the expiry, which are not payment secrets — or `null` for an `invoice` or card-less payment: those
 * three members as read, joined into one stable text and hashed through the codebase's single digest
 * implementation, so two submissions differing in any of them fingerprint differently.
 *
 * No payment secret enters the input: the PAN and the security code are never digested, retained or
 * compared here, and nothing else about them leaves this call. The fingerprint exists to spot a
 * repeated submission under one idempotency key, not to stand for the card or to be a secret in its own
 * right, and it is held for the life of the document by {@link rememberedOrders}. A submission whose
 * number differs is still told from the first by {@link orderFingerprint}, which carries the payment
 * summary {@link settlePayment} reduced that number to: two numbers sharing a brand and last four
 * digits are one card as far as this store is concerned. */
function cardDigestOf(payment: PaymentValidationInput): string | null {
  const card = payment.card;
  if (payment.method !== "card" || card === undefined) return null;
  const submitted = [card.nameOnCard, card.expiryMonth, card.expiryYear];
  return createCredentialDigest(JSON.stringify(submitted)).hash;
}

/** The identity of a submission for the idempotency store: everything an order is built from, plus the
 * {@link cardDigestOf} fingerprint of the card members that are not payment secrets — and not the
 * authorisation instant, which differs between two identical submissions. */
function orderFingerprint(submission: OrderSubmission): string {
  const { request, cardDigest } = submission;
  return JSON.stringify({
    snapshot: request.snapshot,
    email: request.email,
    shippingAddress: request.shippingAddress,
    billingAddress: request.billingAddress,
    shippingMethodId: request.shippingMethodId,
    customerId: request.customerId,
    payment: { ...request.payment, authorisedAt: null },
    cardDigest,
  });
}

// Reading an order submission and creating its order ---------------------------------------------

/** The address snapshot an order carries, read by the same readers the address book uses. */
function readSubmittedAddress(members: RequestMembers | undefined): Account.Address {
  return {
    id: memberTextOrEmpty(members, "id") as Common.AddressId,
    ...readAddressInput(members),
    isDefaultShipping: memberBoolean(members, "isDefaultShipping") ?? false,
    isDefaultBilling: memberBoolean(members, "isDefaultBilling") ?? false,
  };
}

/** The submitted billing address judged by the same address rule the shipping step and the address book
 * use, each of its messages filed under the group the address sits in — `billing.postalCode` and its
 * siblings, the qualified spelling the checkout's own error clearing expects — so a fault in the address
 * an order is billed to is never read as one in the address it ships to. `address` is the billing half as
 * submitted; the result holds its errors, empty when it passes. */
function billingAddressErrors(address: Account.Address): Common.FieldErrors {
  const errors: Common.FieldErrors = {};
  for (const [member, message] of Object.entries(validateAddress(address))) {
    errors[`billing.${member}`] = message;
  }
  return errors;
}

/** The submission the order endpoint was handed: the order it asks for — both address halves judged by
 * the one address rule, the shipping half through the shipping submission and the billing half under
 * the group it sits in, the payment by the payment rule, the snapshot by its amounts and the key by its
 * presence, with the customer taken from the session and never the body — beside the
 * {@link cardDigestOf} fingerprint of the card members that are not payment secrets, taken here because
 * nothing downstream keeps the card.
 *
 * The session decides first: a submission that presented a token the store could not resolve is refused
 * before its body is read, because the order it asks for cannot be attributed to the buyer it was meant for. */
function readOrderRequest(context: RouteContext): Common.Result<OrderSubmission> {
  // A submission carrying a session token the store could not resolve — expired, unknown or revoked — is
  // refused with the dispatcher's own refusal rather than placed as a guest's: an account-less order is one
  // the signed-in buyer's history will never hold, so they are told to sign in again instead of being handed a
  // confirmation they cannot come back to. A submission that presented no token at all still places a guest
  // order, because the endpoint is anonymous and guest checkout is part of the product. The dispatcher
  // resolves every request's token before a handler runs, so a token seen here beside no session is exactly
  // that case, and `sessionProblem` is the refusal it earned.
  if (context.token !== undefined && context.session === null) {
    return { ok: false, error: context.sessionProblem as Common.ApiError };
  }
  // The submitted body as members, or nothing when the request carried something that is not an object:
  // the readers give every member a value the rule that owns it can judge.
  const body = isMembers(context.body) ? context.body : undefined;
  const shippingAddress = readSubmittedAddress(memberObject(body, "shippingAddress"));
  const billingAddress = readSubmittedAddress(memberObject(body, "billingAddress"));
  const email = memberTextOrEmpty(body, "email");
  const shippingMethodId = memberTextOrEmpty(body, "shippingMethodId");
  const idempotencyKey = memberTextOrEmpty(body, "idempotencyKey");
  const payment = readPaymentInput(memberObject(body, "payment"));
  const snapshot = readOrderSnapshot(memberValue(body, "snapshot"));
  const errors = mergeErrors(
    validateShippingSubmission({ address: shippingAddress, email, shippingMethodId }),
    // The billing half by the same rule, keyed by its own group, and placed after the shipping entry so
    // the field reported for a body wrong in both addresses stays the shipping one.
    billingAddressErrors(billingAddress),
    payment === undefined ? { method: VALIDATION_MESSAGES.REQUIRED } : validatePayment(payment),
    snapshot === undefined ? { snapshot: VALIDATION_MESSAGES.REQUIRED } : {},
    idempotencyKey.trim() === "" ? { idempotencyKey: VALIDATION_MESSAGES.REQUIRED } : {},
  );
  if (hasErrors(errors) || payment === undefined || snapshot === undefined) {
    return invalidFields(errors);
  }
  const settled = settlePayment(payment);
  if (!settled.ok) return settled;
  return ok({
    request: {
      snapshot,
      email,
      shippingAddress,
      billingAddress,
      shippingMethodId,
      idempotencyKey,
      customerId: context.session?.customerId ?? null,
      payment: settled.value,
    },
    cardDigest: cardDigestOf(payment),
  });
}

/** The `POST /api/orders` handler: a submission whose key and body a session already submitted
 * replays the order it created instead of placing a second, a body that differs from the first under
 * the same key is the `409` the endpoint states, and every other submission is created by the data
 * source and remembered once it has been. A token naming a session that has since ended drops what
 * that session remembered before anything is read, and the submission is then refused for want of that
 * session ({@link readOrderRequest}) rather than placed as a guest's. */
export function createOrder(context: RouteContext): Common.Result<unknown> {
  // A token that named a session which has since ended: what that session remembered is dropped here,
  // so the session-less request still carrying its token inherits none of it.
  if (context.token !== undefined && context.session === null)
    forgetRememberedOrders(context.token);
  const submission = readOrderRequest(context);
  if (!submission.ok) return submission;
  const { request } = submission.value;
  const key = request.idempotencyKey;
  const fingerprint = orderFingerprint(submission.value);
  const scope = orderScope(context);
  const entries = rememberedOrders.get(scope) ?? new Map<string, RememberedSubmission>();
  const remembered = entries.get(key);
  if (remembered !== undefined) {
    return remembered.fingerprint === fingerprint
      ? remembered.outcome
      : failure(API_ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT, IDEMPOTENCY_CONFLICT_MESSAGE);
  }
  const created = context.source.createOrder(request);
  if (created.ok) {
    // The credential the request presented for the account-less order it just created — the value the placing
    // client minted for this attempt, which is the only proof of placement a session-less buyer can offer
    // later. `src/utils/orderPlacements.ts` records it and keeps the first record held for an order, so a
    // repeat of one submission leaves the seam and the client holding the same value; an order that names an
    // account gets none, because it is read through the session that owns it.
    if (created.value.customerId === null) rememberPlacement(created.value, context.orderToken);
    entries.set(key, { fingerprint, outcome: created });
    rememberedOrders.set(scope, entries);
  }
  return created;
}
