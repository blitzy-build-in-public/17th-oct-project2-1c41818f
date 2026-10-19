/**
 * Path: src/components/ui/Select.tsx
 * Purpose: Select, checkbox, radio group and switch with accessible labelling
 * Lines: 561
 */

import { useCallback, useEffect, useId, useRef } from "react";
import type { ComponentPropsWithRef, MouseEvent, ReactElement, ReactNode } from "react";

import { FieldError, FieldHint, FormField } from "@/components/ui/Input";
import type { FieldControlProps } from "@/components/ui/Input";
import type { FieldErrors, OptionGroup, SelectOption } from "@/types/common";

/**
 * The class contract this family renders against.
 *
 * No stylesheet may be imported here, so every class below is consumed by name, and this list is what
 * `src/styles/controls.css` owes the file: `sp-field`
 * and its `__label`, `__hint` and `__error` for the field anatomy — the label `FormField` renders and the
 * hint and error rows `src/components/ui/Input.tsx` renders through `FieldHint` and `FieldError` for this
 * file's controls as well; `sp-select` and `sp-select__wrap` for the native list and the element that hosts
 * its chevron; `sp-choice` and `sp-choice__label` for a labelled choice row; `sp-checkbox`, `sp-radio` and
 * `sp-radio-group` for the boxes and the group that stacks them; and `sp-switch` with its `__track` and
 * `__thumb` for the toggle.
 *
 * State is carried by attributes and pseudo-classes, never by a second class: `:checked`, `:indeterminate`
 * and `:disabled` on the boxes, `[aria-checked="true"]` and `[aria-disabled="true"]` on the switch, and
 * `[aria-invalid="true"]` on a field's control. Every attribute the sheet selects on is therefore set here.
 */

// The control contracts ---------------------------------------------------------------------------

/**
 * Everything {@link Select} accepts: every attribute of a native `<select>`, `ref` included, plus the label a
 * field cannot do without.
 *
 * `label` is the control's accessible name, `error` wins over `errors[name]` so one `FieldErrors` map serves
 * every field type, and the choices are mapped over rather than written out. The leading empty choice carries
 * `placeholder`, whose wording is the caller's: this file holds no user-facing sentence, so it arrives from
 * `src/constants/content.ts` at the call site as every other label does.
 */
export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "id" | "children"> {
  /** The control's id; a generated one is used when it is omitted. */
  readonly id?: string;
  /** The field's label, which is the control's accessible name. */
  readonly label: string;
  /** A supporting line under the control, read after the name. */
  readonly hint?: string;
  /** This field's message, which wins over {@link SelectProps.errors}. */
  readonly error?: string;
  /** A whole form's error map, read through {@link SelectProps.name}. */
  readonly errors?: FieldErrors;
  /** Disables the control; wins over a native `disabled` passed alongside it. */
  readonly isDisabled?: boolean;
  /** States the leading empty choice's wording, so the closed control reads a name instead of the first value. */
  readonly placeholder?: string;
  /** The choices, in the order they are rendered. */
  readonly options?: readonly SelectOption[];
  /** Further choices under their own headings, rendered after {@link SelectProps.options}. */
  readonly groups?: readonly OptionGroup[];
  /** Class names added to the field wrapper's own, for a form's field grid. */
  readonly containerClassName?: string;
}

/**
 * Everything {@link Checkbox} accepts: every attribute of a native `<input type="checkbox">` except the type,
 * the id and children, plus the label a checkbox cannot do without.
 *
 * `description` is this choice's own secondary line and is tied to the box with `aria-describedby` alongside
 * `hint` and `error`, never used in place of the label. `isIndeterminate` is the tri-state a facet group needs
 * while some of its values are selected: it is written to the DOM property of that name, which has no
 * attribute form, and that write is both what `:indeterminate` selects and what the platform reports as the
 * box's mixed state — so it is not also spelled as an `aria-checked`, which the native control already owns.
 */
export interface CheckboxProps
  extends Omit<ComponentPropsWithRef<"input">, "id" | "children" | "type"> {
  /** The control's id; a generated one is used when it is omitted. */
  readonly id?: string;
  /** The choice's label, which is the box's accessible name. */
  readonly label: string;
  /** A second line of text describing this choice, read after the label. */
  readonly description?: string;
  /** A supporting line under the choice, read after the name. */
  readonly hint?: string;
  /** The choice's message, rendered as the box's description and marking the box invalid. */
  readonly error?: string;
  /** Whether some but not all of what this box stands for is selected. */
  readonly isIndeterminate?: boolean;
  /** Disables the box; wins over a native `disabled` passed alongside it. */
  readonly isDisabled?: boolean;
  /** Class names added to the field wrapper's own, for a filter list or a form's grid. */
  readonly containerClassName?: string;
}

