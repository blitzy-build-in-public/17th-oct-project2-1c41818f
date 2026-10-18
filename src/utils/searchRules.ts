/**
 * Path: src/utils/searchRules.ts
 * Purpose: Tokenising, weighted scoring and type-ahead ranking over any collections a caller passes
 * Lines: 503
 */

import { SEARCH_SUGGESTION_LIMIT } from "@/constants/config";
import type { Brand, Category, Product, SearchSuggestion, SuggestionKind } from "@/types/catalog";
import type { BrandId, CategoryId } from "@/types/common";
import { clampNumber, createComparator, groupBy, sortBy, uniqueBy } from "@/utils/collections";
import type { Comparator } from "@/utils/collections";
import { normaliseForMatch } from "@/utils/strings";

// Matching weights -------------------------------------------------------------------------------

/**
 * The field weights of {@link scoreProduct}, highest first: the product's definition of relevance,
 * held as one named table rather than as literals scattered through the scorer.
 *
 * A field contributes its weight once per query token it answers, so a product matching two tokens
 * outranks one matching a single token in the same field. The name is worth an order of magnitude
 * more than any other single field, and the summary — which every product has and which mentions
 * many words — is worth least, so a summary match can never outrank a name or a brand match.
 */
const MATCH_WEIGHT = {
  /** The product's whole name is the query: the shopper typed exactly this product's title. */
  NAME_EXACT: 1000,
  /** A query token is a word of the product's name, or the opening of one. */
  NAME_TOKEN: 60,
  /** A query token is a word of the product's brand name, or the opening of one. */
  BRAND_TOKEN: 30,
  /** A query token is a word of the product's category name, or the opening of one. */
  CATEGORY_TOKEN: 20,
  /** A query token is a word of one of the product's tags, or the opening of one. */
  TAG_TOKEN: 15,
  /** A query token is a word of the product's summary, or the opening of one. */
  SUMMARY_TOKEN: 5,
} as const;

/**
 * The shortest token worth matching, in characters: a one-character fragment ("a", "x", "7") is noise
 * in a product search, matching half the catalogue and narrowing nothing, so {@link tokenise} drops it
 * and a query made of nothing else is {@link isBlankQuery blank}.
 */
const MIN_TOKEN_LENGTH = 2;

/**
 * The rank tiers of {@link rankSuggestions}, highest first: the type-ahead's definition of the best
 * suggestion, and the reason a product whose name begins with what was typed leads the list.
 */
const SUGGESTION_TIER = {
  /** A product whose name begins with the query: the completion the shopper is reaching for. */
  PRODUCT_PREFIX: 0,
  /** A product whose name answers a query token further in rather than leading with the query. */
  PRODUCT_TOKEN: 1,
  /** A brand whose name matches. */
  BRAND: 2,
  /** A category whose name matches — the broadest of the three, so it ranks last. */
  CATEGORY: 3,
} as const;

/** The order {@link groupSuggestionsByKind} returns its groups in. */
const SUGGESTION_KIND_ORDER: readonly SuggestionKind[] = ["product", "brand", "category"];

/** The splitter {@link highlightSegments} walks a value with: every run of letters and digits is a
 *  candidate word and the runs between them can never match. Written without the global flag, so it
 *  carries no mutable `lastIndex` and a split never depends on an earlier call. */
const WORD_SPLIT_PATTERN = /([\p{L}\p{N}]+)/u;

/** What a split part must look like to be a candidate word rather than the punctuation between two. */
const WORD_RUN_PATTERN = /^[\p{L}\p{N}]+$/u;

// Shapes -----------------------------------------------------------------------------------------

/** The two names {@link scoreProduct} needs and cannot import — the data layer supplies them from its
 *  seeded brands and categories, so the dependency runs one way only. */
export interface SearchLookup {
  /** The display name of a brand. */
  brandName(id: BrandId): string;
  /** The display name of a category. */
  categoryName(id: CategoryId): string;
}

/** The route builders a caller supplies so {@link buildSuggestions} points a suggestion at its
 *  destination without this module knowing a path: `src/constants/routes.ts` owns every route path, so
 *  the builder arrives with the call — the same inversion as {@link SearchLookup}. */
export interface SearchTargets {
  /** The detail path of the product with this slug. */
  productTarget(slug: string): string;
  /** The listing path of the category with this slug. */
  categoryTarget(slug: string): string;
  /** The results path scoped to the brand with this identifier. */
  brandTarget(id: BrandId): string;
}

