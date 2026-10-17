/**
 * Path: src/features/account/OrderHistoryPage.tsx
 * Purpose: The customer's orders with status and date filters, paging and a link to each order
 * Lines: 566
 */

import { useCallback, useId, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { OrderStatusBadge } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DataTable } from "@/components/ui/Table";
import type { DataTableColumn, DataTablePaging, DataTableSort } from "@/components/ui/Table";
import { DEFAULT_PAGE_SIZE, MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  CART_COPY,
  CHECKOUT_COPY,
  COMMON_ACTIONS,
  DATE_RANGE_COPY,
  FEEDBACK_COPY,
  PAGE_TITLES,
  VALIDATION_MESSAGES,
  documentTitle,
  rangeTooLongMessage,
} from "@/constants/content";
import { ROUTE_PARAMS, ROUTES, accountOrderPath } from "@/constants/routes";
import { ORDER_STATUS_OPTIONS } from "@/constants/taxonomy";
import { getOrder, listOrders } from "@/lib/orderService";
// The session is this page's only source of the token its reads are scoped by, and the only way it can
// tell a visitor whose session has not survived why it has nothing to show. `src/state/AuthContext.tsx`
// is the product's single home for it, and the account area's sibling views read it the same way.
import { useAuth } from "@/state/AuthContext";
import { useAsync, useDocumentTitle, usePagination } from "@/state/hooks";
import type {
  Order,
  OrderHistoryQuery,
  OrderLine,
  OrderStatus,
  PaymentMethod,
  PaymentSummary,
} from "@/types/commerce";
import type { CurrencyCode, OrderId, PageResult, Result } from "@/types/common";
import { sumBy } from "@/utils/collections";
import type { DateRangeErrorCode, DateRangeErrorField } from "@/utils/dates";
import {
  formatDate,
  formatDateRange,
  formatDateTime,
  fromDateInputValue,
  toFieldErrors,
  validateDateRange,
} from "@/utils/dates";
import { formatMoney, formatQuantity } from "@/utils/format";

/*
 * Class contract, consumed by name: no file under `src/features/**` imports a stylesheet, because
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/account.css` owns both modes —
 * `sp-order-history` with its `__filters`, `__table` and `__empty`, and `sp-order-detail` with its
 * `__header`, `__number`, `__status`, `__lines`, `__totals`, `__addresses` and `__timeline` — and earlier
 * sheets supply the rest: the table primitive, `sp-alert`, `sp-empty`, `sp-stack`, and from
 * `src/styles/commerce.css` the `sp-summary__row` register with its `--discount`/`--total` modifiers,
 * `sp-summary__note` and the compact itemised row `sp-review__item` the order confirmation reuses.
 *
 * Both account order routes render here, because the slice spends three view files on four routes: the
 * history and one order, branched once on the order segment, sharing this module's helpers and formatting.
 *
 * BLITZY [COPY GAP]: `src/constants/content.ts` holds no wording for the status filter's unfiltered choice,
 * the billing address's heading, the last-updated label, the word each payment method reads as, or what an
 * empty history says when filters rather than the account are why nothing is listed; those five are held
 * here until a plan amendment adds them to `ACCOUNT_COPY`.
 */

// The screen's own vocabulary

/** The status filter's unfiltered choice, and so how a chosen status is cleared. */
const ANY_STATUS_LABEL = "All statuses";

/** The billing block's heading; the shipping block is labelled by the account vocabulary's own. */
const BILLING_ADDRESS_LABEL = "Billing address";

/** The label beside the timestamp the order was last written at. */
const UPDATED_LABEL = "Last updated";

/** What each payment method reads as when the order carries no card to name — see the copy gap. */
const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  card: "Card",
  invoice: "Invoice",
};

/** The masked head of a card's tail, and the signs between a line's figures and the header's timestamps. */
const CARD_TAIL_MASK = "•••• ";
const QUANTITY_PRICE_SEPARATOR = " × ";
const STAMP_SEPARATOR = " · ";

