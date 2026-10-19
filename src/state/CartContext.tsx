/**
 * Path: src/state/CartContext.tsx
 * Purpose: Cart lines, promo code, persistence, mini-cart visibility and the clear the checkout dispatches
 * Lines: 503
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
import { CATALOG_COPY, addedToCartMessage, lowStockLabel } from "@/constants/content";
import {
  cartActions,
  cartReducer,
  createCartLine,
  createInitialCartState,
  isCartState,
  toCart,
} from "@/state/cartReducer";
import type { CartState } from "@/state/cartReducer";
import { useToast } from "@/state/ToastContext";
import type { Product, ProductStatus } from "@/types/catalog";
import type { Cart, CartLine } from "@/types/commerce";
import type { IsoDateTimeString, LineId } from "@/types/common";
import { formatAvailability } from "@/utils/format";
import { readStored, writeStored } from "@/utils/storage";

/**
 * The one catalogue status a tile sells, spelled the way `src/data/products.ts` spells it at the seeding end
 * and as the tile and the product page spell it on their own surfaces: the three sites decide availability from
 * the same pair of fields, so the rule is read from the status and the stock rather than restated as a second
 * rule with a vocabulary of its own.
 */
const SELLABLE_STATUS: ProductStatus = "active";

// Consumer surface -----------------------------------------------------------------------------

/**
 * What a consumer reads from the cart.
 *
 * This is the cart's state as the rest of the product sees it: the lines the shopper built, the
 * promo code they applied, and when the cart last changed. Nothing here is derived — not the item
 * count, not a line total, not a free-shipping shortfall — because a count or an amount kept beside
 * the lines it describes is a second answer to a question the lines already answer, and the two
 * drift apart. `src/features/cart/cartSelectors.ts` computes what the cart surfaces display and
 * `src/lib/pricingService.ts` produces every money total, both from these lines.
 *
 * Whether the mini-cart drawer is open is deliberately not a member: it travels in a context of its
 * own, read through `useMiniCartOpen()`, so a toggle of it cannot re-render a consumer of the lines.
 */
export interface CartView {
  /** The lines the shopper built, in the order they were added to, and never two for one product. */
  readonly lines: readonly CartLine[];
  /** The code the shopper applied, as typed and trimmed, or `null` when they applied none. */
  readonly promoCode: string | null;
  /** When the lines or the promo code last changed; unchanged by opening the mini-cart. */
  readonly updatedAt: IsoDateTimeString;
}

/**
 * Every change the cart accepts, one member each, stable across renders, together with the one read
 * that lets a control see the lines without subscribing to them.
 *
 * A consumer receives this object in place of a reducer's `dispatch`, so the transitions the cart
 * supports are named rather than spelled out at each call site. Each member is a wrapped transition
 * from `src/state/cartReducer.ts` and holds no rule of its own: the reducer clamps a quantity to its
 * line's stock ceiling, merges a repeated add into the line its product already holds, drops the
 * promo code with the lines when the cart is cleared, and re-clamps restored lines. A caller can
 * therefore call `addItem` unconditionally and let the cart decide what that means.
 *
 * Every member is a `useCallback` over the stable `dispatch` — or, for {@link CartActions.readLines},
 * over a ref — and the object holding them is memoised, so a component that receives one as a prop or
 * a dependency is not re-rendered merely because the cart's provider rendered.
 */
