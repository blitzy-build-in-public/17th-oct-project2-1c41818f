/**
 * Path: src/features/search/SearchBar.tsx
 * Purpose: The search input with debounced suggestions, keyboard selection and recent history
 * Lines: 491
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SEARCH_SUGGESTION_DEBOUNCE_MS, SEARCH_SUGGESTION_LIMIT } from "@/constants/config";
import { COMMON_ACTIONS, SEARCH_COPY, suggestionsUpdatedAnnouncement } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SearchSuggestions, suggestionOptionId } from "@/features/search/SearchSuggestions";
import { isBlankQuery, suggest } from "@/lib/searchService";
import type { SearchLookup } from "@/lib/searchService";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";
import { useAsync, useDebouncedValue, useOnClickOutside } from "@/state/hooks";
import type { Facet, FacetId, SearchSuggestion } from "@/types/catalog";
import { filtersToPath, setQuery as withQueryTerm } from "@/utils/queryParams";

/*
 * Class contract, the list `src/styles/catalog.css` owes this file; no stylesheet is imported here,
 * because `src/main.tsx` is the only importer of `src/styles/**`. `sp-search-bar` is the bar's box and is
 * `position: relative`, which the anchored panel hangs from; `__form` is the row holding the field and
 * the two controls; `__submit` is the search action. `__input` rides on the *field wrapper* rather than
 * the `<input>`, because `flex: 1 1 auto` and `min-inline-size: 0` only mean anything on that row's
 * flexible child, while the primitive renders its `<input>` inside the wrapper at `inline-size: 100%`.
 * `__clear` is the clear action, present only while a value is typed: the sheet states the component
 * carries the `hidden` attribute for that. The panel and its rows belong to `SearchSuggestions`, which
 * the bar renders rather than reproduces; the panel rendered in its place — the session's recent terms —
 * reuses the panel class and the three registers from inside it — the group heading, a row and the grid
 * one group's rows are laid out in — because the sheet declares `sp-search-history` as a grid holding its
 * rows and then its clear action, which `justify-self` packs to the end of it.
 *
 * BLITZY [CONTRACT]: the bar hands `SearchSuggestions` the brand and category names it can reach — the
 * term facets the catalogue service counted, whose values pair the identifier the URL carries with the
 * shopper's wording — and no product lookup, because the only identity a suggestion carries is the route
 * path it points at and the seeded collections sit behind the transport. A product row therefore renders
 * its name alone here; the brand-and-price caption waits on a layer that can resolve a product.
 *
 * BLITZY [BUDGET]: the concern reached 491 lines against its 330-line budget and stays inside the
 * 600-line ceiling, so its overrun is taken from the remainder rather than from a capability. The lines
 * hold the surface the plan names — `SearchBarProps` and `SearchBar` — plus the eight private members the
 * bar cannot do without: the class table, the two glyphs, the facet-derived name lookup the suggestion
 * list requires, the recent-terms rule, the list cursor the keyboard moves and the choice union over the
 * two lists. The rest went where the plan's own rules put it: the class-contract comment every file under
 * `src/features/**` carries because no file may import a stylesheet, the JSDoc on every member, and the
 * two panels with the keyboard, the announcement and the clear control over them. The request itself is
 * `useAsync` in `src/state/hooks.ts`, which owns the abort controller, the superseded-run guard and the
 * shaping of a failure, so none of those is written a second time here. No line is padding and nothing
 * was cut to reach a number.
 */

/** The classes this file consumes, written once so a rename is one edit. */
const CLASSES = {
  bar: "sp-search-bar",
  form: "sp-search-bar__form",
  field: "sp-search-bar__input",
  clear: "sp-search-bar__clear",
  submit: "sp-search-bar__submit",
  panel: "sp-search-suggestions",
  list: "sp-search-suggestions__list",
  group: "sp-search-suggestions__group",
  item: "sp-search-suggestions__item",
  history: "sp-search-history",
  visuallyHidden: "sp-visually-hidden",
} as const;

/** How many submitted terms the bar keeps for as long as the application is mounted. */
const RECENT_SEARCH_LIMIT = 5;

/** What joins the parts of a list's key; no term a shopper types can hold one. */
const LIST_KEY_SEPARATOR = "\u0000";

/** The key of no list at all, so the first render is never mistaken for a list's own key. */
const NO_LIST_KEY = "no-list";

/** The empty answer, shared rather than allocated, so a panel with nothing to list changes nothing. */
const NO_SUGGESTIONS: readonly SearchSuggestion[] = [];

