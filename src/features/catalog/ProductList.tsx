/**
 * Path: src/features/catalog/ProductList.tsx
 * Purpose: The result grid with its loading, empty and error states
 * Lines: 270
 */

import type { ReactElement, ReactNode } from "react";

import { ProductCard } from "@/components/product/ProductCard";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { CATALOG_COPY, COMMON_ACTIONS, EMPTY_STATES, FEEDBACK_COPY } from "@/constants/content";
import type { Product } from "@/types/catalog";
import type { ApiError, AsyncStatus } from "@/types/common";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class below is consumed by name. `src/styles/catalog.css` owns the results area: `sp-product-grid`,
 * whose tracks are one column at the narrowest width and two, three and four columns from --breakpoint-sm,
 * --breakpoint-md and --breakpoint-lg; `sp-product-list`, the single-column list variant whose rows become a
 * fixed media column with the body beside it from --breakpoint-sm; and `sp-no-results`, the recovery block
 * that composes `sp-empty` and adds the way out of an empty result set. `src/styles/components.css` owns the
 * feedback states the other three branches render: `sp-empty` with its `__title`, `__body` and `__action`
 * regions, `sp-alert` with the `--danger` tone a failure is painted in, and `sp-skeleton` with its `--card`
 * shape.
 *
 * The tile is the list item rather than this file. `ProductCard` renders `Card as="li"`, and the grid and
 * list selectors above each reach their own direct child, so the container is a real `<ul>` and every card
 * stands in it unwrapped: a wrapper element between the two would take the track the tile was meant to fill
 * and break the list variant's two columns.
 *
 * Two deliberate omissions. `Button` is not imported although the empty state renders one, because
 * `Feedback.tsx` builds that control itself from `actionLabel` and `onAction`, so an import here would be an
 * unused binding. And the result count is not rendered here: the page's own result-meta row owns the count
 * and its polite live region, the pager states that same number and leaves its announcement to that region,
 * so a count in this file would announce one change three times.
 */

/** Every class this file puts on the page, named once so a render body repeats no string. */
const CLASSES = {
  grid: "sp-product-grid",
  list: "sp-product-list",
  emptyResults: "sp-no-results",
  emptyAction: "sp-empty__action",
} as const;

/**
 * Joins the class names this file composes, leaving out every absent one.
 *
 * Class composition is not a concern `src/utils` owns — `src/components/ui/Card.tsx` and
 * `src/components/product/ProductCard.tsx` each keep their own three-line copy for the same reason — so the
 * join lives in the file that composes the classes.
 *
 * @param names - The classes in cascade order, any of which may be `false` or `undefined` to mean "omit".
 * @returns The names that were given, joined by a single space.
 */
