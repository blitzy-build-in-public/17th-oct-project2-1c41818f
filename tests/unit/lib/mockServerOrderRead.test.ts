/**
 * Path: tests/unit/lib/mockServerOrderRead.test.ts
 * Purpose: The order read's own decisions and the submission's session check: an account-less order answered to the placement credential its own submission minted for as long as that credential's window is open, or to an administrator alone; a durable placement record answered only while the seal beside its members proves this browser wrote it, so a hand-written entry, an entry edited after it was written and a lapsed window each read nothing; an identifier that holds an order and one that holds none refused alike to every caller without a usable credential; a submission carrying a token the store cannot resolve refused rather than placed as a guest's; and the same refusal a foreign order gets for everyone else
 * Lines: 325
 */

import { describe, expect, it, afterEach, vi } from "vitest";

import {
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  ORDER_PLACEMENT_TTL_MS,
  STORAGE_KEYS,
} from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import { getJson, postJson } from "@/lib/apiClient";
import { registerDataSource } from "@/lib/mockServer";
import type { Session } from "@/types/account";
import type { Order } from "@/types/commerce";
import { toIsoDateTime } from "@/utils/dates";
import { clearPlacements, placementTokenFor } from "@/utils/orderPlacements";
import { orderId, placementToken } from "@/utils/strings";
import { writeStored } from "@/utils/storage";

import {
  expectRefusal,
  firstOf,
  installFakeStorage,
  orderBody,
  refusalOf,
  signInCustomer,
  startSeam,
  valueOf,
} from "./mockServerHarness";

// The authorisation rule these cases prove: an order that names no account is answered to the credential it
// was placed with, or to an administrator, and every other caller gets the same `404` a foreign order gets,
// so a response cannot be read to learn whether an identifier exists. Each case drives the real seam over the
// seeded data source and binds its own source through the harness.

/** A row limit past the seeded order count, so a count reads the whole collection it is about. */
const ALL_ROWS = 10_000;

/** The store a case installs, as the harness hands it back. */
type FakeStore = ReturnType<typeof installFakeStorage>;

/** The rows the store holds for the placements, read exactly as they were written, so a case can rewrite the
 * payload the way a script in the page would. */
function durableRows(store: FakeStore): Record<string, unknown>[] {
  const raw = store.getValue(STORAGE_KEYS.ORDER_TOKENS);
  if (raw === null) return [];
  const payload = JSON.parse(raw) as { readonly value?: readonly Record<string, unknown>[] };
  return [...(payload.value ?? [])];
}

/** Writes the rows a case composed, through the product's own storage util under the key the product
 * declares — the one path any payload reaches the store by, whether the product or a script wrote it. */
function writeDurableRows(rows: readonly Record<string, unknown>[]): void {
  writeStored<readonly Record<string, unknown>[]>(STORAGE_KEYS.ORDER_TOKENS, rows);
}

/** Places an account-less order through the seam under a credential of its own, so every record a case reads
 * back is one the product wrote rather than one the case wrote down. */
async function placeGuestOrder(
  key: string,
): Promise<{ readonly order: Order; readonly credential: string }> {
  const credential = placementToken();
  const order = await valueOf(
    postJson<Order>("/api/orders", await orderBody(key, DEMO_CARD_NUMBERS.APPROVED), {
      orderToken: credential,
    }),
  );
  return { order, credential };
}

/** The state a document that did not place the order is in: nothing remembered in memory, and the durable
 * payload exactly as the case left it. Clearing is the module's own way to forget what a document held, so
 * what a case reads after this is the durable half alone — which is what a reload amounts to for a case that
 * cannot reload the page. */
function asAnotherDocument(store: FakeStore): void {
  const held = durableRows(store);
  clearPlacements();
  writeDurableRows(held);
}

