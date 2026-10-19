/**
 * Path: src/data/collectionStore.ts
 * Purpose: The store half of the data source: the seeded collections and the indexes built over them once, with the writes over them re-exported from their own split path
 * Lines: 221
 */

// This is not a path the tree maps on its own: it is the store half of `src/data/repositories.ts`, split out
// under the over-budget rule because the data source's whole concern — a 33-member contract with the
// collections, their indexes, a session registry and the writes over them — cannot be held in one file under
// the 600-line ceiling, and the ceiling is never raised. That concern outgrew this file in turn, so its writes
// half — the refusal an operation answers with, and the account, session and address writes — became the second
// split path `src/data/storeWrites.ts`, whose every name is re-exported below so a consumer still reads the one
// path it read before. What stays here is the state: the seeded collections, the indexes built over them once,
// and the store they are assembled into. `src/data/repositories.ts` holds the contract that composes the domain
// rules, and nothing else imports this module.

import { ROUTES, categoryPath, productPath } from "@/constants/routes";
import { BRANDS, CATEGORIES, CATEGORY_PRODUCT_COUNT } from "@/data/categories";
import {
  mergeAddressBooks,
  mergeCredentials,
  mergeCustomers,
  readClientWrites,
} from "@/data/clientWrites";
import { ADDRESSES, CREDENTIALS, CUSTOMERS } from "@/data/customers";
import { readSessionTable } from "@/data/sessionTable";
import { ORDERS } from "@/data/orders";
import { PRODUCTS } from "@/data/products";
import { REVIEWS, ratingAggregateFor } from "@/data/reviews";
import { mergeReviews } from "@/data/reviewWrites";
import type { Category, CategoryNode, Product } from "@/types/catalog";
import type {
  BrandId,
  CategoryId,
  CustomerId,
  IsoDateString,
  OrderId,
  ProductId,
} from "@/types/common";
import type { Order } from "@/types/commerce";
import { groupBy, sortByKey } from "@/utils/collections";
import { sortByIso, startOfDay } from "@/utils/dates";
import { DEFAULT_FILTER_STATE, filtersToPath } from "@/utils/queryParams";
import type { SearchLookup, SearchTargets } from "@/utils/searchRules";

// The writes over the collections this module builds live in its second split path `src/data/storeWrites.ts`.
// Every name that path publishes is re-exported here, so a consumer — `src/data/repositories.ts` — keeps reading
// one path and no import anywhere in the tree changes. Its type names go through `export type`, which
// verbatimModuleSyntax requires, because they leave no runtime binding behind.
export {
  accept,
  refuse,
  rejectPromo,
  endSession,
  registerAccount,
  signInAccount,
  lookUpSession,
  restore,
  credentialFor,
  updateProfile,
  addBookAddress,
  updateBookAddress,
  removeBookAddress,
  setBookDefault,
} from "@/data/storeWrites";
export type {
  CredentialEntry,
  UpdateBookAddressInput,
  SetBookDefaultInput,
  WritableStore,
} from "@/data/storeWrites";

// The seeded collections ----------------------------------------------------------------------------

/** The key one account-and-product pair of the verified-purchase index is held under. */
export function purchaseKey(customerId: CustomerId, productId: ProductId): string {
  return `${customerId}|${productId}`;
}

/** The tree of the seeded categories, each node carrying its children and its product count in position order.
 * The count is a member of the node type the endpoint declares — `CategoryNode` — so it is derived here and
 * needs no second type beside it: a leaf reports its own catalogue count and a parent the rolled-up total
 * beneath it, exactly as the seed derived them, because the count record is keyed by category. */
function buildCategoryTree(): readonly CategoryNode[] {
  const byParent = groupBy(
    CATEGORIES.filter(
      (category): category is Category & { parentId: CategoryId } => category.parentId !== null,
    ),
    (category) => category.parentId,
  );
  const node = (category: Category): CategoryNode => ({
    ...category,
    productCount: CATEGORY_PRODUCT_COUNT[category.id] ?? 0,
    children: sortByKey(byParent.get(category.id) ?? [], (child) => child.position).map(node),
  });
  return sortByKey(
    CATEGORIES.filter((category) => category.parentId === null),
    (category) => category.position,
  ).map(node);
}

/** The brand and category names a product is scored against, read once from the seeded vocabulary: an
 * identifier the vocabulary does not name scores against the empty string rather than failing a search. */
function buildSearchLookup(): SearchLookup {
  const brandNames = new Map(BRANDS.map((brand) => [brand.id as string, brand.name]));
  const categoryNames = new Map(
    CATEGORIES.map((category) => [category.id as string, category.name]),
  );
  return {
    brandName: (id: BrandId) => brandNames.get(id) ?? "",
    categoryName: (id: CategoryId) => categoryNames.get(id) ?? "",
  };
}

