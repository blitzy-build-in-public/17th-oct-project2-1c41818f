/**
 * Path: src/features/search/ActiveFilters.tsx
 * Purpose: A removable chip per applied filter, with a clear-all action
 * Lines: 234
 */

import { useState } from "react";
import type { ReactElement } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/icons";
import { COMMON_ACTIONS, SEARCH_COPY, removeFilterLabel } from "@/constants/content";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import type { CatalogFilters } from "@/state/CatalogContext";
import type { Facet, FacetId, FilterState } from "@/types/catalog";
import { formatMoney } from "@/utils/format";
import { activeFilterEntries } from "@/utils/queryParams";
import type { ActiveFilterEntry } from "@/utils/queryParams";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**`
 * — so every class is consumed by name from the sheet that owns it: `sp-active-filters` (catalog.css) is
 * the row, `sp-active-filters__chip` is one chip whose own `button` rule sizes and colours the remove
 * control the sheet expects inside it, `sp-active-filters__clear-all` is the clear-all cell, pushed to the
 * row's end by that sheet's `margin-inline-start: auto`, and `sp-visually-hidden` (base.css) keeps the
 * announcement in the accessibility tree while hiding it. No other class is invented here, since one would
 * paint a value outside `src/styles/tokens.css`.
 */

/** The classes this file consumes, written once so a rename is one edit. */
const CLASSES = {
  row: "sp-active-filters",
  chip: "sp-active-filters__chip",
  clearAll: "sp-active-filters__clear-all",
  hidden: "sp-visually-hidden",
} as const;

/** The row's accessible name, from the content library: what the list holds, for a screen reader. */
const ROW_LABEL = SEARCH_COPY.ACTIVE_FILTERS_HEADING;

/** Everything {@link ActiveFilters} accepts. */
export interface ActiveFiltersProps {
  /** The chips to render; omitted, one per applied filter of the query in the address bar. */
  readonly entries?: readonly ActiveFilterEntry[];
  /** What removing one chip does; omitted, the removal writes the query through the context. */
  readonly onRemove?: (entry: ActiveFilterEntry) => void;
  /** What the clear-all action does; omitted, it clears the query's filters through the context. */
  readonly onClearAll?: () => void;
  /** Caps how many chips show at once; a cap below one shows every chip and reveals nothing. */
  readonly maxVisible?: number;
  /** Extra classes for the row itself, so a caller can place it in its own layout. */
  readonly className?: string;
}

/**
 * The catalogue's name for one value of a term facet: `src/constants/taxonomy.ts` declares no wording for
 * a category or a brand, so a chip reads "Audio" rather than the `cat_…` identifier the URL carries.
 */
function termLabel(facetId: FacetId, value: string, facets: readonly Facet[]): string | null {
  const facet = facets.find((candidate) => candidate.id === facetId);
  const term = facet?.values.find((candidate) => candidate.value === value);
  return term?.label ?? null;
}

/**
 * A price filter's bounds as one chip's text, formatted by `src/utils/format.ts` and never by arithmetic
 * here: only a range whose band the vocabulary does not name reaches this.
 */
function priceBoundsText(state: FilterState): string {
  const { minPriceMinor, maxPriceMinor } = state;
  if (minPriceMinor !== null && maxPriceMinor !== null) {
    return `${formatMoney(minPriceMinor)} – ${formatMoney(maxPriceMinor)}`;
  }
  return formatMoney(minPriceMinor ?? maxPriceMinor);
}

/** One chip's text from the descriptor alone: its wording, a term's name, a range's bounds, or the tag. */
function chipText(entry: ActiveFilterEntry, facets: readonly Facet[], state: FilterState): string {
  if (entry.kind === "tag") return entry.value;
  if (entry.label !== null) return entry.label;
  if (entry.facetId === "price") return priceBoundsText(state);
  return termLabel(entry.facetId, entry.value, facets) ?? entry.value;
}

/** A chip's key, from the filter it stands for: its facet and value, or its tag — unique within one row. */
function chipKey(entry: ActiveFilterEntry): string {
  return entry.kind === "tag" ? `tag:${entry.value}` : `${entry.facetId}:${entry.value}`;
}

/**
 * Removes one applied filter by writing the query through the setter that owns it, so the address bar stays
 * the only place the selection lives and `src/utils/queryParams.ts` keeps its normalisation and page
 * clamping. The switch is exhaustive over the facet ids, so no facet reaches here with no way to remove it.
 */
function applyRemoval(entry: ActiveFilterEntry, filters: CatalogFilters): void {
  if (entry.kind === "tag") {
    filters.toggleTag(entry.value);
    return;
  }
  switch (entry.facetId) {
    case "category":
    case "brand":
      filters.toggleFacet(entry.facetId, entry.value);
      return;
    case "price":
      filters.setPriceRange(null, null);
      return;
    case "rating":
      filters.setRating(null);
      return;
    case "availability":
      filters.setInStockOnly(false);
      return;
  }
}

/** Everything {@link ChipRow} accepts. */
interface ChipRowProps {
  readonly text: string;
  readonly onRemove: () => void;
}

/**
 * One chip: the filter's own text, then a real labelled remove control, as two separate focusable targets in
 * one cell. The control takes its name from the content library with the chip's text, so it reads as the
 * filter it removes rather than as a bare "remove", and nothing here is revealed on hover alone.
 */
function ChipRow({ text, onRemove }: ChipRowProps): ReactElement {
  return (
    <li className={CLASSES.chip}>
      <span>{text}</span>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        label={removeFilterLabel(text)}
        icon={<CloseIcon />}
        onClick={onRemove}
      />
    </li>
  );
}

/**
 * The applied filters of the query in the address bar, one removable chip each, with one clear-all action.
 *
 * The chips are a projection of the URL, derived on every render rather than kept, so what shows is always
 * what the address bar holds. Nothing is counted, filtered, sorted or labelled here: the descriptors come
 * from `src/utils/queryParams.ts`, their wording from the vocabulary and the loaded facets.
 *
 * Assumptions: it renders inside a `CatalogProvider` and each hook throws without one rather than showing
 * an empty row; with no filter applied it renders nothing at all, which is why the clear-all action is only
 * ever present beside at least one chip; the removal is announced by this row's own polite region while the
 * result count belongs to the page. `maxVisible` reveals the remaining chips in one direction —
 * `src/constants/content.ts` holds no wording for the reverse — and a hidden chip is never the only way to
 * remove a filter, the panel beside the results clearing each facet on its own.
 *
 * @param props - The descriptors, the removal and clearing overrides, the visible cap and the row classes.
 * @returns The chip row with its announcement region, or `null` when no filter is applied.
 */
export function ActiveFilters({
  entries,
  onRemove,
  onClearAll,
  maxVisible,
  className,
}: ActiveFiltersProps): ReactElement | null {
  const filters = useCatalogFilters();
  const { facets, isLoading } = useCatalog();
  // The row remembers only the last removal and whether every chip was asked for; chips derive below.
  const [announcement, setAnnouncement] = useState("");
  const [isRevealed, setIsRevealed] = useState(false);

  const applied = entries ?? activeFilterEntries(filters.filters);
  const rowClass = className ? `${CLASSES.row} ${className}` : CLASSES.row;
  // Nothing is applied, so there is nothing to show: the row is absent rather than empty.
  if (applied.length === 0) return null;

  const isCapped = maxVisible !== undefined && maxVisible >= 1 && applied.length > maxVisible;
  const visible = isCapped && !isRevealed ? applied.slice(0, maxVisible) : applied;

  const handleRemove = (entry: ActiveFilterEntry, text: string): void => {
    setAnnouncement(removeFilterLabel(text));
    if (onRemove !== undefined) {
      onRemove(entry);
      return;
    }
    applyRemoval(entry, filters);
  };

  const handleClearAll = (): void => {
    setAnnouncement(COMMON_ACTIONS.CLEAR_ALL);
    if (onClearAll !== undefined) {
      onClearAll();
      return;
    }
    filters.clearAll();
  };

  return (
    <>
      <ul className={rowClass} aria-label={ROW_LABEL}>
        {visible.map((entry) => {
          const text = chipText(entry, facets, filters.filters);
          return (
            <ChipRow key={chipKey(entry)} text={text} onRemove={() => handleRemove(entry, text)} />
          );
        })}
        {isCapped && !isRevealed ? (
          <li>
            <Button type="button" variant="link" size="sm" onClick={() => setIsRevealed(true)}>
              {COMMON_ACTIONS.VIEW_ALL}
            </Button>
          </li>
        ) : null}
        {/* Kept in place, not hidden, while a request is in flight, so the chips beside it do not shift. */}
        <li className={CLASSES.clearAll}>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={isLoading}
            onClick={handleClearAll}
          >
            {COMMON_ACTIONS.CLEAR_ALL}
          </Button>
        </li>
      </ul>
      <div className={CLASSES.hidden} role="status">
        {announcement}
      </div>
    </>
  );
}
