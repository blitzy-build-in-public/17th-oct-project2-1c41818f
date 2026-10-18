/**
 * Path: tests/unit/lib/mockServer.test.ts
 * Purpose: Route matching, error mapping, catalogue filter reading, review scoping, idempotency replay, the unregistered-source failure, the transport's shaping and the seed's determinism.
 * Lines: 593
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_API_LATENCY_MS,
  DEFAULT_PAGE_SIZE,
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
} from "@/constants/config";
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
  ORDER_TOKEN_HEADER,
  SESSION_TOKEN_HEADER,
  clearInjectedFailures,
  failNext,
  getApiLatencyMs,
  handleRequest,
  isDataSourceRegistered,
  matchRoute,
  registerDataSource,
  resetMockServer,
  type RequestFailureMatcher,
  type SalesProDataSource,
} from "@/lib/mockServer";
import type { Customer } from "@/types/account";
import type { Category, Product, Review } from "@/types/catalog";
import type { ApiError, PageResult, Result } from "@/types/common";
import type { Order } from "@/types/commerce";
import { createAbortError, isAbortError } from "@/utils/async";
import { compareIso } from "@/utils/dates";
import { FILTER_PARAMS } from "@/utils/queryParams";

import { FIXED_DATE_RANGE, FIXED_NOW, makeFilterState } from "../../fixtures";

import {
  ORDER_SAMPLE,
  PAGE_SIZE,
  expectRefusal,
  firstOf,
  orderBody,
  refusalOf,
  signInCustomer,
  startSeam,
  valueOf,
} from "./mockServerHarness";

// The seam's own contract, driven at the seam: no DOM, no provider and no rendering take part, so every
// case runs in the node project, and the data source is bound per case because the seam reaches its data
// through a binding rather than an import — the rule the unbound-seam cases prove.

/** A row limit past the seeded order count, so a count reads the whole collection it is about. */
const ALL_ROWS = 10_000;

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
    // The two analytics reads answer with a promise of a `Result`, because the modules they aggregate with
    // are fetched on first use, so a pass unwraps the value the equality below compares.
    kpis: await valueOf(booted.getKpis(FIXED_DATE_RANGE)),
    revenue: await valueOf(booted.getRevenueSeries(FIXED_DATE_RANGE)),
    reports: booted.listReportDefinitions(),
  };
}

