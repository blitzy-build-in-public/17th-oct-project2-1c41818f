/**
 * Path: src/state/hooks.ts
 * Purpose: State-facing hooks: storage-backed state, debounced value, abortable async reads and the document title
 * Lines: 351
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FEEDBACK_COPY } from "@/constants/content";
import type { ApiError, AsyncStatus, Result } from "@/types/common";
import { debounce, isAbortError } from "@/utils/async";
import { readStored, removeStored, writeStored, type StorageKey } from "@/utils/storage";

/**
 * The hooks whose readers are the state layer and the feature slices that compose it: durable state
 * through `src/utils/storage.ts`, a value that settles after a burst through `src/utils/async.ts`, an
 * abortable request, and the document title. Each wires a caller to one of those foundation modules rather
 * than owning a rule of its own, so a feature imports the hook instead of writing a second implementation
 * of it. Nothing here imports a context, a service or a component, which is what lets the contexts
 * themselves consume it without an import cycle.
 *
 * The hooks shared presentation reads — `usePagination`, `useMediaQuery`, `useBreakpoint` and
 * `useOnClickOutside` — live beside the primitives that read them in `src/components/ui/hooks.ts`, because
 * shared presentation is a layer below this one and may not import upward. Neither file holds a copy of the
 * other's hooks: the split is by who reads a hook, and every hook has exactly one home.
 */

// Shared helpers ---------------------------------------------------------------------------------

