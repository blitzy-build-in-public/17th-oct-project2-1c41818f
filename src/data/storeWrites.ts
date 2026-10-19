/**
 * Path: src/data/storeWrites.ts
 * Purpose: The writes half of the data source: the refusals its operations answer with, and the account, session and address writes over the seeded collections
 * Lines: 478
 */

// This is not a path the tree maps on its own: it is the writes half of the store that
// `src/data/collectionStore.ts` holds — itself the store half of `src/data/repositories.ts`, split out under the
// over-budget rule because the store is more than one file can carry under the 600-line ceiling, and the ceiling
// is never raised. The seeded collections and the indexes built over them once stay in
// `src/data/collectionStore.ts`; every operation that changes them lives here, and that module re-exports each
// name below, so a consumer — `src/data/repositories.ts` — reads exactly the path it read before.
//
// The slice of the store these writes read and keep in step is declared here rather than imported from the
// module that holds it, because that module re-exports this one's names: an import back — a type-only one
// included — would make the two modules import each other, and no circular dependency may exist. Declaring the
// slice keeps the edge one-way, and every member is the type its writer produces, so the store that module
// builds satisfies the interface without a change.

import {
  ACCOUNT_COPY,
  FEEDBACK_COPY,
  NOT_FOUND_COPY,
  PROMO_REJECTION_MESSAGES,
} from "@/constants/content";
import {
  emailKey,
  rememberAccount,
  rememberAddressBook,
  rememberProfile,
} from "@/data/clientWrites";
import type { StoredCredential } from "@/data/customers";
import {
  type SessionMembers,
  type SessionRecord,
  recordSession,
  resolveSessionRecord,
  revokeSession,
} from "@/data/sessionTable";
import type {
  Address,
  AddressInput,
  AddressKind,
  Credentials,
  Customer,
  ProfileUpdateInput,
  RegistrationInput,
  RegistrationResult,
  Role,
  Session,
} from "@/types/account";
import type {
  AddressId,
  CustomerId,
  IsoDateTimeString,
  Result,
  SessionToken,
} from "@/types/common";
import type { PromoRejectionReason } from "@/types/commerce";
import {
  applyDefaultAddressRule,
  isSessionExpired,
  promoteDefaultAfterRemoval,
  sessionExpiresAt,
} from "@/utils/accountRules";
import { toIsoDateTime } from "@/utils/dates";
import {
  addressId as newAddressId,
  createCredentialDigest,
  createSalt,
  customerId as newCustomerId,
  randomHexText,
  sessionToken as mintSessionToken,
} from "@/utils/strings";

// The slice of the store these writes read -----------------------------------------------------------

/**
 * The slice of the store the writes below read and keep in step: the accounts and the index that finds one in
 * the collection, the credentials keyed by the email that signs in, the address books keyed by their owner, and
 * the session registry the durable table is read back into.
 *
 * It is declared here rather than imported from `src/data/collectionStore.ts`, the module holding the
 * collections these writes change, because that module re-exports the names below: an import back — a type-only
 * one included — would make the two modules import each other. Declaring the slice keeps the edge one-way, and
 * since every member is the type its writer produces, the store that module builds satisfies it unchanged.
 */
export interface WritableStore {
  readonly customers: Customer[];
  readonly customerById: Map<CustomerId, Customer>;
  readonly customerIndexById: Map<CustomerId, number>;
  readonly credentials: Map<string, StoredCredential>;
  readonly books: Map<CustomerId, Address[]>;
  readonly sessions: Map<string, SessionRecord>;
}

// Outcomes and refusals -----------------------------------------------------------------------------
// The status each refusal the data source answers with carries. It mirrors the vocabulary
// `src/lib/apiContract.ts` owns, which is outside the dependency whitelist this work is given and whose runtime
// import is forbidden, so the codes are restated here once — the choice the committed transport, auth, pricing,
// report, order and customer service lanes each recorded for their own refusals — while every code the
// transport decides reaches a surface unchanged from the transport itself.

/** The status of the promo refusals: a conflict with the code's own eligibility. */
const PROMO_REJECTION_STATUS = 409;

