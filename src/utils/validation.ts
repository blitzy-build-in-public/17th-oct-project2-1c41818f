/**
 * Path: src/utils/validation.ts
 * Purpose: Every field and form validator, each returning a field-keyed error map
 * Lines: 598
 */

import { PASSWORD_POLICY, SHIPPING_METHODS } from "@/constants/config";
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
import { hasControlCharacters } from "@/utils/strings";

/**
 * The contract every rule here keeps: a validator returns a field-keyed error map and never throws, so a
 * blank, absent or wrongly typed value is judged rather than crashing the render that asked. A rule accepts
 * with an empty map and refuses with one entry keyed by the member name its control binds to, and a rule
 * judging several controls takes that member name first, as {@link validateRequired} and
 * {@link validateCardExpiry} do for the half in fault. Every sentence comes from
 * `src/constants/content.ts`, every limit from the bound its field declares; consumers are every submit
 * path and `src/lib/mockServer.ts`, which runs these rules over an untrusted body.
 */

// Rule limits ------------------------------------------------------------------------------------

/** The field a failure naming no control is filed under, by {@link fieldErrorsFromApiError}. */
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
/** The most characters a person's name may hold, read by a name control for its own `maxLength`. */
export const NAME_MAX_LENGTH = 80;
/** The longest each free-text field may be: an address's lines, its city, region and label, and the
 * catalogue's search term; each control reads its own bound for its `maxLength`. */
export const FREE_TEXT_LIMITS = {
  LINE_MAX: 120,
  PLACE_MAX: 80,
  LABEL_MAX: 40,
  SEARCH_TERM_MAX: 120,
} as const;
/** The characters a promo code is built from and the length it must fall between: {@link PROMO_CODE_PATTERN}
 * is built from these numbers, so the sentence a refusal states and the rule it breaks cannot drift apart. */
export const PROMO_CODE_MIN_LENGTH = 4;
export const PROMO_CODE_MAX_LENGTH = 16;
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

/** The characters an email address's local part is built from: the dot-atom set of RFC 5322. */
const EMAIL_LOCAL_PATTERN =
  "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const EMAIL_DOMAIN_PATTERN = "(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}";
const EMAIL_PATTERN = new RegExp(`^${EMAIL_LOCAL_PATTERN}@${EMAIL_DOMAIN_PATTERN}$`);
/** The shape a control's text must have: a phone number and a card number as typed, a security code, a
 * promo code of the upper-case alphanumerics the bounds above allow, and a whole signed number in text. */
const PHONE_PATTERN = /^\+?[\d\s().-]+$/;
const CARD_TEXT_PATTERN = /^[\d\s-]+$/;
/** A number whose digits are all the same, refused ahead of the Luhn check, which accepts one. */
const REPEATED_DIGIT_PATTERN = /^(\d)\1+$/;
const DIGITS_PATTERN = /^\d+$/;
/** Built from the bounds above, so the length the rule judges is the length a refusal states. */
const PROMO_CODE_PATTERN = new RegExp(
  `^[A-Z0-9]{${PROMO_CODE_MIN_LENGTH},${PROMO_CODE_MAX_LENGTH}}$`,
);
const INTEGER_PATTERN = /^-?\d+$/;
/** A letter and a digit for the password policy, and everything that is not a digit. */
const LETTER_PATTERN = /\p{L}/u;
const DIGIT_PATTERN = /\d/;
const NON_DIGIT_PATTERN = /\D/g;
/** Each country's postal-code pattern, compiled once at load, and its label, so a message can name the
 * country it describes; compiled without `g`, whose `lastIndex` would fail the next identical value. */
const POSTAL_CODE_PATTERNS: ReadonlyMap<string, RegExp> = new Map<string, RegExp>(
  SUPPORTED_COUNTRIES.map((country): [string, RegExp] => [
    country.code,
    new RegExp(country.postalCodePattern),
  ]),
);
const COUNTRY_LABELS: ReadonlyMap<string, string> = new Map<string, string>(
  SUPPORTED_COUNTRIES.map((country): [string, string] => [country.code, country.label]),
);

