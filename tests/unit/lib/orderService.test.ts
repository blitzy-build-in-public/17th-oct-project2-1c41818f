/**
 * Path: tests/unit/lib/orderService.test.ts
 * Purpose: Order construction from a snapshot, numbering, status transitions, snapshot immutability and the placement credential a guest order is read with
 * Lines: 590
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_STATUS_OPTIONS } from "@/constants/taxonomy";
import { createSalesProDataSource } from "@/data/repositories";
import { failNext, registerDataSource, resetMockServer } from "@/lib/mockServer";
import {
  ORDER_STATUS_EVENTS,
  appendStatusHistory,
  buildOrderInput,
  canSubmitOrder,
  canTransition,
  createIdempotencyKey,
  createOrder,
  getOrder,
  listOrders,
  nextStatus,
  orderNumber,
  summariseOrderTotals,
  toOrderLines,
} from "@/lib/orderService";
import { isValidIso } from "@/utils/dates";
import { placementTokenFor } from "@/utils/orderPlacements";
import { orderId, productId } from "@/utils/strings";
import {
  FIXED_NOW,
  makeAddress,
  makeCartLine,
  makeFilterState,
  makeOrder,
  makePricedCart,
} from "../../fixtures";

import type { OrderContact, OrderStatusEvent } from "@/lib/orderService";
import type { SalesProDataSource } from "@/lib/mockServer";
import type { RegistrationResult } from "@/types/account";
import type { IsoDateTimeString } from "@/types/common";
import type { CartLine, Order, OrderStatus, PaymentInput, PricedCart } from "@/types/commerce";

// The pure rules are called directly and the three async members through the real transport, answered by
// the data source bound below; nothing here is mocked. The idempotency store's own behaviour at that seam
// belongs to tests/unit/lib/mockServer.test.ts, where it lives, and is not repeated here.

/** The writable view a case stands a later edit behind, which the product's read-only shapes prevent. */
type Editable<TShape> = { -readonly [TKey in keyof TShape]: TShape[TKey] };

/** The data source every request in this file is answered from: `bindFreshSource` rebinds it per case. */
let source: SalesProDataSource;

/** Binds the composition root, as `src/main.tsx` does before the first render; each case binds again,
 * because the seam's reset unbinds the source before the next one runs. */
function bindFreshSource(): void {
  source = createSalesProDataSource();
  registerDataSource(source);
}

/** A lookup source of its own, read once: the seeded catalogue is identical in every source, so the
 * product the cases buy is the same product whichever source answers the request. */
const CATALOGUE = createSalesProDataSource();
const SHIPPING_METHOD_ID = CATALOGUE.listShippingMethods()[0].id;
/** The product every placing case buys: one the store holds in stock, because the seam refuses an order
 * whose line names a product the catalogue cannot supply at the quantity asked for. */
function findBoughtProduct() {
  const stocked = CATALOGUE.listProducts(makeFilterState()).items;
  const found = stocked.find((item) => item.stockOnHand >= 2);
  if (found === undefined) throw new Error("The seeded catalogue holds nothing in stock.");
  return found;
}
const BOUGHT = findBoughtProduct();

beforeAll(bindFreshSource);

beforeEach(() => {
  resetMockServer();
  bindFreshSource();
});

afterAll(() => {
  resetMockServer();
});

/** A cart line for the bought product, or a copy a case passes, at its own name, sku, price and stock. */
function seededLine(quantity = 2, product = BOUGHT): CartLine {
  return makeCartLine({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPriceMinor: product.priceMinor,
    maxQuantity: product.stockOnHand,
    imageUrl: product.images[0].url,
    quantity,
  });
}

/** The snapshot a buyer reviewed, priced at the delivery method every submission below names. */
function seededSnapshot(quantity = 2, product = BOUGHT): PricedCart {
  const lines = [seededLine(quantity, product)];
  return makePricedCart({ lines, shippingMethodId: SHIPPING_METHOD_ID });
}

