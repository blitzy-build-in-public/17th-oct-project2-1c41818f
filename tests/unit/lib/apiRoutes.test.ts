/**
 * Path: tests/unit/lib/apiRoutes.test.ts
 * Purpose: The route table's own decisions, driven through the bound seam: the order submission's card and body reading, and the refusals a hand-made request is answered with.
 * Lines: 597
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS, FREE_SHIPPING_METHOD_ID, SESSION_TTL_MS } from "@/constants/config";
import { createSalesProDataSource } from "@/data/repositories";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/apiClient";
import {
  API_ERROR_CODES,
  API_PATHS,
  fillApiPath,
  registerDataSource,
  type SalesProDataSource,
} from "@/lib/mockServer";
import { addDays, startOfDay } from "@/utils/dates";

import type { Address, Session } from "@/types/account";
import type { Product, Review, SearchSuggestionResponse } from "@/types/catalog";
import type { ApiError, LineId, PageResult, Result } from "@/types/common";
import type { CartLine, Order, PricedCart } from "@/types/commerce";
import type { ReviewDraft } from "@/utils/validation";

import { FIXED_NOW } from "../../fixtures";

// The seam is driven as a client drives it: real requests through `src/lib/apiClient.ts` into the route
// table, answered by the seeded store the case binds. Nothing is mocked and no handler is called directly,
// so every case measures what a caller receives — the payload, the status, the code and the control — and
// what these modules own is the reading of a hand-made request: which control a malformed body belongs to,
// which brand a demonstration payment records, and which refusals the seam answers for itself.

/** The store each case is answered from, rebound before every case so no case reads another's writes. */
let source: SalesProDataSource;
/** The sessions the case in progress signed in, taken once each and dropped with the store. */
let sessions: Sessions | undefined;

beforeEach(() => {
  source = createSalesProDataSource();
  registerDataSource(source);
  sessions = undefined;
});

/** The endpoints the rows below name, under short names because each row is one line long. */
const PRODUCTS = API_PATHS.PRODUCTS;
const FACETS = API_PATHS.FACETS;
const REVIEWS = API_PATHS.PRODUCT_REVIEWS;
const CART = API_PATHS.CART_PRICE;
const PROMO = API_PATHS.CART_VALIDATE_PROMO;
const LOGIN = API_PATHS.AUTH_LOGIN;
const REGISTER = API_PATHS.AUTH_REGISTER;
const DETAIL = API_PATHS.CUSTOMER_DETAIL;
const BOOK = API_PATHS.CUSTOMER_ADDRESSES;
const ADDRESS = API_PATHS.CUSTOMER_ADDRESS;
const ADDRESS_DEFAULT = API_PATHS.CUSTOMER_ADDRESS_DEFAULT;
const ORDERS = API_PATHS.ORDERS;
const KPIS = API_PATHS.ANALYTICS_KPIS;
const REVENUE = API_PATHS.ANALYTICS_REVENUE;
const TOP_PRODUCTS = API_PATHS.ANALYTICS_TOP_PRODUCTS;
const RECENT_ORDERS = API_PATHS.ANALYTICS_RECENT_ORDERS;
const REPORT_RUN = API_PATHS.REPORT_RUN;
/** The field a refusal names where it names none, the code every field rule answers with, and the account
 *  the sign-in rows submit. */
const NO_FIELD = undefined;
const INVALID = API_ERROR_CODES.VALIDATION_FAILED;
const SHOPPER_EMAIL = DEMO_ACCOUNTS.CUSTOMER_EMAIL;

/** The payload of a call the case expects to be answered. */
async function valueOf<TValue>(pending: Promise<Result<TValue>>): Promise<TValue> {
  const result = await pending;
  if (!result.ok) throw new Error(`The call was refused with ${result.error.code}.`);
  return result.value;
}

/** The failure of a call the case expects to be refused; `label` names the case in a failure. */
async function refusalOf(pending: Promise<Result<unknown>>, label: string): Promise<ApiError> {
  const result = await pending;
  if (result.ok) throw new Error(`"${label}" was answered where the case expects a refusal.`);
  return result.error;
}

