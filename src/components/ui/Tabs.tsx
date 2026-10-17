/**
 * Path: src/components/ui/Tabs.tsx
 * Purpose: Tabs with roving focus, and the accordion used for disclosure sections
 * Lines: 513
 */

import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";

/*
 * Class contract. `src/styles/tabs-accordion.css` is the sole definition site of this family — it is the
 * sheet `src/styles/data-display.css` loads with `@import "./tabs-accordion.css";`, and `data-display.css`
 * is in turn the sheet `src/styles/components.css` loads with `@import "./data-display.css";`. No file under
 * `src/components/**` may import a stylesheet, because `src/main.tsx` is the only importer of
 * `src/styles/**`. Every class below is therefore consumed by name, and this comment is the list that
 * sheet owes the file: `sp-tabs` for the set, `sp-tabs__list` for the strip that scrolls sideways at a
 * small width, `sp-tabs__tab` for one tab, `sp-tabs__panel` for the region showing the selected tab's
 * content, and `sp-accordion`, `sp-accordion__item`, `sp-accordion__trigger` and `sp-accordion__panel`
 * for the disclosure family. State is carried by the attribute and never by a second class: the sheet
 * paints the selected tab through `[aria-selected="true"]` and the open disclosure through
 * `[aria-expanded="true"]`, so the attributes written below are what make the state visible as well as
 * announced, and a class-only implementation would render an unstyled selection.
 *
 * Neither family renders a member of `src/components/ui/Button.tsx`. The sheet carries the whole visual
 * contract of a tab and of a disclosure trigger — the indicator border, the padding, the type role and
 * the caret are declared on `.sp-tabs__tab` and on `.sp-accordion__trigger` — so both elements are the
 * plain `<button>` those rules own, and the button family's own base rule, which is written for a
 * standalone control, would compete with the rule that owns the element.
 *
 * Three decisions a later reader must not undo:
 *   - Roving tabindex. The selected tab is the set's single tabbable element (`tabIndex={0}`) and every
 *     other tab leaves the tab order (`tabIndex={-1}`), which is what makes a tab set one stop in the
 *     page's tab order instead of one stop per tab, and what the arrow keys then move within.
 *   - Only the selected tab's panel is rendered. A panel that fetches or aggregates must not mount while
 *     another tab is selected, so the inactive panels are absent from the document rather than hidden by
 *     a class, and the `hidden` attribute is not needed for them. A caller that genuinely needs an
 *     inactive panel's content in the document places that content outside the set.
 *   - `isManual` selects between the two activation modes WAI-ARIA describes. By default an arrow key
 *     moves focus and activates in the same keystroke, because a tab of this product is cheap to show; in
 *     manual mode it moves focus only and Enter or Space activates, for a set whose panels are costly to
 *     mount. Both modes are supplied because the difference is a property of the panel, not of the tab.
 *
 * No string reaches the page from this file: every label, heading and badge arrives from its caller, from
 * `src/constants/content.ts` or `src/constants/taxonomy.ts`.
 */

/** The one property the keyboard walk reads, which both item shapes carry. */
interface DisableableItem {
  /** Whether a disabled item is left out of the walk and never becomes the selected or focused one. */
  readonly disabled?: boolean;
}

/** The four element roles the two components derive their ids for. */
type ItemIdRole = "tab" | "panel" | "trigger" | "region";

/**
 * The heading element each supported outline level renders.
 *
 * The level is read from one table rather than branched on, so a caller's `headingLevel` decides the
 * element the same way at every call site, and the literal names keep the tag resolvable by JSX.
 */
const HEADING_ELEMENTS = { 2: "h2", 3: "h3", 4: "h4" } as const;

