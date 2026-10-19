/**
 * Path: tests/unit/utils/validation.test.ts
 * Purpose: Each validator's accept and reject cases, and the form-level error maps
 * Lines: 559
 */

// A pure-function suite: it runs in the node project, reaches no DOM, mocks no module and touches no
// storage, so every assertion observes a returned error map rather than an internal.
import { describe, expect, it } from "vitest";

import { MAX_REPORT_RANGE_DAYS, PASSWORD_POLICY, SHIPPING_METHODS } from "@/constants/config";
import {
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
  nameLengthMessage,
  postalCodeFormatMessage,
  promoCodeLengthMessage,
  quantityRangeMessage,
  reviewBodyTooLongMessage,
  reviewBodyTooShortMessage,
  reviewTitleTooLongMessage,
  reviewTitleTooShortMessage,
} from "@/constants/content";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import type { FieldErrors } from "@/types/common";
import { addDays, validateDateRange } from "@/utils/dates";
import {
  FORM_ERROR_KEY,
  FREE_TEXT_LIMITS,
  NAME_MAX_LENGTH,
  PROMO_CODE_MAX_LENGTH,
  PROMO_CODE_MIN_LENGTH,
  REVIEW_LIMITS,
  clearFieldError,
  fieldErrored,
  fieldErrorsFromApiError,
  fieldErrorsFromResult,
  firstError,
  hasErrors,
  isRatingValue,
  mergeErrors,
  validateAddress,
  validateEmail,
  validateName,
  validatePassword,
  validatePayment,
  validatePhone,
  validatePostalCode,
  validateProfileUpdate,
  validatePromoCodeShape,
  validateQuantity,
  validateRating,
  validateRegistration,
  validateRequired,
  validateReview,
  validateReviewBody,
  validateReviewTitle,
  validateSearchTerm,
  validateShippingSubmission,
  validateSignIn,
  type CardValidationInput,
} from "@/utils/validation";
import { FIXED_DATE, FIXED_LATER_DATE, FIXED_NOW, makeApiError } from "../../fixtures";

/** The instant the time-dependent rules are measured against. Each takes `now` as an argument, so
 * the suite pins no timer and reads no wall clock. */
const NOW = new Date(FIXED_NOW);
const CURRENT_MONTH = NOW.getMonth() + 1;
const CURRENT_YEAR = NOW.getFullYear();
const NEXT_YEAR = CURRENT_YEAR + 1;
/** The month before `NOW`'s, built through the Date constructor so a January boundary wraps to the
 * previous December rather than to month zero. */
const PREVIOUS_MONTH = new Date(CURRENT_YEAR, NOW.getMonth() - 1, 1);
/** A password exactly at the configured minimum, holding a letter and a digit, and the same
 * password one character shorter: the two sides of the policy's length rule. */
const MINIMUM_PASSWORD = `a1${"x".repeat(PASSWORD_POLICY.MIN_LENGTH - 2)}`;
const SHORT_PASSWORD = MINIMUM_PASSWORD.slice(0, -1);
/** The country the sample address is entered in, and a complete address in it carrying every member
 * of `AddressInput`; the cases below remove one member or mistype one. */
const US = SUPPORTED_COUNTRIES.find((country) => country.code === "US") ?? SUPPORTED_COUNTRIES[0];
const VALID_ADDRESS = {
  label: "Home",
  fullName: "Dana Okafor",
  line1: "1120 NW Marshall St",
  line2: "",
  city: "Portland",
  region: "OR",
  postalCode: "97205",
  country: US.code,
  phone: "",
} as const;
/** A card in good standing: a number with a correct check digit and an expiry a year ahead. */
const VALID_CARD = {
  number: "4242424242424242",
  nameOnCard: "Dana Okafor",
  expiryMonth: CURRENT_MONTH,
  expiryYear: NEXT_YEAR,
  cvc: "123",
};
/** One malformed card member, the message it breaks and the payment-form control it is filed against. */
const CARD_FAILURES: readonly (readonly [string, Partial<CardValidationInput>, string])[] = [
  ["number", { number: "4242424242424241" }, VALIDATION_MESSAGES.CARD_NUMBER],
  ["nameOnCard", { nameOnCard: "" }, VALIDATION_MESSAGES.REQUIRED],
  ["expiryMonth", { expiryMonth: 13 }, VALIDATION_MESSAGES.CARD_EXPIRY],
  ["expiryYear", { expiryYear: "" }, VALIDATION_MESSAGES.REQUIRED],
  ["cvc", { cvc: "12" }, VALIDATION_MESSAGES.CARD_SECURITY_CODE],
];

