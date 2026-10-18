/**
 * Path: src/components/ui/Modal.tsx
 * Purpose: Modal, drawer and confirm dialog with dialog semantics, focus trap and an inert background
 * Lines: 497
 */

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEventHandler, ReactElement, ReactNode, RefObject } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/icons";
import { useOverlay } from "@/components/ui/overlayEngine";
import { A11Y_COPY, COMMON_ACTIONS } from "@/constants/content";

/*
 * Class contract. `src/styles/data-display.css` — reached through the `@import` at the top of
 * `src/styles/components.css` — is the sole definition site of this family, and no file under
 * `src/components/**` imports a stylesheet because `src/main.tsx` is the only importer of
 * `src/styles/**`; every class below is consumed by name. The sheet owes this file `sp-backdrop` with
 * `--modal` and `--drawer`, `sp-modal` with `--sm|--md|--lg` and its `__header`, `__title`, `__close`,
 * `__body` and `__footer` parts, `sp-drawer` with `--start|--end`, `is-open` and its four parts, and
 * `sp-confirm` with `sp-confirm__actions`. State is carried by the attribute the sheet reads — the
 * `disabled` and `aria-busy` pair a `Button` sets in flight, `aria-modal`, and the `inert` attribute
 * written here on the application root, whose visible half is the backdrop — with `is-open` the single
 * state class, because it resolves a drawer's resting offset to the viewport edge. A panel is rendered
 * only while it is open: a hidden one left mounted would answer a `dialog` role query. The unions below
 * live here, not in `src/constants`, for the reason `src/components/ui/Button.tsx` records: a variant set
 * is the component family's API surface rather than copy or configuration. The dialog behaviour behind
 * these three components — the focus movement, the Tab containment, Escape, the inert background and the
 * outside-pointer dismissal — lives in `src/components/ui/overlayEngine.ts`, which this file imports.
 */

/** The three modal widths `src/styles/data-display.css` declares. */
export type ModalSize = "sm" | "md" | "lg";

/** The two viewport edges a drawer can be attached to. */
export type DrawerSide = "start" | "end";

/** Which control a confirm dialog puts the focus on when it opens. */
export type ConfirmInitialFocus = "confirm" | "cancel";

/** The class each modal width and each drawer side carries, exactly as the sheet spells them. */
const MODAL_SIZE_CLASSES: Readonly<Record<ModalSize, string>> = {
  sm: "sp-modal--sm",
  md: "sp-modal--md",
  lg: "sp-modal--lg",
};
const DRAWER_SIDE_CLASSES: Readonly<Record<DrawerSide, string>> = {
  start: "sp-drawer--start",
  end: "sp-drawer--end",
};

/** The backdrop each overlay is positioned and dimmed by, the drawer's reveal, and the close part. */
const BACKDROP_MODAL = "sp-backdrop sp-backdrop--modal";
const BACKDROP_DRAWER = "sp-backdrop sp-backdrop--drawer";
const OPEN_CLASS = "is-open";
const CLOSE_CLASS = "sp-modal__close";

/** Whether the environment schedules an animation frame, which is the one thing the drawer's entrance
 * waits on: `document` is absent on a server render, where no frame runs and no transition paints. */
function canScheduleAnimationFrame(): boolean {
  return typeof requestAnimationFrame === "function";
}

