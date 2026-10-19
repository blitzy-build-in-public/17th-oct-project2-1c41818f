/**
 * Path: src/features/checkout/ReviewOrder.tsx
 * Purpose: The review step: items, addresses, shipping, totals and payment restated before submission
 * Lines: 509
 */

import { useId, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { CHECKOUT_COPY, editSectionLabel } from "@/constants/checkoutCopy";
import { SHIPPING_METHODS } from "@/constants/config";
import {
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  appliedPromoLabel,
  freeShippingProgressLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { countryLabel } from "@/constants/taxonomy";
import { useCheckout } from "@/state/CheckoutContext";
import type { CheckoutActions, CheckoutView } from "@/state/CheckoutContext";
import { handOffThen, useFocusHandoff } from "@/components/ui/focusHandoff";
import { useRefusalFocus } from "@/state/focusHooks";
import type { AddressInput } from "@/types/account";
import type { ApiError, CurrencyCode } from "@/types/common";
import type { PricedCart, PricedCartLine } from "@/types/commerce";
import { formatFreeShippingRemaining, formatMoney, formatQuantity } from "@/utils/format";

/*
 * Class contract. `src/styles/commerce.css` owns this step: `sp-review`
 * for the grid each state of the step sits in — the step's own root, and the grid the sections sit in inside
 * it —
 * `sp-review__section` for one section (a heading, the edit control returning
 * to the step it came from, and the content beneath them) with `sp-review__edit` placing that control, and
 * `sp-review__list` with `sp-review__totals` for the compact lines' list and the totals block. The compact line
 * itself is `sp-review__item`, and the register the amounts read in is the order summary's — `sp-summary__title`,
 * `sp-summary__row` with its `--discount` and `--total` modifiers, `sp-summary__note`,
 * `sp-summary__progress-label` and `sp-summary__actions` for the single action band — which
 * `src/styles/summary-panel.css` owns, because the cart's own summary draws it. The sections use the sheet's
 * own frames rather than cards nested inside them: every region of a `Card` carries its own padding and
 * dividing rule, so a card per section would draw each divider and each padding band twice.
 */

/** The sign between a line's quantity and the price it is bought at: notation rather than wording. */
const QUANTITY_PRICE_SEPARATOR = "×";

/** The sign a saving carries before its amount, which the discount register leaves to the row's own markup. */
const DISCOUNT_SIGN = "−";

/** What a card's last four digits are shown behind; only that tail ever reaches the screen. */
const CARD_TAIL_MASK = "•••• ";

/** The amount row, in the three registers the summary sheet declares. */
const ROW_CLASS = "sp-summary__row";
const ROW_DISCOUNT_CLASS = "sp-summary__row sp-summary__row--discount";
const ROW_TOTAL_CLASS = "sp-summary__row sp-summary__row--total";

/** The steps an edit control may return the shopper to: the two that own a form, the review itself excepted. */
type ReviewStep = "shipping" | "payment";

/** The address members the review restates. `CheckoutShippingValues` and the `AddressInput` its billing group
 *  holds carry the same names, so this one projection reads either of them. */
type AddressFields = Omit<AddressInput, "label">;

/** One amount row: its label, its formatted figure, and the register it is painted in. */
type AmountRow = readonly [label: string, value: string, className: string];

/** Builds one amount row, so a row's shape is written once rather than at each of the rows below. */
function row(label: string, value: string, className: string): AmountRow {
  return [label, value, className];
}

/** One address as the lines it is read by, in postal order, skipping whatever was left empty. The projection is
 *  local because `addressLabel` in `src/lib/customerService.ts` names a stored `Address`, whose label and
 *  identifiers the checkout's own values do not carry. */
function addressLines(fields: AddressFields): readonly string[] {
  return [
    fields.fullName,
    fields.line1,
    fields.line2,
    `${fields.city}, ${fields.region} ${fields.postalCode}`,
    countryLabel(fields.country),
    fields.phone,
  ].filter((line) => line.trim() !== "");
}

/** A line's quantity and the unit price it was added at — both the priced line's own, never recomputed. */
function quantityAtPriceLabel(line: PricedCartLine, currency: CurrencyCode): string {
  const quantity = formatQuantity(line.quantity);
  const unitPrice = formatMoney(line.unitPriceMinor, currency);
  return `${quantity} ${QUANTITY_PRICE_SEPARATOR} ${unitPrice}`;
}

/** The tail of the card as typed at the payment step: its last four digits behind the mask. */
function cardTail(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits.length === 0 ? "" : `${CARD_TAIL_MASK}${digits.slice(-4)}`;
}

/**
 * The amounts the order will be placed for, built from the priced cart the review holds. Nothing is added up: each
 * figure is the one `src/lib/pricingService.ts` computed for this basket, which is what keeps the cart, this step
 * and the placed order's confirmation from disagreeing about the same basket. The discount row appears only where
 * a discount was taken and carries its sign as markup; the codes that earned it are named beneath the rows.
 *
 * @param snapshot - The priced cart the buyer is confirming.
 * @returns The rows to render, in the order an order reads them.
 */
function amountRows(snapshot: PricedCart): readonly AmountRow[] {
  const { currency, discountTotalMinor, grandTotalMinor, shippingMinor, subtotalMinor, taxMinor } =
    snapshot;
  return [
    row(CART_COPY.SUMMARY_SUBTOTAL_LABEL, formatMoney(subtotalMinor, currency), ROW_CLASS),
    ...(discountTotalMinor > 0
      ? [
          row(
            CART_COPY.SUMMARY_DISCOUNT_LABEL,
            `${DISCOUNT_SIGN}${formatMoney(discountTotalMinor, currency)}`,
            ROW_DISCOUNT_CLASS,
          ),
        ]
      : []),
    row(CART_COPY.SUMMARY_SHIPPING_LABEL, formatMoney(shippingMinor, currency), ROW_CLASS),
    row(CART_COPY.SUMMARY_TAX_LABEL, formatMoney(taxMinor, currency), ROW_CLASS),
    row(CART_COPY.SUMMARY_TOTAL_LABEL, formatMoney(grandTotalMinor, currency), ROW_TOTAL_CLASS),
  ];
}

/** The control that returns the shopper to the step a section's values were entered at: a real button rather than
 *  a link, because it moves within the flow instead of navigating, so every group of values stays as entered. Its
 *  name says which section it edits, so no bare "Edit" reaches a screen reader. */
function SectionEdit({
  heading,
  step,
  onEdit,
}: {
  readonly heading: string;
  readonly step: ReviewStep;
  readonly onEdit: (step: ReviewStep) => void;
}): ReactElement {
  const returnToStep = (): void => {
    onEdit(step);
  };
  return (
    <Button
      className="sp-review__edit"
      variant="link"
      size="sm"
      type="button"
      onClick={returnToStep}
    >
      {editSectionLabel(heading)}
    </Button>
  );
}

/** Everything {@link ReviewSection} renders from. */
interface ReviewSectionProps {
  readonly heading: string;
  /** What the section states, rendered across the section's width. */
  readonly children: ReactNode;
  /** A control of the section's own, for one the flow itself does not provide an edit step for. */
  readonly edit?: ReactNode;
  /** The step that owns what the section states, when it offers a control returning there. */
  readonly editStep?: ReviewStep;
  /** What returning to that step does; required whenever `editStep` is given. */
  readonly onEdit?: (step: ReviewStep) => void;
}

/** One restated section: its heading, the control that edits what it states, and what it states beneath them. */
function ReviewSection({
  heading,
  children,
  edit,
  editStep,
  onEdit,
}: ReviewSectionProps): ReactElement {
  const editControl =
    editStep === undefined || onEdit === undefined ? (
      edit
    ) : (
      <SectionEdit heading={heading} step={editStep} onEdit={onEdit} />
    );
  return (
    <section className="sp-review__section">
      <h3 className="sp-summary__title">{heading}</h3>
      {editControl}
      {children}
    </section>
  );
}

/** One address as the lines it is read by, with its own label where the section's heading does not name it. A
 *  block per line rather than a run broken by `<br>`, and a plain element rather than `<address>`, whose
 *  browser's own italic no stylesheet in this product cancels. */
function AddressBlock({
  label,
  lines,
}: {
  readonly label?: string;
  readonly lines: readonly string[];
}): ReactElement {
  return (
    <div className="sp-summary__note">
      {label === undefined ? null : <p>{label}</p>}
      {lines.map((line, index) => (
        <p key={`${String(index)}-${line}`}>{line}</p>
      ))}
    </div>
  );
}

/** The placeholder the step stands in with while the basket is priced: the shapes the sections will take, because
 *  a total that has not been quoted is not a total of zero. The region holding it carries `aria-busy`. */
function ReviewSkeleton(): ReactElement {
  return (
    <div className="sp-review" aria-busy="true">
      <Skeleton variant="heading" width="18ch" />
      <Skeleton variant="text" lines={3} />
      <Skeleton variant="card" />
      <Skeleton variant="text" lines={2} />
      <Skeleton variant="card" />
    </div>
  );
}

/** The state a failed price request shows: the failure the seam shaped, in the danger register, with the retry
 *  that asks for the figures again. No `try`/`catch` surrounds the request, because the seam reports failures as
 *  values and the flow already holds the one it received. */
function PricingFailure({
  error,
  onRetry,
}: {
  readonly error: ApiError;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <div className="sp-review">
      <Alert tone="danger" error={error} actionLabel={COMMON_ACTIONS.RETRY} onAction={onRetry} />
      <p className="sp-summary__note">{FEEDBACK_COPY.ERROR_STATE_HINT}</p>
    </div>
  );
}

/** The checkout as this step reads it: the flow's view, with the actions that move it on. */
type ReviewFlow = CheckoutView & { readonly actions: CheckoutActions };

/** Everything {@link ReviewSummary} renders from. */
interface ReviewSummaryProps {
  /** The flow: the values entered, the submission's state, and the actions that change either. */
  readonly flow: ReviewFlow;
  /** The priced cart the buyer is confirming, which every figure below is read from. */
  readonly snapshot: PricedCart;
  /** The identifier the submission notice carries, so the submit control can describe itself with it. */
  readonly noticeId: string;
  /** The arming call this step's root hands the submission: the submit control disables itself while the request
   *  is in flight, so the focus it gives up is claimed by the region that survives the submission. */
  readonly handOffFocus: () => void;
}

/**
 * What the order will record, restated in the sections that make it up: the items, the addresses it keeps, the
 * delivery method, how it is paid for, and what it comes to. Every figure comes from the priced cart the flow
 * holds and nothing is computed here, because a second implementation of that arithmetic is how two screens come
 * to disagree about what an order costs. The one failure this step can carry is the submission's own, and the
 * control that resolves it is the submit control itself, so exactly one control places the order.
 *
 * @param props - The flow, the priced cart it produced and the notice's identifier.
 * @returns The review's sections and its single action band.
 */
function ReviewSummary({
  flow,
  snapshot,
  noticeId,
  handOffFocus,
}: ReviewSummaryProps): ReactElement {
  const { actions, canSubmit, error, isSubmitting, values } = flow;
  const { appliedPromos, currency, freeShippingRemainingMinor, shippingMethodId, shippingMinor } =
    snapshot;
  /**
   * The region the refusal is stated in, which is what a refused order hands the keyboard to: the alert mounts
   * at the top of a review longer than most viewports, so without the move the refusal is announced from above
   * the place the buyer is looking.
   */
  const failureRef = useRef<HTMLDivElement | null>(null);

  // The trigger is the failure itself rather than whether one is standing: every refused submission is
  // answered with an `ApiError` of its own, so pressing the order control again after a refusal takes the
  // keyboard back to the notice, while a re-render that changes nothing about the failure moves nothing.
  useRefusalFocus(error, failureRef);
  const method = SHIPPING_METHODS.find((candidate) => candidate.id === shippingMethodId);
  /**
   * What the free-delivery band says, read from the two figures the pricing service already settled: what is
   * still owed before the threshold is met, and what delivery actually costs. The earned sentence is shown
   * only when nothing is charged for delivery, because a basket that qualifies on one service while the
   * chosen one charges would otherwise read as free directly above the charge it is paying.
   */
  const deliveryLabel =
    freeShippingRemainingMinor > 0
      ? freeShippingProgressLabel(formatFreeShippingRemaining(freeShippingRemainingMinor, currency))
      : shippingMinor > 0
        ? null
        : CART_COPY.FREE_DELIVERY_EARNED_LABEL;

  /** The single submission path. `submit` resolves rather than rejecting — the flow reports the outcome through
   *  its view — so its promise is deliberately not awaited, while the control is disabled as it runs. The handoff
   *  is armed first, because that disabled control is what gives the focus up, in the commit that starts the
   *  request, and both a placed order and a refused one leave the reader inside this step's own root. */
  const submitOrder = (): void => {
    handOffFocus();
    void actions.submit();
  };

  /** Returns to the step a section's values were entered at, which the flow performs itself. */
  const editStep = (step: ReviewStep): void => {
    actions.setStep(step);
  };

  return (
    <>
      {error === null ? null : (
        <div ref={failureRef} tabIndex={-1}>
          <Alert tone="danger" title={CHECKOUT_COPY.ERROR_SUMMARY_HEADING} error={error} />
        </div>
      )}
      <div className="sp-review">
        <ReviewSection
          heading={CHECKOUT_COPY.REVIEW_ITEMS_HEADING}
          edit={
            <Link className="sp-btn sp-btn--link sp-btn--sm sp-review__edit" to={ROUTES.CART}>
              {CHECKOUT_COPY.BACK_TO_CART_LABEL}
            </Link>
          }
        >
          <ul className="sp-review__list" role="list">
            {snapshot.lines.map((line) => (
              <li className="sp-review__item" key={line.id}>
                <span>{line.name}</span>
                <span>{line.sku}</span>
                <span>{quantityAtPriceLabel(line, currency)}</span>
                {line.discountMinor > 0 ? (
                  <span>
                    {`${CART_COPY.SUMMARY_DISCOUNT_LABEL} ${DISCOUNT_SIGN}${formatMoney(
                      line.discountMinor,
                      currency,
                    )}`}
                  </span>
                ) : null}
                <span>{formatMoney(line.lineTotalMinor, currency)}</span>
              </li>
            ))}
          </ul>
        </ReviewSection>
        <ReviewSection
          heading={CHECKOUT_COPY.REVIEW_SHIPPING_HEADING}
          editStep="shipping"
          onEdit={editStep}
        >
          <AddressBlock lines={addressLines(values.shipping)} />
          {values.shipping.billingSameAsShipping ? null : (
            <AddressBlock
              label={CHECKOUT_COPY.REVIEW_BILLING_HEADING}
              lines={addressLines(values.shipping.billing)}
            />
          )}
        </ReviewSection>
        <ReviewSection
          heading={CHECKOUT_COPY.REVIEW_DELIVERY_METHOD_HEADING}
          editStep="shipping"
          onEdit={editStep}
        >
          <p className="sp-review__item">
            <span>{method?.name ?? CART_COPY.SUMMARY_SHIPPING_LABEL}</span>
            <span>{formatMoney(shippingMinor, currency)}</span>
          </p>
          {method === undefined ? null : <p className="sp-summary__note">{method.description}</p>}
        </ReviewSection>
        <ReviewSection
          heading={CHECKOUT_COPY.REVIEW_PAYMENT_HEADING}
          editStep="payment"
          onEdit={editStep}
        >
          <p className="sp-review__item">
            <span>{values.payment.nameOnCard}</span>
            <span>{cardTail(values.payment.number)}</span>
          </p>
        </ReviewSection>
        <ReviewSection heading={CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING}>
          <div className="sp-review__totals">
            {deliveryLabel === null ? null : (
              <p className="sp-summary__progress-label">{deliveryLabel}</p>
            )}
            {amountRows(snapshot).map(([label, value, className]) => (
              <div className={className} key={label}>
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
          {appliedPromos.length === 0 ? null : (
            <div className="sp-summary__note">
              {appliedPromos.map((promo) => (
                <p key={promo.code}>{appliedPromoLabel(promo.code)}</p>
              ))}
            </div>
          )}
        </ReviewSection>
      </div>
      <div className="sp-summary__actions">
        <Button
          type="button"
          variant="primary"
          isBlock
          disabled={!canSubmit}
          isLoading={isSubmitting}
          aria-describedby={isSubmitting ? noticeId : undefined}
          onClick={submitOrder}
        >
          {/*
            The in-flight wording is the control's own visible label rather than `Button`'s
            `loadingLabel`, which that component renders inside a visually hidden span and excludes from
            the name it pins to the label element: a control that keeps saying "Place order" while the
            order is being placed tells a shopper nothing, so the same words a reader hears are the ones
            on screen.
          */}
          {isSubmitting ? CHECKOUT_COPY.SUBMITTING_LABEL : CHECKOUT_COPY.PLACE_ORDER_LABEL}
        </Button>
        {isSubmitting ? (
          <p className="sp-summary__note" id={noticeId}>
            {CHECKOUT_COPY.DUPLICATE_SUBMISSION_NOTICE}
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * Which of the four states the step renders: a basket being priced, a price request that failed, a basket with
 * nothing in it to confirm, and the review itself.
 *
 * The failure is read before the empty state, because a failure is not emptiness: a request that never answered
 * leaves a basket whose figures are unknown, and "your cart is empty" would state something untrue about the cart
 * the shopper filled. A superseded answer never reaches this decision, because the flow aborts it.
 *
 * @param flow - The flow, as the provider publishes it.
 * @param noticeId - The identifier the submission notice carries.
 * @param handOffFocus - The arming call the retry makes, because that control leaves with the alert it sits in.
 * @returns The element the step renders.
 */
function reviewBody(flow: ReviewFlow, noticeId: string, handOffFocus: () => void): ReactElement {
  if (flow.pricingStatus === "loading") return <ReviewSkeleton />;
  if (flow.pricingError !== null) {
    // Armed before the flow is asked again: the newer quote replaces this failure, and the alert carrying the
    // control the reader just pressed with it, so the focus it gives up lands on the root that outlives both.
    const retryPricing = handOffThen(handOffFocus, (): void => {
      flow.actions.retryPricing();
    });
    return <PricingFailure error={flow.pricingError} onRetry={retryPricing} />;
  }
  if (flow.snapshot === null) {
    return <EmptyState surface="cart" actionHref={ROUTES.CATALOG} headingLevel={3} />;
  }
  return (
    <ReviewSummary
      flow={flow}
      snapshot={flow.snapshot}
      noticeId={noticeId}
      handOffFocus={handOffFocus}
    />
  );
}

/**
 * The review step of the checkout: everything the order will record, restated once, before it is placed.
 *
 * The step reads the checkout's own flow and renders from it alone, and writes nothing: it prices nothing, builds
 * no order and mints no key, because the flow's `submit` takes the snapshot, sends it under the key the flow
 * minted for this attempt, and hands the cart its own clear once the order is placed.
 *
 * @returns The root of the step's content: the placeholder, the empty state, the failure or the review itself.
 */
export function ReviewOrder(): ReactElement {
  const flow = useCheckout();
  const noticeId = useId();

  /*
   * The region this step's own actions hand the focus off to, and the call that arms the move.
   *
   * Two controls in this step take the focus down with them: the submit disables itself for as long as the
   * request runs, so the commit that starts the attempt gives the focus the browser held on it back to the
   * document, and the price failure's retry leaves with the alert it sits in the moment a newer quote puts this
   * step back on its placeholder. Both outcomes land in this step, whose states render a root each, so the one
   * element that survives all of them is the root below: it is the step's whole body, it takes the focus without
   * joining the tab order, and the shell's own step heading names the place the reader lands in. A placed order
   * unmounts the step and leaves the route change to move the focus, which is what the shell does for it.
   */
  const { regionRef, handOffFocus } = useFocusHandoff<HTMLDivElement>();

  return (
    <div className="sp-review" ref={regionRef} tabIndex={-1}>
      {reviewBody(flow, noticeId, handOffFocus)}
    </div>
  );
}