export interface CartActions {
  /**
   * Reads the lines as they stand, without subscribing the caller to them.
   *
   * For a control whose activation needs the cart's current contents but whose rendering does not
   * depend on the cart: the ceiling check a product card's quick add makes before it adds, and the
   * same check on the product detail page. The value is read at the moment the control is activated,
   * where reading the cart through `useCart()` would re-render that control — and with it the whole
   * action row of every tile on screen — on every change to the cart.
   *
   * @returns The lines as they stand, in the order the shopper added them.
   */
  readLines(): readonly CartLine[];
  /**
   * Adds a product to the cart, one unit unless a quantity is given.
   *
   * The line is built by `createCartLine`, which prices it at the product's current price and copies
   * the stock on hand as its ceiling; a product the cart already holds is merged into its existing
   * line rather than added beside it, so this is safe to call on every click. A product with nothing
   * on hand builds no line at all, so the add leaves the cart untouched and the availability the
   * product surface shows is what tells the shopper there is nothing to buy.
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
 * memoised over stable callbacks, and is therefore not re-rendered when the lines change. It is also
 * where a control reads the lines when only its activation needs them, through `readLines()`, without
 * subscribing to them. One context carrying both would re-render every such control on every quantity
 * keystroke.
 */
const CartDispatchContext = createContext<CartActions | null>(null);

/**
 * Whether the mini-cart drawer is open, private to this module: consumers reach it through
 * `useMiniCartOpen()`.
 *
 * The flag travels in a context of its own rather than beside the lines, because the two change for
 * unrelated reasons and a context hands a new value to every one of its consumers whenever its own
 * value changes. Toggling the drawer would otherwise re-render all of the cart's readers — the cart
 * page, the summary, the add controls on a page of tiles — none of which displays the flag, while a
 * change to the lines would re-render the two controls that do. The `null` default is the "no
 * provider above this consumer" sentinel the other two contexts use, turned into an error by the hook
 * rather than acting as a closed drawer that would hide a wiring mistake.
 */
const MiniCartContext = createContext<boolean | null>(null);

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
 * survives a reload and whether the mini-cart drawer is open, and the two travel in different places
 * on purpose: the state reaches its readers through `CartStateContext` and the drawer flag through
 * `MiniCartContext`, rendered outermost, so opening or closing the drawer re-renders the controls
 * that display the flag and nothing that reads the lines.
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
 * @returns The three providers — the drawer flag outermost, the lines within it, the actions
 *   innermost — wrapping the subtree.
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

  /**
   * The lines as the actions see them, kept in a ref so a reader of them can be stable.
   *
   * This is what lets `readLines` hand back the lines without subscribing its caller to them, which a
   * `useCallback` that closed over the state could not do: such a callback would change identity on
   * every change to the cart, and a changed identity re-renders every consumer of the actions — the
   * re-render the split contexts exist to avoid. Kept current by an effect rather than during render,
   * so no render writes it, the rule `react-hooks/refs` enforces and the one
   * `src/state/AuthContext.tsx` follows for its own state ref.
   */
  const linesRef = useRef<readonly CartLine[]>(state.lines);
  useEffect(() => {
    linesRef.current = state.lines;
  }, [state.lines]);

  const addItem = useCallback(
    (product: Product, quantity: number = 1): void => {
      const line = createCartLine(product, quantity);
      // A product with nothing on hand builds no line, so the add changes nothing: the availability
      // the product surface already shows is what tells the shopper there is nothing to buy.
      if (line !== null) {
        dispatch(cartActions.add(line));
      }
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

  const readLines = useCallback((): readonly CartLine[] => linesRef.current, []);

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
      readLines,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      applyPromoCode,
      openMiniCart,
      closeMiniCart,
      toggleMiniCart,
    }),
    [
      readLines,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      applyPromoCode,
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
    }),
    [state.lines, state.promoCode, state.updatedAt],
  );

  return (
    <MiniCartContext value={isMiniCartOpen}>
      <CartStateContext value={value}>
        <CartDispatchContext value={actions}>{children}</CartDispatchContext>
      </CartStateContext>
    </MiniCartContext>
  );
}

// Consumer hooks -------------------------------------------------------------------------------

/**
 * Reads the cart: its lines, the promo code applied and when it last changed.
 *
 * Returns the provider's memoised value, so every consumer receives the same object while nothing
 * about the cart changed and an unrelated parent render does not re-render a consumer. The drawer flag
 * is not part of it — `useMiniCartOpen()` reads that on its own — so opening or closing the drawer
 * hands no consumer of this hook a new value, and a cart change reaches exactly the components that
 * display the cart.
 *
 * A control that needs the lines only when it is activated rather than on every render — the ceiling
 * check behind an add button — reads them through `useCartDispatch()`'s `readLines()` instead, so it
 * is not re-rendered by a change to the cart at all.
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
 * Reads whether the mini-cart drawer is open.
 *
 * The flag is not a member of `useCart()` because the two change for unrelated reasons and a consumer
 * of one must not be re-rendered by the other: the lines are displayed by every cart surface, while
 * the flag is displayed by the header's cart trigger and the drawer itself, which are the two
 * components this hook re-renders when the shopper opens or closes the drawer.
 *
 * @returns Whether the mini-cart drawer is open.
 * @throws When called above every `CartProvider` — an application wiring mistake, not a state a
 *   visitor can reach — naming the missing provider.
 */
