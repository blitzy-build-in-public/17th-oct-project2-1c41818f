/**
 * Path: src/components/ui/Input.tsx
 * Purpose: Input, text area and form field wrapper with label, hint, required and error handling
 * Lines: 549
 */

import { useId, useState } from "react";
import type { ChangeEvent, ComponentPropsWithRef, ReactElement, ReactNode } from "react";

import type { FieldErrors } from "@/types/common";

// The field contract ------------------------------------------------------------------------------

/**
 * What {@link FormField} hands to the control it wraps.
 *
 * The field can hand this over only because it does not render the control itself: the render prop's
 * caller does. `id` is what the label points at with `htmlFor`, `describedBy` is the id list the
 * control puts on `aria-describedby`, and the three flags map onto `aria-invalid`, the native
 * `required` and the native `disabled` attributes. `isDisabled` completes the pair `isRequired`
 * starts, for the same reason: the field cannot set either attribute on a control it does not own.
 *
 * The individual ids travel alongside the joined list so that a control carrying auxiliary text of
 * its own — the text area's character counter, an addon that carries words — extends the described-by
 * list in the field's order instead of guessing it.
 *
 * Exported because every control family that renders inside a field shares this one contract:
 * `Select.tsx` declares its controls against it rather than inventing a second shape.
 */
export interface FieldControlProps {
  /** The identifier the control carries and the label points at. */
  readonly id: string;
  /** The ids the control puts on `aria-describedby`, or `undefined` when it has none. */
  readonly describedBy: string | undefined;
  /** Whether the control marks itself `aria-invalid`. */
  readonly isInvalid: boolean;
  /** Whether the control carries the native `required` attribute. */
  readonly isRequired: boolean;
  /** Whether the control carries the native `disabled` attribute. */
  readonly isDisabled: boolean;
  /** The hint element's id, or `undefined` when the field renders no hint. */
  readonly hintId: string | undefined;
  /**
   * The id of the element carrying the field's message, or `undefined` when the field renders none.
   * That element is what the control points at with `aria-describedby`, so the message reaches
   * assistive technology as the control's own description rather than as a live region of its own.
   */
  readonly errorId: string | undefined;
}

/** Everything {@link FormField} accepts. */
export interface FormFieldProps {
  /** The control's id; a generated one is used when it is omitted, so two fields cannot collide. */
  readonly id?: string;
  /** The field's label, which is the control's accessible name. */
  readonly label: string;
  /** A supporting line under the control, read after the name. */
  readonly hint?: string;
  /** The field's message; its presence is what marks the control invalid. */
  readonly error?: string;
  /** Renders the visible required marker; the state itself is the control's native `required`. */
  readonly required?: boolean;
  /** Renders the control in its disabled state. */
  readonly isDisabled?: boolean;
  /** Class names added to the field's own, for the layout the caller places it in. */
  readonly className?: string;
  /** The control to render, given the contract above. */
  readonly children: (field: FieldControlProps) => ReactNode;
}

/**
 * Everything {@link Input} accepts: every attribute of a native `<input>` except the two the field
 * owns, plus the label, the auxiliary text, the form-wide error map and the addon slots.
 */
export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "id" | "children"> {
  /** The control's id; a generated one is used when it is omitted. */
  readonly id?: string;
  /** The field's label. */
  readonly label: string;
  /** A supporting line under the control. */
  readonly hint?: string;
  /** This field's message, which wins over {@link InputProps.errors}. */
  readonly error?: string;
  /** A whole form's error map, read through {@link InputProps.name}. */
  readonly errors?: FieldErrors;
  /** Disables the control; wins over a native `disabled` passed alongside it. */
  readonly isDisabled?: boolean;
  /** Content rendered before the control inside the field's control slot. */
  readonly leadingAddon?: ReactNode;
  /** Content rendered after the control inside the field's control slot. */
  readonly trailingAddon?: ReactNode;
  /** Class names added to the field wrapper's own, for a form's field grid. */
  readonly containerClassName?: string;
}

