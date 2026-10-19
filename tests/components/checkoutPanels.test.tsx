/**
 * Path: tests/components/checkoutPanels.test.tsx
 * Purpose: The checkout's two panels through their own props and the real seam: the order summary's placeholder, its refusal with the retry, the failure a step reports itself, and the priced rows it states, and the step error summary's list, its absent case, the keyboard a refusal hands over and the move its links perform
 * Lines: 448
 */

import { createRef, useRef } from "react";
import type { ReactElement } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_COPY,
  errorSummaryCountLabel,
  errorSummaryFieldAnchor,
} from "@/constants/checkoutCopy";
import { FREE_SHIPPING_THRESHOLD_MINOR } from "@/constants/config";
import {
  CART_COPY,
  COMMON_ACTIONS,
  VALIDATION_MESSAGES,
  appliedPromoLabel,
  cartItemCountLabel,
  freeShippingProgressLabel,
} from "@/constants/content";
import { PROMO_CODES } from "@/data/orders";
import { PRODUCTS } from "@/data/products";
import { CheckoutErrorSummary } from "@/features/checkout/CheckoutErrorSummary";
import { OrderSummaryPanel } from "@/features/checkout/OrderSummaryPanel";
import type { OrderSummaryPanelProps } from "@/features/checkout/OrderSummaryPanel";
import { shippingFieldLabel } from "@/features/checkout/ShippingForm";
import { API_PATHS, FALLBACK_FAILURE_MESSAGE } from "@/lib/mockServer";
import { priceCart } from "@/lib/pricingService";
import { createCartLine } from "@/state/cartReducer";
import type { FieldErrors } from "@/types/common";
import type { CartLine, PricedCart, PromoCode } from "@/types/commerce";
import { formatFreeShippingRemaining } from "@/utils/format";
import { FORM_ERROR_KEY, validateAddress } from "@/utils/validation";

import { CHOSEN_METHOD } from "../helpers/checkoutHarness";
import { rowAmount, summaryPanel } from "../helpers/journeyHarness";
import {
  failNext,
  renderWithProviders,
  resetApiState,
  screen,
  waitFor,
  within,
} from "../testUtils";

/*
 * The checkout's two panels, each mounted on its own with the props the checkout hands it. Both are rendered
 * directly rather than through the route, because each is decided entirely by what it is given: the order
 * summary reads a priced basket and the request's lifecycle, and the step summary reads an error map, the
 * step's own label resolver and the move its links perform.
 *
 * Every figure and every message comes from the module that produces it — `src/lib/pricingService.ts` for the
 * basket, `src/utils/validation.ts` for a refused step, `src/lib/mockServer.ts` for a failure — so a case
 * asserts a panel against the product's own answers rather than against a figure written here. The two things
 * the checkout supplies to the step summary — its step region and its jump-to-field move — are reproduced in
 * the harness below, because the route that owns them exports neither.
 */

beforeEach(resetApiState);

afterEach(() => {
  resetApiState();
  // jsdom keeps one document across the files of a run, so a case that followed a fragment puts the address back.
  window.history.replaceState(null, "", "/");
});

// The inputs a case states ------------------------------------------------------------------------

/** The retry a panel offers where a case observes it rather than performing it. */
const noRetry = (): void => undefined;

/** The jump a summary performs where no control of the step carries the field, which the browser then follows. */
const noJump = (): boolean => false;

/** The region a summary reads when its own notice is never in the document. */
const NO_STEP_REGION = createRef<HTMLDivElement>();

/** One seeded line, built by the cart's own constructor so it carries the price and the ceiling the catalogue gave it.
 *
 * `priciest` picks the dearest qualifying product instead of the cheapest, which is what lets a case hold a basket
 * that still clears free delivery after a percentage has been taken off it. */
function seededLine(units: number, atLeastMinor = 0, priciest = false): CartLine {
  const qualifying = [...PRODUCTS]
    .filter(
      (candidate) =>
        candidate.priceMinor > 0 &&
        candidate.stockOnHand >= units &&
        candidate.priceMinor * units >= atLeastMinor,
    )
    .sort((left, right) =>
      priciest ? right.priceMinor - left.priceMinor : left.priceMinor - right.priceMinor,
    );
  const product = qualifying[0];
  if (product === undefined) {
    throw new Error(`No seeded product holds ${String(units)} units at that price.`);
  }
  const line = createCartLine(product, units);
  if (line === null) throw new Error(`No line could be built for "${product.name}".`);
  return line;
}

/** A basket short of free delivery, and one that clears it twice over so a code cannot carry it back below. */
const SMALL_LINE = seededLine(2);
const BULK_LINE = seededLine(5, FREE_SHIPPING_THRESHOLD_MINOR * 2, true);

