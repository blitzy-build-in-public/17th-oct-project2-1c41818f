/**
 * Path: tests/unit/state/hooksAsync.test.ts
 * Purpose: The hooks src/state/hooks.ts owns — storage-backed state, the document title and the re-exported async hook — together with the paging, media-query, breakpoint and outside-pointer hooks their readers share
 * Lines: 437
 *
 * @vitest-environment jsdom
 */

import { fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { act, createElement, createRef, useEffect, type ReactElement, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBreakpoint,
  useMediaQuery,
  useOnClickOutside,
  usePagination,
} from "@/components/ui/hooks";
import {
  BREAKPOINTS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  STORAGE_KEYS,
} from "@/constants/config";
import { useAsync, useDebouncedValue, useDocumentTitle, useLocalStorage } from "@/state/hooks";
import { readStored, removeStored, writeStored } from "@/utils/storage";
import { makeResult } from "../../fixtures";

/*
 * Why this file asks for a DOM. Every fact these hooks report is a return value of a mounted component, and most
 * of them are effects — a stored value read back, a title set on the document, a media query subscribed to — so
 * the cases mount and read `.ts` modules' neighbours under `tests/unit/**` and build their hosts with
 * `createElement` rather than JSX.
 *
 * Why the cases exist. `src/state/hooks.ts` is the product's only storage-reading hook, the hook every page
 * titles itself with, and the path every consumer imports `useAsync` from; the paging, media-query, breakpoint
 * and outside-pointer hooks are read by the shared primitives and the layout, which import them from
 * `src/components/ui/hooks.ts` — their home, because shared presentation is a layer below State. The cases cover
 * what those hooks do for their readers: the value a page opens on and writes back, the title it sets, the pages
 * a control offers, the stop a viewport is at, and the dismissal an overlay registers.
 */

// Storage-backed state ---------------------------------------------------------------------------

/** The key the storage-backed cases read and write: the last-used report range, and no other case's key. */
const STORAGE_KEY = STORAGE_KEYS.REPORT_RANGE;

/** What the hook is mounted with, and what a removal falls back to. */
const INITIAL_RANGE_DAYS = 30;

/** Proves a stored payload is the number of days a report range is held in. */
function isDayCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

describe("useLocalStorage", () => {
  beforeEach(() => {
    // Each case clears the key it drives, so a value another case left cannot decide its outcome.
    removeStored(STORAGE_KEY);
  });

  it("opens on the stored value and writes each change back to the store", () => {
    expect(writeStored(STORAGE_KEY, 90)).toBe(true);
    const { result } = renderHook(() => useLocalStorage<number>(STORAGE_KEY, INITIAL_RANGE_DAYS));

    // The read happens once, in the first render, so the page opens on the range the administrator last chose.
    expect(result.current[0]).toBe(90);

    act(() => result.current[1](120));
    expect(result.current[0]).toBe(120);
    // What the page holds is what the next document reads back.
    expect(readStored(STORAGE_KEY, 0)).toBe(120);
  });

  it("accepts a change written as a function of the value the store holds", () => {
    const { result } = renderHook(() => useLocalStorage<number>(STORAGE_KEY, INITIAL_RANGE_DAYS));

    // A page extending the range it holds hands the hook the rule rather than an answer read from a stale render.
    act(() => result.current[1]((previous) => previous + 60));
    expect(result.current[0]).toBe(90);
    expect(readStored(STORAGE_KEY, 0)).toBe(90);
  });

  it("drops the entry and returns to the value it was mounted with when the caller removes it", () => {
    const { result } = renderHook(() => useLocalStorage<number>(STORAGE_KEY, INITIAL_RANGE_DAYS));
    act(() => result.current[1](90));
    expect(readStored(STORAGE_KEY, 0)).toBe(90);

    act(() => result.current[2]());

    // The entry is gone — the storage module's own fallback answers — and the page is back on what it mounted with.
    expect(readStored(STORAGE_KEY, 0)).toBe(0);
    expect(result.current[0]).toBe(INITIAL_RANGE_DAYS);
  });

  it("discards a stored payload its caller's guard rejects", () => {
    expect(writeStored(STORAGE_KEY, { days: 90 })).toBe(true);
    const { result } = renderHook(() =>
      useLocalStorage<number>(STORAGE_KEY, INITIAL_RANGE_DAYS, { validate: isDayCount }),
    );

    // A shape an older build wrote is not the shape this page reads, so the value it mounted with answers instead.
    expect(result.current[0]).toBe(INITIAL_RANGE_DAYS);
  });
});

// Document title ---------------------------------------------------------------------------------

/** The titles a page sets, composed by its own module as `src/features/*` composes them. */
const CART_TITLE = "Cart — SalesPro";
const CHECKOUT_TITLE = "Checkout — SalesPro";

/**
 * A page rendered where the host has no document: the document is withdrawn for the interval the title hook's
 * effect occupies and put back as soon as it has run, because React and jsdom read the document themselves and
 * it cannot be missing for a whole render.
 */
function TitlelessPage({ title }: { readonly title: string }): null {
  useEffect(() => {
    vi.stubGlobal("document", undefined);
  }, []);
  useDocumentTitle(title);
  useEffect(() => {
    vi.unstubAllGlobals();
  }, []);
  return null;
}

describe("useDocumentTitle", () => {
  /** The title the environment started with, put back after every case. */
  let titleBeforeCase: string;
  beforeEach(() => {
    titleBeforeCase = document.title;
  });
  afterEach(() => {
    document.title = titleBeforeCase;
  });

  it("titles the document the page in front of the reader names", () => {
    const { rerender } = renderHook(
      ({ title }: { readonly title: string }) => useDocumentTitle(title),
      {
        initialProps: { title: CART_TITLE },
      },
    );
    expect(document.title).toBe(CART_TITLE);

    // The page rendered next names its own title; nothing is restored on unmount.
    rerender({ title: CHECKOUT_TITLE });
    expect(document.title).toBe(CHECKOUT_TITLE);
  });

  it("leaves the title alone where the host has no document", () => {
    const { rerender } = renderHook(TitlelessPage, { initialProps: { title: CART_TITLE } });

    // A host with no document — Vitest's node project, a renderer outside a browser — is answered rather than
    // crashed into: nothing was titled and nothing was raised.
    expect(document.title).toBe(titleBeforeCase);

    // The page is still mounted and the document it was rendered without is back, so the next title takes.
    rerender({ title: CHECKOUT_TITLE });
    expect(document.title).toBe(CHECKOUT_TITLE);
  });
});

// Debounced value --------------------------------------------------------------------------------

/** The quiet period the case waits out; zero keeps it in real time rather than on a fake clock. */
const QUIET_PERIOD_MS = 0;

describe("useDebouncedValue", () => {
  it("publishes a value once it stops changing, and keeps the settled one while a burst runs", async () => {
    const { result, rerender } = renderHook(
      ({ value }: { readonly value: string }) => useDebouncedValue(value, QUIET_PERIOD_MS),
      { initialProps: { value: "lamp" } },
    );

    // The first render hands back what it was given, which is the value the caller already holds.
    expect(result.current).toBe("lamp");

    // A keystroke publishes nothing on its own: the value on screen is kept while the burst is under way.
    rerender({ value: "lamps" });
    expect(result.current).toBe("lamp");

    // The burst's last value is published once it has settled, which is what a debounced request reads.
    await waitFor(() => expect(result.current).toBe("lamps"));
  });
});

// The async-data hook's own path ----------------------------------------------------------------

describe("the async-data hook", () => {
  it("resolves its whole lifecycle through this module's path", async () => {
    const { result } = renderHook(() => useAsync<number>(() => Promise.resolve(makeResult(7)), []));

    // The async-data concern is written in `src/state/asyncQuery.ts` and re-exported here, so a consumer's own
    // import path still resolves the hook and the lifecycle it reports.
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toBe(7);
    expect(result.current.error).toBeNull();
  });
});

// Paging -----------------------------------------------------------------------------------------

/** The result set a listing control pages over: nine pages of the configured size. */
const PAGE_TOTAL = 100;

describe("usePagination", () => {
  it("reports every paging change a control makes, confined to the pages that exist", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      usePagination({ page: 1, pageSize: DEFAULT_PAGE_SIZE, total: PAGE_TOTAL, onChange }),
    );

    expect(result.current.page).toBe(1);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrevious).toBe(false);
    expect(result.current.slots).toContain(1);

    // Each control reports the page and the size the reader asked for, which is what the caller writes to the URL.
    act(() => result.current.next());
    expect(onChange).toHaveBeenLastCalledWith(2, DEFAULT_PAGE_SIZE);

    act(() => result.current.last());
    expect(onChange).toHaveBeenLastCalledWith(result.current.pageCount, DEFAULT_PAGE_SIZE);

    // The first page has no previous one, so asking for it stays where it is.
    act(() => result.current.previous());
    expect(onChange).toHaveBeenLastCalledWith(1, DEFAULT_PAGE_SIZE);

    act(() => result.current.first());
    expect(onChange).toHaveBeenLastCalledWith(1, DEFAULT_PAGE_SIZE);

    // A page outside the range is confined to the nearest that exists rather than asked of the service.
    act(() => result.current.goTo(PAGE_TOTAL));
    expect(onChange).toHaveBeenLastCalledWith(result.current.pageCount, DEFAULT_PAGE_SIZE);

    // A new size returns to the first page, and a size the product does not offer falls back to the default.
    act(() => result.current.setPageSize(PAGE_SIZE_OPTIONS[2]));
    expect(onChange).toHaveBeenLastCalledWith(1, PAGE_SIZE_OPTIONS[2]);
    act(() => result.current.setPageSize(PAGE_TOTAL));
    expect(onChange).toHaveBeenLastCalledWith(1, DEFAULT_PAGE_SIZE);
  });
});