/**
 * Everything {@link RadioGroup} accepts.
 *
 * `legend` names the group and is rendered as the fieldset's own `<legend>`, never as an `aria-label` on the
 * fieldset, because a legend is what assistive technology announces on entry; the radios share `name`, which
 * is what makes them one group and gives arrow-key selection without a key handler here.
 *
 * `renderOptionLabel` replaces the content of one option's label element, which is what lets the checkout show
 * a pre-formatted delivery price beside the method's name while the radio's accessible name stays the text of
 * that label. `optionClassName` is the class a caller's own sheet expects on one option's row — the checkout's
 * shipping-method card puts `.sp-summary__method` here — and `.sp-choice` is applied either way.
 */
export interface RadioGroupProps {
  /** The group's id, which an error summary anchors to; a generated one is used when it is omitted. */
  readonly id?: string;
  /** The name the radios share, which is what makes them one group. */
  readonly name: string;
  /** The group's name, rendered as the legend. */
  readonly legend: string;
  /** The selected value; the option carrying it is the checked radio. */
  readonly value: string;
  /** Called with the value of the option that was picked. */
  readonly onChange: (value: string) => void;
  /** The options, in the order they are rendered. */
  readonly options: readonly SelectOption[];
  /** A supporting line above the options, read after the legend. */
  readonly hint?: string;
  /** The group's message, rendered after the options and read as their description. */
  readonly error?: string;
  /** How the options are laid out; vertical unless the caller asks for the horizontal arrangement. */
  readonly orientation?: "vertical" | "horizontal";
  /** Disables every radio in the group; an option's own `disabled` disables that option alone. */
  readonly isDisabled?: boolean;
  /** Renders one option's label content, replacing the option's own text. */
  readonly renderOptionLabel?: (option: SelectOption) => ReactNode;
  /** A class added to every option's row, beside `.sp-choice`. */
  readonly optionClassName?: string;
  /** Class names added to the fieldset's own, for a form's field grid. */
  readonly containerClassName?: string;
}

/**
 * Everything {@link Switch} accepts.
 *
 * The control is a `<button type="button" role="switch">`, because that is the markup `src/styles/controls.css`
 * is written against: the sheet paints the toggle through `.sp-switch__track` and `.sp-switch__thumb` and moves
 * them on `.sp-switch[aria-checked="true"]`. A `<div role="switch">` would lose the native keyboard behaviour,
 * and a checkbox carrying the role would fall outside those selectors and lose the track and the thumb.
 *
 * `onChange` receives the state the switch would move to rather than an event: a switch has no field for the
 * browser to fill in, so unwrapping `event.target.checked` in every caller is work with no home here.
 */
export interface SwitchProps
  extends Omit<ComponentPropsWithRef<"button">, "id" | "children" | "type" | "onChange"> {
  /** The control's id; a generated one is used when it is omitted. */
  readonly id?: string;
  /** The switch's label, which is the control's accessible name. */
  readonly label: string;
  /** A supporting line under the switch, read after the name. */
  readonly hint?: string;
  /** Disables the switch; wins over a native `disabled` passed alongside it. */
  readonly isDisabled?: boolean;
  /** The state the switch shows; `true` is on. */
  readonly checked: boolean;
  /** Called with the state the switch would move to when it is toggled. */
  readonly onChange: (checked: boolean) => void;
  /** Class names added to the field wrapper's own, for a settings list or a form's grid. */
  readonly containerClassName?: string;
}

// Private helpers ---------------------------------------------------------------------------------

/** True for a string that holds something a reader can see: neither absent nor blank. */
function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * Picks the message a choice shows: the one passed to it, or the one a form's error map holds under the
 * control's own name. The control's own message wins, so a page can override a single field of a map without
 * rebuilding the map around it, and both are read as absent when blank — an empty message would render an
 * error paragraph with nothing in it. `FormField` resolves the same way for a select's field.
 */
function resolveMessage(
  explicit: string | undefined,
  fromMap: string | undefined,
): string | undefined {
  if (isPresent(explicit)) return explicit;
  return isPresent(fromMap) ? fromMap : undefined;
}