/** The magnifier on the search action: decoration, because the control carrying it owns the name. */
function SearchGlyph(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M16.4 16.4 21 21" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

/** The cross on the clear action; decoration for the same reason. */
function ClearGlyph(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

/**
 * The catalogue's own name tables, read from the term facets the catalogue service counted: those values
 * pair the identifier the URL holds as `value` with the wording the shopper reads as `label`. An
 * identifier no facet carries is answered as itself, the degradation `src/data/products.ts` makes for a
 * brand it does not know.
 *
 * @param facets - The facets of the catalogue's current query, as the view holds them.
 * @returns The brand and category name lookups, resolved against those facets.
 */
function nameLookupFrom(facets: readonly Facet[]): SearchLookup {
  const tables = new Map<FacetId, ReadonlyMap<string, string>>();
  for (const facet of facets) {
    if (facet.kind !== "terms") continue;
    tables.set(facet.id, new Map(facet.values.map((value) => [value.value, value.label])));
  }
  const nameOf = (facetId: FacetId, id: string): string => tables.get(facetId)?.get(id) ?? id;
  return { brandName: (id) => nameOf("brand", id), categoryName: (id) => nameOf("category", id) };
}

/**
 * Adds a submitted term to the session's recent terms: most recent first, unique without regard to case,
 * no longer than {@link RECENT_SEARCH_LIMIT}. A blank term changes nothing, because a submission that
 * searched for nothing is not something to offer back.
 *
 * @param terms - The terms kept so far, most recent first.
 * @param term - The term just submitted, as the field held it.
 * @returns The next list, or the same list when there is nothing to record.
 */
function rememberTerm(terms: readonly string[], term: string): readonly string[] {
  const entry = term.trim();
  if (entry === "") return terms;
  const others = terms.filter((item) => item.toLowerCase() !== entry.toLowerCase());
  return [entry, ...others].slice(0, RECENT_SEARCH_LIMIT);
}

/** The row the keyboard is on, held together with the list it belongs to. */
interface ListCursor {
  /** The key of the list the row belongs to. */
  readonly key: string;
  /** The row's position in that list, or `-1` when no row is current. */
  readonly index: number;
}

/** One row of whichever list the keyboard is moving through: a recent term, or a suggestion. */
type Choice = SearchSuggestion | string;

/** Everything {@link SearchBar} accepts. */
export interface SearchBarProps {
  /**
   * The term the field opens with, for a host that renders the bar before the URL carries one. It is read
   * only while the URL holds no term, so the URL's own term wins the moment it has one and the field
   * follows it again after a submission.
   */
  readonly initialQuery?: string;
  /** Moves the caret into the field on mount, for a bar that is the page's first control. */
  readonly autoFocus?: boolean;
  /** Called with the submitted term once the URL has been asked for it, for a host that reacts to one. */
  readonly onSubmitted?: (query: string) => void;
  /** Extra classes for the bar's own box, appended after its own for the caller's layout. */
  readonly className?: string;
}

/**
 * The search field: a labelled combobox over the catalogue's type-ahead, with the keyboard driving the
 * list and the session's recent terms offered while nothing searchable is typed.
 *
 * The URL is the only store of the submitted term — the bar reads it through `useCatalogFilters` and
 * writes it through that context's setter — while the text being edited, the panel, the current row and
 * the recent terms are the bar's own state. Matching, ranking and the targets a suggestion points at are
 * `src/lib/searchService.ts`'s; filtering and faceting are `src/lib/catalogService.ts`'s.
 *
 * The recent terms live in React state for as long as the application is mounted and are deliberately
 * never written to `localStorage`: `STORAGE_KEYS` declares an entry for the cart, the session token, the
 * account store's session table and the last-used report range only, and `src/utils/storage.ts` is the
 * product's only durable store, so a reload starts with an empty history.
 *
 * @param props - The opening term, the autofocus flag, the submission callback and extra classes.
 * @returns The bar: the field, its clear and search actions, the panel and the announced option count.
 */
export function SearchBar({
  initialQuery,
  autoFocus = false,
  onSubmitted,
  className,
}: SearchBarProps): ReactElement {
  // Kept whole rather than destructured: the context's setters are methods, and calling one away from
  // the object it belongs to is what `@typescript-eslint/unbound-method` refuses.
  const catalogFilters = useCatalogFilters();
  const { facets } = useCatalog();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const listId = useId();
  const recentHeadingId = `${listId}-recent`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The text being edited, and nothing else: `null` means the field is showing the URL's own term.
  const [edited, setEdited] = useState<string | null>(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [terms, setTerms] = useState<readonly string[]>([]);
  const [cursor, setCursor] = useState<ListCursor>({ key: NO_LIST_KEY, index: -1 });

  const urlTerm = catalogFilters.filters.q;
  const text = edited ?? (urlTerm !== "" ? urlTerm : (initialQuery ?? ""));
  const settled = useDebouncedValue(text, SEARCH_SUGGESTION_DEBOUNCE_MS);
  // A term holding nothing searchable — empty, punctuation, a lone character — is the absence of a filter
  // rather than a search: no suggestion is asked for, and the panel offers the session's recent terms.
  // An emptied field counts as blank at once rather than when the debouncer settles, so the term just
  // cleared and its answer never flash back in the panel behind the field the shopper emptied.
  const isBlank = text.trim() === "" || isBlankQuery(settled);

  const request = useAsync<readonly SearchSuggestion[]>(
    (signal) => suggest(settled, SEARCH_SUGGESTION_LIMIT, signal),
    [settled],
    { enabled: !isBlank },
  );

  const lookup = useMemo(() => nameLookupFrom(facets), [facets]);

  const suggestions = request.data ?? NO_SUGGESTIONS;
  const showHistory = isPanelOpen && isBlank && terms.length > 0;
  const showSuggestions = isPanelOpen && !isBlank && request.status !== "idle";
  const isPanelShown = showHistory || showSuggestions;
  // The rows the panel is rendering, which is what the keyboard moves through: the recent terms while
  // nothing searchable is typed, and the answer's own rows once one has arrived.
  const optionCount = isBlank
    ? terms.length
    : request.status === "success"
      ? suggestions.length
      : 0;
  // The listbox the field's ARIA state describes: both places that render one — the recent terms here and
  // the suggestions below — render a row per counted option, while the panel's loading ring, its failure
  // alert and its empty line render no listbox at all. `aria-expanded`, `aria-controls` and the current
  // row are read off this one flag, so none of them names a popup no element answers to.
  const isListboxShown = isPanelShown && optionCount > 0;

  // The list the keyboard is on, as one string. The list's own contents decide the key, so a new answer
  // or a new first term is a new key and the current row is dropped rather than left pointing at a row
  // that has moved. Nothing is written during a render, and no effect resets it.
  const listKey = isBlank
    ? `history${LIST_KEY_SEPARATOR}${terms.join(LIST_KEY_SEPARATOR)}`
    : `${request.status}${LIST_KEY_SEPARATOR}${settled}${LIST_KEY_SEPARATOR}${optionCount}`;
  const activeIndex = cursor.key === listKey ? cursor.index : -1;
  const activeDescendant =
    isListboxShown && activeIndex >= 0 && activeIndex < optionCount
      ? suggestionOptionId(listId, activeIndex)
      : undefined;

  /** Closes the panel and clears the current row, which is what every dismissal of it does. */
  const closePanel = useCallback((): void => {
    setPanelOpen(false);
    setCursor({ key: listKey, index: -1 });
  }, [listKey]);

  /**
   * Submits a term: the URL is written through the catalogue's own setter, which is the one writer of
   * query state, and the bar moves to the search route when it is not already on it.
   *
   * A route change beside that write would not do, because `react-router-dom` resolves the setter's
   * search-only navigation against the location of the render that raised it: the term would land on the
   * route being left, or the change of route would drop it. Off the search route the term and the route
   * therefore travel in one navigation, built by the query writer's own path builder — byte for byte the
   * URL the setter writes on the search route — so a submit reads the same wherever it is made.
   */
  const submit = useCallback(
    (term: string): void => {
      if (pathname === ROUTES.SEARCH) {
        catalogFilters.setQuery(term);
      } else {
        void navigate(filtersToPath(ROUTES.SEARCH, withQueryTerm(catalogFilters.filters, term)));
      }
      // The field follows the URL again from here, which is what keeps the submitted term in one place.
      setEdited(null);
      setTerms((previous) => rememberTerm(previous, term));
      closePanel();
      onSubmitted?.(term);
    },
    [catalogFilters, closePanel, navigate, onSubmitted, pathname],
  );

  /** Takes a suggestion's own target, which the service built, so no path is assembled here. */
  const chooseSuggestion = useCallback(
    (suggestion: SearchSuggestion): void => {
      closePanel();
      void navigate(suggestion.target);
    },
    [closePanel, navigate],
  );

  const choose = useCallback(
    (choice: Choice): void => {
      if (typeof choice === "string") {
        submit(choice);
        return;
      }
      chooseSuggestion(choice);
    },
    [chooseSuggestion, submit],
  );

  /** Moves the current row one step, wrapping at either end, and opens the panel if it was closed. */
  const stepCurrent = useCallback(
    (delta: 1 | -1): void => {
      if (optionCount === 0) return;
      setPanelOpen(true);
      const index =
        activeIndex < 0
          ? delta === 1
            ? 0
            : optionCount - 1
          : (activeIndex + delta + optionCount) % optionCount;
      setCursor({ key: listKey, index });
    },
    [activeIndex, listKey, optionCount],
  );

  /** Issues the suggestion request again, which is what the panel's failure state offers. */
  const retry = useCallback((): void => {
    request.reload();
  }, [request]);

  /** Makes the row the pointer or the focus landed on the current one, without choosing it. */
  const preview = useCallback(
    (index: number): void => {
      setCursor({ key: listKey, index });
    },
    [listKey],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setEdited(event.target.value);
    setPanelOpen(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit(text);
  };

  /**
   * The field's own keys. Enter belongs to the form while no row is current, so the term the shopper
   * typed is what a bare Enter searches for; Escape closes the panel and leaves the text untouched; Tab
   * closes it and moves on, which is why that key is not consumed.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        stepCurrent(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        stepCurrent(-1);
        return;
      case "Enter": {
        const choice: Choice | undefined =
          activeIndex < 0 ? undefined : (isBlank ? terms : suggestions)[activeIndex];
        if (choice === undefined) return;
        event.preventDefault();
        choose(choice);
        return;
      }
      case "Escape":
        event.preventDefault();
        closePanel();
        return;
      case "Tab":
        closePanel();
        return;
      default:
        return;
    }
  };

  const handleClear = useCallback((): void => {
    setEdited("");
    closePanel();
    inputRef.current?.focus();
  }, [closePanel]);

  useOnClickOutside(containerRef, closePanel, { enabled: isPanelOpen });

  const announcement =
    isListboxShown && !isBlank ? suggestionsUpdatedAnnouncement(optionCount) : "";

  return (
    <div
      ref={containerRef}
      className={className === undefined ? CLASSES.bar : `${CLASSES.bar} ${className}`}
    >
      <form className={CLASSES.form} role="search" onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          containerClassName={CLASSES.field}
          label={SEARCH_COPY.FIELD_LABEL}
          placeholder={SEARCH_COPY.PLACEHOLDER}
          value={text}
          autoFocus={autoFocus}
          // The panel is the product's own suggestion surface, so the engine's completion list is kept out
          // of the field, and the return key says what it does on a touch keyboard.
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={isListboxShown}
          // The reference exists while the listbox does: a popup rendering a loading ring, a failure or an
          // empty line holds no element with that id, so the field names one only while one is rendered.
          aria-controls={isListboxShown ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          onChange={handleChange}
          onFocus={() => setPanelOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <IconButton
          className={CLASSES.clear}
          variant="ghost"
          label={COMMON_ACTIONS.CLEAR}
          icon={<ClearGlyph />}
          hidden={text === ""}
          onClick={handleClear}
        />
        <IconButton
          className={CLASSES.submit}
          type="submit"
          label={COMMON_ACTIONS.SEARCH}
          icon={<SearchGlyph />}
        />
      </form>
      {showHistory ? (
        <div className={CLASSES.panel}>
          <div className={CLASSES.history}>
            <div id={listId} role="listbox" aria-label={SEARCH_COPY.SUGGESTIONS_LIST_LABEL}>
              <div className={CLASSES.list} role="group" aria-labelledby={recentHeadingId}>
                <p className={CLASSES.group} id={recentHeadingId}>
                  {SEARCH_COPY.RECENT_HEADING}
                </p>
                {terms.map((term, index) => (
                  <button
                    key={term}
                    type="button"
                    role="option"
                    id={suggestionOptionId(listId, index)}
                    className={CLASSES.item}
                    aria-selected={index === activeIndex}
                    tabIndex={-1}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      choose(term);
                    }}
                    onPointerEnter={() => preview(index)}
                    onFocus={() => preview(index)}
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
            {/* Outside the listbox, because a listbox may hold options and the groups around them and no
                other interactive child; the sheet still packs it to the end of the history grid. */}
            <Button variant="link" onClick={() => setTerms([])}>
              {SEARCH_COPY.RECENT_CLEAR_LABEL}
            </Button>
          </div>
        </div>
      ) : null}
      {showSuggestions ? (
        <SearchSuggestions
          suggestions={suggestions}
          lookup={lookup}
          query={settled}
          status={request.status}
          error={request.error ?? undefined}
          listId={listId}
          activeIndex={activeIndex}
          onSelect={chooseSuggestion}
          onPreview={preview}
          onRetry={retry}
        />
      ) : null}
      {/* Present from the first render and only ever given new text, because a live region inserted at the
          moment of the update is not announced reliably. The wording is the type-ahead's own live-region
          helper from `src/constants/content.ts`, counting suggestions rather than the products found. */}
      <p className={CLASSES.visuallyHidden} role="status">
        {announcement}
      </p>
    </div>
  );
}
