/**
 * Path: src/features/home/FeaturedProducts.tsx
 * Purpose: The featured-products strip drawn from the seeded catalogue, with a link into the catalogue
 * Lines: 334
 */

import type { FocusEvent, ReactElement } from "react";

import { Link } from "react-router-dom";

import { ProductCard } from "@/components/product/ProductCard";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, FEEDBACK_COPY } from "@/constants/content";
import { HOME_COPY } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { useQuickAdd } from "@/state/CartContext";
import type { Product } from "@/types/catalog";
import type { AsyncStatus, ApiError } from "@/types/common";

/*
 * Class contract.
 *
 * `src/styles/catalog-landing.css` owns the band's own rhythm, each class named with the sheet that
 * declares it: `sp-featured` is the section, which stacks its heading row, its supporting line and its
 * strip with the sheet's gap,
 * `sp-featured__subtitle` is that supporting line in the muted register the same role takes on every other
 * surface, and `sp-featured__header` is the heading row that closes its action to the end — the same row the
 * related strip on a product's page wears. `src/styles/catalog.css` owns the strip: `sp-product-grid` is the
 * result grid and `sp-product-grid--strip` its strip modifier, which runs the row as a snapped horizontal
 * scroller below --breakpoint-md and up to four equal cards per row from there, so the band reflows with no
 * breakpoint read here and no width decided in JavaScript. `src/styles/controls.css` owns the family the
 * view-all link borrows: `sp-btn` with `sp-btn--secondary`, the spelling a page written from the primitives
 * onward uses, which states the absence of the underline an anchor would otherwise carry.
 *
 * The tile and the feedback primitives are the other two owners, and neither is restated here. `ProductCard`
 * wears `sp-card sp-card--interactive sp-product-card` and every region inside it, and it is the band's `<li>`:
 * the sheet's `.sp-product-grid--strip > *` selects its own direct child, so a wrapper element between the two
 * would break the strip's flex sizing. `Alert`, `EmptyState` and `Skeleton` carry their own classes, their own
 * state attributes and their own ARIA, so this file passes them props and writes no rule for them.
 *
 * Copy comes from the copy modules and every figure is formatted elsewhere: the band's heading,
 * its supporting line and its view-all label from `src/constants/content.ts`, the empty
 * state's wording from `src/constants/content.ts`, the destination from `src/constants/routes.ts`,
 * and each tile formats its own price, discount, rating and availability through
 * `src/utils/format.ts`. Nothing here computes an amount, a count or a sentence of its own.
 */

/**
 * Names the band. The section points at it through `aria-labelledby`, so the landmark's accessible name is the
 * copy module's own heading rather than a string invented for it — the shape `src/features/home/HeroSection.tsx`
 * and `src/features/home/CategoryShowcase.tsx` establish for the landing page's other bands. It is rendered in
 * every one of the four states, which is what keeps the band named whichever state it is in.
 */
const FEATURED_HEADING_ID = "featured-products-heading";

/**
 * The placeholder tiles the loading state stands in with, one name per tile: four of them, which is the widest
 * row the strip draws, so the band the skeleton occupies is the band the content arrives in. Each carries its
 * own identity rather than a position, and the sheet's card shape gives each its size, so nothing here measures
 * or places anything.
 */
const PLACEHOLDER_TILE_KEYS = ["first", "second", "third", "fourth"] as const;

/**
 * How many leading tiles take an eager image.
 *
 * The strip's first row is above the fold at every width it is read at — one card on a phone, three from
 * --breakpoint-sm and four from --breakpoint-md — so these carry `ProductCard`'s own `priority` and the tiles
 * behind them keep the lazy default a row that scrolls sideways wants.
 */
const EAGER_TILE_COUNT = 4;

/**
 * Everything the band is handed.
 *
 * The slice has one data read and it lives in `src/features/home/HomePage.tsx`, which owns the four states of
 * the landing route: the catalogue's requests are capped at one in flight per view, so the featured strip and
 * the category showcase are fed by that single loader rather than by one request each. This component therefore
 * fetches nothing, holds no state and runs no effect — it renders the state it is given, and the retry it hands
 * back is the parent's own.
 */
