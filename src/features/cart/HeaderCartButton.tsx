/**
 * Path: src/features/cart/HeaderCartButton.tsx
 * Purpose: The header's cart trigger: the basket's count and the mini-cart disclosure, composed into the header by the shell
 * Lines: 100
 */

import type { ReactElement } from "react";

import { HEADER_COPY, cartButtonLabel } from "@/constants/content";
import { selectItemCount } from "@/features/cart/cartSelectors";
import { useCart, useCartDispatch, useMiniCartOpen } from "@/state/CartContext";

/*
 * Why this control lives in the cart slice and not in the header.
 *
 * It is the only piece of the header's row that displays the basket, so it is the only piece that has to read
 * the cart. The header itself may not: `src/components/layout/Header.tsx` sits below the state layer, and a
 * shared-presentation file importing `src/state` would be an import running upward, which the layer order
 * forbids. The cart is a feature slice, and a feature slice may read the state layer, so the control belongs
 * here, and `src/App.tsx` — the one layer above the features, which already composes this slice's
 * `MiniCart.tsx` drawer and the toast viewport — hands its element to `AppLayout` and so to the header. The
 * header renders what it is handed without knowing what reads it.
 *
 * That arrangement also keeps the render cost where the cart state says it belongs. Because the element the
 * shell composes is stable and this component is the one that subscribes, a change to the lines — an add, a
 * quantity edit, a removal — re-renders this button alone: the wordmark, the primary navigation, the search row
 * and the account menu beside it are not re-rendered, and neither is the routed page under the shell.
 *
 * Class contract. Both classes below are `src/styles/layout.css`'s: `.sp-cart-button` is the trigger itself, and
 * `.sp-cart-badge` is the count it carries, which the sheet renders only beside a non-empty basket. No colour,
 * length, radius or breakpoint of this file's own appears here.
 */

/**
 * The header's cart trigger: a real button that reports what the basket holds and opens the mini-cart drawer.
 *
 * The count is read during render through `selectItemCount`, the cart slice's one home for its derived values —
 * which reads the shared `sumQuantities` in `src/utils/collections.ts` for the sum itself, so the figure is
 * derived in one place rather than a second time here — and it is stored nowhere, because a count kept beside
 * the lines it counts is a second answer to one question; it reaches the button's accessible name through
 * `cartButtonLabel`, so a screen reader hears the figure without the badge, and the badge itself is
 * `aria-hidden` so the figure is not announced twice. `aria-expanded` reports the drawer's own state, read from
 * `useMiniCartOpen()` — the flag's own context, which the cart exposes separately from the lines precisely so a
 * drawer toggle re-renders the controls that display the flag and nothing else.
 *
 * @returns The cart button, with its badge whenever the basket holds anything.
 */
export function HeaderCartButton(): ReactElement {
  const { lines } = useCart();
  const isMiniCartOpen = useMiniCartOpen();
  // The action object is held rather than its members destructured: `CartActions` declares its members in
  // method position, and a member separated from the object it belongs to is the shape the linter's
  // `unbound-method` rule exists to catch.
  const cartActions = useCartDispatch();

  // The count is one fact about the lines, so it is read during render and stored nowhere, and it is read
  // through the cart slice's derived-value home rather than summed here: `selectItemCount` is where this cart
  // derives it, so the badge cannot disagree with the cart page, the mini-cart or the checkout's summary panel
  // about one basket.
  const itemCount = selectItemCount(lines);

  return (
    /*
     * Why this control is a raw button rather than one of the shared primitives. A feature file composes the
     * controls in `src/components/ui`, and this one is the exception, because `src/styles/layout.css` declares
     * the whole of its appearance in the rule it shares with the account menu's trigger beside it: the
     * trigger's box, the corner the badge is anchored in and the inline-end padding that pays for that badge
     * are all that sheet's, and it reaches the page before the primitive family does — the family's
     * `src/styles/controls.css` arrives through the `@import` in `src/styles/components.css`. Both rules are
     * one class deep, so the later one wins: a composed control would take `sp-btn`'s padding shorthand over
     * the sheet's inline-end padding, the family's label type size and a variant's colour over the sheet's own
     * type and colour, and the badge would print over the label it is paid to sit beside. The two classes stay
     * on the element itself, which keeps the sheet the single definition site of the trigger's look and this
     * file to its behaviour and its labels.
     */
    <button
      aria-expanded={isMiniCartOpen}
      aria-haspopup="dialog"
      aria-label={cartButtonLabel(itemCount)}
      className="sp-cart-button"
      onClick={() => {
        cartActions.toggleMiniCart();
      }}
      type="button"
    >
      {HEADER_COPY.NAV_CART_LABEL}
      {/* A real separator text node, not layout: the WCAG 2.5.3 audit compares the accessible name with the
          element's own text nodes concatenated, and the absolutely positioned badge would otherwise read as
          "Cart1" beside the name "Cart 1 item". A whitespace-only text run is not rendered by a flex container. */}
      {itemCount > 0 ? (
        <>
          {" "}
          <span aria-hidden="true" className="sp-cart-badge">
            {itemCount}
          </span>
        </>
      ) : null}
    </button>
  );
}