/** The status each refusal of the data source's own carries. */
const REFUSAL_STATUS = {
  "duplicate-email": 409,
  "session-unknown": 401,
  "session-expired": 401,
  "invalid-credentials": 401,
  forbidden: 403,
  "address-not-found": 404,
  "insufficient-stock": 422,
  "validation-failed": 422,
} as const;

/** One refusal the data source decides: the transport's own code for the same condition. */
type RefusalCode = keyof typeof REFUSAL_STATUS;

/** The field a promo refusal is filed under, so a cart marks the control that caused it. */
const PROMO_CODE_FIELD = "promoCode";

/** A successful outcome, so a member of the data source reads as one sentence. */
export function accept<TValue>(value: TValue): Result<TValue> {
  return { ok: true, value };
}

/** A refusal at the status its own code sets, naming the form field it belongs to when it has one: the shape
 * every failure here takes, so a caller narrows on `ok` exactly as it does on the transport's own failures. */
export function refuse(code: RefusalCode, message: string, field?: string): Result<never> {
  const status = REFUSAL_STATUS[code];
  return field === undefined
    ? { ok: false, error: { status, code, message } }
    : { ok: false, error: { status, code, message, field } };
}

/** The refusal a code the pricing rules will not apply is answered with: the reason as the code a cart names
 * the cause by, with the sentence `src/constants/content.ts` words that reason with. */
export function rejectPromo(reason: PromoRejectionReason): Result<never> {
  return {
    ok: false,
    error: {
      status: PROMO_REJECTION_STATUS,
      code: reason,
      message: PROMO_REJECTION_MESSAGES[reason],
      field: PROMO_CODE_FIELD,
    },
  };
}

// The account store ---------------------------------------------------------------------------------
// Demonstration boundary, stated plainly: this is an in-browser account store, not a security boundary. No
// password is stored — only the salted digest the shared helper produces and verifies — and a session is an
// opaque token carrying a role claim and an expiry, minted from this browser's random source at each issue and
// re-checked by the transport on every privileged request. What that buys is honesty rather than force: a
// record a script writes for itself cannot be one this browser sealed, a token a reader has seen is rotated
// away by the next sign-in, and the seal a sign-out rotates puts every copy of the table taken before it — a
// record's revocation mark included — out of reach; while a script that reads the seal secret beside the table
// it proves can still make a record that passes, so a real deployment moves issue and verification behind the
// server `src/lib/apiClient.ts` is built to be repointed at.

/** Opens a session for an account and records it: the token is minted from this browser's own random source,
 * one fresh value per issue, so no sign-in replays the token an earlier one was issued — a token a reader has
 * seen, by a screenshot, a copied store or a shared machine, is rotated away by the next sign-in rather than
 * standing as a permanent credential for the account — and the expiry is the product's single expiry rule.
 * Handing the session to the table records it: it is sealed under the secret standing now and written, so the
 * instant this session was issued is durable and the record is one only this browser can have written. The
 * single mint site: registration and sign-in both arrive here. */
function openSession(store: WritableStore, customer: Customer, at: IsoDateTimeString): Session {
  const session: Session = {
    token: mintSessionToken(randomHexText()),
    customerId: customer.id,
    role: customer.role,
    issuedAt: at,
    expiresAt: sessionExpiresAt(at),
  };
  recordSession(store.sessions, session);
  return session;
}

/**
 * Ends the session a token names: the record is marked revoked and this browser's seal secret rotated, so a
 * token a visitor has given up is refused for the life of the record rather than only for the life of the
 * document that ended it, and no copy of the table taken before that instant can put it back — every record
 * sealed under the replaced secret, the copy's own record included, stops verifying. `src/data/sessionTable.ts`
 * owns that mechanism.
 *
 * The record is kept rather than dropped so the refusal travels with the record it belongs to, and the registry
 * keeps it too, so this document refuses the token without re-reading the table. A token no record stands for
 * changes nothing here, and the client ends the session on its own side as well, by clearing the copy it
 * persisted.
 */
export function endSession(store: WritableStore, token: SessionToken): void {
  revokeSession(store.sessions, token);
}

