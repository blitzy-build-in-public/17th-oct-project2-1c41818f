/**
 * Path: src/features/catalog/CatalogFilterRegion.tsx
 * Purpose: Catalogue facet panel: the five facet groups over the catalogue's own facet response, as the sticky column or the drawer body
 * Lines: 261
 */

import type { ReactElement, ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Checkbox, RadioGroup, Switch } from "@/components/ui/Select";
import {
  COMMON_ACTIONS,
  EMPTY_STATES,
  FACET_ANY_LABELS,
  SEARCH_COPY,
  clearFacetLabel,
  productCountLabel,
} from "@/constants/content";
import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import type { FacetDefinition } from "@/constants/taxonomy";
import type { CatalogFilters } from "@/state/CatalogContext";
import { handOffThen, useFocusHandoff } from "@/components/ui/focusHandoff";
import type { Facet, FacetId, FilterState } from "@/types/catalog";
import { indexBy } from "@/utils/collections";
import { formatNumber } from "@/utils/format";
import { activeFilterEntries, facetValueMatches } from "@/utils/queryParams";
import type { ActiveFilterEntry } from "@/utils/queryParams";

/*
 * Class contract: no stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class below is consumed by name from the sheet that owns it: `catalog.css`, and the `catalog-landing.css`
 * it loads, style the catalogue's own facet blocks. Every primitive below paints itself, so no colour, radius,
 * shadow or media query is here.
 */

/** The classes used more than once, written once so a sheet rename is one edit. */
export const CLASSES = {
  column: "sp-facets",
  group: "sp-facets__group",
  legend: "sp-facets__legend",
  value: "sp-facets__value",
  label: "sp-facets__label",
  count: "sp-facets__count",
  clear: "sp-facets__clear",
} as const;

/** The value that means "no value": the state choice a single-choice facet's group opens with. */
const ANY_VALUE = "";

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
  readonly focusTargetRef?: RefObject<HTMLElement | null>;
  readonly fallbackRef: RefObject<HTMLDivElement | null>;
}

/**
 * The filter region: the five facet groups of `src/constants/taxonomy.ts` over the catalogue's own facet response,
 * as the sticky first column of `.sp-catalog-layout` from the extra-large stop up and the caller's drawer below it.
 *
 * The region is composed here rather than imported from the search slice's `FilterPanel.tsx`, which one feature may
 * not reach into, and applies no rule of its own: `src/lib/catalogService.ts` counts the facets,
 * `src/constants/taxonomy.ts` declares the vocabulary, and the setters it is handed own the query, so nothing is
 * mirrored into state. A facet with no answer renders its placeholder, a settled response holding no value says
 * what that means, and each facet's clear action takes its own control away — so it is armed with the handoff of
 * `focusTargetRef`, the page body, and of `fallbackRef`, this panel — which takes that focus while the open
 * drawer has made it inert.
 */
export function CatalogFilterRegion({
  facets,
  filters,
  catalog,
  isReading,
  isDrawer,
  id,
  focusTargetRef,
  fallbackRef,
}: FilterRegionProps): ReactElement {
  const applied = activeFilterEntries(filters);
  const { handOffFocus } = useFocusHandoff(focusTargetRef, fallbackRef);
  const clearAll = handOffThen(handOffFocus, () => catalog.clearAll());
  const clearFacet = handOffThen(handOffFocus, (id: FacetId) => catalog.clearFacet(id));
  const clearAllAction =
    applied.length === 0 ? null : (
      <Button className={CLASSES.clear} variant="link" size="sm" onClick={clearAll}>
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
        onClick={() => clearFacet(definition.id)}
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
      // No answer for this facet yet: the placeholder shaped like it, and nothing once the read has settled.
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
      <div className="sp-facets__panel" ref={fallbackRef} tabIndex={-1}>
        {isDrawer ? null : <h2 className={CLASSES.legend}>{SEARCH_COPY.FILTER_PANEL_HEADING}</h2>}
        {isDrawer ? null : clearAllAction}
        {content}
      </div>
    </div>
  );
}
