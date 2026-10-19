/**
 * Path: src/features/admin/RecentOrdersTable.tsx
 * Purpose: The dashboard's most-recent-orders table with status badges
 * Lines: 366
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
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/Table";
import { ACCOUNT_COPY, COMMON_ACTIONS, EMPTY_STATES } from "@/constants/content";
import { ADMIN_COPY } from "@/constants/content-reports";
import type { ApiError } from "@/types/common";
import type { Order } from "@/types/commerce";
import { sumQuantities } from "@/utils/collections";
import { formatDateTime } from "@/utils/dates";

/*
 * Class contract. This list is what the sheets owe the table, each class named with the sheet that declares
 * it. The card's frame
 * and its four regions belong to `src/styles/data-display.css` (`sp-card`, `sp-card__header`,
 * `sp-card__body`, and `sp-card__body--flush`, which is what lets a table meet the frame), the status pill is
 * that sheet's badge family (`sp-badge`, its variant modifiers and `sp-badge--sm` for a dense cell), the table
 * is its `sp-table` family (`sp-table`, `sp-table--compact` for the row the back office uses, `sp-table__num`
 * for a column of figures and `sp-table__empty` for the single row a table with nothing to show renders), and
 * `sp-visually-hidden` in `src/styles/base.css` carries the caption, and `src/styles/placeholders.css` — the
 * single home for placeholder geometry, loaded by `src/styles/account.css` — sizes the bar the loading state
 * puts in every cell of the table it reserves (`sp-placeholder-cell`). The failure the page hands in is
 * rendered by the alert primitive, whose `sp-alert` family `src/styles/components.css` declares with the
 * other primitives and which this file adopts by mounting it rather than by restating any of it. The
 * scroll frame handed to the table through `TABLE_FRAME_CLASS` is `src/styles/admin-reports.css`'s
 * report-style shell, and its floor under the table is what makes a six-column back office table travel
 * sideways inside the card rather than compressing its columns below legibility. No colour, radius, shadow
 * or pixel media query is written in this file.
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
 * No row links to an order. `src/constants/routes.ts` offers `accountOrderPath`, but no administrator order
 * route exists, and `GET /api/orders/:id` is scoped to the session's own customer, answering
 * `401`, `403` or `404` for anyone else, so a link from here would open a route that cannot load for an
 * administrator reading another customer's order. The order number is plain text, and no route string is
 * written in this file.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content-reports.ts` declares no administrator table column vocabulary.
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
 * The items column states the order's unit count, read through `sumQuantities` in `src/utils/collections.ts`:
 * the account's order-history column states that same figure for the same order, so the two screens cannot
 * report one order in two units under the one label they share.
 *
 * Each column either reads a value the table renders through the product's cell formatter — the order number,
 * the customer's email, the order's unit count as an integer and the placed order's own recorded
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
    value: (order) => sumQuantities(order.lines),
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

/**
 * The class `src/styles/placeholders.css` sizes a figure in a table cell with: one bar at the height of the
 * body-sm line the cell's own text renders in, so a placeholder row comes out as tall as the row of figures
 * that replaces it. The sheet is the product's single home for placeholder geometry and is loaded by
 * `src/styles/account.css`, the last of the eight.
 */
const PLACEHOLDER_CELL_CLASS = "sp-placeholder-cell";

/** One placeholder figure, rendered where a column's own cell renders its value. */
function placeholderCell(): ReactElement {
  return <Skeleton className={PLACEHOLDER_CELL_CLASS} variant="text" />;
}

/**
 * The table as its placeholder renders it: the same columns in the same order, carrying the same headings and
 * the same numeric alignment, with a bar where every cell's value goes. The headings are the same module's
 * words, so the table the reader sees while the period is read is headed exactly as the table it becomes.
 *
 * Sorting is deliberately not carried over: a heading that reordered placeholder rows would offer a control
 * acting on nothing. That leaves the header 2.5 pixels shorter than the loaded one — the sort button the
 * loaded headings carry — which is the whole of the difference between the two header rows.
 */
const PLACEHOLDER_COLUMNS: readonly DataTableColumn<number>[] = COLUMNS.map((column) => ({
  id: column.id,
  header: column.header,
  align: column.align,
  isNumeric: column.isNumeric,
  cell: placeholderCell,
}));

/**
 * The rows a placeholder table is built from: the keys React renders them by. They carry no data — every cell
 * of them is a bar — so their identity is their position, which is what the count the page states resolves to.
 *
 * @param count - How many rows the read being waited on asked for.
 * @returns One key per row, in order.
 */
function placeholderRowKeys(count: number): readonly number[] {
  const rows = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return Array.from({ length: rows }, (_row, index) => index);
}

