/**
 * Path: src/features/search/SortControl.tsx
 * Purpose: The sort selector that writes the chosen key to the URL
 * Lines: 155
 */

import type { ChangeEvent, ReactElement } from "react";

import { Select } from "@/components/ui/Select";
import { CATALOG_COPY } from "@/constants/content";
import { SORT_OPTIONS } from "@/constants/taxonomy";
import { useCatalogFilters } from "@/state/CatalogContext";
import type { SortKey } from "@/types/catalog";

/*
 * Class contract. This list is what the sheets owe the control, each class named with the sheet that declares
 * it. `sp-sort`, declared in
 * `src/styles/catalog.css`, is the row-saving arrangement of a labelled select: its own base rule stacks
 * the label above the select, and from `--breakpoint-md` it places the label beside a select capped at the
 * facet column's width, which is the shape `.sp-result-meta > .sp-sort` closes to the end of its own row.
 * That is what `isCompact` asks for, and it is the only class this file adds. The select, its chevron
 * wrapper and the field's own label, hint and error slots carry the names `src/components/ui/Select.tsx`
 * and `src/styles/controls.css` already own — the standard field a page's own sort control renders when
 * `isCompact` is omitted — so nothing here restates them, and no colour, radius, shadow or inline style
 * appears in this file. How wide the field ends up is its container's rule, not this file's: it fills the
 * column it is given, and inside a wrapping flex row such as `.sp-result-meta` on a phone it takes the
 * width of its own content.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: the sheets declare no modifier that compacts the field's stacked anatomy
 * below `--breakpoint-md` — `.sp-sort` is the one dense arrangement on offer and its own base rule still
 * stacks the label above the select on a phone — so `isCompact` reaches that arrangement rather than a
 * second one. A rule only the sheet can add would be needed for the label to sit beside the select at
 * every width, and inventing one here would put a value outside `tokens.css`.
 */

/**
 * The sort keys the taxonomy offers, read from the option list rather than restated: `SORT_OPTIONS` in
 * `src/constants/taxonomy.ts` stays the only home of the sort vocabulary, so a key added there is offered
 * by the select and recognised below without this file changing.
 */
const SORT_KEYS: readonly string[] = SORT_OPTIONS.map((option) => option.value);

/**
 * Whether a value a select produced is one the taxonomy offers. `Select` renders the options it is handed,
 * so a value reaching a change event is one of them; the predicate is what narrows the DOM's `string` to
 * `SortKey` without a cast, and it also holds for a leading empty choice, which this control never renders
 * because every option carries a real key and no placeholder is passed.
 */
function isSortKey(value: string): value is SortKey {
  return SORT_KEYS.includes(value);
}

/**
 * Joins the classes the field wrapper carries, dropping the absent ones so no stray space reaches the
 * attribute. File-local, like every other component in this run that composes a class list.
 *
 * @param values - Classes to join; a `false` or `undefined` entry contributes nothing.
 * @returns The class attribute value, empty when nothing was given.
 */
function composeClassName(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/** Everything {@link SortControl} accepts. */
export interface SortControlProps {
  /**
   * The key the control shows. Omitted, the control shows the sort the URL carries, which is the only
   * store of it: `src/utils/queryParams.ts` fills the default in when a query names no sort, so the
   * control renders that default rather than one of its own.
   */
  readonly value?: SortKey;
  /**
   * Reports the key the shopper picked, for a page that needs to observe the change itself. The URL is
   * written whether or not this is supplied, and the key reported is the one picked — the writer may
   * normalise it, because a sort that is meaningless for the current query (relevance with no search
   * term) falls back to the default, and the control then shows the key the URL actually holds.
   */
  readonly onChange?: (sort: SortKey) => void;
  /** The control's visible label, which is also its accessible name. */
  readonly label?: string;
  /**
   * Renders the catalogue sheet's dense row arrangement instead of the standard field: from
   * `--breakpoint-md` the label sits beside a select capped at the facet column's width, which is how the
   * result-meta row carries the control at the end of its own line.
   */
  readonly isCompact?: boolean;
  /** Extra classes for the control's own wrapper, beside the field's and the arrangement's. */
  readonly className?: string;
}

/**
 * The sort selector of a catalogue or search surface: one labelled select whose value is the sort in the
 * address bar and whose change writes the address bar.
 *
 * The control holds no copy of the sort. Its value comes from `useCatalogFilters().filters.sort` and its
 * change goes to that context's `setSort`, which composes `withSort` from `src/utils/queryParams.ts` and
 * navigates — so the URL stays the single store of query state, the listing returns to its first page
 * because a reordered listing cannot keep the page it was read on (the writer's own rule, not this file's),
 * and a sorted URL reloads to the identical result set. Its options are the taxonomy's own list, so the
 * order the keys appear in and the words a shopper reads have one home, and the comparators that apply a
 * key stay in `src/lib/catalogService.ts`; no ordering rule is written here.
 *
 * The control is never disabled. While the catalogue is reloading it stays usable, and a failed load leaves
 * it usable so picking another order issues a fresh request; the surface reports the in-flight state with
 * its own `aria-busy` and skeleton treatment. The change is announced by the result count the page already
 * publishes in a polite live region, so this control opens no second one. Keyboard operation, the picker a
 * phone opens and the accessible name are the native `<select>`'s, which is what the select primitive
 * renders.
 *
 * The select carries no `name`, deliberately: the control's only way out of the page is the navigation the
 * context's setter performs, and a named control inside a form the surface happens to wrap would be
 * submitted with it, giving the sort a second and competing path into the query.
 *
 * The control lives in the search slice while the catalogue page composes it too, because every surface that
 * sorts a listing sorts it the same way: the vocabulary is `src/constants/taxonomy.ts`'s, the URL write is
 * `src/utils/queryParams.ts`'s and the ordering is `src/lib/catalogService.ts`'s, so this file carries no
 * domain rule and nothing is duplicated by the two surfaces sharing it. No feature slice imports another, so
 * a catalogue page composes this control rather than reaching into the search slice for it.
 *
 * @param props - The key to show, the change to report onward, the visible label, the dense arrangement and
 *   any extra classes. See {@link SortControlProps}.
 * @returns The field holding the sort select.
 * @throws When rendered above every `CatalogProvider`: the URL is this control's store and the provider is
 *   what holds it, so a control without one has no sort to show and no setter to write with.
 */
export function SortControl({
  value,
  onChange,
  label,
  isCompact = false,
  className,
}: SortControlProps): ReactElement {
  const catalogFilters = useCatalogFilters();
  // The prop wins; otherwise the URL's key, which the query writer has already normalised and defaulted.
  const sortKey = value ?? catalogFilters.filters.sort;

  const changeSort = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    if (!isSortKey(next)) return;
    catalogFilters.setSort(next);
    onChange?.(next);
  };

  return (
    <Select
      label={label ?? CATALOG_COPY.SORT_GROUP_LABEL}
      options={SORT_OPTIONS}
      value={sortKey}
      onChange={changeSort}
      containerClassName={composeClassName(isCompact && "sp-sort", className)}
    />
  );
}
