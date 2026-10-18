/**
 * Path: src/features/checkout/OrderConfirmation.tsx
 * Purpose: Confirmation route showing the order number, itemised lines, delivery estimate and address
 * Lines: 543
 */

import type { ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader, OrderStatusBadge } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import {
  CHECKOUT_COPY,
  deliveryEstimateLabel,
  orderConfirmationHeading,
} from "@/constants/checkoutCopy";
import { SHIPPING_METHODS, STORAGE_KEYS } from "@/constants/config";
import {
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  NOT_FOUND_COPY,
  PAGE_TITLES,
  appliedPromoLabel,
  documentTitle,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, accountOrderPath, loginPath } from "@/constants/routes";
import { countryLabel } from "@/constants/taxonomy";
// The seam's own reading of a failure, so this page never decides what a status or a sentence means: whether
// a retry could answer differently is a fact about the refusal, and `src/lib/apiContract.ts` owns it.
import { isNotFoundFailure, isSessionFailure } from "@/lib/apiClient";
import { getOrder } from "@/lib/orderService";
import type { OrderServiceOptions } from "@/lib/orderService";
import { useAuth } from "@/state/AuthContext";
import { useAsync, useDocumentTitle, useLocalStorage } from "@/state/hooks";
import type { AsyncQueryState } from "@/state/hooks";
import { useScrollToTop } from "@/state/scrollHooks";
import type { Address, Session } from "@/types/account";
import type { Order, PaymentSummary, PricedCartLine } from "@/types/commerce";
import type { ApiError, CurrencyCode, OrderId } from "@/types/common";
import { addDays, formatDate, formatDateRange } from "@/utils/dates";
import { formatMoney, formatQuantity } from "@/utils/format";
import { capitalise } from "@/utils/strings";

/*
 * Class contract, consumed by name because no file under `src/features/**` imports a stylesheet —
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/commerce.css` owns the confirmation
 * family: `sp-confirmation` with its `__header`, `__meta` (the pair grid the address form and the payment
 * row also use), `__number` (monospaced, selectable in one gesture), `__estimate`, `__lines` (the itemised
 * band, ruled off above and below) and `__actions`. That band reuses the review step's form —
 * `sp-review__list` and `sp-review__item`, whose last child the sheet pushes to the trailing edge in tabular
 * figures — and the amounts under it sit in the order summary register `src/styles/summary-panel.css` owns:
 * `sp-summary__title`, `sp-summary__note` and `sp-summary__row` with its `--discount` and `--total` modifiers,
 * framed by `sp-review__totals`. Earlier sheets supply the rest: `sp-container` with `--narrow`, `sp-page`,
 * `sp-page__body` and `sp-grid` from `src/styles/layout.css`; `sp-btn` with the `--primary`, `--secondary`
 * and `--link` variants an anchor wears from `src/styles/controls.css`, because every control here navigates
 * and no member of `Button.tsx` renders a link; and `.sp-visually-hidden`, the removal of a `role="list"`
 * element's markers and the motion neutralised under `prefers-reduced-motion` from `src/styles/base.css`.
 */

/** The sign between a line's quantity and the price it was bought at: notation rather than wording, so it is
 * not the copy library's, while both figures beside it are `src/utils/format.ts`'s. */
const QUANTITY_PRICE_SEPARATOR = "×";

/** The sign a discount row carries before its amount. The summary register's discount modifier paints the
 * saving in the success pair and leaves the sign to the row's own markup. */
const DISCOUNT_SIGN = "−";

/** What a card's last four digits are shown behind, so the tail reads as a tail rather than as a number. */
const CARD_TAIL_MASK = "•••• ";

// Reading the route and the credential a read may carry ------------------------------------------

/**
 * The order identifier a route segment names, as the identifier the order client takes.
 *
 * The segment is text, and it enters the typed domain here at the one boundary this page owns — the bridge
 * `src/lib/apiRoutes.ts` crosses for a captured path segment. Nothing is validated against a shape: whether
 * the identifier names an order is the seam's answer, given as a `404`.
 *
 * @param segment - The route segment.
 * @returns The identifier, typed as the order client's parameter.
 */
function asOrderId(segment: string): OrderId {
  return segment as OrderId;
}

