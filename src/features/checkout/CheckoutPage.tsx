/**
 * Path: src/features/checkout/CheckoutPage.tsx
 * Purpose: The checkout route: step indicator, the current step's view and the order summary panel
 * Lines: 592
 */

import { useEffect, useId, useRef } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import {
  CART_COPY,
  CHECKOUT_COPY,
  COMMON_ACTIONS,
  PAGE_TITLES,
  appliedPromoLabel,
  cartItemCountLabel,
  documentTitle,
  errorSummaryFieldAnchor,
  freeShippingProgressLabel,
  stepProgressLabel,
} from "@/constants/content";
import { ROUTES, orderConfirmationPath } from "@/constants/routes";
import { CheckoutSteps, checkoutStepCopy } from "@/features/checkout/CheckoutSteps";
import type { CheckoutFormStep } from "@/features/checkout/CheckoutSteps";
import { PaymentForm } from "@/features/checkout/PaymentForm";
import { ReviewOrder } from "@/features/checkout/ReviewOrder";
import { ShippingForm } from "@/features/checkout/ShippingForm";
import { useCart } from "@/state/CartContext";
import { useCheckout } from "@/state/CheckoutContext";
import { CHECKOUT_FORM_STEPS } from "@/state/checkoutReducer";
import type { CheckoutStep } from "@/state/checkoutReducer";
import { useDocumentTitle } from "@/state/hooks";
import type { ApiError, AsyncStatus, FieldErrors } from "@/types/common";
import type { PricedCart } from "@/types/commerce";
import { formatFreeShippingRemaining, formatMoney } from "@/utils/format";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer
 * of `src/styles/**` — so every class below is consumed by name, and this list is what the sheets owe the
 * file.
 *
 * `src/styles/layout.css` owns the page: `sp-container` is the width and gutter every route sits in, `sp-page`
 * the column of blocks at one rhythm, `sp-page__body` the region the route's own content lands in, `sp-split`
 * the frame whose aside track is `--layout-aside-width` from the large stop, and `sp-stack` the rhythm the
 * summary's figures sit in. `src/styles/commerce.css` owns the checkout's register: `sp-checkout` widens that
 * frame's row gap, `sp-checkout__main` narrows the step column and `sp-checkout__aside` is the summary column,
 * sticky below the header from the large stop.
 *
 * The step shell is `sp-step` for the region, with `sp-step__header`, `sp-step__title`, `sp-step__count` and
 * `sp-step__errors` for the heading block and the summary of what is wrong, and `sp-step__body` for the region
 * the current step renders in — the class the shipping and payment forms also carry on their own roots, and
 * the one the sheet dims and closes to the pointer while the shell is `aria-busy`. Each step's action row is
 * `sp-step__actions`, rendered by that step's own file, and the indicator is `CheckoutSteps`' family.
 *
 * The order summary panel is `sp-summary` with `sp-summary__title`, the `sp-summary__row` register and its
 * `--discount` and `--total` modifiers, `sp-summary__note` and `sp-summary__progress-label`: the panel
 * register the cart's own summary draws, which is why this panel is a `Card` carrying that class rather than a
 * card of its own.
 */

/** The classes this route puts on the page, written once so a rename is one edit. */
const CLASSES = {
  container: "sp-container",
  page: "sp-page",
  pageBody: "sp-page__body",
  frame: "sp-checkout sp-split",
  main: "sp-checkout__main",
  aside: "sp-checkout__aside",
  stack: "sp-stack",
  step: "sp-step",
  stepHeader: "sp-step__header",
  stepTitle: "sp-step__title",
  stepCount: "sp-step__count",
  stepErrors: "sp-step__errors",
  stepBody: "sp-step__body",
  summary: "sp-summary",
  summaryTitle: "sp-summary__title",
  row: "sp-summary__row",
  note: "sp-summary__note",
  progressLabel: "sp-summary__progress-label",
} as const;

/**
 * The sign a saving carries before its amount: the summary register paints the value in its success pair and
 * leaves the sign to the markup.
 */
const DISCOUNT_SIGN = "−";

/** The separator between a field and the group it sits in inside the flow's error map: `billing.city`. */
const FIELD_QUALIFIER_SEPARATOR = ".";

/** The two registers an amount row carries beyond the plain one, as the summary sheet names its modifiers. */
const ROW_MODIFIER_CLASSES = {
  discount: `${CLASSES.row} sp-summary__row--discount`,
  total: `${CLASSES.row} sp-summary__row--total`,
} as const;

/** The register an amount row is painted in. */
type RowModifier = keyof typeof ROW_MODIFIER_CLASSES;

