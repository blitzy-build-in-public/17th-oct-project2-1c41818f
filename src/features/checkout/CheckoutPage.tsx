/**
 * Path: src/features/checkout/CheckoutPage.tsx
 * Purpose: The checkout route: step indicator, the current step's view and the order summary panel
 * Lines: 395
 */

import { useEffect, useId, useRef } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { stepProgressLabel } from "@/constants/checkoutCopy";
import { PAGE_TITLES, documentTitle } from "@/constants/content";
import { ROUTES, orderConfirmationPath } from "@/constants/routes";
import { CheckoutErrorSummary } from "@/features/checkout/CheckoutErrorSummary";
import { CheckoutSteps, checkoutStepCopy } from "@/features/checkout/CheckoutSteps";
import type { CheckoutFormStep } from "@/features/checkout/CheckoutSteps";
import { OrderSummaryPanel } from "@/features/checkout/OrderSummaryPanel";
import { PaymentForm, paymentFieldLabel } from "@/features/checkout/PaymentForm";
import { ReviewOrder } from "@/features/checkout/ReviewOrder";
import { ShippingForm, shippingFieldLabel } from "@/features/checkout/ShippingForm";
import { useCart } from "@/state/CartContext";
import { useCheckout } from "@/state/CheckoutContext";
import { CHECKOUT_FORM_STEPS } from "@/state/checkoutReducer";
import type { CheckoutStep } from "@/state/checkoutReducer";
import { useFocusHandoff } from "@/state/focusHandoff";
import { useDocumentTitle } from "@/state/hooks";
import { useScrollToTop } from "@/state/scrollHooks";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class below is consumed by name, and this list is what the sheets owe the file.
 *
 * `src/styles/layout.css` owns the page: `sp-container` is the width and gutter every route sits in, `sp-page`
 * the column of blocks at one rhythm, `sp-page__body` the region the route's own content lands in, `sp-split`
 * the frame whose aside track is `--layout-aside-width` from the large stop, and `sp-stack` the rhythm the
 * summary's figures sit in. `src/styles/commerce.css` owns the checkout's register: `sp-checkout` widens that
 * frame's row gap and `sp-checkout__main` narrows the step column, while `sp-checkout__aside` — the summary
 * column, sticky below the header from the large stop — is declared in `src/styles/cart.css` beside the summary
 * panel it holds, whose register `src/styles/summary-panel.css` owns.
 *
 * The step shell is `sp-step` for the region, with `sp-step__header`, `sp-step__title` and `sp-step__count`
 * for the heading block, and `sp-step__body` for the region the current step renders in — the class the
 * shipping and payment forms also carry on their own roots, and the one the sheet dims and closes to the
 * pointer while the shell is `aria-busy`. The summary of what is wrong states its own register in
 * `src/features/checkout/CheckoutErrorSummary.tsx`, which owns that class. Each step's action row is
 * `sp-step__actions`, rendered by that step's own file, and the indicator is `CheckoutSteps`' family.
 *
 * The order summary panel the aside renders is `OrderSummaryPanel.tsx`'s, and that file's own comment holds its
 * class contract: the register the cart's own summary also draws, declared in `src/styles/cart.css`. Of that
 * register this file carries one class: `sp-summary__note`, the caption the step's supporting line is painted
 * in, which is why the table below keeps `note`.
 */

/** The classes this route puts on the page, written once so a rename is one edit. */
const CLASSES = {
  container: "sp-container",
  page: "sp-page",
  pageBody: "sp-page__body",
  frame: "sp-checkout sp-split",
  main: "sp-checkout__main",
  aside: "sp-checkout__aside",
  step: "sp-step",
  stepHeader: "sp-step__header",
  stepTitle: "sp-step__title",
  stepCount: "sp-step__count",
  stepBody: "sp-step__body",
  note: "sp-summary__note",
} as const;

/** The separator between a field and the group it sits in inside the flow's error map: `billing.city`. */
const FIELD_QUALIFIER_SEPARATOR = ".";

// Reading the step ------------------------------------------------------------------------------

/**
 * Whether a step is one of the three that own a form, read from the reducer's own list, not restated
 * here. The confirmation is not one: it holds a placed order and is no step a shopper works through.
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
 * What the step region stands in with at the confirmation, where the order is placed: the shapes a step's content
 * takes, announcing nothing, because the region holding it is what carries `aria-busy`.
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

// The route -------------------------------------------------------------------------------------

/**
 * The `/checkout` route: where the shopper is, the step they are working on, and what the order comes to.
 *
 * The route composes and it decides nothing. The step machine, the entered values, the price of the basket and
 * the order itself belong to `src/state/CheckoutContext.tsx`, which prices the basket as it changes, places the
 * order from the priced snapshot taken before completion and hands the cart its own clear; the order of the
 * steps belongs to `src/state/checkoutReducer.ts`; each step's fields and rules belong to that step's own file;
 * and every figure arrives already computed. What this file owns is the composition — the page's heading, the
 * indicator, the step shell with its heading, its count and its summary of what is wrong, the current step's
 * view, the order summary panel — and the one navigation a completed checkout takes.
 *
 * Each state is rendered where its own subject is. A basket with no lines cannot be checked out, so the route
 * offers the empty state with the one action that helps rather than a flow that could never complete — asked
 * before an order is placed, because completion empties the cart. The price request's placeholder and its
 * failure belong to the figures, so the order summary panel states them and its retry asks the flow again,
 * which leaves the step in hand mounted and usable while a newer quote is on its way.
 *
 * A placed order is handed to its own route rather than rendered here: the reducer moves the flow to its
 * confirmation and this page navigates to `orderConfirmationPath`, replacing the entry so the browser's back
 * button cannot re-enter a checkout that is already finished. For the instant that takes, the frame keeps its
 * indicator and the step region its placeholder.
 *
 * @returns The checkout route.
 */