export function useMiniCartOpen(): boolean {
  const isOpen = useContext(MiniCartContext);
  if (isOpen === null) {
    throw new Error("useMiniCartOpen must be called from a component within a CartProvider.");
  }
  return isOpen;
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

/**
 * The add a product tile performs: one unit of a product, with the notice a line at its ceiling raises.
 *
 * It exists as a hook of its own so that this rule has one home. A tile is shared presentation and the cart
 * lives in a layer above it, so no tile may read the cart; the surface that composes the tiles reads it here
 * and hands the returned callback down as `onAddToCart`, which is how the catalogue, the search results, the
 * landing band and the related-products strip all add through the same rule rather than each keeping a copy
 * of it. The surfaces that call this are `src/features/home/FeaturedProducts.tsx`,
 * `src/features/catalog/ProductList.tsx`, `src/features/search/SearchPage.tsx` and the related strip in
 * `src/features/catalog/ProductDetailPage.tsx`; the product page's own purchase panel is not one of them,
 * because it adds a chosen quantity and reports the success beside it.
 *
 * The add itself is the cart's own single call: `addItem` merges a repeat into the line the product already
 * holds and clamps it to that line's ceiling, so nothing else is dispatched here. The one condition kept
 * beside it is the ceiling, which is why the line the cart holds for the product is compared against the
 * bound the reducer clamps to: a line already at its `maxQuantity` would otherwise absorb the add silently,
 * where the shopper is owed the same notice the availability line shows — the words come from
 * `lowStockLabel` in `src/constants/content.ts`, the copy module, so none is invented here. Every other
 * outcome is stated in the toast register instead — `addedToCartMessage` names the product that was added —
 * rather than by opening the drawer: an add is one action, and the drawer is a modal whose background is made
 * inert, so opening it on the shopper's behalf would cost a dismissal before the next add. The header's cart
 * trigger keeps the drawer reachable from the badge on every route, which is what the drawer is for.
 *
 * The returned callback is a `useCallback` over the values it reads, so it changes only when the cart or the
 * notice it raises does.
 *
 * @returns The callback a composing surface hands to each tile as `onAddToCart`.
 * @throws When called above every `CartProvider` — the tiles' surface is always composed inside one — naming
 *   the missing provider.
 */
export function useQuickAdd(): (product: Product) => void {
  // The action object is held rather than its members destructured: `CartActions` declares its members in
  // method position, and a member separated from the object it belongs to is the shape the linter's
  // `unbound-method` rule exists to catch.
  const cart = useCartDispatch();
  const { error, success } = useToast();

  return useCallback(
    (product: Product): void => {
      // The line is read at activation rather than subscribed to during render, through the cart's own
      // `readLines()`: nothing this callback returns depends on the lines, so a caller that only adds must not
      // be re-rendered by a change to them — one quick add on a catalogue page would otherwise cost a pass over
      // every tile's action row. `src/state/CartContext.tsx` offers that read for exactly this case.
      // A product the tile cannot sell is refused first, in the words the tile's own availability line
      // carries, because the control stays in the tab order and reports itself `aria-disabled` rather than
      // disabled: a control a keyboard user can reach either acts or explains itself.
      const availability = formatAvailability(product.stockOnHand, product.lowStockThreshold);
      if (!availability.available || product.status !== SELLABLE_STATUS) {
        error(CATALOG_COPY.OUT_OF_STOCK_LABEL);
        return;
      }

      const line = cart.readLines().find((candidate) => candidate.productId === product.id);
      if (line !== undefined && line.quantity >= line.maxQuantity) {
        error(lowStockLabel(line.maxQuantity));
        return;
      }

      cart.addItem(product);
      // The outcome is stated rather than shown: the tile's add opens no drawer, and this is the one place
      // that decides so for every surface that renders tiles.
      success(addedToCartMessage(product.name));
    },
    [cart, error, success],
  );
}
