/**
 * Path: src/features/search/SearchPage.tsx
 * Purpose: Search route: query summary, facets, sort control, active-filter chips and results
 * Lines: 318
 */

import { useId } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import type { BreadcrumbItem } from "@/components/layout/PageHeader";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard, ProductCardPlaceholder } from "@/components/product/ProductCard";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Pagination } from "@/components/ui/Pagination";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  PAGE_TITLES,
  SEARCH_COPY,
  documentTitle,
  resultsUpdatedAnnouncement,
  searchSummaryLabel,
} from "@/constants/content";
import { ROUTES, categoryPath } from "@/constants/routes";
import { CATEGORY_DEFINITIONS } from "@/constants/taxonomy";
import { ActiveFilters } from "@/features/search/ActiveFilters";
import { FilterPanel } from "@/features/search/FilterPanel";
import { SearchBar } from "@/features/search/SearchBar";
import { SortControl } from "@/features/search/SortControl";
import { highlightSegments, isBlankQuery, tokenise } from "@/lib/searchService";
import type { SearchSegment } from "@/lib/searchService";
import { useQuickAdd } from "@/state/CartContext";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { useDocumentTitle } from "@/state/hooks";
import { hasActiveFilters } from "@/utils/queryParams";

/*
 * Class contract: no stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class is consumed by name. `src/styles/layout.css` owns the page shell (`sp-container`, `sp-page`,
 * `sp-page__body`); `src/styles/catalog.css` owns this surface's own family: `sp-catalog-layout` is the frame
 * whose first child is the filter panel and whose second is this page's column, `sp-result-meta` is the
 * toolbar row the count and the sort share, `sp-result-count` is the register both of the surface's outcome
 * sentences wear, `sp-product-grid` is the result grid whose direct children are the tiles, and
 * `sp-no-results` wraps the empty state with the way out of it. Those children are `ProductCard`'s own
 * `<li>`s, so the grid is the list that holds them and carries `role="list"` for the marker-less treatment
 * `src/styles/base.css` gives one. The recovery chips are `sp-category-chips` and `sp-category-chip`, from the
 * landing sheet `catalog.css` loads with `@import`, and the heading that names the results region wears
 * `sp-visually-hidden`, the utility `src/styles/base.css` owns.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: closed — `src/styles/base.css` declares the element default a matched run once
 * lacked: its `:where(mark)` rule paints `mark` in --color-accent-subtle with --color-accent-contrast, so the
 * summary's marked run here and the suggestion list's own reach the page through tokens.css, never the engine.
 *
 * BLITZY [LAYOUT]: `.sp-result-meta`'s own comment expects the filter drawer's trigger in its row, but the
 * panel is rendered once, as `sp-catalog-layout`'s first child, which is where it is the sticky column from
 * the extra-large stop up — so below that stop the trigger stands above the results, not inside the toolbar.
 * Moving it would take a trigger prop on the panel or a second panel instance, which would put one panel's
 * controls and its open drawer into the document twice.
 *
 * BLITZY [COPY]: `src/constants/content.ts` holds no description for this route — its search wording names the
 * field, the filter panel and the chips — so the header carries the title and the action slot alone, and the
 * query summary carries the state of the search.
 *
 * The outcome sentence is the content library's own: `resultsUpdatedAnnouncement` in the toolbar's live region,
 * which is this page's only count region, and the pager is told so — its caption states that count beside the
 * page number while its own region speaks the page alone. No number is formatted here, because the sentence's
 * own template carries it and the catalogue holds three digits at most, so `src/utils/format.ts` is not
 * reached.
 */

/** The categories the empty state offers as a way back into the catalogue: the top level of the vocabulary
 *  `src/constants/taxonomy.ts` declares, read from it rather than restated, each one a chip that links to its
 *  own listing. */
const RECOVERY_CATEGORIES = CATEGORY_DEFINITIONS.filter((category) => category.parentSlug === null);

/** The trail this route carries: the landing page, the catalogue it browses, then the route itself, whose crumb
 *  carries no destination because the visitor is on it. The two paths come from the route vocabulary, so no
 *  path is written as a string here. */
const BREADCRUMBS: readonly BreadcrumbItem[] = [
  { label: PAGE_TITLES.HOME, to: ROUTES.HOME },
  { label: PAGE_TITLES.CATALOG, to: ROUTES.CATALOG },
  { label: PAGE_TITLES.SEARCH },
];

/**
 * The results while a page of them is on its way: the grid the answer will fill, holding one placeholder tile
 * per result the query asked for.
 *
 * It is the loaded grid's own markup and the loaded tile's own shape — a real `<ul>` whose items are the
 * placeholder `ProductCard` renders — so the region the skeleton reserves is the region the answer fills. The
 * count is the page size the query was paged by, because the count decides the height as much as the shape
 * does: a page of twelve is three rows of four, and a shorter band would grow the page under everything below
 * it when the products landed.
 *
 * Silent to assistive technology — every placeholder is hidden and the region around them reports the wait
 * with `aria-busy` — so a load is heard once, from the region's own state.
 *
 * @param props - The number of results the query paged by.
 * @returns The placeholder grid.
 */
