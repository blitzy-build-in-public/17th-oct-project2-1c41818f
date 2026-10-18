/**
 * Path: tests/components/controls.test.tsx
 * Purpose: Button, field and select behaviour, including keyboard and focus handling; the overlay, tooltip and toast half of the suite is in tests/components/overlays.test.tsx
 * Lines: 276
 */

import { useState } from "react";
import type { ReactElement } from "react";

import { describe, expect, it, vi } from "vitest";

import {
  Button,
  ButtonGroup,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  IconButton,
} from "@/components/ui/Button";
import { Input, TextArea } from "@/components/ui/Input";
import { Checkbox, RadioGroup, Select, Switch } from "@/components/ui/Select";
import {
  CATALOG_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
} from "@/constants/content";

import { makeFieldErrors } from "../fixtures";
import { renderWithProviders, screen, within } from "../testUtils";

/*
 * The shared controls seen from the outside — the button family, the field family and the selection controls —
 * through roles, accessible names, ARIA state, rendered text and where the keyboard focus is. No assertion
 * touches a class name or a computed style, so none needs a stylesheet, and every subject is mounted through
 * `renderWithProviders`. The three overlays, the tooltip and the toast viewport are the other half of this
 * suite and live in `tests/components/overlays.test.tsx`, which declares the document root, the media-query
 * shim and the harnesses its own subjects need; all five families together were over the request's 600-line
 * ceiling, which is why the two files are the §0.5.5 split of the one suite.
 *
 * Each case reads its first post-render expectation through an awaited query, and moves a fake clock inside an
 * awaited query rather than between two of them, because the providers issue requests when they mount: an
 * update raised outside the testing library's `act` window is what React reports as an act warning. The rule,
 * and why the awaited query is what keeps such a settle inside that window, is stated in
 * `tests/testUtils.tsx`; no case needs an `act` call of its own.
 */

// Test data --------------------------------------------------------------------------------------

const EMAIL_LABEL = "Email address";
const NOTES_LABEL = "Delivery notes";
const NOTES_MAX_LENGTH = 80;
const TYPED_NOTE = "Leave at the door";
const PROMO_LABEL = "Promo code";
const HINT_TEXT = "Letters and numbers only";
const SORT_LABEL = "Sort order";
const STOCK_LABEL = "In stock only";
const ALERTS_LABEL = "Availability alerts";
const NOTIFY_LABEL = "Notify me";

// Harness components, mounted inside the real providers ------------------------------------------

/** A field whose message is the caller's to withdraw, so the wiring is proved derived, not latched. */
function ClearableErrorField(): ReactElement {
  const [hasError, setHasError] = useState(true);
  return (
    <div>
      <Button onClick={() => setHasError(false)}>{COMMON_ACTIONS.CLEAR}</Button>
      <Input
        errors={hasError ? makeFieldErrors({ email: VALIDATION_MESSAGES.EMAIL_FORMAT }) : undefined}
        label={EMAIL_LABEL}
        name="email"
      />
    </div>
  );
}

// The button family ------------------------------------------------------------------------------

describe("the button family", () => {
  it("renders every declared variant and size as an enabled, named button", async () => {
    renderWithProviders(
      <div>
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} onClick={() => undefined} variant={variant}>
            {`${variant} action`}
          </Button>
        ))}
        {BUTTON_SIZES.map((size) => (
          <Button key={size} onClick={() => undefined} size={size}>
            {`${size} action`}
          </Button>
        ))}
      </div>,
    );
    for (const name of [...BUTTON_VARIANTS, ...BUTTON_SIZES]) {
      expect(await screen.findByRole("button", { name: `${name} action` })).toBeEnabled();
    }
  });

  it("announces a control in flight and activates neither it nor a disabled one", async () => {
    const onLoading = vi.fn();
    const onDisabled = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <Button isLoading onClick={onLoading}>
          {CATALOG_COPY.ADD_TO_CART_LABEL}
        </Button>
        <Button disabled onClick={onDisabled}>
          {COMMON_ACTIONS.APPLY}
        </Button>
      </div>,
    );
    const loading = screen.getByRole("button", { name: CATALOG_COPY.ADD_TO_CART_LABEL });
    const disabled = screen.getByRole("button", { name: COMMON_ACTIONS.APPLY });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toBeDisabled();
    expect(within(loading).getByText(FEEDBACK_COPY.LOADING)).toBeInTheDocument();
    expect(disabled).toBeDisabled();
    await user.click(loading);
    await user.click(disabled);
    expect(onLoading).not.toHaveBeenCalled();
    expect(onDisabled).not.toHaveBeenCalled();
  });

  it("names an icon-only control from its label and groups controls under one name", async () => {
    renderWithProviders(
      <ButtonGroup label={CATALOG_COPY.SORT_GROUP_LABEL}>
        <IconButton icon={<span />} label={COMMON_ACTIONS.REMOVE} onClick={() => undefined} />
        <Button onClick={() => undefined}>{COMMON_ACTIONS.PREVIOUS}</Button>
      </ButtonGroup>,
    );
    const group = await screen.findByRole("group", { name: CATALOG_COPY.SORT_GROUP_LABEL });
    expect(screen.getByRole("button", { name: COMMON_ACTIONS.REMOVE })).toBeEnabled();
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });

  it("activates from the keyboard with Enter and with Space", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Button onClick={onClick}>{CATALOG_COPY.ADD_TO_CART_LABEL}</Button>,
    );
    const control = screen.getByRole("button", { name: CATALOG_COPY.ADD_TO_CART_LABEL });
    await user.tab();
    expect(control).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

