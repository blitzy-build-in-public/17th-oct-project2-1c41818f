/**
 * Path: src/state/CartContext.tsx
 * Purpose: Cart lines, promo code, persistence, mini-cart visibility and the clear the checkout dispatches
 * Lines: 373
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";

import { STORAGE_KEYS } from "@/constants/config";
import {
  cartActions,
  cartReducer,
  createCartLine,
  createInitialCartState,
  fromCart,
  isCartState,
  toCart,
} from "@/state/cartReducer";
import type { CartState } from "@/state/cartReducer";
import type { Product } from "@/types/catalog";
import type { Cart, CartLine } from "@/types/commerce";
import type { IsoDateTimeString, LineId } from "@/types/common";
import { readStored, writeStored } from "@/utils/storage";

// Consumer surface -----------------------------------------------------------------------------

/**
 * What a consumer reads from the cart.
 *
 * This is the cart's state as the rest of the product sees it: the lines the shopper built, the
 * promo code they applied, when the cart last changed, and whether the mini-cart drawer is open.
 * Nothing here is derived — not the item count, not a line total, not a free-shipping shortfall —
 * because a count or an amount kept beside the lines it describes is a second answer to a question
 * the lines already answer, and the two drift apart. `src/features/cart/cartSelectors.ts` computes
 * what the cart surfaces display and `src/lib/pricingService.ts` produces every money total, both
 * from these lines.
 */
export interface CartView {
  /** The lines the shopper built, in the order they were added to, and never two for one product. */
  readonly lines: readonly CartLine[];
  /** The code the shopper applied, as typed and trimmed, or `null` when they applied none. */
  readonly promoCode: string | null;
  /** When the lines or the promo code last changed; unchanged by opening the mini-cart. */
  readonly updatedAt: IsoDateTimeString;
  /** Whether the mini-cart drawer is open. Deliberately not persisted, so a reload starts closed. */
  readonly isMiniCartOpen: boolean;
}

/**
 * Every change the cart accepts, one member each, stable across renders.
 *
 * A consumer receives this object in place of a reducer's `dispatch`, so the transitions the cart
 * supports are named rather than spelled out at each call site. Each member is a wrapped transition
 * from `src/state/cartReducer.ts` and holds no rule of its own: the reducer clamps a quantity to its
 * line's stock ceiling, merges a repeated add into the line its product already holds, drops the
 * promo code with the lines when the cart is cleared, and re-clamps restored lines. A caller can
 * therefore call `addItem` unconditionally and let the cart decide what that means.
 *
 * Every member is a `useCallback` over the stable `dispatch`, and the object holding them is
 * memoised, so a component that receives one as a prop or a dependency is not re-rendered merely
 * because the cart's provider rendered.
 */
export interface CartActions {
  /**
   * Adds a product to the cart, one unit unless a quantity is given.
   *
   * The line is built by `createCartLine`, which prices it at the product's current price and copies
   * the stock on hand as its ceiling; a product the cart already holds is merged into its existing
   * line rather than added beside it, so this is safe to call on every click.
   */
  addItem(product: Product, quantity?: number): void;
  /** Sets one line's quantity. The transition clamps it between one and that line's stock ceiling. */
  updateQuantity(lineId: LineId, quantity: number): void;
  /** Drops one line, leaving the others in the order the shopper built them. */
  removeItem(lineId: LineId): void;
  /**
   * Empties the cart — lines and promo code together.
   *
   * This is the only clearing path in the product. The checkout dispatches it once an order has been
   * placed instead of touching lines itself, which is what keeps the cart's state owned here.
   */
  clearCart(): void;
  /** Stores the code the shopper applied, or `null` once they withdraw it. */
  applyPromoCode(code: string | null): void;
  /**
   * Adopts lines built elsewhere, re-clamped by the reducer.
   *
   * The cart slice calls this after a catalogue refresh to bring each line's stock ceiling up to
   * date; a line whose product can no longer supply the quantity it holds is clamped down and the
   * cart renders its availability warning.
   */
  replaceLines(lines: CartLine[]): void;
  /**
   * Adopts a whole cart — the shape a stored one is read back as — through the reducer's restore
   * transition, which re-clamps every line against the ceiling it carries.
   */
  restoreCart(cart: Cart): void;
  /** Opens the mini-cart drawer. */
  openMiniCart(): void;
  /** Closes the mini-cart drawer. */
  closeMiniCart(): void;
  /** Flips the mini-cart drawer between open and closed. */
  toggleMiniCart(): void;
}

