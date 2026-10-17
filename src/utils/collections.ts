/**
 * Path: src/utils/collections.ts
 * Purpose: Grouping, sorting, uniqueness, chunking, indexing and pagination helpers for collections
 * Lines: 585
 */

import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, type PageSize } from "@/constants/config";
import type { PageResult, SortDirection } from "@/types/common";

/**
 * The contract every helper here keeps: each is generic over its item, key or value type, takes
 * `readonly` inputs it never mutates, is pure and allocates its own result, and orders deterministically
 * — ties keep input order and absent values sort last. Nothing here renders, filters or scores; those
 * rules live in `src/lib/catalogService.ts` and `src/utils/statistics.ts`.
 */

// Shared types ----------------------------------------------------------------------------------

/** Reads one value off an item: what every helper here takes its key, value or sort value from. */
export type Selector<TItem, TValue> = (item: TItem) => TValue;

/**
 * Every value a sort key may yield. `null`, `undefined` and `NaN` are absent and sort last in either
 * direction; an ISO 8601 date orders correctly as a string.
 */
export type SortValue = string | number | boolean | null | undefined;

/**
 * Orders two items — negative before, positive after, zero equal — in `Array.prototype.sort`'s shape,
 * so a comparator built by {@link createComparator} passes straight to {@link sortBy}.
 */
export type Comparator<TItem> = (a: TItem, b: TItem) => number;

/**
 * One key of a multi-key sort: `select` reads the value to order by and `direction` overrides the
 * comparator's direction for that key alone.
 */
export interface SortKey<TItem> {
  readonly select: Selector<TItem, SortValue>;
  readonly direction?: SortDirection;
}

/** One value with the number of times it occurs, as {@link frequencyOf} ranks it. */
export interface FrequencyEntry<TValue> {
  readonly value: TValue;
  readonly count: number;
}

/** What {@link topN} accepts beside its count: `direction` picks the end, defaulting to `"desc"`. */
export interface TopNOptions {
  readonly direction?: SortDirection;
}

/**
 * One entry of the page-button window {@link pageWindow} returns, as data rather than markup: a `page`
 * entry carries a button's page number and whether it is current, and a `gap` entry the span of hidden
 * pages, both inclusive.
 */
export type PageWindowEntry =
  | { readonly kind: "page"; readonly page: number; readonly isCurrent: boolean }
  | { readonly kind: "gap"; readonly from: number; readonly to: number };

// Grouping and indexing -------------------------------------------------------------------------

/**
 * Groups `items` by the key `keyOf` reads off each one, as a new `Map` in first-read key order with each
 * group in input order — the reproducible order facet counts and report groups rely on.
 */