/** Joins the classes a control carries, dropping the absent ones so no stray space reaches the attribute. */
function joinClassNames(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/**
 * The class list of one choice row: `.sp-choice`, which owns the row's arrangement, its touch target and its
 * pointer, plus whatever the control composing the row adds.
 *
 * @param extra - Classes this row adds beside `.sp-choice`; absent ones contribute nothing.
 * @returns The row's class attribute value.
 */
function choiceClasses(...extra: readonly (string | false | undefined)[]): string {
  return joinClassNames("sp-choice", ...extra);
}

/**
 * Builds an `aria-describedby` value from the ids describing a control, in the order a reader meets them, so
 * the help for a control is read before the complaint about it, and never as an empty string — an empty
 * `aria-describedby` is a wiring mistake no reader can see.
 *
 * @param ids - The describing elements' ids, absent when the caller rendered none of them.
 * @returns The id list, or `undefined` when nothing describes the control.
 */
function composeDescribedBy(...ids: readonly (string | undefined)[]): string | undefined {
  const described = ids.filter(isPresent);
  return described.length === 0 ? undefined : described.join(" ");
}

/** One choice of a native list: the value it stores, the text it shows and whether it can be picked. */
function renderOption(option: SelectOption): ReactElement {
  return (
    <option key={option.value} value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  );
}

/** The flat choices a caller supplied, or nothing when it supplied none or supplied them grouped. */
function renderOptions(options: readonly SelectOption[] | undefined): readonly ReactElement[] {
  return options?.map(renderOption) ?? [];
}

/**
 * The choices a caller gathered under headings, each rendered as the `<optgroup>` a native list expects. A
 * group has no identifier of its own — `OptionGroup` carries a label and its options — so the label is the key.
 */
function renderGroups(groups: readonly OptionGroup[] | undefined): readonly ReactElement[] {
  return (
    groups?.map((group) => (
      <optgroup key={group.label} label={group.label}>
        {group.options.map(renderOption)}
      </optgroup>
    )) ?? []
  );
}

/**
 * The leading choice of a select: an empty-valued option carrying the wording the closed control reads before a
 * real choice is made. An option rather than a CSS placeholder, because only an option is announced as the
 * control's current value.
 *
 * Deliberately not `disabled`: a disabled option can never hold selectedness, so the platform would hand the
 * closed control the first enabled choice and the user would read a value they never picked. The empty value is
 * also what makes a `required` select refuse a submission until a real choice is made, and it is why this is the
 * option the platform selects by default, without any `selected` attribute needing to be set.
 */
function renderPlaceholderOption(label: string): ReactElement {
  return <option value="">{label}</option>;
}

// The controls ------------------------------------------------------------------------------------

/**
 * A list of choices: the native `<select>`, wrapped in the label, hint and error treatment every field shares.
 *
 * Native on purpose: keyboard selection, type-ahead, the picker a phone opens and the support every assistive
 * technology already has come with the element, and no dependency may supply a listbox here. The select
 * renders inside `.sp-select__wrap`, because a pseudo-element does not render on a `<select>` and that wrapper
 * is where the stylesheet's chevron is drawn.
 *
 * The leading choice is an empty-valued option carrying `placeholder`, or the field's own label when the caller
 * supplied no choices at all, so the closed control never reads blank; it is not disabled, because a disabled
 * option cannot hold selectedness and the platform would display the first real value in its place. Both strings
 * are the caller's, which keeps every user-facing sentence in `src/constants/content.ts`.
 *
 * @param props - The field's label and auxiliary text, the form-wide error map, the placeholder, the two ways
 *   of supplying choices and the control's own native attributes. `isDisabled` wins over a native `disabled`.
 * @returns The field, with the select inside it.
 */
export function Select({
  id,
  label,
  hint,
  error,
  errors,
  name,
  required,
  isDisabled,
  disabled,
  placeholder,
  options,
  groups,
  containerClassName,
  ...rest
}: SelectProps): ReactElement {
  const isFieldDisabled = isDisabled ?? disabled ?? false;
  const message = resolveMessage(error, name === undefined ? undefined : errors?.[name]);
  const hasChoices = (options?.length ?? 0) > 0 || (groups?.length ?? 0) > 0;
  const leadingLabel = isPresent(placeholder) ? placeholder : hasChoices ? undefined : label;

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
      {(field: FieldControlProps) => (
        <div className="sp-select__wrap">
          <select
            {...rest}
            id={field.id}
            name={name}
            className={joinClassNames("sp-select", rest.className)}
            disabled={field.isDisabled}
            required={field.isRequired}
            aria-invalid={field.isInvalid}
            aria-describedby={field.describedBy}
          >
            {leadingLabel === undefined ? null : renderPlaceholderOption(leadingLabel)}
            {renderOptions(options)}
            {renderGroups(groups)}
          </select>
        </div>
      )}
    </FormField>
  );
}

