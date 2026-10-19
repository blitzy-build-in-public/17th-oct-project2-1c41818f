/**
 * Path: src/components/ui/ToastItem.tsx
 * Purpose: One queued toast message: its markup, its kind's glyph and live role, and its pausable countdown
 * Lines: 296
 */

import { useCallback, useEffect, useRef } from "react";
import type { ReactElement } from "react";

import { IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/Icons";
import { TOAST_DURATION_MS } from "@/constants/config";
import { COMMON_ACTIONS } from "@/constants/content";
import type { ToastKind, ToastMessage } from "@/types/common";

/*
 * Why this file exists beside `Toast.tsx`: the toast family is one concern and it is more than one file can
 * hold under the plan's 600-line ceiling, so the ceiling splits it rather than being raised. This file owns a
 * single message — the frame a reader reads and dismisses, the live role it is announced through and the
 * countdown that ends it — and `Toast.tsx` owns the stack those messages stand in: the viewport, the visible
 * cap, the pointer probe and the focus a dismissal hands on. Nothing here imports `Toast.tsx`, so the
 * dependency runs one way.
 */

/*
 * Class contract. `src/styles/toasts.css` — the sheet `src/styles/data-display.css` loads through
 * `@import`, and the sole definition site of the toast family — owes the classes rendered below: the frame
 * `sp-toast`, a two-column grid whose second track holds the dismiss control and which the sheet makes
 * pass-through as well, so the words of a message never take the click aimed at the control they happen to sit
 * over; the three variants `sp-toast--success`, `sp-toast--error` and `sp-toast--info`; the text row
 * `sp-toast__message`, whose direct child `svg` the sheet sizes; and the dismiss control's `sp-toast__close`,
 * the one descendant the sheet gives `pointer-events: auto`, because it is the one part of a message a reader
 * has to click.
 * The dismiss control is the button primitive dressed with that class, so the 44px `--touch-target-min`
 * floor `sp-btn--icon` declares decides its target and stays the primitive's business.
 * The register is never carried by hue alone. The variant class tints the frame, the leading border and the
 * text together, and each message also draws its kind's glyph inside the text row, so a reader who cannot
 * separate the three surfaces can still separate a tick, an exclamation and an "i".
 */

/** Every class the toast family puts on the page, written once so a rename is one edit. */
export const CLASSES = {
  viewport: "sp-toast-viewport",
  toast: "sp-toast",
  message: "sp-toast__message",
  close: "sp-toast__close",
} as const;

/**
 * The dismiss control of one message, as a selector: the class contract above read back from the live DOM, which
 * is how a dismissal finds the control of a message other than the one the reader is on.
 */
export const DISMISS_CONTROL_SELECTOR = `.${CLASSES.close}`;

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
 * screen reader reads is the message and not the column it joins.
 *
 * The message element is the live region; the viewport must therefore never carry `aria-live` as well, and
 * each message is an `alert` or a `status`. That is what keeps a message from being announced twice, and the
 * trade-off it takes deliberately is that assistance which only announces a live region already present when
 * its content changed may not announce the first message, where a newly inserted `alert` is widely announced
 * and a `status` is not universally.
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
export function joinClassNames(...names: readonly (string | false | undefined)[]): string {
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

/** What {@link ToastItem} renders: one queued message and the queue's dismiss handle. */
interface ToastItemProps {
  /** The message to render, exactly as the queue holds it. */
  readonly toast: ToastMessage;
  /** The queue's stable `dismiss`, which is how a message leaves. */
  readonly onDismiss: (id: number) => void;
  /**
   * Whether the pointer is resting over the stack this message stands in, as
   * {@link ToastViewport}'s probe reports it. Omitted by a caller that has no stack to measure, and absent
   * then means "no pointer over the stack" rather than "unknown".
   */
  readonly pointerOverStack?: boolean;
}

/**
 * One queued message: its markup, its own live role and its own countdown.
 *
 * The countdown is armed on mount for the message's resolved duration and asks the queue to remove the
 * message when it elapses. A reader can hold it: the pointer resting over the stack suspends the timer, and
 * so does the keyboard focus reaching its dismiss control. The pointer half arrives by two routes that meet
 * in the same count — the viewport's probe, for a real pointer, and the message element's own handlers, for
 * the synthetic pointer a component test dispatches — because a box that takes no pointer input is never
 * entered by a real pointer. Suspensions are counted rather than assumed, so a message whose pointer has
 * already left it keeps waiting while its dismiss control still holds focus — otherwise a keyboard reader
 * would be raced by a message the pointer had abandoned.
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
 * @param props - The queued message, the queue's dismiss handle, and whether the pointer rests over the stack.
 * @returns The rendered message element.
 */
export function ToastItem({ toast, onDismiss, pointerOverStack }: ToastItemProps): ReactElement {
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
   *
   * A hold already in force is respected rather than raced: the time left is recorded and no timer is
   * started, because the release that follows is what arms it. Without that, a countdown armed while a
   * reader holds the message would run underneath the hold and dismiss a message the reader is attending to
   * — which is what happens when the arming effect runs its setup a second time, as React does in
   * development, since the count is already above zero and the first hold has already cleared the timer.
   */
  const arm = useCallback(
    (delayMs: number): void => {
      deadlineRef.current = Date.now() + delayMs;
      remainingRef.current = delayMs;
      if (holdsRef.current > 0) {
        return;
      }
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

  /*
   * The pointer's own hold, reported by the viewport's probe because the message box is pass-through and a
   * real pointer can therefore never enter it. It drives the same counted hold the pointer and focus
   * handlers below drive, so the probe and a synthetic pointer compose instead of double counting: the count
   * rises while either path holds the message and the countdown resumes when the last of them lets go.
   *
   * The transition is what is acted on, remembered in a ref, and unmounting releases nothing: a release
   * there would arm the remainder against a timer that no later cleanup owns.
   */
  const pointerOverStackRef = useRef(false);
  useEffect(() => {
    const isOver = pointerOverStack === true;
    if (isOver === pointerOverStackRef.current) {
      return;
    }
    pointerOverStackRef.current = isOver;
    if (isOver) {
      hold();
    } else {
      release();
    }
  }, [hold, pointerOverStack, release]);

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
        icon={<CloseIcon />}
      />
    </div>
  );
}
