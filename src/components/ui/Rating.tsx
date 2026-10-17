/**
 * Path: src/components/ui/Rating.tsx
 * Purpose: Rating display and input, the price tag with discount, and the quantity stepper
 * Lines: 536
 */

import { useId, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";

import { IconButton } from "@/components/ui/Button";
import { RadioGroup } from "@/components/ui/Select";
import { DEFAULT_CURRENCY } from "@/constants/config";
import {
  CART_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  lowStockLabel,
  quantityRangeMessage,
  ratingSummaryLabel,
} from "@/constants/content";
import type { RatingValue } from "@/types/catalog";
import type { CurrencyCode, MinorUnits, SelectOption } from "@/types/common";
import { clampNumber } from "@/utils/collections";
import type { AvailabilityLevel } from "@/utils/format";
import {
  formatAvailability,
  formatDiscount,
  formatMoney,
  formatQuantity,
  formatRating,
  formatReviewCount,
  formatScaledPercent,
} from "@/utils/format";

/**
 * The class contract this family renders against.
 *
 * No stylesheet may be imported here — `src/main.tsx` is the only importer of `src/styles/**` — so every class
 * below is consumed by name, and this list is what the sheets owe the file: `sp-rating` with its `__stars`,
 * `__star`, `__star--empty`, `__value` and `__count` for the display row; `sp-price` with its `__current`,
 * `__list` and `__discount` for the price tag; and `sp-quantity` with its `__button` and `__input` for the
 * stepper. `sp-rating__count` is declared in `src/styles/controls.css`, which owns the shared caption register
 * the rating's count line belongs to; `sp-visually-hidden` comes from `src/styles/base.css`; and the radio
 * group's own classes belong to `src/components/ui/Select.tsx`, which declares the contract for them.
 *
 * State is carried by attributes and pseudo-classes, never by a second class: `:disabled` on a stepper control,
 * `:checked` on a radio, and the rating's stars take their colour from the class the row gives each one, so
 * every attribute the sheets select on is set here rather than only a class.
 *
 * Two contracts of the rating family are decided here and must not be undone. The input variant draws its stars
 * inside the rows of the shared {@link RadioGroup}, so the target that sheet declares for a star button is not
 * what the input uses: the row carries `min-block-size: var(--touch-target-min)` and the radio carries the
 * checked state, which is why the star's own button rule and its `[aria-checked]` rule have no consumer in the
 * input path. And availability is styled per surface by `src/styles/catalog.css` — `.sp-product-card__stock` and
 * `.sp-product-detail__stock` with their `--low` and `--out` modifiers — so {@link PriceTag} states availability
 * only when the caller names the class its own sheet declares, and never invents one.
 */

// The rating, price and quantity vocabulary ------------------------------------------------------

/** The five star values the family offers, in order: `RatingValue` is exactly this union of literals. */
const STARS = [1, 2, 3, 4, 5] as const;

/** The glyph a star is drawn with, U+2605. Decoration in every path: the text carries the rating. */
const STAR_GLYPH = "★";

/** The floor a quantity may take: the product's rule is a whole number from one up to the line's ceiling. */
const MIN_QUANTITY = 1;

/** The unit one press of a stepper control moves the quantity by. */
const QUANTITY_STEP = 1;

/** The direction the decrement control moves the quantity in. */
const DECREMENT = -1;

/** The direction the increment control moves the quantity in. */
const INCREMENT = 1;

/** The glyph the decrement control draws: U+2212, the arithmetic minus rather than a hyphen. */
const DECREASE_GLYPH = "−";

/** The glyph the increment control draws. */
const INCREASE_GLYPH = "+";

/** What a typed quantity must look like to be committed: whole digits and nothing else, so no fraction, no
 *  exponent and no sign reaches the field's value. */
const WHOLE_DIGITS = /^[0-9]+$/;

/** The class `src/styles/base.css` gives an element that stays in the accessibility tree and is never painted. */
const VISUALLY_HIDDEN = "sp-visually-hidden";

/** The modifier each availability level appends to the class its caller's sheet declares, which is how
 *  `src/styles/catalog.css` names the low and out states. The in-stock level carries none. */
const STOCK_LEVEL_MODIFIERS: Readonly<Record<AvailabilityLevel, string>> = {
  "in-stock": "",
  "low-stock": "--low",
  "out-of-stock": "--out",
};

/** The stars a radio option stands for, in the order the group renders them. The value is the star as text, so
 *  it round-trips through the group's string contract, and the label is the numeral that names each radio. */
const STAR_OPTIONS: readonly SelectOption[] = STARS.map((star) => ({
  value: String(star),
  label: String(star),
}));

// Private helpers ---------------------------------------------------------------------------------

/** Joins the classes a control carries, dropping the absent ones so no stray space reaches the attribute. */
function joinClassNames(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/** The text a caller supplied, or the fallback when it supplied none or only spaces: an empty sentence names
 *  nothing, so it is never the accessible text of a rating. */
function textOr(candidate: string | undefined, fallback: string): string {
  return candidate !== undefined && candidate.trim() !== "" ? candidate : fallback;
}

/** The star a radio option's value stands for, or `null` when the value names none of the five. */
function starValueOf(optionValue: string): RatingValue | null {
  return STARS.find((star) => String(star) === optionValue) ?? null;
}

/** The class one star carries: the rating colour while it is filled, muted while it is not. */
function starClass(isFilled: boolean): string {
  return joinClassNames("sp-rating__star", !isFilled && "sp-rating__star--empty");
}

/** How many stars an average fills: the nearest whole star, never fewer than none and never more than the row.
 *  The average itself is never changed — the glyph row is decoration and the value's own text carries it. */
function filledStars(average: number): number {
  return Number.isFinite(average) ? clampNumber(Math.round(average), 0, STARS.length) : 0;
}

/** One star of a row: filled up to the value's whole stars and muted above them. */
function renderStar(star: number, filled: number): ReactElement {
  return (
    <span className={starClass(star <= filled)} key={star} aria-hidden="true">
      {STAR_GLYPH}
    </span>
  );
}

/** The sentence an availability level reads, in the library's own words, so no surface writes its own. Only the
 *  low level reads the count, and that level is reached through a stock pair, so the figure is there. */
function stockLabel(level: AvailabilityLevel, stockOnHand: number | null): string {
  switch (level) {
    case "in-stock":
      return CATALOG_COPY.IN_STOCK_LABEL;
    case "low-stock":
      return lowStockLabel(stockOnHand ?? MIN_QUANTITY);
    case "out-of-stock":
      return CATALOG_COPY.OUT_OF_STOCK_LABEL;
  }
}

/** The classes an availability line carries: the class the caller's own sheet declares for it, plus that
 *  class's own level modifier when the product is low on stock or out of it. */
function stockClasses(base: string, level: AvailabilityLevel): string {
  const modifier = STOCK_LEVEL_MODIFIERS[level];
  return joinClassNames(base, modifier.length > 0 && `${base}${modifier}`);
}

// Rating -----------------------------------------------------------------------------------------

/** Everything {@link Rating} accepts. */
export interface RatingProps {
  /** The average to show, as the product or a review carries it: `4.5` fills four stars and reads `4.5`. */
  readonly value: number;
  /** How many reviews the average was taken from. Given it, the count is shown and the accessible sentence
   *  carries both figures; without it only the value is stated. */
  readonly count?: number;
  /** Draws the numeric value beside the stars. Without it the stars and the count are what a sighted reader
   *  sees, and the value remains the accessible text. */
  readonly showValue?: boolean;
  /** Replaces the accessible sentence for a caller that has a fuller description of its own. */
  readonly label?: string;
  /** Class names added to the row's own, for the surface's alignment. */
  readonly className?: string;
}

/**
 * A rating as the catalogue carries it: a row of five stars, the value as text and, when a count is given, the
 * number of reviews.
 *
 * The value is text first and the stars are decoration, because a rating a reader can only see as filled shapes
 * is unreadable to assistive technology and unusable in a greyscale or colour-blind rendering. One sentence
 * therefore carries the whole figure — the reviewer count and the average together when both are known, which is
 * the sentence `src/constants/content.ts` composes, or the formatted value when the caller gave no count — and
 * the visible figures beside the stars are hidden from assistive technology so that sentence is read once rather
 * than three times. A caller with a fuller description passes `label` and it replaces that sentence.
 *
 * @param props - The average, the optional review count, whether the value is drawn, the sentence override and
 *   the row's extra classes.
 * @returns The rating row, with its stars, its text and one accessible sentence.
 */
export function Rating({
  value,
  count,
  showValue = false,
  label,
  className,
}: RatingProps): ReactElement {
  const display = formatRating(value, count);
  const filled = filledStars(display.average);
  const sentence =
    count === undefined ? display.value : ratingSummaryLabel(display.value, display.count);

  return (
    <span className={joinClassNames("sp-rating", className)}>
      <span className="sp-rating__stars" aria-hidden="true">
        {STARS.map((star) => renderStar(star, filled))}
      </span>
      {showValue ? (
        <span className="sp-rating__value" aria-hidden="true">
          {display.value}
        </span>
      ) : null}
      {count === undefined ? null : (
        <span className="sp-rating__count" aria-hidden="true">
          {formatReviewCount(display.count)}
        </span>
      )}
      <span className={VISUALLY_HIDDEN}>{textOr(label, sentence)}</span>
    </span>
  );
}

// Rating input -----------------------------------------------------------------------------------

/** Everything {@link RatingInput} accepts. */
export interface RatingInputProps {
  /** The star that is chosen, or `null` while nothing has been chosen — an untouched review form has no
   *  rating rather than a zero one. */
  readonly value: RatingValue | null;
  /** Called with the star the shopper picked. It is always a whole star, so no caller has to check one. */
  readonly onChange: (value: RatingValue) => void;
  /** The group's name, drawn as its legend and read before the stars. */
  readonly label: string;
  /** A supporting line under the legend, read after the name. */
  readonly hint?: string;
  /** The group's message, rendered as the alert the field anatomy uses. The rule behind it — a whole star from
   *  one to five — belongs to `src/utils/validation.ts`, not here. */
  readonly error?: string;
  /** The name the five radios share; a generated one is used when it is omitted. */
  readonly name?: string;
  /** Disables every star. */
  readonly isDisabled?: boolean;
  /** Class names added to the group's own, for a form's field grid. */
  readonly className?: string;
}

/**
 * The rating a shopper gives a product: five stars, each one a radio of a single group.
 *
 * The group is the shared {@link RadioGroup} rather than five clickable shapes, which is what gives the control
 * a legend, native arrow-key selection, one tab stop, an invalid state and the error wiring every other field in
 * the product has — a row of spans would have to reproduce all of it and would still be unusable by keyboard.
 * Each row's label holds the star as decoration and the numeral as the radio's accessible name, so a screen
 * reader hears "four" for the fourth star, and the star the group reports as checked is the only one carrying
 * the rating colour.
 *
 * @param props - The chosen star and its change handler, the group's legend, its auxiliary text, the shared
 *   radio name, the disabled state and the group's extra classes.
 * @returns The fieldset the radios live in, with its legend, its stars and its messages.
 */
export function RatingInput({
  value,
  onChange,
  label,
  hint,
  error,
  name,
  isDisabled = false,
  className,
}: RatingInputProps): ReactElement {
  const generatedId = useId();
  const chosen = value === null ? "" : String(value);

  /** Commits the star an option stands for; a value naming no star is ignored rather than guessed at. */
  const handleChange = (optionValue: string): void => {
    const star = starValueOf(optionValue);
    if (star !== null) onChange(star);
  };

  return (
    <RadioGroup
      id={generatedId}
      name={name ?? generatedId}
      legend={label}
      value={chosen}
      onChange={handleChange}
      options={STAR_OPTIONS}
      hint={hint}
      error={error}
      orientation="horizontal"
      isDisabled={isDisabled}
      containerClassName={className}
      renderOptionLabel={(option) => (
        <>
          <span className={starClass(chosen === option.value)} aria-hidden="true">
            {STAR_GLYPH}
          </span>
          <span className={VISUALLY_HIDDEN}>{option.label}</span>
        </>
      )}
    />
  );
}

// Price ------------------------------------------------------------------------------------------

/** Everything {@link PriceTag} accepts. */
export interface PriceTagProps {
  /** The price in integer minor units, as `Product.priceMinor` and `OrderLine.unitPriceMinor` carry it. */
  readonly priceMinor: MinorUnits;
  /** The list price in minor units. A figure above the price is what renders the struck price and the
   *  discount; an absent, equal or lower one renders neither. */
  readonly listPriceMinor?: MinorUnits;
  /** The currency the figures are shown in; the product's single currency unless a caller names another. */
  readonly currency?: CurrencyCode;
  /** Whether the product can be bought. Read only when no stock figures are given, where it is the caller's
   *  only statement of availability. */
  readonly isAvailable?: boolean;
  /** What is on hand. Given together with {@link PriceTagProps.lowStockThreshold}, these figures decide the
   *  availability level through `src/utils/format.ts` and win over {@link PriceTagProps.isAvailable}. */
  readonly stockOnHand?: number;
  /** The level at or below which stock is called low. Read with {@link PriceTagProps.stockOnHand}. */
  readonly lowStockThreshold?: number;
  /** The class the caller's own sheet declares for the availability line, which is how a surface states
   *  availability in its own register — the catalogue tile's `.sp-product-card__stock`, the buy column's
   *  `.sp-product-detail__stock`. Given it, the line is rendered with that class and its `--low` or `--out`
   *  modifier; without it the caller renders availability itself and no line appears here. */
  readonly stockClassName?: string;
  /** Class names added to the tag's own, for the surface's layout. */
  readonly className?: string;
}

/**
 * A price, what it saves and whether the product can be bought.
 *
 * Every figure leaves this component as text: the minor units arrive as integers, `src/utils/format.ts` renders
 * them and no arithmetic happens here at all, so a price cannot drift on its way to the screen and the single
 * rounding rule stays in one place. The saving is stated twice over — the list price is a real `<s>` element
 * and the discount is the library's own figure, so neither the strikethrough nor a colour is the only carrier of
 * it. A saving that rounds to no whole percentage renders the struck price alone, because the percentage a badge
 * would state is the library's figure and this component states none of its own.
 *
 * @param props - The price and optional list price, the currency, the availability inputs, the class the
 *   caller's sheet declares for the availability line, and the tag's extra classes.
 * @returns The price tag, with its current price and whatever of the rest the figures justify.
 */
export function PriceTag({
  priceMinor,
  listPriceMinor,
  currency,
  isAvailable = true,
  stockOnHand,
  lowStockThreshold,
  stockClassName,
  className,
}: PriceTagProps): ReactElement {
  const shownCurrency = currency ?? DEFAULT_CURRENCY;
  const listPrice =
    listPriceMinor !== undefined && listPriceMinor > priceMinor ? listPriceMinor : null;
  const discount = listPrice === null ? 0 : formatDiscount(listPrice, priceMinor);
  const hasStockPair = stockOnHand !== undefined && lowStockThreshold !== undefined;
  const availability = hasStockPair ? formatAvailability(stockOnHand, lowStockThreshold) : null;
  const level: AvailabilityLevel =
    availability === null ? (isAvailable ? "in-stock" : "out-of-stock") : availability.status;

  return (
    <span className={joinClassNames("sp-price", className)}>
      <span className="sp-price__current">{formatMoney(priceMinor, shownCurrency)}</span>
      {listPrice === null ? null : (
        <>
          <s className="sp-price__list">{formatMoney(listPrice, shownCurrency)}</s>
          {discount > 0 ? (
            <span className="sp-price__discount">
              {`${CART_COPY.SUMMARY_DISCOUNT_LABEL} ${formatScaledPercent(discount, 0)}`}
            </span>
          ) : null}
        </>
      )}
      {stockClassName === undefined ? null : (
        <span className={stockClasses(stockClassName, level)}>
          {stockLabel(level, availability === null ? null : availability.stockOnHand)}
        </span>
      )}
    </span>
  );
}

// Quantity ---------------------------------------------------------------------------------------

/** Everything {@link QuantityStepper} accepts. */
export interface QuantityStepperProps {
  /** How many the caller holds, as `CartLine.quantity` carries it. */
  readonly value: number;
  /** Called with the quantity to hold, which is always between one and {@link QuantityStepperProps.max}. */
  readonly onChange: (value: number) => void;
  /** The most that may be held: the line's `maxQuantity`, copied from stock when the line was created. The
   *  control refuses to go past it, which is the visible half of the bound the cart reducer enforces. */
  readonly max: number;
  /** The field's label, which is also the name assistive technology gives it. */
  readonly label: string;
  /** Disables the whole control. */
  readonly isDisabled?: boolean;
  /** Class names added to the control's own, for the surface's layout. */
  readonly className?: string;
}

/**
 * How many of something to buy: a decrement control, the quantity as a number and an increment control.
 *
 * The value is text first, so the quantity is readable, typeable and correctable, and both buttons are real
 * buttons with names of their own, so the field is usable from the keyboard and by touch. Every path — either
 * button, a typed figure and a pasted one — is confined by the same bounds through `src/utils/collections.ts`,
 * so the control cannot report a quantity outside the range it announces; and the two controls that would
 * leave that range report themselves unavailable and do nothing, which is what makes the bound visible without
 * taking the keyboard user's focus away from the field they were stepping.
 *
 * A typed entry is committed as it is typed and normalised when the field is left or Enter is pressed: text
 * holding no whole number — an empty field, letters, a fraction, a sign — commits nothing and the field falls
 * back to the value it is holding, so the control never reports a quantity that is not a whole number. While a
 * figure is typed the field shows what was typed even where the committed value was clamped, so the field never
 * fights the typist; the caller's own clamp remains the enforcement, and this control's is what the shopper sees.
 * The bound is carried twice: the field's own minimum and maximum state the range as the platform announces it,
 * and a described-by line the library phrases says it in words, so the ceiling is never implicit. The control
 * states no quantity of its own beyond what it is given: line totals, discounts and every other figure belong to
 * `src/lib/pricingService.ts`, and what a quantity does to the cart belongs to `CartContext`.
 *
 * @param props - The current quantity and its change handler, the ceiling stock sets, the field's label, the
 *   disabled state and the control's extra classes.
 * @returns The stepper, with its two controls, its labelled field and its announced bound.
 */
export function QuantityStepper({
  value,
  onChange,
  max,
  label,
  isDisabled = false,
  className,
}: QuantityStepperProps): ReactElement {
  const inputId = useId();
  const boundsId = `${inputId}-bounds`;
  const [draft, setDraft] = useState<string | null>(null);
  // A ceiling that is not a finite number, or is below the floor, leaves the control offering the single unit
  // the rule's floor allows rather than an inverted range.
  const ceiling = Number.isFinite(max) ? Math.max(MIN_QUANTITY, Math.trunc(max)) : MIN_QUANTITY;
  const current = clampNumber(value, MIN_QUANTITY, ceiling);
  const shown = draft ?? formatQuantity(current);

  /** Reports the quantity a control asked for, confined to the bounds, and only when it is a change. */
  const commit = (next: number): void => {
    const clamped = clampNumber(next, MIN_QUANTITY, ceiling);
    if (clamped !== current) onChange(clamped);
  };

  /** Moves the quantity one step, clearing whatever was typed so the field shows the committed figure. */
  const stepBy = (direction: number): void => {
    setDraft(null);
    commit(current + direction * QUANTITY_STEP);
  };

  /** Keeps what was typed, and commits it when it is a whole number: anything else falls back to the value. */
  const handleInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const typed = event.target.value;
    setDraft(typed);
    if (!WHOLE_DIGITS.test(typed)) return;
    commit(Number(typed));
  };

  /** Leaving the field normalises it, so what it shows is what it holds. */
  const handleBlur = (): void => {
    setDraft(null);
  };

  /** Enter normalises the field without leaving it, as leaving it would. */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") setDraft(null);
  };

  return (
    <span className={joinClassNames("sp-quantity", className)}>
      <label className={VISUALLY_HIDDEN} htmlFor={inputId}>
        {label}
      </label>
      <IconButton
        variant="ghost"
        className="sp-quantity__button"
        icon={DECREASE_GLYPH}
        label={`${label}: ${COMMON_ACTIONS.REMOVE}`}
        onClick={() => stepBy(DECREMENT)}
        disabled={isDisabled}
        // BLITZY [A11Y]: a control at the floor reports itself unavailable through `aria-disabled` rather than the
        // native attribute, because the native one removes the control from the tab order the moment it is reached
        // and a keyboard user who stepped down to the floor would lose their place. The sheet dims both spellings
        // and the handler is inert at the floor either way; a caller disabling the whole control still sets the
        // native attribute, so nothing inside a disabled stepper is reachable at all.
        aria-disabled={isDisabled || current === MIN_QUANTITY ? true : undefined}
      />
      <input
        id={inputId}
        className="sp-quantity__input"
        type="number"
        inputMode="numeric"
        min={MIN_QUANTITY}
        max={ceiling}
        step={QUANTITY_STEP}
        value={shown}
        disabled={isDisabled}
        aria-describedby={boundsId}
        onChange={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      <IconButton
        variant="ghost"
        className="sp-quantity__button"
        icon={INCREASE_GLYPH}
        label={`${label}: ${COMMON_ACTIONS.ADD}`}
        onClick={() => stepBy(INCREMENT)}
        disabled={isDisabled}
        // The ceiling reports itself the way the floor does, and for the same reason: see the decrement control.
        aria-disabled={isDisabled || current === ceiling ? true : undefined}
      />
      <span className={VISUALLY_HIDDEN} id={boundsId}>
        {quantityRangeMessage(ceiling)}
      </span>
    </span>
  );
}
