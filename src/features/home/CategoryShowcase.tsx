/**
 * Path: src/features/home/CategoryShowcase.tsx
 * Purpose: Category tiles with product counts that link into the filtered catalogue
 * Lines: 232
 */

import type { ReactElement } from "react";

import { Link } from "react-router-dom";

import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, FEEDBACK_COPY, productCountLabel } from "@/constants/content";
import { HOME_COPY } from "@/constants/content";
import type { AsyncStatus, ApiError } from "@/types/common";

/*
 * Class contract.
 *
 * No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so every class
 * below is consumed by name. `src/styles/catalog-landing.css` owns the band: `sp-category-showcase` for the
 * section's own rhythm, `sp-category-tiles` for the grid that draws two columns on a phone, three from
 * --breakpoint-sm and four from --breakpoint-md, and the tile's `sp-category-tile` with its `__name` and
 * `__count` regions. `src/styles/data-display.css` owns the frame the tile borrows: `sp-card` paints the
 * surface, the border, the radius and the elevation, and `sp-card--interactive` adds the pointer cursor and
 * the hover and focus-within emphasis.
 *
 * That sheet states the markup it expects — the tile is a link that takes the card's frame in markup — so
 * the tile is a `Link` wearing both families rather than a `Card` with a link inside it: `Card` declares no
 * click handling and cannot itself navigate, and a tile whose blank space sits outside its target is a smaller
 * target than the one the sheet paints. The feedback primitives own their own classes and state attributes.
 *
 * Copy comes from the two copy modules: the band's heading and supporting line from
 * `src/constants/content.ts`, the count's template from `src/constants/content.ts`. That template renders
 * the facet's own count in the singular form it decides; no figure is grouped, rounded or re-derived here.
 */

/**
 * Names the band. The section points at it through `aria-labelledby`, so the landmark's accessible name is the
 * copy module's own heading rather than a string invented for it — the shape
 * `src/features/home/HeroSection.tsx` establishes for the page's other section.
 */
const SHOWCASE_HEADING_ID = "category-showcase-heading";

/**
 * The placeholder tiles the loading state stands in with, one name per tile: four of them, which is the widest
 * row the tile grid draws, so the band the skeleton occupies is the band the content arrives in. Each carries
 * its own identity rather than a position, and the sheet's card shape gives each its size, so nothing here
 * measures or places anything.
 */
const PLACEHOLDER_TILE_KEYS = ["first", "second", "third", "fourth"] as const;

/**
 * One tile of the band: a category, how many products it holds and where it leads.
 *
 * Every field arrives already decided. The label and the count come from the category facet the parent read —
 * the count is the facet's own figure, never one recomputed or aggregated here, and a parent's total is never
 * assembled from its children — and the target is the catalogue URL the parent composed through
 * `src/utils/queryParams.ts`, which is the one place a filter URL exists.
 */
export interface CategoryTile {
  /** The category's name, as the category facet labels it. */
  readonly label: string;
  /** How many products the category holds, as the category facet counts them. */
  readonly count: number;
  /** The catalogue target the tile navigates to, built by the parent. */
  readonly to: string;
}

/**
 * Everything the band is handed.
 *
 * The slice has one data read and it lives in `src/features/home/HomePage.tsx`, which owns the four states of
 * the landing route. This component therefore fetches nothing, holds no state and runs no effect: it renders
 * the state it is given and offers the retry its parent owns.
 */
export interface CategoryShowcaseProps {
  /**
   * The lifecycle of the slice's read: `idle`, before anything is asked for, and `loading` both render the
   * placeholder band, `error` renders the alert, and `success` renders the tiles or the empty state.
   */
  readonly status: AsyncStatus;
  /**
   * The tiles to render, in the order the category facet lists them. An empty list is a legitimate outcome of
   * a successful read and renders the empty state — it is not a failure, and no tile is invented to fill it.
   */
  readonly tiles: readonly CategoryTile[];
  /** The shaped failure the error state reports, and `null` in every other state. */
  readonly error: ApiError | null;
  /** Re-runs the read behind the band: the error state's retry, and the empty state's action when no target is given. */
  readonly onRetry: () => void;
  /**
   * The catalogue target the empty state's single action leads to, composed by the parent through the URL
   * writer. This file builds no URL and holds no route literal, so that destination exists only when the parent
   * hands it over; without it the empty state offers the reload above rather than a control leading nowhere.
   */
  readonly browseAllTo?: string;
}