/** A basket priced by the product's own pricing service, with the failure it cannot accept thrown. */
async function pricedCart(
  lines: readonly CartLine[],
  promoCode?: string,
  shippingMethodId: string | null = null,
): Promise<PricedCart> {
  const result = await priceCart(lines, promoCode, shippingMethodId);
  if (!result.ok) throw new Error(`The basket could not be priced: ${result.error.message}`);
  return result.value;
}

/** The seeded code that takes a percentage off the goods and applies to any basket. */
function goodsCode(): PromoCode {
  const code = PROMO_CODES.find(
    (promo) =>
      promo.active &&
      promo.kind === "percent" &&
      promo.appliesTo === "order" &&
      promo.minSubtotalMinor === 0 &&
      promo.usageCount < promo.usageLimit,
  );
  if (code === undefined) throw new Error("No seeded code discounts any basket.");
  return code;
}

/** The order summary's props, with each case stating only what it decides. */
function panelProps(overrides: Partial<OrderSummaryPanelProps> = {}): OrderSummaryPanelProps {
  return {
    error: null,
    isReportedByStep: false,
    onRetry: noRetry,
    snapshot: null,
    status: "loading",
    ...overrides,
  };
}

/** The figures region of a summary panel: the one element inside it that carries the request's busy state. */
function figuresRegion(panel: HTMLElement): HTMLElement {
  const region = panel.querySelector<HTMLElement>("[aria-busy]");
  if (region === null) throw new Error("The panel states no figures region.");
  return region;
}

/** The panel a case reads, named by the heading the checkout states for it. */
function orderPanel(): HTMLElement {
  return summaryPanel(CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING);
}

// The order summary panel -------------------------------------------------------------------------

