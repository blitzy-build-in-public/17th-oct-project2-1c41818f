/**
 * Path: src/features/checkout/OrderSummaryPanel.tsx
 * Purpose: The checkout's order summary panel: the basket's priced figures and the states they arrive in
 * Lines: 280
 */

import { useId } from "react";
import type { ReactElement } from "react";

import { Card } from "@/components/ui/Card";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import {
  CART_COPY,
  COMMON_ACTIONS,
  appliedPromoLabel,
  cartItemCountLabel,
  freeShippingProgressLabel,
} from "@/constants/content";
import type { ApiError, AsyncStatus } from "@/types/common";
import type { PricedCart } from "@/types/commerce";
import { sumQuantities } from "@/utils/collections";
import { formatFreeShippingRemaining, formatMoney } from "@/utils/format";

/**
 * Why this file exists beside `CheckoutPage.tsx`: the route file may hold no more than 600 lines, and the
 * panel — its amount rows and the states the figures arrive in — does not fit beside the checkout's steps
 * and forms, so the concern is split rather than the ceiling raised, the way
 * `src/components/ui/overlayEngine.ts` stands beside `Modal.tsx`. The move is verbatim: the panel keeps its
 * own class contract, its own states and its single importer, which is `CheckoutPage.tsx`.
 */

/*
 * Class contract. This list is what the sheets owe the file, each class named with the sheet that declares it.
 *
 * `src/styles/layout.css` supplies `sp-stack`, the rhythm the panel's figures sit in, and the panel itself is
 * `src/styles/commerce.css`'s: `sp-summary` with `sp-summary__title`, the `sp-summary__row` register and its
 * `--discount` and `--total` modifiers, `sp-summary__note` and `sp-summary__progress-label` — the panel
 * register the cart's own summary draws, which is why this panel is a `Card` carrying that class rather than
 * a card of its own.
 */

/** The classes this panel puts on its own markup, written once so a rename is one edit. */
const CLASSES = {
  stack: "sp-stack",
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

/** The two registers an amount row carries beyond the plain one, as the summary sheet names its modifiers. */
const ROW_MODIFIER_CLASSES = {
  discount: `${CLASSES.row} sp-summary__row--discount`,
  total: `${CLASSES.row} sp-summary__row--total`,
} as const;

/** The register an amount row is painted in. */
type RowModifier = keyof typeof ROW_MODIFIER_CLASSES;

// The panel's states -----------------------------------------------------------------------------

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
 * The note above them states how many units the basket holds, read through the shared aggregation
 * helper the cart slice and the header's badge use, so this panel, the cart page, the mini-cart and
 * the badge state one figure for one basket.
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
      <p className={CLASSES.note}>{cartItemCountLabel(sumQuantities(lines))}</p>
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
export interface OrderSummaryPanelProps {
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
export function OrderSummaryPanel(props: OrderSummaryPanelProps): ReactElement {
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
