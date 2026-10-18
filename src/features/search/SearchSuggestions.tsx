/**
 * Path: src/features/search/SearchSuggestions.tsx
 * Purpose: The type-ahead suggestion list grouping product, brand and category matches
 * Lines: 309
 */

import type { ReactElement } from "react";

import { Alert, Spinner } from "@/components/ui/Feedback";
import type { AlertProps } from "@/components/ui/Feedback";
import { COMMON_ACTIONS, SEARCH_COPY } from "@/constants/content";
import { groupSuggestionsByKind, highlightSegments, tokenise } from "@/lib/searchService";
import type { SearchLookup, SuggestionGroup } from "@/lib/searchService";
import type { Product, SearchSuggestion, SuggestionKind } from "@/types/catalog";
import { isAbortError } from "@/utils/async";
import { formatDiscount, formatMoney, formatScaledPercent } from "@/utils/format";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class is consumed by name from `src/styles/catalog.css`, which owns this
 * surface. `sp-search-suggestions` is the panel the bar anchors; `__list` is one kind's own grid —
 * carried by the group wrapper rather than by the listbox, because its `display: grid` is what makes
 * each row a grid item that spans the panel, so a selected row's tint and its leading accent bar cover
 * the whole row instead of the row's text box; `__group` is that kind's title; `__item` is a row, whose
 * `[aria-selected="true"]` state the sheet paints with a tint and a leading accent bar, so which row is
 * current never rests on colour alone; `__kind` is a row's trailing caption; `__empty` is the region the
 * loading and empty states share. The listbox element itself carries no class: it needs only its id, its
 * role and its accessible name, and every group inside it is laid out by the sheet's own grid.
 *
 * BLITZY [CONTRACT]: a matched run is marked with the `mark` element inside a row's item class, whose
 * element default `src/styles/base.css` paints with the accent-subtle and accent-contrast tokens, so the
 * marking colour reaches the document through `tokens.css` like every other value on this surface.
 *
 * BLITZY [BUDGET]: the concern reached 309 lines against its 270-line budget — the class contract, the
 * four data states, the ARIA wiring of a labelled listbox and the extraction of the option row — and
 * stays well inside the 600-line ceiling. Nothing was cut from it to reach a number.
 */

/** The panel's classes, written once so a rename is one edit. */
const CLASSES = {
  panel: "sp-search-suggestions",
  list: "sp-search-suggestions__list",
  group: "sp-search-suggestions__group",
  item: "sp-search-suggestions__item",
  kind: "sp-search-suggestions__kind",
  empty: "sp-search-suggestions__empty",
} as const;

/** One group's title, from the content library, so no wording is written here. */
const KIND_TITLES: Readonly<Record<SuggestionKind, string>> = {
  product: SEARCH_COPY.SUGGESTIONS_PRODUCTS_HEADING,
  brand: SEARCH_COPY.SUGGESTIONS_BRANDS_HEADING,
  category: SEARCH_COPY.SUGGESTIONS_CATEGORIES_HEADING,
};

/** The listbox's accessible name, from the content library. */
const LIST_LABEL = SEARCH_COPY.SUGGESTIONS_LIST_LABEL;

/**
 * The state of the suggestion request being rendered: the four states `AsyncStatus` declares in
 * `src/types/common.ts`, stated here because that module is not a declared dependency of this file. A
 * caller's `AsyncStatus` value satisfies this type unchanged, so nothing converts on the way in.
 */
export type SuggestionRequestStatus = "idle" | "loading" | "success" | "error";

/** The shaped failure a request reports, taken from the alert that renders it rather than restated. */
export type SuggestionError = NonNullable<AlertProps["error"]>;

