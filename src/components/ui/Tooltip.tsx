/**
 * Path: src/components/ui/Tooltip.tsx
 * Purpose: Tooltip and popover triggered by keyboard or pointer and wired through `aria-describedby`
 * Lines: 404
 */

import { cloneElement, useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from "react";

import { useOnClickOutside } from "@/state/hooks";

/*
 * Class contract. `src/styles/components.css` is the sole definition site of this family and no file under
 * `src/components/**` may import a stylesheet, so every class below is consumed by name: `sp-tooltip` for
 * the bubble, `sp-popover` for the panel, and `is-open` on whichever is revealed — the sheet paints the
 * closed state `opacity: 0` with `visibility: hidden`, so a surface rendered without `is-open` is rendered
 * invisible. `sp-tooltip-anchor` and `sp-popover-anchor` sit on the wrapper and are what make it the
 * containing block the absolutely positioned surface is measured against, and the four placement
 * modifiers (`sp-tooltip--top|--bottom|--start|--end`, `sp-popover--top|--bottom|--start|--end`) position
 * it against that anchor. `sp-visually-hidden`, owned by `src/styles/base.css`, carries the panel's label.
 *
 * State is carried by attributes and by that one class, the way the three primitive sheets agree: the
 * trigger reports itself through `aria-describedby` and `aria-expanded`, the surface carries its `role`,
 * and `is-open` marks the revealed one. The description link named in this file's purpose is the substance
 * of `Tooltip`; the reveal and the transition are the decoration around it.
 *
 * The wrapper is a `<span>` in `Tooltip`, because it sits in inline content beside a control, and a `<div>`
 * in `Popover`, because the panel it holds may carry flow content of its own and the caller places it
 * where a block belongs.
 */

/** The four sides a tooltip or a popover can be placed on, named for the writing mode rather than for left or right. */
export type TooltipPlacement = "top" | "bottom" | "start" | "end";

/** Every class this file puts on the page, written once so a rename is one edit. */
const CLASSES = {
  tooltip: "sp-tooltip",
  popover: "sp-popover",
  tooltipAnchor: "sp-tooltip-anchor",
  popoverAnchor: "sp-popover-anchor",
  open: "is-open",
  visuallyHidden: "sp-visually-hidden",
} as const;

/** The attributes this file merges into a caller's trigger, all of them optional on the element itself. */
interface TriggerAttributes {
  readonly "aria-describedby"?: string;
  readonly "aria-expanded"?: boolean;
  readonly "aria-controls"?: string;
}

// Shared helpers ---------------------------------------------------------------------------------

/** Joins the class names that were given, omitting the ones that are absent or empty. */
function joinClassNames(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/**
 * The props a caller put on the trigger element, read as an untyped record.
 *
 * A `ReactElement` carries its props as a type parameter this file cannot know, so they are read through
 * one narrowing point rather than assumed: `cloneElement` merges onto any element, but only a reader that
 * treats what it finds as `unknown` can tell the attribute string it is looking for from anything else.
 */
function triggerProps(trigger: ReactElement): Record<string, unknown> {
  return trigger.props as Record<string, unknown>;
}

/** The `aria-describedby` a caller already set, so a merge adds to it instead of replacing it. */
function describedByOf(trigger: ReactElement): string | undefined {
  const value = triggerProps(trigger)["aria-describedby"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Joins two space-separated id lists in order, dropping blanks and repeats. */
function mergeIds(existing: string | undefined, added: string | undefined): string | undefined {
  const parts = `${existing ?? ""} ${added ?? ""}`.split(" ").filter((part) => part.length > 0);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length === 0 ? undefined : unique.join(" ");
}

/** Adds this file's attributes to a caller's trigger, keeping every prop, ref and handler the caller set. */
function withTriggerAttributes(trigger: ReactElement, attributes: TriggerAttributes): ReactElement {
  return cloneElement(trigger, attributes);
}

/** Clears one scheduled timer and forgets it, so calling again before it fires is harmless. */
function clearTimer(timer: { current: number | null }): void {
  if (timer.current === null) return;
  window.clearTimeout(timer.current);
  timer.current = null;
}

/** Moves focus to a node, unless it has left the document since the surface was opened. */
function focusIfConnected(node: HTMLElement | null): void {
  if (node === null || !node.isConnected) return;
  node.focus();
}

/**
 * The trigger node, which is the wrapper's first element child.
 *
 * Both components render the trigger first and the surface after it, so the trigger is reachable from the
 * wrapper without composing a ref onto an element this file does not own.
 */
function firstElementChild(container: HTMLElement | null): HTMLElement | null {
  const child = container === null ? null : container.firstElementChild;
  return child instanceof HTMLElement ? child : null;
}

// Tooltip ----------------------------------------------------------------------------------------

/** Everything {@link Tooltip} accepts. */
export interface TooltipProps {
  /** The supplementary text, or inline nodes, revealed beside the trigger. */
  readonly content: ReactNode;
  /** Exactly one element that accepts `aria-describedby` — a real button, link or input — not a fragment. */
  readonly children: ReactElement;
  /** Which side of the trigger the bubble sits on. Defaults to `"top"`. */
  readonly placement?: TooltipPlacement;
  /** Milliseconds of pointer-over or focus before the bubble is revealed. Defaults to `0`, so it is immediate. */
  readonly openDelayMs?: number;
  /** Milliseconds after the pointer leaves or focus moves away before the bubble is hidden. Defaults to `0`. */
  readonly closeDelayMs?: number;
  /** The bubble's id; a generated one is used when it is omitted, so two tooltips cannot collide. */
  readonly id?: string;
  /** Class names added to the wrapper's own, for the layout the caller places it in. */
  readonly className?: string;
}

/**
 * Reveals supplementary text beside its trigger, on pointer-over and on focus, and describes the trigger
 * with it while it is open.
 *
 * `content` is supplementary by construction: it is an icon's label, a count's explanation or the full
 * text of a string the layout truncated. Information that is only reachable by hovering is not available
 * at all — to a touch user, a keyboard user or a screen reader — so the trigger keeps its own accessible
 * name and this component supplies the description beside it. The wrapper therefore sets no `aria-label`;
 * an icon-only trigger is given one by its caller.
 *
 * The wiring is `React.cloneElement` on the single child: this file never reaches into it with a ref and
 * never replaces a prop, it merges. An `aria-describedby` the caller already set is extended while the
 * bubble is open and left exactly as it was while it is closed, and the child's own ref, handlers and
 * attributes are untouched. The child must be one element that accepts `aria-describedby` — a real
 * `button`, `a` or `input` — because a fragment or a text node has nowhere to put the attribute.
 *
 * Placement is a class, never a measurement: the bubble carries
 * `sp-tooltip--top|--bottom|--start|--end` and the stylesheet positions it against the wrapper's anchor
 * class. Nothing here reads `getBoundingClientRect`, watches a resize or detects a collision, because the
 * stack admits no positioning engine and a hand-measured one would be a second implementation of what the
 * sheet already does. A caller that needs the bubble somewhere the four sides do not reach styles the
 * surface through its own sheet.
 *
 * Both delays default to `0`, the reveal happening synchronously in the handler that caused it so the
 * description exists by the time assistive technology reads the focused element. No delay is declared in
 * `src/constants/config.ts`, and inventing one here would put configuration outside its home, so a caller
 * that wants a delay passes it.
 *
 * @param props - The content, the trigger, the placement, the two delays, an optional id and extra classes.
 * @returns The wrapper holding the trigger and, while open, the `role="tooltip"` bubble.
 */
export function Tooltip({
  content,
  children,
  placement = "top",
  openDelayMs = 0,
  closeDelayMs = 0,
  id,
  className,
}: TooltipProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearScheduled = useCallback((): void => {
    clearTimer(openTimer);
    clearTimer(closeTimer);
  }, []);

  // A component that unmounts mid-delay leaves a timer that would set state on a gone component, so every
  // scheduled reveal and dismissal is cancelled by the cleanup of this single effect.
  useEffect(() => () => clearScheduled(), [clearScheduled]);

  const reveal = useCallback((): void => {
    clearScheduled();
    if (openDelayMs <= 0) {
      setIsOpen(true);
      return;
    }
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setIsOpen(true);
    }, openDelayMs);
  }, [clearScheduled, openDelayMs]);

  const dismiss = useCallback((): void => {
    clearScheduled();
    setIsOpen(false);
  }, [clearScheduled]);

  const scheduleDismiss = useCallback((): void => {
    clearScheduled();
    if (closeDelayMs <= 0) {
      setIsOpen(false);
      return;
    }
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setIsOpen(false);
    }, closeDelayMs);
  }, [clearScheduled, closeDelayMs]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>): void => {
      if (event.key !== "Escape") return;
      dismiss();
    },
    [dismiss],
  );

  const inheritedDescription = describedByOf(children);
  const describedBy = isOpen ? mergeIds(inheritedDescription, tooltipId) : inheritedDescription;

  return (
    <span
      className={joinClassNames(CLASSES.tooltipAnchor, className)}
      onPointerEnter={reveal}
      onPointerLeave={scheduleDismiss}
      onFocus={reveal}
      onBlur={scheduleDismiss}
      onKeyDown={handleKeyDown}
    >
      {withTriggerAttributes(children, { "aria-describedby": describedBy })}
      {isOpen ? (
        <span
          className={joinClassNames(
            CLASSES.tooltip,
            CLASSES.open,
            `${CLASSES.tooltip}--${placement}`,
          )}
          id={tooltipId}
          role="tooltip"
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

// Popover ----------------------------------------------------------------------------------------

/** Everything {@link Popover} accepts. */
export interface PopoverProps {
  /** Exactly one element that accepts `aria-expanded` — a real button — not a fragment. */
  readonly trigger: ReactElement;
  /** The panel's content: the menu, the form or the detail the trigger opens. */
  readonly children: ReactNode;
  /** Which side of the trigger the panel sits on. Defaults to `"bottom"`, the register a menu opens in. */
  readonly placement?: TooltipPlacement;
  /** The open state when the caller owns it; omit both this and `onOpenChange` to let the panel hold its own. */
  readonly isOpen?: boolean;
  /** Reports every requested change of the open state, for a caller that owns it or listens to it. */
  readonly onOpenChange?: (isOpen: boolean) => void;
  /** The panel's id, which the trigger points at with `aria-controls`; a generated one is used when omitted. */
  readonly id?: string;
  /** The panel's name, announced through `aria-labelledby` over visually hidden text inside the panel. */
  readonly label?: string;
  /** Class names added to the wrapper's own; the caller's class is what positions the panel in a header. */
  readonly className?: string;
  /** Class names added to the panel's own, for a caller styling its own panel surface. */
  readonly panelClassName?: string;
}

/**
 * Opens a panel of controls beside its trigger, without taking the page over.
 *
 * This is deliberately not a modal. `src/components/ui/Modal.tsx` owns every overlay that needs the
 * background inert and focus contained — the modal, the drawer and the confirm dialog — and the panels
 * this component opens are the opposite case: an account menu, a navigation menu, a filter panel, each
 * sitting inside page navigation a trapped focus would break. So the panel carries `role="group"` and no
 * `role="dialog"`, focus is never trapped, the rest of the page stays clickable and tabbable, and Escape
 * closes the panel and puts focus back on the trigger it was opened from. A control inside the panel does
 * not close it: only the caller's own selection does, through `onOpenChange`.
 *
 * The open state is either the caller's (`isOpen` with `onOpenChange`) or the panel's own. That single
 * piece of internal state is genuine rather than derived — nothing renders it from anything else — so
 * holding it in state is correct here, and it is never mirrored back from the prop by an effect. A click
 * outside the wrapper closes the panel through `useOnClickOutside` from `src/state/hooks.ts`, which is the
 * product's one implementation of that dismissal and the reason this file attaches no listener of its own.
 *
 * The trigger is merged, never replaced: this file writes nothing onto it but `aria-expanded` and, while
 * the panel is open, `aria-controls`, so every handler and attribute the caller set still runs. Activation
 * is read from the wrapper's click instead — anything outside the panel toggles, a control inside it does
 * not — and the wrapper is positioned by the caller's `className`, as `.sp-account-menu` and the mobile
 * navigation panel are, because a popover belongs in the flow of the page that opens it.
 *
 * @param props - The trigger, the panel's content, the placement, the open state and the two class hooks.
 * @returns The wrapper holding the trigger and, while open, the `role="group"` panel.
 */
export function Popover({
  trigger,
  children,
  placement = "bottom",
  isOpen,
  onOpenChange,
  id,
  label,
  className,
  panelClassName,
}: PopoverProps): ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = isOpen !== undefined;
  const open = isControlled ? isOpen : uncontrolledOpen;
  const wrapper = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const labelId = label === undefined ? undefined : `${panelId}-label`;

  const setOpen = useCallback(
    (next: boolean): void => {
      if (next && typeof document !== "undefined") {
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      onOpenChange?.(next);
      if (!isControlled) setUncontrolledOpen(next);
    },
    [isControlled, onOpenChange],
  );

  useOnClickOutside(wrapper, () => setOpen(false), { enabled: open });

  const toggle = useCallback((): void => {
    setOpen(!open);
  }, [open, setOpen]);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const panelNode = panel.current;
      const target = event.target;
      if (panelNode !== null && target instanceof Node && panelNode.contains(target)) return;
      toggle();
    },
    [toggle],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "Escape" || !open) return;
      const target = firstElementChild(wrapper.current) ?? opener.current;
      setOpen(false);
      focusIfConnected(target);
    },
    [open, setOpen],
  );

  return (
    <div
      ref={wrapper}
      className={joinClassNames(CLASSES.popoverAnchor, className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {withTriggerAttributes(trigger, {
        "aria-expanded": open,
        "aria-controls": open ? panelId : undefined,
      })}
      {open ? (
        <div
          ref={panel}
          className={joinClassNames(
            CLASSES.popover,
            CLASSES.open,
            `${CLASSES.popover}--${placement}`,
            panelClassName,
          )}
          id={panelId}
          role="group"
          aria-labelledby={labelId}
        >
          {labelId === undefined ? null : (
            <span className={CLASSES.visuallyHidden} id={labelId}>
              {label ?? ""}
            </span>
          )}
          {children}
        </div>
      ) : null}
    </div>
  );
}
