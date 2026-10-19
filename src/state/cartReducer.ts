/**
 * Path: src/state/cartReducer.ts
 * Purpose: Cart transitions with stock clamping and an exhaustive action union
 * Lines: 535
 */

import type { Product } from "@/types/catalog";
import type { Cart, CartLine } from "@/types/commerce";
import type { CurrencyCode, IsoDateTimeString, LineId, ProductId } from "@/types/common";
import { DEFAULT_CURRENCY, STORAGE_VERSION } from "@/constants/config";
import { clampNumber } from "@/utils/collections";
import { isValidIso, toIsoDateTime } from "@/utils/dates";
import { assertNever } from "@/utils/exhaustive";
import { cartLineId } from "@/utils/strings";

// State ----------------------------------------------------------------------------------------

/**
 * The cart's whole state: the lines the shopper built, the code they applied and when the cart last
 * changed.
 *
 * It holds nothing derived. The item count and the free-shipping progress are computed during render
 * by `src/features/cart/cartSelectors.ts`, and every money total by `src/lib/pricingService.ts`; a
 * stored count or subtotal would be a second answer to a question the lines already answer, and the
 * two would drift apart. No amount, no total and no format helper therefore appears in this file.
 *
 * `updatedAt` is advanced by each transition that changes the lines, from an instant the caller
 * supplied: the added line's `addedAt` on `cart/add`, and the action's own `at` elsewhere. The
 * reducer reads no clock, so a state and an action always produce the same result — which is what
 * lets a test assert a transition rather than watch a timestamp.
 */
export interface CartState {
  readonly lines: readonly CartLine[];
  readonly promoCode: string | null;
  readonly updatedAt: IsoDateTimeString;
}

// Actions --------------------------------------------------------------------------------------

/**
 * Every transition the cart can make, one member each.
 *
 * Naming the transitions instead of offering a setter keeps the cart's rules here: a quantity cannot
 * be written past its line's stock ceiling, a second add of the same product cannot create a second
 * line, and lines change wholesale only through `cart/replace-lines`, whose purpose is a cart
 * rebuilt elsewhere — restored from storage, or re-clamped against refreshed stock.
 *
 * `at` is the instant a change happened. It travels with the action rather than being read inside
 * the reducer, which is what keeps the reducer reproducible. It is optional so an action a caller
 * builds by hand still type-checks; a transition whose action carries none keeps the instant the
 * state already held.
 */
export type CartAction =
  | { readonly type: "cart/add"; readonly line: CartLine }
  | {
      readonly type: "cart/update-quantity";
      readonly lineId: LineId;
      readonly quantity: number;
      readonly at?: IsoDateTimeString;
    }
  | { readonly type: "cart/remove"; readonly lineId: LineId; readonly at?: IsoDateTimeString }
  | { readonly type: "cart/clear"; readonly at?: IsoDateTimeString }
  | {
      readonly type: "cart/apply-promo";
      readonly code: string | null;
      readonly at?: IsoDateTimeString;
    }
  | {
      readonly type: "cart/replace-lines";
      readonly lines: readonly CartLine[];
      readonly at?: IsoDateTimeString;
    }
  | { readonly type: "cart/restore"; readonly state: CartState };

/**
 * A creator for every action, defined once at module scope so a holder can keep one in a dependency
 * list without its identity changing between renders.
 *
 * The creators that change the cart stamp the instant they were called — the only clock reads in
 * this module, and the reason the reducer itself has none. A caller needing a fixed instant, a test
 * asserting `updatedAt` above all, passes its own as the last argument.
 */
