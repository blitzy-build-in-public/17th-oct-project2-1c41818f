/**
 * Path: src/data/clientWrites.ts
 * Purpose: The durable record of this browser's own writes to the seeded collections, and the folds that replay it onto the seeds
 * Lines: 563
 */

// The seeded collections are rebuilt from the frozen seed on every document load, so everything this
// browser writes for itself would otherwise live only in the document that wrote it: a reload would forget
// the order a checkout placed, the account a registration created with the digest that verifies it, the
// profile a customer edited, the address book they wrote and the review they published. This module owns
// the writes that extend that durable record and the pure folds that lay it over the seeds. The record's own
// shape and its empty value live in `src/data/clientWriteRecord.ts` and are re-exported below, so the review
// member's guard, append and fold — which read that shape — live in `src/data/reviewWrites.ts` without this
// module importing a shape back from them: a review is the one write the record holds as a list of rows
// rather than keyed by an identifier. `src/utils/storage.ts` is the only store, under the key
// `src/constants/config.ts` declares, and the store's own collections stay the source of truth for a running
// document — a refused write changes nothing about them.

import { STORAGE_KEYS } from "@/constants/config";
import {
  NO_CLIENT_WRITES,
  type AddressBookWrite,
  type ClientWrites,
  type RegisteredAccount,
} from "@/data/clientWriteRecord";
import type { StoredCredential } from "@/data/customers";
import { isStoredReviews, reviewsOf, withReview } from "@/data/reviewWrites";
import type { Address, Customer, Role } from "@/types/account";
import type { Review } from "@/types/catalog";
import type { CustomerId, IsoDateString } from "@/types/common";
import type {
  Order,
  OrderLine,
  OrderStatusHistoryEntry,
  PaymentSummary,
  PricedCart,
  PricedCartLine,
} from "@/types/commerce";
import { startOfDay } from "@/utils/dates";
import { readStored, writeStored } from "@/utils/storage";

// The record's shape is published here as well as in `src/data/clientWriteRecord.ts`, because the split that
// took the shape out left this module's public surface as it was: a consumer of the record reads it from this
// path exactly as it did before, whether it needs the shape or one of the folds that follow.

export { NO_CLIENT_WRITES } from "@/data/clientWriteRecord";

export type {
  AddressBookWrite,
  ClientWrites,
  OrderMint,
  RegisteredAccount,
} from "@/data/clientWriteRecord";

/** The roles an account record can carry, as the union `src/types/account.ts` declares them: the guard
 * below tests a stored payload against this set rather than trusting a string from the store. */
const ACCOUNT_ROLES: readonly Role[] = ["guest", "customer", "admin"];

/**
 * The key an email address is looked up and compared by: an address is case-insensitive, so a stored
 * account and a submitted address meet on this key rather than on the spelling either arrived in.
 *
 * This is the rule's one home — `src/data/storeWrites.ts` imports it for its credential map — so
 * the account a registration creates, the account a sign-in looks up and the account a reload replays
 * are found by one comparison.
 *
 * @param email - The address as it was submitted or stored.
 * @returns The trimmed, lower-cased form both sides are compared in.
 */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

// Reading the record --------------------------------------------------------------------------------

/** Whether a stored member is an object rather than a primitive, an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether every named member of a record is text, which is what the identifier and instant members
 * every index and surface reads have to be. */