/** The two properties every map-returning validator keeps: it holds exactly the named fields, each
 * carrying a sentence, and it is keyed by the field names the forms bind their controls to. */
function expectRejectedWith(errors: FieldErrors, fields: readonly string[]): void {
  expect(Object.keys(errors).sort()).toEqual([...fields].sort());
  expect(Object.values(errors).every((message) => message.length > 0)).toBe(true);
}

describe("field rules", () => {
  it("accepts a well-formed email address, keyed empty", () => {
    expect(validateEmail("dana.okafor@example.com")).toEqual({});
    expect(validateEmail("dana+orders@mail.example.co.uk")).toEqual({});
  });

  it("reports an absent email as missing and every malformed shape as misformatted", () => {
    expect(validateEmail("   ")).toEqual({ email: VALIDATION_MESSAGES.REQUIRED });
    for (const malformed of [
      "dana.okafor.example.com",
      "dana@@example.com",
      "dana@example",
      "dana okafor@example.com",
      "@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(validateEmail(malformed)).toEqual({ email: VALIDATION_MESSAGES.EMAIL_FORMAT });
    }
  });

  it("accepts a password of exactly the policy's minimum length", () => {
    expect(validatePassword(MINIMUM_PASSWORD)).toEqual({});
  });

  it("rejects a password that is short, letters only or digits only", () => {
    for (const rejected of [
      SHORT_PASSWORD,
      "a".repeat(PASSWORD_POLICY.MIN_LENGTH),
      "1".repeat(PASSWORD_POLICY.MIN_LENGTH),
    ]) {
      expect(validatePassword(rejected)).toEqual({ password: VALIDATION_MESSAGES.PASSWORD_POLICY });
    }
    expect(validatePassword("")).toEqual({ password: VALIDATION_MESSAGES.REQUIRED });
  });

  it("keys a required control and an optional phone number by the member name they judge", () => {
    expect(validateRequired("city", "  ")).toEqual({ city: VALIDATION_MESSAGES.REQUIRED });
    expect(validateRequired("line1", "1120 NW Marshall St")).toEqual({});
    expect(validatePhone("+1 (503) 555-0134")).toEqual({});
    expect(validatePhone("")).toEqual({});
    expect(validatePhone("503")).toEqual({ phone: VALIDATION_MESSAGES.PHONE_FORMAT });
  });

  it("accepts a name at each end of its bounds, judged for the control it is given", () => {
    expect(validateName("firstName", "Da")).toEqual({});
    expect(validateName("fullName", "x".repeat(NAME_MAX_LENGTH))).toEqual({});
    expect(validateName("nameOnCard", "Dana Okafor")).toEqual({});
  });

  it("rejects a name one character past the ceiling, keyed by the control it was given", () => {
    const oversized = "x".repeat(NAME_MAX_LENGTH + 1);
    const message = nameLengthMessage(NAME_MAX_LENGTH);
    expect(validateName("firstName", oversized)).toEqual({ firstName: message });
    expect(validateName("lastName", oversized)).toEqual({ lastName: message });
  });

  it("keeps the caller's sentence for a name too short or holding no letter", () => {
    expect(validateName("fullName", "1")).toEqual({ fullName: VALIDATION_MESSAGES.REQUIRED });
    expect(validateName("firstName", "", "Enter your first name.")).toEqual({
      firstName: "Enter your first name.",
    });
    expect(validateName("firstName", "Dana", "Enter your first name.")).toEqual({});
  });

  it("refuses a name carrying a control character, which no control could display", () => {
    for (const refused of ["Ctrl\u0000Name\nLine", "Dana\tOkafor", "Dana\u007f"]) {
      expect(validateName("firstName", refused)).toEqual({
        firstName: VALIDATION_MESSAGES.CONTROL_CHARACTERS,
      });
    }
  });

  it("judges the search term by the free-text rule, keyed by the parameter it travels under", () => {
    expect(validateSearchTerm("waxed jacket")).toEqual({});
    expect(validateSearchTerm("")).toEqual({});
    expect(validateSearchTerm("j\u0000acket")).toEqual({
      q: VALIDATION_MESSAGES.CONTROL_CHARACTERS,
    });
    expect(validateSearchTerm("x".repeat(FREE_TEXT_LIMITS.SEARCH_TERM_MAX + 1))).toEqual({
      q: nameLengthMessage(FREE_TEXT_LIMITS.SEARCH_TERM_MAX),
    });
  });

  it("accepts a quantity at the lower bound and at the caller's ceiling, typed or numeric", () => {
    expect(validateQuantity(1, 4)).toEqual({});
    expect(validateQuantity(4, 4)).toEqual({});
    expect(validateQuantity("3", 4)).toEqual({});
  });

  it("rejects a quantity outside one to the ceiling, naming that ceiling", () => {
    for (const rejected of [0, -2, 1.5, Number.POSITIVE_INFINITY, 5, "", "many"]) {
      expect(validateQuantity(rejected, 4)).toEqual({ quantity: quantityRangeMessage(4) });
    }
    expect(validateQuantity(2, 1)).toEqual({ quantity: quantityRangeMessage(1) });
  });

  it("accepts a complete address whose postal code matches its country", () => {
    expect(validateAddress(VALID_ADDRESS)).toEqual({});
  });

  it("rejects an address missing a required member, keyed by that member alone", () => {
    for (const field of ["fullName", "line1", "city", "region", "postalCode", "country"]) {
      expectRejectedWith(validateAddress({ ...VALID_ADDRESS, [field]: "" }), [field]);
    }
  });

  it("refuses a control character in a free-text address field", () => {
    expect(validateAddress({ ...VALID_ADDRESS, line1: "1120 NW\u0000 Marshall" })).toEqual({
      line1: VALIDATION_MESSAGES.CONTROL_CHARACTERS,
    });
    expect(validateAddress({ ...VALID_ADDRESS, city: "Port\nland" })).toEqual({
      city: VALIDATION_MESSAGES.CONTROL_CHARACTERS,
    });
    expect(validateAddress({ ...VALID_ADDRESS, label: "Ho\u0000me" })).toEqual({
      label: VALIDATION_MESSAGES.CONTROL_CHARACTERS,
    });
  });

  it("refuses a free-text address field past the bound its own control declares", () => {
    const past = (limit: number): string => "x".repeat(limit + 1);
    expect(validateAddress({ ...VALID_ADDRESS, line1: past(FREE_TEXT_LIMITS.LINE_MAX) })).toEqual({
      line1: nameLengthMessage(FREE_TEXT_LIMITS.LINE_MAX),
    });
    expect(validateAddress({ ...VALID_ADDRESS, label: past(FREE_TEXT_LIMITS.LABEL_MAX) })).toEqual({
      label: nameLengthMessage(FREE_TEXT_LIMITS.LABEL_MAX),
    });
  });

  it("rejects a postal code that does not match the pattern its country declares", () => {
    const errors = validateAddress({ ...VALID_ADDRESS, postalCode: "97" });
    expectRejectedWith(errors, ["postalCode"]);
    expect(errors.postalCode).toBe(postalCodeFormatMessage(US.label));
  });

  it("reports every configured country's own pattern, so one added to the taxonomy is judged too", () => {
    for (const country of SUPPORTED_COUNTRIES) {
      expect(validatePostalCode("!!", country.code)).toEqual({
        postalCode: postalCodeFormatMessage(country.label),
      });
    }
  });

  it("rejects an unsupported country and leaves the postal pattern unjudged behind it", () => {
    expectRejectedWith(validateAddress({ ...VALID_ADDRESS, country: "ZZ" }), ["country"]);
    expect(validatePostalCode(VALID_ADDRESS.postalCode, "ZZ")).toEqual({});
  });

  it("judges the optional phone number only once one is typed", () => {
    expect(validateAddress({ ...VALID_ADDRESS, phone: "503" })).toEqual({
      phone: VALIDATION_MESSAGES.PHONE_FORMAT,
    });
    expect(validateAddress({ ...VALID_ADDRESS, phone: "+1 (503) 555-0134" })).toEqual({});
  });

  it("accepts every whole rating from one to five, numeric or typed", () => {
    for (const rating of [1, 2, 3, 4, 5, "5"]) expect(validateRating(rating)).toEqual({});
  });

  it.each([
    [undefined, VALIDATION_MESSAGES.REQUIRED],
    ["", VALIDATION_MESSAGES.REQUIRED],
    [0, VALIDATION_MESSAGES.OUT_OF_RANGE],
    [4.5, VALIDATION_MESSAGES.UNSUPPORTED_VALUE],
  ])("answers the rating value %s with the sentence its own fault carries", (value, message) => {
    expect(validateRating(value)).toEqual({ rating: message });
  });

  it("narrows a rating selection to the five whole values the star control offers", () => {
    for (const accepted of [1, 2, 3, 4, 5]) expect(isRatingValue(accepted)).toBe(true);
    for (const rejected of [0, 6, 4.5, "5", undefined, null, Number.NaN]) {
      expect(isRatingValue(rejected)).toBe(false);
    }
  });

  it("accepts a review title at each end of its configured bounds", () => {
    expect(validateReviewTitle("x".repeat(REVIEW_LIMITS.TITLE_MIN))).toEqual({});
    expect(validateReviewTitle("x".repeat(REVIEW_LIMITS.TITLE_MAX))).toEqual({});
  });

  it("rejects a review title one character outside those bounds", () => {
    const tooShort = { title: reviewTitleTooShortMessage(REVIEW_LIMITS.TITLE_MIN) };
    const tooLong = { title: reviewTitleTooLongMessage(REVIEW_LIMITS.TITLE_MAX) };
    expect(validateReviewTitle("x".repeat(REVIEW_LIMITS.TITLE_MIN - 1))).toEqual(tooShort);
    expect(validateReviewTitle("x".repeat(REVIEW_LIMITS.TITLE_MAX + 1))).toEqual(tooLong);
    expect(validateReviewTitle("")).toEqual({ title: VALIDATION_MESSAGES.REQUIRED });
  });

  it("accepts a review body at each end of its configured bounds", () => {
    const { BODY_MIN, BODY_MAX } = REVIEW_LIMITS;
    expect(validateReviewBody("x".repeat(BODY_MIN))).toEqual({});
    expect(validateReviewBody("x".repeat(BODY_MAX))).toEqual({});
  });

  it("rejects a review body one character outside those bounds", () => {
    const tooShort = { body: reviewBodyTooShortMessage(REVIEW_LIMITS.BODY_MIN) };
    const tooLong = { body: reviewBodyTooLongMessage(REVIEW_LIMITS.BODY_MAX) };
    expect(validateReviewBody("x".repeat(REVIEW_LIMITS.BODY_MIN - 1))).toEqual(tooShort);
    expect(validateReviewBody("x".repeat(REVIEW_LIMITS.BODY_MAX + 1))).toEqual(tooLong);
    expect(validateReviewBody("  ")).toEqual({ body: VALIDATION_MESSAGES.REQUIRED });
  });
});

describe("promo code shape", () => {
  it("accepts a promo code at each end of its configured bounds", () => {
    const accepted = [
      "SAVE",
      "1234",
      "SAVE2025SPRING10",
      "A".repeat(PROMO_CODE_MIN_LENGTH),
      "A".repeat(PROMO_CODE_MAX_LENGTH),
    ];
    for (const code of accepted) {
      expect(validatePromoCodeShape(code)).toEqual({});
    }
  });

  it("reports a promo code outside those bounds as a length fault, disclosing them", () => {
    const message = promoCodeLengthMessage(PROMO_CODE_MIN_LENGTH, PROMO_CODE_MAX_LENGTH);
    for (const rejected of ["SAV", "SAVE2025SPRING101", "1".repeat(PROMO_CODE_MAX_LENGTH + 1)]) {
      expect(validatePromoCodeShape(rejected)).toEqual({ promoCode: message });
    }
  });

  it("reports a code of the right length carrying another character as a character fault", () => {
    for (const rejected of ["save10", "SAVE 10", "SAVE-10"]) {
      expect(validatePromoCodeShape(rejected)).toEqual({
        promoCode: VALIDATION_MESSAGES.PROMO_CODE_FORMAT,
      });
    }
    expect(validatePromoCodeShape("")).toEqual({ promoCode: VALIDATION_MESSAGES.REQUIRED });
  });
});

describe("date range", () => {
  it("accepts a single-day range", () => {
    const validation = validateDateRange(FIXED_DATE, FIXED_DATE, NOW);
    expect(validation).toEqual({ valid: true, days: 1, problems: [] });
  });

  it("accepts a range of exactly the configured maximum", () => {
    const from = addDays(FIXED_DATE, -(MAX_REPORT_RANGE_DAYS - 1));
    const validation = validateDateRange(from, FIXED_DATE, NOW);
    expect(validation).toEqual({ valid: true, days: MAX_REPORT_RANGE_DAYS, problems: [] });
  });

  it("rejects a range one day past that maximum", () => {
    const from = addDays(FIXED_DATE, -MAX_REPORT_RANGE_DAYS);
    const validation = validateDateRange(from, FIXED_DATE, NOW);
    expect(validation.valid).toBe(false);
    expect(validation.days).toBe(MAX_REPORT_RANGE_DAYS + 1);
    expect(validation.problems).toEqual([{ field: "range", code: "range-too-long" }]);
  });

  it("rejects an inverted range outright rather than swapping its two ends", () => {
    const validation = validateDateRange(FIXED_LATER_DATE, FIXED_DATE, NOW);
    expect(validation).toEqual({
      valid: false,
      days: 0,
      problems: [{ field: "range", code: "range-inverted" }],
    });
  });

  it("rejects an end that falls after the day the range is validated against", () => {
    const validation = validateDateRange(FIXED_DATE, FIXED_LATER_DATE, NOW);
    expect(validation.valid).toBe(false);
    expect(validation.problems).toEqual([{ field: "to", code: "range-in-future" }]);
  });

  it("rejects an end that is not a real date, naming the end that is wrong", () => {
    expect(validateDateRange("2025-02-30", FIXED_DATE, NOW).problems).toEqual([
      { field: "from", code: "date-invalid" },
    ]);
    expect(validateDateRange(FIXED_DATE, "not-a-date", NOW).problems).toEqual([
      { field: "to", code: "date-invalid" },
    ]);
  });
});

describe("form validators", () => {
  it("accepts a complete registration", () => {
    expect(
      validateRegistration({
        email: "dana.okafor@example.com",
        password: MINIMUM_PASSWORD,
        firstName: "Dana",
        lastName: "Okafor",
      }),
    ).toEqual({});
  });

  it("keys a rejected registration by every offending field", () => {
    const errors = validateRegistration({
      email: "dana.okafor.example.com",
      password: SHORT_PASSWORD,
      firstName: "1",
      lastName: "",
    });
    expectRejectedWith(errors, ["email", "password", "firstName", "lastName"]);
    expect(errors.email).toBe(VALIDATION_MESSAGES.EMAIL_FORMAT);
    expect(errors.password).toBe(VALIDATION_MESSAGES.PASSWORD_POLICY);
    expect(errors.firstName).toBe(VALIDATION_MESSAGES.REQUIRED);
  });

  it("accepts a well-formed sign-in without judging the password's policy", () => {
    expect(validateSignIn({ email: "legacy.address@example.com", password: "x" })).toEqual({});
  });

  it("marks a malformed address at its own field", () => {
    expect(validateSignIn({ email: "not-an-email", password: "x" })).toEqual({
      email: VALIDATION_MESSAGES.EMAIL_FORMAT,
    });
  });

  it("keys an empty sign-in by both fields, with one sentence for either", () => {
    const errors = validateSignIn({ email: "   ", password: "" });
    expectRejectedWith(errors, ["email", "password"]);
    expect(errors.email).toBe(VALIDATION_MESSAGES.REQUIRED);
    expect(errors.password).toBe(VALIDATION_MESSAGES.REQUIRED);
  });

  it("accepts a profile update whose phone number is being cleared", () => {
    expect(validateProfileUpdate({ firstName: "Dana", lastName: "Okafor", phone: "" })).toEqual({});
  });

  it("keys a rejected profile update by name and phone number", () => {
    const errors = validateProfileUpdate({ firstName: "D", lastName: "1", phone: "503" });
    expectRejectedWith(errors, ["firstName", "lastName", "phone"]);
    expect(errors.phone).toBe(VALIDATION_MESSAGES.PHONE_FORMAT);
  });

  it("accepts a valid card payment and an invoice that carries no card at all", () => {
    expect(validatePayment({ method: "card", card: VALID_CARD }, NOW)).toEqual({});
    expect(validatePayment({ method: "invoice" }, NOW)).toEqual({});
    expect(validatePayment(undefined, NOW)).toEqual({});
  });

  it("keys each malformed card member on the field the payment form binds to", () => {
    for (const [field, patch, message] of CARD_FAILURES) {
      const errors = validatePayment({ method: "card", card: { ...VALID_CARD, ...patch } }, NOW);
      expect(errors[field]).toBe(message);
    }
  });

  it("files a passed expiry on the year, the half a correction usually changes", () => {
    const card = {
      ...VALID_CARD,
      expiryMonth: PREVIOUS_MONTH.getMonth() + 1,
      expiryYear: PREVIOUS_MONTH.getFullYear(),
    };
    expectRejectedWith(validatePayment({ method: "card", card }, NOW), ["expiryYear"]);
  });

  it("accepts a review whose three members are within their rules", () => {
    expect(
      validateReview({
        rating: 4,
        title: "Solid desk lamp",
        body: "The dimmer moves smoothly and the base stays where it is put.",
      }),
    ).toEqual({});
  });

  it("composes the shipping step from its address, its contact email and a configured method", () => {
    const submission = {
      address: VALID_ADDRESS,
      email: "dana.okafor@example.com",
      shippingMethodId: SHIPPING_METHODS[0].id,
    };
    expect(validateShippingSubmission(submission)).toEqual({});
    const broken = {
      address: { ...VALID_ADDRESS, city: "" },
      email: "",
      shippingMethodId: "ship_nowhere",
    };
    expectRejectedWith(validateShippingSubmission(broken), ["city", "email", "shippingMethodId"]);
  });

  it("keys a rejected review by rating, title and body", () => {
    const errors = validateReview({ rating: undefined, title: "no", body: "too short" });
    expectRejectedWith(errors, ["rating", "title", "body"]);
    expect(errors.rating).toBe(VALIDATION_MESSAGES.REQUIRED);
    expect(errors.title).toBe(reviewTitleTooShortMessage(REVIEW_LIMITS.TITLE_MIN));
    expect(errors.body).toBe(reviewBodyTooShortMessage(REVIEW_LIMITS.BODY_MIN));
  });
});

describe("fieldErrorsFromApiError", () => {
  it("files a failure that names a field under that field", () => {
    const error = makeApiError({ status: 422, field: "email", message: "Already registered." });
    expect(fieldErrorsFromApiError(error)).toEqual({ email: error.message });
  });

  it("files a failure that names no field under the form key, reporting something either way", () => {
    const error = makeApiError({ status: 422, message: "The order could not be placed." });
    const errors = fieldErrorsFromApiError(error);
    expect(errors).toEqual({ [FORM_ERROR_KEY]: error.message });
    expect(hasErrors(errors)).toBe(true);
  });

  it("falls back to the neutral sentence when the failure carries none", () => {
    const errors = fieldErrorsFromApiError(makeApiError({ status: 500, message: "   " }));
    expect(errors).toEqual({ [FORM_ERROR_KEY]: FEEDBACK_COPY.ERROR_STATE_BODY });
  });

  it("uses the sentence a caller passes instead of the neutral one", () => {
    const error = makeApiError({ status: 401, message: "" });
    const errors = fieldErrorsFromApiError(error, "Sign in again.");
    expect(errors).toEqual({ [FORM_ERROR_KEY]: "Sign in again." });
  });

  it("keeps an infrastructure failure out of the field keys it names none of", () => {
    const error = makeApiError({ status: 500, code: "server-error" });
    const errors = fieldErrorsFromApiError(error);
    expect(Object.keys(errors)).toEqual([FORM_ERROR_KEY]);
    expect(errors[FORM_ERROR_KEY]).toBe(error.message);
  });

  it("reads a request outcome as an empty map on success and as the failure's map otherwise", () => {
    expect(fieldErrorsFromResult({ ok: true, value: 42 })).toEqual({});
    const error = makeApiError({ status: 409, field: "promoCode", message: "Code expired." });
    const errors = fieldErrorsFromResult({ ok: false, error }, "Try again.");
    expect(errors).toEqual({ promoCode: error.message });
  });
});

describe("error map helpers", () => {
  it("reports presence, the leading message and one field's state", () => {
    const errors = validateSignIn({ email: "", password: "x" });
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors({ email: "" })).toBe(false);
    expect(firstError(errors)).toBe(VALIDATION_MESSAGES.REQUIRED);
    expect(firstError({})).toBeUndefined();
    expect(fieldErrored(errors, "email")).toBe(true);
    expect(fieldErrored(errors, "password")).toBe(false);
  });

  it("merges maps with the later message winning, and clears one field without mutating either", () => {
    const merged = mergeErrors({ email: "", password: "first" }, { password: "second" });
    expect(merged).toEqual({ password: "second" });
    const errors: FieldErrors = { email: "bad", password: "bad too" };
    expect(clearFieldError(errors, "email")).toEqual({ password: "bad too" });
    expect(errors).toEqual({ email: "bad", password: "bad too" });
  });
});