export const cartActions = {
  /** Adds a line, merged into the line its product already holds rather than beside it. */
  add: (line: CartLine): CartAction => ({ type: "cart/add", line }),
  /** Sets a line's quantity; the transition clamps it to that line's stock ceiling. */
  updateQuantity: (
    lineId: LineId,
    quantity: number,
    at: IsoDateTimeString = toIsoDateTime(new Date()),
  ): CartAction => ({ type: "cart/update-quantity", lineId, quantity, at }),
  /** Drops one line, leaving the others in the order the shopper built them. */
  remove: (lineId: LineId, at: IsoDateTimeString = toIsoDateTime(new Date())): CartAction => ({
    type: "cart/remove",
    lineId,
    at,
  }),
  /** Empties the cart and the promo code with it, because that code was applied to those lines. */
  clear: (at: IsoDateTimeString = toIsoDateTime(new Date())): CartAction => ({
    type: "cart/clear",
    at,
  }),
  /** Stores the code the shopper applied, or `null` once they withdraw it. */
  applyPromo: (
    code: string | null,
    at: IsoDateTimeString = toIsoDateTime(new Date()),
  ): CartAction => ({ type: "cart/apply-promo", code, at }),
  /** Adopts lines built elsewhere: restored from storage, or re-clamped against refreshed stock. */
  replaceLines: (
    lines: readonly CartLine[],
    at: IsoDateTimeString = toIsoDateTime(new Date()),
  ): CartAction => ({ type: "cart/replace-lines", lines, at }),
  /** Adopts a whole stored state verbatim, which is how a cart survives a reload. */
  restore: (state: CartState): CartAction => ({ type: "cart/restore", state }),
};

/**
 * The state a cart starts from: no lines, no promo code, and the instant the caller started it.
 *
 * `overrides` serves the two callers that already know part of the state — the cart context
 * hydrating a stored cart, and a test pinning a fixture — and what they supply passes through the
 * same clamping and normalising the transitions apply, so every state this module hands back
 * satisfies its own invariants.
 */
export function createInitialCartState(overrides: Partial<CartState> = {}): CartState {
  return {
    lines: reclampLines(overrides.lines ?? []),
    promoCode: normalisePromoCode(overrides.promoCode ?? null),
    updatedAt: overrides.updatedAt ?? toIsoDateTime(new Date()),
  };
}

// Reducer --------------------------------------------------------------------------------------

/**
 * Applies one transition.
 *
 * A transition that changes nothing returns the state *itself*, not an equal copy: the cart
 * context's value is memoised, so a fresh object for an action that changed nothing — a quantity
 * already at the value asked for, the removal of a line the cart no longer holds, a promo code
 * typed twice — would re-render every consumer of the cart for nothing.
 *
 * The reducer is pure: no clock, no randomness, no storage, no request, and no mutation of the
 * state or of any line it was given. Instants arrive with the action, and
 * `src/state/CartContext.tsx` is what persists the result and re-prices it through
 * `src/lib/pricingService.ts`.
 */
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "cart/add": {
      const lines = mergeCartLine(state.lines, action.line);
      // A line already holding all the stock there is absorbs the add without changing, and a line
      // nobody can buy is not added at all, so the cart keeps its reference either way and the
      // availability warning the cart renders is what tells the shopper why their click changed
      // nothing.
      if (lines === state.lines) {
        return state;
      }
      // An add carries one instant — the moment its line was built — and that is what the cart
      // records as when it changed.
      return { ...state, lines, updatedAt: action.line.addedAt };
    }

    case "cart/update-quantity": {
      const current = findLineById(state.lines, action.lineId);
      if (current === undefined) {
        return state;
      }
      const quantity = clampLineQuantity(action.quantity, current.maxQuantity);
      if (quantity === current.quantity) {
        return state;
      }
      return {
        ...state,
        lines: replaceLine(state.lines, { ...current, quantity }),
        updatedAt: action.at ?? state.updatedAt,
      };
    }

    case "cart/remove": {
      const lines = state.lines.filter((line) => line.id !== action.lineId);
      if (lines.length === state.lines.length) {
        return state;
      }
      // The promo code is left alone: it is order-level, and the lines it applies to are still
      // there for the pricing service to judge it against.
      return { ...state, lines, updatedAt: action.at ?? state.updatedAt };
    }

    case "cart/clear": {
      if (state.lines.length === 0 && state.promoCode === null) {
        return state;
      }
      // The code goes with the lines: an order-level discount cannot outlive the order's lines, so
      // an emptied cart holds none and a stale code cannot be applied by the next checkout.
      return { lines: [], promoCode: null, updatedAt: action.at ?? state.updatedAt };
    }

    case "cart/apply-promo": {
      // Only the spelling is stored. Whether a code applies, what it is worth and why it was refused
      // are `src/lib/pricingService.ts`'s decisions, and a copy of them here would be a second
      // answer to the same question.
      const promoCode = normalisePromoCode(action.code);
      if (promoCode === state.promoCode) {
        return state;
      }
      return { ...state, promoCode, updatedAt: action.at ?? state.updatedAt };
    }

    case "cart/replace-lines": {
      const lines = reclampLines(action.lines);
      if (lines === state.lines) {
        return state;
      }
      return { ...state, lines, updatedAt: action.at ?? state.updatedAt };
    }

    case "cart/restore": {
      // Restoring is not an edit: the state arrives already shaped like this one, from storage or
      // from a fixture, so it is adopted whole rather than run through the transitions again.
      return action.state;
    }

    default: {
      return assertNever(action, "cart action");
    }
  }
}

