/**
 * Path: src/data/clientWriteRecord.ts
 * Purpose: The durable record of this browser's own writes to the seeded collections: the shape a load replays and the empty record a failed read falls back to
 * Lines: 75
 */

// This is not a path the tree maps on its own: it is a §0.5.5 split path of `src/data/clientWrites.ts`,
// taken so that no module imports a shape back from the module that folds it. `src/data/clientWrites.ts`
// owns the record's key, its guard, the writes that extend it and the folds that lay it over the seeds, and
// it folds the record's review list through the guard, the append and the fold in
// `src/data/reviewWrites.ts`; that module reads the record's own shape and hands the record back extended.
// The shape therefore lives here, where both can read it, and the only edge between the two modules runs
// from `src/data/clientWrites.ts` into `src/data/reviewWrites.ts`. `src/data/clientWrites.ts` re-exports
// every name below, so a reader of the record keeps importing it from the same path it always did.

import type { Address, CredentialDigest, Customer } from "@/types/account";
import type { Review } from "@/types/catalog";
import type { Order } from "@/types/commerce";
import type { CustomerId, IsoDateString } from "@/types/common";

// The durable record --------------------------------------------------------------------------------

/** An account this browser registered, with the digest that verifies its password: the record a
 * reload needs for the derived session token to name an account again, and for the credentials of a
 * registered customer to sign in. The digest is the only shape a password is ever held in — the plain
 * text exists for the length of the call that digests it and is never written here. */
export interface RegisteredAccount {
  readonly customer: Customer;
  readonly digest: CredentialDigest;
}

/** One address book this browser wrote, whole: the addresses as they stood when it was written, so a
 * replay replaces that customer's book rather than merging into it. A book holds at most one default
 * of each kind, and replacing it wholesale is what keeps that true across a load. */
export interface AddressBookWrite {
  readonly customerId: CustomerId;
  readonly addresses: readonly Address[];
}

/** How far this browser's own order minting has reached: `nextIndex` is the index the next order it
 * places takes, and `day` and `sequence` are the day and the sequence of the last order number it
 * minted. Two documents open at once agree through these marks instead of deriving an identity from
 * the seed each of them loaded, which is what stops them minting one identifier between them. */
export interface OrderMint {
  readonly nextIndex: number;
  readonly day: IsoDateString;
  readonly sequence: number;
}

/** Everything this browser has written to the seeded collections: the orders it placed with the marks
 * its minting has reached, the accounts it registered, the profile edits it made, the address books it
 * wrote and the reviews it published. Held under one key, so one read replays all of it onto the seed. */
export interface ClientWrites {
  readonly orders: readonly Order[];
  readonly orderMint: OrderMint;
  readonly accounts: readonly RegisteredAccount[];
  readonly profiles: readonly Customer[];
  readonly books: readonly AddressBookWrite[];
  /** The reviews this browser published, newest first. Optional because a payload written before the
   * record carried reviews holds none, and `src/data/reviewWrites.ts` reads its absence as no review
   * rather than as a payload this build will not read. */
  readonly reviews?: readonly Review[];
}

/** The record before this browser has written anything: what a reader gets with no store, an empty one,
 * and a payload this build will not read. Nothing here is ever written through — every write builds a
 * new record from a read — so the same value can answer every reader. */
export const NO_CLIENT_WRITES: ClientWrites = {
  orders: [],
  orderMint: { nextIndex: 0, day: "", sequence: 0 },
  accounts: [],
  profiles: [],
  books: [],
  reviews: [],
};
