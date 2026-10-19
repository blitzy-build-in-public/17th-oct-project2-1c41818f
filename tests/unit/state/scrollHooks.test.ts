/**
 * Path: tests/unit/state/scrollHooks.test.ts
 * Purpose: `useScrollToTop` in src/state/scrollHooks.ts: the view a key names opens at its own top, and a host with no window is not a crash
 * Lines: 98
 *
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useScrollToTop } from "@/state/scrollHooks";

/*
 * Why this file asks for a DOM. `useScrollToTop` moves the window, and its whole contract is the call it makes
 * on the window when the value naming the view changes — which is observable only against a mounted component
 * whose effect has run, so the one environment change the file needs is its header directive.
 *
 * Why the cases exist. `src/features/checkout/CheckoutPage.tsx` calls this with the checkout step and
 * `src/features/checkout/OrderConfirmation.tsx` with the placed order's identifier, and the window's scroll
 * offset survives both a route change and a step change: without the hook the second step opens part-way down
 * itself, and a confirmation arrives under the header. The window itself is the stub `tests/setup.ts` installs
 * for the jsdom project, so a call to it is asserted with `vi.spyOn` rather than by reading the method.
 */

/** The value a case names its view with: what the checkout passes is the step's own identifier. */
const FIRST_VIEW = "checkout/shipping";
const SECOND_VIEW = "checkout/payment";

/** What the hook is expected to ask for: the top of the view, with the document's smooth scroll bypassed. */
const TOP_OF_VIEW = { top: 0, behavior: "instant" };

/**
 * A host that has no window for the interval the hook's own effect occupies: it withdraws the window, renders
 * the view, and puts the window back as soon as the hook's effect has run — jsdom and React themselves read the
 * window, so it can be missing for the hook's effect and for nothing else.
 */
function WindowlessHost({ view }: { readonly view: string }): null {
  useEffect(() => {
    vi.stubGlobal("window", undefined);
  }, []);
  useScrollToTop(view);
  useEffect(() => {
    vi.unstubAllGlobals();
  }, []);
  return null;
}

describe("useScrollToTop", () => {
  it("brings the view to its own top whenever the key that names it changes", () => {
    const scrollTo = vi.spyOn(window, "scrollTo");

    const { rerender } = renderHook(({ key }: { readonly key: string }) => useScrollToTop(key), {
      initialProps: { key: FIRST_VIEW },
    });
    // The first view opens at its own top, whatever offset the document was left at.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(TOP_OF_VIEW);

    // A second view — the next checkout step — is a new view and opens at its top too.
    scrollTo.mockClear();
    rerender({ key: SECOND_VIEW });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(TOP_OF_VIEW);

    // A re-render naming the same view moves nothing: the reader keeps the offset they scrolled to.
    scrollTo.mockClear();
    rerender({ key: SECOND_VIEW });
    expect(scrollTo).not.toHaveBeenCalled();

    // A change back to a view already seen is still a change, so it is brought to its top again.
    scrollTo.mockClear();
    rerender({ key: FIRST_VIEW });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(TOP_OF_VIEW);

    scrollTo.mockRestore();
  });

  it("moves nothing where the host has no window, and keeps the hook usable when one comes back", () => {
    const scrollTo = vi.spyOn(window, "scrollTo");

    const { rerender } = renderHook(WindowlessHost, { initialProps: { view: FIRST_VIEW } });

    // A host with no window — a renderer outside a browser — is answered rather than crashed into: the view
    // opens where it stands, and nothing is asked of a window that is not there.
    expect(scrollTo).not.toHaveBeenCalled();

    // The hook was never unmounted by that render, and the window it was rendered without is back: the next
    // view change is scrolled, so the guard skipped one call rather than disabling the hook.
    rerender({ view: SECOND_VIEW });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(TOP_OF_VIEW);

    scrollTo.mockRestore();
  });
});
