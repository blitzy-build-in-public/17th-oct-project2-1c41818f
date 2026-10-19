/**
 * Path: src/utils/credentials.ts
 * Purpose: The demonstration credential digest the seed data and the sign-in path both call — salt, hash and verify — and the seal an item of durable state is written with
 * Lines: 114
 */

// One home for the credential digest and the seal rather than a second copy of them. This module is a section
// 0.5.5 split of `src/utils/strings.ts`, taken because that file's text and identifier helpers and this
// concern together pass the 600-line ceiling, which is never raised; `src/utils/strings.ts` re-exports the
// members below, so every consumer keeps the path it imported them from and there is no second implementation
// of the digest. The arithmetic is the demonstration-grade FNV-1a of `src/utils/hashing.ts`, and nothing here
// is described as cryptography.

import type { CredentialDigest } from "@/types/account";
import {
  HASH_DOMAIN_PASSWORD,
  HASH_DOMAIN_SALT,
  HASH_DOMAIN_SEAL,
  hashesMatch,
  shortHash,
} from "@/utils/hashing";

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
