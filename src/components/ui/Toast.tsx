/**
 * Path: src/components/ui/Toast.tsx
 * Purpose: Toast viewport and item with a live region and pausable auto-dismiss
 * Lines: 614
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * control and which the sheet makes pass-through as well, so the words of a message never take the click
 * aimed at the control they happen to sit over; the three variants `sp-toast--success`, `sp-toast--error`
 * and `sp-toast--info`; the text row `sp-toast__message`, whose direct child `svg` the sheet sizes; and the
 * dismiss control's `sp-toast__close`, the one descendant the sheet gives `pointer-events: auto`, because it
 * is the one part of a message a reader has to click.
 * The dismiss control is the button primitive dressed with that class, so the 44px `--touch-target-min`
 * floor `sp-btn--icon` declares decides its target and stays the primitive's business.
 * The viewport is portalled onto `document.body` instead of being left in the application root, which an
 * open drawer, modal or confirm dialog makes inert: an inert root dims to `--opacity-inert` and so becomes a
 * stacking context painted before the panel's backdrop, under which the declared `--z-toast` rung is
 * trapped, and it keeps its subtree out of the accessibility tree as well, which would silence the live
 * region these messages carry.
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

/**
 * The dismiss control of one message, as a selector: the class contract above read back from the live DOM, which
 * is how a dismissal finds the control of a message other than the one the reader is on.
 */
const DISMISS_CONTROL_SELECTOR = `.${CLASSES.close}`;

/**
 * The id of the application's routed-content region, the `<main>` that `src/components/layout/AppLayout.tsx`
 * gives `tabIndex={-1}` so it can be focused programmatically.
 *
 * Reached through the document rather than handed down, because that region belongs to the route and the route
 * is a subtree the viewport is never given. `src/components/ui/overlayEngine.ts` reads `#root` the same way.
 */
const MAIN_CONTENT_ID = "main-content";
/**
 * Whether the box holds the point, its borders included: written once because the stack is measured from two
 * directions — the pointer a move reports and the pointer's last known position when the stack mounts — and a
 * box that measures nothing holds no point, so jsdom's laid-out-nothing elements read as holding none.
 */
function isWithin(box: DOMRect, x: number, y: number): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    x >= box.left &&
    x <= box.right &&
    y >= box.top &&
    y <= box.bottom
  );
}

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

/** What a dismissal owes the keyboard: the element the reader was on, and the control that should follow it. */
interface PendingFocus {
  /** The element holding the focus when the dismissal began, which leaves the document with its message. */
  readonly held: Element;
  /** A dismiss control that outlives the message, or `null` when it was the last message standing. */
  readonly survivor: HTMLElement | null;
}

/**
 * Finds a dismiss control other than the one the reader is on: the control that can take the focus once the
 * message holding it has left.
 *
 * The live DOM is what is read, because the queue holds no element and a message carries no identity outside
 * React; what the search returns outlives the update the dismissal is about to make.
 *
 * @param viewport - The viewport element the messages stand in.
 * @param held - The element the focus is inside, which the search skips.
 * @returns A dismiss control still standing, or `null` when the one the focus is on is the only one.
 */
