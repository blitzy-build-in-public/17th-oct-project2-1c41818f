/**
 * Path: src/features/catalog/PurchasePanel.tsx
 * Purpose: The product detail page's buy column: brand and SKU, rating, price and availability, the quantity stepper and the two ways to order
 * Lines: 221
 */

import { useId, useState } from "react";
import type { ReactElement } from "react";

import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { PriceTag, QuantityStepper, Rating } from "@/components/ui/Rating";
import {
  CATALOG_COPY,
  EMPTY_STATES,
  addedToCartMessage,
  lowStockLabel,
  quantityLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { BRAND_DEFINITIONS } from "@/constants/taxonomy";
import { useCartDispatch } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import type { Product, ProductStatus } from "@/types/catalog";
import { formatAvailability, formatRating } from "@/utils/format";

/*
 * Why this file exists beside `ProductDetailPage.tsx`: the product detail page is one concern and it is more
 * than one file can hold under the plan's 600-line ceiling, so the ceiling splits it rather than being raised.
 * This file owns the buy column — who made the product, what it costs, how many to take and the two ways to
 * order it — and `ProductDetailPage.tsx` owns the page around it: the heading block, the gallery, the tab set
 * with its description and specification panels, the related strip and the loading, failed and not-found
 * states. The parent imports this file, so the dependency runs one way.
 */

/*
 * Class contract. `src/styles/catalog-detail.css` — the sheet `src/styles/catalog.css` loads through
 * `@import`, and the sole definition site of the buy column's own block — owes `sp-product-detail__aside` with
 * the `__meta`, `__rating`, `__price` and `__actions` parts rendered below. The availability line's
 * `sp-product-detail__stock` is declared in `catalog.css`, which keeps that state in one home for both the
 * surfaces rendering it, the tile and this column. `src/styles/base.css` owns the `sp-visually-hidden`
 * utility the stated refusal wears.
 * Every control here paints itself: `sp-btn` with the `--primary`, `--secondary` and `--block` modifiers of
 * the button primitive, `sp-rating`, `sp-price` and `sp-quantity`. The no-reviews fallback is this column's
 * own `sp-product-detail__rating` class carrying the copy module's sentence rather than the shared `sp-empty`
 * block, which stays the page's in the related strip.
 */

/** The class names this surface composes, named once so no render body repeats a string. */
const CLASSES = {
  aside: "sp-product-detail__aside",
  meta: "sp-product-detail__meta",
  rating: "sp-product-detail__rating",
  price: "sp-product-detail__price",
  stock: "sp-product-detail__stock",
  actions: "sp-product-detail__actions",
} as const;

/** The catalogue lifecycle a product must hold to be bought. The catalogue serves sellable records only, so this
 *  guard restates that requirement of the buy controls rather than filtering anything here, and `src/data/products.ts`
 *  spells the same status at the seeding end. */
const SELLABLE_STATUS: ProductStatus = "active";

/** The brand names, keyed by the slug each brand identifier carries. */
const BRAND_NAME_BY_SLUG: ReadonlyMap<string, string> = new Map(
  BRAND_DEFINITIONS.map((definition) => [definition.slug, definition.name] as const),
);

// Identity --------------------------------------------------------------------------------------

/** The slug an identifier carries after its prefix: every identifier the product uses is
 *  `<prefix><separator><slug>`, the convention `src/types/common.ts` states for all of them. */
function slugOfIdentifier(identifier: string): string {
  const separator = identifier.indexOf("_");
  return separator === -1 ? identifier : identifier.slice(separator + 1);
}

/** The brand a product carries, or `null` when the vocabulary names none: an unresolved identifier yields nothing
 *  rather than the raw `brd_…` code, which is not a word a shopper should read. */
function brandNameFor(brandIdentifier: string): string | null {
  return BRAND_NAME_BY_SLUG.get(slugOfIdentifier(brandIdentifier)) ?? null;
}

// Presentation ----------------------------------------------------------------------------------

/**
 * The buy column: who made the product, what it costs, how many to take and the two ways to order it.
 *
 * A component of its own because it is the only part of the page that has to know what the cart already holds — a
 * second activation must report the ceiling rather than pass silently — and it holds no subscription to that
 * cart: the line it checks is read through `useCartDispatch()`'s `readLines()` when a buy control is activated,
 * which is the only moment the line is needed, so a change to the cart elsewhere re-renders neither this panel
 * nor the gallery, the tabs and the reviews beside it. Reading the cart during render instead re-rendered all of
 * them on every change to it. Every figure is the shared components' own — the rating states its value and its
 * count as text, the price tag states the discount and the availability in words, the stepper confines the
 * quantity to the stock the product carries — and the only number held here is the quantity the shopper chose.
 *
 * The add is one call: the reducer merges a repeated add into the line the product already holds and clamps it to
 * that line's ceiling, so the single case reported rather than absorbed is a cart that can take no more of it. Both
 * buy controls report themselves unavailable through `aria-disabled` rather than the native attribute, for the
 * reason the card's quick add states — the native one leaves the tab order and takes the availability the visitor
 * needs to read with it — and no control is left explaining itself with nothing: the product that cannot be bought
 * is described, by both of them, with the words the catalogue tile refuses that same state in, and an activation
 * that stays refused raises the sentence again rather than passing in silence.
 *
 * @param props - The product being bought.
 * @returns The buy column.
 */
export function PurchasePanel({ product }: { readonly product: Product }): ReactElement {
  // The action object is held rather than its members destructured: `CartActions` declares its members in method
  // position, and a member separated from the object it belongs to is the shape `unbound-method` exists to catch.
  const cartActions = useCartDispatch();
  const toast = useToast();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  // The reason both buy controls are described by while the product cannot be bought: one identifier for the one
  // sentence, so the control a shopper reaches tells them why it will not act before they activate it.
  const refusalId = useId();

  const rating = formatRating(product.ratingAverage, product.ratingCount);
  const availability = formatAvailability(product.stockOnHand, product.lowStockThreshold);
  const brand = brandNameFor(product.brandId);
  const canBuy = availability.available && product.status === SELLABLE_STATUS;

  /** Adds the quantity chosen, or states why the activation was refused — the product cannot be bought, or the cart
   *  already holds all of it — and adds nothing. */
  const add = (): boolean => {
    // A product the storefront cannot sell is refused first, in the words the catalogue tile refuses the same
    // state in and this page's own stock line carries, because both buy controls stay in the tab order: a control
    // a keyboard user can reach either acts or explains itself.
    if (!canBuy) {
      toast.error(CATALOG_COPY.OUT_OF_STOCK_LABEL);
      return false;
    }
    const held = cartActions.readLines().find((line) => line.productId === product.id);
    if (held !== undefined && held.quantity >= held.maxQuantity) {
      toast.error(lowStockLabel(held.maxQuantity));
      return false;
    }
    cartActions.addItem(product, quantity);
    return true;
  };

  /** Adds the units chosen and opens the mini-cart, which is where the shopper sees the basket. */
  const addToCart = (): void => {
    if (!add()) return;
    toast.success(addedToCartMessage(product.name));
    cartActions.openMiniCart();
  };

  /** Adds the same way and goes straight to the checkout, for a shopper who has finished choosing. */
  const buyNow = (): void => {
    if (!add()) return;
    toast.success(addedToCartMessage(product.name));
    void navigate(ROUTES.CHECKOUT);
  };

  return (
    <div className={CLASSES.aside}>
      <div className={CLASSES.meta}>
        {brand === null ? null : <span>{brand}</span>}
        <span>{product.sku}</span>
      </div>
      {/* A product nobody has reviewed shows the copy module's own words for that state instead of a nought rating,
          because an average of zero from no reviews is not a score. */}
      {rating.hasReviews ? (
        <Rating className={CLASSES.rating} value={rating.average} count={rating.count} showValue />
      ) : (
        <p className={CLASSES.rating}>{EMPTY_STATES.reviews.title}</p>
      )}
      <PriceTag
        className={CLASSES.price}
        priceMinor={product.priceMinor}
        listPriceMinor={product.listPriceMinor}
        currency={product.currency}
        stockOnHand={product.stockOnHand}
        lowStockThreshold={product.lowStockThreshold}
        stockClassName={CLASSES.stock}
      />
      <div className={CLASSES.actions}>
        {/* The reason both buy controls report themselves unavailable for, stated once and described by both. It
            is the copy module's own sentence, the one the catalogue tile's quick add refuses with, and it wears
            the sheet's screen-reader-only utility: the sentence is read out and the absolutely positioned box
            takes no track from the action row, so the layout is the same whether or not it is there. */}
        {canBuy ? null : (
          <span className="sp-visually-hidden" id={refusalId}>
            {CATALOG_COPY.OUT_OF_STOCK_LABEL}
          </span>
        )}
        <QuantityStepper
          value={quantity}
          onChange={setQuantity}
          max={product.stockOnHand}
          label={quantityLabel(product.name)}
          isDisabled={!canBuy}
        />
        <Button
          type="button"
          variant="primary"
          isBlock
          aria-disabled={canBuy ? undefined : "true"}
          aria-describedby={canBuy ? undefined : refusalId}
          onClick={addToCart}
        >
          {CATALOG_COPY.ADD_TO_CART_LABEL}
        </Button>
        <Button
          type="button"
          variant="secondary"
          isBlock
          aria-disabled={canBuy ? undefined : "true"}
          aria-describedby={canBuy ? undefined : refusalId}
          onClick={buyNow}
        >
          {CATALOG_COPY.BUY_NOW_LABEL}
        </Button>
      </div>
    </div>
  );
}