/** Joins the classes a member of this family carries, dropping a falsy entry rather than a blank space. */
function composeClassName(...values: readonly (string | false | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/** Everything a member of this family asks the shared panel frame for. */
interface OverlayFrameProps {
  readonly backdropClassName: string;
  readonly panelClassName: string;
  readonly panelRef: RefObject<HTMLDivElement | null>;
  /** The heading that names the panel; `label` names it instead when it renders none. */
  readonly labelledBy?: string;
  /** The accessible name for a panel whose content supplies its own heading. */
  readonly label?: string;
  readonly describedBy?: string;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly children: ReactNode;
}

/**
 * The dialog surface the three members of this family share: a real `role="dialog"` with `aria-modal`, a
 * name from its heading or its `label`, a `tabIndex` of `-1` for the focus, and the backdrop that centres
 * a modal and dims the page behind a drawer.
 */
function OverlayFrame({
  backdropClassName,
  panelClassName,
  panelRef,
  labelledBy,
  label,
  describedBy,
  onKeyDown,
  children,
}: OverlayFrameProps): ReactElement {
  return (
    <div className={backdropClassName}>
      <div
        aria-describedby={describedBy}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={panelClassName}
        onKeyDown={onKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
        <p className="sp-visually-hidden">{A11Y_COPY.INERT_BACKGROUND_NOTE}</p>
      </div>
    </div>
  );
}

/** Everything {@link Modal} accepts. */
export interface ModalProps {
  /** Whether the modal is up; the panel is rendered only while this is `true`. */
  readonly isOpen: boolean;
  /** Called once per dismissal, and stable across renders so a consumer's effects do not churn. */
  readonly onClose: () => void;
  /** The dialog's heading, rendered as an `<h2>` and used as its accessible name. */
  readonly title: string;
  /** The dialog's content. */
  readonly children: ReactNode;
  /** The actions row, rendered in the footer only when one is supplied. */
  readonly footer?: ReactNode;
  /** The width to render, of the three the sheet declares. Defaults to `"md"`. */
  readonly size?: ModalSize;
  /** Whether Escape, the backdrop and the close control may dismiss. Defaults to `true`. */
  readonly isDismissible?: boolean;
  /** The close control's accessible name, for a surface that says it in its own words. */
  readonly closeLabel?: string;
  /** The control the focus enters on, in place of the first reachable element in the panel. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** The element describing the dialog, for content the heading does not summarise. */
  readonly describedBy?: string;
  /** Extra classes for a layout the panel's own frame does not cover. */
  readonly className?: string;
}

/**
 * The product's modal dialog: a surface that must be answered before the page can be used again.
 *
 * A dialog is a top-level surface rather than a section of a page, so its `title` renders as an `<h2>` —
 * the level a consumer can trust inside a panel that begins its own outline — and that heading is what
 * names the dialog through `aria-labelledby`. A surface the user may leave open while continuing to
 * browse, such as the mini-cart, is a {@link Drawer} instead.
 *
 * @param props - Open state, the close handler, the heading, the content and the optional settings.
 * @returns The rendered dialog, or `null` while it is closed.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  isDismissible = true,
  closeLabel,
  initialFocusRef,
  describedBy,
  className,
}: ModalProps): ReactElement | null {
  const { panelRef, handleKeyDown } = useOverlay({
    isOpen,
    onClose,
    canDismiss: isDismissible,
    initialFocusRef,
  });
  const titleId = useId();

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <OverlayFrame
      backdropClassName={BACKDROP_MODAL}
      describedBy={describedBy}
      labelledBy={titleId}
      onKeyDown={handleKeyDown}
      panelClassName={composeClassName("sp-modal", MODAL_SIZE_CLASSES[size], className)}
      panelRef={panelRef}
    >
      <header className="sp-modal__header">
        <h2 className="sp-modal__title" id={titleId}>
          {title}
        </h2>
        {isDismissible ? (
          <IconButton
            className={CLOSE_CLASS}
            icon={<CloseIcon />}
            label={closeLabel ?? A11Y_COPY.CLOSE_DIALOG_LABEL}
            onClick={onClose}
            variant="ghost"
          />
        ) : null}
      </header>
      <div className="sp-modal__body">{children}</div>
      {footer === undefined || footer === null ? null : (
        <footer className="sp-modal__footer">{footer}</footer>
      )}
    </OverlayFrame>,
    document.body,
  );
}

/** Everything {@link Drawer} accepts apart from the name it requires. */
interface DrawerFrameProps {
  /** Whether the drawer is up; the panel is rendered only while this is `true`. */
  readonly isOpen: boolean;
  /** Called once per dismissal, and stable across renders so a consumer's effects do not churn. */
  readonly onClose: () => void;
  /** The drawer's content. */
  readonly children: ReactNode;
  /** The edge the panel is attached to. Defaults to `"end"`, and `"start"` is the leading edge in RTL. */
  readonly side?: DrawerSide;
  /** The actions row. A drawer whose content carries its own footer omits it. */
  readonly footer?: ReactNode;
  /** Whether Escape, the backdrop and the close control may dismiss. Defaults to `true`. */
  readonly isDismissible?: boolean;
  /** The close control's accessible name, for a panel that says it in its own words. */
  readonly closeLabel?: string;
  /** The control the focus enters on, in place of the first reachable element in the panel. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** The element describing the drawer, when the caller names one. */
  readonly describedBy?: string;
  /** Extra classes for a layout the panel's own frame does not cover. */
  readonly className?: string;
}

/**
 * The two ways a drawer is named, exactly one of which a caller supplies, so an unannounceable dialog
 * cannot be built: the `title` it renders as a heading, or a `label` its content earns the heading for.
 */
type DrawerName =
  | { readonly title: string; readonly label?: string }
  | { readonly title?: string; readonly label: string };

/** Everything {@link Drawer} accepts. */
export type DrawerProps = DrawerFrameProps & DrawerName;

/**
 * The product's drawer: a panel that comes in from a viewport edge over a page it does not unmount.
 *
 * A drawer is what a surface uses when the user should be able to keep the page they are on — the
 * mini-cart opened from the header, the facet panel on a phone — so it is content-sized, its footer is
 * optional, and Escape, the backdrop and its own close control all dismiss it. `title` renders the heading
 * and names the panel; `label` names a panel whose content supplies the heading, and no header is rendered
 * in that case, because content that carries the heading carries its own controls too.
 *
 * @param props - Open state, the close handler, one of the two names and the optional settings.
 * @returns The rendered drawer, or `null` while it is closed.
 */
export function Drawer(props: DrawerProps): ReactElement | null {
  const {
    isOpen,
    onClose,
    children,
    side = "end",
    footer,
    isDismissible = true,
    closeLabel,
    initialFocusRef,
    describedBy,
    className,
  } = props;
  const title = props.title;
  const headingId = useId();
  const { panelRef, handleKeyDown } = useOverlay({
    isOpen,
    onClose,
    canDismiss: isDismissible,
    initialFocusRef,
  });

  if (!isOpen || typeof document === "undefined") return null;

  const hasHeading = title !== undefined && title.length > 0;

  return createPortal(
    <DrawerPanel
      className={className}
      describedBy={describedBy}
      label={hasHeading ? undefined : props.label}
      labelledBy={hasHeading ? headingId : undefined}
      onKeyDown={handleKeyDown}
      panelRef={panelRef}
      side={side}
    >
      {hasHeading ? (
        <header className="sp-drawer__header">
          <h2 className="sp-drawer__title" id={headingId}>
            {title}
          </h2>
          {isDismissible ? (
            <IconButton
              className={CLOSE_CLASS}
              icon={<CloseIcon />}
              label={closeLabel ?? A11Y_COPY.CLOSE_DIALOG_LABEL}
              onClick={onClose}
              variant="ghost"
            />
          ) : null}
        </header>
      ) : null}
      <div className="sp-drawer__body">{children}</div>
      {footer === undefined || footer === null ? null : (
        <footer className="sp-drawer__footer">{footer}</footer>
      )}
    </DrawerPanel>,
    document.body,
  );
}

/** Everything {@link DrawerPanel} accepts: the frame's own props, plus the side its resting offset is. */
interface DrawerPanelProps {
  readonly side: DrawerSide;
  readonly panelRef: RefObject<HTMLDivElement | null>;
  /** The heading that names the panel; `label` names it instead when it renders none. */
  readonly labelledBy?: string;
  /** The accessible name for a panel whose content supplies its own heading. */
  readonly label?: string;
  readonly describedBy?: string;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  /** Extra classes for a layout the panel's own frame does not cover. */
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The drawer's panel, which exists only while the drawer is open — the lifetime its entrance belongs to.
 *
 * `src/styles/data-display.css` declares that entrance as a transition on `.sp-drawer` from the resting
 * offset the side class sets to the `translateX(0)` that `.is-open` resolves, so the travel needs one frame
 * in which the resting transform is the panel's computed style: a panel whose very first style is already
 * the settled one has nothing to start from and pops into place, which is what the review measured. The
 * class therefore arrives on the frame after the mount, and it is deliberately not state the drawer carries
 * across cycles — a panel mounted once per open holds the flag itself, so closing and reopening travels
 * again without a second write. The write happens in the frame callback and not in the effect body, because
 * an effect that writes state synchronously is the `set-state-in-effect` failure mode this codebase's lint
 * rejects; where no frame can be scheduled the panel starts settled and is simply present, exactly as it is
 * under the reduced-motion rule that removes the transition.
 */
function DrawerPanel({
  side,
  panelRef,
  labelledBy,
  label,
  describedBy,
  onKeyDown,
  className,
  children,
}: DrawerPanelProps): ReactElement {
  const [hasEntered, setHasEntered] = useState((): boolean => !canScheduleAnimationFrame());

  useEffect(() => {
    if (!canScheduleAnimationFrame()) return undefined;
    const frame = requestAnimationFrame((): void => setHasEntered(true));
    // StrictMode runs this effect's setup twice in development, so the first frame is cancelled rather
    // than left to fire beside the second.
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <OverlayFrame
      backdropClassName={BACKDROP_DRAWER}
      describedBy={describedBy}
      label={label}
      labelledBy={labelledBy}
      onKeyDown={onKeyDown}
      panelClassName={composeClassName(
        "sp-drawer",
        DRAWER_SIDE_CLASSES[side],
        hasEntered && OPEN_CLASS,
        className,
      )}
      panelRef={panelRef}
    >
      {children}
    </OverlayFrame>
  );
}

/** Everything {@link ConfirmDialog} accepts. */
export interface ConfirmDialogProps {
  /** Whether the confirmation is up. */
  readonly isOpen: boolean;
  /** The question, rendered as the heading and used as the dialog's accessible name. */
  readonly title: string;
  /** The consequence the user is agreeing to, used as the dialog's description. */
  readonly message: string;
  /** The confirming action's label. Defaults to the shared `Confirm` verb. */
  readonly confirmLabel?: string;
  /** The dismissing action's label. Defaults to the shared `Cancel` verb. */
  readonly cancelLabel?: string;
  /** The action taken when the user agrees. */
  readonly onConfirm: () => void;
  /** The action taken when the user declines, or dismisses with Escape or the backdrop. */
  readonly onCancel: () => void;
  /** Paints the confirming action as the danger variant, for a removal or a discard. */
  readonly isDestructive?: boolean;
  /** Marks the confirming action in flight: disabled, busy and showing the shared spinner. */
  readonly isBusy?: boolean;
  /** Which control the focus lands on; `"cancel"` by default, so the safe answer is the deliberate one. */
  readonly initialFocus?: ConfirmInitialFocus;
  /** Extra classes for a layout the panel's own frame does not cover. */
  readonly className?: string;
}

/**
 * The product's confirmation dialog: one question, two answers and no other content.
 *
 * It composes the same engine and the same `Button` family as its siblings, so the destructive colour and
 * the in-flight treatment keep one home each. Escape, the backdrop and the cancel action all take the same
 * path, `onCancel`, which is what makes a declined confirmation behave exactly like a dismissed one, and
 * while `isBusy` the confirming action is disabled and announces its own in-flight state, so a second
 * submission cannot be started from a keyboard.
 *
 * @param props - Open state, the question, its consequence, the two actions and the optional settings.
 * @returns The rendered confirmation, or `null` while it is closed.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = COMMON_ACTIONS.CONFIRM,
  cancelLabel = COMMON_ACTIONS.CANCEL,
  onConfirm,
  onCancel,
  isDestructive = false,
  isBusy = false,
  initialFocus = "cancel",
  className,
}: ConfirmDialogProps): ReactElement | null {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const { panelRef, handleKeyDown } = useOverlay({
    isOpen,
    onClose: onCancel,
    canDismiss: true,
    initialFocusRef: initialFocus === "confirm" ? confirmRef : cancelRef,
  });
  const titleId = useId();
  const messageId = useId();

  // A confirming action that goes in flight turns `disabled`, and a control that cannot take the focus
  // gives it up: Chrome hands it to the document body while the application root is still inert, jsdom
  // leaves it on the control itself, and either way a dialog the user is still answering would hold
  // nothing. The panel carries the focus until the action settles, so Escape and Tab keep their place.
  useEffect(() => {
    if (!isBusy) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && panel.contains(active) && !active.matches(":disabled")) {
      return;
    }
    panel.focus();
  }, [isBusy, panelRef]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <OverlayFrame
      backdropClassName={BACKDROP_MODAL}
      describedBy={messageId}
      labelledBy={titleId}
      onKeyDown={handleKeyDown}
      panelClassName={composeClassName("sp-confirm", className)}
      panelRef={panelRef}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={messageId}>{message}</p>
      <div className="sp-confirm__actions">
        <Button onClick={onCancel} ref={cancelRef} variant="secondary">
          {cancelLabel}
        </Button>
        <Button
          isLoading={isBusy}
          onClick={onConfirm}
          ref={confirmRef}
          variant={isDestructive ? "danger" : "primary"}
        >
          {confirmLabel}
        </Button>
      </div>
    </OverlayFrame>,
    document.body,
  );
}
