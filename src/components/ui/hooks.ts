/**
 * Path: src/components/ui/hooks.ts
 * Purpose: The view-facing hooks the shared primitives and their composing pages read: pagination, media query, breakpoint and outside click
 * Lines: 288
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { BREAKPOINTS, type Breakpoint } from "@/constants/config";
import type { PageResult } from "@/types/common";
import {
  clampPage,
  normalisePageSize,
  pageCountFor,
  pageFlagsFor,
  pageWindow,
} from "@/utils/collections";

/**
 * The hooks shared presentation reads: the paging projection a listing control renders, the viewport stop
 * the header and the facet panel switch at, and the dismissal an overlay registers when a pointer lands
 * outside it.
 *
 * Why these live here and not in `src/state/hooks.ts`. Their readers are the shared primitives —
 * `src/components/ui/Pagination.tsx`, `src/components/ui/Tooltip.tsx` and
 * `src/components/ui/overlayEngine.ts`, which `Modal` and `Drawer` compose — the layout's own
 * `src/components/layout/Header.tsx`, and the feature pages that compose those primitives. Shared
 * presentation is a layer below State, so a primitive reaching into `src/state` would be an import running
 * upward, which the layer order forbids and which no exception is recorded for; the hooks therefore sit
 * beside the primitives that read them. `src/state/hooks.ts` keeps the hooks whose readers are the
 * contexts themselves — `useAsync`, `useLocalStorage`, `useDebouncedValue` and `useDocumentTitle` — so each
 * hook has exactly one home and neither file carries a copy of the other's.
 *
 * The split is by who reads a hook and not by what it does, and it moves no rule: `usePagination` derives
 * its paging through `src/utils/collections.ts`, `useBreakpoint` reads the widths in
 * `src/constants/config.ts`, and `useOnClickOutside` attaches one document listener, exactly as each did
 * before it moved. Nothing here imports a context, a service or a component, so this file depends on
 * Foundations alone and the layer order holds in both directions.
 */

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
 * No paging rule is restated here: `pageCountFor`, `clampPage`, `pageFlagsFor`, `pageWindow` and
 * `normalisePageSize` live in `src/utils/collections.ts`, so the control in
 * `src/components/ui/Pagination.tsx` and the collections it pages over cannot disagree about how many
 * pages exist or about whether another page does. A page outside the range is confined to the nearest
 * that exists, a size outside the configured set falls back to `DEFAULT_PAGE_SIZE` so an unvalidated
 * query parameter cannot reach a request, and changing the page size returns to the first page.
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
    ...pageFlagsFor(currentPage, pageCount),
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
