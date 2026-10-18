/**
 * Path: tests/unit/lib/mockServer.test.ts
 * Purpose: Route matching, error mapping, catalogue filter reading, review scoping, idempotency replay, the unregistered-source failure and seed determinism.
 * Lines: 529
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_API_LATENCY_MS,
  DEFAULT_PAGE_SIZE,
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  FREE_SHIPPING_METHOD_ID,
} from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import {
  buildQueryString,
  clearInjectedFailures as clearThroughClient,
  deleteJson,
  failNext as armThroughClient,
  getJson,
  patchJson,
  postJson,
  request,
  resetApiClient,
  toApiError,
} from "@/lib/apiClient";
import {
  API_ERROR_CODES,
  FALLBACK_FAILURE_MESSAGE,
  SESSION_TOKEN_HEADER,
  clearInjectedFailures,
  failNext,
  getApiLatencyMs,
  handleRequest,
  isDataSourceRegistered,
  matchRoute,
  registerDataSource,
  resetMockServer,
  type SalesProDataSource,
} from "@/lib/mockServer";
import type { Customer, Session } from "@/types/account";
import type { Category, Product } from "@/types/catalog";
import type { ApiError, LineId, PageResult, Result } from "@/types/common";
import type { CartLine, Order, PricedCart } from "@/types/commerce";
import { createAbortError, isAbortError } from "@/utils/async";
import { compareIso } from "@/utils/dates";
import { FILTER_PARAMS } from "@/utils/queryParams";

import { FIXED_DATE_RANGE, FIXED_NOW, makeAddress, makeFilterState } from "../../fixtures";

// The seam's own contract, driven at the seam: no DOM, no provider and no rendering take part, so every
// case runs in the node project, and the data source is bound per case because the seam reaches its data
// through a binding rather than an import — the rule the unbound-seam cases prove.

/** The catalogue page size the paging case reads at: the largest configured, so a total spans few pages. */
const PAGE_SIZE = 48;
/** A row limit past the seeded order count, so a count reads the whole collection it is about. */
const ALL_ROWS = 10_000;
/** The order rows a determinism pass samples: enough for the invariants that pass asserts. */
const ORDER_SAMPLE = 40;

/** The static paths the route table answers and the route each resolves to: the catalogue of report
 * definitions resolves as `reports.list` and a named report run as `reports.run`. */
const STATIC_ROUTES: [string, string][] = [
  ["/api/products", "products.list"],
  ["/api/categories", "categories.list"],
  ["/api/facets", "facets.list"],
  ["/api/reports/definitions", "reports.list"],
  ["/api/reports/sales", "reports.run"],
];

/** The numeric filter members a malformed value can arrive on, against the two paths that read a
 * filter: `GET /api/facets` takes the same parameters as the listing, so both answer their own `422`. */
const MALFORMED_FILTERS: [string, string][] = [
  ["/api/products", FILTER_PARAMS.MIN_PRICE],
  ["/api/products", FILTER_PARAMS.MAX_PRICE],
  ["/api/products", FILTER_PARAMS.MIN_RATING],
  ["/api/facets", FILTER_PARAMS.MIN_PRICE],
];

/** The registration body the two account cases submit, well formed so only the field under test differs. */
const REGISTRATION = {
  email: DEMO_ACCOUNTS.CUSTOMER_EMAIL,
  password: DEMO_ACCOUNTS.PASSWORD,
  firstName: "Dana",
  lastName: "Okafor",
};

/** The data source the case in progress is answered from, bound by the hook at the foot of this block. */
let source: SalesProDataSource;

/** The first entry of a collection a case reads, or a failure naming the empty collection. */
function firstOf<TItem>(items: readonly TItem[]): TItem {
  const [first] = items;
  if (first === undefined) throw new Error("The collection the case reads is empty.");
  return first;
}

/** The payload of a request the case expects to be answered. */
async function valueOf<TValue>(pending: Promise<Result<TValue>>): Promise<TValue> {
  const result = await pending;
  if (!result.ok) throw new Error(`The request was refused with ${result.error.code}.`);
  return result.value;
}

/** The failure of a request the case expects to be refused. */
async function refusalOf<TValue>(pending: Promise<Result<TValue>>): Promise<ApiError> {
  const result = await pending;
  if (result.ok) throw new Error("The request was answered where the case expects a refusal.");
  return result.error;
}

/** Asserts one refusal: the status and code the contract sets and the message every failure carries.
 * `label` names the case in a failure, because one case asserts five refusals in a row. */
