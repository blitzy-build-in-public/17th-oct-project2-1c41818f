/**
 * Path: tests/components/Table.test.tsx
 * Purpose: Column rendering, sorting, the empty state and the pagination contract
 * Lines: 316
 */

import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/components/ui/Table";
import type {
  DataTableColumn,
  DataTablePaging,
  DataTableProps,
  DataTableSort,
} from "@/components/ui/Table";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  A11Y_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  PAGE_SIZE_LABEL,
  PAGING_NOUNS,
  REPORTS_COPY,
  pageAnnouncement,
  pagingCountLabel,
} from "@/constants/content";
import type { Product } from "@/types/catalog";
import { pageWindow } from "@/utils/collections";
import { formatMoney, formatNumber } from "@/utils/format";

import { makePageResult, makeProduct } from "../fixtures";
import { renderWithProviders, screen, within } from "../testUtils";

/* A sort direction is carried by `aria-sort` on the column's own header cell, which is what assistive
 * technology announces as sorted ascending or descending: the content module holds no wording for one, and
 * the table deliberately invents none, so a sortable column reports `"none"` while it is not the sorted one. */

/** The table's caption, and the accessible name every case looks the table up by. */
const CAPTION = "Products in the catalogue";

/** Three rows, priced apart so an order is observable, each keeping the id its builder derived. */
const ROWS: readonly Product[] = [
  makeProduct({ name: "Aurora Desk Lamp", sku: "AUR-DL-001", priceMinor: 4_999 }),
  makeProduct({ name: "Cascade Speaker", sku: "CAS-SP-002", priceMinor: 12_900 }),
  makeProduct({ name: "Trailhead Kettle", sku: "TRL-KT-003", priceMinor: 3_499 }),
];

/** The rows dearest first, which the default-sort case opens in, and by name, both ways. */
const BY_PRICE_DESCENDING = ["Cascade Speaker", "Aurora Desk Lamp", "Trailhead Kettle"];
const BY_NAME_ASCENDING = ROWS.map((row) => row.name);
const BY_NAME_DESCENDING = [...BY_NAME_ASCENDING].reverse();

/** The order a third activation of the name column returns to, which is the order the table opens in. */
const DEFAULT_SORT: DataTableSort = { columnId: "price", direction: "desc" };

/** A sortable text column, a plain one, and a money column the product's own formatter fills. */
const COLUMNS: readonly DataTableColumn<Product>[] = [
  { id: "name", header: "Product", value: (row) => row.name, sortable: true },
  { id: "sku", header: "SKU", value: (row) => row.sku },
  { id: "price", header: "Price", value: (row) => row.priceMinor, format: "money", sortable: true },
];

/* A table whose rows arrive already ranked, so the order belongs to the read and the table has none of its
 * own to apply: one column states the order it was ranked in, the other is plain, and neither can be sorted. */
const RANKED_COLUMNS: readonly DataTableColumn<Product>[] = [
  { id: "name", header: "Product", value: (row) => row.name },
  {
    id: "price",
    header: "Price",
    value: (row) => row.priceMinor,
    format: "money",
    orderInForce: "desc",
  },
];

/** The header cell of `columnId` among the columns a case hands the table, by the same id lookup. */
function headerCellOf(columns: readonly DataTableColumn<Product>[], columnId: string): HTMLElement {
  return screen.getAllByRole("columnheader")[columns.findIndex((column) => column.id === columnId)];
}

/** What every table here is rendered with, the prices added up, and the catalogue paging is read from. */
const TABLE_PROPS: Pick<DataTableProps<Product>, "columns" | "rows" | "rowKey" | "caption"> = {
  columns: COLUMNS,
  rows: ROWS,
  rowKey: (row) => row.id,
  caption: CAPTION,
};
const ROWS_TOTAL_MINOR = ROWS.reduce((sum, row) => sum + row.priceMinor, 0);
const CATALOGUE = makePageResult(ROWS, { total: 120 });

