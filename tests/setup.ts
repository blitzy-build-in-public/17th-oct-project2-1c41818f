/**
 * Path: tests/setup.ts
 * Purpose: Loads the jest-dom matchers and clears state between tests
 * Lines: 130
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Stubbed at module scope rather than in a hook: a setup file is evaluated before any test
// module, so this is the only point that lands before the mock server reads the value it turns
// into a response delay. Stubbing per test would leave that first read at the 120 ms default.
vi.stubEnv("VITE_API_LATENCY_MS", "0");

/** The upper bound of the mobile-first baseline: the default viewport sits one pixel below it. */
const SMALL_BREAKPOINT_PX = 480;

/**
 * The mobile-first viewport media queries are answered against, so no desktop rule applies by
 * default; a test needing a breakpoint replaces `window.matchMedia` with its own `vi.fn()`.
 */
const DEFAULT_VIEWPORT_WIDTH_PX = SMALL_BREAKPOINT_PX - 1;

/** The MediaQueryList surface `useMediaQuery` touches, including the deprecated listener pair. */
interface MediaQueryListStub {
  readonly media: string;
  readonly matches: boolean;
  onchange: ((event: MediaQueryListEvent) => void) | null;
  addEventListener(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  addListener(listener: (event: MediaQueryListEvent) => void): void;
  removeListener(listener: (event: MediaQueryListEvent) => void): void;
  dispatchEvent(event: Event): boolean;
}

/**
 * Resolves the width features of a media query against a fixed viewport width. jsdom has no
 * layout engine, so a query naming no width feature (`prefers-reduced-motion`, `orientation`)
 * resolves false, keeping the application on its motion-on, single-column baseline.
 */
function matchesViewport(query: string, viewportWidthPx: number): boolean {
  let widthFeatureSeen = false;
  for (const [, name, rawValue] of query.matchAll(/\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)/gi)) {
    const feature = name.toLowerCase();
    if (feature !== "min-width" && feature !== "max-width") continue;
    const threshold = Number.parseFloat(rawValue);
    if (Number.isNaN(threshold)) continue;
    widthFeatureSeen = true;
    if (feature === "min-width" ? viewportWidthPx < threshold : viewportWidthPx > threshold) {
      return false;
    }
  }
  return widthFeatureSeen;
}

/**
 * Builds the MediaQueryList the environment lacks, so `useMediaQuery` can read `matches` and
 * subscribe: both listener APIs share one set, which is what makes `removeEventListener`
 * actually unsubscribe, and `dispatchEvent` lets a test simulate a viewport change.
 */
function createMediaQueryList(query: string): MediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list: MediaQueryListStub = {
    media: query,
    matches: matchesViewport(query, DEFAULT_VIEWPORT_WIDTH_PX),
    onchange: null,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    dispatchEvent(event) {
      const changeEvent = event as MediaQueryListEvent;
      list.onchange?.(changeEvent);
      for (const listener of listeners) listener(changeEvent);
      return true;
    },
  };
  return list as unknown as MediaQueryList;
}

/**
 * Installs the DOM surface the planned modules reach but jsdom provides unusably or not at all:
 * media queries, a quiet window scroll, and the object-URL and anchor-click pair the CSV export
 * needs. Skipped where no DOM exists, so a DOM-less project can load this file too.
 */
function installDomShims(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.matchMedia = (query: string): MediaQueryList => createMediaQueryList(query);

  // Route changes scroll the window, and jsdom logs "Not implemented" for every call.
  window.scrollTo = (): void => undefined;

  // Node's own URL.createObjectURL rejects the jsdom Blob src/utils/csv.ts builds, so the export
  // would throw without these stubs. Assert on them through `vi.spyOn` or a structurally cast
  // Mock, never by reading the method: `expect(URL.createObjectURL)` trips unbound-method.
  let objectUrlSequence = 0;
  URL.createObjectURL = vi.fn(
    (_blob: Blob): string => `blob:salespro-test/${String((objectUrlSequence += 1))}`,
  );
  URL.revokeObjectURL = vi.fn((_objectUrl: string): void => undefined);

  // The export starts its download with an anchor click, which jsdom answers with a warning.
  HTMLAnchorElement.prototype.click = vi.fn((): void => undefined);
}

installDomShims();

/**
 * Restores the environment between tests: unmounts what the DOM project rendered, drops the
 * cart, session and report range persisted outside a component, clears spy call history so a
 * later test cannot observe an earlier test's export, and returns to real timers.
 */
afterEach(async () => {
  if (typeof window !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
    window.localStorage.clear();
  }
  vi.clearAllMocks();
  vi.useRealTimers();
});
