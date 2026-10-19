/**
 * Path: src/data/orders.ts
 * Purpose: The generated 365-day order history, with 60 orders attributed to the seeded customers
 * Lines: 595
 */

import {
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  MAX_REPORT_RANGE_DAYS,
  SHIPPING_METHODS,
} from "@/constants/config";
import { ADDRESSES, CUSTOMERS, buildAddress } from "@/data/customers";
import { planAttribution, type Attribution } from "@/data/orderAttribution";
import { DATA_SEED, PRODUCTS, createSeededRandom, type SeededRandom } from "@/data/products";
import { appendStatusHistory, orderNumber, toOrderLines } from "@/utils/orderRules";
import { decidePromo, priceCartLines } from "@/utils/pricingRules";
import type { Address, Customer } from "@/types/account";
import type { CategoryId, IsoDateString, IsoDateTimeString } from "@/types/common";
import type {
  CartLine,
  Order,
  OrderStatus,
  PaymentSummary,
  PromoCode,
  PromoKind,
  PromoScope,
} from "@/types/commerce";
import { indexBy, sum } from "@/utils/collections";
import { addDays, differenceInDays, parseIso, toIsoDate, toIsoDateTime } from "@/utils/dates";
import { addHoursToDate } from "@/utils/dates";
import { categoryId, prefixedId, sequenceId, slugify } from "@/utils/strings";

// The seeded streams and the span -----------------------------------------------------------------

/** This module's own stream, offset from the seed `src/data/products.ts` declares, so no seeded collection
 *  inherits another's draws. */
const SEED = DATA_SEED + 5_009;

/** The trailing days the history's sixty attributed orders are placed in: the year the seeded accounts' own
 *  order history covers, which the era now preceding it must leave exactly where it is. */
const TRAILING_WINDOW_DAYS = 365;

/** The offset the earlier era's stream carries, for the reason {@link SEED} itself is offset from the
 *  catalogue's: neither era of one history may inherit the other's draws. */
const EARLIER_ERA_SEED = SEED + 7_919;

/** The days the history spans: the widest accepted range plus the year before it, so that the previous-year
 *  window of every range ending today falls inside the seed and the baseline the dashboard offers has a
 *  figure to state. */
const HISTORY_DAYS = MAX_REPORT_RANGE_DAYS + TRAILING_WINDOW_DAYS;

/** The first and last hour an order is placed at, the hour the anchor day ends at, and the hours in a day. */
const DAY_FIRST_HOUR = 7;
const DAY_LAST_HOUR = 21;
const WINDOW_LAST_HOUR = 23;
const HOURS_PER_DAY = 24;

/** The day every date and instant in the history is measured from: the clock, read once per build and reduced to a
 *  calendar day, so two builds on the same day return deeply equal orders. Nothing else here reads the clock, calls
 *  `Math.random`, or serialises a `Date` outside `src/utils/dates.ts`. */
function anchorDayFor(now: Date): IsoDateString {
  return toIsoDate(now);
}

// Promo codes --------------------------------------------------------------------------------------

/** One row of the code table, read by position: spelling, kind, what the kind's value means (a percentage, an amount
 *  in minor units, or nothing for a free-delivery code), basket floor, uses allowed and made, whether it is live, and
 *  the day offsets its window opens and closes at — offsets, because a code with two fixed dates expires. */
type PromoRow = readonly [
  string,
  PromoKind,
  number,
  number,
  number,
  number,
  boolean,
  number,
  number,
];

/** The eight codes the store has issued: five that apply to a basket today and three that exist so each way a code
 *  is refused can be met — one at its usage limit, one whose window has closed and one withdrawn. What a code
 *  requires is `src/lib/pricingService.ts`'s rule, so this table states only its conditions. */
const PROMO_ROWS: readonly PromoRow[] = [
  ["SAVE10", "percent", 10, 0, 999, 120, true, -400, 60],
  ["SAVE15", "percent", 15, 5_000, 500, 260, true, -400, 60],
  ["FLAT500", "fixed", 500, 2_500, 300, 84, true, -200, 45],
  ["FREESHIP", "free_shipping", 0, 2_000, 400, 173, true, -400, 60],
  ["SUMMER25", "percent", 25, 10_000, 250, 210, true, -150, -30],
  ["RETIRED10", "percent", 10, 0, 500, 88, false, -400, 60],
];

