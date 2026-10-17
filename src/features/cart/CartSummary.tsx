/**
 * Path: src/features/cart/CartSummary.tsx
 * Purpose: Totals panel with promo-code entry, discount lines and free-shipping progress
 * Lines: 358
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert, ProgressBar, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import {
  CART_COPY,
  CHECKOUT_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  freeShippingProgressLabel,
} from "@/constants/content";
import {
  selectDiscountTotalMinor,
  selectFreeShippingProgress,
} from "@/features/cart/cartSelectors";
import { promoRejectionMessage, validatePromoCode } from "@/lib/pricingService";
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
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/commerce.css` owns this panel's
 * register: `sp-summary` with its padding and rhythm, `sp-summary__title`, `sp-summary__promo` (the field,
 * then the apply control, with a rejected code's reason spanning both columns), `sp-summary__row` with its
 * `--discount` and `--total` modifiers, and `sp-summary__progress` for the free-delivery band.
 * `src/styles/layout.css` contributes `sp-stack`, the rhythm the figures sit in so that the live region
 * wrapped around them costs the rows none of the panel's spacing.
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
 * The placeholder the figures region stands in with while a price is in flight: the shared skeleton rather
 * than zeroes, because a total that has not been quoted is not `$0.00`. The skeleton is silent, so the live
 * region holding it is what carries `aria-busy`.
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
 * One amount row: what it is on the leading edge and the figure on the trailing one.
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
      <span>{label}</span>
      <span>{value}</span>
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
 * @returns The free-delivery band and the amount rows.
 */
function SummaryRows({ pricedCart }: { readonly pricedCart: PricedCart }): ReactElement {
  const { appliedPromos, currency, grandTotalMinor, shippingMinor, subtotalMinor, taxMinor } =
    pricedCart;
  const showsDeliveryCharge = pricedCart.shippingMethodId !== null;

  return (
    <>
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
    </>
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
 * refused one always says why in words.
 *
 * The panel keeps rendering while its figures do not: the title and the promo entry stand whatever the
 * pricing request is doing, so a shopper can correct a rejected code at any moment. The figures follow the
 * states every data-backed surface renders — a placeholder while a price is in flight, the failure with its
 * retry, a placeholder rather than zeroes when no price exists yet, and the amounts once one does — inside a
 * polite live region, so a re-price is announced once without moving the focus the shopper is using.
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
  // code's floor and its eligible goods are properties of the basket as it stands.
  const { lines } = useCart();
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

  useEffect(
    () => () => {
      // A check still in flight when the panel leaves the tree is aborted and its answer discarded.
      attemptRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const isLoading = status === "loading";

  const changeCode = (event: ChangeEvent<HTMLInputElement>): void => {
    setCode(event.target.value);
    // The message goes as the shopper corrects the code rather than standing until the next submission.
    setFieldErrors((errors) => clearFieldError(errors, PROMO_CODE_FIELD));
  };

  const checkPromoCode = async (): Promise<void> => {
    // A code is matched case-insensitively while its accepted shape is upper-case, so what a shopper typed
    // is normalised before anything judges it.
    const normalised = code.trim().toUpperCase();
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

    const reason = promoRejectionMessage(result.error);
    if (reason !== undefined) {
      setNotice(reason);
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void checkPromoCode();
  };

  const renderFigures = (): ReactElement => {
    if (isLoading) return <SummaryPlaceholder />;
    if (error !== null) {
      return (
        <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={onRetry} tone="danger" />
      );
    }
    if (pricedCart === null) return <SummaryPlaceholder />;
    return <SummaryRows pricedCart={pricedCart} />;
  };

  return (
    <Card aria-labelledby={headingId} as="section" className="sp-summary">
      <h2 className="sp-summary__title" id={headingId}>
        {CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING}
      </h2>
      <form className="sp-summary__promo" noValidate onSubmit={handleSubmit}>
        <Input
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
        {notice === null ? null : <Alert tone="warning">{notice}</Alert>}
      </form>
      <div aria-atomic="true" aria-busy={isLoading} aria-live="polite" className="sp-stack">
        {renderFigures()}
      </div>
    </Card>
  );
}
