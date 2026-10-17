/**
 * Path: src/utils/validation.ts
 * Purpose: Every field and form validator, each returning a field-keyed error map
 * Lines: 596
 */

import { PASSWORD_POLICY, SHIPPING_METHODS } from "@/constants/config";
import {
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
  nameLengthMessage,
  postalCodeFormatMessage,
  quantityRangeMessage,
  reviewBodyLengthMessage,
  reviewTitleLengthMessage,
} from "@/constants/content";
import { SUPPORTED_COUNTRIES, type CountryOption } from "@/constants/taxonomy";
import type {
  AddressInput,
  Credentials,
  ProfileUpdateInput,
  RegistrationInput,
} from "@/types/account";
import type { RatingValue, ReviewInput } from "@/types/catalog";
import type { ApiError, FieldErrors, Result } from "@/types/common";
import type { CardInput, PaymentInput } from "@/types/commerce";

/**
 * The contract every rule here keeps: a validator returns a field-keyed error map and never throws, so a
 * blank, absent or wrongly typed value is judged rather than crashing the render that asked. A field rule
 * accepts with an empty map and refuses with one entry keyed by the member name its control binds to, so a
 * control meets the same shape whether a rule or the seam refused it. A rule that judges more than one
 * control — {@link validateRequired}, {@link validateName} — takes that member name as its first parameter,
 * and {@link validateCardExpiry} keys the expiry half in fault. Every sentence comes from
 * `src/constants/content.ts`, every limit from `src/constants/config.ts` or the taxonomy, and the
 * query-state, date-range and paging rules live in their own modules, reused as they stand. Consumers: every
 * submit path in the product, and `src/lib/mockServer.ts`, which runs these rules over an untrusted body so a
 * hand-made request cannot be accepted where the form itself would have refused.
 */

// Rule limits ------------------------------------------------------------------------------------

/** The field a failure naming no single control is filed under, so a form has one place to look for
 * the message it shows above its fields. {@link fieldErrorsFromApiError} files it there. */
export const FORM_ERROR_KEY = "form";

/** The bounds a review's title and body are accepted within, exported because the review form renders the
 * same numbers in its counter and its `maxLength`: the count a writer sees cannot drift from the rule. */
export const REVIEW_LIMITS = {
  TITLE_MIN: 3,
  TITLE_MAX: 80,
  BODY_MIN: 10,
  BODY_MAX: 1200,
} as const;

/** Fewest characters a name may hold, so a stray keystroke is not accepted as one. */
const NAME_MIN_LENGTH = 2;
/** The most characters a person's name may hold, so no name can be stored unbounded. Exported for the
 * reason the review bounds are: a name control reads the number for its own `maxLength`, so the ceiling a
 * visitor meets cannot drift from the rule that refuses them. */
export const NAME_MAX_LENGTH = 80;
/** The digits a phone number may hold (seven to fifteen, the E.164 ceiling), a card number (thirteen to
 * nineteen, across the major schemes) and a security code (three, or four where four is printed). */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;
const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;
const CVC_MIN_DIGITS = 3;
const CVC_MAX_DIGITS = 4;
/** The four-digit years and twelve months a card expiry may name. */
const EXPIRY_YEAR_MIN = 2000;
const EXPIRY_YEAR_MAX = 2099;
const MONTH_MIN = 1;
const MONTH_MAX = 12;
/** The longest a whole email address may be: the limit RFC 5321 sets for one. */
const EMAIL_MAX_LENGTH = 254;

/** The characters an email address's local part is built from — the dot-atom set of RFC 5322 — with
 * every run that follows a dot, its dotted domain, and the two around exactly one `@`. */
const EMAIL_LOCAL_PATTERN = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const EMAIL_DOMAIN_PATTERN = "(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}";
const EMAIL_PATTERN = new RegExp(`^${EMAIL_LOCAL_PATTERN}@${EMAIL_DOMAIN_PATTERN}$`);
/** The shape a control's text must have: a phone number and a card number as typed, a security code, a
 * promo code's four to sixteen upper-case alphanumerics, and a whole signed number in text. */