/** What an empty history says when the filters, not the account, are why nothing is listed. */
const NO_MATCHING_ORDERS = {
  TITLE: "No orders match these filters",
  DESCRIPTION: "Widen the period or choose another status.",
} as const;

/** The field keys the range rule reports under, which are also the `name` each date control carries, so one
 * error map lands on the control that owns it. No field renders the third, so the alert reads it. */
const FROM_FIELD: DateRangeErrorField = "from";
const TO_FIELD: DateRangeErrorField = "to";
const RANGE_FIELD: DateRangeErrorField = "range";

/** The wording of every rule `validateDateRange` can break, keyed by the code it returns. The rule — both
 * ends real, `from` not after `to`, neither in the future, at most the configured span — lives in
 * `src/utils/dates.ts`; this module only says what a broken rule reads as. */
const RANGE_MESSAGES: Readonly<Record<DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

/** The rows the loading placeholder stands in for, one per row a first page typically holds. */
const PLACEHOLDER_ROWS = 6;

/** The order the table opens in: newest first, the order the history endpoint answers in. The endpoint takes
 * no sort parameter, so a header activation reorders the page on show rather than the whole history. */
const DEFAULT_SORT: DataTableSort = { columnId: "placed", direction: "desc" };

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

/** How many units an order holds, counted from its snapshotted lines. */
function unitCount(order: Order): number {
  return sumBy(order.lines, (line) => line.quantity);
}

/** A line's quantity and the unit price it was bought at, both snapshotted, so nothing is looked up in the
 * catalogue again and nothing is multiplied here. */
function lineFigures(line: OrderLine, currency: CurrencyCode): string {
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
        address.country,
        address.phone,
      ]
        .filter((line) => line.trim() !== "")
        .map((line, index) => (
          <p key={`${String(index)}-${line}`}>{line}</p>
        ))}
    </div>
  );
}

/** The loading state both modes render: decorative rows inside a region marked busy, with no live region of
 * its own because the region is what reports the load. */
function LoadPlaceholder(): ReactElement {
  return (
    <div aria-busy="true">
      <Skeleton lines={PLACEHOLDER_ROWS} variant="row" />
    </div>
  );
}

/**
 * The history's columns: a link to the order, when it was placed, its status, its unit count and what it
 * came to. The total is the figure the order's kept priced cart already holds, never a sum taken here, and
 * the order number is a real link inside its cell rather than a clickable row, because a row that answers a
 * pointer and not a keyboard is an accessibility defect the shared table deliberately refuses to offer.
 */
const HISTORY_COLUMNS: readonly DataTableColumn<Order>[] = [
  {
    id: "order",
    header: ACCOUNT_COPY.ORDERS_COLUMN_ORDER,
    sortable: true,
    value: (order) => order.orderNumber,
    cell: (order) => <Link to={accountOrderPath(order.id)}>{order.orderNumber}</Link>,
  },
  {
    id: "placed",
    header: ACCOUNT_COPY.ORDERS_COLUMN_PLACED,
    sortable: true,
    value: (order) => order.placedAt,
    format: "date",
  },
  {
    id: "status",
    header: ACCOUNT_COPY.ORDERS_COLUMN_STATUS,
    cell: (order) => <OrderStatusBadge size="sm" status={order.status} />,
  },
  {
    id: "items",
    header: ACCOUNT_COPY.ORDERS_COLUMN_ITEMS,
    sortable: true,
    isNumeric: true,
    value: (order) => unitCount(order),
    format: "integer",
  },
  {
    id: "total",
    header: ACCOUNT_COPY.ORDERS_COLUMN_TOTAL,
    sortable: true,
    isNumeric: true,
    value: (order) => order.pricedCart.grandTotalMinor,
    format: "money",
  },
];