export function groupBy<TItem, TKey>(
  items: readonly TItem[],
  keyOf: Selector<TItem, TKey>,
): Map<TKey, TItem[]> {
  const groups = new Map<TKey, TItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

/** Counts how many items carry each key `keyOf` reads, as a new `Map` in first-read key order. */
export function countBy<TItem, TKey>(
  items: readonly TItem[],
  keyOf: Selector<TItem, TKey>,
): Map<TKey, number> {
  const counts = new Map<TKey, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Returns a `Map` from the key `keyOf` reads to the last item carrying it, for constant-time lookup
 * where a later record supersedes an earlier one — the opposite of {@link uniqueBy}.
 */
export function indexBy<TItem, TKey>(
  items: readonly TItem[],
  keyOf: Selector<TItem, TKey>,
): Map<TKey, TItem> {
  const index = new Map<TKey, TItem>();
  for (const item of items) index.set(keyOf(item), item);
  return index;
}

/**
 * {@link indexBy} as a plain record, for a lookup written `byId[key]` in a render path: the last item
 * carrying a key wins, and a key such as `__proto__` becomes an own property, not a new prototype.
 */
export function keyBy<TItem, TKey extends string>(
  items: readonly TItem[],
  keyOf: Selector<TItem, TKey>,
): Record<TKey, TItem> {
  return Object.fromEntries(indexBy(items, keyOf)) as Record<TKey, TItem>;
}

/** Returns `items` without the repeats of a key `keyOf` reads, keeping the first occurrence of each. */
export function uniqueBy<TItem, TKey>(
  items: readonly TItem[],
  keyOf: Selector<TItem, TKey>,
): TItem[] {
  const seen = new Set<TKey>();
  const unique: TItem[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/** Splits `items` into the ones `predicate` accepts and the ones it rejects, both in input order. */
export function partition<TItem>(
  items: readonly TItem[],
  predicate: (item: TItem) => boolean,
): readonly [TItem[], TItem[]] {
  const matching: TItem[] = [];
  const rest: TItem[] = [];
  for (const item of items) {
    if (predicate(item)) matching.push(item);
    else rest.push(item);
  }
  return [matching, rest];
}

/**
 * Splits `items` into consecutive chunks of at most `size`, the last one short. A size that is not a
 * positive integer is a programming error rather than data, so it is rejected rather than guessed at.
 *
 * @throws RangeError when `size` is not a positive integer.
 */
export function chunk<TItem>(items: readonly TItem[], size: number): TItem[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError("chunk requires a chunk size of a positive integer.");
  }
  const chunks: TItem[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

// Ordering --------------------------------------------------------------------------------------

/** Reports whether a sort value is absent: `null`, `undefined` or `NaN`. */
function isAbsent(value: SortValue): boolean {
  return (
    value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))
  );
}

/**
 * Compares `a` and `b` in ascending order with absent values last. Strings compare by UTF-16 code unit
 * rather than by locale, so the same data orders identically everywhere; values of different kinds
 * compare by kind — booleans, then numbers, then strings — so the ordering is always a usable one.
 */
export function compareValues(a: SortValue, b: SortValue): number {
  const aAbsent = isAbsent(a);
  const bAbsent = isAbsent(b);
  if (aAbsent && bAbsent) return 0;
  if (aAbsent) return 1;
  if (bAbsent) return -1;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "boolean") return -1;
  if (typeof b === "boolean") return 1;
  return typeof a === "number" ? -1 : 1;
}

/**
 * Applies `direction` to two sort values while keeping absent values last in both directions: a missing
 * value is not a small one, so reversing a sort cannot pull it to the front.
 */
function compareOrdered(a: SortValue, b: SortValue, direction: SortDirection): number {
  const ascending = compareValues(a, b);
  if (ascending === 0 || isAbsent(a) || isAbsent(b)) return ascending;
  return direction === "desc" ? -ascending : ascending;
}

/**
 * Builds the multi-key comparator every listing, table and report sort composes rather than writing its
 * own. Keys apply in the order given, the first difference decides and equal keys fall through to the
 * next; an empty key list compares every pair as equal, which {@link sortBy} leaves in input order. Each
 * key may override the shared direction, and absent values sort last whichever direction applies.
 *
 * @param keys - The sort keys, most significant first.
 * @param direction - The direction for keys that name none; defaults to ascending.
 * @returns A comparator usable with {@link sortBy} and with `Array.prototype.sort`.
 */
export function createComparator<TItem>(
  keys: readonly SortKey<TItem>[],
  direction: SortDirection = "asc",
): Comparator<TItem> {
  return (a, b) => {
    for (const key of keys) {
      const comparison = compareOrdered(key.select(a), key.select(b), key.direction ?? direction);
      if (comparison !== 0) return comparison;
    }
    return 0;
  };
}

/**
 * Sorts a copy of `items` by `comparator`, leaving the input untouched. The sort is stable and
 * explicitly so — the copy is decorated with its input position, which breaks every remaining tie — so a
 * page of results and a report table reproduce exactly between two runs over seeded data.
 */
export function sortBy<TItem>(items: readonly TItem[], comparator: Comparator<TItem>): TItem[] {
  const decorated = items.map((item, index) => ({ item, index }));
  decorated.sort((left, right) => {
    const comparison = comparator(left.item, right.item);
    return comparison === 0 ? left.index - right.index : comparison;
  });
  return decorated.map((entry) => entry.item);
}

/**
 * Sorts a copy of `items` by one value `select` reads off each item — the single-key form most call
 * sites use, built on {@link createComparator} — ascending unless `direction` says otherwise.
 */
export function sortByKey<TItem>(
  items: readonly TItem[],
  select: Selector<TItem, SortValue>,
  direction: SortDirection = "asc",
): TItem[] {
  return sortBy(items, createComparator<TItem>([{ select, direction }]));
}

/** Returns `items` reversed into a new array, its last item first. */
export function reverseCopy<TItem>(items: readonly TItem[]): TItem[] {
  return [...items].reverse();
}

/**
 * Finds the item with the smallest or largest value `select` reads, in one pass and without sorting. An
 * item whose value is absent never wins, and equal values keep the earlier item, so the winner follows
 * the collection rather than the scan.
 *
 * @param items - The collection to scan; never mutated.
 * @param select - Reads the comparable value off one item.
 * @param mode - `"min"` for the smallest value, `"max"` for the largest.
 * @returns The winner, or `undefined` when the collection is empty or every value is absent.
 */
function extremumBy<TItem>(
  items: readonly TItem[],
  select: Selector<TItem, SortValue>,
  mode: "min" | "max",
): TItem | undefined {
  let winnerIndex = -1;
  let winnerValue: SortValue = undefined;
  for (let index = 0; index < items.length; index += 1) {
    const value = select(items[index]);
    if (isAbsent(value)) continue;
    if (winnerIndex < 0) {
      winnerIndex = index;
      winnerValue = value;
      continue;
    }
    const comparison = compareValues(value, winnerValue);
    if (mode === "min" ? comparison < 0 : comparison > 0) {
      winnerIndex = index;
      winnerValue = value;
    }
  }
  return winnerIndex < 0 ? undefined : items[winnerIndex];
}

/** Returns the item whose value `select` reads is smallest, keeping the first when several are equal. */
export function minBy<TItem>(
  items: readonly TItem[],
  select: Selector<TItem, SortValue>,
): TItem | undefined {
  return extremumBy(items, select, "min");
}

/** Returns the item whose value `select` reads is largest, keeping the first when several are equal. */
export function maxBy<TItem>(
  items: readonly TItem[],
  select: Selector<TItem, SortValue>,
): TItem | undefined {
  return extremumBy(items, select, "max");
}

// Aggregation -----------------------------------------------------------------------------------

/**
 * Totals `values` exactly as given, with no rounding: integer minor units sum to an exact integer, and a
 * fractional input is the caller's to round through `src/utils/format.ts`. Returns `0` for an empty one.
 */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Totals the number `valueOf` reads off each item — a cart's line subtotals, a report's row revenue —
 * keeping a sum of minor units exact.
 */
export function sumBy<TItem>(items: readonly TItem[], valueOf: Selector<TItem, number>): number {
  let total = 0;
  for (const item of items) total += valueOf(item);
  return total;
}

/**
 * Returns the mean of `values`, and `0` rather than `NaN` for an empty one, so a metric card always
 * renders a number. Weighted and domain-shaped averages — average order value, moving averages,
 * percentiles — are composed from this in `src/utils/statistics.ts`, which owns them.
 */
export function averageOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/** Reads a bound as given, or as the supplied infinity when it is not a finite number. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Confines `value` to the pair of bounds, reading them in order so an inverted pair still yields a value
 * between them. A non-finite bound adds no constraint — which is how a caller says "no upper limit" —
 * and a non-finite value settles on the lower bound.
 */
export function clampNumber(value: number, min: number, max: number): number {
  const low = finiteOr(min, Number.NEGATIVE_INFINITY);
  const high = finiteOr(max, Number.POSITIVE_INFINITY);
  const lower = Math.min(low, high);
  const upper = Math.max(low, high);
  if (!Number.isFinite(value)) return lower;
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}

/**
 * Builds the arithmetic sequence running from `start` towards `end` and excluding `end`, so the default
 * step makes `range(1, 4)` equal `[1, 2, 3]`; a negative step descends. A step whose direction
 * contradicts the bounds returns an empty array rather than counting forever.
 *
 * @throws RangeError when `step` is zero or fractional, or either bound is not finite.
 */
export function range(start: number, end: number, step: number = 1): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError("range requires finite bounds.");
  }
  if (!Number.isInteger(step) || step === 0) {
    throw new RangeError("range requires a non-zero integer step.");
  }
  const values: number[] = [];
  if (step > 0) {
    for (let value = start; value < end; value += step) values.push(value);
  } else {
    for (let value = start; value > end; value += step) values.push(value);
  }
  return values;
}

