/**
 * Path: tests/components/cardStates.test.tsx
 * Purpose: The card family's own contract: the header's empty and partial slots, the footer's dividing rule, the selection state each role writes, the flush and interactive variants, and the badge and status it renders
 * Lines: 273
 */

import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/Button";
import {
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  OrderStatusBadge,
} from "@/components/ui/Card";
import { BADGE_VARIANTS, ORDER_STATUS_OPTIONS } from "@/constants/taxonomy";

import { renderWithProviders, screen } from "../testUtils";

/*
 * The card family seen from the outside, through roles, accessible names, rendered text and the attributes a
 * selected card states its choice in. Four of its outcomes have neither a role nor words of their own to query
 * — a header given nothing paints nothing at all, and the flush, interactive, undivided and badge treatments
 * are carried by the classes the stylesheets select on — so those are read as the element and as the classes
 * the component's own docblock declares it renders, which is the contract they are.
 *
 * Each case reads its first post-render expectation through an awaited query, because the providers issue
 * requests when they mount and an assertion made before they settle is the state update React reports as
 * unexplained. The rule is stated in `tests/testUtils.tsx`.
 */

// Test data --------------------------------------------------------------------------------------

const CARD_TITLE = "Revenue this period";
const CARD_DESCRIPTION = "Last 30 days against the 30 before them";
const CARD_SUMMARY = "Six orders behind the previous period";
const CARD_BODY_TEXT = "Orders placed and units sold";
const CARD_LABEL = "Revenue tile";
const FLUSH_LABEL = "Detailed orders";
const PADDED_LABEL = "Recent orders";
const INTERACTIVE_LABEL = "Order SP-1042";
const FLUSH_BODY = "A table meets the frame";
const BODY_CLASS = "sp-report__rows";
const HEADER_ACTION = "Export this range";
const BADGE_CLASS = "sp-order__status";
const BADGE_LABEL = "Processing";
const STATUS_LABEL = "Shipped";
const EXTRA_CLASS = "sp-report__tile";
const DIVIDED_FOOTER = "Updated a minute ago";
const UNDIVIDED_FOOTER = "Export this range";
const FOOTER_CLASS = "sp-report__footnote";

/**
 * The attributes a selected card may state its choice in, with the role that decides between them: a role
 * ARIA allows `aria-selected` on states the selection there, and every other card states it globally.
 */
const SELECTION_CASES = [
  {
    attribute: "aria-selected",
    name: "a card that is one choice of a list",
    role: "option",
  },
  {
    attribute: "aria-current",
    name: "a card whose role cannot carry selection",
    role: "group",
  },
] as const;

// The card's regions -----------------------------------------------------------------------------