/** The two codes that discount one category's lines only, each with the leaf category it reaches. */
const CATEGORY_PROMO_ROWS: readonly (readonly [PromoRow, CategoryId])[] = [
  [["BEAUTY15", "percent", 15, 3_000, 200, 31, true, -300, 90], categoryId("skin-care")],
  [["AUDIO20", "percent", 20, 0, 40, 40, true, -90, 30], categoryId("audio")],
];

/** Expands one row into the stored code it describes, dating its window through `src/utils/dates.ts`. */
function toPromoCode(row: PromoRow, anchorDay: IsoDateString, scope?: CategoryId): PromoCode {
  const [code, kind, value, floor, limit, uses, active, opensAt, closesAt] = row;
  const target: PromoScope = scope === undefined ? "order" : "category";
  const reach = { appliesTo: target, categoryIds: scope === undefined ? [] : [scope] };
  const dates = { startsAt: addDays(anchorDay, opensAt), endsAt: addDays(anchorDay, closesAt) };
  const stored = {
    code,
    kind,
    value,
    minSubtotalMinor: floor,
    usageLimit: limit,
    usageCount: uses,
  };
  return { ...stored, ...reach, ...dates, active };
}

/**
 * Builds the eight seeded promo codes, with their windows dated against today.
 *
 * @returns The codes, the order-scoped ones first.
 */
export function buildPromoCodes(): readonly PromoCode[] {
  const anchorDay = anchorDayFor(new Date());
  return [
    ...PROMO_ROWS.map((row) => toPromoCode(row, anchorDay)),
    ...CATEGORY_PROMO_ROWS.map(([row, category]) => toPromoCode(row, anchorDay, category)),
  ];
}

/** The seeded promo codes, exactly as {@link buildPromoCodes} builds them: the reference collection
 *  `src/data/repositories.ts` imports to answer `POST /api/cart/validate-promo` and to price a cart. */
export const PROMO_CODES: readonly PromoCode[] = buildPromoCodes();

// The catalogue and the account base ---------------------------------------------------------------

/** One catalogue record, taken off the seeded catalogue rather than named as an imported type. */
type CatalogueProduct = (typeof PRODUCTS)[number];
/** The catalogue's in-stock records, because a line's quantity is bounded by what is on the shelf. */
const SELLABLE_PRODUCTS: readonly CatalogueProduct[] = PRODUCTS.filter(
  (product) => product.stockOnHand > 0,
);
/** Each product's category, keyed by product, because a basket line carries no category of its own and a
 *  `category`-scoped code is narrowed by it. */
const CATEGORY_BY_PRODUCT: ReadonlyMap<string, CategoryId> = new Map(
  PRODUCTS.map((product) => [product.id, product.categoryId]),
);
/** Every seeded address, keyed by its identifier. */
const ADDRESS_BY_ID: ReadonlyMap<Address["id"], Address> = indexBy(
  ADDRESSES,
  (address) => address.id,
);

/** Where in `CUSTOMERS` an account sits, located rather than assumed to hold a fixed place. */
function customerIndexOf(email: string): number {
  const index = CUSTOMERS.findIndex((customer) => customer.email === email);
  if (index < 0) throw new Error(`The seeded accounts do not hold "${email}".`);
  return index;
}
/** The shopper the shopping, checkout and account flows sign in as, whose orders are kept clear of cancellation. */
const SHOPPER_CUSTOMER_INDEX = customerIndexOf(DEMO_ACCOUNTS.CUSTOMER_EMAIL);

/** The seeded address `id` names; a reference the store does not hold is a seed mistake. */
function addressOf(id: Address["id"]): Address {
  const address = ADDRESS_BY_ID.get(id);
  if (address === undefined) throw new Error(`The seeded address books do not hold "${id}".`);
  return address;
}

// Guest orders ------------------------------------------------------------------------------------

/** The reserved domain guest orders are placed from: a `.test` name resolves nowhere and differs from the three
 *  domains the seeded accounts share. */
