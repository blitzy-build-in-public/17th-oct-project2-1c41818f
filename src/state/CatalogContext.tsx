/**
 * Path: src/state/CatalogContext.tsx
 * Purpose: Loaded catalogue page, facets and status, plus the URL-derived filter state and its setter
 * Lines: 497
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { toRejectionError } from "@/lib/apiClient";
import { buildFacets, listProducts } from "@/lib/catalogService";
import {
  catalogActions,
  catalogFingerprint,
  catalogReducer,
  createInitialCatalogState,
} from "@/state/catalogReducer";
import type { Facet, FacetId, FacetQuery, FilterState, Product, SortKey } from "@/types/catalog";
import type { ApiError, AsyncStatus, MinorUnits, PageResult } from "@/types/common";
import { isAbortError } from "@/utils/async";
import {
  FILTER_PARAMS,
  clearAllFilters,
  clearFacet,
  readFilterState,
  setFacetValues,
  setInStockOnly,
  setPriceRange,
  setQuery,
  setRating,
  toFacetQuery,
  toggleFacetValue,
  toggleTag,
  withPage,
  withSort,
  writeFilterState,
} from "@/utils/queryParams";
import { isRatingValue } from "@/utils/validation";

// Consumer surface -----------------------------------------------------------------------------

/**
 * What a consumer reads from the catalogue: the answer to the query in the address bar.
 *
 * Query state has one home and this is not it. The term, the facets, the sort and the paging live in
 * the URL and are read through `useCatalogFilters()`; nothing here mirrors one into React state, which
 * is what makes a filtered, sorted and searched URL reload to the identical result set. What this view
 * carries is only what a request produced — one page, the facets beside it, the status and the failure
 * — held by `src/state/catalogReducer.ts`, which discards a result that is not the state's own.
 */
export interface CatalogView {
  /** Where the last load stands: `idle` before the first request, then `loading`, `success`, `error`. */
  readonly status: AsyncStatus;
  /** Whether the surface has no answer yet and one is coming — a request in flight, or the first paint
   * before the load effect issues one. A page renders its skeleton on this. */
  readonly isLoading: boolean;
  /** Whether the query succeeded and matched nothing, which is what renders the empty state. */
  readonly isEmpty: boolean;
  /** The page the last successful load returned, or `null` before the first one settles. */
  readonly page: PageResult<Product> | null;
  /** The facets that came back beside that page, counted for the same request by the catalogue service. */
  readonly facets: Facet[];
  /** The failure of the last attempt, kept while the surface still offers its retry. */
  readonly error: ApiError | null;
  /** The filter half of the request this view holds the answer to, as `GET /api/products` and
   * `GET /api/facets` take it. The `status`, the `error` and the `facets` held are that request's; the
   * `page` may still be the previous answer's until a new one lands, which is what the status reports.
   * It is `null` while the view describes no request for the query the URL names — the first paint, and
   * the commit in which the URL has moved on before the load for it is issued — so a consumer can tell
   * a result that answers the URL from one about to be superseded. */
  readonly query: FacetQuery | null;
  /** Issues the request the view last described again, aborting whatever is still in flight. */
  reload(): void;
}

/**
 * What a consumer reads and writes about the query in the address bar: the state itself, the filter
 * half of it, and one setter per change the catalogue accepts.
 *
 * Every setter navigates — the writer `src/utils/queryParams.ts` owns composes the next state from the
 * query the provider last wrote, `setSearchParams` writes it, and the provider loads whatever the URL
 * then names — so the address bar is never a copy of anything and no setter holds a filter value the
 * address bar lacks.
 */
