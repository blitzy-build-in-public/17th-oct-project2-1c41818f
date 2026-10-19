/**
 * Path: tests/unit/data/taxonomyBranches.test.ts
 * Purpose: The country vocabulary's own reading rule: the configured label a stored code resolves to, whatever case and space it arrives with, and the code itself for one the configured set does not carry
 * Lines: 36
 */

import { describe, expect, it } from "vitest";

import { SUPPORTED_COUNTRIES, countryLabel } from "@/constants/taxonomy";

// The subject is the one function `src/constants/taxonomy.ts` derives a display name with. The code reaches
// it from a stored address rather than from the select that wrote it, so the cases drive the rule directly
// and assert both answers: the label of a configured country, and the code itself for one the set does not
// carry, which is what keeps an address entered before a country left the list readable.

describe("the name a stored country code reads as", () => {
  it.each<[label: string, code: string, expected: string]>([
    ["a code as the vocabulary spells it", "US", "United States"],
    ["a code in another case", "us", "United States"],
    ["a code with space around it", "  gb  ", "United Kingdom"],
    ["a code the set does not carry", "ZZ", "ZZ"],
    ["a code no set could carry, because it is empty", "", ""],
  ])("reads %s", (_label, code, expected) => {
    expect(countryLabel(code)).toBe(expected);
  });

  it("reads every configured country by its own declared label", () => {
    for (const country of SUPPORTED_COUNTRIES) {
      expect(countryLabel(country.code)).toBe(country.label);
      // The rule ignores case and surrounding space, so a stored spelling of a configured code resolves to
      // the same name rather than falling through to the code itself.
      expect(countryLabel(` ${country.code.toLowerCase()} `)).toBe(country.label);
    }
    expect(SUPPORTED_COUNTRIES.length).toBeGreaterThan(0);
  });
});
