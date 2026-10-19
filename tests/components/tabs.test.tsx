/**
 * Path: tests/components/tabs.test.tsx
 * Purpose: The tab set and the disclosure stack driven through their own contract — the roving tabindex, the arrow and Home/End walks with wrapping for the tabs and without it for the disclosures, manual activation, the single mounted panel, the aria wiring, the heading level and the width reserve
 * Lines: 471
 */

import { describe, expect, it, vi } from "vitest";

import { Accordion, Tabs } from "@/components/ui/Tabs";
import type { AccordionItem, TabItem } from "@/components/ui/Tabs";

import { renderWithProviders, screen, within } from "../testUtils";

/*
 * The two members of the tabs-and-accordion family seen from the outside, through roles, accessible names,
 * ARIA state, the rendered text and where the keyboard focus is. No assertion reads a class name or a computed
 * style, and every subject is mounted through `renderWithProviders`.
 *
 * What the tab set owes its callers, and what is asserted below: the selected tab is the set's only tabbable
 * stop and carries `aria-controls` naming the panel it shows, the tabs that are not selected carry neither, the
 * selected tab's panel is the only one in the document and is named by its tab, an arrow key moves along the
 * set and wraps at either end while Home and End reach the first and last enabled tab, a disabled tab is
 * stepped over, `isManual` moves the focus without selecting until Enter or Space activates, a `value` naming
 * no enabled tab falls back to the first enabled one, and the words of a text or number label are handed to
 * the strip through `data-label` while composed markup hands over nothing.
 *
 * What the disclosure stack owes its callers: each disclosure is headed at the level the caller asks for by a
 * real button carrying `aria-expanded` and `aria-controls`, one disclosure at a time unless the caller allows
 * more, the ids given as already open are open before any interaction, a controlled stack changes nothing on
 * its own, the arrow keys walk and stop at the ends (never out of the stack) while Enter still activates the
 * button itself, and a panel is a named region only where its heading can name it.
 *
 * Each case reads its first post-render expectation through an awaited query, because the providers issue
 * requests when they mount and an update raised outside the testing library's `act` window is what React
 * reports as an act warning; the rule is stated in `tests/testUtils.tsx` and no case needs an `act` call of its
 * own. The one case that shapes element boxes does so on the elements themselves, because jsdom has no layout
 * engine: it is the only way the strip's scroll-into-view decision can be reached at all, and the file states
 * why where it does it.
 */

// Test data --------------------------------------------------------------------------------------

const SET_LABEL = "Product sections";
const OVERVIEW_TAB = "Overview";
const SPECS_TAB = "Specifications";
const REVIEWS_TAB = "Reviews";
const ARCHIVE_TAB = "Archive";

const OVERVIEW_PANEL = "What the box holds.";
const SPECS_PANEL = "Shade diameter 180 mm.";
const REVIEWS_PANEL = "No reviews yet.";
const ARCHIVE_PANEL = "Retired finishes.";
const COMPARE_CONTROL = "Compare models";

/** The number the first tab announces beside its label, and the number a tab is labelled by below. */
const COUNT_BADGE = 3;
const NUMBER_LABEL = 12;
const COMPOSED_LABEL = "Ratings and reviews";

const SHIPPING_HEADING = "Shipping";
const RETURNS_HEADING = "Returns";
const WARRANTY_HEADING = 2;
const TERMS_HEADING = "Terms";
const BLANK_HEADING = " ";
const SHIPPING_BODY = "Orders leave the warehouse within one working day.";
const RETURNS_BODY = "Unused goods return free within thirty days.";
const WARRANTY_BODY = "Two years against manufacturing faults.";
const TERMS_BODY = "Prices include sales tax.";
const BLANK_BODY = "Nothing to announce.";

/** Three tabs with one badge, so the label, the badge and the panel of each are distinguishable. */
const SECTION_TABS: readonly TabItem[] = [
  { badge: COUNT_BADGE, content: OVERVIEW_PANEL, id: "overview", label: OVERVIEW_TAB },
  { content: <p>{SPECS_PANEL}</p>, id: "specs", label: SPECS_TAB },
  { content: REVIEWS_PANEL, id: "reviews", label: REVIEWS_TAB },
];

/** A set whose first tab is unavailable, so a requested value has no enabled tab to name. */
const FALLBACK_TABS: readonly TabItem[] = [
  { content: OVERVIEW_PANEL, disabled: true, id: "unavailable", label: OVERVIEW_TAB },
  { content: SPECS_PANEL, id: "specs", label: SPECS_TAB },
];