function hasText(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

/** Whether a stored member is a finite number: what every money amount and quantity has to be, so no
 * surface ever formats `NaN` or a string as an amount. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whether a stored member is null or text: the shape of a guest order's customer, a payment's card
 * brand and last four digits, and a payment's authorisation instant. */
function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Whether a stored member is an array every entry of which the guard accepts. */
function isEvery<TItem>(
  value: unknown,
  guard: (item: unknown) => item is TItem,
): value is readonly TItem[] {
  return Array.isArray(value) && value.every(guard);
}

/** Whether a stored member is one of the roles an account can hold. */
function isRole(value: unknown): value is Role {
  return typeof value === "string" && ACCOUNT_ROLES.some((role) => role === value);
}

/** The members an address carries as text: the identifier first, because the book is keyed and looked
 * up by it, then every field the address cards and the order surfaces render. */
const ADDRESS_TEXT_FIELDS = [
  "id",
  "label",
  "fullName",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "country",
  "phone",
] as const;

/** The members a customer record carries as text besides the two below that need their own check. */
const CUSTOMER_TEXT_FIELDS = [
  "id",
  "email",
  "firstName",
  "lastName",
  "phone",
  "createdAt",
  "loyaltyTier",
] as const;

/** The members a cart line carries as text: the snapshot line an order keeps alongside its own lines. */
const CART_LINE_TEXT_FIELDS = ["id", "productId", "sku", "name", "imageUrl", "addedAt"] as const;

/** The members an order line carries as text. */
const ORDER_LINE_TEXT_FIELDS = ["id", "productId", "productName", "sku", "imageUrl"] as const;

/** The members an order carries as text besides the members whose own guard follows. */
const ORDER_TEXT_FIELDS = [
  "id",
  "orderNumber",
  "email",
  "status",
  "shippingMethodId",
  "placedAt",
  "updatedAt",
  "idempotencyKey",
] as const;

/** Whether a stored member is an address: the identifier and text fields a book is read by, plus the
 * two default flags the address cards and the default rules read. */
function isAddress(value: unknown): value is Address {
  return (
    isRecord(value) &&
    hasText(value, ADDRESS_TEXT_FIELDS) &&
    typeof value.isDefaultShipping === "boolean" &&
    typeof value.isDefaultBilling === "boolean"
  );
}

/** Whether a stored member is a customer record: the identifier and email the account store is keyed by,
 * the role every privileged path re-checks, the references to the book, and the members the account
 * surfaces render. The role is read here as one of the three the product has and is never authority: the
 * folds below resolve an account the seed holds to the seed's own role and one it does not to a customer. */
function isCustomer(value: unknown): value is Customer {
  if (!isRecord(value)) return false;
  return (
    hasText(value, CUSTOMER_TEXT_FIELDS) &&
    isRole(value.role) &&
    isTextOrNull(value.lastLoginAt) &&
    typeof value.marketingOptIn === "boolean" &&
    isEvery(value.addressIds, (id): id is CustomerId => typeof id === "string")
  );
}

/** Whether a stored member is a cart line inside an order's priced snapshot, priced: an order stores
 * the cart it was placed from, and the confirmation and the order detail render its amounts. */
function isPricedLine(value: unknown): value is PricedCartLine {
  return (
    isRecord(value) &&
    hasText(value, CART_LINE_TEXT_FIELDS) &&
    isNumber(value.unitPriceMinor) &&
    isNumber(value.quantity) &&
    isNumber(value.lineSubtotalMinor) &&
    isNumber(value.discountMinor) &&
    isNumber(value.lineTotalMinor)
  );
}

/** Whether a stored member is a line of the order itself: the snapshot of what was bought, which is a
 * different shape from the cart line it was built from. */
function isOrderLine(value: unknown): value is OrderLine {
  return (
    isRecord(value) &&
    hasText(value, ORDER_LINE_TEXT_FIELDS) &&
    isNumber(value.unitPriceMinor) &&
    isNumber(value.quantity) &&
    isNumber(value.lineTotalMinor)
  );
}

/** Whether a stored member is one step of an order's status history: the status, its instant and, for
 * a step worth explaining, its note. */
function isStatusEntry(value: unknown): value is OrderStatusHistoryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.status === "string" &&
    typeof value.at === "string" &&
    (value.note === undefined || typeof value.note === "string")
  );
}

/** Whether a stored member is the priced cart an order was placed from. Its amounts are the pricing
 * service's and are not recomputed here, so the guard proves the members the surfaces read exist. */
function isPricedCart(value: unknown): value is PricedCart {
  return (
    isRecord(value) &&
    isEvery(value.lines, isPricedLine) &&
    isNumber(value.grandTotalMinor) &&
    isNumber(value.subtotalMinor) &&
    typeof value.currency === "string"
  );
}

/** Whether a stored member is what an order records about its payment: the method and outcome a
 * summary line words, and the nullable card members it renders when there is a card. */
function isPayment(value: unknown): value is PaymentSummary {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    typeof value.status === "string" &&
    isTextOrNull(value.brand) &&
    isTextOrNull(value.last4) &&
    (value.authorisedAt === null || typeof value.authorisedAt === "string")
  );
}

/** Whether a stored member is an order: the identifier the confirmation route and the store's own
 * index are keyed by, the instant the history is sorted by, the customer it is filed under, the
 * number and the history the surfaces render, and the snapshot it keeps. */