/** What a rule reads when it cannot assume a type: a control's value, possibly absent or mistyped. */
export type FieldValue = unknown;

/** The values a form validator judges, with every member and the object itself possibly absent. */
export type FormValues<TShape> = Partial<TShape> | undefined;

/** The expiry half of a card as a validation entry point reads it: `CardInput`'s two members, each either the
 * number it declares or the digits in text, because the payment form holds what was typed. */
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

/** A review as its form holds it: `ReviewInput`'s members with the rating possibly unchosen. */
export type ReviewDraft = Omit<ReviewInput, "rating"> & {
  readonly rating: RatingValue | undefined;
};

/** The shipping step's submission: the address, the order's contact email and the delivery method. */
export interface ShippingSubmission {
  readonly address: AddressInput;
  readonly email: string;
  readonly shippingMethodId: string;
}

/** Whether a value counts as missing: `null`, `undefined` or blank text, not `0` or `false`. */
function isBlank(value: FieldValue): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.trim().length === 0;
}

/** The trimmed text of a value, or an empty string when it is not text at all. */
const textOf = (value: FieldValue): string => (typeof value === "string" ? value.trim() : "");

/** A value read as a whole number, or `undefined` for anything else — a fraction, a blank field, a
 * word. Text is read only when it is a signed integer with nothing around it. */
function integerOf(value: FieldValue): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  const text = textOf(value);
  if (text.length === 0 || !INTEGER_PATTERN.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

/** Whether a message is worth reporting: an empty one is the same as an absent one. */
const isReportable = (message: string | undefined): message is string =>
  typeof message === "string" && message.length > 0;

/** Builds the one-entry map every rule returns, dropping a message that is absent or empty. */
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
 * as nothing. `field` keys the map; `message` defaults to the required sentence. */
export function validateRequired(
  field: string,
  value: FieldValue,
  message: string = VALIDATION_MESSAGES.REQUIRED,
): FieldErrors {
  return isBlank(value) ? ruleErrors(field, message) : {};
}

/** The rule an email address is accepted by: something before a single `@` and a dotted domain whose last
 * label is two letters or more. The address is not lower-cased, so the form keeps what was typed. */
export function validateEmail(value: FieldValue): FieldErrors {
  const address = textOf(value);
  if (address.length === 0) return ruleErrors("email", VALIDATION_MESSAGES.REQUIRED);
  const malformed = address.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(address);
  return malformed ? ruleErrors("email", VALIDATION_MESSAGES.EMAIL_FORMAT) : {};
}

/** The rule a password is accepted by: the length and classes `PASSWORD_POLICY` in `src/constants/config.ts`
 * requires; never trimmed, kept or echoed, and blank reports as missing rather than as short. */
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

/** The rule a postal code is accepted by: the pattern its country declares in `src/constants/taxonomy.ts`,
 * compared without regard to case; a blank or unsupported country leaves the pattern to that field. */
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

/** The rule a phone number is accepted by: seven to fifteen digits, with an optional leading `+` and nothing
 * around them but spaces, brackets, dots and hyphens; optional on an address. Returns the `phone` map. */
export function validatePhone(value: FieldValue): FieldErrors {
  const phone = textOf(value);
  if (phone.length === 0) return {};
  const digits = digitsOf(phone).length;
  const phoneShaped = PHONE_PATTERN.test(phone) && digits >= PHONE_MIN_DIGITS;
  if (phoneShaped && digits <= PHONE_MAX_DIGITS) return {};
  return ruleErrors("phone", VALIDATION_MESSAGES.PHONE_FORMAT);
}

/** The rule a free-text field is accepted by: no control character in the value, and no more characters than
 * the bound its own field declares in {@link FREE_TEXT_LIMITS}. `field` keys the map; `required` says whether
 * an empty value breaks the required sentence, an optional member passing empty. Returns the field's map. */
function validateFreeText(
  field: string,
  value: FieldValue,
  max: number,
  required = true,
): FieldErrors {
  const text = textOf(value);
  if (text.length === 0) return required ? ruleErrors(field, VALIDATION_MESSAGES.REQUIRED) : {};
  if (hasControlCharacters(text)) return ruleErrors(field, VALIDATION_MESSAGES.CONTROL_CHARACTERS);
  return text.length > max ? ruleErrors(field, nameLengthMessage(max)) : {};
}

/** The rule a name is accepted by: two to {@link NAME_MAX_LENGTH} characters with at least one letter, so a
 * lone keystroke, a punctuation mark or a row of digits is not a person's name, and no control character.
 * `field` is the control's member name — `firstName`, `lastName`, `fullName`, `nameOnCard` — and keys the
 * map; `message` defaults to the sentence a name too short breaks. Returns the field's map. */
export function validateName(
  field: string,
  value: FieldValue,
  message: string = VALIDATION_MESSAGES.REQUIRED,
): FieldErrors {
  const name = textOf(value);
  if (name.length < NAME_MIN_LENGTH || !LETTER_PATTERN.test(name)) {
    return ruleErrors(field, message);
  }
  if (hasControlCharacters(name)) {
    return ruleErrors(field, VALIDATION_MESSAGES.CONTROL_CHARACTERS);
  }
  return name.length > NAME_MAX_LENGTH ? ruleErrors(field, nameLengthMessage(NAME_MAX_LENGTH)) : {};
}

/** The Luhn check a card number carries: from the rightmost digit leftward, every second digit is doubled and
 * reduced by nine above nine, and the digits must sum to a multiple of ten — what one mistyped digit or a
 * transposition breaks. `digits` are the number's digits alone, every other value failing the check. */
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
 * them, a correct Luhn check digit, and digits that are not all the same — no gateway authorises a
 * repeated-digit number. Approval is the demonstration seam's answer. Returns the `number` map. */
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
  if (REPEATED_DIGIT_PATTERN.test(digits)) {
    return ruleErrors("number", VALIDATION_MESSAGES.CARD_NUMBER);
  }
  return isLuhnValid(digits) ? {} : ruleErrors("number", VALIDATION_MESSAGES.CARD_NUMBER);
}