function ResultPlaceholders({ count }: { readonly count: number }): ReactElement {
  const tiles = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : DEFAULT_PAGE_SIZE;
  return (
    <ul className="sp-product-grid" role="list">
      {Array.from({ length: tiles }, (_slot, index) => (
        <ProductCardPlaceholder key={`search-placeholder-${String(index)}`} />
      ))}
    </ul>
  );
}

/** Everything {@link SearchPage} accepts. */
export interface SearchPageProps {
  /** Extra classes for the page's own container, appended after the shell's, for a caller laying the route out
   *  inside something of its own. */
  readonly className?: string;
}

/**
 * The search route: the term, the facets, the sort and the page in the address bar, and the results they name.
 *
 * The URL is the single store of the query. This page reads it through `useCatalogFilters()` and writes it
 * only through that context's setters — each composing control calls the setter it needs for itself — so a
 * searched, filtered and paged address reloads to the identical result set and no filter value is mirrored
 * into React state. What it reads about the answer is `useCatalog()` alone: the page holds no state, issues no
 * request and recomputes no facet count, because the catalogue service answered with the facets it counted.
 * The one other thing it reads is the cart's add, taken through `useQuickAdd` in `src/state/CartContext.tsx`
 * and handed to the results' tiles: a tile is shared presentation and may not read the cart itself, and the
 * read sits with the component that maps the results rather than higher up, so a change to the cart
 * re-renders the results and not the toolbar, the facets or the summary above them.
 *
 * Its four data states are rendered in the order a load passes through them: the placeholder grid while a page
 * is on its way; the shaped failure with its retry when the request did not answer; the empty state with the
 * one action that helps when the query matched nothing; and otherwise the grid with its paging. The toolbar
 * above them stays usable throughout, so a shopper can refine the query that just failed.
 *
 * A term with nothing searchable in it filters nothing and is not an error, so it is not one of those states:
 * the catalogue stands as it does without a term, and the notice above the count says the address's term was
 * not applied rather than leaving the listing to read as its answer. That notice stands over all four states.
 *
 * Accessibility is structural: `PageHeader` renders the route's only `<h1>`, the filter panel's heading and
 * the results heading nest under it without skipping a level, the results region is named by a heading that is
 * present but not painted, the count is announced politely from a region that is present from the first
 * render, and every control composed here is a shared primitive, so its keyboard behaviour and its focus ring
 * are the primitive's own.
 *
 * @param props - Extra classes for the page's container. See {@link SearchPageProps}.
 * @returns The route: its heading block, the facet frame and the results.
 * @throws When rendered above every `CatalogProvider`: the query is that provider's store and there is none to
 *   read without it. The provider must itself be inside a router, because the store is the address bar.
 */
