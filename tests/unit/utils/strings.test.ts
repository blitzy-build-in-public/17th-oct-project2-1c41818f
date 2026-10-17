/**
 * Path: tests/unit/utils/strings.test.ts
 * Purpose: The text, identifier-generator and credential-digest contracts of src/utils/strings.ts
 * Lines: 512
 */

import { describe, expect, it } from "vitest";

// The demonstration credential is read from the constant the seed data and the mock server read it
// from, so no password literal is written into a test. The module under test is imported as a
// namespace, as the sibling suites import theirs; every expectation below reads the contract its
// JSDoc states rather than its internals.
import { DEMO_ACCOUNTS } from "@/constants/config";
import * as strings from "@/utils/strings";

// Test data -------------------------------------------------------------------------------------

/** The text every identifier case is keyed by, so each generator's readable half is one shape. */
const SOURCE = "Aurora Desk Lamp";

/** The salt and the digest `src/data/customers.ts` seeds for the demonstration customer account:
 *  `createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, createSalt(email))`. */
const CUSTOMER_SALT = strings.createSalt(DEMO_ACCOUNTS.CUSTOMER_EMAIL);
const SEEDED_DIGEST = strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, CUSTOMER_SALT);

/** Values read back from storage that are not a digest at all. */
const NOT_A_DIGEST: { readonly label: string; readonly value: unknown }[] = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "a bare string", value: SEEDED_DIGEST.hash },
  { label: "a number", value: 42 },
  { label: "an empty object", value: {} },
  { label: "an array", value: [] },
];

/** Digests short of a member, and digests whose member is present but empty: both are malformed. */
const INCOMPLETE_DIGESTS: { readonly label: string; readonly value: unknown }[] = [
  { label: "a digest with no salt", value: { hash: SEEDED_DIGEST.hash } },
  { label: "a digest with no hash", value: { salt: SEEDED_DIGEST.salt } },
  { label: "a digest with an empty salt", value: { salt: "", hash: SEEDED_DIGEST.hash } },
  { label: "a digest with an empty hash", value: { salt: SEEDED_DIGEST.salt, hash: "" } },
];

/** Each generator that derives its suffix from a name, and the prefix it is documented to carry. */
type GeneratorCase = {
  readonly name: string;
  readonly generate: (source: string) => string;
  readonly prefix: string;
};
const GENERATORS: GeneratorCase[] = [
  { name: "productId", generate: strings.productId, prefix: "prod_" },
  { name: "categoryId", generate: strings.categoryId, prefix: "cat_" },
  { name: "brandId", generate: strings.brandId, prefix: "brd_" },
  { name: "customerId", generate: strings.customerId, prefix: "cus_" },
  { name: "addressId", generate: strings.addressId, prefix: "adr_" },
  { name: "orderId", generate: strings.orderId, prefix: "ord_" },
  { name: "cartLineId", generate: strings.cartLineId, prefix: "line_" },
  { name: "reviewId", generate: strings.reviewId, prefix: "rev_" },
  { name: "promoCodeId", generate: strings.promoCodeId, prefix: "prom_" },
];

/** Two names whose slugs share their first forty characters, so only the source hash can tell the
 *  identifiers apart. */
const LONG_NAME_A = "Supercalifragilisticexpialidocious Widget Alpha";
const LONG_NAME_B = "Supercalifragilisticexpialidocious Widget Beta";
/** The shape of an identifier cut at the readable maximum: 40 readable characters, none of them a
 *  hyphen at either end of the cut, then a hyphen and 8 characters of the source's hash. Stated
 *  once here because two expectations read it. */
const CUT_IDENTIFIER_PATTERN = /^prod_[a-z0-9](?:[a-z0-9-]{38}[a-z0-9])-[0-9a-f]{8}$/;

// Text ------------------------------------------------------------------------------------------

