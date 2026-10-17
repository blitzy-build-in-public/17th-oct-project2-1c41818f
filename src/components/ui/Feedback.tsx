/**
 * Path: src/components/ui/Feedback.tsx
 * Purpose: Spinner, skeleton, empty state, alert and progress bar: the four states every data page renders
 * Lines: 598
 */

import { useId } from "react";
import type { CSSProperties, ElementType, ReactElement, ReactNode } from "react";

import { Button, ButtonGroup, IconButton } from "@/components/ui/Button";
import { A11Y_COPY, COMMON_ACTIONS, EMPTY_STATES, FEEDBACK_COPY } from "@/constants/content";
import type { EmptyStateKey } from "@/constants/content";
import type { ApiError } from "@/types/common";
import { formatPercent } from "@/utils/format";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class below is consumed by name. `src/styles/components.css` owns the data-page feedback states:
 * `sp-spinner` with its keyframes; `sp-skeleton` with its `--text`, `--card` and `--row` shapes and its
 * `__line` part; `sp-empty`, `sp-alert` and `sp-progress` with their `__icon`, `__title`, `__body`,
 * `__action`, `__track`, `__fill` and `__label` regions and the alert's `--info`, `--success` and
 * `--warning` tones. `sp-alert--danger` and `sp-progress__label` are declared in the sheet that file loads,
 * `src/styles/controls.css`. The button family the actions wear is composed through `Button.tsx`, except
 * for the empty state's link, which is an `<a>` carrying the `sp-btn sp-btn--primary` pair the committed
 * `HeroSection.tsx` already puts on a link. `.sp-visually-hidden` is the global utility of
 * `src/styles/base.css`, which also neutralises the spinner's rotation and the skeleton's shimmer under
 * `prefers-reduced-motion`, so neither state schedules motion of its own.
 *
 * State is carried by attributes: the spinner is a `role="status"` region, an alert an `alert` or `status`
 * region by tone, the progress bar a `progressbar` with its `aria-value*` trio, and the skeleton
 * `aria-hidden`, because the region it stands in for is what carries `aria-busy` while it loads. The
 * geometry the sheets leave to the component arrives through their own hooks — `--spinner-size`,
 * `--progress-height`, and `--sp-progress-value`, the ratio the progress fill publishes for components.css to
 * size the fill by — and every value set here is either that ratio or a `var()` reference into
 * `src/styles/tokens.css`, so no colour, radius, shadow, duration or breakpoint is written in this file.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: an indeterminate bar is reported by ARIA alone. The sheets declare no
 * indeterminate class — their state vocabulary is the `aria-*` attributes, `disabled`, `inert`, the
 * pseudo-classes and the three classes `is-loading`, `is-open` and `sp-card--interactive` — so a bar with
 * `isIndeterminate` states no value and renders no fill, and no class is invented here for a rule no sheet
 * holds.
 */

/** A style object that also carries the custom properties the sheets substitute, such as `--spinner-size`. */
type FeedbackStyle = CSSProperties & Record<`--${string}`, string>;

/** Joins the class names one of these states composes, leaving out every absent one. */
function composeClassName(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * Whether a slot holds something React paints, so a region given nothing is left out rather than drawn as an
 * empty band. A zero is a value these states legitimately show; `false`, `null`, `undefined` and the empty
 * string paint nothing.
 */
function hasSlot(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** Whether a label holds words a visitor can read, so a control with a blank label is left out. */
function hasLabel(label: string | undefined): label is string {
  return label !== undefined && label.trim() !== "";
}

/**
 * The share of a bar that is filled, held between nothing and the whole track: a figure that is not finite
 * reads as no progress, and one above the bar's own maximum is clamped rather than painted past the track.
 */
function filledRatio(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value / limit, 0), 1);
}

/**
 * The single control an empty state offers with the way out of it: an anchor when the way out is a
 * destination, `Button` when it is an action, and nothing at all when the label has neither — a control that
 * cannot do anything is worse than the sentence alone.
 */