export function SearchPage({ className }: SearchPageProps): ReactElement {
  const view = useCatalog();
  const catalog = useCatalogFilters();
  const onAddToCart = useQuickAdd();
  const resultsHeadingId = useId();

  useDocumentTitle(documentTitle(PAGE_TITLES.SEARCH));

  const query = catalog.filters.q;
  // A term holding nothing searchable is the absence of a search rather than one, which is what makes this
  // route the whole catalogue when the address carries no term: the wording and the highlighting both follow
  // that reading, and neither of them re-splits or re-cases the text — `src/lib/searchService.ts` does.
  const isBrowsing = isBlankQuery(query);
  // A term the address carries that holds nothing searchable: no token survived tokenising, so nothing was
  // filtered by it. Without the notice below, the whole catalogue would read as that term's own answer.
  const isTermIgnored = query.trim() !== "" && isBrowsing;
  // The page in hand, and only while the last load did not fail: a failure is reported by the alert below, and
  // a count beside it would describe a query the surface could not answer.
  const answer = view.error === null ? view.page : null;
  const total = answer === null ? null : answer.total;
  // The summary sentence, absent until a page has settled: the library's templates carry the count, so there
  // is nothing to state before one is known.
  const summary =
    total === null
      ? null
      : isBrowsing
        ? CATALOG_COPY.ALL_PRODUCTS_HEADING
        : searchSummaryLabel(query, total);
  // Every value below is derived during render from the data the context already holds, so nothing is stored
  // and nothing needs memoising: the sentence's tokens and its marked runs are a few string operations on one
  // line of text, and the filter test is the query writer's own.
  const segments: readonly SearchSegment[] =
    summary === null ? [] : highlightSegments(summary, tokenise(query));
  const announcement = total === null ? "" : resultsUpdatedAnnouncement(total);
  const hasFilters = hasActiveFilters(catalog.filters);

  let body: ReactElement;

  if (view.isLoading) {
    body = <ResultPlaceholders count={catalog.filters.pageSize} />;
  } else if (view.error !== null) {
    body = (
      <Alert
        tone="danger"
        error={view.error}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={() => view.reload()}
      />
    );
  } else if (view.isEmpty) {
    body = (
      <div className="sp-no-results">
        {/* One control, and the one that helps: clearing the filters that emptied the result, or leaving the
            search for the catalogue when no filter was applying and the term alone matched nothing. The
            clearer removes the facets and keeps the term — the query writer's own rule — so on a term that
            matched nothing the action returns the state to its term-only form; the chip row below is the way
            into the catalogue from there, and a way out of every empty result. */}
        {hasFilters ? (
          <EmptyState
            headingLevel={2}
            title={EMPTY_STATES.searchResults.title}
            description={EMPTY_STATES.searchResults.description}
            actionLabel={EMPTY_STATES.catalogue.actionLabel}
            onAction={() => catalog.clearAll()}
          />
        ) : (
          <EmptyState surface="searchResults" headingLevel={2} actionHref={ROUTES.CATALOG} />
        )}
        <ul className="sp-category-chips" role="list">
          {RECOVERY_CATEGORIES.map((category) => (
            <li key={category.slug}>
              <Link className="sp-category-chip" to={categoryPath(category.slug)}>
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (answer !== null) {
    body = (
      <>
        {/* The tile is the list item — `ProductCard` renders its own `<li>` — so the grid is the list that
            holds them and carries `role="list"` for the marker-less treatment base.css gives one. Each tile
            is handed the cart's add, which is read above rather than inside the tile. */}
        <ul className="sp-product-grid" role="list">
          {answer.items.map((product) => (
            <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
          ))}
        </ul>
        <Pagination
          page={answer.page}
          pageSize={answer.pageSize}
          total={answer.total}
          pageCount={answer.pageCount}
          hasNext={answer.hasNext}
          hasPrevious={answer.hasPrevious}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(page) => catalog.setPage(page)}
          onPageSizeChange={(pageSize) => catalog.setPageSize(pageSize)}
          // The count region above is this page's, so the pager announces the page alone.
          isCountAnnouncedByCaller
        />
      </>
    );
  } else {
    // The load settled with neither a page nor a failure, so nothing is known yet: the placeholders stand
    // rather than an empty grid that would claim there are no results.
    body = <ResultPlaceholders count={catalog.filters.pageSize} />;
  }

  return (
    <div className={className === undefined ? "sp-container" : `sp-container ${className}`}>
      <div className="sp-page">
        <PageHeader title={PAGE_TITLES.SEARCH} breadcrumbs={BREADCRUMBS} actions={<SearchBar />} />
        <div className="sp-catalog-layout">
          {/* The panel renders itself once: the sticky column from the extra-large stop up, and its own
              focus-trapped drawer with its own trigger below it. */}
          <FilterPanel />
          <div className="sp-page__body">
            {/* A term the search could not use states that above the count, in the polite register the count
                itself speaks in, so the catalogue below is not read as an answer to the term. It stands over
                every state the results can be in, because the term was dropped whatever the catalogue then
                renders: the placeholders of a load, a failure, an empty result and the grid alike. */}
            {isTermIgnored ? (
              <Alert tone="info" title={SEARCH_COPY.QUERY_NOT_APPLIED_TITLE}>
                {SEARCH_COPY.QUERY_NOT_APPLIED_DESCRIPTION}
              </Alert>
            ) : null}
            {summary === null ? null : (
              <p className="sp-result-count">
                {segments.map((segment, position) =>
                  segment.matched ? (
                    // The run a query token matched. A summary is positional, so its position and its text
                    // identify it — the reading the suggestion list gives its own marked runs.
                    <mark key={`${position}:${segment.text}`}>{segment.text}</mark>
                  ) : (
                    <span key={`${position}:${segment.text}`}>{segment.text}</span>
                  ),
                )}
              </p>
            )}
            <div className="sp-result-meta">
              {/* Present from the first render and only ever given new text, because a region inserted at the
                  moment of the update is not announced reliably. This is the page's only count region, and
                  `Pagination` is told so, so the pager announces the page alone. */}
              <p className="sp-result-count" role="status">
                {announcement}
              </p>
              <SortControl isCompact />
            </div>
            <ActiveFilters />
            <section aria-labelledby={resultsHeadingId} aria-busy={view.isLoading}>
              <h2 className="sp-visually-hidden" id={resultsHeadingId}>
                {CATALOG_COPY.RESULTS_REGION_LABEL}
              </h2>
              {body}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