export interface CatalogFilters {
  /** The whole query, normalised as it was read: defaults filled in, lists canonical, size configured. */
  readonly filters: FilterState;
  /** The filter half of `filters`, which is what the product and facet endpoints take. */
  readonly facetQuery: FacetQuery;
  /** Applies a search term, returning the listing to its first page and pushing a history entry, so
   * Back returns to the previous search rather than to a half-typed one. */
  setQuery(q: string): void;
  /** Reorders the listing and returns it to its first page, the order it was paged under being gone;
   * the history entry is replaced, a sort being a refinement of the listing already read. */
  setSort(sort: SortKey): void;
  /** Moves to a page of the listing, clamped by the service to the pages that exist. */
  setPage(page: number): void;
  /** Changes how many results a page holds, returning the listing to its first page. */
  setPageSize(pageSize: number): void;
  /** Adds a facet value to the filter, or removes it when it is already applied. */
  toggleFacet(facetId: FacetId, value: string): void;
  /** Replaces the whole of one facet's selection with a single value, or clears the facet with `null`: the
   * setter a single-choice facet writes through, where the price bands and the rating floors hold one value at
   * a time. The term facets, which are combined several at a time, keep {@link CatalogFilters.toggleFacet}. */
  setFacetValue(facetId: FacetId, value: string | null): void;
  /** Sets the price range in minor units; `null` leaves that side open and an inverted pair is swapped
   * rather than rejected. */
  setPriceRange(minPriceMinor: MinorUnits | null, maxPriceMinor: MinorUnits | null): void;
  /** Sets the minimum star rating, or clears the rating filter with `null` or an off-scale value. */
  setRating(minRating: number | null): void;
  /** Applies or clears the availability filter. */
  setInStockOnly(inStockOnly: boolean): void;
  /** Clears every value of one facet — its terms, its range, its star or its toggle. */
  clearFacet(facetId: FacetId): void;
  /** Adds a tag to the filter, or removes it when it is already applied — the writer the chip for an
   * applied tag removes it through, so every filter a chip can show has a control that removes it. */
  toggleTag(tag: string): void;
  /** Clears every facet and tag, keeping the term, the sort and the page size. */
  clearAll(): void;
  /** Whether the address bar holds nothing beyond the defaults, asked of the query writer, which omits
   * every default, rather than of a list of fields restated here. */
  readonly isDefault: boolean;
}

// Helpers --------------------------------------------------------------------------------------

/**
 * The query the writer composed last, and the setter it composed through.
 *
 * `react-router-dom` builds its setter inside the render that reads the address bar, so a setter's identity is
 * that render's: two writes raised inside one render share it, and any render of a different address carries
 * another. Read together, the pair says whether a query this module wrote is still the newest one it knows.
 */
interface PendingWrite {
  /** The setter the address was written through, as `useSearchParams` held it while that address was in place. */
  readonly setter: ReturnType<typeof useSearchParams>[1];
  /** The query that write composed, as the address bar carries it. */
  readonly search: string;
}

/** The query keys the catalogue owns, read from the writer's own vocabulary so no key is restated here. */
const CATALOGUE_QUERY_KEYS: ReadonlySet<string> = new Set(Object.values(FILTER_PARAMS));

/**
 * The canonical form of the query in the address bar: what the writer writes for what the reader reads back,
 * with every parameter the catalogue does not own carried over exactly as it stands.
 *
 * The address bar is shared with the surfaces that put something else in it — the sign-in link carries the path
 * the visitor was sent away from in `returnTo` — and the writer's canonical form holds the catalogue's keys
 * alone, so a replacement composed from that alone would drop the rest of the address.
 *
 * @param searchParams - The parameters the address bar holds, as the router read them.
 * @param pageCount - How many pages the query's loaded answer holds, when one is known: it clamps a page named
 *   past the last one to the page the catalogue would serve.
 * @returns The parameters the canonical address carries.
 */
function canonicalSearchParams(searchParams: URLSearchParams, pageCount?: number): URLSearchParams {
  const canonical = writeFilterState(readFilterState(searchParams, pageCount));
  for (const [key, value] of searchParams) {
    if (!CATALOGUE_QUERY_KEYS.has(key)) canonical.append(key, value);
  }
  return canonical;
}

// Contexts -------------------------------------------------------------------------------------

/**
 * The catalogue's loaded state, private to this module: consumers reach it through `useCatalog()`.
 *
 * The `null` default is the "no provider above this consumer" sentinel the hook turns into an error
 * naming what is missing, rather than a silently empty catalogue that would hide a wiring mistake.
 */
const CatalogViewContext = createContext<CatalogView | null>(null);

/**
 * The query in the address bar and the setters that write it, private to this module: consumers reach
 * it through `useCatalogFilters()`.
 *
 * State and query travel in two contexts on purpose. React compares a context value with `Object.is`,
 * so one context carrying both would re-render every reader of the loaded page whenever a refinement
 * moved the URL; split, a filter change hands a new value to this context alone, and a component that
 * reads only `useCatalog()` is re-rendered only when the load it reads has changed.
 */
const CatalogFiltersContext = createContext<CatalogFilters | null>(null);

// Provider -------------------------------------------------------------------------------------

