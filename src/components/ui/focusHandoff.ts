/**
 * Path: src/components/ui/focusHandoff.ts
 * Purpose: The one home of the focus-handoff rule: when the control that had the focus goes away, hand the focus to the region the action's outcome lands in
 * Lines: 291
 */

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

/*
 * Why this sits beside the primitives rather than in `src/state/hooks.ts`: its readers include the
 * layout's `src/components/layout/Header.tsx`, which is Shared presentation and sits BELOW State, and
 * the feature pages that compose that surface reach it downward — exactly why the four view-facing
 * hooks live in `src/components/ui/hooks.ts`. Split out of `src/state/hooks.ts` at 599 of the 600-line
 * ceiling, it keeps the dependency downward and single: it imports React alone — its three hooks and
 * its `RefObject` type — and nothing from a context, a service, a component or a state module, while
 * `src/state/hooks.ts` keeps the hooks whose readers are the contexts.
 *
 * What it exists for. A control that unmounts, or that goes native-disabled while a request is in flight,
 * gives the focus up, and the browser then drops it onto `document.body`. Every keyboard user's position is
 * lost with it: the next Tab restarts at the document's first focusable element — the skip link — and the
 * surface they were working in is as many Tab presses away as the page is long. The rule this module owns is
 * therefore: when the control that had the focus goes away, hand the focus to the region the action's outcome
 * lands in, which is a region that survives the transition that removed the control.
 *
 * One case refuses that move. An action raised from inside an open overlay draws its control, and the container
 * around it, outside the application root, while the root itself is inert — and a browser refuses the focus for
 * every element inside an inert subtree, so the region the outcome lands in cannot take it. The container of
 * the control that raised the action is the one thing left beside the region that survives the transition, so
 * it stands in: the handoff asks the primary region for the focus, reads back whether it took it, and only then
 * falls back.
 */

/**
 * What {@link useFocusHandoff} hands back: the region a surface focuses after an action removes or disables
 * the control that raised it, and the arming call the action's own handler makes.
 *
 * @typeParam TElement - The element the region is, so its ref can be handed straight to that element's own
 *   `ref` attribute: the default `HTMLElement` for a `<section>` region, `HTMLDivElement` for a page body.
 */
export interface FocusHandoff<TElement extends HTMLElement = HTMLElement> {
  /**
   * The primary region: the one the action's outcome lands in, to place on the element that survives the action
   * and carries `tabIndex={-1}` so the region can take the focus without joining the tab order. Its `ref` is
   * `null` until that element is mounted.
   */
  readonly regionRef: RefObject<TElement | null>;
  /**
   * Arms the handoff: with the next commit of the component that calls it, focus lands on the element
   * `regionRef` points at, once. Call it from the handler of the action whose control is about to go away,
   * before or after the state write; calling it without an action that commits moves nothing.
   */
  readonly handOffFocus: () => void;
}

/**
 * Whether a region can take the focus at all: an element the surface has not rendered yet, or one that the
 * transition that armed the handoff removed, answers `null` or is out of the document.
 *
 * @param region - The element the region ref points at, if any.
 * @returns True when focusing it would move the focus into the document.
 */
function isFocusableRegion(region: HTMLElement | null): region is HTMLElement {
  return region !== null && region.isConnected;
}

/**
 * Whether a region is taller than the viewport it would be shown in — a whole checkout step, a page body, a
 * results region. Read from the layout the commit has just painted, never during render.
 *
 * No viewport at all, or one reporting no height, answers `false`: the move below then stays on the path an
 * environment without layout can follow, which is where jsdom runs this module.
 *
 * @param region - The element the region ref points at.
 * @returns True when the region cannot be shown whole in the viewport.
 */
function exceedsViewport(region: HTMLElement): boolean {
  if (typeof window === "undefined") return false;
  const viewportHeight = window.innerHeight;
  return viewportHeight > 0 && region.getBoundingClientRect().height > viewportHeight;
}

/**
 * The region a handoff moved the focus to, and — for a region taller than the viewport, whose start edge the
 * move had to place itself — the document top that alignment was computed against.
 */
interface AlignedRegion {
  /** The region that took the focus: the primary, or the fallback when the primary refused it. */
  readonly region: HTMLElement;
  /** The region's own distance from the top of the document when its start edge was aligned, or `null` when
   *  the region fits in the viewport and the browser's own scroll placed it. */
  readonly documentTop: number | null;
}

/**
 * The region's own distance from the top of the document, which no scroll of its own changes: what an
 * alignment is computed against, and what tells a later commit that the content above the region has carried
 * its start edge further up.
 *
 * `null` where there is no window to measure in, which keeps every reader of it on the path an environment
 * without layout can follow.
 *
 * @param region - The element the region ref points at.
 * @returns That distance in pixels, or `null` when there is no window to measure it in.
 */