// Responsive layout ------------------------------------------------------------------------------

/** The members the media-query hooks read from a list; the rest of the DOM interface takes no part in them. */
interface MediaQueryListStub {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener(type: "change", listener: (event: MediaQueryListEvent) => void): void;
}

/** Answers the width feature a query names against a viewport width; a query naming none never matches. */
function matchesViewportWidth(query: string, widthPx: number): boolean {
  const threshold = Number.parseFloat(/min-width:\s*([\d.]+)px/.exec(query)?.[1] ?? "");
  return Number.isNaN(threshold) ? false : widthPx >= threshold;
}

/** The `change` event a resize announces, which jsdom implements neither as a type nor as a constructible one. */
function mediaQueryChange(matches: boolean): MediaQueryListEvent {
  return { matches, media: "" } as unknown as MediaQueryListEvent;
}

/**
 * Answers media queries against one viewport width and hands the case the way to announce a resize, which is the
 * `change` event a browser fires. The shim `tests/setup.ts` installs is replaced for the case and put back by the
 * per-case teardown.
 */
function installViewport(widthPx: number): { announceChange(matches: boolean): void } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  window.matchMedia = (query: string): MediaQueryList => {
    const list: MediaQueryListStub = {
      matches: matchesViewportWidth(query, widthPx),
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    };
    return list as unknown as MediaQueryList;
  };
  return {
    announceChange(matches: boolean): void {
      const event = mediaQueryChange(matches);
      for (const listener of [...listeners]) listener(event);
    },
  };
}

