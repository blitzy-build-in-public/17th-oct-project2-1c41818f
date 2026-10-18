/**
 * Path: tests/unit/lib/apiRoutesVocabulary.test.ts
 * Purpose: The vocabulary the seam refuses a hand-made request's own values with, driven through `src/lib/apiRoutes.ts`, `src/lib/apiRequests.ts` and `src/lib/apiOrders.ts`: one rule per parameter, the sentence each value that is present but invalid earns, and the idempotency conflict's own wording.
 * Lines: 346
 */

// The vocabulary half of the seam's contract, split out of tests/unit/lib/apiRoutes.test.ts when that suite
// reached the request's 600-line ceiling (§0.5.5: a concern that no longer fits is split into a second file,
// and the ceiling is never raised). Every case drives the real seam through `src/lib/apiClient.ts`, so no
// module is mocked and no handler is called directly: each assertion is one a caller can make of the answer it
// receives, and what is held to account here is the wording these modules state about a value the caller
// itself supplied — a delivered value is never reported as one nobody sent.

import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, DEMO_CARD_NUMBERS, FREE_SHIPPING_METHOD_ID } from "@/constants/config";
import {
  FEEDBACK_COPY,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  VALIDATION_MESSAGES,
} from "@/constants/content";
import { getJson, postJson } from "@/lib/apiClient";
import { API_ERROR_CODES, API_PATHS, fillApiPath } from "@/lib/mockServer";
import type { Session } from "@/types/account";
import type { Product } from "@/types/catalog";
import type { PageResult, Result } from "@/types/common";
import type { Order, PricedCart } from "@/types/commerce";
import { validateAddress, validateRating, validateShippingSubmission } from "@/utils/validation";

import { FIXED_DATE_RANGE, makeAddress } from "../../fixtures";

import {
  PAGE_SIZE,
  firstOf,
  orderBody,
  refusalOf,
  signInCustomer,
  startSeam,
  valueOf,
} from "./mockServerHarness";

// The store each case is answered from: bound before every case, the way tests/unit/lib/mockServer.test.ts
// binds it, because the seam reaches its data through a binding rather than an import.
beforeEach(() => {
  startSeam();
});

/** The two sessions a case may authorise a request with, each issued by the seam's own sign-in route. */
interface Tokens {
  readonly customer: Session;
  readonly admin: Session;
}

/** The request options a session authorises a call with: its token and nothing else. */
function as(session: Session): { readonly sessionToken: string } {
  return { sessionToken: session.token };
}

/** Signs one of the seeded accounts in through the product's own sign-in route. */
function signIn(email: string): Promise<Session> {
  return valueOf(
    postJson<Session>(API_PATHS.AUTH_LOGIN, { email, password: DEMO_ACCOUNTS.PASSWORD }),
  );
}

/** The shopper's session and the administrator's: the customer submits what the vocabulary judges, and
 *  the administrator is the only role the dashboard's dated reads answer. */
async function signedIn(): Promise<Tokens> {
  return { customer: await signInCustomer(), admin: await signIn(DEMO_ACCOUNTS.ADMIN_EMAIL) };
}

// The requests the rows below send ------------------------------------------------------------------

/** The first product the catalogue serves, for the review path each review row builds. */
async function servedProduct(): Promise<Product> {
  const served = await valueOf(
    getJson<PageResult<Product>>(API_PATHS.PRODUCTS, {
      query: { inStock: true, pageSize: PAGE_SIZE },
    }),
  );
  return firstOf(served.items);
}

/** The path of that product's review list. */
async function reviewPath(): Promise<string> {
  return fillApiPath(API_PATHS.PRODUCT_REVIEWS, { id: (await servedProduct()).id });
}

/** That product's review list, filtered by the member a row names. */
async function reviewList(query: Record<string, string>): Promise<Result<unknown>> {
  return getJson(await reviewPath(), { query });
}

/** A catalogue listing filtered and sorted by the members a row names. */
function listing(query: Record<string, string>): Promise<Result<unknown>> {
  return getJson(API_PATHS.PRODUCTS, { query });
}

/** A KPI read over the fixture range, which only an administrator's session reaches. */
function kpis(tokens: Tokens, query: Record<string, string>): Promise<Result<unknown>> {
  return getJson(API_PATHS.ANALYTICS_KPIS, {
    query: { ...FIXED_DATE_RANGE, ...query },
    ...as(tokens.admin),
  });
}

/** The path of the shopper's own address book, for the addition a row submits. */
function bookPath(tokens: Tokens): string {
  return fillApiPath(API_PATHS.CUSTOMER_ADDRESSES, { id: tokens.customer.customerId });
}

/** A review both review rules accept, so the rating is the only member a row can break. */
const REVIEW_TITLE = "Excellent kettle";
const REVIEW_BODY = "It boils water faster than the old one did.";
/** A review of the first served product, submitted by the shopper with the rating a row hands it: a rating of
 *  `undefined` leaves the member off the body rather than sending it empty, as an unchosen star control does. */
