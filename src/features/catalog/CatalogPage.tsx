/**
 * Path: src/features/catalog/CatalogPage.tsx
 * Purpose: Catalogue route for all products or one category, with facets, result count and pagination
 * Lines: 594
 */

import { useId, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

import type { BreadcrumbItem } from "@/components/layout/PageHeader";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Drawer } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Checkbox, RadioGroup, Select, Switch } from "@/components/ui/Select";
import { BREAKPOINTS, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  NOT_FOUND_COPY,
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
import { API_PATHS, getJson } from "@/lib/apiClient";
import type { CatalogFilters } from "@/state/CatalogContext";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { useAsync, useDocumentTitle, useMediaQuery } from "@/state/hooks";
import type { CategoryNode, Facet, FilterState } from "@/types/catalog";
import type { ApiError, AsyncStatus, CategoryId } from "@/types/common";
import { indexBy } from "@/utils/collections";
import { formatMoney, formatNumber } from "@/utils/format";
import {
  activeFilterEntries,
  countActiveFilters,
  facetValueMatches,
  filtersToPath,
} from "@/utils/queryParams";
import type { ActiveFilterEntry } from "@/utils/queryParams";

/*
 * Class contract: no stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class below is consumed by name. `src/styles/layout.css` owns the shell (`sp-container`, `sp-page`,
 * `sp-page__body`); `src/styles/catalog.css` owns `sp-catalog-layout`, `sp-facets` with its `--drawer` reset and
 * its `__panel`, `__group`, `__legend`, `__values`, `__value`, `__label`, `__count`, `__clear` and `__toggle`
 * parts, `sp-result-meta` with `sp-result-count` and `sp-sort`, and the `sp-active-filters` row with its `__chip`
 * and `__clear-all` cells; `src/styles/catalog-landing.css`, which catalog.css loads, owns `sp-category-chips`
 * and `sp-category-chip`, the subcategory row the router's `aria-current` marks; `src/styles/base.css` owns
 * `sp-visually-hidden`. Every primitive below paints itself, so no colour, radius, shadow or media query is here.
 */

/** The classes used more than once, written once so a sheet rename is one edit; a class this file names once is
 *  written where it is used. */
const CLASSES = {
  column: "sp-facets",
  group: "sp-facets__group",
  legend: "sp-facets__legend",
  value: "sp-facets__value",
  label: "sp-facets__label",
  count: "sp-facets__count",
  clear: "sp-facets__clear",
} as const;

/** The stop the filter panel is a sticky column from and a drawer below, built from the configured token: CSS
 *  cannot evaluate a custom property inside a media query, so the width travels from `src/constants/config.ts`. */
const COLUMN_QUERY = `(min-width: ${BREAKPOINTS.MEDIUM}px)`;

/** The value a single-choice facet carries to mean "no value": the choice that clears the rating filter. */
const ANY_VALUE = "";

/** Every category of the tree `GET /api/categories` answers with, each parent followed by its own children: the
 *  endpoint returns the two-level tree, so a route carrying a child's slug resolves only after the walk, and no
 *  level is re-sorted because each already arrives in `position` order. */
function flattenCategories(nodes: readonly CategoryNode[]): readonly CategoryNode[] {
  return nodes.flatMap((node) => [node, ...node.children]);
}

/** The identifiers a category's listing filters by: a parent's products are its subcategories' products, the
 *  seeded catalogue assigning every product to a leaf, so a parent scopes by the leaves beneath it and a category
 *  with none scopes by itself. The identifiers are the data's own, never derived from the slug here, so a
 *  category the endpoint does not hold cannot be filtered for. */
function categoryScopeIds(category: CategoryNode): readonly CategoryId[] {
  if (category.children.length === 0) return [category.id];
  return category.children.map((child) => child.id);
}

/** The chip's remove control glyph: decorative, because the control carrying it owns the accessible name. */
function DismissGlyph(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        d="M6 6 18 18M18 6 6 18"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={2}
      />
    </svg>
  );
}

