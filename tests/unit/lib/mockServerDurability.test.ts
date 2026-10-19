/**
 * Path: tests/unit/lib/mockServerDurability.test.ts
 * Purpose: The seam's durability across a document load: what a document writes is what the next reads, the sealed placement credential of an account-less order and a published review's own row included, two documents placing orders keep each other's records and never mint one order identifier between them, and a record whose window has run out is dropped rather than carried
 * Lines: 360
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  ORDER_PLACEMENT_TTL_MS,
  STORAGE_KEYS,
} from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import { getJson, postJson } from "@/lib/apiClient";
import { registerDataSource } from "@/lib/mockServer";
import type { RegistrationResult, Session } from "@/types/account";
import type { Product, Review } from "@/types/catalog";
import type { PageResult } from "@/types/common";
import type { Order } from "@/types/commerce";
import { isValidIso } from "@/utils/dates";
import { placementTokenFor } from "@/utils/orderPlacements";
import { placementToken } from "@/utils/strings";

import {
  ORDER_SAMPLE,
  PAGE_SIZE,
  expectRefusal,
  installFakeStorage,
  orderBody,
  refusalOf,
  signInCustomer,
  startSeam,
  valueOf,
} from "./mockServerHarness";

// What the seam guarantees across a document load, and what each case here drives it for: what one document
// writes is what the next reads — a placed order's placement credential and a published review's own row
// included — and two documents open at once never mint one order identifier between them. Every case drives
// the real seam over the seeded data source, installed behind a fake Web Storage so one document's writes are
// the next document's reads.

/** The page a case reads a product's reviews at: the size the harness exports, so a list read at it is the
 * one the product's own review page holds when the whole list fits a page. */
type ReviewPage = { readonly page: number; readonly pageSize: number };

/** The first product of a served page whose whole review list fits one page of it, read with those rows, so
 * the figures a published row implies are computed from them rather than from a seeded count, identifier or
 * rating written down here. A product holding no row is skipped: an equality over an empty list would hold
 * without proving the average is a reading of the rows. */
async function firstWholeReviewList(
  products: readonly Product[],
  page: ReviewPage,
): Promise<{ readonly product: Product; readonly rows: PageResult<Review> }> {
  for (const product of products) {
    const rows = await valueOf(
      getJson<PageResult<Review>>(`/api/products/${product.id}/reviews`, { query: page }),
    );
    if (rows.total > 0 && rows.total < page.pageSize) return { product, rows };
  }
  throw new Error("The seeded catalogue serves no product whose whole review list fits one page.");
}

/** The mean of a list of ratings to one decimal, computed here from those ratings rather than read from the
 * module the figures under test come from, so a case asserts a reading of its own rows. */
function meanRating(ratings: readonly number[]): number {
  const total = ratings.reduce((running, rating) => running + rating, 0);
  return Math.round((total / ratings.length) * 10) / 10;
}

/** The store a case reads the durable payload through, as the harness hands it back. */
type FakeStore = ReturnType<typeof installFakeStorage>;

/** The rows the store holds for the placements, read exactly as they were written. */
function durableRows(store: FakeStore): Record<string, unknown>[] {
  const raw = store.getValue(STORAGE_KEYS.ORDER_TOKENS);
  if (raw === null) return [];
  const payload = JSON.parse(raw) as { readonly value?: readonly Record<string, unknown>[] };
  return [...(payload.value ?? [])];
}