/** A set with a disabled tab in the middle and another at the end, so the walk has to step over both. */
const WALK_TABS: readonly TabItem[] = [
  { content: OVERVIEW_PANEL, id: "overview", label: OVERVIEW_TAB },
  { content: SPECS_PANEL, disabled: true, id: "specs", label: SPECS_TAB },
  {
    content: (
      <>
        <p>{REVIEWS_PANEL}</p>
        <button type="button">{COMPARE_CONTROL}</button>
      </>
    ),
    id: "reviews",
    label: REVIEWS_TAB,
  },
  { content: ARCHIVE_PANEL, disabled: true, id: "archive", label: ARCHIVE_TAB },
];

/** One tab per label shape, which is what decides the words handed to the strip's width reserve. */
const LABEL_TABS: readonly TabItem[] = [
  { content: OVERVIEW_PANEL, id: "text", label: SPECS_TAB },
  { content: SPECS_PANEL, id: "number", label: NUMBER_LABEL },
  { content: REVIEWS_PANEL, id: "composed", label: <em>{COMPOSED_LABEL}</em> },
];

/** Every heading shape the disclosure stack accepts, with a disabled disclosure among them. */
const DISCLOSURES: readonly AccordionItem[] = [
  { content: SHIPPING_BODY, heading: SHIPPING_HEADING, id: "shipping" },
  { content: RETURNS_BODY, disabled: true, heading: RETURNS_HEADING, id: "returns" },
  { content: WARRANTY_BODY, heading: WARRANTY_HEADING, id: "warranty" },
  { content: BLANK_BODY, heading: BLANK_HEADING, id: "notes" },
  { content: TERMS_BODY, heading: <span>{TERMS_HEADING}</span>, id: "terms" },
];

// The tab set ------------------------------------------------------------------------------------

