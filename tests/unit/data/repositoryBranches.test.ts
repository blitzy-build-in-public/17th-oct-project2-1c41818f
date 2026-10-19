/**
 * Path: tests/unit/data/repositoryBranches.test.ts
 * Purpose: The data source's own read and refusal branches: a product the catalogue serves with no reviews, a review written by an account or for a product the store does not hold, a line the store will not price, a code that is no code at all, and the two refusals a report run earns before it composes anything
 * Lines: 269
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import { VALIDATION_MESSAGES } from "@/constants/content";
import { DATE_RANGE_COPY, rangeTooLongMessage } from "@/constants/content-reports";
import type { Session } from "@/types/account";
import type { ReportKind } from "@/types/analytics";
import type { Product, Review, ReviewInput } from "@/types/catalog";
import type { ApiError, CustomerId, PageResult, ProductId, Result } from "@/types/common";
import { getJson, postJson } from "@/lib/apiClient";
import { API_PATHS, fillApiPath, type SalesProDataSource } from "@/lib/mockServer";
import { addDays, toIsoDate } from "@/utils/dates";

import { makeCartLine } from "../../fixtures";
import {
  PAGE_SIZE,
  expectRefusal,
  refusalOf,
  signInCustomer,
  startSeam,
  valueOf,
} from "../lib/mockServerHarness";

// The subject is `src/data/repositories.ts` — the data source the transport is bound to — driven through the
// transport itself wherever the transport reaches it, and through the contract's own members where the
// transport refuses the request first: a path naming a product's reviews, a report range and a report kind
// are all judged at the seam before a handler runs, or after it, so those branches are the data source's own
// answers to a caller that asks it directly. Nothing is mocked: the store, its rules and its collections are
// the product's own.

/** The store each case is answered from, bound to the seam before every case so no case reads another's writes. */
let source: SalesProDataSource;

/** The session the case in progress signed in with, so a request it makes carries one the seam issued. */
let session: Session;

beforeEach(async () => {
  source = startSeam();
  session = await signInCustomer();
});

/** A review body the review rule accepts, so a case that writes one asserts the branch it is about. */
const REVIEW_DRAFT: ReviewInput = {
  rating: 4,
  title: "Quiet and solid on the desk",
  body: "The finish is even and the controls feel considered rather than cheap.",
};

/** A product identifier no catalogue row carries. */
const ABSENT_PRODUCT = "prd_not_in_the_catalogue" as ProductId;

/** A customer identifier no account carries. */
const ABSENT_CUSTOMER = "cus_not_in_the_store" as CustomerId;

/** Today, as the reports date their ranges. */
const TODAY = toIsoDate(new Date());

/** The failure of a call the data source answers with synchronously, which is every pricing and promo call. */
function failureOf<TValue>(result: Result<TValue>): ApiError {
  if (result.ok) throw new Error("The call was answered where the case expects a refusal.");
  return result.error;
}

/** The catalogue's first product whose seeded reviews number none, read through the transport's own listing
 *  and paged until it is found, because which products those are follows the seeded review counts. */
async function productWithNoReviews(): Promise<Product> {
  for (let page = 1; ; page += 1) {
    const served = await valueOf(
      getJson<PageResult<Product>>(API_PATHS.PRODUCTS, { query: { pageSize: PAGE_SIZE, page } }),
    );
    const bare = served.items.find((product) => product.ratingCount === 0);
    if (bare !== undefined) return bare;
    if (page >= served.pageCount) {
      throw new Error("The seeded catalogue holds no product without a review.");
    }
  }
}

/** One page of a product's reviews, read through the transport. */
function reviewsOf(productId: ProductId): Promise<Result<PageResult<Review>>> {
  return getJson<PageResult<Review>>(fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: productId }), {
    query: { pageSize: PAGE_SIZE },
  });
}

describe("a product the catalogue serves with no reviews at all", () => {
  it("answers an empty page for it, and lists the review a customer writes for it", async () => {
    const product = await productWithNoReviews();

    const before = await valueOf(reviewsOf(product.id));
    expect(before.total).toBe(0);
    expect(before.items).toEqual([]);

    const written = await valueOf(
      postJson<Review>(fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: product.id }), REVIEW_DRAFT, {
        sessionToken: session.token,
      }),
    );
    expect(written.productId).toBe(product.id);
    expect(written.customerId).toBe(session.customerId);
    expect(written.title).toBe(REVIEW_DRAFT.title);

    // The first review of a product opens its own group in the store's index, and the page a customer reads
    // next is drawn from that group: one row, written by the account that submitted it.
    const after = await valueOf(reviewsOf(product.id));
    expect(after.total).toBe(1);
    expect(after.items.map((review) => review.id)).toEqual([written.id]);
  });

  it("names no reviewer for a review whose author the store does not hold", () => {
    const review = source.insertProductReview({
      productId: ABSENT_PRODUCT,
      customerId: ABSENT_CUSTOMER,
      ...REVIEW_DRAFT,
    });

    // A read is a value and never a failure, so an account the store cannot resolve contributes an empty
    // name rather than leaving the row without one.
    expect(review.customerName).toBe("");
    expect(review.customerId).toBe(ABSENT_CUSTOMER);
    expect(review.verifiedPurchase).toBe(false);
  });

  it("records a review for a product the store does not hold without inventing a catalogue row", () => {
    const review = source.insertProductReview({
      productId: ABSENT_PRODUCT,
      customerId: session.customerId,
      ...REVIEW_DRAFT,
    });

    // The row is stored and listed under the identifier it names, while the catalogue holds no product under
    // it: the rating fold has nothing to fold into, which is why it leaves the catalogue alone.
    expect(source.getProduct(ABSENT_PRODUCT)).toBeUndefined();
    expect(
      source.listProductReviews({ productId: ABSENT_PRODUCT, page: 1, pageSize: PAGE_SIZE }).total,
    ).toBe(1);
    expect(review.productId).toBe(ABSENT_PRODUCT);
  });
});

