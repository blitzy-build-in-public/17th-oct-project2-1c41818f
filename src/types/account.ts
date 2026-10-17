/**
 * Path: src/types/account.ts
 * Purpose: Account shapes: customer, address, credentials, session, role and loyalty tier
 * Lines: 303
 */

import type { AddressId, CustomerId, IsoDateTimeString, SessionToken } from "@/types/common";

// Role and loyalty tier -------------------------------------------------------------------------

/**
 * What a visitor is entitled to do, carried as the `role` claim on every session.
 *
 * `guest` is an unauthenticated visitor browsing the storefront, `customer` is a signed-in shopper
 * and `admin` is a sales administrator. `src/Router.tsx` reads it to guard `/account/*` (customer
 * or administrator) and `/admin/*` (administrator only), but that guard is a convenience rather
 * than the control: authorisation is enforced in `src/lib/mockServer.ts`, which re-checks the
 * session's role on every privileged request, because hiding a control is not access control.
 */
export type Role = "guest" | "customer" | "admin";

/**
 * The seeded loyalty label on a customer record.
 *
 * A label only. Loyalty point accounting is out of scope, so nothing in the product computes,
 * awards or mutates a tier: `src/data/customers.ts` assigns one when it seeds the customer base and
 * the account surfaces render it as a badge.
 */
export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

// Addresses -------------------------------------------------------------------------------------

/**
 * Which of a customer's two defaults an address is being nominated for.
 *
 * The selector carried by `POST /api/customers/:id/addresses/:addressId/default`, whose body is
 * `DefaultAddressRequest`. Naming the kind rather than letting one form set both flags keeps the
 * "at most one default of each kind" rule enforceable, and it is why an order whose customer has no
 * billing default is billed to its shipping address.
 */
export type AddressKind = "shipping" | "billing";

/**
 * One postal address in a customer's address book, and the address an order ships to or is billed
 * against.
 *
 * Two rules belong to this shape and are owned elsewhere: at most one address per customer has
 * `isDefaultShipping` set and at most one has `isDefaultBilling` set, and setting a default of a
 * kind clears the previous default of that kind — `src/lib/customerService.ts` owns that rule,
 * including promoting the most recently added address when a default is removed. A `Customer` holds
 * references to its addresses rather than copies, so an address is stored once and the address book
 * is its only home.
 *
 * An order keeps the address it was placed with rather than re-reading the book, so editing or
 * removing an address never rewrites a placed order and an order's total cannot move afterwards.
 */
export interface Address {
  /** Assigned by the data layer when the address is created; prefixed `adr_`. */
  readonly id: AddressId;

  /** The customer's own name for the address, as the address book and checkout show it. */
  readonly label: string;

  readonly fullName: string;
  readonly line1: string;

  /** Apartment, suite or unit; an empty string when the address has no second line. */
  readonly line2: string;

  readonly city: string;
  readonly region: string;

  /** Validated against the pattern of `country`, by the rule in `src/utils/validation.ts`. */
  readonly postalCode: string;

  /** One of the configured countries; checkout and the address book offer exactly that set. */
  readonly country: string;

  /** Recorded so a delivery can be queried; an empty string when none was supplied. */
  readonly phone: string;

  /** At most one address per customer is the default shipping address. */
  readonly isDefaultShipping: boolean;

  /** At most one address per customer is the default billing address. */
  readonly isDefaultBilling: boolean;
}

/**
 * The create and update body of the address endpoints, without the members the data layer owns.
 *
 * `id` is assigned when the address is created and the two default flags move only through the
 * dedicated default endpoint, so neither appears here. Which members are required — full name,
 * line 1, city, region, postal code and country — is owned by `src/utils/validation.ts`, which
 * returns a `FieldErrors` map keyed by exactly these member names; checkout and the address book
 * reuse it unchanged.
 *
 * The optional members are declared in full rather than omitted, so an update always describes the
 * whole address and a cleared field is cleared by an empty string.
 */
export interface AddressInput {
  /** The customer's own name for the address; the one member the address rule does not require. */
  readonly label: string;

  readonly fullName: string;
  readonly line1: string;

  /** An empty string when the address has no second line. */
  readonly line2: string;

  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;

  /** An empty string when no phone number is supplied, which the address rule accepts. */
  readonly phone: string;
}

/**
 * The body of the set-default endpoint: which default to point at the address in the path.
 *
 * Setting a default is a separate operation from editing an address, so an address stays valid
 * while its default status changes, and the clearing of the previous default of the same kind lives
 * in `src/lib/customerService.ts` rather than in a form.
 */
export interface DefaultAddressRequest {
  readonly kind: AddressKind;
}

// Customers and credentials ---------------------------------------------------------------------

/**
 * A customer account, as the account surfaces, the order history and the administrator's records
 * read it.
 *
 * `lastLoginAt` is `null` from registration until the first successful sign-in, which is what tells
 * an invited account from a used one; `src/lib/mockServer.ts` writes it when it answers a sign-in.
 *
 * `addressIds` are references, not embedded addresses: the address book is read, created and edited
 * through the address endpoints, so an address is stored once and no order depends on a copy of it.
 *
 * The record carries no credential of any kind. The digest that verifies a password is held in the
 * account store that `src/data/customers.ts` seeds, and it is never part of a payload the UI
 * receives.
 */
export interface Customer {
  /** Account identifier, prefixed `cus_`. */
  readonly id: CustomerId;

  /** The sign-in identity, unique across accounts and unchangeable through the profile endpoint. */
  readonly email: string;

