/**
 * Path: src/features/checkout/ReviewOrder.tsx
 * Purpose: The review step: items, addresses, shipping, totals and payment restated before submission
 * Lines: 462
 */

import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { SHIPPING_METHODS } from "@/constants/config";
import {
  CART_COPY,
  CHECKOUT_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  appliedPromoLabel,
  editSectionLabel,
  freeShippingProgressLabel,
} from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SUPPORTED_COUNTRIES } from "@/constants/taxonomy";
import { useCheckout } from "@/state/CheckoutContext";
import type { CheckoutActions, CheckoutView } from "@/state/CheckoutContext";
import type { AddressInput } from "@/types/account";
import type { ApiError, CurrencyCode } from "@/types/common";
import type { PricedCart, PricedCartLine } from "@/types/commerce";
import { formatFreeShippingRemaining, formatMoney, formatQuantity } from "@/utils/format";

/*
 * Class contract, consumed by name because no file under `src/features/**` imports a stylesheet — `src/main.tsx`
 * is the only importer of `src/styles/**`. `src/styles/commerce.css` owns this step: `sp-review` for the grid the
 * sections sit in, `sp-review__section` for one section (a heading, the edit control returning to the step it came
 * from, and the content beneath them) with `sp-review__edit` placing that control, `sp-review__list` and
 * `sp-review__item` for the compact lines, `sp-review__totals` over the summary register (`sp-summary__title`,
 * `sp-summary__row` with its `--discount` and `--total` modifiers, `sp-summary__note`,
 * `sp-summary__progress-label`), and `sp-summary__actions` for the single action band. The sections use the
 * sheet's own frames rather than cards nested inside them: every region of a `Card` carries its own padding and
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

/**
 * The heading the billing address is restated under when it differs from the shipping one.
 *
 * `src/constants/content.ts` names a shipping address (`CHECKOUT_COPY.REVIEW_SHIPPING_HEADING`) and no
 * counterpart for the billing one, and a generated file is added to rather than rewritten, so the label of the
 * second address an order keeps is stated once, here. Leaving it unsaid would restate only one of the two.
 */
const BILLING_ADDRESS_HEADING = "Billing address";

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

/** The country a code names, from the product's one list of supported countries; a code the list does not carry
 *  reads as itself rather than as nothing. */
function countryLabel(code: string): string {
  return SUPPORTED_COUNTRIES.find((country) => country.code === code)?.label ?? code;
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
function ReviewSummary({ flow, snapshot, noticeId }: ReviewSummaryProps): ReactElement {
  const { actions, canSubmit, error, isSubmitting, values } = flow;
  const { appliedPromos, currency, freeShippingRemainingMinor, shippingMethodId, shippingMinor } =
    snapshot;
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
   *  its view — so its promise is deliberately not awaited, while the control is disabled as it runs. */
  const submitOrder = (): void => {
    void actions.submit();
  };

  /** Returns to the step a section's values were entered at, which the flow performs itself. */
  const editStep = (step: ReviewStep): void => {
    actions.setStep(step);
  };

  return (
    <>
      {error === null ? null : (
        <Alert tone="danger" title={CHECKOUT_COPY.ERROR_SUMMARY_HEADING} error={error} />
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
              label={BILLING_ADDRESS_HEADING}
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
          loadingLabel={CHECKOUT_COPY.SUBMITTING_LABEL}
          aria-describedby={isSubmitting ? noticeId : undefined}
          onClick={submitOrder}
        >
          {CHECKOUT_COPY.PLACE_ORDER_LABEL}
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
 * @returns The element the step renders.
 */
function reviewBody(flow: ReviewFlow, noticeId: string): ReactElement {
  if (flow.pricingStatus === "loading") return <ReviewSkeleton />;
  if (flow.pricingError !== null) {
    const retryPricing = (): void => {
      flow.actions.retryPricing();
    };
    return <PricingFailure error={flow.pricingError} onRetry={retryPricing} />;
  }
  if (flow.snapshot === null) {
    return <EmptyState surface="cart" actionHref={ROUTES.CATALOG} headingLevel={3} />;
  }
  return <ReviewSummary flow={flow} snapshot={flow.snapshot} noticeId={noticeId} />;
}

/**
 * The review step of the checkout: everything the order will record, restated once, before it is placed.
 *
 * The step reads the checkout's own flow and renders from it alone, and writes nothing: it prices nothing, builds
 * no order and mints no key, because the flow's `submit` takes the snapshot, sends it under the key the flow
 * minted for this attempt, and hands the cart its own clear once the order is placed.
 *
 * @returns The step's content, or the placeholder, the empty state or the failure the flow is in.
 */
export function ReviewOrder(): ReactElement {
  const flow = useCheckout();
  const noticeId = useId();
  return reviewBody(flow, noticeId);
}