/** The rule a card expiry is accepted by: an integer month from 1 to 12, a four-digit year, and a pair that
 * has not passed — a card stays valid to the end of its expiry month. Each half is judged on its own, a
 * blank one breaking the required rule on its own key; a passed pair is filed on `expiryYear`, the half a
 * correction usually changes. `now` is the injectable instant measured against. Returns the faults' map. */
export function validateCardExpiry(
  value: FormValues<CardExpiryInput>,
  now: Date = new Date(),
): FieldErrors {
  const month = integerOf(value?.expiryMonth);
  const year = integerOf(value?.expiryYear);
  const monthUsable = month !== undefined && month >= MONTH_MIN && month <= MONTH_MAX;
  const yearUsable = year !== undefined && year >= EXPIRY_YEAR_MIN && year <= EXPIRY_YEAR_MAX;
  const faults = mergeErrors(
    ruleErrors("expiryMonth", monthUsable ? undefined : VALIDATION_MESSAGES.CARD_EXPIRY),
    ruleErrors("expiryYear", yearUsable ? undefined : VALIDATION_MESSAGES.CARD_EXPIRY),
    validateRequired("expiryMonth", value?.expiryMonth),
    validateRequired("expiryYear", value?.expiryYear),
  );
  if (monthUsable && yearUsable && now.getTime() >= new Date(year, month, 1).getTime()) {
    faults.expiryYear = VALIDATION_MESSAGES.CARD_EXPIRY;
  }
  return faults;
}

/** The rule a security code is accepted by: three or four digits and nothing else. */
export function validateCvc(value: FieldValue): FieldErrors {
  const cvc = textOf(value);
  if (cvc.length === 0) return ruleErrors("cvc", VALIDATION_MESSAGES.REQUIRED);
  const wrongShape = !DIGITS_PATTERN.test(cvc);
  const wrongLength = cvc.length < CVC_MIN_DIGITS || cvc.length > CVC_MAX_DIGITS;
  return wrongShape || wrongLength ? ruleErrors("cvc", VALIDATION_MESSAGES.CARD_SECURITY_CODE) : {};
}