describe("normaliseWhitespace: every run of whitespace collapses to one space", () => {
  /** Text carrying the whitespace kinds a paste brings, and what the collapse gives back. */
  const CASES: { readonly input: string; readonly expected: string }[] = [
    { input: "  Aurora   Desk  Lamp ", expected: "Aurora Desk Lamp" },
    { input: "Aurora\tDesk\nLamp", expected: "Aurora Desk Lamp" },
    { input: "Aurora\u00a0Desk\u00a0Lamp", expected: "Aurora Desk Lamp" },
    { input: "Aurora\u2028Desk\u2029Lamp", expected: "Aurora Desk Lamp" },
    { input: "\u00a0 \t\n ", expected: "" },
    { input: "", expected: "" },
  ];

  it.each(CASES)("reads $input as $expected", ({ input, expected }) => {
    expect(strings.normaliseWhitespace(input)).toBe(expected);
  });
});

describe("slugify: a display string as the catalogue's URL slug", () => {
  /** Display strings and the slug each reduces to; the empty expectations are the cases holding
   *  nothing sluggable. */
  const CASES: { readonly input: string; readonly expected: string }[] = [
    { input: "Aurora Desk Lamp", expected: "aurora-desk-lamp" },
    { input: "  Bamboo   Desk Organiser  ", expected: "bamboo-desk-organiser" },
    { input: "Crème Brûlée Set", expected: "creme-brulee-set" },
    { input: "Ünïcôdé", expected: "unicode" },
    { input: "Of\uFB01ce Chair", expected: "office-chair" },
    { input: "Ａｕｒｏｒａ", expected: "aurora" },
    { input: "USB-C Hub", expected: "usb-c-hub" },
    { input: "100% Cotton", expected: "100-cotton" },
    { input: "--Aurora--", expected: "aurora" },
    { input: "C++ & C#", expected: "c-c" },
    { input: "!!! ???", expected: "" },
    { input: "Модель", expected: "" },
  ];

  it.each(CASES)("reads $input as $expected", ({ input, expected }) => {
    expect(strings.slugify(input)).toBe(expected);
  });

  it("keeps every result ASCII, lower case and free of edge or doubled hyphens", () => {
    for (const { input } of CASES) {
      expect(strings.slugify(input)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$|^$/);
    }
  });
});

describe("normaliseForMatch: the key two spellings of one text meet on", () => {
  /** Spellings of one text and the key each reduces to. */
  const CASES: { readonly input: string; readonly expected: string }[] = [
    { input: "  Aurora   Desk Lamp ", expected: "aurora desk lamp" },
    { input: "Crème Brûlée", expected: "creme brulee" },
    { input: "USB-C", expected: "usb c" },
    { input: "usb c", expected: "usb c" },
    { input: "A/B", expected: "a b" },
    { input: "12,99", expected: "12 99" },
    { input: "!!!", expected: "" },
  ];

  it.each(CASES)("reads $input as $expected", ({ input, expected }) => {
    expect(strings.normaliseForMatch(input)).toBe(expected);
  });

  it('reduces punctuation to a space rather than to nothing, so "USB-C" meets "usb c" but not "usbc"', () => {
    expect(strings.normaliseForMatch("USB-C")).toBe(strings.normaliseForMatch("usb c"));
    expect(strings.normaliseForMatch("USB-C")).not.toBe(strings.normaliseForMatch("usbc"));
  });
});

describe("toTitleCase: every word's first letter, the rest of the word untouched", () => {
  /** Headings and captions, and the title-cased line each renders as. */
  const CASES: { readonly input: string; readonly expected: string }[] = [
    { input: "USB-C hub", expected: "USB-C Hub" },
    { input: "aurora desk lamp", expected: "Aurora Desk Lamp" },
    { input: "  bamboo   organiser  ", expected: "Bamboo Organiser" },
    { input: "usb-c hub", expected: "Usb-C Hub" },
    { input: "wireless/corded mouse", expected: "Wireless/Corded Mouse" },
    { input: "the USB-C hub", expected: "The USB-C Hub" },
    { input: "100% cotton", expected: "100% Cotton" },
    { input: '"quoted" label', expected: '"quoted" Label' },
    { input: "élan vital", expected: "Élan Vital" },
    { input: "", expected: "" },
  ];

  it.each(CASES)("reads $input as $expected", ({ input, expected }) => {
    expect(strings.toTitleCase(input)).toBe(expected);
  });
});

