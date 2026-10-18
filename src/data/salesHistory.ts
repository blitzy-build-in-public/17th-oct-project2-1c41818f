/**
 * Path: src/data/salesHistory.ts
 * Purpose: The daily sales fact rows derived from the generated orders, keyed by category and channel
 * Lines: 326
 */

import { ORDERS } from "@/data/orders";
import { PRODUCTS } from "@/data/products";
import type { SalesChannel, SalesRecord } from "@/types/analytics";
import type { CategoryId, IsoDateString, MinorUnits, ProductId } from "@/types/common";
import type { Order } from "@/types/commerce";
import { createComparator, groupBy, indexBy, sortBy, sumBy } from "@/utils/collections";
import { parseIso, startOfDay } from "@/utils/dates";

// The fact table ---------------------------------------------------------------------------------

/**
 * The historical sales series the dashboard and the three reports are read from: what each category sold
 * through each channel on each day of the trailing year.
 *
 * **Reduced from the orders, never generated beside them.** `src/data/orders.ts` already holds the whole
 * seeded history, so the rows here are one reduction over that collection — no second seeded stream, no
 * re-priced basket, no clock read and no randomness — and the two collections therefore come from the same
 * generator. That is what makes a period's revenue and the orders placed in it agree rather than drift
 * apart, and it is the property to keep: every amount a row carries was computed once by
 * `src/lib/pricingService.ts`, is read here, and is never recalculated.
 *
 * **Keyed by day, category and channel, and by nothing else.** A row deliberately carries no product key.
 * Product performance is computed from the order collection, where every line names the product it sold,
 * while the questions a fact table answers — what came in, in which buckets, split how — need only those
 * three keys. A product column would restate the orders and multiply the table by an order of magnitude
 * for no question the dashboard or a report asks.
 *
 * **Sparse.** A row exists per combination activity actually reached, not per combination that could
 * exist: the trailing year crossed with twelve categories and three channels is 13,140 combinations,
 * almost all of them empty. Twelve and not the catalogue's twenty, because a line files under the category
 * of the product it names and only the twelve leaf categories hold products — the eight parents are
 * navigation, so no order can reach a row of theirs. Every reader buckets and sums the rows anyway, so a
 * zero-filled table would cost size and carry no figure a missing row does not already state.
 *
 * **Reconciling.** Every line of every order falls into exactly one row, and an order's discount is split
 * across the rows its lines fall into by the per-line shares `src/lib/pricingService.ts` already computed.
 * Three identities therefore hold over the whole table, and they are this module's acceptance test: the
 * gross revenue is the sum of every placed order line's subtotal, the discount is the sum of every placed
 * order's own discount, and the refunds are the goods of the orders that were cancelled — so gross less
 * discount less refunds is what the orders still standing brought, which is exactly the
 * `periodOrders`/`goodsRevenueMinor` basis `src/utils/statistics.ts` owns, and no row's net revenue is ever
 * negative.
 *
 * **Additive where a reader sums it.** `orders` counts each order once, its own +1 attributed to the single
 * row of the category that carried the most of its goods, ties going to the lower category id, so a sum
 * over the rows of a period is the orders placed in that period rather than one count per category an order
 * sold into. `units` states the ordering population's units alone, because a cancelled order's lines were
 * voided. Both are what makes this table's totals equal the order collection's, the reconciliation this
 * module exists to keep.
 *
 * Dates are local calendar days, because bucketing, the comparison baselines and the report ranges are all
 * computed in the visitor's own time zone.
 */

/** The separator inside a row key. No part of one — an ISO date, a `cat_` identifier and a channel word —
 *  holds it, so the three parts can never be read across one another. */
const ROW_KEY_SEPARATOR = "|";

/**
 * The channel split as exclusive upper tickets out of the sixty minutes an hour holds: the website takes
 * tickets 0 to 36, the app 37 to 52 and the store 53 to 59, so roughly 62% of the history was placed
 * through the website, 27% through the app and 12% through the store — one dominant channel, two smaller.
 */
const CHANNEL_WEB_TICKET_MAX = 37;
const CHANNEL_MOBILE_TICKET_MAX = 53;

// The catalogue lookup ---------------------------------------------------------------------------

/** One catalogue record, taken off the seeded catalogue rather than named as an imported type, as
 *  `src/data/orders.ts` takes it: what this file needs from the catalogue is the collection itself. */
type CatalogueProduct = (typeof PRODUCTS)[number];

/** Each product's category, keyed by the identifier an order line names. A line carries the product it sold
 *  and no category of its own, so this is the one lookup that files a line under a category, built once
 *  rather than scanned for per line. */
const PRODUCT_BY_ID: ReadonlyMap<ProductId, CatalogueProduct> = indexBy(
  PRODUCTS,
  (product) => product.id,
);

/**
 * The category the product an order line names sits in.
 *
 * @param productId - The identifier the line carries.
 * @returns The category that product belongs to.
 * @throws TypeError when the catalogue holds no such product. An order line naming one is a defect in the
 * seeded data rather than a case to absorb: dropping the line would leave the fact table quietly short of
 * revenue the order history still counts.
 */