const GUEST_EMAIL_DOMAIN = "checkout.test";
/** The name pools a guest contact is drawn from, written as lines of words split into entries, and the labels its
 *  two addresses carry. */
const GUEST_FIRST_NAMES = "Ada Bram Cora Dev Esme Felipe Greta Hugo Ines Johan Karim".split(" ");
const GUEST_LAST_NAMES = "Ashford Bellamy Cortez Delgado Emerson Fairfax Grant Hollis".split(" ");
const SHIPPING_ADDRESS_LABEL = "Home";
const BILLING_ADDRESS_LABEL = "Billing";

// The daily volume curve --------------------------------------------------------------------------

/** Orders per weekday, Sunday first, so every day of the span trades — the smallest carries two orders — and no
 *  day is a hole in the revenue series and in the sales facts derived from this history. */
const WEEKLY_VOLUME = [4, 2, 2, 3, 3, 4, 3];
/** The trailing days that carry the seasonal lift, and how many orders each adds. */
const SEASONAL_LIFT_DAYS = 60;
const SEASONAL_LIFT_VOLUME = 1;

/** Plans the history's days: every day of its whole span, oldest first, with the orders it trades in. The
 *  seasonal lift still falls on the last {@link SEASONAL_LIFT_DAYS} of them — the same calendar days it lifted
 *  before the span grew — so the trailing window trades exactly as it did. */
function planDays(anchorDay: IsoDateString): readonly { date: IsoDateString; volume: number }[] {
  const firstDay = addDays(anchorDay, -(HISTORY_DAYS - 1));
  const days: { date: IsoDateString; volume: number }[] = [];
  for (let offset = 0; offset < HISTORY_DAYS; offset += 1) {
    const date = addDays(firstDay, offset);
    const weekday = parseIso(date)?.getDay() ?? 0;
    const lifted = offset >= HISTORY_DAYS - SEASONAL_LIFT_DAYS ? SEASONAL_LIFT_VOLUME : 0;
    days.push({ date, volume: WEEKLY_VOLUME[weekday] + lifted });
  }
  return days;
}

// Planning the two eras ---------------------------------------------------------------------------

/** The history's two eras, oldest first: the earlier one, which precedes the trailing window and whose orders
 *  are all guests'; and the trailing window itself, which holds the sixty orders attributed to seeded accounts. */
interface PlannedHistory {
  readonly earlier: readonly PlannedOrder[];
  readonly recent: readonly PlannedOrder[];
}

/** One order the history is about to place: the day it belongs to, its position within that day — which is what
 *  its order number is built from — how old it is, and the account it belongs to when the attribution places it. */
interface PlannedOrder {
  readonly date: IsoDateString;
  readonly sequence: number;
  readonly ageDays: number;
  readonly attribution: Attribution | undefined;
}

/** Turns a run of the history's days into one slot per order each day trades, with no account yet: attribution
 *  is planned over one era's slots rather than over the whole history's. */
function planSlots(
  days: readonly { readonly date: IsoDateString; readonly volume: number }[],
  anchorDay: IsoDateString,
): PlannedOrder[] {
  const slots: PlannedOrder[] = [];
  for (const day of days) {
    const ageDays = differenceInDays(day.date, anchorDay);
    for (let position = 0; position < day.volume; position += 1) {
      slots.push({ date: day.date, sequence: position + 1, ageDays, attribution: undefined });
    }
  }
  return slots;
}

/**
 * Plans the whole history in its two eras, oldest first: the earlier era — the history's first 366 days, left to
 * guests alone — and the trailing window of 365 days immediately after it, which holds the sixty attributed orders.
 *
 * The two are planned separately because attribution is spread over one era's slots: `planAttribution` places
 * sixty orders evenly through whatever order count it is given, so planning the history in one pass would
 * space them across both eras and move every account, day and status the trailing window holds today. The
 * earlier era's days are the only ones the trailing window's own attribution does not see.
 */
function planOrders(anchorDay: IsoDateString): PlannedHistory {
  const days = planDays(anchorDay);
  const windowOpens = days.length - TRAILING_WINDOW_DAYS;
  const earlier = planSlots(days.slice(0, windowOpens), anchorDay);
  const recent = planSlots(days.slice(windowOpens), anchorDay);
  const attribution = planAttribution(recent.length);
  return {
    earlier,
    recent: recent.map((slot, index) => ({ ...slot, attribution: attribution.get(index) })),
  };
}

