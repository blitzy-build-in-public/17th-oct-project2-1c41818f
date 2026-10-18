/**
 * Path: src/utils/queryParams.ts
 * Purpose: Reads and writes filter, sort and page state to the URL, normalising defaults away
 * Lines: 598
 */

/**
 * The URL is the store of every catalogue and search query: this module is its only reader and writer, and no
 * component mirrors a filter value into React state, which is what makes a filtered, sorted and searched URL
 * reload to the identical result set. Reading is tolerant — an unknown sort key, a malformed number, a
 * repeated parameter, an out-of-range page and an inverted price range all resolve to a usable state — while
 * writing is canonical, so two equivalent selections serialise to one URL instead of multiplying it.
 *
 * Per-key contract. `Default` is what `readFilterState` restores when a key is absent and what
 * `DEFAULT_FILTER_STATE` holds; `Omitted when` is what `writeFilterState` leaves out.
 *
 * | URL key       | Field           | Accepted                               | Default | Omitted when | Malformed input |
 * | ------------- | --------------- | -------------------------------------- | ------- | ------------ | --------------- |
 * | `q`           | `q`             | any text, trimmed                      | `""`    | blank        | the first occurrence wins, then trimmed |
 * | `categoryIds` | `categoryIds`   | category ids, repeated or comma-joined | `[]`    | none applied | blank parts dropped, de-duplicated, sorted |
 * | `brandIds`    | `brandIds`      | brand ids, repeated or comma-joined    | `[]`    | none applied | as `categoryIds` |
 * | `minPrice`    | `minPriceMinor` | integer minor units from the floor to the catalogue's top price | no bound | no bound | rounded by `roundMinorUnits`; at or below the floor, or not a safe integer, becomes no bound; above the catalogue's ceiling becomes that ceiling |
 * | `maxPrice`    | `maxPriceMinor` | integer minor units, swapped if below the minimum, read as the ceiling above it | no bound | no bound | as `minPrice` |
 * | `minRating`   | `minRating`     | an integer star, 1 to 5                | no filter | no filter   | a fraction, or a value off the scale, becomes no filter |
 * | `inStock`     | `inStockOnly`   | `true` or `1`                          | `false` | false        | any other value is false |
 * | `tags`        | `tags`          | tags, repeated or comma-joined         | `[]`    | none applied | as `categoryIds` |
 * | `sort`        | `sort`          | one of `SORT_OPTIONS`                  | `relevance` with a term, `newest` without | the default for the query | an unknown key, or `relevance` with no term, falls back to that default |
 * | `page`        | `page`          | an integer page, 1 or above            | `1`     | 1            | a fraction is truncated and a value below 1 becomes 1; a page past the last is clamped by `clampPage` when a page count is known |
 * | `pageSize`    | `pageSize`      | one of the configured sizes, 12/24/48  | `12`    | the default size | an unconfigured size becomes the default |
 *
 * Money stays in minor units in the URL and is rounded only through `src/utils/format.ts`; the page size is
 * validated only through `src/utils/collections.ts`, and the page's ceiling is applied by
 * `src/lib/catalogService.ts`, which knows the result total. No user-facing sentence is written here.
 */

import { CATALOGUE_PRICE_CEILING_MINOR, DEFAULT_PAGE_SIZE } from "@/constants/config";
import {
  FACET_DEFINITIONS,
  SORT_OPTIONS,
  type FacetDefinition,
  type FacetDefinitionOption,
} from "@/constants/taxonomy";
import type { FacetId, FacetQuery, FilterState, SortKey } from "@/types/catalog";
import { clampPage, normalisePageSize, uniqueBy } from "@/utils/collections";
import { roundMinorUnits } from "@/utils/format";

// Local aliases -----------------------------------------------------------------------------------

/**
 * The state's own field types, read as indexed accesses rather than imported from `src/types`. The branded
 * identifiers are asserted from the URL's strings — the signal that they did not come from the generator in
 * `src/utils/strings.ts` — and whether an id names a real category is the data layer's decision.
 */