const PHONE_PATTERN = /^\+?[\d\s().-]+$/;
const CARD_TEXT_PATTERN = /^[\d\s-]+$/;
const DIGITS_PATTERN = /^\d+$/;
const PROMO_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
const INTEGER_PATTERN = /^-?\d+$/;
/** The classes a password must hold one of each — a letter and a digit — and everything that is not a
 * digit, dropped before a card, phone or security code is counted. */
const LETTER_PATTERN = /\p{L}/u;
const DIGIT_PATTERN = /\d/;
const NON_DIGIT_PATTERN = /\D/g;
/** Each country's postal-code pattern, compiled once at load, and its label, so a message can name the
 * country it describes. The sources come from `src/constants/taxonomy.ts` and are compiled without the `g`
 * flag, which carries `lastIndex` between calls and would let one value pass and the next identical one
 * fail; every source is a constant of this repository, so one that will not compile is a programming error
 * that fails loudly at load rather than a case to absorb. */
const POSTAL_CODE_PATTERNS: ReadonlyMap<string, RegExp> = new Map<string, RegExp>(
  SUPPORTED_COUNTRIES.map((country): [string, RegExp] => [
    country.code,
    new RegExp(country.postalCodePattern),
  ]),
);
const COUNTRY_LABELS: ReadonlyMap<string, string> = new Map<string, string>(
  SUPPORTED_COUNTRIES.map((country): [string, string] => [country.code, country.label]),
);

/** What a rule reads when it cannot assume a type: the value a control holds, which may be absent,
 * blank or of another type while the form is still being filled. */
export type FieldValue = unknown;

/** The values a form validator is handed, every member and the object itself possibly absent: the same
 * validator judges a request body missing the member it needs, reporting it rather than throwing. */
export type FormValues<TShape> = Partial<TShape> | undefined;

/** The expiry half of a card as a validation entry point reads it: `CardInput`'s two members, each either
 * the number it declares or the digits in text, because the payment form holds what was typed — an empty
 * string once a field is cleared — and the numeric pair is assembled where the order is. */
export type CardExpiryInput = {
  readonly expiryMonth: number | string;
  readonly expiryYear: number | string;
};

/** A card as a validation entry point reads it: the expiry shape above beside `CardInput`'s other members,
 * so the member names stay exactly `CardInput`'s and a form binds its errors by them. */
export type CardValidationInput = CardExpiryInput & Omit<CardInput, "expiryMonth" | "expiryYear">;

/** The payment a validation entry point reads: `PaymentInput`'s method and a card as above. */
export type PaymentValidationInput = Omit<PaymentInput, "card"> & {
  readonly card?: CardValidationInput;
};

/** A review as its form holds it: every member `ReviewInput` carries, the rating possibly unchosen,
 * which is why the review form narrows it with {@link isRatingValue} before submitting. */
export type ReviewDraft = Omit<ReviewInput, "rating"> & { readonly rating: RatingValue | undefined };

/** The shipping step's submission: the address, the contact email the order records, and the chosen
 * delivery method, each validated by its own rule. */
export interface ShippingSubmission {
  readonly address: AddressInput;
  readonly email: string;
  readonly shippingMethodId: string;
}

/** Whether a value counts as missing: `null`, `undefined`, or text with nothing in it once trimmed.
 * `0` and `false` are values. Reads a value of any type without assuming one. */
function isBlank(value: FieldValue): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.trim().length === 0;
}

/** The trimmed text of a value, or an empty string when it is not text at all, so a rule can judge a
 * field without knowing what the control handed it. */
const textOf = (value: FieldValue): string => (typeof value === "string" ? value.trim() : "");

/** A value read as a whole number, or `undefined` for anything else — a fraction, a blank field, a
 * word. Text is read only when it is a signed integer with nothing around it. */