// The status distribution -------------------------------------------------------------------------

/** The age from which an order may be finished: a delivery, and the cancellation or refund that can follow one, is
 *  only dated at orders this old or older. */
const SETTLED_AFTER_DAYS = 7;
/** The statuses the history's orders hold, by how long ago they were placed, a status appearing in a pool as often
 *  as its share: most of the history is old enough to have finished, so most of it is delivered, with a genuine
 *  minority cancelled or refunded, which the facts derived from it report as refunds. */
const STATUS_BANDS: readonly {
  readonly maxAgeDays: number;
  readonly pool: readonly OrderStatus[];
}[] = [
  { maxAgeDays: 0, pool: ["confirmed", "confirmed", "confirmed", "pending"] },
  { maxAgeDays: 2, pool: ["processing", "processing", "processing", "confirmed", "cancelled"] },
  { maxAgeDays: 6, pool: ["processing", "processing", "shipped", "confirmed", "cancelled"] },
  {
    maxAgeDays: Number.MAX_SAFE_INTEGER,
    pool: ["delivered", "delivered", "delivered", "delivered", "shipped", "cancelled", "refunded"],
  },
];

/** The statuses an order passes through to hold the status it holds, each walk opening at the `pending` entry a
 *  freshly placed order carries, and every move one `src/lib/orderService.ts` permits. */
const STATUS_PATHS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ["pending"],
  confirmed: ["pending", "confirmed"],
  processing: ["pending", "confirmed", "processing"],
  shipped: ["pending", "confirmed", "processing", "shipped"],
  delivered: ["pending", "confirmed", "processing", "shipped", "delivered"],
  cancelled: ["pending", "cancelled"],
  refunded: ["pending", "confirmed", "processing", "shipped", "delivered", "refunded"],
};

/** The status a planned order holds: the draw the band its age falls in allows, except for the documented shopper's own
 *  orders, where a cancellation becomes the status of an order that finished normally instead, so that history can be empty. */
function statusFor(plan: PlannedOrder, rand: SeededRandom): OrderStatus {
  const settled = STATUS_BANDS.find((entry) => plan.ageDays <= entry.maxAgeDays);
  const band = settled ?? STATUS_BANDS[STATUS_BANDS.length - 1];
  const drawn = rand.pick(band.pool);
  const live = plan.attribution?.customerIndex === SHOPPER_CUSTOMER_INDEX;
  if (!live || (drawn !== "cancelled" && drawn !== "refunded")) return drawn;
  return plan.ageDays >= SETTLED_AFTER_DAYS ? "delivered" : "processing";
}

// Building one order ------------------------------------------------------------------------------

/** The fewest and most lines an order holds and the most of any one product it holds, plus the weights that split the
 *  history's orders across the configured delivery methods in the order the configuration declares them. */
const MIN_ORDER_LINES = 1;
const MAX_ORDER_LINES = 5;
const MAX_LINE_QUANTITY = 4;
const SHIPPING_METHOD_WEIGHTS = [1, 3, 4, 2, 1];

/** The share of the history's orders placed with a promo code, paid for by card rather than invoiced, and cancelled
 *  after a declined card: a meaningful minority of codes, so the discount lines and discount amounts are non-zero. */
const PROMO_ORDER_CHANCE = 0.22;
const CARD_PAYMENT_CHANCE = 0.88;
const CANCELLED_DECLINED_CHANCE = 0.5;

/** The two cards the history's payments were taken with, reduced to what an order may record: the brand the seam
 *  reads from the number's leading digit — both demonstration numbers begin with `4`, which it reads as a Visa — and
 *  the four digits it keeps, so no order holds a chargeable value. */
const APPROVED_CARD = { brand: "Visa", last4: DEMO_CARD_NUMBERS.APPROVED.slice(-4) } as const;
const DECLINED_CARD = { brand: "Visa", last4: DEMO_CARD_NUMBERS.DECLINED.slice(-4) } as const;

