/**
 * Path: src/features/search/FilterPanel.tsx
 * Purpose: The facet panel for category, brand, price, rating and availability, with counts and clear actions
 * Lines: 458
 */

import { useCallback, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Drawer } from "@/components/ui/Modal";
import { Checkbox, RadioGroup, Switch } from "@/components/ui/Select";
import { BREAKPOINTS } from "@/constants/config";
import {
  COMMON_ACTIONS,
  FACET_ANY_LABELS,
  SEARCH_COPY,
  clearFacetLabel,
  productCountLabel,
} from "@/constants/content";
import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import type { FacetDefinition } from "@/constants/taxonomy";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { useMediaQuery } from "@/state/hooks";
import type { Facet, FacetValue, FilterState } from "@/types/catalog";
import { indexBy } from "@/utils/collections";
import { formatNumber } from "@/utils/format";
import { activeFilterEntries, countActiveFilters, facetValueMatches } from "@/utils/queryParams";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class is consumed by name from `src/styles/catalog.css`, which owns this surface; `src/styles/base.css`
 * and `src/styles/components.css` are reached only through the primitives composed here, which apply their own
 * names (`.sp-visually-hidden`, `.sp-field`, `.sp-choice`, `.sp-alert`, `.sp-empty`, `.sp-skeleton`).
 *
 * `sp-facets` is the panel and, from the extra-large stop up, the sticky first column of `.sp-catalog-layout`; the
 * sheet hides it below that stop because the drawer takes over, so exactly one of the two is ever rendered and
 * no control id or label reaches the document twice. `sp-facets--drawer` is the same element inside the drawer,
 * resetting the sticky positioning and the panel's own scroll, and the sheet writes it after `sp-facets`, so its
 * `display: grid` holds at every width. `sp-facets__panel` is the bordered box laying the heading and the clear
 * action out in a two-column first row; `__group` spans both tracks; `__legend` is a group heading; `__values`,
 * `__value`, `__label` and `__count` are a value list, its rows, the growing label side of a row and the count
 * beside it; `__clear` is a clear action aligned to the end of its row; and `__toggle` is the small-screen
 * trigger, hidden from the extra-large stop up and so rendered only while the panel is a drawer.
 *
 * BLITZY [CONTRACT]: the sheet speaks of "the panel's heading" but declares no `sp-facets__heading` rule, so the
 * heading borrows `sp-facets__legend` — the register and separator a filter column's own title should wear. The
 * price and rating facets are likewise one `fieldset` each, whose legend `RadioGroup` renders, rather than a
 * group fieldset wrapping a second one, so a single legend names the group instead of two announcing the same
 * words.
 */

/** The classes this surface composes, written once so a sheet rename is one edit. */
const CLASSES = {
  column: "sp-facets",
  drawer: "sp-facets--drawer",
  panel: "sp-facets__panel",
  group: "sp-facets__group",
  legend: "sp-facets__legend",
  values: "sp-facets__values",
  value: "sp-facets__value",
  label: "sp-facets__label",
  count: "sp-facets__count",
  clear: "sp-facets__clear",
  toggle: "sp-facets__toggle",
} as const;

/** The stop the panel is a column from and a drawer below, built from the token so no width is written here: the
 *  column holds 260px of the layout, which the grid's 198px cards need in their own right below that width. */
const COLUMN_QUERY = `(min-width: ${BREAKPOINTS.XLARGE}px)`;

/** The value that means "no value": the state choice a single-choice facet's group opens with. */
const ANY_VALUE = "";

/** One facet's group: its vocabulary entry, whether it holds anything, the action that resets it alone and the
 *  control its kind needs. */
interface FacetGroupProps {
  readonly definition: FacetDefinition;
  readonly isApplied: boolean;
  readonly onClear: () => void;
  readonly children?: ReactNode;
}

/**
 * The clear action of one facet: the shared verb as its visible text and an accessible name built from the
 * content library's template and the facet's label, so it says which facet it clears.
 */
function FacetClearAction({
  definition,
  onClear,
}: {
  definition: FacetDefinition;
  onClear: () => void;
}): ReactElement {
  return (
    <Button
      className={CLASSES.clear}
      variant="link"
      size="sm"
      aria-label={clearFacetLabel(definition.label)}
      onClick={onClear}
    >
      {COMMON_ACTIONS.CLEAR}
    </Button>
  );
}

/**
 * One facet's group: a labelled `fieldset` carrying the facet's shopper-worded heading, the control its kind
 * needs and the action that resets this facet and nothing else — the markup the sheet's `__group` layout is
 * written against, and one thing to assistive technology, since its legend names the controls inside it.
 */
