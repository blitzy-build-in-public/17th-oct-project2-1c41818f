/**
 * Path: src/features/account/OrderHistoryPage.tsx
 * Purpose: The customer's orders with status and date filters, paging and a link to each order
 * Lines: 314
 */

import type { ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { OrderStatusBadge } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import {
  ACCOUNT_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  PAGE_TITLES,
  PAYMENT_METHOD_LABELS,
  documentTitle,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, loginPath } from "@/constants/routes";
import { ORDER_STATUS_OPTIONS, countryLabel } from "@/constants/taxonomy";
import { OrderHistoryList, OrderHistoryPlaceholder } from "@/features/account/OrderHistoryList";
// The seam's own reading of a failure, so neither mode decides what a status or a sentence means: whether a
// repeat of the read could answer differently is a fact about the refusal, and `src/lib/apiContract.ts` owns it.
import { isNotFoundFailure, isSessionFailure } from "@/lib/apiClient";
import { getOrder } from "@/lib/orderService";
// The session is this page's only source of the token its reads are scoped by, and the only way it can
// tell a visitor whose session has not survived why it has nothing to show. `src/state/AuthContext.tsx`
// is the product's single home for it, and the account area's sibling views read it the same way.
import { useAuth } from "@/state/AuthContext";
import { useFocusHandoff, handOffThen } from "@/state/focusHandoff";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { Order, OrderStatus, PaymentSummary, PricedCartLine } from "@/types/commerce";
import type { CurrencyCode, OrderId, Result } from "@/types/common";
import { formatDate, formatDateTime } from "@/utils/dates";
import { formatMoney, formatQuantity } from "@/utils/format";

/*
 * Class contract, consumed by name: no file under `src/features/**` imports a stylesheet, because
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/account.css` owns both modes —
 * `sp-order-history` with its `__filters`, `__table`, `__placeholder` and `__empty`, and `sp-order-detail`
 * with its `__header`, `__number`, `__status`, `__lines`, `__totals`, `__addresses` and `__timeline` — and
 * earlier sheets supply the rest: the table primitive, `sp-alert`, `sp-empty`, `sp-stack`; from
 * `src/styles/summary-panel.css`, which `commerce.css` loads, the `sp-summary__row` register with its
 * `--discount`/`--total` modifiers and `sp-summary__note`; and from `src/styles/commerce.css` the compact
 * itemised row `sp-review__item` the order confirmation reuses. The history's own block — `sp-order-history`
 * and its parts — is rendered by `src/features/account/OrderHistoryList.tsx`, which this file mounts.
 *
 * Both account order routes render here, because the slice spends three view files on four routes: the
 * history lives in `OrderHistoryList.tsx` and this file branches once on the order segment, so one view file
 * serves the history and one order, and the two share this module's helpers and formatting.
 *
 * The three words this screen's copy gap once held are the account vocabulary's now: `ACCOUNT_COPY` declares
 * the billing address's heading (`ORDER_DETAIL_BILLING_ADDRESS_HEADING`) and the last-updated label
 * (`ORDER_DETAIL_UPDATED_LABEL`), and the word each payment method reads as is `PAYMENT_METHOD_LABELS`,
 * re-exported from `src/constants/content.ts`. This file therefore states no wording of its own.
 */

// The screen's own vocabulary

/** The masked head of a card's tail, and the signs between a line's figures and the header's timestamps. */
const CARD_TAIL_MASK = "•••• ";
const QUANTITY_PRICE_SEPARATOR = " × ";
const STAMP_SEPARATOR = " · ";

// Reading a route and an order

/** The order identifier a route segment names, as the identifier the order client takes: the segment is
 * text, and it enters the typed domain at the one boundary this page owns. Nothing is validated against a
 * shape — whether the identifier names an order is the seam's answer, given as a `404`. */
function asOrderId(segment: string): OrderId {
  return segment as OrderId;
}

/** The words a status reads as, from the vocabulary that names every status once. */
function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** A line's quantity and the unit price it was bought at, both snapshotted, so nothing is looked up in the
 * catalogue again and nothing is multiplied here. */
function lineFigures(line: PricedCartLine, currency: CurrencyCode): string {
  const quantity = formatQuantity(line.quantity);
  const unitPrice = formatMoney(line.unitPriceMinor, currency);
  return `${quantity}${QUANTITY_PRICE_SEPARATOR}${unitPrice}`;
}

/** The one line a payment block shows: a card's brand with its masked tail, or the method an order was
 * settled without a card by. Only a tail can reach an order, because the number a buyer enters is validated
 * at the payment step and discarded at the seam. */
function paymentLine(payment: PaymentSummary): string {
  if (payment.last4 === null) return PAYMENT_METHOD_LABELS[payment.method];
  return `${payment.brand ?? ""} ${CARD_TAIL_MASK}${payment.last4}`.trim();
}

/** One address snapshot as the lines a reader reads it by, in postal order, so a second street line or a
 * phone number that was not supplied leaves no blank row. A block of its own rather than a run broken by
 * `<br>`, and a plain element rather than `<address>`, which brings the browser's own italic with it. The
 * address shape is read off the order rather than imported, because the order is the only thing this file
 * is handed one by. */
function AddressBlock({ address }: { readonly address: Order["shippingAddress"] }): ReactElement {
  return (
    <div className="sp-summary__note">
      {[
        address.fullName,
        address.line1,
        address.line2,
        `${address.city}, ${address.region} ${address.postalCode}`,
        countryLabel(address.country),
        address.phone,
      ]
        .filter((line) => line.trim() !== "")
        .map((line, index) => (
          <p key={`${String(index)}-${line}`}>{line}</p>
        ))}
    </div>
  );
}

/**
 * One order, read top to bottom: its number with the dates and the status, the itemised lines and what they
 * came to, the two addresses it was placed with, how it was paid for, and the history of its status.
 *
 * Every figure comes from the order itself — its snapshotted lines and the priced cart it keeps — so nothing
 * is re-read from the catalogue, re-priced or added up, and a later price, tax rate or delivery charge cannot
 * move a total the customer has already been shown. The currency travels with the order, and the timeline
 * states each status in words beside its date, so the sequence reads without the marker's shade.
 *
 * The failed read is the one state with a decision in it: a refusal for want of a session is resolved by
 * signing in, and a `404` by the history this order came from, so the retry is offered exactly where a repeat
 * of the read could answer differently and the link below is the resolving action in both other cases.
 *
 * @param props - The order the route names, and the session token its read is scoped by.
 * @returns The order detail.
 */
function OrderDetail({
  orderId,
  sessionToken,
}: {
  readonly orderId: OrderId;
  readonly sessionToken: string;
}): ReactElement {
  const { pathname } = useLocation();
  const loadOrder = (signal: AbortSignal): Promise<Result<Order>> =>
    getOrder(orderId, { sessionToken, signal });
  const {
    data: order,
    error,
    reload,
    status,
  } = useAsync<Order>(loadOrder, [orderId, sessionToken]);

  /*
   * The detail view's region: its three states have three different roots, so the wrapper they all render
   * inside is the one survivor the failure's retry hands the focus to instead of the document body.
   */
  const { regionRef, handOffFocus } = useFocusHandoff<HTMLDivElement>();
  const retry = handOffThen(handOffFocus, reload);

  if (status === "error" && error !== null) {
    const isSessionProblem = isSessionFailure(error);
    const canRetry = !isSessionProblem && !isNotFoundFailure(error);

    return (
      <div className="sp-stack" ref={regionRef} tabIndex={-1}>
        <Alert
          actionLabel={canRetry ? COMMON_ACTIONS.RETRY : undefined}
          error={error}
          onAction={canRetry ? retry : undefined}
          tone="danger"
        />
        <p className="sp-summary__note">
          {isSessionProblem ? (
            <Link to={loginPath(pathname)}>{COMMON_ACTIONS.SIGN_IN}</Link>
          ) : (
            <Link to={ROUTES.ACCOUNT_ORDERS}>{ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL}</Link>
          )}
        </p>
      </div>
    );
  }
  if (order === null) {
    return (
      <div className="sp-stack" ref={regionRef} tabIndex={-1}>
        <OrderHistoryPlaceholder />
      </div>
    );
  }

  const { currency, discountTotalMinor, grandTotalMinor, shippingMinor, subtotalMinor, taxMinor } =
    order.pricedCart;

  return (
    <article className="sp-order-detail" ref={regionRef} tabIndex={-1}>
      <div className="sp-order-detail__header">
        <h2 className="sp-order-detail__number">{order.orderNumber}</h2>
        <span className="sp-order-detail__status">
          <OrderStatusBadge status={order.status} />
        </span>
        <p className="sp-summary__note">
          {`${CHECKOUT_COPY.CONFIRMATION_PLACED_DATE_LABEL} ${formatDate(order.placedAt)}`}
          {STAMP_SEPARATOR}
          {`${ACCOUNT_COPY.ORDER_DETAIL_UPDATED_LABEL} ${formatDateTime(order.updatedAt)}`}
        </p>
        <Link to={ROUTES.ACCOUNT_ORDERS}>{ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL}</Link>
      </div>

      <section className="sp-stack">
        <h3>{ACCOUNT_COPY.ORDER_DETAIL_ITEMS_HEADING}</h3>
        <ul className="sp-order-detail__lines" role="list">
          {order.pricedCart.lines.map((line) => (
            <li className="sp-review__item" key={line.id}>
              <span>{line.name}</span>
              <span>{line.sku}</span>
              <span>{lineFigures(line, currency)}</span>
              <span>{formatMoney(line.lineSubtotalMinor, currency)}</span>
            </li>
          ))}
        </ul>
        <div className="sp-order-detail__totals">
          <div className="sp-summary__row">
            <span>{CART_COPY.SUMMARY_SUBTOTAL_LABEL}</span>
            <span>{formatMoney(subtotalMinor, currency)}</span>
          </div>
          {discountTotalMinor === 0 ? null : (
            <div className="sp-summary__row sp-summary__row--discount">
              <span>{CART_COPY.SUMMARY_DISCOUNT_LABEL}</span>
              <span>{formatMoney(-discountTotalMinor, currency)}</span>
            </div>
          )}
          <div className="sp-summary__row">
            <span>{CART_COPY.SUMMARY_SHIPPING_LABEL}</span>
            <span>{formatMoney(shippingMinor, currency)}</span>
          </div>
          <div className="sp-summary__row">
            <span>{CART_COPY.SUMMARY_TAX_LABEL}</span>
            <span>{formatMoney(taxMinor, currency)}</span>
          </div>
          <div className="sp-summary__row sp-summary__row--total">
            <span>{CART_COPY.SUMMARY_TOTAL_LABEL}</span>
            <span>{formatMoney(grandTotalMinor, currency)}</span>
          </div>
        </div>
      </section>

      <div className="sp-order-detail__addresses">
        <section className="sp-stack">
          <h3>{ACCOUNT_COPY.ORDER_DETAIL_ADDRESS_HEADING}</h3>
          <AddressBlock address={order.shippingAddress} />
        </section>
        <section className="sp-stack">
          <h3>{ACCOUNT_COPY.ORDER_DETAIL_BILLING_ADDRESS_HEADING}</h3>
          <AddressBlock address={order.billingAddress} />
        </section>
      </div>

      <section className="sp-stack">
        <h3>{ACCOUNT_COPY.ORDER_DETAIL_PAYMENT_HEADING}</h3>
        <p>{paymentLine(order.payment)}</p>
      </section>

      <section className="sp-stack">
        <h3>{ACCOUNT_COPY.ORDER_DETAIL_HISTORY_HEADING}</h3>
        <ol className="sp-order-detail__timeline" role="list">
          {order.statusHistory.map((entry) => (
            <li
              aria-current={entry.status === order.status ? "true" : undefined}
              className="sp-order-detail__step"
              key={`${entry.status}-${entry.at}`}
            >
              <span className="sp-order-detail__step-label">{statusLabel(entry.status)}</span>
              <span className="sp-order-detail__step-date">{formatDateTime(entry.at)}</span>
              {entry.note === undefined ? null : <p className="sp-summary__note">{entry.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

/**
 * The account's orders route: the customer's own history, or the one order the route names.
 *
 * Which is rendered is decided once, by whether the route carries an order segment, and the whole screen sits
 * behind the session, because the seam scopes both endpoints to the customer the token authenticates: a
 * visitor whose session has not survived is told to sign in rather than shown an empty table. The history
 * itself — its filters, columns, paging and placeholder — is `src/features/account/OrderHistoryList.tsx`; this
 * file owns the route, the session gate and one order. The view renders the account area's `<h2>` below the
 * shell's `<h1>`, and sets the document title for its own route.
 *
 * @returns The order history, or the order the route names.
 */
export function OrderHistoryPage(): ReactElement {
  const params = useParams();
  const orderId = (params[ROUTE_PARAMS.ORDER_ID] ?? "").trim();
  const { session } = useAuth();
  useDocumentTitle(documentTitle(orderId === "" ? PAGE_TITLES.ORDERS : PAGE_TITLES.ORDER_DETAIL));

  if (session === null) {
    return (
      <section className="sp-stack">
        <Alert tone="warning">{FEEDBACK_COPY.SIGN_IN_REQUIRED}</Alert>
      </section>
    );
  }
  return orderId === "" ? (
    <OrderHistoryList sessionToken={session.token} />
  ) : (
    <OrderDetail orderId={asOrderId(orderId)} sessionToken={session.token} />
  );
}
