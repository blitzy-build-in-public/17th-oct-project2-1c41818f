/**
 * Path: src/components/ui/Button.tsx
 * Purpose: Button, icon button and button group with their variants, sizes, loading and disabled states
 * Lines: 458
 */

import { useId } from "react";
import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";

import { FEEDBACK_COPY } from "@/constants/content";

/*
 * Class contract. `src/styles/controls.css` is the sole definition site of this family — it is the sheet
 * `src/styles/components.css` loads through `@import`. No stylesheet is imported here, so every class below is
 * consumed by name, and this comment is the list the sheet owes the file: `sp-btn` for the base
 * control; `sp-btn--primary`, `sp-btn--secondary`, `sp-btn--ghost`, `sp-btn--danger` and `sp-btn--link` for
 * the five variants; `sp-btn--sm` and `sp-btn--lg` for the two sizes that differ from the base rule (`md`
 * is the base rule itself and carries no modifier); `sp-btn--icon` for the square target of a glyph-only
 * control; `sp-btn--round` for the pill shape; `sp-btn--block` for a control that fills its line; and the
 * `sp-btn__icon`, `sp-btn__label` and `sp-btn__spinner` parts. The group is `sp-btn-group`, with
 * `sp-btn-group--vertical`, `sp-btn-group--align-start`, `sp-btn-group--align-center` and
 * `sp-btn-group--align-end` for the orientation and the packing; the round shape and the four group
 * modifiers were added to that sheet alongside this file, which is their only consumer.
 *
 * State is carried by the attribute rather than by a second class. `aria-busy="true"` is what the sheet
 * paints as an in-flight control and what reveals `sp-btn__spinner`; the real `disabled` attribute is what
 * paints a disabled one; the not-allowed pointer, the visible focus ring and the reduced-motion treatment
 * all come from `src/styles/base.css` and are deliberately not restated here. A loading control keeps its
 * label in the box, which is what keeps its accessible name stable — the sheet's own note says the label's
 * text is what a screen reader announces for the button — and the loading word rendered beside it is text
 * for assistive technology that the same sheet hides visually with `.sp-visually-hidden`.
 *
 * The committed `src/features/home/HeroSection.tsx` styles its two calls to action as links carrying
 * `sp-btn sp-btn--primary`, because a call to action that navigates is an anchor and not a button,
 * and that call site wears the same `sp-btn` family this file renders, with no alias declared beside it.
 * Nothing here renders a link: a control that navigates is an `<a>` styled with those classes, and a
 * control that acts is the `<button>` this file renders.
 */

/**
 * Every class this family puts on the page, written once so a rename is one edit.
 *
 * The values are the sheet's own names and no new name is composed here. `spinnerGlyph` is the animated
 * ring from the same sheet's feedback states, which an in-flight control uses when its caller supplies no
 * `loadingIcon` of its own.
 */
const CLASSES = {
  base: "sp-btn",
  iconOnly: "sp-btn--icon",
  round: "sp-btn--round",
  block: "sp-btn--block",
  icon: "sp-btn__icon",
  label: "sp-btn__label",
  spinner: "sp-btn__spinner",
  spinnerGlyph: "sp-spinner",
  visuallyHidden: "sp-visually-hidden",
  group: "sp-btn-group",
  groupVertical: "sp-btn-group--vertical",
  groupAlignStart: "sp-btn-group--align-start",
  groupAlignCenter: "sp-btn-group--align-center",
  groupAlignEnd: "sp-btn-group--align-end",
} as const;

/**
 * The five variants the sheet paints, in the order a style guide would list them.
 *
 * The variant and size unions are this component family's own public API surface, so they live here rather
 * than in `src/constants/content.ts` (which owns user-facing copy) or `src/constants/config.ts` (which owns
 * numeric configuration). A `const` array with a union derived from it is used instead of an `enum`: the
 * compiler runs with `erasableSyntaxOnly`, and the array is also iterable by anything that has to list the
 * variants.
 */
export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;

/** One of the five variants {@link BUTTON_VARIANTS} names. */
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/**
 * The three sizes the sheet declares, smallest first.
 *
 * `"md"` is the default, and it is the one size with no modifier of its own, because the base rule in
 * `src/styles/controls.css` already carries the medium height, padding and type role.
 */
