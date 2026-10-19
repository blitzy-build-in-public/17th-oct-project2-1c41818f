/**
 * Path: src/utils/strings.ts
 * Purpose: Slug, case, truncation and initial helpers, the prefixed identifier generators, and the credential digest
 * Lines: 620
 */

import type { CredentialDigest } from "@/types/account";
import type {
  AddressId,
  Brand,
  BrandId,
  CategoryId,
  CustomerId,
  LineId,
  OrderId,
  ProductId,
  PromoCodeId,
  ReviewId,
  SessionToken,
} from "@/types/common";
import {
  HASH_DOMAIN_CUSTOMER,
  HASH_DOMAIN_IDENTIFIER,
  HASH_DOMAIN_PASSWORD,
  HASH_DOMAIN_SALT,
  HASH_DOMAIN_SEAL,
  HASH_DOMAIN_SESSION,
  hashesMatch,
  shortHash,
} from "@/utils/hashing";

// Text ------------------------------------------------------------------------------------------

/** The ellipsis {@link truncate} appends when its caller supplies no other. */
const ELLIPSIS = "…";

/** Every run of characters a slug does not keep: the one definition of where a word breaks. */
const NON_SLUG_PATTERN = /[^a-z0-9]+/g;

/** The separators a slug may neither begin nor end with. */
const SLUG_EDGE_PATTERN = /^-+|-+$/g;

/** Every run of whitespace, the non-breaking and line-separator ones included. */
const WHITESPACE_PATTERN = /\s+/gu;

/** Whitespace at the end of a value, dropped after a cut and before an ellipsis is appended. */
const TRAILING_WHITESPACE_PATTERN = /\s+$/u;

/** The first Unicode letter anywhere in a value. */
const LETTER_PATTERN = /\p{L}/u;

/** A word boundary — the start of a value, whitespace, a hyphen or a slash — and the letter after it. */
const WORD_START_PATTERN = /(^|[\s\-/])(\p{L})/gu;

/** The combining marks a compatibility decomposition leaves behind. */
const COMBINING_MARK_PATTERN = /\p{M}+/gu;

/** Every C0 and DEL control character. No `g` flag: a `g` pattern carries `lastIndex` between calls, so it
 * would let one value pass the test below and the next identical one fail. */
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

/** The class {@link stripControlCharacters} removes: the set difference `[^\P{Cc}\t\n\r]`, read as "a
 * control character that is not a tab, a CR or a LF", the three a value may legitimately carry as
 * whitespace — `src/utils/csv.ts` quotes a field holding one rather than losing it. */
const STRIPPED_CONTROL_CHARACTER_PATTERN = /[^\P{Cc}\t\n\r]/gu;

/**
 * Folds a value to its unaccented form — `é` to `e`, a ligature to its letters, a full-width character
 * to its ASCII one — so two spellings of the same text compare equal. Compatibility decomposition is
 * used rather than canonical because it also splits the ligatures and full-width forms that arrive
 * unnoticed in pasted text; a script with no ASCII fold (Greek, Cyrillic, CJK) survives the fold and is
 * then dropped by the helpers that keep ASCII only, each of which says so for itself.
 */
function foldDiacritics(value: string): string {
  return value.normalize("NFKD").replace(COMBINING_MARK_PATTERN, "");
}

/**
 * Collapses every run of whitespace in a value to a single space and trims both ends, so text pasted
 * from two places renders and compares alike. The non-breaking and line-separator spaces are collapsed
 * too: they survive copying unnoticed and would otherwise leave equal-looking text unequal.
 *
 * @param value - The text to collapse.
 * @returns The collapsed text, with no leading or trailing whitespace.
 */
export function normaliseWhitespace(value: string): string {
  return value.replace(WHITESPACE_PATTERN, " ").trim();
}

/**
 * Whether a value carries a control character — a C0 or a DEL one. This is the product's only statement of
 * that rule: `src/utils/validation.ts` refuses a free-text field by it, because a NUL or a newline inside a
 * name or an address line is text no control displays whatever the escaping at render, and `src/utils/csv.ts`
 * strips a cell's text by {@link stripControlCharacters}, its sibling here.
 *
 * @param value - The text to inspect.
 * @returns True when the value holds at least one control character.
 */