/** An invoice payment, the one method whose validity reads no clock, so these cases stay pinned. */
const INVOICE_PAYMENT: PaymentInput = { method: "invoice" };

/** The details a submission carries beside its snapshot, as the checkout collects them. */
function contactFor(payment: PaymentInput, email = "buyer@example.test"): OrderContact {
  return {
    email,
    shippingAddress: makeAddress(),
    billingAddress: makeAddress({ label: "Billing", isDefaultBilling: true }),
    shippingMethodId: SHIPPING_METHOD_ID,
    payment,
  };
}

describe("an order built from the snapshot the buyer reviewed", () => {
  it("takes its lines from the priced cart and writes the submission field for field", () => {
    const snapshot = seededSnapshot();
    const priced = snapshot.lines[0];
    const lines = toOrderLines(snapshot);
    const contact = contactFor(INVOICE_PAYMENT);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      id: priced.id,
      productId: priced.productId,
      productName: priced.name,
      sku: priced.sku,
      unitPriceMinor: priced.unitPriceMinor,
      quantity: priced.quantity,
      lineTotalMinor: priced.lineTotalMinor,
      imageUrl: priced.imageUrl,
    });
    // What the line cost is the unit price times what was bought, at the price of that moment.
    expect(lines[0].lineTotalMinor).toBe(lines[0].unitPriceMinor * lines[0].quantity);
    expect(buildOrderInput(snapshot, contact, "ord_attempt-1")).toEqual({
      snapshot,
      email: contact.email,
      shippingAddress: contact.shippingAddress,
      billingAddress: contact.billingAddress,
      shippingMethodId: SHIPPING_METHOD_ID,
      payment: INVOICE_PAYMENT,
      idempotencyKey: "ord_attempt-1",
    });
    // Both addresses travel as snapshots, so editing the address book later cannot move an order.
    expect(contact.billingAddress).toMatchObject({ label: "Billing", isDefaultBilling: true });
  });

  it("reads an order's totals off its own snapshot, never recomputed from its lines", () => {
    const reviewed: PricedCart = { ...seededSnapshot(), grandTotalMinor: 12_345 };
    const order = makeOrder({ pricedCart: reviewed, lines: toOrderLines(reviewed) });
    const before = structuredClone(order);

    // An amount the lines would not sum to: a surface that re-priced the order would show another total.
    expect(summariseOrderTotals(order)).toEqual({
      subtotalMinor: reviewed.subtotalMinor,
      discountTotalMinor: reviewed.discountTotalMinor,
      shippingMinor: reviewed.shippingMinor,
      taxMinor: reviewed.taxMinor,
      grandTotalMinor: 12_345,
    });
    // A summary reads: the order comes back exactly as it went in, snapshot included.
    expect(order).toEqual(before);
  });
});

describe("a placed order against the catalogue changing afterwards", () => {
  it("holds the purchase-time name, sku and price of every line", () => {
    const listed = structuredClone(BOUGHT);
    const order = makeOrder({ pricedCart: seededSnapshot(2, listed) });
    const before = structuredClone(order);
    const held = {
      productId: listed.id,
      productName: listed.name,
      sku: listed.sku,
      unitPriceMinor: listed.priceMinor,
    };

    // The copy is renamed, re-priced and re-skued after placement: a live reference would follow it.
    const changed = listed as unknown as Editable<typeof listed>;
    changed.name = "Renamed later";
    changed.sku = "REN-9999";
    changed.priceMinor += 5_000;

    expect(order).toEqual(before);
    expect(order.lines[0]).toMatchObject(held);
    expect(changed.priceMinor).not.toBe(order.lines[0].unitPriceMinor);
    expect(order.pricedCart.grandTotalMinor).toBe(before.pricedCart.grandTotalMinor);
  });

  it("copies each priced line, so a later cart edit leaves the order's lines alone", () => {
    const snapshot = seededSnapshot();
    const priced = snapshot.lines[0];
    const lines = toOrderLines(snapshot);
    const held = {
      productName: priced.name,
      sku: priced.sku,
      unitPriceMinor: priced.unitPriceMinor,
      lineTotalMinor: priced.lineTotalMinor,
    };

    const edited = priced as unknown as Editable<PricedCart["lines"][number]>;
    edited.name = "Renamed after the order";
    edited.sku = "REN-0000";
    edited.unitPriceMinor = 1;
    edited.lineTotalMinor = 1;

    expect(lines[0]).not.toBe(priced);
    expect(lines[0]).toMatchObject(held);
  });
});