/**
 * The history: the status and date filters, the page of orders they resolve to, and the paging beneath it.
 *
 * The filters are this page's own state rather than the URL's, unlike the catalogue's and the search's: the
 * URL stores query state for those two screens, and the history reaches `src/utils/queryParams.ts` through
 * neither. A filter change returns to the first page — the lower bound of `clampPage` — and every page the
 * control reports is already confined by `usePagination` through `clampPage` and `pageCountFor`. Neither
 * endpoint is given a customer id, because neither takes one: the seam scopes the history to the customer its
 * session token authenticates. A range that is half given, inverted or past its cap is never sent at all.
 *
 * @param props - The session token every read is scoped by.
 * @returns The order history section.
 */
function OrderHistoryList({ sessionToken }: { readonly sessionToken: string }): ReactElement {
  const navigate = useNavigate();
  const headingId = useId();
  const [statusValue, setStatusValue] = useState("");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // A date control hands over the text it holds, and only a complete calendar day is a bound: a half-typed
  // value is no bound at all rather than a malformed one, so it never reaches a request.
  const from = fromDateInputValue(fromText);
  const to = fromDateInputValue(toText);
  const hasRangeEnd = from !== "" || to !== "";
  const rangeValidation = hasRangeEnd ? validateDateRange(from, to) : null;
  const rangeErrors =
    rangeValidation === null ? {} : toFieldErrors(rangeValidation, RANGE_MESSAGES);
  const rangeIsUsable = rangeValidation === null || rangeValidation.valid;
  const range = rangeIsUsable && hasRangeEnd ? { from, to } : null;
  const status = ORDER_STATUS_OPTIONS.find((option) => option.value === statusValue)?.value;

  const query: OrderHistoryQuery = {
    page,
    pageSize,
    ...(status === undefined ? {} : { status }),
    ...(range === null ? {} : range),
  };

  const loadOrders = (signal: AbortSignal): Promise<Result<PageResult<Order>>> =>
    listOrders(query, { sessionToken, signal });

  const {
    data,
    error,
    reload,
    status: loadStatus,
  } = useAsync<PageResult<Order>>(
    loadOrders,
    [page, pageSize, statusValue, from, to, sessionToken],
    {
      enabled: rangeIsUsable,
    },
  );

  const orders = data?.items ?? [];
  const changePage = useCallback((nextPage: number, nextPageSize: number): void => {
    setPage(nextPage);
    setPageSize(nextPageSize);
  }, []);
  const pager = usePagination({ page, pageSize, total: data?.total ?? 0, onChange: changePage });
  const paging: DataTablePaging = {
    ...pager,
    onPageChange: pager.goTo,
    onPageSizeChange: pager.setPageSize,
  };

  /** Every filter control reports the same way: the value it now holds is written and the list returns to
   * the first page, so a narrower result set is never looked at from a page that no longer exists. */
  const changeFilter =
    (write: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      write(event.target.value);
      setPage(1);
    };

  const clearFilters = (): void => {
    setStatusValue("");
    setFromText("");
    setToText("");
    setPage(1);
  };

  const renderResults = (): ReactElement => {
    if (loadStatus === "error" && error !== null) {
      return (
        <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={reload} tone="danger" />
      );
    }
    if (loadStatus !== "success") return <LoadPlaceholder />;
    if (orders.length === 0) {
      return range !== null || statusValue !== "" ? (
        <EmptyState
          actionLabel={COMMON_ACTIONS.CLEAR_ALL}
          description={NO_MATCHING_ORDERS.DESCRIPTION}
          onAction={clearFilters}
          title={NO_MATCHING_ORDERS.TITLE}
        />
      ) : (
        <EmptyState
          className="sp-order-history__empty"
          onAction={(): void => {
            void navigate(ROUTES.CATALOG);
          }}
          surface="orders"
        />
      );
    }
    return (
      <DataTable
        caption={ACCOUNT_COPY.ORDERS_HEADING}
        columns={HISTORY_COLUMNS}
        defaultSort={DEFAULT_SORT}
        paging={paging}
        rowKey={(order) => order.id}
        rows={orders}
        tableClassName="sp-order-history__table"
      />
    );
  };

  return (
    <section aria-labelledby={headingId} className="sp-order-history">
      <h2 id={headingId}>{ACCOUNT_COPY.ORDERS_HEADING}</h2>
      <div className="sp-order-history__filters">
        <Select
          label={ACCOUNT_COPY.ORDERS_STATUS_FILTER_LABEL}
          onChange={changeFilter(setStatusValue)}
          options={ORDER_STATUS_OPTIONS}
          placeholder={ANY_STATUS_LABEL}
          value={statusValue}
        />
        <Input
          errors={rangeErrors}
          label={DATE_RANGE_COPY.FROM_LABEL}
          name={FROM_FIELD}
          onChange={changeFilter(setFromText)}
          type="date"
          value={fromText}
        />
        <Input
          errors={rangeErrors}
          label={DATE_RANGE_COPY.TO_LABEL}
          name={TO_FIELD}
          onChange={changeFilter(setToText)}
          type="date"
          value={toText}
        />
        {rangeErrors[RANGE_FIELD] === undefined ? null : (
          <Alert actionLabel={COMMON_ACTIONS.CLEAR} onAction={clearFilters} tone="warning">
            {rangeErrors[RANGE_FIELD]}
          </Alert>
        )}
        {range === null ? null : (
          <p className="sp-summary__note">{formatDateRange(range.from, range.to)}</p>
        )}
      </div>
      {renderResults()}
    </section>
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
  const loadOrder = (signal: AbortSignal): Promise<Result<Order>> =>
    getOrder(orderId, { sessionToken, signal });
  const {
    data: order,
    error,
    reload,
    status,
  } = useAsync<Order>(loadOrder, [orderId, sessionToken]);

  if (status === "error" && error !== null) {
    return (
      <div className="sp-stack">
        <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={reload} tone="danger" />
        <p className="sp-summary__note">
          <Link to={ROUTES.ACCOUNT_ORDERS}>{ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL}</Link>
        </p>
      </div>
    );
  }
  if (order === null) return <LoadPlaceholder />;

  const { currency, discountTotalMinor, grandTotalMinor, shippingMinor, subtotalMinor, taxMinor } =
    order.pricedCart;

  return (
    <article className="sp-order-detail">
      <div className="sp-order-detail__header">
        <h2 className="sp-order-detail__number">{order.orderNumber}</h2>
        <span className="sp-order-detail__status">
          <OrderStatusBadge status={order.status} />
        </span>
        <p className="sp-summary__note">
          {`${CHECKOUT_COPY.CONFIRMATION_PLACED_DATE_LABEL} ${formatDate(order.placedAt)}`}
          {STAMP_SEPARATOR}
          {`${UPDATED_LABEL} ${formatDateTime(order.updatedAt)}`}
        </p>
        <Link to={ROUTES.ACCOUNT_ORDERS}>{ACCOUNT_COPY.ORDER_DETAIL_BACK_LABEL}</Link>
      </div>

      <section className="sp-stack">
        <h3>{ACCOUNT_COPY.ORDER_DETAIL_ITEMS_HEADING}</h3>
        <ul className="sp-order-detail__lines" role="list">
          {order.lines.map((line) => (
            <li className="sp-review__item" key={line.id}>
              <span>{line.productName}</span>
              <span>{line.sku}</span>
              <span>{lineFigures(line, currency)}</span>
              <span>{formatMoney(line.lineTotalMinor, currency)}</span>
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
          <h3>{BILLING_ADDRESS_LABEL}</h3>
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
 * The account's orders: the customer's own history, or the one order the route names.
 *
 * Which is rendered is decided once, by whether the route carries an order segment — this slice spends one
 * view file on both routes — and the whole screen sits behind the session, because the seam scopes both
 * endpoints to the customer the token authenticates: a visitor whose session has not survived is told to
 * sign in rather than shown an empty table. The view renders the account area's `<h2>` below the shell's
 * `<h1>`, and sets the document title for its own route.
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