/** The totals row a report appends: the label, and the money column's own sum. */
const TOTALS_FOOTER = (
  <tr>
    <td>{REPORTS_COPY.TOTALS_ROW_LABEL}</td>
    <td colSpan={COLUMNS.length - 1}>{formatMoney(ROWS_TOTAL_MINOR)}</td>
  </tr>
);

/** An empty state a case hands the table, to show the slot beats the component's own fallback. */
const SUPPLIED_EMPTY = "Nothing listed for this category";

/** How a case observes the page a control reports. */
type OnPageChange = (page: number) => void;

/** The body rows in render order, the header row dropped, and the first cell of every one. */
function dataRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}
function renderedNames(): string[] {
  return dataRows().map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

/** The header cell of one column, for the `aria-sort` assertion the column's order is read through. */
function headerCell(columnId: string): HTMLElement {
  const index = COLUMNS.findIndex((column) => column.id === columnId);
  return screen.getAllByRole("columnheader")[index];
}

/** The rest of the pager's caption contract a case hands the table: the collection it counts, and whether the
 *  surface that mounts it announces that count in a region of its own. */
type PagerCaption = Pick<DataTablePaging, "countNoun" | "isCountAnnouncedByCaller">;

/** The paging a listing hands the table at one page: the catalogue's own fields, plus the handlers. */
function pagingFor(
  page: number,
  onChange: OnPageChange,
  onSizeChange?: OnPageChange,
  pager?: PagerCaption,
) {
  const catalogue = makePageResult(ROWS, { page, total: CATALOGUE.total });
  return { ...catalogue, onPageChange: onChange, onPageSizeChange: onSizeChange, ...pager };
}

/** Renders the table at one page and returns it with the paging control it composes beneath it. */
async function renderPage(
  page: number,
  onChange: OnPageChange,
  onSizeChange?: OnPageChange,
  pager?: PagerCaption,
) {
  const harness = renderWithProviders(
    <DataTable {...TABLE_PROPS} paging={pagingFor(page, onChange, onSizeChange, pager)} />,
  );
  const nav = await screen.findByRole("navigation", { name: A11Y_COPY.PAGINATION_LABEL });
  return { ...harness, nav };
}

describe("DataTable", () => {
  it("names the table, renders each cell under its header, and reports a load in flight", async () => {
    const { rerender } = renderWithProviders(<DataTable {...TABLE_PROPS} />);
    const table = await screen.findByRole("table", { name: CAPTION });
    expect(table).not.toHaveAttribute("aria-busy");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Product", "SKU", "Price"]);
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(ROWS[0].name);
    expect(cells[1]).toHaveTextContent(ROWS[0].sku);
    expect(cells[2]).toHaveTextContent(formatMoney(ROWS[0].priceMinor));
    expect(cells[2].textContent).not.toContain(String(ROWS[0].priceMinor));
    expect(renderedNames()).toEqual(BY_NAME_ASCENDING);
    rerender(<DataTable {...TABLE_PROPS} isLoading />);
    expect(screen.getByRole("table", { name: CAPTION })).toHaveAttribute("aria-busy", "true");
    expect(renderedNames()).toEqual(BY_NAME_ASCENDING);
  });

  it("shows its empty state when there is nothing to show, preferring the one it is handed", async () => {
    const withFallback = renderWithProviders(<DataTable {...TABLE_PROPS} rows={[]} />);
    await screen.findByRole("table", { name: CAPTION });
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText(EMPTY_STATES.catalogue.title)).toBeInTheDocument();
    withFallback.unmount();
    renderWithProviders(<DataTable {...TABLE_PROPS} rows={[]} emptyState={SUPPLIED_EMPTY} />);
    await screen.findByRole("table", { name: CAPTION });
    expect(screen.getByText(SUPPLIED_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATES.catalogue.title)).not.toBeInTheDocument();
  });

  it("renders the totals row it is handed in the footer, and no footer without one", async () => {
    const withFooter = renderWithProviders(<DataTable {...TABLE_PROPS} footer={TOTALS_FOOTER} />);
    await screen.findByRole("table", { name: CAPTION });
    expect(dataRows()).toHaveLength(ROWS.length + 1);
    const totals = within(dataRows()[ROWS.length]);
    expect(totals.getByText(REPORTS_COPY.TOTALS_ROW_LABEL)).toBeInTheDocument();
    expect(totals.getByText(formatMoney(ROWS_TOTAL_MINOR))).toBeInTheDocument();
    withFooter.unmount();
    renderWithProviders(<DataTable {...TABLE_PROPS} />);
    await screen.findByRole("table", { name: CAPTION });
    expect(dataRows()).toHaveLength(ROWS.length);
    expect(screen.queryByText(REPORTS_COPY.TOTALS_ROW_LABEL)).not.toBeInTheDocument();
  });

  it("orders the rows from a header control and reports the direction on the sorted column alone", async () => {
    const { user } = renderWithProviders(<DataTable {...TABLE_PROPS} defaultSort={DEFAULT_SORT} />);
    await screen.findByRole("table", { name: CAPTION });
    expect(headerCell("price")).toHaveAttribute("aria-sort", "descending");
    expect(renderedNames()).toEqual(BY_PRICE_DESCENDING);

    const nameHeader = headerCell("name");
    const nameControl = within(nameHeader).getByRole("button", { name: "Product" });
    const priceText = formatMoney(ROWS[0].priceMinor);
    await user.click(nameControl);
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(headerCell("price")).toHaveAttribute("aria-sort", "none");
    expect(headerCell("sku")).not.toHaveAttribute("aria-sort");
    expect(renderedNames()).toEqual(BY_NAME_ASCENDING);
    expect(within(dataRows()[0]).getAllByRole("cell")[2]).toHaveTextContent(priceText);

    await user.click(nameControl);
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    expect(renderedNames()).toEqual(BY_NAME_DESCENDING);
    await user.click(nameControl);
    expect(headerCell("price")).toHaveAttribute("aria-sort", "descending");
    expect(renderedNames()).toEqual(BY_PRICE_DESCENDING);
  });

  it("announces the order a column arrived in, and offers no control over the order it cannot change", async () => {
    renderWithProviders(<DataTable {...TABLE_PROPS} columns={RANKED_COLUMNS} />);
    await screen.findByRole("table", { name: CAPTION });

    // The ranked column states the direction its rows are in, and the header carries no control, because
    // the read that produced the rows owns the order and the table has none of its own to apply.
    const rankedHeader = headerCellOf(RANKED_COLUMNS, "price");
    expect(rankedHeader).toHaveAttribute("aria-sort", "descending");
    expect(within(rankedHeader).queryByRole("button")).toBeNull();

    // A column that is neither sortable nor ordered states nothing about the rows it heads.
    const plainHeader = headerCellOf(RANKED_COLUMNS, "name");
    expect(plainHeader).not.toHaveAttribute("aria-sort");
    expect(within(plainHeader).queryByRole("button")).toBeNull();

    // Declaring an order is a statement, not an order applied: the rows stay where the read put them.
    expect(renderedNames()).toEqual(BY_NAME_ASCENDING);
    expect(renderedNames()).not.toEqual(BY_PRICE_DESCENDING);
  });
});