/** Compares two dependency lists element by element, the same way `Object.is` compares their inputs. */
function sameDeps(previous: readonly unknown[], next: readonly unknown[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

/** Reports whether a caught rejection already carries the `ApiError` fields. */
function isApiErrorShape(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const { status, code, message } = value as Partial<ApiError>;
  return typeof status === "number" && typeof code === "string" && typeof message === "string";
}

/**
 * Shapes a rejection into the failure a page can render. Requests resolve a failed `Result` instead of
 * throwing, so this only ever sees a caller's `run` that threw anyway.
 */
function failureFrom(error: unknown): ApiError {
  if (isApiErrorShape(error)) return error;
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : FEEDBACK_COPY.ERROR_STATE_BODY;
  return { status: 500, code: "unexpected-error", message };
}

/**
 * Narrows a hook's key to the product-key union `src/utils/storage.ts` accepts. {@link useLocalStorage}
 * takes the caller's plain string so a caller need not import that union, while the storage module keeps
 * its signatures keyed to the entries of `STORAGE_KEYS`, which are the only keys any caller passes.
 */
function productStorageKey(key: string): StorageKey {
  return key as StorageKey;
}

// Storage-backed state ---------------------------------------------------------------------------

/** Options for {@link useLocalStorage}. */
export interface LocalStorageOptions<TValue> {
  /** Proves a stored payload is `TValue`; one the guard rejects is discarded for `initialValue`. */
  readonly validate?: (value: unknown) => value is TValue;
}

/** What {@link useLocalStorage} returns: the value, its setter and its remover. */
export type LocalStorageResult<TValue> = readonly [
  TValue,
  (next: TValue | ((previous: TValue) => TValue)) => void,
  () => void,
];

/** Reports whether an update is a function of the previous value rather than the next value itself. */
function isUpdater<TValue>(
  next: TValue | ((previous: TValue) => TValue),
): next is (previous: TValue) => TValue {
  return typeof next === "function";
}

/**
 * State that survives a reload, read once from the store and written back only when it changes.
 *
 * This is the product's only storage-reading hook and it delegates every read, write and removal to
 * `src/utils/storage.ts`, which owns the versioned envelope, the availability probe and the
 * degradation, so a browser that refuses storage loses persistence and keeps the state. Keys come from
 * the caller: the entries of `STORAGE_KEYS` in `src/constants/config.ts` are the only ones that exist.
 *
 * The read happens once, in the lazy initialiser of the first render, so a payload another tab
 * rewrites later cannot rewind the value this hook holds. The write is guarded by the value the store
 * last accepted, so mounting does not write over a stored value and an unchanged value writes nothing.
 *
 * @param key - The product-owned key to read and write.
 * @param initialValue - Returned when nothing usable is stored, and what `remove()` falls back to.
 * @param options - Optional guard for the stored payload; see {@link LocalStorageOptions.validate}.
 * @returns The value, its setter and its remover, as a `readonly` tuple.
 */
export function useLocalStorage<TValue>(
  key: string,
  initialValue: TValue,
  options: LocalStorageOptions<TValue> = {},
): LocalStorageResult<TValue> {
  const [value, setValue] = useState<TValue>(() =>
    readStored<TValue>(productStorageKey(key), initialValue, options.validate),
  );

  // The value the store last accepted decides whether a render owes the store a write and takes no
  // part in what is rendered, so it is held in a ref rather than in state.
  const writtenRef = useRef<TValue>(value);

  useEffect(() => {
    if (Object.is(writtenRef.current, value)) return;
    writeStored(productStorageKey(key), value);
    writtenRef.current = value;
  }, [key, value]);

  const setStored = useCallback((next: TValue | ((previous: TValue) => TValue)): void => {
    setValue((previous) => (isUpdater(next) ? next(previous) : next));
  }, []);

  const remove = useCallback((): void => {
    removeStored(productStorageKey(key));
    writtenRef.current = initialValue;
    setValue(initialValue);
  }, [initialValue, key]);

  return useMemo(() => [value, setStored, remove] as const, [remove, setStored, value]);
}

// Debounced value --------------------------------------------------------------------------------

/**
 * Returns `value` once it has stopped changing for `delayMs`: how a search box turns a burst of
 * keystrokes into one suggestion request, and how an expensive derived read is kept off the keystroke
 * path.
 *
 * The delay is the caller's policy — the suggestion debounce, for instance, is
 * `SEARCH_SUGGESTION_DEBOUNCE_MS` in `src/constants/config.ts`, passed in by `SearchBar`. The mechanism
 * is `debounce` in `src/utils/async.ts`, rebuilt for each quiet period so that the effect's cleanup
 * cancels a pending commit both when the value changes again and when the component unmounts. The new
 * value is published from the debounced timer, never from the effect body, so no render schedules state
 * of its own.
 *
 * @param value - The value to settle; the first render returns it unchanged.
 * @param delayMs - Quiet period in milliseconds before a changed value is published.
 * @returns The last value that stayed unchanged for `delayMs`.
 */
export function useDebouncedValue<TValue>(value: TValue, delayMs: number): TValue {
  const [settled, setSettled] = useState<TValue>(value);

  useEffect(() => {
    const commit = debounce((next: TValue): void => {
      setSettled(() => next);
    }, delayMs);
    commit(value);
    return () => commit.cancel();
  }, [delayMs, value]);

  return settled;
}

// Async data -------------------------------------------------------------------------------------

/** Options for {@link useAsync}. */
export interface UseAsyncOptions {
  /** Run when `deps` change. `false` suppresses every run and cancels one in flight. Defaults to `true`. */
  readonly enabled?: boolean;
  /**
   * Run on mount. `false` waits for the first `reload()`, which is how a screen that fetches only on
   * demand — a detail panel opened by an action — avoids an empty first call. Defaults to `true`.
   */
  readonly immediate?: boolean;
}

/**
 * The lifecycle of one request with its payload and failure, plus the actions a caller drives.
 * Structurally this is `AsyncState` from `src/types/common.ts` carrying its actions, so a value of this
 * shape passes to anything that renders the four async states: `data` is set only by a successful run
 * and `error` only by a failed one.
 */
export interface AsyncQueryState<TValue> {
  readonly status: AsyncStatus;
  readonly data: TValue | null;
  readonly error: ApiError | null;
  /** Run again, keeping the current `deps`. */
  readonly reload: () => void;
  /** Abort anything in flight and return to `idle`, discarding the payload and the failure. */
  readonly reset: () => void;
  /** Abort anything in flight and keep the current status: a cancelled run reports no failure. */
  readonly cancel: () => void;
}

/** The `idle` state every instance starts from, shared rather than allocated per render. */
const IDLE_ASYNC_SNAPSHOT = { status: "idle", data: null, error: null } as const;

/** The state held between runs: the lifecycle fields of {@link AsyncQueryState} alone. */
type AsyncSnapshot<TValue> = Pick<AsyncQueryState<TValue>, "status" | "data" | "error">;

/** What a run was triggered by, so a new run is recognised by comparison rather than by an array. */
interface AsyncTrigger {
  readonly deps: readonly unknown[];
  readonly runToken: number;
  readonly enabled: boolean;
}

/**
 * Runs an abortable request whenever the caller's `deps` change, reporting the four lifecycle states.
 *
 * `run` is read through a ref and is deliberately not what triggers a load: an inline fetcher is a new
 * function on every render, so depending on its identity would reload on every render — the endless
 * request loop this hook is shaped to make impossible. The trigger is the `deps` list the caller passed,
 * compared element by element, which is also why the effect carries no dependency array: the caller's
 * list is rebuilt each render and cannot be spread into one. Pass the inputs the request actually reads
 * — a query, a page, an id — and nothing that is rebuilt each render.
 *
 * Each run owns one `AbortController`: a newer run aborts the one before it, and unmounting or disabling
 * the hook aborts whatever is in flight. A superseded run ignores its own settled promise, so a slow
 * response cannot overwrite the state of a newer request; the `signal` is the one to forward into
 * `src/lib/apiClient.ts`, which is what lets a superseded request stop rather than merely be ignored. A
 * run cancelled on purpose keeps the status it had, because a cancellation is not a failure to show.
 *
 * @param run - Starts the request, given the signal that cancels it.
 * @param deps - The inputs that decide when to run; compared with `Object.is`, element by element.
 * @param options - Whether to run automatically, and whether to run on mount; see {@link UseAsyncOptions}.
 * @returns The status, payload and failure of the request, with `reload`, `reset` and `cancel`.
 */
export function useAsync<TValue>(
  run: (signal: AbortSignal) => Promise<Result<TValue>>,
  deps: readonly unknown[],
  options: UseAsyncOptions = {},
): AsyncQueryState<TValue> {
  const enabled = options.enabled ?? true;
  const immediate = options.immediate ?? true;

  const [snapshot, setSnapshot] = useState<AsyncSnapshot<TValue>>(IDLE_ASYNC_SNAPSHOT);
  const [runToken, setRunToken] = useState(0);

  const runRef = useRef(run);
  const controllerRef = useRef<AbortController | null>(null);
  const triggerRef = useRef<AsyncTrigger | null>(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // Abort in flight when the component goes away, and re-arm the trigger so that a remount starts its
  // run: React's StrictMode invokes mount, cleanup and mount again, and a remount that found its own
  // deps unchanged would otherwise skip the request the cleanup just cancelled.
  useEffect(
    () => () => {
      triggerRef.current = null;
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.abort();
    },
    [],
  );

  const settle = useCallback(async (controller: AbortController): Promise<void> => {
    let result: Result<TValue>;
    try {
      result = await runRef.current(controller.signal);
    } catch (error: unknown) {
      // A cancelled run reports nothing: the run that cancelled it owns the state from here on.
      if (isAbortError(error) || controller.signal.aborted) return;
      setSnapshot({ status: "error", data: null, error: failureFrom(error) });
      return;
    }
    if (controller.signal.aborted) return;
    setSnapshot(
      result.ok
        ? { status: "success", data: result.value, error: null }
        : { status: "error", data: null, error: result.error },
    );
  }, []);

  const reload = useCallback((): void => {
    setRunToken((token) => token + 1);
  }, []);
  const cancel = useCallback((): void => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
  }, []);
  const reset = useCallback((): void => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    setSnapshot(IDLE_ASYNC_SNAPSHOT);
  }, []);

  useEffect(() => {
    const previous = triggerRef.current;
    triggerRef.current = { deps, runToken, enabled };
    if (!enabled) return cancel();
    if (!immediate && runToken === 0) return;
    const triggered =
      previous === null ||
      previous.runToken !== runToken ||
      previous.enabled !== enabled ||
      !sameDeps(previous.deps, deps);
    if (!triggered) return;

    const controller = new AbortController();
    const superseded = controllerRef.current;
    controllerRef.current = controller;
    superseded?.abort();
    // The run starts from a microtask rather than in the effect's synchronous phase, so the loading
    // snapshot lands in its own render instead of cascading out of the effect that triggered it.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setSnapshot({ status: "loading", data: null, error: null });
      void settle(controller);
    });
  });

  return useMemo(
    () => ({
      status: snapshot.status,
      data: snapshot.data,
      error: snapshot.error,
      reload,
      reset,
      cancel,
    }),
    [cancel, reload, reset, snapshot.data, snapshot.error, snapshot.status],
  );
}

// Document title ---------------------------------------------------------------------------------

/**
 * Sets the document title for as long as the calling page is mounted. The title is composed by the
 * caller from the copy in `src/constants/content.ts`, so no sentence is held here; the page rendered
 * next sets its own, and nothing is restored on unmount. Where there is no document — Vitest's `node`
 * project — the call is a no-op rather than a crash.
 *
 * @param title - The full document title, the `SalesPro` suffix included.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = title;
  }, [title]);
}