/** The payment an invoiced order records, accepted with no card and nothing authorised, and the payment a declined
 *  card leaves, which is the brand and the last four digits alone. */
const INVOICE_PAYMENT: PaymentSummary = {
  method: "invoice",
  status: "authorised",
  brand: null,
  last4: null,
  authorisedAt: null,
};
const DECLINED_PAYMENT: PaymentSummary = {
  method: "card",
  status: "declined",
  brand: DECLINED_CARD.brand,
  last4: DECLINED_CARD.last4,
  authorisedAt: null,
};

/** The payment an order records. Goods that went out were captured, the money is back once the order is refunded,
 *  an order still moving holds an authorisation alone, and a cancelled order was declined about half the time. */
function paymentFor(
  status: OrderStatus,
  placedAt: IsoDateTimeString,
  rand: SeededRandom,
): PaymentSummary {
  if (rand.chance(1 - CARD_PAYMENT_CHANCE)) return INVOICE_PAYMENT;
  if (status === "cancelled" && rand.chance(CANCELLED_DECLINED_CHANCE)) return DECLINED_PAYMENT;
  const captured = status === "delivered" || status === "shipped";
  const settled = status === "refunded" ? "refunded" : captured ? "captured" : "authorised";
  const card = { brand: APPROVED_CARD.brand, last4: APPROVED_CARD.last4, authorisedAt: placedAt };
  return { method: "card", status: settled, ...card };
}

/** One basket line: the product's name, sku, price and picture copied as a snapshot, and its stock copied as the
 *  ceiling the quantity may reach. */
function toCartLine(
  product: CatalogueProduct,
  quantity: number,
  placedAt: IsoDateTimeString,
  id: CartLine["id"],
): CartLine {
  const { id: productId, sku, name, priceMinor, stockOnHand, images } = product;
  return {
    id,
    productId,
    sku,
    name,
    unitPriceMinor: priceMinor,
    quantity,
    maxQuantity: stockOnHand,
    imageUrl: images[0].url,
    addedAt: placedAt,
  };
}

/** Builds one order's basket: one to five distinct products, each ordered in a quantity inside what is on the shelf,
 *  numbered from the running line index the caller passes so no two lines share an identifier. */
function basketFor(
  rand: SeededRandom,
  placedAt: IsoDateTimeString,
  firstLineIndex: number,
): CartLine[] {
  const chosen = rand.pickMany(SELLABLE_PRODUCTS, rand.int(MIN_ORDER_LINES, MAX_ORDER_LINES));
  return chosen.map((product, offset) => {
    const quantity = rand.int(1, Math.min(MAX_LINE_QUANTITY, product.stockOnHand));
    return toCartLine(product, quantity, placedAt, sequenceId("line", firstLineIndex + offset));
  });
}

/** The delivery method an order was placed with: a weighted draw over the configured methods, so the everyday
 *  services carry most of the history and the express one the fewest. */
function shippingMethodFor(rand: SeededRandom): string {
  if (SHIPPING_METHOD_WEIGHTS.length !== SHIPPING_METHODS.length) {
    throw new Error("The delivery weights and the configured delivery methods do not line up.");
  }
  const ticket = rand.int(1, sum(SHIPPING_METHOD_WEIGHTS));
  let running = 0;
  for (const [index, weight] of SHIPPING_METHOD_WEIGHTS.entries()) {
    running += weight;
    if (ticket <= running) return SHIPPING_METHODS[index].id;
  }
  return SHIPPING_METHODS[0].id;
}

/** The code an order was placed with, or `undefined` for the orders placed without one. A code is kept only if the
 *  pricing service's own decision rule accepts it for this basket on this day: `decidePromo` is the single
 *  implementation of what a code requires, so a seeded order cannot carry a code the cart would refuse. */
function promoFor(
  date: IsoDateString,
  lines: readonly CartLine[],
  rand: SeededRandom,
): PromoCode | undefined {
  if (!rand.chance(PROMO_ORDER_CHANCE)) return undefined;
  for (const promo of rand.shuffle(PROMO_CODES)) {
    const rule = {
      code: promo.code,
      promo,
      lines,
      today: date,
      categoryIdsByProductId: CATEGORY_BY_PRODUCT,
    };
    if (decidePromo(rule) === undefined) return promo;
  }
  return undefined;
}