describe("order-detail authorisation", () => {
  it("answers an account-less order to its placement credential alone, and serves an administrator", async () => {
    // A seeded order that names no account is answered to an administrator; a caller that sent no session is
    // refused, and a signed-in customer is refused with the same `404` a foreign account-owned order answers,
    // so a response cannot be read to learn whether an identifier exists.
    const source = startSeam();
    const seeded = source.getRecentOrders(ALL_ROWS).find((order) => order.customerId === null);
    if (seeded === undefined) throw new Error("The seeded orders hold no account-less order.");
    const seededPath = `/api/orders/${seeded.id}`;
    expectRefusal(await refusalOf(getJson(seededPath)), 401, "unauthenticated");
    const shopper = await signInCustomer();
    expectRefusal(
      await refusalOf(getJson(seededPath, { sessionToken: shopper.token })),
      404,
      "order-not-found",
    );
    const admin = await valueOf(
      postJson<Session>("/api/auth/login", {
        email: DEMO_ACCOUNTS.ADMIN_EMAIL,
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    expect((await valueOf(getJson<Order>(seededPath, { sessionToken: admin.token }))).id).toBe(
      seeded.id,
    );

    // An order created with no session answers the credential its own submission minted, and nothing else:
    // neither the bare identifier, nor the idempotency key the attempt was submitted under — a readable
    // value that names the attempt rather than a credential — nor a credential of another mint.
    const key = "key-placement-credential";
    const orderToken = placementToken();
    const body = await orderBody(key, DEMO_CARD_NUMBERS.APPROVED);
    const created = await valueOf(postJson<Order>("/api/orders", body, { orderToken }));
    expect(created.customerId).toBeNull();
    const createdPath = `/api/orders/${created.id}`;
    const uncredentialed = [
      getJson(createdPath),
      getJson(createdPath, { orderToken: key }),
      getJson(createdPath, { orderToken: placementToken() }),
    ];
    for (const pending of uncredentialed) {
      expectRefusal(await refusalOf(pending), 401, "unauthenticated");
    }
    expect((await valueOf(getJson<Order>(createdPath, { orderToken }))).id).toBe(created.id);
    // The credential is held against the order it placed, not as a key to every account-less order.
    expectRefusal(await refusalOf(getJson(seededPath, { orderToken })), 401, "unauthenticated");

    // The same submission carrying a token no session answers is refused rather than placed as a guest's — a
    // buyer whose session lapsed is told to sign in again — while the tokenless one above was a guest's and was
    // placed as one, and nothing is created for the refused attempt.
    const newest = firstOf(source.getRecentOrders(1)).id;
    const refused = await refusalOf(postJson("/api/orders", body, { sessionToken: "ses_absent" }));
    expectRefusal(refused, 401, "session-unknown");
    expect(firstOf(source.getRecentOrders(1)).id).toBe(newest);
  });
});

describe("the placement record a document reads back", () => {
  /** The store the case installs, put back in every outcome so no later case reads through it. */
  let storage: FakeStore | null = null;

  afterEach(() => {
    storage?.restore();
    storage = null;
    vi.useRealTimers();
  });

  it("answers a guest's own credential after the document that placed the order is gone", async () => {
    startSeam();
    storage = installFakeStorage();
    const { order, credential } = await placeGuestOrder("key-reload");
    expect(order.customerId).toBeNull();

    // The durable record is the one the product itself wrote: the credential its submission presented, the
    // window that credential is usable in, and the seal beside them, which is what tells this record from one
    // a script wrote into the key.
    const rows = durableRows(storage);
    expect(rows.map((row) => row.orderId)).toEqual([order.id]);
    expect(rows[0]?.token).toBe(credential);
    expect(rows[0]?.seal).toMatch(/^[0-9a-f]{16}$/);

    // The document that placed the order is gone: nothing remembered in memory, the durable payload as it was
    // left, and a second store built over the same storage — the reload the confirmation route comes back from.
    asAnotherDocument(storage);
    const next = createSalesProDataSource();
    registerDataSource(next);
    const path = `/api/orders/${order.id}`;
    expect(next.getOrder(order.id)?.id).toBe(order.id);
    expect(placementTokenFor(order.id)).toBe(credential);
    expect((await valueOf(getJson<Order>(path, { orderToken: credential }))).id).toBe(order.id);
    // The record answers the credential it carries and no other.
    expectRefusal(
      await refusalOf(getJson(path, { orderToken: placementToken() })),
      401,
      "unauthenticated",
    );
  });

  it("refuses a hand-written entry, and takes only itself away", async () => {
    startSeam();
    storage = installFakeStorage();
    const { order, credential } = await placeGuestOrder("key-hand-written");
    const genuine = durableRows(storage);
    asAnotherDocument(storage);
    const path = `/api/orders/${order.id}`;
    // The entry a hand-written payload carries: a credential nobody minted, a window in the future, the same
    // shape as a real record — and no seal, because a seal is not something a writer can produce.
    const madeUp = placementToken();
    const window = toIsoDateTime(new Date(Date.now() + ORDER_PLACEMENT_TTL_MS));

    writeDurableRows([{ orderId: order.id, token: madeUp, expiresAt: window }]);
    expectRefusal(await refusalOf(getJson(path, { orderToken: madeUp })), 401, "unauthenticated");
    // No payload reaches the caller: the payload holds only that entry, and an entry that cannot be proved
    // is not a record at all, so the credential the product recorded reads nothing either while it stands.
    expectRefusal(
      await refusalOf(getJson(path, { orderToken: credential })),
      401,
      "unauthenticated",
    );

    // Written over the records this browser holds, the entry is dropped on its own and the record beside it
    // still answers its own credential.
    writeDurableRows([{ orderId: order.id, token: madeUp, expiresAt: window }, ...genuine]);
    expectRefusal(await refusalOf(getJson(path, { orderToken: madeUp })), 401, "unauthenticated");
    expect((await valueOf(getJson<Order>(path, { orderToken: credential }))).id).toBe(order.id);
    expect(placementTokenFor(order.id)).toBe(credential);

    // The entry an earlier build wrote — a submission's idempotency key as the credential and no expiry at
    // all — is not a record this build describes, so it is discarded rather than honoured as a credential
    // that never lapses; the same goes for a window this module cannot read.
    const key = "ord_attempt-m3k-1";
    writeDurableRows([{ orderId: order.id, token: key }]);
    expectRefusal(await refusalOf(getJson(path, { orderToken: key })), 401, "unauthenticated");
    writeDurableRows([
      { orderId: order.id, token: credential, expiresAt: "the day after tomorrow" },
    ]);
    expectRefusal(
      await refusalOf(getJson(path, { orderToken: credential })),
      401,
      "unauthenticated",
    );
    expect(placementTokenFor(order.id)).toBeNull();
  });

  /** The two members a hand-written payload can edit while leaving the seal in place: the credential the
   * record carries and the window it is usable in. */
  const EDITS: readonly (readonly [
    string,
    (row: Record<string, unknown>) => Record<string, unknown>,
  ])[] = [
    ["credential", (row) => ({ ...row, token: placementToken() })],
    [
      "window",
      (row) => ({
        ...row,
        expiresAt: toIsoDateTime(new Date(Date.now() + 2 * ORDER_PLACEMENT_TTL_MS)),
      }),
    ],
  ];

  it.each(EDITS)(
    "refuses a record whose %s was edited after it was placed",
    async (_member, edit) => {
      startSeam();
      storage = installFakeStorage();
      const { order, credential } = await placeGuestOrder("key-edited");
      const edited = durableRows(storage).map(edit);
      asAnotherDocument(storage);
      writeDurableRows(edited);
      const path = `/api/orders/${order.id}`;

      // The seal was written over the members as they were, so a record whose credential or window was changed
      // after that no longer verifies: neither the edited value nor the credential the submission minted reads
      // the order, and the client holds nothing to send for it either.
      const presented = typeof edited[0]?.token === "string" ? edited[0].token : credential;
      expectRefusal(
        await refusalOf(getJson(path, { orderToken: presented })),
        401,
        "unauthenticated",
      );
      expectRefusal(
        await refusalOf(getJson(path, { orderToken: credential })),
        401,
        "unauthenticated",
      );
      expect(placementTokenFor(order.id)).toBeNull();
    },
  );

  it("refuses a credential whose window has lapsed", async () => {
    const realNow = Date.now();
    startSeam();
    storage = installFakeStorage();
    // The order was placed a window and a day ago: the record is the genuine one the product wrote, and only
    // its window has run out.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(realNow - ORDER_PLACEMENT_TTL_MS - 24 * 60 * 60 * 1000));
    const { order, credential } = await placeGuestOrder("key-lapsed");
    vi.setSystemTime(new Date(realNow));
    const path = `/api/orders/${order.id}`;

    // The record is still held — nothing has written the list since — which is what makes this case the window
    // rule rather than the seal: a credential worth one window reads nothing once that window has passed.
    expect(durableRows(storage).map((row) => row.orderId)).toEqual([order.id]);
    expectRefusal(
      await refusalOf(getJson(path, { orderToken: credential })),
      401,
      "unauthenticated",
    );
    expect(placementTokenFor(order.id)).toBeNull();
  });
});

describe("what a caller without a usable credential is told", () => {
  it("answers an identifier that holds an order and one that holds none alike", async () => {
    const source = startSeam();
    const held = firstOf(source.getRecentOrders(1)).id;
    const absent = orderId("999999");
    expect(source.getOrder(held)).toBeDefined();
    expect(source.getOrder(absent)).toBeUndefined();
    // Existence is not observable to a caller that cannot present a usable credential: no credential at all, a
    // token the store cannot resolve, and a foreign placement credential are each refused identically, and an
    // identifier no order holds is refused exactly as one that holds an order is.
    for (const options of [{}, { sessionToken: "ses_absent" }, { orderToken: placementToken() }]) {
      const onHeld = await refusalOf(getJson(`/api/orders/${held}`, options));
      const onAbsent = await refusalOf(getJson(`/api/orders/${absent}`, options));
      expect(onHeld.status).toBe(401);
      expect(onAbsent).toEqual(onHeld);
    }
    // The pair is told apart only by a caller the store lets through, and then only by ownership: a resolved
    // session answers its own order, and another account's order with the same `404` an absent identifier
    // earns — never the `403` that would say the record is there.
    const shopper = await signInCustomer();
    const withSession = { sessionToken: shopper.token };
    const foreign = await refusalOf(getJson(`/api/orders/${held}`, withSession));
    const unknown = await refusalOf(getJson(`/api/orders/${absent}`, withSession));
    expect([foreign.status, foreign.code]).toEqual([404, "order-not-found"]);
    expect(unknown).toEqual(foreign);
  });
});