/** Everything {@link SearchSuggestions} accepts. */
export interface SearchSuggestionsProps {
  /** The suggestions to list, as the service ranked them: products, then brands, then categories. */
  readonly suggestions: readonly SearchSuggestion[];
  /** Supplies the brand name a product row's caption shows; the data layer owns the names. */
  readonly lookup: SearchLookup;
  /** The term the suggestions answer, whose tokens decide which runs of a row's text are marked. */
  readonly query: string;
  /** Where the request stands. */
  readonly status: SuggestionRequestStatus;
  /** The failure to render; a superseded request is rendered as nothing instead. */
  readonly error?: SuggestionError;
  /** The id of the listbox this file renders, from which every option id is derived. */
  readonly listId: string;
  /** The flat position of the current row, or `-1` when no row is current. */
  readonly activeIndex: number;
  /** What choosing a suggestion does; `SearchBar` owns the navigation it leads to. */
  readonly onSelect: (suggestion: SearchSuggestion) => void;
  /** Reports the row a pointer or a focus landed on, so the bar can make that row current. */
  readonly onPreview?: (index: number) => void;
  /** What the retry action on a failed request does. */
  readonly onRetry?: () => void;
  /**
   * Resolves the product a product suggestion names, from that suggestion's own target — the only
   * identity a suggestion carries. A suggestion is answered as a label, a kind and a target, with no
   * price and no brand, so a caller that can reach the catalogue passes this to have the caption filled
   * in; without it a product row renders its name alone rather than a figure nobody supplied.
   */ readonly productLookup?: (target: string) => Product | undefined;
  /** Extra classes for the panel's own box. */
  readonly className?: string;
}

/**
 * The id of one option row, from the listbox it belongs to and the option's flat position: the single
 * place the format is decided, so the input in `SearchBar.tsx` points `aria-activedescendant` at exactly
 * the element this component renders for that position.
 *
 * @param listId - The id of the listbox the options belong to.
 * @param index - The option's flat position, in the order the grouped rows render in.
 * @returns The element id of that option.
 */
export function suggestionOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** The id of one kind's group title, derived from the listbox's id so a group and its own label agree. */
function groupTitleId(listId: string, kind: SuggestionKind): string {
  return `${listId}-group-${kind}`;
}

/** Whether a failure reports a request a newer one replaced: a cancelled keystroke, not a fault, which the
 *  transport answers with `request-aborted` and never rejects. A cancellation reaching here another way is
 *  recognised by `isAbortError`; either way nothing is shown, because the newer request owns the panel. */
function isSuperseded(error: SuggestionError): boolean {
  return isAbortError(error) || error.code === "request-aborted";
}

/** One kind's suggestions, each carrying the flat position its option id and the current row count by. */
type NumberedGroup = Omit<SuggestionGroup, "items"> & {
  readonly items: readonly { readonly suggestion: SearchSuggestion; readonly index: number }[];
};

/** Numbers the suggestions in the order the rows render: kinds as the service grouped them, each kind's
 *  own suggestions as they arrived — best match first for a ranked payload. A caller counts the same rows
 *  with these numbers, so one number identifies a suggestion for the input and for this list alike. */
function numberSuggestions(groups: readonly SuggestionGroup[]): NumberedGroup[] {
  let next = 0;
  return groups.map((group) => ({
    kind: group.kind,
    items: group.items.map((suggestion) => {
      const index = next;
      next += 1;
      return { suggestion, index };
    }),
  }));
}

/** A product row's trailing caption: the brand, the price, and — only when the list price sits above the
 *  price — the whole percentage saved, both figures formatted by `src/utils/format.ts` and joined by a
 *  separator, so no money and no percentage is computed or rendered here. */
function productCaption(product: Product, lookup: SearchLookup): string {
  const parts = [
    lookup.brandName(product.brandId),
    formatMoney(product.priceMinor, product.currency),
  ];
  const discount = formatDiscount(product.listPriceMinor, product.priceMinor);
  if (discount > 0) parts.push(formatScaledPercent(discount, 0));
  return parts.join(" · ");
}

/** What every row of one list shares: the listbox and the wiring, taken from the list's own props, plus
 *  the query's tokens a row's text is marked by and the position of the current row. */
type SuggestionRowContext = Pick<
  SearchSuggestionsProps,
  "listId" | "lookup" | "productLookup" | "onSelect" | "onPreview" | "activeIndex"
> & { readonly tokens: readonly string[] };

/** Everything one suggestion row renders from. */
interface SuggestionRowProps {
  /** The suggestion to render. */
  readonly suggestion: SearchSuggestion;
  /** The row's flat position, which its option id is built from and which decides whether it is current. */
  readonly index: number;
  /** What the row shares with the rest of the list. */
  readonly context: SuggestionRowContext;
}