export const BUTTON_SIZES = ["sm", "md", "lg"] as const;

/** One of the three sizes {@link BUTTON_SIZES} names. */
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/** The modifier each variant carries, exactly as the sheet spells it. */
const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary: "sp-btn--primary",
  secondary: "sp-btn--secondary",
  ghost: "sp-btn--ghost",
  danger: "sp-btn--danger",
  link: "sp-btn--link",
};

/** The modifier each size carries; `"md"` maps to the empty string, since it adds nothing. */
const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: "sp-btn--sm",
  md: "",
  lg: "sp-btn--lg",
};

/**
 * Joins the classes a member of this family carries into one attribute value.
 *
 * A falsy value is dropped rather than rendered, so a caller's `className` may be absent and a conditional
 * modifier may evaluate to `false` without leaving a double space in the attribute. Class composition is
 * not a concern `src/utils` owns, so the one copy of this logic is here, in the file that composes the
 * classes.
 *
 * @param values - Class names in cascade order, any of which may be `false` or `undefined` to mean "omit".
 * @returns The names that were given, joined by a single space.
 */
function joinClassNames(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/**
 * Everything the three exported members resolve to before their markup is rendered.
 *
 * `Button` and `IconButton` differ only in how they derive these values from their own props, so the class
 * list, the loading markup and the disabled/`aria-busy` pair exist once, here. This interface is internal:
 * nothing outside the file imports it.
 */
interface ButtonCoreProps extends ComponentPropsWithRef<"button"> {
  /** The variant modifier to apply. */
  readonly variant: ButtonVariant;
  /** The size modifier to apply. */
  readonly size: ButtonSize;
  /** Whether a submission or an action behind this control is in flight. */
  readonly isLoading: boolean;
  /** Whether the control fills the inline space it is given. */
  readonly isBlock: boolean;
  /** Whether the children are the control's only visible content, so the glyph slot carries them. */
  readonly isIconOnly: boolean;
  /** Whether the control takes the pill shape. */
  readonly isRound: boolean;
  /** Decoration drawn ahead of the label, hidden from assistive technology. */
  readonly leadingIcon?: ReactNode;
  /** Decoration drawn after the label, hidden from assistive technology. */
  readonly trailingIcon?: ReactNode;
  /** The mark an in-flight control draws; the animated ring stands in when this is absent. */
  readonly loadingIcon?: ReactNode;
  /** The word an in-flight control renders for assistive technology, replacing the shared default. */
  readonly loadingLabel?: string;
}

/**
 * Renders one control of this family.
 *
 * The element is a real `<button>`; `type` defaults to `"button"` so a control inside a form never submits
 * it by accident, while an explicit `type="submit"` still reaches the element. `ref` is an ordinary prop in
 * React 19, so the caller's ref arrives through the rest props and no `forwardRef` is used.
 *
 * While `isLoading` the control is disabled and carries `aria-busy="true"`, its label element stays in the
 * box, the spinner takes the leading slot, and its accessible name is pinned to that label element, so the
 * word rendered for assistive technology beside it does not change the name a user hears. The name is
 * pinned only when the caller supplied no name of its own and the control renders a label element at all:
 * an icon-only control renders none, so it is named by the `aria-label` it requires instead. A caller's own
 * `aria-label`, `aria-labelledby` or `aria-busy` reaches the element untouched while the control is idle,
 * because an attribute this component has nothing to say about is left out of the element rather than
 * written as `undefined` over the caller's value.
 *
 * @param props - The resolved variant, size, flags, icon slots, label and the remaining button attributes.
 * @returns The rendered button element.
 */
function ButtonCore({
  variant,
  size,
  isLoading,
  isBlock,
  isIconOnly,
  isRound,
  leadingIcon,
  trailingIcon,
  loadingIcon,
  loadingLabel,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonCoreProps): ReactElement {
  const labelId = useId();
  const hasCallerSuppliedName =
    rest["aria-label"] !== undefined || rest["aria-labelledby"] !== undefined;

  const classes = joinClassNames(
    CLASSES.base,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    isIconOnly && CLASSES.iconOnly,
    isRound && CLASSES.round,
    isBlock && CLASSES.block,
    className,
  );

  const leading = isLoading ? (
    <span className={CLASSES.spinner}>
      {loadingIcon ?? <span className={CLASSES.spinnerGlyph} aria-hidden="true" />}
    </span>
  ) : leadingIcon ? (
    <span className={CLASSES.icon} aria-hidden="true">
      {leadingIcon}
    </span>
  ) : null;

  const glyph =
    isIconOnly && !isLoading ? (
      <span className={CLASSES.icon} aria-hidden="true">
        {children}
      </span>
    ) : null;

  const label = isIconOnly ? null : (
    <span className={CLASSES.label} id={labelId}>
      {children}
    </span>
  );

  const trailing = trailingIcon ? (
    <span className={CLASSES.icon} aria-hidden="true">
      {trailingIcon}
    </span>
  ) : null;

  const status = isLoading ? (
    <span className={CLASSES.visuallyHidden}>{loadingLabel ?? FEEDBACK_COPY.LOADING}</span>
  ) : null;

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={isLoading || disabled === true}
      {...(isLoading ? { "aria-busy": true } : {})}
      {...(isLoading && !hasCallerSuppliedName && !isIconOnly
        ? { "aria-labelledby": labelId }
        : {})}
    >
      {leading}
      {label}
      {glyph}
      {trailing}
      {status}
    </button>
  );
}

/** Everything {@link Button} accepts: the button element's own attributes, plus this family's options. */
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** The variant to paint. Defaults to `"primary"`, the accent action a screen offers once. */
  readonly variant?: ButtonVariant;
  /** The size to render. Defaults to `"md"`. */
  readonly size?: ButtonSize;
  /** Marks the control in flight: disabled, busy to assistive technology, and carrying the spinner. */
  readonly isLoading?: boolean;
  /** Fills the inline space the control is given, for a submit that spans a form or a panel. */
  readonly isBlock?: boolean;
  /** The mark drawn in the spinner's place while loading; the shared animated ring stands in when absent. */
  readonly loadingIcon?: ReactNode;
  /** Decoration drawn before the label, hidden from assistive technology. */
  readonly leadingIcon?: ReactNode;
  /** Decoration drawn after the label, hidden from assistive technology. */
  readonly trailingIcon?: ReactNode;
  /** The word announced while loading, in place of the shared default, for a more specific action. */
  readonly loadingLabel?: string;
}