  readonly firstName: string;
  readonly lastName: string;

  /** Optional at registration; an empty string when the customer has not supplied one. */
  readonly phone: string;

  /**
   * The account's standing: `customer` for a shopper, or `admin` for the seeded sales
   * administrators. A stored account is never a guest — an unauthenticated visitor is represented
   * by the absence of a session, not by an account record.
   */
  readonly role: Role;

  /** When the account was created. */
  readonly createdAt: IsoDateTimeString;

  /** When it last signed in, or `null` if it never has. */
  readonly lastLoginAt: IsoDateTimeString | null;

  /** The seeded label the profile shows; nothing awards, spends or changes it. */
  readonly loyaltyTier: LoyaltyTier;

  /** Consent recorded at registration and editable through the profile; nothing else acts on it. */
  readonly marketingOptIn: boolean;

  /** References into the address book, resolved through the address endpoints. */
  readonly addressIds: readonly AddressId[];
}

/**
 * A salted digest of a demonstration password: the shape the account store persists and verifies.
 *
 * Demonstration boundary, stated plainly: this is an in-browser account store, not a security
 * boundary. The salt and the hash are produced and checked solely by the salt, hash and verify
 * helpers in `src/utils/strings.ts`, which is their single home because two layers need them —
 * `src/data/customers.ts` when it seeds the customer base and `src/lib/mockServer.ts` when it
 * answers a sign-in — so declaring the algorithm here as well would be the duplicated logic the
 * product forbids. A real deployment moves issue and verification behind the server that
 * `src/lib/apiClient.ts` is built to be repointed at.
 *
 * A plain-text password is never a member of any type in this file, and the digest never travels to
 * the UI: it stays inside the account store.
 */
export interface CredentialDigest {
  /** Unique per account, so two customers who chose the same password share no hash. */
  readonly salt: string;

  /** The password combined with the salt; never leaves the account store. */
  readonly hash: string;
}

/**
 * The sign-in body of `POST /api/auth/login`.
 *
 * The password is validated by `src/utils/validation.ts` (at least eight characters, with one
 * letter and one digit) and digested, or verified against the stored digest, by the salt and hash
 * helpers in `src/utils/strings.ts`; a plain-text password is never stored. A rejected sign-in
 * answers `401` with one generic message that does not reveal which of the two members was wrong,
 * so a response cannot be used to discover which email addresses have accounts.
 */
export interface Credentials {
  /** The account's email address. */
  readonly email: string;

  /** Never stored in clear. */
  readonly password: string;
}

/**
 * The registration body of `POST /api/auth/register`.
 *
 * Unlike `Credentials` this carries the profile members the account needs from its first moment,
 * because a registered customer is signed in immediately and no second request follows. The same
 * password rule as sign-in applies; a duplicate email is rejected by `src/lib/mockServer.ts` with
 * `409`, and a field-level validation failure answers `422` with the offending member named.
 */
export interface RegistrationInput {
  /** The sign-in identity of the account being created; unique across accounts. */
  readonly email: string;

  /** Digested by the salt and hash helpers in `src/utils/strings.ts`; never stored in clear. */
  readonly password: string;

  readonly firstName: string;
  readonly lastName: string;

  /** Recorded on the new account, and from then on editable through the profile. */
  readonly marketingOptIn: boolean;
}

/**
 * The body of `PATCH /api/customers/:id`, field for field with the data layer's endpoint.
 *
 * Only the editable members appear: the email identifies the account and is not changed through
 * this path, the role, the loyalty tier and the timestamps are owned by the data layer, and the
 * addresses are read and written through their own endpoints. An administrator may patch an account
 * it does not own; the ownership and role checks are enforced in `src/lib/mockServer.ts`.
 */
export interface ProfileUpdateInput {
  readonly firstName: string;
  readonly lastName: string;

  /** An empty string clears the stored number, because the member is optional. */
  readonly phone: string;

  readonly marketingOptIn: boolean;
}

// Sessions --------------------------------------------------------------------------------------

/**
 * An issued session: the opaque token, the account it belongs to and the role it carries.
 *
 * `token` is prefixed `ses_` and opaque — it encodes nothing a caller may read, so nothing
 * outside `src/lib/mockServer.ts` parses it — and it travels as the `x-session-token` header.
 * `role` is the claim re-checked on every privileged request, which is why a session, and not the
 * current route, is the unit of authorisation.
 *
 * An expired or unknown token answers `401`, which signs the visitor out and returns them to
 * sign-in rather than degrading into a partially authenticated screen. `src/state/AuthContext.tsx`
 * persists it through `src/utils/storage.ts` under the key in `src/constants/config.ts` and
 * revalidates it through `restoreSession` in `src/lib/authService.ts`; nothing here stores it.
 */
export interface Session {
  /** The opaque credential the client sends back; prefixed `ses_`. */
  readonly token: SessionToken;

  /** The account the token authenticates, which every ownership check compares against. */
  readonly customerId: CustomerId;

  /** The standing the token carries, re-checked on each privileged request. */
  readonly role: Role;

  /** When the token was issued. */
  readonly issuedAt: IsoDateTimeString;

  /** When it stops being accepted; a session past this instant is treated as absent. */
  readonly expiresAt: IsoDateTimeString;
}

/**
 * The response of `POST /api/auth/register`: the created account and the session opened with it.
 *
 * Registration signs the new customer in, so both halves are returned together and no surface has
 * to follow a successful registration with a second sign-in request.
 */
export interface RegistrationResult {
  readonly customer: Customer;
  readonly session: Session;
}
