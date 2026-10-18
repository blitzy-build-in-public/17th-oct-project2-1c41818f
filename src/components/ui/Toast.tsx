/**
 * Path: src/components/ui/Toast.tsx
 * Purpose: Toast viewport and item with a live region and pausable auto-dismiss
 * Lines: 337
 */

import { useCallback, useEffect, useRef } from "react";
import type { ReactElement } from "react";

import { IconButton } from "@/components/ui/Button";
import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from "@/constants/config";
import { A11Y_COPY, COMMON_ACTIONS } from "@/constants/content";
import type { ToastKind, ToastMessage } from "@/types/common";

/*
 * Class contract. `src/styles/data-display.css` — the sheet `src/styles/components.css` loads through
 * `@import`, and the sole definition site of this family — owes the classes rendered below: the fixed
 * viewport `sp-toast-viewport`, which carries `inset-block-end`, `inset-inline-end`, `--z-toast` and
 * `pointer-events: none`, so the placement, the stacking and the non-blocking behaviour are the sheet's and
 * no z-index is written here; the frame `sp-toast`, a two-column grid whose second track holds the dismiss
 * control; the three variants `sp-toast--success`, `sp-toast--error` and `sp-toast--info`; the text row
 * `sp-toast__message`, whose direct child `svg` the sheet sizes; and the dismiss control's `sp-toast__close`.
 * The dismiss control is the button primitive dressed with that class, so the 44px `--touch-target-min`
 * floor `sp-btn--icon` declares decides its target and stays the primitive's business.
 * The register is never carried by hue alone. The variant class tints the frame, the leading border and the
 * text together, and each message also draws its kind's glyph inside the text row, so a reader who cannot
 * separate the three surfaces can still separate a tick, an exclamation and an "i".
 */

/** Every class this file puts on the page, written once so a rename is one edit. */
const CLASSES = {
  viewport: "sp-toast-viewport",
  toast: "sp-toast",
  message: "sp-toast__message",
  close: "sp-toast__close",
} as const;

/** The variant modifier each kind carries, exactly as the sheet spells it. */
const KIND_CLASSES: Readonly<Record<ToastKind, string>> = {
  success: "sp-toast--success",
  error: "sp-toast--error",
  info: "sp-toast--info",
};

/**
 * The live role each kind is announced through: a failure interrupts what a screen reader is saying, while
 * a confirmation or a note waits for a pause.
 *
 * The role belongs to the message and never to the container: a live region on the viewport would announce
 * the whole column again each time one message joined or left it, so the same words would be read twice.
 * The message element is the whole live region, inserted together with the words it announces, so what a
 * screen reader reads is the message and not the column it joins — which is why the viewport must never
 * carry `aria-live` as well.
 *
 * That shape is the one the running page was checked against: its accessibility tree shows the container as
 * a named `region` with no `aria-live`, and each message as a `status`, an `alert` for a failure. It is what
 * keeps a message from being announced twice, and the trade-off it takes deliberately is that assistance
 * which only announces a live region already present when its content changed may not announce the first
 * message, where a newly inserted `alert` is widely announced and a `status` is not universally.
 */
const KIND_LIVE_ROLES: Readonly<Record<ToastKind, "alert" | "status">> = {
  success: "status",
  error: "alert",
  info: "status",
};

/**
 * The glyph each kind draws, as one stroked path in a 24-unit box: a ringed tick, a ringed exclamation and
 * a ringed "i". Each is a whole circle plus its mark, so the three silhouettes differ even in greyscale.
 */
const KIND_ICON_PATHS: Readonly<Record<ToastKind, string>> = {
  success: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M7.5 12.4l3 3 6.5-7.2",
  error: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 7.4v5.6M12 16.6h.01",
  info: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 11v5.6M12 7.4h.01",
};

/** The dismiss control's glyph, in the same stroked treatment as the kind glyphs. */
const CLOSE_ICON_PATH = "M18 6 6 18M6 6l12 12";