/** A viewport width, the stop it reaches, and the three flags the layout switches on. */
const VIEWPORTS: readonly [number, string, boolean, boolean, boolean][] = [
  [BREAKPOINTS.SMALL - 1, "sm", true, false, false],
  [BREAKPOINTS.MEDIUM, "md", false, true, false],
  [BREAKPOINTS.LARGE, "lg", false, false, true],
  [BREAKPOINTS.XLARGE, "xl", false, false, true],
];

describe("useMediaQuery", () => {
  it("answers a query from the host and follows a resize the host announces", () => {
    const viewport = installViewport(BREAKPOINTS.LARGE);
    const { result } = renderHook(({ query }: { readonly query: string }) => useMediaQuery(query), {
      initialProps: { query: `(min-width: ${String(BREAKPOINTS.LARGE)}px)` },
    });
    expect(result.current).toBe(true);

    // A viewport that narrows below the query's stop is announced as a `change`, and the reader re-renders.
    act(() => viewport.announceChange(false));
    expect(result.current).toBe(false);
  });

  it("answers a query that changed between two renders from the host", () => {
    installViewport(BREAKPOINTS.LARGE);
    const { result, rerender } = renderHook(
      ({ query }: { readonly query: string }) => useMediaQuery(query),
      {
        initialProps: { query: `(min-width: ${String(BREAKPOINTS.SMALL)}px)` },
      },
    );
    expect(result.current).toBe(true);

    // A query the hook has not read yet is answered during that render rather than from the snapshot the query
    // before it recorded, which is what keeps the reading correct before the browser dispatches anything.
    rerender({ query: `(min-width: ${String(BREAKPOINTS.XLARGE)}px)` });
    expect(result.current).toBe(false);
  });

  it("answers a host that cannot be asked about a query as not matching", () => {
    // A host with no media-query support at all is the baseline layout rather than a crash.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const { result } = renderHook(() =>
      useMediaQuery(`(min-width: ${String(BREAKPOINTS.MEDIUM)}px)`),
    );
    expect(result.current).toBe(false);
  });
});

