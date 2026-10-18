/**
 * Path: src/state/ToastContext.tsx
 * Purpose: The toast queue with success, error and info helpers
 * Lines: 298
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from "@/constants/config";
import type { ToastKind, ToastMessage } from "@/types/common";

/*
 * The queue's two shapes and its two configured numbers belong to the foundations, and are imported rather
 * than declared here: `ToastKind` and `ToastMessage` are in `src/types/common.ts`, and `TOAST_DURATION_MS`
 * and `TOAST_MAX_VISIBLE` in `src/constants/config.ts`. Neither is re-exported, because a re-export would
 * give a concern a second name beside the one home it has, and the viewport — which sits below this layer —
 * imports them from those owners directly.
 */

/**
 * What a caller hands to `notify` or to one of the three kind helpers.
 *
 * The words are passed in rather than composed here, so that
 * `src/constants/content.ts` stays the only home of user-facing copy.
 */
export interface ToastInput {
  /** Which register the message is reported in. */
  readonly kind: ToastKind;
  /** The message text. */
  readonly message: string;
  /** Short heading rendered above the message. */
  readonly title?: string;
  /** Overrides this kind's default duration from `TOAST_DURATION_MS`. */
  readonly durationMs?: number;
}

/**
 * The per-message options a kind helper accepts once the helper has fixed the
 * kind and the message: only the heading and a duration override remain.
 */
type ToastHelperOptions = Omit<ToastInput, "kind" | "message">;

/**
 * The toast surface every consumer reaches through `useToast()`.
 *
 * The queue is read-only to consumers — `toasts` is exactly what the viewport
 * renders — and changes only through `notify`, the three kind helpers, `dismiss`
 * and `clear`. Every one of those functions is stable across renders and the
 * value carrying them is memoised, so a consumer re-renders when the queue
 * changes and not when its provider happens to render.
 *
 * Only the enqueue paths can leave the queue unchanged, and they do it for one
 * reason: a notification identical to a message already standing collapses into
 * that message instead of joining it, and hands the caller the standing id. A
 * dismissal or a clear of something the queue does not hold changes nothing.
 *
 * The six functions are declared as function-valued properties rather than as
 * methods, because the provider builds them as function-valued properties
 * either way: an object literal holding the `useCallback` results, where the
 * two forms describe the same runtime value. The property form is the one a
 * consumer can read off the object — destructuring it, or handing it to a
 * position that takes a callback — without raising
 * `@typescript-eslint/unbound-method`, which flags a method whose receiver it
 * may have been separated from, and which this repository's lint gate treats as
 * an error.
 */
export interface ToastApi {
  /** The queued notifications, oldest first, never more than `TOAST_MAX_VISIBLE` and never two of them alike. */
  readonly toasts: readonly ToastMessage[];
  /**
   * Queues a notification of any kind, and returns the id the caller holds.
   *
   * A notification is never queued twice: when the queue already holds a message with the same kind, the same
   * heading and the same words, nothing is queued and that standing message's id is what comes back, so a burst
   * of identical raises — five lines removed from the cart in a row — collapses into the one message already
   * standing rather than stacking copies of it over the page. Two messages that differ in any of those three
   * parts are not alike: the same words raised as a failure and as a confirmation are two distinguishable
   * registers, and both stand.
   */
  readonly notify: (input: ToastInput) => number;
  /**
   * Queues a success notification, collapsing into the success message already standing when it carries the
   * same heading and the same words; returns the id to hold, on the terms {@link ToastApi.notify} states.
   */
  readonly success: (message: string, options?: ToastHelperOptions) => number;
  /**
   * Queues an error notification, collapsing into the error message already standing when it carries the same
   * heading and the same words; returns the id to hold, on the terms {@link ToastApi.notify} states.
   */
  readonly error: (message: string, options?: ToastHelperOptions) => number;
  /**
   * Queues an informational notification, collapsing into the info message already standing when it carries the
   * same heading and the same words; returns the id to hold, on the terms {@link ToastApi.notify} states.
   */
  readonly info: (message: string, options?: ToastHelperOptions) => number;
  /** Removes the message with this id, and does nothing when no message has it. */
  readonly dismiss: (id: number) => void;
  /** Removes every queued message at once. */
  readonly clear: () => void;
}

/**
 * The queue itself, private to this module: consumers reach it through
 * `useToast()`. The `null` default is the "no provider above this consumer"
 * sentinel that the hook turns into an error naming what is missing.
 */
const ToastContext = createContext<ToastApi | null>(null);

/** One shared empty queue, so clearing an already empty queue keeps its identity. */
const EMPTY_QUEUE: readonly ToastMessage[] = [];

/**
 * Appends one message, and once `TOAST_MAX_VISIBLE` is reached lets the oldest go
 * so that the newest stay visible.
 */
function appendWithinLimit(
  queue: readonly ToastMessage[],
  message: ToastMessage,
): readonly ToastMessage[] {
  if (queue.length < TOAST_MAX_VISIBLE) {
    return [...queue, message];
  }
  return [...queue.slice(queue.length - TOAST_MAX_VISIBLE + 1), message];
}

/**
 * Assembles the input a kind helper hands to `notify`, keeping the optional
 * fields absent rather than present and undefined, so an absent duration falls
 * through to the kind's policy default.
 */
function buildInput(kind: ToastKind, message: string, options?: ToastHelperOptions): ToastInput {
  return options === undefined
    ? { kind, message }
    : { kind, message, title: options.title, durationMs: options.durationMs };
}