/** Whether a persisted payload is text: the shape the session entry holds, and the only one passed on. */
function isStoredText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * What the order request carries beside its path: the signal that cancels a superseded read, and the session
 * token when the visitor holds one.
 *
 * The token is sent because the seam authenticates the read with it: an order that names an account answers
 * only to the session that owns it, or to an administrator, and a request carrying no token at all is refused
 * with `401`. An order placed without an account is answered by the placement credential
 * `src/lib/orderService.ts` remembers for the orders this browser placed, which the read presents on its own
 * and which is why a guest's confirmation reopens there and nowhere else. Nothing about expiry, role or
 * ownership is decided here — those are the seam's answers to this request.
 *
 * @param sessionToken - The token the read authenticates with, `""` when the visitor holds none.
 * @param signal - The request's abort signal, from `useAsync`.
 * @returns The options the order client takes.
 */
function requestOptions(sessionToken: string, signal: AbortSignal): OrderServiceOptions {
  return sessionToken === "" ? { signal } : { signal, sessionToken };
}

// Reading what the order itself holds ------------------------------------------------------------

/**
 * The delivery window the order's own method puts it in, as the range this page states: both ends are
 * arithmetic on the placement date through `src/utils/dates.ts`, over the transit window the method's record
 * in `src/constants/config.ts` declares, which is that list's single home. The window is a range and never a
 * promised day, and no date is computed here.
 *
 * @param order - The placed order.
 * @returns The formatted range, or `null` when no configured method carries the order's method id or the
 * range cannot be read — an estimate left unsaid rather than guessed at.
 */
function deliveryEstimate(order: Order): string | null {
  const method = SHIPPING_METHODS.find((candidate) => candidate.id === order.shippingMethodId);
  if (method === undefined) return null;
  const range = formatDateRange(
    addDays(order.placedAt, method.minDays),
    addDays(order.placedAt, method.maxDays),
  );
  return range === "" ? null : range;
}

/**
 * One address as the lines a reader reads it by, in postal order. A member left empty renders no line, so a
 * second street line or a phone number that was not supplied leaves no blank row. The country reads as the name
 * `src/constants/taxonomy.ts` declares for the code the address stores, so an address renders here as it
 * renders at the review step and in the address book.
 *
 * @param address - The address snapshot the order keeps.
 * @returns The non-empty lines to render.
 */
function addressLines(address: Address): readonly string[] {
  return [
    address.fullName,
    address.line1,
    address.line2,
    `${address.city}, ${address.region} ${address.postalCode}`,
    countryLabel(address.country),
    address.phone,
  ].filter((line) => line.trim() !== "");
}

/**
 * The one line a payment summary shows: a card's brand with its masked last four digits, or the method an
 * order was settled without a card by. Only a card's tail reaches an order — the number a buyer enters is
 * validated at the payment step and discarded at the seam — so no member here could print one.
 *
 * @param payment - The payment summary the order keeps.
 * @returns The line to render.
 */
function paymentSummaryLine(payment: PaymentSummary): string {
  if (payment.last4 === null) return capitalise(payment.method);
  const brand = payment.brand ?? "";
  return `${brand} ${CARD_TAIL_MASK}${payment.last4}`.trim();
}

/**
 * A line's quantity and the unit price it was bought at, joined by the sign that reads as "this many at this
 * price". Both figures are the priced line's own snapshot, so nothing is looked up in the catalogue again and
 * the price printed beside the quantity is the one the line was priced at.
 *
 * @param line - The priced line the order keeps.
 * @param currency - The currency the order was priced in.
 * @returns The joined label.
 */
function quantityAtPriceLabel(line: PricedCartLine, currency: CurrencyCode): string {
  const quantity = formatQuantity(line.quantity);
  const unitPrice = formatMoney(line.unitPriceMinor, currency);
  return `${quantity} ${QUANTITY_PRICE_SEPARATOR} ${unitPrice}`;
}

/** What {@link ConfirmationFailure} needs: the failure the seam shaped, where the visitor stands, and what
 * retrying does. */
interface ConfirmationFailureProps {
  /** The `ApiError` the failed read resolved with. */
  readonly error: ApiError;
  /** The path this read was made from, which the sign-in link carries back as its `returnTo`. */
  readonly returnPath: string;
  /** Runs the read again, from `useAsync`. */
  readonly onRetry: () => void;
}

/**
 * The state a failed read shows: the failure in the danger register, with the action that resolves it and the
 * way back its single action cannot also offer.
 *
 * Every failure this route can meet arrives as one value — a `404` for an identifier no order holds, a `401`
 * for an account's order read without a session, a `403` where a role was refused — and the message is the
 * failure's own. No `try`/`catch` surrounds the read, because the seam reports failures as values.
 *
 * The action offered is the one that resolves the state, not the one a retry verb suggests. A retry is shown
 * exactly where a repeat of the request could answer differently; a refusal for want of a session is resolved
 * by the sign-in that ends in one, which carries this path back so the visitor lands on the order they asked
 * for, and a `404` by the catalogue link below, because repeating either would spend a request on an answer
 * the seam has already given.
 *
 * @param props - The failure, the path to return to, and the retry that runs the read again.
 * @returns The alert, the hint under it and the links that resolve the state.
 */
