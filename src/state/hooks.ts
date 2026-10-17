/**
 * Path: src/state/hooks.ts
 * Purpose: Shared hooks: storage-backed state, debounced value, pagination, media query, async data, document title, outside click
 * Lines: 600
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { BREAKPOINTS, type Breakpoint } from "@/constants/config";
import type { ApiError, AsyncStatus, PageResult, Result } from "@/types/common";
import { debounce, isAbortError } from "@/utils/async";
import { clampPage, normalisePageSize, pageCountFor, pageWindow } from "@/utils/collections";
import { readStored, removeStored, writeStored, type StorageKey } from "@/utils/storage";

/**
 * The hooks every context, page and component shares: durable state through `src/utils/storage.ts`, a
 * value that settles after a burst through `src/utils/async.ts`, paging arithmetic through
 * `src/utils/collections.ts`, the responsive stops in `src/constants/config.ts`, an abortable request,
 * the document title, and dismissal when a pointer lands outside an element. Each wires a caller to one
 * of those foundation modules rather than owning a rule of its own, so a feature imports the hook
 * instead of writing a second implementation of it. Nothing here imports a context, a service or a
 * component, which is what lets the contexts themselves consume it without an import cycle.
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
  const message = error instanceof Error && error.message.length > 0 ? error.message : "";
  return {
    status: 500,
    code: "unexpected-error",
    message: message.length > 0 ? message : "The request failed unexpectedly.",
  };
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

// Paging -----------------------------------------------------------------------------------------

/** A page button or the gap between two runs of buttons, as `slots` reports it. */
export type PaginationSlot = number | "ellipsis";

/** The gap between two runs of page buttons, named once so the control matches on a single value. */
const PAGE_WINDOW_ELLIPSIS = "ellipsis";

/**
 * The paging a control renders: the metadata of the payload shape the listing services return, taken
 * from `PageResult` without its `items` so the control and the payload cannot describe paging
 * differently, plus the buttons to draw and the actions that change the page.
 */
export interface PaginationState extends Omit<PageResult<never>, "items"> {
  /** The page buttons in render order, with one `"ellipsis"` standing in for a run left out. */
  readonly slots: readonly PaginationSlot[];
  /** Go to a page; one outside the range is confined to the nearest that exists. */
  readonly goTo: (page: number) => void;
  readonly first: () => void;
  readonly last: () => void;
  readonly next: () => void;
  readonly previous: () => void;
  /** Change the page size and return to the first page; an unconfigured size falls back to the default. */
  readonly setPageSize: (pageSize: number) => void;
}

/** What {@link usePagination} reads: the paging a caller holds, and where a change is reported. */
export interface PaginationInput extends Pick<PageResult<never>, "page" | "pageSize" | "total"> {
  /** Called with the page and page size the reader asked for; the caller writes them to the URL. */
  readonly onChange: (page: number, pageSize: number) => void;
}

/**
 * Everything the pagination control needs, derived from the paging a caller holds.
 *
 * The arithmetic is not restated here: `pageCountFor`, `clampPage`, `pageWindow` and
 * `normalisePageSize` in `src/utils/collections.ts` are its single implementation, which is why the
 * control in `src/components/ui/Pagination.tsx` and the collections it pages over can never disagree
 * about how many pages exist. A page outside the range is confined to the nearest that does, and a page
 * size outside the configured set falls back to `DEFAULT_PAGE_SIZE`, so an unvalidated query parameter
 * cannot reach a request. Changing the page size returns to the first page, because the page a reader
 * was on rarely means the same rows at a different size.
 *
 * @param input - The paging in force and the callback that reports a change; see {@link PaginationInput}.
 * @returns The current paging, the page buttons to draw and the actions that change them.
 */