async function review(tokens: Tokens, rating: unknown): Promise<Result<unknown>> {
  const body: Record<string, unknown> = { title: REVIEW_TITLE, body: REVIEW_BODY };
  if (rating !== undefined) body.rating = rating;
  return postJson(await reviewPath(), body, as(tokens.customer));
}

// The values this file hands the seam ----------------------------------------------------------------

/** Each is well formed enough for its member to be read, and names no member of the vocabulary that member
 *  is judged against, so the sentence is the only thing the answer can state about it. */
const TELEPORT_METHOD = "ship_teleport";
const UNSUPPORTED_COUNTRY = "ZZ";
const UNKNOWN_SORT = "not-a-sort-key";
const BELOW_NOTHING = "-500";
const UNKNOWN_BASELINE = "nonsense";
const UNKNOWN_BUCKET = "fortnight";

/** One value the seam refuses: what is wrong with it, the request carrying it, the control the answer
 *  names, and the sentence that answer states. */
interface VocabularyCase {
  readonly what: string;
  readonly send: (tokens: Tokens) => Promise<Result<unknown>>;
  readonly field: string;
  readonly message: string;
}

/** Every present-but-invalid value the seam's own QA report enumerates, and the sentence each earns. The
 *  control is named correctly already, so the wording is what these rows hold the answer to. */
const VOCABULARY: readonly VocabularyCase[] = [
  {
    what: "a review list rated outside the five",
    send: () => reviewList({ rating: "9" }),
    field: "rating",
    message: VALIDATION_MESSAGES.OUT_OF_RANGE,
  },
  {
    what: "a review list rated by something that is not a number",
    send: () => reviewList({ rating: "not-a-number" }),
    field: "rating",
    message: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
  },
  {
    what: "a review rated zero",
    send: (tokens) => review(tokens, 0),
    field: "rating",
    message: VALIDATION_MESSAGES.OUT_OF_RANGE,
  },
  {
    what: "a review rated six",
    send: (tokens) => review(tokens, 6),
    field: "rating",
    message: VALIDATION_MESSAGES.OUT_OF_RANGE,
  },
  {
    what: "a review whose rating arrives as text",
    send: (tokens) => review(tokens, "5"),
    field: "rating",
    message: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
  },
  {
    what: "a review carrying no rating member at all",
    send: (tokens) => review(tokens, undefined),
    field: "rating",
    message: VALIDATION_MESSAGES.REQUIRED,
  },
  {
    what: "an address in a country the store does not ship to",
    send: (tokens) =>
      postJson(
        bookPath(tokens),
        makeAddress({ country: UNSUPPORTED_COUNTRY }),
        as(tokens.customer),
      ),
    field: "country",
    message: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
  },
  {
    what: "a listing sorted by an order no control offers",
    send: () => listing({ sort: UNKNOWN_SORT }),
    field: "sort",
    message: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
  },
  {
    what: "a listing with a minimum price below nothing",
    send: () => listing({ minPrice: BELOW_NOTHING }),
    field: "minPrice",
    message: VALIDATION_MESSAGES.OUT_OF_RANGE,
  },
  {
    what: "a KPI read against a baseline no option declares",
    send: (tokens) => kpis(tokens, { baseline: UNKNOWN_BASELINE }),
    field: "baseline",
    message: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
  },
  {
    what: "a KPI read cut into a period no control offers",
    send: (tokens) => kpis(tokens, { bucket: UNKNOWN_BUCKET }),
    field: "bucket",
    message: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
  },
];

describe("a value that is present but invalid", () => {
  it.each(VOCABULARY)("refuses $what with its own sentence", async ({ send, field, message }) => {
    const error = await refusalOf(send(await signedIn()));
    expect([error.status, error.code, error.field, error.message]).toEqual([
      422,
      API_ERROR_CODES.VALIDATION_FAILED,
      field,
      message,
    ]);
  });
});

// One parameter, one rule ----------------------------------------------------------------------------

/** The submission `orderBody` hands back, read through the member a quote re-prices and the rest of the body
 *  the order path is asked with; `orderBody` returns it as an opaque object, so the shape is named here. */
type Submission = { readonly snapshot: PricedCart } & Record<string, unknown>;

/** A submittable order priced by the seam itself, so a cart quote and an order are asked over one basket. */
async function submission(idempotencyKey: string): Promise<Submission> {
  return (await orderBody(idempotencyKey, DEMO_CARD_NUMBERS.APPROVED)) as Submission;
}