describe("numbering and keys", () => {
  const LATER_INSTANT = "2025-10-16T09:30:00.000Z";

  it("numbers an order from the day it was placed and its position on that day", () => {
    const first = orderNumber(1, FIXED_NOW);

    // Deterministic in both arguments, so a seed, a fixture and a case derive the same reference.
    expect(orderNumber(1, FIXED_NOW)).toBe(first);
    expect(first).toMatch(/^SP-\d{6}-0001$/);
    // Padded to a fixed width and counted from one, so a day's references read in placement order, and a
    // position no order could hold numbers a first order rather than minting an impossible reference.
    expect(orderNumber(2, FIXED_NOW)).toBe(`${first.slice(0, -4)}0002`);
    expect(orderNumber(0, FIXED_NOW)).toBe(first);
    expect(orderNumber(Number.NaN, FIXED_NOW)).toBe(first);
    expect(orderNumber(2.7, FIXED_NOW)).toBe(orderNumber(2, FIXED_NOW));
    // Another day is another number: the date half is the day the order was placed.
    expect(orderNumber(1, LATER_INSTANT).slice(0, -4)).not.toBe(first.slice(0, -4));
    // A date-time the product cannot parse is refused loudly: a number built from it would be wrong.
    expect(() => orderNumber(1, "the day before yesterday" as IsoDateTimeString)).toThrow(
      TypeError,
    );
  });

  it("mints a distinct key for every attempt, even two inside the same millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const frozen = createIdempotencyKey();
    const sameInstant = createIdempotencyKey();
    vi.setSystemTime(new Date(Date.parse(FIXED_NOW) + 1_000));
    const aSecondLater = createIdempotencyKey();
    vi.useRealTimers();

    for (const key of [frozen, sameInstant, aSecondLater]) expect(key).toMatch(/^ord_\S+$/);
    // Two attempts must never share a key: the key is what makes a repeated submission replay the order
    // the first one created rather than placing a second.
    expect(sameInstant).not.toBe(frozen);
    expect(aSecondLater).not.toBe(frozen);
    expect(createIdempotencyKey()).not.toBe(frozen);
  });
});

/** Every status the taxonomy defines and every event the machine knows, both read from the vocabulary
 * rather than restated, so an addition there reaches every check below. */
const STATUSES: OrderStatus[] = ORDER_STATUS_OPTIONS.map((option) => option.value);
const EVENTS: OrderStatusEvent[] = Object.values(ORDER_STATUS_EVENTS);
const EVENT_TARGETS: Readonly<Record<OrderStatusEvent, OrderStatus>> = {
  confirm: "confirmed",
  "start-processing": "processing",
  ship: "shipped",
  deliver: "delivered",
  cancel: "cancelled",
  refund: "refunded",
};