function integerOf(value: FieldValue): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  const text = textOf(value);
  if (text.length === 0 || !INTEGER_PATTERN.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

/** Whether a message is worth reporting; a validator's map may hold keys with nothing in them, and an
 * empty message is the same as an absent one. */
const isReportable = (message: string | undefined): message is string =>
  typeof message === "string" && message.length > 0;

/** What a field rule returns: one entry keyed by the control the rule judged, carrying the message it
 * broke, or an empty map when the value was accepted. Every rule below returns through this one builder,
 * so the map's shape has a single home. */
function ruleErrors(field: string, message: string | undefined): FieldErrors {
  return isReportable(message) ? { [field]: message } : {};
}

/** The digits of a value, with every space, hyphen, dot, bracket and letter dropped. */
const digitsOf = (value: string): string => value.replace(NON_DIGIT_PATTERN, "");

/** The configured entry for a country code, compared without regard to case or surrounding space. */
function findCountry(code: string): CountryOption | undefined {
  const wanted = code.trim().toUpperCase();
  return SUPPORTED_COUNTRIES.find((country) => country.code === wanted);
}

// Primitive field rules --------------------------------------------------------------------------

/** The rule a required field is accepted by: something must have been entered, whitespace-only text counting
 * as nothing. `field` is the control's own member name and keys the map, which is how one rule serves every
 * required control; `message` defaults to the generic required sentence, and a caller passes its own only
 * where `content.ts` holds a more specific one. */
export function validateRequired(
  field: string,
  value: FieldValue,
  message: string = VALIDATION_MESSAGES.REQUIRED,
): FieldErrors {
  return isBlank(value) ? ruleErrors(field, message) : {};
}

/** The rule an email address is accepted by: something before a single `@` and a dotted domain whose
 * last label is two letters or more, neither part opening, closing or doubling on a dot. The address is
 * not lower-cased, so the form keeps what was typed. Returns the `email` map it breaks, else an empty one. */
export function validateEmail(value: FieldValue): FieldErrors {
  const address = textOf(value);
  if (address.length === 0) return ruleErrors("email", VALIDATION_MESSAGES.REQUIRED);
  const malformed = address.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(address);
  return malformed ? ruleErrors("email", VALIDATION_MESSAGES.EMAIL_FORMAT) : {};
}

/** The rule a password is accepted by: the length and classes `PASSWORD_POLICY` in
 * `src/constants/config.ts` requires, read from there so the form, the seeds and this rule agree. It is
 * never trimmed, kept, echoed or altered; blank reports as missing, not as short. Returns the `password`
 * map it breaks, else an empty one when it meets the policy. */
export function validatePassword(value: FieldValue): FieldErrors {
  const password = typeof value === "string" ? value : "";
  if (password.trim().length === 0) return ruleErrors("password", VALIDATION_MESSAGES.REQUIRED);
  const short = password.length < PASSWORD_POLICY.MIN_LENGTH;
  const missingLetter = PASSWORD_POLICY.REQUIRE_LETTER && !LETTER_PATTERN.test(password);
  const missingDigit = PASSWORD_POLICY.REQUIRE_DIGIT && !DIGIT_PATTERN.test(password);
  return short || missingLetter || missingDigit
    ? ruleErrors("password", VALIDATION_MESSAGES.PASSWORD_POLICY)
    : {};
}

/** The rule a postal code is accepted by: the pattern its country declares in
 * `src/constants/taxonomy.ts`, compared without regard to case because two of the five countries write codes
 * with letters. `country` is the code the address names; a blank or unsupported one leaves the pattern
 * unjudged, that failure belonging to the country field. Returns the `postalCode` map it breaks, else an
 * empty one. */
export function validatePostalCode(value: FieldValue, country: FieldValue): FieldErrors {
  const postalCode = textOf(value);
  if (postalCode.length === 0) return ruleErrors("postalCode", VALIDATION_MESSAGES.REQUIRED);
  const entry = typeof country === "string" ? findCountry(country) : undefined;
  if (entry === undefined) return {};
  const pattern = POSTAL_CODE_PATTERNS.get(entry.code);
  if (pattern === undefined || pattern.test(postalCode.toUpperCase())) return {};
  const message = postalCodeFormatMessage(COUNTRY_LABELS.get(entry.code) ?? entry.label);
  return ruleErrors("postalCode", message);
}

/** The rule a phone number is accepted by: seven to fifteen digits, with an optional leading `+` and
 * nothing around them but spaces, brackets, dots and hyphens. Optional on an address, so an empty value
 * passes and the field is judged once typed. Returns the `phone` map it breaks, else an empty one. */
export function validatePhone(value: FieldValue): FieldErrors {
  const phone = textOf(value);
  if (phone.length === 0) return {};
  const digits = digitsOf(phone).length;
  const phoneShaped = PHONE_PATTERN.test(phone) && digits >= PHONE_MIN_DIGITS;
  if (phoneShaped && digits <= PHONE_MAX_DIGITS) return {};
  return ruleErrors("phone", VALIDATION_MESSAGES.PHONE_FORMAT);
}

/** The rule a name is accepted by: two to {@link NAME_MAX_LENGTH} characters with at least one letter, so a
 * lone keystroke, a punctuation mark or a row of digits is not a person's name and neither is a value long
 * enough to bloat whatever stores it. `field` is the control's own member name — `firstName`, `lastName`,
 * `fullName`, `nameOnCard` — and keys the map; `message` defaults to the sentence a name too short breaks,
 * while a name past the ceiling breaks the length sentence `content.ts` builds from the bound. */
export function validateName(
  field: string,
  value: FieldValue,
  message: string = VALIDATION_MESSAGES.REQUIRED,
): FieldErrors {
  const name = textOf(value);
  if (name.length < NAME_MIN_LENGTH || !LETTER_PATTERN.test(name)) {
    return ruleErrors(field, message);
  }
  return name.length > NAME_MAX_LENGTH ? ruleErrors(field, nameLengthMessage(NAME_MAX_LENGTH)) : {};
}

/** The Luhn check a card number carries: from the rightmost digit leftward, every second digit is doubled
 * and reduced by nine above nine, and the digits must sum to a multiple of ten — what one mistyped digit
 * or a transposition breaks. `digits` are the number's digits alone; the result says whether they carry a
 * correct check digit, an empty string, a non-digit or a value that is not a string at all failing the
 * check rather than being ignored. */
export function isLuhnValid(digits: string): boolean {
  if (typeof digits !== "string" || digits.length === 0) return false;
  let sum = 0;
  let doubling = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    sum += doubling ? (digit > 4 ? digit * 2 - 9 : digit * 2) : digit;
    doubling = !doubling;
  }
  return sum % 10 === 0;
}