/** The sentence a code outside the bounds is refused with, built once from them. */
const PROMO_CODE_LENGTH_MESSAGE = promoCodeLengthMessage(
  PROMO_CODE_MIN_LENGTH,
  PROMO_CODE_MAX_LENGTH,
);

/** The rule a promo code's shape is accepted by: four to sixteen upper-case letters or digits, the length
 * judged first so a code outside the bounds is refused as a length fault and only a right-length code
 * carrying another character breaks the character-class sentence. The value is not upper-cased here, because
 * the entry field normalises as the shopper types. Returns the `promoCode` map. */
export function validatePromoCodeShape(value: FieldValue): FieldErrors {
  const code = textOf(value);
  if (code.length === 0) return ruleErrors("promoCode", VALIDATION_MESSAGES.REQUIRED);
  if (code.length < PROMO_CODE_MIN_LENGTH || code.length > PROMO_CODE_MAX_LENGTH) {
    return ruleErrors("promoCode", PROMO_CODE_LENGTH_MESSAGE);
  }
  return PROMO_CODE_PATTERN.test(code)
    ? {}
    : ruleErrors("promoCode", VALIDATION_MESSAGES.PROMO_CODE_FORMAT);
}

/** The rule a quantity is accepted by: a whole number from one to `maxQuantity`, the stock on hand, read from
 * a number or from typed text, the message naming that ceiling. Returns the `quantity` map. */
export function validateQuantity(value: FieldValue, maxQuantity: number): FieldErrors {
  const quantity = integerOf(value);
  const outOfRange = quantity === undefined || quantity < 1 || quantity > maxQuantity;
  return outOfRange ? ruleErrors("quantity", quantityRangeMessage(maxQuantity)) : {};
}

/** The rule the catalogue's search term is accepted by: the free-text rule at
 * {@link FREE_TEXT_LIMITS.SEARCH_TERM_MAX} characters, the bound the search controls carry as their own
 * `maxLength`; `field` is the query parameter the term travels under, the `q` of
 * `src/utils/queryParams.ts`, and a blank term is no filter rather than a fault. */
export function validateSearchTerm(value: FieldValue, field = "q"): FieldErrors {
  return validateFreeText(field, value, FREE_TEXT_LIMITS.SEARCH_TERM_MAX, false);
}

/** The rule a review's title is accepted by: 3 to 80 characters once trimmed, the bounds in
 * {@link REVIEW_LIMITS}, each bound its own sentence; an empty title is missing, not badly sized. */
export function validateReviewTitle(value: FieldValue): FieldErrors {
  const title = textOf(value);
  if (title.length === 0) return ruleErrors("title", VALIDATION_MESSAGES.REQUIRED);
  const { TITLE_MIN, TITLE_MAX } = REVIEW_LIMITS;
  if (title.length < TITLE_MIN) return ruleErrors("title", reviewTitleTooShortMessage(TITLE_MIN));
  return title.length > TITLE_MAX ? ruleErrors("title", reviewTitleTooLongMessage(TITLE_MAX)) : {};
}

/** The rule a review's body is accepted by: 10 to 1,200 characters once trimmed, the bounds in
 * {@link REVIEW_LIMITS}, each bound its own sentence; an empty body is missing, not badly sized. */
export function validateReviewBody(value: FieldValue): FieldErrors {
  const body = textOf(value);
  if (body.length === 0) return ruleErrors("body", VALIDATION_MESSAGES.REQUIRED);
  const { BODY_MIN, BODY_MAX } = REVIEW_LIMITS;
  if (body.length < BODY_MIN) return ruleErrors("body", reviewBodyTooShortMessage(BODY_MIN));
  return body.length > BODY_MAX ? ruleErrors("body", reviewBodyTooLongMessage(BODY_MAX)) : {};
}

