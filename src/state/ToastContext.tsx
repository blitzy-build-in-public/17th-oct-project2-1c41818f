/**
 * Path: src/state/ToastContext.tsx
 * Purpose: The toast queue with success, error and info helpers
 * Lines: 249
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

/**
 * The three registers a transient outcome can be reported in: an action that
 * completed, an action that failed, and a neutral note.
 *
 * A string union rather than an `enum`, because the compiler runs with
 * `erasableSyntaxOnly`, which forbids syntax it cannot erase.
 */
export type ToastKind = "success" | "error" | "info";

/**
 * One queued notification, complete enough for the viewport to render as it
 * stands.
 *
 * `durationMs` is the queue's duration policy for this message: the viewport's
 * timer honours it, while the behaviour around that timer — pausing while the
 * pointer or the keyboard focus rests on the item, and then asking the queue to
 * remove it — belongs to the viewport.
 */
export interface ToastMessage {
  /** Stable handle for this message: handed out by `notify`, accepted by `dismiss`. */
  readonly id: number;
  /** Which register the message is reported in. */
  readonly kind: ToastKind;
  /** The message text, supplied by the caller and never composed here. */
  readonly message: string;
  /** Short heading rendered above the message when the caller supplies one. */
  readonly title?: string;
  /** How long the message may stay on screen, in milliseconds. */
  readonly durationMs: number;
}

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
  /** The queued notifications, oldest first, never more than `TOAST_MAX_VISIBLE`. */
  readonly toasts: readonly ToastMessage[];
  /** Queues a notification of any kind, and returns the new message's id. */
  readonly notify: (input: ToastInput) => number;
  /** Queues a success notification, and returns its id. */
  readonly success: (message: string, options?: ToastHelperOptions) => number;
  /** Queues an error notification, and returns its id. */
  readonly error: (message: string, options?: ToastHelperOptions) => number;
  /** Queues an informational notification, and returns its id. */
  readonly info: (message: string, options?: ToastHelperOptions) => number;
  /** Removes the message with this id, and does nothing when no message has it. */
  readonly dismiss: (id: number) => void;
  /** Removes every queued message at once. */
  readonly clear: () => void;
}

/**
 * The single home of the queue's duration policy: how long a message of each kind
 * stays on screen unless the caller overrides it through `ToastInput.durationMs`.
 *
 * A failure needs longer to read than a confirmation, which is why an error
 * outlasts a success or an info note. The viewport reads the resolved value from
 * the message it renders, so it carries no copy of these numbers.
 */
export const TOAST_DURATION_MS: Readonly<Record<ToastKind, number>> = {
  success: 5000,
  error: 8000,
  info: 5000,
};

/**
 * How many notifications a burst may leave on screen. A burst longer than this
 * keeps the newest and lets the oldest go, so an action that reports twice cannot
 * stack a column of notices over the page it is reporting on.
 */
export const TOAST_MAX_VISIBLE = 4;

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
 * The provider owns the queue and the enqueue, dismiss, cap and duration policy,
 * and deliberately owns nothing else. The rendered item, the live region and the
 * auto-dismiss timer — pausing it while the pointer or the focus rests on an item
 * — live in the viewport, `src/components/ui/Toast.tsx`, which reads `toasts`,
 * honours each message's `durationMs` and calls `dismiss(id)` when that time is
 * up. That split is why this module holds no timer, no markup and no words, and
 * why no toast survives a reload: nothing here is persisted.
 *
 * The queue lives in `useState` with functional updates, because a burst of
 * notifications raised within one tick must all be accounted for, and ids come
 * from a ref-held counter rather than a random source or a clock, so a test can
 * name the message it means.
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

  const notify = useCallback((input: ToastInput): number => {
    const id = lastIdRef.current + 1;
    lastIdRef.current = id;
    const message: ToastMessage = {
      id,
      kind: input.kind,
      message: input.message,
      title: input.title,
      durationMs: input.durationMs ?? TOAST_DURATION_MS[input.kind],
    };
    setToasts((queue) => appendWithinLimit(queue, message));
    return id;
  }, []);

  const success = useCallback(
    (message: string, options?: ToastHelperOptions): number =>
      notify(buildInput("success", message, options)),
    [notify],
  );

  const error = useCallback(
    (message: string, options?: ToastHelperOptions): number =>
      notify(buildInput("error", message, options)),
    [notify],
  );

  const info = useCallback(
    (message: string, options?: ToastHelperOptions): number =>
      notify(buildInput("info", message, options)),
    [notify],
  );

  const dismiss = useCallback((id: number): void => {
    setToasts((queue) => {
      const remaining = queue.filter((toast) => toast.id !== id);
      return remaining.length === queue.length ? queue : remaining;
    });
  }, []);

  const clear = useCallback((): void => {
    setToasts((queue) => (queue.length === 0 ? queue : EMPTY_QUEUE));
  }, []);

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
