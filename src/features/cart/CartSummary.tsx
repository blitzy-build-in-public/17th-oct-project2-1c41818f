/**
 * Path: src/features/cart/CartSummary.tsx
 * Purpose: Totals panel with promo-code entry, discount lines and free-shipping progress
 * Lines: 435
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert, ProgressBar, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import {
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  appliedPromoLabel,
  freeShippingProgressLabel,
  removePromoLabel,
} from "@/constants/content";
import {
  selectDiscountTotalMinor,
  selectFreeShippingProgress,
} from "@/features/cart/cartSelectors";
import { normalisePromoCode, promoRejectionMessage, validatePromoCode } from "@/lib/pricingService";
import { useCart, useCartDispatch } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import type { ApiError, AsyncStatus, FieldErrors } from "@/types/common";
import type { PricedCart } from "@/types/commerce";
import { formatMoney } from "@/utils/format";
import {
  clearFieldError,
  fieldErrored,
  fieldErrorsFromApiError,
  hasErrors,
  validatePromoCodeShape,
} from "@/utils/validation";

/*
 * Class contract, consumed by name because no file under `src/features/**` imports a stylesheet —
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/summary-panel.css` owns this
 * panel's register, split out of `src/styles/commerce.css`, which loads it with `@import`: `sp-summary`
 * with its padding and rhythm, `sp-summary__title`, `sp-summary__promo` (the field, its apply control,
 * the reason, the applied code's row and the notice, each placed as a row of the band — the label and the
 * control of the field and the apply control on the band's own two columns, and the reason, the applied row
 * and the notice spanning both), `sp-summary__applied` for the applied code with the control that withdraws
 * it, `sp-summary__row` with its `--discount` and `--total` modifiers, and `sp-summary__progress` for the
 * free-delivery band. `src/styles/layout.css` contributes `sp-stack`, the rhythm the figures sit in on the
 * definition list that holds the amount rows, so the region wrapped around them costs the rows none of the
 * panel's spacing, and `src/styles/base.css` contributes `sp-visually-hidden`, which keeps the announcement
 * out of sight while leaving it in the accessibility tree.
 */

/** The control a promo rule and a promo failure both key their message to, as the seam names it. */
const PROMO_CODE_FIELD = "promoCode";

/** The sign a saving carries before its amount. The summary register's discount modifier paints the value
 *  in the success pair and leaves the sign to the markup. */
const DISCOUNT_SIGN = "−";

/** How many placeholder lines stand in for the amount rows a price in flight will replace. */
const PLACEHOLDER_ROW_COUNT = 5;

/** The register each amount row renders in, as the summary sheet names its two modifiers. */
const ROW_MODIFIER_CLASSES = {
  discount: "sp-summary__row--discount",
  total: "sp-summary__row--total",
} as const;

/**
 * Everything {@link CartSummary} renders against.
 *
 * The panel is handed its figures rather than fetching them: `CartPage.tsx` owns the cart slice's pricing
 * request, so this component displays the priced cart it is given and asks the pricing service only whether
 * a code the shopper types can be applied to it.
 */
export interface CartSummaryProps {
  /** The priced basket, or `null` before one has been produced. */
  readonly pricedCart: PricedCart | null;
  /** The lifecycle of the pricing request that produced it. */
  readonly status: AsyncStatus;
  /** The failure that request met, or `null`; the panel's figures state it with a retry. */
  readonly error?: ApiError | null;
  /** Runs the pricing request again, for the retry the failure state offers. */
  readonly onRetry: () => void;
}

/**
 * The placeholder the figures region stands in with while the basket holds no price at all: the shared
 * skeleton rather than zeroes, because a total that has not been quoted is not `$0.00`. It is the first
 * load's state alone — a re-price keeps the figures it is replacing — and the skeleton is silent, so the
 * figures region holding it is what carries `aria-busy` for as long as the price is in flight.
 *
 * @returns The stacked placeholder lines.
 */
function SummaryPlaceholder(): ReactElement {
  return <Skeleton lines={PLACEHOLDER_ROW_COUNT} variant="text" width="100%" />;
}