/** Whether a value is a whole rating from one to five, the review form's narrowing guard. */
export function isRatingValue(value: unknown): value is RatingValue {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** The rule a rating is accepted by: one of the five whole numbers, read from a number or text; an absent or
 * blank member alone reports as missing. Returns the `rating` map. */
export function validateRating(value: FieldValue): FieldErrors {
  if (isBlank(value)) return ruleErrors("rating", VALIDATION_MESSAGES.REQUIRED);
  const rating = integerOf(value);
  if (rating === undefined) return ruleErrors("rating", VALIDATION_MESSAGES.UNSUPPORTED_VALUE);
  return isRatingValue(rating) ? {} : ruleErrors("rating", VALIDATION_MESSAGES.OUT_OF_RANGE);
}

// Form rules -------------------------------------------------------------------------------------

/** The rule the country field is accepted by: one of the countries `src/constants/taxonomy.ts` declares,
 * compared without regard to case; a blank member reports as missing, an unknown one as unsupported. */
function validateCountry(value: FieldValue): FieldErrors {
  if (isBlank(value)) return ruleErrors("country", VALIDATION_MESSAGES.REQUIRED);
  return findCountry(textOf(value)) !== undefined
    ? {}
    : ruleErrors("country", VALIDATION_MESSAGES.UNSUPPORTED_VALUE);
}

/** The rule the delivery method is accepted by: one of the methods `src/constants/config.ts` declares. A
 * blank member reports as missing; an id naming no configured method takes the unsupported-value sentence.
 * Exported for `priceCart`, which judges that same member by it. */
export function validateShippingMethod(value: FieldValue): FieldErrors {
  if (isBlank(value)) return ruleErrors("shippingMethodId", VALIDATION_MESSAGES.REQUIRED);
  const id = textOf(value);
  return SHIPPING_METHODS.some((method) => method.id === id)
    ? {}
    : ruleErrors("shippingMethodId", VALIDATION_MESSAGES.UNSUPPORTED_VALUE);
}

/** The rule the registration form is submitted by: a well-formed email, a password meeting the policy, and a
 * first and last name. `marketingOptIn` is a choice and carries no rule, and a duplicate email is the store's
 * answer, arriving as a `409` whose field lands in this map. `input` is the body
 * `POST /api/auth/register` accepts; the result keys errors by its member names. */
export function validateRegistration(input: FormValues<RegistrationInput>): FieldErrors {
  return mergeErrors(
    validateEmail(input?.email),
    validatePassword(input?.password),
    validateName("firstName", input?.firstName),
    validateName("lastName", input?.lastName),
  );
}

/** The rule the sign-in form is submitted by: both members present, and the address's own shape once given.
 * The address is judged by {@link validateEmail}, so a mistyped one is reported on its own control rather
 * than only by the seam's form-level sentence; the rule reads the field and never an account, so nothing is
 * disclosed about the store. The password's policy is deliberately not judged — a returning visitor may hold
 * a password predating it and is to be told their credentials do not match — and both empty fields share one
 * generic sentence, so neither is singled out. A refused sign-in's message reaches this map through
 * {@link fieldErrorsFromApiError}. */
export function validateSignIn(input: FormValues<Credentials>): FieldErrors {
  return mergeErrors(validateEmail(input?.email), validateRequired("password", input?.password));
}

/** The rule the profile form is submitted by: a first and last name, and a phone number judged only when one
 * is given, since an empty number clears the stored one. The email, role, loyalty tier and addresses are not
 * editable here and carry no rule. `input` is the body `PATCH /api/customers/:id` accepts. */
export function validateProfileUpdate(input: FormValues<ProfileUpdateInput>): FieldErrors {
  return mergeErrors(
    validateName("firstName", input?.firstName),
    validateName("lastName", input?.lastName),
    validatePhone(input?.phone),
  );
}

/** The one address rule, used unchanged by the checkout's shipping step and the account address book, so a
 * delivery address and a saved address cannot disagree about what is valid. `fullName`, `line1`, `city`,
 * `region`, `postalCode` and `country` are required; `line2`, `phone` and `label` are optional. Every
 * free-text member — both lines, the city, the region and the label — is judged by {@link validateFreeText}:
 * bounded by {@link FREE_TEXT_LIMITS} and free of control characters. The result keys errors by
 * `AddressInput`'s members, so a form attaches each message to its own control. */
export function validateAddress(input: FormValues<AddressInput>): FieldErrors {
  return mergeErrors(
    validateName("fullName", input?.fullName),
    validateFreeText("line1", input?.line1, FREE_TEXT_LIMITS.LINE_MAX),
    validateFreeText("line2", input?.line2, FREE_TEXT_LIMITS.LINE_MAX, false),
    validateFreeText("city", input?.city, FREE_TEXT_LIMITS.PLACE_MAX),
    validateFreeText("region", input?.region, FREE_TEXT_LIMITS.PLACE_MAX),
    validateFreeText("label", input?.label, FREE_TEXT_LIMITS.LABEL_MAX, false),
    validatePostalCode(input?.postalCode, input?.country),
    validateCountry(input?.country),
    validatePhone(input?.phone),
  );
}

/** The rule the payment step is submitted by: a `card` must hold the cardholder's name, a number passing the
 * Luhn check, an expiry that has not passed and a three-to-four digit security code, while an `invoice`
 * carries no card and passes. Approval is not decided here: that is the demonstration seam's answer. The
 * result keys errors by `CardInput`'s members, the expiry filed by {@link validateCardExpiry} on the half
 * carrying the fault, and `now` is the instant it is measured against. */
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
 * and a body of 10 to 1,200, the bounds in {@link REVIEW_LIMITS}. `input` is the review as the form holds it,
 * with the rating possibly unchosen; the result is keyed by `rating`, `title` and `body`. */
export function validateReview(input: FormValues<ReviewDraft>): FieldErrors {
  return mergeErrors(
    validateRating(input?.rating),
    validateReviewTitle(input?.title),
    validateReviewBody(input?.body),
  );
}

/** The composite the checkout's shipping step is submitted by: the address rule, the contact email the order
 * records, and a delivery method chosen from the configured ones. The address's own keys are carried through
 * unchanged, so the form marks both its controls and the step-level ones from one map. */
export function validateShippingSubmission(input: FormValues<ShippingSubmission>): FieldErrors {
  return mergeErrors(
    validateAddress(input?.address),
    validateEmail(input?.email),
    validateShippingMethod(input?.shippingMethodId),
  );
}

// Error maps -------------------------------------------------------------------------------------

/** Whether a map holds any error at all, which is what a submit handler asks before it sends. */
export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(isReportable);
}