/**
 * Ranks the distinct values `keyOf` reads by how often they occur — most frequent first — as new entries
 * of value and count. Equally common values keep first-appearance order, because the counts are read in
 * that order and the sort is stable, so a tie follows the data rather than the engine.
 */
export function frequencyOf<TItem, TValue>(
  items: readonly TItem[],
  keyOf: Selector<TItem, TValue>,
): readonly FrequencyEntry<TValue>[] {
  const ranked: FrequencyEntry<TValue>[] = [];
  for (const [value, count] of countBy(items, keyOf)) ranked.push({ value, count });
  ranked.sort((left, right) => right.count - left.count);
  return ranked;
}

/**
 * Returns the best-performing items by the numeric value `select` reads: the dashboard's top products and
 * the product-performance report are read from it, so no surface orders anything itself. Ties keep input
 * order, an item whose value is absent is taken last, a count below one takes nothing and a fractional
 * count is floored. The direction travels in an options object rather than as a fourth positional argument.
 *
 * It reads the collection once, keeping a window of at most `count` items best first beside the values
 * `select` read for them, so `select` runs once per item rather than once per comparison: a candidate's
 * place in the window is found by bisection over those cached values, and one ranked at or past the last
 * place is passed over rather than taken and dropped. The cost is one pass with O(log count) comparisons
 * per item, so a caller taking a few rows of a long collection never pays for ordering the whole of it.
 *
 * @param items - The collection to rank; never mutated.
 * @param select - Reads the numeric value to rank by off one item.
 * @param count - How many items to take.
 * @param options - Which end of the ranking to take; defaults to the largest values.
 * @returns A new array of at most `count` items, best first.
 */