/** The seeded collections {@link buildSuggestions} draws its candidates from. */
export interface SuggestionSources {
  /** The catalogue's products, whose names are the product suggestions. */
  readonly products: readonly Product[];
  /** The catalogue's categories, whose names are the category suggestions. */
  readonly categories: readonly Category[];
  /** The catalogue's brands, whose names are the brand suggestions. */
  readonly brands: readonly Brand[];
}

/** Everything {@link buildSuggestions} reads: the collections to search, the term typed so far, the
 *  route builders its targets come from and how many suggestions to return at most. A brand or
 *  category *name* lookup is deliberately absent — every suggestion carries the wording it is ranked
 *  by, so {@link SearchLookup} serves only {@link scoreProduct} and {@link applyTextMatch}. */
export interface BuildSuggestionsInput {
  /** The collections to draw candidates from. */
  readonly sources: SuggestionSources;
  /** The term the shopper has typed so far, as the field holds it. */
  readonly query: string;
  /** The route builders a suggestion's target is built with. */
  readonly targets: SearchTargets;
  /** The most suggestions to return; defaults to `SEARCH_SUGGESTION_LIMIT` and is capped there. */
  readonly limit?: number;
}

/** One run of a value, marked with whether a query token matched it: what the suggestion list and the
 *  results header render as highlighted text. Concatenating the segments reproduces the value exactly —
 *  segmentation never rewrites the text it marks — so a caller may render the parts and read the whole. */
export interface SearchSegment {
  /** The literal text of this run. */
  readonly text: string;
  /** Whether a query token matched this run. */
  readonly matched: boolean;
}

/** Suggestions of one kind, in the order {@link groupSuggestionsByKind} returns them. */
export interface SuggestionGroup {
  /** What every suggestion in the group points at. */
  readonly kind: SuggestionKind;
  /** The group's suggestions, best first, never empty. */
  readonly items: readonly SearchSuggestion[];
}

// Tokenising -------------------------------------------------------------------------------------

/**
 * Reduces a value to the comparison key a query and a product field meet on: lowercase, accent-folded,
 * punctuation reduced to single spaces, both ends trimmed.
 *
 * Delegates to `normaliseForMatch` in `src/utils/strings.ts`, which is the product's only normaliser —
 * the same key `src/lib/catalogService.ts` compares a facet value by and `src/utils/queryParams.ts`
 * round-trips through the URL — so this file adds no second one.
 *
 * @param text - The text to normalise.
 * @returns The comparison key, with single spaces between its tokens and none at either end.
 */
export function normaliseQuery(text: string): string {
  return normaliseForMatch(text);
}

/**
 * Splits a value into the tokens a product is matched against: lowercase, split on every
 * non-alphanumeric boundary, single-character fragments dropped, repeats dropped.
 *
 * Deterministic by construction — the split runs on the normalised form, string comparison is by code
 * unit and the first appearance of a token fixes its position — so two equal queries always produce
 * the same list, which is what lets a URL reload to an identical result set. Nothing is compared by
 * locale, so the same terms match in every browser.
 *
 * @param text - The text to split, the raw query or a product field.
 * @returns The tokens, in first-appearance order, deduplicated; empty when there is nothing matchable.
 */
export function tokenise(text: string): string[] {
  const normalised = normaliseForMatch(text);
  if (normalised === "") return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const candidate of normalised.split(" ")) {
    if (candidate.length < MIN_TOKEN_LENGTH || seen.has(candidate)) continue;
    seen.add(candidate);
    tokens.push(candidate);
  }
  return tokens;
}

/**
 * Whether a term holds nothing worth searching for: empty, whitespace or punctuation only, or made
 * entirely of the single-character fragments {@link tokenise} drops.
 *
 * A blank term is not an error and not an empty search — it is the absence of a filter, which is why
 * {@link applyTextMatch} leaves its input unfiltered and {@link suggest} answers without a request.
 *
 * @param text - The term to judge.
 * @returns `true` when no token survives tokenising.
 */
export function isBlankQuery(text: string): boolean {
  return tokenise(text).length === 0;
}

/** One value's derived match form: its normalised comparison key and the words split from it. */
interface NameMatch {
  /** The value's comparison key: lowercased, accent-folded, single-spaced and trimmed. */
  readonly normalised: string;
  /** The key's words; empty when the key is, so nothing sluggable means no words. */
  readonly words: readonly string[];
}

/** The derived match form of every value this module compares, one entry per distinct text.
 *
 *  The seeded catalogue and taxonomy are immutable while the application runs, so a value's key and
 *  its words are derived once and reused by every later call that reads them, whatever the query.
 *  Only derived word tables are held — no request, response or query result, and no query text: it
 *  is `tokenise`, `normaliseQuery` and `highlightSegments` that normalise the shopper's input. */
