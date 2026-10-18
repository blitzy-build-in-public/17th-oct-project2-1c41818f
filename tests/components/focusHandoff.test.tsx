/**
 * Path: tests/components/focusHandoff.test.tsx
 * Purpose: The focus-handoff contract: an armed handoff moves the focus to the region, an unarmed commit moves nothing, a region that is gone is skipped, and a region the browser refuses gives way to the fallback
 * Lines: 295
 */

import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";

import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/Button";
import { handOffThen, useFocusHandoff } from "@/state/focusHandoff";

import { renderWithProviders, screen } from "../testUtils";

/*
 * The rule `src/state/focusHandoff.ts` owns, read where it can be observed: at the keyboard focus. A control
 * that unmounts with the commit its own action causes gives its focus up, and the browser drops it onto
 * `document.body`; the handoff is what puts it on the region the outcome lands in instead, or — when an open
 * overlay has made the page inert and the region inside it therefore refuses the focus — on the container of the
 * control that raised the action. The cases below are the behaviours of the hook: the armed move, the commit that
 * arms nothing, a region the committing transition removed, and every way the region and that fallback can stand.
 * No assertion here reads a class name or a computed style.
 */

/** The words the harness's two controls, its region and its fallback container read as. */
const REMOVE_CONTROL = "Remove this filter";
const UNARMED_CONTROL = "Re-render the surface";
const REGION_NAME = "Results";
const FALLBACK_NAME = "Filter panel";

/** How a region can stand when the action that arms the handoff is taken, and how the harness renders it. */
type RegionState = "focusable" | "refusing";

/**
 * A surface shaped like the ones the handoff serves: a control whose own commit removes it, a control that
 * commits without arming anything, the region the first one's outcome lands in, and — `"absent"` by default — the
 * container of the surface that region keeps beside it.
 *
 * The region is the product's own shape — a section named by the heading inside it, carrying `tabIndex={-1}` so
 * it can take the focus without joining the tab order — and `keepsRegion` can remove it with the same state the
 * action writes, which is the case a surface that drops its region alongside its control would hit. A region
 * rendered `"refusing"` is not a focusable area, which is why a browser refuses the focus for it: the region
 * inside the inert application root of an open overlay is exactly that, and jsdom models the same refusal for an
 * element carrying no `tabindex`, since it implements no `inert` of its own. `settles` adds the one commit after
 * the action that stands in for a transition landing late — a chip row leaving with the query it wrote, a page
 * being replaced — which is the layout the alignment a tall move makes has to survive.
 */
function HandoffSurface({
  keepsRegion = true,
  primary = "focusable",
  fallback = "absent",
  settles = false,
}: {
  readonly keepsRegion?: boolean;
  readonly primary?: RegionState;
  readonly fallback?: RegionState | "absent";
  readonly settles?: boolean;
}): ReactElement {
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const { regionRef, handOffFocus } = useFocusHandoff(undefined, fallbackRef);
  const headingId = useId();
  const [isRemoved, setRemoved] = useState(false);
  const [renders, setRenders] = useState(0);

  // The action, and the commit of the surface's own that lands after it: a transition's write, out of the
  // commit the action caused and holding the focus the move gave the region, never during that render.
  const removeControl = handOffThen(handOffFocus, (): void => {
    setRemoved(true);
    if (settles) {
      queueMicrotask((): void => {
        setRenders(1);
      });
    }
  });

  return (
    <>
      {isRemoved ? null : <Button onClick={removeControl}>{REMOVE_CONTROL}</Button>}
      <Button onClick={() => setRenders(renders + 1)}>{UNARMED_CONTROL}</Button>
      <p>{`Renders: ${String(renders)}`}</p>
      {isRemoved && !keepsRegion ? null : (
        <section
          aria-labelledby={headingId}
          ref={regionRef}
          tabIndex={primary === "focusable" ? -1 : undefined}
        >
          <h2 id={headingId}>{REGION_NAME}</h2>
        </section>
      )}
      {fallback === "absent" ? null : (
        <div
          aria-label={FALLBACK_NAME}
          ref={fallbackRef}
          role="group"
          tabIndex={fallback === "focusable" ? -1 : undefined}
        >
          {FALLBACK_NAME}
        </div>
      )}
    </>
  );
}