function isOrder(value: unknown): value is Order {
  if (!isRecord(value)) return false;
  return (
    hasText(value, ORDER_TEXT_FIELDS) &&
    (value.customerId === null || typeof value.customerId === "string") &&
    isEvery(value.lines, isOrderLine) &&
    isEvery(value.statusHistory, isStatusEntry) &&
    isAddress(value.shippingAddress) &&
    isAddress(value.billingAddress) &&
    isPayment(value.payment) &&
    isPricedCart(value.pricedCart)
  );
}

/** Whether a stored member is a registered account: the customer record and the digest beside it. */
function isRegisteredAccount(value: unknown): value is RegisteredAccount {
  if (!isRecord(value) || !isCustomer(value.customer)) return false;
  const digest = value.digest;
  return isRecord(digest) && typeof digest.salt === "string" && typeof digest.hash === "string";
}

/** Whether a stored member is an address book written whole. */
function isAddressBookWrite(value: unknown): value is AddressBookWrite {
  return (
    isRecord(value) && typeof value.customerId === "string" && isEvery(value.addresses, isAddress)
  );
}

/**
 * Proves a payload read back from the store is a record this module wrote.
 *
 * Every member is checked through the guard for its own shape, because a payload that reached the
 * store before a shape changed cannot be handed to a store that indexes and renders the current one.
 * A payload that fails anywhere is rejected wholesale, which is `src/utils/storage.ts`'s documented
 * policy: the reader's fallback is the whole record, never a partly decoded one. The review list is the
 * one member a payload may lack without being refused: `src/data/reviewWrites.ts` reads its absence as
 * no review, so a payload written before the record carried reviews keeps the orders, accounts, profiles
 * and books it does hold rather than costing every one of them.
 *
 * @param value - The payload the store handed back.
 * @returns `true` when the payload carries every member this module writes.
 */
function isClientWrites(value: unknown): value is ClientWrites {
  if (!isRecord(value)) return false;
  const mint = value.orderMint;
  return (
    isEvery(value.orders, isOrder) &&
    isRecord(mint) &&
    isNumber(mint.nextIndex) &&
    typeof mint.day === "string" &&
    isNumber(mint.sequence) &&
    isEvery(value.accounts, isRegisteredAccount) &&
    isEvery(value.profiles, isCustomer) &&
    isEvery(value.books, isAddressBookWrite) &&
    isStoredReviews(value.reviews)
  );
}

/**
 * Reads the record of this browser's writes.
 *
 * Reads from the store. Anything unusable — no store at all, a private window that refuses the write,
 * a payload this build will not read, a full quota that left an older copy behind — answers the empty
 * record, so a data source built without a store behaves as if nothing had ever been written: reads
 * answer from the seeds and writes are dropped. This is what makes persistence an addition rather than a
 * dependency. The review list is completed on the way out, so a payload written before the record carried
 * reviews is read as the empty list rather than as an absent member each reader would have to resolve.
 *
 * @returns The writes to replay onto the seeds, or {@link NO_CLIENT_WRITES}.
 */
export function readClientWrites(): ClientWrites {
  const writes = readStored(STORAGE_KEYS.CLIENT_WRITES, NO_CLIENT_WRITES, isClientWrites);
  return { ...writes, reviews: reviewsOf(writes) };
}

// Writing the record --------------------------------------------------------------------------------
// Every write below is a read-modify-write through the one storage util, and every one of them is a
// no-op-safe refusal: `writeStored` reports a refused write as `false` and raises nothing, so a store
// that will not take the payload — a full quota, a private window — leaves the running document's
// in-memory collections exactly as correct as they are.

/** Replaces the entry a key names, or appends it when the record holds none: one account, profile and
 * book each, so a write of a record the store already holds never leaves two of it behind. */
function upsert<TItem>(
  items: readonly TItem[],
  key: string,
  selectKey: (item: TItem) => string,
  next: TItem,
): readonly TItem[] {
  const index = items.findIndex((item) => selectKey(item) === key);
  if (index === -1) return [...items, next];
  return items.map((item, position) => (position === index ? next : item));
}

/**
 * Records an order this browser placed, together with the marks its minting reached.
 *
 * The order is prepended, so the record reads newest first exactly as the store's own collection does,
 * and the mint index is the higher of the two: the index the caller just minted past and the index the
 * record already stood at. Taking the higher one is what keeps two documents open at once from moving
 * the durable mark backwards — a document that minted before the other wrote must not wind the mark
 * back to its own value and hand a later document a duplicate identifier.
 *
 * @param order - The order the store just created.
 * @param mint - The index and the sequence that order was minted from.
 */