/**
 * Builds the element id one tab, panel, trigger or region carries.
 *
 * Both components derive their whole aria wiring from a single `useId` base, so the ids a set of tabs or
 * a stack of disclosures needs are composed here once instead of being derived twice, and two sets on one
 * page cannot collide because React's base is unique per component instance. An item id is normalised to
 * the characters an id may hold, so a caller's `report.sales` still names a valid element; an id that
 * differs from another only in those characters would collide, which is why callers pass ids that are
 * already distinct words.
 *
 * @param baseId - The `useId` value of the component rendering the item.
 * @param role - Which of the four elements the id belongs to.
 * @param itemId - The item's own id, as the caller wrote it.
 * @returns The id to place on the element and to reference from its neighbour's aria attribute.
 */
function itemElementId(baseId: string, role: ItemIdRole, itemId: string): string {
  return `${baseId}-${role}-${itemId.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

/**
 * Walks a tab set or a disclosure stack from a starting index and returns the index of the first enabled
 * item in the given direction.
 *
 * The walk is written once because both components apply the same rule — a disabled item is stepped over
 * rather than focused — and only its wrapping differs: an arrow key in a tab strip continues from the
 * other end, which is what WAI-ARIA asks of a tablist, while an arrow key in a disclosure stack stops at
 * the end it reached, so that the key cannot move focus out of the stack it was pressed in.
 *
 * @param items - The items, in render order.
 * @param start - The index to walk from. It may sit outside the list, which asks for the first enabled
 *   item (`-1` with step `1`) or the last one (`items.length` with step `-1`), as Home and End do.
 * @param step - The direction: `1` towards the last item, `-1` towards the first.
 * @param isWrapping - Whether walking past an end continues from the other end.
 * @returns The index of the first enabled item the walk reaches, or `-1` when every item is disabled or
 *   the list is empty.
 */
function findEnabledIndex<T extends DisableableItem>(
  items: readonly T[],
  start: number,
  step: 1 | -1,
  isWrapping: boolean,
): number {
  const count = items.length;
  if (count === 0) return -1;

  let index = start;
  for (let visited = 0; visited < count; visited += 1) {
    index += step;
    if (index < 0 || index >= count) {
      if (!isWrapping) return -1;
      index = index < 0 ? count - 1 : 0;
    }
    if (items[index].disabled !== true) return index;
  }
  return -1;
}

/**
 * Joins the classes one of these components composes, leaving out every absent one.
 *
 * The join is written here, in the file that composes the classes, for the reason the two sibling
 * primitive files state over their own copies: no module under `src/utils` owns class composition, and
 * the three files that compose a caller's `className` with their own are the only places the rule is
 * applied. It is three lines of joining and no rule beyond it.
 *
 * @param names - The class names in cascade order, each of which may be absent.
 * @returns The present names joined by a single space, or an empty string when none is present.
 */
function composeClassName(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * Whether a disclosure heading carries the text that would name its panel.
 *
 * A region that computes an empty accessible name is worse than no region at all: it appears in a screen
 * reader's landmark list as an unnamed entry. Only a heading rendered from text or from a number can name
 * the panel it discloses, so only then does the panel take `role="region"`; a caller whose heading is
 * composed markup passes the words as text if it wants that landmark.
 *
 * @param heading - The item's heading node.
 * @returns True when the heading itself names the panel.
 */
function hasHeadingText(heading: ReactNode): boolean {
  if (typeof heading === "string") return heading.trim().length > 0;
  return typeof heading === "number";
}

/** One tab of a {@link Tabs} set: the control's label, the panel it shows, and its optional decoration. */
export interface TabItem {
  /**
   * Identifies the tab. Selection, `onChange` and a caller's own URL state are all expressed in this
   * value rather than in an index, so a reordered item keeps the selection it had.
   */
  readonly id: string;
  /**
   * The tab's visible label, which is also the control's accessible name. It comes from the caller — the
   * product detail page passes the section names of `src/constants/content.ts` and the reports page the
   * report names of `src/constants/taxonomy.ts` — because this file writes no sentence.
   */
  readonly label: ReactNode;
  /**
   * The content shown while this tab is selected. It is mounted only then, which is the whole reason the
   * inactive panels are absent from the document rather than hidden.
   */
  readonly content: ReactNode;
  /** Renders the tab visible but genuinely disabled, and skipped by the arrow keys. */
  readonly disabled?: boolean;
  /**
   * Decoration drawn after the label inside the tab's own box — a result count, a status. Its text joins
   * the tab's accessible name, which is what makes a count announced with the tab it belongs to.
   */
  readonly badge?: ReactNode;
  /** Extra classes for this tab's panel, for a panel that needs a layout of its own. */
  readonly panelClassName?: string;
}

/** Everything {@link Tabs} accepts. */
export interface TabsProps {
  /** The tabs, in render order. The first enabled one is selected when the selection names none. */
  readonly items: readonly TabItem[];
  /**
   * The selected tab's id, which makes the set controlled: the value shown is the one given here, and
   * `onChange` is then the caller's only way to move the selection. A value naming no item — a stale
   * query parameter, for instance — falls back to the first enabled tab rather than blanking the set.
   */
  readonly value?: string;
  /** The id selected before any interaction, for an uncontrolled set. */
  readonly defaultValue?: string;
  /**
   * Called with the id of a tab the user has just activated, and never with the id of the tab that was
   * already selected, so a caller that writes the selection to the URL is not asked to rewrite a value
   * the URL already holds. It is the only output this component produces.
   */
  readonly onChange?: (id: string) => void;
  /** Names the set for assistive technology, as the `tablist`'s accessible name. */
  readonly label: string;
  /**
   * Moves focus without selecting when an arrow key is pressed, so Enter or Space is what activates.
   * Defaults to `false`, in which case an arrow key focuses and activates in one keystroke.
   */
  readonly isManual?: boolean;
  /** Extra classes for the set's own element, for the layout the caller places it in. */
  readonly className?: string;
  /** Extra classes for every panel, applied before {@link TabItem.panelClassName}. */
  readonly panelClassName?: string;
}

/**
 * A set of tabs whose panels share one region of the page.
 *
 * The set is the `tablist`; each tab is a `role="tab"` button that carries `aria-selected` and an id; the
 * selected tab also carries `aria-controls` naming the panel it shows, and the tabs that are not selected
 * carry it not at all, because only the selected tab's panel is in the document and a reference to a panel
 * that is not mounted is an ARIA authoring error. Each panel is a `role="tabpanel"` labelled by its tab
 * and focusable, so a keyboard user can reach the content it reveals, and the selection is derived during
 * render from `value` or from the set's own state — never mirrored into state and never synchronised by an
 * effect.
 *
 * The keyboard model is the one WAI-ARIA describes for tabs: Tab enters the set at the selected tab (its
 * roving `tabIndex` is `0`), ArrowRight and ArrowLeft move along the set and wrap at either end, Home and
 * End reach the first and last enabled tab, and the arrow keys skip a disabled tab rather than landing on
 * one that cannot be activated. Tab then leaves the set and reaches the panel.
 *
 * @param props - The items, the optional controlled value, the change handler, the set's accessible name,
 *   the activation mode and the two class hooks.
 * @returns The set, its tab list and the selected tab's panel.
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  label,
  isManual = false,
  className,
  panelClassName,
}: TabsProps): ReactElement {
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(defaultValue);

  const requestedId = value ?? uncontrolledValue;
  const requestedIndex = items.findIndex(
    (item) => item.id === requestedId && item.disabled !== true,
  );
  const selectedIndex =
    requestedIndex >= 0 ? requestedIndex : findEnabledIndex(items, -1, 1, false);
  const selectedItem = selectedIndex < 0 ? undefined : items[selectedIndex];

  const activate = (id: string): void => {
    if (id === selectedItem?.id) return;
    if (value === undefined) setUncontrolledValue(id);
    onChange?.(id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const key = event.key;
    let nextIndex = -1;

    if (key === "ArrowRight" || key === "ArrowLeft") {
      nextIndex = findEnabledIndex(items, index, key === "ArrowRight" ? 1 : -1, true);
    } else if (key === "Home") {
      nextIndex = findEnabledIndex(items, -1, 1, false);
    } else if (key === "End") {
      nextIndex = findEnabledIndex(items, items.length, -1, false);
    } else {
      return;
    }

    // Both keys would otherwise scroll the strip itself, which it can, because the tab list scrolls
    // sideways at a small width. The move is a move within the set, so the page must not move with it.
    event.preventDefault();
    if (nextIndex < 0) return;

    tabRefs.current[nextIndex]?.focus();
    if (isManual) return;

    const nextItem = items[nextIndex];
    if (nextItem !== undefined) activate(nextItem.id);
  };

  const selectedTabId =
    selectedItem === undefined ? undefined : itemElementId(baseId, "tab", selectedItem.id);
  const selectedPanelId =
    selectedItem === undefined ? undefined : itemElementId(baseId, "panel", selectedItem.id);

  return (
    <div className={composeClassName("sp-tabs", className)}>
      <div className="sp-tabs__list" role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const tabId = itemElementId(baseId, "tab", item.id);
          const panelId = itemElementId(baseId, "panel", item.id);

          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId}
              className="sp-tabs__tab"
              aria-selected={isSelected}
              aria-controls={isSelected ? panelId : undefined}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled === true}
              onClick={() => {
                activate(item.id);
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
            >
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
      {selectedItem === undefined ||
      selectedPanelId === undefined ||
      selectedTabId === undefined ? null : (
        <div
          id={selectedPanelId}
          role="tabpanel"
          aria-labelledby={selectedTabId}
          tabIndex={0}
          className={composeClassName(
            "sp-tabs__panel",
            panelClassName,
            selectedItem.panelClassName,
          )}
        >
          {selectedItem.content}
        </div>
      )}
    </div>
  );
}

/** One disclosure of an {@link Accordion}: what it is headed by, and what it reveals. */
export interface AccordionItem {
  /** Identifies the disclosure, and the value open state is expressed in. */
  readonly id: string;
  /**
   * The heading the disclosure is announced under. Rendered inside the heading element and inside the
   * trigger button, so the words both describe the section and name the control that opens it.
   */
  readonly heading: ReactNode;
  /** The content revealed while the disclosure is open. It stays in the document while collapsed. */
  readonly content: ReactNode;
  /** Renders the disclosure visible but genuinely disabled and skipped by the arrow keys. */
  readonly disabled?: boolean;
}

/** Everything {@link Accordion} accepts. */
export interface AccordionProps {
  /** The disclosures, in render order. */
  readonly items: readonly AccordionItem[];
  /**
   * Whether more than one disclosure may be open at once. Defaults to `false`, in which case opening one
   * closes the rest, which is the behaviour a set of sections describing one subject wants.
   */
  readonly allowMultiple?: boolean;
  /** The ids open before any interaction, for an uncontrolled accordion. */
  readonly defaultOpenIds?: readonly string[];
  /**
   * The open ids, which makes the accordion controlled: the panels shown are the ones named here and
   * `onToggle` is then the caller's only way to change them. An id naming no item is ignored.
   */
  readonly openIds?: readonly string[];
  /**
   * Called when a disclosure is toggled, with the id and the state it moved to. It is called for a
   * controlled accordion and an uncontrolled one alike, so a caller may observe a set it does not drive.
   */
  readonly onToggle?: (id: string, isOpen: boolean) => void;
  /**
   * The heading level each disclosure's heading element is rendered at, so the stack takes the level its
   * section of the document outline needs. Defaults to `3`, a level below the page's own title and the
   * heading of the region the stack sits in.
   */
  readonly headingLevel?: 2 | 3 | 4;
  /** Extra classes for the stack's own element, for the layout the caller places it in. */
  readonly className?: string;
}

/**
 * A stack of disclosures, each headed by a control that opens and closes it.
 *
 * Every heading is a real heading element — the level comes from `headingLevel`, so the disclosure keeps
 * its place in the document outline — and it holds a real button carrying `aria-expanded`, an id and
 * `aria-controls`. The button is activated by pointer, by Enter and by Space, because it is a button; the
 * arrow keys additionally walk from one disclosure to the next and Home and End reach the ends, which is
 * a convenience over the pattern's requirement and never a replacement for the button's own activation.
 * Each panel is `hidden` while collapsed, and it takes `role="region"` only where its heading can name it,
 * because a landmark with an empty name is a defect rather than a help.
 *
 * Open state is derived during render from `openIds` or from the stack's own state, and a disabled
 * disclosure can neither be opened nor be reached by the arrow keys. Unlike a tab panel, a collapsed
 * disclosure's content stays mounted behind `hidden`, which is what lets a caller keep the state of a form
 * inside one; a caller whose collapsed content must not mount at all should not render it in this stack.
 *
 * @param props - The disclosures, the multiple-open and controlled-state options, the toggle handler, the
 *   heading level and the class hook.
 * @returns The stack of disclosure headings and their panels.
 */
export function Accordion({
  items,
  allowMultiple = false,
  defaultOpenIds,
  openIds,
  onToggle,
  headingLevel = 3,
  className,
}: AccordionProps): ReactElement {
  const baseId = useId();
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [uncontrolledOpenIds, setUncontrolledOpenIds] = useState<readonly string[]>(
    () => defaultOpenIds ?? [],
  );

  const requestedOpenIds = openIds ?? uncontrolledOpenIds;
  const Heading = HEADING_ELEMENTS[headingLevel];

  const toggle = (item: AccordionItem, isOpen: boolean): void => {
    if (openIds === undefined) {
      if (!allowMultiple) {
        // Only one disclosure may be open: opening one replaces the set, closing one empties it.
        setUncontrolledOpenIds(isOpen ? [] : [item.id]);
      } else if (isOpen) {
        // Closing one of several: the id leaves the set and every other open disclosure stays open.
        setUncontrolledOpenIds(requestedOpenIds.filter((id) => id !== item.id));
      } else {
        setUncontrolledOpenIds([...requestedOpenIds, item.id]);
      }
    }

    onToggle?.(item.id, !isOpen);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const key = event.key;
    let nextIndex = -1;

    if (key === "ArrowDown") {
      nextIndex = findEnabledIndex(items, index, 1, false);
    } else if (key === "ArrowUp") {
      nextIndex = findEnabledIndex(items, index, -1, false);
    } else if (key === "Home") {
      nextIndex = findEnabledIndex(items, -1, 1, false);
    } else if (key === "End") {
      nextIndex = findEnabledIndex(items, items.length, -1, false);
    } else {
      return;
    }

    if (nextIndex < 0) return;
    event.preventDefault();
    triggerRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={composeClassName("sp-accordion", className)}>
      {items.map((item, index) => {
        const isOpen = item.disabled !== true && requestedOpenIds.includes(item.id);
        const triggerId = itemElementId(baseId, "trigger", item.id);
        const regionId = itemElementId(baseId, "region", item.id);
        const isNamedRegion = hasHeadingText(item.heading);

        return (
          <div key={item.id} className="sp-accordion__item">
            <Heading>
              <button
                ref={(element) => {
                  triggerRefs.current[index] = element;
                }}
                type="button"
                id={triggerId}
                className="sp-accordion__trigger"
                aria-expanded={isOpen}
                aria-controls={regionId}
                disabled={item.disabled === true}
                onClick={() => {
                  toggle(item, isOpen);
                }}
                onKeyDown={(event) => {
                  handleTriggerKeyDown(event, index);
                }}
              >
                {item.heading}
              </button>
            </Heading>
            <div
              id={regionId}
              className="sp-accordion__panel"
              role={isNamedRegion ? "region" : undefined}
              aria-labelledby={isNamedRegion ? triggerId : undefined}
              hidden={!isOpen}
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