/** The first entry of a collection a case reads, or a failure naming the empty collection. */
function firstOf<TItem>(items: readonly TItem[]): TItem {
  const [first] = items;
  if (first === undefined) throw new Error("The collection the case reads is empty.");
  return first;
}

/** The two sessions a case may authorise a request with, each issued by the seam's own sign-in route. */
interface Sessions {
  readonly customer: Session;
  readonly admin: Session;
}

/** Signs one of the seeded accounts in. */
async function signIn(email: string): Promise<Session> {
  return valueOf(postJson<Session>(LOGIN, { email, password: DEMO_ACCOUNTS.PASSWORD }));
}

/** Both sessions, signed in through the product's own path, on first use within a case. */
async function signedIn(): Promise<Sessions> {
  sessions ??= {
    customer: await signIn(SHOPPER_EMAIL),
    admin: await signIn(DEMO_ACCOUNTS.ADMIN_EMAIL),
  };
  return sessions;
}

/** The request options a session authorises a call with: its token and nothing else. */
function as(session: Session): { readonly sessionToken: string } {
  return { sessionToken: session.token };
}

/** One endpoint path with its captured segments filled, as the services fill their own targets. */
function pathFor(pattern: string, id: string, extra: Record<string, string> = {}): string {
  return fillApiPath(pattern, { id, ...extra });
}

/** The path of a read on the shopper's own account, and of one on another account the shopper may not
 *  reach, which is filled with the administrator's identifier. */
function ownPath({ customer }: Sessions, pattern: string, addressId?: string): string {
  return pathFor(pattern, customer.customerId, addressId === undefined ? {} : { addressId });
}
function otherPath({ admin }: Sessions, pattern: string, addressId?: string): string {
  return pathFor(pattern, admin.customerId, addressId === undefined ? {} : { addressId });
}

/** The first product the catalogue serves, for the paths and bodies a case builds. */
async function servedProduct(): Promise<Product> {
  const served = await valueOf(
    getJson<PageResult<Product>>(PRODUCTS, { query: { inStock: true, pageSize: 24 } }),
  );
  return firstOf(served.items);
}

/** One line over the first served product, for the bodies that carry a basket. */
async function lineOf(overrides: Partial<CartLine> = {}): Promise<CartLine> {
  const product = await servedProduct();
  // The identifier is hand-built and branded by the cast, the visible signal no generator made it.
  return {
    id: `line_${product.id}` as LineId,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPriceMinor: product.priceMinor,
    quantity: 1,
    maxQuantity: product.stockOnHand,
    imageUrl: firstOf(product.images).url,
    addedAt: FIXED_NOW,
    ...overrides,
  };
}

/** A priced basket over the first served product, priced by the seam's own endpoint so the amounts are
 *  the ones a checkout would have reviewed. */
async function pricedSnapshot(): Promise<PricedCart> {
  return valueOf(postJson<PricedCart>(CART, { lines: [await lineOf()] }));
}

/** The path of the first served product's reviews. */
async function reviewPath(): Promise<string> {
  return pathFor(REVIEWS, (await servedProduct()).id);
}

/** A review of the first served product, submitted by the shopper with the draft a row shapes over a
 *  draft both review rules accept. */
const REVIEW_TITLE = "Excellent kettle";
const REVIEW_BODY = "It boils water faster than the old one did.";
async function review(
  { customer }: Sessions,
  draft: Partial<ReviewDraft>,
): Promise<Result<unknown>> {
  const body = { rating: 5, title: REVIEW_TITLE, body: REVIEW_BODY, ...draft };
  return postJson(await reviewPath(), body, as(customer));
}

/** The body with one member taken off it, as a submission that never carried that member. */
function without(body: object, member: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...body };
  delete copy[member];
  return copy;
}

// The submitted bodies -------------------------------------------------------------------------------

/** The address a submission carries: the members an address input holds in full, and neither default
 *  flag — the member an order records as false when the submission does not carry it. */
const ADDRESS_BODY = {
  label: "Home",
  fullName: "Dana Okafor",
  line1: "12 Beacon Street",
  line2: "",
  city: "Portland",
  region: "OR",
  postalCode: "97205",
  country: "US",
  phone: "+1 503 555 0134",
} as const;