export function CheckoutPage(): ReactElement {
  const {
    actions,
    errors,
    isSubmitting,
    order,
    pricingError,
    pricingStatus,
    refusals,
    snapshot,
    step,
  } = useCheckout();
  const { lines } = useCart();
  const navigate = useNavigate();

  /**
   * The region the current step renders in, so a summary message above can focus the control it names.
   */
  const stepBodyRef = useRef<HTMLDivElement>(null);

  /** The step's own heading: where a step change moves the keyboard, and what states which step is in hand. */
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  /** The step already announced, so the step this page opened on is not treated as a change to announce. */
  const announcedStepRef = useRef<CheckoutStep>(step);

  /** Names the step's position in the flow, so focusing its heading reports where in the flow it stands. */
  const stepCountId = useId();

  /*
   * The step region is the one this route hands the focus off to: the order summary panel's price failure
   * carries a retry, and that control leaves with the failure it reports, so the retry below arms the move.
   */
  const { regionRef, handOffFocus } = useFocusHandoff<HTMLDivElement>();
  /** The checkout cannot proceed without lines, and the cart is emptied the moment an order is placed — so an
   *  empty basket here is one the shopper arrived with, never the aftermath of their own order. */
  const isCartEmpty = lines.length === 0 && order === null;
  /** The step the previous commit stood on: a fact about that commit, not a reason to render. */
  const previousStepRef = useRef(step);
  /*
   * The step-boundary focus move. A changed step means the flow moved, which replaced the whole form the press was
   * in, so the focus the browser would drop onto the document body is claimed by the step region instead — without
   * the browser's own scroll, which would leave the indicator above the region behind the sticky header, and with
   * the page brought to the top, where the indicator and the new step's heading are both clear of it. A refused
   * submission does not change the step, and a focus the step indicator has already handed to its marker stands.
   */
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    if (document.activeElement !== document.body) return;
    regionRef.current?.focus({ preventScroll: true });
    window.scrollTo({ behavior: "instant", top: 0 });
  }, [regionRef, step]);

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
   * The view follows the flow rather than the step before it: a step change opens at the step's own top, so
   * its indicator, its heading and the summary of what is wrong above it are on screen. The value that names
   * the view is the flow's own `step`, so a return to an earlier step lands there the same way.
   */
  useScrollToTop(step);

  /*
   * A step change is announced once, from the step shell, because the control the shopper pressed leaves the
   * document with the advance: without the move below the keyboard falls back to the document body, and nothing
   * says which step is now on screen. The keyboard goes to the step's own heading — the element that names the
   * step — and `aria-describedby` carries its position in the flow alongside it, so one focus move announces
   * both what the step is and where it stands. The move takes no scroll with it: where the view sits is the
   * scroll above's decision, taken for this same step, and a focus-driven scroll would undo it.
   *
   * The step the page opened on is not a change, so the run that mounts moves nothing, and the confirmation —
   * where the flow places the order and this route hands over — has no heading of its own to move to, which the
   * optional read covers.
   */
  useEffect(() => {
    const announced = announcedStepRef.current;
    announcedStepRef.current = step;
    if (announced === step) return;
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  /* A placed order belongs to the confirmation route, which reads it by its identifier and survives a
   * reload, so this route's copy of it is a courtesy, not the source — and `reset`, the flow's one return to
   * a fresh first step, gives that copy up here, because a copy kept in a flow mounted for the whole document
   * would send every later entry to /checkout to the old confirmation, never to a second basket. */
  useEffect(() => {
    if (order === null) return;
    void navigate(orderConfirmationPath(order.id), { replace: true });
    actions.reset();
  }, [actions, navigate, order]);

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
    handOffFocus();
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
   * hand-over. The region states it so the sheet can dim what it holds and assistive technology can announce the
   * update. A price request does not make the region busy — the basket's figures are the summary panel's, and
   * replacing a form the shopper is typing in, or has just chosen a delivery method in, with a placeholder would
   * take the control they were using off the screen beneath them.
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

  /**
   * The labels the summary names its entries with, read from the step in hand's own field list: the shipping
   * step's contact and address controls, or the payment step's five card controls. A message the step's list
   * answers nothing for is not listed at all, which is what leaves a failure that names no control — a refused
   * card, held for the flow as a whole — to the one region that reports it.
   */
  const summaryFieldLabel = form?.step === "shipping" ? shippingFieldLabel : paymentFieldLabel;

  const body = isCartEmpty ? (
    <EmptyState actionHref={ROUTES.CATALOG} surface="cart" />
  ) : (
    <div className={CLASSES.frame}>
      <div className={CLASSES.main}>
        <CheckoutSteps currentStep={step} onStepSelect={selectStep} />
        <div aria-busy={isStepRegionBusy} className={CLASSES.step} ref={regionRef} tabIndex={-1}>
          {form === null ? null : (
            <div className={CLASSES.stepHeader}>
              <h2
                aria-describedby={stepCountId}
                className={CLASSES.stepTitle}
                ref={stepHeadingRef}
                tabIndex={-1}
              >
                {form.copy.heading}
              </h2>
              <p className={CLASSES.stepCount} id={stepCountId}>
                {stepProgressLabel(form.position, CHECKOUT_FORM_STEPS.length)}
              </p>
              <p className={CLASSES.note}>{form.copy.supporting}</p>
            </div>
          )}
          {showsErrorSummary ? (
            <CheckoutErrorSummary
              errors={errors}
              fieldLabel={summaryFieldLabel}
              onJumpToField={jumpToField}
              refusals={refusals}
              stepRef={stepBodyRef}
            />
          ) : null}
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