function expectRefusal(error: ApiError, status: number, code: string, label = "the refusal"): void {
  expect(error.status, label).toBe(status);
  expect(error.code, label).toBe(code);
  expect(error.message.length, label).toBeGreaterThan(0);
}

/** Signs the seeded customer in, so a case carries a session the seam issued rather than one it built. */
function signInCustomer(): Promise<Session> {
  return valueOf(
    postJson<Session>("/api/auth/login", {
      email: DEMO_ACCOUNTS.CUSTOMER_EMAIL,
      password: DEMO_ACCOUNTS.PASSWORD,
    }),
  );
}

/** A submittable order: a line built from a product the catalogue serves, priced by the seam so the
 * snapshot is the one a cart would carry, and the demonstration card the case names. */
async function orderBody(idempotencyKey: string, cardNumber: string): Promise<object> {
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

/** The product a bootstrap's review read is scoped by: the one the pass's own catalogue page holds with the
 * most reviews, so the scoping the determinism case asserts is asserted over rows rather than over an empty
 * list, and both passes pick the same product without a seeded identifier being written down here. */
function mostReviewed(products: readonly Product[]): Product {
  return products.reduce(
    (best, one) => (one.ratingCount > best.ratingCount ? one : best),
    firstOf(products),
  );
}

/** One independent bootstrap of the seeded data, read through the data source's own accessors. The module
 * registry is reset first, so two passes share no module state and the second is not the first's store. */
async function captureSeed() {
  vi.resetModules();
  const data = await import("@/data/repositories");
  const booted = data.createSalesProDataSource();
  const products = booted.listProducts(makeFilterState({ pageSize: PAGE_SIZE }));
  const reviewed = mostReviewed(products.items);
  return {
    categories: booted.listCategories(),
    brands: booted.listBrands(),
    products,
    reviewed,
    reviews: booted.listProductReviews({ productId: reviewed.id, page: 1, pageSize: PAGE_SIZE }),
    orders: booted.getRecentOrders(ORDER_SAMPLE),
    credential: booted.findSignInCredential(DEMO_ACCOUNTS.CUSTOMER_EMAIL),
    kpis: booted.getKpis(FIXED_DATE_RANGE),
    revenue: booted.getRevenueSeries(FIXED_DATE_RANGE),
    reports: booted.listReportDefinitions(),
  };
}

beforeEach(() => {
  vi.stubEnv("VITE_API_LATENCY_MS", "0");
  resetMockServer();
  source = createSalesProDataSource();
  registerDataSource(source);
});

describe("route matching", () => {
  it.each(STATIC_ROUTES)("resolves %s as %s", (path, routeId) => {
    expect(matchRoute("GET", path)?.routeId).toBe(routeId);
  });

  it("captures a path parameter as the identifier it names, never as a position", async () => {
    const served = await valueOf(getJson<PageResult<Product>>("/api/products"));
    const product = firstOf(served.items);
    const order = firstOf(source.getRecentOrders(1));
    expect(product.id.startsWith("prod_")).toBe(true);
    expect(order.id.startsWith("ord_")).toBe(true);
    expect(matchRoute("GET", `/api/products/${product.id}`)?.params).toEqual({ id: product.id });
    expect(matchRoute("GET", `/api/orders/${order.id}`)?.params).toEqual({ id: order.id });
    expect(matchRoute("PATCH", "/api/customers/cus_1/addresses/adr_2")?.params).toEqual({
      id: "cus_1",
      addressId: "adr_2",
    });
    expect(matchRoute("GET", "/api/products?page=2")?.params).toEqual({});
  });

  it("answers an unknown path as a value rather than by throwing", async () => {
    expect(matchRoute("GET", "/api/no-such-endpoint")).toBeNull();
    expect(matchRoute("GET", "/api/products/prod_1/nothing")).toBeNull();
    expectRefusal(await refusalOf(handleRequest("/api/no-such-endpoint")), 404, "route-not-found");
  });
});

describe("refusals", () => {
  it("maps each refusal to the status, code and message the contract names", async () => {
    const session = await signInCustomer();
    const declined = await orderBody("key-declined", DEMO_CARD_NUMBERS.DECLINED);
    const range = { from: FIXED_DATE_RANGE.from, to: FIXED_DATE_RANGE.to };
    const unknownToken = () => getJson("/api/auth/session", { sessionToken: "ses_absent" });
    const adminPath = () =>
      getJson("/api/analytics/kpis", { query: range, sessionToken: session.token });
    const cases: [string, () => Promise<Result<unknown>>, number, string][] = [
      ["no session", () => getJson("/api/orders"), 401, "unauthenticated"],
      ["unknown token", unknownToken, 401, "session-unknown"],
      ["admin endpoint", adminPath, 403, "forbidden"],
      ["taken email", () => postJson("/api/auth/register", REGISTRATION), 409, "duplicate-email"],
      ["declined card", () => postJson("/api/orders", declined), 402, "payment-declined"],
    ];
    for (const [label, call, status, code] of cases) {
      expectRefusal(await refusalOf(call()), status, code, label);
    }
  });

  it("names the control a body that breaks a field rule belongs to", async () => {
    const broken = { ...REGISTRATION, email: "not-an-address" };
    const error = await refusalOf(postJson("/api/auth/register", broken));
    expectRefusal(error, 422, "validation-failed");
    expect(error.field).toBe("email");
  });
});

describe("the unbound seam", () => {
  it("answers 503 data-source-unavailable before any source is bound", async () => {
    vi.resetModules();
    const seam = await import("@/lib/mockServer");
    const data = await import("@/data/repositories");
    expect(seam.isDataSourceRegistered()).toBe(false);
    const unbound = await refusalOf(seam.handleRequest("/api/categories"));
    expectRefusal(unbound, 503, "data-source-unavailable");
    seam.registerDataSource(data.createSalesProDataSource());
    expect(seam.isDataSourceRegistered()).toBe(true);
    expect((await seam.handleRequest("/api/categories")).ok).toBe(true);
  });

  it("resets the injected failure, the remembered key and the registration", async () => {
    const body = await orderBody("key-reset", DEMO_CARD_NUMBERS.APPROVED);
    const created = await valueOf(postJson<Order>("/api/orders", body));
    failNext();
    resetMockServer();
    expect(isDataSourceRegistered()).toBe(false);
    expectRefusal(await refusalOf(request("/api/categories")), 503, "data-source-unavailable");
    registerDataSource(source);
    expect((await request("/api/categories")).ok).toBe(true);
    failNext({ path: "/api/products" });
    expect((await request("/api/categories")).ok).toBe(true);
    expectRefusal(await refusalOf(request("/api/products")), 503, "data-source-unavailable");
    failNext({ routeId: "products.list", status: 500, code: "unexpected-error" });
    clearThroughClient();
    expect((await request("/api/products")).ok).toBe(true);
    const repeated = await valueOf(postJson<Order>("/api/orders", body));
    expect(repeated.id).not.toBe(created.id);
    expect(repeated.orderNumber).not.toBe(created.orderNumber);
    resetApiClient();
    expect(isDataSourceRegistered()).toBe(false);
  });
});

describe("answered reads", () => {
  it("serves the catalogue as a page whose total is what the query matches", async () => {
    const first = await valueOf(
      getJson<PageResult<Product>>("/api/products", { query: { page: 1, pageSize: PAGE_SIZE } }),
    );
    const last = await valueOf(
      getJson<PageResult<Product>>("/api/products", {
        query: { page: first.pageCount, pageSize: PAGE_SIZE },
      }),
    );
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.pageCount).toBe(Math.ceil(first.total / PAGE_SIZE));
    expect(last.items).toHaveLength(first.total - (first.pageCount - 1) * PAGE_SIZE);
    const none = await valueOf(
      getJson<PageResult<Product>>("/api/products", { query: { q: "zzzznosuchproduct" } }),
    );
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
  });

  it("answers a reference collection and a named key in their own shapes", async () => {
    const served = await valueOf(getJson<PageResult<Product>>("/api/products"));
    const product = firstOf(served.items);
    const categories = await valueOf(getJson<Category[]>("/api/categories"));
    expect(firstOf(categories).slug.length).toBeGreaterThan(0);
    const related = await valueOf(
      getJson<{ items: Product[] }>(`/api/products/${product.id}/related`),
    );
    expect(firstOf(related.items).categoryId).toBe(product.categoryId);
  });
});