/**
 * Joins the class names one of these components composes, leaving out every absent one.
 *
 * A caller's `className` may be absent and a conditional name may evaluate to `false`, so the names that
 * are present are joined and the rest are dropped rather than left as a gap in the attribute. Class
 * composition is no concern of `src/utils`, so the single copy of this logic is in the file that composes
 * the classes.
 *
 * @param names - The classes in render order, each absent when the flag that adds it is off.
 * @returns The present classes joined by a single space, or the empty string when none is present.
 */
function joinClassNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * Resolves how long one message may stay on screen.
 *
 * The queue resolves `durationMs` per message out of its own policy, so that is the value that applies; this
 * stands behind it with the kind's policy duration for a value that could never count down, because a
 * message handed over with a zero, a negative or a non-finite duration would otherwise vanish at once or
 * never leave at all.
 *
 * @param kind - The register the message was reported in, whose policy duration stands in.
 * @param durationMs - The duration the queue resolved for this message.
 * @returns A positive number of milliseconds to count down.
 */
function resolveDurationMs(kind: ToastKind, durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : TOAST_DURATION_MS[kind];
}

/**
 * Normalises the visible cap a caller passes.
 *
 * `maxVisible` is a number a caller supplies, so it is read as one: a fractional value is truncated, a
 * negative one renders nothing rather than less than nothing, and a value that is not a number at all falls
 * back to the queue's own cap instead of silently emptying the viewport.
 *
 * @param maxVisible - The cap the caller asked for.
 * @returns A whole number of messages, never negative.
 */
function resolveVisibleCap(maxVisible: number): number {
  return Number.isFinite(maxVisible) ? Math.max(0, Math.trunc(maxVisible)) : TOAST_MAX_VISIBLE;
}

/** What {@link ToastItem} renders: one queued message and the queue's dismiss handle. */
interface ToastItemProps {
  /** The message to render, exactly as the queue holds it. */
  readonly toast: ToastMessage;
  /** The queue's stable `dismiss`, which is how a message leaves. */
  readonly onDismiss: (id: number) => void;
}

/**
 * One queued message: its markup, its own live role and its own countdown.
 *
 * The countdown is armed on mount for the message's resolved duration and asks the queue to remove the
 * message when it elapses. A reader can hold it: the pointer entering the message suspends the timer, and so
 * does the keyboard focus reaching its dismiss control. Suspensions are counted rather than assumed, so a
 * message whose pointer has already left it keeps waiting while its dismiss control still holds focus —
 * otherwise a keyboard reader would be raced by a message the pointer had abandoned.
 *
 * Resuming arms the **remainder**, never a fresh full duration: a suspension records the time left as
 * `deadlineRef.current - Date.now()`, the deadline being the instant the countdown was last armed for, and
 * that remainder is what the next arm counts down. Restarting from the resolved duration instead would let a
 * reader keep a message alive indefinitely by nudging the pointer, and would report the wrong thing about
 * how long a message is permitted to interrupt.
 *
 * Every timer armed here is cleared when the message unmounts, so a message removed by any route — its own
 * countdown, its dismiss control, the queue's `clear()`, or the queue's own cap letting the oldest go —
 * leaves nothing behind that could dismiss a message the queue no longer holds.
 *
 * @param props - The queued message and the queue's dismiss handle.
 * @returns The rendered message element.
 */
