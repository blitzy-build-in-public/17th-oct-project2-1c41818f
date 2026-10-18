/**
 * Path: src/features/cart/MiniCart.tsx
 * Purpose: The cart drawer opened from the header badge, with quick quantity edits and a checkout link
 * Lines: 272
 */

import type { ReactElement } from "react";

import { Link, useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/ui/Feedback";
import { Drawer } from "@/components/ui/Modal";
import { CART_COPY, cartItemCountLabel } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { CartItemRow } from "@/features/cart/CartItemRow";
import { selectIsCartEmpty, selectItemCount } from "@/features/cart/cartSelectors";
import { useCart, useCartDispatch, useMiniCartOpen } from "@/state/CartContext";

/*
 * Where this drawer is mounted, and why it is not mounted by the header.
 *
 * The drawer has to be reachable from every route, because the header's cart badge is what opens it and
 * `src/components/product/ProductCard.tsx` opens it too — a quick add on any surface the product tiles
 * appear on. Neither of the two files that would make that easy may import it: `Header.tsx` and
 * `AppLayout.tsx` sit below the feature layer and import nothing from `src/features/**`, and
 * `CartProvider` renders no markup at all, so the drawer cannot ride on either. The mount point is
 * therefore the app shell, `src/App.tsx` — the one layer above the features — which renders `MiniCart`
 * beside the toast viewport. That file lists this path among its dependencies, so the edge exists in the
 * plan rather than being an omission a later reader has to discover.
 *
 * Because the shell renders it outside the routed content, a route change does not unmount it: the
 * drawer's own actions close it (see the JSDoc below) instead of relying on navigation to do it.
 *
 * One requirement travels with that mount point: the shell that renders this drawer must itself sit
 * inside a router. The empty state's action navigates and the two destinations are links, so a mount
 * outside `src/main.tsx`'s `BrowserRouter` (or the test helper's `MemoryRouter`) throws on the first
 * render rather than failing quietly. `src/App.tsx` composes providers and the layout and owns no router,
 * which is exactly why the router belongs to the entry point above it.
 *
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only
 * importer of `src/styles/**` — so every class below is consumed by name and this list is what the sheets
 * owe the file. `src/styles/data-display.css`, reached through the `@import` at the top of
 * `src/styles/components.css`, owns the panel: `.sp-drawer`, its `--end` edge, `__header`, `__title`,
 * `__body` and `__footer`, the backdrop and the focus behaviour. None of those is named here, because
 * `src/components/ui/Modal.tsx` is the file that composes them; this file renders the drawer's content
 * and nothing of the drawer itself.
 *
 * `src/styles/commerce.css` owns that content: `.sp-minicart` is the panel's flex column, `.sp-minicart__list`
 * the scrolling region the rows fill, `.sp-minicart__footer` the actions block over its own rule, and
 * `.sp-minicart__empty` the padded box the empty state sits in. The rows themselves are
 * `src/features/cart/CartItemRow.tsx`'s family and arrive as `.sp-minicart__item` in its compact
 * presentation — this file passes the prop and names no row class of its own.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: the drawer declares no part for the item-count line, so its one sentence
 * reads in `.sp-cart-row__meta`, the muted supporting-line register the cart's own sheet declares. One
 * added class in `commerce.css` — a `.sp-minicart__count` at the same register — would give the line a
 * name of its own; the class is reported rather than invented here.
 *
 * BLITZY [LAYOUT]: the plan asks for a bottom sheet below the small stop, and the sheets declare no
 * bottom-edge drawer: `.sp-drawer` has `--start`, `--end` and `--wide` and no fourth variant. The panel is
 * therefore anchored to the inline-end edge at every width, where `min(--drawer-width, 100%)` already
 * clamps it to full bleed on a phone below `--breakpoint-sm` — which is what makes the badge reachable at
 * the narrowest width too. A bottom-edge variant would be a class this file may not invent and a
 * stylesheet it does not own; reported for the sheet rather than worked around.
 */

/**
 * Every class this file puts on the page, written once so a rename is one edit.
 *
 * The values are the sheets' own names and no name is composed here. The three action classes are the
 * button family's and are joined at the element that carries them, because a link that is painted as a
 * button wears the primitive's base class and its two modifiers together.
 */
const CLASSES = {
  root: "sp-minicart",
  list: "sp-minicart__list",
  count: "sp-cart-row__meta",
  footer: "sp-minicart__footer",
  empty: "sp-minicart__empty",
  action: "sp-btn",
  actionPrimary: "sp-btn--primary",
  actionSecondary: "sp-btn--secondary",
  actionBlock: "sp-btn--block",
} as const;

/** The two registers the drawer's actions take: the way on, and the way to look before taking it. */
type ActionVariant = "primary" | "secondary";

/** The modifier each variant carries. `secondary` is the one the cart's side actions wear by default. */
const ACTION_VARIANT_CLASSES: Readonly<Record<ActionVariant, string>> = {
  primary: CLASSES.actionPrimary,
  secondary: CLASSES.actionSecondary,
};

/**
 * One of the drawer's destinations, drawn as the shared button family.
 *
 * The product navigates with a link rather than a button — a real `Link` carries the destination, keeps a
 * link's semantics and may be opened in a new tab — and it wears the button family's classes so a
 * destination and an action look alike wherever they appear; `OrderConfirmation.tsx` and `LoginPage.tsx`
 * compose a link the same way. No `Button` is rendered for a navigation, because that primitive is a
 * `<button>` and would carry no `href`.
 *
 * Both destinations close the drawer as they are activated, through the same `onActivate` the panel's own
 * dismissal uses. The drawer is mounted outside the routed content, so nothing unmounts it when the route
 * changes and it would otherwise stay open over the page the shopper just asked for. The activation runs
 * on the way out of the click rather than after it, so the panel is already dismissed when the new route
 * renders.
 *
 * @param props.to - The destination, always read from the route constants.
 * @param props.label - The action's wording, always read from the content library.
 * @param props.variant - Which register the action takes; the onward action is `"primary"`.
 * @param props.onActivate - The drawer's dismissal, run as the link is activated.
 * @returns The styled destination.
 */
function miniCartActionLink({
  to,
  label,
  variant,
  onActivate,
}: {
  readonly to: string;
  readonly label: string;
  readonly variant: ActionVariant;
  readonly onActivate: () => void;
}): ReactElement {
  return (
    <Link
      className={`${CLASSES.action} ${ACTION_VARIANT_CLASSES[variant]} ${CLASSES.actionBlock}`}
      onClick={onActivate}
      to={to}
    >
      {label}
    </Link>
  );
}

/**
 * The mini-cart: the cart's lines in a drawer, opened from the header's badge on any route.
 *
 * It holds no state of its own. Whether it is open is the flag `src/state/CartContext.tsx` publishes through
 * `useMiniCartOpen()`, which the header's cart button flips through `toggleMiniCart` and this file only
 * reads; the lines arrive through `useCart()`, so an edit made anywhere — with the drawer open or shut — is
 * already in the array this drawer renders on its next pass, and a quantity changed in here updates the badge
 * behind it without either surface telling the other anything. A local open/closed flag would be a second
 * answer to a question the context already answers, and the badge and the panel would disagree the first time
 * one of them changed without the other.
 *
 * Where it is mounted, and what that obliges. The app shell `src/App.tsx` renders this component beside
 * the toast viewport: the drawer has to be reachable from every route, the header's badge is what opens it
 * and a quick add on a product tile opens it as well, but `Header.tsx` and `AppLayout.tsx` sit below the
 * feature layer and import nothing from `src/features/**`, and `CartProvider` renders no markup. Every
 * action in here therefore closes the drawer itself — the two destinations because a route change does not
 * unmount a panel that lives outside the routed content, and the empty state's action for the same reason.
 *
 * Which states it renders. Two: the cart's lines, and the empty state. There is no skeleton and no error
 * state here, and that is a decision rather than a gap — the data is the cart in memory, which cannot fail
 * to arrive, and the drawer issues no request. The pricing request, its loading state and its failure
 * state belong to the cart page, which owns the one money surface; a drawer that priced a basket would be
 * a second client of the pricing service on a route the shopper has not opened.
 *
 * What it does not show. No total. Every figure in this product is produced by
 * `src/lib/pricingService.ts` and displayed on one surface, and a drawer that added a subtotal to hand
 * would be the second implementation of the arithmetic that module owns — the thing the cart's rows, the
 * summary panel, the checkout and an order's own lines are all kept in agreement by. The drawer shows what
 * the shopper put in, not what it costs; the summary panel one click away prices it.
 *
 * Accessibility. The dialog contract is the shared engine's, not this file's: `Drawer` renders
 * `role="dialog"` with `aria-modal`, moves the focus into the panel on open, contains the tab order,
 * closes on Escape and on an outside pointer, and returns the focus to the control that invoked it — the
 * header's cart button, which is why the badge keeps the focus once the panel is dismissed. The panel is
 * named by the content library's own heading and its close control carries its own name. The item count is
 * an ordinary sentence and not a live region: the panel's name is what announces it, and a count that
 * re-announced itself on every quantity change would talk over the shopper instead of reporting a result.
 * Every row is `CartItemRow`, so the stepper's label, the removal's label and the availability sentence —
 * text, never colour alone — are that component's and arrive here unchanged.
 *
 * @returns The drawer, rendered only while the cart context reports it open.
 */
export function MiniCart(): ReactElement {
  const { lines } = useCart();
  const isMiniCartOpen = useMiniCartOpen();
  const cartActions = useCartDispatch();
  const navigate = useNavigate();

  /** How many units the cart holds, read off the lines rather than kept beside them. */
  const itemCount = selectItemCount(lines);
  const isEmpty = selectIsCartEmpty(lines);

  /**
   * The drawer's dismissal, wrapped around the cart's own action.
   *
   * The wrapper is not ceremony: the action is a method of the memoised action object, and handing that
   * reference to a prop or a callback would separate it from its receiver — the product's convention, and
   * the lint rule behind it, is to call it through the object it belongs to at every site.
   */
  const closeMiniCart = (): void => {
    cartActions.closeMiniCart();
  };

  /**
   * The empty state's single action: dismiss the panel first, then go to the catalogue.
   *
   * The order matters for the same reason the destinations' does — the drawer outlives the route — and the
   * destination is the catalogue rather than the search screen because the state's own wording offers the
   * shopper somewhere to start rather than a query to make.
   */
  const browseCatalogue = (): void => {
    closeMiniCart();
    // `navigate` returns a promise in this router version, and there is nothing to do with its result:
    // the location is the router's to report, and a failed navigation is not a condition this panel can
    // render anything about.
    void navigate(ROUTES.CATALOG);
  };

  return (
    <Drawer
      closeLabel={CART_COPY.MINI_CART_CLOSE_LABEL}
      isOpen={isMiniCartOpen}
      onClose={closeMiniCart}
      side="end"
      title={CART_COPY.MINI_CART_HEADING}
    >
      <div className={CLASSES.root}>
        {isEmpty ? (
          /* The empty cart: the shared empty state, its wording and its one action the content library's,
           * at a heading level below the drawer's own so the panel's outline stays in order — the title the
           * drawer renders is an `h2`. */
          <div className={CLASSES.empty}>
            <EmptyState headingLevel={3} onAction={browseCatalogue} surface="cart" />
          </div>
        ) : (
          <>
            {/* What the cart holds, in the library's own sentence: ordinary content rather than a live
             * region, as the JSDoc above records. The wording is the library's, and it takes the count as
             * a number and words it itself, so `src/utils/format.ts` is deliberately not reached from this
             * file: a bare figure drawn here would need a sentence of this file's own to explain it, and
             * copy lives in the content library rather than in a component. */}
            <p className={CLASSES.count}>{cartItemCountLabel(itemCount)}</p>
            {/* The lines as a list, keyed by the line's own id so a removal cannot make React reuse one
             * line's subtree for another: the row holds no state, but the key is what keeps the stepper's
             * focus where the shopper left it. `role="list"` is the pairing `src/styles/base.css` documents
             * as what keeps the list announced once a sheet strips the marker, which `sp-minicart__list`
             * does — the cart page's own list, the search grids and the review list wear it too. */}
            <ul className={CLASSES.list} role="list">
              {lines.map((line) => (
                <CartItemRow isCompact key={line.id} line={line} />
              ))}
            </ul>
            {/* The two ways on, neither rendered for an empty cart, whose one action is the empty state's:
             * a panel offering a checkout it cannot complete is worse than a panel offering the one thing
             * that helps. */}
            <div className={CLASSES.footer}>
              {miniCartActionLink({
                to: ROUTES.CART,
                label: CART_COPY.MINI_CART_VIEW_CART_LABEL,
                variant: "secondary",
                onActivate: closeMiniCart,
              })}
              {miniCartActionLink({
                to: ROUTES.CHECKOUT,
                label: CART_COPY.PROCEED_TO_CHECKOUT_LABEL,
                variant: "primary",
                onActivate: closeMiniCart,
              })}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