export interface FeaturedProductsProps {
  /**
   * The lifecycle of the slice's read: `idle`, before anything is asked for, and `loading` both render the
   * placeholder strip, `error` renders the alert, and `success` renders the tiles or the empty state.
   */
  readonly status: AsyncStatus;
  /**
   * The products to feature, in the order the parent chose them — the strip renders the list as given and
   * reorders nothing. An empty list is a legitimate outcome of a successful read and renders the empty state;
   * it is not a failure, and no tile is invented to fill it.
   */
  readonly products: readonly Product[];
  /** The shaped failure the error state reports, and `null` in every other state. */
  readonly error: ApiError | null;
  /** Re-runs the read behind the band: the error state's retry, which the parent owns and this file only wires. */
  readonly onRetry: () => void;
}

/**
 * The loading state: one decorative card per placeholder name, laid out in the strip, so the band holds the
 * shape the content will fill.
 *
 * It announces nothing — every placeholder is hidden from assistive technology, and the section itself carries
 * `aria-busy` while the read is in flight — because a live region here would make a screen reader hear the load
 * twice. Its cards take the strip's own grid classes rather than a box of their own, so the placeholder row
 * reflows exactly as the loaded row does.
 *
 * @returns The placeholder strip.
 */
function FeaturedPlaceholders(): ReactElement {
  return (
    <div className="sp-product-grid sp-product-grid--strip" aria-hidden="true">
      {PLACEHOLDER_TILE_KEYS.map((key) => (
        <Skeleton key={key} variant="card" />
      ))}
    </div>
  );
}

/** Everything the loaded strip is handed. */
interface FeaturedTilesProps {
  /** The products to feature, in the order to render them. */
  readonly products: readonly Product[];
}

/**
 * Brings a tile that has just taken focus wholly inside the strip.
 *
 * The browser's own focus scroll cannot manage this alone: an engine scrolls a focused element into view only
 * once it lies entirely outside the scrollport. A control inside a tile that is still partly on screen therefore
 * draws no scroll at all, and the strip's `proximity` snapping does not then pull the tile to the `start`
 * position its `scroll-snap-align` declares, so a Tab walk reaches a tile's link and its quick add with only
 * part of each box in view. No `scroll-margin-inline` on the tiles or on the controls inside them, and no
 * `scroll-padding-inline` on the strip, changes that: the scroll such a margin would correct is never issued.
 * Scrolling the tile is what brings the whole card in, because the tile — not the control inside it — is the
 * box the strip clips.
 *
 * `inline: "start"` is the alignment that leaves the snap nothing to correct: the tile's own
 * `scroll-snap-align: start`, from the sheet, already makes its start edge the offset the strip rests at, so the
 * position asked for here coincides with the one the strip would choose for itself. `block: "nearest"` leaves the
 * vertical axis to the browser, which handles it and which this band does not change.
 *
 * The handler acts only where the strip scrolls sideways. From --breakpoint-md it is a grid with
 * `overflow-x: visible`, and the related strip on a product's page never wears this modifier; the test for that is
 * the strip's own overflow rather than a breakpoint read here, which is also what keeps the handler off the
 * layout-free DOM a test runs in, where `scrollWidth` and `clientWidth` are both 0 and no scrolling exists.
 *
 * The strip stays off the tab order, as it is now: its tiles' links and quick adds are the band's focus stops
 * already, and making the scroll region a stop of its own would put one more press in front of every tile without
 * adding anything a reader can activate. Nothing here changes what is focusable, only where the strip sits when
 * something inside it is.
 *
 * @param event - The focus the strip catches from a tile's own link or quick-add button.
 */