describe("a basket the store will not price", () => {
  it.each<[label: string, quantity: number]>([
    ["a line for none of the product", 0],
    ["a line for a negative count", -2],
    ["a line above the ceiling it declares", 11],
    ["a line for a fraction of a product", 1.5],
  ])("refuses %s with the stock refusal a cart marks its lines with", (_label, quantity) => {
    const refusal = failureOf(
      source.priceCart({
        lines: [makeCartLine({ quantity, maxQuantity: 10 })],
        promoCode: null,
        shippingMethodId: null,
      }),
    );

    // A quantity outside one-to-the-ceiling is stock that is not there, refused before anything is priced.
    expectRefusal(refusal, 422, "insufficient-stock");
    expect(refusal.field).toBe("lines");
    expect(refusal.message).toBe(VALIDATION_MESSAGES.QUANTITY_RANGE);
  });

  it("refuses the same line at the transport, with the same code and the same field", async () => {
    const line = makeCartLine({ quantity: 11, maxQuantity: 10 });

    const refusal = await refusalOf(
      postJson<unknown>(API_PATHS.CART_PRICE, { lines: [line], shippingMethodId: null }),
    );

    // The transport reads the submitted lines against the ceiling each carries, so a client is refused the
    // same refusal the data source answers a caller that submits the line to it with — and its sentence names
    // the ceiling the line declared, which is the control the shopper corrects.
    expectRefusal(refusal, 422, "insufficient-stock");
    expect(refusal.field).toBe("lines");
    expect(refusal.message).toContain("10");
  });
});

describe("a code that is no code at all", () => {
  it.each<[label: string, code: string]>([
    ["an empty code", ""],
    ["a code of whitespace alone", "   "],
  ])("answers %s as unknown rather than applying it", (_label, code) => {
    const refusal = failureOf(source.validatePromoCode({ code, lines: [makeCartLine()] }));

    // Whitespace alone is no code at all: the store's own normaliser says so, and the answer is the refusal a
    // code no definition holds earns, filed under the control that carries it.
    expectRefusal(refusal, 409, "unknown");
    expect(refusal.field).toBe("promoCode");
  });
});

describe("a report run the store refuses before it composes anything", () => {
  it.each<
    [
      label: string,
      range: { readonly from: string; readonly to: string },
      field: string,
      message: string,
    ]
  >([
    [
      "a range whose start is not a day",
      { from: "not-a-day", to: TODAY },
      "from",
      VALIDATION_MESSAGES.REQUIRED,
    ],
    [
      "a range that ends before it starts",
      { from: TODAY, to: addDays(TODAY, -30) },
      "range",
      DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
    ],
    [
      "a range that reaches past today",
      { from: TODAY, to: addDays(TODAY, 2) },
      "to",
      DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
    ],
    [
      "a range wider than the product accepts",
      { from: addDays(TODAY, -(MAX_REPORT_RANGE_DAYS + 2)), to: TODAY },
      "range",
      rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
    ],
  ])("refuses %s with the wording its own rule carries", async (_label, range, field, message) => {
    const refusal = await refusalOf(
      source.runReport({ kind: "sales", from: range.from, to: range.to }),
    );

    // The same rule and the same sentence the transport refuses a request's range with, so a report form
    // shows one message whether the range was caught here or before the request left.
    expectRefusal(refusal, 422, "validation-failed");
    expect(refusal.field).toBe(field);
    expect(refusal.message).toBe(message);
  });

  it("refuses a kind no definition declares, where the transport answers a path it has no route for", async () => {
    const refusal = await refusalOf(
      source.runReport({ kind: "nonsense" as ReportKind, from: addDays(TODAY, -7), to: TODAY }),
    );

    expectRefusal(refusal, 422, "validation-failed");
    expect(refusal.field).toBe("kind");
    expect(refusal.message).toBe(VALIDATION_MESSAGES.REQUIRED);

    // The transport reads the path's kind before a handler runs, so a client asking for a kind that does not
    // exist is answered with the route refusal rather than reaching the store at all — and only an
    // administrator reaches the route at all, so the case signs one in for the comparison.
    const administrator = await valueOf(
      postJson<Session>(API_PATHS.AUTH_LOGIN, {
        email: DEMO_ACCOUNTS.ADMIN_EMAIL,
        password: DEMO_ACCOUNTS.PASSWORD,
      }),
    );
    const throughSeam = await refusalOf(
      getJson<unknown>(fillApiPath(API_PATHS.REPORT_RUN, { kind: "nonsense" }), {
        query: { from: addDays(TODAY, -7), to: TODAY },
        sessionToken: administrator.token,
      }),
    );
    expectRefusal(throughSeam, 404, "route-not-found");
  });
});