function emptyStateAction(
  label: string | undefined,
  href: string | undefined,
  onAction: (() => void) | undefined,
): ReactElement | null {
  if (!hasLabel(label)) return null;
  if (href !== undefined) {
    return (
      <a className="sp-btn sp-btn--primary" href={href}>
        {label}
      </a>
    );
  }
  if (onAction === undefined) return null;
  return (
    <Button variant="primary" onClick={onAction}>
      {label}
    </Button>
  );
}

// Spinner --------------------------------------------------------------------------------------

/** One of the three sizes the ring is drawn at. */
export type SpinnerSize = "sm" | "md" | "lg";

/**
 * The size each ring takes, as the custom property `sp-spinner` reads. `"md"` is the sheet's own size and
 * adds nothing; the other two reuse the spacing tokens the button family sizes its in-flight ring with, so a
 * standalone spinner and the spinner inside a loading button come in the same two sizes.
 */
const SPINNER_SIZE_STYLES: Readonly<Record<SpinnerSize, FeedbackStyle | undefined>> = {
  sm: { "--spinner-size": "var(--space-4)" },
  md: undefined,
  lg: { "--spinner-size": "var(--space-8)" },
};

/** Everything {@link Spinner} accepts. */
export interface SpinnerProps {
  /** The size of the ring. Defaults to `"md"`, the size the stylesheet declares. */
  readonly size?: SpinnerSize;
  /** The word announced while the ring turns, in place of the shared one, for a load a caller can name. */
  readonly label?: string;
  /** Extra classes for the layout around the ring, added to the announcement wrapper. */
  readonly className?: string;
}

/**
 * The loading state: a turning ring that names itself.
 *
 * The ring is decoration and is hidden from assistive technology; its name is the visually hidden word
 * inside the `role="status"` wrapper, which is also the polite live region that announces the load. A ring
 * with no name would announce nothing at all, which is why the wrapper and the word are both here. The turn
 * is the stylesheet's own animation, neutralised under `prefers-reduced-motion` by `src/styles/base.css`.
 *
 * @param props - The ring's size, the announced word and extra classes for the wrapper.
 * @returns The status region holding the decorative ring and its hidden name.
 */
export function Spinner({ size = "md", label, className }: SpinnerProps): ReactElement {
  return (
    <span className={className} role="status">
      <span className="sp-spinner" style={SPINNER_SIZE_STYLES[size]} aria-hidden="true" />
      <span className="sp-visually-hidden">{label ?? A11Y_COPY.LOADING_ANNOUNCEMENT}</span>
    </span>
  );
}

// Skeleton -------------------------------------------------------------------------------------

/** The shape a placeholder takes, chosen so the space it occupies matches what replaces it. */
export type SkeletonVariant = "text" | "heading" | "block" | "circle" | "card" | "row";

/**
 * The classes and the geometry one shape carries: the sheet's modifier where it declares one, which is where
 * the block size comes from for text, card and row, and the size the content being stood in for needs, in
 * spacing tokens, for the three shapes the sheet leaves to the component.
 */
interface SkeletonShape {
  /** The sheet's modifier for this shape, when the sheet declares one. */
  readonly className?: string;
  /** The shape's inline size, when it does not simply fill the space it is given. */
  readonly inlineSize?: string;
  /** The shape's block size, when the sheet's own declaration does not already set one. */
  readonly blockSize?: string;
  /** The corner radius, for the one shape that is a circle rather than a rounded box. */
  readonly radius?: string;
}

/** The geometry each shape renders with, before a caller's own width and height are applied over it. */
const SKELETON_SHAPES: Readonly<Record<SkeletonVariant, SkeletonShape>> = {
  text: { className: "sp-skeleton--text" },
  heading: { className: "sp-skeleton--text", blockSize: "var(--space-6)" },
  block: { blockSize: "var(--space-16)" },
  circle: {
    inlineSize: "var(--space-12)",
    blockSize: "var(--space-12)",
    radius: "var(--radius-pill)",
  },
  card: { className: "sp-skeleton--card" },
  row: { className: "sp-skeleton--row" },
};