/**
 * Holds the toast queue, and provides it with its helpers to everything below.
 *
 * The provider owns the queue and the enqueue, collapse, dismissal, cap and
 * duration policy, and deliberately owns nothing else. The rendered item, the live region and the
 * auto-dismiss timer — pausing it while the pointer or the focus rests on an item
 * — live in the viewport, `src/components/ui/Toast.tsx`, which reads `toasts`,
 * honours each message's `durationMs` and calls `dismiss(id)` when that time is
 * up. That split is why this module holds no timer, no markup and no words, and
 * why no toast survives a reload: nothing here is persisted.
 *
 * The queue is written once and read from two places: `queueRef` holds the array
 * every mutation reads and rewrites, and the state beside it is that same array
 * handed to the render that paints it. The ref is what lets a burst of
 * notifications raised within one tick all be accounted for — each one reads what
 * the one before it wrote, rather than a state value React has not rendered yet —
 * and it is what lets `notify` answer with the id of a message already standing,
 * since a `useState` updater runs later and cannot report a value to its caller.
 * Ids come from a ref-held counter rather than a random source or a clock, so a
 * test can name the message it means.
 *
 * One context carries both the queue and its helpers, so every consumer
 * re-renders when the queue changes — that is what lets a viewport repaint. The
 * helpers themselves are stable across renders, so a memoised component that
 * receives them as props is not re-rendered by a notification it has nothing to
 * do with, which keeps an add-to-cart toast from re-rendering a screen that only
 * ever dismisses toasts.
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>(EMPTY_QUEUE);
  const lastIdRef = useRef(0);

  /*
   * The queue as a mutation reads it. The state above is what a render paints; this
   * ref is the same array, written before the state is, so that a notification
   * raised in the middle of a burst reads what the notification before it wrote —
   * state React has not re-rendered yet is state no enqueue may compare against, or
   * two identical raises in one tick would both join the queue.
   */
  const queueRef = useRef<readonly ToastMessage[]>(EMPTY_QUEUE);

  /**
   * Publishes the queue's next value, through the one route every mutation takes.
   *
   * The ref first, so the read that follows in the same tick sees the change, then
   * the state carrying the same array to the next render. Nothing else writes
   * either of them, so the two cannot come to disagree.
   *
   * @param next - The queue as it is to stand from this moment on.
   */
  const publish = useCallback((next: readonly ToastMessage[]): void => {
    queueRef.current = next;
    setToasts(next);
  }, []);

  /**
   * Queues one notification, unless an identical message is already standing.
   *
   * Identical means all three parts a reader can tell apart: the kind, the heading
   * and the words. The heading is compared as the queue holds it — `undefined` when
   * the caller supplied none — so a message with no heading is alike another with no
   * heading and unlike one whose heading is the empty string, the two being a
   * caller's different choices rather than the same choice written twice. A duration
   * override is deliberately not part of the comparison: it decides how long a
   * message is read for and never what it says, and a repeat of a message already
   * standing is the same feedback however long it was asked to stand.
   *
   * @param input - The kind, the words, and the optional heading and duration.
   * @returns The id to hold: the id of the identical message already standing, when
   *   there is one and nothing is queued, and otherwise the id given to the message
   *   this raises. `dismiss` accepts either.
   */
  const notify = useCallback(
    (input: ToastInput): number => {
      const queue = queueRef.current;
      const standing = queue.find(
        (toast) =>
          toast.kind === input.kind &&
          toast.title === input.title &&
          toast.message === input.message,
      );
      if (standing !== undefined) {
        return standing.id;
      }
      const id = lastIdRef.current + 1;
      lastIdRef.current = id;
      const message: ToastMessage = {
        id,
        kind: input.kind,
        message: input.message,
        title: input.title,
        durationMs: input.durationMs ?? TOAST_DURATION_MS[input.kind],
      };
      publish(appendWithinLimit(queue, message));
      return id;
    },
    [publish],
  );

  /** Queues a success notification; an identical success message already standing absorbs it. */
  const success = useCallback(
    (message: string, options?: ToastHelperOptions): number =>
      notify(buildInput("success", message, options)),
    [notify],
  );

  /** Queues an error notification; an identical failure message already standing absorbs it. */
  const error = useCallback(
    (message: string, options?: ToastHelperOptions): number =>
      notify(buildInput("error", message, options)),
    [notify],
  );

  /** Queues an informational notification; an identical note already standing absorbs it. */
  const info = useCallback(
    (message: string, options?: ToastHelperOptions): number =>
      notify(buildInput("info", message, options)),
    [notify],
  );

  const dismiss = useCallback(
    (id: number): void => {
      const queue = queueRef.current;
      const remaining = queue.filter((toast) => toast.id !== id);
      if (remaining.length !== queue.length) {
        publish(remaining);
      }
    },
    [publish],
  );

  const clear = useCallback((): void => {
    if (queueRef.current.length > 0) {
      publish(EMPTY_QUEUE);
    }
  }, [publish]);

  const value = useMemo<ToastApi>(
    () => ({ toasts, notify, success, error, info, dismiss, clear }),
    [toasts, notify, success, error, info, dismiss, clear],
  );

  return <ToastContext value={value}>{children}</ToastContext>;
}

/**
 * Reads the toast queue and its helpers.
 *
 * Returns the provider's memoised value, so two components calling this hook
 * while the queue is unchanged receive the same object. Throws when called above
 * every `ToastProvider`: that is a wiring mistake in the application rather than
 * anything a visitor can reach, so it is reported as an error instead of being
 * rendered.
 */
export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error("useToast must be called from a component within a ToastProvider.");
  }
  return value;
}
