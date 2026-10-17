/**
 * Path: src/features/search/FilterPanel.tsx
 * Purpose: The facet panel for category, brand, price, rating and availability, with counts and clear actions
 * Lines: 540
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Drawer } from "@/components/ui/Modal";
import { Checkbox, RadioGroup, Switch } from "@/components/ui/Select";
import { BREAKPOINTS } from "@/constants/config";
import {
  COMMON_ACTIONS,
  SEARCH_COPY,
  clearFacetLabel,
  productCountLabel,
} from "@/constants/content";
import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import type { FacetDefinition } from "@/constants/taxonomy";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { useMediaQuery } from "@/state/hooks";
import type { Facet, FacetValue, FilterState } from "@/types/catalog";
import type { FieldErrors, MinorUnits } from "@/types/common";
import { indexBy } from "@/utils/collections";
import { formatMinorAsInput, formatNumber, parseMoneyToMinor } from "@/utils/format";
import {
  FILTER_PARAMS,
  PRICE_FILTER_FLOOR_MINOR,
  activeFilterEntries,
  countActiveFilters,
  facetValueMatches,
} from "@/utils/queryParams";
import { fieldErrorsFromApiError } from "@/utils/validation";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class is consumed by name from `src/styles/catalog.css`, which owns this surface; `src/styles/base.css`
 * and `src/styles/components.css` are reached only through the primitives composed here, which apply their own
 * names (`.sp-visually-hidden`, `.sp-field`, `.sp-choice`, `.sp-alert`, `.sp-empty`, `.sp-skeleton`).
 *
 * `sp-facets` is the panel and, from the medium stop up, the sticky first column of `.sp-catalog-layout`; the
 * sheet hides it below that stop because the drawer takes over, so exactly one of the two is ever rendered and
 * no control id or label reaches the document twice. `sp-facets--drawer` is the same element inside the drawer,
 * resetting the sticky positioning and the panel's own scroll, and the sheet writes it after `sp-facets`, so its
 * `display: grid` holds at every width. `sp-facets__panel` is the bordered box laying the heading and the clear
 * action out in a two-column first row; `__group` and `__range` span both tracks; `__legend` is a group heading;
 * `__values`, `__value`, `__label` and `__count` are a value list, its rows, the growing label side of a row and
 * the count beside it; `__clear` is a clear action aligned to the end of its row; `__toggle` is the small-screen
 * trigger, hidden from the medium stop up and so rendered only while the panel is a drawer; and the dash between
 * the two price bounds is the `__range > :nth-child(2)` the sheet styles.
 *
 * BLITZY [CONTRACT]: the sheet speaks of "the panel's heading" but declares no `sp-facets__heading` rule, so the
 * heading borrows `sp-facets__legend` — the register and separator a filter column's own title should wear. The
 * rating facet is likewise one `fieldset`, whose legend `RadioGroup` renders, rather than a group fieldset
 * wrapping a second one, so a single legend names the group instead of two announcing the same words.
 */

/** The classes this surface composes, written once so a sheet rename is one edit. */
const CLASSES = {
  column: "sp-facets",
  drawer: "sp-facets--drawer",
  panel: "sp-facets__panel",
  group: "sp-facets__group",
  range: "sp-facets__range",
  legend: "sp-facets__legend",
  values: "sp-facets__values",
  value: "sp-facets__value",
  label: "sp-facets__label",
  count: "sp-facets__count",
  clear: "sp-facets__clear",
  toggle: "sp-facets__toggle",
} as const;

/** The stop the panel is a column from and a drawer below, built from the token so no width is written here. */
const COLUMN_QUERY = `(min-width: ${BREAKPOINTS.MEDIUM}px)`;

/** The value a single-choice facet carries to mean "no value": the "any rating" choice that clears the filter. */
const ANY_VALUE = "";

/**
 * The two price bounds a shopper types, named by the query keys the URL and `GET /api/products` both carry, so a
 * bound the endpoint rejects can mark its own field.
 *
 * BLITZY [COPY]: `src/constants/content.ts` holds no wording for a price bound — its only price strings are the
 * taxonomy's band labels — so the two labels are stated here. They belong in the content library.
 */