/** Everything {@link Skeleton} accepts. */
export interface SkeletonProps {
  /**
   * The shape to stand in with. Defaults to `"block"`, because the call that passes nothing is a route-level
   * suspension standing in for a page's content rather than for one line of it.
   */
  readonly variant?: SkeletonVariant;
  /**
   * How many text lines to stack, for a paragraph-shaped placeholder. One or fewer renders the variant's own
   * single shape; two or more render that many lines in a container the sheet spaces and shimmers as a group.
   */
  readonly lines?: number;
  /** The inline size to render at, in place of the shape's own — a width in `ch`, `rem` or `%`, held to
   *  the width of its container so a placeholder can never widen the page it sits on. */
  readonly width?: string;
  /** The block size to render at, in place of the shape's own — the height of a chart frame, for one. */
  readonly height?: string;
  /** Extra classes for the layout the placeholder sits in. */
  readonly className?: string;
}

/**
 * The loading state of a region: a decorative placeholder shaped like the content that will replace it.
 *
 * It is hidden from assistive technology and deliberately silent — it announces nothing, and the region it
 * stands inside is what carries `aria-busy` while the request is in flight. A live region here would make a
 * screen reader hear the load twice, so none is rendered. It holds no state, runs no timer and formats
 * nothing: the lines are painted by the stylesheet's own shimmer, which `prefers-reduced-motion: reduce`
 * neutralises.
 *
 * @param props - The shape, the line count, an explicit size and extra classes.
 * @returns The decorative placeholder element.
 */
export function Skeleton({
  variant = "block",
  lines = 1,
  width,
  height,
  className,
}: SkeletonProps): ReactElement {
  const lineCount = Number.isFinite(lines) ? Math.max(0, Math.trunc(lines)) : 1;

  if (lineCount > 1) {
    // A stack takes the width it is given and no fixed height, because the sheet spaces the lines itself
    // once the container holds them. The keys are positional on purpose: every line is the same decorative
    // box, with no identity and no state for a key to preserve across a re-render.
    return (
      <div
        className={composeClassName("sp-skeleton", className)}
        style={{ inlineSize: width, maxInlineSize: "100%" }}
        aria-hidden="true"
      >
        {Array.from({ length: lineCount }, (_line, index) => (
          <span className="sp-skeleton__line" key={`skeleton-line-${String(index)}`} />
        ))}
      </div>
    );
  }

  const shape = SKELETON_SHAPES[variant];

  return (
    <div
      className={composeClassName("sp-skeleton", shape.className, className)}
      style={{
        inlineSize: width ?? shape.inlineSize,
        blockSize: height ?? shape.blockSize,
        maxInlineSize: "100%",
        borderRadius: shape.radius,
      }}
      aria-hidden="true"
    />
  );
}

// Empty state ----------------------------------------------------------------------------------

/**
 * The surfaces whose wording names a control: exactly those the content library gives an action label. One
 * it gives none promises no action, so it needs no wiring and is left out of this union.
 */
type ActionableSurfaceKey = {
  [Key in EmptyStateKey]: "actionLabel" extends keyof (typeof EMPTY_STATES)[Key] ? Key : never;
}[EmptyStateKey];

/**
 * What backs the single control an empty state offers, at least one of the two being required: a control
 * that resolves nothing is worse than the sentence alone. `actionHref` wins when both are given.
 */
type EmptyStateActionWiring =
  | { readonly actionHref: string; readonly onAction?: () => void }
  | { readonly onAction: () => void; readonly actionHref?: string };

/**
 * Everything {@link EmptyState} accepts: the wording slots, and the wiring the wording obliges. Wherever it
 * names a control — a surface whose copy carries an action label, or a caller's own `actionLabel` — the
 * callback or the destination that backs it is required, so no state can promise an action it does not offer
 * and no call site can leave one unwired. `relatedProducts`, whose copy names none, and a state that names no
 * surface and no label, need neither.
 */
