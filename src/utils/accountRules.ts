/**
 * Path: src/utils/accountRules.ts
 * Purpose: The account rules the domain services and the data layer share: session lifetime and the address book's default flags
 * Lines: 162
 */

import { SESSION_TTL_MS } from "@/constants/config";
import type { Address, AddressKind, Session } from "@/types/account";
import type { AddressId, IsoDateTimeString } from "@/types/common";
import { maxBy } from "@/utils/collections";
import { parseIso, toIsoDateTime } from "@/utils/dates";

/**
 * The account rules both the domain services and the data layer read: how long an issued session stays
 * valid, and which address of an address book is the default of a kind.
 *
 * They live here, in the foundations, rather than in the service that publishes them, because two
 * layers need them and the layer order lets a file import only from its own layer or from a layer
 * below it. `src/lib/authService.ts` and `src/lib/customerService.ts` re-export every name below, so a
 * caller keeps importing the service that owns the account it is reading, while the seeded data layer
 * that stamps a session's `expiresAt` and answers the address endpoints may read the same home from a
 * layer below it instead of importing the layer above.
 *
 * Each rule keeps exactly one home. {@link sessionExpiresAt} and {@link isSessionExpired} are the
 * product's only expiry arithmetic, so the session a client stores, the session a lookup answers with
 * and the session the seam accepts cannot disagree about when it lapses. {@link withDefaultFlag} is the
 * only code that writes a default flag, so the book a page renders, the book a removal promotes in and
 * the book the seam writes to cannot disagree about which address is the default.
 */

// Session lifetime --------------------------------------------------------------------------------

/**
 * When a session issued at `issuedAt` stops being accepted: the issue instant plus the seven days
 * `SESSION_TTL_MS` allows.
 *
 * This and {@link isSessionExpired} are the product's only expiry rule, so the session a client stores,
 * the session a lookup answers with and the session the seam accepts cannot disagree about when it
 * lapses. The result is truncated to the second, which is the precision the stored local ISO form
 * carries and, against a seven-day lifetime, immaterial.
 *
 * An `issuedAt` that names no real instant yields the empty string, which no caller may read as a
 * usable expiry: {@link isSessionExpired} treats an unreadable instant as expired, so a malformed
 * issue instant denies the session rather than granting it.
 *
 * @param issuedAt - The local ISO 8601 date-time the session was issued at.
 * @returns The local ISO 8601 date-time it expires at, or `""` when `issuedAt` is unreadable.
 */
export function sessionExpiresAt(issuedAt: IsoDateTimeString): IsoDateTimeString {
  const issued = parseIso(issuedAt);
  return issued === null ? "" : toIsoDateTime(new Date(issued.getTime() + SESSION_TTL_MS));
}

/**
 * Whether a session has lapsed by `now`.
 *
 * A session is expired at the exact instant it expires, the half-open rule the seam applies, so a
 * session this function still accepts is one the seam still accepts. Anything unreadable is expired:
 * an `expiresAt` that does not parse and a `now` that does not parse both deny the session, because an
 * instant nobody can judge is not a licence to stay signed in.
 *
 * The instant is a parameter rather than a clock read, so the rule stays pure, a caller owns its own
 * clock and a test is deterministic. Consumers: `src/data/repositories.ts` when it answers a session
 * lookup, and `src/state/AuthContext.tsx` when it decides whether a restored session is still worth
 * showing.
 *
 * @param session - The session to judge; only its `expiresAt` is read.
 * @param now - The instant to judge it against, as a local ISO 8601 date-time.
 * @returns Whether the session has expired at `now`.
 */
export function isSessionExpired(session: Session, now: IsoDateTimeString): boolean {
  const expiresAt = parseIso(session.expiresAt);
  const instant = parseIso(now);
  if (expiresAt === null || instant === null) return true;
  return expiresAt.getTime() <= instant.getTime();
}

// The address book's default flags ----------------------------------------------------------------