/** Replaces one account in the store with the record that stands for it now, in the collection and in the
 * index alike, so a read by identifier and a read of the collection cannot disagree. */
function replaceAccount(store: WritableStore, customer: Customer): void {
  const index = store.customerIndexById.get(customer.id);
  if (index !== undefined) store.customers[index] = customer;
  store.customerById.set(customer.id, customer);
}

/** Creates an account and opens its session: registration signs the customer in, so the digest the shared
 * helper produces is the same shape the seed stores, and the session it opens is minted the one way every
 * session is — a fresh token from this browser's random source, never a value registered beside the account.
 * The account and its digest are written to the durable record before the session is opened, so the token the
 * session carries names an account a later document rebuilds from that record rather than refusing. */
export function registerAccount(
  store: WritableStore,
  input: RegistrationInput,
): Result<RegistrationResult> {
  if (store.credentials.has(emailKey(input.email))) {
    return refuse("duplicate-email", ACCOUNT_COPY.DUPLICATE_EMAIL_MESSAGE, "email");
  }
  const now = toIsoDateTime(new Date());
  const customer: Customer = {
    id: newCustomerId(input.email),
    email: input.email.trim(),
    firstName: input.firstName,
    lastName: input.lastName,
    phone: "",
    role: "customer",
    createdAt: now,
    // Registration is also the account's first sign-in, so its last-login line and its session agree.
    lastLoginAt: now,
    loyaltyTier: "bronze",
    marketingOptIn: input.marketingOptIn,
    addressIds: [],
  };
  store.customers.push(customer);
  store.customerIndexById.set(customer.id, store.customers.length - 1);
  store.customerById.set(customer.id, customer);
  const digest = createCredentialDigest(input.password, createSalt(customer.email));
  store.credentials.set(emailKey(customer.email), { customer, digest });
  store.books.set(customer.id, []);
  // The account and its digest reach the durable record before its session is opened, so the token the
  // session carries names an account the next document rebuilds from that record.
  rememberAccount({ customer, digest });
  return accept({ customer, session: openSession(store, customer, now) });
}

/** Opens the session for credentials the transport has already proved: the password is deliberately not
 * compared here — that comparison, and the one sentence both wrong answers are worded with, belong to the
 * transport's sign-in handler. The account's last sign-in is written here, because nothing else in the product
 * reads or writes it. */
export function signInAccount(store: WritableStore, credentials: Credentials): Result<Session> {
  const stored = store.credentials.get(emailKey(credentials.email));
  if (stored === undefined) {
    return refuse("invalid-credentials", ACCOUNT_COPY.SIGN_IN_FAILED_MESSAGE);
  }
  const now = toIsoDateTime(new Date());
  const account = store.customerById.get(stored.customer.id) ?? stored.customer;
  const customer: Customer = { ...account, lastLoginAt: now };
  replaceAccount(store, customer);
  return accept(openSession(store, customer, now));
}

/** The session one record stands for once its account has been resolved: the members the client and the
 * transport are given, read without the seal the record is written with or the revocation mark it may carry,
 * because neither is a member of the session contract and neither is the client's business. */