/** The first message a map holds, in the order its fields were set — the one a summary leads with. */
export function firstError(errors: FieldErrors): string | undefined {
  return Object.values(errors).find(isReportable);
}

/** Whether one field carries an error, so a control marks itself without reading the whole map. */
export function fieldErrored(errors: FieldErrors, field: string): boolean {
  return isReportable(errors[field]);
}

/** Combines maps into one, so a step's rule is composed from its parts: a later map replaces an earlier
 * message for a field they share, and the result holds every reportable message, at most one per field. */
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
 * message clears as the visitor corrects it. `errors` is the map to copy and `field` the field to clear; the
 * result is a new map with that key removed, leaving the map passed in untouched. */
export function clearFieldError(errors: FieldErrors, field: string): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field));
}

/** The map an `ApiError` becomes: a seam failure reaches the same shape a field rule returns, so a form
 * renders both alike. A failure naming a `field` is filed under it — how `src/lib/mockServer.ts`'s `422`
 * answers mark the control that caused them — and one naming none goes under {@link FORM_ERROR_KEY}, where a
 * form looks for the message shown above its fields. `fallbackMessage` is the sentence to show when the
 * failure carries none; the caller keeps the `ApiError` itself, which a page-level error state renders. */
export function fieldErrorsFromApiError(
  error: ApiError,
  fallbackMessage: string = FEEDBACK_COPY.ERROR_STATE_BODY,
): FieldErrors {
  const carried = textOf(error.message);
  const field = textOf(error.field);
  const message = carried.length > 0 ? carried : fallbackMessage;
  return { [field.length > 0 ? field : FORM_ERROR_KEY]: message };
}

/** The map a request outcome becomes: empty when the request succeeded, and the failure's own map when it
 * failed, so a caller handles both halves of a `Result` in one expression. */
export function fieldErrorsFromResult<TValue>(
  result: Result<TValue>,
  fallbackMessage?: string,
): FieldErrors {
  return result.ok ? {} : fieldErrorsFromApiError(result.error, fallbackMessage);
}