// The field family -------------------------------------------------------------------------------

describe("the field family", () => {
  it("labels its control, states the required one and associates the hint with it", async () => {
    renderWithProviders(
      <div>
        <Input hint={HINT_TEXT} label={PROMO_LABEL} />
        <Input label={EMAIL_LABEL} required />
      </div>,
    );
    const promoField = await screen.findByLabelText(PROMO_LABEL);
    expect(promoField.getAttribute("aria-describedby")).toBe(screen.getByText(HINT_TEXT).id);
    expect(screen.getByLabelText(new RegExp(EMAIL_LABEL))).toBeRequired();
  });

  it("wires a form error map to its field, describes the field by it, and clears it", async () => {
    const { user } = renderWithProviders(<ClearableErrorField />);
    const field = screen.getByLabelText(EMAIL_LABEL);
    const message = screen.getByText(VALIDATION_MESSAGES.EMAIL_FORMAT);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.CLEAR }));
    const cleared = screen.getByLabelText(EMAIL_LABEL);
    expect(cleared).toHaveAttribute("aria-invalid", "false");
    expect(cleared.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(VALIDATION_MESSAGES.EMAIL_FORMAT)).toBeNull();
  });

  it("takes a multi-line value and counts the characters it receives", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TextArea label={NOTES_LABEL} maxLength={NOTES_MAX_LENGTH} showCount onChange={onChange} />,
    );
    const field = screen.getByLabelText(NOTES_LABEL);
    const counter = (): HTMLElement =>
      screen.getByText(new RegExp(`/ ${String(NOTES_MAX_LENGTH)}$`));
    const typed = `${TYPED_NOTE}\n${TYPED_NOTE}`;
    expect(counter()).toHaveTextContent(`0 / ${String(NOTES_MAX_LENGTH)}`);
    await user.type(field, `${TYPED_NOTE}{Enter}${TYPED_NOTE}`);
    expect(field).toHaveValue(typed);
    expect(counter()).toHaveTextContent(`${String(typed.length)} / ${String(NOTES_MAX_LENGTH)}`);
    expect(onChange).toHaveBeenCalled();
  });
});

// The selection controls ------------------------------------------------------------------------

describe("the selection controls", () => {
  it("changes a select through the native control it is", async () => {
    const { user } = renderWithProviders(
      <Select
        label={SORT_LABEL}
        options={[
          { value: "newest", label: "Newest first" },
          { value: "price", label: "Price, lowest first" },
        ]}
      />,
    );
    const control = screen.getByRole("combobox", { name: SORT_LABEL });
    await user.selectOptions(control, "price");
    expect(control).toHaveValue("price");
  });

  it("toggles a checkbox and a switch by pointer and by keyboard, and refuses a disabled choice", async () => {
    const description = "Hides what is out of stock";
    function Choices(): ReactElement {
      const [isOn, setOn] = useState(false);
      return (
        <div>
          <Checkbox description={description} label={STOCK_LABEL} />
          <Switch checked={isOn} label={ALERTS_LABEL} onChange={setOn} />
          <Checkbox description="Sold out" isDisabled label={NOTIFY_LABEL} />
        </div>
      );
    }
    const { user } = renderWithProviders(<Choices />);
    const box = screen.getByLabelText(STOCK_LABEL);
    const toggle = screen.getByRole("switch", { name: ALERTS_LABEL });
    const unavailable = screen.getByLabelText(NOTIFY_LABEL);
    expect(box).not.toBeChecked();
    expect(box.getAttribute("aria-describedby")).toBe(screen.getByText(description).id);
    expect(unavailable).toBeDisabled();
    await user.click(box);
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.keyboard(" ");
    expect(toggle).not.toBeChecked();
    await user.click(unavailable);
    expect(unavailable).not.toBeChecked();
  });

  it("keeps one radio checked in the legend-named group and moves it with the arrow keys", async () => {
    function Rating(): ReactElement {
      const [value, setValue] = useState("four");
      return (
        <RadioGroup
          legend={CATALOG_COPY.REVIEWS_RATING_FILTER_LABEL}
          name="rating"
          onChange={setValue}
          options={[
            { value: "any", label: "Any rating" },
            { value: "four", label: "Four stars and up" },
          ]}
          value={value}
        />
      );
    }
    const { user } = renderWithProviders(<Rating />);
    const group = screen.getByRole("group", { name: CATALOG_COPY.REVIEWS_RATING_FILTER_LABEL });
    const anyRating = screen.getByRole("radio", { name: "Any rating" });
    const fourStars = screen.getByRole("radio", { name: "Four stars and up" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(fourStars).toBeChecked();
    fourStars.focus();
    await user.keyboard("{ArrowUp}");
    expect(anyRating).toBeChecked();
    expect(fourStars).not.toBeChecked();
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
  });
});