/**
 * Points one address of a book at being the default of `kind`, and clears the flag of that kind on
 * every other address: the rule that keeps at most one default of each kind per customer, and the
 * only place a default flag is written.
 *
 * The two kinds are independent, so nominating a shipping default leaves `isDefaultBilling` exactly
 * as it stood on every address: one address can be the default of one kind, of both or of neither.
 * An id that names no address of the book changes nothing — nominating an address the book does not
 * hold is the data layer's `404`, not a rule that empties the default it cannot fill.
 *
 * Nothing is mutated. The result is a new array, and an address whose flag already holds the value
 * asked for is carried over as the same object, so a caller comparing references sees a change only
 * where one was made.
 *
 * @param addresses - The book as it stands; never mutated.
 * @param addressId - The address to nominate.
 * @param kind - Which default to point at that address.
 * @returns The book with its defaults applied, or a copy of it when the id names no address.
 */
export function applyDefaultAddressRule(
  addresses: readonly Address[],
  addressId: AddressId,
  kind: AddressKind,
): Address[] {
  if (!addresses.some((address) => address.id === addressId)) return [...addresses];
  return addresses.map((address) => withDefaultFlag(address, kind, address.id === addressId));
}

/**
 * The book after one address is removed: the removed address is gone, and each kind that lost its
 * default falls to the most recently added address that remains.
 *
 * The book is passed as it stands, including the address being removed, because that entry is what
 * tells the rule which kinds lost their default — the shape `SalesProDataSource.removeAddress`
 * composes over the stored book. An id that names no address removes nothing and promotes nothing,
 * a book left empty promotes nothing, and an address that held no default leaves every flag as it
 * was.
 *
 * "Most recently added" is read from the identifiers rather than from array position, so the winner
 * does not depend on how a book happens to be stored or in which order it was read back: the
 * greatest identifier wins, compared by code unit. Both identifier forms this product mints order
 * usefully under that comparison — a padded sequence (`adr_0007` before `adr_0012`) orders by
 * insertion, and a slug keyed by the owner and the label (`adr_<owner>-<label>`) orders stably by
 * name — and either way the choice is deterministic, which is what makes two runs over the seeded
 * books promote the same address and a test over seeded data reproducible.
 *
 * @param addresses - The book as it stands, the address being removed included; never mutated.
 * @param removedId - The address being removed.
 * @returns A new book without it, with each default it held promoted.
 */
export function promoteDefaultAfterRemoval(
  addresses: readonly Address[],
  removedId: AddressId,
): Address[] {
  const removed = addresses.find((address) => address.id === removedId);
  const remaining = addresses.filter((address) => address.id !== removedId);
  if (removed === undefined) return remaining;
  const shipping = removed.isDefaultShipping ? promoteDefault(remaining, "shipping") : remaining;
  return removed.isDefaultBilling ? promoteDefault(shipping, "billing") : shipping;
}

/** Points `kind`'s default at the most recently added address of `addresses` — the greatest
 * identifier — and leaves every flag as it was when the book holds no address to promote. */
function promoteDefault(addresses: readonly Address[], kind: AddressKind): Address[] {
  const candidate = maxBy(addresses, (address) => address.id);
  if (candidate === undefined) return [...addresses];
  return addresses.map((address) => withDefaultFlag(address, kind, address.id === candidate.id));
}

/** Returns `address` with its `kind` flag set to `isDefault` and its other flag untouched: the one
 * place a flag is written, and the exhaustive switch over the two kinds. */
function withDefaultFlag(address: Address, kind: AddressKind, isDefault: boolean): Address {
  switch (kind) {
    case "shipping":
      return address.isDefaultShipping === isDefault
        ? address
        : { ...address, isDefaultShipping: isDefault };
    case "billing":
      return address.isDefaultBilling === isDefault
        ? address
        : { ...address, isDefaultBilling: isDefault };
  }
}
