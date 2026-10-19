/**
 * Path: src/features/admin/TopProductsTable.tsx
 * Purpose: The dashboard's best-performing-products table by revenue or units
 * Lines: 379
 */

import { useMemo, type ReactElement } from "react";
import { Link } from "react-router-dom";

import { Button, ButtonGroup } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { DataTable, type DataTableColumn } from "@/components/ui/Table";
import { COMMON_ACTIONS, EMPTY_STATES } from "@/constants/content";
import { ADMIN_COPY } from "@/constants/content-reports";
import { productPath } from "@/constants/routes";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import type { Metric, ProductPerformance, ReportColumn, ReportDefinition } from "@/types/analytics";
import type { ApiError } from "@/types/common";
import { formatOrdinal, formatScaledPercent } from "@/utils/format";

/*
 * Class contract. `src/styles/data-display.css` — the sheet `src/styles/components.css` loads through
 * `@import` — owns the card and the data table this file composes, and `src/styles/controls.css` the control
 * group, so this list is what the sheets owe the file, each class named with the sheet that declares it.
 * The card brings `sp-card` with its `sp-card__header`, `sp-card__heading`,
 * `sp-card__title` and `sp-card__action` regions and the `sp-card__body--flush` body a card holding a table
 * gives no padding to, so the table meets the frame; the group brings `sp-btn-group` and the `sp-btn` family,
 * and the table brings `sp-table-wrap` (the scroll container, so a narrow viewport scrolls these five columns
 * rather than squeezing them), `sp-table`, `sp-table--compact` for the back office's dense row,
 * `sp-table__caption`, `sp-table__num` for the three columns of figures and `sp-table__empty` for the one row
 * a period with no sales shows. `sp-visually-hidden` comes from `src/styles/base.css`, and the loading state's
 * two bars — `sp-placeholder-cell` for a figure and `sp-placeholder-name` for the product column's wrapped
 * text — come from `src/styles/placeholders.css`, the single home for placeholder geometry, loaded by
 * `src/styles/account.css`.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/styles/admin-reports.css` declares no top-products block — `.sp-dashboard`
 * and `.sp-dashboard__section` belong to the page that stacks the dashboard's blocks, and
 * `.sp-report-table__scroll` exists for a report's wide table, whose `min-inline-size:
 * var(--layout-table-min-width)` floor five columns do not need — so the card frame and the primitive's own
 * container are the whole contract this file takes from the sheets, and no name is invented for a rule no
 * sheet holds.
 *
 * Three boundaries are deliberate. The rows are rendered in the order the read returned them and no column is
 * `sortable`, because the service ranks them under the requested metric and a header that reordered them would
 * state a different claim than the ranking asked for. That order is still stated rather than left to be
 * inferred: the column the read ranked by declares it through `orderInForce`, so its header announces the
 * direction to assistive technology while no header is a control — the toggle above the table is what changes
 * the ranking, and the table itself cannot. There is no paging, because the read is a `limit`-bounded ranking.
 * And no state is fetched or held here: the four states a read passes through belong to each dashboard surface,
 * so the page hands the ranking read's own failure in and this card renders it in its body, beside the retry,
 * with the metric control left live above it.
 *
 * The row's link is built from the product the row names rather than from a slug it does not carry:
 * `ProductPerformance` holds the product's id, name and sku and no slug, the product read behind the detail
 * route is keyed by that id (`GET /api/products/:id`), and a slug would mean deriving it from the name through
 * a rule `src/utils/strings.ts` already owns. The target comes from `productPath`, so no path is written here.
 */

/** The heading level the card's title renders at when the page names none: the level a block inside a
 *  dashboard section sits at. The card's title is the heading-3 type at every level. */
const DEFAULT_HEADING_LEVEL: 2 | 3 | 4 = 3;

/**
 * The key the product column is rendered and looked up by: the one column of this table whose cell holds a
 * name long enough to wrap, which is why the placeholder sizes its bar apart from the figures beside it.
 */
const PRODUCT_COLUMN_ID = "product";

/**
 * The classes `src/styles/placeholders.css` sizes a placeholder cell with: `sp-placeholder-cell` is one bar at
 * the height of the body-sm line the cell's own text renders in, and `sp-placeholder-name` is that same bar at
 * the height the product names take in this table's narrow product column. The sheet is the product's single
 * home for placeholder geometry and is loaded by `src/styles/account.css`, the last of the eight.
 */