type CategoryIdentifier = FilterState["categoryIds"][number];
type BrandIdentifier = FilterState["brandIds"][number];
type PriceBound = FilterState["minPriceMinor"];
type RatingFilter = FilterState["minRating"];

/** A price filter's two bounds; either may be absent, which leaves that side of the range open. */
interface PriceRange {
  readonly minPriceMinor: PriceBound;
  readonly maxPriceMinor: PriceBound;
}

// Query-string vocabulary -------------------------------------------------------------------------

/**
 * Every query-string key this module reads and writes, named once so the URL, `GET /api/products` and
 * `GET /api/facets` cannot drift apart. A list is written as one comma-separated value and is also accepted
 * as repeated occurrences of the key.
 */
export const FILTER_PARAMS = {
  QUERY: "q",
  CATEGORY_IDS: "categoryIds",
  BRAND_IDS: "brandIds",
  MIN_PRICE: "minPrice",
  MAX_PRICE: "maxPrice",
  MIN_RATING: "minRating",
  IN_STOCK: "inStock",
  TAGS: "tags",
  SORT: "sort",
  PAGE: "page",
  PAGE_SIZE: "pageSize",
} as const;

/**
 * The lowest price a filter can express, in minor units: a price is never negative, so a lower bound at this
 * floor excludes nothing and is read and written as no bound at all. `src/lib/catalogService.ts` filters from
 * the same floor.
 */
export const PRICE_FILTER_FLOOR_MINOR = 0;

/** The inclusive star range a rating filter accepts — the domain `RatingValue` narrows to. */
const RATING_BOUNDS = { MIN: 1, MAX: 5 } as const;

/** The sort an empty query rests at, and the one the sort control falls back to when a term is cleared. */
const DEFAULT_SORT_KEY: SortKey = "newest";

/** The literal a flag is turned on by, in the URL and in a boolean facet's value alike. */
const TRUE_LITERAL = "true";

/**
 * The canonical empty selection, and the reference every omission is measured against: no query term, no
 * facet, no price bound, no rating, the default sort for an empty query, the first page and the default page
 * size. A listing at this state writes an empty query string, so `/catalog` and `/catalog?` name one listing.
 */