/**
 * A single choice: a real `<input type="checkbox">` on a labelled choice row, with the label, an optional
 * description, a hint and an error.
 *
 * The row is a `<label>` wrapping the box, so the whole row is the target the pointer reaches and the
 * browser's own behaviour — Space to toggle, the checked state read out on focus — needs nothing added. The
 * box keeps its native checked state as the source of truth, which is why nothing declares `aria-checked`
 * beside it: the native property is what the platform reports.
 *
 * `isIndeterminate` is the one state with no attribute form, so it is written to the element's own property
 * from an effect that depends on the flag and clears it when the flag goes false. `src/styles/controls.css`
 * selects `:indeterminate`, so a class could not carry it, and an unchecked box with a mixed state is what a
 * facet group shows while some of its values are selected.
 *
 * A choice's description borrows the field's auxiliary-text register, the register the stylesheets give text
 * standing beside a control: the sheet declares no class of its own for one, which is the same borrowing
 * `src/components/ui/Input.tsx` makes for the slot it holds beside a field.
 *
 * @param props - The label and the secondary lines, the error, the tri-state flag and the box's own native
 *   attributes. `isDisabled` wins over a native `disabled` when both are given.
 * @returns The choice's row, with the box inside it and its descriptions beneath.
 */
export function Checkbox({
  id,
  label,
  description,
  hint,
  error,
  isIndeterminate = false,
  isDisabled,
  disabled,
  containerClassName,
  className,
  ref: forwardedRef,
  ...rest
}: CheckboxProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = isPresent(description) ? `${controlId}-description` : undefined;
  const hintId = isPresent(hint) ? `${controlId}-hint` : undefined;
  const errorId = isPresent(error) ? `${controlId}-error` : undefined;
  const isFieldDisabled = isDisabled ?? disabled ?? false;
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The indeterminate state is a property, so the element it is written to is held here. A caller's own ref
  // is pointed at the same element rather than dropped, because React 19 hands it over as an ordinary prop.
  const setInputRef = useCallback(
    (node: HTMLInputElement | null): void => {
      inputRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef !== null && forwardedRef !== undefined) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  useEffect(() => {
    const node = inputRef.current;
    if (node === null) return;
    node.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  return (
    <div className={joinClassNames("sp-field", containerClassName)}>
      <label className={choiceClasses()} htmlFor={controlId}>
        <input
          {...rest}
          ref={setInputRef}
          type="checkbox"
          id={controlId}
          className={joinClassNames("sp-checkbox", className)}
          disabled={isFieldDisabled}
          aria-invalid={errorId !== undefined}
          aria-describedby={composeDescribedBy(descriptionId, hintId, errorId)}
        />
        <span className="sp-choice__label">{label}</span>
      </label>
      <FieldHint id={descriptionId} text={description} />
      <FieldHint id={hintId} text={hint} />
      <FieldError id={errorId} text={error} />
    </div>
  );
}

/**
 * One choice from a short list: a `<fieldset>` whose own `<legend>` names the group, holding one labelled radio
 * per option.
 *
 * The radios share their `name`, which is what makes them one group and gives arrow-key selection without a key
 * handler here, and the group's name is the legend rather than an `aria-label`, because a legend is what
 * assistive technology announces when focus enters the group. The fieldset takes `tabIndex={-1}` so an error
 * summary can send focus to the group it names, a fieldset being unfocusable otherwise.
 *
 * The hint and the error are tied to every radio through `aria-describedby`, and the error is read as the
 * group's own description rather than as a live region of its own — the summary a form renders above its fields
 * is what announces a refused submit — while the invalid state reaches the radios the same way: a `<fieldset>`
 * cannot carry `aria-invalid`, so each radio carries it while the group renders an error and omits it while it
 * does not, which leaves a valid group's radios with no invalid state to report. `orientation` adds
 * the horizontal arrangement's class, which `src/styles/controls.css` declares as a modifier of the
 * stacked group, laying its rows out in one line.
 *
 * @param props - The group's name and legend, the selected value and its change handler, the options, the
 *   auxiliary text, the arrangement, the per-option label renderer and the class a caller's sheet expects on an
 *   option's row.
 * @returns The group, with its radios, their labels and the group's own text inside it.
 */
export function RadioGroup({
  id,
  name,
  legend,
  value,
  onChange,
  options,
  hint,
  error,
  orientation,
  isDisabled = false,
  renderOptionLabel,
  optionClassName,
  containerClassName,
}: RadioGroupProps): ReactElement {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const hintId = isPresent(hint) ? `${groupId}-hint` : undefined;
  const errorId = isPresent(error) ? `${groupId}-error` : undefined;
  const describedBy = composeDescribedBy(hintId, errorId);

  return (
    <fieldset
      id={groupId}
      tabIndex={-1}
      className={joinClassNames(
        "sp-radio-group",
        // BLITZY [CONTRACT]: controls.css declares the group's horizontal arrangement beside its stacked base
        // rule, so the class is what puts the group's rows in one line where the base stacks them.
        orientation === "horizontal" && "sp-radio-group--horizontal",
        containerClassName,
      )}
    >
      <legend className="sp-field__label">{legend}</legend>
      <FieldHint id={hintId} text={hint} />
      {options.map((option) => (
        <label className={choiceClasses(optionClassName)} key={option.value}>
          <input
            type="radio"
            className="sp-radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={isDisabled || option.disabled === true}
            aria-invalid={errorId !== undefined ? "true" : undefined}
            aria-describedby={describedBy}
          />
          <span className="sp-choice__label">
            {renderOptionLabel === undefined ? option.label : renderOptionLabel(option)}
          </span>
        </label>
      ))}
      <FieldError id={errorId} text={error} />
    </fieldset>
  );
}

/**
 * One setting that is either on or off: a `<button type="button" role="switch">` whose `aria-checked` carries
 * the state, holding the toggle `src/styles/controls.css` paints from `.sp-switch__track` and
 * `.sp-switch__thumb`.
 *
 * A button because that is the markup the sheet is written against — the track and the thumb are elements
 * inside the control, and they move on `.sp-switch[aria-checked="true"]` — and because a button keeps what a
 * switch needs: Space and Enter toggle it. The row class is added beside it so the toggle and its text are
 * spaced by the sheet's own gap, and the label is the control's content, which is what names it for assistive
 * technology and what makes the whole row one pointer target.
 *
 * `disabled` and `aria-disabled="true"` are set together: the native attribute takes the control out of the tab
 * order and refuses the click, while the ARIA state is what dims the track. BLITZY [CONTRACT]: the sheet owning
 * the family restates the not-allowed pointer for the disabled and `aria-disabled` cases of `.sp-choice` and
 * `.sp-switch`, so a non-interactive row does not advertise itself as clickable.
 *
 * @param props - The label and its supporting line, the state and its change handler, the disabled flags and
 *   the button's own native attributes. `isDisabled` wins over a native `disabled` when both are given.
 * @returns The switch, with its track, its thumb, its label and its hint.
 */
export function Switch({
  id,
  label,
  hint,
  isDisabled,
  disabled,
  checked,
  onChange,
  onClick,
  containerClassName,
  className,
  ...rest
}: SwitchProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = isPresent(hint) ? `${controlId}-hint` : undefined;
  const isFieldDisabled = isDisabled ?? disabled ?? false;

  // A caller's own click handler runs first, so it can prevent the default and hold the state where it is;
  // the toggle then reports the state the switch moves to, which is why `onChange` takes a boolean.
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    onChange(!checked);
  };

  return (
    <div className={joinClassNames("sp-field", containerClassName)}>
      <button
        {...rest}
        type="button"
        id={controlId}
        role="switch"
        aria-checked={checked}
        aria-disabled={isFieldDisabled ? "true" : undefined}
        aria-describedby={composeDescribedBy(hintId)}
        disabled={isFieldDisabled}
        className={choiceClasses("sp-switch", className)}
        onClick={handleClick}
      >
        <span className="sp-switch__track" aria-hidden="true" />
        <span className="sp-switch__thumb" aria-hidden="true" />
        <span className="sp-choice__label">{label}</span>
      </button>
      <FieldHint id={hintId} text={hint} />
    </div>
  );
}