/**
 * Everything {@link TextArea} accepts: every attribute of a native `<textarea>` except the two the
 * field owns, plus the same label, auxiliary text, error map and addon slots an input takes, and the
 * two properties a multi-line field adds — its row count and its character counter.
 */
export interface TextAreaProps extends Omit<ComponentPropsWithRef<"textarea">, "id" | "children"> {
  /** The control's id; a generated one is used when it is omitted. */
  readonly id?: string;
  /** The field's label. */
  readonly label: string;
  /** A supporting line under the control. */
  readonly hint?: string;
  /** This field's message, which wins over {@link TextAreaProps.errors}. */
  readonly error?: string;
  /** A whole form's error map, read through {@link TextAreaProps.name}. */
  readonly errors?: FieldErrors;
  /** Disables the control; wins over a native `disabled` passed alongside it. */
  readonly isDisabled?: boolean;
  /** Rows to render before the field scrolls; four when it is omitted. */
  readonly rows?: number;
  /** Renders a counter of the characters written, counted against `maxLength`. */
  readonly showCount?: boolean;
  /** Content rendered before the control inside the field's control slot. */
  readonly leadingAddon?: ReactNode;
  /** Content rendered after the control inside the field's control slot. */
  readonly trailingAddon?: ReactNode;
  /** Class names added to the field wrapper's own, for a form's field grid. */
  readonly containerClassName?: string;
}

// Private helpers ---------------------------------------------------------------------------------

/** True for a string that holds something a visitor can read: neither absent nor blank. */
function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** Joins the class names a component renders, dropping the absent ones so no stray space is emitted. */
function classNames(...names: readonly (string | undefined)[]): string {
  return names.filter(isPresent).join(" ");
}

/** The ids one field can describe its control by, in the order a screen reader reads them. */
interface DescribedByIds {
  /** The leading addon's element id, when that addon carries words. */
  readonly leadingAddonId?: string | undefined;
  /** The hint's element id, when the field renders one. */
  readonly hintId?: string | undefined;
  /** The error's element id, when the field renders one. */
  readonly errorId?: string | undefined;
  /** A control's own auxiliary element — the text area's counter — when it renders one. */
  readonly countId?: string | undefined;
  /** The trailing addon's element id, when that addon carries words. */
  readonly trailingAddonId?: string | undefined;
}

/**
 * Builds an `aria-describedby` value from the ids a control is currently described by, in reading
 * order — the leading addon's words, the hint, then the error, then any auxiliary count, then the
 * trailing addon's words — so an addon read as a prefix to the value is announced before it and one
 * read as the value's unit after it, while the field's own help still precedes its complaint and an
 * absent id contributes nothing at all.
 *
 * The result is `undefined` rather than an empty string when nothing describes the control, because
 * an empty `aria-describedby` is a wiring mistake a reader cannot see. Called by {@link FormField}
 * for the contract it hands its control, and again by {@link Input} and {@link TextArea} once they
 * hold addon ids — and the text area a count id of its own.
 */
function composeDescribedBy(ids: DescribedByIds): string | undefined {
  const described = [
    ids.leadingAddonId,
    ids.hintId,
    ids.errorId,
    ids.countId,
    ids.trailingAddonId,
  ].filter(isPresent);
  return described.length === 0 ? undefined : described.join(" ");
}

/**
 * Picks the message a field shows: the one passed to the field, or the one a form's error map holds
 * under the field's own name. The field's own message wins, so a page can override a single field of
 * a form-wide map without rebuilding the map around it.
 *
 * Both are read as absent when blank, because an empty message would render an error paragraph with
 * nothing in it and mark the control invalid for no reason a visitor could act on.
 */
function resolveErrorMessage(
  explicit: string | undefined,
  fromMap: string | undefined,
): string | undefined {
  if (isPresent(explicit)) return explicit;
  return isPresent(fromMap) ? fromMap : undefined;
}

/**
 * Counts the characters a text field holds, for the counter a field with both `showCount` and
 * `maxLength` renders. An absent value is nothing written yet, and the array form a native control
 * allows is joined before it is counted, so the counter can never be a frame behind the field.
 */
