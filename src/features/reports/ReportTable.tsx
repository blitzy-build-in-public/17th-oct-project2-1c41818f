/**
 * Path: src/features/reports/ReportTable.tsx
 * Purpose: The report table with sortable columns, a totals row and the CSV export action
 * Lines: 397
 */

import { useCallback, useId, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { usePagination } from "@/components/ui/hooks";
import { DataTable } from "@/components/ui/Table";
import type { DataTableColumn, DataTablePaging, DataTableSort } from "@/components/ui/Table";
import { CSV_MAX_CELL_LENGTH, CSV_MAX_ROWS, DEFAULT_PAGE_SIZE } from "@/constants/config";
import { EMPTY_STATES, FEEDBACK_COPY, PAGING_NOUNS } from "@/constants/content";
import {
  DATE_RANGE_COPY,
  REPORTS_COPY,
  exportNote,
  exportRowCountNote,
} from "@/constants/content-reports";
import { toCsvMatrix, totalsRowCells } from "@/lib/reportService";
import { useToast } from "@/state/ToastContext";
import type {
  BucketGranularity,
  ReportDefinition,
  ReportKind,
  ReportRow,
  ReportSummary,
} from "@/types/analytics";
import type { DateRange } from "@/types/common";
import { normalisePageSize, paginate, sortByKey } from "@/utils/collections";
import { buildCsvResult, downloadCsv } from "@/utils/csv";
import type { CsvBuildResult } from "@/utils/csv";
import { formatBucketCell, formatDateRange } from "@/utils/dates";
import { formatCellValue } from "@/utils/format";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of this block, and no file under
 * `src/features/**` may import a stylesheet — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class below is adopted by name, and this comment is the list the sheet owes the file:
 * `sp-report-table` is the block stacking the export action over the table and spacing the two apart;
 * `sp-report-table__scroll` is the horizontal scroll container `DataTable` appends to its own, floored to the
 * sheet's table width so a wide report travels sideways instead of squeezing its columns below legibility;
 * `sp-report-table__totals` is the totals row that closes the table, whose raised surface and semibold
 * figures stay the primitive's and whose thicker top rule the sheet adds; and `sp-report-table__num` is the
 * alignment a money or count cell of that row takes, qualified by the block so it also out-specifies the
 * sticky header. `sp-export` is the action group — the CSV control beside its captions — and
 * `sp-export__note` the captions themselves: the cap the download is bounded by, and, once one has been
 * prepared for the run on screen, the row count its file held.
 *
 * Everything else the table needs belongs to the primitive. `DataTable` owns the caption, the `aria-sort`
 * header semantics, the sticky header, the tabular-numeric treatment, the single empty row and the composed
 * paginator, so no comparator, page window or cell formatter is written here: the order comes from `sortByKey`
 * over each column's raw cell, a cell is rendered by `formatCellValue` from the `ReportCellFormat` its column
 * declares — except the period column, whose wording is `formatBucketCell`'s so that a bucket the selected
 * range clips states the days of it the range covers — and the export is built by `reportService.toCsvMatrix`
 * from the same rows, the same definition and the same summary the table renders over — which is what stops
 * the download from disagreeing with the screen, down to the totals row, which is `totalsRowCells`' output in
 * both.
 *
 * The order and the page are this file's, and both are applied to the whole run before the primitive is handed
 * anything. `DataTable` sorts only what it is given, and what it is given is one page, so an order left to the
 * primitive would reorder the page on show and leave the rest of the range in the order the service produced,
 * stating a claim about the range it had not checked: here every row the run produced is ordered, the page is
 * cut from that order, and a sort activation reopens it at its first page, so the row the table states first is
 * the range's own extreme in that column. The totals row and the export stay over the whole run, so the sorted
 * view is still a view of the range it claims.
 *
 * The export is prepared and started synchronously: the matrix, the serialisation and the download are one
 * call, so there is no in-flight window for the control to be disabled for, and a second activation simply
 * writes the same file again.
 *
 * The two captions beside the control state two different facts, and no sentence states both: the cap the
 * download is bounded by comes from `CSV_MAX_ROWS` and `CSV_MAX_CELL_LENGTH` in `src/constants/config.ts`,
 * and the count the last file held is stated separately by `exportRowCountNote` from
 * `src/constants/content-reports.ts`, the module every dashboard and reports sentence lives in.
 */

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  block: "sp-report-table",
  scroll: "sp-report-table__scroll",
  totals: "sp-report-table__totals",
  numeric: "sp-report-table__num",
  export: "sp-export",
  exportNote: "sp-export__note",
} as const;