describe("the status machine", () => {
  /** The moves an order may make, and the moves it may not. */
  const ALLOWED: [OrderStatus, OrderStatus][] = [
    ["pending", "confirmed"],
    ["confirmed", "processing"],
    ["processing", "shipped"],
    ["shipped", "delivered"],
    ["delivered", "refunded"],
    ["pending", "cancelled"],
    ["confirmed", "cancelled"],
    ["processing", "cancelled"],
    ["cancelled", "refunded"],
  ];
  const REFUSED: [OrderStatus, OrderStatus][] = [
    ["delivered", "pending"],
    ["cancelled", "shipped"],
    ["refunded", "confirmed"],
    ["shipped", "cancelled"],
  ];

  it("allows the moves an order may make, refuses every other, and refuses a status it already holds", () => {
    for (const [from, to] of ALLOWED) expect(canTransition(from, to)).toBe(true);
    for (const [from, to] of REFUSED) expect(canTransition(from, to)).toBe(false);
    // Re-recording where an order already stands is not a transition, and asking does not throw.
    for (const status of STATUSES) {
      expect(canTransition(status, status)).toBe(false);
      expect(() => nextStatus(status, ORDER_STATUS_EVENTS.CONFIRM)).not.toThrow();
    }
  });

  it("moves an order on for an event it allows and leaves it be for one it does not", () => {
    // The forward walk, the cancellation the table allows up to dispatch, and the refund that settles it.
    expect(nextStatus("pending", ORDER_STATUS_EVENTS.CONFIRM)).toBe("confirmed");
    expect(nextStatus("confirmed", ORDER_STATUS_EVENTS.START_PROCESSING)).toBe("processing");
    expect(nextStatus("processing", ORDER_STATUS_EVENTS.SHIP)).toBe("shipped");
    expect(nextStatus("shipped", ORDER_STATUS_EVENTS.DELIVER)).toBe("delivered");
    expect(nextStatus("delivered", ORDER_STATUS_EVENTS.REFUND)).toBe("refunded");
    // An event that does not apply returns the status it came in with — a refusal is a value, not a
    // failure — so a caller needs no guard before asking and no catch around the answer.
    expect(nextStatus("shipped", ORDER_STATUS_EVENTS.CANCEL)).toBe("shipped");
    expect(nextStatus("refunded", ORDER_STATUS_EVENTS.SHIP)).toBe("refunded");
    // An event the vocabulary does not name fails loudly rather than falling through unhandled.
    expect(() => nextStatus("pending", "teleport" as OrderStatusEvent)).toThrow(Error);
  });

  it("keeps nextStatus and canTransition in agreement over every status and every event", () => {
    const pairs = STATUSES.flatMap((from) => EVENTS.map((event) => ({ from, event })));
    expect(pairs).toHaveLength(STATUSES.length * EVENTS.length);

    let refused = 0;
    for (const { from, event } of pairs) {
      const target = EVENT_TARGETS[event];
      const allowed = canTransition(from, target);
      if (!allowed) refused += 1;
      expect(nextStatus(from, event)).toBe(allowed ? target : from);
    }
    expect(refused).toBeGreaterThan(0);
    // Every status but the terminal one can be moved on: the table carries no dead status.
    const movable = STATUSES.filter((status) =>
      EVENTS.some((event) => nextStatus(status, event) !== status),
    );
    expect(movable).toEqual(STATUSES.filter((status) => status !== "refunded"));
  });
});

