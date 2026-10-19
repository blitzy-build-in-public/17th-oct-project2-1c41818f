/**
 * Path: src/features/catalog/ProductDetailPage.tsx
 * Purpose: Product route composing the gallery, details, tabs, reviews and related-products strip
 * Lines: 454
 */

import { useId } from "react";
import type { ReactElement } from "react";

import { Link, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import type { BreadcrumbItem } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductGallery } from "@/components/product/ProductGallery";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { NotFoundView } from "@/components/ui/NotFoundView";
import { Tabs } from "@/components/ui/Tabs";
import type { TabItem } from "@/components/ui/Tabs";
import { RELATED_PRODUCTS_LIMIT } from "@/constants/config";
import {
  A11Y_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  PAGE_TITLES,
  documentTitle,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, categoryPath } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";
import { ProductReviews } from "@/features/catalog/ProductReviews";
import { PurchasePanel } from "@/features/catalog/PurchasePanel";
import { API_ERROR_CODES } from "@/lib/apiClient";
import {
  flattenCategoryTree,
  getProductBySlug,
  getRelated,
  isProductSegment,
  listCategories,
} from "@/lib/catalogService";
import { useQuickAdd } from "@/state/CartContext";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { CategoryNode, Product, ProductSpec } from "@/types/catalog";
import type { ApiError, ProductId } from "@/types/common";
import { indexBy } from "@/utils/collections";

/*
 * Class contract. This list is what the sheets owe the page, each class named with the sheet that declares it, and
 * it covers the whole surface the route renders: this file's own parts and the buy column's.
 * `src/styles/catalog-detail.css`, loaded by `src/styles/catalog.css` with
 * `@import`, is the sole definition site of the block: `sp-product-detail` with the `__main` and `__sections` parts
 * rendered here, the `__aside` container the loading placeholder stands its shapes in and the buy column renders,
 * and the buy column's `__meta`, `__rating`, `__price` and `__actions` parts rendered by the
 * split path `src/features/catalog/PurchasePanel.tsx`, which the page composes; the same sheet declares the
 * `sp-specs` definition list with its `__row`, `__term` and `__value`, the `sp-features` list with its `__item`
 * marker, and the `sp-related` section. The availability line's `sp-product-detail__stock` — the buy column's part
 * of that block — is declared in `catalog.css`, which keeps that state in one home for both the surfaces rendering
 * it. `sp-related__header`, `sp-product-grid--related` and `sp-gallery__stage` belong to the landing, catalogue
 * and gallery sheets, and the loading placeholder borrows the last so the artwork's box is held open. `sp-btn` with
 * `--link`, `sp-tabs`, `sp-alert`, `sp-empty`, `sp-skeleton` and `sp-stack` are the shared primitives', and
 * `sp-visually-hidden` is `src/styles/base.css`'s utility.
 * `sp-product-detail__title` is deliberately unused: the page's single `<h1>` is the shared page
 * header's, which is why the product's name is passed to it.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` declares no key for the tab set's accessible name — it is
 * named with that module's own words for this page, `PAGE_TITLES.PRODUCT` — and no label for the SKU, which the buy
 * column announces as the code it is and which the specifications list names under `Item code`. Both are recorded
 * rather than filled with an invented sentence.
 */

/** The class names this surface composes, named once so no render body repeats a string. The buy column's own
 *  names are the split path's map, in `src/features/catalog/PurchasePanel.tsx`; `aside` is named here as well
 *  because the loading placeholder stands its shapes in that container, so the page does not reflow when the
 *  product arrives. */