/** The rule a card number is accepted by: thirteen to nineteen digits, spaces and hyphens allowed between
 * them, and a correct Luhn check digit. Approval is not decided here — that is the demonstration seam's
 * answer in `src/lib/mockServer.ts` — and the number is read, validated and discarded, never stored. Returns
 * the `number` map it breaks, else an empty one when its shape is acceptable. */
export function validateCardNumber(value: FieldValue): FieldErrors {
  const typed = textOf(value);
  if (typed.length === 0) return ruleErrors("number", VALIDATION_MESSAGES.REQUIRED);
  if (!CARD_TEXT_PATTERN.test(typed)) {
    return ruleErrors("number", VALIDATION_MESSAGES.CARD_NUMBER);
  }
  const digits = digitsOf(typed);
  if (digits.length < CARD_MIN_DIGITS || digits.length > CARD_MAX_DIGITS) {
    return ruleErrors("number", VALIDATION_MESSAGES.CARD_NUMBER);
  }
  return isLuhnValid(digits) ? {} : ruleErrors("number", VALIDATION_MESSAGES.CARD_NUMBER);
}

/** The rule a card expiry is accepted by: an integer month from 1 to 12, a four-digit year, and a pair that
 * has not passed — a card stays valid to the end of its expiry month, so one expiring in the month `now`
 * falls in is still accepted. `value` holds the two expiry members, either possibly absent while the form is
 * filled; `now` is the injectable instant measured against. The map is keyed by the half in fault:
 * `expiryMonth` for a month absent, unreadable or outside 1-12, and `expiryYear` for a year absent or
 * unreadable as well as for a pair whose halves are both well formed but which has passed — the coarser half,
 * and the one a correction usually changes. Empty when the pair holds. */
