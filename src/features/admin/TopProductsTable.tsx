/**
 * Path: src/features/admin/TopProductsTable.tsx
 * Purpose: The dashboard's best-performing-products table by revenue or units
 * Lines: 250
 */

import { useMemo, type ReactElement } from "react";
import { Link } from "react-router-dom";

import { Button, ButtonGroup } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/Table";
import { ADMIN_COPY, EMPTY_STATES } from "@/constants/content";
import { productPath } from "@/constants/routes";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import type { Metric, ProductPerformance, ReportColumn, ReportDefinition } from "@/types/analytics";
import { formatOrdinal, formatScaledPercent } from "@/utils/format";

/*
 * Class contract. `src/styles/data-display.css` — the sheet `src/styles/components.css` loads through
 * `@import` — owns the card and the data table this file composes, and `src/styles/controls.css` the control
 * group, so every class below is adopted by name and no stylesheet is imported here: `src/main.tsx` is the
 * only importer of `src/styles/**`. The card brings `sp-card` with its `sp-card__header`, `sp-card__heading`,
 * `sp-card__title` and `sp-card__action` regions and the `sp-card__body--flush` body a card holding a table
 * gives no padding to, so the table meets the frame; the group brings `sp-btn-group` and the `sp-btn` family,
 * and the table brings `sp-table-wrap` (the scroll container, so a narrow viewport scrolls these five columns
 * rather than squeezing them), `sp-table`, `sp-table--compact` for the back office's dense row,
 * `sp-table__caption`, `sp-table__num` for the three columns of figures and `sp-table__empty` for the one row
 * a period with no sales shows. `sp-visually-hidden` comes from `src/styles/base.css`.
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
 * state a different claim than the ranking asked for. There is no `error` prop, because the page owns the one
 * error surface for the range it requested, and no paging, because the read is a `limit`-bounded ranking.
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
 * The word the ranking column is headed with.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` words the control above the table
 * (`TOP_PRODUCTS_RANK_CONTROL_LABEL`) and `src/constants/taxonomy.ts` names the figures a ranking sells, but
 * neither module declares a word for the position itself, so the one below is this file's rather than a
 * control's label reused where a column heading belongs. It is the product's own word for the value —
 * `ProductPerformance.rank`, and `formatOrdinal`'s note that it renders "the rank a top-products table
 * shows" — and one added key in content.ts is all this column needs to speak the dashboard's register.
 */
const RANK_COLUMN_HEADING = "Rank";

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
   *  arrives. Defaults to false. */
  readonly isLoading?: boolean;
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
 * than a blank body.
 *
 * @param props - The ranked products, the metric in force with its callback, the loading flag, the heading and
 *   its level; see {@link TopProductsTableProps}.
 * @returns The card holding the ranking control and the ranked table.
 */
export function TopProductsTable({
  products,
  metric,
  onMetricChange,
  isLoading = false,
  title,
  headingLevel = DEFAULT_HEADING_LEVEL,
}: TopProductsTableProps): ReactElement {
  const heading =
    title !== undefined && title.trim() !== "" ? title.trim() : ADMIN_COPY.TOP_PRODUCTS_HEADING;

  // Derived during render and never mirrored into state. The array is memoised because the table memoises the
  // presentation it builds from the columns on their identity, so a fresh array each render would defeat that.
  const columns = useMemo<readonly DataTableColumn<ProductPerformance>[]>(
    () => [
      {
        id: "rank",
        header: RANK_COLUMN_HEADING,
        // The ranking's own position as the read reported it, never this file's index over the rows on show:
        // an index would be a second ranking, and it would shift with any later slice of the same list.
        cell: (row) => formatOrdinal(row.rank),
      },
      {
        id: "product",
        header: PRODUCT_COLUMN_LABELS.product,
        cell: (row) => <Link to={productPath(row.productId)}>{row.productName}</Link>,
      },
      {
        id: "units",
        header: PRODUCT_COLUMN_LABELS.unitsSold,
        value: (row) => row.units,
        format: "integer",
        isNumeric: true,
      },
      {
        id: "revenue",
        header: PRODUCT_COLUMN_LABELS.revenue,
        value: (row) => row.netRevenueMinor,
        format: "money",
        isNumeric: true,
      },
      {
        id: "share",
        header: PRODUCT_COLUMN_LABELS.revenueShare,
        cell: (row) => formatScaledPercent(row.sharePercent),
        isNumeric: true,
      },
    ],
    [],
  );

  return (
    <Card>
      <CardHeader
        title={heading}
        action={<RankControl metric={metric} onMetricChange={onMetricChange} />}
        headingLevel={headingLevel}
      />
      <CardBody isFlush>
        <DataTable<ProductPerformance>
          columns={columns}
          rows={products}
          rowKey={(row) => row.productId}
          caption={heading}
          emptyState={<p>{EMPTY_STATES.dashboardRange.title}</p>}
          isLoading={isLoading}
          density="compact"
        />
      </CardBody>
    </Card>
  );
}
