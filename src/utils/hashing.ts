/**
 * Path: src/utils/hashing.ts
 * Purpose: The digest arithmetic every identifier, token, salt, password digest and seal is built on: the domain separators, the FNV-1a core and the constant-time comparison
 * Lines: 88
 */

// One home for the demonstration-grade arithmetic rather than a second implementation of it. This module is a
// section 0.5.5 split of `src/utils/strings.ts`, taken because that file publishes the identifier generators, the
// random source and the credential digest and could not hold this section beside them inside the 600-line ceiling.
// Nothing here is described as cryptography: the arithmetic is FNV-1a, `src/utils/strings.ts` builds the product's
// identifiers, tokens and digests on it, and each caller states what its own demonstration-grade meaning is.

// Domains ---------------------------------------------------------------------------------------

/** Domain separators: one text hashes differently in each role it is used for, so no value a product derives can
 * collide with another value derived from the same text. */
export const HASH_DOMAIN_IDENTIFIER = "identifier";
export const HASH_DOMAIN_CUSTOMER = "customer";
export const HASH_DOMAIN_SESSION = "session";
export const HASH_DOMAIN_SEAL = "seal";
export const HASH_DOMAIN_SALT = "salt";
export const HASH_DOMAIN_PASSWORD = "password";

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Hashes one text with FNV-1a over its code units and returns the 32-bit result unsigned.
 *
 * `Math.imul` is what keeps the multiplication inside 32 bits: a plain `*` would exceed the range a JavaScript
 * number represents exactly, and every digest would then depend on floating-point rounding. Hashing code units
 * rather than code points keeps the function allocation-free, which matters because the seed generators run it
 * tens of thousands of times.
 *
 * @param value - The text to hash.
 * @returns The hash as an unsigned 32-bit integer.
 */
function fnv1a32(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Renders a 32-bit hash as exactly eight lowercase hexadecimal characters, so a digest assembled from two of them
 * always has the same length.
 *
 * @param hash - An unsigned 32-bit value.
 * @returns Its eight-character hexadecimal form.
 */
function toHex32(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}

/**
 * Digests a domain and a value into 16 hexadecimal characters — 64 bits, from two FNV-1a passes over pass- and
 * domain-separated inputs — so a disambiguator, a session token, a salt and a password digest each get a
 * full-width result and the same text hashes differently in each role.
 *
 * @param domain - What the value is being hashed for.
 * @param value - The text to hash.
 * @returns Sixteen lowercase hexadecimal characters, identical for identical arguments.
 */
export function shortHash(domain: string, value: string): string {
  const seed = `${domain}:${value}`;
  return `${toHex32(fnv1a32(`1:${seed}`))}${toHex32(fnv1a32(`2:${seed}`))}`;
}

/**
 * Compares two hash strings in a single pass that does not stop at the first differing character, and rejects a
 * length mismatch up front because the length of a recomputed digest is not a secret.
 *
 * @param left - The hash recomputed from the supplied password.
 * @param right - The hash the stored digest holds.
 * @returns True when the two are equal.
 */
export function hashesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