/** The identity of one report run: the report, the period it covered and the cut it was bucketed by. Two
 *  renders that agree here show the same rows, which is how the paging and the prepared export in force are
 *  recognised — derived during render rather than reset by an effect. */
function runKeyOf(kind: ReportKind, range: DateRange, granularity: BucketGranularity): string {
  return `${kind}|${range.from}|${range.to}|${granularity}`;
}

/** The name a download is offered under: the report's kind, its cut and the two ends of its period, all of
 *  them already machine-shaped, so the file a reader saves names what it holds. `src/utils/csv.ts` sanitises
 *  the name and adds the extension. */
function exportFileNameOf(
  kind: ReportKind,
  range: DateRange,
  granularity: BucketGranularity,
): string {
  return `${kind}-${granularity}-${range.from}-${range.to}`;
}

/** The key a period column carries in every definition that has one, so the cell wording below is attached to
 *  the column of dates rather than to a column's position in the table. */
const PERIOD_COLUMN_KEY = "period";

/** The wording one row's period cell shows: the day the bucket opens when the range covers it whole, and the
 *  days of it the range holds when the range clips it — both `src/utils/dates.ts`'s. The row keeps the
 *  bucket's ISO day as its cell value, so the sort of the column, the row's identity and the CSV export are
 *  unchanged and only this text is qualified; a cell holding no date is printed as it stands, as the shared
 *  cell dispatcher does. */
function periodCellOf(row: ReportRow, granularity: BucketGranularity, range: DateRange): ReactNode {
  const period = row.cells[PERIOD_COLUMN_KEY];
  return typeof period === "string" ? formatBucketCell(period, granularity, range) || period : null;
}

/** The key `DataTable` tracks a row by: the report's own stable id — a bucket key or a product id — and never
 *  an array index, which shifts the moment the order, the page or the range changes. */
function reportRowKey(row: ReportRow): string {
  return row.id;
}

/** The caption above the table, joined from the parts that are known: the definition's name from the
 *  vocabulary module, the period formatted by `src/utils/dates.ts` and the note stating whose clock a period
 *  boundary follows. An unparsable end formats to nothing and is left out rather than read as a gap. */
function captionOf(definition: ReportDefinition, range: DateRange): string {
  return [definition.name, formatDateRange(range.from, range.to), DATE_RANGE_COPY.LOCAL_TIME_NOTE]
    .filter((part) => part !== "")
    .join(". ");
}

/** The paging a reader has chosen, and the run they chose it for. */
interface PagingChoice {
  readonly page: number;
  /** One of the sizes `src/constants/config.ts` offers; normalised before it is stored. */
  readonly pageSize: number;
  readonly runKey: string;
}

/** The order a reader has chosen, and the run they chose it for. */
interface SortChoice {
  /** The order in force, or `undefined` for the order the run's own read produced. */
  readonly sort: DataTableSort | undefined;
  readonly runKey: string;
}

/** An export prepared for a run, and the run it was prepared for. */
interface PreparedExport {
  readonly result: CsvBuildResult;
  readonly runKey: string;
}

/**
 * Everything {@link ReportTable} accepts.
 *
 * The definition carries the columns, so no column list is written here and no per-kind table exists in this
 * file: the heading, the key, the cell format, the alignment and whether a column sorts all travel from the
 * definition the report was run with.
 */
export interface ReportTableProps {
  /** Which of the three reports these rows came from: names the download and identifies the run. */
  readonly kind: ReportKind;
  /** The definition that ran: the source of every column, its heading and its cell format. */
  readonly definition: ReportDefinition;
  /** Every row the run produced, not the page on show: the table pages them and the export writes them all. */
  readonly rows: readonly ReportRow[];
  /** The figures the run states beside its rows: the totals row the table ends with and the CSV's own. */
  readonly summary: ReportSummary;
  /** The period the run covered, formatted into the table's caption. */
  readonly range: DateRange;
  /** The cut the run was bucketed by, which identifies the run and names its download. */
  readonly granularity: BucketGranularity;
  /** Whether another run is in flight, keeping the rows already on screen visible until it arrives. */
  readonly isBusy?: boolean;
}

