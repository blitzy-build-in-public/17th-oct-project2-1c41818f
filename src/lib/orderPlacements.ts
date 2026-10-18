/**
 * Path: src/lib/orderPlacements.ts
 * Purpose: The read credential this browser holds for each order it placed without an account
 * Lines: 94
 */

import { STORAGE_KEYS } from "@/constants/config";
import type { Order } from "@/types/commerce";
import type { OrderId } from "@/types/common";
import { readStored, writeStored } from "@/utils/storage";

// The credential a placement is remembered by ------------------------------------------------------
// The client-side half of the order-read credential `src/lib/apiOrders.ts` keeps at the seam: the
// idempotency key a submission was sent under is the one value the placing client mints and holds, so
// it is what a confirmation carrying nothing but an identifier presents to read its own order back.

/** One order this browser placed without an account, beside the credential its submission carried. */
interface Placement {
  readonly orderId: OrderId;
  readonly token: string;
}

/** How many placements are kept, newest first: the confirmation of a recent order reopens after a
 * reload, while a browser that places order after order cannot grow the payload without bound. */
const KEPT_PLACEMENTS = 20;

/** Whether a stored value is one placement: both members present and text, so an entry a build this
 * one does not know wrote is discarded rather than handed back as a credential. */
function isPlacement(value: unknown): value is Placement {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly orderId?: unknown; readonly token?: unknown };
  return typeof candidate.orderId === "string" && typeof candidate.token === "string";
}

/**
 * Whether a stored value is the payload this module writes: a list whose every entry is a placement.
 *
 * Every member of every entry is guarded, so a payload of another shape — or one holding a single entry
 * that is not a placement — is discarded whole rather than read in part, which is what keeps a value
 * this build cannot describe out of the read that would present it.
 */
function isPlacementList(value: unknown): value is readonly Placement[] {
  return Array.isArray(value) && value.every(isPlacement);
}

/** The placements this browser holds, newest first: an empty list when nothing is stored, the store
 * cannot be reached, or the payload fails its guard. */
function storedPlacements(): readonly Placement[] {
  return readStored<readonly Placement[]>(STORAGE_KEYS.ORDER_TOKENS, [], isPlacementList);
}

/**
 * Remembers the placement of an order this browser created, under the credential its submission
 * carried, so the buyer's own confirmation can be reopened after a reload.
 *
 * Only an order that names no account is recorded, because an order that names an account is read
 * through the session that owns it and needs no other credential. A placement of an order already
 * stored replaces that entry rather than repeating it, the list stays newest first, and the oldest
 * placement beyond {@link KEPT_PLACEMENTS} is dropped. A refused write is tolerated silently, exactly
 * as every other caller of `writeStored` tolerates it: the order is placed either way.
 *
 * @param order - The order that was created.
 * @param token - The credential the submission that created it was sent under.
 */
export function rememberPlacement(order: Order, token: string): void {
  if (order.customerId !== null) return;
  const kept = storedPlacements().filter((placement) => placement.orderId !== order.id);
  const placements: readonly Placement[] = [{ orderId: order.id, token }, ...kept].slice(
    0,
    KEPT_PLACEMENTS,
  );
  writeStored<readonly Placement[]>(STORAGE_KEYS.ORDER_TOKENS, placements);
}

/**
 * The credential this browser holds for an order it placed without an account, or `null` when it holds
 * none: the client-side half of the seam's order-read credential, and the only thing a confirmation
 * route carrying an identifier but no session can present.
 *
 * @param orderId - The identifier the read asks for.
 * @returns The credential stored for that order, or `null` when this browser stored none for it.
 */
export function placementTokenFor(orderId: OrderId): string | null {
  return storedPlacements().find((placement) => placement.orderId === orderId)?.token ?? null;
}

/**
 * Forgets every placement this browser holds, so a fresh case starts with none: the store is rewritten
 * empty through the same util every other write uses, which is what keeps a case from reading an order an
 * earlier case placed.
 */
export function clearPlacements(): void {
  writeStored<readonly Placement[]>(STORAGE_KEYS.ORDER_TOKENS, []);
}