export function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTER_PATTERN.test(value);
}

/**
 * The same value with every control character removed, so text that arrived from a hand-made request cannot
 * reach a file or a store carrying one. A tab, a CR and a LF are kept: they are whitespace a line of text
 * may legitimately hold, and the export quotes a field carrying one rather than losing the break.
 *
 * @param value - The text to clean.
 * @returns The text without its control characters.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(STRIPPED_CONTROL_CHARACTER_PATTERN, "");
}

/**
 * Converts a display string into the lowercase hyphenated slug the catalogue's URLs use and the
 * readable half of an identifier is built from: accents and ligatures folded, every remaining run
 * outside `a-z0-9` collapsed to one hyphen, the hyphens at either end dropped. The result is ASCII and
 * stable — the same input yields the same slug in every process, which is what lets a seeded identifier
 * be recomputed rather than stored. A value with nothing sluggable in it returns an empty string, and
 * the identifier generators below supply their own fallback rather than inventing a slug here.
 *
 * @param value - The text to slug.
 * @returns The slug, or an empty string when the text holds no letters or digits.
 */
export function slugify(value: string): string {
  return foldDiacritics(value)
    .toLowerCase()
    .replace(NON_SLUG_PATTERN, "-")
    .replace(SLUG_EDGE_PATTERN, "");
}

/**
 * Builds the key two spellings of the same text are compared by: lowercase, accent-folded, punctuation
 * reduced to single spaces, both ends trimmed.
 *
 * This is the catalogue's and the search's only normaliser, which is why it lives here rather than in
 * either of them: `src/lib/catalogService.ts` keys a product against a facet value with it and
 * `src/lib/searchService.ts` tokenises a query with it, so a search typed `"USB-C"` and a filter stored
 * as `usb c` meet on one key. Punctuation becomes a space rather than nothing, so those two agree
 * instead of collapsing into `usbc` against `usb c`.
 *
 * @param value - The text to reduce to a comparison key.
 * @returns The key, with single spaces between its tokens and none at either end.
 */
export function normaliseForMatch(value: string): string {
  return foldDiacritics(value).toLowerCase().replace(NON_SLUG_PATTERN, " ").trim();
}

/**
 * Capitalises the first letter of every word and leaves the rest of each word exactly as given, so a
 * heading or a facet caption reads as a title without a product code being destroyed: `"USB-C hub"`
 * becomes `"USB-C Hub"`, never `"Usb-c Hub"`. A word begins at the start of the value and after
 * whitespace, a hyphen or a slash, and whitespace is collapsed first, so the result is a single-spaced
 * line whatever the input's spacing was.
 *
 * @param value - The text to title-case.
 * @returns The title-cased text.
 */
