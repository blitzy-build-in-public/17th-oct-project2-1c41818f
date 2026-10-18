/**
 * Path: src/features/account/OrderHistoryList.tsx
 * Purpose: The customer's order history: the status and date filters, the paged table they resolve to and the loading placeholder
 * Lines: 386
 */

import { useCallback, useId, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { OrderStatusBadge } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { usePagination } from "@/components/ui/hooks";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DataTable } from "@/components/ui/Table";
import type { DataTableColumn, DataTablePaging } from "@/components/ui/Table";
import { DEFAULT_PAGE_SIZE, MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  PAGING_NOUNS,
  VALIDATION_MESSAGES,
} from "@/constants/content";
import { DATE_RANGE_COPY, rangeTooLongMessage } from "@/constants/content-reports";
import { ROUTES, accountOrderPath, loginPath } from "@/constants/routes";
import { ORDER_STATUS_OPTIONS } from "@/constants/taxonomy";
// The seam's own reading of a failure, so neither mode decides what a status or a sentence means: whether a
// repeat of the read could answer differently is a fact about the refusal, and `src/lib/apiContract.ts` owns it.
import { isSessionFailure } from "@/lib/apiClient";
import { listOrders } from "@/lib/orderService";
import { useFocusHandoff } from "@/state/focusHandoff";
import { useAsync } from "@/state/hooks";
import type { Order, OrderHistoryQuery } from "@/types/commerce";
import type { PageResult, Result } from "@/types/common";
import { sumQuantities } from "@/utils/collections";
import type { DateRangeErrorCode, DateRangeErrorField } from "@/utils/dates";
import {
  formatDateRange,
  fromDateInputValue,
  toFieldErrors,
  validateDateRange,
} from "@/utils/dates";

/*
 * Class contract, consumed by name: no file under `src/features/**` imports a stylesheet, because
 * `src/main.tsx` is the only importer of `src/styles/**`. `src/styles/account.css` owns the history's block —
 * `sp-order-history` with its `__filters`, `__table`, `__placeholder` and `__empty` — and earlier sheets supply
 * the rest: the table primitive, `sp-alert`, `sp-empty` and `sp-stack`, the `sp-placeholder-cell` register
 * `src/styles/placeholders.css` gives a figure in a table cell, and `src/styles/cart.css`'s
 * `sp-summary__note`. The detail half of the same contract — `sp-order-detail` and its parts — is stated in
 * `src/features/account/OrderHistoryPage.tsx`, this module's only importer.
 *
 * Both account order routes render the detail file, because the slice spends three view files on four routes:
 * this one holds the history and `src/features/account/OrderHistoryPage.tsx` branches once on the order segment.
 * A rule either of them reads — the range rules, the status vocabulary, the money and date formatting — is
 * imported from the module that owns it, so nothing is stated twice across the pair.
 *
 * BLITZY [COPY GAP]: `src/constants/content.ts` holds no wording for the status filter's unfiltered choice, or
 * for what an empty history says when filters rather than the account are why nothing is listed; both are held
 * here until a plan amendment adds them to `ACCOUNT_COPY`.
 */

// The screen's own vocabulary

/** The status filter's unfiltered choice, and so how a chosen status is cleared. */
const ANY_STATUS_LABEL = "All statuses";

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

/** The rows the loading placeholder stands in with, one per row a first page typically holds. Each is named
 *  rather than counted so that a decorative row has an identity of its own instead of a position among its
 *  siblings. */
const PLACEHOLDER_ROW_KEYS = ["first", "second", "third", "fourth", "fifth", "sixth"] as const;

/** The loading state both modes of the account order routes render: the history's own table with a placeholder
 *  line in every cell, inside a region hidden from assistive technology because the wrapper around it is what
 *  reports the wait with `aria-busy`. The frame, the caption, the five column headings, the alignment and the row
 *  height are all the loaded table's own — the line in each cell is `sp-placeholder-cell`, the size
 *  `placeholders.css` gives a figure in a table cell — so only the figures are missing and the region keeps the
 *  height it has when the rows land. `sp-order-history__placeholder`, the busy region's own class, is what keeps
 *  that table inside the section's column: the loaded table's scroll container is a direct child of the section,
 *  while this one is nested a level deeper, so `src/styles/account.css` gives the region the same zero minimum
 *  inline size and the same sideways scroll rather than letting the table's width reach the page.
 *
 *  It is exported because one order's own page renders it too, while its read is in flight. */
export function OrderHistoryPlaceholder(): ReactElement {
  return (
    <div aria-busy="true" className="sp-order-history__placeholder">
      <div aria-hidden="true">
        <DataTable
          caption={ACCOUNT_COPY.ORDERS_HEADING}
          columns={PLACEHOLDER_COLUMNS}
          rows={PLACEHOLDER_ROW_KEYS}
          rowKey={(key) => key}
          tableClassName="sp-order-history__table"
        />
      </div>
    </div>
  );
}