/**
 * Holds the catalogue and provides it, with the query in the address bar, to everything below.
 *
 * The provider owns the wiring and no rule of its own: `src/utils/queryParams.ts` reads and writes the
 * query, `src/lib/catalogService.ts` filters, facets, sorts and pages, and
 * `src/state/catalogReducer.ts` decides which result is still current. What is left here is one
 * request pair per query, one abort controller per pair, and two memoised values. It must be rendered
 * inside a router, because the search params are the query store: `src/main.tsx` renders
 * `BrowserRouter` and `tests/testUtils.tsx` renders `MemoryRouter`, so no router is created here.
 *
 * @param props.children - The subtree that may read the catalogue and write its query.
 * @returns The two providers, state outermost, wrapping the subtree.
 */
export function CatalogProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(catalogReducer, undefined, createInitialCatalogState);
  const [searchParams, setSearchParams] = useSearchParams();
  // Every reload of one query gets a token of its own, so the effect below re-runs without the query
  // having to change — which is what the error state's retry action needs.
  const [reloadToken, setReloadToken] = useState(0);
  // The query this writer composed last, so a write raised while an earlier one is still on its way composes
  // from it rather than from the params of the render it was raised in — which is how a burst of writes raised
  // inside one render applies in the order it was raised instead of the last of them overwriting the rest.
  const pendingWriteRef = useRef<PendingWrite | null>(null);

  // The query read once per address change: `readFilterState` fills in the defaults, canonicalises the
  // lists, clamps the page size and swaps an inverted price range, `toFacetQuery` projects the filter
  // half, and `catalogFingerprint` is the key the reducer recognises a result by. All three are
  // memoised on the params, whose identity `react-router-dom` keeps while the search string is
  // unchanged — which is why a write landing on the URL already in place re-renders nothing.
  const filterState = useMemo(() => readFilterState(searchParams), [searchParams]);
  const facetQuery = useMemo(() => toFacetQuery(filterState), [filterState]);
  const fingerprint = useMemo(() => catalogFingerprint(filterState), [filterState]);

  // The only place this module touches the URL. `compose` is applied to the newest query this writer knows: the
  // one it composed for a write raised from this same render, which the setter's own identity identifies — and
  // which the address bar does not carry yet, because the navigation that write asked for is still on its way —
  // and otherwise the params of the render this navigation is composed in, which is the address bar in place.
  // Composing from the render's params instead of from that pending query is what loses a write: two setters
  // raised inside one render would both read the state the address held before either of them, so the second
  // would overwrite the first. The writer canonicalises the result — keys sorted, every default left out — so
  // equivalent selections share one URL instead of multiplying it. A refinement replaces the history entry so a
  // long session does not fill it, while a move that changes what the listing is pushes one, so Back returns to
  // the search or the page the shopper came from.
  const commit = useCallback(
    (
      compose: (current: FilterState) => FilterState,
      options?: { readonly replace?: boolean },
    ): void => {
      const pending = pendingWriteRef.current;
      const current =
        pending !== null && pending.setter === setSearchParams ? pending.search : searchParams;
      const next = writeFilterState(compose(readFilterState(current)));
      pendingWriteRef.current = { setter: setSearchParams, search: next.toString() };
      setSearchParams(next, { replace: options?.replace ?? true });
    },
    [searchParams, setSearchParams],
  );

  const setQueryTerm = useCallback(
    (q: string): void => commit((current) => setQuery(current, q), { replace: false }),
    [commit],
  );
  // `withSort` keeps the page it is given, and a reordered listing cannot: the third page of a list
  // sorted by price is not the third page the shopper was reading, so the page gives way with it.
  const setSortKey = useCallback(
    (sort: SortKey): void => commit((current) => withPage(withSort(current, sort), 1)),
    [commit],
  );
  const setPageNumber = useCallback(
    (page: number): void => commit((current) => withPage(current, page), { replace: false }),
    [commit],
  );
  // `src/utils/queryParams.ts` exports no page-size writer, so the state is composed here and that
  // module's writer and reader normalise the size to a configured one either way.
  const setPageSizeValue = useCallback(
    (pageSize: number): void => commit((current) => withPage({ ...current, pageSize }, 1)),
    [commit],
  );
  const toggleFacetValueFor = useCallback(
    (facetId: FacetId, value: string): void =>
      commit((current) => toggleFacetValue(current, facetId, value)),
    [commit],
  );
  const setPriceRangeValue = useCallback(
    (minPriceMinor: MinorUnits | null, maxPriceMinor: MinorUnits | null): void =>
      commit((current) => setPriceRange(current, minPriceMinor, maxPriceMinor)),
    [commit],
  );
  // A single-choice facet replaces its whole selection in one write, because the state holds one band and one
  // star floor at a time: the writer's accessor for the facet turns the list back into that single value, so a
  // second choice replaces the first rather than merging with it.
  const setFacetValueFor = useCallback(
    (facetId: FacetId, value: string | null): void =>
      commit((current) => setFacetValues(current, facetId, value === null ? [] : [value])),
    [commit],
  );
  const setRatingValue = useCallback(
    (minRating: number | null): void =>
      commit((current) => setRating(current, isRatingValue(minRating) ? minRating : null)),
    [commit],
  );
  const setInStockOnlyValue = useCallback(
    (inStockOnly: boolean): void => commit((current) => setInStockOnly(current, inStockOnly)),
    [commit],
  );
  const clearFacetValue = useCallback(
    (facetId: FacetId): void => commit((current) => clearFacet(current, facetId)),
    [commit],
  );
  const toggleTagValue = useCallback(
    (tag: string): void => commit((current) => toggleTag(current, tag)),
    [commit],
  );
  const clearAllValues = useCallback(
    (): void => commit((current) => clearAllFilters(current)),
    [commit],
  );
  const reload = useCallback((): void => setReloadToken((token) => token + 1), []);

  // How many pages the loaded answer holds, known only while the state answers the query the address bar names:
  // it is what clamps a page named past the last one to the page the catalogue would serve. A query whose answer
  // is not in hand yet has no page count, so a page it names stands as it is until that answer arrives — the
  // state keeps the previous answer's page and facets across a load, and those describe another query.
  const pageCount =
    state.status === "success" && state.fingerprint === fingerprint && state.page !== null
      ? state.page.pageCount
      : undefined;

  // The address bar, put into the form the reader already renders and the writer already writes.
  //
  // Reading query state is tolerant and writing it is canonical, so a hand-made, edited or bookmarked address —
  // an unknown sort key, a value written twice, an unconfigured page size, a page past the last, an inverted
  // price range — renders the canonical result while keeping its own text in the address bar, and two addresses
  // that render the same listing both stay bookmarkable. This replaces such an address with the canonical one,
  // so equivalent selections share one URL. Rendering is unchanged: the reader has already normalised every
  // value it renders, and the replacement keeps the parameters that name something other than a default, so a
  // filtered, sorted and searched URL still reloads to the identical result set. It settles in one pass — the
  // canonical form reads back to itself, so the parameters read from a replaced address are the ones it was
  // compared against — and an address already canonical is left where it is, which keeps an untouched address
  // out of the history. A replacement moves the query the load below is keyed on, so that load runs once more
  // for the canonical query; the one it supersedes is aborted, and no further replacement follows.
  useEffect(() => {
    const canonical = canonicalSearchParams(searchParams, pageCount);
    if (canonical.toString() === searchParams.toString()) return;
    setSearchParams(canonical, { replace: true });
  }, [pageCount, searchParams, setSearchParams]);

  // The load, once per query and once per reload of it. One `AbortController` per pass, aborted when
  // the query changes and when the provider unmounts, which bounds this view to the single request
  // pair in flight that `MAX_IN_FLIGHT_REQUESTS_PER_VIEW` in `src/constants/config.ts` states. The page
  // and the facets are asked for together, because they describe one request, and both calls resolve
  // their failures as values — the service never rejects — so their outcome is read rather than caught.
  useEffect(() => {
    const controller = new AbortController();
    dispatch(catalogActions.loadStarted(filterState, fingerprint));

    void Promise.all([
      listProducts(filterState, { signal: controller.signal }),
      buildFacets(filterState, { signal: controller.signal }),
    ]).then(
      ([pageResult, facetResult]) => {
        // A cancelled request resolves to a superseded failure rather than rejecting, so a controller
        // that was aborted has no result to apply and reports nothing: the request that cancelled it
        // owns the state from here on.
        if (controller.signal.aborted) return;
        if (!pageResult.ok) {
          dispatch(catalogActions.loadFailed(fingerprint, pageResult.error));
          return;
        }
        if (!facetResult.ok) {
          dispatch(catalogActions.loadFailed(fingerprint, facetResult.error));
          return;
        }
        // One result carries the page and the facets of one request, so the two cannot drift apart.
        dispatch(catalogActions.loadSucceeded(fingerprint, pageResult.value, facetResult.value));
      },
      (cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) return;
        // Unreachable through the shipped transport, which resolves every failure as a value: kept so a
        // rejection could not leave the surface loading forever.
        dispatch(catalogActions.loadFailed(fingerprint, toRejectionError(cause)));
      },
    );

    return () => {
      controller.abort();
    };
  }, [dispatch, filterState, fingerprint, reloadToken]);

  // Derived during render rather than stored, so the reducer keeps only what a request produced: a
  // first paint that issued nothing yet is loading as far as a reader is concerned, and an empty state
  // is a success that matched nothing rather than a page that has not arrived.
  const isLoading = state.status === "loading" || (state.status === "idle" && state.page === null);
  const isEmpty =
    state.status === "success" && state.page !== null && state.page.items.length === 0;

  // The view describes a request only while the state's key is the key of the query in the address bar:
  // before the first load, and in the commit where the URL has moved on, it describes none.
  const query = state.fingerprint === fingerprint ? facetQuery : null;
  const isDefault = useMemo(() => writeFilterState(filterState).toString() === "", [filterState]);

  const view = useMemo<CatalogView>(
    () => ({
      status: state.status,
      isLoading,
      isEmpty,
      page: state.page,
      facets: state.facets,
      error: state.error,
      query,
      reload,
    }),
    [state.status, state.page, state.facets, state.error, isLoading, isEmpty, query, reload],
  );

  const filters = useMemo<CatalogFilters>(
    () => ({
      filters: filterState,
      facetQuery,
      setQuery: setQueryTerm,
      setSort: setSortKey,
      setPage: setPageNumber,
      setPageSize: setPageSizeValue,
      toggleFacet: toggleFacetValueFor,
      setFacetValue: setFacetValueFor,
      setPriceRange: setPriceRangeValue,
      setRating: setRatingValue,
      setInStockOnly: setInStockOnlyValue,
      clearFacet: clearFacetValue,
      toggleTag: toggleTagValue,
      clearAll: clearAllValues,
      isDefault,
    }),
    [
      filterState,
      facetQuery,
      isDefault,
      setQueryTerm,
      setSortKey,
      setPageNumber,
      setPageSizeValue,
      toggleFacetValueFor,
      setFacetValueFor,
      setPriceRangeValue,
      setRatingValue,
      setInStockOnlyValue,
      clearFacetValue,
      toggleTagValue,
      clearAllValues,
    ],
  );

  return (
    <CatalogViewContext value={view}>
      <CatalogFiltersContext value={filters}>{children}</CatalogFiltersContext>
    </CatalogViewContext>
  );
}