export function topN<TItem>(
  items: readonly TItem[],
  select: Selector<TItem, number>,
  count: number,
  options: TopNOptions = {},
): TItem[] {
  if (!Number.isFinite(count) || count < 1) return [];
  const capacity = Math.floor(count);
  const direction = options.direction ?? "desc";
  const best: TItem[] = [];
  const values: SortValue[] = [];
  for (const item of items) {
    const value = select(item);
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compareOrdered(value, values[middle], direction) < 0) high = middle;
      else low = middle + 1;
    }
    if (low >= capacity) continue;
    if (best.length === capacity) {
      best.pop();
      values.pop();
    }
    best.splice(low, 0, item);
    values.splice(low, 0, value);
  }
  return best;
}

// Paging ----------------------------------------------------------------------------------------

/** The number of page buttons {@link pageWindow} lays out when a caller names no width. */
const PAGE_WINDOW_MAX_BUTTONS = 5;

/** Reports whether `value` is one of the page sizes the product offers. */
function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

/**
 * Reads a requested page size as one of the configured sizes. The request's source is the URL, so the
 * value is untrusted: an absent, unknown, fractional or non-finite size becomes `DEFAULT_PAGE_SIZE`
 * rather than travelling on to a service, and the catalogue, the shared table, the order history and the
 * report tables all normalise through here, so no surface pages at a size the others do not offer.
 *
 * @param requested - The size as the query string carried it.
 * @returns The requested size when it is configured, otherwise the default.
 */