// Line construction ----------------------------------------------------------------------------

/**
 * The cart line a product is added as.
 *
 * The line's identifier is derived from the product's slug, so a product mints one line id and a
 * second add therefore merges into the first line rather than duplicating it. `maxQuantity` is the
 * stock on hand copied as it stands and `unitPriceMinor` the price as both stand at the moment of
 * the add: a line is priced when it is created, and a later price change reaches the cart through
 * the next add or through the fresh pricing call, never by this module rewriting a stored amount.
 *
 * `null` is the answer for a product with nothing on hand: the ceiling holds nothing purchasable, so
 * there is no line to build and the availability the product surface shows is what tells the shopper
 * the product cannot be bought.
 *
 * `at` is the instant the line joined the cart — the clock by default, and supplied by a caller that
 * needs a fixed one, which is how the cart tests assert an `updatedAt` instead of observing it.
 *
 * @returns The line, or `null` when the product's stock leaves nothing purchasable.
 */
export function createCartLine(
  product: Product,
  quantity: number = 1,
  at: IsoDateTimeString = toIsoDateTime(new Date()),
): CartLine | null {
  // A product always carries a slug; falling back to its id keeps a hand-built fixture from making
  // the identifier generator throw over a blank source it cannot read.
  const idSource = product.slug.trim() === "" ? product.id : product.slug;
  const maxQuantity = stockCeilingOf(product.stockOnHand);
  if (maxQuantity < 1) {
    return null;
  }
  return {
    id: cartLineId(idSource),
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPriceMinor: product.priceMinor,
    quantity: clampLineQuantity(quantity, maxQuantity),
    maxQuantity,
    imageUrl: product.images[0]?.url ?? "",
    addedAt: at,
  };
}

// Quantity and merging -------------------------------------------------------------------------

/**
 * `quantity` as a whole number a line may hold: between one and the line's stock ceiling, through
 * the shared `clampNumber`, or 0 when the ceiling holds nothing purchasable.
 *
 * A line's ceiling is at least one, because a line with nothing behind it never exists — a product
 * with nothing on hand builds no line, an add that could not be bought changes nothing, and a line
 * whose product has run out is dropped as it is read. 0 is therefore this module's answer for "no
 * purchasable quantity", never a quantity a line holds, and a caller that receives it drops the line.
 *
 * The floor is one rather than zero for a ceiling that has something in it, because a line at zero
 * is a removal, and removal has a transition of its own. A quantity that arrived as `NaN`, as a
 * fraction from a stepper, or past the ceiling is settled to something the cart can hold rather than
 * refused: refusing would leave the shopper looking at a quantity they did not ask for either way.
 *
 * @returns The quantity the line may hold, or 0 when the ceiling holds nothing purchasable.
 */
export function clampLineQuantity(quantity: number, maxQuantity: number): number {
  const ceiling = stockCeilingOf(maxQuantity);
  if (ceiling < 1) {
    return 0;
  }
  const whole = Number.isFinite(quantity) ? Math.trunc(quantity) : 1;
  return clampNumber(whole, 1, ceiling);
}

/**
 * The lines with `line` merged in: its product adds to the line the cart already holds, or gains a
 * line of its own when it is new to the cart.
 *
 * One product, one line is the rule, and merging on the product rather than on the line's id keeps
 * it true even for a line a caller built by hand. A merged line keeps the identity and the `addedAt`
 * it already had — the cart stays in the order the shopper built it — while its price, name, image
 * and stock ceiling follow the product as it stands now, so a repriced or short-stocked product is
 * reflected by the add that noticed it. A merge that changes nothing returns the array it was given,
 * which is how the caller tells that the line already holds all the stock there is.
 *
 * A line whose ceiling holds nothing purchasable — the product has nothing left on hand — cannot be
 * added at all, so the array comes back as it was and the cart therefore keeps its own reference.
 */