/** Everything {@link RecentOrdersTable} accepts. */
export interface RecentOrdersTableProps {
  /**
   * The orders to show, in the order the page received them: the dashboard's `getRecentOrders` read, at most
   * as many as the limit it asked for. This table fetches nothing, so these rows, the loading flag and the
   * failure below are its whole state.
   */
  readonly orders: readonly Order[];
  /**
   * Whether the page's read is still in flight. While it is, the table reports itself busy and holds the rows
   * it already has, so a reload after a range change never blanks a filled table; on a first load, where it
   * holds none, it renders the placeholder {@link placeholderRowCount} describes rather than claiming the
   * period held no orders.
   */
  readonly isLoading?: boolean;
  /**
   * How many rows the read that feeds this table asked for — the page's own limit — so the card reserves the
   * space those rows will take while the read is in flight: the placeholder is the height of a page of this
   * table's rows, so the block the reader is looking at does not move when they land. Left out, no placeholder
   * is rendered and the card shows its header alone, which is what a caller that does not know the count
   * wants.
   */
  readonly placeholderRowCount?: number;
  /**
   * The failure the page's own read reported, or `null` when it answered. While a failure is handed in the
   * card keeps its frame and its title and its body states the failure, with {@link onRetry} beside it, in
   * place of the table — the four-state contract is each surface's own, so a failed orders read leaves the
   * dashboard's figures, chart and ranking exactly as they are. A failure takes precedence over `isLoading`,
   * because a read that did not answer is not still in flight.
   */
  readonly error?: ApiError | null;
  /**
   * Called when the reader asks for the orders again: the page's `reload` for the read behind this table, so
   * the retry re-runs that one request and no other. It renders no control of its own, being the alert's
   * action alone, and is passed through untouched.
   */
  readonly onRetry?: () => void;
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
 * customer's email, how many units it holds, what it came to and where it stands.
 *
 * The rows are the period's last placements as the page read them, so this table is a window and not a
 * history: it holds no paging control, because the endpoint it is fed from is a limit-bounded list rather than
 * a paged collection, and a page control here would report a page that does not exist. It holds no export
 * action either — the dashboard reads and the reports export — and no filter of its own, because the period is
 * the page's control and every table under it answers the same range.
 *
 * Its states are explicit and in the order they can occur: the placeholder, when the read is in flight and
 * nothing is held, at the height of the rows it is waiting for; the rows the page handed over, held while a
 * reload runs; the empty row, when the read succeeded and the period recorded nothing; the failure, when the
 * read answered with one, stated in the card's own body beside its retry; and the rows. The placeholder is
 * hidden from assistive technology and the frame around it carries `aria-busy`, so the wait is announced once
 * and no empty cell is read out as content.
 *
 * A failure the page hands in is this card's own body rather than the page's: the title and the frame stay, so
 * the reader sees which read failed, and the retry re-runs that one read. Nothing is fetched here either way,
 * so the failure is rendered and the reloading is the page's.
 *
 * @param props - The orders to show, the page's loading state and the row count it reserves, the failure with
 *   its retry, the card's title and its heading level; see {@link RecentOrdersTableProps}.
 * @returns The card holding the shared table, configured with this surface's columns.
 */
export function RecentOrdersTable({
  orders,
  isLoading = false,
  placeholderRowCount = 0,
  error,
  onRetry,
  title = ADMIN_COPY.RECENT_ORDERS_HEADING,
  headingLevel = 3,
}: RecentOrdersTableProps): ReactElement {
  // The card is a section named by its own title, so the region a screen reader lands on is announced with
  // the words the heading shows rather than by the table's caption alone.
  const headingId = useId();
  const failure = error ?? null;

  // Nothing has arrived and nothing is held: the table is about to be filled, so a page of its own rows is
  // reserved rather than an empty body shown. A table that already holds rows keeps them instead, because the
  // read under way is a reload of the period the reader is looking at.
  const placeholderRows = placeholderRowKeys(placeholderRowCount);
  const isPlaceholderShown = isLoading && orders.length === 0 && placeholderRows.length > 0;

  return (
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader title={<span id={headingId}>{title}</span>} headingLevel={headingLevel} />
      {/* The body loses its flush edge only while the alert stands in for the table: a table meets the frame
          with no padding of its own, while the alert brings the padding the card's other bodies carry. */}
      <CardBody isFlush={failure === null}>
        {failure === null ? (
          isPlaceholderShown ? (
            // The row the reader is waiting for, in the shape it arrives in: the same columns and headings, a bar
            // where every figure goes, and the page's own row count. The frame reports the wait; the table inside
            // is hidden from assistive technology, because a table of empty cells read out as content is not a
            // state anyone asked for.
            <div aria-busy="true">
              <div aria-hidden="true">
                <DataTable
                  columns={PLACEHOLDER_COLUMNS}
                  rows={placeholderRows}
                  rowKey={(row) => String(row)}
                  caption={title}
                  isLoading
                  density="compact"
                  className={TABLE_FRAME_CLASS}
                />
              </div>
            </div>
          ) : (
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
          )
        ) : (
          <Alert
            actionLabel={COMMON_ACTIONS.RETRY}
            error={failure}
            onAction={onRetry}
            tone="danger"
          />
        )}
      </CardBody>
    </Card>
  );
}