describe("useFocusHandoff", () => {
  it("moves the focus to the region when the action removes the control that raised it", async () => {
    const { user } = renderWithProviders(<HandoffSurface />);

    await user.click(screen.getByRole("button", { name: REMOVE_CONTROL }));

    expect(screen.queryByRole("button", { name: REMOVE_CONTROL })).toBeNull();
    expect(screen.getByRole("region", { name: REGION_NAME })).toHaveFocus();
  });

  it("moves nothing when the commit that follows arms no handoff", async () => {
    const { user } = renderWithProviders(<HandoffSurface />);
    const control = screen.getByRole("button", { name: UNARMED_CONTROL });

    await user.click(control);

    expect(control).toHaveFocus();
    expect(screen.getByRole("region", { name: REGION_NAME })).not.toHaveFocus();
  });

  it("skips a region that the committing transition removed", async () => {
    const { user } = renderWithProviders(<HandoffSurface keepsRegion={false} />);

    await user.click(screen.getByRole("button", { name: REMOVE_CONTROL }));

    expect(screen.queryByRole("region", { name: REGION_NAME })).toBeNull();
    expect(document.body).toHaveFocus();
  });

  /*
   * The fallback: what a surface focuses when the region the outcome lands in refuses the move, which is what the
   * region inside the inert root of an open overlay does to any handoff armed from inside that overlay. Each case
   * names how the two stand and where the focus must end up, so a change to either one is caught here.
   */
  it.each([
    {
      primary: "focusable",
      fallback: "focusable",
      landsOn: "the region",
      keepsRegion: true,
    },
    {
      primary: "refusing",
      fallback: "focusable",
      landsOn: "the fallback",
      keepsRegion: true,
    },
    {
      primary: "focusable",
      fallback: "focusable",
      landsOn: "the fallback",
      keepsRegion: false,
    },
    {
      primary: "refusing",
      fallback: "refusing",
      landsOn: "the document body",
      keepsRegion: true,
    },
  ] as const)(
    "lands on $landsOn when the region is $primary and the fallback is $fallback",
    async ({ primary, fallback, landsOn, keepsRegion }) => {
      const { user } = renderWithProviders(
        <HandoffSurface fallback={fallback} keepsRegion={keepsRegion} primary={primary} />,
      );

      await user.click(screen.getByRole("button", { name: REMOVE_CONTROL }));

      // Read as identity rather than through `toHaveFocus`, because one case has no region to hand it: a region
      // the committing transition removed answers `null`, and the assertion still has to say the focus is not
      // there.
      const active = document.activeElement;
      const region = screen.queryByRole("region", { name: REGION_NAME });
      const container = screen.getByRole("group", { name: FALLBACK_NAME });
      if (landsOn === "the region") {
        expect(active).toBe(region);
        expect(active).not.toBe(container);
      } else if (landsOn === "the fallback") {
        expect(active).toBe(container);
        expect(active).not.toBe(region);
      } else {
        expect(active).toBe(document.body);
        expect(active).not.toBe(container);
      }
    },
  );

  /*
   * The layout half of the rule, which this environment cannot measure for itself: every box jsdom reports is
   * zero-sized, so a region always "fits" there and the branch taken for one taller than the screen would never
   * run. The box is therefore given by the case — a region taller than jsdom's own viewport, read from
   * `window.innerHeight` rather than from a number written here, against one that fits inside it — and what is
   * asserted is what this environment can observe: the move lands where the case says without throwing, and the
   * start-edge alignment is asked for in the tall case and never otherwise. jsdom carries no `scrollIntoView` at
   * all, which is why the alignment is observed on a stub standing in for that method; what the alignment then
   * does to the page — the region's top edge below the sticky header, its ring's top edge on screen — is
   * geometry, and is measured in a browser rather than here.
   *
   * The third case is the one that keeps the alignment honest: a region an overlay's inert root made refuse the
   * focus is not one to scroll the page to, so a tall region that refuses it is left where it stands and the
   * fallback takes the focus.
   */
  it.each([
    {
      label: "taller than the viewport",
      regionHeightPx: window.innerHeight * 2,
      primary: "focusable",
      fallback: "absent",
      landsOn: "the region",
      alignsStart: true,
    },
    {
      label: "no taller than the viewport",
      regionHeightPx: 320,
      primary: "focusable",
      fallback: "absent",
      landsOn: "the region",
      alignsStart: false,
    },
    {
      label: "taller than the viewport and refusing the focus",
      regionHeightPx: window.innerHeight * 2,
      primary: "refusing",
      fallback: "focusable",
      landsOn: "the fallback",
      alignsStart: false,
    },
  ] as const)(
    "hands the focus to $landsOn when the region is $label",
    async ({ regionHeightPx, primary, fallback, landsOn, alignsStart }) => {
      const { user } = renderWithProviders(
        <HandoffSurface fallback={fallback} primary={primary} />,
      );
      const region = screen.getByRole("region", { name: REGION_NAME });
      const alignStart = vi.fn((_options?: boolean | ScrollIntoViewOptions): void => undefined);
      region.getBoundingClientRect = (): DOMRect => ({ height: regionHeightPx, top: 0 }) as DOMRect;
      region.scrollIntoView = alignStart;

      await user.click(screen.getByRole("button", { name: REMOVE_CONTROL }));

      expect(document.activeElement).toBe(
        landsOn === "the region" ? region : screen.getByRole("group", { name: FALLBACK_NAME }),
      );
      if (alignsStart) {
        expect(alignStart).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
      } else {
        expect(alignStart).not.toHaveBeenCalled();
      }
    },
  );

  /*
   * The correction, which jsdom can show only through the requests themselves: the box is stated by the case,
   * and every read of it after the move reports the region's start edge where the case puts it. What is asserted
   * is that the alignment is asked for exactly once while nothing has moved the region, and a second time when
   * the content above it has carried its start edge up the document — the branch that keeps a tall region's ring
   * clear of the header on a transition landing a commit after the move, which is how the search results behave
   * when the chip row the action removed leaves with the query it wrote. The alignment's geometry is measured in
   * a browser, not here.
   */
  it.each([
    { label: "carries the start edge up the document", settledTopPx: 367.69, asksAgain: true },
    { label: "leaves it where it was aligned", settledTopPx: 410, asksAgain: false },
  ] as const)(
    "asks for the start-edge alignment again only when the settling layout $label",
    async ({ settledTopPx, asksAgain }) => {
      const { user } = renderWithProviders(<HandoffSurface settles />);
      const region = screen.getByRole("region", { name: REGION_NAME });
      const alignStart = vi.fn((_options?: boolean | ScrollIntoViewOptions): void => undefined);
      let reads = 0;
      // Reads one and two belong to the move: the region's height, then the document top its start edge is
      // aligned against. Reads from three on belong to the commit that settles the layout, which is where the
      // case states the start edge the correction compares.
      region.getBoundingClientRect = (): DOMRect =>
        ({ height: window.innerHeight * 2, top: reads++ < 2 ? 410 : settledTopPx }) as DOMRect;
      region.scrollIntoView = alignStart;

      await user.click(screen.getByRole("button", { name: REMOVE_CONTROL }));
      // The commit the transition after the move makes, with the focus the move gave the region still on it.
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });

      expect(region).toHaveFocus();
      expect(alignStart).toHaveBeenCalledTimes(asksAgain ? 2 : 1);
      expect(alignStart).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
    },
  );
});