/** The profile body a row submits when the profile itself is not what the row is about. */
const PROFILE_BODY = { firstName: "Dana", lastName: "Okafor", phone: "", marketingOptIn: false };

/** A card number as it is printed: written in its groups and reduced to its digits here, so no card
 *  number is ever written down whole. */
function cardDigits(groups: string): string {
  return groups.replace(/\D/g, "");
}

/** A submittable order: the snapshot it is built from, the two flag-less address halves, a payment of the
 *  case's own choosing and the key it is submitted under. */
function submission(
  snapshot: PricedCart,
  idempotencyKey: string,
  card: string | null,
): Record<string, unknown> {
  const cardBody = {
    number: card ?? "",
    nameOnCard: "Dana Okafor",
    expiryMonth: "12",
    expiryYear: "2032",
    cvc: "123",
  };
  return {
    snapshot,
    email: SHOPPER_EMAIL,
    shippingAddress: ADDRESS_BODY,
    billingAddress: { ...ADDRESS_BODY, label: "Billing" },
    shippingMethodId: FREE_SHIPPING_METHOD_ID,
    payment: card === null ? { method: "invoice" } : { method: "card", card: cardBody },
    idempotencyKey,
  };
}

// The payment an accepted submission records ----------------------------------------------------------

/** One card and the brand the demonstration records it under. */
interface CardCase {
  readonly what: string;
  readonly number: string;
  readonly brand: string;
}

/** The ladder the recorded brand is read from, one row per rung: every number is an industry test number
 *  written in its groups, the demonstration's own approved card included. */
const CARDS: readonly CardCase[] = [
  { what: "the approved card", number: cardDigits("4242 4242 4242 4242"), brand: "Visa" },
  { what: "a 51-55 Mastercard", number: cardDigits("5555 5555 5555 4444"), brand: "Mastercard" },
  {
    what: "a 2221-2720 Mastercard",
    number: cardDigits("2223 0031 2200 3222"),
    brand: "Mastercard",
  },
  { what: "an Amex card", number: cardDigits("3782 822463 10005"), brand: "Amex" },
  { what: "a Discover card", number: cardDigits("6011 1111 1111 1117"), brand: "Discover" },
  { what: "an unrecognised scheme", number: cardDigits("3530 1113 3330 0000"), brand: "Card" },
];

describe("the card brand a submission records", () => {
  it.each(CARDS)("records $what under its own brand", async ({ number, brand }) => {
    const snapshot = await pricedSnapshot();
    const order = await valueOf(
      postJson<Order>(ORDERS, submission(snapshot, `key-${number}`, number)),
    );
    expect([order.payment.method, order.payment.status, order.payment.brand]).toEqual([
      "card",
      "authorised",
      brand,
    ]);
    expect(order.payment.last4).toBe(number.slice(-4));
    expect(order.payment.authorisedAt).not.toBeNull();
  });
});

// What a submission leaves out -----------------------------------------------------------------------

describe("the defaults a submission's missing members take", () => {
  it("records both address halves as not default when neither carries the flag", async () => {
    const snapshot = await pricedSnapshot();
    const order = await valueOf(
      postJson<Order>(ORDERS, submission(snapshot, "key-flags", CARDS[0].number)),
    );
    // The flags are absent from the submitted halves rather than false, so what an order records is the
    // endpoint's own reading of an absent member.
    expect([
      order.shippingAddress.isDefaultShipping,
      order.shippingAddress.isDefaultBilling,
      order.billingAddress.isDefaultShipping,
      order.billingAddress.isDefaultBilling,
    ]).toEqual([false, false, false, false]);
    expect([order.shippingAddress.id, order.billingAddress.label]).toEqual(["", "Billing"]);
  });

  it("answers a body that is not a submission at all, naming a control rather than throwing", async () => {
    const error = await refusalOf(postJson(ORDERS, ["not", "a", "submission"]), "a stray body");
    expect([error.status, error.code]).toEqual([422, INVALID]);
    expect(error.field?.length).toBeGreaterThan(0);
    expect(error.message.length).toBeGreaterThan(0);
  });
});