// Reading the step ------------------------------------------------------------------------------

/**
 * Whether a step is one of the three that own a form, read from the list the reducer declares rather than
 * restated here. The confirmation is not one of them: it is where a placed order lands, not a step a shopper
 * works through.
 *
 * @param step - The step the flow is standing on.
 * @returns True for a step that owns a form, narrowing the step to it.
 */
function isFormStep(step: CheckoutStep): step is CheckoutFormStep {
  return CHECKOUT_FORM_STEPS.some((formStep) => formStep === step);
}

/**
 * The title this route gives the browser tab, carrying the position in the flow the step it is showing holds:
 * `Checkout · Step 1 of 3`. The confirmation is not a form step and gets the plain route title. The position
 * is read from `CHECKOUT_FORM_STEPS`, so a step reordered there moves this count with it.
 *
 * @param step - The step the flow is standing on.
 * @returns The page title, without the product name `documentTitle` appends.
 */
function pageTitle(step: CheckoutStep): string {
  if (!isFormStep(step)) return PAGE_TITLES.CHECKOUT;
  const position = CHECKOUT_FORM_STEPS.indexOf(step) + 1;
  return `${PAGE_TITLES.CHECKOUT} · ${stepProgressLabel(position, CHECKOUT_FORM_STEPS.length)}`;
}

/** Proof at compile time that every step was handled: a step added to the union fails to type-check here. */
function assertNever(value: never): never {
  throw new Error(`Unhandled checkout step: ${String(value)}`);
}

/**
 * The current step's own view, one file per step. Exactly one is mounted at a time, so a step the shopper is
 * not standing on holds no controls and no state of its own: every value it collected lives in the checkout's
 * own values, which is why moving back to it finds it as it was left.
 *
 * @param step - The form step the flow is standing on.
 * @returns That step's view.
 */
function stepView(step: CheckoutFormStep): ReactElement {
  switch (step) {
    case "shipping":
      return <ShippingForm />;
    case "payment":
      return <PaymentForm />;
    case "review":
      return <ReviewOrder />;
    default:
      return assertNever(step);
  }
}

// The step region's states ----------------------------------------------------------------------

/**
 * What the step region stands in with at the confirmation, where the order is placed and the route is handing
 * over to the confirmation view: the shapes a step's content takes, announcing nothing, because the region
 * holding it is what carries `aria-busy`.
 */
function StepPlaceholder(): ReactElement {
  return (
    <>
      <Skeleton variant="text" lines={2} />
      <Skeleton variant="card" />
      <Skeleton variant="row" />
    </>
  );
}

/** Everything {@link PricingFailure} renders from. */
interface PricingFailureProps {
  /** The failure the price request answered with. */
  readonly error: ApiError;
  /** Asks for the figures again, through the flow's own pass. */
  readonly onRetry: () => void;
}

/**
 * The state a failed price request shows where the figures would be: the failure the seam shaped, in the danger
 * register, with the retry that asks for them again. No `try`/`catch` surrounds the request, because the seam
 * reports failures as values and the flow already holds the one it received.
 *
 * @param props - The failure and the retry.
 * @returns The failure with its retry action.
 */
function PricingFailure({ error, onRetry }: PricingFailureProps): ReactElement {
  return (
    <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={onRetry} tone="danger" />
  );
}

/** Everything {@link ErrorSummary} renders from. */
interface ErrorSummaryProps {
  /** What is wrong with the flow's values, keyed by the field each message belongs to. */
  readonly errors: FieldErrors;
  /** Puts the keyboard on the control a message names; returns whether it found one. */
  readonly onJumpToField: (field: string) => boolean;
}

/**
 * What is wrong with the step in hand, stated once above it, each message reaching the control it belongs to.
 *
 * A message is a link to the field it names. The controls carry the `name` the flow's error map keys them by,
 * while the id each one is labelled with is generated inside the field component, so the click moves the
 * keyboard to the control itself and lets the browser follow the fragment only where no control matched.
 *
 * @param props - The error map and the move the messages perform.
 * @returns The summary in the danger register, one message per field.
 */