export type EmptyStateProps = {
  /** The headline, in place of the surface's own. */
  readonly title?: ReactNode;
  /** The plain explanation, in place of the surface's own. */
  readonly description?: ReactNode;
  /** Decoration above the headline, hidden from assistive technology because the words carry the meaning. */
  readonly icon?: ReactNode;
  /**
   * The heading level the headline renders at, so the outline stays in order wherever the state lands: `1`
   * for a page's principal content, `2` for a page section, `3` and `4` inside a card. Defaults to `2`.
   */
  readonly headingLevel?: 1 | 2 | 3 | 4;
  /** Extra classes for the surface the state sits on. */
  readonly className?: string;
  /** The words on the single control, in place of the surface's own label. */
  readonly actionLabel?: string;
} & (
  | ({
      /** The surface that came up empty: a filter combination with no matches, an account with no orders, a
       *  reporting range with no sales. One whose wording names a control, which this state has to back. */
      readonly surface: ActionableSurfaceKey;
    } & EmptyStateActionWiring)
  | {
      /** A surface whose copy names no control, or no surface for a state passing its own wording. */
      readonly surface?: Exclude<EmptyStateKey, ActionableSurfaceKey>;
      readonly actionLabel?: undefined;
      readonly onAction?: () => void;
      readonly actionHref?: string;
    }
  | ({
      /** The same two cases, on a state whose label is the caller's rather than the library's. */
      readonly surface?: Exclude<EmptyStateKey, ActionableSurfaceKey>;
      readonly actionLabel: string;
    } & EmptyStateActionWiring)
);

/**
 * The empty state of a region: what is empty, why, and the one action that helps.
 *
 * The wording is the content library's in every case — the surface's own three strings, or the error
 * boundary's neutral pair when no surface is named — so no empty-state sentence is written here and no two
 * surfaces describe the same emptiness differently. Exactly one control is offered, because a state that
 * presents three ways out presents none.
 *
 * That one control is not left to a call site to remember: where the wording names it the props type requires
 * what backs it, so a state cannot render copy promising an action it does not offer, and a state promising
 * none renders its heading and its sentence alone — every combination renders as it always did.
 *
 * @param props - The surface, the wording overrides, the single action and the heading level.
 * @returns The empty state element.
 */
