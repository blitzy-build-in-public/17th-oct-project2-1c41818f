/**
 * Path: tests/components/selectStates.test.tsx
 * Purpose: The selection controls' own contract: the message a field resolves, grouped choices, the leading choice a select falls back to, the description a choice wires, the refs a checkbox hands over and the click a switch answers
 * Lines: 231
 */

import { createRef } from "react";
import type { ReactElement } from "react";

import { describe, expect, it, vi } from "vitest";

import { Checkbox, RadioGroup, Select, Switch } from "@/components/ui/Select";

import { renderWithProviders, screen, within } from "../testUtils";

/*
 * The selection family seen from the outside, through roles, accessible names, the messages rendered beside a
 * control, the ids a control describes itself by and the state a control reports. Every subject is mounted
 * through `renderWithProviders`, and each case reads its first post-render expectation through an awaited
 * query, because the providers issue requests when they mount. The rule is stated in `tests/testUtils.tsx`.
 */

// Test data --------------------------------------------------------------------------------------

const COUNTRY_LABEL = "Delivery country";
const REGION_LABEL = "Delivery region";
const CITY_LABEL = "Delivery city";
const COUNTRY_NAME = "country";
const REGION_NAME = "region";
const CITY_NAME = "city";
const MAP_MESSAGE = "Choose a country before continuing";
const OWN_MESSAGE = "This region is not served yet";
const OTHER_KEY = "postalCode";
const CHOICES = [
  { label: "United States", value: "us" },
  { label: "Canada", value: "ca" },
];
const REGION_GROUPS = [
  { label: "Americas", options: CHOICES },
  { label: "Europe", options: [{ label: "Ireland", value: "ie" }] },
];
const EMPTY_LABEL = "Delivery window";
const STOCK_LABEL = "In stock only";
const STOCK_DESCRIPTION = "Hides what is sold out";
const STOCK_HINT = "Applies to the whole result set";
const STOCK_ERROR = "This filter cannot be combined with the price range";
const SHIPPING_LABEL = "Free delivery only";
const SHIPPING_HINT = "Hides orders below the free-delivery threshold";
const ALERTS_LABEL = "Availability alerts";
const GUARDED_LABEL = "Notify me on restock";
const RATING_LEGEND = "Minimum rating";
const RATING_HINT = "Excludes products rated below it";
const RATING_ERROR = "Choose a rating between one and five";

/**
 * The two arrangements a group is declared with: the stacked one it defaults to, and the single line the
 * modifier class asks the stylesheet for.
 */
const ARRANGEMENTS = [
  { isHorizontal: false, label: "stacked", orientation: undefined },
  { isHorizontal: true, label: "in one line", orientation: "horizontal" },
] as const;

// The select and its field ------------------------------------------------------------------------

describe("the select field", () => {
  it("shows its own message, the one its form's map holds under its name, and neither when it has none", async () => {
    renderWithProviders(
      <div>
        <Select
          errors={{ [COUNTRY_NAME]: MAP_MESSAGE }}
          label={COUNTRY_LABEL}
          name={COUNTRY_NAME}
          options={CHOICES}
        />
        <Select
          error={OWN_MESSAGE}
          errors={{ [REGION_NAME]: MAP_MESSAGE }}
          label={REGION_LABEL}
          name={REGION_NAME}
          options={CHOICES}
        />
        <Select
          errors={{ [OTHER_KEY]: MAP_MESSAGE }}
          label={CITY_LABEL}
          name={CITY_NAME}
          options={CHOICES}
        />
      </div>,
    );
    const fromMap = await screen.findByRole("combobox", { name: COUNTRY_LABEL });
    expect(fromMap).toHaveAttribute("aria-invalid", "true");
    expect(fromMap.getAttribute("aria-describedby")).toBe(screen.getByText(MAP_MESSAGE).id);
    // The field's own message wins over the map's, which is therefore never rendered.
    const own = screen.getByRole("combobox", { name: REGION_LABEL });
    expect(own).toHaveAttribute("aria-invalid", "true");
    expect(own.getAttribute("aria-describedby")).toBe(screen.getByText(OWN_MESSAGE).id);
    const untouched = screen.getByRole("combobox", { name: CITY_LABEL });
    expect(untouched).toHaveAttribute("aria-invalid", "false");
    expect(untouched.getAttribute("aria-describedby")).toBeNull();
  });

  it("gathers its choices under the headings its groups name", async () => {
    renderWithProviders(
      <Select groups={REGION_GROUPS} label={REGION_LABEL} placeholder="Choose a region" />,
    );
    const control = await screen.findByRole("combobox", { name: REGION_LABEL });
    const americas = screen.getByRole("group", { name: "Americas" });
    expect(within(americas).getByRole("option", { name: "United States" })).toBeInTheDocument();
    expect(within(americas).getByRole("option", { name: "Canada" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Europe" })).getByRole("option", {
        name: "Ireland",
      }),
    ).toBeInTheDocument();
    expect(within(control).getByRole("option", { name: "Choose a region" })).toBeInTheDocument();
  });

  it("leads with the field's own label when it has no choices at all", async () => {
    renderWithProviders(<Select label={EMPTY_LABEL} />);
    const control = await screen.findByRole("combobox", { name: EMPTY_LABEL });
    expect(control).toHaveDisplayValue(EMPTY_LABEL);
    expect(within(control).getByRole("option", { name: EMPTY_LABEL })).toBeInTheDocument();
  });
});

