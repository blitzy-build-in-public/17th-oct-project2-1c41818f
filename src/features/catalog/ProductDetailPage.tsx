/**
 * Path: src/features/catalog/ProductDetailPage.tsx
 * Purpose: Product route composing the gallery, details, tabs, reviews and related-products strip
 * Lines: 584
 */

import { useId, useState } from "react";
import type { ReactElement } from "react";

import { Link, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import type { BreadcrumbItem } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductGallery } from "@/components/product/ProductGallery";
import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { PriceTag, QuantityStepper, Rating } from "@/components/ui/Rating";
import { Tabs } from "@/components/ui/Tabs";
import type { TabItem } from "@/components/ui/Tabs";
import { PAGE_SIZE_OPTIONS, RELATED_PRODUCTS_LIMIT } from "@/constants/config";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  NOT_FOUND_COPY,
  PAGE_TITLES,
  addedToCartMessage,
  documentTitle,
  lowStockLabel,
  quantityLabel,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, categoryPath } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";
import { BRAND_DEFINITIONS } from "@/constants/taxonomy";
import { ProductReviews } from "@/features/catalog/ProductReviews";
import { API_ERROR_CODES, API_PATHS, getJson } from "@/lib/apiClient";
import { getProduct, getRelated } from "@/lib/catalogService";
import { useCart, useCartDispatch } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { Category, Product, ProductSpec, ProductStatus } from "@/types/catalog";
import type { ApiError, PageResult, ProductId, Result } from "@/types/common";
import { indexBy } from "@/utils/collections";
import { formatAvailability, formatRating } from "@/utils/format";

/*
 * Class contract: no stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so every
 * class below is consumed by name. `src/styles/catalog-detail.css`, loaded by `src/styles/catalog.css` with
 * `@import`, is the sole definition site of this surface: `sp-product-detail` with its `__main`, `__aside`,
 * `__meta`, `__rating`, `__price`, `__stock`, `__actions` and `__sections` parts, the `sp-specs` definition list
 * with its `__row`, `__term` and `__value`, the `sp-features` list with its `__item` marker, and the `sp-related`
 * section; `sp-related__header`, `sp-product-grid--related` and `sp-gallery__stage` belong to the landing, catalogue
 * and gallery sheets, and the loading placeholder borrows the last so the artwork's box is held open. `sp-btn` with
 * `--primary`, `--secondary` and `--link`, `sp-tabs`, `sp-alert`, `sp-empty`, `sp-skeleton` and `sp-stack` are the
 * shared primitives'. `sp-product-detail__title` is deliberately unused: the page's single `<h1>` is the shared page
 * header's, which is why the product's name is passed to it.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` declares no key for the tab set's accessible name — it is
 * named with that module's own words for this page, `PAGE_TITLES.PRODUCT` — and no label for the SKU, which is
 * announced as the code it is and named under `Item code` in the specifications list. Both are recorded rather than
 * filled with an invented sentence.
 */

/** The class names this surface composes, named once so no render body repeats a string. */
const CLASSES = {
  root: "sp-product-detail",
  main: "sp-product-detail__main",
  aside: "sp-product-detail__aside",
  meta: "sp-product-detail__meta",
  rating: "sp-product-detail__rating",
  price: "sp-product-detail__price",
  stock: "sp-product-detail__stock",
  actions: "sp-product-detail__actions",
  sections: "sp-product-detail__sections",
  galleryStage: "sp-gallery__stage",
  specs: "sp-specs",
  specsRow: "sp-specs__row",
  specsTerm: "sp-specs__term",
  specsValue: "sp-specs__value",
  features: "sp-features",
  featuresItem: "sp-features__item",
  related: "sp-related",
  relatedHeader: "sp-related__header",
  relatedGrid: "sp-product-grid sp-product-grid--related",
  linkAction: "sp-btn sp-btn--link",
  pageBody: "sp-page__body sp-stack",
  stack: "sp-stack",
} as const;

/** The catalogue lifecycle a product must hold to be bought. The detail endpoint answers a product whatever its
 *  status, so the sellable one is stated where the buy controls are guarded, as `src/data/products.ts` spells it at
 *  the seeding end. */