/** The instant an order was placed at: an hour inside the trading day and a minute inside that hour, built through
 *  `src/utils/dates.ts` from a day, as the customer seed builds its own timestamps. */
function instantOn(date: IsoDateString, rand: SeededRandom): IsoDateTimeString {
  const at = parseIso(date);
  if (at === null) throw new TypeError(`An order needs an ISO 8601 day; received "${date}".`);
  at.setHours(rand.int(DAY_FIRST_HOUR, DAY_LAST_HOUR), rand.int(0, 59), 0, 0);
  return toIsoDateTime(at);
}

/** How far apart the entries of one order's status history are placed at most, in hours. */
const MAX_STATUS_STEP_HOURS = 36;

/** Records a planned order's whole status history: the path its status allows from the opening `pending` entry,
 *  its entries as many whole hours apart as the order's age leaves room for, so the last still falls no later
 *  than the day the history ends on. */
function recordStatusHistory(order: Order, plan: PlannedOrder, status: OrderStatus): Order {
  const path = STATUS_PATHS[status];
  const start = parseIso(order.placedAt);
  if (start === null)
    throw new TypeError(`An order instant must be an ISO 8601 date-time: ${order.placedAt}`);
  const room = plan.ageDays * HOURS_PER_DAY + (WINDOW_LAST_HOUR - start.getHours());
  const step = Math.max(1, Math.min(MAX_STATUS_STEP_HOURS, Math.floor(room / path.length)));
  return path.reduce((current, entry, index) => {
    const at = addHoursToDate(start, index * step);
    return appendStatusHistory(current, entry, toIsoDateTime(at));
  }, order);
}

/** Who placed an order: the account it is attributed to, the address it confirms to, and the two addresses it is
 *  shipped to and billed to, kept as snapshots so a later address edit cannot rewrite a placed order. */
interface OrderIdentity {
  readonly customerId: Customer["id"] | null;
  readonly email: string;
  readonly shippingAddress: Address;
  readonly billingAddress: Address;
}

/** The identity an order is placed under: a seeded account's own email and the defaults its address book records,
 *  or a guest's contact — a name drawn from the pools and the reserved-domain address derived from it — with the
 *  two addresses built through the shared address factory for that order, which keys their identifiers. */
function identityFor(plan: PlannedOrder, id: Order["id"], rand: SeededRandom): OrderIdentity {
  const attribution = plan.attribution;
  if (attribution !== undefined) {
    const customer = CUSTOMERS[attribution.customerIndex];
    const book = customer.addressIds.map(addressOf);
    const shippingAddress = book.find((entry) => entry.isDefaultShipping) ?? book[0];
    const billingAddress = book.find((entry) => entry.isDefaultBilling) ?? shippingAddress;
    return { customerId: customer.id, email: customer.email, shippingAddress, billingAddress };
  }
  const fullName = `${rand.pick(GUEST_FIRST_NAMES)} ${rand.pick(GUEST_LAST_NAMES)}`;
  const shared = { owner: id, fullName, random: rand } as const;
  const shippingAddress = buildAddress({
    ...shared,
    label: SHIPPING_ADDRESS_LABEL,
    isDefaultShipping: true,
  });
  const billingAddress = buildAddress({
    ...shared,
    label: BILLING_ADDRESS_LABEL,
    isDefaultBilling: true,
  });
  const email = `${slugify(fullName)}@${GUEST_EMAIL_DOMAIN}`;
  return { customerId: null, email, shippingAddress, billingAddress };
}

/** The idempotency key a seeded order was created under: the prefix and the `attempt` wording the checkout's own key
 *  carries, minted from the order's position rather than the clock. `createIdempotencyKey` is deliberately unused: it
 *  reads the instant and advances a counter, so two builds would mint different keys. */
function idempotencyKeyFor(position: number): string {
  return prefixedId("ord", `attempt seed ${position + 1}`);
}