export function validateCardExpiry(
  value: FormValues<CardExpiryInput>,
  now: Date = new Date(),
): FieldErrors {
  const month = integerOf(value?.expiryMonth);
  const year = integerOf(value?.expiryYear);
  const monthUsable = month !== undefined && month >= MONTH_MIN && month <= MONTH_MAX;
  const yearUsable = year !== undefined && year >= EXPIRY_YEAR_MIN && year <= EXPIRY_YEAR_MAX;
  if (!monthUsable) return ruleErrors("expiryMonth", VALIDATION_MESSAGES.CARD_EXPIRY);
  if (!yearUsable) return ruleErrors("expiryYear", VALIDATION_MESSAGES.CARD_EXPIRY);
  const expiresAfter = new Date(year, month, 1).getTime();
  if (now.getTime() >= expiresAfter) {
    return ruleErrors("expiryYear", VALIDATION_MESSAGES.CARD_EXPIRY);
  }
  return {};
}

/** The rule a security code is accepted by: three or four digits and nothing else. Returns the `cvc` map
 * it breaks, else an empty one when it fits. */
export function validateCvc(value: FieldValue): FieldErrors {
  const cvc = textOf(value);
  if (cvc.length === 0) return ruleErrors("cvc", VALIDATION_MESSAGES.REQUIRED);
  const wrongShape = !DIGITS_PATTERN.test(cvc);
  const wrongLength = cvc.length < CVC_MIN_DIGITS || cvc.length > CVC_MAX_DIGITS;
  return wrongShape || wrongLength ? ruleErrors("cvc", VALIDATION_MESSAGES.CARD_SECURITY_CODE) : {};
}

/** The rule a promo code's shape is accepted by: four to sixteen characters, all an upper-case letter or a
 * digit. The value is not upper-cased here, because the rule states what an accepted code is rather than what
 * a typed one must be: the entry field normalises as the shopper types, while this rule still refuses a
 * lower-case code arriving at the order seam from anywhere else. Returns the `promoCode` map it breaks. */
export function validatePromoCodeShape(value: FieldValue): FieldErrors {
  const code = textOf(value);
  if (code.length === 0) return ruleErrors("promoCode", VALIDATION_MESSAGES.REQUIRED);
  return PROMO_CODE_PATTERN.test(code)
    ? {}
    : ruleErrors("promoCode", VALIDATION_MESSAGES.PROMO_CODE_FORMAT);
}

/** The rule a quantity is accepted by: a whole number from one to `maxQuantity`, which is what is still in
 * stock, read from a number or from typed text. The message names that ceiling, so a stepper bounded by stock
 * and this rule tell a shopper the same thing. Returns the `quantity` map it breaks, else an empty one. */
export function validateQuantity(value: FieldValue, maxQuantity: number): FieldErrors {
  const quantity = integerOf(value);
  const outOfRange = quantity === undefined || quantity < 1 || quantity > maxQuantity;
  return outOfRange ? ruleErrors("quantity", quantityRangeMessage(maxQuantity)) : {};
}

/** The rule a review's title is accepted by: 3 to 80 characters once trimmed, the bounds in
 * {@link REVIEW_LIMITS}; an empty title reports as missing rather than as badly sized. Returns the `title`
 * map it breaks, else an empty one when it is within the bounds. */