export function rememberOrder(
  order: Order,
  mint: { readonly index: number; readonly sequence: number },
): void {
  const writes = readClientWrites();
  const next: ClientWrites = {
    ...writes,
    orders: [order, ...writes.orders],
    orderMint: {
      nextIndex: Math.max(mint.index + 1, writes.orderMint.nextIndex),
      day: startOfDay(order.placedAt),
      sequence: mint.sequence,
    },
  };
  writeStored(STORAGE_KEYS.CLIENT_WRITES, next);
}

/** Records an account this browser registered, with the digest that verifies its password, so the
 * token derived from the account resolves again after a load and its credentials still sign in. */
export function rememberAccount(account: RegisteredAccount): void {
  const writes = readClientWrites();
  const next: ClientWrites = {
    ...writes,
    accounts: upsert(writes.accounts, account.customer.id, (item) => item.customer.id, account),
  };
  writeStored(STORAGE_KEYS.CLIENT_WRITES, next);
}

/** Records a customer record this browser changed — a profile edit, or an address reference an address
 * write moved — replacing the record the store already holds for that account, so a reload shows the
 * edited profile rather than the seeded one. */
export function rememberProfile(customer: Customer): void {
  const writes = readClientWrites();
  const next: ClientWrites = {
    ...writes,
    profiles: upsert(writes.profiles, customer.id, (item) => item.id, customer),
  };
  writeStored(STORAGE_KEYS.CLIENT_WRITES, next);
}

/** Records one customer's address book as it now stands, replacing the book the record holds for that
 * customer. The book is written whole rather than as a change, because the default rules move flags
 * between addresses and a whole book is what makes a replay reproduce that outcome exactly. */
export function rememberAddressBook(customerId: CustomerId, addresses: readonly Address[]): void {
  const writes = readClientWrites();
  const next: ClientWrites = {
    ...writes,
    books: upsert(writes.books, customerId, (item) => item.customerId, { customerId, addresses }),
  };
  writeStored(STORAGE_KEYS.CLIENT_WRITES, next);
}

/** Records a review this browser published, prepended so the record reads newest first exactly as the
 * store's own review list does. `src/data/reviewWrites.ts` owns the append itself: a review is the one
 * write the record holds as a list of rows rather than as a record keyed by an identifier, so its guard
 * and its fold live there with it. */
export function rememberReview(review: Review): void {
  writeStored(STORAGE_KEYS.CLIENT_WRITES, withReview(readClientWrites(), review));
}

// Minting an order's identity ------------------------------------------------------------------------

/** The index and the sequence an order placed now takes: the pair {@link nextOrderMint} answers with. */
export interface OrderMintChoice {
  readonly index: number;
  readonly sequence: number;
}

/**
 * The identity the next order placed in this browser takes, past everything the document holding it
 * loaded and everything the browser has already written.
 *
 * The index is the higher of the durable mark and the index the caller's own store reached, and the
 * sequence is the higher of the last sequence the record holds for the day in question and the count
 * the caller's store holds for it. Taking both from the store *and* from the record is what stops two
 * documents open at once from minting one identifier between them, and what stops a day's numbers
 * repeating: a store rebuilt from the seed knows only the seeded orders, so its own answer would
 * collide with the number the document beside it just used.
 *
 * @param day - The local day the order is being placed on.
 * @param loadedIndex - The index the caller's store would mint from.
 * @param loadedDaySequence - How many orders the caller's store holds for that day.
 * @returns The index for the identifier and the sequence for the order number.
 */
export function nextOrderMint(
  day: IsoDateString,
  loadedIndex: number,
  loadedDaySequence: number,
): OrderMintChoice {
  const { orderMint } = readClientWrites();
  const carried = orderMint.day === day ? orderMint.sequence : 0;
  return {
    index: Math.max(orderMint.nextIndex, loadedIndex),
    sequence: Math.max(carried, loadedDaySequence) + 1,
  };
}

// Replaying the record onto the seeds ---------------------------------------------------------------

/** The role an account this browser registered is taken with: registration only creates a customer. */
const REGISTERED_ROLE: Role = "customer";