const NAME_MATCHES = new Map<string, NameMatch>();

/** The derived form of one value: derived on first sight and memoised from then on. The one home
 *  of the word-splitting rule, so every field and every candidate splits words the same way.
 *
 *  @param text - The value to derive: a product field or a suggestion's wording.
 *  @returns The memoised entry, carrying the value's comparison key and its words. */
function nameMatchOf(text: string): NameMatch {
  const memoised = NAME_MATCHES.get(text);
  if (memoised !== undefined) return memoised;
  const normalised = normaliseForMatch(text);
  const derived: NameMatch = { normalised, words: normalised === "" ? [] : normalised.split(" ") };
  NAME_MATCHES.set(text, derived);
  return derived;
}

/** Whether `words` answers `token`: a word that is the token, or one that begins with it, so a typed
 *  prefix completes the longer word — "cam" answers "cameras" and "aur" answers "aurelia". */
function holdsWord(words: readonly string[], token: string): boolean {
  return words.some((word) => word.startsWith(token));
}

/**
 * Whether a name *is* the query rather than merely containing part of it: the same number of words,
 * every one of them a query token, compared exactly rather than by {@link holdsWord}'s opening rule.
 *
 * A token that is only the opening of a name word therefore earns that word's token weight instead,
 * and the extra token in `"aurora desk lamp white"` still keeps the product off the exact-match tier.
 */
function isExactName(nameWords: readonly string[], tokens: readonly string[]): boolean {
  if (tokens.length === 0 || nameWords.length !== tokens.length) return false;
  return nameWords.every((word) => tokens.includes(word));
}

// Scoring ----------------------------------------------------------------------------------------

/**
 * Scores one product against a query's tokens, by the weights in {@link MATCH_WEIGHT}.
 *
 * The relevance definition, in one place: an exact name match adds `NAME_EXACT` once, then every token
 * adds a field's weight each time a word of that field answers it — the name, the brand name, the
 * category name, any tag, the summary. A product that answers no token in any field scores `0`, which
 * {@link applyTextMatch} drops, and a blank token list scores `0` for every product, because an absent
 * query says nothing about any of them.
 *
 * Pure and deterministic: a sum of integers over the words {@link nameMatchOf} derived, so equal
 * inputs always score equal, and neither the product nor the lookup is mutated.
 *
 * @param product - The product to score.
 * @param tokens - The query's tokens, as {@link tokenise} produced them.
 * @param lookup - Supplies the brand and category display names the product is measured against.
 * @returns The relevance score, `0` when the product matches nothing.
 */
export function scoreProduct(
  product: Product,
  tokens: readonly string[],
  lookup: SearchLookup,
): number {
  if (tokens.length === 0) return 0;
  const nameWords = nameMatchOf(product.name).words;
  const brandWords = nameMatchOf(lookup.brandName(product.brandId)).words;
  const categoryWords = nameMatchOf(lookup.categoryName(product.categoryId)).words;
  const tagWords = product.tags.flatMap((tag) => nameMatchOf(tag).words);
  const summaryWords = nameMatchOf(product.summary).words;
  let score = isExactName(nameWords, tokens) ? MATCH_WEIGHT.NAME_EXACT : 0;
  for (const token of tokens) {
    if (holdsWord(nameWords, token)) score += MATCH_WEIGHT.NAME_TOKEN;
    if (holdsWord(brandWords, token)) score += MATCH_WEIGHT.BRAND_TOKEN;
    if (holdsWord(categoryWords, token)) score += MATCH_WEIGHT.CATEGORY_TOKEN;
    if (holdsWord(tagWords, token)) score += MATCH_WEIGHT.TAG_TOKEN;
    if (holdsWord(summaryWords, token)) score += MATCH_WEIGHT.SUMMARY_TOKEN;
  }
  return score;
}

/**
 * Narrows a listing to the products a query describes, best match first.
 *
 * This is the full-text half of the catalogue listing, composed ahead of the filtering and sorting
 * that belong to another file: `src/data/repositories.ts` runs `applyTextMatch` and then the facet
 * filters, the sort and the page, so the order this function returns is the relevance order the
 * `relevance` sort key must preserve rather than re-derive.
 *
 * Two invariants hold whatever the input:
 *
 * - A query with no token — blank, or nothing but one-character fragments — filters nothing and
 *   returns the products unchanged, as a copy. An absent term means no search, never an empty listing.
 * - The order is total and reproducible: score descending, then name, then identifier, all compared by
 *   code unit. Two products that score equally always come out in the same order, and the input array
 *   is neither sorted in place nor mutated.
 *
 * @param products - The products to match, in any order.
 * @param query - The raw query, tokenised here.
 * @param lookup - Supplies the brand and category names the scores read.
 * @returns The matching products, best first, or every product when the query holds no token.
 */