/**
 * The product's button: the control that performs an action.
 *
 * An action that navigates is a link carrying the family's classes rather than this component, so every
 * button the application renders behaves the way a button is expected to: Enter and Space both activate it,
 * it is skipped by Tab while disabled, and it never navigates on its own. A control whose only content is a
 * glyph goes through {@link IconButton} instead, because that is the member which requires an accessible
 * name.
 *
 * @param props - Variant, size, state flags, icon slots, the label and the remaining button attributes.
 * @returns The rendered button element.
 */
export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  isBlock = false,
  loadingIcon,
  leadingIcon,
  trailingIcon,
  loadingLabel,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <ButtonCore
      {...rest}
      variant={variant}
      size={size}
      isLoading={isLoading}
      isBlock={isBlock}
      isIconOnly={false}
      isRound={false}
      loadingIcon={loadingIcon}
      leadingIcon={leadingIcon}
      trailingIcon={trailingIcon}
      loadingLabel={loadingLabel}
    >
      {children}
    </ButtonCore>
  );
}

/**
 * Everything {@link IconButton} accepts.
 *
 * It is {@link Button}'s own props minus the three slots an icon-only control does not have — `children`,
 * `leadingIcon` and `trailingIcon` — plus the name and the glyph that replace them. The name is required
 * rather than optional: this is the type-level enforcement that stops a control whose only content is a
 * glyph from reaching a user with no name at all. A `type` alias rather than an interface, because
 * `Omit<…>` is not an object type with statically known members for an interface to extend.
 */
export type IconButtonProps = Omit<ButtonProps, "children" | "leadingIcon" | "trailingIcon"> & {
  /** The accessible name, applied as `aria-label` on the button and never drawn on screen. */
  readonly label: string;
  /** The glyph, drawn inside the square target in a box the sheet sizes. */
  readonly icon: ReactNode;
  /** Draws the pill shape instead of the rounded square, for a floating or a circular control. */
  readonly isRound?: boolean;
};