/** One submission the order endpoint refuses: what it leaves out, the body it carries, the control. */
interface RefusedSubmission {
  readonly what: string;
  readonly build: (snapshot: PricedCart) => Record<string, unknown>;
  readonly field: string;
}

const REFUSED_SUBMISSIONS: readonly RefusedSubmission[] = [
  {
    what: "a submission with no payment",
    build: (snapshot) => without(submission(snapshot, "key-no-payment", null), "payment"),
    field: "method",
  },
  {
    what: "a submission with no cart snapshot",
    build: (snapshot) => without(submission(snapshot, "key-no-snapshot", null), "snapshot"),
    field: "snapshot",
  },
  {
    what: "a submission with no idempotency key",
    build: (snapshot) => submission(snapshot, "   ", null),
    field: "idempotencyKey",
  },
  {
    what: "a submission whose cart holds no line",
    build: (snapshot) => submission({ ...snapshot, lines: [] }, "key-empty-cart", null),
    field: "snapshot",
  },
];

describe("a body the order endpoint refuses", () => {
  it.each(REFUSED_SUBMISSIONS)(
    "refuses $what, naming the control that owns it",
    async (refused) => {
      const snapshot = await pricedSnapshot();
      const error = await refusalOf(postJson(ORDERS, refused.build(snapshot)), refused.what);
      expect([error.status, error.code, error.field]).toEqual([422, INVALID, refused.field]);
      expect(error.message.length).toBeGreaterThan(0);
    },
  );
});

// The session a submission is remembered under -------------------------------------------------------

describe("what a submission is remembered under", () => {
  it("forgets a token's submissions once the token names no live session", async () => {
    const session = await signIn(SHOPPER_EMAIL);
    const snapshot = await pricedSnapshot();
    const body = submission(snapshot, "key-token", CARDS[0].number);
    const carried = as(session);
    const placed = await valueOf(postJson<Order>(ORDERS, body, carried));
    expect(placed.customerId).toBe(session.customerId);
    // While the session is live, the same key under the same token replays the order it created rather
    // than placing a second: that is what the memory the endpoint keeps is for.
    expect((await valueOf(postJson<Order>(ORDERS, body, carried))).id).toBe(placed.id);

    // The session passes its expiry without anyone signing out, and the same token arrives again: the
    // submission is read as the guest submission it has become, and because the token names no live
    // session, what it remembered is dropped as that request is read.
    const live = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(live + SESSION_TTL_MS + 1);
    const asGuest = await valueOf(postJson<Order>(ORDERS, body, carried));
    expect([asGuest.customerId, asGuest.id === placed.id]).toEqual([null, false]);

    // The clock returns to the instant the session is live at once more: the identical submission is
    // placed afresh rather than replayed from the memory the expired request found keyed by this token.
    vi.setSystemTime(live);
    const afterExpiry = await valueOf(postJson<Order>(ORDERS, body, carried));
    expect(afterExpiry.customerId).toBe(session.customerId);
    expect(afterExpiry.id).not.toBe(placed.id);
    vi.useRealTimers();
  });
});

// The requests the route table refuses, and the reads it answers -------------------------------------

/** A request a row sends: the sessions it may take a token from, and the call it makes. */
type Send = (sessions: Sessions) => Promise<Result<unknown>>;

/** The first address of the shopper's book, for the rows that name one of them. */
async function heldAddress({ customer }: Sessions): Promise<string> {
  const book = await valueOf(getJson<Address[]>(pathFor(BOOK, customer.customerId), as(customer)));
  return firstOf(book).id;
}

/** A dated range the readers accept, derived from the newest seeded order rather than from the ambient
 *  clock: the thirty days that order's own day ends. */
function acceptedRange(): { readonly from: string; readonly to: string } {
  const lastDay = startOfDay(firstOf(source.getRecentOrders(1)).placedAt);
  return { from: addDays(lastDay, -29), to: lastDay };
}

/** The dated members a row's query carries, beside whatever else that row names. */
function rangeQuery(extra: Record<string, string> = {}): string {
  return new URLSearchParams({ ...acceptedRange(), ...extra }).toString();
}