/** One applied filter's chip text: the vocabulary's wording, a term's name as the facet response labels it (the
 *  taxonomy declares none for a category or a brand), or a price range's bounds through `src/utils/format.ts`. */
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
 * One facet's values as a multi-select list — the terms a category or a brand is chosen by, and the price bands
 * the range facet declares — each with the count `src/lib/catalogService.ts` already computed with this facet's
 * own selection excluded, so choosing one value leaves its siblings' counts meaningful. Nothing is counted,
 * filtered or intersected here. A count is text and part of its control's accessible name, never colour or width
 * alone, and a value the filters have emptied keeps its place and its zero, disabled while it is not selected.
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
 * response, as the sticky first column of `.sp-catalog-layout` from the medium stop up and inside the caller's
 * focus-trapped drawer below it.
 *
 * The region is composed here rather than imported from the search slice's `FilterPanel.tsx`, which one feature
 * may not reach into: it applies no rule of its own — `src/lib/catalogService.ts` counts the facets,
 * `src/constants/taxonomy.ts` declares the vocabulary, and `src/utils/queryParams.ts` owns the query — and writes
 * only through the provider's setters, mirroring nothing into state. A facet that has not arrived renders the
 * placeholder shaped like it; a settled response holding no value at all says what that means; and each facet
 * carries the action that resets it alone while the query applies it.
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

  // Whether a facet is applied is asked of the query writer's own chip list rather than of a rule restated here,
  // so this answer and the chips above the results cannot disagree about what is applied.
  const isApplied = (facetId: FacetDefinition["id"]): boolean =>
    applied.some((entry) => entry.kind === "facet" && entry.facetId === facetId);

  const clearFacetAction = (definition: FacetDefinition): ReactNode =>
    isApplied(definition.id) ? (
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
      // The rating facet is the single-choice list of the star floors the vocabulary declares, opened by the
      // choice that clears it and named by the radio group's own legend, so one legend names the group. The
      // facets whose terms the catalogue answers with are combined several at a time, as are the price bands a
      // range declares, so those share one multi-select.
      case "terms":
      case "range": {
        if (definition.id !== "rating") return group(definition, values);
        const counts = indexBy(facet.values, (value) => value.value);
        return (
          <div className={CLASSES.group} key={definition.id}>
            <RadioGroup
              name={`${definition.id}-filter`}
              legend={definition.label}
              value={filters.minRating === null ? ANY_VALUE : String(filters.minRating)}
              options={[
                { value: ANY_VALUE, label: clearFacetLabel(definition.label) },
                ...facet.values.map((value) => ({
                  value: value.value,
                  label: value.label,
                  disabled: value.count === 0 && !facetValueMatches(filters, facet.id, value.value),
                })),
              ]}
              onChange={(value) => catalog.setRating(value === ANY_VALUE ? null : Number(value))}
              renderOptionLabel={(option) => {
                const entry = counts.get(option.value);
                if (entry === undefined) return option.label;
                // Each count is rendered through the option's own label node, so the number a floor would
                // leave is part of the control's name rather than a decoration beside it.
                return (
                  <>
                    {option.label} {"· "}
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
  // A settled response holding no facet value at all is said once rather than shown as five empty headings; the
  // listing beside it carries the action that helps, so this notice offers none.
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
 * URL return the identical result set. A parent scopes by its subcategories, every seeded product sitting in a
 * leaf. The results render in the order a load passes through them: the placeholder grid, the shaped failure with
 * its retry, the empty state offering the one action that helps, then the results with their paging.
 *
 * @returns The route: its heading block, the filter region in one of its two placements, and the results.
 * @throws When rendered above every `CatalogProvider`, whose store is the address bar and which must itself be
 *   inside a router.
 */
export function CatalogPage(): ReactElement {
  const params = useParams();
  const { pathname } = useLocation();
  const slug = (params[ROUTE_PARAMS.CATEGORY_SLUG] ?? "").trim();

  const view = useCatalog();
  const catalog = useCatalogFilters();
  const filters = catalog.filters;
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const isColumn = useMediaQuery(COLUMN_QUERY);
  const panelId = useId();
  const resultsHeadingId = useId();

  // The category read feeds the heading, the trail, the subcategory chips and the scope of the listing, so it
  // runs only on the route that names a category. A failure there is folded into the page's own error state
  // rather than replacing the catalogue the visitor asked for.
  const categories = useAsync<CategoryNode[]>(
    (signal) => getJson<CategoryNode[]>(API_PATHS.CATEGORIES, { signal }),
    [],
    { enabled: slug !== "" },
  );
  const categoryTree = categories.data === null ? [] : flattenCategories(categories.data);
  const category = slug === "" ? null : (categoryTree.find((node) => node.slug === slug) ?? null);
  const isResolvingCategory =
    slug !== "" && (categories.status === "idle" || categories.status === "loading");
  const isUnknownCategory = slug !== "" && categories.status === "success" && category === null;

  // The tab names what the page shows, the refusal included when the address names a category the catalogue
  // does not hold.
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
  const panel = isUnknownCategory ? null : (
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
            panel === null || isColumn ? null : (
              <Button
                className="sp-facets__toggle"
                variant="secondary"
                size="sm"
                aria-expanded={isDrawerOpen}
                aria-controls={panelId}
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
            {isUnknownCategory ? (
              <EmptyState
                title={NOT_FOUND_COPY.TITLE}
                description={NOT_FOUND_COPY.BODY}
                actionLabel={NOT_FOUND_COPY.ACTION_LABEL}
                actionHref={ROUTES.CATALOG}
              />
            ) : (
              <>
                <div className="sp-result-meta">
                  {/* Present from the first render and only ever given new text, because a region inserted at
                      the moment of the update is not announced reliably. This is the page's only count region;
                      `Pagination` announces the same figure beside the page number. */}
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
                      const chosen = SORT_OPTIONS.find(
                        (option) => option.value === event.target.value,
                      );
                      if (chosen !== undefined) catalog.setSort(chosen.value);
                    }}
                  />
                </div>
                {entries.length === 0 ? null : (
                  <ul className="sp-active-filters" aria-label={SEARCH_COPY.ACTIVE_FILTERS_HEADING}>
                    {entries.map((entry) => {
                      const text = chipText(entry, view.facets, filters);
                      const key =
                        entry.kind === "tag"
                          ? `tag:${entry.value}`
                          : `${entry.facetId}:${entry.value}`;
                      return (
                        <li className="sp-active-filters__chip" key={key}>
                          <span>{text}</span>
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            label={removeFilterLabel(text)}
                            icon={<DismissGlyph />}
                            onClick={() => {
                              // The facet clears as a whole — the action `clearFacet` is — so every chip
                              // removes the facet it names, and the tag it carries when it is a tag.
                              if (entry.kind === "tag") catalog.toggleTag(entry.value);
                              else catalog.clearFacet(entry.facetId);
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
                  {/* The paging belongs to the answer, so it is held back while a new one is on its way: the
                      page in hand is the previous query's until this one lands. */}
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
                    />
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
      {panel === null || isColumn ? null : (
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