// The catalogue's filter reading: a filter member that is present but carries no number is refused by
// name, an inverted price pair is swapped rather than refused, and the paging members stay clamped.

describe("catalogue filter reading", () => {
  it.each(MALFORMED_FILTERS)("%s refuses a malformed %s", async (path, member) => {
    const error = await refusalOf(getJson(path, { query: { [member]: "not-a-number" } }));
    expectRefusal(error, 422, "validation-failed");
    expect(error.field).toBe(member);
  });

  it("swaps an inverted price pair rather than refusing it, serving the same rows ascending", async () => {
    const page = (minPrice: number, maxPrice: number) =>
      valueOf(
        getJson<PageResult<Product>>("/api/products", {
          query: { minPrice, maxPrice, pageSize: PAGE_SIZE },
        }),
      );
    const ascending = await page(10_000, 50_000);
    const inverted = await page(50_000, 10_000);
    const unfiltered = await valueOf(
      getJson<PageResult<Product>>("/api/products", { query: { pageSize: PAGE_SIZE } }),
    );
    expect(inverted.total).toBe(ascending.total);
    expect(inverted.items.map((item) => item.id)).toEqual(ascending.items.map((item) => item.id));
    // The bounds were swapped rather than dropped: they still leave rows out of the unfiltered page.
    expect(ascending.total).toBeGreaterThan(0);
    expect(ascending.total).toBeLessThan(unfiltered.total);
  });

  it("keeps the paging members clamped rather than reading them as malformed filters", async () => {
    const paged = await valueOf(
      getJson<PageResult<Product>>("/api/products", { query: { page: "abc", pageSize: "abc" } }),
    );
    expect(paged.page).toBe(1);
    expect(paged.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("reads an empty price member as no bound, the reading an empty vocabulary member gets", async () => {
    const blank = await valueOf(
      getJson<PageResult<Product>>("/api/products", { query: { minPrice: "", maxPrice: "" } }),
    );
    const unfiltered = await valueOf(
      getJson<PageResult<Product>>("/api/products", { query: { pageSize: PAGE_SIZE } }),
    );
    expect(blank.total).toBe(unfiltered.total);
  });
});

describe("idempotency", () => {
  it("replays a repeated submission and refuses the key for a differing body", async () => {
    const body = await orderBody("key-repeat", DEMO_CARD_NUMBERS.APPROVED);
    const created = await valueOf(postJson<Order>("/api/orders", body));
    const before = source.getRecentOrders(ALL_ROWS).length;
    const replayed = await valueOf(postJson<Order>("/api/orders", body));
    expect(replayed).toEqual(created);
    expect(replayed.orderNumber).toBe(created.orderNumber);
    expect(source.getRecentOrders(ALL_ROWS).length).toBe(before);
    const conflict = await refusalOf(
      postJson("/api/orders", { ...body, email: "other@salespro.test" }),
    );
    expectRefusal(conflict, 409, "idempotency-key-conflict");
  });
});

describe("the transport", () => {
  it("waits the configured latency out and falls back to the default", async () => {
    expect(getApiLatencyMs()).toBe(0);
    vi.useFakeTimers();
    const pending = request<Category[]>("/api/categories");
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).ok).toBe(true);
    vi.useRealTimers();
    vi.stubEnv("VITE_API_LATENCY_MS", "");
    expect(getApiLatencyMs()).toBe(DEFAULT_API_LATENCY_MS);
    vi.stubEnv("VITE_API_LATENCY_MS", "0");
  });

  it("serialises a query deterministically", () => {
    const query = {
      sort: "price-asc",
      page: 2,
      brandIds: ["brd_b", "brd_a"],
      q: "",
      none: undefined,
    };
    expect(buildQueryString(query)).toBe("brandIds=brd_b&brandIds=brd_a&page=2&q=&sort=price-asc");
    expect(buildQueryString({ q: "oak & ash" })).toBe("q=oak%20%26%20ash");
    expect(buildQueryString({})).toBe("");
  });

  it("shapes anything a request goes wrong with", () => {
    const reported: ApiError = { status: 404, code: "route-not-found", message: "No endpoint." };
    const boom = new Error("boom");
    expect(isAbortError(createAbortError())).toBe(true);
    expect(isAbortError(boom)).toBe(false);
    expect(toApiError(createAbortError(), "/api/products")).toEqual({
      status: 499,
      code: "request-aborted",
      message: FALLBACK_FAILURE_MESSAGE,
    });
    expect(toApiError(reported, "/api/products")).toBe(reported);
    expect(toApiError(boom, "/api/products")).toEqual({
      status: 500,
      code: "unexpected-error",
      message: FALLBACK_FAILURE_MESSAGE,
    });
    expect(toApiError(boom, "https://example.test/api/products")).toEqual({
      status: 400,
      code: "invalid-request-path",
      message: FALLBACK_FAILURE_MESSAGE,
    });
  });

  it("refuses a target that is not a path and settles an abort, both as values", async () => {
    const target = "https://example.test/api/products";
    expectRefusal(await refusalOf(request(target)), 400, "invalid-request-path");
    const controller = new AbortController();
    const pending = request<Category[]>("/api/products", { signal: controller.signal });
    controller.abort();
    expectRefusal(await refusalOf(pending), 499, "request-aborted");
  });

  it("carries the method and the session token each wrapper sets", async () => {
    expect(SESSION_TOKEN_HEADER).toBe("x-session-token");
    expect(armThroughClient).toBe(failNext);
    expect(clearThroughClient).toBe(clearInjectedFailures);
    const session = await signInCustomer();
    const path = `/api/customers/${session.customerId}/addresses/adr_absent`;
    const headers = { sessionToken: session.token };
    expectRefusal(await refusalOf(deleteJson(path, headers)), 404, "address-not-found");
    expectRefusal(await refusalOf(getJson(path, headers)), 404, "route-not-found");
    expectRefusal(await refusalOf(deleteJson(path)), 401, "unauthenticated");
    const profile = { firstName: "Dana", lastName: "Okafor", phone: "", marketingOptIn: false };
    const updated = await valueOf(
      patchJson<Customer>(`/api/customers/${session.customerId}`, profile, headers),
    );
    expect(updated.id).toBe(session.customerId);
  });
});

describe("seed determinism", () => {
  it("boots the same seeded collections twice from a fresh module registry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const first = await captureSeed();
    const second = await captureSeed();
    vi.useRealTimers();
    // The equality alone would also hold for two reads of one already-loaded module, so what proves each
    // pass is a fresh bootstrap is that the range-keyed reads below are non-empty: they only are when the
    // module re-ran its seed under the pinned clock rather than serving the copy loaded at file scope.
    expect(first).toEqual(second);
    expect(first.categories.length).toBeGreaterThan(0);
    expect(first.brands.length).toBeGreaterThan(0);
    expect(first.products.items.length).toBeGreaterThan(0);
    expect(first.reviews.items.length).toBeGreaterThan(0);
    expect(first.orders.length).toBeGreaterThan(0);
    expect(first.reports.length).toBeGreaterThan(0);
    expect(first.revenue.length).toBeGreaterThan(0);
    expect(first.kpis.orders).toBeGreaterThan(0);
    expect(first.credential?.digest.hash).toBe(second.credential?.digest.hash);
    // The reviews read is scoped to the product it names: its rows are that product's own, its total is that
    // product's own review count from the same bootstrap, and they lead with the newest first.
    expect(first.reviews.items.length).toBeGreaterThan(0);
    const own = first.reviewed.id;
    expect(first.reviews.items.every((review) => review.productId === own)).toBe(true);
    expect(first.reviews.total).toBe(first.reviewed.ratingCount);
    const stamps = first.reviews.items.map((review) => review.createdAt);
    expect([...stamps].sort(compareIso).reverse()).toEqual(stamps);
    // An identifier the catalogue does not hold is refused, as the write route on the same path refuses it,
    // rather than answered with the collection.
    expectRefusal(
      await refusalOf(getJson("/api/products/prod_not-in-the-catalogue/reviews")),
      404,
      API_ERROR_CODES.PRODUCT_NOT_FOUND,
      "the reviews of an unknown product",
    );
    for (const order of first.orders) {
      const priced = order.pricedCart;
      for (const line of priced.lines) {
        expect(line.lineSubtotalMinor).toBe(line.unitPriceMinor * line.quantity);
        expect(line.lineTotalMinor).toBe(line.lineSubtotalMinor - line.discountMinor);
      }
      const orderTotal = order.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      const pricedTotal = priced.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      expect(orderTotal).toBe(pricedTotal);
      expect(priced.subtotalMinor).toBe(
        priced.lines.reduce((sum, line) => sum + line.lineSubtotalMinor, 0),
      );
      expect(priced.discountTotalMinor).toBe(
        priced.lines.reduce((sum, line) => sum + line.discountMinor, 0),
      );
      expect(priced.grandTotalMinor).toBe(
        priced.subtotalMinor - priced.discountTotalMinor + priced.shippingMinor + priced.taxMinor,
      );
    }
  });
});