function ToastItem({ toast, onDismiss }: ToastItemProps): ReactElement {
  const timeoutRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);
  const remainingRef = useRef(0);
  const holdsRef = useRef(0);
  const durationMs = resolveDurationMs(toast.kind, toast.durationMs);
  const { id, kind, message, title } = toast;

  /** Asks the queue to remove this message. */
  const dismissSelf = useCallback((): void => {
    onDismiss(id);
  }, [id, onDismiss]);

  /**
   * Arms the countdown for `delayMs`.
   *
   * The deadline is recorded before the timer so a suspension has an instant to subtract from, and the
   * callback clears the reference first, which is what tells a later release that nothing is counting down.
   */
  const arm = useCallback(
    (delayMs: number): void => {
      deadlineRef.current = Date.now() + delayMs;
      remainingRef.current = delayMs;
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        remainingRef.current = 0;
        dismissSelf();
      }, delayMs);
    },
    [dismissSelf],
  );

  useEffect(() => {
    arm(durationMs);
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [arm, durationMs]);

  /** Suspends the countdown, keeping the time left for the release that follows. */
  const hold = useCallback((): void => {
    holdsRef.current += 1;
    if (holdsRef.current > 1 || timeoutRef.current === null) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
  }, []);

  /** Resumes the countdown once nothing is holding it, from the time that was left. */
  const release = useCallback((): void => {
    if (holdsRef.current === 0) {
      return;
    }
    holdsRef.current -= 1;
    if (holdsRef.current > 0 || timeoutRef.current !== null || remainingRef.current <= 0) {
      return;
    }
    arm(remainingRef.current);
  }, [arm]);

  return (
    <div
      className={joinClassNames(CLASSES.toast, KIND_CLASSES[kind])}
      role={KIND_LIVE_ROLES[kind]}
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <span className={CLASSES.message}>
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={KIND_ICON_PATHS[kind]} />
        </svg>
        <span>
          {title === undefined ? null : <strong>{title} </strong>}
          {message}
        </span>
      </span>
      <IconButton
        className={CLASSES.close}
        variant="ghost"
        label={COMMON_ACTIONS.CLOSE}
        onClick={dismissSelf}
        icon={
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={CLOSE_ICON_PATH} />
          </svg>
        }
      />
    </div>
  );
}

/** Everything {@link ToastViewport} accepts. */
export interface ToastViewportProps {
  /** The queued notifications, oldest first, exactly as the queue holds them. */
  readonly toasts: readonly ToastMessage[];
  /**
   * The queue's `dismiss`, which is how a message leaves.
   *
   * It is the composition root that takes it from `useToast()` and passes it on, once: the queue's own
   * `dismiss` is stable for the life of its provider, and a handle rebuilt on every render would change each
   * item's handle, where an item re-arms its countdown when the handle it holds changes and would therefore
   * hand a standing message a fresh full duration each time another one arrived.
   */
  readonly onDismiss: (id: number) => void;
  /** Extra classes for the viewport, for a caller that has to place it differently on one screen. */
  readonly className?: string;
  /** How many messages may stand on screen at once, up to the queue's own cap. Defaults to that cap. */
  readonly maxVisible?: number;
}

/**
 * Renders the queued notifications, newest last, and drives their countdowns.
 *
 * The queue is the single source of truth and this component holds no copy of it: it renders a view of the
 * `toasts` it is handed, capped at `maxVisible` messages taken in order, and the only way it removes anything
 * is by calling the `onDismiss` it is handed with a message's id. That slice is a read and never a mutation:
 * nothing here is added to or spliced out of the queue. Both come from the composition root in `src/App.tsx`,
 * which reads them inside the providers — this file sits below the state layer and imports nothing from it,
 * which is why the queue arrives as a prop rather than through a hook. The queue itself never holds more than
 * `TOAST_MAX_VISIBLE` messages — the provider keeps the newest and lets the oldest go as each one arrives — so
 * `maxVisible` narrows what the queue already carries rather than revealing a backlog waiting behind it.
 *
 * It is mounted once, by `src/App.tsx`, outside the routed content, so a notification survives a route
 * change. With an empty queue it renders nothing at all rather than an empty landmark, and while it holds
 * messages the viewport itself takes no pointer events (the sheet's `pointer-events: none`, with the
 * messages opting back in), so it never covers the control a reader was reaching for.
 *
 * The container is a named `region` and deliberately not a live region: each message carries its own
 * `alert` or `status` role, and an `aria-live` here as well would announce every message twice.
 *
 * @param props - The queued messages, the queue's dismiss handle, optional classes and how many messages may
 *   stand on screen at once; see {@link ToastViewportProps}.
 * @returns The viewport, or `null` while the queue is empty.
 */
export function ToastViewport({
  toasts,
  onDismiss,
  className,
  maxVisible = TOAST_MAX_VISIBLE,
}: ToastViewportProps): ReactElement | null {
  const visible = toasts.slice(0, resolveVisibleCap(maxVisible));

  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      className={joinClassNames(CLASSES.viewport, className)}
      role="region"
      aria-label={A11Y_COPY.TOAST_REGION_LABEL}
    >
      {visible.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
