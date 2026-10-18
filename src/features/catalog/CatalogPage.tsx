/**
 * Path: src/features/catalog/CatalogPage.tsx
 * Purpose: Catalogue route for all products or one category, with facets, result count and pagination
 * Lines: 585
 */

import { useId, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import type { BreadcrumbItem } from "@/components/layout/PageHeader";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { useMediaQuery } from "@/components/ui/hooks";
import { Drawer } from "@/components/ui/Modal";
import { NotFoundView } from "@/components/ui/NotFoundView";
import { Pagination } from "@/components/ui/Pagination";
import { Checkbox, RadioGroup, Select, Switch } from "@/components/ui/Select";
import { CloseIcon } from "@/components/ui/icons";
import { BREAKPOINTS, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FACET_ANY_LABELS,
  PAGE_TITLES,
  SEARCH_COPY,
  categoryPageHeading,
  clearFacetLabel,
  documentTitle,
  productCountAnnouncement,
  productCountLabel,
  removeFilterLabel,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, categoryPath } from "@/constants/routes";
import { FACET_DEFINITIONS, SORT_OPTIONS } from "@/constants/taxonomy";
import type { FacetDefinition } from "@/constants/taxonomy";
import { ProductList } from "@/features/catalog/ProductList";
import { flattenCategoryTree, listCategories } from "@/lib/catalogReads";
import type { CatalogFilters } from "@/state/CatalogContext";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { CategoryNode, Facet, FilterState } from "@/types/catalog";
import type { ApiError, AsyncStatus, CategoryId } from "@/types/common";
import { indexBy } from "@/utils/collections";
import { formatMoney, formatNumber } from "@/utils/format";
import {
  activeFilterEntries,
  clearAllFilters,
  clearFacet,
  countActiveFilters,
  facetValueMatches,
  filtersToPath,
  toggleFacetValue,
} from "@/utils/queryParams";
import type { ActiveFilterEntry } from "@/utils/queryParams";

/*
 * Class contract: no stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class below is consumed by name from the sheet that owns it: `layout.css` the shell, `catalog.css` and the
 * `catalog-landing.css` it loads the catalogue's own blocks, and `base.css` the visually-hidden one. Every
 * primitive below paints itself, so no colour, radius, shadow or media query is here.
 */

/** The classes used more than once, written once so a sheet rename is one edit. */
const CLASSES = {
  column: "sp-facets",
  group: "sp-facets__group",
  legend: "sp-facets__legend",
  value: "sp-facets__value",
  label: "sp-facets__label",
  count: "sp-facets__count",
  clear: "sp-facets__clear",
} as const;

/** The stop the filter panel is a sticky column from and a drawer below, built from the configured token: the
 *  results column holds cards of their own 198px content width only while no facet column stands beside it, so the
 *  panel waits for the width the column and a row of the grid share, and CSS cannot evaluate a custom property
 *  inside a media query, which is why the width travels from `src/constants/config.ts`. */
const COLUMN_QUERY = `(min-width: ${BREAKPOINTS.XLARGE}px)`;

/** The value that means "no value": the state choice a single-choice facet's group opens with. */
const ANY_VALUE = "";

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

/** Everything {@link FacetValues} renders from. */
interface FacetValuesProps {
  readonly facet: Facet;
  readonly filters: FilterState;
  readonly onToggle: (value: string) => void;
}

/**
 * One facet's values as a multi-select list — the terms a category or a brand is chosen by — each with the count
 * `src/lib/catalogService.ts` computed with this facet's own selection excluded, so choosing one value leaves its
 * siblings' counts meaningful. Nothing is counted here, and a value the filters have emptied keeps its place and
 * its zero, disabled while it is not selected; the count is text, part of its control's accessible name.
 */
function FacetValues({ facet, filters, onToggle }: FacetValuesProps): ReactElement {
  return (
    <ul className="sp-facets__values">
      {facet.values.map((value) => {
        const isSelected = facetValueMatches(filters, facet.id, value.value);
        return (
          <li className={CLASSES.value} key={value.value}>
            <Checkbox
              containerClassName={CLASSES.label}
              label={value.label}
              aria-label={`${value.label} · ${productCountLabel(value.count)}`}
              checked={isSelected}
              isDisabled={value.count === 0 && !isSelected}
              onChange={() => onToggle(value.value)}
            />
            <span className={CLASSES.count}>{formatNumber(value.count)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Everything {@link CatalogFilterRegion} is handed. */
interface FilterRegionProps {
  readonly facets: readonly Facet[];
  readonly filters: FilterState;
  readonly catalog: CatalogFilters;
  readonly isReading: boolean;
  readonly isDrawer: boolean;
  readonly id: string;
}

/**
 * The filter region: the five facet groups of `src/constants/taxonomy.ts` over the catalogue's own facet
 * response, as the sticky first column of `.sp-catalog-layout` from the extra-large stop up and the caller's
 * focus-trapped drawer below it.
 *
 * The region is composed here rather than imported from the search slice's `FilterPanel.tsx`, which one feature may
 * not reach into, and applies no rule of its own: `src/lib/catalogService.ts` counts the facets,
 * `src/constants/taxonomy.ts` declares the vocabulary, and the setters it is handed own the query, so nothing is
 * mirrored into state. A facet that has not arrived renders its placeholder, a settled response holding no value
 * says what that means, and each facet carries the action that resets it alone while the query applies it.
 */
function CatalogFilterRegion({
  facets,
  filters,
  catalog,
  isReading,
  isDrawer,
  id,
}: FilterRegionProps): ReactElement {
  const applied = activeFilterEntries(filters);
  const clearAllAction =
    applied.length === 0 ? null : (
      <Button className={CLASSES.clear} variant="link" size="sm" onClick={() => catalog.clearAll()}>
        {COMMON_ACTIONS.CLEAR_ALL}
      </Button>
    );

  // A facet's state and value come from the query writer's chip list, so the panel and the chips agree.
  const appliedEntryOf = (facetId: FacetDefinition["id"]): ActiveFilterEntry | undefined =>
    applied.find((entry) => entry.kind === "facet" && entry.facetId === facetId);

  const clearFacetAction = (definition: FacetDefinition): ReactNode =>
    appliedEntryOf(definition.id) !== undefined ? (
      <Button
        className={CLASSES.clear}
        variant="link"
        size="sm"
        aria-label={clearFacetLabel(definition.label)}
        onClick={() => catalog.clearFacet(definition.id)}
      >
        {COMMON_ACTIONS.CLEAR}
      </Button>
    ) : null;

  const group = (definition: FacetDefinition, control: ReactNode): ReactElement => (
    <fieldset className={CLASSES.group} key={definition.id}>
      <legend className={CLASSES.legend}>{definition.label}</legend>
      {control}
      {clearFacetAction(definition)}
    </fieldset>
  );

  const renderFacet = (definition: FacetDefinition): ReactElement | null => {
    const facet = facets.find((candidate) => candidate.id === definition.id);
    if (facet === undefined) {
      // No answer for this facet yet: the placeholder shaped like the group it stands in for, and nothing at all
      // once the read has settled without one.
      return isReading ? (
        <div className={CLASSES.group} key={definition.id}>
          <Skeleton variant="text" lines={4} />
        </div>
      ) : null;
    }
    const values = (
      <FacetValues
        facet={facet}
        filters={filters}
        onToggle={(value) => catalog.toggleFacet(definition.id, value)}
      />
    );

    switch (definition.kind) {
      // The price bands and the rating floors are chosen one at a time through the single-choice group below, whose
      // `RadioGroup` legend names it, so no two contradictory bands apply; the bounds stay the query writer's rule
      // — floored, clamped, swapped on read — while the catalogue's own terms keep the list.
      case "terms":
      case "range": {
        if (definition.options === undefined) return group(definition, values);
        const counts = indexBy(facet.values, (value) => value.value);
        const anyLabel =
          definition.id === "price" ? FACET_ANY_LABELS.price : FACET_ANY_LABELS.rating;
        return (
          <div className={CLASSES.group} key={definition.id}>
            <RadioGroup
              name={`${definition.id}-filter`}
              legend={definition.label}
              value={appliedEntryOf(definition.id)?.value ?? ANY_VALUE}
              options={[
                { value: ANY_VALUE, label: anyLabel },
                ...facet.values.map((value) => ({
                  value: value.value,
                  label: value.label,
                  disabled: value.count === 0 && !facetValueMatches(filters, facet.id, value.value),
                })),
              ]}
              onChange={(value) =>
                catalog.setFacetValue(definition.id, value === ANY_VALUE ? null : value)
              }
              renderOptionLabel={(option) => {
                const entry = counts.get(option.value);
                if (entry === undefined) return option.label;
                // The count is rendered inside the option's own label, so it is part of the control's name.
                return (
                  <>
                    {option.label} {"\u00b7 "}
                    <span className={CLASSES.count}>{formatNumber(entry.count)}</span>
                  </>
                );
              }}
            />
            {clearFacetAction(definition)}
          </div>
        );
      }
      case "boolean": {
        const value = facet.values[0];
        return value === undefined
          ? null
          : group(
              definition,
              <div className={CLASSES.value}>
                <Switch
                  containerClassName={CLASSES.label}
                  label={value.label}
                  aria-label={`${value.label} · ${productCountLabel(value.count)}`}
                  checked={filters.inStockOnly}
                  onChange={(inStockOnly) => catalog.setInStockOnly(inStockOnly)}
                />
                <span className={CLASSES.count}>{formatNumber(value.count)}</span>
              </div>,
            );
      }
    }
  };

  const groups = FACET_DEFINITIONS.map(renderFacet);
  const holdsValues = facets.some((facet) => facet.values.length > 0);
  // No facet value at all is said once, not as five empty headings: the listing carries the action.
  const content: ReactNode =
    !isReading && !holdsValues ? (
      <EmptyState
        title={EMPTY_STATES.catalogue.title}
        description={EMPTY_STATES.catalogue.description}
      />
    ) : (
      groups
    );

  return (
    <div className={isDrawer ? `${CLASSES.column} sp-facets--drawer` : CLASSES.column} id={id}>
      <div className="sp-facets__panel">
        {isDrawer ? null : <h2 className={CLASSES.legend}>{SEARCH_COPY.FILTER_PANEL_HEADING}</h2>}
        {isDrawer ? null : clearAllAction}
        {content}
      </div>
    </div>
  );
}

/**
 * The catalogue route: every product, or one category's, under the facets, the sort and the page the address bar
 * names.
 *
 * The URL is the single store of the query, so the route keeps no filter value and issues no request: it reads
 * `useCatalogFilters()` and `useCatalog()`, and it writes only through the provider's setters, each of which
 * navigates. The one state it holds is whether the small-screen drawer is open. A category URL entered without a
 * category selection has the route's own scope written into the query — `Navigate` does that declaratively, so it
 * is not a render-side effect, and a selection already in the address bar is the visitor's own and is left alone —
 * which is what makes the header, the chips, the facet counts and the listing describe one query, and a reloaded
 * URL return the identical result set; a write that would empty that scope hands off to the catalogue route rather
 * than being undone by the guard. A parent scopes by its subcategories, every seeded product sitting in a leaf.
 * The results render in the order a load passes through them: the placeholder grid, the shaped failure with its
 * retry, the empty state offering the one action that helps, then the results with their paging. An address naming
 * no category the catalogue holds is not this page's heading over a listing with nothing in it — the listing has
 * no scope to serve — so it renders the shared not-found view in place of the whole page, and the route's single
 * `h1` names the state the visitor is actually in.
 *
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
  const isReading = isResolvingCategory || view.isLoading;
  const answer = failure === null && !isResolvingCategory ? view.page : null;
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
  // A parent's subcategories, or, on a child, the siblings it shares a parent with: the one the visitor stands
  // in marked as the current page by the router's own attribute, which is what the chip sheet colours.
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
    />
  );
  const clearAllAction =
    appliedCount === 0 ? null : (
      <Button className={CLASSES.clear} variant="link" size="sm" onClick={() => catalog.clearAll()}>
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
          <div className="sp-page__body">
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
                        onClick={() => {
                          // Each chip removes the single value its label names, through the writer's own
                          // accessor for that facet: clearing a whole facet is the facet group's own clear
                          // action, and clearing everything is "Clear all".
                          if (entry.kind === "tag") catalog.toggleTag(entry.value);
                          else catalog.toggleFacet(entry.facetId, entry.value);
                        }}
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
                onRetry={() => {
                  if (categories.error === null) view.reload();
                  else categories.reload();
                }}
                emptyAction={clearAllAction ?? undefined}
              />
              {/* The paging belongs to the answer, so it is held back until that answer lands. */}
              {isReading || answer === null || answer.total === 0 ? null : (
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