/**
 * The loading state: one decorative card per placeholder name, laid out in the tile grid, so the band holds the
 * shape the content will fill.
 *
 * It announces nothing — every placeholder is hidden from assistive technology, and the section itself carries
 * `aria-busy` while the read is in flight — because a live region here would make a screen reader hear the load
 * twice.
 *
 * @returns The placeholder grid.
 */
function ShowcasePlaceholders(): ReactElement {
  return (
    <div className="sp-category-tiles" aria-hidden="true">
      {PLACEHOLDER_TILE_KEYS.map((key) => (
        <Skeleton key={key} variant="card" />
      ))}
    </div>
  );
}

/** What the empty state is wired to: the target the parent composed, or the reload the parent owns. */
interface EmptyBandWiring {
  /** The catalogue target the parent composed through the URL writer, when it supplied one. */
  readonly browseAllTo: string | undefined;
  /** Re-runs the read behind the band. */
  readonly onRetry: () => void;
}

/**
 * The empty state: the catalogue's own wording for a catalogue with nothing to show, and the one action that
 * helps.
 *
 * The wording is the content library's, because it declares no showcase-specific empty surface and a sentence
 * invented here would be copy without a home. That surface's own label names filters this band has none of, so
 * the control takes the shared catalogue label in its place, which is what the primitive's label prop exists
 * for.
 *
 * The action is the catalogue link when the parent supplied the target, and the parent's own reload otherwise,
 * because a control leading nowhere is worse than the reload that re-asks for the categories. Exactly one
 * control is rendered either way: a state offering three ways out offers none.
 *
 * @param props - The optional catalogue target and the parent's retry.
 * @returns The empty state element.
 */
function ShowcaseEmptyState({ browseAllTo, onRetry }: EmptyBandWiring): ReactElement {
  if (browseAllTo === undefined) {
    return (
      <EmptyState
        surface="catalogue"
        headingLevel={3}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={onRetry}
      />
    );
  }

  return (
    <EmptyState
      surface="catalogue"
      headingLevel={3}
      actionLabel={HOME_COPY.FEATURED_VIEW_ALL_LABEL}
      actionHref={browseAllTo}
    />
  );
}

/**
 * The landing route's category band: one tile per category, each naming the category and the number of products
 * inside it, and each one a link into the catalogue scoped to that category.
 *
 * It is presentational and total. It fetches nothing, computes no count, aggregates no child category into a
 * parent and builds no URL, and it renders all four states — the placeholder band while the read is in flight,
 * the alert carrying the failure's own message with its retry, the empty state when the category facet comes
 * back with no values, and the loaded grid otherwise — deriving the branch during render, so no state is
 * mirrored and no placeholder is ever shown beside a stale grid. The heading is rendered in every one of those
 * states, which is what keeps the landmark named whichever state the band is in.
 *
 * @param props - The read's status, the pre-built tiles, the failure, the retry and the optional catalogue
 *   target the empty state's action leads to.
 * @returns The labelled section holding the band.
 */
export function CategoryShowcase({
  status,
  tiles,
  error,
  onRetry,
  browseAllTo,
}: CategoryShowcaseProps): ReactElement {
  const isReading = status === "idle" || status === "loading";

  let band: ReactElement;

  if (isReading) {
    band = <ShowcasePlaceholders />;
  } else if (status === "error") {
    band = (
      <Alert
        tone="danger"
        error={error ?? undefined}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={onRetry}
      >
        {error === null ? FEEDBACK_COPY.ERROR_STATE_BODY : null}
      </Alert>
    );
  } else if (tiles.length === 0) {
    band = <ShowcaseEmptyState browseAllTo={browseAllTo} onRetry={onRetry} />;
  } else {
    band = (
      <ul className="sp-category-tiles" role="list">
        {tiles.map((tile) => (
          <li key={tile.to}>
            <Link className="sp-card sp-card--interactive sp-category-tile" to={tile.to}>
              <h3 className="sp-category-tile__name">{tile.label}</h3>
              <span className="sp-category-tile__count">{productCountLabel(tile.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      className="sp-category-showcase"
      aria-labelledby={SHOWCASE_HEADING_ID}
      aria-busy={isReading}
    >
      <h2 id={SHOWCASE_HEADING_ID}>{HOME_COPY.SHOWCASE_TITLE}</h2>
      <p>{HOME_COPY.SHOWCASE_SUBTITLE}</p>
      {band}
    </section>
  );
}
