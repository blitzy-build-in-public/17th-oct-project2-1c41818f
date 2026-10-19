/**
 * Path: tests/components/tooltip.test.tsx
 * Purpose: The tooltip and the popover driven through their own contract — the description merged onto the trigger and restored on dismissal, the caller's delays, the four placements, the popover's own or caller-owned open state, its inside and outside dismissal and the focus Escape returns
 * Lines: 302
 */

import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Popover, Tooltip } from "@/components/ui/Tooltip";

import { renderWithProviders, screen, within } from "../testUtils";

/*
 * The two supplementary surfaces seen from the outside, through roles, accessible names, the ARIA state on the
 * trigger and where the keyboard focus is. Every subject is mounted through `renderWithProviders`, every
 * interaction goes through the returned `user`, and no service, context or data module stands in for anything.
 *
 * `tests/components/overlays.test.tsx` already proves the tooltip's bare contract — hidden while closed, the
 * trigger described by the bubble while it is open, a pointer-over and a focus each revealing it, a
 * pointer-out hiding it and Escape dismissing it. What is asserted here is what that case does not reach: a
 * caller's own `aria-describedby` extended while the bubble is open and left exactly as it was while it is
 * closed, an id the caller already names not repeating, the caller's delays with the reveal a departing
 * pointer cancels, Escape dismissing at once rather than after the close delay, a key that is not Escape
 * ignored, and a generated id when the caller supplies none.
 *
 * The popover is asserted whole, because nothing else in the suite mounts it: the trigger reports itself
 * through `aria-expanded` and, only while the panel is open, `aria-controls`; the panel is a `role="group"`
 * named by its caller's words and not a dialog; the caller's own click handler still runs beside the
 * component's; a control inside the panel does not close it while a click on the wrapper outside the panel
 * and a pointer outside the wrapper both do; Escape closes it and puts the focus back on the trigger; and a
 * caller that owns the open state changes nothing by itself, only reporting what it was asked for.
 *
 * One assertion reads a class name, and it is the placement: the sheet that owns `sp-tooltip--top`,
 * `--bottom`, `--start` and `--end` is what positions each surface, so the modifier class is the whole of a
 * placement's observable output and no stylesheet is loaded in this project to read a computed offset from.
 * Every other assertion reads a role, an accessible name, ARIA state, rendered text or the focus.
 *
 * Each case reads its first post-render expectation through an awaited query, because the providers issue
 * requests when they mount and an update raised outside the testing library's `act` window is what React
 * reports as an act warning. The one case that drives a delay arms `vi.useFakeTimers({ shouldAdvanceTime:
 * true })` before it renders, as `tests/testUtils.tsx` states, and moves that clock inside `act` — the one
 * place in this file that moves a clock outside an awaited query, for the reason {@link passTheDelay} states —
 * while `tests/setup.ts` restores real timers after every case.
 */

// Test data --------------------------------------------------------------------------------------

const TOOLTIP_TEXT = "Excludes cancelled orders.";
const SHOW_BREAKDOWN = "Show the breakdown";
const TOOLTIP_ID = "basket-total-tooltip";
const OWN_DESCRIPTION_ID = "basket-total-note";
const REPEATED_DESCRIPTION = `${OWN_DESCRIPTION_ID} ${OWN_DESCRIPTION_ID}`;
const DELAY_MS = 1_000;

const OPEN_MENU = "Account menu";
const MENU_LABEL = "Signed in as Dana Okafor";
const MENU_ITEM = "Order history";
const OUTSIDE_CONTROL = "Sign out";
const MENU_ID = "account-menu";

/** How many sides a tooltip and a popover can be placed on, each with a modifier class of its own. */
const PLACEMENTS = ["top", "bottom", "start", "end"] as const;

/**
 * Lets the caller's delay elapse, with the state update it raises inside `act`.
 *
 * The clock is moved here rather than inside an awaited query, which is where this suite moves a fake clock
 * everywhere else: a `waitFor` whose callback advances the timers Vitest owns re-enters the query's own
 * interval, each re-entry advancing the same clock again, so the query races past its own timeout before the
 * callback ever returns. `act` is what puts the resulting render inside React's window instead.
 */
async function passTheDelay(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DELAY_MS);
  });
}

// The tooltip ------------------------------------------------------------------------------------