const PLACEHOLDER_CELL_CLASS = "sp-placeholder-cell";
const PLACEHOLDER_NAME_CLASS = "sp-placeholder-cell sp-placeholder-name";

/** One placeholder figure, for a column whose cell holds a number, a share or a rank. */
function placeholderCell(): ReactElement {
  return <Skeleton className={PLACEHOLDER_CELL_CLASS} variant="text" />;
}

/** One placeholder name, for the column whose cell holds the product's own text. */
function placeholderNameCell(): ReactElement {
  return <Skeleton className={PLACEHOLDER_NAME_CLASS} variant="text" />;
}

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

/**
 * The two ways the ranking is ordered, in the order the toggle shows them: the closed set `Metric` declares,
 * each labelled with the dashboard's own word for that figure.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: the copy module declares no ranking-scoped pair, so the options carry
 * `ADMIN_COPY`'s revenue and units labels — the two figures the KPI cards state and the two the ranking is
 * ordered by — instead of a second pair written here.
 */
const METRIC_TOGGLES: readonly { readonly value: Metric; readonly label: string }[] = [
  { value: "revenue", label: ADMIN_COPY.KPI_REVENUE_LABEL },
  { value: "units", label: ADMIN_COPY.KPI_UNITS_LABEL },
];

/**
 * The product-performance report's own column words, read by cell key.
 *
 * The dashboard's ranking and that report state the same four things about a product — which one, what it
 * sold, what it earned and its share of the period — and the vocabulary module declares one label for each,
 * so the headings are read from `REPORT_DEFINITIONS`, the exported home of those columns, rather than written
 * a second time here. A module that declared no such report would yield no labels; the three definitions it
 * does declare always include one.
 */
const PRODUCTS_REPORT: ReportDefinition | undefined = REPORT_DEFINITIONS.find(
  (definition) => definition.kind === "products",
);
const PRODUCTS_COLUMNS: readonly ReportColumn[] = PRODUCTS_REPORT?.columns ?? [];
const PRODUCT_COLUMN_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  PRODUCTS_COLUMNS.map((column) => [column.key, column.label] as const),
);

/** Everything {@link RankControl} renders with: the metric in force, and the way a change is reported up. */
interface RankControlProps {
  /** The metric the page is ranking by, which is the option the toggle shows as pressed. */
  readonly metric: Metric;
  /** Called with the metric the reader picked, for the page to re-run its read. */
  readonly onMetricChange: (metric: Metric) => void;
}

/**
 * The ranking control: the two `Metric` values as one labelled group of toggle buttons.
 *
 * It is mounted in the card header's action slot and holds no state — the metric belongs to the page and to
 * the read behind the table, so a selection only travels back through `onMetricChange`. Each option is a real
 * button carrying the vocabulary's own words, `aria-pressed` states which one is in force, and the pressed
 * control also takes the primary variant, so the current ranking never rests on the fill alone.
 *
 * @param props - The metric in force and the callback that reports a change.
 * @returns The group of two toggle buttons.
 */
