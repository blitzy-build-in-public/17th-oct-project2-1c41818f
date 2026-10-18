/**
 * Path: tests/components/overlays.test.tsx
 * Purpose: The overlay family's behaviour — dialog semantics, the inert background, focus moved in and restored, Escape, the Tab-edge wrap, the busy confirmation and the drawer presentation
 * Lines: 273
 */

import { useRef, useState } from "react";
import type { ReactElement } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/Modal";
import { A11Y_COPY, CATALOG_COPY, COMMON_ACTIONS, SEARCH_COPY } from "@/constants/content";
import { useBreakpoint } from "@/state/hooks";

import { renderWithProviders, screen, waitFor } from "../testUtils";

/*
 * The overlay family seen from the outside — the modal, the drawer and the confirmation — through roles,
 * accessible names, ARIA state, rendered text and where the keyboard focus is. No assertion touches a class
 * name or a computed style, so none needs a stylesheet; every subject is mounted through
 * `renderWithProviders`, and the panels portal onto `document.body`, so queries come from `screen`.
 *
 * This file is the §0.5.5 split of `tests/components/controls.test.tsx`: the three overlays are a family in
 * their own right, and the shared-controls suite that held them alongside four other families was over the
 * 600-line ceiling, so the ceiling's remedy applies and the split is recorded in the manifest. Nothing else
 * changed — every case below is the case the single suite ran, and the other four families stay in the file
 * this one came from.
 *
 * Each case reads its first post-render expectation through an awaited query rather than a synchronous one,
 * because the providers issue requests when they mount: an update raised outside the testing library's `act`
 * window is what React reports as an act warning. The rule, and why the awaited query is what keeps such a
 * settle inside that window, is stated in `tests/testUtils.tsx`; no case needs an `act` call of its own.
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