const SELLABLE_STATUS: ProductStatus = "active";

/** The identifiers of the three tabs, named once so no render body repeats a string. */
const TAB_IDS = {
  DESCRIPTION: "description",
  SPECIFICATIONS: "specifications",
  REVIEWS: "reviews",
} as const;

/** The page size the slug lookup reads the listing at: the product's own largest configured size, because the
 *  lookup's only requirement of the payload is that the ranked matches fit inside one page. */
const LOOKUP_PAGE_SIZE = PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1];

/** The placeholder cards a loading strip stands in with, one per related product the endpoint answers with at most;
 *  each carries its own identity rather than a position, so no key is an index. */
const RELATED_PLACEHOLDER_KEYS = ["first", "second", "third", "fourth"] as const;

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

/** The identifier the detail endpoint's path takes, from the segment the route carries. The route is declared
 *  `/product/:slug` and the endpoint's parameter is `:id`, so the two are one position in a request without this
 *  file deciding whether the value names a product: that answer is the seam's, and an identifier it holds nothing
 *  for is the `404` the not-found state renders. The cast is the visible signal that the value did not come from the
 *  generator `src/utils/strings.ts` owns, the one module this file may not call. */
function asProductIdentifier(segment: string): ProductId {
  return segment as ProductId;
}

/** Whether a failure is the detail endpoint reporting that it holds no product under the identifier asked for. */
function isMissingProduct(error: ApiError): boolean {
  return error.code === API_ERROR_CODES.PRODUCT_NOT_FOUND;
}

/** The product one slug names, read from the catalogue listing by the slug itself. Exact by construction: the
 *  listing's term is the slug the route carries, the endpoint ranks the product whose name the slug was built from
 *  above every partial match, and the row whose `slug` equals the segment is the product asked for. `null` reports a
 *  listing that answered without holding it, which leaves the detail endpoint's own refusal standing.
 *
 *  The request goes through `src/lib/apiClient.ts` with the two parameters the lookup needs, so the endpoint's own
 *  normalisation of a partial query supplies the rest. `catalogService.listProducts` is not used because it takes a
 *  complete `FilterState`, whose defaults `src/utils/queryParams.ts` owns and this file may not import. */
async function findProductBySlug(
  slug: string,
  signal: AbortSignal,
): Promise<Result<Product | null>> {
  const listing = await getJson<PageResult<Product>>(API_PATHS.PRODUCTS, {
    query: { q: slug, pageSize: LOOKUP_PAGE_SIZE },
    signal,
  });
  if (!listing.ok) return listing;
  return { ok: true, value: listing.value.items.find((one) => one.slug === slug) ?? null };
}

/**
 * Resolves the product the route names, so the rest of the page works from the product and its own identifier.
 *
 * The route carries the readable slug and the endpoint takes the prefixed identifier, and neither can be derived
 * from the other on the client: an identifier's suffix is cut and disambiguated with a hash once a name passes the
 * readable maximum, so `prod_` plus a slug is the wrong identifier for a long name and nothing recovers the right
 * one here. The endpoint is therefore asked first with the value the route carries, because it is the authority on
 * whether a product exists; the one `404` a mismatch between the two spellings produces is then resolved once
 * through the listing, which holds every product under the slug it was seeded with. The lookup happens once per
 * route and nowhere else in this file, so no second resolution rule exists.
 *
 * @param slug - The slug the route carries.
 * @param signal - The abort signal of a read a newer one supersedes.
 * @returns The product, or the shaped failure to render; never a rejection.
 */
async function resolveProduct(slug: string, signal: AbortSignal): Promise<Result<Product>> {
  const read = await getProduct(asProductIdentifier(slug), { signal });
  if (read.ok || !isMissingProduct(read.error)) return read;

  const found = await findProductBySlug(slug, signal);
  if (!found.ok) return found;
  return found.value === null ? read : { ok: true, value: found.value };
}

/** The route a category crumb navigates to. `src/constants/routes.ts` builds the path and `BreadcrumbItem` types
 *  its target as `RoutePath`, the union of the application's declared patterns; a filled pattern is one of the
 *  routes the application serves, so the two agree about where the crumb leads. */
