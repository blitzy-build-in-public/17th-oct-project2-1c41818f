/**
 * Path: src/state/catalogReducer.ts
 * Purpose: Catalogue load transitions tagged with the query fingerprint that produced them
 * Lines: 259
 */

import type { Facet, FilterState, Product } from "@/types/catalog";
import type { ApiError, AsyncStatus, IsoDateTimeString, PageResult } from "@/types/common";
import { writeFilterState } from "@/utils/queryParams";

// State -----------------------------------------------------------------------------------------

/**
 * Everything one catalogue load produces, keyed by the whole request it belongs to.
 *
 * The state carries **no filter values** — no term, no facet selection, no sort, no page and no page
 * size. The URL is the store of every one of them, `src/utils/queryParams.ts` is its only reader and
 * writer, and the catalogue context derives them from the location, so a copy here would be a second
 * answer to a question the address bar already answers, and the two would drift apart the first time
 * one was written without the other. There is no action that sets a filter, and none may be added.
 *
 * What is stored is what a request produced, tagged with the fingerprint of the request that asked
 * for it:
 *
 * - `fingerprint` is that tag: the canonical key `catalogFingerprint` builds from the whole request
 *   that produced what is stored, its sort and its page and page size included, so a superseded page
 *   is discarded by the same single comparison that discards a superseded filter. It stays `null`
 *   until the first load starts, which is the case `isStaleResult` reads as "nothing is waiting for
 *   a result".
 * - `page` and `facets` are what the last successful load returned, and both are deliberately kept
 *   across a failure so the error state renders over the result the shopper was reading.
 * - `loadedAt` is the instant the last successful load settled. It arrives with that load's action,
 *   so the reducer reads no clock and a transition is reproducible from its state and its action.
 */
export interface CatalogState {
  readonly status: AsyncStatus;
  readonly fingerprint: string | null;
  readonly page: PageResult<Product> | null;
  readonly facets: Facet[];
  readonly error: ApiError | null;
  readonly loadedAt: IsoDateTimeString | null;
}

/**
 * The state a catalogue surface starts from: nothing asked for and nothing held.
 *
 * `status` is `idle` rather than `loading`, because a surface that dispatched no request must not
 * render a skeleton for one that is not coming. `facets` starts as an empty array rather than
 * `null`, so the filter panel iterates its response from the first render.
 */
export function createInitialCatalogState(): CatalogState {
  return {
    status: "idle",
    fingerprint: null,
    page: null,
    facets: [],
    error: null,
    loadedAt: null,
  };
}

// Actions ---------------------------------------------------------------------------------------

/**
 * Every transition a catalogue load can make, one member each.
 *
 * Three members carry a `fingerprint`, and that is the whole of the staleness rule: a result is
 * applied only while its fingerprint is the state's own. `catalog/load-started` records the key of
 * the request being asked for and nothing else of it, because what a request filters by belongs to
 * the URL, and the two result actions are applied or discarded by comparing what they carry against
 * the state, so a slow response for a request the shopper has moved on from — a superseded page as
 * much as a superseded filter — cannot overwrite a newer result that has already landed.
 *
 * `at` is the instant a successful load settled. It travels with the action rather than being read
 * inside the reducer, which is what keeps the transitions reproducible, and it is optional so an
 * action built by hand still type-checks; a success carrying none keeps the instant the state
 * already holds.
 */
export type CatalogAction =
  | { readonly type: "catalog/load-started"; readonly fingerprint: string }
  | {
      readonly type: "catalog/load-succeeded";
      readonly fingerprint: string;
      readonly page: PageResult<Product>;
      readonly facets: Facet[];
      readonly at?: IsoDateTimeString;
    }
  | { readonly type: "catalog/load-failed"; readonly fingerprint: string; readonly error: ApiError }
  | { readonly type: "catalog/reset" };

// Fingerprint and staleness ---------------------------------------------------------------------

/**
 * The staleness key of a request: the canonical query string `src/utils/queryParams.ts` writes for
 * the whole of it — the filter half together with the sort, the page and the page size — with keys
 * sorted and every field holding its default left out.
 *
 * The key is produced by that module's own normaliser and writer rather than from the request's
 * field order, which is what makes two equivalent selections — the same categories listed the other
 * way round, a price range written out or left off — produce one key, and therefore one result the
 * UI treats as current. Because the sort, the page and the page size are inside the key as well as
 * the filters are, two requests that differ by any of them key apart, and that is what lets the
 * single comparison in `isStaleResult` discard a superseded page exactly as it discards a superseded
 * filter. The default selection writes the empty string, which is the unfiltered catalogue's key.
 *
 * @param request - The whole request a load is issued for, its sort, page and page size included.
 * @returns The request's canonical key, compared against `CatalogState.fingerprint`.
 */
export function catalogFingerprint(request: FilterState): string {
  return writeFilterState(request).toString();
}

