/**
 * Path: src/features/cart/CartPage.tsx
 * Purpose: The cart route: line rows, the summary panel and the empty-cart state
 * Lines: 380
 */

import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";
import { FREE_SHIPPING_METHOD_ID } from "@/constants/config";
import {
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  PAGE_TITLES,
  cartItemCountLabel,
  documentTitle,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { CartItemRow } from "@/features/cart/CartItemRow";
import { CartSummary } from "@/features/cart/CartSummary";
import {
  selectIsCartEmpty,
  selectItemCount,
  selectPricedLinesById,
} from "@/features/cart/cartSelectors";
import { priceCart, promoRejectionMessage } from "@/lib/pricingService";
import { useCart, useCartDispatch } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { LineId } from "@/types/common";
import type { CartLine, PricedCart, PricedCartLine } from "@/types/commerce";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer
 * of `src/styles/**` — so every class this page renders is consumed by name, and this list is what the
 * sheets owe it.
 *
 * `src/styles/layout.css` owns the page: `sp-container` is the width and gutter every route sits in,
 * `sp-page` the column of blocks at one rhythm, `sp-page__body` the region the page's own content lands in,
 * and `sp-split` the frame whose aside track is `--layout-aside-width` from the large stop. `src/styles/
 * commerce.css` owns the cart's register: `sp-cart` widens that frame's row gap, so a summary stacked below
 * the rows is separated from them; `sp-cart__lines` is the grid frame the rows sit in, each a `sp-cart-row`
 * item of it, a family `CartItemRow.tsx` owns and this file does not restate; `sp-cart__aside` is the
 * summary column, sticky below the header from the large stop; `sp-cart__empty` tightens the shared empty
 * state to this panel; and `sp-summary__actions`, the stacked action block the summary's own file does not
 * render, is `src/styles/summary-panel.css`'s — the panel belongs to `CartSummary.tsx`, so the page's two
 * navigation controls compose that block here, each carrying `sp-btn--block`. `src/styles/
 * controls.css` owns the button family, whose classes reach both controls this page draws that are not
 * `Button`'s: a control that navigates is an anchor carrying `sp-btn` with its variant and the block
 * modifier, never a `<button>`, and the clear control is `Button` in its link variant.
 *
 * The four states this route can be in belong to the surface that can show them, and none is drawn twice.
 * The empty cart is this file's: with no lines there is no basket to price, so the page renders the empty
 * state, the request is suppressed, and the panel is not drawn at all. A price in flight is the panel's:
 * the rows render from the lines the cart already holds, so the only region genuinely waiting is the
 * figures, and `CartSummary.tsx` stands its own placeholder in them rather than this page standing a
 * page-sized skeleton over data it has. A failed price is the panel's as well — its alert states the message
 * the seam shaped and its retry is this page's `reload` — while the rows stay usable, so a cart the shopper
 * can still correct is never hidden behind an error; that same failure is the one state in which the way on
 * to checkout is refused, because a basket whose price could not be read has no total to check out with, and
 * the retry beside it can restore one here rather than send the shopper into a flow that cannot total what
 * they hold. What remains, lines beside figures, is the loaded state, the only one of the four that draws
 * every region of the route.
 *
 * Accessibility here is by construction rather than by attribute. The route's one `<h1>` is `PageHeader`'s;
 * the rows are a list of items and are marked as one; every control is a real `Button` or a real anchor
 * carrying words, so nothing depends on a glyph, a hue or a pointer; the figures are announced once, by the
 * panel's own polite live region, while the item count the header states is a plain line and deliberately
 * not a second live region — the figure a shopper waits on is the money, and that one is the panel's to
 * announce. Focus is put back on the page's body whenever an action of this page unmounts the control that
 * held it — the clear control when the cart empties, the retry when a price arrives — so neither route
 * drops a keyboard user at the top of the document.
 *
 * Three concerns are reported rather than worked around. `sp-summary__actions` declares its rule above a
 * block that follows the summary, so that hairline meets the panel's own bottom edge where the two sit
 * flush; the composition is left as the sheet's comment states it rather than given a spacing class the
 * sheet does not name for it. The line list carries `role="list"` although `sp-cart__lines` strips no
 * marker: its rows are grid items and therefore paint no marker box, which is the pairing `src/styles/
 * base.css` documents as what keeps list semantics without a visible marker. And `src/constants/content.ts`
 * holds no cart-scoped label for the clear control, so that control reads the copy library's generic
 * `Clear` — see the gap flag below.
 */

/*
 * BLITZY [DESIGN_SYSTEM_GAP]: `COMMON_ACTIONS.CLEAR` is the copy library's generic clear, because no
 * cart-scoped label for this control exists. A key naming what is cleared would let the control read the
 * way its own register would.
 */

/** The control the pricing seam names when the code this cart carries is what it refused: the field a
 *  promo rejection is filed against, as `src/lib/pricingService.ts` and the seam both spell it. */
const PROMO_CODE_FIELD = "promoCode";

/** The checkout control's classes: the button family's base name, its primary variant and the block
 *  modifier that fills the column it stands in. */
const CHECKOUT_ACTION_CLASS = "sp-btn sp-btn--primary sp-btn--block";

/** The continue-shopping control's classes, in the secondary register. */
const CONTINUE_SHOPPING_ACTION_CLASS = "sp-btn sp-btn--secondary sp-btn--block";

/**
 * Every class this page puts on the page, written once so a rename is one edit.
 *
 * The values are the sheets' own names. `frame` is the one value holding two, because the cart's frame is
 * `.sp-cart`'s and the two columns are `.sp-split`'s; both are carried by the element that opens the frame.
 */
const CLASSES = {
  container: "sp-container",
  page: "sp-page",
  pageBody: "sp-page__body",
  frame: "sp-cart sp-split",
  lines: "sp-cart__lines",
  aside: "sp-cart__aside",
  actions: "sp-summary__actions",
  empty: "sp-cart__empty",
} as const;

/**
 * The `/cart` route: the lines the shopper holds, what they come to, and the two ways on from here.
 *
 * The page reads the cart from `src/state/CartContext.tsx` and owns exactly one request: the price of the
 * basket as it stands, asked through `src/lib/pricingService.ts` whenever the lines or the code change. It
 * computes no money of its own — not a line total, not a subtotal, not a delivery charge, not how far the
 * basket is from free delivery — because each of those figures has one producer, so a figure derived here
 * would be a second answer to a question the pricing service already answers. What this page owns is the
 * composition: the heading, the rows, the summary panel, the two navigation controls and the clear control,
 * each handed the state it renders and none of them keeping a copy of it.
 *
 * An empty cart asks nothing. The pricing request is suppressed while the cart holds no lines, because
 * there is no basket to price: the empty state is rendered instead, no request is spent on it, and no
 * summary is drawn beneath it. `useAsync`'s lifecycle covers the rest without a page-sized skeleton over
 * data the cart already holds — the rows render from the lines immediately, and the region that is
 * genuinely pending is the figures, which `CartSummary.tsx` stands its own placeholder in.
 *
 * A failure is reported where the figures are, with the message the seam shaped and the retry that asks
 * again, and the rows stay usable while it stands, so the shopper can correct the cart rather than be told
 * only that something went wrong. One failure is not left standing: a pricing refusal naming the cart's own
 * promo code means the code no longer applies to this basket, so the page withdraws it and states the
 * reason, which returns the cart to a price the shopper can read. Without that, a stored code that stopped
 * applying would leave the summary failing on every retry with nothing in the panel able to withdraw it.
 *
 * The clear control is a named control in the page header's action slot rather than a glyph one beside the
 * rows: it empties everything the page lists, so it carries the word for what it does instead of a picture
 * whose meaning only the text around it could supply — `IconButton` is for a control whose label the
 * composition already gives it, which this one has not.
 *
 * @returns The cart route.
 */
export function CartPage(): ReactElement {
  const { lines, promoCode } = useCart();
  const cart = useCartDispatch();
  const toasts = useToast();

  const isEmpty = selectIsCartEmpty(lines);
  const itemCount = selectItemCount(lines);

  /*
   * The basket's price, and this page's only request. `useAsync` compares the two inputs the request reads
   * rather than the callback's identity — an inline fetcher is a new function on every render — so a cart
   * change asks once and the answer to a superseded request is discarded; `enabled` is what keeps an empty
   * cart from asking at all. The priced cart is never copied into state here: the hook holds the last
   * answer, and a second copy could outlive the price it came from.
   */
  const {
    data: pricedCart,
    status,
    error,
    reload,
  } = useAsync<PricedCart>(
    (signal) => priceCart(lines, promoCode ?? undefined, FREE_SHIPPING_METHOD_ID, { signal }),
    [lines, promoCode],
    { enabled: !isEmpty },
  );

  useDocumentTitle(documentTitle(PAGE_TITLES.CART));

  /*
   * A code this basket no longer honours is withdrawn rather than left failing. The seam files such a
   * refusal against the control it belongs to, so a failure naming `promoCode` is the cart's own code being
   * refused and not a request that failed outright; the reason is stated once on the transient-outcome
   * surface, in the pricing service's wording for the reason the failure carries and in the seam's own
   * message when the code was refused for its shape instead. Clearing it re-asks the price without a code,
   * and the guard cannot fire twice for one code, because the code it clears is the one this effect reads.
   */
  useEffect(() => {
    if (error === null || error.field !== PROMO_CODE_FIELD || promoCode === null) return;
    cart.applyPromoCode(null);
    toasts.error(promoRejectionMessage(error) ?? error.message);
  }, [cart, error, promoCode, toasts]);

  /**
   * The region the page's body lands in, so focus can be moved to it when an action of this page removes the
   * control that held it. It carries `tabindex="-1"` for that reason alone: the region is not in the tab
   * order, it is only somewhere focus may be put.
   */
  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * Whether an action of this page is waiting for the state its control's removal depends on. Set by the
   * clear control and by the retry the failure state offers, and read once by the effect below, so focus is
   * moved only after the shopper's own action and never after a cart that was already empty on arrival or a
   * first price that simply arrived.
   */
  const isFocusRestorePending = useRef(false);

  /*
   * Focus is moved to the page's body when an action of this page takes away the control that held it.
   *
   * Two controls do that. The clear control is rendered only while lines are held, so pressing it removes
   * the focused element from the document. The retry the failure state offers sits in the alert that leaves
   * with the failure, so a price that arrives unmounts it in the same way. In both cases the browser would
   * otherwise drop focus onto the document body and return a keyboard user to the top of the page with
   * nothing said, and in both the move waits for the state the action asked for — an empty cart, or a price
   * that settled — so it can never land while the control it replaces is still on screen. The flag makes it
   * a one-shot: a page that arrives empty, or that is simply rendering its first price, moves nothing, and a
   * retry that fails again reports a new alert whose control the browser keeps focused.
   */
  useEffect(() => {
    if (!isFocusRestorePending.current) return;
    if (!isEmpty && status !== "success") return;
    isFocusRestorePending.current = false;
    bodyRef.current?.focus();
  }, [isEmpty, status]);

  /**
   * The priced lines keyed by their own id, so each row reads the figures for the line it renders and
   * `undefined` while a newer price is in flight. Derived on each render from the priced cart rather than
   * kept anywhere, which is what stops a map outliving the price it was built from; the lookup is by line
   * id because the rows render the cart's own lines and never the priced array's.
   */
  const pricedLinesById = pricedCart === null ? null : selectPricedLinesById(pricedCart);

  /**
   * Empties the cart through the transition the context owns, arms the focus move and reports the outcome on
   * the transient-outcome surface. Nothing is read back afterwards: the cart's state has one owner, and the
   * empty state that follows is this page's own statement that no line is left.
   */
  const clearCart = (): void => {
    isFocusRestorePending.current = true;
    cart.clearCart();
    toasts.success(FEEDBACK_COPY.TOAST_CART_CLEARED);
  };

  /**
   * Asks for the basket's price again, for the retry the failure state offers, and arms the same focus move
   * the clear control arms: the alert that carries this control leaves with the failure it reports, so
   * without the arm a keyboard user would be dropped onto the document body the moment the figures arrive.
   */
  const retryPricing = (): void => {
    isFocusRestorePending.current = true;
    reload();
  };

  const body = isEmpty ? (
    <EmptyState actionHref={ROUTES.CATALOG} className={CLASSES.empty} surface="cart" />
  ) : (
    <div className={CLASSES.frame}>
      <CartLines lines={lines} pricedLinesById={pricedLinesById} />
      <aside className={CLASSES.aside}>
        <CartSummary error={error} onRetry={retryPricing} pricedCart={pricedCart} status={status} />
        <CartActions isCheckoutAvailable={status !== "error"} />
      </aside>
    </div>
  );

  return (
    <div className={CLASSES.container}>
      <div className={CLASSES.page}>
        <PageHeader
          actions={
            isEmpty ? undefined : (
              <Button onClick={clearCart} variant="link">
                {COMMON_ACTIONS.CLEAR}
              </Button>
            )
          }
          description={isEmpty ? undefined : cartItemCountLabel(itemCount)}
          title={CART_COPY.PAGE_HEADING}
        />
        <div className={CLASSES.pageBody} ref={bodyRef} tabIndex={-1}>
          {body}
        </div>
      </div>
    </div>
  );
}

// The page's own regions -------------------------------------------------------------------------

/** Everything {@link CartLines} renders from. */
interface CartLinesProps {
  /** The lines the cart holds, in the order the shopper built them. */
  readonly lines: readonly CartLine[];
  /** The priced lines keyed by id, or `null` before this basket has been priced. */
  readonly pricedLinesById: ReadonlyMap<LineId, PricedCartLine> | null;
}

/**
 * The cart's rows: one `CartItemRow` per line, each handed the priced figures for its own line.
 *
 * The list is a `<ul>` because it is a list of what the shopper holds, and it carries `role="list"` because
 * its rows are grid items: a grid item generates no marker box, and the pairing is what keeps the list
 * announced as a list rather than as a run of text. A row is keyed by its own line id and never by position,
 * so editing a quantity re-renders the row it belongs to and can never hand a line another line's figures.
 *
 * @param props - The cart's lines and the priced lines keyed by id.
 * @returns The list of rows.
 */
function CartLines({ lines, pricedLinesById }: CartLinesProps): ReactElement {
  return (
    <ul className={CLASSES.lines} role="list">
      {lines.map((line) => (
        <CartItemRow
          key={line.id}
          line={line}
          pricedLine={pricedLinesById === null ? undefined : pricedLinesById.get(line.id)}
        />
      ))}
    </ul>
  );
}

/** Everything {@link CartActions} renders from. */
interface CartActionsProps {
  /**
   * Whether the basket currently has a total to check out with: `false` only while the pricing request that
   * produces the total is failing. A price merely in flight leaves it `true` — the panel stands its own
   * placeholder in the figures and the shopper has been told nothing is wrong.
   */
  readonly isCheckoutAvailable: boolean;
}

/**
 * The two ways on from the cart, in the summary column beneath the panel: to checkout, or back to the
 * catalogue.
 *
 * Both controls navigate rather than act, so both are anchors carrying the button family's classes. An
 * anchor is what a destination deserves — it can be opened in a new tab, copied and followed without the
 * application having loaded — and `Button` deliberately renders no link, which is why these two are not
 * members of it. The block modifier fills the column, as the class contract above states the action block
 * asks of the markup inside it, and the primary register is spent on the one action a cart exists for.
 *
 * The checkout control is offered in every state of the page except the one the summary panel cannot price:
 * while the pricing request that produces the total is failing, there is no total to check out with, so the
 * activation is refused here rather than handed to a flow that could not complete it. Refused and not
 * withdrawn, because the route's inventory names this control as part of itself and the failure is
 * recoverable in place — the panel's alert carries the retry that restores the figures and the control with
 * them. The refusal is stated through `aria-disabled` rather than the native attribute, so the control keeps
 * its place in the tab order and the panel's own explanation stays beside it, and it is enforced by
 * preventing the default of the click: `Link` runs this handler first and navigates only when the event is
 * unprevented, and Enter on a focused anchor fires that same click, so the keyboard is refused as the pointer
 * is.
 *
 * @param props - Whether the basket has a total to check out with.
 * @returns The stacked pair of navigation controls.
 */
function CartActions({ isCheckoutAvailable }: CartActionsProps): ReactElement {
  return (
    <div className={CLASSES.actions}>
      <Link
        aria-disabled={isCheckoutAvailable ? undefined : "true"}
        className={CHECKOUT_ACTION_CLASS}
        onClick={(event) => {
          if (!isCheckoutAvailable) event.preventDefault();
        }}
        to={ROUTES.CHECKOUT}
      >
        {CART_COPY.PROCEED_TO_CHECKOUT_LABEL}
      </Link>
      <Link className={CONTINUE_SHOPPING_ACTION_CLASS} to={ROUTES.CATALOG}>
        {CART_COPY.CONTINUE_SHOPPING_LABEL}
      </Link>
    </div>
  );
}