export function validateReviewTitle(value: FieldValue): FieldErrors {
  const title = textOf(value);
  if (title.length === 0) return ruleErrors("title", VALIDATION_MESSAGES.REQUIRED);
  const { TITLE_MIN, TITLE_MAX } = REVIEW_LIMITS;
  const wrongLength = title.length < TITLE_MIN || title.length > TITLE_MAX;
  return wrongLength ? ruleErrors("title", reviewTitleLengthMessage(TITLE_MIN, TITLE_MAX)) : {};
}

/** The rule a review's body is accepted by: 10 to 1,200 characters once trimmed, the bounds in
 * {@link REVIEW_LIMITS}; an empty body reports as missing rather than as badly sized. Returns the `body`
 * map it breaks, else an empty one when it is within the bounds. */
export function validateReviewBody(value: FieldValue): FieldErrors {
  const body = textOf(value);
  if (body.length === 0) return ruleErrors("body", VALIDATION_MESSAGES.REQUIRED);
  const { BODY_MIN, BODY_MAX } = REVIEW_LIMITS;
  const wrongLength = body.length < BODY_MIN || body.length > BODY_MAX;
  return wrongLength ? ruleErrors("body", reviewBodyLengthMessage(BODY_MIN, BODY_MAX)) : {};
}

/** Whether a value is one of the five ratings, the guard a form narrows its own state with before it
 * submits a review. Returns whether `value` is a whole number from one to five. */