function FacetGroup({ definition, isApplied, onClear, children }: FacetGroupProps): ReactElement {
  return (
    <fieldset className={CLASSES.group}>
      <legend className={CLASSES.legend}>{definition.label}</legend>
      {children}
      {isApplied ? <FacetClearAction definition={definition} onClear={onClear} /> : null}
    </fieldset>
  );
}

/** Everything {@link TermFacet} renders from: the facet's counted terms, the state that decides selection, and
 *  the one write it makes — adding a value to the filter, or removing it when it is already applied. */
interface TermFacetProps {
  readonly facet: Facet;
  readonly filters: FilterState;
  readonly onToggle: (value: string) => void;
}

/**
 * A term facet — category or brand — as a multi-select list of its values. Every count is the one the response
 * already carries, computed with this facet's own selection excluded and every other facet applied, so selecting
 * a brand leaves the other brands' counts meaningful; nothing is counted, filtered or intersected here. A count
 * is text and part of its control's accessible name, so it is never conveyed by colour or width alone, and a
 * value the filters have emptied keeps its place and its `0`, disabled while it is not selected — a selected
 * value stays operable so it can be removed.
 */
function TermFacet({ facet, filters, onToggle }: TermFacetProps): ReactElement {
  return (
    <ul className={CLASSES.values}>
      {facet.values.map((value) => {
        const isSelected = facetValueMatches(filters, facet.id, value.value);
        return (
          <li className={CLASSES.value} key={value.value}>
            <Checkbox
              containerClassName={CLASSES.label}
              label={value.label}
              aria-label={`${value.label} \u00b7 ${productCountLabel(value.count)}`}
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

/** Everything {@link SingleChoiceFacet} renders from: the group's own members, the facet and the value the
 *  query applies, the "any" choice's own wording, and the write that chooses a value — the one that clears the
 *  facet included. */
interface SingleChoiceFacetProps extends Omit<FacetGroupProps, "children"> {
  readonly facet: Facet;
  readonly filters: FilterState;
  readonly selection: string;
  readonly anyLabel: string;
  readonly onSelect: (value: string) => void;
}

/**
 * A single-choice facet — the price bands and the rating floors — as one radio group: the vocabulary's own
 * legend, the "any" choice that holds the state a facet applying nothing is in, and every value beside the
 * count the response already carries, rendered through each option's own label node so the number a choice
 * would leave is part of the control's name.
 *
 * Choosing a value replaces the selection, because the state holds one band or one floor at a time and the
 * writer this control calls replaces the facet rather than adding to it — so two contradictory bands cannot
 * both apply and no choice is silently discarded. A value the filters have emptied keeps its place, disabled
 * while it is not the selected one, and a selected value stays operable so it can be replaced or cleared. The
 * legend is the group's own `fieldset` legend, which `RadioGroup` renders, so one legend names the group; the
 * facet's clear action beside the group is the single clearing affordance, never a value of the group.
 */
function SingleChoiceFacet({
  definition,
  facet,
  filters,
  selection,
  anyLabel,
  isApplied,
  onClear,
  onSelect,
}: SingleChoiceFacetProps): ReactElement {
  const counts = indexBy(facet.values, (value) => value.value);
  const options = [
    { value: ANY_VALUE, label: anyLabel },
    ...facet.values.map((value) => ({
      value: value.value,
      label: value.label,
      disabled: value.count === 0 && !facetValueMatches(filters, facet.id, value.value),
    })),
  ];

  return (
    <div className={CLASSES.group}>
      <RadioGroup
        name={`${facet.id}-filter`}
        legend={definition.label}
        value={selection}
        options={options}
        onChange={onSelect}
        renderOptionLabel={(option) => {
          const entry = counts.get(option.value);
          if (entry === undefined) return option.label;
          return (
            <>
              {option.label} {"\u00b7 "}
              <span className={CLASSES.count}>{formatNumber(entry.count)}</span>
            </>
          );
        }}
      />
      {isApplied ? <FacetClearAction definition={definition} onClear={onClear} /> : null}
    </div>
  );
}

/** Everything {@link FilterPanel} accepts: the facets and filter state to render — read from the catalogue
 *  context when either is omitted — the change observer the page announces from, and the panel's id and
 *  classes. The filter state is a read override only; writes still go through the provider's setters, so the
 *  URL keeps its single writer. */
export interface FilterPanelProps {
  readonly facets?: readonly Facet[];
  readonly filters?: FilterState;
  readonly onChange?: () => void;
  /** The panel's element id, which the small-screen trigger's `aria-controls` points at while the drawer is
   *  open — the state the panel exists in. */
  readonly panelId?: string;
  readonly className?: string;
}

/**
 * The filter panel: five facet groups over the catalogue's own facet response, shown as a sticky column from the
 * extra-large stop up and as a focus-trapped drawer below it.
 *
 * The URL is the store of everything selected: the panel reads its selection from the filter state and writes
 * only through the catalogue provider's setters, which apply the writer `src/utils/queryParams.ts`, so a
 * filtered URL reloads to the identical result set. The one piece of state this file holds is the drawer's open
 * flag — column or drawer is the viewport's own reading through `useMediaQuery`, and of the two exactly one is
 * rendered. The panel asks for nothing itself: the page's request carries the facets beside its results, and a
 * failure is answered with the retry the provider owns rather than with a request issued here.
 *
 * Three states are rendered in order: the group-shaped placeholders a definition with no response stands in with,
 * which is also the first load before any facet has arrived; the empty state with the one action that helps, when
 * the response holds no facet value at all; and otherwise the loaded panel. A failure is the page's own state and
 * is rendered there alone, so while the read stands failed the panel offers no facet content at all and announces
 * nothing: this surface's counts are the response's, and a count from a query that was never answered is not a
 * current count, while a second alert beside the page's would announce one failure twice. Counts are only ever
 * the ones the response carries, so the surface holds no rule of the catalogue's own: no predicate, no comparator
 * and no second count.
 *
 * @param props - The facets and filter state to render, the change observer, the panel's id and extra classes.
 * @returns The column from the extra-large stop up, or the trigger with its drawer below it — or nothing at all
 *   while the read that fills the panel stands failed, because neither placement then has anything to offer.
 *
 * BLITZY [BUDGET]: 458 lines against the plan's 470-line budget, and inside the 600-line ceiling — no line was
 * added to reach a number and none was cut to leave one. The five data-driven groups, the three controls they
 * dispatch to, the class contract and the four data states are what the surface needs, and the plan's own
 * remedy — a second file — would break the path this slice's page imports.
 */
export function FilterPanel({
  facets: facetsProp,
  filters: filtersProp,
  onChange,
  panelId,
  className,
}: FilterPanelProps): ReactElement | null {
  const view = useCatalog();
  const catalog = useCatalogFilters();
  const filters = filtersProp ?? catalog.filters;
  const facets = facetsProp ?? view.facets;

  // The only state this file holds: whether the drawer is open. Nothing about the selection is kept here.
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const isColumn = useMediaQuery(COLUMN_QUERY);
  const generatedId = useId();
  const id = panelId ?? generatedId;

  // Every write runs the provider's setter and then reports the change to the page, so the panel never composes
  // a query string, never resets the page itself and never re-counts what it has just changed.
  const write = useCallback(
    (commit: () => void): void => {
      commit();
      onChange?.();
    },
    [onChange],
  );
  const closeDrawer = useCallback((): void => setDrawerOpen(false), []);
  const clearAll = (): void => write(() => catalog.clearAll());
  // One write serves both single-choice facets: the provider's setter replaces the facet's whole selection, so a
  // band or a floor replaces the one already applied, and the "any" choice clears it.
  const selectValue = (facetId: FacetDefinition["id"], value: string): void =>
    write(() => catalog.setFacetValue(facetId, value === ANY_VALUE ? null : value));

  // The response matched to the vocabulary by id, so a definition and its values never pair by position.
  const facetIndex = indexBy(facets, (facet) => facet.id);
  const appliedCount = countActiveFilters(filters);

  const renderFacet = (definition: FacetDefinition): ReactElement => {
    const facet = facetIndex.get(definition.id);
    if (facet === undefined) {
      // No response for this facet yet: the placeholder shaped like the group it stands in for.
      return (
        <div className={CLASSES.group} key={definition.id}>
          <Skeleton variant="text" lines={4} />
        </div>
      );
    }
    // What a facet applies, and which of its values is the selected one, are both asked of the query writer's own
    // chip list rather than of rules restated here, so this panel and the chips above the results cannot disagree
    // about the state. A price band's chip carries the band's own key, which is what the group's options carry.
    const entry = activeFilterEntries(filters).find(
      (candidate) => candidate.kind === "facet" && candidate.facetId === definition.id,
    );
    const isApplied = entry !== undefined;
    const selection = entry === undefined ? ANY_VALUE : entry.value;
    const group = {
      definition,
      isApplied,
      onClear: (): void => write(() => catalog.clearFacet(definition.id)),
    };

    // The one element a single-choice facet's group is rendered as, so the rating floors below and the price
    // bands below that share it instead of repeating it: its own wording for the "any" choice is all that differs.
    const singleChoice = (anyLabel: string): ReactElement => (
      <SingleChoiceFacet
        key={definition.id}
        {...group}
        facet={facet}
        filters={filters}
        selection={selection}
        anyLabel={anyLabel}
        onSelect={(value) => selectValue(definition.id, value)}
      />
    );

    switch (definition.kind) {
      case "terms":
        // A vocabulary that declares its own values is a fixed list to choose one of — the rating floor — while
        // the facets whose terms come from the catalogue declare none and are combined several at a time.
        return definition.options === undefined ? (
          <FacetGroup key={definition.id} {...group}>
            {facet.values.length === 0 ? null : (
              <TermFacet
                facet={facet}
                filters={filters}
                onToggle={(value) => write(() => catalog.toggleFacet(definition.id, value))}
              />
            )}
          </FacetGroup>
        ) : (
          singleChoice(FACET_ANY_LABELS.rating)
        );
      case "range":
        // The price facet is the vocabulary's own five bands, chosen one at a time like a rating floor: choosing
        // a band replaces the selection, which is what the state's single minimum and maximum pair can hold, so
        // two contradictory bands cannot both apply and no choice is silently discarded. The bounds themselves
        // stay the query writer's rule: a hand-written pair is still floored, clamped and swapped when it is read.
        return singleChoice(FACET_ANY_LABELS.price);
      case "boolean": {
        const value: FacetValue | undefined = facet.values[0];
        return (
          <FacetGroup key={definition.id} {...group}>
            {value === undefined ? null : (
              <div className={CLASSES.value}>
                <Switch
                  containerClassName={CLASSES.label}
                  label={value.label}
                  aria-label={`${value.label} \u00b7 ${productCountLabel(value.count)}`}
                  checked={filters.inStockOnly}
                  onChange={(inStockOnly) => write(() => catalog.setInStockOnly(inStockOnly))}
                />
                <span className={CLASSES.count}>{formatNumber(value.count)}</span>
              </div>
            )}
          </FacetGroup>
        );
      }
    }
  };

  const groups = FACET_DEFINITIONS.map(renderFacet);
  // The read that fills this panel has failed with nothing in flight: the page owns that state and renders the
  // failure, so the panel offers nothing rather than a second copy of it.
  const hasFailed = view.error !== null && !view.isLoading;
  let content: ReactNode = groups;
  if (hasFailed) {
    // The failed read is `SearchPage`'s state and it renders the surface's one alert and one retry for it; a
    // second copy of that alert here would announce a single failure twice and offer a second recovery control
    // for it. The facets are withheld with it rather than left standing: a count is a fact about an answer, and
    // this query was never answered, so the last one this panel holds is not a current one.
    content = null;
  } else if (!view.isLoading && !facets.some((facet) => facet.values.length > 0)) {
    content = <EmptyState surface="catalogue" onAction={clearAll} />;
  }

  const clearAllAction =
    appliedCount > 0 ? (
      <Button className={CLASSES.clear} variant="link" size="sm" onClick={clearAll}>
        {COMMON_ACTIONS.CLEAR_ALL}
      </Button>
    ) : null;
  const columnClass = className === undefined ? CLASSES.column : `${CLASSES.column} ${className}`;
  const panel = (
    <div className={isColumn ? columnClass : `${CLASSES.column} ${CLASSES.drawer}`} id={id}>
      <div className={CLASSES.panel}>
        {isColumn ? <h2 className={CLASSES.legend}>{SEARCH_COPY.FILTER_PANEL_HEADING}</h2> : null}
        {isColumn ? clearAllAction : null}
        {content}
      </div>
    </div>
  );
  if (isColumn) return panel;
  // Below the medium stop this panel is reached through its own trigger, and a trigger standing over a panel
  // holding nothing is a control that resolves nothing: while the read stands failed the whole surface is left
  // out, and the results column beside it carries the failure and its retry alone.
  if (hasFailed) return null;

  return (
    <>
      <Button
        className={CLASSES.toggle}
        variant="secondary"
        size="sm"
        aria-expanded={isDrawerOpen}
        // The reference exists while the panel does: collapsed, no element carries that id.
        aria-controls={isDrawerOpen ? id : undefined}
        onClick={() => setDrawerOpen(true)}
      >
        {SEARCH_COPY.OPEN_FILTERS_LABEL}
        {appliedCount > 0 ? ` ${formatNumber(appliedCount)}` : null}
      </Button>
      <Drawer
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        title={SEARCH_COPY.FILTER_PANEL_HEADING}
        closeLabel={SEARCH_COPY.CLOSE_FILTERS_LABEL}
        side="start"
        footer={clearAllAction}
      >
        {panel}
      </Drawer>
    </>
  );
}
