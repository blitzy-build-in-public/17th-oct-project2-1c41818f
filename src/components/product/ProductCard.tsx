/**
 * Path: src/components/product/ProductCard.tsx
 * Purpose: Catalogue tile with imagery, price, discount, rating and quick add to cart
 * Lines: 500
 */

import { memo, useId } from "react";
import type { ReactElement } from "react";

import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Feedback";
import { PriceTag, Rating } from "@/components/ui/Rating";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { CATALOG_COPY, EMPTY_STATES, quickAddLabel } from "@/constants/content";
import { productPath } from "@/constants/routes";
import { BRAND_DEFINITIONS } from "@/constants/taxonomy";

import type { Product, ProductStatus } from "@/types/catalog";
import { formatAvailability, formatRating } from "@/utils/format";
import { brandId } from "@/utils/strings";

/*
 * Class contract. `src/styles/catalog.css` is the sole definition site of this block — no file under
 * `src/components/**` imports a stylesheet — so every class below is consumed by name: `sp-product-card`
 * for the tile, which
 * composes `sp-card` and `sp-card--interactive`, the frame that sheet's own comment says the tile wears;
 * `sp-product-card__media` for the image box; `sp-product-card__flag` for the mark placed over it;
 * `sp-product-card__body` for the text column, which the sheet lays out as a column so the price block can be
 * pinned to its foot; `sp-product-card__name` for the heading, which the sheet clamps to two lanes and reserves
 * both of, rising to four from the small stop where the grid first goes multi-column; `sp-product-card__brand`;
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
 * The tile reads no cart and holds no cart state: what its quick add does is handed to it as a callback by the
 * surface composing the grid, and that callback reads the line it compares at activation, so the tile renders
 * identically whether or not the shopper has a cart and a change to it re-renders no card. One implementation
 * therefore serves the catalogue, the search results, the landing band and the related strip without any of them
 * teaching it about the cart.
 *
 * The loading tile wears the same three classes the loaded one does — `sp-product-card` with its
 * `sp-product-card--placeholder` modifier, `sp-product-card__media`, `sp-product-card__body` and
 * `sp-product-card__actions` — so the placeholder occupies the tile's own box, and each block inside it
 * wears `sp-product-placeholder__brand`, `__name`, `__rating`, `__price`, `__compare`, `__discount`,
 * `__stock` or `__action` from `src/styles/placeholders.css`, which is where the space each of them stands
 * in for is declared. The block inside the media box is the exception: it carries no class of its own, and
 * that sheet sizes it as `.sp-product-card__media > .sp-skeleton`.
 */