export function toTitleCase(value: string): string {
  return normaliseWhitespace(value).replace(
    WORD_START_PATTERN,
    (_match: string, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`,
  );
}

/**
 * Uppercases the first letter of a value and leaves everything else untouched, so a stored status or
 * loyalty tier renders as a label — `"pending"` to `"Pending"` — without the rest of the word being
 * rewritten. The first *letter* is capitalised rather than the first character, so a value opening with
 * a quote or a bracket comes out capitalised too.
 *
 * @param value - The text to capitalise.
 * @returns The text with its first letter uppercased, or unchanged when it holds no letter.
 */
export function capitalise(value: string): string {
  const match = LETTER_PATTERN.exec(value);
  if (match === null) return value;
  const index = match.index;
  return `${value.slice(0, index)}${match[0].toUpperCase()}${value.slice(index + match[0].length)}`;
}

/**
 * Shortens a value to fit a display budget, appending an ellipsis to the cut.
 *
 * The cut counts characters rather than UTF-16 code units, so a value carrying an emoji or any other
 * surrogate pair is never cut through the middle of one and left rendering as a replacement character.
 * A space left dangling by the cut is dropped, so a shortened name reads `"Aurora Desk…"`. The ellipsis
 * is kept whole — a budget shorter than the ellipsis returns the ellipsis alone — and a value that
 * already fits is returned unchanged, with no ellipsis.
 *
 * @param value - The text to shorten.
 * @param maxLength - The most characters the result may hold, as a whole number of 0 or more.
 * @param ellipsis - The marker appended to the cut, `…` by default.
 * @returns The shortened text.
 * @throws TypeError - When `maxLength` is not a whole number of 0 or more, which is a programming error
 *   rather than a display condition and is failed fast instead of rendering an untruncated value.
 */
export function truncate(value: string, maxLength: number, ellipsis: string = ELLIPSIS): string {
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new TypeError(`truncate expects a whole number of characters, received ${maxLength}.`);
  }
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  const available = maxLength - Array.from(ellipsis).length;
  if (available < 1) return ellipsis;
  const head = characters.slice(0, available).join("").replace(TRAILING_WHITESPACE_PATTERN, "");
  return `${head}${ellipsis}`;
}

/** Returns a word's first letter, or an empty string when the word holds none. */
function firstLetterOf(word: string): string {
  const match = LETTER_PATTERN.exec(word);
  return match === null ? "" : match[0];
}

/**
 * Reduces a person's name to the one or two letters an avatar or an account menu shows.
 *
 * The name may be given in two parts or as one full name: `initials("Dana", "Okafor")` and
 * `initials("Dana Okafor")` both return `"DO"`. Only the first and the last word contribute a letter,
 * so a middle name does not widen the result and a single-word name yields one letter. Letters are
 * uppercased after they are picked, so an accented initial keeps its own letter, and a name holding no
 * letter yields an empty string rather than a placeholder a caller could read as a real initial.
 *
 * @param firstName - The first name, or the whole name when no second part is supplied.
 * @param lastName - The last name, when the name is supplied in two parts.
 * @returns One or two uppercase letters, or an empty string when the name holds no letter.
 */
export function initials(firstName: string, lastName = ""): string {
  const parts = normaliseWhitespace(`${firstName} ${lastName}`).split(" ");
  const first = firstLetterOf(parts.at(0) ?? "");
  if (first === "") return "";
  const last = parts.length > 1 ? firstLetterOf(parts.at(-1) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Reduces a person's name to the one a surface read by others may carry: the given name with the last name
 * cut to its initial, so `displayName("Dana", "Okafor")` reads `"Dana O."`.
 *
 * The name may be given in two parts or as one full name — `displayName("Dana Okafor")` reads exactly as
 * `displayName("Dana", "Okafor")` does, the way {@link initials} reads them — and only the first and the
 * last word count, so a middle name does not lengthen the result. Nothing is invented for a name that
 * cannot carry an initial: a single-word name and a blank second part both come back as the given name
 * alone, with no dot left hanging off it, and a second part holding no letter is left off rather than
 * rendered as an initial it does not have. An initial keeps its own letter and is uppercased, so an
 * accented name reads as it is written, and the given name is returned as it was stored rather than
 * capitalised, because the spelling of a person's own name is theirs.
 *
 * @param firstName - The first name, or the whole name when no second part is supplied.
 * @param lastName - The last name, when the name is supplied in two parts.
 * @returns The given name and the last name's initial, or as much of the name as can be said when no
 *   initial can be taken from it.
 */
export function displayName(firstName: string, lastName = ""): string {
  const parts = normaliseWhitespace(`${firstName} ${lastName}`).split(" ");
  const given = parts.at(0) ?? "";
  const initial = parts.length > 1 ? firstLetterOf(parts.at(-1) ?? "") : "";
  return initial === "" ? given : `${given} ${initial.toUpperCase()}.`;
}

// The digest arithmetic --------------------------------------------------------------------------
// One implementation of it, shared by the identifier generators below, the seal, the random source and the
// credential digest at the end of this file: `src/utils/hashing.ts` holds the FNV-1a core and the domain
// separators, and this module publishes the values the product derives from it. It is demonstration-grade
// rather than cryptographic, and each caller states what that means for it.

// Randomness ------------------------------------------------------------------------------------
// One source of unpredictable text, for the values that must not be derivable from anything a reader can
// see: the issue marker a session token is minted from, a durable record's seal, and the placement
// credential this browser holds for an order it placed without an account.

/** How many random bytes a token is minted from when its caller names none: sixteen, or 128 bits. */
const RANDOM_TOKEN_BYTES = 16;

/**
 * Reads random bytes from the browser's own generator as lowercase hexadecimal text. `crypto.getRandomValues`
 * is the only source used: a host without it fails loudly rather than minting a value a reader could guess.
 *
 * @param byteLength - How many random bytes to read; a whole count of one or more.
 * @returns Twice that many lowercase hexadecimal characters.
 * @throws TypeError - When the length is not a whole count of one or more bytes.
 */
export function randomHexText(byteLength: number = RANDOM_TOKEN_BYTES): string {
  if (!Number.isInteger(byteLength) || byteLength < 1) {
    throw new TypeError(`A random byte count must be whole and positive: ${byteLength}.`);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Identifiers -----------------------------------------------------------------------------------

/** The character between an identifier's prefix and the suffix derived from its source. */
const ID_SEPARATOR = "_";

/** The longest readable suffix an identifier carries before it is cut and disambiguated. */
const MAX_READABLE_SUFFIX_LENGTH = 40;

/** The hexadecimal characters of the source hash that disambiguate a cut suffix. */
const TRUNCATED_SUFFIX_HASH_LENGTH = 8;

/** The width {@link sequenceId} pads an index to when its caller supplies none. */
const DEFAULT_SEQUENCE_WIDTH = 4;

/**
 * A prefix carrying its separator exactly once: the brand of the identifier built from it. It makes
 * `"prod"` and `"prod_"` the same prefix to a caller — either yields `Brand<string, "prod_">`, which is
 * `ProductId` — so an identifier is never built with two separators or with none.
 */
type PrefixedBrand<TBrand extends string> = TBrand extends `${infer _TPrefix}_`
  ? TBrand
  : `${TBrand}_`;

/**
 * Returns a prefix ending in exactly one separator, whichever form its caller passed.
 *
 * @param prefix - The prefix to normalise.
 * @returns The prefix, ending in exactly one separator.
 * @throws TypeError - When the prefix is blank: an identifier carrying no prefix cannot be read back as
 *   the kind of thing it names.
 */
function prefixWithSeparator(prefix: string): string {
  if (prefix.trim() === "") throw new TypeError("An identifier prefix cannot be blank.");
  return prefix.endsWith(ID_SEPARATOR) ? prefix : `${prefix}${ID_SEPARATOR}`;
}

/**
 * Builds an identifier whose suffix is its source's digest rather than its slug: the one way an identifier is made
 * when the text behind it must not be readable out of it. The digest is stable, so a seed, a registration and a
 * fixture derive one identifier for one source, and domain-separated, so no identifier of this kind can collide
 * with a token, a salt or a password digest.
 *
 * @param prefix - The identifier's prefix, with or without its separator.
 * @param domain - What the source is being hashed for.
 * @param source - The text the identifier is derived from; it may not be blank.
 * @returns The prefixed identifier.
 * @throws TypeError - When the source is blank.
 */
function opaqueId<TPrefix extends string>(
  prefix: TPrefix,
  domain: string,
  source: string,
): Brand<string, PrefixedBrand<TPrefix>> {
  if (source.trim() === "") throw new TypeError("An identifier source cannot be blank.");
  return `${prefixWithSeparator(prefix)}${shortHash(domain, source)}` as Brand<
    string,
    PrefixedBrand<TPrefix>
  >;
}

/**
 * Derives an identifier's readable suffix from its source: the source's slug, or the source's hash when
 * a slug cannot carry it.
 *
 * A slug past the readable maximum is cut and disambiguated with the opening characters of the source's
 * hash, so two long names sharing a beginning still get distinct identifiers, and a source holding
 * nothing sluggable — punctuation only, or a script with no ASCII fold — takes that hash outright rather
 * than collapsing to a shared empty suffix.
 *
 * @param source - The stable text the suffix is derived from.
 * @returns The suffix.
 */
function readableSuffix(source: string): string {
  const slug = slugify(source);
  if (slug === "") return shortHash(HASH_DOMAIN_IDENTIFIER, source);
  if (slug.length <= MAX_READABLE_SUFFIX_LENGTH) return slug;
  const cut = slug.slice(0, MAX_READABLE_SUFFIX_LENGTH).replace(SLUG_EDGE_PATTERN, "");
  const disambiguator = shortHash(HASH_DOMAIN_IDENTIFIER, source).slice(
    0,
    TRUNCATED_SUFFIX_HASH_LENGTH,
  );
  return `${cut}-${disambiguator}`;
}

/**
 * Builds an identifier from a prefix and a readable source: how every seeded entity's id is made.
 *
 * The suffix is the slug of `source`, so an identifier says what it names — a product seeded from
 * `"Aurora Desk Lamp"` is `prod_aurora-desk-lamp` — which is what keeps the seeded collections, the
 * order history and the test fixtures readable. It is a pure function of its arguments: no counter, no
 * clock and no randomness, so two passes over the same data build the same identifiers, which is the
 * determinism the seeded catalogue, the analytics and the tests rest on. Two sources that slugify
 * identically therefore produce the same identifier, so a caller needing distinct ids for such a pair —
 * the roughly 2,250 generated orders, for instance — numbers them with {@link sequenceId} instead.
 *
 * @param prefix - The identifier's prefix, with or without its trailing underscore: `"prod"` and
 *   `"prod_"` both yield a `prod_`-prefixed identifier.
 * @param source - The name, handle or other stable text the suffix is derived from; it may not be blank.
 * @returns The prefixed identifier, identical for identical arguments in every process.
 * @throws TypeError - When the prefix or the source is blank.
 */
export function prefixedId<TBrand extends string>(
  prefix: TBrand,
  source: string,
): Brand<string, PrefixedBrand<TBrand>> {
  if (source.trim() === "") throw new TypeError("An identifier source cannot be blank.");
  return `${prefixWithSeparator(prefix)}${readableSuffix(source)}` as Brand<
    string,
    PrefixedBrand<TBrand>
  >;
}

/**
 * Builds an identifier from a prefix and a caller-supplied index, padded to a fixed width.
 *
 * This is the generator for the collections produced in bulk rather than authored — the generated
 * orders, their lines and the daily facts built from them — where a name is not unique enough to key on
 * and the index is already the caller's own loop counter. Padding makes the identifiers sort and read in
 * order (`ord_0007` before `ord_0012`), and because the suffix is the index itself, a seed loop that runs
 * twice writes the same ids in the same order.
 *
 * @param prefix - The identifier's prefix, with or without its trailing underscore.
 * @param index - The whole number rendered as the suffix, 0 or more; a caller may number its first record
 *   1, which is how the product speaks about a first page.
 * @param width - The smallest number of digits to pad the index to, defaulting to 4; an index wider than
 *   its padding keeps every digit of its own.
 * @returns The prefixed identifier.
 * @throws TypeError - When the prefix is blank, `index` is not a whole number of 0 or more, or `width` is
 *   not a whole number of 1 or more.
 */
export function sequenceId<TBrand extends string>(
  prefix: TBrand,
  index: number,
  width: number = DEFAULT_SEQUENCE_WIDTH,
): Brand<string, PrefixedBrand<TBrand>> {
  const normalisedPrefix = prefixWithSeparator(prefix);
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(`sequenceId expects a whole index of 0 or more, received ${index}.`);
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new TypeError(`sequenceId expects a padding width of 1 or more, received ${width}.`);
  }
  return `${normalisedPrefix}${String(index).padStart(width, "0")}` as Brand<
    string,
    PrefixedBrand<TBrand>
  >;
}

/**
 * The per-entity generators below all delegate to {@link prefixedId}, so the suffix rule is stated once
 * above and every id a seed, a fixture or the transport mints follows it. Each names the text it is keyed
 * by and is deterministic in it, and each throws a `TypeError` for a blank source, as `prefixedId` does.
 */

/** The `prod_`-prefixed identifier for a product seeded, fixtured or imported from `source`'s name. */
export function productId(source: string): ProductId {
  return prefixedId("prod_", source);
}

/** The `cat_`-prefixed identifier for a category named by `source`, at either level of the tree. */
export function categoryId(source: string): CategoryId {
  return prefixedId("cat_", source);
}

/** The `brd_`-prefixed identifier for a brand named by `source`. */
export function brandId(source: string): BrandId {
  return prefixedId("brd_", source);
}

/**
 * The `cus_`-prefixed identifier for the account whose email address or name is `source`, suffixed with that
 * source's digest ({@link opaqueId}): every caller derives it from the email address and a customer identifier
 * travels in payloads anyone may read, so a readable suffix would publish the address itself.
 */
export function customerId(source: string): CustomerId {
  return opaqueId("cus_", HASH_DOMAIN_CUSTOMER, source);
}

/** The `adr_`-prefixed identifier for the address keyed by `source`, its owner and label together. */
export function addressId(source: string): AddressId {
  return prefixedId("adr_", source);
}

/** The `ord_`-prefixed identifier for the order keyed by `source`; the generated history numbers its
 * orders with {@link sequenceId} instead, because their names repeat. */
export function orderId(source: string): OrderId {
  return prefixedId("ord_", source);
}

/** The `line_`-prefixed identifier for a cart line, and for the order line built from it. */
export function cartLineId(source: string): LineId {
  return prefixedId("line_", source);
}

/** The `rev_`-prefixed identifier for the review keyed by `source`, its product and customer together. */
export function reviewId(source: string): ReviewId {
  return prefixedId("rev_", source);
}

/** The `prom_`-prefixed identifier for the promo code whose code is `source`. */
export function promoCodeId(source: string): PromoCodeId {
  return prefixedId("prom_", source);
}

/**
 * Mints an opaque session token from a source the sign-in path controls.
 *
 * The token carries the `ses_` prefix and discloses nothing else: its source — the issue marker the account store
 * draws from {@link randomHexText}, one per session it opens — is hashed rather than embedded, so a token cannot be
 * read to learn which account it belongs to or when it was issued, which is the opacity the session contract in
 * `src/types/account.ts` requires. The store mints each session's from fresh randomness, never from the account.
 *
 * @param source - The text the token is derived from; it may not be blank.
 * @returns The `ses_`-prefixed session token.
 * @throws TypeError - When the source is blank.
 */
export function sessionToken(source: string): SessionToken {
  if (source.trim() === "") throw new TypeError("A session token source cannot be blank.");
  return `${prefixWithSeparator("ses_")}${shortHash(HASH_DOMAIN_SESSION, source)}` as SessionToken;
}

/**
 * Mints the read credential this browser holds for an order it placed without an account.
 *
 * The read it authorises returns the buyer's own confirmation — the name, email address, telephone number and
 * delivery address that order carries — so the credential is unpredictable rather than derived: it comes from the
 * browser's random source and never from the submission's clock, counter or idempotency key, each of which a reader
 * of this repository could recompute. It is a bearer credential rather than an entity identifier, so no collection
 * holds one and `src/utils/orderPlacements.ts` is where one lives.
 *
 * @returns A fresh placement credential, prefixed `plc_`.
 */
export function placementToken(): string {
  return `${prefixWithSeparator("plc_")}${randomHexText()}`;
}

// Credential digest -----------------------------------------------------------------------------
// Demonstration only. This is an in-browser account store, not a security boundary: the salt and the
// hash below are a salted FNV-1a digest, they are never described as cryptographic, and a real
// deployment moves issue and verification behind the server `src/lib/apiClient.ts` is built to be
// repointed at. The helpers live here rather than in either caller because two layers need them —
// `src/data/customers.ts` when it seeds the 40 customers and 2 administrators, `src/lib/mockServer.ts`
// when it answers a sign-in — so a second copy would drift from this one.

/** The salt source a caller that names none is salted from; the seeds name an account's email instead. */
const DEFAULT_SALT_SOURCE = "salespro-demonstration-account";

/**
 * Derives an account's salt from a stable source its caller chooses — the seed passes the account's email
 * address — so every account has its own salt and two customers who chose the same password share no
 * hash. The derivation is deterministic, so a seeded digest can be recomputed rather than stored, and it
 * is domain-separated from the password digest, so no salt can collide with a hash of the same text.
 *
 * @param source - The text to derive the salt from; a blank value falls back to the default source.
 * @returns Sixteen lowercase hexadecimal characters.
 */
export function createSalt(source: string = DEFAULT_SALT_SOURCE): string {
  return shortHash(HASH_DOMAIN_SALT, source.trim() === "" ? DEFAULT_SALT_SOURCE : source);
}

/**
 * Builds the salted digest an account stores for its password, as `src/data/customers.ts` does when it
 * seeds the customer base and `src/lib/mockServer.ts` does when a registration creates an account.
 *
 * The password's policy — eight characters or more, with one letter and one digit — is a form rule owned
 * by `src/utils/validation.ts` and is deliberately not repeated here. The plain text exists only for the
 * length of this call: the digest holds the salt and the hash, and nothing else about the password.
 *
 * @param password - The password to digest; never stored in clear.
 * @param salt - The account's salt, derived from the default source when no other is supplied.
 * @returns The digest the account store persists.
 */
export function createCredentialDigest(
  password: string,
  salt: string = createSalt(),
): CredentialDigest {
  const resolvedSalt = salt.trim() === "" ? createSalt() : salt;
  return { salt: resolvedSalt, hash: digestHash(password, resolvedSalt) };
}

/**
 * Checks a password against a stored digest by recomputing the hash with the digest's own salt and
 * comparing the two in a single pass.
 *
 * A malformed digest — `null`, a string, an object missing its salt or its hash — returns `false` rather
 * than throwing, because the digest arrives from storage and storage is not trusted to hold the shape it
 * was given. No plain-text password is stored, returned or logged by this call.
 *
 * @param password - The password to check.
 * @param digest - The stored digest, typed `unknown` so a value read back from storage is validated
 *   rather than assumed.
 * @returns True when the password matches the digest, and false for anything else.
 */
export function verifyCredential(password: string, digest: unknown): boolean {
  if (!isCredentialDigest(digest)) return false;
  return hashesMatch(digestHash(password, digest.salt), digest.hash);
}

/**
 * Recomputes a digest's hash from a password and the salt that digest stores, domain-separated so a
 * password digest can never equal an identifier, a token or a salt.
 */
function digestHash(password: string, salt: string): string {
  return shortHash(HASH_DOMAIN_PASSWORD, `${salt}:${password}`);
}

/**
 * Seals a text with a secret its caller holds: the integrity value an item of durable state is written with, so
 * a record this browser did not write can be told from one it did. Demonstration-grade, like the credential
 * digest beside it: one FNV-1a digest over the secret and the sealed text, domain-separated so a seal can never
 * equal a password digest, a salt or an identifier, and never written beside the value it seals.
 *
 * @param secret - The secret the text is sealed with; it may not be blank.
 * @param value - The text to seal.
 * @returns Sixteen lowercase hexadecimal characters.
 * @throws TypeError - When the secret is blank: a seal with no secret proves nothing.
 */
export function keyedDigest(secret: string, value: string): string {
  if (secret.trim() === "") throw new TypeError("A seal secret cannot be blank.");
  return shortHash(HASH_DOMAIN_SEAL, `${secret}:${value}`);
}

/** Narrows a value read from storage to a digest whose salt and hash are both present and non-empty. */
function isCredentialDigest(value: unknown): value is CredentialDigest {
  if (typeof value !== "object" || value === null) return false;
  const { salt, hash } = value as { readonly salt?: unknown; readonly hash?: unknown };
  return typeof salt === "string" && salt !== "" && typeof hash === "string" && hash !== "";
}