function survivingDismissControl(viewport: HTMLElement, held: Element): HTMLElement | null {
  const controls = viewport.querySelectorAll<HTMLElement>(DISMISS_CONTROL_SELECTOR);
  for (const control of controls) {
    if (!control.contains(held)) {
      return control;
    }
  }
  return null;
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
function ToastItem({ toast, onDismiss, pointerOverStack }: ToastItemProps): ReactElement {
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
 * change, and it is rendered through `createPortal` onto `document.body` rather than into the application
 * root it is mounted from. A panel of the overlay family makes that root inert while it is open, and an
 * inert root is dimmed to `--opacity-inert` — which makes it a stacking context painted before the panel's
 * own body-level backdrop — so a viewport left inside it would be trapped below the `--z-drawer` backdrop
 * however high its own `--z-toast` rung reads, and the same attribute would keep the messages out of the
 * accessibility tree the live region exists for. Portalling past the root is the shape the whole
 * accessibility tree is then read: the container is a named `region` with no `aria-live`, and each message
 * is a `status` or an `alert` of its own, in the accessibility tree whatever else is open.
 *
 * With an empty queue it renders nothing at all rather than an empty landmark, and while it holds messages
 * neither the viewport nor a message box takes a pointer event (the sheet's `pointer-events: none` on both,
 * re-enabled on the dismiss control alone), so a message never covers the control a reader was reaching for.
 * The countdowns still pause while a reader attends to a message: the pointer resting anywhere over the
 * stack, which is what the pointermove probe below reports, and the keyboard focus reaching a control inside
 * one, which the message element's own focus handlers report.
 *
 * A message leaves by its own countdown or by its dismiss control, and that control stands inside the message
 * being removed. A dismissal that begins with the focus inside the viewport therefore ends by handing the focus
 * on — to a message still standing, or to the application's routed content region when that was the last one —
 * so the reader's place in the page survives the message and the next Tab carries on from there rather than
 * from the top of the document. A dismissal that begins with the focus anywhere else moves no focus at all,
 * which is what keeps a message leaving the corner of the screen from pulling a reader away from their control.
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerOverStackRef = useRef(false);
  /** Where the pointer was when the document last reported it moving: the only record of a pointer that was
   * already resting where the stack appears. */
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [pointerOverStack, setPointerOverStack] = useState(false);

  /*
   * The queue's dismiss reaches an item through a stable wrapper: a wrapper rebuilt on every render would
   * change the handle each item holds, and an item re-arms its countdown when its handle changes, so a
   * second message arriving would hand the first one a fresh full duration. The ref carries the latest props
   * into a wrapper whose identity never changes, and it is the same ref that tells the handler below whether
   * the queue still holds the message a click asked to remove.
   */
  const queueRef = useRef({ toasts, onDismiss });
  useEffect(() => {
    queueRef.current = { toasts, onDismiss };
  });

  /*
   * The focus one dismissal owes, recorded by the handler below and paid by the layout effect after it: the
   * element the reader was on, and the control still standing that should take the focus if that element goes.
   */
  const pendingFocusRef = useRef<PendingFocus | null>(null);

  /**
   * Dismisses one message, keeping the reader's keyboard focus in the application.
   *
   * The dismiss control stands inside the message it removes, so activating it takes the focused element out of
   * the document with the message, and a browser left with nothing focused falls back to the body: the reader
   * loses their place in the page, and the next Tab starts again at the top of the document. A dismissal that
   * begins while the focus is inside the viewport is therefore recorded — what the reader was on, and a control
   * to hand the focus to — and the layout effect below pays it out once React has removed the message. A
   * dismissal that begins with the focus anywhere else moves no focus at all, so a message leaving the corner of
   * the screen never pulls a reader away from the control they are working.
   *
   * With a drawer or another panel open, the panel's own focus restore runs as well and wins, taking the reader
   * back to the control that opened it. That is the right answer, and the focus stays in the application either
   * way.
   *
   * @param id - The id the queue returned for the message to remove.
   */
  const dismissToast = useCallback((id: number): void => {
    const viewport = viewportRef.current;
    const held = document.activeElement;
    /*
     * Only a message the queue still holds leaves it, and only then is there an update for the layout effect to
     * account for. An id already gone — a countdown and a control racing over one message — would otherwise
     * leave a record standing, to be paid on some later render it has nothing to do with.
     */
    const isQueued = queueRef.current.toasts.some((toast) => toast.id === id);
    if (isQueued && viewport !== null && held !== null && viewport.contains(held)) {
      pendingFocusRef.current = { held, survivor: survivingDismissControl(viewport, held) };
    }
    queueRef.current.onDismiss(id);
  }, []);

  /*
   * The focus a dismissal owes, paid once React has taken the message out of the document: the only moment at
   * which the element that left can be told from the elements that outlived it. One ref is read, and a render
   * with no dismissal to settle returns from here at once.
   */
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) {
      return;
    }
    pendingFocusRef.current = null;
    if (pending.held.isConnected) {
      /*
       * The element the reader was on outlived the message that left — a countdown took a different one — so the
       * focus is already where it belongs and is left exactly as it stands.
       */
      return;
    }
    const { survivor } = pending;
    const target =
      survivor !== null && survivor.isConnected
        ? survivor
        : document.getElementById(MAIN_CONTENT_ID);
    /*
     * Focusing the routed content region moves the focus and must not move the reader's view: the place in the
     * page they had reached is theirs to keep.
     */
    target?.focus({ preventScroll: true });
  });

  const visible = toasts.slice(0, resolveVisibleCap(maxVisible));

  /*
   * The stack-level probe that keeps auto-dismiss pausing on hover now that a message box takes no pointer
   * input: the pointer is watched at the document and measured against the viewport's own rectangle, so
   * resting anywhere over the stack holds every message standing in it without a message having to be
   * entered. The listener is attached for the lifetime of the component rather than for as long as a message
   * stands, because the state it drives is corrected only by a pointer move — a listener detached while the
   * queue was empty would leave a stale "inside" behind, and the next message raised would hold until the
   * reader happened to move the mouse again. What it costs is one passive listener, whose handler returns at
   * once while no viewport is mounted and while the rectangle it reads measures nothing.
   *
   * The handler answers "not over the stack" while no viewport is mounted, because with nothing on screen
   * there is nothing a pointer could be resting over: an answer left standing from a message that has since
   * left would pause the next one raised, however far from the corner the pointer had travelled in between.
   *
   * A rectangle that measures nothing is not a rectangle a pointer can be inside, so a zero width or height
   * leaves the state as it was: jsdom has no layout engine and reports zeros for every element, and a probe
   * reading those zeros as "inside" would pause every message in the component tests. The setter is reached
   * only from the handler below and only when the answer has changed, so a pointer move over the page costs
   * one comparison and no render while the answer holds.
   */
  const reportPointerOver = useCallback((next: boolean): void => {
    if (pointerOverStackRef.current === next) {
      return;
    }
    pointerOverStackRef.current = next;
    setPointerOverStack(next);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      const viewport = viewportRef.current;
      if (viewport === null) {
        reportPointerOver(false);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      reportPointerOver(isWithin(rect, event.clientX, event.clientY));
    };
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => document.removeEventListener("pointermove", handlePointerMove);
  }, [reportPointerOver]);

  /*
   * The stack is measured again as it mounts, against the pointer's last known position: a pointer already
   * resting where a message appears is over that message, and no move will ever report it, so without this
   * the two arrivals would disagree. The item's own hold pauses the countdown, and a release arms the remainder.
   */
  useEffect(() => {
    const viewport = viewportRef.current;
    const position = pointerPositionRef.current;
    if (viewport === null || position === null) return;
    reportPointerOver(isWithin(viewport.getBoundingClientRect(), position.x, position.y));
  }, [reportPointerOver, visible.length]);

  if (visible.length === 0 || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={joinClassNames(CLASSES.viewport, className)}
      role="region"
      aria-label={A11Y_COPY.TOAST_REGION_LABEL}
      ref={viewportRef}
    >
      {visible.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={dismissToast}
          pointerOverStack={pointerOverStack}
        />
      ))}
    </div>,
    document.body,
  );
}