export function applyTextMatch(
  products: readonly Product[],
  query: string,
  lookup: SearchLookup,
): Product[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return [...products];
  const scored: { readonly product: Product; readonly score: number }[] = [];
  for (const product of products) {
    const score = scoreProduct(product, tokens, lookup);
    if (score > 0) scored.push({ product, score });
  }
  const ranked = sortBy(
    scored,
    createComparator<{ readonly product: Product; readonly score: number }>([
      { select: (entry) => entry.score, direction: "desc" },
      { select: (entry) => entry.product.name },
      { select: (entry) => entry.product.id },
    ]),
  );
  return ranked.map((entry) => entry.product);
}

// Type-ahead ranking -----------------------------------------------------------------------------

/** The term a candidate is admitted and ranked by: the shopper's normalised key and its tokens. */
interface QueryMatch {
  readonly normalised: string;
  readonly tokens: readonly string[];
}

/** One suggestion carried with the keys ranking compares it by — its normalised text and its tier —
 *  derived once, because a sort compares a candidate many times and re-deriving costs each one. */
interface RankedSuggestion {
  readonly suggestion: SearchSuggestion;
  readonly normalised: string;
  readonly tier: number;
}

/** The tier a suggestion ranks in, from keys already derived: a brand, a category, or a product that
 *  leads with the query (`PRODUCT_PREFIX`) rather than only holding one of its tokens; a suggestion a
 *  caller offers that answered neither way ranks with the token tier. */
function tierOf(kind: SuggestionKind, leadsWithQuery: boolean): number {
  if (kind === "brand") return SUGGESTION_TIER.BRAND;
  if (kind === "category") return SUGGESTION_TIER.CATEGORY;
  return leadsWithQuery ? SUGGESTION_TIER.PRODUCT_PREFIX : SUGGESTION_TIER.PRODUCT_TOKEN;
}

/** Carries a suggestion with its comparison keys: the one home of the derivation, taking the reading
 *  the candidate was admitted by. */
function rankableOf(
  suggestion: SearchSuggestion,
  match: NameMatch,
  term: QueryMatch,
): RankedSuggestion {
  const tier = tierOf(suggestion.kind, match.normalised.startsWith(term.normalised));
  return { suggestion, normalised: match.normalised, tier };
}

/** The ranking order both callers share: tier, then the text, then the target, all by code unit. */
const RANK_ORDER: Comparator<RankedSuggestion> = createComparator<RankedSuggestion>([
  { select: (entry) => entry.tier },
  { select: (entry) => entry.suggestion.text },
  { select: (entry) => entry.suggestion.target },
]);

/**
 * Orders suggestions best first by the tiers of {@link SUGGESTION_TIER}, ties broken by the
 * suggestion's text and then its target — both by code unit, so equal input yields the same list; a
 * term with no token ranks nothing and gives the list back as a copy, and each suggestion's keys are
 * derived once, ahead of the sort.
 *
 * @param suggestions - The suggestions to rank; never mutated.
 * @param query - The term the ranking is relative to.
 * @returns A new array, best suggestion first.
 */
export function rankSuggestions(
  suggestions: readonly SearchSuggestion[],
  query: string,
): SearchSuggestion[] {
  const normalised = normaliseQuery(query);
  const tokens = tokenise(query);
  if (normalised === "" || tokens.length === 0) return [...suggestions];
  const term: QueryMatch = { normalised, tokens };
  const decorated = suggestions.map((suggestion) =>
    rankableOf(suggestion, nameMatchOf(suggestion.text), term),
  );
  return sortBy(decorated, RANK_ORDER).map((entry) => entry.suggestion);
}

/** How many suggestions to return: the caller's request inside `1..SEARCH_SUGGESTION_LIMIT`, or the
 *  cap when none was asked for or the request is not a number. */
export function resolveSuggestionLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_SUGGESTION_LIMIT;
  return clampNumber(Math.trunc(limit), 1, SEARCH_SUGGESTION_LIMIT);
}

/** The best `count` candidates, best first: a window holding at most `count` entries that compares each
 *  further candidate against the window's worst and orders only the window — the whole list's own
 *  prefix, because (tier, text) is unique once candidates are deduplicated. */
