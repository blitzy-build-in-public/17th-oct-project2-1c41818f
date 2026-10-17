/**
 * Path: src/features/admin/RecentOrdersTable.tsx
 * Purpose: The dashboard's most-recent-orders table with status badges
 * Lines: 235
 */

import { useId } from "react";
import type { ReactElement } from "react";

import {
  Card,
  CardBody,
  CardHeader,
  OrderStatusBadge,
  type CardHeaderProps,
} from "@/components/ui/Card";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/Table";
import { ACCOUNT_COPY, ADMIN_COPY, EMPTY_STATES } from "@/constants/content";
import type { Order } from "@/types/commerce";
import { formatDateTime } from "@/utils/dates";

/*
 * Class contract. No file under `src/features/**` imports a stylesheet — `src/main.tsx` is the only importer
 * of `src/styles/**` — so every class named here is adopted from the sheet that declares it. The card's frame
 * and its four regions belong to `src/styles/data-display.css` (`sp-card`, `sp-card__header`,
 * `sp-card__body`, and `sp-card__body--flush`, which is what lets a table meet the frame), the status pill is
 * that sheet's badge family (`sp-badge`, its variant modifiers and `sp-badge--sm` for a dense cell), the table
 * is its `sp-table` family (`sp-table`, `sp-table--compact` for the row the back office uses, `sp-table__num`
 * for a column of figures and `sp-table__empty` for the single row a table with nothing to show renders), and
 * `sp-visually-hidden` in `src/styles/base.css` carries the caption. The scroll frame handed to the table
 * through `TABLE_FRAME_CLASS` is `src/styles/admin-reports.css`'s report-style shell, and its floor under the
 * table is what makes a six-column back office table travel sideways inside the card rather than compressing
 * its columns below legibility. No colour, radius, shadow or pixel media query is written in this file.
 *
 * The table is the shared primitive, configured rather than re-implemented. Sorting, the `<caption>`,
 * `aria-sort` on the sorted header, the sticky header, the scroll container, the empty row, the numeric
 * alignment of the two figure columns and the rendering of every cell belong to `src/components/ui/Table.tsx`;
 * this file declares columns and hands them over. Two rules follow and are deliberately absent below: no
 * comparator, because `sortByKey` in `src/utils/collections.ts` orders the rows, and no figure formatted by
 * hand, because the money and count columns carry their `format` and `formatCellValue` in
 * `src/utils/format.ts` dispatches to the product's single money and integer formatters — so the total shown
 * here is the one the cart summary, the confirmation and the account's order detail show.
 *
 * The status is rendered by `OrderStatusBadge` and never by a mapping of this file's own: the badge resolves
 * it through `ORDER_STATUS_OPTIONS` in `src/constants/taxonomy.ts` and always writes the status's label as
 * its text, so no status rests on colour alone and no second status-to-variant mapping exists to drift from
 * the dashboard's other surfaces.
 *
 * No row links to an order. `src/constants/routes.ts` offers `accountOrderPath`, but the plan declares no
 * administrator order route and `GET /api/orders/:id` is scoped to the session's own customer, answering
 * `401`, `403` or `404` for anyone else, so a link from here would open a route that cannot load for an
 * administrator reading another customer's order. The order number is plain text, and no route string is
 * written in this file.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` declares no administrator table column vocabulary.
 * The dashboard's own block names the table and nothing else — `ADMIN_COPY.RECENT_ORDERS_HEADING` is its card
 * title and its caption — so the four column labels that read the same in both registers are adopted from the
 * order-history block that already words them (`ACCOUNT_COPY.ORDERS_COLUMN_ORDER`, `_PLACED`, `_ITEMS`,
 * `_TOTAL` and `_STATUS`), and the customer column takes `ACCOUNT_COPY.EMAIL_LABEL`, which names exactly the
 * value it shows, the order's email. Five administrator keys in `ADMIN_COPY` — one per column — are all this
 * table needs to read in its own voice.
 */

/**
 * The report-style scroll frame `src/styles/admin-reports.css` declares for a wide back-office table, handed
 * to the shared table's scroll container so the frame, its edge-to-edge scroll and the legible floor under the
 * table all come from the sheet that owns the administrator register.
 */
const TABLE_FRAME_CLASS = "sp-report-table__scroll";

/** The key each column is rendered and looked up by, which is also the id a sort names. */
const COLUMN_IDS = {
  order: "order",
  placed: "placed",
  customer: "customer",
  items: "items",
  total: "total",
  status: "status",
} as const;

/**
 * The order the table opens in: newest first, which is how `getRecentOrders` answers. It is declared rather
 * than left implicit so the header reports the direction the rows are in from the first render and a
 * re-activation of the column returns to it.
 */
const DEFAULT_SORT: DataTableSort = { columnId: COLUMN_IDS.placed, direction: "desc" };

/**
 * The order two orders placed in the same second are shown in, and the identity React keys a row by — the
 * order's own id, never its position, because a position changes the moment the sort or the limit does.
 *
 * @param order - The order a row shows.
 * @returns The order's stable identifier.
 */
function rowKeyOf(order: Order): string {
  return order.id;
}