/** Where a type-ahead suggestion leads: the two route builders the routes module owns and the search route
 * scoped to a brand, written through the query module's own path builder so the URL a suggestion navigates to
 * is byte for byte the one the filter panel writes. */
export const SEARCH_TARGETS: SearchTargets = {
  productTarget: productPath,
  categoryTarget: categoryPath,
  brandTarget: (id: BrandId) =>
    filtersToPath(ROUTES.SEARCH, { ...DEFAULT_FILTER_STATE, brandIds: [id] }),
};

/** The orders that name an account, grouped by it, in the order they arrived: an order placed by a guest
 * belongs to no account and is left out of every customer's history. The key is narrowed to an identifier
 * here, so a caller reads it without checking for the absence again. */
function ordersByOwner(orders: readonly Order[]): Map<CustomerId, Order[]> {
  const grouped = new Map<CustomerId, Order[]>();
  for (const order of orders) {
    const owner = order.customerId;
    if (owner === null) continue;
    const group = grouped.get(owner);
    if (group === undefined) grouped.set(owner, [order]);
    else group.push(order);
  }
  return grouped;
}

/** How many orders each calendar day holds: what the next order placed on a day is numbered after. */
function countByDay(orders: readonly Order[]): Map<IsoDateString, number> {
  const counts = new Map<IsoDateString, number>();
  for (const order of orders) {
    const day = startOfDay(order.placedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

/**
 * Builds one data source's collections and indexes in a single pass over the seeds.
 *
 * The rating a product is served with is the one the reviews it is served with imply, derived here rather than
 * recomputed per read, and the reviews themselves are the seeded rows with this browser's own laid over them,
 * so a review the last document published is listed here and counted by that same rule; the address books are
 * reassembled from the account references; the order history is sorted newest first, because the seeded array
 * is grouped by day rather than by instant and an order created at runtime is placed at the front of it; this
 * browser's own writes to the collections — the orders it placed, the accounts it registered, the profile
 * edits, the address books it made and the reviews it published — are replayed onto the seeds first, so a
 * document load carries on where the last one left off instead of reading only the seed; and every lookup a
 * member needs — by identifier, by email, by customer, by account-and-product, together with the position each
 * product and each account holds in its collection — is built here, so a read and a replacement are both a map
 * lookup rather than a scan of 2,255 orders or 140 products. The session registry is read from its durable
 * table, and every record the table holds is proved against this browser's seal before it is admitted: a
 * session's own issue instant is what that table is for, and a record this browser did not write is not a
 * session. Nothing in the seeds is written: this store holds copies.
 *
 * @returns The collections and indexes one data source reads and writes.
 */
export function createStore() {
  const writes = readClientWrites();
  const reviews = mergeReviews(REVIEWS, writes);
  const reviewsByProduct = groupBy(reviews, (review) => review.productId);
  const products: Product[] = PRODUCTS.map((product) => ({
    ...product,
    ...ratingAggregateFor(reviewsByProduct.get(product.id) ?? []),
  }));
  const customers = mergeCustomers(CUSTOMERS, writes);
  const credentials = mergeCredentials(CREDENTIALS, writes);
  const books = mergeAddressBooks(ADDRESSES, customers, writes);
  const orders = sortByIso([...writes.orders, ...ORDERS], (order) => order.placedAt, "desc");
  const ordersByCustomer = ordersByOwner(orders);
  const verifiedPurchases = new Set<string>();
  for (const [owner, rows] of ordersByCustomer) {
    for (const order of rows) {
      for (const line of order.lines) {
        verifiedPurchases.add(purchaseKey(owner, line.productId));
      }
    }
  }
  return {
    products,
    productById: new Map(products.map((product) => [product.id, product])),
    productIndexById: new Map(products.map((product, index) => [product.id, index])),
    categoryByProduct: new Map(PRODUCTS.map((product) => [product.id, product.categoryId])),
    reviews,
    reviewsByProduct,
    customers,
    customerById: new Map(customers.map((customer) => [customer.id, customer])),
    customerIndexById: new Map(customers.map((customer, index) => [customer.id, index])),
    credentials,
    books,
    orders,
    orderById: new Map<OrderId, Order>(orders.map((order) => [order.id, order])),
    ordersByCustomer,
    nextOrderIndex: Math.max(writes.orderMint.nextIndex, orders.length + 1),
    orderSequenceByDay: countByDay(orders),
    sessions: readSessionTable(),
    verifiedPurchases,
    categories: buildCategoryTree(),
    brands: BRANDS,
    lookup: buildSearchLookup(),
  };
}

/** The collections and indexes one data source reads and writes, as {@link createStore} returns them: the
 * served catalogue, the reviews and their grouping, the account store, the order history newest first, the
 * session registry read back from its durable table, the verified-purchase index and the catalogue's own
 * lookups.
 * `productIndexById` and `customerIndexById` hold each record's slot, and every writer keeps them in step. */
export type DataStore = ReturnType<typeof createStore>;