export function mergeCartLine(lines: readonly CartLine[], line: CartLine): readonly CartLine[] {
  const incoming = reclampLine(line);
  if (incoming === null) {
    return lines;
  }
  const current = findLineByProduct(lines, incoming.productId);
  if (current === undefined) {
    return [...lines, incoming];
  }
  const merged: CartLine = {
    ...incoming,
    id: current.id,
    addedAt: current.addedAt,
    quantity: clampLineQuantity(current.quantity + incoming.quantity, incoming.maxQuantity),
  };
  return isSameLine(current, merged) ? lines : replaceLine(lines, merged);
}

// Storage guards and mapping -------------------------------------------------------------------

/**
 * Whether `value` is a cart line a stored cart can be rebuilt from.
 *
 * This is the guard `src/state/CartContext.tsx` hands `readStored` in `src/utils/storage.ts`, so a
 * payload that is not a line — a quantity that came back as text, an id where a name belongs — is
 * rejected and the cart falls back to empty rather than rendering rows of `NaN`.
 *
 * It checks shape and nothing more. A line whose quantity outgrew a lower ceiling is a valid line
 * and is repaired by `reclampLine` when it is read, because discarding a shopper's cart over a stock
 * change they did not cause would be the wrong repair; a ceiling holding nothing purchasable is no
 * line at all, which is why `maxQuantity` has to be at least one here.
 */
export function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonBlankString(candidate.id) &&
    isNonBlankString(candidate.productId) &&
    isNonBlankString(candidate.sku) &&
    isNonBlankString(candidate.name) &&
    isAmount(candidate.unitPriceMinor) &&
    isWholeNumberAtLeast(candidate.quantity, 1) &&
    isWholeNumberAtLeast(candidate.maxQuantity, 1) &&
    typeof candidate.imageUrl === "string" &&
    isIsoTimestamp(candidate.addedAt)
  );
}

/**
 * Whether `value` is a cart state a stored cart can be restored from: the guard for the whole
 * persisted payload, where one unusable line rejects the state it sits in.
 */
export function isCartState(value: unknown): value is CartState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isCartLineArray(candidate.lines) &&
    (candidate.promoCode === null || typeof candidate.promoCode === "string") &&
    isIsoTimestamp(candidate.updatedAt)
  );
}

/**
 * The persistable cart for a state: the same lines, the same code and the same instant, plus the two
 * fields the reducer's state has no use for.
 *
 * `version` is `STORAGE_VERSION`, the shape version `src/utils/storage.ts` compares a stored copy
 * against, so a cart written by an older build is discarded rather than read as this one. `currency`
 * is the one currency the product prices in, taken as an argument so a caller holding a cart keeps
 * the currency that cart was built with. Nothing is computed here: a cart carries no total, and
 * `src/lib/pricingService.ts` is the only module that produces one.
 */
export function toCart(state: CartState, currency: CurrencyCode = DEFAULT_CURRENCY): Cart {
  return {
    version: STORAGE_VERSION,
    lines: state.lines,
    promoCode: state.promoCode,
    currency,
    updatedAt: state.updatedAt,
  };
}

/**
 * The state a stored cart restores to: the inverse of `toCart`, and lossless against it, so
 * `fromCart(toCart(state))` equals `state` field for field.
 *
 * The two repairs the transitions make are made again here, on the way in from a payload this build
 * did not necessarily write: every line is re-clamped to the stock ceiling it carries, a line whose
 * product has nothing left to buy is dropped, and a blank code settles back to none. `version` is
 * deliberately not read — `src/utils/storage.ts` has already discarded a payload whose version it
 * does not recognise — and neither `version` nor `currency` has a member on the state, which is why
 * `toCart` takes the currency as an argument instead.
 */