describe("capitalise: the first letter of a value, and nothing else", () => {
  /** Stored values and labels, and the text each capitalises to. */
  const CASES: { readonly input: string; readonly expected: string }[] = [
    { input: "pending", expected: "Pending" },
    { input: "PENDING", expected: "PENDING" },
    { input: "pending status", expected: "Pending status" },
    { input: '"pending"', expected: '"Pending"' },
    { input: "[draft]", expected: "[Draft]" },
    { input: "123abc", expected: "123Abc" },
    { input: "123", expected: "123" },
    { input: "  pending  ", expected: "  Pending  " },
    { input: "émile", expected: "Émile" },
    { input: "!", expected: "!" },
    { input: "", expected: "" },
  ];

  it.each(CASES)("reads $input as $expected", ({ input, expected }) => {
    expect(strings.capitalise(input)).toBe(expected);
  });
});

describe("truncate: a value shortened to a display budget", () => {
  const NAME = "Aurora Desk Lamp";

  it("returns a value that already fits unchanged, with no ellipsis", () => {
    expect(strings.truncate(NAME, NAME.length)).toBe(NAME);
    expect(strings.truncate(NAME, 40)).toBe(NAME);
    // The budget counts the shopping cart emoji as one character, not as its two code units.
    expect(strings.truncate("🛒 Desk", 6)).toBe("🛒 Desk");
  });

  it("appends the ellipsis to a cut and drops the space the cut left dangling", () => {
    expect(strings.truncate(NAME, 12)).toBe("Aurora Desk…");
    expect(strings.truncate(NAME, 8)).toBe("Aurora…");
  });

  it("counts characters rather than code units, so a surrogate pair is never split", () => {
    const cut = strings.truncate("🛒🛒 Desk", 2);
    expect(cut).toBe("🛒…");
    expect(Array.from(cut)).toEqual(["🛒", "…"]);
  });

  it("keeps the ellipsis whole when the budget is shorter than it", () => {
    expect(strings.truncate(NAME, 0)).toBe("…");
    expect(strings.truncate(NAME, 1)).toBe("…");
    expect(strings.truncate(NAME, 3, "...")).toBe("...");
    expect(strings.truncate(NAME, 2, ">>>")).toBe(">>>");
  });

  it("honours a custom ellipsis and counts it against the budget", () => {
    expect(strings.truncate(NAME, 6, ">>")).toBe("Auro>>");
    expect(strings.truncate(NAME, 12, "->")).toBe("Aurora Des->");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a budget of %s",
    (maxLength) => {
      expect(() => strings.truncate(NAME, maxLength)).toThrow(TypeError);
      expect(() => strings.truncate(NAME, maxLength)).toThrow(/whole number of characters/);
    },
  );
});

describe("initials: the one or two letters an avatar shows", () => {
  /** Names in one field or two, and the initials each reduces to. */
  const CASES: { readonly first: string; readonly last: string; readonly expected: string }[] = [
    { first: "Dana", last: "Okafor", expected: "DO" },
    { first: "  Dana  ", last: " Okafor ", expected: "DO" },
    { first: "dana", last: "okafor", expected: "DO" },
    { first: "Dana Ada", last: "Okafor", expected: "DO" },
    { first: "Dana", last: "Ada Okafor", expected: "DO" },
    { first: "Dana", last: "", expected: "D" },
    { first: "émile", last: "Zola", expected: "ÉZ" },
    { first: "123", last: "456", expected: "" },
    { first: "!", last: "?", expected: "" },
    { first: "", last: "", expected: "" },
  ];

  it.each(CASES)('reads "$first" and "$last" as "$expected"', ({ first, last, expected }) => {
    expect(strings.initials(first, last)).toBe(expected);
  });

  it("reads one full name in a single field exactly as it reads two fields", () => {
    expect(strings.initials("Dana Okafor")).toBe(strings.initials("Dana", "Okafor"));
  });
});

// Identifiers -----------------------------------------------------------------------------------

describe("prefixedId: an identifier that says what it names", () => {
  it("derives the suffix from the source's slug", () => {
    expect(strings.prefixedId("prod", SOURCE)).toBe("prod_aurora-desk-lamp");
    expect(strings.prefixedId("cat", "Crème Brûlée")).toBe("cat_creme-brulee");
  });

  it("builds the same identifier on every call, in this process and any other", () => {
    const first = strings.prefixedId("prod", SOURCE);
    expect([0, 1, 2].map(() => strings.prefixedId("prod", SOURCE))).toEqual([first, first, first]);
  });

  it('treats "prod" and "prod_" as one prefix', () => {
    expect(strings.prefixedId("prod", SOURCE)).toBe(strings.prefixedId("prod_", SOURCE));
    expect(strings.prefixedId("prod_", SOURCE)).toBe("prod_aurora-desk-lamp");
  });

  it("gives two distinct sources distinct identifiers", () => {
    expect(strings.prefixedId("prod", SOURCE)).not.toBe(
      strings.prefixedId("prod", "Bamboo Desk Organiser"),
    );
  });

  it("cuts a slug past the readable maximum and disambiguates the cut", () => {
    const alpha = strings.prefixedId("prod", LONG_NAME_A);
    const beta = strings.prefixedId("prod", LONG_NAME_B);
    expect(alpha).toMatch(CUT_IDENTIFIER_PATTERN);
    expect(beta).toMatch(CUT_IDENTIFIER_PATTERN);
    // The two names share more than the readable maximum, so the readable halves are identical and
    // the source hash alone keeps the identifiers apart.
    expect(alpha.slice(0, 45)).toBe(beta.slice(0, 45));
    expect(alpha).not.toBe(beta);
  });

  it("falls back to the source's hash when nothing sluggable survives", () => {
    const punctuation = strings.prefixedId("prod", "!!! ???");
    expect(punctuation).toMatch(/^prod_[0-9a-f]{16}$/);
    expect(punctuation).not.toBe(strings.prefixedId("prod", "??? !!!"));
    // A script with no ASCII fold slugs to nothing as well, and takes the same fallback.
    expect(strings.prefixedId("prod", "Модель")).toMatch(/^prod_[0-9a-f]{16}$/);
  });

  it("rejects a blank prefix", () => {
    expect(() => strings.prefixedId("", SOURCE)).toThrow(TypeError);
    expect(() => strings.prefixedId("   ", SOURCE)).toThrow(/prefix cannot be blank/);
  });

  it("rejects a blank source", () => {
    expect(() => strings.prefixedId("prod", "")).toThrow(TypeError);
    expect(() => strings.prefixedId("prod", "   ")).toThrow(/source cannot be blank/);
  });
});

describe("sequenceId: an index padded to a fixed width", () => {
  it("pads the index to the documented width of four", () => {
    expect(strings.sequenceId("ord", 0)).toBe("ord_0000");
    expect(strings.sequenceId("ord", 7)).toBe("ord_0007");
  });

  it("keeps every digit of an index wider than its padding", () => {
    expect(strings.sequenceId("ord", 12_345)).toBe("ord_12345");
    expect(strings.sequenceId("ord", 7, 2)).toBe("ord_07");
    expect(strings.sequenceId("ord", 123, 2)).toBe("ord_123");
  });

  it("sorts in index order as strings", () => {
    // Nine and ten are the pair the padding exists for: as bare strings "10" would sort first.
    const indices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const identifiers = indices.map((index) => strings.sequenceId("ord", index));
    expect(new Set(identifiers).size).toBe(indices.length);
    expect([...identifiers].sort()).toEqual(identifiers);
  });

  it("builds the same identifier on every call and normalises the prefix as prefixedId does", () => {
    expect(strings.sequenceId("ord", 7)).toBe(strings.sequenceId("ord", 7));
    expect(strings.sequenceId("ord", 7)).toBe(strings.sequenceId("ord_", 7));
  });

  it("rejects a blank prefix", () => {
    expect(() => strings.sequenceId("", 7)).toThrow(/prefix cannot be blank/);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects an index of %s", (index) => {
    expect(() => strings.sequenceId("ord", index)).toThrow(TypeError);
    expect(() => strings.sequenceId("ord", index)).toThrow(/whole index of 0 or more/);
  });

  it.each([0, -2, 1.5, Number.NaN])("rejects a padding width of %s", (width) => {
    expect(() => strings.sequenceId("ord", 7, width)).toThrow(TypeError);
    expect(() => strings.sequenceId("ord", 7, width)).toThrow(/padding width of 1 or more/);
  });
});

describe("the per-entity generators: one documented prefix each", () => {
  it.each(GENERATORS)(
    "$name carries the $prefix prefix before the source's slug",
    ({ generate, prefix }) => {
      expect(generate(SOURCE)).toBe(`${prefix}aurora-desk-lamp`);
    },
  );

  it.each(GENERATORS)("$name rejects a blank source", ({ generate }) => {
    expect(() => generate("   ")).toThrow(TypeError);
  });
});

describe("sessionToken: an opaque token that discloses nothing", () => {
  const ACCOUNT = strings.customerId(DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  const SOURCE_TEXT = `${ACCOUNT}:2026-04-01T00:00:00.000Z:customer`;

  it("is the documented prefix and sixteen lowercase hexadecimal characters", () => {
    expect(strings.sessionToken(SOURCE_TEXT)).toMatch(/^ses_[0-9a-f]{16}$/);
    expect(strings.sessionToken(SOURCE_TEXT)).toHaveLength(20);
  });

  it("carries neither the source nor the account, the role or the issue marker", () => {
    const token = strings.sessionToken(SOURCE_TEXT);
    for (const part of [SOURCE_TEXT, ACCOUNT, "shopper", "salespro", "customer"]) {
      expect(token).not.toContain(part);
    }
  });

  it("builds the same token for one source and different tokens for two", () => {
    expect(strings.sessionToken(SOURCE_TEXT)).toBe(strings.sessionToken(SOURCE_TEXT));
    expect(strings.sessionToken(SOURCE_TEXT)).not.toBe(
      strings.sessionToken(`${ACCOUNT}:2026-04-02T00:00:00.000Z:customer`),
    );
  });

  it("rejects a blank source", () => {
    expect(() => strings.sessionToken("")).toThrow(TypeError);
    expect(() => strings.sessionToken("  ")).toThrow(/session token source cannot be blank/);
  });
});

// Credential digest -----------------------------------------------------------------------------
// Demonstration only, as `src/utils/strings.ts` states: these are the helpers that decide every
// seeded account's sign-in, and what they promise is a round trip and a refusal, never secrecy.

describe("createSalt: an account's salt, derived from a stable source", () => {
  it("is sixteen lowercase hexadecimal characters", () => {
    expect(CUSTOMER_SALT).toMatch(/^[0-9a-f]{16}$/);
    expect(strings.createSalt()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is identical for one source and different for two accounts", () => {
    expect(strings.createSalt(DEMO_ACCOUNTS.CUSTOMER_EMAIL)).toBe(CUSTOMER_SALT);
    expect(strings.createSalt(DEMO_ACCOUNTS.CUSTOMER_EMAIL)).not.toBe(
      strings.createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL),
    );
  });

  it("falls back to the documented default source when its caller supplies a blank one", () => {
    expect(strings.createSalt("")).toBe(strings.createSalt());
    expect(strings.createSalt("   ")).toBe(strings.createSalt());
  });

  it("is domain-separated from the password and identifier digests of the same text", () => {
    expect(strings.createSalt(DEMO_ACCOUNTS.PASSWORD)).not.toBe(SEEDED_DIGEST.hash);
    const fallback = strings.prefixedId("prod", "!!! ???").slice("prod_".length);
    expect(strings.createSalt("!!! ???")).not.toBe(fallback);
  });
});

describe("createCredentialDigest: the salted digest the account store keeps", () => {
  it("holds exactly a salt and a sixteen-character hexadecimal hash", () => {
    expect(Object.keys(SEEDED_DIGEST).sort()).toEqual(["hash", "salt"]);
    expect(SEEDED_DIGEST.salt).toBe(CUSTOMER_SALT);
    expect(SEEDED_DIGEST.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("salts from the default source when its caller names none", () => {
    expect(strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD).salt).toBe(strings.createSalt());
    expect(strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD)).toEqual(
      strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, strings.createSalt()),
    );
    // A salt that carries no account separation is no salt: an empty one takes the default too.
    expect(strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, "")).toEqual(
      strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD),
    );
  });

  it("builds the same digest for the same password and salt on every call", () => {
    expect(strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD, CUSTOMER_SALT)).toEqual(
      SEEDED_DIGEST,
    );
  });

  it("gives two accounts that share one password different hashes", () => {
    const admin = strings.createCredentialDigest(
      DEMO_ACCOUNTS.PASSWORD,
      strings.createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL),
    );
    expect(admin.salt).not.toBe(CUSTOMER_SALT);
    expect(admin.hash).not.toBe(SEEDED_DIGEST.hash);
  });

  it("gives two passwords under one salt different hashes", () => {
    expect(
      strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD.toUpperCase(), CUSTOMER_SALT).hash,
    ).not.toBe(SEEDED_DIGEST.hash);
  });

  it("keeps the password out of every member of the digest", () => {
    // The second password is hexadecimal throughout on purpose: it is the one shape an embedded
    // plain text could actually be spotted in, so that case can fail where the first cannot.
    for (const password of [DEMO_ACCOUNTS.PASSWORD, "baddcafe"]) {
      const digest = strings.createCredentialDigest(password, CUSTOMER_SALT);
      expect(digest.hash).not.toBe(password);
      expect(digest.salt).not.toContain(password);
      expect(digest.hash).not.toContain(password);
    }
  });
});

