/**
 * Path: src/features/cart/cartSelectors.ts
 * Purpose: Derived cart values: item count, line discount totals and free-shipping progress
 * Lines: 194
 */

import { freeShippingProgress, type FreeShippingProgress } from "@/lib/pricingService";
import type { CartLine, PricedCart, PricedCartLine } from "@/types/commerce";
import type { LineId, MinorUnits } from "@/types/common";
import { indexBy, sumQuantities } from "@/utils/collections";

/**
 * The derived values the cart slice displays, read off the lines the shopper built and off the priced
 * cart `src/lib/pricingService.ts` produced — and never computed a second time.
 *
 * Three rules decide what may live in this module, and they are what stop the header's badge, the
 * cart's summary panel and the checkout from disagreeing about the same basket:
 *
 * - Counts are read off the lines themselves, so the item count and the empty test belong here — and the
 *   count is read through the shared aggregation helper, so every surface that states it, inside this
 *   slice and above it, states one figure for one basket.
 * - No money is computed. A line's discount and the basket's discount total are read from the priced
 *   cart exactly as the pricing service wrote them, and the free-delivery position is that service's
 *   own `freeShippingProgress`, called rather than restated. Nothing here compares a subtotal against
 *   the free-shipping threshold, which is also why this module imports no configuration at all.
 * - Amounts leave as integer minor units. Turning one into text is the view's job, through
 *   `src/utils/format.ts`.
 *
 * The slice's views read these directly: the cart page's header line, the mini-cart and the header's badge all
 * count units with `selectItemCount` — whose reading is `sumQuantities`, the shared helper the checkout's own
 * summary panel has to call for itself, because the layer rule keeps that other slice from importing this
 * module — and a row reads `selectAvailability` and maps its status to the wording in
 * `src/constants/content.ts`, the summary panel puts the priced cart's own breakdown of applied promos
 * beside `selectDiscountTotalMinor` and draws its progress block from `selectFreeShippingProgress`, and
 * every amount reaches the screen through `src/utils/format.ts`.
 *
 * Every function is pure and deterministic, so a caller may run one on every render without memoising
 * it, and the same cart always produces the same figures.
 */

// Availability ---------------------------------------------------------------------------------

/**
 * How much of a cart line is still buyable, in the three states the cart renders.
 *
 * The question is the line's own — how much of it may be bought — and not the product's shelf question
 * of whether its stock is running low, which `src/utils/format.ts` answers from the product's stock
 * against its low-stock threshold. A line carries the stock ceiling copied onto it as it was created,
 * so its availability is read from that ceiling and its quantity alone.
 *
 * - `"in-stock"`: the line holds less than its ceiling, so it can still grow.
 * - `"limited"`: the line already holds everything the product has left, so its quantity cannot rise.
 * - `"unavailable"`: the ceiling holds nothing purchasable, so the line cannot be bought at all.
 */
export type LineAvailabilityStatus = "in-stock" | "limited" | "unavailable";

/**
 * A cart line's availability: the status, and the ceiling it was measured against.
 *
 * The ceiling travels with the status so a quantity stepper bounds itself from the selector's answer
 * instead of reading the line's stock field again, and a row can disable its controls at the bounds the
 * cart itself would clamp to.
 *
 * No wording is carried: the sentence a shopper reads for each status belongs to
 * `src/constants/content.ts`, which keeps copy out of this shape.
 */
export interface LineAvailability {
  readonly status: LineAvailabilityStatus;
  readonly maxQuantity: number;
}

/**
 * Reads one line's availability from the ceiling it carries and the quantity it holds.
 *
 * `maxQuantity` is the ceiling because it is the stock the line was created with — the same field
 * `src/state/cartReducer.ts` clamps every quantity change against — so the status, the stepper's bounds
 * and the reducer's clamp all speak about one number.
 *
 * A ceiling below one holds nothing purchasable, which is the ceiling the reducer's clamp answers `0`
 * for, and a ceiling that is not a finite number is no ceiling at all; both read as unavailable rather
 * than being floored to one, so a line that cannot be bought is reported as such instead of being
 * offered at a phantom unit. The cart drops such a line as it reads itself, so this is the answer for a
 * line handed here before that repair.
 *
 * @param line The cart line to read.
 * @returns Its status and the ceiling it was measured against.
 */