function ConfirmationFailure({
  error,
  onRetry,
  returnPath,
}: ConfirmationFailureProps): ReactElement {
  const isSessionProblem = isSessionFailure(error);
  const canRetry = !isSessionProblem && !isNotFoundFailure(error);

  return (
    <div className="sp-confirmation">
      <Alert
        actionLabel={canRetry ? COMMON_ACTIONS.RETRY : undefined}
        error={error}
        onAction={canRetry ? onRetry : undefined}
        tone="danger"
      />
      {/* The hint advises a second attempt, so it is said exactly where one is offered: a visitor asked to sign
          in or handed the way back is not told to try again. */}
      {canRetry ? <p className="sp-summary__note">{FEEDBACK_COPY.ERROR_STATE_HINT}</p> : null}
      <div className="sp-confirmation__actions">
        {isSessionProblem ? (
          <Link className="sp-btn sp-btn--primary" to={loginPath(returnPath)}>
            {COMMON_ACTIONS.SIGN_IN}
          </Link>
        ) : null}
        <Link className="sp-btn sp-btn--secondary" to={ROUTES.CATALOG}>
          {NOT_FOUND_COPY.ACTION_LABEL}
        </Link>
      </div>
    </div>
  );
}

// The confirmation -------------------------------------------------------------------------------

/**
 * The confirmation's opening block: the order's status, its number — monospaced, selectable in one gesture
 * and named by the label above it — the day it was placed, and the delivery window that follows from it.
 *
 * The pair sits in a description list, so each value carries a real accessible name rather than a label that
 * merely sits beside it, and the status badge states its meaning in words while its variant only emphasises
 * it. No estimate is shown when no method resolves, because a guess is worse than an omission.
 *
 * @param order - The placed order.
 * @returns The confirmation's header block.
 */
function ConfirmationHeader({ order }: { readonly order: Order }): ReactElement {
  const estimate = deliveryEstimate(order);

  return (
    <header className="sp-confirmation__header">
      <OrderStatusBadge status={order.status} />
      <dl className="sp-confirmation__meta">
        <div>
          <dt className="sp-summary__note">{CHECKOUT_COPY.CONFIRMATION_ORDER_NUMBER_LABEL}</dt>
          <dd className="sp-confirmation__number">{order.orderNumber}</dd>
        </div>
        <div>
          <dt className="sp-summary__note">{CHECKOUT_COPY.CONFIRMATION_PLACED_DATE_LABEL}</dt>
          <dd>{formatDate(order.placedAt)}</dd>
        </div>
      </dl>
      {estimate === null ? null : (
        <p className="sp-confirmation__estimate">{deliveryEstimateLabel(estimate)}</p>
      )}
    </header>
  );
}

/**
 * The order's amounts, read from the priced cart the order keeps and formatted here and only here.
 *
 * Nothing is added up: the five figures are the ones `src/lib/pricingService.ts` computed when the order was
 * placed, which is why a later price, tax rate or delivery charge cannot move them. The discount row appears
 * only when a discount was taken and carries its sign as markup, and each applied code is named beneath it,
 * because an amount alone does not say which code earned it.
 *
 * @param order - The placed order, whose kept priced cart holds every figure shown.
 * @returns The totals register that closes the itemised block.
 */
function OrderTotals({ order }: { readonly order: Order }): ReactElement {
  const {
    appliedPromos,
    currency,
    discountTotalMinor,
    grandTotalMinor,
    shippingMinor,
    subtotalMinor,
    taxMinor,
  } = order.pricedCart;

  return (
    <div className="sp-review__totals">
      <h3 className="sp-summary__title">{CHECKOUT_COPY.CONFIRMATION_TOTALS_HEADING}</h3>
      <div className="sp-summary__row">
        <span>{CART_COPY.SUMMARY_SUBTOTAL_LABEL}</span>
        <span>{formatMoney(subtotalMinor, currency)}</span>
      </div>
      {discountTotalMinor > 0 ? (
        <div className="sp-summary__row sp-summary__row--discount">
          <span>{CART_COPY.SUMMARY_DISCOUNT_LABEL}</span>
          <span>{`${DISCOUNT_SIGN}${formatMoney(discountTotalMinor, currency)}`}</span>
        </div>
      ) : null}
      {appliedPromos.map((promo) => (
        <p className="sp-summary__note" key={promo.code}>
          {appliedPromoLabel(promo.code)}
        </p>
      ))}
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
  );
}