function scrollTileIntoView(event: FocusEvent<HTMLUListElement>): void {
  const strip = event.currentTarget;
  const control = event.target;

  if (!(control instanceof HTMLElement) || strip.scrollWidth <= strip.clientWidth) {
    return;
  }

  // The tile is the strip's direct child: `ProductCard` renders itself as the `<li>` precisely so the sheet's
  // `.sp-product-grid--strip > *` can size it, which leaves a `li` of some other box not this band's business.
  const tile = control.closest("li");

  if (tile === null || tile.parentElement !== strip) {
    return;
  }

  const stripBox = strip.getBoundingClientRect();
  const tileBox = tile.getBoundingClientRect();

  // A tile already wholly inside asks for nothing, and that is every tile from --breakpoint-md up as well as the
  // tile a reader is already looking at: moving it would be motion with no work to do.
  if (tileBox.left >= stripBox.left && tileBox.right <= stripBox.right) {
    return;
  }

  tile.scrollIntoView({ block: "nearest", inline: "start" });
}

/**
 * The loaded band: one tile per product, each a link to its own page and, through `ProductCard`'s quick add,
 * one activation away from the cart.
 *
 * The tiles are `ProductCard` and nothing else, which is what keeps one tile implementation behind the home,
 * catalogue, search and related strips, and each tile is the list's own `<li>` rather than a wrapping element
 * around one. The list carries `role="list"`, the spelling `src/styles/base.css` gives a deliberately
 * marker-free list and what keeps the list semantics once its markers are gone. React's key is the product's
 * own identity, never the position, so a re-render that reorders or replaces products keeps each tile's state
 * with its product.
 *
 * The add a tile performs arrives from here. A tile is shared presentation and the cart lives above it, so the
 * band reads the cart's own add through `useQuickAdd` in `src/state/CartContext.tsx` — the single home of that
 * rule, the ceiling notice included — and hands the callback to each tile; the read sits in this component
 * rather than in the section that renders it, so a change to the cart re-renders the strip and not the band's
 * own heading and view-all row.
 *
 * The list catches focus so that a tile the strip has only partly on screen is brought fully into it, which is
 * the one thing the browser's own focus scroll leaves undone at this width; the handler above states why.
 *
 * @param props - The products to feature, in the order to render them.
 * @returns The strip's list of tiles.
 */
function FeaturedTiles({ products }: FeaturedTilesProps): ReactElement {
  const onAddToCart = useQuickAdd();

  return (
    <ul className="sp-product-grid sp-product-grid--strip" role="list" onFocus={scrollTileIntoView}>
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          onAddToCart={onAddToCart}
          priority={index < EAGER_TILE_COUNT}
        />
      ))}
    </ul>
  );
}

/**
 * The landing route's featured band: the catalogue's best-reviewed products as a strip of tiles, with the
 * band's heading, its supporting line and one link into the catalogue.
 *
 * It is presentational and total. It fetches nothing, computes no total, formats no figure and composes no URL,
 * because the slice's one read and its four states belong to `src/features/home/HomePage.tsx`. What it owns is
 * how those states are shown, and it shows all four in one order — the placeholder strip while the read is in
 * flight, the alert carrying the failure's own message with the parent's retry, the catalogue's own wording when
 * the read succeeds with nothing to feature, and the tiles otherwise — deriving the branch during render, so no
 * state is mirrored, no effect synchronises anything, and a placeholder is never shown beside a stale grid.
 *
 * The heading is rendered in every one of those states, which is what keeps the landmark named whichever state
 * the band is in. The view-all link appears with the tiles instead, and that is deliberate rather than
 * incidental: the empty state offers this same destination as its own single action and an error state's action
 * is the retry, so a link beside either of them would offer one way out twice. Where the band does show it,
 * navigation is a `Link` rather than a button because it is a link — a middle click and an open-in-a-new-tab
 * keep working — and it borrows the button family for its look, which is the shape
 * `src/features/home/HeroSection.tsx` sets for the page's other calls to action.
 *
 * `aria-busy` states the read rather than leaving the placeholders to imply it, and the section is a real
 * landmark in every state so the page's outline is the same before and after the read answers.
 *
 * Three omissions are decisions rather than oversights. Nothing announces the tiles in a live region, because
 * the strip is a selection from the catalogue rather than a result set a shopper is refining — the catalogue
 * and search pages own the announcement their filters need, and a second one here would interrupt the page a
 * visitor has just opened. Nothing is memoised: the parent hands over a handful of tiles, and the bookkeeping a
 * `useMemo` would add to derive what `Array.prototype.map` already does in a pass is the cost memoisation is
 * reserved for avoiding on the expensive aggregations, not on this one. And no count is rendered beside the
 * heading, because the band shows what it was given rather than the size of a result set — the catalogue's own
 * pages own the result count and its page-size control.
 *
 * The four states are chosen by the read's status and not by the length of the list alone, which is what keeps a
 * read still in flight from flashing the empty state: an empty list means "nothing to feature" only once the
 * read has reported success.
 *
 * @param props - The read's status, the products to feature, the failure and the parent's retry.
 * @returns The labelled section holding the band.
 */