function RankControl({ metric, onMetricChange }: RankControlProps): ReactElement {
  return (
    <ButtonGroup label={ADMIN_COPY.TOP_PRODUCTS_RANK_CONTROL_LABEL}>
      {METRIC_TOGGLES.map((toggle) => {
        const isCurrent = metric === toggle.value;
        return (
          <Button
            key={toggle.value}
            variant={isCurrent ? "primary" : "secondary"}
            size="sm"
            aria-pressed={isCurrent}
            onClick={() => {
              onMetricChange(toggle.value);
            }}
          >
            {toggle.label}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}

/** Everything {@link TopProductsTable} accepts. */
export interface TopProductsTableProps {
  /**
   * The period's best-performing products, exactly as the page's analytics read returned them: already ranked
   * under the metric that was asked for, so the table renders the order it is handed and never re-ranks it.
   */
  readonly products: readonly ProductPerformance[];
  /** The metric the ranking in force was ordered by, shown as the pressed half of the toggle. */
  readonly metric: Metric;
  /** Called with the metric the reader picked, for the page to write into its query and read again. */
  readonly onMetricChange: (metric: Metric) => void;
  /** Whether the page is still reading the ranking. While it is, the table states itself busy and keeps the
   *  rows it already holds, so a change of metric leaves the previous ranking in place until the new one
   *  arrives; where it holds none, it renders the placeholder {@link placeholderRowCount} describes. Defaults
   *  to false. */
  readonly isLoading?: boolean;
  /**
   * How many rows the read that feeds this table asked for — the page's own limit — so the card reserves the
   * space those rows will take while the read is in flight: the placeholder is the height of a page of this
   * table's rows, including the several lines a product name takes in this column, so the block the reader is
   * looking at does not move when the ranking lands. Left out, no placeholder is rendered and the card shows
   * its header alone, which is what a caller that does not know the count wants.
   */
  readonly placeholderRowCount?: number;
  /**
   * The failure the page's own ranking read reported, or `null` when it answered. While a failure is handed
   * in the card keeps its frame, its title and the metric control — a change of metric re-runs the read and is
   * therefore a legitimate way out — and its body states the failure with {@link onRetry} in place of the
   * table, so a failed ranking read leaves the dashboard's figures, chart and orders table as they are. A
   * failure takes precedence over `isLoading`, because a read that did not answer is not still in flight.
   */
  readonly error?: ApiError | null;
  /**
   * Called when the reader asks for the ranking again: the page's `reload` for the read behind this table, so
   * the retry re-runs that one request and no other. It renders no control of its own, being the alert's
   * action alone, and is passed through untouched.
   */
  readonly onRetry?: () => void;
  /** The card's heading and the table's accessible name. Omitted or blank, the dashboard's own words for this
   *  block are used, so the heading and the caption always agree. */
  readonly title?: string;
  /** The level the heading renders at, defaulted to 3 so a block inside a dashboard section keeps the document
   *  outline in order. The size is the card title's at every level. */
  readonly headingLevel?: 2 | 3 | 4;
}

/**
 * The dashboard's best-performing products for a period, as one ranked table that can be read two ways.
 *
 * The rows arrive aggregated, ranked and shared by `src/lib/analyticsService.ts` — revenue and units are the
 * period's own figures, and the share is the percentage the read computed against the period's whole — so this
 * component computes no total, no share and no percentage of its own: revenue is rendered from integer minor
 * units by `src/utils/format.ts` and the share, which the read already scaled, by the scaled formatter the same
 * module owns. The rank column shows the ranking's own position and the product's name links to the catalogue's
 * detail route, because an administrator reads this table to answer what is selling and then to look at it.
 *
 * The only control is the metric toggle, and it is the page's: this component neither fetches nor holds the
 * ranking, so pressing it reports the choice upward and renders whatever comes back. A period with no sales
 * legitimately has no products, and the table then shows its empty row with the dashboard's own sentence rather
 * than a blank body. While the ranking is read and none is held, it shows the placeholder instead: the same
 * five columns and headings, one bar per figure and a taller block in the product column, at the count the
 * page's own read asked for, so the card is the height of the ranking that replaces it and the block below it
 * does not move when the ranking lands. A read the page could not answer is the card's own body too: the title
 * and the toggle stay live, so the ranking can be re-asked for while the failure is on screen, and the alert
 * carries the one retry.
 *
 * @param props - The ranked products, the metric in force with its callback, the loading flag and the row
 *   count it reserves, the failure with its retry, the heading and its level; see {@link TopProductsTableProps}.
 * @returns The card holding the ranking control and the ranked table.
 */
export function TopProductsTable({
  products,
  metric,
  onMetricChange,
  isLoading = false,
  placeholderRowCount = 0,
  error,
  onRetry,
  title,
  headingLevel = DEFAULT_HEADING_LEVEL,
}: TopProductsTableProps): ReactElement {
  const heading =
    title !== undefined && title.trim() !== "" ? title.trim() : ADMIN_COPY.TOP_PRODUCTS_HEADING;
  const failure = error ?? null;

  // Derived during render and never mirrored into state. The array is memoised because the table memoises the
  // presentation it builds from the columns on their identity, so a fresh array each render would defeat that,
  // and it is rebuilt when the metric changes because the column the read ranked by states that fact.
  const columns = useMemo<readonly DataTableColumn<ProductPerformance>[]>(
    () => [
      {
        id: "rank",
        // The heading is the product's own word for the position — `ProductPerformance.rank`, the value
        // `formatOrdinal` renders — declared once in the dashboard vocabulary rather than repeated here.
        header: ADMIN_COPY.TOP_PRODUCTS_RANK_COLUMN_LABEL,
        // The ranking's own position as the read reported it, never this file's index over the rows on show:
        // an index would be a second ranking, and it would shift with any later slice of the same list.
        cell: (row) => formatOrdinal(row.rank),
      },
      {
        id: PRODUCT_COLUMN_ID,
        header: PRODUCT_COLUMN_LABELS.product,
        cell: (row) => <Link to={productPath(row.productId)}>{row.productName}</Link>,
      },
      {
        id: "units",
        header: PRODUCT_COLUMN_LABELS.unitsSold,
        value: (row) => row.units,
        format: "integer",
        isNumeric: true,
        // The read ranked by the unit count under this metric, so the column states that order, and the
        // reader changes it from the toggle above the table rather than from a header this table cannot honour.
        orderInForce: metric === "units" ? "desc" : undefined,
      },
      {
        id: "revenue",
        header: PRODUCT_COLUMN_LABELS.revenue,
        value: (row) => row.netRevenueMinor,
        format: "money",
        isNumeric: true,
        // The same statement under the revenue metric, which is the read's default ranking.
        orderInForce: metric === "revenue" ? "desc" : undefined,
      },
      {
        id: "share",
        header: PRODUCT_COLUMN_LABELS.revenueShare,
        cell: (row) => formatScaledPercent(row.sharePercent),
        isNumeric: true,
      },
    ],
    [metric],
  );

  // The same five columns as the placeholder renders them: the same ids, headings, numeric alignment and rank,
  // with a bar where every cell's figure goes — and the wider, taller bar for the product column, whose names
  // are the one cell of this table that wraps. The headings are the vocabulary module's own words, so the table
  // the reader sees while the ranking is read is headed exactly as the ranking it becomes. No column is
  // sortable in either set: the ranking is the service's order, so no heading here carries a sort control.
  const placeholderColumns = useMemo<readonly DataTableColumn<number>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        align: column.align,
        isNumeric: column.isNumeric,
        cell: column.id === PRODUCT_COLUMN_ID ? placeholderNameCell : placeholderCell,
      })),
    [columns],
  );

  // Nothing has arrived and nothing is held: the table is about to be filled, so a page of its own rows is
  // reserved rather than an empty body shown. A table that already holds rows keeps them instead, because the
  // read under way is a re-ranking of the one the reader is looking at.
  const placeholderRows = placeholderRowKeys(placeholderRowCount);
  const isPlaceholderShown = isLoading && products.length === 0 && placeholderRows.length > 0;

  return (
    <Card>
      <CardHeader
        title={heading}
        action={<RankControl metric={metric} onMetricChange={onMetricChange} />}
        headingLevel={headingLevel}
      />
      {/* The body loses its flush edge only while the alert stands in for the table: a table meets the frame
          with no padding of its own, while the alert brings the padding the card's other bodies carry. */}
      <CardBody isFlush={failure === null}>
        {failure === null ? (
          isPlaceholderShown ? (
            // The ranking the reader is waiting for, in the shape it arrives in: the same columns and headings, a
            // bar where every figure goes, a wrapped-name block in the product column, and the page's own row
            // count. The frame reports the wait; the table inside is hidden from assistive technology, because a
            // table of empty cells read out as content is not a state anyone asked for.
            <div aria-busy="true">
              <div aria-hidden="true">
                <DataTable
                  columns={placeholderColumns}
                  rows={placeholderRows}
                  rowKey={(row) => String(row)}
                  caption={heading}
                  isLoading
                  density="compact"
                />
              </div>
            </div>
          ) : (
            <DataTable<ProductPerformance>
              columns={columns}
              rows={products}
              rowKey={(row) => row.productId}
              caption={heading}
              emptyState={<p>{EMPTY_STATES.dashboardRange.title}</p>}
              isLoading={isLoading}
              density="compact"
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