function documentTopOf(region: HTMLElement): number | null {
  if (typeof window === "undefined") return null;
  return region.getBoundingClientRect().top + window.scrollY;
}

/**
 * Brings a region's start edge just inside the scrollport, which is the one alignment the document's own
 * `scroll-padding-block-start` — the sticky header's clearance — was written for: the scrollport begins below
 * the header, so the region's top edge and the focus ring painted around it rest clear of the header rather
 * than behind it.
 *
 * An environment whose elements carry no `scrollIntoView` has no scrollport to align to and is left alone
 * rather than thrown through.
 *
 * @param region - The element the region ref points at.
 * @returns The document top the alignment was computed against, or `null` when nothing was aligned.
 */
function alignRegionStart(region: HTMLElement): number | null {
  const documentTop = documentTopOf(region);
  if (documentTop === null || typeof region.scrollIntoView !== "function") return null;
  region.scrollIntoView({ block: "start", inline: "nearest" });
  return documentTop;
}

/**
 * The move itself, asked for and then read back. A browser refuses the focus for an element that is not a
 * focusable area — one inside an inert subtree, or one that generates no box — and answers that refusal by
 * doing nothing at all: no error, no exception, and `document.activeElement` left where it was. The reader
 * below is therefore the result of the request.
 *
 * A region taller than the viewport, whose own start edge the focus would have to carry on screen, is the one
 * case the browser does not answer for the reader; it is focused without the browser's own scroll and then
 * aligned to its start edge. See the branch below.
 *
 * @param region - The element the region ref points at, if any.
 * @returns The region that took the focus, with the alignment it took, or `null` when the move did not happen.
 */
function focusRegion(region: HTMLElement | null): AlignedRegion | null {
  if (!isFocusableRegion(region)) return null;
  /*
   * Which edge of an element that cannot fit in the viewport the browser reveals is its own choice, and the
   * choice it makes is the edge nearest where the reader already is: a region whose start edge sits above the
   * scrollport is focused where it stands, its start edge — and the focus ring drawn around the region's top —
   * left above the viewport and behind the header, and a region whose start edge is still below it is scrolled
   * to that edge. The move is therefore made deterministic in the one case where the outcome is not settled:
   * the focus is taken without the browser's scroll, and then the start edge is aligned into the scrollport,
   * below the clearance the document reserves for it.
   *
   * A region that fits keeps the browser's own move untouched. That move scrolls as little as it can, which is
   * what leaves a reader who is halfway down a form exactly where they were, and a blanket alignment of every
   * region to the top of the scrollport would take them somewhere they never asked to go.
   */
  if (!exceedsViewport(region)) {
    region.focus();
    return document.activeElement === region ? { region, documentTop: null } : null;
  }
  region.focus({ preventScroll: true });
  // A region the browser refused the focus for — the inert-root case the fallback exists for — is not one to
  // scroll the page to, so the alignment follows a focus that was actually taken and nothing else.
  if (document.activeElement !== region) return null;
  return { region, documentTop: alignRegionStart(region) };
}

/**
 * The rule above, as one hook: a region to put on the element the outcome lands in, and the arming call the
 * action's handler makes.
 *
 * The armed flag is kept in a ref rather than in state, because it is a fact about the next commit and not a
 * reason to render: arming it must not cost a render of its own. The effect carries no dependency array, and
 * that is deliberate — the commit that removes the control is the one the action causes, which a handler
 * cannot name in advance, so the effect asks once per commit whether the handoff is armed, and — while an
 * alignment one of its own moves made is still standing — whether the layout above that region has carried it
 * further up the document, and does nothing at all when neither is the case. The hook never moves the focus on
 * its own: a commit that no action armed leaves the focus exactly where the browser and the user put it, which
 * is what keeps a filter, a sort or a keystroke from stealing focus from the control being typed in. It makes
 * one scroll of its own, the start-edge alignment of a region taller than the viewport, and that only for the
 * commit that moved the focus and the commits that follow it while the region still holds that focus.
 *
 * Assumptions: the region element carries `tabIndex={-1}` — a region that cannot take the focus is left
 * alone rather than being given an attribute behind React's back — and it is rendered by the same component
 * that arms the handoff, or by an ancestor, so it is in the document by the commit that follows the arming.
 * Several components may arm the same region by handing this hook the same ref, each holding its own flag.
 *
 * @param externalRef - The primary region to share with another component's handoff, in place of one of this
 *   hook's own. Omitted, the hook holds a region of its own.
 * @param fallbackRef - The container of the control that raised the action, which also carries
 *   `tabIndex={-1}`: it takes the focus when an open overlay has made the page inert and the primary region
 *   inside it therefore refuses the move. Omitted, a refused move leaves the focus where it is.
 * @returns The region ref and the arming call; see {@link FocusHandoff}.
 * @typeParam TElement - The element the region is, named wherever the region is not a `<section>`: a page body
 *   hands back a `RefObject<HTMLDivElement | null>`, which is the ref type that element's `ref` expects.
 */