function categoryCrumbTarget(slug: string): RoutePath {
  return categoryPath(slug) as RoutePath;
}

/** The trail above one product: home, its category and its parent when it has one, then the product itself. Every
 *  label is a name the data carries, so no crumb is a prettified slug and none is a string written here. A category
 *  the read did not answer with leaves the trail at home and the product rather than inventing a crumb: the trail is
 *  the only thing this page's category read feeds, so a failure there shortens it and never replaces the product the
 *  shopper asked for. */
function categoryTrailFor(
  product: Product,
  categories: readonly Category[],
): readonly BreadcrumbItem[] {
  const byId = indexBy(categories, (category) => category.id);
  const category = byId.get(product.categoryId);
  const trail: BreadcrumbItem[] = [{ label: PAGE_TITLES.HOME, to: ROUTES.HOME }];

  if (category !== undefined) {
    const parent = category.parentId === null ? undefined : byId.get(category.parentId);
    if (parent !== undefined) {
      trail.push({ label: parent.name, to: categoryCrumbTarget(parent.slug) });
    }
    trail.push({ label: category.name, to: categoryCrumbTarget(category.slug) });
  }

  trail.push({ label: product.name });
  return trail;
}

/** The document title this route reports: the product once it is known, the refusal when there is none, and the
 *  route's own name while the read is in flight. */
function pageTitleFor(product: Product | null, isMissing: boolean): string {
  if (product !== null) return product.name;
  return isMissing ? PAGE_TITLES.NOT_FOUND : PAGE_TITLES.PRODUCT;
}

// Presentation ----------------------------------------------------------------------------------

/** The loading state: a gallery-shaped box beside the buy column's own placeholders, in the loaded layout's
 *  containers so the page does not reflow when the product arrives. The region carries `aria-busy` while the read is
 *  in flight, and every shape is decorative on its own. */
function DetailPlaceholders(): ReactElement {
  return (
    <div className={CLASSES.root} aria-busy="true">
      <div className={CLASSES.main}>
        <div className={CLASSES.galleryStage}>
          <Skeleton variant="block" width="100%" height="100%" />
        </div>
      </div>
      <div className={CLASSES.aside}>
        <Skeleton variant="heading" />
        <Skeleton variant="text" lines={3} />
        <Skeleton variant="block" height="var(--space-20)" />
      </div>
    </div>
  );
}

/** One product's specification rows as a definition list of term and value pairs: a `<dl>` rather than a table,
 *  because the rows pair labels with their values, and the sheet groups each pair in a `<div>` so a narrow screen
 *  stacks and a wide one places them side by side. A product with no rows states the copy module's own words for
 *  that state. */