describe("the order summary panel", () => {
  it("stands its heading and a busy figures region while no price has arrived, and no amount row", () => {
    renderWithProviders(<OrderSummaryPanel {...panelProps({ status: "loading" })} />);

    const panel = orderPanel();
    expect(
      within(panel).getByRole("heading", { name: CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING }),
    ).toBeInTheDocument();
    expect(figuresRegion(panel)).toHaveAttribute("aria-busy", "true");
    // Nothing has been quoted, so no amount row stands in for a total that has not been given, and nothing failed.
    expect(within(panel).queryByText(CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeNull();
    expect(within(panel).queryByText(CART_COPY.SUMMARY_TOTAL_LABEL)).toBeNull();
    expect(within(panel).queryByRole("alert")).toBeNull();
  });

  it("reports a refused price where it owns the report, and asks for the figures again through its own retry", async () => {
    const armed = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    const refused = await priceCart([SMALL_LINE], undefined, null);
    armed.disarm();
    if (refused.ok) throw new Error("The armed price request was answered.");

    const retry = vi.fn();
    const { user } = renderWithProviders(
      <OrderSummaryPanel
        {...panelProps({ error: refused.error, onRetry: retry, status: "error" })}
      />,
    );

    const panel = orderPanel();
    const alert = within(panel).getByRole("alert");
    expect(alert).toHaveTextContent(refused.error.message);
    // The failure stands where the figures would, so no amount row is stated beneath an unreadable price.
    expect(within(panel).queryByText(CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeNull();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("leaves a failure the step reports itself to that step, standing its placeholder rather than a second report", async () => {
    const armed = failNext({ method: "POST", path: API_PATHS.CART_PRICE });
    const refused = await priceCart([SMALL_LINE], undefined, null);
    armed.disarm();
    if (refused.ok) throw new Error("The armed price request was answered.");

    renderWithProviders(
      <OrderSummaryPanel
        {...panelProps({ error: refused.error, isReportedByStep: true, status: "error" })}
      />,
    );

    const panel = orderPanel();
    // The step in hand states the failure and its retry inches away, so the panel repeats neither.
    expect(within(panel).queryByRole("alert")).toBeNull();
    expect(within(panel).queryByText(CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBeNull();
    expect(within(panel).queryByText(refused.error.message)).toBeNull();
  });

  it("states the amounts, the delivery it has not been charged for, and the shortfall to free delivery", async () => {
    const priced = await pricedCart([SMALL_LINE]);
    expect(priced.shippingMethodId).toBeNull();
    expect(priced.freeShippingRemainingMinor).toBeGreaterThan(0);
    renderWithProviders(
      <OrderSummaryPanel {...panelProps({ snapshot: priced, status: "success" })} />,
    );

    const panel = orderPanel();
    expect(within(panel).getByText(cartItemCountLabel(SMALL_LINE.quantity))).toBeInTheDocument();
    expect(rowAmount(panel, CART_COPY.SUMMARY_SUBTOTAL_LABEL)).toBe(priced.subtotalMinor);
    expect(rowAmount(panel, CART_COPY.SUMMARY_TAX_LABEL)).toBe(priced.taxMinor);
    expect(rowAmount(panel, CART_COPY.SUMMARY_TOTAL_LABEL)).toBe(priced.grandTotalMinor);
    // No code reduced the goods, so no saving row stands and no code is named beneath the figures.
    expect(within(panel).queryByText(CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBeNull();
    // No delivery method has been chosen, so the row says where the charge is settled instead of quoting one.
    expect(
      within(panel).getByText(CART_COPY.SUMMARY_SHIPPING_AT_CHECKOUT_LABEL),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        freeShippingProgressLabel(
          formatFreeShippingRemaining(priced.freeShippingRemainingMinor, priced.currency),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("charges the delivery once a method has been chosen and names each code the basket applied", async () => {
    const code = goodsCode();
    const priced = await pricedCart([BULK_LINE], code.code, CHOSEN_METHOD.id);
    // The basket reached the free-delivery threshold and the method it was priced with still charges.
    expect(priced.freeShippingRemainingMinor).toBe(0);
    expect(priced.shippingMinor).toBeGreaterThan(0);
    expect(priced.discountTotalMinor).toBeGreaterThan(0);
    renderWithProviders(
      <OrderSummaryPanel {...panelProps({ snapshot: priced, status: "success" })} />,
    );

    const panel = orderPanel();
    expect(rowAmount(panel, CART_COPY.SUMMARY_SHIPPING_LABEL)).toBe(priced.shippingMinor);
    expect(within(panel).queryByText(CART_COPY.SUMMARY_SHIPPING_AT_CHECKOUT_LABEL)).toBeNull();
    expect(rowAmount(panel, CART_COPY.SUMMARY_DISCOUNT_LABEL)).toBe(priced.discountTotalMinor);
    expect(rowAmount(panel, CART_COPY.SUMMARY_TOTAL_LABEL)).toBe(priced.grandTotalMinor);
    for (const promo of priced.appliedPromos) {
      expect(within(panel).getByText(appliedPromoLabel(promo.code))).toBeInTheDocument();
    }
    // The threshold was reached, so no shortfall is stated beneath the figures.
    expect(
      within(panel).queryByText(
        freeShippingProgressLabel(formatFreeShippingRemaining(0, priced.currency)),
      ),
    ).toBeNull();
  });
});

// The step's error summary ------------------------------------------------------------------------

/** The member the flow's jump move looks a control up by, which is also the key a message is filed under. */
const STEP_CONTROL_NAME = "fullName";

/** The message a refused submission files under no control at all, which no step can point at. */
const FORMLESS_REFUSAL = FALLBACK_FAILURE_MESSAGE;

/** A refused shipping step: every field the address rule reports, plus one message that names no control. */
function shippingRefusal(): FieldErrors {
  return { ...validateAddress({}), [FORM_ERROR_KEY]: FORMLESS_REFUSAL };
}

/** The maps a summary has nothing to list for: a step with nothing wrong, and one naming no control at all. */
const EMPTY_ERROR_MAPS: readonly { readonly name: string; readonly errors: FieldErrors }[] = [
  { name: "a step with nothing wrong", errors: {} },
  {
    name: "a step whose only message names no control",
    errors: { [FORM_ERROR_KEY]: FORMLESS_REFUSAL },
  },
];

/** What the summary's own surface needs: the map it lists, the refusal in force and whether a control stands. */
interface ErrorSurfaceProps {
  readonly errors: FieldErrors;
  readonly refusals: number;
  readonly withControl?: boolean;
}

/**
 * A minimal step: the summary above a body that holds the control a message names, and the move the flow
 * performs — a lookup of the control by the member the key carries, focused when one is found, and a refusal
 * that lets the browser follow the fragment when none is.
 *
 * The step region and that move are the two things `CheckoutPage.tsx` supplies and exports neither, so the
 * steps the summary depends on are reproduced here rather than pulled from the route that owns them.
 */
function ErrorSurface({ errors, refusals, withControl = false }: ErrorSurfaceProps): ReactElement {
  const stepRef = useRef<HTMLDivElement | null>(null);

  const jumpToField = (field: string): boolean => {
    const member = field.slice(field.lastIndexOf(".") + 1);
    const control = stepRef.current?.querySelector<HTMLElement>(`[name="${member}"]`) ?? null;
    if (control === null) return false;
    control.focus();
    return true;
  };

  return (
    <>
      <CheckoutErrorSummary
        errors={errors}
        fieldLabel={shippingFieldLabel}
        onJumpToField={jumpToField}
        refusals={refusals}
        stepRef={stepRef}
      />
      <div ref={stepRef}>
        {withControl ? (
          <input
            aria-invalid="true"
            aria-label={CHECKOUT_COPY.FULL_NAME_LABEL}
            name={STEP_CONTROL_NAME}
          />
        ) : null}
      </div>
    </>
  );
}

describe("the step's error summary", () => {
  it("lists a named link per field of the step that is at fault and leaves out a message no control carries", () => {
    const errors = shippingRefusal();
    const listed = Object.entries(errors).filter(
      ([field]) => shippingFieldLabel(field) !== undefined,
    );
    expect(listed.length).toBeGreaterThan(0);
    renderWithProviders(<ErrorSurface errors={errors} refusals={0} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(CHECKOUT_COPY.ERROR_SUMMARY_HEADING)).toBeInTheDocument();
    expect(within(alert).getByText(errorSummaryCountLabel(listed.length))).toBeInTheDocument();

    const links = within(alert).getAllByRole("link");
    expect(links).toHaveLength(listed.length);
    for (const [field, message] of listed) {
      const label = shippingFieldLabel(field);
      if (label === undefined) throw new Error(`The step names no control for "${field}".`);
      const link = within(alert).getByRole("link", { name: new RegExp(`^${label}`) });
      expect(link).toHaveAttribute("href", errorSummaryFieldAnchor(field));
      expect(link).toHaveTextContent(message);
    }
    // The refusal that names no control of the step is not read twice: the panel that owns it reports it alone.
    expect(within(alert).queryByText(FORMLESS_REFUSAL)).toBeNull();
  });

  it.each(EMPTY_ERROR_MAPS)("renders nothing at all for $name", ({ errors }) => {
    const { container } = renderWithProviders(
      <CheckoutErrorSummary
        errors={errors}
        fieldLabel={shippingFieldLabel}
        onJumpToField={noJump}
        refusals={0}
        stepRef={NO_STEP_REGION}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("hands the keyboard to the notice on a refusal, and again on the refusal that follows it", async () => {
    const errors = shippingRefusal();
    // A control of the step stands and is marked as at fault, so the notice winning the keyboard is what is proved.
    const { rerender } = renderWithProviders(
      <ErrorSurface errors={errors} refusals={0} withControl />,
    );
    expect(screen.queryByRole("alert")).not.toBeNull();

    rerender(<ErrorSurface errors={errors} refusals={1} withControl />);
    await waitFor(() => expect(screen.getByRole("alert").parentElement).toHaveFocus());

    // A second refusal is a refusal as well, and the shopper has since left the notice, so it takes them back.
    screen.getByRole("alert").parentElement?.blur();
    rerender(<ErrorSurface errors={errors} refusals={2} withControl />);
    await waitFor(() => expect(screen.getByRole("alert").parentElement).toHaveFocus());
  });

  it("hands the keyboard to the first control at fault when the summary lists nothing", async () => {
    const errors = { [FORM_ERROR_KEY]: FORMLESS_REFUSAL };
    const { rerender } = renderWithProviders(
      <ErrorSurface errors={errors} refusals={0} withControl />,
    );
    // No notice is rendered for a message that names no control, so the step's own region is what a refusal reaches.
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<ErrorSurface errors={errors} refusals={1} withControl />);

    await waitFor(() => expect(screen.getByLabelText(CHECKOUT_COPY.FULL_NAME_LABEL)).toHaveFocus());
  });

  it.each([
    {
      name: "moves the keyboard to the control it names, refusing the fragment",
      withControl: true,
      followed: false,
    },
    {
      name: "lets the browser follow the fragment when no control carries the field",
      withControl: false,
      followed: true,
    },
  ])("$name", async ({ withControl, followed }) => {
    const { user } = renderWithProviders(
      <ErrorSurface
        errors={{ [STEP_CONTROL_NAME]: VALIDATION_MESSAGES.REQUIRED }}
        refusals={0}
        withControl={withControl}
      />,
    );
    const link = within(screen.getByRole("alert")).getByRole("link");
    const before = window.location.hash;

    await user.click(link);

    if (followed) {
      await waitFor(() =>
        expect(window.location.hash).toBe(errorSummaryFieldAnchor(STEP_CONTROL_NAME)),
      );
      return;
    }
    // A control was found and focused, so the move was the whole of it and the fragment was refused.
    expect(screen.getByLabelText(CHECKOUT_COPY.FULL_NAME_LABEL)).toHaveFocus();
    expect(window.location.hash).toBe(before);
  });
});