export function EmptyState({
  surface,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  icon,
  headingLevel = 2,
  className,
}: EmptyStateProps): ReactElement {
  const copy = surface === undefined ? undefined : EMPTY_STATES[surface];
  // Eight of the nine surfaces declare an action label and `relatedProducts` does not, so the union of the
  // nine has to be asked for it.
  const copyActionLabel =
    copy !== undefined && "actionLabel" in copy ? copy.actionLabel : undefined;
  const resolvedTitle = hasSlot(title)
    ? title
    : (copy?.title ?? FEEDBACK_COPY.ERROR_BOUNDARY_TITLE);
  const resolvedDescription = hasSlot(description)
    ? description
    : (copy?.description ?? FEEDBACK_COPY.ERROR_BOUNDARY_BODY);
  const action = emptyStateAction(actionLabel ?? copyActionLabel, actionHref, onAction);
  const Heading: ElementType = `h${headingLevel}`;

  return (
    <div className={composeClassName("sp-empty", className)}>
      {hasSlot(icon) ? (
        <span className="sp-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Heading className="sp-empty__title">{resolvedTitle}</Heading>
      <p className="sp-empty__body">{resolvedDescription}</p>
      {action === null ? null : <div className="sp-empty__action">{action}</div>}
    </div>
  );
}

// Alert ----------------------------------------------------------------------------------------

/** The register an alert speaks in. */
export type AlertTone = "info" | "success" | "warning" | "danger";

/** The modifier each tone carries, exactly as the sheets spell it. */
const ALERT_TONE_CLASSES: Readonly<Record<AlertTone, string>> = {
  info: "sp-alert--info",
  success: "sp-alert--success",
  warning: "sp-alert--warning",
  danger: "sp-alert--danger",
};

/**
 * The decorative mark each tone draws in the alert's icon column, which the sheet reserves because the title
 * and the action are positioned around it. A mark keeps the register legible to a visitor who cannot tell
 * the four surfaces apart by hue — the rule that no state is carried by colour alone. The words beside it
 * carry the meaning, and these are characters rather than artwork, so nothing is sized or loaded.
 */
const ALERT_TONE_MARKS: Readonly<Record<AlertTone, string>> = {
  info: "i",
  success: "✓",
  warning: "!",
  danger: "✕",
};

/** The mark the alert's dismiss control draws, which names itself through its label instead. */
const DISMISS_MARK = "✕";

/** Everything {@link Alert} accepts. */
export interface AlertProps {
  /** The register to speak in. An `error` overrides it to `"danger"`. */
  readonly tone: AlertTone;
  /**
   * The headline. An alert carrying an `error` and no title falls back to the content library's error-state
   * title, so a failure always says what failed rather than only why.
   */
  readonly title?: ReactNode;
  /** The alert's text. When it is absent and an `error` is given, the error's own message is rendered. */
  readonly children?: ReactNode;
  /**
   * A failure shaped at the API seam, rendered in the danger register with its message as the alert's text.
   * This is the one path from a failed `Result` to pixels: because the seam reports failures as values rather
   * than exceptions, no page needs a `try`/`catch` around a request — it needs this prop.
   */
  readonly error?: ApiError;
  /** The words on the action that resolves what the alert reports, usually the retry verb. */
  readonly actionLabel?: string;
  /** What the action does. An action renders only when a label and a callback are both given. */
  readonly onAction?: () => void;
  /** Offers the dismiss control. It renders only alongside `onDismiss`. */
  readonly isDismissible?: boolean;
  /** What dismissing does; the caller owns hiding the alert it rendered. */
  readonly onDismiss?: () => void;
  /** Extra classes for the surface the alert sits on. */
  readonly className?: string;
}

/**
 * A message about the outcome of something: a notice, a confirmation, a warning, or a failure.
 *
 * The register is announced the way its urgency deserves — `alert` for a failure, so it interrupts and is
 * heard at once, and `status` for the rest, so a confirmation waits its turn — and the region is named by
 * its title where it has one, because an announcement of "alert" alone tells a visitor nothing.
 *
 * @param props - The tone, the wording, an optional failure, the action and the dismiss control.
 * @returns The alert element.
 */
export function Alert({
  tone,
  title,
  children,
  error,
  actionLabel,
  onAction,
  isDismissible = false,
  onDismiss,
  className,
}: AlertProps): ReactElement {
  const titleId = useId();

  // One register for failure, whatever tone was named: a request that did not answer is not an informational
  // message, and keeping every failure in the danger register is what makes the error states look alike.
  const resolvedTone: AlertTone = error === undefined ? tone : "danger";
  const resolvedTitle: ReactNode = hasSlot(title)
    ? title
    : error === undefined
      ? undefined
      : FEEDBACK_COPY.ERROR_STATE_TITLE;
  const body: ReactNode = hasSlot(children) ? children : error?.message;
  const showsTitle = hasSlot(resolvedTitle);
  const showsBody = hasSlot(body);
  const showsAction = hasLabel(actionLabel) && onAction !== undefined;
  const showsDismiss = isDismissible && onDismiss !== undefined;

  return (
    <div
      className={composeClassName("sp-alert", ALERT_TONE_CLASSES[resolvedTone], className)}
      role={resolvedTone === "danger" ? "alert" : "status"}
      aria-labelledby={showsTitle ? titleId : undefined}
    >
      <span className="sp-alert__icon" aria-hidden="true">
        {ALERT_TONE_MARKS[resolvedTone]}
      </span>
      {showsTitle ? (
        <p className="sp-alert__title" id={titleId}>
          {resolvedTitle}
        </p>
      ) : null}
      {showsBody ? <div className="sp-alert__body">{body}</div> : null}
      {showsAction || showsDismiss ? (
        <div className="sp-alert__action">
          <ButtonGroup align="start">
            {showsAction ? (
              <Button variant="secondary" size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            ) : null}
            {showsDismiss ? (
              <IconButton
                variant="ghost"
                size="sm"
                label={COMMON_ACTIONS.CLOSE}
                icon={DISMISS_MARK}
                onClick={onDismiss}
              />
            ) : null}
          </ButtonGroup>
        </div>
      ) : null}
    </div>
  );
}

// Progress bar ---------------------------------------------------------------------------------

/** One of the two thicknesses a bar is drawn at. */
export type ProgressSize = "sm" | "md";

/** The scale a bar reports on when its caller names none. */
const DEFAULT_PROGRESS_MAX = 100;

/**
 * The height each thickness renders at, as the custom property `sp-progress__track` reads. `"md"` is the
 * height the token sheet declares for the track and adds nothing; the small bar is one spacing step shorter,
 * for a row that already carries a sentence of its own.
 */
const PROGRESS_SIZE_STYLES: Readonly<Record<ProgressSize, FeedbackStyle | undefined>> = {
  sm: { "--progress-height": "var(--space-1)" },
  md: undefined,
};

/** Everything {@link ProgressBar} accepts. */
export interface ProgressBarProps {
  /** How far along the task is, on the scale `max` sets. A figure above `max` is clamped to it. */
  readonly value: number;
  /** The top of that scale. Defaults to `100`, and a figure that is not positive is read as the default. */
  readonly max?: number;
  /** What is progressing, read as the bar's name and shown as the visible caption. */
  readonly label: string;
  /**
   * The value already rendered as words — a formatted amount, a formatted count — in place of the
   * percentage, for a bar whose reader needs the figure itself. It is shown as given and announced as the
   * bar's value text.
   */
  readonly valueLabel?: string;
  /**
   * Reports work with no position: the bar states no value, shows no percentage and renders no fill, and the
   * caption is its label alone.
   */
  readonly isIndeterminate?: boolean;
  /** The bar's thickness. Defaults to `"md"`, the height the token sheet declares. */
  readonly size?: ProgressSize;
  /** Extra classes for the surface the bar sits on, such as the summary panel's own progress band. */
  readonly className?: string;
}

/**
 * The progress of a task the visitor is waiting on.
 *
 * It is a labelled `progressbar` whose value is stated three ways, because a filled track is unreadable to a
 * visitor who cannot see it: the numeric pair assistive technology announces, the value text when the caller
 * has already rendered one, and a visible caption of the label followed by the value. The fill's width is the
 * ratio this bar publishes as `--sp-progress-value`, which `src/styles/components.css` turns into a percentage
 * — no formatted display string is ever a length — so the fill and the caption from `src/utils/format.ts`
 * state one figure, and the caption sits outside the track so the label survives whatever the fill covers.
 *
 * @param props - The value and its scale, the label, the optional value text, the indeterminate flag, the
 * thickness and extra classes.
 * @returns The progress bar element.
 */
export function ProgressBar({
  value,
  max = DEFAULT_PROGRESS_MAX,
  label,
  valueLabel,
  isIndeterminate = false,
  size = "md",
  className,
}: ProgressBarProps): ReactElement {
  const limit = Number.isFinite(max) && max > 0 ? max : DEFAULT_PROGRESS_MAX;
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), limit) : 0;
  const ratio = filledRatio(clamped, limit);
  const valueText = isIndeterminate ? undefined : (valueLabel ?? formatPercent(ratio));
  const fillWidthStyle: FeedbackStyle = { "--sp-progress-value": String(ratio) };

  return (
    <div className={composeClassName("sp-progress", className)} style={PROGRESS_SIZE_STYLES[size]}>
      <div
        className="sp-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={isIndeterminate ? undefined : 0}
        aria-valuemax={isIndeterminate ? undefined : limit}
        aria-valuenow={isIndeterminate ? undefined : clamped}
        aria-valuetext={isIndeterminate ? undefined : valueLabel}
      >
        {isIndeterminate ? null : (
          <span className="sp-progress__fill" style={fillWidthStyle} aria-hidden="true" />
        )}
      </div>
      <p className="sp-progress__label">
        {valueText === undefined ? label : `${label} ${valueText}`}
      </p>
    </div>
  );
}
