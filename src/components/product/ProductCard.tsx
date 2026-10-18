/**
 * Path: src/components/product/ProductCard.tsx
 * Purpose: Catalogue tile with imagery, price, discount, rating and quick add to cart
 * Lines: 408
 */

import { useId } from "react";
import type { ReactElement } from "react";

import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PriceTag, Rating } from "@/components/ui/Rating";
import { DEFAULT_CURRENCY } from "@/constants/config";
import {
  CATALOG_COPY,
  EMPTY_STATES,
  addedToCartMessage,
  lowStockLabel,
  quickAddLabel,
} from "@/constants/content";
import { productPath } from "@/constants/routes";
import { BRAND_DEFINITIONS } from "@/constants/taxonomy";
import { useCartDispatch } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import type { Product, ProductStatus } from "@/types/catalog";
import { formatAvailability, formatRating } from "@/utils/format";
import { brandId } from "@/utils/strings";

/*
 * Class contract. `src/styles/catalog.css` is the sole definition site of this block — no file under
 * `src/components/**` imports a stylesheet, because `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class below is consumed by name: `sp-product-card` for the tile, which
 * composes `sp-card` and `sp-card--interactive`, the frame that sheet's own comment says the tile wears;
 * `sp-product-card__media` for the image box; `sp-product-card__flag` for the mark placed over it;
 * `sp-product-card__body` for the text column, which the sheet lays out as a column so the price block can be
 * pinned to its foot; `sp-product-card__name` for the heading, which the sheet clamps to two lanes and
 * reserves both of, rising to three from the four-column stop; `sp-product-card__brand`;
 * `sp-product-card__rating`, which the sheet holds at the start of the row it sits in;
 * `sp-product-card__price`, which carries the `sp-price` primitive and is pinned to the foot of the body so
 * one row's availability sentence sits on one baseline, its discount pill placed out of the row by the sheet;
 * `sp-product-card__stock`, the availability line the shared `PriceTag` renders when it is handed that
 * class and its own `--low` and `--out` modifiers; and `sp-product-card__actions` for the quick-add slot,
 * which the sheet keeps in the tab order at every width rather than hiding it.
 *
 * Two placements are the sheet's rather than this file's. The tile is the list item: `.sp-product-grid`,
 * `.sp-product-grid--strip > *` and `.sp-product-list > .sp-product-card` each select their own direct
 * child, so the tile renders as the `<li>` a caller places straight into the grid — a wrapper element
 * between the two would break the strip's flex sizing and the list layout's two columns. And the list
 * variant nests the action slot inside `sp-product-card__body`, because that layout is exactly two grid
 * columns, the media and the body, and a third direct child would be auto-placed into a second row under
 * the media.
 *
 * The tile holds no cart state of its own: its one cart-touching piece is the private quick-add control
 * below, which reads the cart only when its button is activated, so the tile renders identically whether
 * or not the shopper has a cart.
 */

/** The class names of this block, named once so a render body repeats no string. */
const CLASSES = {
  root: "sp-product-card",
  media: "sp-product-card__media",
  flag: "sp-product-card__flag",
  body: "sp-product-card__body",
  brand: "sp-product-card__brand",
  name: "sp-product-card__name",
  rating: "sp-product-card__rating",
  price: "sp-product-card__price",
  stock: "sp-product-card__stock",
  actions: "sp-product-card__actions",
} as const;

/**
 * Joins the class names this block composes, leaving out every absent one.
 *
 * Class composition is not a concern `src/utils` owns — `src/components/ui/Card.tsx` and
 * `src/components/product/ProductGallery.tsx` each keep their own three-line copy for the same reason —
 * so the join lives in the file that composes the classes.
 *
 * @param names - The classes in cascade order, any of which may be `false` or `undefined` to mean "omit".
 * @returns The names that were given, joined by a single space.
 */