// The choice ------------------------------------------------------------------------------------

describe("the checkbox and its own lines", () => {
  it("describes a choice by its description, its hint and its error, and marks it invalid", async () => {
    renderWithProviders(
      <Checkbox
        description={STOCK_DESCRIPTION}
        error={STOCK_ERROR}
        hint={STOCK_HINT}
        label={STOCK_LABEL}
      />,
    );
    const box = await screen.findByRole("checkbox", { name: STOCK_LABEL });
    const described = [STOCK_DESCRIPTION, STOCK_HINT, STOCK_ERROR].map(
      (text) => screen.getByText(text).id,
    );
    expect(box.getAttribute("aria-describedby")).toBe(described.join(" "));
    expect(box).toHaveAttribute("aria-invalid", "true");
  });

  it("hands the box to a callback ref and to an object ref, and gives it up on unmount", async () => {
    const callbackRef = vi.fn<(node: HTMLInputElement | null) => void>();
    const objectRef = createRef<HTMLInputElement>();
    const harness: ReactElement = (
      <div>
        <Checkbox label={STOCK_LABEL} ref={callbackRef} />
        <Checkbox label={SHIPPING_LABEL} ref={objectRef} />
      </div>
    );
    const { unmount } = renderWithProviders(harness);
    const byCallback = await screen.findByRole("checkbox", { name: STOCK_LABEL });
    const byObject = screen.getByRole("checkbox", { name: SHIPPING_LABEL });
    expect(callbackRef).toHaveBeenCalledWith(byCallback);
    expect(objectRef.current).toBe(byObject);
    unmount();
    expect(callbackRef).toHaveBeenLastCalledWith(null);
  });
});

// The group --------------------------------------------------------------------------------------

describe("the radio group", () => {
  it.each(ARRANGEMENTS)(
    "names a group laid out $label by its legend and describes every choice in it",
    async ({ isHorizontal, orientation }) => {
      renderWithProviders(
        <RadioGroup
          error={RATING_ERROR}
          hint={RATING_HINT}
          legend={RATING_LEGEND}
          name="rating"
          onChange={() => undefined}
          options={[
            { label: "Any rating", value: "any" },
            { label: "Four stars and up", value: "four" },
          ]}
          orientation={orientation}
          value="four"
        />,
      );
      const group = await screen.findByRole("group", { name: RATING_LEGEND });
      const described = [RATING_HINT, RATING_ERROR].map((text) => screen.getByText(text).id);
      for (const radio of within(group).getAllByRole("radio")) {
        expect(radio.getAttribute("aria-describedby")).toBe(described.join(" "));
        expect(radio).toHaveAttribute("aria-invalid", "true");
      }
      // The arrangement is the modifier the stylesheet selects the single line on; the stacked base is either way.
      expect(group).toHaveClass("sp-radio-group");
      if (isHorizontal) expect(group).toHaveClass("sp-radio-group--horizontal");
      else expect(group).not.toHaveClass("sp-radio-group--horizontal");
    },
  );
});

// The switch -------------------------------------------------------------------------------------

describe("the switch", () => {
  it("reports the state it would move to, holds it when the caller's own handler refuses, and reads its hint", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <Switch checked={false} label={ALERTS_LABEL} onChange={onChange} />
        <Switch checked={false} hint={SHIPPING_HINT} label={SHIPPING_LABEL} onChange={onChange} />
        <Switch
          checked={false}
          label={GUARDED_LABEL}
          onChange={onChange}
          onClick={(event) => event.preventDefault()}
        />
      </div>,
    );
    const plain = await screen.findByRole("switch", { name: ALERTS_LABEL });
    const withHint = screen.getByRole("switch", { name: SHIPPING_LABEL });
    expect(withHint.getAttribute("aria-describedby")).toBe(screen.getByText(SHIPPING_HINT).id);
    await user.click(plain);
    await user.click(withHint);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    const guarded = screen.getByRole("switch", { name: GUARDED_LABEL });
    await user.click(guarded);
    // The caller's handler ran first and cancelled the press, so the switch reported no new state.
    expect(guarded).toHaveAttribute("aria-checked", "false");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