describe("an order's status history", () => {
  const LATER_INSTANT = "2025-10-16T09:30:00.000Z";
  const CONFIRMED = makeOrder();

  it("appends one entry, records an opening status once, and leaves its own order alone", () => {
    const moved = appendStatusHistory(CONFIRMED, "processing", LATER_INSTANT, "Picking started.");
    const [opening, picked] = moved.statusHistory;

    expect(moved).not.toBe(CONFIRMED);
    expect(moved).toMatchObject({ status: "processing", updatedAt: LATER_INSTANT });
    expect(moved.statusHistory).toHaveLength(2);
    expect(opening).toEqual(CONFIRMED.statusHistory[0]);
    expect(picked?.status).toBe("processing");
    expect(picked?.at).toBe(LATER_INSTANT);
    expect(picked?.note).toBe("Picking started.");
    // The order it came from keeps the status, the instant and the timeline it held.
    expect(CONFIRMED).toMatchObject({ status: "confirmed", updatedAt: FIXED_NOW });

    // An order's own status opens its timeline exactly once, and a blank note is no note.
    const draft = makeOrder({ status: "pending", statusHistory: [] });
    const opened = appendStatusHistory(draft, "pending", FIXED_NOW);
    expect(opened.statusHistory).toEqual([{ status: "pending", at: FIXED_NOW }]);
    expect(appendStatusHistory(opened, "pending", LATER_INSTANT)).toBe(opened);
    const reRecorded = appendStatusHistory(opened, "pending", LATER_INSTANT, "   ");
    expect(reRecorded.statusHistory).toHaveLength(1);
  });

  it("refuses a status the order's own rule does not reach", () => {
    // A walk to delivery: each move appends its own entry, so the timeline is the path the order took.
    const picked = appendStatusHistory(CONFIRMED, "processing", LATER_INSTANT);
    const dispatched = appendStatusHistory(picked, "shipped", LATER_INSTANT);
    const delivered = appendStatusHistory(dispatched, "delivered", LATER_INSTANT);
    const walked = delivered.statusHistory.map((entry) => entry.status);
    expect(walked).toEqual(["confirmed", "processing", "shipped", "delivered"]);

    // Two steps ahead, backwards, and a cancellation after dispatch — a return, which is out of scope —
    // each return the order it was given rather than writing an impossible timeline.
    expect(appendStatusHistory(CONFIRMED, "delivered", LATER_INSTANT)).toBe(CONFIRMED);
    expect(appendStatusHistory(delivered, "confirmed", LATER_INSTANT)).toBe(delivered);
    expect(appendStatusHistory(dispatched, "cancelled", LATER_INSTANT)).toBe(dispatched);
    // A cancelled order may still be settled; it may never be shipped.
    const cancelled = appendStatusHistory(CONFIRMED, "cancelled", LATER_INSTANT);
    expect(appendStatusHistory(cancelled, "refunded", LATER_INSTANT).status).toBe("refunded");
    expect(appendStatusHistory(cancelled, "shipped", LATER_INSTANT)).toBe(cancelled);
  });
});

describe("the submission guard's client half", () => {
  it("refuses a submission already in flight and one with no key to send", () => {
    const key = createIdempotencyKey();

    expect(canSubmitOrder({ submitting: true, lastKey: undefined }, key)).toBe(false);
    expect(canSubmitOrder({ submitting: true, lastKey: key }, key)).toBe(false);
    expect(canSubmitOrder({ submitting: false, lastKey: undefined }, "")).toBe(false);
    expect(canSubmitOrder({ submitting: false, lastKey: undefined }, "   ")).toBe(false);
    expect(canSubmitOrder({ submitting: false, lastKey: undefined }, key)).toBe(true);
    // A retry of the tracked attempt is deliberately let through: the key it repeats is what makes the
    // second attempt harmless, and refusing it here would strand a buyer whose order is already recorded.
    expect(canSubmitOrder({ submitting: false, lastKey: key }, key)).toBe(true);
  });

  it("refuses a submission the rules reject before a request is made, naming the half at fault", async () => {
    const contact = contactFor(INVOICE_PAYMENT);
    const nothingToBuy = await createOrder(
      buildOrderInput({ ...seededSnapshot(), lines: [] }, contact, createIdempotencyKey()),
    );
    const keyless = await createOrder(buildOrderInput(seededSnapshot(), contact, " "));
    // A line the catalogue cannot supply is the store's refusal, which names the basket it could not price.
    const unsuppliable = makePricedCart({
      lines: [makeCartLine({ productId: productId("gone"), quantity: 1, maxQuantity: 5 })],
    });
    const refused = await createOrder(
      buildOrderInput(unsuppliable, contact, createIdempotencyKey()),
    );

    if (nothingToBuy.ok || keyless.ok || refused.ok)
      throw new Error("A refused submission answers.");
    expect(nothingToBuy.error).toMatchObject({ status: 422, field: "snapshot" });
    expect(keyless.error).toMatchObject({ status: 422, field: "idempotencyKey" });
    expect(refused.error).toMatchObject({
      status: 422,
      code: "insufficient-stock",
      field: "lines",
    });
  });
});