export function normalisePageSize(requested?: number): PageSize {
  if (requested === undefined || !Number.isInteger(requested) || !isPageSize(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  return requested;
}

/**
 * Returns the number of pages a collection of `total` items fills at `pageSize`, never below `1`: an empty
 * collection is one empty page rather than no page at all, which keeps a page number in range for
 * {@link clampPage} and {@link pageWindow} and lets every surface render "Page 1 of 1" without a special
 * case. `total` — not the page count — is what reports that there is nothing to show.
 */
export function pageCountFor(total: number, pageSize: PageSize): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Confines a requested `page` to the pages that exist, so a query parameter or a back button naming a page
 * outside the range lands on a page holding results rather than on an empty view: a page before the first
 * becomes `1`, one past the last becomes the last, a fractional page truncates, and a non-finite one is `1`.
 */
export function clampPage(page: number, pageCount: number): number {
  const lastPage = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  if (!Number.isFinite(page)) return 1;
  const requested = Math.trunc(page);
  if (requested < 1) return 1;
  return requested > lastPage ? lastPage : requested;
}

/**
 * Derives the two flags every paging surface publishes, from the page being shown and the pages
 * that exist as {@link clampPage} and {@link pageCountFor} produce them: a next page exists while
 * the current one is before the last, and a previous page exists once it is past the first. This
 * is the rule's only implementation, so the payload {@link paginate} builds and the pagination
 * control hook in `src/state/hooks.ts` cannot answer "is there another page" differently.
 *
 * @param currentPage - The page being shown, clamped to the pages that exist.
 * @param pageCount - The pages that exist, as {@link pageCountFor} reports them; never below `1`.
 * @returns Whether a next page and a previous page exist.
 */
export function pageFlagsFor(
  currentPage: number,
  pageCount: number,
): Pick<PageResult<never>, "hasNext" | "hasPrevious"> {
  return { hasNext: currentPage < pageCount, hasPrevious: currentPage > 1 };
}

/**
 * Slices one page out of `items` and reports the paging that produced it: the single implementation behind
 * the catalogue, the search results, the order history and every report table, and the only place a
 * `PageResult` is built. Page and size are normalised before the slice, and the next and previous flags
 * come from {@link pageFlagsFor}, that rule's single home. The returned `items` is a new array.
 *
 * @param items - The whole collection to page over; never mutated.
 * @param page - The requested 1-based page.
 * @param pageSize - The requested page size; defaults to `DEFAULT_PAGE_SIZE`.
 * @returns The page's items with the total, the normalised page and size, the page count, and the flags for
 * a next and a previous page.
 */
export function paginate<TItem>(
  items: readonly TItem[],
  page: number,
  pageSize?: number,
): PageResult<TItem> {
  const size = normalisePageSize(pageSize);
  const total = items.length;
  const pageCount = pageCountFor(total, size);
  const currentPage = clampPage(page, pageCount);
  const start = (currentPage - 1) * size;
  return {
    items: items.slice(start, start + size),
    total,
    page: currentPage,
    pageSize: size,
    pageCount,
    ...pageFlagsFor(currentPage, pageCount),
  };
}

/**
 * Lays out the page buttons a pagination control renders, as data rather than markup: the first and last
 * page always appear, the current page sits inside a window of at most `maxButtons` page buttons, and a run
 * of pages the window leaves out becomes one `gap` entry, so the control renders an ellipsis with a label
 * such as "pages 2 to 7" without computing any of it. At either end of the collection the window holds
 * fewer entries, and `from` and `to` are inclusive, so a gap of a single page can be rendered as that page.
 *
 * @param currentPage - The page being shown; clamped to the pages that exist.
 * @param pageCount - The pages that exist, as {@link pageCountFor} reports them.
 * @param maxButtons - The widest number of page buttons the window may hold; defaults to 5.
 * @returns New window entries in render order.
 */
export function pageWindow(
  currentPage: number,
  pageCount: number,
  maxButtons: number = PAGE_WINDOW_MAX_BUTTONS,
): readonly PageWindowEntry[] {
  const lastPage = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  const width = Number.isFinite(maxButtons) && maxButtons >= 1 ? Math.floor(maxButtons) : 1;
  const current = clampPage(currentPage, lastPage);
  const windowSize = Math.min(width, lastPage);
  const half = Math.floor((windowSize - 1) / 2);
  const first = clampNumber(current - half, 1, lastPage - windowSize + 1);
  const last = first + windowSize - 1;
  const entries: PageWindowEntry[] = [];
  if (first > 1) {
    entries.push({ kind: "page", page: 1, isCurrent: current === 1 });
    if (first > 2) entries.push({ kind: "gap", from: 2, to: first - 1 });
  }
  for (let page = first; page <= last; page += 1) {
    entries.push({ kind: "page", page, isCurrent: page === current });
  }
  if (last < lastPage) {
    if (last < lastPage - 1) entries.push({ kind: "gap", from: last + 1, to: lastPage - 1 });
    entries.push({ kind: "page", page: lastPage, isCurrent: current === lastPage });
  }
  return entries;
}