export function fromCart(cart: Cart): CartState {
  return {
    lines: reclampLines(cart.lines),
    promoCode: normalisePromoCode(cart.promoCode),
    updatedAt: cart.updatedAt,
  };
}

// Internal helpers -----------------------------------------------------------------------------

/**
 * A stock count as a line's ceiling: the whole units on hand, and 0 when there is nothing
 * purchasable to hold.
 *
 * The ceiling is the stock copied as it stands rather than floored at one, so a count of 0 says
 * there is nothing purchasable and never a phantom unit. A count that is not a finite number is
 * unusable and reads as 0 for the same reason, and a fractional count truncates, so a line never
 * holds part of a unit.
 */
function stockCeilingOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * A line with its ceiling and quantity repaired, itself when neither needed repairing, and `null`
 * when the ceiling it carries holds nothing purchasable.
 *
 * `null` is how a line that cannot be bought is dropped rather than kept at a quantity of one:
 * `reclampLines` leaves such a line out of the cart and `mergeCartLine` lets it change nothing.
 */
function reclampLine(line: CartLine): CartLine | null {
  const maxQuantity = stockCeilingOf(line.maxQuantity);
  if (maxQuantity < 1) {
    return null;
  }
  const quantity = clampLineQuantity(line.quantity, maxQuantity);
  return quantity === line.quantity && maxQuantity === line.maxQuantity
    ? line
    : { ...line, quantity, maxQuantity };
}

/**
 * Every line repaired, with the array that came in kept when no line needed repairing and none was
 * dropped; a line whose product has nothing left to buy is left out of the cart altogether.
 */
function reclampLines(lines: readonly CartLine[]): readonly CartLine[] {
  const next: CartLine[] = [];
  let keptEveryLine = true;
  for (const line of lines) {
    const repaired = reclampLine(line);
    if (repaired === null || repaired !== line) {
      keptEveryLine = false;
    }
    if (repaired !== null) {
      next.push(repaired);
    }
  }
  return keptEveryLine ? lines : next;
}

/** The code the cart holds: trimmed, and none at all when it is blank. */
function normalisePromoCode(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  const trimmed = code.trim();
  return trimmed === "" ? null : trimmed;
}

/** The line whose id is `lineId`, or `undefined` when the cart does not hold it. */
function findLineById(lines: readonly CartLine[], lineId: LineId): CartLine | undefined {
  return lines.find((line) => line.id === lineId);
}

/** The line holding `productId` — at most one, because a product occupies one line. */
function findLineByProduct(lines: readonly CartLine[], productId: ProductId): CartLine | undefined {
  return lines.find((line) => line.productId === productId);
}

/** The lines with the line of the same id replaced, in place and in order. */
function replaceLine(lines: readonly CartLine[], line: CartLine): readonly CartLine[] {
  return lines.map((candidate) => (candidate.id === line.id ? line : candidate));
}

/** Whether two lines hold the same values, so a merge that changed nothing keeps the old array. */
function isSameLine(current: CartLine, candidate: CartLine): boolean {
  return (
    current.id === candidate.id &&
    current.productId === candidate.productId &&
    current.sku === candidate.sku &&
    current.name === candidate.name &&
    current.unitPriceMinor === candidate.unitPriceMinor &&
    current.quantity === candidate.quantity &&
    current.maxQuantity === candidate.maxQuantity &&
    current.imageUrl === candidate.imageUrl &&
    current.addedAt === candidate.addedAt
  );
}

/** Whether `value` is ISO 8601 text this module can read back, as every stored instant must be. */
function isIsoTimestamp(value: unknown): value is IsoDateTimeString {
  return typeof value === "string" && isValidIso(value);
}

/** Whether `value` is a whole number of at least `minimum` — the shape a count or a ceiling has. */
function isWholeNumberAtLeast(value: unknown, minimum: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

/** Whether `value` is a whole, non-negative number of minor units. */
function isAmount(value: unknown): boolean {
  return isWholeNumberAtLeast(value, 0);
}

/** Whether `value` is a string with something in it, as every identifier and name must be. */
function isNonBlankString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Whether `value` is an array of nothing but cart lines. */
function isCartLineArray(value: unknown): value is readonly CartLine[] {
  return Array.isArray(value) && value.every((line: unknown) => isCartLine(line));
}
