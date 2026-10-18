/**
 * Path: src/state/asyncQuery.ts
 * Purpose: The abortable async-data hook and the lifecycle types it reports, which every data-backed page renders
 * Lines: 242
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FEEDBACK_COPY } from "@/constants/content";
import type { ApiError, AsyncStatus, Result } from "@/types/common";
import { isAbortError } from "@/utils/async";

/*
 * A §0.5.5 split of `src/state/hooks.ts`, which had reached the request's 600-line ceiling with this concern
 * inside it: the hooks module keeps the storage-backed state, the debounced value and the document title, the
 * view-facing paging, media-query, breakpoint and outside-pointer hooks live beside the primitives that read
 * them in `src/components/ui/hooks.ts`, and the async-data concern lives here. The two halves of this module's
 * own contract are one — `src/state/hooks.ts` re-exports `useAsync`, `UseAsyncOptions` and `AsyncQueryState`,
 * so every consumer's path still resolves the whole of it and no call site changed — and the direction is
 * one-way, this file importing no hook from the module that publishes it, so no cycle exists.
 */

// The run's own helpers --------------------------------------------------------------------------

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

/** Options for {@link useAsync}. */
export interface UseAsyncOptions {
  /** Run when `deps` change. `false` suppresses every automatic run until `reload()`, and aborts one in flight. Defaults to `true`. */
  readonly enabled?: boolean;
  /**
   * Run on mount. `false` waits for the first `reload()`, which is how a screen that fetches only on
   * demand — a detail panel opened by an action — avoids an empty first call. Defaults to `true`.
   */
  readonly immediate?: boolean;
  /**
   * Keep the payload the last answered run published while a newer run is in flight, rather than reporting
   * none for the whole of it. Defaults to `false`, which is what a region whose content is a function of
   * the payload alone wants: the payload is gone while the next one is read, so the region renders its
   * placeholder. A caller that keeps it — the cart the shopper is correcting, a report re-run over a moved
   * period, a suggestion list the next settled term replaces — renders the content it already had and
   * reports the wait through its own busy state, and `data` is then `null` only until the first answer.
   */
  readonly keepPreviousData?: boolean;
}

/**
 * The lifecycle of one request with its payload and failure, plus the actions a caller drives.
 * Structurally this is `AsyncState` from `src/types/common.ts` carrying its actions, so a value of this
 * shape passes to anything that renders the four async states: `data` is set only by a successful run —
 * and, for a caller that asked for it, kept while the run that supersedes it is in flight — and `error`
 * only by a failed one.
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
 * Each run owns one `AbortController`: starting a new run aborts the one before it, unmounting aborts
 * whatever is in flight, and a run whose controller has been superseded ignores its own settled promise,
 * so a slow response cannot overwrite the state of a newer request. The `signal` is the one to forward
 * into `src/lib/apiClient.ts`, which is what lets a superseded request stop rather than merely be
 * ignored. A run cancelled on purpose keeps the status it had, because a cancellation is not a failure
 * to show a reader.
 *
 * A run reports no payload while it runs unless the caller asked for the payload to be kept, which is
 * what a region that is refreshing content already on screen wants: see
 * {@link UseAsyncOptions.keepPreviousData}. Either way a failed run reports no payload, so a region that
 * keeps the previous one still answers a failure with its own error state.
 *
 * @param run - Starts the request, given the signal that cancels it.
 * @param deps - The inputs that decide when to run; compared with `Object.is`, element by element.
 * @param options - Whether to run automatically, whether to run on mount, and whether the payload survives
 *   the run that supersedes it; see {@link UseAsyncOptions}.
 * @returns The status, payload and failure of the request, with `reload`, `reset` and `cancel`.
 */
export function useAsync<TValue>(
  run: (signal: AbortSignal) => Promise<Result<TValue>>,
  deps: readonly unknown[],
  options: UseAsyncOptions = {},
): AsyncQueryState<TValue> {
  const enabled = options.enabled ?? true;
  const immediate = options.immediate ?? true;
  const keepPreviousData = options.keepPreviousData ?? false;

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

  const cancel = useCallback((): void => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
  }, []);

  useEffect(() => {
    const previous = triggerRef.current;
    triggerRef.current = { deps, runToken, enabled };
    // A disabled hook answers nothing, so whatever run is in flight is aborted rather than left to settle:
    // a caller that turns `enabled` off while a request is in the air expects it to stop.
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
    // snapshot lands in its own render instead of cascading out of the effect that triggered it. The
    // payload a caller asked to keep stays where the last answered run put it, so a region that reads it
    // is not blanked by the run that supersedes the content it is already showing.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setSnapshot((previous) => ({
        status: "loading",
        data: keepPreviousData ? previous.data : null,
        error: null,
      }));
      void settle(controller);
    });
  });

  const reload = useCallback((): void => {
    setRunToken((token) => token + 1);
  }, []);
  const reset = useCallback((): void => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    setSnapshot(IDLE_ASYNC_SNAPSHOT);
  }, []);

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
