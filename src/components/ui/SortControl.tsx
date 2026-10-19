/**
 * Path: src/components/ui/SortControl.tsx
 * Purpose: The sort selector both the catalogue and search surfaces compose, reporting the chosen key onward
 * Lines: 139
 */

import type { ChangeEvent, ReactElement } from "react";

import { Select } from "@/components/ui/Select";
import { CATALOG_COPY } from "@/constants/content";
import { SORT_OPTIONS } from "@/constants/taxonomy";
import type { SortKey } from "@/types/catalog";

/*
 * Class contract. This list is what the sheets owe the control, each class named with the sheet that declares
 * it. `sp-sort`, declared in `src/styles/catalog.css`, is the row-saving arrangement of a labelled select:
 * its own base rule stacks the label above the select, and from `--breakpoint-md` it places the label beside
 * a select capped at the facet column's width, which is the shape `.sp-result-meta > .sp-sort` closes to the
 * end of its own row. That is what `isCompact` asks for, and it is the only class this file adds. The select,
 * its chevron wrapper and the field's own label, hint and error slots carry the names
 * `src/components/ui/Select.tsx` and `src/styles/controls.css` already own — the standard field this control
 * renders when `isCompact` is omitted — so nothing here restates them, and no colour, radius, shadow or
 * inline style appears in this file. How wide the field ends up is its container's rule, not this file's: it
 * fills the column it is given, and inside a wrapping flex row such as `.sp-result-meta` on a phone it takes
 * the width of its own content.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: the sheets declare no modifier that compacts the field's stacked anatomy
 * below `--breakpoint-md` — `.sp-sort` is the one dense arrangement on offer and its own base rule still
 * stacks the label above the select on a phone — so `isCompact` reaches that arrangement rather than a
 * second one. A rule only the sheet can add would be needed for the label to sit beside the select at
 * every width, and inventing one here would put a value outside `tokens.css`.
 */

// The control contract ----------------------------------------------------------------------------

/** Everything {@link SortControl} accepts. */
export interface SortControlProps {
  /**
   * The key the control shows. The URL is its only store and the caller passes what it holds — the query
   * writer `src/utils/queryParams.ts` has already normalised it and filled the default in — so the control
   * renders the sort the address bar carries rather than one of its own.
   */
  readonly value: SortKey;
  /**
   * Reports the key the shopper picked. The caller writes it through the catalogue's own setter, which
   * navigates: the URL stays the single store of the query, the listing returns to its first page because a
   * reordered listing cannot keep the page it was read on (the writer's own rule, not this file's), and a
   * sorted URL reloads to the identical result set.
   */
  readonly onChange: (sort: SortKey) => void;
  /** The control's visible label, which is also its accessible name; the shared wording unless a caller
   * passes one. */
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

// Private helpers ---------------------------------------------------------------------------------

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

/**
 * The sort selector of a catalogue listing or a set of search results: one labelled select whose value is the
 * sort the caller holds and whose change reports the key the shopper picked.
 *
 * The control holds no copy of the sort. The address bar is its only store, and the caller passes both the
 * value it reads there and the setter that writes it back — `useCatalogFilters().filters.sort` and that
 * context's `setSort` on the two surfaces that compose this control today — so no surface keeps the two in
 * step and the listing returns to its first page through the writer's own rule. The options are the
 * taxonomy's own list, so the order the keys appear in and the words a shopper reads have one home, and the
 * comparators that apply a key stay in `src/lib/catalogService.ts`; no ordering rule is written here. The key
 * a change carries is looked up among those options rather than cast from the DOM's string, so a value the
 * option list does not carry is ignored and the query keeps the sort it holds.
 *
 * The control is never disabled. While the listing is reloading it stays usable, and a failed load leaves it
 * usable so picking another order issues a fresh request; the surface reports the in-flight state with its own
 * `aria-busy` and skeleton treatment. The change is announced by the result count the page already publishes
 * in a polite live region, so this control opens no second one. Keyboard operation, the picker a phone opens
 * and the accessible name are the native `<select>`'s, which is what the select primitive renders.
 *
 * The select carries no `name`, deliberately: the control's only way out of the page is the navigation the
 * caller's setter performs, and a named control inside a form the surface happens to wrap would be submitted
 * with it, giving the sort a second and competing path into the query.
 *
 * It lives in the shared presentation layer because both surfaces that sort a listing sort it the same way,
 * and a feature slice may not import another: the catalogue page composes this control and the search page
 * composes this control, so neither the vocabulary lookup, the arrangement class nor the setter call exists in
 * two files and this file carries no domain rule of its own.
 *
 * Assumes the caller renders it inside a router and above the provider that holds the query, because the
 * change it reports is written back by navigating — this control reads no context and enforces neither, which
 * is what keeps it free of the state layer it would otherwise sit above.
 *
 * @param props - The key to show, the change to report onward, the visible label, the dense arrangement and
 *   any extra classes. See {@link SortControlProps}.
 * @returns The field holding the sort select.
 */
export function SortControl({
  value,
  onChange,
  label,
  isCompact = false,
  className,
}: SortControlProps): ReactElement {
  const changeSort = (event: ChangeEvent<HTMLSelectElement>): void => {
    // The value is looked up among the vocabulary's own keys rather than cast, so a value the control did not
    // offer is ignored and the query keeps the sort it holds.
    const chosen = SORT_OPTIONS.find((option) => option.value === event.target.value);
    if (chosen === undefined) return;
    onChange(chosen.value);
  };

  return (
    <Select
      label={label ?? CATALOG_COPY.SORT_GROUP_LABEL}
      options={SORT_OPTIONS}
      value={value}
      onChange={changeSort}
      containerClassName={composeClassName(isCompact && "sp-sort", className)}
    />
  );
}