function textLengthOf(value: string | number | readonly string[] | undefined): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return String(value).length;
  if (value === undefined) return 0;
  return value.join("").length;
}

/**
 * The words an addon contributes to its field's description, or `undefined` when it contributes none.
 *
 * An addon made of text carries meaning for the field — "USD" is the unit the value is in and "%" is
 * what it is measured by — so it is announced as part of the control's description, beside the
 * field's help and its message. An addon made of elements is deliberately not described: only the
 * caller knows what its element holds, and a field described by a control inside it would read that
 * control's name as though it were the field's own. A blank addon is nothing to read.
 */
function addonWords(addon: ReactNode): string | undefined {
  if (typeof addon !== "string" && typeof addon !== "number") return undefined;
  const words = String(addon);
  return isPresent(words) ? words : undefined;
}

/**
 * Renders one addon slot of a field — a unit, a prefix, or a small control the field carries beside
 * its own — with the id the control can point at it through.
 *
 * The class is declared in `src/styles/controls.css`, which owns the field family, so the addon is
 * named by the sheet instead of borrowing the auxiliary-text register the hint uses. Only an addon
 * carrying words joins the control's description — see {@link addonWords} — while the id is on the
 * element either way, so the slot itself stays addressable.
 */
function renderAddon(addon: ReactNode, id: string): ReactElement | null {
  return addon === undefined || addon === null ? null : (
    <span className="sp-field__addon" id={id}>
      {addon}
    </span>
  );
}

// The field ---------------------------------------------------------------------------------------

/**
 * Renders one field's anatomy around whatever control its caller supplies: the label bound to the
 * control's id, the required marker, the control's slot, the hint and the error.
 *
 * The control arrives through a render prop because the field cannot reach into it — only the caller
 * knows whether it renders an `<input>`, a `<textarea>` or a group of controls, and the control is
 * the element that has to carry `id`, `aria-describedby` and `aria-invalid`. Handing the contract
 * back this way is what lets every control family share one label, hint and error treatment instead
 * of restating it, and it is why {@link FieldControlProps} is exported.
 *
 * A required field states it two ways, each with one home: the native `required` attribute on the
 * control carries the state, and the asterisk beside the label marks it for sighted users. The
 * asterisk is hidden from assistive technology, and no wording joins the label, because a control's
 * accessible name has to be its label alone — a field that is missing a value says so through its own
 * error paragraph, which is the control's description and speaks when the reader reaches the control.
 * The label still ends with that marker, so a query for a required field's name matches the copy as a
 * pattern rather than as the exact string.
 *
 * The message is the control's description and nothing more: the paragraph carries the id the control
 * names in `aria-describedby`, so a visitor hears it on reaching the control and again on returning to
 * it, while the summary a form renders above its fields is the one region that announces a refused
 * submit. Marking the paragraph an alert as well would speak the same failure twice, and eight times
 * over a form whose fields are all empty.
 *
 * @param props - The field's label, optional hint and error, the required and disabled flags, an
 *   optional class name and the control to render; `id` falls back to a generated one.
 * @returns The field's markup, with the caller's control inside it.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  isDisabled = false,
  className,
  children,
}: FormFieldProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = isPresent(hint) ? `${controlId}-hint` : undefined;
  const errorId = isPresent(error) ? `${controlId}-error` : undefined;
  const field: FieldControlProps = {
    id: controlId,
    describedBy: composeDescribedBy({ hintId, errorId }),
    isInvalid: errorId !== undefined,
    isRequired: required,
    isDisabled,
    hintId,
    errorId,
  };

  return (
    <div className={classNames("sp-field", className)}>
      <label className="sp-field__label" htmlFor={controlId}>
        {label}
        {required ? (
          <>
            {" "}
            <span className="sp-field__required" aria-hidden="true">
              *
            </span>
          </>
        ) : null}
      </label>
      <div className="sp-field__control">{children(field)}</div>
      <FieldHint id={hintId} text={hint} />
      <FieldError id={errorId} text={error} />
    </div>
  );
}

/**
 * Everything {@link FieldHint} and {@link FieldError} accept: the id the control describes itself by and the
 * wording the row carries.
 */