describe("the tooltip", () => {
  it("extends the trigger's own description while it is open and restores it when it closes", async () => {
    const { user } = renderWithProviders(
      <Tooltip content={TOOLTIP_TEXT} id={TOOLTIP_ID}>
        <button aria-describedby={OWN_DESCRIPTION_ID} type="button">
          {SHOW_BREAKDOWN}
        </button>
      </Tooltip>,
    );
    const trigger = await screen.findByRole("button", { name: SHOW_BREAKDOWN });
    expect(trigger).toHaveAttribute("aria-describedby", OWN_DESCRIPTION_ID);
    expect(screen.queryByRole("tooltip")).toBeNull();

    await user.hover(trigger);
    const bubble = await screen.findByRole("tooltip");
    expect(bubble).toHaveAttribute("id", TOOLTIP_ID);
    expect(bubble).toHaveTextContent(TOOLTIP_TEXT);
    expect(trigger.getAttribute("aria-describedby")).toBe(`${OWN_DESCRIPTION_ID} ${TOOLTIP_ID}`);

    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).toHaveAttribute("aria-describedby", OWN_DESCRIPTION_ID);

    await user.tab();
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(TOOLTIP_TEXT);

    await user.tab();
    expect(trigger).not.toHaveFocus();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).toHaveAttribute("aria-describedby", OWN_DESCRIPTION_ID);
  });

  it("names an id the caller repeats only once while the bubble is open", async () => {
    const { user } = renderWithProviders(
      <Tooltip content={TOOLTIP_TEXT} id={TOOLTIP_ID}>
        <button aria-describedby={REPEATED_DESCRIPTION} type="button">
          {SHOW_BREAKDOWN}
        </button>
      </Tooltip>,
    );
    const trigger = await screen.findByRole("button", { name: SHOW_BREAKDOWN });

    await user.hover(trigger);
    const bubble = await screen.findByRole("tooltip");

    expect(trigger.getAttribute("aria-describedby")).toBe(`${OWN_DESCRIPTION_ID} ${TOOLTIP_ID}`);
    expect(bubble).toHaveAttribute("id", TOOLTIP_ID);
  });

  it.each(PLACEMENTS)("carries the bubble on its %s side and names itself", async (placement) => {
    const { user } = renderWithProviders(
      <Tooltip content={TOOLTIP_TEXT} placement={placement}>
        <button type="button">{SHOW_BREAKDOWN}</button>
      </Tooltip>,
    );
    const trigger = await screen.findByRole("button", { name: SHOW_BREAKDOWN });

    await user.hover(trigger);
    const bubble = await screen.findByRole("tooltip");

    expect(bubble).toHaveClass(`sp-tooltip--${placement}`);
    expect(bubble.id).not.toBe("");
    expect(trigger.getAttribute("aria-describedby")).toBe(bubble.id);
  });

  it("waits out the caller's delays, cancels a reveal the pointer left before, and dismisses on Escape at once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(
      <Tooltip closeDelayMs={DELAY_MS} content={TOOLTIP_TEXT} openDelayMs={DELAY_MS}>
        <button type="button">{SHOW_BREAKDOWN}</button>
      </Tooltip>,
    );
    const trigger = await screen.findByRole("button", { name: SHOW_BREAKDOWN });

    await user.hover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // The pointer leaves before the reveal is due, so the scheduled reveal is cancelled and never fires.
    await user.unhover(trigger);
    await passTheDelay();
    expect(screen.queryByRole("tooltip")).toBeNull();

    await user.hover(trigger);
    await passTheDelay();
    expect(screen.getByRole("tooltip")).toHaveTextContent(TOOLTIP_TEXT);

    // The bubble stays for the dismissal's own delay before it goes.
    await user.unhover(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await passTheDelay();
    expect(screen.queryByRole("tooltip")).toBeNull();

    // A key that is not Escape is none of this component's business.
    await user.tab();
    await passTheDelay();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("a");
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

// The popover ------------------------------------------------------------------------------------

describe("the popover", () => {
  it("opens its panel from the trigger, keeps the caller's own handler, and closes on a pointer outside it", async () => {
    const onTriggerClick = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <Popover
          id={MENU_ID}
          label={MENU_LABEL}
          trigger={
            <button onClick={onTriggerClick} type="button">
              {OPEN_MENU}
            </button>
          }
        >
          <button type="button">{MENU_ITEM}</button>
        </Popover>
        <button type="button">{OUTSIDE_CONTROL}</button>
      </div>,
    );
    const trigger = await screen.findByRole("button", { name: OPEN_MENU });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("group")).toBeNull();

    await user.click(trigger);
    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", MENU_ID);
    const panel = await screen.findByRole("group", { name: MENU_LABEL });
    expect(panel).toHaveAttribute("id", MENU_ID);

    // A control inside the panel is used without dismissing it.
    await user.click(within(panel).getByRole("button", { name: MENU_ITEM }));
    expect(screen.getByRole("group", { name: MENU_LABEL })).toBeInTheDocument();

    // A click on the wrapper outside the panel toggles it shut.
    await user.click(trigger);
    expect(screen.queryByRole("group")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(await screen.findByRole("group", { name: MENU_LABEL })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: OUTSIDE_CONTROL }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-controls");
  });

  it("closes on Escape and puts the focus back on the trigger it was opened from", async () => {
    const { user } = renderWithProviders(
      <Popover label={MENU_LABEL} trigger={<button type="button">{OPEN_MENU}</button>}>
        <button type="button">{MENU_ITEM}</button>
      </Popover>,
    );
    const trigger = await screen.findByRole("button", { name: OPEN_MENU });

    await user.tab();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("group")).toBeNull();

    await user.click(trigger);
    const panel = await screen.findByRole("group", { name: MENU_LABEL });
    await user.click(within(panel).getByRole("button", { name: MENU_ITEM }));
    expect(screen.getByRole("group", { name: MENU_LABEL })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("takes its open state from the caller and reports every request it does not apply", async () => {
    const onOpenChange = vi.fn();
    const { user } = renderWithProviders(
      <Popover
        isOpen
        label={MENU_LABEL}
        onOpenChange={onOpenChange}
        trigger={<button type="button">{OPEN_MENU}</button>}
      >
        <button type="button">{MENU_ITEM}</button>
      </Popover>,
    );
    const trigger = await screen.findByRole("button", { name: OPEN_MENU });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = await screen.findByRole("group", { name: MENU_LABEL });

    await user.click(within(panel).getByRole("button", { name: MENU_ITEM }));
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("group", { name: MENU_LABEL })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("group", { name: MENU_LABEL })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each(PLACEMENTS)(
    "carries the panel on its %s side and names it only when it is given words",
    async (placement) => {
      const { user } = renderWithProviders(
        <Popover placement={placement} trigger={<button type="button">{OPEN_MENU}</button>}>
          <button type="button">{MENU_ITEM}</button>
        </Popover>,
      );
      await user.click(await screen.findByRole("button", { name: OPEN_MENU }));
      const panel = await screen.findByRole("group");

      expect(panel).toHaveClass(`sp-popover--${placement}`);
      expect(panel).not.toHaveAttribute("aria-labelledby");
    },
  );
});