export function isRatingValue(value: unknown): value is RatingValue {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** The rule a rating is accepted by: one of the five whole numbers, read from a number or from text. A value
 * outside the five reports as missing rather than as out of range, because the star control offers the whole
 * domain and nothing else, so the failure a visitor can reach is an unchosen rating; a hand-made request
 * carrying a sixth star is re-rejected by the seam with `422` naming this field. Returns the `rating` map. */
export function validateRating(value: FieldValue): FieldErrors {
  const rating = integerOf(value);
  if (rating !== undefined && isRatingValue(rating)) return {};
  return ruleErrors("rating", VALIDATION_MESSAGES.REQUIRED);
}

// Form rules -------------------------------------------------------------------------------------

/** The rule the country field is accepted by: one of the countries `src/constants/taxonomy.ts` declares. A
 * code outside the set reports as a missing country, since the control offers the configured set as its only
 * choices and a hand-made request carrying another code is re-rejected by the seam with `422`. Returns the
 * `country` map, empty when the value names a configured country. */
function validateCountry(value: FieldValue): FieldErrors {
  return findCountry(textOf(value)) !== undefined
    ? {}
    : ruleErrors("country", VALIDATION_MESSAGES.REQUIRED);
}

/** The rule the delivery method is accepted by: one of the methods `src/constants/config.ts` declares. An
 * unknown id reports as an unchosen method, for the same reason a country outside the set does: the radios
 * offer the configured methods, and the seam re-checks the id it is sent. Returns the `shippingMethodId`
 * map, empty when the value names a configured method. */
function validateShippingMethod(value: FieldValue): FieldErrors {
  if (isBlank(value)) return ruleErrors("shippingMethodId", VALIDATION_MESSAGES.REQUIRED);
  const id = textOf(value);
  return SHIPPING_METHODS.some((method) => method.id === id)
    ? {}
    : ruleErrors("shippingMethodId", VALIDATION_MESSAGES.REQUIRED);
}

/** The rule the registration form is submitted by: a well-formed email, a password meeting the policy, and
 * a first and last name. `marketingOptIn` is a choice and carries no rule, and a duplicate email is not
 * judged here — that is the store's answer, arriving as a `409` whose field lands in this map. `input` is the
 * body `POST /api/auth/register` accepts; the result keys errors by its member names, empty when it may be
 * submitted. */
export function validateRegistration(input: FormValues<RegistrationInput>): FieldErrors {
  return mergeErrors(
    validateEmail(input?.email),
    validatePassword(input?.password),
    validateName("firstName", input?.firstName),
    validateName("lastName", input?.lastName),
  );
}

/** The rule the sign-in form is submitted by: both members present, and nothing more. The email's shape
 * and the password's policy are deliberately not judged — a returning visitor may hold a password
 * predating the current policy and is to be told their credentials do not match, not that their password
 * is the wrong length — and both empty fields share one generic sentence, so neither is singled out.
 * `input` is the credentials as typed; the result holds an `email` and `password` error while either is
 * empty. The rejected sign-in is answered by the seam with one generic message that
 * {@link fieldErrorsFromApiError} lands in this same map. */
export function validateSignIn(input: FormValues<Credentials>): FieldErrors {
  return mergeErrors(
    validateRequired("email", input?.email),
    validateRequired("password", input?.password),
  );
}

/** The rule the profile form is submitted by: a first and last name, and a phone number judged only when one
 * is given, since an empty number clears the stored one. The email, role, loyalty tier and addresses are not
 * editable here and carry no rule. `input` is the body `PATCH /api/customers/:id` accepts; the result keys
 * errors by its member names, empty when the form may be submitted. */
export function validateProfileUpdate(input: FormValues<ProfileUpdateInput>): FieldErrors {
  return mergeErrors(
    validateName("firstName", input?.firstName),
    validateName("lastName", input?.lastName),
    validatePhone(input?.phone),
  );
}

/** The one address rule, used unchanged by the checkout's shipping step and the account address book, so a
 * delivery address and a saved address cannot disagree about what is valid. `fullName`, `line1`, `city`,
 * `region`, `postalCode` and `country` are required; `line2`, `phone` and `label` are optional, the phone
 * judged once typed and the label carrying no rule. `input` is the address as entered; the result keys
 * errors by `AddressInput`'s members, so a form attaches each message to its own control. */
export function validateAddress(input: FormValues<AddressInput>): FieldErrors {
  return mergeErrors(
    validateName("fullName", input?.fullName),
    validateRequired("line1", input?.line1),
    validateRequired("city", input?.city),
    validateRequired("region", input?.region),
    validatePostalCode(input?.postalCode, input?.country),
    validateCountry(input?.country),
    validatePhone(input?.phone),
  );
}

/** The rule the payment step is submitted by: a `card` must hold the cardholder's name, a number passing
 * the Luhn check, an expiry that has not passed and a three-to-four digit security code, while an
 * `invoice` carries no card and passes. Approval is not decided here — that is the demonstration seam's
 * answer, which discards the number once it has read it. `input` is the method and card as typed; `now` is
 * the instant the expiry is measured against. The result keys errors by `CardInput`'s members, the expiry
 * filed by {@link validateCardExpiry} on the half carrying the fault. */
export function validatePayment(
  input: FormValues<PaymentValidationInput>,
  now: Date = new Date(),
): FieldErrors {
  if (input?.method !== "card") return {};
  const card = input.card;
  return mergeErrors(
    validateCardNumber(card?.number),
    validateName("nameOnCard", card?.nameOnCard),
    validateCardExpiry(card, now),
    validateCvc(card?.cvc),
  );
}

/** The rule the review form is submitted by: a rating chosen from the five, a title of 3 to 80 characters
 * and a body of 10 to 1,200, the bounds in {@link REVIEW_LIMITS}. `input` is the review as the form holds
 * it, with the rating possibly unchosen; the result is an error map keyed by `rating`, `title` and `body`,
 * empty when the review may be submitted. */
export function validateReview(input: FormValues<ReviewDraft>): FieldErrors {
  return mergeErrors(
    validateRating(input?.rating),
    validateReviewTitle(input?.title),
    validateReviewBody(input?.body),
  );
}

/** The composite the checkout's shipping step is submitted by: the address rule, the contact email the order
 * records, and a delivery method chosen from the configured ones. The address's own keys are carried through
 * unchanged, so the form marks the address controls and the two step-level controls from one map. `input` is
 * the step's values; the result holds the address, `email` and `shippingMethodId` errors. */
export function validateShippingSubmission(input: FormValues<ShippingSubmission>): FieldErrors {
  return mergeErrors(
    validateAddress(input?.address),
    validateEmail(input?.email),
    validateShippingMethod(input?.shippingMethodId),
  );
}

// Error maps -------------------------------------------------------------------------------------

/** Whether a map holds any error at all, which is what a submit handler asks before it sends. `errors` is
 * the map a validator returned; the result says whether at least one field holds a message. */
export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(isReportable);
}