describe("verifyCredential: the decision every sign-in rests on", () => {
  it("accepts the password the digest was built from, under an account salt or the default one", () => {
    expect(strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD, SEEDED_DIGEST)).toBe(true);
    expect(
      strings.verifyCredential(
        DEMO_ACCOUNTS.PASSWORD,
        strings.createCredentialDigest(DEMO_ACCOUNTS.PASSWORD),
      ),
    ).toBe(true);
    const admin = strings.createCredentialDigest(
      DEMO_ACCOUNTS.PASSWORD,
      strings.createSalt(DEMO_ACCOUNTS.ADMIN_EMAIL),
    );
    expect(strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD, admin)).toBe(true);
  });

  it("rejects every other password", () => {
    expect(strings.verifyCredential(`${DEMO_ACCOUNTS.PASSWORD} `, SEEDED_DIGEST)).toBe(false);
    expect(strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD.toLowerCase(), SEEDED_DIGEST)).toBe(
      false,
    );
    expect(strings.verifyCredential(DEMO_ACCOUNTS.CUSTOMER_EMAIL, SEEDED_DIGEST)).toBe(false);
    expect(strings.verifyCredential("", SEEDED_DIGEST)).toBe(false);
  });

  it.each(NOT_A_DIGEST)("returns false for $label rather than throwing", ({ value }) => {
    expect(strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD, value)).toBe(false);
  });

  it.each(INCOMPLETE_DIGESTS)("returns false for $label", ({ value }) => {
    expect(strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD, value)).toBe(false);
  });

  it("returns false for a digest whose hash was tampered with while its salt stayed intact", () => {
    const first = SEEDED_DIGEST.hash.startsWith("0") ? "1" : "0";
    const tampered = `${first}${SEEDED_DIGEST.hash.slice(1)}`;
    expect(tampered).not.toBe(SEEDED_DIGEST.hash);
    expect(
      strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD, { salt: CUSTOMER_SALT, hash: tampered }),
    ).toBe(false);
  });

  it("returns false for a digest whose hash is one character short", () => {
    const truncated = SEEDED_DIGEST.hash.slice(0, -1);
    expect(truncated).toHaveLength(15);
    expect(
      strings.verifyCredential(DEMO_ACCOUNTS.PASSWORD, { salt: CUSTOMER_SALT, hash: truncated }),
    ).toBe(false);
  });
});