export function useFocusHandoff<TElement extends HTMLElement = HTMLElement>(
  externalRef?: RefObject<TElement | null>,
  fallbackRef?: RefObject<HTMLElement | null>,
): FocusHandoff<TElement> {
  const ownRef = useRef<TElement | null>(null);
  const regionRef: RefObject<TElement | null> = externalRef ?? ownRef;
  const isArmed = useRef(false);
  /*
   * The region a move aligned, and the document top it was aligned against, so that alignment can be corrected
   * on the commits that follow. A ref for the same reason the flag is one: it is a fact about those commits,
   * not a reason to render.
   */
  const alignedRegion = useRef<AlignedRegion | null>(null);

  const handOffFocus = useCallback((): void => {
    isArmed.current = true;
  }, []);

  useEffect(() => {
    if (isArmed.current) {
      // Cleared before the move, so a region that cannot take the focus does not keep the flag armed and move
      // the focus on some later, unrelated commit.
      isArmed.current = false;
      /*
       * The move also lands the reader somewhere they can see. A region taller than the viewport — a whole step,
       * a page body, a results region — has no edge the browser can reveal for the reader, so it is focused
       * without the browser's own scroll and then aligned to its start edge, below the clearance the document
       * reserves for the sticky header; a region that fits keeps that scroll untouched, because it moves the
       * page as little as the region needs and so leaves the reader where they were.
       *
       * The layout is read here, after the commit that removed the control, and never during render: the box
       * that decides which case this is is the one the reader now has in front of them.
       */
      // The primary first, the fallback only when the browser refused it — the case an open overlay's inert
      // page makes of every region inside the root. A fallback that refuses as well leaves the focus where it
      // is, rather than carrying it somewhere neither the action nor the surface asked for.
      alignedRegion.current =
        focusRegion(regionRef.current) ?? focusRegion(fallbackRef?.current ?? null);
      return;
    }
    /*
     * The correction, which the commits after the move can call for. The commit that removed the control is not
     * always the last one to move the region it landed in: the row that control sat in can leave with the
     * transition the action started — a chip row, a pager, a page being replaced — and a query written through
     * the address bar lands a commit later still, so an alignment computed on the commit in between is left
     * pointing at a start edge the layout has since carried further up the document, behind the very header it
     * was aligned to clear.
     *
     * So while the region still holds the focus and the content above it has carried its start edge up the
     * document, the alignment is asked for again against the layout the reader actually has. Nothing else moves
     * the region's own distance from the top of the document, so a reader who scrolls away from a region they
     * are still focused in is never pulled back to it; and once the region sits where it was aligned, or the
     * focus has left it, the watch ends and this effect has nothing left to do.
     */
    const aligned = alignedRegion.current;
    if (aligned === null) return;
    if (
      aligned.documentTop === null ||
      !aligned.region.isConnected ||
      document.activeElement !== aligned.region
    ) {
      alignedRegion.current = null;
      return;
    }
    const currentTop = documentTopOf(aligned.region);
    if (currentTop === null || currentTop >= aligned.documentTop) return;
    alignRegionStart(aligned.region);
    alignedRegion.current = { region: aligned.region, documentTop: currentTop };
  });

  return { regionRef, handOffFocus };
}

/**
 * The arming call composed with the action it belongs to, for a call site that hands the focus off in place:
 * `onPageChange={handOffThen(handOffFocus, catalog.setPage)}` arms the handoff and then writes the page the
 * reader asked for, so the control that is about to be unmounted by that write is replaced by the region.
 *
 * The action's own arguments pass through unchanged, which is what lets one composition serve a paging
 * callback, a form submit and a bare clear-all action.
 *
 * @param handOffFocus - The arming call, from {@link useFocusHandoff}.
 * @param action - The action the handler would otherwise call on its own.
 * @returns The handler to pass where the action was passed, arming the handoff first.
 */
export function handOffThen<TArgs extends unknown[]>(
  handOffFocus: () => void,
  action: (...args: TArgs) => void,
): (...args: TArgs) => void {
  return (...args: TArgs): void => {
    handOffFocus();
    action(...args);
  };
}