export interface FieldRowProps {
  /** The element's id, which is the one the field puts on its control's `aria-describedby`. */
  readonly id?: string;
  /** The row's wording; absent, the row renders empty rather than missing. */
  readonly text?: string;
}

/**
 * The field's hint row: the supporting line the whole field family renders under a control.
 *
 * Exported beside {@link FormField} so the row is written once for the controls that a field wraps and for the
 * ones that render their own anatomy around it. `src/components/ui/Select.tsx` composes a checkbox, a radio
 * group and a switch outside this field, and imports this row — and {@link FieldError} — rather than restating
 * either.
 *
 * The row exists only while it has an id, because the id is what the control points at through
 * `aria-describedby` and a hint nothing describes is read by nobody; the text falls back to an empty string, so
 * a row whose wording is missing renders nothing rather than the word `undefined`.
 *
 * @param props - The row's id and its wording, both optional; with no id the row renders nothing at all.
 * @returns The `sp-field__hint` paragraph, or `null` when no id was given.
 */
export function FieldHint({ id, text }: FieldRowProps): ReactElement | null {
  if (id === undefined) return null;
  return (
    <p className="sp-field__hint" id={id}>
      {text ?? ""}
    </p>
  );
}

/**
 * The field's error row: the message that states what is wrong with a field's value.
 *
 * The row carries no live role of its own. It is the control's description: the id-guard is the one
 * {@link FieldHint} applies, and the field puts this id on the control's `aria-describedby` while the row
 * exists, which is also the state the control's `aria-invalid` reports. A submit that refuses a whole step
 * announces itself once, through the one summary region the form renders above its fields; a live role here
 * would speak the same failure again from every invalid field — eight times over an empty form.
 *
 * @param props - The row's id and its message, both optional; with no id the row renders nothing at all.
 * @returns The `sp-field__error` paragraph, or `null` when no id was given.
 */
export function FieldError({ id, text }: FieldRowProps): ReactElement | null {
  if (id === undefined) return null;
  return (
    <p className="sp-field__error" id={id}>
      {text ?? ""}
    </p>
  );
}

// The controls ------------------------------------------------------------------------------------

/**
 * A single-line text field: the `<input>` itself with its label, hint, error and addon slots.
 *
 * Every attribute of a native `<input>` passes straight through, `ref` included — React 19 takes a
 * ref as an ordinary prop, so no wrapper stands between the caller and the element, and the element
 * a caller holds is the one the browser focuses. What this component adds is the wiring an input
 * cannot do alone: the id its label points at, `aria-describedby` for the hint, for the error and for
 * any addon that carries words, `aria-invalid` for the invalid state, and the required and disabled
 * attributes.
 *
 * The field's message is `error` when it is given, and otherwise `errors[name]` — the field-keyed map
 * every validator in `src/utils/validation.ts` returns — so a form spreads one map over its fields
 * and no page has to thread a message per field. No rule is applied and no message is written here:
 * this component renders the message it is handed.
 *
 * @param props - The field's label and auxiliary text, the form-wide error map, the addon slots and
 *   the control's own native attributes. `isDisabled` is this component's name for the disabled
 *   state; a native `disabled` works too and is overridden by `isDisabled` when both are given.
 * @returns The field, with the input inside it.
 */
export function Input({
  id,
  label,
  hint,
  error,
  errors,
  name,
  required,
  isDisabled,
  disabled,
  leadingAddon,
  trailingAddon,
  containerClassName,
  className,
  ...rest
}: InputProps): ReactElement {
  const isFieldDisabled = isDisabled ?? disabled ?? false;
  const message = resolveErrorMessage(error, name === undefined ? undefined : errors?.[name]);

  return (
    <FormField
      id={id}
      label={label}
      hint={hint}
      error={message}
      required={required ?? false}
      isDisabled={isFieldDisabled}
      className={containerClassName}
    >
      {(field) => {
        const leadingAddonId = `${field.id}-addon-leading`;
        const trailingAddonId = `${field.id}-addon-trailing`;
        return (
          <>
            {renderAddon(leadingAddon, leadingAddonId)}
            <input
              {...rest}
              id={field.id}
              name={name}
              className={classNames("sp-input", className)}
              disabled={field.isDisabled}
              required={field.isRequired}
              aria-invalid={field.isInvalid}
              aria-describedby={composeDescribedBy({
                leadingAddonId: addonWords(leadingAddon) === undefined ? undefined : leadingAddonId,
                hintId: field.hintId,
                errorId: field.errorId,
                trailingAddonId:
                  addonWords(trailingAddon) === undefined ? undefined : trailingAddonId,
              })}
            />
            {renderAddon(trailingAddon, trailingAddonId)}
          </>
        );
      }}
    </FormField>
  );
}

