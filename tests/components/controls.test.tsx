/**
 * Path: tests/components/controls.test.tsx
 * Purpose: Button, field, select and overlay behaviour, including keyboard and focus handling
 * Lines: 378
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
import { ToastViewport } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  A11Y_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
} from "@/constants/content";
import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE, useToast } from "@/state/ToastContext";

import { makeFieldErrors } from "../fixtures";
import { renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * The shared controls seen from the outside — the button family, the field family, the selection controls, the
 * tooltip and the toast viewport — through roles, accessible names, ARIA state, rendered text and where the
 * keyboard focus is. The overlay family, whose panels portal onto `document.body`, is in
 * `tests/components/overlays.test.tsx`, the §0.5.5 split of this file: the five families together were over the
 * 600-line ceiling, and the overlays are a family in their own right. No assertion touches a class name or a
 * computed style, so none needs a stylesheet, and every subject is mounted through `renderWithProviders`.
 *
 * Each case reads its first post-render expectation through an awaited query, and moves a fake clock inside an
 * awaited query rather than between two of them, because the providers issue requests when they mount and a
 * toast countdown dismisses through a queue update: an update raised outside the testing library's `act` window
 * is what React reports as an act warning. The rule, and why the awaited query is what keeps such a settle
 * inside that window, is stated in `tests/testUtils.tsx`; no case needs an `act` call of its own.
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
const RAISE_SUCCESS = "Report a success";
const RAISE_ERROR = "Report a failure";
const TOOLTIP_TEXT = "Excludes cancelled orders.";

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

/** Raises notifications through the real queue, beside the viewport the application mounts itself. */
function ToastHarness(): ReactElement {
  const toast = useToast();
  return (
    <div>
      <Button onClick={() => toast.success(FEEDBACK_COPY.TOAST_ADDRESS_SAVED)}>
        {RAISE_SUCCESS}
      </Button>
      <Button onClick={() => toast.error(FEEDBACK_COPY.TOAST_EXPORT_FAILED)}>{RAISE_ERROR}</Button>
      <ToastViewport />
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

  it("wires a form error map to its field, announces it, and clears it with the message", async () => {
    const { user } = renderWithProviders(<ClearableErrorField />);
    const alert = screen.getByRole("alert");
    const field = screen.getByLabelText(EMAIL_LABEL);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(alert).toHaveTextContent(VALIDATION_MESSAGES.EMAIL_FORMAT);
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.CLEAR }));
    const cleared = screen.getByLabelText(EMAIL_LABEL);
    expect(cleared).toHaveAttribute("aria-invalid", "false");
    expect(cleared.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
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

// Supplementary surfaces ------------------------------------------------------------------------

describe("supplementary surfaces", () => {
  it("describes its trigger only while the tooltip is open, on hover and on focus", async () => {
    const { user } = renderWithProviders(
      <Tooltip content={TOOLTIP_TEXT}>
        <Button onClick={() => undefined}>{COMMON_ACTIONS.APPLY}</Button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: COMMON_ACTIONS.APPLY });
    expect(trigger).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.hover(trigger);
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    expect(screen.getByRole("tooltip")).toHaveTextContent(TOOLTIP_TEXT);
    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent(TOOLTIP_TEXT);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("announces each kind in its own register, dismisses by control and caps what it shows", async () => {
    const { user } = renderWithProviders(<ToastHarness />);
    await user.click(screen.getByRole("button", { name: RAISE_ERROR }));
    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(FEEDBACK_COPY.TOAST_EXPORT_FAILED);
    const viewport = screen.getByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
    expect(viewport).not.toHaveAttribute("aria-live");
    await user.click(within(failure).getByRole("button", { name: COMMON_ACTIONS.CLOSE }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL })).toBeNull();
    const raise = screen.getByRole("button", { name: RAISE_SUCCESS });
    await user.click(raise);
    expect(await screen.findByRole("status")).toHaveTextContent(FEEDBACK_COPY.TOAST_ADDRESS_SAVED);
    for (let count = 0; count < TOAST_MAX_VISIBLE + 1; count += 1) {
      await user.click(raise);
    }
    expect(screen.getAllByRole("status")).toHaveLength(TOAST_MAX_VISIBLE);
  });

  it("clears a message when its duration elapses and holds it while it is attended to", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<ToastHarness />);
    const raise = screen.getByRole("button", { name: RAISE_SUCCESS });
    await user.click(raise);
    await screen.findByRole("status");
    // The clock is moved inside an awaited query, so the dismissal the countdown raises lands in the window
    // that query holds open rather than between two of them: an update raised outside that window is what React
    // reports as an act warning. The budget is raised past the move, because the query's own timeout would
    // otherwise fire inside it and end the query before the dismissal does.
    await waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(TOAST_DURATION_MS.success);
      },
      { timeout: TOAST_DURATION_MS.success * 2 },
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await user.click(raise);
    const message = await screen.findByRole("status");
    await user.hover(message);
    vi.advanceTimersByTime(TOAST_DURATION_MS.success * 3);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: COMMON_ACTIONS.CLOSE });
    dismiss.focus();
    vi.advanceTimersByTime(TOAST_DURATION_MS.success);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.unhover(message);
    dismiss.blur();
    await waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(TOAST_DURATION_MS.success + 100);
      },
      { timeout: TOAST_DURATION_MS.success * 2 },
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