function composeClassName(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * How many placeholder tiles the loading state stands in with.
 *
 * Eight is two rows of the widest grid the sheet declares — four columns from --breakpoint-lg — and enough
 * of a band at every narrower width to show that the results are arriving rather than that the page has
 * nothing to list. The figure is not the page size: this file is handed a page of products and never the
 * paging configuration, because paging belongs to the page that reads the URL.
 */
const PLACEHOLDER_TILE_COUNT = 8;

/**
 * The heading level the empty state's headline renders at.
 *
 * `2` is the level of a page section, which is the slot the results occupy: the route's own header carries
 * the `h1` and the tiles carry their own `h3` names, so the recovery headline joins the outline between them
 * rather than competing with the title or skipping a level on the way down to a tile that is not rendered.
 */
const EMPTY_HEADING_LEVEL = 2;

/**
 * The wording and the heading level of an empty result set, assembled once for the one state that uses it.
 *
 * The words are the content library's own — the `catalogue` surface's title and its plain explanation of why
 * nothing is listed — so no empty-state sentence is written in this file, and the level travels with them so
 * the block cannot render at one level in one branch and another level in the next.
 */
const EMPTY_RESULT_COPY = {
  title: EMPTY_STATES.catalogue.title,
  description: EMPTY_STATES.catalogue.description,
  headingLevel: EMPTY_HEADING_LEVEL,
} as const;

/**
 * The two placements a result set is laid out in.
 *
 * They are the same two placements `ProductCard` accepts, because the container and the tile have to agree:
 * a `list` container lays its rows out as a media column with the body beside it and the tile has to put its
 * action inside that body, while a `grid` container gives every tile a track of its own.
 */
export type ProductListLayout = "grid" | "list";

/** Everything {@link ProductList} accepts. */
export interface ProductListProps {
  /**
   * The products this page of results holds, in the order the service sorted them.
   *
   * They are rendered as given: this component filters nothing, sorts nothing, facets nothing and pages
   * nothing, because `src/lib/catalogService.ts` owns all four rules and the URL owns the query that
   * produced them. An empty array on a `success` status is the empty result set rather than a state still
   * arriving, which is what lets the caller distinguish "still reading" from "nothing matches".
   */
  readonly items: readonly Product[];
  /**
   * How far the read has got: `idle` before the first request, `loading` while one is in flight, `success`
   * when `items` is the answer, `error` when the read failed.
   *
   * `idle` is rendered as loading rather than as an empty result set, because a region that had not asked
   * anything yet has nothing to say about being empty, and the skeleton is what a visitor sees in the frame
   * between the route mounting and the first answer landing.
   */
  readonly status: AsyncStatus;
  /**
   * The failure the seam shaped, when the read failed.
   *
   * Failures are values rather than exceptions at this seam, so a caller with a failed request holds this
   * instead of a thrown error and hands it straight through; the message it carries is what the error state
   * renders.
   */
  readonly error?: ApiError | null;
  /**
   * What retrying means to the caller — usually the context's own reload.
   *
   * It backs both of the outcomes a caller can be offered: the action on the error state, and the single
   * action on an empty result set when the caller supplied no action of its own.
   */
  readonly onRetry?: () => void;
  /**
   * The one control an empty result set offers, when the caller has a better way out than a retry.
   *
   * A catalogue whose filters match nothing is emptied by the filters rather than by a failed request, so the
   * useful action there is clearing them — which the page owns, because the filters live in the URL. The
   * caller passes the control itself, labelled with the same words the empty state's copy promises, and this
   * component renders it in place of its own; a retry beside it would be a second, useless way out.
   */
  readonly emptyAction?: ReactNode;
  /**
   * The placement the tiles are laid out in. Defaults to `"grid"`.
   *
   * `grid` is the catalogue and search presentation; `list` is the wider row a caller reaches for where the
   * results share a screen with something else.
   */
  readonly layout?: ProductListLayout;
  /** Extra classes for the results area, placed after the block's own so the caller's layout wins. */
  readonly className?: string;
}

/**
 * One page of products as a grid or a list, in whichever of the four states its read is in.
 *
 * The component is presentational and holds nothing: it receives the products, the status of the read that
 * produced them and the failure if there was one, and it renders one of four things — a skeleton shaped like
 * the grid while the read is in flight, the recovery block when a successful read matched nothing, an alert
 * carrying the shaped `ApiError` when the read failed, and the tiles themselves when there is something to
 * show. It fetches nothing, runs no effect, reads no context and keeps no state, so a page can drive it from
 * a context, from a hook or from a test without this file knowing which.
 *
 * Every figure a tile shows comes from the tile, which resolves its own brand, rating, both prices, its
 * discount and its availability, so no price is formatted and no total is computed here. The tiles are keyed
 * by the product's own identifier — never by their position, so a filter or a sort that reorders the page
 * moves a tile rather than repainting a different product into it. Each tile is handed its product and its
 * placement and nothing else: the brand name comes from the tile's own taxonomy lookup, so a page holding
 * products needs no brand records, and no tile is marked eager, because product imagery is a deterministic
 * inline SVG rather than a request whose order could be worth arranging.
 *
 * Accessibility is structural: the grid is a real list of real links, each tile's name being the link's text;
 * the placeholders are decorative and hidden, and they add no live region, the region's own `aria-busy` being
 * what states that it is filling; the error state is the alert `Feedback.tsx` already roles as a failure, so
 * its message is announced and its retry is a real button in the tab order; and the empty state's action is
 * either the caller's own focusable control or the button the shared empty state builds.
 *
 * @param props - The page of products, the status of the read, the failure if any, the retry, the empty
 *   state's action, the placement and the caller's extra classes.
 * @returns The results area in the state the read is in.
 */
export function ProductList({
  items,
  status,
  error,
  onRetry,
  emptyAction,
  layout = "grid",
  className,
}: ProductListProps): ReactElement {
  // The container is the same element, keeps the same name and keeps the list role in the loading state and
  // the loaded one, so the named list a visitor's screen reader has entered does not change out from under
  // them when the tiles arrive: `aria-busy` is what states that it is filling, and the placeholders inside
  // stay hidden so the busy region is not also counted out as eight empty rows.
  const containerClass = layout === "list" ? CLASSES.list : CLASSES.grid;

  if (status === "idle" || status === "loading") {
    return (
      <ul
        className={composeClassName(containerClass, className)}
        role="list"
        aria-label={CATALOG_COPY.RESULTS_REGION_LABEL}
        aria-busy="true"
      >
        {/* The placeholders are interchangeable decorative boxes with no identity for a key to preserve,
            which is the same reason the shared skeleton keys its own lines by position, and they are hidden
            from assistive technology so the region reports that it is filling rather than counting eight
            empty rows. */}
        {Array.from({ length: PLACEHOLDER_TILE_COUNT }, (_slot, index) => (
          <li key={`result-placeholder-${String(index)}`} aria-hidden="true">
            <Skeleton variant="card" />
          </li>
        ))}
      </ul>
    );
  }

  if (status === "success" && items.length === 0) {
    // Exactly one way out: the caller's own control when it had a better answer than trying again, the
    // shared empty state's retry button when it did not, and its headline and its explanation alone when
    // neither was offered — never a second control beside the first.
    return (
      <div className={composeClassName(CLASSES.emptyResults, className)}>
        {emptyAction === undefined && onRetry !== undefined ? (
          <EmptyState
            {...EMPTY_RESULT_COPY}
            actionLabel={COMMON_ACTIONS.RETRY}
            onAction={onRetry}
          />
        ) : (
          <EmptyState {...EMPTY_RESULT_COPY} />
        )}
        {emptyAction === undefined ? null : (
          <div className={CLASSES.emptyAction}>{emptyAction}</div>
        )}
      </div>
    );
  }

  if (status === "error") {
    const failure = error ?? undefined;

    return (
      <Alert
        tone="danger"
        error={failure}
        title={failure === undefined ? FEEDBACK_COPY.ERROR_STATE_TITLE : undefined}
        actionLabel={onRetry === undefined ? undefined : COMMON_ACTIONS.RETRY}
        onAction={onRetry}
        className={className}
      >
        {failure === undefined ? FEEDBACK_COPY.ERROR_STATE_BODY : undefined}
      </Alert>
    );
  }

  return (
    <ul
      className={composeClassName(containerClass, className)}
      role="list"
      aria-label={CATALOG_COPY.RESULTS_REGION_LABEL}
    >
      {items.map((product) => (
        <ProductCard key={product.id} product={product} variant={layout} />
      ))}
    </ul>
  );
}