/** The first message a map holds, in the order its fields were set — the one a summary above a form leads
 * with. `errors` is the map a validator returned; the result is its first reportable message, or
 * `undefined` when it holds none. */
export function firstError(errors: FieldErrors): string | undefined {
  return Object.values(errors).find(isReportable);
}

/** Whether one field of a map carries an error, so a control marks itself without reading the whole map.
 * `errors` is the map a validator returned and `field` the field to ask about; the result says whether
 * that field holds a message. */
export function fieldErrored(errors: FieldErrors, field: string): boolean {
  return isReportable(errors[field]);
}

/** Combines maps into one, so a step's whole rule is composed from the maps its parts produced. `maps` are
 * combined in order — a later map replaces an earlier message for a field they share, the most recently
 * computed rule being the one shown — and the result is a new map holding every reportable message, at most
 * one per field. */
export function mergeErrors(...maps: readonly FieldErrors[]): FieldErrors {
  const merged: FieldErrors = {};
  for (const map of maps) {
    for (const [field, message] of Object.entries(map)) {
      if (isReportable(message)) merged[field] = message;
    }
  }
  return merged;
}

/** The same map without one field's error, which is what a form does the moment a control is edited: the
 * message clears as the visitor corrects it rather than standing until the next submission. `errors` is the
 * map to copy and `field` the field to clear; the result is a new map with that key removed, leaving the map
 * passed in untouched. */
export function clearFieldError(errors: FieldErrors, field: string): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field));
}

/** The map an `ApiError` becomes, so a failure the seam reports lands in the same shape a field rule does
 * and a form renders both the same way. A failure naming a `field` is filed under it — how the `422`
 * validation answers from `src/lib/mockServer.ts` mark the control that caused them — and one naming none
 * is filed under {@link FORM_ERROR_KEY}, the single place a form looks for the message it shows above its
 * fields. `error` is the failure a service returned; `fallbackMessage` is the sentence to show when it
 * carries none, defaulting to the neutral one, and a surface with more specific copy — sign-in, order
 * placement — passes its own. The result is a one-entry map keyed by the failing field, or by the form
 * key; the caller keeps the `ApiError` itself, which a page-level error state renders. */
export function fieldErrorsFromApiError(
  error: ApiError,
  fallbackMessage: string = FEEDBACK_COPY.ERROR_STATE_BODY,
): FieldErrors {
  const carried = textOf(error.message);
  const field = textOf(error.field);
  const message = carried.length > 0 ? carried : fallbackMessage;
  return { [field.length > 0 ? field : FORM_ERROR_KEY]: message };
}

/** The map a request outcome becomes: empty when the request succeeded, and the
 * {@link fieldErrorsFromApiError} map when it failed, so a caller handles both halves of a `Result` in one
 * expression. `result` is the outcome a service returned and `fallbackMessage` the sentence to show when
 * the failure carries none; the result is an empty map for a success, or the failure's map. */
export function fieldErrorsFromResult<TValue>(
  result: Result<TValue>,
  fallbackMessage?: string,
): FieldErrors {
  return result.ok ? {} : fieldErrorsFromApiError(result.error, fallbackMessage);
}