// Consumer hooks -------------------------------------------------------------------------------

/**
 * Reads the catalogue: the page and facets of the query in the address bar, where the load stands, the
 * failure if there was one, the query the state belongs to, and the retry the error state calls.
 *
 * Returns the provider's memoised value, so every consumer receives the same object while nothing
 * about the load changed: the value changes when the page, the facets, the status, the failure or the
 * reload's identity does, and not when a refinement moves the URL, which is the other context's to
 * report.
 *
 * @returns The catalogue's loaded state as `CatalogView`.
 * @throws When called above every `CatalogProvider` — an application wiring mistake, not a state a
 *   visitor can reach — naming the missing provider.
 */
export function useCatalog(): CatalogView {
  const view = useContext(CatalogViewContext);
  if (view === null) {
    throw new Error("useCatalog must be called from a component within a CatalogProvider.");
  }
  return view;
}

/**
 * Reads the query in the address bar and the setters that write it.
 *
 * Returns the provider's memoised value, whose setters are stable for the life of the provider, so a
 * control can list one in a dependency array or hand it to a memoised child without re-rendering on
 * every change elsewhere. A consumer that only displays results reads `useCatalog()` instead, so a
 * refinement does not re-render it.
 *
 * @returns The query and its setters as `CatalogFilters`.
 * @throws When called above every `CatalogProvider`, naming the missing provider.
 */
export function useCatalogFilters(): CatalogFilters {
  const filters = useContext(CatalogFiltersContext);
  if (filters === null) {
    throw new Error("useCatalogFilters must be called from a component within a CatalogProvider.");
  }
  return filters;
}