/**
 * A multi-line text field: the `<textarea>` itself with the same label, hint, error and addon
 * treatment an input gets, plus the row count it opens at and, on request, a counter of the
 * characters written against the field's `maxLength`.
 *
 * The counter follows the field whether the caller holds the value or the browser does. A controlled
 * field is counted from the `value` it is given on every render, and an uncontrolled one keeps the
 * length it read from the change event in state of its own, so no field needs the counter forced on
 * it to report its length. An absent `maxLength` means there is nothing to count against and no
 * counter is rendered.
 *
 * @param props - The field's label and auxiliary text, the form-wide error map, the row count, the
 *   counter flag and the control's own native attributes. `isDisabled` is this component's name for
 *   the disabled state; a native `disabled` works too and is overridden by `isDisabled` when both
 *   are given.
 * @returns The field, with the text area inside it.
 */
export function TextArea({
  id,
  label,
  hint,
  error,
  errors,
  name,
  required,
  isDisabled,
  disabled,
  rows = 4,
  showCount = false,
  maxLength,
  leadingAddon,
  trailingAddon,
  containerClassName,
  className,
  value,
  defaultValue,
  onChange,
  ...rest
}: TextAreaProps): ReactElement {
  const isControlled = value !== undefined;
  const [typedLength, setTypedLength] = useState<number>(() => textLengthOf(defaultValue));
  const usedLength = isControlled ? textLengthOf(value) : typedLength;
  const isFieldDisabled = isDisabled ?? disabled ?? false;
  const message = resolveErrorMessage(error, name === undefined ? undefined : errors?.[name]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // An uncontrolled field keeps its own value, so its length is read from the event; a controlled
    // one is counted from the value the caller renders, which the event has already asked for.
    if (!isControlled) setTypedLength(event.target.value.length);
    onChange?.(event);
  };

  return (
    <FormField
      id={id}
      label={label}
      hint={hint}
      error={message}
      required={required ?? false}
      isDisabled={isFieldDisabled}
      className={containerClassName}
    >
      {(field) => {
        const countId =
          showCount && typeof maxLength === "number" ? `${field.id}-count` : undefined;
        const leadingAddonId = `${field.id}-addon-leading`;
        const trailingAddonId = `${field.id}-addon-trailing`;
        return (
          <>
            {renderAddon(leadingAddon, leadingAddonId)}
            <textarea
              {...rest}
              id={field.id}
              name={name}
              rows={rows}
              maxLength={maxLength}
              value={value}
              defaultValue={defaultValue}
              onChange={handleChange}
              className={classNames("sp-textarea", className)}
              disabled={field.isDisabled}
              required={field.isRequired}
              aria-invalid={field.isInvalid}
              aria-describedby={composeDescribedBy({
                leadingAddonId: addonWords(leadingAddon) === undefined ? undefined : leadingAddonId,
                hintId: field.hintId,
                errorId: field.errorId,
                countId,
                trailingAddonId:
                  addonWords(trailingAddon) === undefined ? undefined : trailingAddonId,
              })}
            />
            {countId === undefined ? null : (
              <p className="sp-field__hint" id={countId} aria-live="polite">
                {`${usedLength} / ${maxLength}`}
              </p>
            )}
            {renderAddon(trailingAddon, trailingAddonId)}
          </>
        );
      }}
    </FormField>
  );
}