/** One option of the listbox: a real button carrying `role="option"`, so the listbox owns it and the
 *  input's `aria-activedescendant` can name it. It stays out of the tab order on purpose — the field keeps
 *  focus and the bar moves the current row — and the pointer's own event does the choosing with its default
 *  suppressed, so the field never loses focus and the panel cannot close before the row is picked. The
 *  kind of a row is carried by its group's title, which is text. */
function SuggestionRow({ suggestion, index, context }: SuggestionRowProps): ReactElement {
  const { listId, tokens, lookup, productLookup, activeIndex, onSelect, onPreview } = context;
  const product = suggestion.kind === "product" ? productLookup?.(suggestion.target) : undefined;
  const caption = product === undefined ? undefined : productCaption(product, lookup);
  const segments = highlightSegments(suggestion.text, tokens);

  return (
    <button
      type="button"
      role="option"
      id={suggestionOptionId(listId, index)}
      className={CLASSES.item}
      aria-selected={index === activeIndex}
      tabIndex={-1}
      onPointerDown={(event) => {
        event.preventDefault();
        onSelect(suggestion);
      }}
      onPointerEnter={() => onPreview?.(index)}
      onFocus={() => onPreview?.(index)}
    >
      <span>
        {segments.map((segment, position) =>
          segment.matched ? (
            <mark key={`${position}:${segment.text}`}>{segment.text}</mark>
          ) : (
            segment.text
          ),
        )}
      </span>
      {caption === undefined ? null : <span className={CLASSES.kind}>{caption}</span>}
    </button>
  );
}

/**
 * The type-ahead list for a term typed into the search field: the suggestions the service ranked, grouped
 * by kind under a title each, every row an option the field points at with `aria-activedescendant`, and the
 * runs of a row's text a query token matched marked.
 *
 * It renders what it is given and owns no state: `SearchBar.tsx` holds the field, the debounce, the abort
 * controller and the current position, and this component reports a choice through `onSelect` and a hovered
 * or focused row through `onPreview`. The request as it stands decides what is shown, in this precedence: a
 * superseded request renders nothing; one in flight renders the loading ring with the panel still anchored
 * to the field; a failure renders the shaped message with the retry action; and otherwise the grouped rows,
 * or — when a completed request matched nothing — the message saying so. A request that has not been made
 * renders nothing at all.
 *
 * @param props - The suggestions, the request's state, the listbox id and the callbacks.
 * @returns The panel, or nothing when there is nothing to show.
 */
export function SearchSuggestions({
  suggestions,
  lookup,
  query,
  status,
  error,
  listId,
  activeIndex,
  onSelect,
  onPreview,
  onRetry,
  productLookup,
  className,
}: SearchSuggestionsProps): ReactElement | null {
  if (error !== undefined && isSuperseded(error)) return null;
  const panelClass = className ? `${CLASSES.panel} ${className}` : CLASSES.panel;
  if (status === "loading") {
    return (
      <div className={panelClass}>
        <Spinner className={CLASSES.empty} size="sm" />
      </div>
    );
  }
  if (error !== undefined) {
    return (
      <div className={panelClass}>
        <Alert tone="danger" error={error} actionLabel={COMMON_ACTIONS.RETRY} onAction={onRetry} />
      </div>
    );
  }
  const groups = numberSuggestions(groupSuggestionsByKind(suggestions));
  if (groups.length === 0) {
    if (status !== "success") return null;
    return (
      <div className={panelClass}>
        <p className={CLASSES.empty} role="status">
          {SEARCH_COPY.SUGGESTIONS_EMPTY}
        </p>
      </div>
    );
  }
  const context: SuggestionRowContext = {
    listId,
    lookup,
    productLookup,
    activeIndex,
    onSelect,
    onPreview,
    tokens: tokenise(query),
  };

  return (
    <div className={panelClass}>
      <div id={listId} role="listbox" aria-label={LIST_LABEL}>
        {groups.map((group) => (
          <div
            key={group.kind}
            role="group"
            aria-labelledby={groupTitleId(listId, group.kind)}
            className={CLASSES.list}
          >
            <p id={groupTitleId(listId, group.kind)} className={CLASSES.group}>
              {KIND_TITLES[group.kind]}
            </p>
            {group.items.map((entry) => (
              <SuggestionRow
                key={entry.suggestion.target}
                suggestion={entry.suggestion}
                index={entry.index}
                context={context}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