/**
 * A button whose only visible content is a glyph.
 *
 * The glyph is decorative — the control's name comes from `label`, so a screen reader announces the action
 * and never the picture — and the square target the sheet gives it is what makes it usable by touch. Use it
 * for a control the surrounding design already explains, such as a drawer's close action, a quantity
 * stepper's plus and minus, or a table row's overflow menu.
 *
 * @param props - The required `label` and `icon`, the optional `isRound`, and the rest of {@link Button}'s
 * options and button attributes.
 * @returns The rendered button element.
 */
export function IconButton({
  label,
  icon,
  isRound = false,
  variant = "primary",
  size = "md",
  isLoading = false,
  isBlock = false,
  loadingIcon,
  loadingLabel,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <ButtonCore
      {...rest}
      aria-label={label}
      variant={variant}
      size={size}
      isLoading={isLoading}
      isBlock={isBlock}
      isIconOnly
      isRound={isRound}
      loadingIcon={loadingIcon}
      loadingLabel={loadingLabel}
    >
      {icon}
    </ButtonCore>
  );
}

/** How a {@link ButtonGroup} arranges its controls. */
export type ButtonGroupOrientation = "horizontal" | "vertical";

/** Where a {@link ButtonGroup} packs its controls along the axis the orientation sets. */
export type ButtonGroupAlign = "start" | "center" | "end";

/**
 * The modifier each orientation carries.
 *
 * `"horizontal"` maps to `undefined` because the sheet's base group rule is already the row, and the
 * function that joins the classes drops an absent name rather than writing an empty one.
 */
const GROUP_ORIENTATION_CLASSES: Readonly<Record<ButtonGroupOrientation, string | undefined>> = {
  horizontal: undefined,
  vertical: CLASSES.groupVertical,
};

/**
 * The modifier each alignment carries.
 *
 * Naming an alignment also widens the group to the inline space it is given, which is what gives the
 * packing room to act; a group that names no alignment keeps hugging its controls, so a segmented control
 * and a row of actions can sit next to each other without either changing size.
 */
const GROUP_ALIGN_CLASSES: Readonly<Record<ButtonGroupAlign, string>> = {
  start: CLASSES.groupAlignStart,
  center: CLASSES.groupAlignCenter,
  end: CLASSES.groupAlignEnd,
};

/** Everything {@link ButtonGroup} accepts. */
export interface ButtonGroupProps {
  /** The controls to arrange, each an ordinary {@link Button} or {@link IconButton}. */
  readonly children: ReactNode;
  /**
   * Names the group for assistive technology, so a screen reader announces what the controls belong to —
   * "Sort order", "Date range". Omit it when the surrounding heading already says it; a label that
   * is empty or only whitespace is treated as no name, so no group is ever named by spaces.
   */
  readonly label?: string;
  /** The axis the controls are arranged along. Defaults to `"horizontal"`. */
  readonly orientation?: ButtonGroupOrientation;
  /** The packing along that axis. Omit it and the group is only as wide as its controls. */
  readonly align?: ButtonGroupAlign;
  /** Extra classes for the caller's own layout, appended after the group's own. */
  readonly className?: string;
}

/**
 * Arranges a row or a column of controls as one unit.
 *
 * The group is a `role="group"` container rather than a toolbar or a radiogroup, because the controls
 * inside it keep their own names and their own behaviour: the group neither manages focus nor selects a
 * value, it only says that these controls belong together, which is what the label is for. Adjacent borders
 * collapse and only the outer corners stay rounded, so the row reads as one segmented control while each
 * button remains a button.
 *
 * @param props - The controls, the optional label, orientation and alignment, and extra classes.
 * @returns The rendered group element.
 */
export function ButtonGroup({
  children,
  label,
  orientation = "horizontal",
  align,
  className,
}: ButtonGroupProps): ReactElement {
  const classes = joinClassNames(
    CLASSES.group,
    GROUP_ORIENTATION_CLASSES[orientation],
    align === undefined ? undefined : GROUP_ALIGN_CLASSES[align],
    className,
  );
  const accessibleLabel = label !== undefined && label.trim().length > 0 ? label : undefined;

  return (
    <div className={classes} role="group" aria-label={accessibleLabel}>
      {children}
    </div>
  );
}
