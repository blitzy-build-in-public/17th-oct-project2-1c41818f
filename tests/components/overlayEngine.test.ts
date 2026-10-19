/**
 * Path: tests/components/overlayEngine.test.ts
 * Purpose: The dialog behaviour the overlay family shares: the focus edges a panel's Tab walks, the stack an outside pointer and Escape answer, the frame that holds a focus no control can take, and the inert application root
 * Lines: 315
 */

import { createElement, useState } from "react";
import type { ReactElement, RefObject } from "react";

import { beforeEach, describe, expect, it } from "vitest";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { ModalProps } from "@/components/ui/Modal";
import { A11Y_COPY } from "@/constants/content";

import { renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * `src/components/ui/overlayEngine.ts` read through the panels that compose it, because the module's contract
 * is the behaviour its consumers gain: the three members of the family keep their own markup, and this file
 * drives the rules they share — which controls a Tab can reach and in what order it wraps, which member of a
 * stack a gesture belongs to, where the focus stands when no control inside can take it, and when the
 * application root is dimmed and handed back.
 *
 * The file is `.ts` rather than `.tsx`, so the harnesses below build their trees with `createElement`. Every
 * case reads its first post-render expectation through an awaited query, because the providers issue requests
 * when they mount and an assertion made before they settle is the state update React reports as unexplained.
 * The rule is stated in `tests/testUtils.tsx`, and the panels portal onto `document.body`, so queries come from
 * `screen`.
 */

// Test data --------------------------------------------------------------------------------------

const PANEL_NAME = "Report range";
const LOWER_NAME = "Order summary";
const UPPER_NAME = "Remove this address?";
const FIRST_ACTION = "Continue";
const LAST_ACTION = "Go to checkout";
const HIDDEN_ACTION = "Preview the receipt";
const RESTING_VALUE = "Totals for the trailing 30 days";
const TRIGGER_NAME = "Revenue chart";

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

/** The control that closes a modal panel, named as the family names it. */
function closeControl(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("button", { name: A11Y_COPY.CLOSE_DIALOG_LABEL });
}

beforeEach(applicationRoot);

// Harness panels, mounted inside the real providers -----------------------------------------------

/**
 * One panel element.
 *
 * Its content travels inside the props rather than as a trailing argument, because `ModalProps.children` is a
 * required field and `createElement` checks that object before it takes a child: a `.ts` file has no JSX to
 * express the panel any other way.
 */
function panel(props: ModalProps): ReactElement {
  return createElement(Modal, props);
}

/**
 * A panel whose last two controls are a visible one and a hidden one: the engine has to read the hidden control
 * out of the panel's edges, or Tab's wrap out of the panel's last control would land on it.
 */
function EdgesSurface(): ReactElement {
  return panel({
    children: [
      createElement(Button, { key: "first", onClick: () => undefined }, FIRST_ACTION),
      createElement(Button, { key: "last", onClick: () => undefined }, LAST_ACTION),
      createElement(
        Button,
        { key: "hidden", onClick: () => undefined, style: { display: "none" } },
        HIDDEN_ACTION,
      ),
    ],
    isOpen: true,
    onClose: () => undefined,
    title: PANEL_NAME,
  });
}

/** Two panels open at once, each closing on its own, so a gesture's destination and the stack are observable. */
function StackSurface(): ReactElement {
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  return createElement(
    "div",
    null,
    panel({
      children: createElement(Button, { onClick: () => undefined }, FIRST_ACTION),
      isOpen: lower,
      onClose: () => setLower(false),
      title: LOWER_NAME,
    }),
    panel({
      children: createElement(Button, { onClick: () => undefined }, LAST_ACTION),
      isOpen: upper,
      onClose: () => setUpper(false),
      title: UPPER_NAME,
    }),
  );
}

/** A panel with nothing a Tab can reach: it is not dismissible, so it renders no close control either. */
function BareSurface(): ReactElement {
  return panel({
    children: null,
    isDismissible: false,
    isOpen: true,
    onClose: () => undefined,
    title: PANEL_NAME,
  });
}

/**
 * A panel whose controls stand beside a resting element the focus is sent to, which cannot take it.
 *
 * The resting element is held in a box the harness keeps in state rather than in `useRef`, because this file is
 * `.ts` and `createElement` — the only way to build a tree without JSX — cannot carry a ref value: the
 * repository's hooks lint rejects a ref passed to a function during a render. The box takes the shape the prop
 * is declared with and lives as long as the harness does, which is what a ref holds for.
 */
function RestingSurface(): ReactElement {
  const [resting] = useState<RefObject<HTMLDivElement | null>>(() => ({ current: null }));
  return panel({
    children: [
      createElement("div", { key: "resting", ref: resting }, RESTING_VALUE),
      createElement(Button, { key: "first", onClick: () => undefined }, FIRST_ACTION),
      createElement(Button, { key: "last", onClick: () => undefined }, LAST_ACTION),
    ],
    initialFocusRef: resting,
    isOpen: true,
    onClose: () => undefined,
    title: PANEL_NAME,
  });
}

/** A panel that may not be dismissed, so the only way out of it is the control the caller renders. */
function HeldSurface(): ReactElement {
  return panel({
    children: createElement(Button, { onClick: () => undefined }, FIRST_ACTION),
    isDismissible: false,
    isOpen: true,
    onClose: () => undefined,
    title: PANEL_NAME,
  });
}

/**
 * A surface whose invoking control is not an HTML element: a focusable chart that opens the panel from its own
 * activation, which is the half of the family's restore contract no button or link can show. The panel's close
 * control is a button, so the panel itself is ordinary.
 */
function ChartSurface(): ReactElement {
  const [isOpen, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement(
      "svg",
      {
        height: 40,
        key: "trigger",
        onClick: (): void => setOpen(true),
        tabIndex: 0,
        width: 40,
      },
      createElement("title", null, TRIGGER_NAME),
      createElement("rect", { height: 40, width: 40 }),
    ),
    panel({
      children: createElement(Button, { onClick: () => undefined }, FIRST_ACTION),
      isOpen,
      onClose: () => setOpen(false),
      title: PANEL_NAME,
    }),
  );
}

// The panel's own focus edges ---------------------------------------------------------------------

describe("the focus a panel takes and the edges Tab walks", () => {
  it("reads its edges from the controls that paint, leaving a hidden subtree out of the round", async () => {
    const { user } = renderWithProviders(createElement(EdgesSurface));
    const dialog = await screen.findByRole("dialog", { name: PANEL_NAME });
    // Only the three controls that paint are the panel's: the hidden one is out of the accessibility tree, so
    // no reader can be sent to it and the round below has three stops rather than four.
    expect(within(dialog).getAllByRole("button")).toHaveLength(3);
    const last = within(dialog).getByRole("button", { name: LAST_ACTION });
    last.focus();
    await user.tab();
    // The hidden control is not the panel's last reachable element, so the wrap comes round to its first.
    expect(closeControl(dialog)).toHaveFocus();
    // A backward Tab from the middle of the panel is the browser's own move and is left to it, so it lands on
    // the control before the one the reader was on rather than on any edge the panel computes.
    within(dialog).getByRole("button", { name: FIRST_ACTION }).focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(closeControl(dialog)).toHaveFocus();
  });

  it("holds the focus on a panel with nothing a Tab can reach, and answers Tab there", async () => {
    const { user } = renderWithProviders(createElement(BareSurface));
    const dialog = await screen.findByRole("dialog", { name: PANEL_NAME });
    expect(within(dialog).queryAllByRole("button")).toHaveLength(0);
    expect(dialog).toHaveFocus();
    await user.tab();
    // Nothing inside is reachable, so the panel keeps the focus rather than letting Tab walk out of it.
    expect(dialog).toHaveFocus();
  });

  it("holds the focus on the frame when the control it was sent to cannot take it, and answers Tab from either edge", async () => {
    const { user } = renderWithProviders(createElement(RestingSurface));
    const dialog = await screen.findByRole("dialog", { name: PANEL_NAME });
    const first = closeControl(dialog);
    const last = within(dialog).getByRole("button", { name: LAST_ACTION });
    // A resting element takes no focus, so the panel — which carries `tabIndex={-1}` — holds it instead of the
    // document body.
    expect(dialog).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it("answers a backward Tab from the frame by the panel's last stop", async () => {
    const { user } = renderWithProviders(createElement(RestingSurface));
    const dialog = await screen.findByRole("dialog", { name: PANEL_NAME });
    const last = within(dialog).getByRole("button", { name: LAST_ACTION });
    expect(dialog).toHaveFocus();
    // A backward Tab from the frame reaches the panel's last control, the edge the panel ends at.
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();
  });
});

// The stack the panels share ----------------------------------------------------------------------

describe("the stack of open panels", () => {
  it("answers an outside pointer with the topmost panel alone and hands the root back once the last one closes", async () => {
    const { user } = renderWithProviders(createElement(StackSurface));
    await screen.findByRole("dialog", { name: LOWER_NAME });
    expect(screen.getByRole("dialog", { name: UPPER_NAME })).toBeInTheDocument();
    expect(isBackgroundInert()).toBe(true);
    await user.click(document.body);
    // One gesture closed one panel: the topmost answered it and the one beneath it is still up.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: UPPER_NAME })).toBeNull());
    expect(screen.getByRole("dialog", { name: LOWER_NAME })).toBeInTheDocument();
    expect(isBackgroundInert()).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: LOWER_NAME })).toBeNull());
    // The root comes back to life with the last panel, never with the one beneath it.
    expect(isBackgroundInert()).toBe(false);
  });

  it("keeps the root inert and the panel open for a pointer against a panel that may not be dismissed", async () => {
    const { user } = renderWithProviders(createElement(HeldSurface));
    const dialog = await screen.findByRole("dialog", { name: PANEL_NAME });
    await user.click(document.body);
    // The gesture is cancelled rather than answered, so the focus stays where the reader left it.
    expect(screen.getByRole("dialog", { name: PANEL_NAME })).toBeInTheDocument();
    expect(isBackgroundInert()).toBe(true);
    expect(hasFocusInside(dialog)).toBe(true);
  });
});

// The focus a dismissal hands back -----------------------------------------------------------------

describe("the focus a dismissal hands back", () => {
  it("restores no focus to an invoker that is not an HTML element", async () => {
    const { container, user } = renderWithProviders(createElement(ChartSurface));
    const trigger = container.querySelector<SVGSVGElement>("svg");
    if (trigger === null) throw new Error("The harness rendered no chart trigger");
    trigger.focus();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await screen.findByRole("dialog", { name: PANEL_NAME });
    // The family restores the focus to the control that opened the panel only while that control is an element
    // it can focus; a surface that opened it from anywhere else leaves the focus where the removal put it.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});