export const DEFAULT_FILTER_STATE: FilterState = {
  q: "",
  categoryIds: [],
  brandIds: [],
  minPriceMinor: null,
  maxPriceMinor: null,
  minRating: null,
  inStockOnly: false,
  tags: [],
  sort: DEFAULT_SORT_KEY,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

// Vocabulary --------------------------------------------------------------------------------------

/** The facet vocabulary as its declared interface, so an entry's optional bands are read uniformly. */
const FACET_VOCABULARY: readonly FacetDefinition[] = FACET_DEFINITIONS;

/** The sort keys the URL accepts, read from the taxonomy so it cannot carry a key the control cannot show. */
const SORT_KEYS: readonly string[] = SORT_OPTIONS.map((option) => option.value);

/** Reports whether a sort key is one the sort control offers. */
const isSortKey = (value: string): value is SortKey => SORT_KEYS.includes(value);

/** The values a facet declares, or none when the catalogue supplies its terms instead. */
function facetOptions(facetId: FacetId): readonly FacetDefinitionOption[] {
  return FACET_VOCABULARY.find((definition) => definition.id === facetId)?.options ?? [];
}

/** One declared value of a facet, or `undefined` when the vocabulary declares no such value. */
function facetOption(facetId: FacetId, value: string): FacetDefinitionOption | undefined {
  return facetOptions(facetId).find((option) => option.value === value);
}

// Normalising -------------------------------------------------------------------------------------

/** Splits one parameter's occurrences into trimmed, non-empty values, however the URL carried them. */
function listValues(params: URLSearchParams, key: string): string[] {
  const values: string[] = [];
  for (const occurrence of params.getAll(key)) {
    for (const part of occurrence.split(",")) {
      const trimmed = part.trim();
      if (trimmed !== "") values.push(trimmed);
    }
  }
  return values;
}

/** A canonical list: de-duplicated and sorted, so two selections holding the same values share one URL. */
function canonicalList(values: readonly string[]): string[] {
  return uniqueBy(values, (value) => value).sort();
}

/** The list with `value` added when it is absent and removed when it is present, kept canonical. */
function toggleList<TValue extends string>(values: readonly TValue[], value: TValue): TValue[] {
  if (values.includes(value)) return values.filter((entry) => entry !== value);
  return uniqueBy([...values, value], (entry) => entry).sort();
}

/** The number a parameter carries, or `null` when it carries no finite figure at all. */
function parseNumber(text: string | null): number | null {
  if (text === null || text.trim() === "") return null;
  const parsed = Number(text.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** The flag a parameter carries: `true` or `1` turns it on, and nothing else does. */
function parseBoolean(params: URLSearchParams, key: string): boolean {
  const raw = (params.get(key) ?? "").trim().toLowerCase();
  return raw === TRUE_LITERAL || raw === "1";
}

/** A rating filter value: a whole star on the scale, or `null` for no rating filter. */
function normaliseRating(value: number | null): RatingFilter {
  if (value === null || !Number.isInteger(value)) return null;
  if (value < RATING_BOUNDS.MIN || value > RATING_BOUNDS.MAX) return null;
  return value as NonNullable<RatingFilter>;
}

/**
 * A price bound in whole minor units: `null` for one that is absent, unrepresentable or at or below the
 * floor, and the catalogue's ceiling for one above it, so no bound names a range the catalogue cannot fill.
 */
function normalisePriceBound(value: number | null): PriceBound {
  if (value === null) return null;
  const rounded = roundMinorUnits(value);
  if (!Number.isSafeInteger(rounded) || rounded <= PRICE_FILTER_FLOOR_MINOR) return null;
  return Math.min(rounded, CATALOGUE_PRICE_CEILING_MINOR);
}

/** A price range with each bound normalised and the two ordered: an inverted range is swapped, not rejected. */
function normalisePriceRange(minimum: PriceBound, maximum: PriceBound): PriceRange {
  const lower = normalisePriceBound(minimum);
  const upper = normalisePriceBound(maximum);
  if (lower === null || upper === null || lower <= upper) {
    return { minPriceMinor: lower, maxPriceMinor: upper };
  }
  return { minPriceMinor: upper, maxPriceMinor: lower };
}

/** The sort an empty query rests at, versus the one a term makes meaningful: relevance needs a term to rank. */
function defaultSortKeyFor(query: string): SortKey {
  return query.trim() === "" ? DEFAULT_SORT_KEY : "relevance";
}

/** The sort a query resolves to: the named key when it is meaningful, otherwise the query's own default. */
function normaliseSort(named: string, query: string): SortKey {
  if (!isSortKey(named)) return defaultSortKeyFor(query);
  return named === "relevance" && query.trim() === "" ? DEFAULT_SORT_KEY : named;
}

/** A requested page as a whole number at or above the first, clamped to `pageCount` when the caller knows it. */
function normalisePageNumber(requested: number | null, pageCount?: number): number {
  const page =
    requested === null || !Number.isFinite(requested) ? 1 : Math.max(1, Math.trunc(requested));
  if (pageCount === undefined || !Number.isFinite(pageCount) || pageCount < 1) return page;
  return clampPage(page, pageCount);
}

// Facet values ------------------------------------------------------------------------------------

/** The range a range facet's value names — a declared band, or the encoded bounds — or `null` for neither. */
function decodePriceRange(value: string): PriceRange | null {
  const option = facetOption("price", value);
  if (option !== undefined)
    return normalisePriceRange(option.minMinor ?? null, option.maxMinor ?? null);
  const separator = value.indexOf("-");
  if (separator < 0) return null;
  const lower = parseNumber(value.slice(0, separator));
  const upper = parseNumber(value.slice(separator + 1));
  if (lower === null && upper === null) return null;
  return normalisePriceRange(lower, upper);
}

/** Narrows a decoded facet value to a range, for dropping the ones that name no range at all. */
function isPriceRange(range: PriceRange | null): range is PriceRange {
  return range !== null;
}

/** The value identifying a price range: a declared band where one matches it, else its encoded bounds. */
function priceValueOf(range: PriceRange): string {
  const band = facetOptions("price").find(
    (option) =>
      (option.minMinor ?? null) === range.minPriceMinor &&
      (option.maxMinor ?? null) === range.maxPriceMinor,
  );
  return band?.value ?? `${range.minPriceMinor ?? ""}-${range.maxPriceMinor ?? ""}`;
}

/** Reports whether a boolean facet's value turns its filter on, in either spelling a URL carries. */
function isFacetTrue(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  if (normalised === TRUE_LITERAL || normalised === "1") return true;
  return facetOptions("availability").some((option) => option.value === normalised);
}

/** The wording `src/constants/taxonomy.ts` gives a facet value, or `null` when it declares none for it. */
function facetValueLabel(facetId: FacetId, value: string): string | null {
  if (facetId === "availability") {
    const option = facetOptions("availability")[0];
    return option !== undefined && isFacetTrue(value) ? option.label : null;
  }
  return facetOption(facetId, value)?.label ?? null;
}

/** A facet value in the canonical form the state's values take; `null` when it names nothing the facet holds. */
function canonicalFacetValue(facetId: FacetId, value: string): string | null {
  switch (facetId) {
    case "category":
    case "brand": {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    }
    case "price": {
      const range = decodePriceRange(value);
      return range === null ? null : priceValueOf(range);
    }
    case "rating": {
      const rating = normaliseRating(parseNumber(value));
      return rating === null ? null : String(rating);
    }
    case "availability":
      return isFacetTrue(value) ? TRUE_LITERAL : null;
  }
}

/** One facet's filter in state terms: the values it applies, and the fields a list of values replaces. */
interface FacetAccessor {
  /** The values the state applies for this facet, canonical and in the order the chips show them. */
  readonly values: (state: FilterState) => readonly string[];
  /** The fields a list of values replaces; an empty list clears the facet. */
  readonly patch: (values: readonly string[]) => Partial<FilterState>;
}

/**
 * The five facets' accessors, stated once per facet. Every matcher, writer and chip reads this table rather
 * than switching over the facet ids itself, so the panel, the chips and the services cannot disagree about
 * what a facet holds; a single-valued facet — the price range and the rating — reports at most one value.
 */
const FACET_ACCESSORS: Readonly<Record<FacetId, FacetAccessor>> = {
  category: {
    values: (state) => canonicalList(state.categoryIds),
    patch: (values) => ({ categoryIds: canonicalList(values) as CategoryIdentifier[] }),
  },
  brand: {
    values: (state) => canonicalList(state.brandIds),
    patch: (values) => ({ brandIds: canonicalList(values) as BrandIdentifier[] }),
  },
  price: {
    values: (state) => {
      const range = normalisePriceRange(state.minPriceMinor, state.maxPriceMinor);
      if (range.minPriceMinor === null && range.maxPriceMinor === null) return [];
      return [priceValueOf(range)];
    },
    patch: (values) => {
      const bands = values.map((value) => decodePriceRange(value)).filter(isPriceRange);
      if (bands.length === 0) return { minPriceMinor: null, maxPriceMinor: null };
      const upper = bands.map((band) => band.maxPriceMinor);
      return normalisePriceRange(
        Math.min(...bands.map((band) => band.minPriceMinor ?? PRICE_FILTER_FLOOR_MINOR)),
        upper.includes(null) ? null : Math.max(...upper.map((bound) => bound ?? 0)),
      );
    },
  },
  rating: {
    values: (state) => (state.minRating === null ? [] : [String(state.minRating)]),
    patch: (values) => {
      const [first] = values;
      return { minRating: first === undefined ? null : normaliseRating(parseNumber(first)) };
    },
  },
  availability: {
    values: (state) => (state.inStockOnly ? [TRUE_LITERAL] : []),
    patch: (values) => ({ inStockOnly: values.some((value) => isFacetTrue(value)) }),
  },
};

// Reading -----------------------------------------------------------------------------------------

/**
 * Reads query state from a URL query string, tolerating anything a hand-made URL can carry: an unknown sort
 * key falls back to the query's default, ids are de-duplicated and sorted, numbers are parsed defensively, a
 * rating off the scale is dropped, an inverted price range is swapped, and the page size is normalised.
 *
 * `pageCount`, when the caller knows it, clamps the page to the pages that exist. An unset field reads as
 * `null` or as its documented default, never as `undefined`.
 *
 * @param params - The query string, with or without a leading `?`, or already-parsed parameters.
 */
export function readFilterState(params: URLSearchParams | string, pageCount?: number): FilterState {
  const search = typeof params === "string" ? new URLSearchParams(params) : params;
  const q = (search.get(FILTER_PARAMS.QUERY) ?? "").trim();
  const range = normalisePriceRange(
    parseNumber(search.get(FILTER_PARAMS.MIN_PRICE)),
    parseNumber(search.get(FILTER_PARAMS.MAX_PRICE)),
  );
  return {
    q,
    categoryIds: canonicalList(
      listValues(search, FILTER_PARAMS.CATEGORY_IDS),
    ) as CategoryIdentifier[],
    brandIds: canonicalList(listValues(search, FILTER_PARAMS.BRAND_IDS)) as BrandIdentifier[],
    minPriceMinor: range.minPriceMinor,
    maxPriceMinor: range.maxPriceMinor,
    minRating: normaliseRating(parseNumber(search.get(FILTER_PARAMS.MIN_RATING))),
    inStockOnly: parseBoolean(search, FILTER_PARAMS.IN_STOCK),
    tags: canonicalList(listValues(search, FILTER_PARAMS.TAGS)),
    sort: normaliseSort(search.get(FILTER_PARAMS.SORT) ?? "", q),
    page: normalisePageNumber(parseNumber(search.get(FILTER_PARAMS.PAGE)), pageCount),
    pageSize: normalisePageSize(parseNumber(search.get(FILTER_PARAMS.PAGE_SIZE)) ?? undefined),
  };
}

// Writing -----------------------------------------------------------------------------------------

/**
 * Writes query state as canonical, default-free parameters: keys sorted, list values de-duplicated and sorted
 * into one comma-separated value, and every field holding its default left out, so an empty string means the
 * default selection. The state is normalised again here, is never mutated, and yields new parameters carrying
 * only what differs from the defaults.
 */
export function writeFilterState(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  const writeList = (key: string, values: readonly string[]): void => {
    const canonical = canonicalList(values);
    if (canonical.length > 0) params.set(key, canonical.join(","));
  };
  if (state.q.trim() !== "") params.set(FILTER_PARAMS.QUERY, state.q.trim());
  writeList(FILTER_PARAMS.CATEGORY_IDS, state.categoryIds);
  writeList(FILTER_PARAMS.BRAND_IDS, state.brandIds);
  writeList(FILTER_PARAMS.TAGS, state.tags);
  const range = normalisePriceRange(state.minPriceMinor, state.maxPriceMinor);
  if (range.minPriceMinor !== null)
    params.set(FILTER_PARAMS.MIN_PRICE, String(range.minPriceMinor));
  if (range.maxPriceMinor !== null)
    params.set(FILTER_PARAMS.MAX_PRICE, String(range.maxPriceMinor));
  const rating = normaliseRating(state.minRating);
  if (rating !== null) params.set(FILTER_PARAMS.MIN_RATING, String(rating));
  if (state.inStockOnly) params.set(FILTER_PARAMS.IN_STOCK, TRUE_LITERAL);
  const sort = normaliseSort(state.sort, state.q);
  if (sort !== defaultSortKeyFor(state.q)) params.set(FILTER_PARAMS.SORT, sort);
  const pageSize = normalisePageSize(state.pageSize);
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set(FILTER_PARAMS.PAGE_SIZE, String(pageSize));
  const page = normalisePageNumber(state.page);
  if (page > 1) params.set(FILTER_PARAMS.PAGE, String(page));
  params.sort();
  return params;
}

/** Writes the search string a link or a navigation carries, `?` included; an empty string means no query. */
export function filtersToSearchString(state: FilterState): string {
  const search = writeFilterState(state).toString();
  return search === "" ? "" : `?${search}`;
}

/**
 * Builds the path and query of a link into a filtered listing, so a link and the navigation that follows a
 * filter write the identical URL; `path` carries no query of its own, as the builders in
 * `src/constants/routes.ts` produce it.
 */
export function filtersToPath(path: string, state: FilterState): string {
  return `${path}${filtersToSearchString(state)}`;
}

// Filter summary ----------------------------------------------------------------------------------

/**
 * The filter half of the state — every facet, the query term and the tags, with the sort and the paging
 * dropped — as `GET /api/products` and `GET /api/facets` take their parameters. Read back from the state's
 * canonical form, so the terms a facet counts are the terms the listing filtered by.
 */
export function toFacetQuery(state: FilterState): FacetQuery {
  const { q, categoryIds, brandIds, minPriceMinor, maxPriceMinor, minRating, inStockOnly, tags } =
    readFilterState(writeFilterState(state));
  return { q, categoryIds, brandIds, minPriceMinor, maxPriceMinor, minRating, inStockOnly, tags };
}

/**
 * Reports whether any filter is applied: a facet value or a tag, but not a query term, a sort or a page.
 * Each branch mirrors the emptiness rule of that facet's own accessor in `FACET_ACCESSORS`, so the boolean
 * and the chip count cannot disagree, and no chip descriptor or label lookup is built to answer it.
 */
export function hasActiveFilters(state: FilterState): boolean {
  if (state.categoryIds.length > 0 || state.brandIds.length > 0) return true;
  if (state.tags.length > 0 || state.inStockOnly) return true;
  if (state.minRating !== null) return true;
  const range = normalisePriceRange(state.minPriceMinor, state.maxPriceMinor);
  return range.minPriceMinor !== null || range.maxPriceMinor !== null;
}

/** How many filters are applied, which is the number of chips `activeFilterEntries` returns. */
export function countActiveFilters(state: FilterState): number {
  return activeFilterEntries(state).length;
}

/**
 * One removable chip: a facet value, which `toggleFacetValue` removes by the same value, or a tag, which
 * `toggleTag` removes. `label` is the vocabulary's wording, or `null` where the caller labels the value.
 */
export type ActiveFilterEntry =
  | {
      readonly kind: "facet";
      readonly facetId: FacetId;
      readonly value: string;
      readonly label: string | null;
    }
  | { readonly kind: "tag"; readonly value: string };

/**
 * The applied filters as one chip each, in the panel's own facet order with tags last, so
 * `src/features/search/ActiveFilters.tsx` and `FilterPanel.tsx` cannot disagree about what is applied.
 */
export function activeFilterEntries(state: FilterState): readonly ActiveFilterEntry[] {
  const entries: ActiveFilterEntry[] = [];
  for (const definition of FACET_VOCABULARY) {
    for (const value of FACET_ACCESSORS[definition.id].values(state)) {
      entries.push({
        kind: "facet",
        facetId: definition.id,
        value,
        label: facetValueLabel(definition.id, value),
      });
    }
  }
  for (const tag of canonicalList(state.tags)) entries.push({ kind: "tag", value: tag });
  return entries;
}

/** Reports whether a facet's value describes what the state applies, as the panel marks a selected control. */
export function facetValueMatches(state: FilterState, facetId: FacetId, value: string): boolean {
  const canonical = canonicalFacetValue(facetId, value);
  if (canonical === null) return false;
  return FACET_ACCESSORS[facetId].values(state).includes(canonical);
}

// Writers -----------------------------------------------------------------------------------------

/** The state with `changes` applied and the listing on its first page, which is where a filter change lands. */
function withFilters(state: FilterState, changes: Partial<FilterState>): FilterState {
  return { ...state, ...changes, page: 1 };
}

/** Moves a listing to a page, clamped to the pages that exist when `pageCount` is known. */
export function withPage(state: FilterState, page: number, pageCount?: number): FilterState {
  return { ...state, page: normalisePageNumber(page, pageCount) };
}

/** Reorders a listing; a sort is not a filter, so the page it is on is kept. */
export function withSort(state: FilterState, sortKey: SortKey): FilterState {
  return { ...state, sort: normaliseSort(sortKey, state.q) };
}

/**
 * Sets the search term, trimmed. A chosen sort is kept — only a relevance sort left with no term is repaired
 * to the default — and the listing returns to its first page.
 */
export function setQuery(state: FilterState, q: string): FilterState {
  const query = q.trim();
  return { ...state, q: query, sort: normaliseSort(state.sort, query), page: 1 };
}

/** Adds a facet value to the filter, or removes it when it is already applied; one that names nothing holds. */
export function toggleFacetValue(state: FilterState, facetId: FacetId, value: string): FilterState {
  const canonical = canonicalFacetValue(facetId, value);
  if (canonical === null) return state;
  const applied = FACET_ACCESSORS[facetId].values(state);
  const next = applied.includes(canonical)
    ? applied.filter((entry) => entry !== canonical)
    : canonicalList([...applied, canonical]);
  return withFilters(state, FACET_ACCESSORS[facetId].patch(next));
}

/**
 * Replaces every value of one facet at once, as a preset or a group's clear action does: an empty list clears
 * the facet, and a range facet applies several bands as the smallest range containing them, leaving the upper
 * bound open when one of the bands is open.
 */
export function setFacetValues(
  state: FilterState,
  facetId: FacetId,
  values: readonly string[],
): FilterState {
  const canonical = values
    .map((value) => canonicalFacetValue(facetId, value))
    .filter((value): value is string => value !== null);
  return withFilters(state, FACET_ACCESSORS[facetId].patch(canonical));
}

/** Sets the price range, dropping a bound at the floor and swapping an inverted pair. */
export function setPriceRange(
  state: FilterState,
  minMinor: PriceBound,
  maxMinor: PriceBound,
): FilterState {
  return withFilters(state, normalisePriceRange(minMinor, maxMinor));
}

/** Sets the minimum rating, or clears the rating filter when the value is absent or off the scale. */
export function setRating(state: FilterState, rating?: RatingFilter): FilterState {
  return withFilters(state, { minRating: normaliseRating(rating ?? null) });
}

/** Turns the availability filter on or off. */
export function setInStockOnly(state: FilterState, value: boolean): FilterState {
  return withFilters(state, { inStockOnly: value });
}

/** Adds a tag to the filter, or removes it when it is already applied; a blank tag changes nothing. */
export function toggleTag(state: FilterState, tag: string): FilterState {
  const trimmed = tag.trim();
  if (trimmed === "") return state;
  return withFilters(state, { tags: toggleList(canonicalList(state.tags), trimmed) });
}

/** Clears one facet — its terms, its range, its star or its toggle — and returns the listing to page one. */
export function clearFacet(state: FilterState, facetId: FacetId): FilterState {
  return withFilters(state, FACET_ACCESSORS[facetId].patch([]));
}

/**
 * Clears every filter — the facets and the tags — while keeping the search term, the sort and the page size,
 * and returning the listing to its first page. Called with no state it returns the canonical empty selection.
 */
export function clearAllFilters(state: FilterState = DEFAULT_FILTER_STATE): FilterState {
  return {
    ...DEFAULT_FILTER_STATE,
    q: state.q.trim(),
    sort: normaliseSort(state.sort, state.q),
    pageSize: normalisePageSize(state.pageSize),
  };
}