export function usePagination(input: PaginationInput): PaginationState {
  const { onChange, page } = input;
  const total = Number.isFinite(input.total) && input.total > 0 ? Math.floor(input.total) : 0;
  const pageSize = normalisePageSize(input.pageSize);
  const pageCount = pageCountFor(total, pageSize);
  const currentPage = clampPage(page, pageCount);

  const slots = useMemo<readonly PaginationSlot[]>(
    () =>
      pageWindow(currentPage, pageCount).map((entry) =>
        entry.kind === "page" ? entry.page : PAGE_WINDOW_ELLIPSIS,
      ),
    [currentPage, pageCount],
  );

  const goTo = useCallback(
    (next: number): void => {
      onChange(clampPage(next, pageCount), pageSize);
    },
    [onChange, pageCount, pageSize],
  );

  const first = useCallback((): void => goTo(1), [goTo]);
  const last = useCallback((): void => goTo(pageCount), [goTo, pageCount]);
  const next = useCallback((): void => goTo(currentPage + 1), [currentPage, goTo]);
  const previous = useCallback((): void => goTo(currentPage - 1), [currentPage, goTo]);

  const setPageSize = useCallback(
    (requested: number): void => {
      onChange(1, normalisePageSize(requested));
    },
    [onChange],
  );

  return {
    page: currentPage,
    pageSize,
    total,
    pageCount,
    hasNext: currentPage < pageCount,
    hasPrevious: currentPage > 1,
    slots,
    goTo,
    first,
    last,
    next,
    previous,
    setPageSize,
  };
}

// Responsive layout ------------------------------------------------------------------------------

/**
 * Reads the current match state of a media query. An environment with no DOM — Vitest's `node` project,
 * and any consumer outside a browser — reports `false` rather than throwing.
 */