/**
 * The account store a document loads: the seeded accounts, then the accounts this browser registered, then
 * the profile edits it made, laid over in that order so an edit outlasts the registration it followed.
 *
 * The seed is the authority for the identity and the authority of every account it already holds: a
 * record naming one of them — by identifier, or by the email an account is looked up and compared by —
 * contributes only the members the product's own writes change for an account: `firstName`, `lastName`,
 * `phone`, `marketingOptIn`, `lastLoginAt` and `addressIds`. The `id`, `email`, `createdAt`, `loyaltyTier`
 * and `role` are the seed's whatever the record claims: the role decides which paths a session opens.
 *
 * A record naming no account is one this browser registered, and registration only ever makes a customer:
 * it is honoured for the same six members and its role is {@link REGISTERED_ROLE}, so a written record can
 * never mint an administrator — the two administrators are the seed's — and never `guest`, which
 * authenticates nobody.
 *
 * @param seed - `CUSTOMERS`, the accounts the seed holds.
 * @param writes - The record read from the store.
 * @returns A new array; `seed` itself is never mutated.
 */
export function mergeCustomers(seed: readonly Customer[], writes: ClientWrites): Customer[] {
  const merged = [...seed];
  const byId = new Map<CustomerId, number>(merged.map((customer, index) => [customer.id, index]));
  const byEmail = new Map(
    merged.map((customer, index): [string, number] => [emailKey(customer.email), index]),
  );
  const records = [...writes.accounts.map((account) => account.customer), ...writes.profiles];
  for (const written of records) {
    const position = byId.get(written.id) ?? byEmail.get(emailKey(written.email));
    if (position === undefined) {
      byId.set(written.id, merged.length);
      byEmail.set(emailKey(written.email), merged.length);
      merged.push({ ...written, role: REGISTERED_ROLE });
    } else {
      const { firstName, lastName, phone, marketingOptIn, lastLoginAt, addressIds } = written;
      merged[position] = {
        ...merged[position],
        firstName,
        lastName,
        phone,
        marketingOptIn,
        lastLoginAt,
        addressIds,
      };
    }
  }
  return merged;
}

/**
 * The credential map a document loads, keyed by {@link emailKey}: the seeded credentials, then the
 * credentials of the accounts this browser registered for itself.
 *
 * A written account supplies a credential only for an email the seed does not hold, because the seed is the
 * authority for the identities it holds and a digest this browser wrote must not displace the one that
 * verifies a seeded password. Both properties of the account store depend on the map: a re-registration of
 * an email this browser already registered is still a `409` duplicate email, and the password a
 * registration was created with still verifies, because the digest written beside the account is the one
 * the sign-in path compares against.
 *
 * @param seed - `CREDENTIALS`, the digests the seed holds.
 * @param writes - The record read from the store.
 * @returns A new map; the seed entries are the seed's own objects.
 */
export function mergeCredentials(
  seed: readonly StoredCredential[],
  writes: ClientWrites,
): Map<string, StoredCredential> {
  const credentials = new Map<string, StoredCredential>(
    seed.map((entry) => [emailKey(entry.customer.email), entry]),
  );
  for (const account of writes.accounts) {
    const key = emailKey(account.customer.email);
    if (credentials.has(key)) continue;
    credentials.set(key, account);
  }
  return credentials;
}

/**
 * The address books a document loads: every account's book reassembled from its seeded references, then
 * the books this browser wrote laid over them.
 *
 * Reassembly is the seeded rule unchanged — an account holds references and the book is built by
 * resolving them against the seeded addresses — and a written book replaces its account's book whole,
 * because the write captured the addresses as they stood, identifiers, flags and all.
 *
 * @param seedAddresses - `ADDRESSES`, the addresses the seeded books are built from.
 * @param customers - The merged accounts, so a registered account gets a book of its own.
 * @param writes - The record read from the store.
 * @returns A new map; the seeded arrays it is built from are never mutated.
 */
export function mergeAddressBooks(
  seedAddresses: readonly Address[],
  customers: readonly Customer[],
  writes: ClientWrites,
): Map<CustomerId, Address[]> {
  const addressById = new Map(seedAddresses.map((address) => [address.id, address]));
  const books = new Map<CustomerId, Address[]>(
    customers.map((customer) => [
      customer.id,
      customer.addressIds.flatMap((id) => {
        const address = addressById.get(id);
        return address === undefined ? [] : [address];
      }),
    ]),
  );
  for (const write of writes.books) books.set(write.customerId, [...write.addresses]);
  return books;
}
