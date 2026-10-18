/**
 * Path: tests/integration/orderPlacementDurability.test.tsx
 * Purpose: The orders this browser created survive a reload: read back into a rebuilt store, the credential that opens them verified from its own durable record, and every other caller still refused
 * Lines: 403
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, SHIPPING_METHODS, STORAGE_KEYS } from "@/constants/config";
import { CHECKOUT_COPY, FEEDBACK_COPY } from "@/constants/content";
import { orderConfirmationPath } from "@/constants/routes";
import { createSalesProDataSource } from "@/data/repositories";
import { fillApiPath, getJson, postJson } from "@/lib/apiClient";
import { API_PATHS, registerDataSource } from "@/lib/mockServer";
import {
  buildOrderInput,
  createIdempotencyKey,
  createOrder,
  getOrder,
  listOrders,
  type OrderContact,
} from "@/lib/orderService";
import type { Product } from "@/types/catalog";
import type { CartLine, Order } from "@/types/commerce";
import type { ApiError, OrderId, Result, SessionToken } from "@/types/common";
import { sequenceId } from "@/utils/strings";
import { writeStored } from "@/utils/storage";

import { makeAddress, makeCartLine, makeFilterState, makePricedCart } from "../fixtures";
import { renderApp, resetApiState, screen } from "../testUtils";

/*
 * What a reload is, and how each case reaches one.
 *
 * The confirmation route is reload-safe only if two records survive the document that wrote them: the
 * order itself, which exists nowhere but the store a request was answered from, and the seam's record of
 * the credential that opens it. So the cases below build the document a reload builds — a store built
 * now, whose reads are answered by what this browser persisted — and, where the credential is what is
 * under test, a module registry reset first, so the seam that decides the read holds no memory of the
 * document before it, exactly as a fresh document holds none. That is the technique
 * `tests/integration/sessionLifecycle.test.tsx` uses for the durable session table, applied to the orders
 * this browser created. Nothing is mocked: the orders are placed through the real order client, the reads
 * are made through the real transport, and every assertion is about what a caller is answered — a
 * returned order, a refusal, or what the confirmation renders.
 */

// The seeded facts every placement is built from --------------------------------------------------

/** A source read as a caller of the data module, for the seeded facts a placement needs: the product it
 *  buys, the delivery methods it may choose, and the order the seeded history holds. */
const SEEDED = createSalesProDataSource();

/** The delivery method every placement in this file chooses: the dearest one, which always charges, so
 *  the priced snapshot states a shipping figure of its own. */
const SHIPPING_METHOD_ID = SHIPPING_METHODS[SHIPPING_METHODS.length - 1].id;

/** The catalogue line every placement in this file buys: a seeded product the store holds in stock at
 *  the quantity asked for, because the seam refuses an order whose line the catalogue cannot supply. */
function stockedLine(): CartLine {
  const product: Product | undefined = SEEDED.listProducts(makeFilterState()).items.find(
    (row) => row.stockOnHand >= 2,
  );
  if (product === undefined) throw new Error("The seeded catalogue holds nothing in stock.");
  return makeCartLine({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPriceMinor: product.priceMinor,
    maxQuantity: product.stockOnHand,
    imageUrl: product.images[0].url,
    quantity: 2,
  });
}

/** The priced cart every submission is built from, as the checkout hands one over at the review step. */
const SNAPSHOT = makePricedCart({ lines: [stockedLine()], shippingMethodId: SHIPPING_METHOD_ID });

/** The first order of the seeded history, which no submission here created: `ord_0001`, an account-less
 *  order — asserted where it is read, because the refusal is only meaningful for such an order. */
const SEEDED_GUEST_ORDER = sequenceId("ord", 1);

/** The contact a guest's submission carries, and the one an account's carries. */
const GUEST_EMAIL = "guest.buyer@example.test";

/** A credential no submission in this file was sent under: what a stranger arrives holding, and what a
 *  browser that placed some other order holds. */
const FOREIGN_CREDENTIAL = "ord_attempt-shared-link";

// The details a submission carries -----------------------------------------------------------------

/** The details a submission carries beside its snapshot, as the checkout collects them. The invoice is
 *  the one payment whose validity reads no clock, so every placement here stays pinned. */