/**
 * The six columns the dashboard's table shows, in display order: the only configuration this file adds to the
 * shared table.
 *
 * Each column either reads a value the table renders through the product's cell formatter — the order number,
 * the customer's email, the line count as an integer and the placed order's own recorded
 * `pricedCart.grandTotalMinor` as money, never a recomputation of it — or draws its cell with a component
 * that already owns the rendering, which is the placed timestamp through `src/utils/dates.ts` and the status
 * through `OrderStatusBadge`. The two figure columns are marked numeric, so they align on their digits, and
 * every column that exposes a value is sortable; status is not, because a state is not an order.
 *
 * The placed column sorts on the order's own ISO timestamp while rendering it as the date and time it is, so
 * the reader orders rows by a value the column never prints differently.
 */
const COLUMNS: readonly DataTableColumn<Order>[] = [
  {
    id: COLUMN_IDS.order,
    header: ACCOUNT_COPY.ORDERS_COLUMN_ORDER,
    value: (order) => order.orderNumber,
    format: "text",
    sortable: true,
  },
  {
    id: COLUMN_IDS.placed,
    header: ACCOUNT_COPY.ORDERS_COLUMN_PLACED,
    cell: (order) => formatDateTime(order.placedAt),
    value: (order) => order.placedAt,
    sortable: true,
  },
  {
    id: COLUMN_IDS.customer,
    header: ACCOUNT_COPY.EMAIL_LABEL,
    value: (order) => order.email,
    format: "text",
    sortable: true,
  },
  {
    id: COLUMN_IDS.items,
    header: ACCOUNT_COPY.ORDERS_COLUMN_ITEMS,
    value: (order) => order.lines.length,
    format: "integer",
    isNumeric: true,
    sortable: true,
  },
  {
    id: COLUMN_IDS.total,
    header: ACCOUNT_COPY.ORDERS_COLUMN_TOTAL,
    value: (order) => order.pricedCart.grandTotalMinor,
    format: "money",
    isNumeric: true,
    sortable: true,
  },
  {
    id: COLUMN_IDS.status,
    header: ACCOUNT_COPY.ORDERS_COLUMN_STATUS,
    cell: (order) => <OrderStatusBadge status={order.status} size="sm" />,
  },
];

/**
 * What the table's single empty row shows for a period that recorded no orders: the dashboard's own wording,
 * rather than the catalogue's that the primitive falls back to, so a range with no activity says so. It names
 * no control, because the range that would widen the period belongs to the page and is not this table's to
 * render.
 */
const EMPTY_ROW: ReactElement = (
  <>
    <p>{EMPTY_STATES.dashboardRange.title}</p>
    <p>{EMPTY_STATES.dashboardRange.description}</p>
  </>
);

/** Everything {@link RecentOrdersTable} accepts. */
export interface RecentOrdersTableProps {
  /**
   * The orders to show, in the order the page received them: the dashboard's `getRecentOrders` read, at most
   * as many as the limit it asked for. This table fetches nothing, so these rows and the loading flag are its
   * whole state.
   */
  readonly orders: readonly Order[];
  /**
   * Whether the page's read is still in flight. While it is, the table reports itself busy and holds the rows
   * it already has, so a reload after a range change never blanks a filled table; on a first load it shows its
   * header and no rows rather than claiming the period held no orders.
   */
  readonly isLoading?: boolean;
  /** The card's title, and the table's accessible name beside it; the dashboard's own wording by default. */
  readonly title?: string;
  /**
   * The heading level the title renders at, so the card joins the document outline at the level the dashboard
   * nests it rather than at one this component picks. The visual size is the card title's either way.
   */
  readonly headingLevel?: CardHeaderProps["headingLevel"];
}

/**
 * The dashboard's most recent orders: one row per placed order, with its number, when it was placed, the
 * customer's email, how many lines it holds, what it came to and where it stands.
 *
 * The rows are the period's last placements as the page read them, so this table is a window and not a
 * history: it holds no paging control, because the endpoint it is fed from is a limit-bounded list rather than
 * a paged collection, and a page control here would report a page that does not exist. It holds no export
 * action either — the dashboard reads and the reports export — and no filter of its own, because the period is
 * the page's control and every table under it answers the same range.
 *
 * @param props - The orders to show, the page's loading state, the card's title and its heading level.
 * @returns The card holding the shared table, configured with this surface's columns.
 */
export function RecentOrdersTable({
  orders,
  isLoading = false,
  title = ADMIN_COPY.RECENT_ORDERS_HEADING,
  headingLevel = 3,
}: RecentOrdersTableProps): ReactElement {
  // The card is a section named by its own title, so the region a screen reader lands on is announced with
  // the words the heading shows rather than by the table's caption alone.
  const headingId = useId();

  return (
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader title={<span id={headingId}>{title}</span>} headingLevel={headingLevel} />
      <CardBody isFlush>
        <DataTable
          columns={COLUMNS}
          rows={orders}
          rowKey={rowKeyOf}
          caption={title}
          defaultSort={DEFAULT_SORT}
          emptyState={EMPTY_ROW}
          isLoading={isLoading}
          density="compact"
          className={TABLE_FRAME_CLASS}
        />
      </CardBody>
    </Card>
  );
}