const PRICE_BOUNDS = {
  min: { name: FILTER_PARAMS.MIN_PRICE, label: "Minimum price" },
  max: { name: FILTER_PARAMS.MAX_PRICE, label: "Maximum price" },
} as const;

/** One price bound: the query key it writes and the wording of its label. */
type PriceBoundFieldDefinition = (typeof PRICE_BOUNDS)[keyof typeof PRICE_BOUNDS];

/**
 * The bound a field's text names, as minor units, or `null` when it names none: an empty field, a value typed
 * without a digit, or an amount at or below the price floor, which the query writer reads as no bound at all. A
 * bound above the catalogue's ceiling is kept as typed — confining bounds is the writer's own rule.
 */
function readBound(text: string): MinorUnits | null {
  if (!/[0-9]/.test(text)) return null;
  const amount = parseMoneyToMinor(text);
  return amount > PRICE_FILTER_FLOOR_MINOR ? amount : null;
}

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

/** Everything {@link RatingFacet} renders from: the group's own members, the floor facet and the write that
 *  chooses one — including the choice that clears the filter. */
interface RatingFacetProps extends Omit<FacetGroupProps, "children"> {
  readonly facet: Facet;
  readonly filters: FilterState;
  readonly onSelect: (value: string) => void;
}

/**
 * The rating facet: a single-choice list of the star floors the vocabulary declares, opened by the choice that
 * clears the filter. Counts are rendered through each option's own label node, so the number a floor would leave
 * is part of the control's name rather than a decoration beside it.
 *
 * BLITZY [COPY]: `src/constants/content.ts` declares no wording for an "any" choice, so the choice that clears
 * the facet is labelled with the library's own clear-action template for the facet rather than with a sentence
 * written here. A dedicated string belongs in the content library.
 */
