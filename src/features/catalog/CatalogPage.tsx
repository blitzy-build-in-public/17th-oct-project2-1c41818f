/**
 * Path: src/features/catalog/CatalogPage.tsx
 * Purpose: Catalogue route for all products or one category, with facets, result count and pagination
 * Lines: 376
 */

import { useId, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import type { BreadcrumbItem } from "@/components/layout/PageHeader";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { useMediaQuery } from "@/components/ui/hooks";
import { Drawer } from "@/components/ui/Modal";
import { NotFoundView } from "@/components/ui/NotFoundView";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { CloseIcon } from "@/components/ui/Icons";
import { BREAKPOINTS, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  PAGE_TITLES,
  SEARCH_COPY,
  categoryPageHeading,
  documentTitle,
  productCountAnnouncement,
  removeFilterLabel,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, categoryPath } from "@/constants/routes";
import { SORT_OPTIONS } from "@/constants/taxonomy";
import { CLASSES, CatalogFilterRegion } from "@/features/catalog/CatalogFilterRegion";
import { ProductList } from "@/features/catalog/ProductList";
import { flattenCategoryTree, listCategories } from "@/lib/catalogReads";
import type { CatalogFilters } from "@/state/CatalogContext";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { handOffThen, useFocusHandoff } from "@/components/ui/focusHandoff";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { CategoryNode, Facet, FilterState } from "@/types/catalog";
import type { ApiError, AsyncStatus, CategoryId } from "@/types/common";
import { formatMoney, formatNumber } from "@/utils/format";
import {
  activeFilterEntries,
  clearAllFilters,
  clearFacet,
  countActiveFilters,
  filtersToPath,
  toggleFacetValue,
} from "@/utils/queryParams";
import type { ActiveFilterEntry } from "@/utils/queryParams";

/*
 * Class contract. This list is what the sheets owe the page, each class named with the sheet that declares
 * it: `layout.css` the shell, `catalog.css` and the `catalog-landing.css` it loads the catalogue's own
 * blocks, and `base.css` the visually-hidden one. Every primitive below paints itself, so no colour, radius,
 * shadow or media query is here.
 */

/** The stop the filter panel is a sticky column from and a drawer below, built from the configured token: the
 *  results column holds cards of their own 198px content width only while no facet column stands beside it, so the
 *  panel waits for the width the column and a row of the grid share, and CSS cannot evaluate a custom property
 *  inside a media query, which is why the width travels from `src/constants/config.ts`. */
const COLUMN_QUERY = `(min-width: ${BREAKPOINTS.XLARGE}px)`;

/** The identifiers a category's listing filters by: a parent's products are its subcategories' products, the
 *  seeded catalogue assigning every product to a leaf, so a parent scopes by the leaves beneath it and a category
 *  with none scopes by itself. The identifiers are the data's own, never derived from the slug here, so a
 *  category the endpoint does not hold cannot be filtered for. */
function categoryScopeIds(category: CategoryNode): readonly CategoryId[] {
  if (category.children.length === 0) return [category.id];
  return category.children.map((child) => child.id);
}

/** One chip's text: a vocabulary label, a facet term's name, or a price range's formatted bounds. */
function chipText(
  entry: ActiveFilterEntry,
  facets: readonly Facet[],
  filters: FilterState,
): string {
  if (entry.kind === "tag") return entry.value;
  if (entry.label !== null) return entry.label;
  if (entry.facetId === "price") {
    const { minPriceMinor, maxPriceMinor } = filters;
    if (minPriceMinor !== null && maxPriceMinor !== null) {
      return `${formatMoney(minPriceMinor)} – ${formatMoney(maxPriceMinor)}`;
    }
    return formatMoney(minPriceMinor ?? maxPriceMinor);
  }
  const term = facets
    .find((facet) => facet.id === entry.facetId)
    ?.values.find((value) => value.value === entry.value);
  return term?.label ?? entry.value;
}

/**
 * The catalogue route: every product, or one category's, under the facets, the sort and the page its address
 * names. The URL is the single store of the query, so the route keeps no filter value and issues no request:
 * it reads `useCatalogFilters()` and `useCatalog()`, and it writes only through the provider's setters, each
 * of which navigates. The one state it holds is whether the small-screen drawer is open. A category URL
 * entered without a category selection has the route's own scope written into the query — `Navigate` does that
 * declaratively, so it is not a render-side effect, and a selection already in the address bar is the
 * visitor's own and is left alone — which is what makes the header, the chips, the facet counts and the
 * listing describe one query, and a reloaded URL return the identical result set; a write that would empty
 * that scope hands off to the catalogue route rather than being undone by the guard. A parent scopes by its
 * subcategories, every seeded product sitting in a leaf. The results render in the order a load passes through
 * them: the placeholder grid, the shaped failure with its retry, the empty state offering the one action that
 * helps, then the results with their paging. An address naming no category the catalogue holds is not this
 * page's heading over a listing with nothing in it — the listing has no scope to serve — so it renders the
 * shared not-found view in place of the whole page, and the route's single `h1` names the state the visitor is
 * actually in.
 * @returns The route: its heading block, the filter region in one of its two placements, and the results.
 * @throws When rendered above every `CatalogProvider`, which must itself be inside a router.
 */
export function CatalogPage(): ReactElement {
  const params = useParams();
  const { pathname } = useLocation();
  const slug = (params[ROUTE_PARAMS.CATEGORY_SLUG] ?? "").trim();

  const view = useCatalog();
  const writers = useCatalogFilters();
  const filters = writers.filters;
  const navigate = useNavigate();
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const isColumn = useMediaQuery(COLUMN_QUERY);
  const panelId = useId();
  const resultsHeadingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The two regions these actions hand the focus to: the page body (the chips and the results) and, while the
  // open drawer has made the body inert, the filter panel's own container.
  const { regionRef, handOffFocus } = useFocusHandoff<HTMLDivElement>(undefined, panelRef);
  const clearAll = handOffThen(handOffFocus, () => catalog.clearAll());
  const changePageSize = handOffThen(handOffFocus, (size: number) => catalog.setPageSize(size));

  // The category read feeds the heading, the trail, the subcategory chips and the scope of the listing, so it
  // runs only on the route that names a category. It comes from `src/lib/catalogReads.ts` — the catalogue's own
  // service surface, so this file names no endpoint — and a failure there is folded into the page's own error
  // state rather than replacing the catalogue the visitor asked for.
  const categories = useAsync<CategoryNode[]>((signal) => listCategories({ signal }), [], {
    enabled: slug !== "",
  });
  const categoryTree = categories.data === null ? [] : flattenCategoryTree(categories.data);
  const category = slug === "" ? null : (categoryTree.find((node) => node.slug === slug) ?? null);
  const isResolvingCategory =
    slug !== "" && (categories.status === "idle" || categories.status === "loading");
  const isUnknownCategory = slug !== "" && categories.status === "success" && category === null;

  // The tab names what the page shows, the refusal included for a category the catalogue does not hold.
  const pageTitle = isUnknownCategory
    ? PAGE_TITLES.NOT_FOUND
    : category === null
      ? PAGE_TITLES.CATALOG
      : PAGE_TITLES.CATEGORY;
  useDocumentTitle(documentTitle(pageTitle));

  if (category !== null && filters.categoryIds.length === 0) {
    const scoped: FilterState = { ...filters, categoryIds: [...categoryScopeIds(category)] };
    return <Navigate replace to={filtersToPath(pathname, scoped)} />;
  }

  // An address naming a category the catalogue does not hold is the not-found state and not this page showing
  // nothing: the listing has no scope to serve, so the page's header would name a page the visitor never asked
  // for. It renders the one shared view, in place of the header and the whole listing region, which is what
  // keeps the route's single `h1` describing what is on screen. The title above is set before this return and
  // is left as it is, because the state a visitor is looking at is the one the tab must name.
  if (isUnknownCategory) return <NotFoundView />;

  // A write that would leave this category route unscoped hands off to the catalogue route: the guard above puts
  // the scope back into any category-less URL, so a control that cleared the scope would appear to do nothing.
  // The next state is the query writer's own, so the term, the sort and the page size cross the hand-off with it.
  const write = (next: FilterState, set: () => void): void =>
    category !== null && next.categoryIds.length === 0
      ? void navigate(filtersToPath(ROUTES.CATALOG, next), { replace: true })
      : set();
  // Every control writes through this object, whose three scope-emptying setters go through `write`.
  const catalog: CatalogFilters = {
    ...writers,
    toggleFacet: (facetId, value) =>
      write(toggleFacetValue(filters, facetId, value), () => writers.toggleFacet(facetId, value)),
    clearFacet: (facetId) => write(clearFacet(filters, facetId), () => writers.clearFacet(facetId)),
    clearAll: () => write(clearAllFilters(filters), () => writers.clearAll()),
  };

  const failure: ApiError | null = categories.error ?? view.error;
  // A read counts as unfinished both before its load is issued — `view.query` is null while the view describes
  // no request for the query the address bar names, which is the commit in which the URL has moved on — and
  // while that load is in flight, because the page the view holds is the previous answer's until this read
  // settles. Stating that retained page's total under this query's scope is what would pair one query's count
  // with another query's wording.
  const isAnswerCurrent = view.query !== null;
  const isReading = isResolvingCategory || view.isLoading || !isAnswerCurrent;
  const answer = failure === null && !isReading ? view.page : null;
  const status: AsyncStatus = isReading ? "loading" : failure !== null ? "error" : view.status;
  const total = answer === null ? null : answer.total;
  const appliedCount = countActiveFilters(filters);
  const entries = activeFilterEntries(filters);
  const title = category === null ? PAGE_TITLES.CATALOG : categoryPageHeading(category.name);
  const breadcrumbs: readonly BreadcrumbItem[] | undefined =
    category === null
      ? undefined
      : [
          { label: PAGE_TITLES.HOME, to: ROUTES.HOME },
          { label: PAGE_TITLES.CATALOG, to: ROUTES.CATALOG },
          { label: category.name },
        ];
  // A parent's subcategories, or a child's siblings: the one stood in is marked by the router's own attribute.
  const relatedCategories: readonly CategoryNode[] =
    category === null
      ? []
      : category.parentId === null
        ? category.children
        : (categoryTree.find((node) => node.id === category.parentId)?.children ?? []);
  const panel = (
    <CatalogFilterRegion
      facets={view.facets}
      filters={filters}
      catalog={catalog}
      isReading={isReading}
      isDrawer={!isColumn}
      id={panelId}
      focusTargetRef={regionRef}
      fallbackRef={panelRef}
    />
  );
  const clearAllAction =
    appliedCount === 0 ? null : (
      <Button className={CLASSES.clear} variant="link" size="sm" onClick={clearAll}>
        {COMMON_ACTIONS.CLEAR_ALL}
      </Button>
    );

  return (
    <div className="sp-container">
      <div className="sp-page">
        <PageHeader
          breadcrumbs={breadcrumbs}
          title={title}
          description={category === null ? undefined : category.description}
          actions={
            isColumn ? null : (
              <Button
                className="sp-facets__toggle"
                variant="secondary"
                size="sm"
                aria-expanded={isDrawerOpen}
                // The reference exists while the panel does: collapsed, no element carries that id.
                aria-controls={isDrawerOpen ? panelId : undefined}
                onClick={() => setDrawerOpen(true)}
              >
                {SEARCH_COPY.OPEN_FILTERS_LABEL}
                {appliedCount > 0 ? ` ${formatNumber(appliedCount)}` : null}
              </Button>
            )
          }
        />
        {relatedCategories.length === 0 ? null : (
          <ul className="sp-category-chips">
            {relatedCategories.map((node) => (
              <li key={node.id}>
                <Link
                  className="sp-category-chip"
                  to={categoryPath(node.slug)}
                  aria-current={node.id === category?.id ? "page" : undefined}
                >
                  {node.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="sp-catalog-layout">
          {isColumn ? panel : null}
          <div className="sp-page__body" ref={regionRef} tabIndex={-1}>
            <div className="sp-result-meta">
              {/* Present from the first render and only ever given new text, because a region inserted at
                  the moment of the update is not announced reliably. This is the page's only count region;
                  `Pagination` is told so, so it states that figure and announces the page alone. */}
              <p className="sp-result-count" role="status">
                {total === null ? "" : productCountAnnouncement(total)}
              </p>
              <Select
                containerClassName="sp-sort"
                label={CATALOG_COPY.SORT_GROUP_LABEL}
                options={SORT_OPTIONS}
                value={filters.sort}
                // The value is looked up among the vocabulary's own keys rather than cast, so a value the
                // control did not offer is ignored and the URL keeps the sort it holds.
                onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                  const chosen = SORT_OPTIONS.find((option) => option.value === event.target.value);
                  if (chosen !== undefined) catalog.setSort(chosen.value);
                }}
              />
            </div>
            {entries.length === 0 ? null : (
              <ul className="sp-active-filters" aria-label={SEARCH_COPY.ACTIVE_FILTERS_HEADING}>
                {entries.map((entry) => {
                  const text = chipText(entry, view.facets, filters);
                  const key =
                    entry.kind === "tag" ? `tag:${entry.value}` : `${entry.facetId}:${entry.value}`;
                  return (
                    <li className="sp-active-filters__chip" key={key}>
                      <span>{text}</span>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        label={removeFilterLabel(text)}
                        icon={<CloseIcon />}
                        onClick={handOffThen(handOffFocus, () => {
                          // Each chip removes the single value its label names, through the writer's own
                          // accessor for that facet: clearing a whole facet is the facet group's own clear
                          // action, and clearing everything is "Clear all".
                          if (entry.kind === "tag") catalog.toggleTag(entry.value);
                          else catalog.toggleFacet(entry.facetId, entry.value);
                        })}
                      />
                    </li>
                  );
                })}
                <li className="sp-active-filters__clear-all">{clearAllAction}</li>
              </ul>
            )}
            <section aria-labelledby={resultsHeadingId} aria-busy={isReading}>
              <h2 className="sp-visually-hidden" id={resultsHeadingId}>
                {CATALOG_COPY.RESULTS_REGION_LABEL}
              </h2>
              <ProductList
                items={answer === null ? [] : answer.items}
                status={status}
                error={failure}
                // The placeholder tiles stand in at the page size the query asked for, so the skeleton
                // reserves exactly the region the answer fills and nothing below it moves.
                placeholderCount={filters.pageSize}
                onRetry={handOffThen(handOffFocus, () => {
                  if (categories.error === null) view.reload();
                  else categories.reload();
                })}
                emptyAction={clearAllAction ?? undefined}
              />
              {/* The paging belongs to the answer, so it is held back while a new one is on its way: the page
                  in hand is the previous query's until this one lands. */}
              {isReading || answer === null || answer.total === 0 ? null : (
                <Pagination
                  page={answer.page}
                  pageSize={answer.pageSize}
                  total={answer.total}
                  pageCount={answer.pageCount}
                  hasNext={answer.hasNext}
                  hasPrevious={answer.hasPrevious}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageChange={handOffThen(handOffFocus, (page) => catalog.setPage(page))}
                  onPageSizeChange={changePageSize}
                  // The count region above is this page's, so the pager announces the page alone.
                  isCountAnnouncedByCaller
                />
              )}
            </section>
          </div>
        </div>
      </div>
      {isColumn ? null : (
        <Drawer
          isOpen={isDrawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={SEARCH_COPY.FILTER_PANEL_HEADING}
          closeLabel={SEARCH_COPY.CLOSE_FILTERS_LABEL}
          side="start"
          footer={clearAllAction}
        >
          {panel}
        </Drawer>
      )}
    </div>
  );
}