/**
 * The history's columns: a link to the order, when it was placed, its status, its unit count and what it
 * came to. The unit count is the shared reading of an order's lines — `sumQuantities` in
 * `src/utils/collections.ts` — so the dashboard's own column states the same figure for the same order. The
 * total is the figure the order's kept priced cart already holds, never a sum taken here, and the
 * order number is a real link inside its cell rather than a clickable row, because a row that answers a
 * pointer and not a keyboard is an accessibility defect the shared table deliberately refuses to offer.
 *
 * No column is sortable and the table is handed no default order, because `GET /api/orders` accepts only
 * `page`, `pageSize`, `status`, `from` and `to`: this is one page of a history the endpoint orders itself,
 * and no request this screen can make would change that order. A sortable header could therefore only
 * reorder the rows in hand while announcing, through `aria-sort`, an ordering of the whole history the
 * request never produced. The rows render in the order the read returned them — newest first.
 */
const HISTORY_COLUMNS: readonly DataTableColumn<Order>[] = [
  {
    id: "order",
    header: ACCOUNT_COPY.ORDERS_COLUMN_ORDER,
    value: (order) => order.orderNumber,
    cell: (order) => <Link to={accountOrderPath(order.id)}>{order.orderNumber}</Link>,
  },
  {
    id: "placed",
    header: ACCOUNT_COPY.ORDERS_COLUMN_PLACED,
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
    isNumeric: true,
    value: (order) => sumQuantities(order.lines),
    format: "integer",
  },
  {
    id: "total",
    header: ACCOUNT_COPY.ORDERS_COLUMN_TOTAL,
    isNumeric: true,
    value: (order) => order.pricedCart.grandTotalMinor,
    format: "money",
  },
];

/**
 * The columns the placeholder table renders: the history's own columns with a placeholder line in place of
 * each cell's figure.
 *
 * The headings, their order and the alignment of the two numeric columns are read from {@link HISTORY_COLUMNS}
 * rather than restated, so the placeholder's header row is the loaded one down to the words in it and the two
 * cannot drift. Sorting is not carried over because no column of the history is sortable — the endpoint takes
 * no sort parameter, as {@link HISTORY_COLUMNS} records — so a header here would offer a control that acts on
 * nothing.
 */
const PLACEHOLDER_COLUMNS: readonly DataTableColumn<string>[] = HISTORY_COLUMNS.map((column) => ({
  id: column.id,
  header: column.header,
  isNumeric: column.isNumeric,
  align: column.align,
  cell: () => <Skeleton className="sp-placeholder-cell" variant="text" />,
}));

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
export function OrderHistoryList({
  sessionToken,
}: {
  readonly sessionToken: string;
}): ReactElement {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const headingId = useId();
  const [statusValue, setStatusValue] = useState("");

  /*
   * The region the two actions hand the focus off to, and the handoff itself: the section below is rendered
   * around the filters, the table and every state they resolve to, so it is what outlives an action that takes
   * its own control away — the empty state's clear-all and the error state's retry both leave with the state
   * they report — where the browser would otherwise drop the focus onto `document.body`. `aria-labelledby`
   * names the region, so the heading it points at is what a screen reader announces when the focus lands.
   */
  const { regionRef, handOffFocus } = useFocusHandoff();
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
    // The rows are orders, so the pager's caption counts orders rather than the catalogue's products.
    countNoun: PAGING_NOUNS.ORDERS,
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
    // Armed before the write: clearing the filters takes the empty state's own control, or the message's,
    // off the screen with them.
    handOffFocus();
    setStatusValue("");
    setFromText("");
    setToText("");
    setPage(1);
  };

  /** Asks for the page again, for the error state's retry: that control leaves with the failure it reports, so
   *  the history around it takes the focus the retry would otherwise lose. */
  const retry = (): void => {
    handOffFocus();
    reload();
  };

  const renderResults = (): ReactElement => {
    if (loadStatus === "error" && error !== null) {
      // Every read here carries the session's token, so a refusal for want of one is resolved by the sign-in
      // that ends in a session rather than by asking again; every other failure keeps the retry that can
      // answer it.
      return isSessionFailure(error) ? (
        <div className="sp-stack">
          <Alert error={error} tone="danger" />
          <p className="sp-summary__note">
            <Link to={loginPath(pathname)}>{COMMON_ACTIONS.SIGN_IN}</Link>
          </p>
        </div>
      ) : (
        <Alert actionLabel={COMMON_ACTIONS.RETRY} error={error} onAction={retry} tone="danger" />
      );
    }
    if (loadStatus !== "success") return <OrderHistoryPlaceholder />;
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
        paging={paging}
        rowKey={(order) => order.id}
        rows={orders}
        tableClassName="sp-order-history__table"
      />
    );
  };

  return (
    <section aria-labelledby={headingId} className="sp-order-history" ref={regionRef} tabIndex={-1}>
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
