/**
 * Path: src/data/reviewWrites.ts
 * Purpose: The review half of this browser's durable record: the guard that reads a published review back, the append that records one and the fold that lays the record's rows over the seeded ones
 * Lines: 110
 */

// This is not a path the tree maps on its own: it is a second split of the durable record
// `src/data/clientWrites.ts` holds, taken under the over-budget rule because that file cannot take another
// export under the 600-line ceiling, which is never raised. A published review is the
// fourth collection this browser adds to a seeded one, and the only one the seed holds as a list of rows
// rather than as a record indexed by identifier: the member's own guard, the append that records an
// accepted review and the fold that lays the record's rows over the seeded ones live here, while the
// record's key, its guard, its writes and its other folds stay in `src/data/clientWrites.ts`, which owns the
// one write through the storage util. The record's own shape lives in `src/data/clientWriteRecord.ts`, which
// both modules read it from: this module takes the shape from there rather than from the module that folds
// it, so between the two of them the module graph stays acyclic. This module holds no store, no key and no
// state of its own.

import type { ClientWrites } from "@/data/clientWriteRecord";
import type { Review } from "@/types/catalog";

// Reading a stored review ---------------------------------------------------------------------------

/** The members a review carries as text: the identifier the list keys a row by, the product it reviews
 * and the account that wrote it, and the three members every review surface renders. */
const REVIEW_TEXT_FIELDS = [
  "id",
  "productId",
  "customerId",
  "customerName",
  "title",
  "body",
  "createdAt",
] as const;

/** Whether a stored member is a review: each text member above, the rating and the helpful count as
 * finite numbers, and the verified-purchase mark as a boolean. Content the current type does not
 * describe is discarded rather than handed to a review list as a row, because the list reads every one
 * of those members. */
function isReview(value: unknown): value is Review {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as { readonly [member: string]: unknown };
  return (
    REVIEW_TEXT_FIELDS.every((field) => typeof row[field] === "string") &&
    Number.isFinite(row.rating) &&
    Number.isFinite(row.helpfulCount) &&
    typeof row.verifiedPurchase === "boolean"
  );
}

/**
 * Whether a stored review list is one this build wrote.
 *
 * An absent list answers `true`: a payload written before the record carried reviews holds none, and
 * rejecting it wholesale would cost the orders, accounts, profiles and address books it does hold,
 * because `src/utils/storage.ts` discards a payload its guard refuses as a whole rather than reading it
 * in part.
 *
 * @param value - The member the record was read with.
 * @returns `true` when the member is absent, or is an array of reviews.
 */
export function isStoredReviews(value: unknown): value is readonly Review[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((row) => isReview(row)));
}

/**
 * The reviews the record holds: the rows this browser published, newest first, or none at all.
 *
 * An absent list is read as the empty one here, at the single point where the record's reviews are read,
 * so a payload written before the record carried reviews behaves exactly as a browser that published
 * nothing — which is what such a payload is.
 *
 * @param writes - The record as it was read.
 * @returns The rows the record holds; `writes` itself is never mutated.
 */
export function reviewsOf(writes: ClientWrites): readonly Review[] {
  return writes.reviews ?? [];
}

// Recording a published review -----------------------------------------------------------------------

/**
 * The record with one published review added, newest first.
 *
 * The row is prepended, so the record reads exactly as the store's own review list does, the newest
 * first, and the replay that follows a load lists a submitted review where the document that accepted it
 * showed it.
 *
 * @param writes - The record as it was read.
 * @param review - The review the store has just accepted.
 * @returns A new record; `writes` itself is never mutated.
 */
export function withReview(writes: ClientWrites, review: Review): ClientWrites {
  return { ...writes, reviews: [review, ...reviewsOf(writes)] };
}

/**
 * The review store a document loads: the rows this browser published, then the seeded ones.
 *
 * This browser's rows lead, which is what puts a review the visitor just published back at the front of
 * the list they return to, and the seed's rows follow in the order the seed wrote them — so a document
 * that published nothing serves the seeded collection itself, in its own order.
 *
 * @param seed - `REVIEWS`, the rows the seed holds.
 * @param writes - The record read from the store.
 * @returns A new array; `seed` itself is never mutated.
 */
export function mergeReviews(seed: readonly Review[], writes: ClientWrites): Review[] {
  return [...reviewsOf(writes), ...seed];
}