describe("the tab set", () => {
  it("keeps one tab stop on the selected tab and mounts only the panel it names", async () => {
    const { user } = renderWithProviders(<Tabs items={SECTION_TABS} label={SET_LABEL} />);
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    const [overview, specs, reviews] = within(list).getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");

    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(overview.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", overview.id);
    expect(panel).toHaveTextContent(OVERVIEW_PANEL);
    expect(overview).toHaveTextContent(String(COUNT_BADGE));
    expect(specs).toHaveAccessibleName(SPECS_TAB);

    for (const tab of [specs, reviews]) {
      expect(tab).toHaveAttribute("aria-selected", "false");
      expect(tab).toHaveAttribute("tabindex", "-1");
      expect(tab).not.toHaveAttribute("aria-controls");
    }
    expect(screen.queryByText(SPECS_PANEL)).toBeNull();
    expect(screen.queryByText(REVIEWS_PANEL)).toBeNull();

    await user.click(specs);

    expect(specs).toHaveAttribute("aria-selected", "true");
    expect(specs).toHaveAttribute("tabindex", "0");
    expect(overview).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText(SPECS_PANEL)).toBeVisible();
    expect(screen.queryByText(OVERVIEW_PANEL)).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", specs.id);
  });

  it("renders a set with no tabs as an empty named tablist and no panel", async () => {
    renderWithProviders(<Tabs items={[]} label={SET_LABEL} />);
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    expect(within(list).queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("selects nothing and mounts no panel when every tab is disabled", async () => {
    renderWithProviders(
      <Tabs items={SECTION_TABS.map((tab) => ({ ...tab, disabled: true }))} label={SET_LABEL} />,
    );
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    for (const tab of within(list).getAllByRole("tab")) {
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute("aria-selected", "false");
    }
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it.each(["unavailable", "a-tab-that-does-not-exist"])(
    "falls back to the first enabled tab when the value names %s",
    async (requested) => {
      renderWithProviders(<Tabs items={FALLBACK_TABS} label={SET_LABEL} value={requested} />);
      const list = await screen.findByRole("tablist", { name: SET_LABEL });
      const [unavailable, specs] = within(list).getAllByRole("tab");
      expect(unavailable).toBeDisabled();
      expect(specs).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText(SPECS_PANEL)).toBeVisible();
    },
  );

  it("keeps the caller's value in charge and reports the requests it does not apply", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <Tabs items={SECTION_TABS} label={SET_LABEL} onChange={onChange} value="overview" />,
    );
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    const [overview, specs] = within(list).getAllByRole("tab");
    await user.click(specs);
    expect(onChange).toHaveBeenLastCalledWith("specs");
    expect(specs).toHaveAttribute("aria-selected", "false");
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(OVERVIEW_PANEL)).toBeVisible();

    await user.click(overview);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("walks the set with the arrow keys and Home and End, stepping over a disabled tab", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <Tabs items={WALK_TABS} label={SET_LABEL} onChange={onChange} />,
    );
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    const tabs = within(list).getAllByRole("tab");

    await user.tab();
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(onChange).toHaveBeenLastCalledWith("reviews");

    // The panel takes no tab stop of its own: the next stop is the control the panel holds.
    await user.tab();
    expect(screen.getByRole("button", { name: COMPARE_CONTROL })).toHaveFocus();
    await user.tab({ shift: true });
    expect(tabs[2]).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(tabs[2]).toHaveFocus();

    await user.keyboard("{End}");
    expect(tabs[2]).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(3);
    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();

    await user.keyboard("a");
    expect(tabs[0]).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenLastCalledWith("overview");
  });

  it("moves only the focus while isManual is set, and activates on Enter or Space", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <Tabs isManual items={SECTION_TABS} label={SET_LABEL} onChange={onChange} />,
    );
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    const [overview, specs, reviews] = within(list).getAllByRole("tab");

    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(specs).toHaveFocus();
    expect(specs).toHaveAttribute("aria-selected", "false");
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(specs).toHaveAttribute("aria-selected", "true");
    expect(onChange).toHaveBeenLastCalledWith("specs");

    await user.keyboard("{ArrowRight}");
    await user.keyboard(" ");
    expect(reviews).toHaveAttribute("aria-selected", "true");
    expect(onChange).toHaveBeenLastCalledWith("reviews");
  });

  it("hands the strip the words of a text or number label and nothing for composed markup", async () => {
    renderWithProviders(<Tabs items={LABEL_TABS} label={SET_LABEL} />);
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    const [text, numbered, composed] = within(list).getAllByRole("tab");

    expect(within(text).getByText(SPECS_TAB)).toHaveAttribute("data-label", SPECS_TAB);
    expect(within(numbered).getByText(String(NUMBER_LABEL))).toHaveAttribute(
      "data-label",
      String(NUMBER_LABEL),
    );
    expect(composed).toHaveAccessibleName(COMPOSED_LABEL);
    expect(composed.querySelectorAll("[data-label]")).toHaveLength(0);
  });

  it("scrolls a tab the strip has only partly on screen fully inside it, and leaves the rest alone", async () => {
    const { user } = renderWithProviders(<Tabs items={SECTION_TABS} label={SET_LABEL} />);
    const list = await screen.findByRole("tablist", { name: SET_LABEL });
    const tabs = within(list).getAllByRole("tab");

    // jsdom has no layout engine, so every element reports both widths as 0 and every box as empty. The strip
    // is given a scroll range and the tabs are given edges of their own, which is the only way the handler's
    // two decisions — a tab already inside is left alone, a tab past an edge is scrolled the rest of the way
    // in — can be reached at all; `scrollIntoView` is absent from jsdom and is supplied per tab for the same
    // reason. What each case asserts is the call the browser would receive.
    const scrolls = tabs.map(() => vi.fn());
    tabs.forEach((tab, index) => {
      tab.scrollIntoView = scrolls[index];
    });

    // No scroll range: the focus is taken and nothing else happens.
    await user.tab();
    expect(tabs[0]).toHaveFocus();
    expect(scrolls[0]).not.toHaveBeenCalled();

    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 320 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 200 });
    list.getBoundingClientRect = () => boxOf(0, 200);
    tabs[0].getBoundingClientRect = () => boxOf(10, 70);
    tabs[1].getBoundingClientRect = () => boxOf(240, 300);
    tabs[2].getBoundingClientRect = () => boxOf(-120, -60);

    await user.keyboard("{ArrowLeft}");
    expect(tabs[2]).toHaveFocus();
    expect(scrolls[2]).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });

    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveFocus();
    expect(scrolls[0]).not.toHaveBeenCalled();

    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(scrolls[1]).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
});

// The disclosure stack ---------------------------------------------------------------------------