export function selectAvailability(line: CartLine): LineAvailability {
  if (!Number.isFinite(line.maxQuantity) || line.maxQuantity < 1) {
    return { status: "unavailable", maxQuantity: 0 };
  }
  const { maxQuantity } = line;
  if (line.quantity >= maxQuantity) {
    return { status: "limited", maxQuantity };
  }
  return { status: "in-stock", maxQuantity };
}

// Counts and emptiness -------------------------------------------------------------------------

/**
 * The number of units in the cart: the sum of every line's quantity, and `0` for an empty cart.
 *
 * This is the figure the header's cart badge shows and its accessible label announces, so it counts
 * units rather than lines — three of one product beside one of another are four items. The sum is
 * `sumQuantities` from `src/utils/collections`, the shared home of that reading, so the badge, the
 * mini-cart, the cart page, the checkout's summary panel and a placed order's own figures all add the
 * same quantities up in one place rather than each writing the loop again.
 *
 * @param lines The cart's lines.
 * @returns The total quantity across them.
 */
export function selectItemCount(lines: readonly CartLine[]): number {
  return sumQuantities(lines);
}

/**
 * Whether the cart holds nothing.
 *
 * The test is on the lines rather than on any total: a cart that kept a promo code after its last line
 * was removed is still empty for every surface that renders it, because a code discounts goods there
 * are none of.
 *
 * @param lines The cart's lines.
 * @returns `true` when there is nothing in the cart.
 */
export function selectIsCartEmpty(lines: readonly CartLine[]): boolean {
  return lines.length === 0;
}

// Figures the pricing service produced ---------------------------------------------------------

/**
 * One line's share of the discounts applied to the basket, exactly as the pricing service computed it.
 *
 * The amount is read rather than recalculated: it already carries this line's part of an order-level
 * code and the whole of a code scoped to the line's own category, so restating that arithmetic here is
 * how a cart's rows and an order's lines come to disagree about what one order costs. The figure is the
 * line's `discountMinor`, rounded by the pricing service like every other amount in the product.
 *
 * @param line A line as `src/lib/pricingService.ts` priced it.
 * @returns The line's discount in integer minor units, `0` when nothing reduced that line.
 */
export function selectLineDiscountMinor(line: PricedCartLine): MinorUnits {
  return line.discountMinor;
}

/**
 * The basket's total discount, exactly as the pricing service computed it.
 *
 * This is the figure the summary panel's discount rows add up to and the figure a placed order carries,
 * so nothing here adds the applied promos together again; the priced cart's own breakdown travels
 * beside it for the rows that name each code and the amount it took off.
 *
 * @param pricedCart The priced basket.
 * @returns The total discount in integer minor units, `0` when no code applied.
 */
export function selectDiscountTotalMinor(pricedCart: PricedCart): MinorUnits {
  return pricedCart.discountTotalMinor;
}

/**
 * The priced lines keyed by their own id, for the rows that render from the cart's own lines.
 *
 * The lines a view renders and the lines the pricing service returned are two readings of one basket,
 * and they are briefly different: an edit lands on the cart's lines at once while its new price is
 * still a request away. Keying the priced lines lets each row look up the figures for its own id — and
 * read `undefined` for as long as that price is in flight — instead of scanning the priced array once
 * per row on every render, which is quadratic in a full cart. The map is rebuilt on each call, so a
 * caller that keeps one across renders keeps it beside the priced cart it was derived from.
 *
 * @param pricedCart The priced basket.
 * @returns A read-only map from line id to that line's priced figures.
 */
export function selectPricedLinesById(pricedCart: PricedCart): ReadonlyMap<LineId, PricedCartLine> {
  return indexBy(pricedCart.lines, (line) => line.id);
}

/**
 * How far the basket is from free delivery: what is still owed, how full the progress indicator is and
 * whether the threshold is already met.
 *
 * The threshold arithmetic belongs to `src/lib/pricingService.ts`, which knows the configured threshold
 * and already computed the shortfall that sits on the priced cart; this selector routes the priced cart
 * to that function rather than restating the comparison, so the progress bar, the sentence beside it and
 * the delivery charge the shopper is actually quoted cannot disagree. A caller reads `remainingMinor`
 * for the sentence and `ratio` for the bar, and formats any amount through `src/utils/format.ts`.
 *
 * @param pricedCart The priced basket.
 * @returns The free-delivery progress the pricing service derived for it.
 */
export function selectFreeShippingProgress(pricedCart: PricedCart): FreeShippingProgress {
  return freeShippingProgress(pricedCart);
}