function categoryOf(productId: ProductId): CategoryId {
  const product = PRODUCT_BY_ID.get(productId);
  if (product === undefined) {
    throw new TypeError(
      `A seeded order line names a product the catalogue does not hold: "${productId}".`,
    );
  }
  return product.categoryId;
}

// The channel of an order ------------------------------------------------------------------------

/**
 * The channel a seeded order was placed through.
 *
 * `Order` records no channel — the union in `src/types/analytics.ts` is a fact-table dimension — so the
 * channel is derived here and nowhere else, and from the order itself rather than from a second seeded
 * stream, a call to `Math.random` or the position the order happens to hold in the collection. The minute
 * of the hour is the ticket because the history's own generator draws it uniformly and independently for
 * every order (`instantOn` in `src/data/orders.ts`): it is a spread already in the record, so the split is
 * stable between two builds and independent of the day, the basket and the customer, and consecutive
 * orders do not land in one channel the way they would under a modulo of the order's position.
 *
 * @param order - The order to file; only the instant it was placed at is read.
 * @returns The channel its goods were sold through.
 */
function channelFor(order: Order): SalesChannel {
  const placedAt = parseIso(order.placedAt);
  if (placedAt === null) {
    throw new TypeError(`An order's placement must be an ISO 8601 date-time: "${order.placedAt}".`);
  }
  const ticket = placedAt.getMinutes();
  if (ticket < CHANNEL_WEB_TICKET_MAX) return "web";
  if (ticket < CHANNEL_MOBILE_TICKET_MAX) return "mobile";
  return "store";
}

// The reduction ----------------------------------------------------------------------------------

/**
 * One order's contribution to one category on one day through one channel: what it adds to a row before
 * the rows are summed.
 *
 * An order makes at most one of these per row, because its lines are grouped by the category their
 * products sit in, and exactly one of them carries the order's own count in `orders` — which is what lets
 * a row's `orders` state the orders attributed to it while the table still sums to the period's count.
 */
interface SalesContribution {
  readonly date: IsoDateString;
  readonly categoryId: CategoryId;
  readonly channel: SalesChannel;
  readonly orders: number;
  readonly units: number;
  readonly grossRevenueMinor: MinorUnits;
  readonly discountMinor: MinorUnits;
  readonly refundMinor: MinorUnits;
}

/** What a contribution carried of its order's goods: the lines' subtotals less the discounts those lines
 *  took, which is the most one category took of the order and, for a cancelled order, what a refund
 *  removes from its row. */
function goodsOf(contribution: SalesContribution): MinorUnits {
  return contribution.grossRevenueMinor - contribution.discountMinor;
}

/**
 * The contribution that carries an order's own count: the row of the category that took the most of the
 * order's goods, and the lower category id when two took the same.
 *
 * One row and not every row, because the column is read as a count of orders: `periodFigures` in
 * `src/lib/analyticsService.ts` and the sales report both sum it over a period, so a +1 on every category
 * an order sold into would state one order two or three times over. The largest share rather than the
 * first, so the attribution does not depend on the order the lines happen to sit in, and the id settling a
 * tie, so it is fixed by the data rather than by the map's insertion order: two builds of one dataset are
 * byte-identical.
 *
 * @param contributions - The contributions one order made; never empty.
 * @returns The index into them of the one that carries the order's count.
 */
function attributionIndex(contributions: readonly SalesContribution[]): number {
  let carrying = 0;
  for (let index = 1; index < contributions.length; index += 1) {
    const goods = goodsOf(contributions[index]);
    const carried = goodsOf(contributions[carrying]);
    const tied =
      goods === carried && contributions[index].categoryId < contributions[carrying].categoryId;
    if (goods > carried || tied) carrying = index;
  }
  return carrying;
}

/**
 * The contributions one order makes to the fact table: its priced lines grouped by the category their
 * products sit in, each group summed to the units it sold, the goods it came to before any discount, that
 * group's share of the order's discount and, for an order that was cancelled, the goods a refund removes.
 *
 * Both per-line amounts are read from the priced cart the order keeps entire rather than recomputed:
 * `lineSubtotalMinor` is the line's own price times its quantity, and `discountMinor` is the share of the
 * order's discount that line carried, allocated by `src/lib/pricingService.ts` in proportion to the
 * subtotals of the lines the code reached. Those shares add up to `discountTotalMinor` exactly and none
 * exceeds its own line, so a category-scoped code's discount lands in the category it applied to and no
 * row's net can go negative. Nothing here multiplies, rounds or prices anything.
 *
 * **Stated over the one order population `src/utils/statistics.ts` owns.** An order that was cancelled
 * sold nothing: its lines were voided, so it states no units and carries no count, and its goods are what
 * its rows' `refundMinor` removes. A refunded order's sale stands — only its money came back afterwards —
 * so its units, its count and its goods all stay. The gross and the discount are stated over every placed
 * order whatever its status, which is what keeps this module's three identities closing over any range.
 *
 * @param order - The order to reduce; neither it nor its cart is written to.
 * @returns One contribution per category the order sold into, and none at all for an order holding no
 * line: a row is keyed by category, so such an order has no row to be stated in.
 */