/**
 * The placed order as the confirmation reads it: what was bought and what it cost, where it goes, how it was
 * paid for, and where the reader can go next.
 *
 * The itemised rows read the priced cart the order keeps, each row's amount being that line's own goods
 * subtotal — the unit price times the quantity `src/lib/pricingService.ts` computed — so the amounts add up to
 * the Subtotal row and the discount is stated once, in its own row. Every remaining value comes from the order —
 * its recorded addresses and its payment summary — so this block renders a placed order and recomputes
 * nothing, the currency every amount is shown in travels with the order rather than being assumed, and the
 * lines are keyed by the identifier a cart line already carried.
 *
 * The order-history step is offered exactly when it resolves: an order that names no account lives in no
 * account's history, and one that names an account is offered that history only to the visitor whose session
 * owns it — the order can equally have been read by an administrator, whose own history it is not in. Every
 * control here navigates, because nothing on a confirmation writes.
 *
 * @param props - The placed order and whether the visitor's own session owns it.
 * @returns The confirmation's content, below its header.
 */
function ConfirmationDetails({
  isOwnOrder,
  order,
}: {
  readonly isOwnOrder: boolean;
  readonly order: Order;
}): ReactElement {
  const currency = order.pricedCart.currency;

  return (
    <article className="sp-confirmation">
      <ConfirmationHeader order={order} />
      <Card as="section">
        <CardHeader title={CHECKOUT_COPY.CONFIRMATION_ITEMS_HEADING} headingLevel={2} />
        <CardBody>
          <div className="sp-confirmation__lines">
            <ul className="sp-review__list" role="list">
              {order.pricedCart.lines.map((line) => (
                <li className="sp-review__item" key={line.id}>
                  <span>{line.name}</span>
                  <span>{line.sku}</span>
                  <span>{quantityAtPriceLabel(line, currency)}</span>
                  <span>{formatMoney(line.lineSubtotalMinor, currency)}</span>
                </li>
              ))}
            </ul>
            <OrderTotals order={order} />
          </div>
        </CardBody>
      </Card>
      <div className="sp-grid">
        <Card as="section">
          <CardHeader title={CHECKOUT_COPY.CONFIRMATION_ADDRESS_HEADING} headingLevel={2} />
          <CardBody>
            {/* One block per line, rather than a run broken by `<br>`, so each line stands on its own; and a
                plain element rather than `<address>`, because that element brings the browser's own italic
                with it and no stylesheet in this product declares a font style at all. The card's own
                heading is what says whose address this is. */}
            <div className="sp-summary__note">
              {addressLines(order.shippingAddress).map((line, index) => (
                <p key={`${String(index)}-${line}`}>{line}</p>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card as="section">
          <CardHeader title={CHECKOUT_COPY.CONFIRMATION_PAYMENT_HEADING} headingLevel={2} />
          <CardBody>
            <p>{paymentSummaryLine(order.payment)}</p>
          </CardBody>
        </Card>
      </div>
      <div className="sp-confirmation__actions">
        <Link className="sp-btn sp-btn--primary" to={ROUTES.CATALOG}>
          {CHECKOUT_COPY.CONFIRMATION_CONTINUE_SHOPPING_LABEL}
        </Link>
        {isOwnOrder ? (
          <Link className="sp-btn sp-btn--secondary" to={accountOrderPath(order.id)}>
            {CHECKOUT_COPY.CONFIRMATION_ORDER_HISTORY_LABEL}
          </Link>
        ) : null}
        <Link className="sp-btn sp-btn--link" to={ROUTES.HOME}>
          {CHECKOUT_COPY.CONFIRMATION_HOME_LABEL}
        </Link>
      </div>
    </article>
  );
}

/**
 * Which of the four states the route renders, in the order they can occur: an address naming no order, a
 * failed read, a read still in flight, and the order itself.
 *
 * The failure is read before the payload, because a failed read leaves no payload behind it, and a superseded
 * request's answer never reaches the state at all — `useAsync` aborts it — so a placeholder is only ever
 * replaced by the result of the request that is still current. The state naming no order carries the wording
 * the content library keeps for an address that matches nothing in the product, with the one action that copy
 * names, and a hand-edited address is the only way to reach it.
 *
 * @param orderId - The identifier the route named, `""` when it named none.
 * @param query - The read's state and its actions, from `useAsync`.
 * @param session - The session in force, or `null` for a visitor who is not signed in.
 * @param returnPath - The path the visitor is on, which a failed read's sign-in link carries back.
 * @returns The element the page renders below its header.
 */
function confirmationBody(
  orderId: string,
  query: AsyncQueryState<Order>,
  session: Session | null,
  returnPath: string,
): ReactElement {
  const { data, error, reload } = query;

  if (orderId === "") {
    return (
      <EmptyState
        title={NOT_FOUND_COPY.TITLE}
        description={NOT_FOUND_COPY.BODY}
        actionLabel={NOT_FOUND_COPY.ACTION_LABEL}
        actionHref={ROUTES.CATALOG}
      />
    );
  }
  if (error !== null) {
    return <ConfirmationFailure error={error} onRetry={reload} returnPath={returnPath} />;
  }
  if (data === null) {
    return (
      <div className="sp-confirmation" aria-busy="true">
        <Skeleton variant="heading" width="18ch" />
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }
  // Ownership is decided by the order and the session held, never by what the read returned: the seam can
  // answer an administrator's request for another account's order, and that order is not in their history.
  const isOwnOrder = data.customerId !== null && data.customerId === session?.customerId;
  return <ConfirmationDetails isOwnOrder={isOwnOrder} order={data} />;
}

/**
 * The order confirmation route: the page a buyer lands on the moment an order is placed, and the page the
 * same address renders again after a reload in the browser that placed it.
 *
 * That reload-safety is the point of the file. The cart is cleared the moment an order is placed, so this page
 * reads nothing held in memory: it takes the identifier from the route, asks `src/lib/orderService.ts` for the
 * order, and renders what the order holds. Which credential answers that read depends on the order: an order
 * that names an account needs the session token below, and an account-less one the placement credential
 * `src/lib/orderService.ts` remembers for the orders this browser placed — so a confirmation reopens in the
 * browser that placed it, and a shared link no longer opens a stranger's order. It reads no cart state and no
 * checkout state, and every rule about who may read an order stays in the seam rather than being restated here.
 * The two session facts it does touch are the credential the read authenticates with and the account that
 * credential stands for; neither is decided here.
 *
 * The credential is read from the entry `src/state/AuthContext.tsx` persists rather than from the session that
 * module publishes, and that choice is load-bearing. A stored token is revalidated on mount, and until it
 * settles the provider reports a signed-out visitor — so a read carrying only the session would be sent with no
 * credential at all in that window and refused with `401`, showing a signed-in buyer a failure that replaces
 * itself with their order a moment later. The persisted entry holds the token itself and is readable on the
 * first render, so the very first request already carries what the seam authenticates with; once the session
 * resolves the two agree, and the ownership check below uses that session rather than the entry, because only
 * the revalidation knows which account the token stands for.
 *
 * @returns The page: its heading block, and whichever of the four states the read is in.
 */
export function OrderConfirmation(): ReactElement {
  const params = useParams();
  const { pathname } = useLocation();
  const orderId = (params[ROUTE_PARAMS.ORDER_ID] ?? "").trim();
  const { session } = useAuth();
  const [storedToken] = useLocalStorage<string>(STORAGE_KEYS.SESSION, "", {
    validate: isStoredText,
  });
  const sessionToken = session?.token ?? storedToken;
  const order = useAsync<Order>(
    (signal) => getOrder(asOrderId(orderId), requestOptions(sessionToken, signal)),
    [orderId, sessionToken],
    { enabled: orderId !== "" },
  );
  const heading =
    order.data === null
      ? PAGE_TITLES.ORDER_CONFIRMATION
      : orderConfirmationHeading(order.data.orderNumber);

  useDocumentTitle(documentTitle(PAGE_TITLES.ORDER_CONFIRMATION));

  /*
   * The confirmation opens at its own top, because it arrives with whatever offset the route in front of it
   * was left at — the checkout's, when this is where a placed order handed over — which would otherwise put
   * the placed order's heading underneath the sticky header. The value that names the view is the route's own
   * order identifier, so a second order's confirmation opens at its top rather than at this one's.
   */
  useScrollToTop(orderId);

  return (
    <div className="sp-container sp-container--narrow">
      <div className="sp-page">
        <PageHeader
          title={heading}
          description={order.data === null ? undefined : CHECKOUT_COPY.CONFIRMATION_THANK_YOU}
        />
        <div className="sp-page__body">{confirmationBody(orderId, order, session, pathname)}</div>
      </div>
    </div>
  );
}
