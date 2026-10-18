/**
 * Path: tests/unit/lib/mockServerHarness.ts
 * Purpose: The seam fixtures and assertions the mock-server specs share: the data source a case binds, the
 * first-entry, payload and refusal helpers, the signed-in customer, a submittable order body and the fake
 * Web Storage a durability case installs.
 * Lines: 152
 */

import { expect, vi } from "vitest";

import { DEMO_ACCOUNTS, FREE_SHIPPING_METHOD_ID } from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import { getJson, postJson } from "@/lib/apiClient";
import { registerDataSource, resetMockServer, type SalesProDataSource } from "@/lib/mockServer";
import type { Session } from "@/types/account";
import type { Product } from "@/types/catalog";
import type { ApiError, LineId, PageResult, Result } from "@/types/common";
import type { CartLine, PricedCart } from "@/types/commerce";

import { FIXED_NOW, makeAddress } from "../../fixtures";

/** The catalogue page size the paging case reads at: the largest configured, so a total spans few pages. */
export const PAGE_SIZE = 48;

/** The order rows a determinism pass samples: enough for the invariants that pass asserts. */
export const ORDER_SAMPLE = 40;

/** The first entry of a collection a case reads, or a failure naming the empty collection. */
export function firstOf<TItem>(items: readonly TItem[]): TItem {
  const [first] = items;
  if (first === undefined) throw new Error("The collection the case reads is empty.");
  return first;
}

/** The payload of a request the case expects to be answered. */
export async function valueOf<TValue>(pending: Promise<Result<TValue>>): Promise<TValue> {
  const result = await pending;
  if (!result.ok) throw new Error(`The request was refused with ${result.error.code}.`);
  return result.value;
}

/** The failure of a request the case expects to be refused. */
export async function refusalOf<TValue>(pending: Promise<Result<TValue>>): Promise<ApiError> {
  const result = await pending;
  if (result.ok) throw new Error("The request was answered where the case expects a refusal.");
  return result.error;
}

/** Asserts one refusal: the status and code the contract sets and the message every failure carries.
 * `label` names the case in a failure, because one case asserts five refusals in a row. */
export function expectRefusal(
  error: ApiError,
  status: number,
  code: string,
  label = "the refusal",
): void {
  expect(error.status, label).toBe(status);
  expect(error.code, label).toBe(code);
  expect(error.message.length, label).toBeGreaterThan(0);
}

/** Signs the seeded customer in, so a case carries a session the seam issued rather than one it built. */
export function signInCustomer(): Promise<Session> {
  return valueOf(
    postJson<Session>("/api/auth/login", {
      email: DEMO_ACCOUNTS.CUSTOMER_EMAIL,
      password: DEMO_ACCOUNTS.PASSWORD,
    }),
  );
}

/** A submittable order: a line built from a product the catalogue serves, priced by the seam so the
 * snapshot is the one a cart would carry, and the demonstration card the case names. */
export async function orderBody(idempotencyKey: string, cardNumber: string): Promise<object> {
  const query = { inStock: true, pageSize: PAGE_SIZE };
  const served = await valueOf(getJson<PageResult<Product>>("/api/products", { query }));
  const product = firstOf(served.items);
  // The identifier is hand-built and branded by the cast, the visible signal a generator did not make it.
  const line: CartLine = {
    id: `line_${product.id}` as LineId,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPriceMinor: product.priceMinor,
    quantity: 1,
    maxQuantity: product.stockOnHand,
    imageUrl: firstOf(product.images).url,
    addedAt: FIXED_NOW,
  };
  const pricing = { lines: [line], promoCode: null, shippingMethodId: FREE_SHIPPING_METHOD_ID };
  const snapshot = await valueOf(postJson<PricedCart>("/api/cart/price", pricing));
  const card = {
    number: cardNumber,
    nameOnCard: "Dana Okafor",
    expiryMonth: "12",
    expiryYear: "2032",
    cvc: "123",
  };
  return {
    snapshot,
    email: DEMO_ACCOUNTS.CUSTOMER_EMAIL,
    shippingAddress: makeAddress(),
    billingAddress: makeAddress({ label: "Billing" }),
    shippingMethodId: FREE_SHIPPING_METHOD_ID,
    payment: { method: "card", card },
    idempotencyKey,
  };
}

/** A fake Web Storage installed as `globalThis.localStorage` and backed by a Map, put back by the case's own
 * hook in every outcome, so what one document writes is what the next reads and no other case sees a store. */
export function installFakeStorage(): {
  readonly keys: () => string[];
  readonly getValue: (key: string) => string | null;
  readonly restore: () => void;
} {
  const entries = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        entries.set(key, value);
      },
      removeItem: (key: string): void => {
        entries.delete(key);
      },
    },
  });
  return {
    keys: () => [...entries.keys()],
    getValue: (key: string): string | null => entries.get(key) ?? null,
    restore: () => {
      if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Object.defineProperty(globalThis, "localStorage", original);
    },
  };
}

/**
 * Binds a fresh data source to the seam with the injected latency stubbed away: the state every case in both
 * specs starts from, because the seam reaches its data through a binding rather than an import.
 */
export function startSeam(): SalesProDataSource {
  vi.stubEnv("VITE_API_LATENCY_MS", "0");
  resetMockServer();
  const source = createSalesProDataSource();
  registerDataSource(source);
  return source;
}