function readMediaQuery(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/** The query a match state was read for, so a query that changed is answered from the DOM. */
interface MediaQuerySnapshot {
  readonly query: string;
  readonly matches: boolean;
}

/**
 * Reports whether a media query currently matches, and re-renders when it starts or stops matching.
 *
 * The query is read once in the lazy initialiser and then tracked through the `MediaQueryList` `change`
 * event, whose listener is removed when the query changes or the component unmounts, so a resize cannot
 * multiply listeners. A query that changed between two renders is answered from the DOM during that
 * render rather than from the snapshot the previous query recorded, keeping the reading correct before
 * the browser dispatches anything. Pass a query that is stable by value across renders.
 *
 * @param query - A media query string, such as `(min-width: 768px)`.
 * @returns `true` while the query matches, and `false` where there is no DOM to ask.
 */
export function useMediaQuery(query: string): boolean {
  const [snapshot, setSnapshot] = useState<MediaQuerySnapshot>(() => ({
    query,
    matches: readMediaQuery(query),
  }));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => {
      setSnapshot({ query, matches: event.matches });
    };
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return snapshot.query === query ? snapshot.matches : readMediaQuery(query);
}

/** The name each configured stop is reported under; total over `Breakpoint`, so a new stop must be named here. */
const BREAKPOINT_NAMES = {
  SMALL: "sm",
  MEDIUM: "md",
  LARGE: "lg",
  XLARGE: "xl",
} as const satisfies Record<Breakpoint, string>;
/** The name of a responsive stop, lowest first; the widths behind them are `BREAKPOINTS`. */
export type BreakpointName = (typeof BREAKPOINT_NAMES)[Breakpoint];

/**
 * The stop a viewport is at, and the three coarse flags the layout switches on: mobile is everything
 * below the small stop, tablet everything up to the large one, and desktop everything at or above it.
 */
export interface BreakpointInfo {
  /** The highest configured stop the viewport reaches; below the first one it is `"sm"`. */
  readonly current: BreakpointName;
  /** Below the small stop: the header collapses behind a menu and the grid runs one column. */
  readonly isMobile: boolean;
  /** At or above the small stop and below the large one: the grid runs two or three columns. */
  readonly isTablet: boolean;
  /** At or above the large stop: the sidebar and the four-column grid fit. */
  readonly isDesktop: boolean;
}

/**
 * The responsive stop the viewport is at, read from the widths in `src/constants/config.ts` — the same
 * numbers `src/styles/tokens.css` repeats as media-query literals, which is why no width is written out
 * here. `"sm"`, `"md"`, `"lg"` and `"xl"` are cumulative: each names the highest configured stop reached.
 *
 * @returns The current stop and the mobile, tablet and desktop flags.
 */
export function useBreakpoint(): BreakpointInfo {
  const aboveSmall = useMediaQuery(`(min-width: ${BREAKPOINTS.SMALL}px)`);
  const aboveMedium = useMediaQuery(`(min-width: ${BREAKPOINTS.MEDIUM}px)`);
  const aboveLarge = useMediaQuery(`(min-width: ${BREAKPOINTS.LARGE}px)`);
  const aboveXLarge = useMediaQuery(`(min-width: ${BREAKPOINTS.XLARGE}px)`);

  const reached: Breakpoint = aboveXLarge
    ? "XLARGE"
    : aboveLarge
      ? "LARGE"
      : aboveMedium
        ? "MEDIUM"
        : "SMALL";
  const current: BreakpointName = BREAKPOINT_NAMES[reached];

  return useMemo(
    () => ({
      current,
      isMobile: !aboveSmall,
      isTablet: aboveSmall && !aboveLarge,
      isDesktop: aboveLarge,
    }),
    [aboveLarge, aboveSmall, current],
  );
}

// Async data -------------------------------------------------------------------------------------

/** Options for {@link useAsync}. */
export interface UseAsyncOptions {
  /** Run when `deps` change. `false` suppresses every automatic run until `reload()`. Defaults to `true`. */
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
 * Each run owns one `AbortController`: starting a new run aborts the one before it, unmounting aborts
 * whatever is in flight, and a run whose controller has been superseded ignores its own settled promise,
 * so a slow response cannot overwrite the state of a newer request. The `signal` is the one to forward
 * into `src/lib/apiClient.ts`, which is what lets a superseded request stop rather than merely be
 * ignored. A run cancelled on purpose keeps the status it had, because a cancellation is not a failure
 * to show a reader.
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

  useEffect(() => {
    const previous = triggerRef.current;
    triggerRef.current = { deps, runToken, enabled };
    if (!enabled || (!immediate && runToken === 0)) return;
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

// Outside pointer --------------------------------------------------------------------------------

/** Options for {@link useOnClickOutside}. */
export interface UseOnClickOutsideOptions {
  /** Whether to listen at all; `false` removes the listener. Defaults to `true`. */
  readonly enabled?: boolean;
}

/**
 * Calls `handler` when a pointer goes down outside `ref`'s element.
 *
 * The overlays in `src/components/ui/Modal.tsx` — the modal, the drawer and the confirm dialog — rely on
 * this for dismissal, alongside the Escape key their own handler reads. The listener is registered on
 * the document for `pointerdown`, which covers a mouse, a finger and a stylus in one path, and the
 * handler is read through a ref so that a caller passing an inline arrow does not re-register the
 * listener on every render. An event whose target sits inside the element is ignored, which is what lets
 * a control inside an overlay be used without dismissing it.
 *
 * @param ref - The element that must contain the pointer for the event to be ignored.
 * @param handler - Called with the event that landed outside, so a caller can stop propagation.
 * @param options - Whether to listen; see {@link UseOnClickOutsideOptions.enabled}.
 */
export function useOnClickOutside<TElement extends HTMLElement>(
  ref: RefObject<TElement | null>,
  handler: (event: MouseEvent | TouchEvent) => void,
  options: UseOnClickOutsideOptions = {},
): void {
  const enabled = options.enabled ?? true;
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const element = ref.current;
      if (element === null) return;
      const target = event.target;
      if (target instanceof Node && element.contains(target)) return;
      handlerRef.current(event);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [enabled, ref]);
}