/** The class names of this block, named once so a render body repeats no string. */
const CLASSES = {
  root: "sp-product-card",
  placeholder: "sp-product-card--placeholder",
  media: "sp-product-card__media",
  flag: "sp-product-card__flag",
  body: "sp-product-card__body",
  brand: "sp-product-card__brand",
  name: "sp-product-card__name",
  rating: "sp-product-card__rating",
  price: "sp-product-card__price",
  pricePrimitive: "sp-price",
  stock: "sp-product-card__stock",
  actions: "sp-product-card__actions",
  placeholderBrand: "sp-product-placeholder__brand",
  placeholderName: "sp-product-placeholder__name",
  placeholderRating: "sp-product-placeholder__rating",
  placeholderPrice: "sp-product-placeholder__price",
  placeholderCompare: "sp-product-placeholder__compare",
  placeholderDiscount: "sp-product-placeholder__discount",
  placeholderStock: "sp-product-placeholder__stock",
  placeholderAction: "sp-product-placeholder__action",
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
  /**
   * Adds one unit of the product to the cart, which is the whole of what the tile's quick add does.
   *
   * It is the surface composing the tile that owns this, and the reason is the layer order: a tile is shared
   * presentation and the cart lives in the state layer above it, so a tile reading the cart would be an import
   * running upward. The surface reads the cart for it — through `useQuickAdd` in `src/state/CartContext.tsx`,
   * the single home of the rule, so a line already at its ceiling raises the same notice on every surface — and
   * hands the returned callback down here. The tile calls it only for a product it has already found buyable.
   */
  readonly onAddToCart: (product: Product) => void;
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
 * Its render entry point is {@link ProductCard}, the `memo` wrapper below: this function is not exported,
 * because every surface should reach the tile through the wrapper that keeps a page re-render out of the grid.
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
 * @param props - The product, the add the composing surface owns, the placement, whether the quick add is
 *   offered, the image priority, an optional brand name override and the tile's extra classes.
 * @returns The tile, ready to sit directly inside a product grid.
 */
function ProductCardTile({
  product,
  onAddToCart,
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
      onAddToCart={onAddToCart}
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
          {/* The sheet clamps the heading and this link to the lanes the card's column allows, so a name longer
              than those lanes can still hide a word below the stop where the card widens. The title carries the
              whole name for the pointer; the link's text is unchanged and stays the accessible name readers get. */}
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

/**
 * {@link ProductCardTile} wrapped in `memo`: the tile every surface of the product renders.
 *
 * The wrapper is what keeps a page re-render out of the grid. The catalogue's filter drawer is that route's
 * own state, so opening or closing it re-renders the page and, without this, every tile the page holds — up
 * to a full page of forty-eight. A tile's props are the product object, identical between two renders of the
 * same page; the callback its composing surface hands in, which is the memoised function `useQuickAdd`
 * returns; and small flags and a class name. The comparison is therefore cheap and the subtrees behind it are
 * skipped rather than re-rendered.
 *
 * Nothing a tile shows changes without one of those props changing: the cart is read inside the callback at
 * activation rather than subscribed to during render, so a change to the cart re-renders no tile, and a
 * context update re-renders its consumer whatever a `memo` around an ancestor decides.
 *
 * @param props - The product, the add the composing surface owns, the placement, whether the quick add is
 *   offered, the image priority, an optional brand name override and the tile's extra classes.
 * @returns The tile, ready to sit directly inside a product grid.
 */
export const ProductCard = memo(ProductCardTile);

// `memo` reports the wrapped function's name to the profiling tools, so the tile's known name is written back.
ProductCard.displayName = "ProductCard";

/** Everything the tile's quick-add control is handed. */
interface QuickAddControlProps {
  /** The product one activation adds. */
  readonly product: Product;
  /** Whether the product can be bought at all, which the tile has already settled from its stock and status. */
  readonly canBuy: boolean;
  /** The identifier of the mark that explains an unbuyable product, for the control to be described by. */
  readonly describedById?: string;
  /** The composing surface's add, passed on unchanged once the product is known to be buyable. */
  readonly onAddToCart: (product: Product) => void;
}

/**
 * The tile's quick add: one button that puts a single unit of the product in the cart.
 *
 * The button itself, which owns no cart: the add it raises is the `onAddToCart` callback the surface composing
 * the tile handed in, so this control imports nothing from the state layer and the ceiling, the merge into an
 * existing line and the notice the add raises all belong to that callback and the reducer behind it.
 *
 * The rule the callback holds keeps the property this control first had: the line the cart holds is read at
 * activation, through `readLines()`, which `src/state/CartContext.tsx` offers beside its contexts precisely so a
 * control that only changes the cart subscribes to neither — so a cart change re-renders no tile's action row,
 * and one quick add on a catalogue page costs no pass over the cards. `useQuickAdd` in that module is the
 * callback's single home, shared by every surface that renders tiles.
 *
 * A product with nothing on hand is refused by the callback, which states the tile's own availability words:
 * the control reports itself `aria-disabled` rather than disabled, so a keyboard user keeps it and the
 * activation explains why it will not act. Nothing is derived here — the item count belongs to the shell that
 * composes the header, and every money total to `src/lib/pricingService.ts`.
 *
 * @param props - The product, whether it can be bought, the mark that explains it when it cannot, and the
 *   add the composing surface owns.
 * @returns The action slot holding the quick-add button.
 */
function QuickAddControl({
  product,
  canBuy,
  describedById,
  onAddToCart,
}: QuickAddControlProps): ReactElement {
  /** Raises the add the composing surface owns, which decides what a product it cannot sell is told. */
  const addToCart = (): void => {
    onAddToCart(product);
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

/**
 * Everything {@link ProductCardPlaceholder} accepts.
 *
 * It takes the placement and nothing else, because a placeholder carries no figures: every block inside it
 * stands in for a part of the tile at that part's own size, and which of those parts exist is the one thing
 * the two placements differ in.
 */
export interface ProductCardPlaceholderProps {
  /** The placement the tile it stands in for is laid out in. Defaults to `"grid"`. */
  readonly variant?: ProductCardVariant;
}

/**
 * One tile's worth of placeholder: the space a product tile occupies while the page of results is on its way.
 *
 * It is the tile's own shape rather than a bar of a convenient size. It wears `sp-product-card` and the same
 * three regions the loaded tile wears, so the grid reserves exactly what the loaded tile takes: the media box
 * is the tile's own 4:3 one, the body stacks the four parts the loaded body stacks — the brand line, the two
 * clamped lines of the name, the rating row and the wrapping price line with its four parts — and the action
 * bar is the slot the quick add occupies. `src/styles/catalog.css` declares the size each of those blocks
 * stands in for, from the token the part it replaces renders at; each block therefore takes the variant whose
 * own modifier carries no size of its own — the line shape for a line and the card shape for a box — so that
 * the sheet is the only place the geometry is decided.
 *
 * It is decorative: the whole list item is hidden from assistive technology, and each block inside it is too,
 * because the region the placeholders sit in is what states the wait with `aria-busy`. It holds no state,
 * fetches nothing and reveals none of the parts the loaded tile withholds from a pointer until hover.
 *
 * @param props - The placement; see {@link ProductCardPlaceholderProps}.
 * @returns The decorative loading tile, ready to sit directly inside a product grid.
 */
export function ProductCardPlaceholder({
  variant = "grid",
}: ProductCardPlaceholderProps): ReactElement {
  const actions = (
    <div className={CLASSES.actions}>
      <Skeleton variant="card" className={CLASSES.placeholderAction} />
    </div>
  );

  return (
    <Card
      as="li"
      className={composeClassName(CLASSES.root, CLASSES.placeholder)}
      aria-hidden="true"
    >
      <div className={CLASSES.media}>
        <Skeleton variant="card" />
      </div>
      <div className={CLASSES.body}>
        <Skeleton variant="text" className={CLASSES.placeholderBrand} />
        <Skeleton variant="text" className={CLASSES.placeholderName} />
        <Skeleton variant="text" className={CLASSES.placeholderRating} />
        {/* The price line wears the primitive's own class through the same join `PriceTag` composes it with,
            so the four blocks wrap into the rows the four parts of a real price line wrap into at that width. */}
        <div className={composeClassName(CLASSES.pricePrimitive, CLASSES.price)}>
          <Skeleton variant="text" className={CLASSES.placeholderPrice} />
          <Skeleton variant="text" className={CLASSES.placeholderCompare} />
          <Skeleton variant="card" className={CLASSES.placeholderDiscount} />
          <Skeleton variant="text" className={CLASSES.placeholderStock} />
        </div>
        {variant === "list" ? actions : null}
      </div>
      {variant === "grid" ? actions : null}
    </Card>
  );
}