export function FeaturedProducts({
  status,
  products,
  error,
  onRetry,
}: FeaturedProductsProps): ReactElement {
  // `idle` is the state before the parent asks for anything, and it renders the placeholder for the same reason
  // `loading` does: there is nothing to show yet, and a band that rendered nothing at all would read as a
  // catalogue with no featured products rather than as a read that has not answered.
  const isReading = status === "idle" || status === "loading";
  const showsTiles = status === "success" && products.length > 0;

  // Exactly one band is built, never two: the branches are exclusive and ordered, so a placeholder cannot be
  // shown beside a loaded grid and an alert cannot appear beside tiles an earlier read produced.
  let band: ReactElement;

  if (isReading) {
    band = <FeaturedPlaceholders />;
  } else if (status === "error") {
    band = (
      <Alert
        tone="danger"
        error={error ?? undefined}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={onRetry}
      >
        {/*
         * A failure the seam shaped carries its own sentence, and the alert prefers it to anything passed here;
         * the copy module's neutral body covers the defensive case of an error status with no error to read, so
         * the state never renders an empty surface and the message it shows is never a string invented here.
         */}
        {error === null ? FEEDBACK_COPY.ERROR_STATE_BODY : null}
      </Alert>
    );
  } else if (products.length === 0) {
    /*
     * The wording is the copy module's. The landing page declares no empty surface of its own, and a sentence
     * invented here would be copy with no home, so the catalogue's own surface is the nearest one — and because
     * its label names filters this band has none of, the single control takes the band's view-all label in its
     * place, which is what the primitive's label prop exists for. The way out is the real destination the
     * primitive renders from `actionHref`, so the state's one control lands on the catalogue rather than
     * nowhere, and the headline sits at level 3 to follow the band's own `<h2>` without skipping a level.
     */
    band = (
      <EmptyState
        surface="catalogue"
        headingLevel={3}
        actionLabel={HOME_COPY.FEATURED_VIEW_ALL_LABEL}
        actionHref={ROUTES.CATALOG}
      />
    );
  } else {
    band = <FeaturedTiles products={products} />;
  }

  return (
    <section className="sp-featured" aria-labelledby={FEATURED_HEADING_ID} aria-busy={isReading}>
      <div className="sp-featured__header">
        <h2 id={FEATURED_HEADING_ID}>{HOME_COPY.FEATURED_TITLE}</h2>
        {showsTiles ? (
          <Link className="sp-btn sp-btn--secondary" to={ROUTES.CATALOG}>
            {HOME_COPY.FEATURED_VIEW_ALL_LABEL}
          </Link>
        ) : null}
      </div>
      {/* The supporting line is a sibling of the heading row rather than a child of it: that row is a flex line
          placing each child beside the last, so a paragraph inside it would sit next to the heading instead of
          under it. The section's own grid, from the sheet, spaces the heading row, this line and the band. */}
      <p className="sp-featured__subtitle">{HOME_COPY.FEATURED_SUBTITLE}</p>
      {band}
    </section>
  );
}
