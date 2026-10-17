/**
 * Path: src/components/ui/Card.tsx
 * Purpose: Card with its header, body and footer slots, and the badge every feature surface uses
 * Lines: 360
 */

import type { ComponentPropsWithoutRef, ElementType, ReactElement, ReactNode } from "react";

import { ORDER_STATUS_OPTIONS } from "@/constants/taxonomy";
import type { BadgeVariant } from "@/constants/taxonomy";
import type { OrderStatus } from "@/types/commerce";

/**
 * Joins the class names one of these components composes, leaving out every absent one.
 *
 * Each component below renders the class contract `src/styles/data-display.css` defines — `.sp-card`
 * with its selected, `--interactive` and `--flush` states and its four regions, and `.sp-badge` with its
 * variant, size and outline modifiers — and each accepts a `className` from its caller, so the join is
 * written once here instead of once in every render body.
 *
 * @param names - The classes in render order, each absent when the flag that adds it is off.
 * @returns The present classes joined by a single space, or an empty string when none is present.
 */
function composeClassName(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * Whether a slot holds something React paints, so a region given nothing is left out rather than painted
 * with its border and padding and nothing between them.
 *
 * `0` needs no special case and gets none: a zero is a value a card legitimately shows, while `false`,
 * `null`, `undefined` and the empty string all paint nothing.
 *
 * @param node - The slot's value.
 * @returns True when the slot should be rendered.
 */
function hasSlot(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/**
 * Everything {@link Card} accepts: the props of the element it renders, plus the card's own flags.
 */
export type CardProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  /**
   * The element the card renders as. A KPI tile is a `<section>`, a product tile an `<article>` and a
   * card that is one item of a list an `<li>`, so the semantics follow the content the caller puts in the
   * card rather than a container that is always a `<div>`.
   */
  readonly as?: "div" | "article" | "section" | "li";
  /** The card's content: a header, a body, a footer, or any combination of the three. */
  readonly children: ReactNode;
  /**
   * Marks a card whose whole surface is the target of one navigation or one action, which is the
   * interactive card variant of `src/styles/data-display.css`.
   *
   * It is emphasis and never a substitute for a control: the caller places the real `Link` or `Button`
   * inside the card, because a card carrying a click handler and no focusable element cannot be reached
   * from the keyboard.
   */
  readonly isInteractive?: boolean;
  /**
   * Removes the padding around what the card holds, for a card whose content manages its own spacing — a
   * table meeting the frame is the case the stylesheet names.
   */
  readonly isFlush?: boolean;
  /**
   * Marks the card as the one chosen among several.
   *
   * It is written to the `aria-selected` attribute the stylesheet selects on and is announced where the
   * card carries a role that supports selection — `option`, `row`, `gridcell`, `tab`, `columnheader` or
   * `rowheader` — so a card that is a real choice in a listbox or a grid passes that role as well.
   * Everywhere else the selected frame is the emphasis, the caller's own control carries the state and the
   * words beside the card name the choice, because no state of this product is left to colour alone.
   */
  readonly isSelected?: boolean;
};

/**
 * The surface every feature renders its panels on: a KPI tile, a product tile, the cart's summary, an
 * order's detail, a chart's frame or a report's table.
 *
 * It composes {@link CardHeader}, {@link CardBody}, {@link CardFooter} and, where a status or a quantity
 * needs one, {@link Badge}. It holds no state, runs no effect and formats no value: a money amount or a
 * date reaches it already formatted by the caller.
 *
 * @param props - The element to render as, the state flags and the element's own attributes.
 * @returns The card element with its regions inside it.
 */
export function Card({
  as = "div",
  children,
  className,
  isFlush = false,
  isInteractive = false,
  isSelected = false,
  ...rest
}: CardProps): ReactElement {
  // The four tags a card renders as take the same attribute surface this component accepts, so the
  // variable is narrowed to one of them for the spread to be checked against a single set of intrinsic
  // props: a union of four would ask it to satisfy each member's own event-handler generics, and React
  // receives the tag itself either way.
  const Element = as as "div";

  return (
    <Element
      {...rest}
      aria-selected={isSelected ? "true" : undefined}
      className={composeClassName(
        "sp-card",
        isInteractive && "sp-card--interactive",
        isFlush && "sp-card--flush",
        className,
      )}
    >
      {children}
    </Element>
  );
}

/** Everything {@link CardHeader} accepts. */
export interface CardHeaderProps {
  /** Content rendered after the title and its description — a summary line, an aside, a count. */
  readonly children?: ReactNode;
  /**
   * The card's title, rendered as a real heading element so it joins the document outline. Omit it for a
   * card whose region is already named by the heading above it.
   */
  readonly title?: ReactNode;
  /**
   * The supporting line under the title: a range, a unit, a sentence of context. Its wording comes from
   * `src/constants/content.ts` or from a builder there.
   */
  readonly description?: ReactNode;
  /** The card-level control on the trailing edge: a report frame's export action, a tile's range trigger. */
  readonly action?: ReactNode;
  /**
   * The heading level the title renders at, so a card nested inside a section keeps the outline in order
   * instead of skipping a level. The visual size is the card title's in either case, which is what lets
   * the level be chosen for structure alone.
   */
  readonly headingLevel?: 2 | 3 | 4;
  /** Extra classes for a layout the card's own frame does not cover. */
  readonly className?: string;
}

/**
 * The card's opening region: its title at the heading level the caller asks for, an optional supporting
 * line, optional extra content and an optional control on the trailing edge.
 *
 * Returns nothing when it is given nothing to render, so a card that opens straight into its body does
 * not carry an empty bordered band above it.
 *
 * @param props - The title, description, extra content, action and heading level.
 * @returns The header region, or `null` when every slot is empty.
 */
export function CardHeader({
  children,
  title,
  description,
  action,
  headingLevel = 3,
  className,
}: CardHeaderProps): ReactElement | null {
  const hasHeading = hasSlot(title) || hasSlot(description);

  if (!hasHeading && !hasSlot(children) && !hasSlot(action)) {
    return null;
  }

  const Heading: ElementType = `h${headingLevel}`;

  return (
    <header className={composeClassName("sp-card__header", className)}>
      {hasHeading ? (
        <div className="sp-card__heading">
          {hasSlot(title) ? <Heading className="sp-card__title">{title}</Heading> : null}
          {hasSlot(description) ? <p className="sp-card__description">{description}</p> : null}
        </div>
      ) : null}
      {hasSlot(children) ? children : null}
      {hasSlot(action) ? <div className="sp-card__action">{action}</div> : null}
    </header>
  );
}

/** Everything {@link CardBody} accepts. */
export interface CardBodyProps {
  /**
   * The card's content: a table, a chart, a form, a paragraph, a list, or a composition of them. The
   * spacing between those parts is the caller's, which is what the `isFlush` flag below exists for.
   */
  readonly children: ReactNode;
  /**
   * Removes the padding around the content, for a body that manages its own spacing on its own terms —
   * a body holding a table that should meet the card's frame.
   */
  readonly isFlush?: boolean;
  /** Extra classes for a layout the card's own body does not cover. */
  readonly className?: string;
}

/**
 * The card's content region: everything between the header and the footer.
 *
 * It renders whatever it is handed and nothing of its own, so the loading, empty and error states a
 * data-backed card shows are the ones `src/components/ui/Feedback.tsx` owns and the caller composes.
 *
 * @param props - The content and whether the region carries padding.
 * @returns The body region with its content inside it.
 */
export function CardBody({ children, isFlush = false, className }: CardBodyProps): ReactElement {
  return (
    <div
      className={composeClassName("sp-card__body", isFlush && "sp-card__body--flush", className)}
    >
      {children}
    </div>
  );
}

/** Everything {@link CardFooter} accepts. */
export interface CardFooterProps {
  /** The footer's content: the cart summary's actions, a report frame's export control, a caption. */
  readonly children: ReactNode;
  /**
   * Whether the footer carries the rule that separates it from the body. It defaults to on, because a
   * footer whose content sits directly under the body without a division reads as part of it.
   */
  readonly isDivided?: boolean;
  /** Extra classes for a layout the card's own footer does not cover. */
  readonly className?: string;
}

/**
 * The card's closing region, on the trailing edge of the frame.
 *
 * @param props - The content and whether the region carries its dividing rule.
 * @returns The footer region with its content inside it.
 */
export function CardFooter({
  children,
  isDivided = true,
  className,
}: CardFooterProps): ReactElement {
  return (
    <div
      className={composeClassName(
        "sp-card__footer",
        !isDivided && "sp-card__footer--undivided",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The two badge sizes: `md` matches a body line, `sm` suits a dense table cell or a chart legend.
 */
export type BadgeSize = "sm" | "md";

/** Everything {@link Badge} accepts. */
export interface BadgeProps {
  /**
   * The badge's text, and the reason the prop is required rather than optional: the words carry the
   * meaning and the variant only emphasises it. A badge distinguished by its colour alone is unreadable to
   * a colour-blind visitor and loses its meaning entirely in a greyscale rendering, so every badge in the
   * product states its state in words — the order status, the stock note, the saving.
   */
  readonly children: ReactNode;
  /**
   * Which variant emphasises the badge, from the vocabulary `src/constants/taxonomy.ts` declares. Typed
   * against that union rather than a list of this file's own, so a surface cannot name a variant the
   * stylesheet does not define.
   */
  readonly variant?: BadgeVariant;
  /**
   * Draws the variant's own ink on the surface behind the badge instead of on a tinted pill, for a badge
   * placed on a band where a tinted pill would not separate from what it sits on.
   */
  readonly isOutline?: boolean;
  /** The badge's size; `md` unless a dense row calls for `sm`. */
  readonly size?: BadgeSize;
  /** Extra classes for a placement the badge does not cover. */
  readonly className?: string;
}

/**
 * A short status or count rendered as a pill: an order's status, a stock warning, a saving.
 *
 * It is not interactive and never carries the meaning on its own — a badge shows what the surface beside
 * it already names, which is why its text is required rather than optional.
 *
 * @param props - The badge's text, variant, size and outline treatment.
 * @returns The badge pill with its text inside it.
 */
export function Badge({
  children,
  variant = "neutral",
  isOutline = false,
  size = "md",
  className,
}: BadgeProps): ReactElement {
  return (
    <span
      className={composeClassName(
        "sp-badge",
        `sp-badge--${variant}`,
        size === "sm" && "sp-badge--sm",
        isOutline && "sp-badge--outline",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Everything {@link OrderStatusBadge} accepts. */
export interface OrderStatusBadgeProps {
  /** The status to render, from `src/types/commerce.ts`. */
  readonly status: OrderStatus;
  /** The size of the badge it renders. */
  readonly size?: BadgeSize;
  /** Extra classes for a placement inside a table cell or a detail row. */
  readonly className?: string;
}

/**
 * An order's status as a badge: the one place a status becomes a pill, so the three surfaces that show one
 * — the account's order history with its status filter, the order detail's timeline, and the dashboard's
 * recent-orders table — render the same words in the same variant instead of each mapping statuses to
 * badges of its own.
 *
 * The lookup is `ORDER_STATUS_OPTIONS` from `src/constants/taxonomy.ts`, the single vocabulary that names
 * every status, and the label is rendered as the badge's text rather than implied by its colour.
 *
 * @param props - The status to render and the size of the badge.
 * @returns The status badge, or `null` when the vocabulary holds no record for the status.
 */
export function OrderStatusBadge({
  status,
  size,
  className,
}: OrderStatusBadgeProps): ReactElement | null {
  const option = ORDER_STATUS_OPTIONS.find((candidate) => candidate.value === status);

  if (!option) {
    return null;
  }

  return (
    <Badge className={className} size={size} variant={option.badgeVariant}>
      {option.label}
    </Badge>
  );
}