/**
 * Builds one order: its basket, its identity, its status and its whole lifecycle, priced once.
 *
 * Nothing is computed here that the product computes elsewhere: the basket, the applicable code and the chosen
 * method go to `priceCartLines`, whose `PricedCart` the order keeps entire, and its lines become the order's
 * immutable snapshot through `toOrderLines`, so the name, sku, unit price and total an order reports are the ones
 * the product had at that moment.
 *
 * @param position - The order's position in the history, counting from zero, which keys its identifier.
 * @param plan - The day, position within the day, age and account the order is planned with.
 * @param rand - This build's stream.
 * @param linesSoFar - How many lines the history has written so far, so line identifiers continue.
 */
function buildOrder(
  position: number,
  plan: PlannedOrder,
  rand: SeededRandom,
  linesSoFar: number,
): Order {
  const id = sequenceId("ord", position + 1);
  const placedAt = instantOn(plan.date, rand);
  const identity = identityFor(plan, id, rand);
  const status = plan.attribution?.forcedStatus ?? statusFor(plan, rand);
  const lines = basketFor(rand, placedAt, linesSoFar);
  const shippingMethodId = shippingMethodFor(rand);
  const pricedCart = priceCartLines({
    lines,
    promo: promoFor(plan.date, lines, rand),
    shippingMethodId,
    categoryIdsByProductId: CATEGORY_BY_PRODUCT,
  });
  const draft: Order = {
    ...identity,
    id,
    orderNumber: orderNumber(plan.sequence, placedAt),
    status: "pending",
    lines: toOrderLines(pricedCart),
    shippingMethodId,
    payment: paymentFor(status, placedAt, rand),
    pricedCart,
    placedAt,
    updatedAt: placedAt,
    statusHistory: [],
    idempotencyKey: idempotencyKeyFor(position),
  };
  return recordStatusHistory(draft, plan, status);
}

/**
 * Builds the entire seeded order history in one deterministic pass: the trailing year's orders, priced through
 * `src/lib/pricingService.ts` and numbered and moved on through `src/lib/orderService.ts`, with exactly the
 * sixty attributed to seeded accounts and the rest placed by guests, after the year that precedes them.
 *
 * The earlier era is generated first and from a stream of its own, so that the trailing window is drawn from
 * `SEED`'s very first step: its baskets, prices, promos, methods and statuses are then the ones this history
 * held before the earlier era existed, and the accounts' own order history, the customers report and the
 * default range's sales facts all stay where they were. Its own orders are guests' alone — the cohort of
 * accounts dated inside the trailing year must keep owning none — and it is generated before the window so
 * that the identifiers below run chronologically from the oldest order to the newest.
 *
 * Pure and re-callable: two seed streams and one reading of the clock reduced to a day, nothing else, so two calls
 * on the same day return deeply equal collections. Each basket is drawn with a bounded number of stream steps
 * rather than by shuffling the sellable catalogue. Because every amount came from the product's one pricing
 * implementation, a seeded order's total agrees with what `POST /api/cart/price` answers for the same lines.
 *
 * @returns The whole history, oldest order first.
 */
export function buildOrders(): readonly Order[] {
  const anchorDay = anchorDayFor(new Date());
  const { earlier, recent } = planOrders(anchorDay);
  const orders: Order[] = [];
  let linesSoFar = 0;
  const earlierRand = createSeededRandom(EARLIER_ERA_SEED);
  earlier.forEach((plan, position) => {
    const order = buildOrder(position, plan, earlierRand, linesSoFar);
    linesSoFar += order.lines.length;
    orders.push(order);
  });
  const recentRand = createSeededRandom(SEED);
  recent.forEach((plan, offset) => {
    const order = buildOrder(earlier.length + offset, plan, recentRand, linesSoFar);
    linesSoFar += order.lines.length;
    orders.push(order);
  });
  return orders;
}

/** The seeded order history, exactly as {@link buildOrders} builds it: the collection `src/data/repositories.ts`
 *  serves for a customer's own order history, an order's detail, the dashboard's recent orders and the
 *  product-performance reads that scan it by product. It spans the widest accepted range plus the year before
 *  it, so that the dashboard's previous-year baseline is answered from orders rather than from nothing, and its
 *  trailing year alone is what the sixty attributed orders and a customer's history are drawn from. */
export const ORDERS: readonly Order[] = buildOrders();
