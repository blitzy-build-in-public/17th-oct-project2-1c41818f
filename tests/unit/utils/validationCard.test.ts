/**
 * Path: tests/unit/utils/validationCard.test.ts
 * Purpose: The card number, expiry and security-code rules of src/utils/validation.ts, and the Luhn check they rest on
 * Lines: 141
 */

// Split out of tests/unit/utils/validation.test.ts when that suite reached the request's 600-line ceiling
// (§0.5.5: a concern that no longer fits is split into a second file, and the ceiling is never raised). It
// is a pure-function suite like its sibling: it runs in the node project, reaches no DOM, mocks no module and
// touches no storage, so every assertion observes a returned error map rather than an internal.
import { describe, expect, it } from "vitest";

import { VALIDATION_MESSAGES } from "@/constants/content";
import type { FieldErrors } from "@/types/common";
import {
  isLuhnValid,
  validateCardExpiry,
  validateCardNumber,
  validateCvc,
  type CardExpiryInput,
} from "@/utils/validation";

import { FIXED_NOW } from "../../fixtures";

/** The instant the expiry rule is measured against. It takes `now` as an argument, so the suite pins no
 * timer and reads no wall clock. */
const NOW = new Date(FIXED_NOW);
const CURRENT_MONTH = NOW.getMonth() + 1;
const CURRENT_YEAR = NOW.getFullYear();
const NEXT_YEAR = CURRENT_YEAR + 1;
/** The month before `NOW`'s, built through the Date constructor so a January boundary wraps to the
 * previous December rather than to month zero. */
const PREVIOUS_MONTH = new Date(CURRENT_YEAR, NOW.getMonth() - 1, 1);

describe("card rules", () => {
  it("accepts the standard test card numbers", () => {
    expect(isLuhnValid("4242424242424242")).toBe(true);
    expect(isLuhnValid("4012888888881881")).toBe(true);
  });

  it("fails a mutated number, an empty one, a non-digit and a value that is not a string", () => {
    expect(isLuhnValid("4242424242424241")).toBe(false);
    expect(isLuhnValid("4242 4242 4242 4242")).toBe(false);
    expect(isLuhnValid("")).toBe(false);
    expect(isLuhnValid(undefined as unknown as string)).toBe(false);
  });

  it("accepts a card number at each end of the documented thirteen to nineteen digits", () => {
    expect(validateCardNumber("4222222222222")).toEqual({});
    expect(validateCardNumber("4000000000000000006")).toEqual({});
    expect(validateCardNumber("4242 4242 4242 4242")).toEqual({});
    expect(validateCardNumber("4242-4242-4242-4242")).toEqual({});
  });

  it("rejects a card number whose digits are all the same, which the Luhn check alone accepts", () => {
    for (const repeated of [
      "0000000000000000",
      "8888888888888888",
      "0".repeat(13),
      "0".repeat(19),
      "0000 0000 0000 0000",
    ]) {
      expect(validateCardNumber(repeated)).toEqual({ number: VALIDATION_MESSAGES.CARD_NUMBER });
    }
  });

  it("rejects a card number of the wrong length, a wrong check digit or a non-numeric one", () => {
    for (const rejected of ["424242424242", "42424242424242424242", "4242424242424241", "4242x"]) {
      expect(validateCardNumber(rejected)).toEqual({ number: VALIDATION_MESSAGES.CARD_NUMBER });
    }
    expect(validateCardNumber("")).toEqual({ number: VALIDATION_MESSAGES.REQUIRED });
  });

  it("accepts a card expiring in the month it is used or later", () => {
    expect(
      validateCardExpiry({ expiryMonth: CURRENT_MONTH, expiryYear: CURRENT_YEAR }, NOW),
    ).toEqual({});
    expect(validateCardExpiry({ expiryMonth: CURRENT_MONTH, expiryYear: NEXT_YEAR }, NOW)).toEqual(
      {},
    );
  });

  it("files each expiry half on its own control, and both when neither holds a value", () => {
    const rejected: readonly (readonly [Partial<CardExpiryInput> | undefined, FieldErrors])[] = [
      // Nothing entered in either half: both are missing, so both are named.
      [
        undefined,
        { expiryMonth: VALIDATION_MESSAGES.REQUIRED, expiryYear: VALIDATION_MESSAGES.REQUIRED },
      ],
      [{}, { expiryMonth: VALIDATION_MESSAGES.REQUIRED, expiryYear: VALIDATION_MESSAGES.REQUIRED }],
      [
        { expiryMonth: "", expiryYear: "" },
        { expiryMonth: VALIDATION_MESSAGES.REQUIRED, expiryYear: VALIDATION_MESSAGES.REQUIRED },
      ],
      // One half blank while the other is acceptable: the blank one is the fault.
      [{ expiryYear: NEXT_YEAR }, { expiryMonth: VALIDATION_MESSAGES.REQUIRED }],
      [{ expiryMonth: CURRENT_MONTH }, { expiryYear: VALIDATION_MESSAGES.REQUIRED }],
      // A half holding something the rule cannot read: impossible, or not a number at all.
      [
        { expiryMonth: 0, expiryYear: CURRENT_YEAR },
        { expiryMonth: VALIDATION_MESSAGES.CARD_EXPIRY },
      ],
      [
        { expiryMonth: 13, expiryYear: CURRENT_YEAR },
        { expiryMonth: VALIDATION_MESSAGES.CARD_EXPIRY },
      ],
      [
        { expiryMonth: "x", expiryYear: NEXT_YEAR },
        { expiryMonth: VALIDATION_MESSAGES.CARD_EXPIRY },
      ],
      [
        { expiryMonth: CURRENT_MONTH, expiryYear: 1999 },
        { expiryYear: VALIDATION_MESSAGES.CARD_EXPIRY },
      ],
      [
        { expiryMonth: CURRENT_MONTH, expiryYear: "x" },
        { expiryYear: VALIDATION_MESSAGES.CARD_EXPIRY },
      ],
      // Readable but passed: the year's complaint, the coarser half a correction changes.
      [
        { expiryMonth: PREVIOUS_MONTH.getMonth() + 1, expiryYear: PREVIOUS_MONTH.getFullYear() },
        { expiryYear: VALIDATION_MESSAGES.CARD_EXPIRY },
      ],
    ];
    for (const [pair, expected] of rejected) {
      expect(validateCardExpiry(pair, NOW)).toEqual(expected);
    }
  });

  it("accepts a three or four digit security code", () => {
    expect(validateCvc("123")).toEqual({});
    expect(validateCvc("1234")).toEqual({});
  });

  it("rejects a security code that is too short, too long or not numeric", () => {
    for (const rejected of ["12", "12345", "12a", " 1 2"]) {
      expect(validateCvc(rejected)).toEqual({ cvc: VALIDATION_MESSAGES.CARD_SECURITY_CODE });
    }
    expect(validateCvc("")).toEqual({ cvc: VALIDATION_MESSAGES.REQUIRED });
  });
});
