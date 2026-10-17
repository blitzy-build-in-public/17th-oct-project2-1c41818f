/**
 * Path: src/features/cart/CartItemRow.tsx
 * Purpose: A single cart line with thumbnail, quantity stepper, removal and an availability warning
 * Lines: 317
 */

import type { ReactElement } from "react";

import { IconButton } from "@/components/ui/Button";
import { PriceTag, QuantityStepper } from "@/components/ui/Rating";
import {
  CART_COPY,
  FEEDBACK_COPY,
  lowStockLabel,
  quantityLabel,
  removeLineLabel,
} from "@/constants/content";
import { selectAvailability, selectLineDiscountMinor } from "@/features/cart/cartSelectors";
import type { LineAvailability } from "@/features/cart/cartSelectors";
import { useCartDispatch } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import type { CartLine, PricedCartLine } from "@/types/commerce";
import { formatMoney } from "@/utils/format";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer
 * of `src/styles/**` — so every class below is consumed by name and this list is what the sheets owe the file.
 *
 * `src/styles/commerce.css` owns the row: `sp-cart-row` is a named-area grid of exactly seven children —
 * `media body remove / media qty total / media price price / warn warn warn`, widened at the medium stop to
 * `media body qty total remove / . price price price price / . warn warn warn warn` — and the parts are
 * `__media` for the square thumbnail, `__body` for the name column, `__name` for the name register, `__sku`
 * for the mono caption, `__meta` for a muted supporting line, `__qty` for the stepper, `__price` for the unit
 * price, `__line-total` for the end-aligned line figure, `__remove` for the ghost removal control and
 * `__warning` for the availability sentence. Those seven are the only classes carrying a `grid-area`, so an
 * eighth direct child of the row would be auto-placed into a cell no area names and would break the layout:
 * the per-line discount therefore sits inside `__body`, which the sheet lays out as its own grid.
 *
 * The drawer's compact form is a second family in the same sheet rather than a modifier of the row:
 * `sp-minicart__item` is a wrapping flex line whose children the sheet selects by element and utility —
 * `> img` at the space-10 square, `> :not(img):not(.sp-quantity):not(.sp-btn)` at the flexible text track —
 * so the compact presentation reuses `__body`, `__name`, `__sku`, `__meta` and `__warning` inside the drawer's
 * item and invents no name of its own. The availability sentence is the item's last flex child in that form,
 * because a line of that width cannot hold the thumbnail, the name, the stepper and the sentence without
 * squeezing one of them: the sheet's own wrapping gives the sentence a line of its own there. A `grid-area` has
 * no effect on a flex item, which is what makes the row's own `__warning` class safe to carry into a container
 * that declares no area for it. The warn row the full form's template declares is a row of that template, so a
 * line with nothing to warn about leaves it empty and still pays its row gap; reported here because the template
 * is that sheet's to change.
 *
 * The unit price is drawn by `PriceTag`, whose `sp-price__current` register is the heading-3 one, and the sheet
 * declares no `sp-cart-row__price .sp-price__current` override, so the figure is painted at that register inside
 * a part the sheet calls muted body-sm. Reported rather than restated: the register is not this file's to change.
 *
 * The name is text and not a link, a boundary of this file rather than an omission: `CartLine` carries no slug and
 * this file's dependency list admits no route constants, so there is nothing to navigate to. `__name`'s own
 * `:hover` register consequently paints a word that is not interactive; reported for the sheet, not worked around
 * by inventing a class or a path here.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` holds no cart-scoped sentence naming what is left of
 * a line's product — the cart's own `QUANTITY_CLAMPED_NOTICE` says a quantity *was reduced*, which is not what
 * a line merely sitting at its ceiling says — so the limited status reads the catalogue's `lowStockLabel`, the
 * one existing sentence that names the remaining count. One added key in that module is all this row needs to
 * speak the cart's own register.
 *
 * BLITZY [A11Y]: a line whose product nothing can be bought of renders the stepper the availability rule calls
 * for, and that stepper's described-by sentence is derived from its ceiling, which floors at one — so such a
 * line announces "Only one is in stock" beside a warning that says the product is out of stock. The state is
 * transitional: `src/state/cartReducer.ts` drops a line with nothing on hand as the cart rereads itself, and
 * `selectAvailability` documents that as the answer for a line handed here before that repair.
 */

/** The glyph the removal control draws: U+2715, sized and coloured by the row's own class. */
const REMOVE_GLYPH = "✕";

/** The sign a per-line discount is stated with. Notation rather than wording, so it is not the copy library's,
 *  and it is markup rather than a character inside a sentence. */
const DISCOUNT_SIGN = "−";

/**
 * Every class this row puts on the page, written once so a rename is one edit.
 *
 * The values are the sheets' own names and no name is composed here. The two row classes are chosen at the
 * element that carries them rather than joined into one attribute value, because a line is one row or the
 * other and never both: the full form carries the cart's classes, the compact form the drawer item's, and the
 * parts shared by both carry the cart row's own part name in each.
 */
const CLASSES = {
  row: "sp-cart-row",
  compactRow: "sp-minicart__item",
  media: "sp-cart-row__media",
  body: "sp-cart-row__body",
  name: "sp-cart-row__name",
  sku: "sp-cart-row__sku",
  meta: "sp-cart-row__meta",
  quantity: "sp-cart-row__qty",
  price: "sp-cart-row__price",
  lineTotal: "sp-cart-row__line-total",
  remove: "sp-cart-row__remove",
  warning: "sp-cart-row__warning",
} as const;

/**
 * Everything {@link CartItemRow} accepts.
 *
 * The row is rendered from the line it is given and from nothing else it holds: it reads no cart state, keeps
 * no copy of the quantity and stores nothing, so the two surfaces that render it — the cart page's list and
 * the drawer's — cannot disagree about a line they both show.
 */
export interface CartItemRowProps {
  /**
   * The line to render, as `src/state/CartContext.tsx` holds it.
   *
   * Every figure the row shows comes from this shape or from `pricedLine`: the name, the sku, the unit price
   * and the image are the copies the line took when it was created, `quantity` is what the shopper holds, and
   * `maxQuantity` is the stock ceiling `src/state/cartReducer.ts` clamps every change against.
   */
  readonly line: CartLine;
  /**
   * The line as `src/lib/pricingService.ts` priced it, present once pricing has resolved the basket.
   *
   * It is absent while a price is still in flight or after a pricing failure, and the row then states what the
   * line itself carries and nothing more: no line total is drawn, because a total is the pricing service's
   * figure and a row that multiplied a unit price by a quantity would be the second implementation of the
   * arithmetic the product keeps in that one module.
   */
  readonly pricedLine?: PricedCartLine;
  /**
   * Renders the drawer's denser presentation of the same line.
   *
   * One implementation serves both surfaces — the cart page's row and the mini-cart's item — so a change to how
   * a line is edited or removed reaches both, and `MiniCart.tsx` composes this component rather than forking a
   * second row of its own.
   */
  readonly isCompact?: boolean;
}

/**
 * The sentence a line's availability reads in, or `null` for a line that can still be bought freely.
 *
 * The switch is exhaustive over `LineAvailabilityStatus`, so a fourth status fails the build here rather than
 * rendering a line with nothing said about it.
 *
 * - `"in-stock"` — nothing to warn about: the line can still grow, so no element is rendered and no empty
 *   sentence reaches the row.
 * - `"limited"` — the line already holds everything the product has left, so the shopper is told what that is.
 *   The words are the catalogue's own stock label; the class contract above records why this file reads that
 *   key rather than a cart-scoped one.
 * - `"unavailable"` — nothing of the line's product can be bought, so the sentence says so and names the way
 *   out, which is the action the row beside it keeps available.
 *
 * The sentence is text, never colour alone, and it carries no live-region role: it is a standing property of
 * the line rather than the outcome of the shopper's last action, so announcing it on every render of a cart
 * that holds such a line would be noise. The row's own class paints it in the danger register; the words carry
 * the state.
 *
 * @param availability - The line's availability, as `selectAvailability` reads it from the line.
 * @returns The warning element, or `null` when there is nothing to warn about.
 */
function availabilityWarning(availability: LineAvailability): ReactElement | null {
  switch (availability.status) {
    case "in-stock":
      return null;
    case "limited":
      return <span className={CLASSES.warning}>{lowStockLabel(availability.maxQuantity)}</span>;
    case "unavailable":
      return <span className={CLASSES.warning}>{CART_COPY.AVAILABILITY_WARNING}</span>;
  }
}

/**
 * One cart line: a thumbnail, what the line is, how many of it the shopper holds, what it costs, the way to
 * change or drop it, and whatever its availability has to say.
 *
 * The row renders from its props and dispatches through the cart's own actions, holding no cart state of its
 * own, so it cannot become a second answer to what the cart contains. Both edits it offers go to
 * `src/state/CartContext.tsx` — a quantity through `updateQuantity(line.id, next)` and a removal through
 * `removeItem(line.id)` — and neither is followed by a local correction: `src/state/cartReducer.ts` clamps a
 * quantity to its line's ceiling and drops the line a removal names, so the cart decides what an edit means and
 * this file only reports the shopper's intent.
 *
 * The quantity control is bounded twice over, deliberately rather than redundantly: `QuantityStepper` receives
 * the ceiling `selectAvailability` read off the line, so its controls and its field refuse to leave the range
 * the shopper can see, while the reducer clamps the same figure again so a stale ceiling — the stock the product
 * carried when the line was built — cannot let an unpurchasable quantity into the cart. A clamp written here
 * would be the third implementation of a rule that already has one home.
 *
 * Money is read, never computed. The unit price is the line's own `unitPriceMinor` through `PriceTag`, the
 * per-line discount is `selectLineDiscountMinor` of the priced line, and the line total is that priced line's
 * `lineTotalMinor`; all three reach the screen through `src/utils/format.ts`, which owns the single rounding rule
 * for minor units. Nothing here adds, multiplies or rounds, so the row cannot disagree with the summary panel
 * beside it about what a line costs.
 *
 * Every word is copy from `src/constants/content.ts` and every class is a name one of the two sheets declares.
 * The thumbnail is decorative — the line's name is rendered beside it as text, so alternative text of its own
 * would be the same item named twice — and it states neither `width` nor `height`: the seed draws it as an
 * inline SVG data URI whose intrinsic size this file does not know, and the sheet fixes both of its dimensions,
 * so the box cannot shift as the picture paints.
 *
 * @param props - The line to render, its priced counterpart once pricing has resolved, and whether the drawer's
 *   denser presentation is wanted.
 * @returns The row, as a list item of the list that contains it: the cart list or the drawer's.
 */
export function CartItemRow({
  line,
  pricedLine,
  isCompact = false,
}: CartItemRowProps): ReactElement {
  const cart = useCartDispatch();
  const toast = useToast();

  const availability = selectAvailability(line);
  const isUnavailable = availability.status === "unavailable";
  const discountMinor = pricedLine === undefined ? 0 : selectLineDiscountMinor(pricedLine);

  /** What the line is: its name, which is also the word its controls are named by, and its sku. */
  const identity = (
    <>
      <span className={CLASSES.name}>{line.name}</span>
      <span className={CLASSES.sku}>{line.sku}</span>
    </>
  );

  /** The price of one unit, in the register `src/components/ui/Rating.tsx` draws for this primitive. */
  const price = <PriceTag priceMinor={line.unitPriceMinor} />;

  /**
   * What the basket's discounts took off this line, when they took anything off it.
   *
   * The figure is the amount the pricing service deducted from the line, and the row states it only when there is
   * one, because a nil discount would say a saving had been made where none was. Each presentation places the
   * sentence in its own register: the full form on a supporting line of the body — the only place it can go,
   * because the row's grid declares an area for each of its seven children and none for an eighth — and the
   * compact form inside the one line the drawer's item already carries for the line's figures.
   */
  const discountText =
    discountMinor > 0
      ? `${CART_COPY.SUMMARY_DISCOUNT_LABEL} ${DISCOUNT_SIGN}${formatMoney(discountMinor)}`
      : null;

  const warning = availabilityWarning(availability);

  /**
   * How many of the line the shopper holds, bounded by the line's own ceiling and disabled outright while nothing
   * of the product can be bought. The label names the product, so assistive technology announces which line the
   * field belongs to rather than a bare figure.
   */
  const stepper = (
    <QuantityStepper
      className={isCompact ? undefined : CLASSES.quantity}
      value={line.quantity}
      max={availability.maxQuantity}
      label={quantityLabel(line.name)}
      isDisabled={isUnavailable}
      onChange={(next: number) => {
        cart.updateQuantity(line.id, next);
      }}
    />
  );

  /**
   * The way out of the line: a ghost control whose accessible name is the action together with the product, and
   * whose press drops the line and then reports the outcome on the product's transient-outcome surface.
   */
  const removeControl = (
    <IconButton
      className={isCompact ? undefined : CLASSES.remove}
      variant="ghost"
      icon={REMOVE_GLYPH}
      label={removeLineLabel(line.name)}
      onClick={() => {
        cart.removeItem(line.id);
        toast.success(FEEDBACK_COPY.TOAST_REMOVED_FROM_CART);
      }}
    />
  );

  /* The drawer's presentation: the same parts in the item's own flex line — the sentence last, where the
   * sheet's wrapping gives it a line of its own rather than the narrow column the name shares. */
  if (isCompact) {
    return (
      <li className={CLASSES.compactRow}>
        <img src={line.imageUrl} alt="" />
        <div className={CLASSES.body}>
          {identity}
          <span className={CLASSES.meta}>
            {price}
            {discountText}
          </span>
        </div>
        {stepper}
        {removeControl}
        {warning}
      </li>
    );
  }

  /* The cart page's presentation: the seven parts the row's named-area grid places, each carrying the class
   * whose area it fills, in reading order — what it is, how many, what one costs, what they come to, how to be
   * rid of it, and what availability has to say. */
  return (
    <li className={CLASSES.row}>
      <img className={CLASSES.media} src={line.imageUrl} alt="" />
      <div className={CLASSES.body}>
        {identity}
        {discountText === null ? null : <span className={CLASSES.meta}>{discountText}</span>}
      </div>
      {stepper}
      <span className={CLASSES.price}>{price}</span>
      {pricedLine === undefined ? null : (
        <span className={CLASSES.lineTotal}>{formatMoney(pricedLine.lineTotalMinor)}</span>
      )}
      {removeControl}
      {warning}
    </li>
  );
}