/** A basket the cart endpoint prices: one line over the first served product, as a row shapes it. */
async function basket(overrides: Partial<CartLine> = {}): Promise<Result<unknown>> {
  return postJson(CART, { lines: [await lineOf(overrides)] });
}

/** The senders the rows below reuse: the calls whose request takes more than one line to build. */
const absentLine: Send = async () => {
  const line = without(await lineOf(), "sku");
  return postJson(CART, { lines: [line] });
};
const badAddedAt: Send = async () => basket({ addedAt: "not-an-instant" });
const unknownPromo: Send = async () =>
  postJson(PROMO, { code: "NOSUCHCODE", lines: [await lineOf()] });
const badRegistration: Send = () =>
  postJson(REGISTER, { email: "not-an-address", password: "short", firstName: "", lastName: "" });
const updateOther: Send = (s) => patchJson(otherPath(s, DETAIL), PROFILE_BODY, as(s.customer));
const addOther: Send = (s) => postJson(otherPath(s, BOOK), ADDRESS_BODY, as(s.customer));
const editOther: Send = (s) =>
  patchJson(otherPath(s, ADDRESS, "adr_1"), ADDRESS_BODY, as(s.customer));
const removeOther: Send = (s) => deleteJson(otherPath(s, ADDRESS, "adr_1"), as(s.customer));
const defaultOther: Send = (s) =>
  postJson(otherPath(s, ADDRESS_DEFAULT, "adr_1"), { kind: "shipping" }, as(s.customer));
const badProfile: Send = (s) =>
  patchJson(ownPath(s, DETAIL), { ...PROFILE_BODY, firstName: "" }, as(s.customer));
const editHeld: Send = async (s) => {
  const addressId = await heldAddress(s);
  return patchJson(pathFor(ADDRESS, s.customer.customerId, { addressId }), {}, as(s.customer));
};
const defaultHeld: Send = async (s) => {
  const addressId = await heldAddress(s);
  return postJson(
    pathFor(ADDRESS_DEFAULT, s.customer.customerId, { addressId }),
    { kind: "main" },
    as(s.customer),
  );
};
const editAbsent: Send = (s) =>
  patchJson(ownPath(s, ADDRESS, "adr_absent"), ADDRESS_BODY, as(s.customer));
const removeAbsent: Send = (s) => deleteJson(ownPath(s, ADDRESS, "adr_absent"), as(s.customer));
const badStatus: Send = (s) => getJson(`${ORDERS}?status=invented`, as(s.customer));
const halfOrderRange: Send = (s) =>
  getJson(`${ORDERS}?from=${acceptedRange().from}`, as(s.customer));
const absentReview: Send = (s) =>
  postJson(
    pathFor(REVIEWS, "prod_absent"),
    { rating: 5, title: REVIEW_TITLE, body: REVIEW_BODY },
    as(s.customer),
  );
const oddBucket: Send = (s) =>
  getJson(`${KPIS}?${rangeQuery({ bucket: "fortnight" })}`, as(s.admin));
const oddBaseline: Send = (s) =>
  getJson(`${KPIS}?${rangeQuery({ baseline: "sideways" })}`, as(s.admin));
const halfKpiRange: Send = (s) => getJson(`${KPIS}?from=${acceptedRange().from}`, as(s.admin));
const oddGrouping: Send = (s) =>
  getJson(`${REVENUE}?${rangeQuery({ groupBy: "sku" })}`, as(s.admin));
const oddMetric: Send = (s) =>
  getJson(`${TOP_PRODUCTS}?${rangeQuery({ metric: "profit" })}`, as(s.admin));
const oddReport: Send = (s) =>
  getJson(`${fillApiPath(REPORT_RUN, { kind: "invented" })}?${rangeQuery()}`, as(s.admin));
