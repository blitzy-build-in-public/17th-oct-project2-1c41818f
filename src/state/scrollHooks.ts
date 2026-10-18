/**
 * Path: src/state/scrollHooks.ts
 * Purpose: View-scroll hooks: brings a view to its own top when the value that names it changes
 * Lines: 41
 */

import { useEffect } from "react";

/*
 * The view-position half of the shared hooks, split out of `src/state/hooks.ts` because that file stood one
 * line inside the request's "No file over 600 lines" ceiling and could not take another export, which §0.5.5
 * answers with a second file rather than a raised ceiling — the same remedy that gave the date foundation its
 * `src/utils/isoInstants.ts` and the overlay family its `src/components/ui/overlayEngine.ts`. Nothing is
 * duplicated: the hooks `hooks.ts` owns stay exactly where they are, and neither file imports the other.
 */

// View position ----------------------------------------------------------------------------------

/**
 * Brings the view to its own top whenever `key` changes.
 *
 * A view a shopper opens — a route, or a step inside one — should begin at its own start rather than at the
 * offset the view before it left behind: the window's scroll position survives a route change and a step
 * change alike, so without this the checkout's second step opens part-way down itself with its heading
 * off-screen, and a placed order's confirmation arrives carrying the offset its checkout was left at, under
 * the header. The caller passes the value that names the view — the flow's step, the route's own identifier —
 * and a change to it brings the window to the top of the view it names.
 *
 * The scroll is instant rather than the document's own smooth behaviour, and deliberately so:
 * `src/styles/base.css` offers smooth scrolling for a jump within a document, while this is a reader arriving
 * at the start of a view that has just replaced another, where an animation would leave the new heading — and
 * any focus the view moves to it — below the viewport for as long as it ran.
 *
 * @param key - The value that names the view in front of the reader; a change brings that view to its top.
 */
export function useScrollToTop(key: unknown): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [key]);
}