function sessionOf(record: SessionMembers, role: Role): Session {
  return {
    token: record.token,
    customerId: record.customerId,
    role,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

/**
 * The session a token still names, whether or not it has expired, because expiry is the transport's decision
 * and only the transport can tell an expired session from an unknown one.
 *
 * A record is honoured only when it is one this browser wrote and still stands: the durable table admits records
 * whose seal verifies, and this function refuses a record a sign-out revoked, so a token the store never minted,
 * a record whose authority members or window were edited outside the store, a record sealed before a sign-out
 * rotated the seal away, and a token a visitor has given up all answer as sessions the store knows nothing
 * about — the one refusal the transport words for them. The durable record is read again on every lookup rather
 * than answered from this document's memory of it, so a sign-out in another document, a rotation, or a session
 * another document opened reaches a document that is already open and is refused or honoured there without a
 * reload. A session that is still live is read as it was written and never rebuilt: it keeps the record's own
 * dates, so one presented after its window has passed answers as the lapsed record it is, not a fresh one. Its
 * role, though, is stamped from the account the record names, not from the record's own claim — written at the
 * one mint site and sealed with it — because the account is the store's authority on what a token reaches. Two
 * tokens are therefore `unknown` as well: one naming an account the store no longer holds, because ownership is
 * decided from the session's `customerId` and a gone account authenticates nobody; and one no record stands for,
 * which the guard that reads a table back has dropped when the record could not be proved. A registered account
 * does not fall in the first case: `src/data/clientWrites.ts` holds it, so the store a reload builds holds it
 * too and the session it minted resolves here.
 */
export function lookUpSession(
  store: WritableStore,
  token: string | undefined,
): Session | undefined {
  if (token === undefined || token.trim() === "") return undefined;
  const record = resolveSessionRecord(store.sessions, token);
  if (record === undefined || record.revokedAt !== undefined) return undefined;
  const account = store.customerById.get(record.customerId);
  return account === undefined ? undefined : sessionOf(record, account.role);
}

/** The session a stored token restores, or the refusal it earns: an unknown token and one past its expiry are
 * answered with the transport's own two codes, so a client signs out on exactly the failure it signs out on for
 * a request it made itself. */
export function restore(store: WritableStore, token: SessionToken): Result<Session> {
  const session = lookUpSession(store, token);
  if (session === undefined) return refuse("session-unknown", FEEDBACK_COPY.SIGN_IN_REQUIRED);
  if (isSessionExpired(session, toIsoDateTime(new Date()))) {
    return refuse("session-expired", FEEDBACK_COPY.TOAST_SESSION_EXPIRED);
  }
  return accept(session);
}

/** The account an email address identifies and the digest its password is stored as: the transport's one
 * sign-in lookup. The account is read from the collection rather than kept in step beside the digest, so a
 * profile edit needs no second write to be reflected here. */
export function credentialFor(store: WritableStore, email: string): CredentialEntry | undefined {
  const stored = store.credentials.get(emailKey(email));
  if (stored === undefined) return undefined;
  return {
    customer: store.customerById.get(stored.customer.id) ?? stored.customer,
    digest: stored.digest,
  };
}

/** One account and the digest that verifies it: the shape the transport's sign-in lookup answers with. */
export interface CredentialEntry {
  readonly customer: Customer;
  readonly digest: StoredCredential["digest"];
}

/** Updates the editable half of an account, leaving the email that identifies it, its role, its tier, its
 * timestamps and its address references as they are. */
export function updateProfile(
  store: WritableStore,
  id: CustomerId,
  input: ProfileUpdateInput,
): Result<Customer> {
  const customer = store.customerById.get(id);
  if (customer === undefined) return refuse("forbidden", FEEDBACK_COPY.ERROR_STATE_BODY);
  const updated: Customer = {
    ...customer,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    marketingOptIn: input.marketingOptIn,
  };
  replaceAccount(store, updated);
  // The edited half of the account is durable: the fields a profile edit changes are the ones the record keeps.
  rememberProfile(updated);
  return accept(updated);
}

/** The identifier a created address takes: the same key the seeded books use — its owner's address and its
 * label — numbered when that key is already held, so a book never holds one identifier twice. */
function mintBookAddressId(book: readonly Address[], customer: Customer, label: string): AddressId {
  const source = `${customer.email} ${label}`;
  let candidate = newAddressId(source);
  for (let suffix = 1; book.some((address) => address.id === candidate); suffix += 1) {
    candidate = newAddressId(`${source} ${suffix}`);
  }
  return candidate;
}

/** Adds an address to an account's book. The first address of a book is the default of both kinds, which is
 * the book the seed builds; a later one never unseats a default, because the defaults move through the
 * dedicated operation and a book holds at most one of each. */
export function addBookAddress(
  store: WritableStore,
  id: CustomerId,
  input: AddressInput,
): Result<Address> {
  const customer = store.customerById.get(id);
  if (customer === undefined) return refuse("forbidden", FEEDBACK_COPY.ERROR_STATE_BODY);
  const book = store.books.get(id) ?? [];
  const address: Address = {
    ...input,
    id: mintBookAddressId(book, customer, input.label),
    isDefaultShipping: !book.some((row) => row.isDefaultShipping),
    isDefaultBilling: !book.some((row) => row.isDefaultBilling),
  };
  const written = [...book, address];
  store.books.set(id, written);
  const updated: Customer = { ...customer, addressIds: [...customer.addressIds, address.id] };
  replaceAccount(store, updated);
  // Both halves are durable: the book the address joined, and the account's reference to it.
  rememberProfile(updated);
  rememberAddressBook(id, written);
  return accept(address);
}

/** Everything {@link updateBookAddress} reads: the store holding the account's book, the account, the address
 *  to replace and the members it is replaced with. */
export interface UpdateBookAddressInput {
  /** The store holding the account's address book. */
  readonly store: WritableStore;
  /** The account whose address is replaced. */
  readonly id: CustomerId;
  /** The address to replace, which the account's book must hold. */
  readonly addressId: AddressId;
  /** The members the address is replaced with, which leave its default flags as they are. */
  readonly input: AddressInput;
}

/** Replaces an address's members, leaving the flags that make it a default as they are: a default moves only
 * through the operation that sets one. */
export function updateBookAddress(update: UpdateBookAddressInput): Result<Address> {
  const { store, id, addressId, input } = update;
  const book = store.books.get(id);
  if (book === undefined) return refuse("forbidden", FEEDBACK_COPY.ERROR_STATE_BODY);
  const existing = book.find((address) => address.id === addressId);
  if (existing === undefined) return refuse("address-not-found", NOT_FOUND_COPY.BODY);
  const updated: Address = { ...existing, ...input };
  const written = book.map((address) => (address.id === addressId ? updated : address));
  store.books.set(id, written);
  rememberAddressBook(id, written);
  return accept(updated);
}

/** Removes an address, and with it the reference the account held: the rule that falls each default a removal
 * took to the address that remains is `src/utils/accountRules.ts`'s, applied to the book as it stands. */
export function removeBookAddress(
  store: WritableStore,
  id: CustomerId,
  addressId: AddressId,
): Result<void> {
  const customer = store.customerById.get(id);
  const book = store.books.get(id);
  if (customer === undefined || book === undefined) {
    return refuse("forbidden", FEEDBACK_COPY.ERROR_STATE_BODY);
  }
  if (!book.some((address) => address.id === addressId)) {
    return refuse("address-not-found", NOT_FOUND_COPY.BODY);
  }
  const remaining = promoteDefaultAfterRemoval(book, addressId);
  store.books.set(id, remaining);
  const updated: Customer = {
    ...customer,
    addressIds: customer.addressIds.filter((held) => held !== addressId),
  };
  replaceAccount(store, updated);
  // The book that remains and the reference the account no longer holds are both durable.
  rememberProfile(updated);
  rememberAddressBook(id, remaining);
  return accept(undefined);
}

/** Everything {@link setBookDefault} reads: the store holding the account's book, the account, the address to
 *  make default and the kind of default it is made. */
export interface SetBookDefaultInput {
  /** The store holding the account's address book. */
  readonly store: WritableStore;
  /** The account whose address is made default. */
  readonly id: CustomerId;
  /** The address to make the default of the given kind, which the account's book must hold. */
  readonly addressId: AddressId;
  /** The kind of default the address is made: shipping or billing. */
  readonly kind: AddressKind;
}

/** Makes one address the default of the kind the request names, clearing the previous default of that kind
 * through `src/utils/accountRules.ts`'s own rule. */
export function setBookDefault(request: SetBookDefaultInput): Result<Address> {
  const { store, id, addressId, kind } = request;
  const book = store.books.get(id);
  if (book === undefined) return refuse("forbidden", FEEDBACK_COPY.ERROR_STATE_BODY);
  const updated = applyDefaultAddressRule(book, addressId, kind);
  const address = updated.find((row) => row.id === addressId);
  if (address === undefined) return refuse("address-not-found", NOT_FOUND_COPY.BODY);
  store.books.set(id, updated);
  rememberAddressBook(id, updated);
  return accept(address);
}