// Contexts -------------------------------------------------------------------------------------

/**
 * The cart's state, private to this module: consumers reach it through `useCart()`.
 *
 * The `null` default is the "no provider above this consumer" sentinel the hook turns into an error
 * naming what is missing, rather than a silent empty cart that would hide a wiring mistake.
 */
const CartStateContext = createContext<CartView | null>(null);

/**
 * The cart's actions, private to this module: consumers reach them through `useCartDispatch()`.
 *
 * State and actions travel in two contexts on purpose. A component that only ever changes the cart —
 * the add button on a product card, the remove control on a line — reads this one, whose value is
 * memoised over stable callbacks, and is therefore not re-rendered when the lines change. One
 * context carrying both would re-render every such control on every quantity keystroke.
 */
const CartDispatchContext = createContext<CartActions | null>(null);

// Hydration ------------------------------------------------------------------------------------

/**
 * The cart a fresh mount starts from: the stored cart re-clamped by the reducer's own constructor,
 * or an empty cart when nothing usable is stored.
 *
 * The stored payload is read as the state's own three fields, because those are the fields this
 * layer owns: the envelope's version is `src/utils/storage.ts`'s business and is compared there
 * before the value is handed over — a payload written by an older `STORAGE_VERSION` comes back as
 * the fallback rather than being migrated — and the cart's `currency` is supplied again by `toCart`
 * on the way out. Reading it through `isCartState` is what makes an unusable payload degrade to an
 * empty cart instead of rendering rows of `NaN`.
 *
 * A stored cart was written when the stock on hand was something else, so the state is built by
 * `createInitialCartState`, which re-clamps every line against the ceiling the line carries and
 * settles a blank promo code back to none. A payload that survives the guard therefore still cannot
 * hand the cart an unpurchasable quantity.
 *
 * @returns The hydrated cart state, empty when nothing usable is stored.
 */
function hydrateCartState(): CartState {
  const stored = readStored<CartState | null>(STORAGE_KEYS.CART, null, isCartState);
  return createInitialCartState(stored ?? {});
}

/**
 * Whether two carts hold the same lines, promo code and instant, each compared by identity.
 *
 * Identity is the right comparison because `src/state/cartReducer.ts` returns the state it was given
 * for a transition that changed nothing and keeps a line array that did not change, so an equal
 * cart here is the same cart and not merely an equal one.
 */
function isSameCartContent(current: Cart, candidate: Cart): boolean {
  return (
    current.lines === candidate.lines &&
    current.promoCode === candidate.promoCode &&
    current.updatedAt === candidate.updatedAt
  );
}

// Provider -------------------------------------------------------------------------------------

/**
 * Holds the cart and provides it, with its actions, to everything below.
 *
 * The cart's state lives in the reducer and nowhere else: no component writes a line, and no other
 * provider keeps a copy of the lines. What this provider owns besides the state is the way the cart
 * survives a reload and whether the mini-cart drawer is open.
 *
 * Hydration happens once, in the reducer's lazy initialiser, so the stored cart is read before the
 * first render rather than arriving in an effect a frame later: the header's cart badge and the
 * mini-cart render the restored lines immediately, and no screen has to distinguish "no cart yet"
 * from "no cart".
 *
 * Persistence is a single effect over the state. It writes the versioned `Cart` that `toCart` builds
 * through `writeStored`, which is the product's only writer of the stored cart, and it deliberately
 * does not depend on `isMiniCartOpen`: whether a drawer is open is a view concern, and persisting it
 * would reopen a drawer the shopper had closed by leaving the page. The first pass writes nothing —
 * see the ref below — so mounting cannot replace a stored cart with the empty one this provider fell
 * back to.
 *
 * @param props.children - The subtree that may read the cart and dispatch its actions.
 * @returns The two providers, state outermost, wrapping the subtree.
 */
