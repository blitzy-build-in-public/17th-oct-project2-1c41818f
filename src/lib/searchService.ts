/**
 * Path: src/lib/searchService.ts
 * Purpose: The search and type-ahead seam — the transport-backed reads and the rule names re-exported from src/utils/searchRules.ts
 * Lines: 127
 */

import { SEARCH_SUGGESTION_LIMIT } from "@/constants/config";
import { API_PATHS, getJson } from "@/lib/apiClient";
import type {
  FilterState,
  Product,
  SearchSuggestion,
  SearchSuggestionResponse,
  SuggestionQuery,
} from "@/types/catalog";
import type { PageResult, QueryParams, Result } from "@/types/common";
import { FILTER_PARAMS } from "@/utils/queryParams";
import { isBlankQuery, resolveSuggestionLimit } from "@/utils/searchRules";

// The public surface ------------------------------------------------------------------------------
// The search's rules — tokenising, the match weights and the type-ahead ranking — live in
// `src/utils/searchRules.ts`, in the foundations layer, for the same reason: the data module composes them over
// the collections it holds and a file may import only from its own layer or from a layer below it. Every name a
// consumer imports stays at this path.

export {
  applyTextMatch,
  buildSuggestions,
  groupSuggestionsByKind,
  highlightSegments,
  isBlankQuery,
  normaliseQuery,
  rankSuggestions,
  scoreProduct,
  tokenise,
  type BuildSuggestionsInput,
  type SearchLookup,
  type SearchSegment,
  type SearchTargets,
  type SuggestionGroup,
  type SuggestionSources,
} from "@/utils/searchRules";

// Requests ---------------------------------------------------------------------------------------

/**
 * Builds the query members one listing request carries, so the query state the URL holds and the
 * request it becomes cannot drift: a blank term is left out rather than sent empty, an unset price
 * bound or rating floor is omitted rather than sent as nothing, and the sort, the page and the page
 * size travel explicitly, so the request states which page of which order it wants. Every member name
 * comes from `FILTER_PARAMS`, the one list the URL is written with and the request's reader reads, so
 * a rename there cannot leave the URL writing a filter this request no longer carries.
 *
 * @param filter - The filter, sort and paging state to read.
 * @returns The request's query members, in the endpoint's own member names.
 */
function listingQuery(filter: FilterState): QueryParams {
  const query: Record<string, string | number | boolean | readonly string[] | undefined> = {
    [FILTER_PARAMS.SORT]: filter.sort,
    [FILTER_PARAMS.PAGE]: filter.page,
    [FILTER_PARAMS.PAGE_SIZE]: filter.pageSize,
  };
  if (!isBlankQuery(filter.q)) query[FILTER_PARAMS.QUERY] = filter.q;
  if (filter.categoryIds.length > 0) query[FILTER_PARAMS.CATEGORY_IDS] = filter.categoryIds;
  if (filter.brandIds.length > 0) query[FILTER_PARAMS.BRAND_IDS] = filter.brandIds;
  if (filter.minPriceMinor !== null) query[FILTER_PARAMS.MIN_PRICE] = filter.minPriceMinor;
  if (filter.maxPriceMinor !== null) query[FILTER_PARAMS.MAX_PRICE] = filter.maxPriceMinor;
  if (filter.minRating !== null) query[FILTER_PARAMS.MIN_RATING] = filter.minRating;
  if (filter.inStockOnly) query[FILTER_PARAMS.IN_STOCK] = true;
  if (filter.tags.length > 0) query[FILTER_PARAMS.TAGS] = filter.tags;
  return query;
}

/**
 * Searches the catalogue: the typed client entry point for full-text search and for a filtered listing
 * alike, because `GET /api/products` is one endpoint with `q` among its filter parameters.
 *
 * The state is passed through as given — the URL owns it, and this module never reads or writes a
 * location — and the abort signal travels to the transport, so the search field cancels a superseded
 * keystroke and the caller meets the transport's `request-aborted` value rather than a rejection.
 * Neither the debounce nor any request cache lives here: the interval is the field's, through
 * `src/utils/async.ts`, and this function honours whatever signal it is handed.
 *
 * @param query - The filter, sort and paging state to search with.
 * @param signal - The abort signal of the request, when a newer one will supersede it.
 * @returns One page of matching products, or the transport's failure value; never a rejection.
 */
export async function search(
  query: FilterState,
  signal?: AbortSignal,
): Promise<Result<PageResult<Product>>> {
  return getJson<PageResult<Product>>(API_PATHS.PRODUCTS, { query: listingQuery(query), signal });
}

/**
 * Asks for type-ahead suggestions for a term typed so far.
 *
 * A term with nothing searchable in it resolves to an empty list without a request: there is nothing
 * to ask, and a round trip would show a loading state for a list already known to be empty. A term that
 * does hold tokens is asked for with the cap the endpoint and the list share, and the caller's signal
 * travels with it, because a newer keystroke cancels this request rather than letting two lists race.
 * The answers arrive already ranked, as {@link buildSuggestions} left them, so nothing is reordered.
 *
 * The request's parameters are typed as {@link SuggestionQuery}, the one shape `src/types/catalog.ts`
 * declares for this endpoint — the seam parses the same request into it — so the endpoint's parameter
 * vocabulary is written once rather than as a literal on each side of the seam.
 *
 * @param query - The term typed so far.
 * @param limit - The most suggestions to ask for; defaults to and is capped at the shared limit.
 * @param signal - The abort signal of the request, when a newer one will supersede it.
 * @returns The suggestions best first, an empty list for a blank term, or the transport's failure.
 */
export async function suggest(
  query: string,
  limit: number = SEARCH_SUGGESTION_LIMIT,
  signal?: AbortSignal,
): Promise<Result<SearchSuggestion[]>> {
  if (isBlankQuery(query)) return { ok: true, value: [] };
  // Declared as the endpoint's own parameter shape and as the transport's query record both: a named
  // interface does not satisfy `QueryParams`' index signature on its own.
  const params: SuggestionQuery & QueryParams = { q: query, limit: resolveSuggestionLimit(limit) };
  const result = await getJson<SearchSuggestionResponse>(API_PATHS.SEARCH_SUGGEST, {
    query: params,
    signal,
  });
  return result.ok ? { ok: true, value: [...result.value.suggestions] } : result;
}
