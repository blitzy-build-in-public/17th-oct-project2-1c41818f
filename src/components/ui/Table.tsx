/**
 * Path: src/components/ui/Table.tsx
 * Purpose: Sortable data table with column definitions, empty state, sticky header and the pagination contract
 * Lines: 472
 */

import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { Pagination } from "@/components/ui/Pagination";
import type { PaginationProps } from "@/components/ui/Pagination";
import { EMPTY_STATES } from "@/constants/content";
import type { ReportCellFormat, ReportCellValue } from "@/types/analytics";
import type { PageResult, SortDirection } from "@/types/common";
import { sortByKey } from "@/utils/collections";
import { formatCellValue } from "@/utils/format";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class below is consumed by name. `src/styles/data-display.css`, loaded through
 * `src/styles/components.css`, owns the data table: `sp-table-wrap` is its scroll container, `sp-table` the
 * table, `sp-table--compact` the dense row, `sp-table__caption` the caption, `sp-table__num` a column whose
 * figures line up on their digits (qualified by `.sp-table` in the sheet so that it also beats the sticky
 * header's `text-align`), `sp-table__sort` the header button — whose caret the sheet draws from the
 * `[aria-sort]` its header cell carries — and `sp-table__empty` the single row a table with nothing to show
 * renders. The control composed at the foot wears the pagination family, and `sp-visually-hidden` is the
 * global utility of `src/styles/base.css`.
 *
 * The scroll container is the product's answer to a narrow viewport: a report or an order table travels
 * sideways rather than compressing its columns below legibility, so this file writes no width of its own. A
 * caller whose own block sets the floor — `sp-report-table__scroll`, `sp-order-history__table` — hands it in
 * through `className`, appended to the scroll container, or `tableClassName`, appended to the table, so
 * `src/styles/admin-reports.css` and `src/styles/account.css` keep owning that decision.
 *
 * State is carried by attributes rather than by a second class, as the sheets' shared contract requires:
 * `aria-sort` on the header cell and `aria-busy` on the table while a request is in flight.
 *
 * Sorting and paging are consumed rather than restated. The displayed rows come from `sortByKey` in
 * `src/utils/collections.ts`, whose own consumer list names this file and whose paging helpers are reached
 * through the composed control; a cell's figures are rendered by `formatCellValue` in `src/utils/format.ts`,
 * the product's single dispatcher for money, percentages, shares, numbers and dates. A comparator, a page
 * window or a currency symbol written here would each be a second home for a rule the request forbids
 * duplicating.
 *
 * Three deliberate decisions:
 *   - No clickable rows. There is no `onRowClick`, because a row that answers a pointer but cannot be
 *     reached by a keyboard is an accessibility defect; every navigating table in the product renders a real
 *     link inside its `cell` instead, as the order history and the recent-orders table both do.
 *   - The empty state is a slot rather than a composed component. `src/components/ui/Feedback.tsx` is
 *     written later in the same phase, so importing it would break this phase's compile gate, and a table's
 *     empty state is a table row rather than a block-level panel — a different rendering context, not a
 *     duplicate. A caller that wants the panel treatment passes `EmptyState` into `emptyState`.
 *   - The control of `src/components/ui/Pagination.tsx` is composed here and that file never imports this
 *     one, so the two share one paging implementation without a cycle between them.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: the sheets declare no non-sticky header and no busy paint for a table — the
 * primitive makes every `.sp-table thead th` sticky as its default — so `isStickyHeader` and `isLoading` are
 * reported by attribute (`data-sticky-header`, `aria-busy`) and no class is invented here for a rule no sheet
 * holds. The same holds for a centred column: `sp-table__num` is the one alignment class the sheets declare,
 * so an end-aligned column wears it while a centred one is set from the caller's own value.
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` holds no wording for a sort direction, and this is
 * the one place it is missed. The direction is therefore carried by `aria-sort` on the header cell — which
 * assistive technology announces as "sorted ascending" or "sorted descending" — and by the caret the sheet
 * draws from that attribute, rather than by a sentence this file would have to invent.
 */

/** The `aria-sort` value a sortable column's header cell carries. */
type AriaSortValue = "ascending" | "descending" | "none";

/** The fewest cells the empty row spans, so a table handed no columns still renders one cell. */
const EMPTY_ROW_MIN_CELLS = 1;

/**
 * The one alignment no sheet declares a class for. A centred column is set from the caller's own value
 * rather than by inventing a rule, and the object is allocated once because every cell of the column shares
 * it.
 */
const CENTRED_CELL_STYLE: CSSProperties = { textAlign: "center" };

/** Joins the class names one part of the table composes, leaving out every absent one. */
function classNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/** Whether a column can be sorted: it asks to be, and it exposes the value an order reads. */
function isSortableColumn<TItem>(column: DataTableColumn<TItem>): boolean {
  return column.sortable === true && column.value !== undefined;
}

/** The `aria-sort` the header cell of `columnId` reports while `sort` is the order in force. */
function ariaSortValue(columnId: string, sort: DataTableSort | undefined): AriaSortValue {
  if (sort === undefined || sort.columnId !== columnId) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * The order one activation of `columnId`'s header moves to.
 *
 * The cycle is ascending, then descending, then the column's default order, and it never repeats a state
 * the reader is already looking at: a column that is not the sorted one starts ascending, an ascending
 * column turns descending, and a descending one returns to the view the table opens in — the declared
 * default when that default orders another column, and ascending otherwise, so a table with no declared
 * default toggles between the two directions instead of stalling on the third activation.
 *
 * @param columnId - The column whose header was activated.
 * @param current - The order in force, or `undefined` when the rows are shown in the order they arrived.
 * @param fallback - The table's declared default sort, read only to restore it.
 * @returns The order to apply next; always a concrete sort, so a caller can store and report it.
 */
function nextSort(
  columnId: string,
  current: DataTableSort | undefined,
  fallback: DataTableSort | undefined,
): DataTableSort {
  if (current === undefined || current.columnId !== columnId) {
    return { columnId, direction: "asc" };
  }
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return fallback !== undefined && fallback.columnId !== columnId
    ? fallback
    : { columnId, direction: "asc" };
}

/**
 * The text one cell shows when its column declares no renderer of its own: the column's `format` applied to
 * the value its `value` reads, through the product's single cell dispatcher. A money cell holds minor units
 * and a percent cell a ratio, so the format travels with the column rather than being baked into a printed
 * string; a column that supplies neither a `cell` nor a `value` renders nothing, which is what a spacer or
 * a purely presentational column is.
 *
 * @param column - The column the cell belongs to.
 * @param row - The row being rendered.
 * @param index - The row's position among the rows on show, counted from zero.
 * @returns The cell's content.
 */
function cellContent<TItem>(column: DataTableColumn<TItem>, row: TItem, index: number): ReactNode {
  if (column.cell !== undefined) return column.cell(row, index);
  if (column.value === undefined) return null;
  return formatCellValue(column.value(row), column.format ?? "text");
}

/**
 * Everything one column contributes to a render, derived once per render rather than per cell: whether it
 * can be sorted, the alignment class its cells and its header share, the alignment style the sheets declare
 * no class for, and the width of the column's own track.
 */
interface ColumnPresentation<TItem> {
  readonly column: DataTableColumn<TItem>;
  readonly isSortable: boolean;
  readonly alignmentClassName: string | undefined;
  readonly alignmentStyle: CSSProperties | undefined;
  readonly widthStyle: CSSProperties | undefined;
}

/**
 * One column of a {@link DataTable}: the key React tracks it by, the heading every row's cell sits under,
 * how its values are rendered, and how it is ordered.
 *
 * The data path is `value` plus `format` — the value unformatted, the format the one its column declares —
 * and `cell` is the escape hatch for a column that renders a component: a link, a badge, an actions group.
 * Because both paths are per-column and every row then maps the same list of columns, no header or cell
 * markup is written twice anywhere in this file.
 *
 * A column that asks to be sorted without exposing a `value` is a caller error; it is treated as unsorted
 * rather than crashing the table.
 */
export interface DataTableColumn<TItem> {
  /** The key this column is rendered and looked up by; also the cell key of every row. */
  readonly id: string;
  /** The heading shown in the header cell, and the sort control's own label. */
  readonly header: ReactNode;
  /**
   * Renders the cell from the row itself, for a column whose content is a component. Given the row and its
   * position among the rows on show.
   */
  readonly cell?: (row: TItem, index: number) => ReactNode;
  /** Reads the cell's raw value: unformatted, and the value a sort orders the column by. */
  readonly value?: (row: TItem) => ReportCellValue;
  /** How `value` is rendered; `text` when a column declares none. */
  readonly format?: ReportCellFormat;
  /** Offers the column's header as a sort control. */
  readonly sortable?: boolean;
  /**
   * Marks a column of figures, which align on their digits rather than on their glyphs — the money, count
   * and percentage columns of every table.
   */
  readonly isNumeric?: boolean;
  /**
   * Where the column's text sits. `end` takes the sheet's numeric alignment class, which also gives the
   * column tabular figures; `center` is applied from this value because no sheet declares a class for it;
   * `start` is the table's own default.
   */
  readonly align?: "start" | "center" | "end";
  /** The width of the column's own track, written on the column element rather than on every cell. */
  readonly width?: string;
  /**
   * The column's fuller name, where the heading is too terse to name the control that sorts it. Applied as
   * the accessible name of the sort button, or of the header cell when the column is not sortable.
   */
  readonly caption?: string;
}

/**
 * The order one column of a {@link DataTable} is in: which column, and which way.
 *
 * The direction is the shared `SortDirection` the query string carries and the listing services apply, so a
 * table's order round-trips through the URL and back without a second vocabulary for it.
 */
export interface DataTableSort {
  /** The `id` of the sorted column. */
  readonly columnId: string;
  /** The direction the column is ordered in. */
  readonly direction: SortDirection;
}

/**
 * The pagination contract every paged table in the product is handed, and what {@link DataTable} reports
 * through.
 *
 * The six paging fields are `PageResult`'s own — projected out of it rather than restated, so a listing can
 * pass a service result's paging straight through and neither side can drift from the payload it came from —
 * and the two handlers say where a change is reported. The catalogue, the account order history, the
 * recent-orders table and the report tables all page through this one type, so the pager's collection noun
 * and the ownership of its count announcement travel with the contract rather than being re-declared by every
 * surface: a table of orders or report rows hands in its own `countNoun`, and a surface that already announces
 * the count in a live region of its own sets `isCountAnnouncedByCaller`.
 */
export type DataTablePaging = Pick<
  PageResult<unknown>,
  "page" | "pageSize" | "total" | "pageCount" | "hasNext" | "hasPrevious"
> & {
  /** Called with the page the reader asked for. */
  readonly onPageChange: (page: number) => void;
  /** Called with a newly chosen page size; absent, the size selector is not rendered. */
  readonly onPageSizeChange?: (pageSize: number) => void;
} & Pick<PaginationProps, "countNoun" | "isCountAnnouncedByCaller">;

/**
 * Everything {@link DataTable} accepts.
 *
 * `sort` makes the table's order controlled — the caller owns it and refetches when it changes — and leaving
 * it out makes the table order its own rows, starting from `defaultSort`. `paging` renders the shared
 * pagination control under the table from the contract's own fields.
 */
export interface DataTableProps<TItem> {
  /** The columns, in display order. */
  readonly columns: readonly DataTableColumn<TItem>[];
  /** The rows to show: the page the caller holds, not the whole collection. */
  readonly rows: readonly TItem[];
  /**
   * Reads a row's stable identity for React's key — an order number, a product id. Given the row and its
   * position among the rows on show; the index is a convenience and never the key itself, because a
   * position changes the moment the order or the page does.
   */
  readonly rowKey: (row: TItem, index: number) => string;
  /** The table's accessible name, and its caption when the caption is visible. */
  readonly caption: string;
  /** Shows the caption above the table instead of leaving it to assistive technology. */
  readonly isCaptionVisible?: boolean;
  /**
   * What to show inside the single empty row: an `EmptyState` from `src/components/ui/Feedback.tsx`, or any
   * other explanation. Absent, the row carries the catalogue empty state's sentence.
   */
  readonly emptyState?: ReactNode;
  /** The order in force, when the caller owns it. */
  readonly sort?: DataTableSort;
  /** The order the table opens in while the caller does not own it. */
  readonly defaultSort?: DataTableSort;
  /** Called with the order a header activation asks for, so a paged caller can refetch. */
  readonly onSortChange?: (sort: DataTableSort) => void;
  /** The paging to report and render: `PageResult`'s own fields, the two handlers and the pager's caption. */
  readonly paging?: DataTablePaging;
  /** Marks the table busy and keeps the rows it already holds visible until the next page arrives. */
  readonly isLoading?: boolean;
  /** Leaves the header in place while the rows scroll under it; the primitive's default. */
  readonly isStickyHeader?: boolean;
  /** The comfortable row, or the dense one the charts' paired tables and the back office use. */
  readonly density?: "comfortable" | "compact";
  /** A row closed over the table — the totals row a report ends with — rendered in the table's foot. */
  readonly footer?: ReactNode;
  /** Appended to the scroll container's own class, for the caller's own block. */
  readonly className?: string;
  /** Appended to the table's own class, for a caller that floors the table's inline size. */
  readonly tableClassName?: string;
}

/**
 * The product's table: a real table whose header and cells are mapped from one list of column definitions,
 * the order the reader applies from a header, a single empty row when there is nothing to show, and the
 * shared pagination control beneath it.
 *
 * The order is controlled when the caller passes `sort` and the table's own otherwise, seeded from
 * `defaultSort` — the effective order is derived during render, never copied into state by an effect — so a
 * URL-driven listing owns its order and a table embedded in a page does not need to. `onSortChange` reports
 * every activation either way, which is what lets a caller that pages on the server refetch while a caller
 * that holds its rows whole gets the ordering for free.
 *
 * Sorting reads the rows through `column.value` and orders them with `sortByKey`, so absent values sort last
 * in both directions, ties keep the order the rows arrived in and the result is reproducible. Paging is not
 * applied here: the rows are the page the caller holds, and the control beneath the table reports the page
 * the reader asked for.
 *
 * A row is never a control — see the module note on clickable rows — and a cell is never a bare string this
 * file assembled from a number: money, percentages, counts and dates are rendered by the product's cell
 * dispatcher, so a figure reads the same here as it does in the CSV a report exports.
 *
 * @param props - The columns, the page of rows, the caption, the order, the paging and the presentation;
 *   see {@link DataTableProps}.
 * @returns The scroll container holding the table, and the pagination control when paging is supplied.
 */
export function DataTable<TItem>({
  columns,
  rows,
  rowKey,
  caption,
  isCaptionVisible = false,
  emptyState,
  sort,
  defaultSort,
  onSortChange,
  paging,
  isLoading = false,
  isStickyHeader = true,
  density = "comfortable",
  footer,
  className,
  tableClassName,
}: DataTableProps<TItem>): ReactElement {
  const [uncontrolledSort, setUncontrolledSort] = useState<DataTableSort | undefined>(defaultSort);
  const isControlled = sort !== undefined;
  const activeSort = sort ?? uncontrolledSort;

  const sortColumn = useMemo(
    () =>
      activeSort === undefined
        ? undefined
        : columns.find((column) => column.id === activeSort.columnId),
    [activeSort, columns],
  );

  const sortAccessor = useMemo(
    () => (sortColumn !== undefined && isSortableColumn(sortColumn) ? sortColumn.value : undefined),
    [sortColumn],
  );

  const displayedRows = useMemo(
    () =>
      activeSort === undefined || sortAccessor === undefined
        ? rows
        : sortByKey(rows, sortAccessor, activeSort.direction),
    [activeSort, rows, sortAccessor],
  );

  const presentations = useMemo(
    () =>
      columns.map(
        (column): ColumnPresentation<TItem> => ({
          column,
          isSortable: isSortableColumn(column),
          alignmentClassName:
            column.isNumeric === true || column.align === "end" ? "sp-table__num" : undefined,
          alignmentStyle: column.align === "center" ? CENTRED_CELL_STYLE : undefined,
          widthStyle: column.width === undefined ? undefined : { inlineSize: column.width },
        }),
      ),
    [columns],
  );

  const hasColumnWidths = useMemo(
    () => presentations.some((presentation) => presentation.widthStyle !== undefined),
    [presentations],
  );

  const handleColumnActivation = useCallback(
    (columnId: string): void => {
      const next = nextSort(columnId, activeSort, defaultSort);
      if (!isControlled) setUncontrolledSort(next);
      onSortChange?.(next);
    },
    [activeSort, defaultSort, isControlled, onSortChange],
  );

  const isEmptyRowVisible = !isLoading && displayedRows.length === 0;

  return (
    <>
      <div className={classNames("sp-table-wrap", className)}>
        <table
          className={classNames(
            "sp-table",
            density === "compact" && "sp-table--compact",
            tableClassName,
          )}
          aria-busy={isLoading ? true : undefined}
          data-sticky-header={isStickyHeader ? "true" : "false"}
        >
          <caption
            className={classNames("sp-table__caption", !isCaptionVisible && "sp-visually-hidden")}
          >
            {caption}
          </caption>
          {hasColumnWidths ? (
            <colgroup>
              {presentations.map((presentation) => (
                <col key={presentation.column.id} style={presentation.widthStyle} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr>
              {presentations.map((presentation) => (
                <th
                  key={presentation.column.id}
                  scope="col"
                  aria-sort={
                    presentation.isSortable
                      ? ariaSortValue(presentation.column.id, activeSort)
                      : undefined
                  }
                  aria-label={presentation.isSortable ? undefined : presentation.column.caption}
                  className={presentation.alignmentClassName}
                  style={presentation.alignmentStyle}
                >
                  {presentation.isSortable ? (
                    <button
                      type="button"
                      className="sp-table__sort"
                      aria-label={presentation.column.caption}
                      onClick={() => handleColumnActivation(presentation.column.id)}
                    >
                      {presentation.column.header}
                    </button>
                  ) : (
                    presentation.column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isEmptyRowVisible ? (
              <tr>
                <td
                  className="sp-table__empty"
                  colSpan={Math.max(presentations.length, EMPTY_ROW_MIN_CELLS)}
                >
                  {emptyState ?? <p>{EMPTY_STATES.catalogue.title}</p>}
                </td>
              </tr>
            ) : (
              displayedRows.map((row, index) => (
                <tr key={rowKey(row, index)}>
                  {presentations.map((presentation) => (
                    <td
                      key={presentation.column.id}
                      className={presentation.alignmentClassName}
                      style={presentation.alignmentStyle}
                    >
                      {cellContent(presentation.column, row, index)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer === undefined ? null : <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {paging === undefined ? null : <Pagination {...paging} />}
    </>
  );
}
