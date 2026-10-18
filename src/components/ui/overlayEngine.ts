/**
 * Path: src/components/ui/overlayEngine.ts
 * Purpose: The overlay engine Modal, Drawer and ConfirmDialog share: focus movement, Tab containment, Escape, the inert background and outside-pointer dismissal.
 * Lines: 210
 */

import { useCallback, useEffect, useId, useRef } from "react";
import type { KeyboardEventHandler, RefObject } from "react";

import { useOnClickOutside } from "@/components/ui/hooks";

/**
 * Why this file exists beside `Modal.tsx`: one concern — the dialog behaviour every overlay shares — is
 * more than that file can hold under the plan's 600-line ceiling, so the ceiling splits it instead of
 * being raised, the way `src/components/charts/chartGeometry.ts` stands beside `chartScales.ts`. The three
 * components keep their own markup, classes and props; this module owns the rules they share, and
 * `Modal.tsx` is its only importer.
 */

/** The element `index.html` declares and `src/main.tsx` mounts the application into. */
const ROOT_ELEMENT_ID = "root";

/** Everything a browser lets a Tab reach, in document order; the panel's own `-1` is excluded. */
const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable]:not([contenteditable='false']), [tabindex]:not([tabindex='-1'])";

/** Whether `element` generates a box inside `panel`, read from the computed `display` of it and of each
 * ancestor up to the panel: a `display: none` region is reachable by no Tab, so it must never be the edge
 * a wrap is computed from. */
function isRenderedWithin(element: HTMLElement, panel: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  while (node !== null) {
    if (window.getComputedStyle(node).display === "none") return false;
    if (node === panel) return true;
    node = node.parentElement;
  }
  return false;
}

/** The elements inside `panel` a Tab can reach, read from the live DOM per keypress; a hidden, inert or
 * `aria-hidden` subtree is excluded, and so is an element that generates no box. */
function focusableElements(panel: HTMLElement): readonly HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hasAttribute("hidden") &&
      element.closest("[inert], [aria-hidden='true']") === null &&
      isRenderedWithin(element, panel),
  );
}

/** The overlays that are open, in the order they opened: the last entry is the topmost, and the one an
 * outside pointer belongs to, so one gesture closes one overlay and the root comes back to life last. */
const openOverlays: string[] = [];

/** The root's own `inert` state before this file first took it over, restored on the last close. */
let rootWasInert: boolean | null = null;

/** Makes the application root inert while any overlay is open, capturing its prior state for the restore.
 * The write targets `#root`, not the overlay, which is portalled to `document.body` to stay interactive. */
function acquireInertBackground(overlayId: string): void {
  openOverlays.push(overlayId);
  if (openOverlays.length > 1) return;
  const root = document.getElementById(ROOT_ELEMENT_ID);
  if (root === null) return;
  rootWasInert = root.inert === true;
  root.inert = true;
}

/** Gives the application root back once the last overlay has closed. An overlay leaves by identity and not
 * by popping the top, so panels that unmount out of order keep the stack and the prior state correct. */
function releaseInertBackground(overlayId: string): void {
  const index = openOverlays.indexOf(overlayId);
  if (index !== -1) openOverlays.splice(index, 1);
  if (openOverlays.length > 0) return;
  const root = document.getElementById(ROOT_ELEMENT_ID);
  if (root !== null && rootWasInert !== null) {
    root.inert = rootWasInert;
  }
  rootWasInert = null;
}

/** Whether an overlay is the topmost of the open stack, and so the owner of an outside pointer. */
function isTopmostOverlay(overlayId: string): boolean {
  return openOverlays.at(-1) === overlayId;
}

/** Every option a component of this family hands the engine. */
interface OverlayOptions {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly canDismiss: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
}

/** The panel ref to attach and the key handler to run on it. */
interface OverlayEngine {
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly handleKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

/**
 * The dialog contract every member of this family shares, implemented once: a panel portalled onto
 * `document.body`, focus moved into it on open and returned to the invoking control on close, Tab and
 * Shift+Tab wrapped inside it, Escape to dismiss, a pointer outside it to dismiss through the shared
 * `useOnClickOutside`, and an inert application root while it is up. `Modal`, `Drawer` and
 * `ConfirmDialog` differ only in markup and classes, so a second copy of any of those rules in a consumer
 * would be the duplication the plan forbids — which is why the mini-cart and the facet panel compose
 * `Drawer` rather than opening a panel of their own.
 *
 * @param options - Whether the overlay is open, how it closes, whether it may be dismissed, and where the
 *   focus goes first.
 * @returns The ref for the panel element and the key handler that panel must run.
 */
export function useOverlay({
  isOpen,
  onClose,
  canDismiss,
  initialFocusRef,
}: OverlayOptions): OverlayEngine {
  const overlayId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    // Read before the focus moves in, and restored only while it is still in the document.
    const invoker = document.activeElement;
    invokerRef.current = invoker instanceof HTMLElement ? invoker : null;
    acquireInertBackground(overlayId);
    const panel = panelRef.current;
    const firstInside = panel === null ? null : (focusableElements(panel).at(0) ?? null);
    const focusTarget = initialFocusRef?.current ?? firstInside ?? panel;
    focusTarget?.focus();
    // A target that cannot take the focus would leave it on the body while the panel is up — the
    // confirming control of a dialog that opens already in flight is exactly that — so the panel,
    // which carries `tabIndex={-1}`, holds it instead.
    if (panel !== null && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      releaseInertBackground(overlayId);
      const invokerElement = invokerRef.current;
      invokerRef.current = null;
      if (invokerElement !== null && invokerElement.isConnected) invokerElement.focus();
    };
  }, [isOpen, initialFocusRef, overlayId]);

  // A dismissal must not depend on where the focus happens to be: a control that goes disabled gives the
  // focus up, and a key pressed at the document body never reaches a handler on the portalled panel. The
  // press is therefore read in the capture phase at the document, before any handler inside the page, and
  // only the topmost overlay answers it — the rule the outside pointer already follows, so one press
  // dismisses exactly one panel however deep the stack is.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (!canDismiss || !isTopmostOverlay(overlayId)) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleEscape, { capture: true });
    return () => document.removeEventListener("keydown", handleEscape, { capture: true });
  }, [canDismiss, isOpen, onClose, overlayId]);

  // Escape is answered at the document, so the panel's own handler owns Tab alone.
  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>((event) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (panel === null) return;
    const focusable = focusableElements(panel);
    const first = focusable.at(0) ?? null;
    const last = focusable.at(-1) ?? null;
    if (first === null || last === null) {
      // Nothing inside is reachable, so the panel holds the focus rather than letting Tab walk out.
      event.preventDefault();
      panel.focus();
      return;
    }
    const active = document.activeElement;
    if (!(active instanceof Node) || !panel.contains(active) || active === panel) {
      // The focus sits on the panel's frame or has left it, so the key is answered from an edge.
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }, []);

  // A pointer outside the panel belongs to the topmost overlay alone: a gesture against a stacked panel's
  // backdrop also lies outside every panel beneath it, and one click must close one overlay, not the stack.
  const handleOutsidePointerDown = useCallback(
    (event: MouseEvent | TouchEvent): void => {
      if (!isTopmostOverlay(overlayId)) return;
      // The gesture's own focus default is cancelled in every case, because the browser would otherwise
      // move the focus to the document body, away from the panel a keyboard user is still working in.
      event.preventDefault();
      if (canDismiss) onClose();
    },
    [canDismiss, onClose, overlayId],
  );

  useOnClickOutside(panelRef, handleOutsidePointerDown, { enabled: isOpen });

  return { panelRef, handleKeyDown };
}