describe("useBreakpoint", () => {
  it.each(VIEWPORTS)(
    "reports a viewport of %i px as the %s stop",
    (width, current, isMobile, isTablet, isDesktop) => {
      installViewport(width);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current).toEqual({ current, isMobile, isTablet, isDesktop });
    },
  );
});

// Outside pointer --------------------------------------------------------------------------------

/**
 * A region that registers the dismissal a case drives, beside a control the region does not contain, and with no
 * region at all where the case asks for one that has gone.
 */
function DismissibleRegion({
  regionRef,
  handler,
  enabled,
  withRegion = true,
}: {
  readonly regionRef: RefObject<HTMLDivElement | null>;
  readonly handler: (event: MouseEvent | TouchEvent) => void;
  readonly enabled?: boolean;
  readonly withRegion?: boolean;
}): ReactElement {
  useOnClickOutside(regionRef, handler, enabled === undefined ? {} : { enabled });
  return createElement(
    "div",
    null,
    withRegion
      ? createElement(
          "div",
          { ref: regionRef },
          createElement("button", { type: "button" }, "Keep"),
        )
      : null,
    createElement("button", { type: "button" }, "Elsewhere"),
  );
}

/** The buttons a case drives; their absence is a mistake in the host rather than an outcome of the hook. */
function buttonsIn(container: HTMLElement): readonly HTMLButtonElement[] {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  if (buttons.length === 0) throw new Error("The host renders the buttons the case drives.");
  return buttons;
}

describe("useOnClickOutside", () => {
  it("calls the handler for a pointer outside the region and ignores one inside it", () => {
    const regionRef = createRef<HTMLDivElement>();
    const handler = vi.fn();
    const { container, rerender, unmount } = render(
      createElement(DismissibleRegion, { regionRef, handler }),
    );
    const [inside, outside] = buttonsIn(container);

    // The overlay is dismissed by a pointer that lands outside it.
    fireEvent.pointerDown(outside);
    expect(handler).toHaveBeenCalledTimes(1);

    // A control inside the overlay is used without dismissing it.
    fireEvent.pointerDown(inside);
    expect(handler).toHaveBeenCalledTimes(1);

    // An overlay that may not be dismissed listens to nothing at all.
    rerender(createElement(DismissibleRegion, { regionRef, handler, enabled: false }));
    fireEvent.pointerDown(document.body);
    expect(handler).toHaveBeenCalledTimes(1);

    // An unmounted overlay stops listening.
    unmount();
    fireEvent.pointerDown(document.body);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reports nothing while the region it watches is not in the document", () => {
    const regionRef = createRef<HTMLDivElement>();
    const handler = vi.fn();
    const { container } = render(
      createElement(DismissibleRegion, { regionRef, handler, withRegion: false }),
    );
    const [elsewhere] = buttonsIn(container);

    // A region that has already gone — a panel unmounting itself — is not a dismissal to report.
    expect(regionRef.current).toBeNull();
    fireEvent.pointerDown(elsewhere);
    expect(handler).not.toHaveBeenCalled();
  });
});