const badRatingFilter: Send = async () => getJson(`${await reviewPath()}?rating=9`);
const notABasket: Send = () => postJson(CART, "no basket");
const overUnits: Send = () => basket({ maxQuantity: 2, quantity: 3 });
const nonListBasket: Send = () => postJson(PROMO, { code: "SAVE10", lines: {} });
const addEmpty: Send = (s) => postJson(ownPath(s, BOOK), {}, as(s.customer));
const noRangeRanking: Send = (s) => getJson(`${TOP_PRODUCTS}?metric=revenue`, as(s.admin));
const noRangeReport: Send = (s) => getJson(fillApiPath(REPORT_RUN, { kind: "sales" }), as(s.admin));
const profileOfOther: Send = (s) => getJson(otherPath(s, DETAIL), as(s.customer));
const bookOfOther: Send = (s) => getJson(otherPath(s, BOOK), as(s.customer));
const absentCustomer: Send = (s) => getJson(pathFor(DETAIL, "cus_absent"), as(s.admin));

/** One refused request: what it asks, how it is sent, the control it names where it names one, and the
 *  code and status it answers with where those are not the field-rule `422`. */
type Refusal = readonly [what: string, send: Send, field?: string, code?: string, status?: number];

/** The refusals, one row per decision the route table makes before it answers. */
const REFUSALS: readonly Refusal[] = [
  // The catalogue's filter members, each judged against the domain its own control declares.
  ["a rating floor outside the five", () => getJson(`${PRODUCTS}?minRating=9`), "minRating"],
  ["a minimum price below nothing", () => getJson(`${PRODUCTS}?minPrice=-1`), "minPrice"],
  ["a maximum price below nothing", () => getJson(`${PRODUCTS}?maxPrice=-4`), "maxPrice"],
  ["an availability flag reading oddly", () => getJson(`${PRODUCTS}?inStock=perhaps`), "inStock"],
  ["a sort order no control offers", () => getJson(`${PRODUCTS}?sort=cheapest`), "sort"],
  ["a facet count with a bad rating floor", () => getJson(`${FACETS}?minRating=7`), "minRating"],
  ["a review list with a bad rating filter", badRatingFilter, "rating"],
  // The bodies the cart endpoints read.
  ["a basket submitted as something other than an object", notABasket, "lines"],
  ["a basket line missing an identifying member", absentLine, "lines"],
  ["a basket line added at something that is not an instant", badAddedAt, "lines"],
  ["a basket line asking for no units at all", () => basket({ quantity: 0 }), "lines"],
  ["a line asking for more units than it holds", overUnits, "lines", "insufficient-stock"],
  ["a basket with no line at all", () => postJson(CART, { lines: [] }), "lines"],
  ["a promo code shaped unlike one", () => postJson(PROMO, { code: "not a code!" }), "promoCode"],
  ["a promo code against a basket that is not a list", nonListBasket, "lines"],
  ["a well-formed promo code the store does not hold", unknownPromo, "promoCode", "unknown", 409],
  // The credentials a session is opened with.
  ["a sign-in with no password", () => postJson(LOGIN, { email: SHOPPER_EMAIL }), "password"],
  ["a sign-in whose body is not an object", () => postJson(LOGIN, ["not", "credentials"]), "email"],
  ["a registration no account rule accepts", badRegistration, "email"],
  // The records a session may not reach: another account's profile, book and addresses.
  ["another account's profile", profileOfOther, NO_FIELD, "forbidden", 403],
  ["another account's book", bookOfOther, NO_FIELD, "forbidden", 403],
  ["another account's profile as an update", updateOther, NO_FIELD, "forbidden", 403],
  ["another account's book as an addition", addOther, NO_FIELD, "forbidden", 403],
  ["another account's address as an edit", editOther, NO_FIELD, "forbidden", 403],
  ["another account's address as a removal", removeOther, NO_FIELD, "forbidden", 403],
  ["another account's address as a default", defaultOther, NO_FIELD, "forbidden", 403],
  [
    "an account no store holds, read by an administrator",
    absentCustomer,
    NO_FIELD,
    "forbidden",
    403,
  ],
  // The bodies a signed-in customer's own record is written with.
  ["an update leaving the account without a first name", badProfile, "firstName"],
  ["an address added with nothing filled in", addEmpty, "fullName"],
  ["an address of the book replaced by nothing", editHeld, "fullName"],
  ["an address the book does not hold", editAbsent, NO_FIELD, "address-not-found", 404],
  ["an address of the book asked to be removed", removeAbsent, NO_FIELD, "address-not-found", 404],
  ["an address asked to default to a non-kind", defaultHeld, "kind"],
  // The history filters, and the review drafts a customer submits.
  ["an order history filtered by a status no order carries", badStatus, "status"],
  ["an order history over a range with one end only", halfOrderRange, "to"],
  ["a review submitted with no rating", (s) => review(s, { rating: undefined }), "rating"],
  ["a review submitted with a title too short", (s) => review(s, { title: "ok" }), "title"],
  ["a review of an absent product", absentReview, NO_FIELD, "product-not-found", 404],
  // The dashboard's and the reports' dated members.
  ["a KPI read cut into an odd period", oddBucket, "bucket"],
  ["a KPI read against a bad baseline", oddBaseline, "baseline"],
  ["a KPI read over a range with one end only", halfKpiRange, "to"],
  ["a revenue series split by a bad grouping", oddGrouping, "groupBy"],
  ["a product ranking ordered by a bad metric", oddMetric, "metric"],
  ["a product ranking asked for with no range", noRangeRanking, "from"],
  ["a report run with no range", noRangeReport, "from"],
  ["a report whose kind no definition declares", oddReport, NO_FIELD, "route-not-found", 404],
];