beforeEach(() => {
  source = startSeam();
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

  it("scopes a product's reviews to the path's product and puts a submitted one first", async () => {
    const served = await valueOf(getJson<PageResult<Product>>("/api/products"));
    const product = served.items.find((candidate) => candidate.ratingCount > 0);
    if (product === undefined) throw new Error("The seeded catalogue serves no reviewed product.");
    const path = `/api/products/${product.id}/reviews`;
    const page = { page: 1, pageSize: PAGE_SIZE };

    const first = await valueOf(getJson<PageResult<Review>>(path, { query: page }));
    expect(first.total).toBe(product.ratingCount);
    expect(first.items.length).toBeGreaterThan(0);
    for (const review of first.items) expect(review.productId).toBe(product.id);
    const instants = first.items.map((review) => review.createdAt);
    expect([...instants].sort().reverse()).toEqual(instants);

    const rating = firstOf(first.items).rating;
    const narrowed = await valueOf(
      getJson<PageResult<Review>>(path, { query: { ...page, rating } }),
    );
    expect(narrowed.total).toBe(first.items.filter((review) => review.rating === rating).length);
    for (const review of narrowed.items) expect(review.rating).toBe(rating);

    const session = await signInCustomer();
    const written = await valueOf(
      postJson<Review>(
        path,
        {
          rating,
          title: "Held up all winter",
          body: "Used it daily for six months and it still reads well.",
        },
        { sessionToken: session.token },
      ),
    );
    const after = await valueOf(getJson<PageResult<Review>>(path, { query: page }));
    // The seeded corpus draws the anchor day as a whole day — one of this product's rows is dated later
    // today than this write — so a submitted row is not guaranteed the first slot. The endpoint's contract
    // is a page ordered newest first, with the write visible in it.
    expect(after.total).toBe(first.total + 1);
    expect(after.items.some((review) => review.id === written.id)).toBe(true);
    const afterInstants = after.items.map((review) => review.createdAt);
    expect([...afterInstants].sort().reverse()).toEqual(afterInstants);
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

  it.each([
    { development: true, latency: "abc", reports: 1 },
    { development: false, latency: "12.5", reports: 0 },
  ])(
    "reports the unusable value $latency $reports time(s) with the development flag $development",
    async ({ development, latency, reports }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.stubEnv("DEV", development);
      vi.stubEnv("VITE_API_LATENCY_MS", latency);
      try {
        // A module and a value of this row's own: the diagnostic reports each distinct value once,
        // so a shared one would let the earlier row answer this one and the case prove nothing.
        vi.resetModules();
        const { getApiLatencyMs: readLatency } = await import("@/lib/mockServer");
        expect(readLatency()).toBe(DEFAULT_API_LATENCY_MS);
        const messages = warn.mock.calls.map((call) => String(call[0]));
        expect(messages).toHaveLength(reports);
        for (const message of messages) {
          expect(message).toContain("VITE_API_LATENCY_MS");
          expect(message).toContain(`"${latency}"`);
        }
      } finally {
        vi.unstubAllEnvs();
        warn.mockRestore();
      }
    },
  );

  it("extends a target that already carries a query rather than breaking it", async () => {
    // A caller may hand the transport a path it built complete. The query passed beside it joins that
    // path with the separator the path's own form calls for, and the seam still reads every member —
    // the page size below is one of the configured options, never the default an unread path falls to.
    const carried = await valueOf(
      getJson<PageResult<Product>>(`/api/products?pageSize=${PAGE_SIZE}`, { query: { page: 1 } }),
    );
    expect([carried.pageSize, carried.page]).toEqual([PAGE_SIZE, 1]);
    const trailingQuestion = await valueOf(
      getJson<PageResult<Product>>("/api/products?", { query: { pageSize: PAGE_SIZE } }),
    );
    expect(trailingQuestion.pageSize).toBe(PAGE_SIZE);
    const trailingAmpersand = await valueOf(
      getJson<PageResult<Product>>(`/api/products?pageSize=${PAGE_SIZE}&`, { query: { page: 2 } }),
    );
    expect([trailingAmpersand.pageSize, trailingAmpersand.page]).toEqual([PAGE_SIZE, 2]);
  });

  it("falls back for a latency the environment cannot apply, reporting each value once", () => {
    const reported = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The variable is unset here, which is the documented default: a build with no value still waits the
    // configured delay rather than not waiting at all.
    vi.unstubAllEnvs();
    expect(getApiLatencyMs()).toBe(DEFAULT_API_LATENCY_MS);
    // A value that is set and unusable falls back too, and is reported once rather than once per read.
    vi.stubEnv("VITE_API_LATENCY_MS", "half a second");
    expect(getApiLatencyMs()).toBe(DEFAULT_API_LATENCY_MS);
    expect(getApiLatencyMs()).toBe(DEFAULT_API_LATENCY_MS);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(String(reported.mock.calls[0]?.[0])).toContain("VITE_API_LATENCY_MS");
    // A whole number of milliseconds past the timer's range is unusable as well, and is a distinct value.
    vi.stubEnv("VITE_API_LATENCY_MS", "99999999999999999999");
    expect(getApiLatencyMs()).toBe(DEFAULT_API_LATENCY_MS);
    expect(reported).toHaveBeenCalledTimes(2);
    // And a whole number inside the range is the delay itself.
    vi.stubEnv("VITE_API_LATENCY_MS", "250");
    expect(getApiLatencyMs()).toBe(250);
    reported.mockRestore();
    vi.stubEnv("VITE_API_LATENCY_MS", "0");
  });

  it("arms a request by method, by route or by path pattern, and answers every other one", async () => {
    const browse = (): Promise<Result<Category[]>> => request<Category[]>("/api/categories");
    const matchers: readonly [RequestFailureMatcher, boolean][] = [
      [{ method: "POST" }, false],
      [{ method: "GET" }, true],
      [{ routeId: "products.list" }, false],
      [{ routeId: "categories.list" }, true],
      [{ path: /^\/api\/cart/ }, false],
      [{ path: /categor/ }, true],
    ];
    for (const [matcher, applies] of matchers) {
      failNext(matcher);
      const armed = await browse();
      expect([matcher, armed.ok]).toEqual([matcher, !applies]);
      if (!armed.ok) expect([matcher, armed.error.status]).toEqual([matcher, 503]);
      // The arm is consumed by the first request it applied to, whichever that was: the next one is
      // answered rather than failing behind it.
      expect((await browse()).ok).toBe(true);
    }
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
    expect(ORDER_TOKEN_HEADER).toBe("x-order-token");
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
