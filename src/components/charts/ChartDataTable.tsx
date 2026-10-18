/**
 * Path: src/components/charts/ChartDataTable.tsx
 * Purpose: The paired data table every chart renders as its accessible alternative, memoised so a renderer's hover readout cannot reconcile its rows
 * Lines: 167
 */

import { memo, useCallback, useState } from "react";
import type { ReactElement } from "react";

import type { ChartDataRow } from "@/components/charts/chartGeometry";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/components/ui/hooks";
import { PAGE_SIZE_OPTIONS } from "@/constants/config";
import { PAGING_NOUNS } from "@/constants/content";
import type { PagingNoun } from "@/constants/content";

/*
 * Class contract. `src/styles/data-display.css`, loaded through `src/styles/components.css`, owns the
 * primitive this table composes: `sp-table` for the table itself, `sp-table--compact` for the dense rows a
 * paired table is read in, `sp-table__caption` for its caption and `sp-table__num` for a column whose
 * figures line up on their digits. `th[scope="row"]` is the primitive's own row-heading contract rather than
 * a class, so the label column needs no name of its own here, and no width, colour or padding is written.
 */

/**
 * The largest size the product configures, which is the page this table states its rows in: taken from
 * `PAGE_SIZE_OPTIONS` rather than chosen here, so a table that fits on one page renders exactly the rows it
 * always did and no pager at all.
 */
const TABLE_PAGE_SIZE = Math.max(...PAGE_SIZE_OPTIONS);

/**
 * Everything {@link ChartDataTable} accepts.
 *
 * The three renderers hand it what their own memoised table models already hold, so nothing here is derived:
 * the caption is the wording a caller composed, the ids are the caller's `useId` values, and the rows are the
 * model's own `readonly` array. `columns` is absent where a table has no column wording to show, which is the
 * donut's case — its value and share columns have no heading in `src/constants/content.ts`, so a header row of
 * empty headings would state less than the caption already does.
 */
export interface ChartDataTableProps {
  /** The table's accessible name, rendered as its caption. */
  readonly caption: string;
  /** The id the SVG's aria-describedby points at, where the caller puts it on the table element. */
  readonly tableId?: string;
  /** The id the caption carries where the caller points aria-describedby at the caption instead. */
  readonly captionId?: string;
  /** The column headings; an empty or absent list renders no header row. */
  readonly columns?: readonly string[];
  /**
   * The React key each column and each cell renders under, one per column in `columns` and, where `columns` is
   * absent, one per cell of a row. Required, and stable: every column states its own identity — a donut's
   * value and share columns keep theirs while the rows change — so no cell is ever keyed by its position in an
   * array, which a reordering would silently reuse.
   */
  readonly columnKeys: readonly string[];
  /** One row per band, bucket or slice, each carrying its own key, its label and one cell per column. */
  readonly rows: readonly ChartDataRow[];
  /**
   * The collection the paging caption counts, named by the surface that knows what the rows are: a renderer
   * forwards the noun its own caller gave, and a caller that says nothing keeps the product default.
   * Defaults to `PAGING_NOUNS.PRODUCTS`, which is what rows holding products draw — but a chart drawn over
   * reporting periods must pass `PAGING_NOUNS.PERIODS`, or its caption counts the wrong collection.
   */
  readonly countNoun?: PagingNoun;
}

/**
 * The paired data table a chart shows beside its drawing, so no figure is readable through colour or geometry
 * alone: the line, bar and donut renderers all mount this one table rather than repeating its markup.
 *
 * Memoised, and that is the reason this component exists rather than the markup it holds. Each renderer keeps
 * the hover readout as its own state, so a pointer moving from band to band re-renders the renderer above this
 * one; a table written inline in that renderer is therefore reconciled on every band change, and a
 * day-bucketed year range puts some 366 rows into it. Here the renderer's props are compared shallowly instead
 * and the subtree is skipped — which is why every prop a renderer passes must keep its identity across a
 * hover: the rows, columns and keys come from the caller's own `useMemo` and the caption and ids are strings.
 *
 * The keys are the caller's own column identities rather than positions in an array: a donut states its value
 * and share columns once for the whole table, and a series' own id names both its column and the cell each row
 * carries for it, so no key a row renders under changes when the rows do.
 *
 * The rows are stated one page at a time under the paging control the product shares, because a table holding
 * every band of a year range is the largest element tree a chart mounts and the readout re-renders the
 * renderer above it on every pointer move. Nothing is dropped by it: the rows are paged, never sampled, so
 * every figure stays reachable through the control, and a table that fits on one page renders its rows and no
 * pager at all.
 *
 * That pager counts what the rows are rather than what the shared control defaults to, and the noun comes from
 * the caller through `countNoun`: the renderers forward theirs, so a chart drawn over reporting periods
 * announces periods while a caller that names nothing keeps the product default.
 *
 * @param props - The caption and the ids that describe the drawing, the column headings and their keys, the
 * rows to render and the collection the paging caption counts.
 * @returns The table, in the markup the three renderers drew inline before this component held it, and the
 * paging control beneath it once its rows need more than one page.
 */
export const ChartDataTable = memo(function ChartDataTable({
  caption,
  tableId,
  captionId,
  columns,
  columnKeys,
  rows,
  countNoun = PAGING_NOUNS.PRODUCTS,
}: ChartDataTableProps): ReactElement {
  // The page is this component's own state rather than a caller's, and it is clamped while the slice is
  // derived rather than reset from an effect: a narrower range redrawing over fewer bands cannot leave the
  // table on a page that is gone, and no caller has to know a page number exists.
  const [page, setPage] = useState(1);
  const handlePageChange = useCallback((next: number): void => setPage(next), []);
  const {
    page: currentPage,
    pageSize,
    pageCount,
  } = usePagination({
    page,
    pageSize: TABLE_PAGE_SIZE,
    total: rows.length,
    onChange: handlePageChange,
  });
  const firstRow = (currentPage - 1) * pageSize;
  const visibleRows = rows.slice(firstRow, firstRow + pageSize);

  return (
    <>
      <table className="sp-table sp-table--compact" id={tableId}>
        <caption className="sp-table__caption" id={captionId}>
          {caption}
        </caption>
        {columns?.length ? (
          <thead>
            <tr>
              {columns.map((heading, index) => (
                <th key={columnKeys[index]} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, index) => (
                <td className="sp-table__num" key={columnKeys[index + 1]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 ? (
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={rows.length}
          label={caption}
          countNoun={countNoun}
          onPageChange={handlePageChange}
        />
      ) : null}
    </>
  );
});