/**
 * How far the basket is from free delivery, as the bar and its sentence.
 *
 * Both figures come from the pricing service through `selectFreeShippingProgress`, which owns the
 * threshold: the sentence states the shortfall it computed and the bar is filled to the share of the
 * threshold it reports, so the sentence, the bar and the delivery charge the shopper is quoted cannot
 * disagree. The remaining amount is formatted here, because formatting is the view's job.
 *
 * The bar carries the sentence as its label, so no value text is passed beside it: the sentence already
 * holds the formatted figure, and the bar would otherwise state it twice.
 *
 * @param props - The priced basket whose free-delivery position is reported.
 * @returns The free-delivery band.
 */
function FreeDeliveryProgress({ pricedCart }: { readonly pricedCart: PricedCart }): ReactElement {
  const progress = selectFreeShippingProgress(pricedCart);
  const label = progress.qualifies
    ? CART_COPY.FREE_DELIVERY_EARNED_LABEL
    : freeShippingProgressLabel(formatMoney(progress.remainingMinor, pricedCart.currency));

  return (
    <ProgressBar className="sp-summary__progress" label={label} max={1} value={progress.ratio} />
  );
}

/** Everything {@link SummaryRow} renders from. */
interface SummaryRowProps {
  /** What the amount is, from the copy library or from an applied promo's own label. */
  readonly label: string;
  /** The amount, already formatted by `src/utils/format.ts`. */
  readonly value: string;
  /** The register the row is painted in: a saving, or the total. */
  readonly modifier?: "discount" | "total";
}

/**
 * One amount row: what it is on the leading edge and the figure on the trailing one, as the term and the
 * definition of a definition list so the pair is exposed rather than left to the visual alignment.
 *
 * The row holds no figure of its own — the amount arrives formatted — so this panel has one place that
 * decides how an amount row looks and no row can drift from the others.
 *
 * @param props - The row's label, its formatted amount and the register it sits in.
 * @returns The row.
 */
