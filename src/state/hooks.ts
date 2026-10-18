/**
 * Path: src/state/hooks.ts
 * Purpose: State-facing hooks: storage-backed state, debounced value, the async read re-exported from `src/state/asyncQuery.ts`, and the document title
 * Lines: 168
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { debounce } from "@/utils/async";
import { readStored, removeStored, writeStored, type StorageKey } from "@/utils/storage";

/**
 * The hooks whose readers are the state layer and the feature slices that compose it: durable state
 * through `src/utils/storage.ts`, a value that settles after a burst through `src/utils/async.ts`, an
 * abortable request, and the document title. Each wires a caller to one of those foundation modules rather
 * than owning a rule of its own, so a feature imports the hook instead of writing a second implementation
 * of it. Nothing here imports a context, a service or a component, which is what lets the contexts
 * themselves consume it without an import cycle.
 *
 * Two members of the set could not stay here, and each has exactly one home elsewhere. The hooks shared
 * presentation reads — `usePagination`, `useMediaQuery`, `useBreakpoint` and `useOnClickOutside` — live
 * beside the primitives that read them in `src/components/ui/hooks.ts`, because shared presentation is a
 * layer below this one and may not import upward. The async-data hook — `useAsync`, the options it takes
 * and the lifecycle it reports — is written in `src/state/asyncQuery.ts` and re-exported below, because it
 * is the concern that carried this file past the request's 600-line ceiling. The split is by who reads a
 * hook, so neither file holds a copy of what is in another.
 */

// The public surface ------------------------------------------------------------------------------
// The async-data concern of this module's set — `useAsync`, its options and the lifecycle it reports —
// lives in `src/state/asyncQuery.ts`, because that concern carried this file past the request's 600-line
// ceiling, which is never raised. Every name a consumer imports stays at this path, as
// `src/utils/dates.ts` repeats the names of `src/utils/isoInstants.ts`.

export { useAsync, type AsyncQueryState, type UseAsyncOptions } from "@/state/asyncQuery";

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
// `useAsync`, `UseAsyncOptions` and `AsyncQueryState` are re-exported at the top of this file from
// `src/state/asyncQuery.ts`, the second file this module's own concern is split into.

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