function SpecificationList({ specs }: { readonly specs: readonly ProductSpec[] }): ReactElement {
  if (specs.length === 0) {
    return <p>{CATALOG_COPY.SPECIFICATIONS_EMPTY}</p>;
  }

  return (
    <dl className={CLASSES.specs}>
      {specs.map((spec) => (
        <div className={CLASSES.specsRow} key={spec.label}>
          <dt className={CLASSES.specsTerm}>{spec.label}</dt>
          <dd className={CLASSES.specsValue}>{spec.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The description tab: the product's long description, then its features under the copy module's own heading. The
 *  features are a real list, so a reader hears how many there are and can walk them one at a time; a product with
 *  none renders the description alone rather than a heading with nothing beneath it. */
function DescriptionPanel({ product }: { readonly product: Product }): ReactElement {
  return (
    <div className={CLASSES.stack}>
      <p>{product.description}</p>
      {product.features.length === 0 ? null : (
        <>
          <h2>{CATALOG_COPY.FEATURES_HEADING}</h2>
          <ul className={CLASSES.features} role="list">
            {product.features.map((feature) => (
              <li className={CLASSES.featuresItem} key={feature}>
                {feature}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The buy column: who made the product, what it costs, how many to take and the two ways to order it.
 *
 * A component of its own for the reason `src/components/product/ProductCard.tsx` gives for its quick add: it is the
 * only part of the page that has to know what the cart already holds, and reading the cart re-renders its reader on
 * every change to it, so keeping that read here leaves the gallery, the tabs and the reviews independent of the
 * cart. Every figure is the shared components' own — the rating states its value and its count as text, the price
 * tag states the discount and the availability in words, the stepper confines the quantity to the stock the product
 * carries — and the only number held here is the quantity the shopper chose.
 *
 * The add is one call: the reducer merges a repeated add into the line the product already holds and clamps it to
 * that line's ceiling, so the single case reported rather than absorbed is a cart that can take no more of it. Both
 * buy controls report themselves unavailable through `aria-disabled` rather than the native attribute, for the
 * reason the card's quick add states — the native one leaves the tab order and takes the availability the visitor
 * needs to read with it — and the handler refuses the activation either way.
 *
 * @param props - The product being bought.
 * @returns The buy column.
 */
function PurchasePanel({ product }: { readonly product: Product }): ReactElement {
  const { lines } = useCart();
  // The action object is held rather than its members destructured: `CartActions` declares its members in method
  // position, and a member separated from the object it belongs to is the shape `unbound-method` exists to catch.
  const cartActions = useCartDispatch();
  const toast = useToast();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);

  const rating = formatRating(product.ratingAverage, product.ratingCount);
  const availability = formatAvailability(product.stockOnHand, product.lowStockThreshold);
  const brand = brandNameFor(product.brandId);
  const canBuy = availability.available && product.status === SELLABLE_STATUS;
  const held = lines.find((line) => line.productId === product.id);

  /** Adds the quantity chosen, or reports the ceiling the cart has reached and adds nothing. */
  const add = (): boolean => {
    if (!canBuy) return false;
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
          onClick={addToCart}
        >
          {CATALOG_COPY.ADD_TO_CART_LABEL}
        </Button>
        <Button
          type="button"
          variant="secondary"
          isBlock
          aria-disabled={canBuy ? undefined : "true"}
          onClick={buyNow}
        >
          {CATALOG_COPY.BUY_NOW_LABEL}
        </Button>
      </div>
    </div>
  );
}

/** The loading state of the related strip: one decorative tile per product the strip stands in for. */
function RelatedPlaceholders(): ReactElement {
  return (
    <div className={CLASSES.relatedGrid} aria-hidden="true">
      {RELATED_PLACEHOLDER_KEYS.map((key) => (
        <Skeleton key={key} variant="card" />
      ))}
    </div>
  );
}

/** The related-products strip: the same-category products the catalogue service selects, nearest in price first.
 *  The read belongs to this section, which is what keeps it from delaying the product — the strip settles on its own
 *  and the page around it is already readable when it does. Its heading row is rendered in every state, so the
 *  landmark is named whichever state the strip is in, and it carries the way into the full catalogue for a visitor
 *  who wants to keep browsing. */
function RelatedProducts({ productId }: { readonly productId: ProductId }): ReactElement {
  const headingId = useId();
  const related = useAsync<Product[]>(
    (signal) => getRelated(productId, RELATED_PRODUCTS_LIMIT, { signal }),
    [productId],
  );
  const loaded = related.data;
  const isReading = related.status === "idle" || related.status === "loading";

  let strip: ReactElement;
  if (isReading) {
    strip = <RelatedPlaceholders />;
  } else if (related.error !== null) {
    strip = (
      <Alert
        tone="danger"
        error={related.error}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={related.reload}
      />
    );
  } else if (loaded === null || loaded.length === 0) {
    strip = <EmptyState surface="relatedProducts" />;
  } else {
    strip = (
      <ul className={CLASSES.relatedGrid} role="list">
        {loaded.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </ul>
    );
  }

  return (
    <section className={CLASSES.related} aria-labelledby={headingId} aria-busy={isReading}>
      <div className={CLASSES.relatedHeader}>
        <h2 id={headingId}>{CATALOG_COPY.RELATED_HEADING}</h2>
        <Link className={CLASSES.linkAction} to={ROUTES.CATALOG}>
          {COMMON_ACTIONS.VIEW_ALL}
        </Link>
      </div>
      {strip}
    </section>
  );
}

/** The loaded product: the gallery and the buy column beside each other, then the sections beneath them. Two of the
 *  three tabs are the page's own; the reviews tab hosts `ProductReviews`, which owns the review list, its rating
 *  filter, its paging and the form a signed-in customer submits, so the route composes that section rather than
 *  repeating any of it. The related strip sits after the tabs, so a shopper reads about the product they opened
 *  before being offered its neighbours. */
function ProductDetailBody({ product }: { readonly product: Product }): ReactElement {
  const tabs: readonly TabItem[] = [
    {
      id: TAB_IDS.DESCRIPTION,
      label: CATALOG_COPY.DESCRIPTION_HEADING,
      content: <DescriptionPanel product={product} />,
    },
    {
      id: TAB_IDS.SPECIFICATIONS,
      label: CATALOG_COPY.SPECIFICATIONS_HEADING,
      content: <SpecificationList specs={product.specs} />,
    },
    {
      id: TAB_IDS.REVIEWS,
      label: CATALOG_COPY.REVIEWS_HEADING,
      content: <ProductReviews productId={product.id} />,
    },
  ];

  return (
    <>
      <div className={CLASSES.root}>
        <div className={CLASSES.main}>
          <ProductGallery product={product} />
        </div>
        <PurchasePanel product={product} />
      </div>
      <div className={CLASSES.sections}>
        <Tabs items={tabs} label={PAGE_TITLES.PRODUCT} />
        <RelatedProducts productId={product.id} />
      </div>
    </>
  );
}

/**
 * The product detail route: everything one product is bought from, composed from the shared primitives.
 *
 * The route segment is the product's readable slug and `resolveProduct` is the single place that turns it into the
 * product; the product's own identifier then serves the two reads that need one — the related strip and the reviews.
 * The category read feeds the breadcrumb trail alone and runs beside the product rather than before it, so the page
 * renders as soon as it knows what it is showing. All four states are derived during render — the placeholders while
 * the read is in flight, the not-found state the endpoint's own refusal produces, the alert carrying a failure's
 * message with its retry, and the loaded product — so nothing is mirrored into state and no placeholder is ever
 * shown beside a stale product.
 *
 * @returns The route: its heading block, and whichever of the four states the read is in.
 */
export function ProductDetailPage(): ReactElement {
  const params = useParams();
  const slug = (params[ROUTE_PARAMS.PRODUCT_SLUG] ?? "").trim();
  const hasSlug = slug !== "";

  const product = useAsync<Product>((signal) => resolveProduct(slug, signal), [slug], {
    enabled: hasSlug,
  });
  const categories = useAsync<Category[]>(
    (signal) => getJson<Category[]>(API_PATHS.CATEGORIES, { signal }),
    [],
  );

  const loaded = product.data;
  const isMissing = !hasSlug || (product.error !== null && isMissingProduct(product.error));
  const isReading = hasSlug && (product.status === "idle" || product.status === "loading");
  const heading = loaded === null ? PAGE_TITLES.PRODUCT : loaded.name;

  useDocumentTitle(documentTitle(pageTitleFor(loaded, isMissing)));

  let body: ReactElement;
  if (isReading) {
    body = <DetailPlaceholders />;
  } else if (isMissing) {
    body = (
      <EmptyState
        title={NOT_FOUND_COPY.TITLE}
        description={NOT_FOUND_COPY.BODY}
        actionLabel={NOT_FOUND_COPY.ACTION_LABEL}
        actionHref={ROUTES.CATALOG}
      />
    );
  } else if (product.error !== null) {
    body = (
      <Alert
        tone="danger"
        error={product.error}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={product.reload}
      />
    );
  } else if (loaded === null) {
    // The read settled with neither a payload nor a failure: the placeholders stand rather than an empty page
    // claiming the product does not exist.
    body = <DetailPlaceholders />;
  } else {
    body = <ProductDetailBody product={loaded} />;
  }

  return (
    <div className="sp-container">
      <div className="sp-page">
        <PageHeader
          breadcrumbs={
            loaded === null ? undefined : categoryTrailFor(loaded, categories.data ?? [])
          }
          title={heading}
          description={loaded === null ? undefined : loaded.summary}
        />
        <div className={CLASSES.pageBody}>{body}</div>
      </div>
    </div>
  );
}