describe("a hand-made request the route table refuses", () => {
  it("answers each row with its own status, code and control", async () => {
    const answered = await signedIn();
    for (const [what, send, field, code, status] of REFUSALS) {
      const error = await refusalOf(send(answered), what);
      expect([what, error.status, error.code]).toEqual([what, status ?? 422, code ?? INVALID]);
      expect([what, error.field]).toEqual([what, field]);
      expect(error.message.length, what).toBeGreaterThan(0);
    }
  });
});

describe("the reads the same routes answer", () => {
  it("lists no suggestion for a request that carries no term", async () => {
    const response = await valueOf(getJson<SearchSuggestionResponse>(API_PATHS.SEARCH_SUGGEST));
    expect(response).toEqual({ suggestions: [] });
  });

  it("ends a session only when the request carries a token, and answers either way", async () => {
    const tokenless = await postJson<void>(API_PATHS.AUTH_LOGOUT, undefined);
    expect(tokenless).toEqual({ ok: true, value: undefined });
    const { customer } = await signedIn();
    expect((await postJson<void>(API_PATHS.AUTH_LOGOUT, undefined, as(customer))).ok).toBe(true);
    const afterEnding = await getJson(API_PATHS.AUTH_SESSION, as(customer));
    expect(afterEnding.ok).toBe(false);
    if (!afterEnding.ok) expect(afterEnding.error.code).toBe(API_ERROR_CODES.SESSION_UNKNOWN);
  });

  it("writes a review a signed-in customer submits, and lists it under its product", async () => {
    const { customer } = await signedIn();
    const product = await servedProduct();
    const before = await valueOf(getJson<PageResult<Review>>(pathFor(REVIEWS, product.id)));
    const draft = { rating: 5, title: REVIEW_TITLE, body: REVIEW_BODY };
    const written = await valueOf(
      postJson<Review>(pathFor(REVIEWS, product.id), draft, as(customer)),
    );
    expect([written.productId, written.rating, written.title, written.body]).toEqual([
      product.id,
      5,
      REVIEW_TITLE,
      REVIEW_BODY,
    ]);
    expect(written.customerId).toBe(customer.customerId);
    const after = await valueOf(getJson<PageResult<Review>>(pathFor(REVIEWS, product.id)));
    expect(after.total).toBe(before.total + 1);
  });

  it("reads the newest orders at a limit confined to at least one row", async () => {
    const { admin } = await signedIn();
    const response = await valueOf(
      getJson<{ readonly items: readonly Order[] }>(RECENT_ORDERS, {
        query: { limit: 0 },
        ...as(admin),
      }),
    );
    expect(response.items.map((one) => one.id)).toEqual(
      source.getRecentOrders(1).map((one) => one.id),
    );
  });
});