describe("Pagination", () => {
  it("announces the count and draws the window the paging derives, marking one current page", async () => {
    const { nav, rerender } = await renderPage(3, vi.fn());
    const slots = pageWindow(3, CATALOGUE.pageCount);
    const pages = slots.flatMap((slot) => (slot.kind === "page" ? [formatNumber(slot.page)] : []));
    expect(slots.some((slot) => slot.kind === "gap")).toBe(true);
    const status = within(nav).getByRole("status");
    expect(status).toHaveTextContent(pagingCountLabel(CATALOGUE.total, PAGING_NOUNS.PRODUCTS));
    expect(status).toHaveTextContent(pageAnnouncement(3, CATALOGUE.pageCount));
    const buttons = within(nav).getAllByRole("button");
    const pageControls = buttons.filter((button) => /^\d/.test(button.textContent ?? ""));
    expect(pageControls.map((button) => button.textContent)).toEqual(pages);
    expect(buttons).toHaveLength(pages.length + 2);
    const current = pageControls.filter((button) => button.getAttribute("aria-current") === "page");
    expect(current).toEqual([within(nav).getByRole("button", { name: formatNumber(3) })]);
    expect(within(nav).queryByRole("combobox")).toBeNull();
    rerender(<DataTable {...TABLE_PROPS} paging={pagingFor(5, vi.fn())} />);
    expect(screen.getByRole("status")).toHaveTextContent(pageAnnouncement(5, CATALOGUE.pageCount));
  });

  it("disables the bound at each end and reports nothing when a disabled bound is activated", async () => {
    const onPageChange = vi.fn();
    const firstPage = await renderPage(1, onPageChange);
    const previous = within(firstPage.nav).getByRole("button", { name: COMMON_ACTIONS.PREVIOUS });
    expect(previous).toBeDisabled();
    await firstPage.user.click(previous);
    expect(onPageChange).not.toHaveBeenCalled();
    firstPage.unmount();
    const lastPage = await renderPage(CATALOGUE.pageCount, onPageChange);
    const next = within(lastPage.nav).getByRole("button", { name: COMMON_ACTIONS.NEXT });
    expect(next).toBeDisabled();
    await lastPage.user.click(next);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("reports the page a control asks for, by pointer and by keyboard", async () => {
    const onPageChange = vi.fn();
    const { user, nav } = await renderPage(3, onPageChange);
    await user.click(within(nav).getByRole("button", { name: COMMON_ACTIONS.NEXT }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    await user.click(within(nav).getByRole("button", { name: formatNumber(2) }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    within(nav)
      .getByRole("button", { name: formatNumber(5) })
      .focus();
    await user.keyboard("{Enter}");
    expect(onPageChange).toHaveBeenLastCalledWith(5);
    expect(onPageChange).toHaveBeenCalledTimes(3);
  });

  it("offers the configured page sizes only when a size handler is supplied", async () => {
    const onPageSizeChange = vi.fn();
    const { user, nav } = await renderPage(1, vi.fn(), onPageSizeChange);
    const select = within(nav).getByRole("combobox", { name: PAGE_SIZE_LABEL });
    const options = within(select).getAllByRole<HTMLOptionElement>("option");
    expect(select).toHaveValue(String(DEFAULT_PAGE_SIZE));
    expect(options.map((option) => option.value)).toEqual(PAGE_SIZE_OPTIONS.map(String));

    const largest = PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1];
    await user.selectOptions(select, String(largest));
    expect(onPageSizeChange).toHaveBeenCalledWith(largest);
  });

  it("counts the collection the caller names instead of counting every collection in products", async () => {
    const { nav } = await renderPage(1, vi.fn(), undefined, { countNoun: PAGING_NOUNS.ORDERS });
    const status = within(nav).getByRole("status");
    expect(status).toHaveTextContent(pagingCountLabel(CATALOGUE.total, PAGING_NOUNS.ORDERS));
    expect(status).not.toHaveTextContent(PAGING_NOUNS.PRODUCTS.plural);
    expect(status).toHaveTextContent(pageAnnouncement(1, CATALOGUE.pageCount));
  });

  it("announces only the page where the mounting surface announces the count itself", async () => {
    const { nav } = await renderPage(3, vi.fn(), undefined, { isCountAnnouncedByCaller: true });
    expect(within(nav).getAllByRole("status")).toHaveLength(1);
    expect(within(nav).getByRole("status").textContent).toBe(
      pageAnnouncement(3, CATALOGUE.pageCount),
    );
    expect(nav).toHaveTextContent(pagingCountLabel(CATALOGUE.total, PAGING_NOUNS.PRODUCTS));
  });
});