describe("a delivery method no shipping method answers", () => {
  it("is refused identically by the cart quote and by the order path", async () => {
    const sent = await submission("key-one-rule");
    const quoted = await refusalOf(
      postJson(API_PATHS.CART_PRICE, {
        lines: sent.snapshot.lines,
        shippingMethodId: TELEPORT_METHOD,
      }),
    );
    const ordered = await refusalOf(
      postJson(API_PATHS.ORDERS, { ...sent, shippingMethodId: TELEPORT_METHOD }),
    );
    expect(quoted).toEqual(ordered);
    expect([quoted.status, quoted.code, quoted.field]).toEqual([
      422,
      API_ERROR_CODES.VALIDATION_FAILED,
      "shippingMethodId",
    ]);
    expect(quoted.message).toBe(VALIDATION_MESSAGES.UNSUPPORTED_VALUE);
  });

  it("still prices the basket for a configured method, for none and for a blank one", async () => {
    const sent = await submission("key-configured");
    const quote = (shippingMethodId: unknown): Promise<Result<PricedCart>> =>
      postJson<PricedCart>(API_PATHS.CART_PRICE, { lines: sent.snapshot.lines, shippingMethodId });
    // The method the quote echoes back is the caller's own; the money is what has to agree.
    const amounts = (priced: PricedCart): readonly number[] => [
      priced.subtotalMinor,
      priced.discountTotalMinor,
      priced.shippingMinor,
      priced.taxMinor,
      priced.grandTotalMinor,
    ];
    const configured = await valueOf(quote(FREE_SHIPPING_METHOD_ID));
    expect(configured.grandTotalMinor).toBeGreaterThan(0);
    for (const unresolved of [null, ""]) {
      expect(amounts(await valueOf(quote(unresolved)))).toEqual(amounts(configured));
    }
  });
});

// The same sentences, asserted where the rules live ---------------------------------------------------

describe("the rule each sentence comes from", () => {
  it("answers a rating by what is wrong with it, and only an unchosen one as missing", () => {
    const refusals: readonly (readonly [unknown, string])[] = [
      [undefined, VALIDATION_MESSAGES.REQUIRED],
      ["", VALIDATION_MESSAGES.REQUIRED],
      [0, VALIDATION_MESSAGES.OUT_OF_RANGE],
      [6, VALIDATION_MESSAGES.OUT_OF_RANGE],
      [4.5, VALIDATION_MESSAGES.UNSUPPORTED_VALUE],
      ["4.5", VALIDATION_MESSAGES.UNSUPPORTED_VALUE],
      [Number.NaN, VALIDATION_MESSAGES.UNSUPPORTED_VALUE],
    ];
    for (const [value, message] of refusals) {
      expect(validateRating(value)).toEqual({ rating: message });
    }
  });

  it("names a country outside the configured set as a value it does not accept", () => {
    expect(validateAddress(makeAddress({ country: UNSUPPORTED_COUNTRY }))).toEqual({
      country: VALIDATION_MESSAGES.UNSUPPORTED_VALUE,
    });
  });

  it("tells a delivery method nobody chose apart from one that names no configured method", () => {
    const address = makeAddress();
    const email = DEMO_ACCOUNTS.CUSTOMER_EMAIL;
    const refused = [
      validateShippingSubmission({ address, email, shippingMethodId: TELEPORT_METHOD }),
      validateShippingSubmission({ address, email, shippingMethodId: "  " }),
    ];
    expect(refused).toEqual([
      { shippingMethodId: VALIDATION_MESSAGES.UNSUPPORTED_VALUE },
      { shippingMethodId: VALIDATION_MESSAGES.REQUIRED },
    ]);
  });
});

// The conflict's own sentence ------------------------------------------------------------------------

describe("an idempotency key reused for a body that differs", () => {
  it("replays an identical submission as the order it already created", async () => {
    const body = await orderBody("key-replay", DEMO_CARD_NUMBERS.APPROVED);
    const placed = await valueOf(postJson<Order>(API_PATHS.ORDERS, body));
    const replayed = await valueOf(postJson<Order>(API_PATHS.ORDERS, body));
    expect(replayed.orderNumber).toBe(placed.orderNumber);
  });

  it("answers 409 with a sentence naming the conflict rather than the shared failure copy", async () => {
    const body = await orderBody("key-conflict", DEMO_CARD_NUMBERS.APPROVED);
    await valueOf(postJson<Order>(API_PATHS.ORDERS, body));
    const conflict = await refusalOf(
      postJson(API_PATHS.ORDERS, { ...body, email: "other@salespro.test" }),
    );
    expect([conflict.status, conflict.code]).toEqual([
      409,
      API_ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
    ]);
    expect(conflict.message).toBe(IDEMPOTENCY_CONFLICT_MESSAGE);
    // The generic sentence keeps its own home: it is the 403's deliberate non-disclosure wording, so a
    // conflict answered with it would tell the caller nothing about what happened.
    expect(IDEMPOTENCY_CONFLICT_MESSAGE).not.toBe(FEEDBACK_COPY.ERROR_STATE_BODY);
  });
});