describe("durability across a document load", () => {
  beforeEach(() => {
    startSeam();
  });

  /** The store the case in progress installed, put back by the hook below in every outcome. */
  let storage: ReturnType<typeof installFakeStorage> | null = null;

  afterEach(() => {
    storage?.restore();
    storage = null;
    vi.useRealTimers();
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
    const orderToken = placementToken();
    const placed = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-placement-durable", DEMO_CARD_NUMBERS.APPROVED),
        { orderToken },
      ),
    );
    expect(placed.customerId).toBeNull();
    // The credential is durable, written through the product's one storage utility under the key the product
    // declares (STORAGE_KEYS.ORDER_TOKENS), which is what lets the confirmation of an account-less order
    // reopen after a reload instead of only inside the document that placed it.
    const written = storage.keys();
    expect(written).toContain(STORAGE_KEYS.ORDER_TOKENS);
    const stored = JSON.parse(storage.getValue(STORAGE_KEYS.ORDER_TOKENS) ?? "{}") as {
      readonly value?: readonly {
        readonly orderId?: string;
        readonly token?: string;
        readonly expiresAt?: string;
        readonly seal?: string;
      }[];
    };
    expect(stored.value?.map((entry) => entry.orderId)).toEqual([placed.id]);
    // What is recorded is the credential the submission presented — the random value the placing client
    // minted for the attempt — and never the idempotency key it submitted under, whose shape the client
    // publishes beside the code that mints it.
    expect(orderToken).toMatch(/^plc_\S+$/);
    expect(stored.value?.[0]?.token).toBe(orderToken);
    expect(stored.value?.[0]?.token).not.toBe("key-placement-durable");
    // The seal beside the members is what proves this browser recorded them: a payload a script wrote carries
    // no such value, and one whose credential or window was edited no longer verifies against it.
    expect(stored.value?.[0]?.seal).toMatch(/^[0-9a-f]{16}$/);
    // The record carries the instant its credential stops being usable, one placement window after the order
    // was placed, so the read it authorises is bounded rather than open for ever.
    const expiresAt = stored.value?.[0]?.expiresAt ?? "";
    expect(isValidIso(expiresAt)).toBe(true);
    expect(Date.parse(expiresAt)).toBe(Date.parse(placed.placedAt) + ORDER_PLACEMENT_TTL_MS);
    expect((await valueOf(getJson<Order>(`/api/orders/${placed.id}`, { orderToken }))).id).toBe(
      placed.id,
    );
  });

  it("keeps the placement another document recorded when it writes one of its own", async () => {
    const store = installFakeStorage();
    storage = store;
    // The first document places its order: the record it leaves behind is the durable half a later document
    // reads, and the credential it minted is the only thing its own confirmation can come back with.
    const firstCredential = placementToken();
    const first = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-merge-first", DEMO_CARD_NUMBERS.APPROVED),
        { orderToken: firstCredential },
      ),
    );
    // The second document is built over the same storage and places an order of its own. The list it writes is
    // composed from the durable records the store holds at that moment — a fresh read, not a list the document
    // took with it — so the first document's record is still in it: neither placement replaces the other's.
    const second = createSalesProDataSource();
    registerDataSource(second);
    const secondCredential = placementToken();
    const later = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-merge-second", DEMO_CARD_NUMBERS.APPROVED),
        { orderToken: secondCredential },
      ),
    );
    expect(later.id).not.toBe(first.id);
    expect(durableRows(store).map((row) => row.orderId)).toEqual([later.id, first.id]);
    expect(placementTokenFor(first.id)).toBe(firstCredential);
    expect(placementTokenFor(later.id)).toBe(secondCredential);
    // Both credentials read their own order back, which is what losing a record would have taken away.
    for (const [id, credential] of [
      [first.id, firstCredential],
      [later.id, secondCredential],
    ] as const) {
      expect(
        (await valueOf(getJson<Order>(`/api/orders/${id}`, { orderToken: credential }))).id,
      ).toBe(id);
    }
  });

  it("drops a record whose window has run out rather than carrying it forward", async () => {
    const realNow = Date.now();
    const store = installFakeStorage();
    storage = store;
    // The order was placed a window and a day ago, so the record the product wrote for it is genuine and out
    // of its own window by the time the next placement composes the list.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(realNow - ORDER_PLACEMENT_TTL_MS - 24 * 60 * 60 * 1000));
    const lapsedCredential = placementToken();
    const lapsed = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-merge-lapsed", DEMO_CARD_NUMBERS.APPROVED),
        {
          orderToken: lapsedCredential,
        },
      ),
    );
    vi.setSystemTime(new Date(realNow));
    expect(durableRows(store).map((row) => row.orderId)).toEqual([lapsed.id]);

    const freshCredential = placementToken();
    const fresh = await valueOf(
      postJson<Order>(
        "/api/orders",
        await orderBody("key-merge-fresh", DEMO_CARD_NUMBERS.APPROVED),
        {
          orderToken: freshCredential,
        },
      ),
    );
    // The write kept the live record it was composing from and left the lapsed one behind, so a credential
    // nothing can be read with is not carried into every later write of the list.
    expect(durableRows(store).map((row) => row.orderId)).toEqual([fresh.id]);
    expect(placementTokenFor(fresh.id)).toBe(freshCredential);
    expect(placementTokenFor(lapsed.id)).toBeNull();
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

  it("carries a published review into the next document, with the figures its rows imply", async () => {
    const store = installFakeStorage();
    storage = store;
    const session = await signInCustomer();
    const page = { page: 1, pageSize: PAGE_SIZE };
    const served = await valueOf(getJson<PageResult<Product>>("/api/products", { query: page }));
    const reviewed = await firstWholeReviewList(served.items, page);
    const path = `/api/products/${reviewed.product.id}/reviews`;

    const submission = {
      rating: 5,
      title: "Durability checkpoint review",
      body: "Written to prove the row outlives the document that published it.",
    };
    const written = await valueOf(
      postJson<Review>(path, submission, { sessionToken: session.token }),
    );

    // The product read of the document that accepted it answers the rows it now lists: the seam's own row
    // counted, and the average a mean of that product's ratings to one decimal.
    const ratings = [...reviewed.rows.items.map((row) => row.rating), written.rating];
    const figures = await valueOf(getJson<Product>(`/api/products/${reviewed.product.id}`));
    expect(figures.ratingCount).toBe(reviewed.rows.total + 1);
    expect(figures.ratingAverage).toBe(meanRating(ratings));

    // The write went through the one storage util, under the key the product declares, and the row the
    // record holds is the one the seam answered with — the text the visitor was told was published.
    const payload = store.getValue(STORAGE_KEYS.CLIENT_WRITES);
    expect(payload, "the record of this browser's own writes").not.toBeNull();
    const record = JSON.parse(payload ?? "") as {
      readonly value?: { readonly reviews?: readonly Review[] };
    };
    expect(record.value?.reviews?.[0]).toEqual(written);
    expect(payload).toContain(submission.title);

    // The next document: an independent source over the same store, with nothing else carried across. It
    // lists the row and derives the same figures from the rows it serves, which is what makes the
    // confirmation of a publication true rather than lost on the load that follows it.
    const next = createSalesProDataSource();
    const nextPage = next.listProductReviews({
      productId: reviewed.product.id,
      page: 1,
      pageSize: PAGE_SIZE,
    });
    expect(nextPage.total).toBe(reviewed.rows.total + 1);
    expect(nextPage.items.map((row) => row.id)).toContain(written.id);
    const carried = next.getProduct(reviewed.product.id);
    expect(carried?.ratingCount).toBe(figures.ratingCount);
    expect(carried?.ratingAverage).toBe(figures.ratingAverage);
  });
});