describe("the disclosure stack", () => {
  it.each([2, 3, 4] as const)(
    "heads every disclosure at level %i and discloses one panel at a time",
    async (level) => {
      const onToggle = vi.fn();
      const { user } = renderWithProviders(
        <Accordion headingLevel={level} items={DISCLOSURES} onToggle={onToggle} />,
      );
      expect(await screen.findAllByRole("heading", { level })).toHaveLength(DISCLOSURES.length);

      const shipping = screen.getByRole("button", { name: SHIPPING_HEADING });
      expect(shipping.closest("h2,h3,h4")).toBe(
        screen.getByRole("heading", { level, name: SHIPPING_HEADING }),
      );
      expect(shipping).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText(SHIPPING_BODY)).not.toBeVisible();

      // A heading of words, and one of a number, each name the panel they disclose; composed markup does not,
      // and neither does a heading of blanks, so those panels stay plain blocks.
      const shippingPanel = screen.getByText(SHIPPING_BODY);
      expect(shippingPanel.getAttribute("aria-labelledby")).toBe(shipping.id);
      expect(shippingPanel).toHaveAttribute("role", "region");
      expect(screen.getByText(WARRANTY_BODY)).toHaveAttribute("role", "region");
      for (const unnamed of [TERMS_BODY, BLANK_BODY]) {
        expect(screen.getByText(unnamed)).not.toHaveAttribute("role");
        expect(screen.getByText(unnamed)).not.toHaveAttribute("aria-labelledby");
      }

      await user.click(shipping);
      expect(shipping).toHaveAttribute("aria-expanded", "true");
      expect(shippingPanel).toBeVisible();
      expect(screen.getByRole("region", { name: SHIPPING_HEADING })).toHaveTextContent(
        SHIPPING_BODY,
      );
      expect(onToggle).toHaveBeenLastCalledWith("shipping", true);

      // Opening another closes the one that was open, because one at a time is the default.
      const warranty = screen.getByRole("button", { name: String(WARRANTY_HEADING) });
      await user.click(warranty);
      expect(warranty).toHaveAttribute("aria-expanded", "true");
      expect(shipping).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText(WARRANTY_BODY)).toBeVisible();
      expect(screen.getByRole("region", { name: String(WARRANTY_HEADING) })).toHaveTextContent(
        WARRANTY_BODY,
      );
      expect(onToggle).toHaveBeenLastCalledWith("warranty", true);

      // A disabled disclosure cannot be opened, and reports nothing.
      const returns = screen.getByRole("button", { name: RETURNS_HEADING });
      expect(returns).toBeDisabled();
      await user.click(returns);
      expect(returns).toHaveAttribute("aria-expanded", "false");
      expect(onToggle).not.toHaveBeenCalledWith("returns", true);

      await user.click(warranty);
      expect(warranty).toHaveAttribute("aria-expanded", "false");
      expect(onToggle).toHaveBeenLastCalledWith("warranty", false);
    },
  );

  it("leaves the others open when the caller allows more than one", async () => {
    const { user } = renderWithProviders(<Accordion allowMultiple items={DISCLOSURES} />);
    const shipping = await screen.findByRole("button", { name: SHIPPING_HEADING });
    const warranty = screen.getByRole("button", { name: String(WARRANTY_HEADING) });

    await user.click(shipping);
    await user.click(warranty);
    expect(shipping).toHaveAttribute("aria-expanded", "true");
    expect(warranty).toHaveAttribute("aria-expanded", "true");

    await user.click(shipping);
    expect(shipping).toHaveAttribute("aria-expanded", "false");
    expect(warranty).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(WARRANTY_BODY)).toBeVisible();
  });

  it("opens the disclosures the caller names as already open", async () => {
    renderWithProviders(<Accordion defaultOpenIds={["shipping"]} items={DISCLOSURES} />);
    const shipping = await screen.findByRole("button", { name: SHIPPING_HEADING });
    expect(shipping).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(SHIPPING_BODY)).toBeVisible();
    expect(screen.getByRole("button", { name: String(WARRANTY_HEADING) })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("changes nothing on its own when the caller owns the open state", async () => {
    const onToggle = vi.fn();
    const { user } = renderWithProviders(
      <Accordion items={DISCLOSURES} onToggle={onToggle} openIds={["shipping"]} />,
    );
    const shipping = await screen.findByRole("button", { name: SHIPPING_HEADING });
    expect(shipping).toHaveAttribute("aria-expanded", "true");

    await user.click(shipping);
    expect(onToggle).toHaveBeenLastCalledWith("shipping", false);
    expect(shipping).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(SHIPPING_BODY)).toBeVisible();

    const warranty = screen.getByRole("button", { name: String(WARRANTY_HEADING) });
    await user.click(warranty);
    expect(onToggle).toHaveBeenLastCalledWith("warranty", true);
    expect(warranty).toHaveAttribute("aria-expanded", "false");
  });

  it("walks the disclosures with the arrow keys and stops at the ends", async () => {
    const { user } = renderWithProviders(<Accordion items={DISCLOSURES} />);
    const shipping = await screen.findByRole("button", { name: SHIPPING_HEADING });
    const warranty = screen.getByRole("button", { name: String(WARRANTY_HEADING) });
    const terms = screen.getByRole("button", { name: TERMS_HEADING });

    await user.tab();
    expect(shipping).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(shipping).not.toHaveFocus();
    expect(warranty).toHaveFocus();
    expect(warranty).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowDown}");
    expect(terms).not.toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(terms).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(terms).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(terms).not.toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(warranty).toHaveFocus();

    await user.keyboard("{Home}");
    expect(shipping).toHaveFocus();
    await user.keyboard("{End}");
    expect(terms).toHaveFocus();

    await user.keyboard("a");
    expect(terms).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(terms).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(TERMS_BODY)).toBeVisible();
  });
});

/** The box jsdom's layout-free engine never produces: one element's edges against the strip's own. */
function boxOf(left: number, right: number): DOMRect {
  const box = { bottom: 0, height: 0, left, right, top: 0, width: right - left, x: left, y: 0 };
  return { ...box, toJSON: () => box } as unknown as DOMRect;
}
