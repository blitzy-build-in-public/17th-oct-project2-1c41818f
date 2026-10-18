/**
 * Path: tests/unit/lib/mockServerDurability.test.ts
 * Purpose: The seam's durability across a document load: what a document writes is what the next reads, the
 * placement credential of an account-less order included, and two documents open at once never mint one order identifier between them
 * Lines: 154
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, DEMO_CARD_NUMBERS, STORAGE_KEYS } from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import { postJson } from "@/lib/apiClient";
import { registerDataSource } from "@/lib/mockServer";
import type { RegistrationResult, Session } from "@/types/account";
import type { Order } from "@/types/commerce";

import {
  ORDER_SAMPLE,
  expectRefusal,
  installFakeStorage,
  orderBody,
  refusalOf,
  startSeam,
  valueOf,
} from "./mockServerHarness";

// The durability half of the mock-server suite, split out of tests/unit/lib/mockServer.test.ts per §0.5.5
// because that file stood over the 600-line ceiling and the ceiling is never raised. Every case drives the
// real seam over the seeded data source, installed behind a fake Web Storage so one document's writes are
// the next document's reads.

describe("durability across a document load", () => {
  beforeEach(() => {
    startSeam();
  });

  /** The store the case in progress installed, put back by the hook below in every outcome. */
  let storage: ReturnType<typeof installFakeStorage> | null = null;

  afterEach(() => {
    storage?.restore();
    storage = null;
  });

  it("carries a placed order and a registered account into the next document", async () => {
    const store = installFakeStorage();
    storage = store;
    const account = await valueOf(
      postJson<RegistrationResult>("/api/auth/register", {
        email: "durable@salespro.test",
        password: DEMO_ACCOUNTS.PASSWORD,
        firstName: "Quinn",
        lastName: "Durable",
        marketingOptIn: false,
      }),
    );
    const placed = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-first-document", DEMO_CARD_NUMBERS.APPROVED),
        { sessionToken: account.session.token },
      ),
    );
    // The document that wrote them went through the one storage util, under the key the product declares.
    expect(store.keys()).toContain(STORAGE_KEYS.CLIENT_WRITES);

    // The next document: an independent source over the same store, with nothing else carried across.
    const next = createSalesProDataSource();
    const resolved = next.getOrder(placed.id);
    expect(resolved?.orderNumber).toBe(placed.orderNumber);
    expect(resolved?.lines).toEqual(placed.lines);
    const history = next.listOrders({
      customerId: account.customer.id,
      page: 1,
      pageSize: ORDER_SAMPLE,
    });
    expect(history.items.map((order) => order.id)).toContain(placed.id);

    // The account's own session and credentials, as the document that registered it left them.
    const restored = next.restoreSession(account.session.token);
    expect(restored.ok ? restored.value.customerId : null).toBe(account.customer.id);
    registerDataSource(next);
    const signedIn = await valueOf(
      postJson<Session>("/api/auth/login", {
        email: "durable@salespro.test",
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    expect(signedIn.customerId).toBe(account.customer.id);
    // The registered email is a held account there too, so registering it again is the same duplicate.
    const duplicate = await refusalOf(
      postJson("/api/auth/register", {
        email: "durable@salespro.test",
        password: DEMO_ACCOUNTS.PASSWORD,
        firstName: "Quinn",
        lastName: "Durable",
        marketingOptIn: false,
      }),
    );
    expectRefusal(duplicate, 409, "duplicate-email");

    // One order per document, and neither the identifier nor the number the first document minted: the
    // marks the mint reads are durable, not re-derived from the seed each document loads.
    const later = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-second-document", DEMO_CARD_NUMBERS.APPROVED),
        { sessionToken: account.session.token },
      ),
    );
    expect(later.id).not.toBe(placed.id);
    expect(later.orderNumber).not.toBe(placed.orderNumber);
    expect(next.getRecentOrders(1)[0]?.id).toBe(later.id);
  });

  it("records the placement credential of an account-less order, so a later document can read it back", async () => {
    storage = installFakeStorage();
    const placed = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-placement-durable", DEMO_CARD_NUMBERS.APPROVED),
      ),
    );
    expect(placed.customerId).toBeNull();
    // The credential is durable, written through the one storage util under the key the product declares:
    // that is what lets the confirmation of an order placed here reopen after a reload (findings
    // `cr15-I06`, `qa5-20`, `qa7-10`-class reloads) rather than only in the document that placed it.
    const written = storage.keys();
    expect(written).toContain(STORAGE_KEYS.ORDER_TOKENS);
    const stored = JSON.parse(storage.getValue(STORAGE_KEYS.ORDER_TOKENS) ?? "{}") as {
      readonly value?: readonly { readonly orderId?: string; readonly token?: string }[];
    };
    expect(stored.value).toEqual([{ orderId: placed.id, token: "key-placement-durable" }]);
  });

  it("keeps two documents open at once from minting one identifier between them", async () => {
    storage = installFakeStorage();
    // Both are built before either writes, so only what the mint reads from the record keeps them apart.
    const first = createSalesProDataSource();
    const second = createSalesProDataSource();
    registerDataSource(first);
    const earlier = await valueOf(
      postJson<Order>("/api/orders", await orderBody("key-tab-one", DEMO_CARD_NUMBERS.APPROVED)),
    );
    registerDataSource(second);
    const later = await valueOf(
      postJson<Order>("/api/orders", await orderBody("key-tab-two", DEMO_CARD_NUMBERS.APPROVED)),
    );
    expect(first.getOrder(earlier.id)).toBeDefined();
    expect(second.getOrder(earlier.id)).toBeUndefined();
    expect(later.id).not.toBe(earlier.id);
    expect(later.orderNumber).not.toBe(earlier.orderNumber);
  });
});