function ErrorSummary({ errors, onJumpToField }: ErrorSummaryProps): ReactElement {
  return (
    <Alert className={CLASSES.stepErrors} title={CHECKOUT_COPY.ERROR_SUMMARY_HEADING} tone="danger">
      <ul>
        {Object.entries(errors).map(([field, message]) => (
          <li key={field}>
            <a
              href={errorSummaryFieldAnchor(field)}
              onClick={(event) => {
                if (onJumpToField(field)) event.preventDefault();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

// The order summary panel -----------------------------------------------------------------------

/** Everything {@link SummaryRow} renders from. */
interface SummaryRowProps {
  /** What the amount is, from the copy library. */
  readonly label: string;
  /** The amount, already formatted by `src/utils/format.ts`. */
  readonly value: string;
  /** The register the row is painted in: a saving, or the total. */
  readonly modifier?: RowModifier;
}

/**
 * One amount row: what it is on the leading edge and the figure on the trailing one. The row holds no figure of
 * its own — the amount arrives formatted — so no row can drift from the others.
 *
 * @param props - The row's label, its formatted amount and the register it sits in.
 * @returns The row.
 */
function SummaryRow({ label, value, modifier }: SummaryRowProps): ReactElement {
  const className = modifier === undefined ? CLASSES.row : ROW_MODIFIER_CLASSES[modifier];

  return (
    <div className={className}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * The basket's amounts and the state of its delivery, read from the priced cart the flow holds.
 *
 * Nothing is added up: every figure is the one `src/lib/pricingService.ts` computed, which keeps the cart, the
 * checkout steps, this panel and a placed order from disagreeing about one basket. The delivery row states a
 * charge only once a method has been chosen, because until then the basket is priced against the fallback
 * method and that figure is not a quote the shopper has been given. The saving row appears only where a
 * discount was taken, and the codes that earned it are named beneath the figures.
 *
 * @param props - The priced basket.
 * @returns The item count, the free-delivery note and the amount rows.
 */
function SummaryRows({ snapshot }: { readonly snapshot: PricedCart }): ReactElement {
  const {
    appliedPromos,
    currency,
    discountTotalMinor,
    freeShippingRemainingMinor,
    grandTotalMinor,
    lines,
    shippingMethodId,
    shippingMinor,
    subtotalMinor,
    taxMinor,
  } = snapshot;

  return (
    <>
      <p className={CLASSES.note}>{cartItemCountLabel(lines.length)}</p>
      {freeShippingRemainingMinor > 0 ? (
        <p className={CLASSES.progressLabel}>
          {freeShippingProgressLabel(
            formatFreeShippingRemaining(freeShippingRemainingMinor, currency),
          )}
        </p>
      ) : null}
      <SummaryRow
        label={CART_COPY.SUMMARY_SUBTOTAL_LABEL}
        value={formatMoney(subtotalMinor, currency)}
      />
      {discountTotalMinor > 0 ? (
        <SummaryRow
          label={CART_COPY.SUMMARY_DISCOUNT_LABEL}
          modifier="discount"
          value={`${DISCOUNT_SIGN}${formatMoney(discountTotalMinor, currency)}`}
        />
      ) : null}
      <SummaryRow
        label={CART_COPY.SUMMARY_SHIPPING_LABEL}
        value={
          shippingMethodId === null
            ? CART_COPY.SUMMARY_SHIPPING_AT_CHECKOUT_LABEL
            : formatMoney(shippingMinor, currency)
        }
      />
      <SummaryRow label={CART_COPY.SUMMARY_TAX_LABEL} value={formatMoney(taxMinor, currency)} />
      <SummaryRow
        label={CART_COPY.SUMMARY_TOTAL_LABEL}
        modifier="total"
        value={formatMoney(grandTotalMinor, currency)}
      />
      {appliedPromos.length === 0 ? null : (
        <div className={CLASSES.note}>
          {appliedPromos.map((promo) => (
            <p key={promo.code}>{appliedPromoLabel(promo.code)}</p>
          ))}
        </div>
      )}
    </>
  );
}

/** The figures' own placeholder, for the window between arriving at the route and the first quote. */
function SummaryPlaceholder(): ReactElement {
  return (
    <>
      <Skeleton variant="text" />
      <Skeleton variant="row" />
      <Skeleton variant="row" />
      <Skeleton variant="row" />
    </>
  );
}

/** Everything {@link OrderSummaryPanel} renders from. */
interface OrderSummaryPanelProps {
  /** The priced cart the flow holds, or `null` before this basket has been priced. */
  readonly snapshot: PricedCart | null;
  /** Where the last price request stands, which decides whether the figures are being waited on. */
  readonly status: AsyncStatus;
  /** The failure the last price request answered with, or `null`. */
  readonly error: ApiError | null;
  /**
   * Whether the step in hand reports the price request inside its own body, which the review step does: it
   * stands its own placeholder and its own failure with a retry in, so the report reaches the shopper once.
   */
  readonly isReportedByStep: boolean;
  /** Asks the flow for the basket's figures again, for the failure's retry. */
  readonly onRetry: () => void;
}

/**
 * What the panel states where the figures go: the failure with its retry where the panel owns the report, the
 * placeholder while no figures exist, and the amounts once they do. A failure the step in hand reports itself
 * leaves the panel its placeholder, because the failure and its retry are stated inches away by that step.
 *
 * @param props - The priced cart, the request's lifecycle and the step's own claim on the report.
 * @returns The failure, the placeholder or the amounts.
 */
function summaryBody(props: OrderSummaryPanelProps): ReactElement {
  if (props.error !== null) {
    return props.isReportedByStep ? (
      <SummaryPlaceholder />
    ) : (
      <PricingFailure error={props.error} onRetry={props.onRetry} />
    );
  }
  return props.snapshot === null ? (
    <SummaryPlaceholder />
  ) : (
    <SummaryRows snapshot={props.snapshot} />
  );
}

/**
 * The order summary panel beside the steps: what the basket comes to, from the priced cart the flow holds.
 *
 * It restates and it computes nothing — no subtotal, no discount, no delivery charge, no total and no
 * free-delivery threshold. Every figure arrives already priced, and this is where each one is formatted. The
 * heading stands whatever the price request is doing, so the shopper always has the panel the figures will
 * land in, and the figures sit in a polite live region: a re-price is announced once, without moving the focus
 * the shopper is using.
 *
 * @param props - The priced cart, the request's lifecycle, the step's own claim on the report and the retry.
 * @returns The summary panel.
 */
function OrderSummaryPanel(props: OrderSummaryPanelProps): ReactElement {
  const headingId = useId();

  return (
    <Card aria-labelledby={headingId} as="section" className={CLASSES.summary}>
      <h2 className={CLASSES.summaryTitle} id={headingId}>
        {CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING}
      </h2>
      <div
        aria-atomic="true"
        aria-busy={props.status === "loading"}
        aria-live="polite"
        className={CLASSES.stack}
      >
        {summaryBody(props)}
      </div>
    </Card>
  );
}

// The route -------------------------------------------------------------------------------------

/**
 * The `/checkout` route: where the shopper is, the step they are working on, and what the order comes to.
 *
 * The route composes and it decides nothing. The step machine, the entered values, the price of the basket and
 * the order itself belong to `src/state/CheckoutContext.tsx`, which prices the basket as it changes, places the
 * order from the priced snapshot taken before completion and hands the cart its own clear; the order of the
 * steps belongs to `src/state/checkoutReducer.ts`; each step's fields, rules and actions belong to that step's
 * own file; and every figure arrives already computed, so nothing here is added up. What this file owns is the
 * composition — the page's heading, the indicator, the step shell with its heading, its count and its summary
 * of what is wrong, the current step's view, the order summary panel — and the one navigation a completed
 * checkout takes.
 *
 * Each state is rendered where its own subject is. A basket with no lines cannot be checked out, so the route
 * offers the empty state with the one action that helps rather than a flow that could never complete — asked
 * before an order is placed, because completion empties the cart. The price request's placeholder and its
 * failure belong to the figures, so the order summary panel states them and its retry asks the flow again,
 * which leaves the step in hand mounted and usable while a newer quote is on its way: the basket's figures are
 * not what the shopper is typing into.
 *
 * A placed order is handed to its own route rather than rendered here: the reducer moves the flow to its
 * confirmation and this page navigates to `orderConfirmationPath`, replacing the entry so the browser's back
 * button cannot re-enter a checkout that is already finished. For the instant that takes, the frame keeps its
 * indicator and the step region keeps its placeholder, because a step whose order is placed has no form left to
 * show and no submission left to offer.
 *
 * @returns The checkout route.
 */
export function CheckoutPage(): ReactElement {
  const { actions, errors, isSubmitting, order, pricingError, pricingStatus, snapshot, step } =
    useCheckout();
  const { lines } = useCart();
  const navigate = useNavigate();

  /**
   * The region the current step renders in, so a message in the summary above can put the keyboard on the
   * control it belongs to.
   */
  const stepBodyRef = useRef<HTMLDivElement>(null);

  /** The checkout cannot proceed without lines, and the cart is emptied the moment an order is placed — so an
   *  empty basket here is one the shopper arrived with, never the aftermath of their own order. */
  const isCartEmpty = lines.length === 0 && order === null;

  /** The step in hand, with the words and the position that name it, or `null` at the confirmation, which is
   *  not a step that owns a form and has no heading of its own to state. */
  const form = isFormStep(step)
    ? {
        step,
        copy: checkoutStepCopy(step),
        position: CHECKOUT_FORM_STEPS.indexOf(step) + 1,
      }
    : null;

  useDocumentTitle(documentTitle(isCartEmpty ? PAGE_TITLES.CHECKOUT : pageTitle(step)));

  /*
   * A placed order belongs to the confirmation route, which reads it by its identifier from the path and
   * survives a reload; this route's copy of it is a courtesy, not the source. The move is a replace, so Back
   * returns to the cart or the catalogue rather than into a checkout that has already been completed.
   */
  useEffect(() => {
    if (order === null) return;
    void navigate(orderConfirmationPath(order.id), { replace: true });
  }, [navigate, order]);

  /**
   * Returns to an earlier step, which the flow performs and the reducer refuses for any move but a return: the
   * indicator offers the control only where that move is one the state machine allows.
   *
   * @param next - The earlier form step the shopper asked for.
   */
  const selectStep = (next: CheckoutFormStep): void => {
    actions.setStep(next);
  };

  /** Asks the flow for the basket's figures again, for the retry a failed price request offers. */
  const retryPricing = (): void => {
    actions.retryPricing();
  };

  /**
   * Puts the keyboard on the control a summary message names, and reports whether it found one.
   *
   * The keys of the flow's error map are the field names `src/utils/validation.ts` files its complaints under,
   * and they are the `name` every control the steps render carries. A key qualified by the group it sits in
   * names the address member itself, and the first control carrying that member is the one the message is
   * about; a message whose control no step is showing moves nothing and lets the browser follow its fragment.
   *
   * @param field - The key the message is filed under.
   * @returns True when a control was found and focused.
   */
  const jumpToField = (field: string): boolean => {
    const region = stepBodyRef.current;
    if (region === null) return false;
    const member = field.slice(field.lastIndexOf(FIELD_QUALIFIER_SEPARATOR) + 1);
    const control = region.querySelector<HTMLElement>(`[name="${member}"]`);
    if (control === null) return false;
    control.focus();
    return true;
  };

  /**
   * Whether the step region is working rather than settled: a submission in flight, or the confirmation's
   * hand-over. The region states it so the sheet can dim what it holds and assistive technology can announce
   * the update.
   *
   * A price request does not make the region busy: the basket's figures are the summary panel's, and the step
   * in hand stays mounted and usable while a newer quote is on its way — replacing a form the shopper is
   * typing in, or has just chosen a delivery method in, with a placeholder would take the control they were
   * using off the screen beneath them.
   */
  const isStepRegionBusy = isSubmitting || form === null;

  /** The step region's content, decided on every render and stored nowhere: the step in hand's own view, and
   *  the placeholder at the confirmation, where the order is already placed and the route is handing over. */
  const stepRegion = form === null ? <StepPlaceholder /> : stepView(form.step);

  /**
   * Whether the shell states what is wrong above the step. The review step is left out because it has no
   * advance to refuse: the one failure it can carry is the submission's own, which that step's file reports
   * with the field messages the attempt named, so a second report of the same failure would be stated twice.
   */
  const showsErrorSummary =
    form !== null && form.step !== "review" && Object.keys(errors).length > 0;

  const body = isCartEmpty ? (
    <EmptyState actionHref={ROUTES.CATALOG} surface="cart" />
  ) : (
    <div className={CLASSES.frame}>
      <div className={CLASSES.main}>
        <CheckoutSteps currentStep={step} onStepSelect={selectStep} />
        <div aria-busy={isStepRegionBusy} className={CLASSES.step}>
          {form === null ? null : (
            <div className={CLASSES.stepHeader}>
              <h2 className={CLASSES.stepTitle}>{form.copy.heading}</h2>
              <p className={CLASSES.stepCount}>
                {stepProgressLabel(form.position, CHECKOUT_FORM_STEPS.length)}
              </p>
              <p className={CLASSES.note}>{form.copy.supporting}</p>
            </div>
          )}
          {showsErrorSummary ? <ErrorSummary errors={errors} onJumpToField={jumpToField} /> : null}
          <div className={CLASSES.stepBody} ref={stepBodyRef}>
            {stepRegion}
          </div>
        </div>
      </div>
      <aside className={CLASSES.aside}>
        <OrderSummaryPanel
          error={pricingError}
          isReportedByStep={step === "review"}
          onRetry={retryPricing}
          snapshot={snapshot}
          status={pricingStatus}
        />
      </aside>
    </div>
  );

  return (
    <div className={CLASSES.container}>
      <div className={CLASSES.page}>
        <PageHeader title={PAGE_TITLES.CHECKOUT} />
        <div className={CLASSES.pageBody}>{body}</div>
      </div>
    </div>
  );
}