/**
 * The report table: the definition's own columns rendered by the shared `DataTable`, the run's totals closing
 * it, and the CSV export control that writes out the rows a reader is looking at.
 *
 * Empty and busy presentation, the caption, the `aria-sort` semantics, the paging control and the totals row's
 * styling are the primitives'; this file owns the order in force and the page cut from it — both taken over the
 * whole run, as the module note above states — and the one export the product offers.
 *
 * @param props - The run's definition, rows, summary, period and cut; see {@link ReportTableProps}.
 * @returns The export action group over the paged table.
 */
export function ReportTable({
  kind,
  definition,
  rows,
  summary,
  range,
  granularity,
  isBusy = false,
}: ReportTableProps): ReactElement {
  const toast = useToast();
  const noteId = useId();
  const runKey = runKeyOf(kind, range, granularity);
  const [paging, setPaging] = useState<PagingChoice>(() => ({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    runKey: "",
  }));
  const [sorting, setSorting] = useState<SortChoice>(() => ({ sort: undefined, runKey: "" }));
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);

  // The paging this run uses. A choice made for another run opens the new one at its first page and keeps the
  // size the reader picked, which is what a report change should do and what no effect is needed for.
  const choice: PagingChoice =
    paging.runKey === runKey ? paging : { page: 1, pageSize: paging.pageSize, runKey };

  // The order this run is in. A run opens in the order the read produced — its own periods, or its own ranking
  // — and a choice made for another run is left behind with the run it was made for, as the paging choice above
  // is, so the two never describe different runs.
  const sort: DataTableSort | undefined = sorting.runKey === runKey ? sorting.sort : undefined;

  const handlePagingChange = useCallback(
    (page: number, pageSize: number): void => {
      setPaging({ page, pageSize: normalisePageSize(pageSize), runKey });
    },
    [runKey],
  );

  const pagination = usePagination({
    page: choice.page,
    pageSize: choice.pageSize,
    total: rows.length,
    onChange: handlePagingChange,
  });

  // A sort activation orders the whole run and reopens it at its first page: the page the reader was on was a
  // slice of another order, and the row the new order puts first is the run's own extreme in that column.
  const handleSortChange = useCallback(
    (next: DataTableSort): void => {
      setSorting({ sort: next, runKey });
      setPaging({ page: 1, pageSize: pagination.pageSize, runKey });
    },
    [pagination.pageSize, runKey],
  );

  // The run's rows in the order in force, ordered before any page is cut from them. `sortByKey` in
  // `src/utils/collections.ts` is the product's one ordering helper, so no comparator is written here, and a
  // column is ordered by its raw cell — the value the primitive renders through, read the same way — rather
  // than by its printed text. Ordering the whole run is what makes the row the table states first the range's
  // own extreme in that column instead of the largest figure of the page the reader happened to be on.
  const sortedRows = useMemo(() => {
    if (sort === undefined) return rows;
    const column = definition.columns.find((candidate) => candidate.key === sort.columnId);
    if (column === undefined) return rows;
    return sortByKey(rows, (row) => row.cells[column.key] ?? null, sort.direction);
  }, [definition, rows, sort]);

  // The page on show, taken out of the run already in that order. Paging rules live in
  // `src/utils/collections.ts`, so the slice comes from `paginate` — the one place a page is taken out of a
  // collection — rather than from an offset computed here.
  const pagedRows = useMemo(
    () => paginate(sortedRows, pagination.page, pagination.pageSize),
    [sortedRows, pagination.page, pagination.pageSize],
  );

  // The paging contract the primitive renders its control from and reports a change through. The hook's two
  // page actions already clamp the page and normalise the size, so neither rule is applied a second time here,
  // and the object is rebuilt only when this file renders. The caption counts what the table's rows are: the
  // sales and customer reports page over reporting periods, and the product-performance report is the one
  // report whose rows are products.
  const tablePaging: DataTablePaging = {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total: pagination.total,
    pageCount: pagination.pageCount,
    hasNext: pagination.hasNext,
    hasPrevious: pagination.hasPrevious,
    countNoun: kind === "products" ? PAGING_NOUNS.PRODUCTS : PAGING_NOUNS.PERIODS,
    onPageChange: pagination.goTo,
    onPageSizeChange: pagination.setPageSize,
  };

  // One column per column of the definition, in its order. `value` reads the raw cell — minor units for money,
  // a ratio for a percentage, the bucket's ISO day for the period — so the primitive orders a column by its
  // figure and renders it through `formatCellValue`, and a sorted column is never sorted by its printed text.
  // The period column alone brings a `cell`, which words a bucket the range clipped by the days it covers while
  // leaving that raw value in place, so nothing the sort or the export reads moves.
  const columns = useMemo<readonly DataTableColumn<ReportRow>[]>(
    () =>
      definition.columns.map((column) => {
        const base: DataTableColumn<ReportRow> = {
          id: column.key,
          header: column.label,
          value: (row: ReportRow) => row.cells[column.key] ?? null,
          format: column.format,
          sortable: column.sortable,
          align: column.align,
          isNumeric: column.align === "end",
        };
        return column.key === PERIOD_COLUMN_KEY
          ? { ...base, cell: (row: ReportRow): ReactNode => periodCellOf(row, granularity, range) }
          : base;
      }),
    [definition, granularity, range],
  );

  // The totals row that closes the table, from `totalsRowCells` — the same list `toCsvMatrix` writes, so the
  // row on screen and the row in the download are one computation and neither can state a different total.
  const footer = useMemo<ReactNode>(() => {
    const totals = totalsRowCells(definition, summary);
    return (
      <tr className={CLASSES.totals}>
        {definition.columns.map((column, index) => (
          <td key={column.key} className={column.align === "end" ? CLASSES.numeric : undefined}>
            {formatCellValue(totals[index], column.format)}
          </td>
        ))}
      </tr>
    );
  }, [definition, summary]);

  // A range that recorded no activity is a legitimate result, so the table's one empty row explains it. The
  // action the copy names belongs to the view that owns the range control, so it is not rendered here.
  const emptyState = useMemo<ReactNode>(
    () => (
      <>
        <p>{EMPTY_STATES.reportRange.title}</p>
        <p>{EMPTY_STATES.reportRange.description}</p>
      </>
    ),
    [],
  );

  const exportFileName = exportFileNameOf(kind, range, granularity);
  const exportLabel = `${REPORTS_COPY.EXPORT_LABEL}: ${definition.name}`;

  const handleExport = useCallback((): void => {
    const result = buildCsvResult(toCsvMatrix(definition, rows, summary), {
      fileName: exportFileName,
    });
    const download = downloadCsv(result.fileNameSuggestion ?? exportFileName, result.text);
    setPrepared({ result, runKey });
    if (download.ok) toast.success(FEEDBACK_COPY.TOAST_EXPORT_READY);
    else toast.error(FEEDBACK_COPY.TOAST_EXPORT_FAILED);
  }, [definition, rows, summary, exportFileName, runKey, toast]);

  // What the note beside the control states: the cap the export is bounded by, from the two limits
  // `src/constants/config.ts` owns. A limit and a count are different facts, so the count a prepared file
  // held is never read into this sentence — it is stated on its own line below.
  const note = exportNote(CSV_MAX_ROWS, CSV_MAX_CELL_LENGTH);

  // The count the prepared file actually holds — the number `src/utils/csv.ts` reports, which is the module
  // that applies the cap and so the only one that can say how many rows survived it — stated as its own
  // caption, and only while it describes the run currently on screen.
  const preparedInForce = prepared !== null && prepared.runKey === runKey ? prepared.result : null;
  const countNote = preparedInForce === null ? null : exportRowCountNote(preparedInForce.rowCount);
  const caption = captionOf(definition, range);

  return (
    <div className={CLASSES.block}>
      <div className={CLASSES.export}>
        <Button
          type="button"
          variant="secondary"
          onClick={handleExport}
          aria-label={exportLabel}
          aria-describedby={noteId}
        >
          {REPORTS_COPY.EXPORT_LABEL}
        </Button>
        <p className={CLASSES.exportNote} id={noteId}>
          {note}
        </p>
        {countNote === null ? null : <p className={CLASSES.exportNote}>{countNote}</p>}
      </div>
      {/* `key` because the primitive orders its own rows while no `sort` is handed in, and the run this one
          replaces may be the run whose activation the table is still holding: an order belongs to the run it
          was asked for and must not outlive it. */}
      <DataTable
        key={runKey}
        columns={columns}
        rows={pagedRows.items}
        rowKey={reportRowKey}
        caption={caption}
        emptyState={emptyState}
        sort={sort}
        onSortChange={handleSortChange}
        paging={tablePaging}
        isLoading={isBusy}
        density="compact"
        footer={footer}
        className={CLASSES.scroll}
      />
    </div>
  );
}