function bestRanked(candidates: readonly RankedSuggestion[], count: number): RankedSuggestion[] {
  if (count < 1) return [];
  const best: RankedSuggestion[] = [];
  for (const candidate of candidates) {
    const worst = best.at(-1);
    if (best.length === count && worst !== undefined && RANK_ORDER(candidate, worst) >= 0) continue;
    best.push(candidate);
    best.sort(RANK_ORDER);
    if (best.length > count) best.pop();
  }
  return best;
}

/**
 * Builds the type-ahead list for a term typed so far: the products, brands and categories whose names
 * answer it, ranked best first and capped. A candidate is admitted when its name begins with the term
 * — how an unfinished word completes — or answers one of the term's tokens, and carries the keys it is
 * ranked by from that one reading; repeated wording is dropped, one row per kind and normalised text,
 * the first kept; and the cap keeps the best {@link resolveSuggestionLimit} rows without ordering the
 * admitted set. Every product it offers answers that term in the results listing too, because both
 * surfaces match through {@link holdsWord}, so no suggestion leads to a results page with nothing on it.
 *
 * @param input - The collections, the term, the route builders and the cap.
 * @returns The suggestions, best first, at most the cap; empty for a term with no token.
 */
export function buildSuggestions(input: BuildSuggestionsInput): SearchSuggestion[] {
  const { sources, query, targets } = input;
  const normalised = normaliseQuery(query);
  const tokens = tokenise(query);
  if (normalised === "" || tokens.length === 0) return [];
  const term: QueryMatch = { normalised, tokens };
  const candidates: RankedSuggestion[] = [];
  const admit = (text: string, kind: SuggestionKind, target: string): void => {
    const match = nameMatchOf(text);
    const answers =
      match.normalised.startsWith(term.normalised) ||
      term.tokens.some((token) => holdsWord(match.words, token));
    if (answers) candidates.push(rankableOf({ text, kind, target }, match, term));
  };
  for (const product of sources.products) {
    admit(product.name, "product", targets.productTarget(product.slug));
  }
  for (const brand of sources.brands) {
    admit(brand.name, "brand", targets.brandTarget(brand.id));
  }
  for (const category of sources.categories) {
    admit(category.name, "category", targets.categoryTarget(category.slug));
  }
  const distinct = uniqueBy(candidates, (entry) => `${entry.suggestion.kind}:${entry.normalised}`);
  return bestRanked(distinct, resolveSuggestionLimit(input.limit)).map((entry) => entry.suggestion);
}

/**
 * Groups suggestions by kind in the order the type-ahead list renders them — products, brands,
 * categories. A kind nothing points at is left out rather than returned empty, so no heading is ever
 * rendered over nothing.
 *
 * @param suggestions - The suggestions to group, in the order they arrived.
 * @returns One group per kind that has suggestions; empty when there are none.
 */
export function groupSuggestionsByKind(
  suggestions: readonly SearchSuggestion[],
): SuggestionGroup[] {
  const groups = groupBy(suggestions, (suggestion) => suggestion.kind);
  const ordered: SuggestionGroup[] = [];
  for (const kind of SUGGESTION_KIND_ORDER) {
    const items = groups.get(kind);
    if (items !== undefined && items.length > 0) ordered.push({ kind, items });
  }
  return ordered;
}

// Highlighting -----------------------------------------------------------------------------------

/**
 * Splits a value into the runs a suggestion list or a results header highlights: each word a query
 * token answers, marked, and every run between the words, unmarked.
 *
 * Marking is {@link holdsWord}'s own rule, so matching and highlighting can never disagree: a token
 * marks the word that is it or begins with it, and a prefix completion the scorer counted on a row is
 * marked on that row. Concatenating the segments reproduces the value byte for byte — accents, case
 * and punctuation included, because a segment is a slice of the input rather than a rendering of its
 * normalised form.
 *
 * @param text - The value to segment.
 * @param tokens - The query's tokens, as {@link tokenise} produced them.
 * @returns The segments in order; their text, joined, is `text` exactly.
 */
export function highlightSegments(text: string, tokens: readonly string[]): SearchSegment[] {
  if (text === "") return [];
  const segments: SearchSegment[] = [];
  for (const part of text.split(WORD_SPLIT_PATTERN)) {
    if (part === "") continue;
    const word = WORD_RUN_PATTERN.test(part) ? normaliseForMatch(part) : "";
    const matched = word !== "" && tokens.some((token) => holdsWord([word], token));
    segments.push({ text: part, matched });
  }
  return segments;
}