function contributionsOf(order: Order): readonly SalesContribution[] {
  const channel = channelFor(order);
  const date = startOfDay(order.placedAt);
  const cancelled = order.status === "cancelled";
  const byCategory = groupBy(order.pricedCart.lines, (line) => categoryOf(line.productId));
  const contributions: SalesContribution[] = [...byCategory].map(([categoryId, lines]) => {
    const grossRevenueMinor = sumBy(lines, (line) => line.lineSubtotalMinor);
    const discountMinor = sumBy(lines, (line) => line.discountMinor);
    return {
      date,
      categoryId,
      channel,
      orders: 0,
      units: cancelled ? 0 : sumBy(lines, (line) => line.quantity),
      grossRevenueMinor,
      discountMinor,
      refundMinor: cancelled ? grossRevenueMinor - discountMinor : 0,
    };
  });
  if (cancelled || contributions.length === 0) return contributions;
  const carrying = attributionIndex(contributions);
  return contributions.map((contribution, index) =>
    index === carrying ? { ...contribution, orders: 1 } : contribution,
  );
}

/** A row of the fact table while it is being summed: the three keys it is filed under and the figures its
 *  contributions add up to. Mutable for the length of one build only, and never handed out — a finished row
 *  leaves as the `readonly` `SalesRecord` of `src/types/analytics.ts`. */
interface SalesRow {
  readonly date: IsoDateString;
  readonly categoryId: CategoryId;
  readonly channel: SalesChannel;
  orders: number;
  units: number;
  grossRevenueMinor: MinorUnits;
  discountMinor: MinorUnits;
  refundMinor: MinorUnits;
}

/** The key a contribution is filed under: the day, the category and the channel, which together name one
 *  row. Text rather than nested maps, because the three parts are already text and none holds the
 *  separator. */
function rowKeyOf(contribution: SalesContribution): string {
  return [contribution.date, contribution.categoryId, contribution.channel].join(ROW_KEY_SEPARATOR);
}

/** The order the rows are emitted in: oldest day first, then by category, then by channel. The three keys
 *  together are unique to a row, so the order is total and two builds of the same data are byte-identical
 *  however the map that held the rows was filled. */
const SALES_ROW_ORDER = createComparator<SalesRow>([
  { select: (row) => row.date },
  { select: (row) => row.categoryId },
  { select: (row) => row.channel },
]);

/** Closes a summed row: its net revenue is its gross less its discount and its refunds, computed once here
 *  so that no reader subtracts the three figures for itself. */
function toSalesRecord(row: SalesRow): SalesRecord {
  return {
    date: row.date,
    categoryId: row.categoryId,
    channel: row.channel,
    orders: row.orders,
    units: row.units,
    grossRevenueMinor: row.grossRevenueMinor,
    discountMinor: row.discountMinor,
    refundMinor: row.refundMinor,
    netRevenueMinor: row.grossRevenueMinor - row.discountMinor - row.refundMinor,
  };
}

/**
 * Builds the daily sales fact table from the seeded order history: one row per day, category and channel
 * the trailing year's orders actually sold into.
 *
 * One grouping pass over the orders and one accumulation loop, and nothing else reads the clock, a random
 * stream or a stored value of its own, so two calls return deeply equal collections — the same rows in the
 * same order — and the rows reconcile with the orders they came from: a period's `orders` is the orders
 * placed in it that were not cancelled, its `units` the units those orders sold, and its revenue the goods
 * they brought net of the discounts applied to them.
 *
 * @returns The rows, oldest day first, then by category and channel.
 */
export function buildSalesRecords(): readonly SalesRecord[] {
  const rows = new Map<string, SalesRow>();
  for (const contribution of ORDERS.flatMap(contributionsOf)) {
    const key = rowKeyOf(contribution);
    const row = rows.get(key);
    if (row === undefined) {
      rows.set(key, {
        date: contribution.date,
        categoryId: contribution.categoryId,
        channel: contribution.channel,
        orders: contribution.orders,
        units: contribution.units,
        grossRevenueMinor: contribution.grossRevenueMinor,
        discountMinor: contribution.discountMinor,
        refundMinor: contribution.refundMinor,
      });
      continue;
    }
    row.orders += contribution.orders;
    row.units += contribution.units;
    row.grossRevenueMinor += contribution.grossRevenueMinor;
    row.discountMinor += contribution.discountMinor;
    row.refundMinor += contribution.refundMinor;
  }
  return sortBy([...rows.values()], SALES_ROW_ORDER).map(toSalesRecord);
}

/**
 * The seeded sales fact table, exactly as {@link buildSalesRecords} builds it: the collection
 * `src/data/repositories.ts` serves for `GET /api/analytics/kpis` and `GET /api/analytics/revenue`, and the
 * one the dashboard, the KPI cards and the three reports are read from. Built once, at import, from the
 * same seeded orders the order history was built from, so the two reconcile by construction.
 */
export const SALES_RECORDS: readonly SalesRecord[] = buildSalesRecords();