describe("the card's regions", () => {
  it("renders the parts of a header it is given", async () => {
    renderWithProviders(
      <Card>
        <CardHeader description={CARD_DESCRIPTION} title={CARD_TITLE}>
          <span>{CARD_SUMMARY}</span>
        </CardHeader>
        <CardBody>{CARD_BODY_TEXT}</CardBody>
      </Card>,
    );
    expect(await screen.findByRole("heading", { level: 3, name: CARD_TITLE })).toBeInTheDocument();
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText(CARD_SUMMARY)).toBeInTheDocument();
    expect(screen.getByText(CARD_BODY_TEXT)).toBeInTheDocument();
  });

  it("leaves out a header given nothing and still heads one given content alone", async () => {
    const { container } = renderWithProviders(
      <div>
        <Card>
          <CardHeader />
          <CardBody>{CARD_BODY_TEXT}</CardBody>
        </Card>
        <Card>
          <CardHeader>
            <span>{CARD_SUMMARY}</span>
          </CardHeader>
          <CardBody>{FLUSH_BODY}</CardBody>
        </Card>
      </div>,
    );
    expect(await screen.findByText(CARD_BODY_TEXT)).toBeInTheDocument();
    // One header for two cards: the empty one painted no region, so nothing stands above its body.
    expect(container.querySelectorAll("header")).toHaveLength(1);
    expect(container.querySelector("header")).toHaveTextContent(CARD_SUMMARY);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("separates a footer from the body by default and drops the rule on request", async () => {
    renderWithProviders(
      <Card>
        <CardBody>{CARD_BODY_TEXT}</CardBody>
        <CardFooter>{DIVIDED_FOOTER}</CardFooter>
        <CardFooter className={FOOTER_CLASS} isDivided={false}>
          {UNDIVIDED_FOOTER}
        </CardFooter>
      </Card>,
    );
    const divided = (await screen.findByText(DIVIDED_FOOTER)).closest<HTMLElement>(
      ".sp-card__footer",
    );
    const undivided = screen.getByText(UNDIVIDED_FOOTER).closest<HTMLElement>(".sp-card__footer");
    expect(divided).not.toBeNull();
    expect(divided).not.toHaveClass("sp-card__footer--undivided");
    expect(undivided).toHaveClass("sp-card__footer", "sp-card__footer--undivided", FOOTER_CLASS);
  });
});

// The card's selection state ---------------------------------------------------------------------

describe("the card's selection state", () => {
  it.each(SELECTION_CASES)(
    "states the selection of $name in $attribute",
    async ({ attribute, role }) => {
      renderWithProviders(
        <Card aria-label={CARD_LABEL} isSelected role={role}>
          {CARD_BODY_TEXT}
        </Card>,
      );
      const card = await screen.findByRole(role, { name: CARD_LABEL });
      expect(card).toHaveAttribute(attribute, "true");
      expect(card).toHaveTextContent(CARD_BODY_TEXT);
    },
  );

  it("states the selection of a card with no role of its own in the global attribute", async () => {
    const { container } = renderWithProviders(<Card isSelected>{CARD_BODY_TEXT}</Card>);
    expect(await screen.findByText(CARD_BODY_TEXT)).toBeInTheDocument();
    const card = container.querySelector("[aria-current]");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent(CARD_BODY_TEXT);
    expect(container.querySelector("[aria-selected]")).toBeNull();
  });

  it("leaves an unselected card with no selection state at all", async () => {
    const { container } = renderWithProviders(<Card>{CARD_BODY_TEXT}</Card>);
    expect(await screen.findByText(CARD_BODY_TEXT)).toBeInTheDocument();
    expect(container.querySelector("[aria-current], [aria-selected]")).toBeNull();
  });
});

// The card's variants ----------------------------------------------------------------------------

describe("the card's variants", () => {
  it("drops the frame's padding for a flush card and keeps the caller's own class", async () => {
    renderWithProviders(
      <div>
        <Card aria-label={FLUSH_LABEL} className={EXTRA_CLASS} isFlush role="group">
          {FLUSH_BODY}
        </Card>
        <Card aria-label={PADDED_LABEL} role="group">
          {CARD_BODY_TEXT}
        </Card>
      </div>,
    );
    const flush = await screen.findByRole("group", { name: FLUSH_LABEL });
    const padded = screen.getByRole("group", { name: PADDED_LABEL });
    expect(flush).toHaveClass("sp-card--flush", EXTRA_CLASS);
    expect(padded).not.toHaveClass("sp-card--flush");
  });

  it("marks the card whose whole surface is one action", async () => {
    renderWithProviders(
      <Card aria-label={INTERACTIVE_LABEL} isInteractive role="group">
        <CardBody>{FLUSH_BODY}</CardBody>
      </Card>,
    );
    const card = await screen.findByRole("group", { name: INTERACTIVE_LABEL });
    expect(card).toHaveClass("sp-card", "sp-card--interactive");
  });
});

// The card family's header and body at their edges ---------------------------------------------------

describe("the regions at their edges", () => {
  it("heads a card by whichever single slot it is given", async () => {
    renderWithProviders(
      <div>
        <Card>
          <CardHeader description={CARD_DESCRIPTION} />
          <CardBody>{CARD_BODY_TEXT}</CardBody>
        </Card>
        <Card>
          <CardHeader
            action={<Button onClick={() => undefined}>{HEADER_ACTION}</Button>}
            title={CARD_TITLE}
          />
          <CardBody>{FLUSH_BODY}</CardBody>
        </Card>
      </div>,
    );
    // A header given a description and nothing else opens the card without a heading, and one given a title
    // and an action renders both: one heading in the document is what says the other header painted none.
    expect(await screen.findByRole("heading", { name: CARD_TITLE })).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: HEADER_ACTION })).toBeEnabled();
  });

  it("removes the body's own padding for a region that manages its spacing", async () => {
    const { container } = renderWithProviders(
      <Card>
        <CardBody className={BODY_CLASS} isFlush>
          {FLUSH_BODY}
        </CardBody>
        <CardBody>{CARD_BODY_TEXT}</CardBody>
      </Card>,
    );
    expect(await screen.findByText(FLUSH_BODY)).toBeInTheDocument();
    const flushed = container.querySelector<HTMLElement>(".sp-card__body--flush");
    expect(flushed).toHaveClass("sp-card__body", "sp-card__body--flush", BODY_CLASS);
    expect(screen.getByText(CARD_BODY_TEXT)).not.toHaveClass("sp-card__body--flush");
  });
});

// The badge the card family renders -----------------------------------------------------------------

describe("the badge and the status it states", () => {
  it.each(BADGE_VARIANTS)("states the %s tint on the pill it renders", async (variant) => {
    renderWithProviders(<Badge variant={variant}>{BADGE_LABEL}</Badge>);
    const badge = await screen.findByText(BADGE_LABEL);
    expect(badge).toHaveClass("sp-badge", `sp-badge--${variant}`);
    // Every variant is a body-line pill unless a dense row asks for the small one or the outlined treatment.
    expect(badge).not.toHaveClass("sp-badge--sm", "sp-badge--outline");
  });

  it("draws the small outlined pill a dense row asks for, beside the caller's own class", async () => {
    renderWithProviders(
      <Badge className={BADGE_CLASS} isOutline size="sm" variant="success">
        {STATUS_LABEL}
      </Badge>,
    );
    const badge = await screen.findByText(STATUS_LABEL);
    expect(badge).toHaveClass(
      "sp-badge",
      "sp-badge--success",
      "sp-badge--sm",
      "sp-badge--outline",
      BADGE_CLASS,
    );
  });

  it.each(ORDER_STATUS_OPTIONS.map((option) => ({ label: option.label, status: option.value })))(
    "states $status as the vocabulary's own label",
    async ({ label, status }) => {
      renderWithProviders(<OrderStatusBadge status={status} />);
      expect(await screen.findByText(label)).toBeInTheDocument();
    },
  );
});