export function CartProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(cartReducer, undefined, hydrateCartState);
  const [isMiniCartOpen, setIsMiniCartOpen] = useState(false);

  /**
   * The cart as it was last handed to storage, or `null` until the first persist pass has run.
   *
   * It is what makes the mount pass a no-op. That pass always finds exactly what hydration read, and
   * writing it back would be at best redundant and at worst destructive: a payload the read rejected
   * — content another build wrote, content that could not be decoded — would be replaced by the empty
   * cart hydration fell back to, and the shopper's cart would be gone for good. Recording the value
   * without writing it leaves a cart this build cannot read on disk, untouched, for the build that
   * can.
   */
  const persistedRef = useRef<Cart | null>(null);

  useEffect(() => {
    const cart = toCart(state);
    const lastPersisted = persistedRef.current;
    persistedRef.current = cart;
    if (lastPersisted === null || isSameCartContent(lastPersisted, cart)) {
      return;
    }
    // A refused write is not reported to the shopper: the cart in memory is already the product's
    // source of truth and every screen renders from it, so a store that will not take the payload
    // costs the shopper the cart on their next reload and nothing before it.
    writeStored(STORAGE_KEYS.CART, cart);
  }, [state]);

  const addItem = useCallback(
    (product: Product, quantity: number = 1): void => {
      dispatch(cartActions.add(createCartLine(product, quantity)));
    },
    [dispatch],
  );

  const updateQuantity = useCallback(
    (lineId: LineId, quantity: number): void => {
      dispatch(cartActions.updateQuantity(lineId, quantity));
    },
    [dispatch],
  );

  const removeItem = useCallback(
    (lineId: LineId): void => {
      dispatch(cartActions.remove(lineId));
    },
    [dispatch],
  );

  const clearCart = useCallback((): void => {
    dispatch(cartActions.clear());
  }, [dispatch]);

  const applyPromoCode = useCallback(
    (code: string | null): void => {
      dispatch(cartActions.applyPromo(code));
    },
    [dispatch],
  );

  const replaceLines = useCallback(
    (lines: CartLine[]): void => {
      dispatch(cartActions.replaceLines(lines));
    },
    [dispatch],
  );

  const restoreCart = useCallback(
    (cart: Cart): void => {
      dispatch(cartActions.restore(fromCart(cart)));
    },
    [dispatch],
  );

  const openMiniCart = useCallback((): void => {
    setIsMiniCartOpen(true);
  }, []);

  const closeMiniCart = useCallback((): void => {
    setIsMiniCartOpen(false);
  }, []);

  const toggleMiniCart = useCallback((): void => {
    // A functional update rather than a read of the current value, so two toggles raised within one
    // tick cannot both act on the state they were rendered with.
    setIsMiniCartOpen((open) => !open);
  }, []);

  const actions = useMemo<CartActions>(
    () => ({
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      applyPromoCode,
      replaceLines,
      restoreCart,
      openMiniCart,
      closeMiniCart,
      toggleMiniCart,
    }),
    [
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      applyPromoCode,
      replaceLines,
      restoreCart,
      openMiniCart,
      closeMiniCart,
      toggleMiniCart,
    ],
  );

  const value = useMemo<CartView>(
    () => ({
      lines: state.lines,
      promoCode: state.promoCode,
      updatedAt: state.updatedAt,
      isMiniCartOpen,
    }),
    [state.lines, state.promoCode, state.updatedAt, isMiniCartOpen],
  );

  return (
    <CartStateContext value={value}>
      <CartDispatchContext value={actions}>{children}</CartDispatchContext>
    </CartStateContext>
  );
}

// Consumer hooks -------------------------------------------------------------------------------

/**
 * Reads the cart: its lines, the promo code applied, when it last changed and whether the mini-cart
 * is open.
 *
 * Returns the provider's memoised value, so two components calling this hook while the cart is
 * unchanged receive the same object, and a consumer of the returned `lines` is not re-rendered by
 * the drawer opening or closing.
 *
 * @returns The cart state as `CartView`.
 * @throws When called above every `CartProvider` — an application wiring mistake, not a state a
 *   visitor can reach — naming the missing provider.
 */
export function useCart(): CartView {
  const value = useContext(CartStateContext);
  if (value === null) {
    throw new Error("useCart must be called from a component within a CartProvider.");
  }
  return value;
}

/**
 * Reads the cart's actions.
 *
 * Returns the provider's memoised action object, whose members are stable for the life of the
 * provider, so a component can list one in a dependency array or pass it to a memoised child without
 * re-rendering it on every cart change. Nothing returned here reads the cart's state, which is what
 * lets a control that only ever adds or removes render independently of the lines.
 *
 * @returns The cart's actions as `CartActions`.
 * @throws When called above every `CartProvider`, naming the missing provider.
 */
export function useCartDispatch(): CartActions {
  const actions = useContext(CartDispatchContext);
  if (actions === null) {
    throw new Error("useCartDispatch must be called from a component within a CartProvider.");
  }
  return actions;
}