/**
 * Reports whether a result belongs to a query the state is no longer describing.
 *
 * One comparison is the whole rule: a result is stale unless its fingerprint is the state's own.
 * Both cases that could be read as accidental are the answer this rule intends — a state whose
 * `fingerprint` is still `null`, where no load was ever recorded and so nothing is waiting for a
 * result, and a state already loading a newer query — because in neither is the arriving result the
 * one the surface is waiting for.
 *
 * @param state - The state the result would be applied to.
 * @param fingerprint - The key carried by the result.
 * @returns `true` when the result must be discarded rather than applied.
 */
export function isStaleResult(state: CatalogState, fingerprint: string): boolean {
  return state.fingerprint !== fingerprint;
}

// Reducer ---------------------------------------------------------------------------------------

/**
 * Applies one transition.
 *
 * A transition that changes nothing returns the state *itself*, not an equal copy, because the
 * catalogue context's value is memoised and a fresh object would re-render every consumer of it for
 * no change at all. Three conditions are deliberate no-ops, and four arms carry them: a repeat of
 * the load already in flight, a failure repeating the one already stored field for field, and a
 * result whose fingerprint is not the state's own — checked on both result arms alike.
 *
 * The reducer is pure: no clock, no randomness, no storage and no request, and nothing the caller
 * passed is mutated. The key a result is recognised by arrives with its action, the instant a
 * success settled arrives with that action too, and `src/state/CatalogContext.tsx` is what
 * dispatches these transitions and what asks the services for the page and the facets they carry.
 */
export function catalogReducer(state: CatalogState, action: CatalogAction): CatalogState {
  switch (action.type) {
    case "catalog/load-started": {
      // A request already in flight for the same key is not a second load: React's StrictMode runs
      // an effect twice and a re-render can re-issue the same request, and neither should replace
      // the object the memoised context value is built from. A load in flight holds no error, so the
      // status and the key are enough to recognise the request.
      if (state.status === "loading" && state.fingerprint === action.fingerprint) {
        return state;
      }
      // The previous error goes with the new request, while the last good page and facets stay for
      // an error state to fall back on if this load fails too.
      return {
        ...state,
        status: "loading",
        fingerprint: action.fingerprint,
        error: null,
      };
    }

    case "catalog/load-succeeded": {
      if (isStaleResult(state, action.fingerprint)) {
        return state;
      }
      return {
        ...state,
        status: "success",
        page: action.page,
        facets: action.facets,
        error: null,
        loadedAt: action.at ?? state.loadedAt,
      };
    }

    case "catalog/load-failed": {
      if (isStaleResult(state, action.fingerprint)) {
        return state;
      }
      // A retry that fails the same way changes nothing the UI renders, so the state keeps its
      // reference instead of re-rendering every consumer with an identical error.
      if (state.status === "error" && isSameApiError(state.error, action.error)) {
        return state;
      }
      // The page and the facets are kept on purpose: an error state renders over the last result
      // the shopper saw rather than emptying a listing they were still reading.
      return { ...state, status: "error", error: action.error };
    }

    case "catalog/reset": {
      return createInitialCatalogState();
    }

    default: {
      return assertNever(action);
    }
  }
}

// Creators --------------------------------------------------------------------------------------

/**
 * A creator for every action, defined once at module scope so a holder can keep one in a dependency
 * list without its identity changing between renders.
 *
 * `loadStarted` derives the key from the whole request when the caller supplies none, so a load and
 * the fingerprint it is tagged with cannot describe two different requests. `loadSucceeded` stamps
 * the instant it was called — the only clock read in this module, and the reason the reducer itself
 * has none — in the ISO form `Date` produces, because `src/utils/dates.ts` is outside this module's
 * dependencies; a caller that needs a fixed instant passes its own, which is how a transition is
 * asserted rather than observed.
 */
export const catalogActions = {
  /** Records the key of the request a load is being issued for; its values live in the URL. */
  loadStarted: (
    request: FilterState,
    fingerprint: string = catalogFingerprint(request),
  ): CatalogAction => ({ type: "catalog/load-started", fingerprint }),

  /** Applies one page of results together with the facets that came back with it. */
  loadSucceeded: (
    fingerprint: string,
    page: PageResult<Product>,
    facets: Facet[],
    at: IsoDateTimeString = new Date().toISOString(),
  ): CatalogAction => ({ type: "catalog/load-succeeded", fingerprint, page, facets, at }),

  /** Records a failure against the query whose request produced it. */
  loadFailed: (fingerprint: string, error: ApiError): CatalogAction => ({
    type: "catalog/load-failed",
    fingerprint,
    error,
  }),

  /** Returns a surface to its initial state, as leaving the catalogue for another route does. */
  reset: (): CatalogAction => ({ type: "catalog/reset" }),
};

// Internal helpers ------------------------------------------------------------------------------

/** Whether `candidate` repeats the failure the state already holds, field for field. */
function isSameApiError(current: ApiError | null, candidate: ApiError): boolean {
  return (
    current !== null &&
    current.status === candidate.status &&
    current.code === candidate.code &&
    current.message === candidate.message &&
    current.field === candidate.field
  );
}

/** Proof at compile time that every action was handled: a member added later fails to build here. */
function assertNever(value: never): never {
  throw new Error(`Unhandled catalogue action: ${JSON.stringify(value)}`);
}