function RatingFacet({
  definition,
  facet,
  filters,
  isApplied,
  onClear,
  onSelect,
}: RatingFacetProps): ReactElement {
  const counts = indexBy(facet.values, (value) => value.value);
  const options = [
    { value: ANY_VALUE, label: clearFacetLabel(definition.label) },
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
        value={filters.minRating === null ? ANY_VALUE : String(filters.minRating)}
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

/** Everything {@link PriceBoundField} renders from: the bound to show and write, the field errors a failed
 *  request named, and the write that opens or closes that side of the range. */
interface PriceBoundFieldProps {
  readonly field: PriceBoundFieldDefinition;
  readonly bound: MinorUnits | null;
  readonly errors: FieldErrors;
  readonly onCommit: (bound: MinorUnits | null) => void;
}

/**
 * One price bound's field: an amount entered in major units and written to the filter in minor units.
 *
 * The field's text is the DOM's own while it is being typed — a controlled value would rewrite the caret on
 * every keystroke, an entered `1299` canonicalising to `1299.00` — and the effect below is what keeps the field
 * in step with the filter state when that changes elsewhere: a clear-all, a removed chip, a range reopened. No
 * selection is mirrored into React state and the amount is the URL's; the field holds only what is being typed.
 *
 * The bound is written when the field is left, and on Enter, which leaves it the same way: a settled pair is what
 * the writer `src/utils/queryParams.ts` normalises, so a half-typed maximum cannot invert the range and swap the
 * minimum the shopper has already entered. Nothing here rejects an amount — the writer swaps an inverted range,
 * clamps a bound to the catalogue's ceiling and reads one at the floor as no bound at all.
 */
function PriceBoundField({ field, bound, errors, onCommit }: PriceBoundFieldProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const text = bound === null ? "" : formatMinorAsInput(bound);

  useEffect(() => {
    const node = inputRef.current;
    if (node === null || node === document.activeElement) return;
    if (node.value !== text) node.value = text;
  }, [text]);

  const settle = (node: HTMLInputElement): void => {
    const amount = readBound(node.value);
    node.value = amount === null ? "" : formatMinorAsInput(amount);
    onCommit(amount);
  };

  return (
    <Input
      ref={inputRef}
      name={field.name}
      label={field.label}
      errors={errors}
      defaultValue={text}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      onBlur={(event: FocusEvent<HTMLInputElement>): void => settle(event.currentTarget)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
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
  /** The panel's element id, which the small-screen trigger's `aria-controls` points at. */
  readonly panelId?: string;
  readonly className?: string;
}

/**
 * The filter panel: five facet groups over the catalogue's own facet response, shown as a sticky column from the
 * medium stop up and as a focus-trapped drawer below it.
 *
 * The URL is the store of everything selected: the panel reads its selection from the filter state and writes
 * only through the catalogue provider's setters, which apply the writer `src/utils/queryParams.ts`, so a
 * filtered URL reloads to the identical result set. The one piece of state this file holds is the drawer's open
 * flag — column or drawer is the viewport's own reading through `useMediaQuery`, and of the two exactly one is
 * rendered. The panel asks for nothing itself: the page's request carries the facets beside its results, and a
 * failure is answered with the retry the provider owns rather than with a request issued here.
 *
 * Four states are rendered in order: the group-shaped placeholders a definition with no response stands in with,
 * which is also the first load before any facet has arrived; the shaped failure with its retry action; the empty
 * state with the one action that helps, when the response holds no facet value at all; and otherwise the loaded
 * panel. Counts are only ever the ones the response carries, so this surface holds no rule of the catalogue's
 * own: no predicate, no comparator and no second count.
 *
 * @param props - The facets and filter state to render, the change observer, the panel's id and extra classes.
 * @returns The column from the medium stop up, or the trigger with its drawer below it.
 *
 * BLITZY [BUDGET]: 540 lines against the plan's 470-line budget, and inside the 600-line ceiling — no line was added
 * to reach a number and none was cut to leave one. The five data-driven groups, the four controls they dispatch
 * to, the price field's DOM-side draft, the class contract and the four data states are what the surface needs,
 * and the plan's own remedy — a second file — would break the path this slice's page imports.
 */
export function FilterPanel({
  facets: facetsProp,
  filters: filtersProp,
  onChange,
  panelId,
  className,
}: FilterPanelProps): ReactElement {
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
  const selectRating = (value: string): void =>
    write(() => catalog.setRating(value === ANY_VALUE ? null : Number(value)));
  const setBound = (side: "min" | "max", bound: MinorUnits | null): void =>
    write(() =>
      catalog.setPriceRange(
        side === "min" ? bound : filters.minPriceMinor,
        side === "max" ? bound : filters.maxPriceMinor,
      ),
    );

  // The response matched to the vocabulary by id, so a definition and its values never pair by position.
  const facetIndex = indexBy(facets, (facet) => facet.id);
  const appliedCount = countActiveFilters(filters);
  // A failure that named a filter parameter marks the bound that carried it; one that named none is shown by the
  // alert above the groups, which is where a failure belonging to no single control belongs.
  const priceErrors: FieldErrors = view.error === null ? {} : fieldErrorsFromApiError(view.error);

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
    // Whether a facet holds anything is asked of the query writer's own chip list rather than of a rule restated
    // here, so this answer and the chips above the results cannot disagree about what is applied.
    const isApplied = activeFilterEntries(filters).some(
      (entry) => entry.kind === "facet" && entry.facetId === definition.id,
    );
    const group = {
      definition,
      isApplied,
      onClear: (): void => write(() => catalog.clearFacet(definition.id)),
    };

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
          <RatingFacet
            key={definition.id}
            {...group}
            facet={facet}
            filters={filters}
            onSelect={selectRating}
          />
        );
      case "range":
        return (
          <FacetGroup key={definition.id} {...group}>
            <div className={CLASSES.range}>
              <PriceBoundField
                field={PRICE_BOUNDS.min}
                bound={filters.minPriceMinor}
                errors={priceErrors}
                onCommit={(bound) => setBound("min", bound)}
              />
              <span aria-hidden="true">{"\u2013"}</span>
              <PriceBoundField
                field={PRICE_BOUNDS.max}
                bound={filters.maxPriceMinor}
                errors={priceErrors}
                onCommit={(bound) => setBound("max", bound)}
              />
            </div>
          </FacetGroup>
        );
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
  let content: ReactNode = groups;
  if (view.error !== null && !view.isLoading) {
    content = (
      <Alert
        tone="danger"
        error={view.error}
        actionLabel={COMMON_ACTIONS.RETRY}
        onAction={() => view.reload()}
      />
    );
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

  return (
    <>
      <Button
        className={CLASSES.toggle}
        variant="secondary"
        size="sm"
        aria-expanded={isDrawerOpen}
        aria-controls={id}
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