describe("the transport surface", () => {
  /** A signed-in customer, registered through the data source, so the token below is one the seam's own
   * session registry knows and every request is authorised by. */
  function registerBuyer(label: string): RegistrationResult {
    const outcome = source.registerCustomer({
      email: `${label}@example.test`,
      password: "OrderTest1234",
      firstName: "Dana",
      lastName: "Okafor",
      marketingOptIn: false,
    });
    if (!outcome.ok) throw new Error(`The buyer could not be registered: ${outcome.error.code}`);
    return outcome.value;
  }

  /** One placement beside the key it was submitted under: the credential its own read presents. */
  async function placeOrderWithKey(
    snapshot: PricedCart,
    contact: OrderContact,
    sessionToken?: string,
  ): Promise<{ readonly order: Order; readonly key: string }> {
    const key = createIdempotencyKey();
    const outcome = await createOrder(buildOrderInput(snapshot, contact, key), { sessionToken });
    if (!outcome.ok) throw new Error(`The order was refused: ${outcome.error.code}`);
    return { order: outcome.value, key };
  }

  /** Places one order through the service and returns it, failing the case when the seam refused it. */
  async function placeOrder(
    snapshot: PricedCart,
    contact: OrderContact,
    sessionToken?: string,
  ): Promise<Order> {
    return (await placeOrderWithKey(snapshot, contact, sessionToken)).order;
  }

  /** Places one invoice order for a session: the shape every case here but the card one uses. */
  async function placeInvoiceOrder(snapshot: PricedCart, sessionToken?: string): Promise<Order> {
    return placeOrder(snapshot, contactFor(INVOICE_PAYMENT), sessionToken);
  }

  /** Reads one page of a customer's history, failing the case when it could not be read. */
  async function readHistory(sessionToken: string) {
    const history = await listOrders(undefined, { sessionToken });
    if (!history.ok) throw new Error(`The history could not be read: ${history.error.code}`);
    return history.value;
  }

  it("places one order for the session that submitted it and reads it back unchanged", async () => {
    const buyer = registerBuyer("place");
    const snapshot = seededSnapshot();
    const input = buildOrderInput(snapshot, contactFor(INVOICE_PAYMENT), createIdempotencyKey());
    const placed = await createOrder(input, { sessionToken: buyer.session.token });
    if (!placed.ok) throw new Error(`The order was refused: ${placed.error.code}`);
    const order = placed.value;

    expect(order.id).toMatch(/^ord_\S+$/);
    expect(order.orderNumber).toMatch(/^SP-\d{6}-\d{4}$/);
    expect(order).toMatchObject({
      customerId: buyer.customer.id,
      email: input.email,
      status: "pending",
      shippingMethodId: input.shippingMethodId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(isValidIso(order.placedAt)).toBe(true);
    // The opening entry, the reviewed snapshot and the lines it priced, exactly as submitted.
    expect(order.statusHistory).toEqual([{ status: "pending", at: order.placedAt }]);
    expect(order.lines).toEqual(toOrderLines(snapshot));
    expect(order.pricedCart).toEqual(snapshot);

    // One submission, one order: the account's history held nothing before it and holds only it after.
    const history = await readHistory(buyer.session.token);
    expect(history.items.map((row) => row.id)).toEqual([order.id]);

    // Reading it back keeps the reference the buyer was given and the facts it was placed with.
    const reread = await getOrder(order.id, { sessionToken: buyer.session.token });
    if (!reread.ok) throw new Error(`The order could not be read: ${reread.error.code}`);
    expect(reread.value.orderNumber).toBe(order.orderNumber);
    expect(reread.value.lines).toEqual(order.lines);
  });

  it("keeps each customer's history to that customer", async () => {
    const mine = registerBuyer("mine");
    const theirs = registerBuyer("theirs");
    const ownOrder = await placeInvoiceOrder(seededSnapshot(), mine.session.token);
    const theirOrder = await placeInvoiceOrder(seededSnapshot(), theirs.session.token);

    // The endpoint takes no customer id: ownership follows the token the request carried.
    const history = await readHistory(mine.session.token);
    expect(history.items.map((row) => row.id)).toEqual([ownOrder.id]);
    expect(history.items.every((row) => row.customerId === mine.customer.id)).toBe(true);
    // The other customer's own history holds the order that customer placed, and nothing of either.
    const theirHistory = await readHistory(theirs.session.token);
    expect(theirHistory.items.map((row) => row.id)).toEqual([theirOrder.id]);
  });

  it("keeps another account out of an order, and answers a foreign order and an absent one alike", async () => {
    const mine = registerBuyer("owner");
    const theirs = registerBuyer("stranger");
    const ownOrder = await placeInvoiceOrder(seededSnapshot(), mine.session.token);
    const foreignOrder = await placeInvoiceOrder(seededSnapshot(), theirs.session.token);
    const token = { sessionToken: mine.session.token };

    const foreign = await getOrder(foreignOrder.id, token);
    const unknown = await getOrder(orderId("no-such-order"), token);
    // Deliberately the same answer, so a response cannot be read to learn which orders exist.
    expect(foreign).toEqual(unknown);
    if (foreign.ok) throw new Error("Another account's order is not readable.");
    expect(foreign.error).toMatchObject({ status: 404, code: "order-not-found" });

    // Its own customer reads it; a caller carrying no session is refused before ownership is judged.
    expect((await getOrder(ownOrder.id, token)).ok).toBe(true);
    const anonymous = await getOrder(ownOrder.id);
    if (anonymous.ok) throw new Error("An account's order is not readable without a session.");
    expect(anonymous.error.status).toBe(401);
    const noHistory = await listOrders(undefined);
    if (noHistory.ok) throw new Error("A history is not readable without a session.");
    expect(noHistory.error.status).toBe(401);

    // A guest's order takes its read credential from the attempt that placed it, remembered here for the
    // order: presenting it is what the confirmation route does by default. The idempotency key that attempt
    // was submitted under is a different value and no credential at all.
    const placed = await placeOrderWithKey(seededSnapshot(), contactFor(INVOICE_PAYMENT));
    expect(placed.order.customerId).toBeNull();
    const credential = placementTokenFor(placed.order.id);
    expect(credential).toMatch(/^plc_\S+$/);
    expect(credential).not.toBe(placed.key);
    const guestRead = await getOrder(placed.order.id);
    if (!guestRead.ok) throw new Error(`The order could not be read: ${guestRead.error.code}`);
    expect(guestRead.value.shippingAddress).toEqual(placed.order.shippingAddress);
  });

  it("discards a card at the seam: an order keeps its brand and last four digits only", async () => {
    const buyer = registerBuyer("card");
    // The expiry is the one member whose validity is defined against the real clock, so it is read from it.
    const card: PaymentInput = {
      method: "card",
      card: {
        number: "4111111111111111",
        nameOnCard: "Dana Okafor",
        expiryMonth: 12,
        expiryYear: new Date().getFullYear() + 1,
        cvc: "123",
      },
    };
    const order = await placeOrder(seededSnapshot(), contactFor(card), buyer.session.token);

    expect(order.payment).toMatchObject({
      method: "card",
      status: "authorised",
      brand: "Visa",
      last4: "1111",
    });
    // The number is read, validated and discarded: nothing an order carries can be charged again.
    expect(JSON.stringify(order)).not.toContain("4111111111111111");
  });

  it("reports a failed placement as a value rather than throwing", async () => {
    failNext({ routeId: "orders.create" });
    const outcome = await createOrder(
      buildOrderInput(seededSnapshot(), contactFor(INVOICE_PAYMENT), createIdempotencyKey()),
    );

    if (outcome.ok) throw new Error("An injected failure is answered rather than reported.");
    expect(outcome.error).toMatchObject({ status: 503, code: "data-source-unavailable" });
  });
});