function composeClassName(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * The one catalogue status a tile sells.
 *
 * The storefront lists `active` products and nothing else, so a draft or an archived record reaching a
 * tile is a defensive case rather than a state the catalogue produces; spelling the status once, as
 * `src/data/products.ts` spells it at the seeding end, keeps a tile from ever offering what the shopfront
 * does not sell.
 */
const SELLABLE_STATUS: ProductStatus = "active";

/**
 * The brand names, keyed by the identifier a product carries.
 *
 * Built once at module scope rather than searched per render, because a page of forty-eight tiles would
 * otherwise walk the twelve definitions forty-eight times. The pairing is the taxonomy's own — the
 * twelve brands and their names — and the key is built by `src/utils/strings.ts`, the single home of the
 * prefixed-identifier convention, exactly as `src/data/products.ts` builds it when it seeds a product's
 * `brandId`.
 */
const BRAND_NAMES: ReadonlyMap<string, string> = new Map(
  BRAND_DEFINITIONS.map((definition) => [brandId(definition.slug), definition.name] as const),
);

/**
 * The brand name a tile shows, or `null` when there is none to show.
 *
 * A caller that already holds the seeded brand record may pass its name and that wins; otherwise the name
 * comes from the taxonomy through {@link BRAND_NAMES}. An identifier nothing resolves to yields `null`
 * rather than the raw `brd_…` identifier, because an identifier is not a word a shopper should read.
 *
 * @param productBrandId - The identifier the product carries.
 * @param supplied - The name a caller supplied, if any.
 * @returns The brand's name, or `null` when neither source holds one.
 */
function brandLabelFor(productBrandId: string, supplied: string | undefined): string | null {
  const trimmed = supplied?.trim() ?? "";
  if (trimmed !== "") return trimmed;
  return BRAND_NAMES.get(productBrandId) ?? null;
}

/**
 * The alt text an image is rendered with.
 *
 * The data layer's own wording is used verbatim, and a blank one falls back to the product's name, which
 * is the same guarantee `ProductGallery` makes for the detail route's imagery: an empty `alt` would hide
 * the picture from a screen reader and from anyone whose image failed to load, and the product's own name
 * is text the data layer already carries rather than a phrase invented beside this markup.
 *
 * @param alt - The alt text the image carries.
 * @param productName - The name of the product the image belongs to.
 * @returns Alt text that holds something other than whitespace.
 */
function imageAltFor(alt: string, productName: string): string {
  return alt.trim() !== "" ? alt : productName;
}

/**
 * The two layouts one tile serves.
 *
 * `grid` is the catalogue, search and strip tile: the media, then the body, then the action row beneath it,
 * which is the three-row stack the sheet's own `.sp-product-card` declares. `list` is the same tile inside
 * the sheet's `.sp-product-list`, where a tile is two grid columns — a narrow media column and the body —
 * so the action travels with the body rather than being auto-placed into a second row under the media.
 *
 * There is no third member because there is no third layout: `.sp-product-grid--strip` and
 * `.sp-product-grid--related` are the grids' own modifiers and change nothing about the tile itself, so a
 * `compact` variant would name a difference no rule makes. A variant that hid the price, the availability
 * or the quick add would be worse than that, because every figure and the add itself are what the tile is
 * for.
 */
export type ProductCardVariant = "grid" | "list";

/** Everything {@link ProductCard} accepts. */
export interface ProductCardProps {
  /**
   * The product the tile presents. Every figure it shows — the name, the brand, the rating with its
   * review count, both prices, the discount and the availability — is derived from this product, so a
   * caller passes no price, no count and no pre-formatted string.
   */
  readonly product: Product;
  /** The placement the tile is rendered in. Defaults to `"grid"`. */
  readonly variant?: ProductCardVariant;
  /**
   * Whether the tile offers its quick add, which it does by default.
   *
   * It exists for the two callers whose context leaves no room for the action: a tile rendered inside a
   * container that is itself one link, where a nested control would be both invalid markup and an
   * ambiguous target, and a read-only row where the product's own page is the only place to act. Every
   * surface of the catalogue, the search results and the landing bands leaves it at its default, so the
   * add-to-cart-from-a-card path the shopping flow rests on is never the thing that is switched off.
   */
  readonly showQuickAdd?: boolean;
  /**
   * Whether the tile's image is fetched eagerly, for tiles the first screenful already contains.
   *
   * The default leaves the image lazy, which is what a catalogue page wants of the tiles below the fold;
   * the landing page's strip and a related-products row directly under the product being read raise it so
   * the picture they already show is not deferred behind the viewport.
   */
  readonly priority?: boolean;
  /**
   * The brand's display name, when the caller already holds the seeded brand record.
   *
   * Optional on purpose: the tile resolves the name from `product.brandId` through the taxonomy on its
   * own, so a caller passes this only to override what the taxonomy would say, never because the tile
   * needs it.
   */
  readonly brandName?: string;
  /** Extra classes for the tile, placed after the block's own so the caller's layout wins. */
  readonly className?: string;
}

/**
 * One product as a catalogue tile: its primary image, its brand, its name linking to the product's page,
 * its rating with its review count, its price with any discount, its availability in words, and a quick
 * add that puts one unit in the cart.
 *
 * The tile is presentational. It receives its product as a prop, fetches nothing, runs no effect and holds
 * no asynchronous state; the loading, empty and error states of a catalogue page belong to the page that
 * renders a row of these. Every figure it shows comes from the one home that owns it — money and ratings
 * from `src/utils/format.ts`, availability from the single rule that turns a stock pair into a level, the
 * product's route from `src/constants/routes.ts` and every word from `src/constants/content.ts` — so the
 * tile computes no total, formats no amount and spells no sentence of its own.
 *
 * Accessibility is structural rather than added: the name is a heading holding a real link whose text is
 * the product's own name, so the link's accessible name names the product without an override; the rating
 * states its value and its review count as text, so no figure is carried by the stars alone; availability
 * is words first and colour second; the quick add is a real button in the tab order at every width, which
 * is why the sheet keeps its slot rendered rather than hiding it; and when the product cannot be bought,
 * the control reports itself unavailable in the ARIA spelling and is described by the mark over the image,
 * so a keyboard user who reaches it is told why.
 *
 * @param props - The product, the placement, whether the quick add is offered, the image priority, an
 *   optional brand name override and the tile's extra classes.
 * @returns The tile, ready to sit directly inside a product grid.
 */
export function ProductCard({
  product,
  variant = "grid",
  showQuickAdd = true,
  priority = false,
  brandName,
  className,
}: ProductCardProps): ReactElement {
  // One identifier per tile, used by the flag that marks an unbuyable product and by the quick add the
  // flag describes. It is generated rather than derived from the product, so two tiles for one product —
  // a catalogue tile and a related-products tile on the same screen — cannot collide.
  const flagId = useId();
  const availability = formatAvailability(product.stockOnHand, product.lowStockThreshold);
  const canBuy = availability.available && product.status === SELLABLE_STATUS;
  const image = product.images[0];
  const rating = formatRating(product.ratingAverage, product.ratingCount);
  const brand = brandLabelFor(product.brandId, brandName);

  const actions = showQuickAdd ? (
    <QuickAddControl
      product={product}
      canBuy={canBuy}
      describedById={canBuy ? undefined : flagId}
    />
  ) : null;

  return (
    <Card as="li" isInteractive className={composeClassName(CLASSES.root, className)}>
      <div className={CLASSES.media}>
        {/* A product with no imagery keeps the media box, because the sheet sizes the tile around it and
            the grid would otherwise reflow for one record the seeds never produce. */}
        {image === undefined ? null : (
          <img
            src={image.url}
            alt={imageAltFor(image.alt, product.name)}
            width={image.width}
            height={image.height}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
          />
        )}
        {canBuy ? null : (
          <span className={CLASSES.flag} id={flagId}>
            <Badge variant="danger" size="sm">
              {CATALOG_COPY.QUICK_ADD_UNAVAILABLE_LABEL}
            </Badge>
          </span>
        )}
      </div>
      <div className={CLASSES.body}>
        {brand === null ? null : <p className={CLASSES.brand}>{brand}</p>}
        <h3 className={CLASSES.name}>
          {/* The sheet clamps the heading and this link, so a name longer than the lanes they allow can still
              hide a word below the four-column stop. The title carries the whole name for the pointer; the
              link's own text is unchanged and remains the accessible name every reader gets. */}
          <Link to={productPath(product.slug)} title={product.name}>
            {product.name}
          </Link>
        </h3>
        {/* A product nobody has reviewed shows the copy module's own words for that state instead of a
            nought rating, because an average of zero from no reviews is not a score. */}
        {rating.hasReviews ? (
          <Rating
            className={CLASSES.rating}
            value={rating.average}
            count={rating.count}
            showValue
          />
        ) : (
          <p className={CLASSES.rating}>{EMPTY_STATES.reviews.title}</p>
        )}
        <PriceTag
          className={CLASSES.price}
          priceMinor={product.priceMinor}
          listPriceMinor={product.listPriceMinor}
          currency={product.currency ?? DEFAULT_CURRENCY}
          stockOnHand={product.stockOnHand}
          lowStockThreshold={product.lowStockThreshold}
          stockClassName={CLASSES.stock}
        />
        {variant === "list" ? actions : null}
      </div>
      {variant === "grid" ? actions : null}
    </Card>
  );
}

/** Everything the tile's quick-add control is handed. */
interface QuickAddControlProps {
  /** The product one activation adds. */
  readonly product: Product;
  /** Whether the product can be bought at all, which the tile has already settled from its stock and status. */
  readonly canBuy: boolean;
  /** The identifier of the mark that explains an unbuyable product, for the control to be described by. */
  readonly describedById?: string;
}

/**
 * The tile's quick add: one button that puts a single unit of the product in the cart.
 *
 * It is a separate component for one reason. It is the only piece of the tile that has to know what the
 * cart already holds — a second activation must report the ceiling rather than pass silently — and the
 * tile itself, with its image, its two prices and its rating, has to stay independent of the cart.
 *
 * Its render output does not depend on the cart either, so it holds no subscription to it: the line it
 * compares against its ceiling is read through `useCartDispatch()`'s `readLines()` at the moment the
 * button is activated, which is the only moment the line is needed. Subscribing instead — reading the
 * cart during render, as this control first did — re-renders the action row of every tile on screen on
 * every change to the cart, so one quick add on a catalogue page costs a pass over all of them, twice
 * when the add also opens the drawer. `src/state/CartContext.tsx` splits its contexts, and offers
 * `readLines` beside them, precisely so a control that only changes the cart is re-rendered by neither.
 *
 * The add is a single call. `src/state/cartReducer.ts` merges a repeated add into the line the product
 * already holds and clamps the quantity to that line's ceiling, so the control dispatches nothing else and
 * keeps no state of its own; a product with nothing on hand builds no line at all, which is why the button
 * reports itself unavailable before it is ever pressed and states that availability when it is. Nothing is
 * derived here — the item count belongs to the header and every money total to `src/lib/pricingService.ts`.
 *
 * @param props - The product, whether it can be bought, and the mark that explains it when it cannot.
 * @returns The action slot holding the quick-add button.
 */
function QuickAddControl({ product, canBuy, describedById }: QuickAddControlProps): ReactElement {
  // The action object is held rather than its members destructured: `CartActions` declares its members in
  // method position, and a member separated from the object it belongs to is the shape the linter's
  // `unbound-method` rule exists to catch.
  const cartActions = useCartDispatch();
  const { error, success } = useToast();

  /**
   * Adds one unit, and states in a toast what happened either way.
   *
   * The ceiling comparison is made at activation, against the line's own bound — the one
   * `src/state/cartReducer.ts` clamps to — so the notice is raised for the same condition the reducer
   * would silently absorb.
   *
   * Every outcome is reported in the toast register rather than by opening the drawer: an add is one action,
   * and the drawer is a modal whose background is made inert, so opening it on the shopper's behalf would
   * cost a dismissal before the next add. The header's cart button keeps the drawer reachable from the badge
   * on every route, which is what the drawer is for.
   *
   * The refusal states the product's availability, in the words the tile's own availability line carries,
   * because the control stays in the tab order: a control a keyboard user can reach either acts or explains
   * itself.
   */
  const addToCart = (): void => {
    if (!canBuy) {
      error(CATALOG_COPY.OUT_OF_STOCK_LABEL);
      return;
    }

    const line = cartActions.readLines().find((candidate) => candidate.productId === product.id);
    if (line !== undefined && line.quantity >= line.maxQuantity) {
      error(lowStockLabel(line.maxQuantity));
      return;
    }

    cartActions.addItem(product);
    success(addedToCartMessage(product.name));
  };

  return (
    <div className={CLASSES.actions}>
      {/* Availability is reported through `aria-disabled` rather than the native attribute, because the
          native one takes the control out of the tab order and with it the description below: a keyboard
          user keeps the control and is told, on focus, why it will not act. The stylesheet dims both
          spellings, and the handler refuses the activation either way. */}
      {/* The name is composed from the product, because every tile in a grid renders this one control and a
          shared name would leave twelve successive Tab stops identical. It leads with the visible label for
          WCAG 2.5.3, and is an `aria-label` rather than extra content so the button's box is unchanged. */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        isBlock
        aria-label={quickAddLabel(product.name)}
        aria-disabled={canBuy ? undefined : "true"}
        aria-describedby={describedById}
        onClick={addToCart}
      >
        {CATALOG_COPY.QUICK_ADD_LABEL}
      </Button>
    </div>
  );
}