function contactFor(email: string): OrderContact {
  return {
    email,
    shippingAddress: makeAddress(),
    billingAddress: makeAddress({ label: "Billing", isDefaultBilling: true }),
    shippingMethodId: SHIPPING_METHOD_ID,
    payment: { method: "invoice" },
  };
}

/** The seeded shopper's credentials, the account whose own orders the account cases place. */
const SHOPPER = { email: DEMO_ACCOUNTS.CUSTOMER_EMAIL, password: DEMO_ACCOUNTS.PASSWORD } as const;

// Reading an outcome, rather than assuming it ------------------------------------------------------

/** The payload a successful call resolved with, asserted rather than assumed. */
function valueOf<TValue>(result: Result<TValue>): TValue {
  if (!result.ok) throw new Error(`Expected a payload, resolved with ${result.error.code}.`);
  return result.value;
}

/** The refusal a refused call resolved with, asserted rather than assumed. */
function refusalOf(result: Result<unknown>): ApiError {
  if (result.ok) throw new Error("Expected a refusal, resolved with a payload.");
  return result.error;
}

// A document, and the one a reload builds ----------------------------------------------------------

/** How one document reaches the seam: the calls a case makes, taken from this file's own registry or
 *  from the registry a reload evaluates. */
interface Document {
  readonly postJson: typeof postJson;
  readonly getJson: typeof getJson;
  readonly createOrder: typeof createOrder;
  readonly getOrder: typeof getOrder;
  readonly listOrders: typeof listOrders;
}

/** The document this file was evaluated in: the one that places the orders the cases below read back. */
const FIRST_DOCUMENT: Document = { postJson, getJson, createOrder, getOrder, listOrders };

/**
 * Opens the document a reload creates.
 *
 * The module registry is reset first, so the seam that decides the next read holds no record of what the
 * document before it placed — which is what a fresh document holds — and the store bound for it is built
 * from the seeds and then read into from this browser's durable records. Whatever answers a read made
 * here is therefore what the browser persisted and nothing that lived in memory: a case that passes in
 * this document passes because the record is durable, and a case that fails is a read the record does
 * not reach.
 *
 * @returns The fresh document's calls, with its data source bound.
 */
async function openReloadedDocument(): Promise<Document> {
  vi.resetModules();
  const client = await import("@/lib/apiClient");
  const seam = await import("@/lib/mockServer");
  const data = await import("@/data/repositories");
  const orders = await import("@/lib/orderService");
  seam.registerDataSource(data.createSalesProDataSource());
  return {
    postJson: client.postJson,
    getJson: client.getJson,
    createOrder: orders.createOrder,
    getOrder: orders.getOrder,
    listOrders: orders.listOrders,
  };
}

/** Rebuilds the store a document's reads are answered from, as a reload does: the seeds plus the orders
 *  this browser created, read back into it. */
function rebuildStore(): void {
  registerDataSource(createSalesProDataSource());
}

// Placing an order --------------------------------------------------------------------------------

/** What a placement is made with: the document submitting it and, if its buyer is signed in, the
 *  session token it carries. */
interface PlacementOptions {
  readonly document?: Document;
  readonly sessionToken?: SessionToken;
}

/**
 * Places one order through the real order client, as the checkout does: the snapshot is priced and the
 * key is minted per attempt by the client that submits it, so an account-less placement also leaves this
 * browser holding the credential that reopens it.
 *
 * @param options - The document to submit through, and the session the submission is made under.
 * @returns The order the seam created.
 */
async function placeOrder(options: PlacementOptions = {}): Promise<Order> {
  const document = options.document ?? FIRST_DOCUMENT;
  const input = buildOrderInput(SNAPSHOT, contactFor(GUEST_EMAIL), createIdempotencyKey());
  const request = options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken };
  return valueOf(await document.createOrder(input, request));
}

/** Signs the seeded shopper in through the endpoint and answers the session token it minted. */
async function signInAsShopper(document: Document = FIRST_DOCUMENT): Promise<SessionToken> {
  const signedIn = await document.postJson<{ readonly token: SessionToken }>(
    API_PATHS.AUTH_LOGIN,
    SHOPPER,
  );
  return valueOf(signedIn).token;
}

