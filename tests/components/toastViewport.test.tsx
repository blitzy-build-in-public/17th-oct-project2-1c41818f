/**
 * Path: tests/components/toastViewport.test.tsx
 * Purpose: The toast family's own contract: the stack the viewport portals onto the body, the cap it falls back to, the hold the pointer's own path takes, the focus a dismissal owes, and the duration and heading each message resolves
 * Lines: 193
 */

import { useRef } from "react";
import type { ReactElement } from "react";

import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/Button";
import { ToastViewport } from "@/components/ui/Toast";
import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from "@/constants/config";
import { A11Y_COPY, COMMON_ACTIONS, FEEDBACK_COPY } from "@/constants/content";
import { useToast } from "@/state/ToastContext";

import { renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * The toast family seen through the real queue: the harness below is `src/App.tsx`'s own composition — the
 * viewport mounted beside a control that reads `useToast()` and handed the queue and its dismiss handle — so
 * every message a case reads was raised through the provider and every dismissal went back through it. The
 * viewport is the surface the application mounts and the component harnesses deliberately omit, so nothing
 * here stands in for the product's queue.
 *
 * Where a case moves the clock it arms fake timers before it renders, and it advances them inside an awaited
 * query rather than between two, because a countdown dismisses through a queue update and an update raised
 * outside the testing library's `act` window is what React reports as unattributable. The two cases that
 * dispatch an event by hand state their reason where they do it: a countdown is paused by a pointer the host's
 * layout engine cannot place, and a message box takes no pointer input of its own.
 */

// Test data --------------------------------------------------------------------------------------

const SAVED_MESSAGE = FEEDBACK_COPY.TOAST_ADDRESS_SAVED;
const FAILURE_MESSAGE = FEEDBACK_COPY.TOAST_EXPORT_FAILED;
const HEADING = "Not saved";

const RAISE_DISTINCT = "Report another save";
const RAISE_FAILURE = "Report a failure";
const RAISE_UNDATED = "Report a save of no duration";
const RAISE_HEADED = "Report a save with a heading";

/** A box the probe can place a pointer inside, since the host's layout engine reports every box as zero. */
const STACK_BOX = { height: 120, left: 500, top: 400, width: 320 };
const INSIDE_STACK = { clientX: 600, clientY: 460 };
const OUTSIDE_STACK = { clientX: 20, clientY: 20 };

// The harness, mounted inside the real providers --------------------------------------------------

/**
 * Raises notifications through the real queue and renders them through the application's own viewport.
 *
 * Each control raises a message a case can tell apart: one whose words differ on every press, so a burst of
 * distinct messages — the burst the visible cap bounds — can be raised; one in the failure register, whose
 * policy duration is the longest; one whose duration the queue resolves to zero; and one carrying a heading.
 */
function ToastHarness({ maxVisible }: { readonly maxVisible?: number }): ReactElement {
  const queue = useToast();
  const distinctRef = useRef(0);
  return (
    <div>
      <Button
        onClick={() => {
          distinctRef.current += 1;
          queue.success(`${SAVED_MESSAGE} ${String(distinctRef.current)}`);
        }}
      >
        {RAISE_DISTINCT}
      </Button>
      <Button onClick={() => queue.error(FAILURE_MESSAGE)}>{RAISE_FAILURE}</Button>
      <Button onClick={() => queue.success(SAVED_MESSAGE, { durationMs: 0 })}>
        {RAISE_UNDATED}
      </Button>
      <Button onClick={() => queue.success(SAVED_MESSAGE, { title: HEADING })}>
        {RAISE_HEADED}
      </Button>
      <ToastViewport maxVisible={maxVisible} onDismiss={queue.dismiss} toasts={queue.toasts} />
    </div>
  );
}

/** Places the viewport's box where the probe can find a pointer inside it and outside it. */
function placeStack(viewport: HTMLElement): void {
  viewport.getBoundingClientRect = (): DOMRect =>
    new DOMRect(STACK_BOX.left, STACK_BOX.top, STACK_BOX.width, STACK_BOX.height);
}

/** The viewport the messages stand in, found by the region the family names it with. */
function viewport(): HTMLElement {
  return screen.getByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
}

/** Moves the fake clock without leaving the testing library's `act` window. */
async function advance(delayMs: number): Promise<void> {
  await waitFor(
    async () => {
      await vi.advanceTimersByTimeAsync(delayMs);
    },
    { timeout: delayMs * 2 },
  );
}

// The stack --------------------------------------------------------------------------------------

describe("the toast stack", () => {
  it("renders the queue through the cap its caller asked for, falling back to the queue's own", async () => {
    const { user } = renderWithProviders(<ToastHarness maxVisible={Number.NaN} />);
    const raise = await screen.findByRole("button", { name: RAISE_DISTINCT });
    for (let count = 0; count < TOAST_MAX_VISIBLE + 1; count += 1) {
      await user.click(raise);
    }
    // A cap that is not a number is read as the queue's own rather than as nothing at all.
    expect(screen.getAllByRole("status")).toHaveLength(TOAST_MAX_VISIBLE);
  });

  it("holds a message while the pointer rests over the stack and resumes the time that was left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<ToastHarness />);
    await user.click(await screen.findByRole("button", { name: RAISE_FAILURE }));
    await screen.findByRole("alert");
    placeStack(viewport());
    // The probe reads the pointer from the document, because a real pointer can never enter a message box:
    // the sheet makes the whole frame pass-through and re-enables its dismiss control alone. The event is
    // therefore dispatched at the document with the point the probe has to place, which is the one thing an
    // event-driven move through `user-event` cannot supply here — the host reports every box as zero-sized.
    fireEvent.pointerMove(document, INSIDE_STACK);
    await advance(TOAST_DURATION_MS.error / 2);
    // Half the message's time has passed while the pointer rested over the stack: nothing counted it down.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.pointerMove(document, OUTSIDE_STACK);
    // The remainder is what resumes, not a fresh full duration: what is left of the message is what leaves it.
    await advance(TOAST_DURATION_MS.error * 0.6);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("leaves the reader's focus where it stands when the message that leaves is not the one holding it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<ToastHarness />);
    const raise = await screen.findByRole("button", { name: RAISE_DISTINCT });
    await user.click(raise);
    await user.click(raise);
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
    const [, younger] = screen.getAllByRole("status");
    const youngerClose = within(younger).getByRole("button", { name: COMMON_ACTIONS.CLOSE });
    // The focus on the younger message's control holds that message's countdown and is the element a dismissal
    // reads: the older one leaves while the control the reader is on outlives it, so the focus must not move.
    youngerClose.focus();
    await advance(TOAST_DURATION_MS.success + 100);
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent(SAVED_MESSAGE);
    expect(youngerClose).toHaveFocus();
  });

  it("ignores a pointer release that no hold preceded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<ToastHarness />);
    await user.click(await screen.findByRole("button", { name: RAISE_FAILURE }));
    const message = await screen.findByRole("alert");
    // Dispatched by hand for the reason the frame's own handlers exist: the box takes no pointer input, so a
    // real pointer never enters or leaves it and only a synthetic release can reach this path.
    fireEvent.pointerLeave(message);
    await advance(TOAST_DURATION_MS.error + 100);
    // The countdown was neither cleared nor restarted by a release that held nothing: the message left on time.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

// The messages -----------------------------------------------------------------------------------

describe("one queued message", () => {
  it("counts a resolved duration of zero as the register's own policy duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<ToastHarness />);
    await user.click(await screen.findByRole("button", { name: RAISE_UNDATED }));
    await screen.findByRole("status");
    await advance(50);
    // A duration of nothing is a message that could never be read, so the register's policy stands behind it.
    expect(screen.getByRole("status")).toBeInTheDocument();
    await advance(TOAST_DURATION_MS.success);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("renders the heading the queue was handed before the words of the message", async () => {
    const { user } = renderWithProviders(<ToastHarness />);
    await user.click(await screen.findByRole("button", { name: RAISE_HEADED }));
    const message = await screen.findByRole("status");
    expect(within(message).getByText(HEADING, { selector: "strong" })).toBeInTheDocument();
    expect(message).toHaveTextContent(`${HEADING} ${SAVED_MESSAGE}`);
  });
});