function SummaryRow({ label, value, modifier }: SummaryRowProps): ReactElement {
  const className =
    modifier === undefined
      ? "sp-summary__row"
      : `sp-summary__row ${ROW_MODIFIER_CLASSES[modifier]}`;

  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * The basket's amounts, read from the priced cart and formatted here and only here.
 *
 * Nothing is added up: every figure is the one `src/lib/pricingService.ts` computed, which is what keeps the
 * cart, the checkout and a placed order from disagreeing about the same basket. Each applied code gets its
 * own row naming it and the amount it took off the goods, with the total discount row beneath a run of them.
 * A code's amount is shown as the priced cart carries it, `0` included: a free-delivery code's saving is on
 * the delivery charge, so its goods discount is genuinely nothing rather than a figure this panel invents.
 *
 * The delivery row states a charge only once a method has been chosen. Before that the priced cart is priced
 * against the fallback method, whose charge is not a quote the shopper has been given, so the row says where
 * the figure comes from instead of promising one.
 *
 * @param props - The priced basket.
 * @returns The free-delivery band and the amount rows, as the definition list pairing each label with its
 *   figure.
 */
function SummaryRows({ pricedCart }: { readonly pricedCart: PricedCart }): ReactElement {
  const { appliedPromos, currency, grandTotalMinor, shippingMinor, subtotalMinor, taxMinor } =
    pricedCart;
  const showsDeliveryCharge = pricedCart.shippingMethodId !== null;

  return (
    <dl className="sp-stack">
      <FreeDeliveryProgress pricedCart={pricedCart} />
      <SummaryRow
        label={CART_COPY.SUMMARY_SUBTOTAL_LABEL}
        value={formatMoney(subtotalMinor, currency)}
      />
      {appliedPromos.map((promo) => (
        <SummaryRow
          key={promo.code}
          label={promo.label}
          modifier="discount"
          value={`${DISCOUNT_SIGN}${formatMoney(promo.amountMinor, currency)}`}
        />
      ))}
      {appliedPromos.length > 1 ? (
        <SummaryRow
          label={CART_COPY.SUMMARY_DISCOUNT_LABEL}
          modifier="discount"
          value={`${DISCOUNT_SIGN}${formatMoney(selectDiscountTotalMinor(pricedCart), currency)}`}
        />
      ) : null}
      <SummaryRow
        label={CART_COPY.SUMMARY_SHIPPING_LABEL}
        value={
          showsDeliveryCharge
            ? formatMoney(shippingMinor, currency)
            : CART_COPY.SUMMARY_SHIPPING_AT_CHECKOUT_LABEL
        }
      />
      <SummaryRow label={CART_COPY.SUMMARY_TAX_LABEL} value={formatMoney(taxMinor, currency)} />
      <SummaryRow
        label={CART_COPY.SUMMARY_TOTAL_LABEL}
        modifier="total"
        value={formatMoney(grandTotalMinor, currency)}
      />
    </dl>
  );
}

/**
 * The cart's totals panel: what the basket comes to, the code that reduces it, and how far it is from free
 * delivery.
 *
 * Every amount it states is read from the priced cart the page handed it and nothing is computed here — not
 * a subtotal, not a discount, not a threshold comparison. What it does own is the promo entry: a code is
 * normalised, its shape judged through `src/utils/validation.ts` and the code then checked against this
 * basket through `src/lib/pricingService.ts`; only a code the seam accepted is stored on the cart, and a
 * refused one is refused against the field the code was typed into, so the words that say why are the field's
 * own message, which marks the control invalid and describes it. A code the seam accepted is stated on the panel
 * together with the control that withdraws it, because a saving can be taken off as readily as it was put on —
 * and taking it off is what returns the basket to the figures it carried before the code was applied.
 *
 * The panel keeps rendering while its figures do not: the title and the promo entry stand whatever the
 * pricing request is doing, so a shopper can correct a rejected code at any moment. The figures follow the
 * states every data-backed surface renders, in this precedence — the failure with its retry takes the
 * region whatever else is in hand, the amounts the price last answered with stand through the re-price a
 * shopper's own edit asked for, a placeholder rather than zeroes stands while no price exists yet, and the
 * amounts of a settled price are the loaded state — in a plain figures region that carries the busy state,
 * with the panel's own polite status node beside it. A re-price is announced once, by that node and as the
 * basket's new total on its own, so the announcement states what changed instead of reading every row out
 * again, and never moves the focus the shopper is using.
 *
 * The amounts are a definition list: each row states its label as the term and its formatted figure as the
 * definition, so the two are one pair to a reader who cannot see the column's alignment rather than two loose
 * runs of text. The free-delivery band the rows open with is not a pair and rides inside the same list, which
 * is the element carrying the rhythm, so neither the spacing nor the announcement changed with the structure.
 *
 * @param props - The priced basket, the request's lifecycle and the retry the failure state offers.
 * @returns The summary panel.
 */
export function CartSummary({
  pricedCart,
  status,
  error = null,
  onRetry,
}: CartSummaryProps): ReactElement {
  // The lines a typed code is checked against come from the cart's own state rather than from a copy: a
  // code's floor and its eligible goods are properties of the basket as it stands. The applied code comes
  // from there too, so the row naming it and the control that withdraws it state what the cart holds rather
  // than a copy this panel could drift from.
  const { lines, promoCode } = useCart();
  // Read as the object rather than destructured, because the interface declares its members as methods.
  const cartActions = useCartDispatch();
  const toasts = useToast();

  const headingId = useId();
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  /** How many checks have started, so an answer a newer check or an unmount superseded is dropped. */
  const attemptRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  /** The promo control itself, so withdrawing a code through the row beside it can put focus back on the
   *  field that row was reached from. */
  const promoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      // A check still in flight when the panel leaves the tree is aborted and its answer discarded.
      attemptRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const isLoading = status === "loading";
  // The one figure a cart change moves, and the whole of what the panel announces: a new quantity, a code or
  // a delivery method moves the total, while every row around it says the same thing again. A price in flight
  // and a price that failed both leave the priced cart null, so nothing is stated until a total exists.
  const totalAnnouncement =
    pricedCart === null
      ? ""
      : `${CART_COPY.SUMMARY_TOTAL_LABEL} ${formatMoney(
          pricedCart.grandTotalMinor,
          pricedCart.currency,
        )}`;

  const changeCode = (event: ChangeEvent<HTMLInputElement>): void => {
    setCode(event.target.value);
    // The messages go as the shopper corrects the code rather than standing until the next submission: the
    // field's own reason and a refusal that named no field are both about the code being edited.
    setFieldErrors((errors) => clearFieldError(errors, PROMO_CODE_FIELD));
    setNotice(null);
  };

  const checkPromoCode = async (): Promise<void> => {
    // A code is matched case-insensitively while its accepted shape is upper-case, so what a shopper typed
    // is normalised before anything judges it — through the rule's one home, which the request that
    // validates and prices the code is handed as well.
    const normalised = normalisePromoCode(code) ?? "";
    setFieldErrors({});
    setNotice(null);
    const shapeErrors = validatePromoCodeShape(normalised);
    if (hasErrors(shapeErrors)) {
      setFieldErrors(shapeErrors);
      return;
    }

    attemptRef.current += 1;
    const attempt = attemptRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsChecking(true);
    const result = await validatePromoCode(normalised, lines, { signal: controller.signal });
    if (attemptRef.current !== attempt) return;
    setIsChecking(false);

    if (result.ok) {
      // The code is stored on the cart, which owns that state; the page re-prices from there.
      cartActions.applyPromoCode(result.value.code);
      setCode("");
      toasts.success(FEEDBACK_COPY.TOAST_PROMO_APPLIED);
      return;
    }

    // A code the seam refused was refused for the code the shopper typed into this field, so the reason is
    // filed against the field rather than stated in the band: the field's own message is what marks the
    // control invalid and describes it, which is how the reason reaches the input and the sheet's invalid
    // treatment instead of standing over it unattached.
    const reason = promoRejectionMessage(result.error);
    if (reason !== undefined) {
      setFieldErrors({ [PROMO_CODE_FIELD]: reason });
      return;
    }
    // A failure that is not one of the reasons a code is refused names the control it belongs to, so it is
    // filed there; one naming no control is stated in the band, where a form-wide message belongs.
    const mapped = fieldErrorsFromApiError(result.error);
    if (fieldErrored(mapped, PROMO_CODE_FIELD)) {
      setFieldErrors(mapped);
      return;
    }
    setNotice(result.error.message);
  };

  const withdrawPromoCode = (): void => {
    cartActions.applyPromoCode(null);
    setFieldErrors({});
    setNotice(null);
    // The control that was just used leaves the document with the code it withdrew, so focus is put on
    // the field the shopper would use next rather than dropped onto the body.
    promoInputRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void checkPromoCode();
  };

  const renderFigures = (): ReactElement => {
    // The failure is stated before any figures, stale ones included: a basket whose price could not be
    // quoted is not a basket to show an earlier price for, and the alert's retry is the way on from it.
    if (error !== null) {
      return (
        <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={onRetry} tone="danger" />
      );
    }
    // The amounts stand for as long as a price does, including through the re-price a shopper's own edit
    // asks for: the region reports that wait with `aria-busy`, so the panel they were reading is never
    // emptied and refilled around them. Only a basket no price exists for yet has nothing to keep, and
    // that first load is the one state the placeholder is for.
    if (pricedCart !== null) return <SummaryRows pricedCart={pricedCart} />;
    return <SummaryPlaceholder />;
  };

  return (
    <Card aria-labelledby={headingId} as="section" className="sp-summary">
      <h2 className="sp-summary__title" id={headingId}>
        {CART_COPY.SUMMARY_HEADING}
      </h2>
      <form className="sp-summary__promo" noValidate onSubmit={handleSubmit}>
        <Input
          ref={promoInputRef}
          autoComplete="off"
          errors={fieldErrors}
          label={CART_COPY.PROMO_FIELD_LABEL}
          name={PROMO_CODE_FIELD}
          onChange={changeCode}
          placeholder={CART_COPY.PROMO_PLACEHOLDER}
          spellCheck={false}
          value={code}
        />
        <Button isLoading={isChecking} type="submit" variant="secondary">
          {CART_COPY.PROMO_APPLY_LABEL}
        </Button>
        {promoCode === null ? null : (
          <div className="sp-summary__applied">
            <span>{appliedPromoLabel(promoCode)}</span>
            <Button
              aria-label={removePromoLabel(promoCode)}
              onClick={withdrawPromoCode}
              variant="link"
            >
              {COMMON_ACTIONS.REMOVE}
            </Button>
          </div>
        )}
        {notice === null ? null : <Alert tone="warning">{notice}</Alert>}
      </form>
      <div aria-busy={isLoading}>{renderFigures()}</div>
      {/* Present from the first render and only ever given new text, because a live region inserted at the
          moment of its own update is not announced reliably. It carries the one figure a cart change moves —
          the basket's total — rather than the whole block, so a new quantity is announced as the total it
          produced and not as the progress sentence, the subtotal, the delivery charge and the tax read out
          again. It stays empty while the price is in flight and after it has failed, because there is no
          total to state then and a failure announces itself through the alert's own `role="alert"`. */}
      <div className="sp-visually-hidden" role="status">
        {totalAnnouncement}
      </div>
    </Card>
  );
}