// Reading an order --------------------------------------------------------------------------------

/** What a read is made with: the document making it and, for an order that names an account, the
 *  session the read authenticates with. */
interface ReadOptions {
  readonly document?: Document;
  readonly sessionToken?: SessionToken;
}

/** Reads one order as the confirmation route does, through a document's own order client: the credential
 *  it presents is the one this browser remembers for that order, and the session a case names when the
 *  order belongs to an account. */
function readOrder(id: OrderId, options: ReadOptions = {}): Promise<Result<Order>> {
  const document = options.document ?? FIRST_DOCUMENT;
  return options.sessionToken === undefined
    ? document.getOrder(id)
    : document.getOrder(id, { sessionToken: options.sessionToken });
}

/** Reads one order presenting exactly the credential a case names, and nothing else: how a shared link,
 *  a stranger's browser and a seeded order are reached. */
function readWithCredential(
  id: OrderId,
  orderToken: string | undefined,
  document: Document = FIRST_DOCUMENT,
): Promise<Result<Order>> {
  return document.getJson<Order>(fillApiPath(API_PATHS.ORDER_DETAIL, { id }), { orderToken });
}

// The confirmation --------------------------------------------------------------------------------

describe("the confirmation a reload reopens", () => {
  beforeEach(() => {
    resetApiState();
  });

  it("renders a guest's own order again instead of the sign-in failure", async () => {
    const placed = await placeOrder();

    // The reload: a store built now, answered by the seeds and by this browser's own records.
    rebuildStore();
    renderApp({ route: orderConfirmationPath(placed.id) });

    // The order the URL names renders: its number, and the sentence this state states.
    expect(await screen.findByText(CHECKOUT_COPY.CONFIRMATION_THANK_YOU)).toBeVisible();
    expect(await screen.findByText(placed.orderNumber)).toBeVisible();
    // The failure the route showed before the order was read back — an unrecoverable one, offering no
    // retry — is gone.
    expect(screen.queryByText(FEEDBACK_COPY.SIGN_IN_REQUIRED)).toBeNull();
    expect(screen.queryByText(CHECKOUT_COPY.CONFIRMATION_ITEMS_HEADING)).toBeVisible();
  });
});

// The order the seam reads back -------------------------------------------------------------------

describe("the order a reload reads back", () => {
  beforeEach(() => {
    resetApiState();
  });

  it("answers a guest's own order in a document that holds no memory of placing it", async () => {
    const placed = await placeOrder();

    const document = await openReloadedDocument();
    const restored = valueOf(await readOrder(placed.id, { document }));

    // The record that was written, read back: identity, numbering, the instant it was placed, its status
    // and its whole history, and every figure it was priced at.
    expect(restored).toEqual(placed);
  });

  it("refuses that same order to a read presenting no credential", async () => {
    const placed = await placeOrder();

    const document = await openReloadedDocument();
    // The buyer's own browser is answered, so the read below is refused for the credential it lacks and
    // not for a missing order.
    expect(valueOf(await readOrder(placed.id, { document })).id).toBe(placed.id);

    const refused = refusalOf(await readWithCredential(placed.id, undefined, document));
    expect(refused.status).toBe(401);
  });

  it("refuses a shared link, and a credential minted for another order", async () => {
    const placed = await placeOrder();

    const document = await openReloadedDocument();
    const stranger = refusalOf(await readWithCredential(placed.id, FOREIGN_CREDENTIAL, document));
    expect(stranger.status).toBe(401);

    // A credential this browser holds for an order of its own opens that order and no other.
    const other = await placeOrder();
    const crossed = refusalOf(
      await document.getJson<Order>(fillApiPath(API_PATHS.ORDER_DETAIL, { id: placed.id }), {
        orderToken: other.idempotencyKey,
      }),
    );
    expect(crossed.status).toBe(401);
  });

  it("still refuses an anonymous read of the seeded account-less order", async () => {
    // The order this case reads belongs to the seeded history and names no account: no submission minted
    // a credential for it, which is why an administrator alone can reach it.
    expect(SEEDED.getOrder(SEEDED_GUEST_ORDER)?.customerId).toBeNull();

    const anonymous = refusalOf(await readWithCredential(SEEDED_GUEST_ORDER, undefined));
    expect(anonymous.status).toBe(401);

    // And a credential minted for an order this browser placed opens only the order it was minted for:
    // presenting it for a seeded account-less order is refused as well.
    const placed = await placeOrder();
    expect(placed.id).not.toBe(SEEDED_GUEST_ORDER);
    const forged = refusalOf(await readWithCredential(SEEDED_GUEST_ORDER, placed.idempotencyKey));
    expect(forged.status).toBe(401);
  });

  it("discards a stored payload this build cannot describe and serves the seeded history", () => {
    // What another build, or another application on this origin, could have left under the key: a list of
    // values that are not order records. It is discarded whole rather than handed to a store as orders.
    expect(writeStored(STORAGE_KEYS.PLACED_ORDERS, [{ id: "ord_1" }, { id: "ord_2" }])).toBe(true);

    const source = createSalesProDataSource();

    expect(source.getRecentOrders(3).every((order) => typeof order.orderNumber === "string")).toBe(
      true,
    );
    expect(source.getOrder(SEEDED_GUEST_ORDER)?.orderNumber).toBeDefined();
  });
});