const CLASSES = {
  root: "sp-product-detail",
  main: "sp-product-detail__main",
  aside: "sp-product-detail__aside",
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

/** The identifiers of the three tabs, named once so no render body repeats a string. */
const TAB_IDS = {
  DESCRIPTION: "description",
  SPECIFICATIONS: "specifications",
  REVIEWS: "reviews",
} as const;

/** The placeholder cards a loading strip stands in with, one per related product the endpoint answers with at most;
 *  each carries its own identity rather than a position, so no key is an index. */
const RELATED_PLACEHOLDER_KEYS = ["first", "second", "third", "fourth"] as const;

/** The crumbs the settled trail holds: the home crumb, the two levels a category is nested to and the product's
 *  own name. `categoryTrailFor` below builds exactly that trail from the answer, and a product whose category the
 *  read did not answer with keeps the middle two slots empty, which is the same trail with fewer crumbs rather
 *  than a shorter one — the header reserves the rows the full trail takes either way. `PageHeader`'s
 *  `breadcrumbSlots` is where the count is spent. */
const SETTLED_TRAIL_LENGTH = 4;

// Identity --------------------------------------------------------------------------------------

/** Whether a failure is the read reporting that the catalogue holds no product under the segment the route
 *  carries: the code the detail endpoint answers an unknown identifier with, which the slug read resolves for a
 *  segment naming nothing, so the not-found state has one trigger whichever read produced it. */
function isMissingProduct(error: ApiError): boolean {
  return error.code === API_ERROR_CODES.PRODUCT_NOT_FOUND;
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
 *  shopper asked for.
 *
 *  The read answers a tree and a product's category is a leaf, so the tree is walked into one list before the
 *  lookup: indexing the payload as it arrives would see the parents alone and shorten every trail to home and the
 *  product. */
function categoryTrailFor(
  product: Product,
  categories: readonly CategoryNode[],
): readonly BreadcrumbItem[] {
  const byId = indexBy(flattenCategoryTree(categories), (category) => category.id);
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
      <span className="sp-visually-hidden" role="status">
        {A11Y_COPY.LOADING_ANNOUNCEMENT}
      </span>
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
 *  who wants to keep browsing. Its tiles are handed the cart's add, read here through `useQuickAdd` from
 *  `src/state/CartContext.tsx`, because a tile is shared presentation and may not read the cart itself. */
function RelatedProducts({ productId }: { readonly productId: ProductId }): ReactElement {
  const headingId = useId();
  const onAddToCart = useQuickAdd();
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
          <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
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

/**
 * The loaded product: the gallery and the buy column beside each other, then the sections beneath them. Two of
 * the three tabs are the page's own; the reviews tab hosts `ProductReviews`, which owns the review list, its
 * rating filter, its paging and the form a signed-in customer submits, so the route composes that section rather
 * than repeating any of it. The related strip sits after the tabs, so a shopper reads about the product they
 * opened before being offered its neighbours.
 *
 * Every figure the buy column states is a figure of the product read, the rating summary among them, while the
 * count the reviews tab states is read from the review collection. A review published in that tab therefore
 * reports itself back here through `onReviewPublished`, which is the route's own re-read of this product: the
 * header above and the list below are then derived from one store after the write resolves, instead of the list
 * moving under a summary left at the figures the page opened with.
 *
 * @param props - The product being shown and the re-read a published review asks the route for.
 * @returns The loaded product's body.
 */
function ProductDetailBody({
  product,
  onReviewPublished,
}: {
  readonly product: Product;
  readonly onReviewPublished: () => void;
}): ReactElement {
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
      content: <ProductReviews productId={product.id} onReviewPublished={onReviewPublished} />,
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
 * The route segment is the product's readable slug and `getProductBySlug` in `src/lib/catalogService.ts` is the
 * single read that turns it into the product, so no request here asks the detail endpoint for an identifier the
 * segment is not; the product's own identifier then serves the two reads that need one — the related strip and
 * the reviews.
 * That read is also the one a published review refreshes: the reviews tab reports the write through
 * `onReviewPublished`, which re-reads this product, so the rating summary above the tabs and the review list
 * below them state one store's figures after the write resolves rather than disagreeing under one page.
 * The category read feeds the breadcrumb trail alone and runs beside the product rather than before it, so the page
 * renders as soon as it knows what it is showing. The states are derived during render — the placeholders while a
 * segment's own payload is still being read, the alert carrying a failure's message with its retry, and the loaded
 * product — so nothing is mirrored into state, no placeholder is ever shown beside a stale product, and a refresh
 * over a product the page already holds renders that product instead of blanking it. The heading block
 * reserves the room its three data-named parts take before that read answers, so the page below it does not move
 * when they arrive: `SETTLED_TRAIL_LENGTH` is what `PageHeader`'s `breadcrumbSlots` spends. The fourth, an address
 * naming no product, is not a state of this page at all: it returns the shared not-found view in place of the
 * header and the body, which is what keeps the route's single `h1` naming the state the visitor is in.
 *
 * @returns The route: its heading block and whichever state the read is in, or the not-found view when the
 *   address names no product.
 */
export function ProductDetailPage(): ReactElement {
  const params = useParams();
  const slug = (params[ROUTE_PARAMS.PRODUCT_SLUG] ?? "").trim();
  const hasSlug = slug !== "";

  // The payload a read already answered with is kept while the next read of the same segment is in flight, so
  // the one refresh this page asks for over a product it is already showing — the re-read a published review
  // reports — replaces that product in place instead of taking the page down to its placeholders.
  const product = useAsync<Product>((signal) => getProductBySlug(slug, { signal }), [slug], {
    enabled: hasSlug,
    keepPreviousData: true,
  });
  const categories = useAsync<CategoryNode[]>((signal) => listCategories({ signal }), []);

  // What the page may render is the payload that answers the segment being read, not merely the last payload the
  // read published. A kept payload is this address's product, so a refresh over it renders that product; a
  // payload a moved-to segment does not answer leaves the page at its placeholders rather than showing the
  // product the visitor came from. The question is `isProductSegment`'s, the one home for the two spellings a
  // segment may use.
  const loaded =
    product.data !== null && isProductSegment(product.data, slug) ? product.data : null;
  const isMissing = !hasSlug || (product.error !== null && isMissingProduct(product.error));
  // The wait a first read of a segment shows is a payload that is neither in hand nor failed. A refresh over the
  // product already on screen is answered by the product itself — it stays rendered and the section reports the
  // read through its own busy state — while a failure is a state of its own and keeps the alert below.
  const isReading = hasSlug && loaded === null && product.error === null;
  const heading = loaded === null ? PAGE_TITLES.PRODUCT : loaded.name;

  // The header's own names — the trail, the heading and the supporting line — are all named by the product read,
  // so while it holds no product the header reserves the rows they take instead of painting the two crumbs the URL
  // supports on its own. The reservation stands for as long as the names are unknown, the failure path included:
  // a header that collapsed when a read failed would move the block below it by the height it had reserved.
  const hasProductNames = loaded !== null;

  useDocumentTitle(documentTitle(pageTitleFor(loaded, isMissing)));

  // An address naming no product is not this route's header over a page with nothing in it: what is on screen is
  // the not-found state, so it renders the one shared view in place of the header and the body below, which keeps
  // the route's single `h1` — and the title set just above, which already names this state — describing what the
  // visitor is actually looking at rather than a product that does not exist.
  if (isMissing) return <NotFoundView />;

  let body: ReactElement;
  if (isReading) {
    body = <DetailPlaceholders />;
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
    body = <ProductDetailBody product={loaded} onReviewPublished={product.reload} />;
  }

  return (
    <div className="sp-container">
      <div className="sp-page">
        <PageHeader
          breadcrumbSlots={hasProductNames ? undefined : SETTLED_TRAIL_LENGTH}
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
