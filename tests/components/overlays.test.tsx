/**
 * Path: tests/components/overlays.test.tsx
 * Purpose: The overlay family and the supplementary surfaces beside it — dialog semantics, the inert background, focus moved in and restored, Escape, the Tab-edge wrap, the busy confirmation, the drawer presentation, the tooltip and the toast — including keyboard and focus handling
 * Lines: 502
 */

import { useRef, useState } from "react";
import type { ReactElement } from "react";

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/Modal";
import { useBreakpoint } from "@/components/ui/hooks";
import { ToastViewport } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  A11Y_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  SEARCH_COPY,
} from "@/constants/content";
import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from "@/constants/config";
import { useToast } from "@/state/ToastContext";

import { renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * The overlays and the surfaces beside them seen from the outside — the modal, the drawer, the destructive
 * confirmation, the tooltip and the toast viewport — through roles, accessible names, ARIA state, rendered
 * text and where the keyboard focus is. No assertion reads a computed style, so none needs a stylesheet: the
 * one class name any case reads is the drawer's frame-deferred `is-open` entrance, asserted as the token it is
 * rather than as the transform the sheet resolves it to. Every subject is mounted through
 * `renderWithProviders`, and the overlay panels portal onto `document.body`, so queries come from `screen`.
 *
 * A §0.5.5 split of `tests/components/controls.test.tsx`, which had reached the request's 600-line ceiling
 * with these two describes inside it: the overlays are a family in their own right, the button, field and
 * selection families stay there and the overlay and supplementary half is here. No case was edited and none
 * was dropped — the moved ranges were taken as they stood — and each file declares the helpers its own
 * subjects read, so the suite's total is unchanged. The later pass that rewrote the toast's cases is folded in
 * here, where the toast and the tooltip are read: its distinct-message control, its viewport-portal case and
 * its collapse case are declared in this file and in no other.
 *
 * Each case reads its first post-render expectation through an awaited query, and moves a fake clock inside an
 * awaited query rather than between two of them, because the providers issue requests when they mount and a
 * toast countdown dismisses through a queue update: an update raised outside the testing library's `act` window
 * is what React reports as an act warning. The rule, and why the awaited query is what keeps such a settle
 * inside that window, is stated in `tests/testUtils.tsx`; no case needs an `act` call of its own, with one
 * exception: the drawer's entrance case takes the frame queue into its own hands — asserting the pending class
 * before any frame has run, then running the captured callback inside `act` — so the ordering it asserts is
 * decided by the case rather than by the host's clock.
 */

/** The media-query shim `tests/setup.ts` installs, kept so a case that overrides it puts it back. */
const SHIM_MEDIA_MATCH = window.matchMedia;

/** The element `index.html` declares and the application mounts into; jsdom starts without one. */
function applicationRoot(): HTMLElement {
  const existing = document.getElementById("root");
  if (existing !== null) return existing;
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  return root;
}

/**
 * Whether the application root is inert while an overlay is up.
 *
 * The engine writes the `inert` IDL property on that root, which a browser reflects onto the attribute and
 * jsdom does not, so the property is the state reachable here; jsdom enforces no focus blocking from it.
 */
function isBackgroundInert(): boolean {
  return (applicationRoot() as unknown as { readonly inert?: boolean }).inert === true;
}

/** Whether the keyboard focus currently sits inside `container` — the overlay containment contract. */
function hasFocusInside(container: HTMLElement): boolean {
  const active = document.activeElement;
  return active !== null && container.contains(active);
}

/** A `MediaQueryList` answering `matches`, which is all `useMediaQuery` reads from it. */
function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  const noop = (): void => undefined;
  return {
    media: query,
    matches,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

// Test data --------------------------------------------------------------------------------------

const MODAL_TITLE = "Order summary";
const DRAWER_TITLE = "Your basket";
const CONFIRM_TITLE = "Remove this address?";
const CONFIRM_MESSAGE = "This address will be removed from your address book.";
const PREFERRED_ACTION = "Go to checkout";
const PANEL_VALUE = "Facet controls";

const OPEN_MODAL = "Open modal";
const OPEN_DRAWER = "Open drawer";
const OPEN_CONFIRM = "Open confirmation";
const RAISE_SUCCESS = "Report a success";
const RAISE_ERROR = "Report a failure";
const RAISE_DISTINCT = "Report another success";
const TOOLTIP_TEXT = "Excludes cancelled orders.";

beforeEach(applicationRoot);

afterEach(() => {
  window.matchMedia = SHIM_MEDIA_MATCH;
});

// Harness components, mounted inside the real providers ------------------------------------------

/** The three overlays, each behind a real invoking control, so focus restoration is measurable. */
function OverlayHarness({ canDismiss = true }: { readonly canDismiss?: boolean }): ReactElement {
  const [panel, setPanel] = useState<"modal" | "drawer" | "confirm" | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const close = (): void => setPanel(null);
  return (
    <div>
      <Button onClick={() => setPanel("modal")}>{OPEN_MODAL}</Button>
      <Button onClick={() => setPanel("drawer")}>{OPEN_DRAWER}</Button>
      <Button onClick={() => setPanel("confirm")}>{OPEN_CONFIRM}</Button>
      <Modal
        initialFocusRef={actionRef}
        isDismissible={canDismiss}
        isOpen={panel === "modal"}
        onClose={close}
        title={MODAL_TITLE}
      >
        <Button onClick={() => undefined}>{COMMON_ACTIONS.CONTINUE}</Button>
        <Button ref={actionRef} onClick={() => undefined}>
          {PREFERRED_ACTION}
        </Button>
      </Modal>
      <Drawer isOpen={panel === "drawer"} onClose={close} title={DRAWER_TITLE}>
        <Button onClick={() => undefined}>{PREFERRED_ACTION}</Button>
      </Drawer>
      <ConfirmDialog
        isDestructive
        isOpen={panel === "confirm"}
        message={CONFIRM_MESSAGE}
        onCancel={close}
        onConfirm={close}
        title={CONFIRM_TITLE}
      />
    </div>
  );
}

/** A destructive confirmation that goes in flight once answered, so a second attempt can be made. */
function BusyConfirm({ onConfirm }: { readonly onConfirm: () => void }): ReactElement {
  const [isBusy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      isBusy={isBusy}
      isDestructive
      isOpen
      message={CONFIRM_MESSAGE}
      onCancel={() => undefined}
      onConfirm={() => {
        setBusy(true);
        onConfirm();
      }}
      title={CONFIRM_TITLE}
    />
  );
}

/**
 * Raises notifications through the real queue, beside the viewport. The viewport takes the queue and its
 * dismiss handle as props — `src/App.tsx` mounts it that way — so the harness passes what it reads.
 *
 * The first two controls raise a fixed message, which is what the queue collapses: raising either of them again
 * while its message stands leaves one message and not two. The third raises a message whose words differ on
 * every press, which is how a burst of distinct messages — the burst the visible cap bounds — is raised.
 */
function ToastHarness(): ReactElement {
  const toast = useToast();
  const distinctRef = useRef(0);
  return (
    <div>
      <Button onClick={() => toast.success(FEEDBACK_COPY.TOAST_ADDRESS_SAVED)}>
        {RAISE_SUCCESS}
      </Button>
      <Button onClick={() => toast.error(FEEDBACK_COPY.TOAST_EXPORT_FAILED)}>{RAISE_ERROR}</Button>
      <Button
        onClick={() => {
          distinctRef.current += 1;
          toast.success(`${FEEDBACK_COPY.TOAST_ADDRESS_SAVED} ${String(distinctRef.current)}`);
        }}
      >
        {RAISE_DISTINCT}
      </Button>
      <ToastViewport toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}

/** The filter panel as the catalogue composes it: a drawer below the small stop, a column above it. */
function ResponsivePanel(): ReactElement {
  const { isMobile } = useBreakpoint();
  if (!isMobile) {
    return <section aria-label={CATALOG_COPY.RESULTS_REGION_LABEL}>{PANEL_VALUE}</section>;
  }
  return (
    <Drawer isOpen onClose={() => undefined} title={SEARCH_COPY.FILTER_PANEL_HEADING}>
      {PANEL_VALUE}
    </Drawer>
  );
}

// The overlay family ----------------------------------------------------------------------------

describe("the overlay family", () => {
  it("opens a modal as a named dialog, moves the focus in and keeps Tab inside it", async () => {
    const { user } = renderWithProviders(<OverlayHarness />);
    await user.click(screen.getByRole("button", { name: OPEN_MODAL }));
    const dialog = await screen.findByRole("dialog", { name: MODAL_TITLE });
    // The close control is the panel's first reachable element and the ref target its last, so three Tabs
    // from the initial focus come back to the last one and the next Tab wraps to the first.
    const first = screen.getByRole("button", { name: A11Y_COPY.CLOSE_DIALOG_LABEL });
    const last = screen.getByRole("button", { name: PREFERRED_ACTION });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(last).toHaveFocus();
    expect(hasFocusInside(dialog)).toBe(true);
    expect(isBackgroundInert()).toBe(true);
    for (let step = 0; step < 3; step += 1) {
      await user.tab();
      expect(hasFocusInside(dialog)).toBe(true);
    }
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it("closes on Escape and on a pointer outside the panel, restoring the focus each time", async () => {
    const { user } = renderWithProviders(<OverlayHarness />);
    const trigger = screen.getByRole("button", { name: OPEN_MODAL });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: MODAL_TITLE });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    expect(isBackgroundInert()).toBe(false);
    await user.click(trigger);
    await screen.findByRole("dialog", { name: MODAL_TITLE });
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("keeps a non-dismissible modal open when Escape is pressed", async () => {
    const { user } = renderWithProviders(<OverlayHarness canDismiss={false} />);
    await user.click(screen.getByRole("button", { name: OPEN_MODAL }));
    await screen.findByRole("dialog", { name: MODAL_TITLE });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: MODAL_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: A11Y_COPY.CLOSE_DIALOG_LABEL })).toBeNull();
  });

  it("gives the drawer the same dialog contract as the modal", async () => {
    const { user } = renderWithProviders(<OverlayHarness />);
    const trigger = screen.getByRole("button", { name: OPEN_DRAWER });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: DRAWER_TITLE });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(hasFocusInside(dialog)).toBe(true);
    expect(isBackgroundInert()).toBe(true);
    await user.tab();
    expect(hasFocusInside(dialog)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    expect(isBackgroundInert()).toBe(false);
  });

  it("defers the drawer's open class to the frame after the mount it travels from", async () => {
    const { user } = renderWithProviders(<OverlayHarness />);
    // This case owns the frame queue instead of racing it. jsdom runs `requestAnimationFrame` on a real
    // timer of its own — a frame of wall-clock time — while the click and the query below spend wall-clock
    // time too, so on a loaded host the frame could already have run by the time the assertions read the
    // panel. Capturing the queue rather than scheduling it puts the ordering under the case's control: the
    // panel's mount effect still asks for its frame, nothing runs it until the case does, and a frame its
    // cleanup cancelled is dropped the way a browser drops it.
    const queuedFrames: { readonly handle: number; readonly callback: FrameRequestCallback }[] = [];
    const cancelledFrames = new Set<number>();
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback): number => {
        const handle = queuedFrames.length + 1;
        queuedFrames.push({ handle, callback });
        return handle;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((handle: number): void => {
        cancelledFrames.add(handle);
      });
    try {
      await user.click(screen.getByRole("button", { name: OPEN_DRAWER }));
      // Read on the click's own commit, before any frame has run: the panel is already the named dialog with
      // the focus inside it, and only the state class the sheet travels from is still outstanding — the
      // resting transform a transition needs as its starting value, which is what makes the declared travel
      // play instead of the panel popping into place.
      const dialog = screen.getByRole("dialog", { name: DRAWER_TITLE });
      expect(hasFocusInside(dialog)).toBe(true);
      expect(dialog).not.toHaveClass("is-open");
      expect(queuedFrames.length).toBeGreaterThan(0);
      // The frame the panel asked for, run where the browser would run it: the callbacks are run inside
      // `act`, which commits the state update they carry before the query below reads the class. The scope
      // is synchronous because the frame's write is — an async callback with nothing to await in it is the
      // `require-await` failure this codebase's lint rejects.
      act((): void => {
        for (const frame of queuedFrames) {
          if (!cancelledFrames.has(frame.handle)) frame.callback(performance.now());
        }
      });
      await waitFor(() => expect(dialog).toHaveClass("is-open"));
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("starts a destructive confirmation on its cancel control", async () => {
    const { user } = renderWithProviders(<OverlayHarness />);
    await user.click(screen.getByRole("button", { name: OPEN_CONFIRM }));
    const dialog = await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    const cancel = screen.getByRole("button", { name: COMMON_ACTIONS.CANCEL });
    expect(dialog).toHaveTextContent(CONFIRM_MESSAGE);
    expect(screen.getByRole("button", { name: COMMON_ACTIONS.CONFIRM })).toBeEnabled();
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(isBackgroundInert()).toBe(false);
  });

  it("answers a confirmation once while its confirming action is in flight", async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(<BusyConfirm onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: COMMON_ACTIONS.CONFIRM });
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("presents the filter panel as a drawer below the small stop and inline above it", async () => {
    // The shim reports a viewport below the small stop, which is the branch the drawer presentation is for.
    const narrow = renderWithProviders(<ResponsivePanel />);
    const drawer = await screen.findByRole("dialog", { name: SEARCH_COPY.FILTER_PANEL_HEADING });
    expect(drawer).toHaveTextContent(PANEL_VALUE);
    narrow.unmount();
    // Every `min-width` query satisfied is the viewport the inline column presentation is written for.
    window.matchMedia = (query: string) => mediaQueryList(query, query.includes("min-width"));
    renderWithProviders(<ResponsivePanel />);
    expect(await screen.findByText(PANEL_VALUE)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// Supplementary surfaces ------------------------------------------------------------------------

describe("supplementary surfaces", () => {
  it("describes its trigger only while the tooltip is open, on hover and on focus", async () => {
    const { user } = renderWithProviders(
      <Tooltip content={TOOLTIP_TEXT}>
        <Button onClick={() => undefined}>{COMMON_ACTIONS.APPLY}</Button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: COMMON_ACTIONS.APPLY });
    expect(trigger).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.hover(trigger);
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    expect(screen.getByRole("tooltip")).toHaveTextContent(TOOLTIP_TEXT);
    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent(TOOLTIP_TEXT);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("portals the toast viewport onto the document body, outside the tree it is mounted in", async () => {
    const { container, user } = renderWithProviders(<ToastHarness />);
    await user.click(screen.getByRole("button", { name: RAISE_SUCCESS }));
    const viewport = await screen.findByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
    // The application root is made inert while any overlay is open, which dims it and keeps its subtree out
    // of the accessibility tree, so the viewport has to leave it for its declared rung and its live region
    // to hold — the harness mounts it inside the container, which is the tree it must not be found in.
    expect(viewport.parentElement).toBe(document.body);
    expect(container.contains(viewport)).toBe(false);
  });

  it("announces each kind in its own register, dismisses by control and caps what it shows", async () => {
    const { user } = renderWithProviders(<ToastHarness />);
    await user.click(screen.getByRole("button", { name: RAISE_ERROR }));
    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(FEEDBACK_COPY.TOAST_EXPORT_FAILED);
    const viewport = screen.getByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
    expect(viewport).not.toHaveAttribute("aria-live");
    await user.click(within(failure).getByRole("button", { name: COMMON_ACTIONS.CLOSE }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL })).toBeNull();
    const raise = screen.getByRole("button", { name: RAISE_SUCCESS });
    await user.click(raise);
    expect(await screen.findByRole("status")).toHaveTextContent(FEEDBACK_COPY.TOAST_ADDRESS_SAVED);
    // The cap is reached with distinct messages, because identical ones collapse into the message standing:
    // this control varies the words it raises, and TOAST_MAX_VISIBLE + 1 of them leave the cap's count standing.
    const raiseDistinct = screen.getByRole("button", { name: RAISE_DISTINCT });
    for (let count = 0; count < TOAST_MAX_VISIBLE + 1; count += 1) {
      await user.click(raiseDistinct);
    }
    expect(screen.getAllByRole("status")).toHaveLength(TOAST_MAX_VISIBLE);
  });

  it("collapses a repeat of one message and keeps the focus in the application when one is dismissed", async () => {
    const { user } = renderWithProviders(<ToastHarness />);
    const raise = screen.getByRole("button", { name: RAISE_SUCCESS });
    for (let count = 0; count < 5; count += 1) {
      await user.click(raise);
    }
    // Five raises of one message leave one message standing: a notification identical to the one already queued
    // collapses into it rather than stacking another copy of the same words over the page.
    expect(screen.getAllByRole("status")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: RAISE_DISTINCT }));
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
    const [older, younger] = screen.getAllByRole("status");
    const olderClose = within(older).getByRole("button", { name: COMMON_ACTIONS.CLOSE });
    const youngerClose = within(younger).getByRole("button", { name: COMMON_ACTIONS.CLOSE });
    // The focus reaches the older message's dismiss control by Tab, and that control leaves the document with the
    // message it belongs to: the dismissal owes the keyboard a survivor, and the younger message's control is
    // still mounted when the queue removes the older one.
    await user.tab();
    expect(olderClose).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    expect(youngerClose).toHaveFocus();

    // Dismissing the last message the same way leaves no survivor and this harness has no routed-content region
    // to hand the focus to: the guarded path moves nothing, throws nothing and empties the viewport.
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL })).toBeNull(),
    );
  });

  it("clears a message when its duration elapses and holds it while it is attended to", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<ToastHarness />);
    const raise = screen.getByRole("button", { name: RAISE_SUCCESS });
    await user.click(raise);
    await screen.findByRole("status");
    // The clock is moved inside an awaited query, so the dismissal the countdown raises lands in the window
    // that query holds open rather than between two of them: an update raised outside that window is what React
    // reports as an act warning. The budget is raised past the move, because the query's own timeout would
    // otherwise fire inside it and end the query before the dismissal does.
    await waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(TOAST_DURATION_MS.success);
      },
      { timeout: TOAST_DURATION_MS.success * 2 },
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await user.click(raise);
    const message = await screen.findByRole("status");
    await user.hover(message);
    vi.advanceTimersByTime(TOAST_DURATION_MS.success * 3);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: COMMON_ACTIONS.CLOSE });
    dismiss.focus();
    vi.advanceTimersByTime(TOAST_DURATION_MS.success);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.unhover(message);
    dismiss.blur();
    await waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(TOAST_DURATION_MS.success + 100);
      },
      { timeout: TOAST_DURATION_MS.success * 2 },
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