// The account's own order -------------------------------------------------------------------------

describe("an account's own order after a reload", () => {
  beforeEach(() => {
    resetApiState();
  });

  it("reads it through the session that owns it, and refuses a non-owner", async () => {
    const token = await signInAsShopper();
    const placed = await placeOrder({ sessionToken: token });

    const document = await openReloadedDocument();
    // The session survived the reload through the durable session table, and the order through the record
    // this browser wrote, so the account reads its own order with the token it signed in with.
    const restored = valueOf(await readOrder(placed.id, { document, sessionToken: token }));
    expect(restored.id).toBe(placed.id);
    expect(restored.customerId).toBe(placed.customerId);

    // A freshly registered account owns nothing of this order: the read answers the same 404 a foreign
    // order answers, so a response cannot be read to learn which orders exist.
    const registered = await document.postJson<{ readonly session: { readonly token: string } }>(
      API_PATHS.AUTH_REGISTER,
      {
        email: "outsider@salespro.test",
        password: DEMO_ACCOUNTS.PASSWORD,
        firstName: "Ida",
        lastName: "Outsider",
        marketingOptIn: false,
      },
    );
    const outsider = valueOf(registered).session.token;

    const refused = refusalOf(
      await document.getJson<Order>(fillApiPath(API_PATHS.ORDER_DETAIL, { id: placed.id }), {
        sessionToken: outsider,
      }),
    );
    expect(refused.status).toBe(404);
  });

  it("lists it in the account's own history, and numbers the next order past it", async () => {
    const token = await signInAsShopper();
    const placed = await placeOrder({ sessionToken: token });

    const document = await openReloadedDocument();
    const history = valueOf(
      await document.listOrders({ page: 1, pageSize: 12 }, { sessionToken: token }),
    );

    // The created order is in the history the session owns, and leads it: it is the most recent one.
    expect(history.items.map((order) => order.id)).toContain(placed.id);
    expect(history.items[0]?.id).toBe(placed.id);

    // A submission after the reload is numbered past the restored order rather than behind it, so the
    // identifier the store hands out next and the order number it builds next are both that record's own
    // successors. Both read in placement order — an identifier is its index padded, a reference its day's
    // position padded — so "past" is a comparison of the values themselves, and a counter that had not
    // been lifted would hand this submission a value at or below the one the restored order holds.
    const second = await placeOrder({ document, sessionToken: token });
    expect(second.id > placed.id).toBe(true);
    expect(second.orderNumber > placed.orderNumber).toBe(true);

    // Both stand as records of their own, and the history the reload rebuilt lists each of them once.
    const after = valueOf(
      await document.listOrders({ page: 1, pageSize: 12 }, { sessionToken: token }),
    );
    const ids = after.items.map((order) => order.id);
    expect(ids).toContain(placed.id);
    expect(ids).toContain(second.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
