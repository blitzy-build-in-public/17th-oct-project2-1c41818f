/**
 * Path: tests/integration/adminReportsFlow.test.tsx
 * Purpose: The dashboard and the three reports for a range, with CSV export and the empty range
 * Lines: 596
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  PAGE_TITLES,
  chartDataTableCaption,
  documentTitle,
} from "@/constants/content";
import {
  ADMIN_COPY,
  CHANNEL_LABELS,
  DATE_RANGE_COPY,
  REPORTS_COPY,
  exportNote,
  exportRowCountNote,
  lastDaysLabel,
} from "@/constants/content-reports";
import {
  CSV_MAX_CELL_LENGTH,
  CSV_MAX_ROWS,
  DEFAULT_REPORT_RANGE_DAYS,
  DEMO_ACCOUNTS,
  STORAGE_KEYS,
} from "@/constants/config";
import { ROUTES } from "@/constants/routes";
import {
  BASELINE_OPTIONS,
  GRANULARITY_OPTIONS,
  ORDER_STATUS_OPTIONS,
  REPORT_DEFINITIONS,
} from "@/constants/taxonomy";
import { describeBaseline } from "@/lib/analyticsService";
import { handleRequest } from "@/lib/mockServer";
import type { ReportCellFormat, ReportDefinition, ReportKind } from "@/types/analytics";
import { CSV_DELIMITER } from "@/utils/csv";
import {
  addDays,
  defaultReportRange,
  formatDateRange,
  maxReportRange,
  resolveBaselineRange,
  toDateInputValue,
} from "@/utils/dates";
import { parseMoneyToMinor } from "@/utils/format";
import { readStored } from "@/utils/storage";

import { failNext, renderApp, resetApiState, screen, waitFor, within } from "../testUtils";
import { COUNT_TEXT, KPI_DELTA_TEXT, MONEY_TEXT, PERCENT_TEXT } from "./figureReaders";
import type { RenderHarness, UserEvent } from "../testUtils";

// The real application over its seeded data, with the seam's failure switch a case's only other lever. Both
// acceptance signals are here: the guard's own role check, and the CSV a report exports against its table.

/** The sign-in form's controls; a required field's label also carries the hidden requirement text. */
const EMAIL_FIELD = new RegExp(`^${ACCOUNT_COPY.EMAIL_LABEL}`);
const PASSWORD_FIELD = new RegExp(`^${ACCOUNT_COPY.PASSWORD_LABEL}`);

/** The alignment class the shared table's own contract gives a column of figures. */
const NUMERIC_CELL_CLASS = "sp-table__num";

/** The heading each report charts under, so a paired data table is found by the caption built from it. */
const CHART_HEADINGS: Readonly<Record<ReportKind, string>> = {
  sales: REPORTS_COPY.SALES_CHART_HEADING,
  products: REPORTS_COPY.PRODUCT_CHART_HEADING,
  customers: REPORTS_COPY.CUSTOMER_CHART_HEADING,
};

/** The reports module's export action: its accessible name states the report it exports. */
const EXPORT_ACTION = new RegExp(`^${REPORTS_COPY.EXPORT_LABEL}`);

/** The bucket control's name — its own choices' words, joined — and the month cut a case asks for. */
const BUCKET_CONTROL_LABEL = GRANULARITY_OPTIONS.map((option) => option.label).join(" / ");
const MONTH_CUT = GRANULARITY_OPTIONS[2].value;

/** The three report kinds, named for the case title each runs under. */
const REPORT_CASES: readonly (readonly [string, ReportDefinition])[] = REPORT_DEFINITIONS.map(
  (definition) => [definition.name, definition] as const,
);

/** The definition of one report kind, resolved the way `src/lib/reportService.ts` resolves it. */
function definitionOf(kind: ReportKind): ReportDefinition {
  return REPORT_DEFINITIONS.find((definition) => definition.kind === kind) ?? REPORT_DEFINITIONS[0];
}

/** The heading one definition gives a column, so no label is written out here. */
function columnLabel(kind: ReportKind, key: string): string {
  return definitionOf(kind).columns.find((column) => column.key === key)?.label ?? "";
}

/** Fills the sign-in screen a guard sent the visitor to and submits it. */
async function submitSignIn(user: UserEvent, email: string): Promise<void> {
  await user.type(await screen.findByLabelText(EMAIL_FIELD), email);
  await user.type(screen.getByLabelText(PASSWORD_FIELD), DEMO_ACCOUNTS.PASSWORD);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  // The form goes once the session is adopted and the visitor moved on, which is where a case starts.
  await waitFor(() => expect(screen.queryByLabelText(EMAIL_FIELD)).toBeNull());
}

/** A seeded account's view of a guarded route, reached through the guard's own sign-in redirect. */
async function openAs(email: string, route: string): Promise<RenderHarness> {
  const app = renderApp({ route });
  await submitSignIn(app.user, email);
  return app;
}

/** The administrator's view of a route; the dashboard unless a case asks for the reports. */
async function openAsAdmin(route: string = ROUTES.ADMIN): Promise<RenderHarness> {
  return openAs(DEMO_ACCOUNTS.ADMIN_EMAIL, route);
}

/** Applies a period through the range control's own two date fields, as the date module formats them. */
async function applyRange(user: UserEvent, from: string, to: string): Promise<void> {
  const fromField = await screen.findByLabelText(DATE_RANGE_COPY.FROM_LABEL);
  const toField = screen.getByLabelText(DATE_RANGE_COPY.TO_LABEL);
  await user.clear(fromField);
  await user.type(fromField, toDateInputValue(from));
  await user.clear(toField);
  await user.type(toField, toDateInputValue(to));
  await user.click(screen.getByRole("button", { name: DATE_RANGE_COPY.APPLY_LABEL }));
}

/** The rendered grid of a table: its header row's headings, then every body and totals row's cells. */
function tableGrid(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole("row")
    .map((row) => {
      const headings = within(row).queryAllByRole("columnheader");
      const cells = headings.length > 0 ? headings : within(row).queryAllByRole("cell");
      return cells.map((cell) => cell.textContent?.trim() ?? "");
    });
}

/** Waits until a table has rendered rows beyond its header, so a late read is read settled. */
async function filledGrid(table: HTMLElement): Promise<string[][]> {
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  return tableGrid(table);
}

/** Whether a column of figures never rises: the order a ranking asked for descending arrives in. */
function isNonIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? 0) >= value);
}

/** The digits of a rendered figure, so a grouped count reads as the number it states. */
function numberOf(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ""));
}

/** The report table and its grid: the table whose caption names the definition it was built from. */
async function reportTableOf(
  definition: ReportDefinition,
): Promise<{ table: HTMLElement; grid: string[][] }> {
  const table = await screen.findByRole("table", { name: new RegExp(`^${definition.name}\\.`) });
  return { table, grid: tableGrid(table) };
}

/** A chart's paired data table, and the same table's rows counted as buckets. */
function chartGridSync(heading: string): string[][] {
  return tableGrid(screen.getByRole("table", { name: chartDataTableCaption(heading) }));
}

/** Waits for a chart's paired data table, so a series still in flight is never read. */
async function chartGrid(heading: string): Promise<string[][]> {
  await screen.findByRole("table", { name: chartDataTableCaption(heading) });
  return chartGridSync(heading);
}

/** How many buckets a chart is drawn over. */
function bucketCount(heading: string): number {
  return chartGridSync(heading).length - 1;
}

/** The figure one KPI card states — its money or count — never its change line or its comparison. */
function kpiFigure(label: string): string {
  const card = screen.getByRole("region", { name: label });
  return (
    within(card).getByText(new RegExp(`${MONEY_TEXT.source}|${COUNT_TEXT.source}`)).textContent ??
    ""
  );
}

/** Whether a rendered cell and an exported one state the same figure, money as integer minor units. */
function sameCellValue(rendered: string, exported: string, format: ReportCellFormat): boolean {
  switch (format) {
    case "money":
      return parseMoneyToMinor(rendered) === parseMoneyToMinor(exported);
    case "integer":
    case "percent":
    case "compact-number":
      return numberOf(rendered) === numberOf(exported);
    default:
      return rendered === exported;
  }
}

/** Splits a CSV file into rows of unquoted cells, per the quoting the CSV module writes. */
function parseCsvText(text: string): string[][] {
  return text.split("\r\n").map((line) => {
    const cells: string[] = [];
    let cell = "";
    let isQuoted = false;
    for (const character of line) {
      if (character === '"') isQuoted = !isQuoted;
      else if (character === CSV_DELIMITER && !isQuoted) {
        cells.push(cell);
        cell = "";
      } else cell += character;
    }
    return [...cells, cell];
  });
}

/** Reads a blob back as text: the DOM's own reader, since the environment's blob has no `text()`. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("The exported file could not be read back."));
    reader.readAsText(blob);
  });
}

/** The file the export handed the browser, from the blob the object-URL stub captured. */
async function capturedCsvRows(): Promise<string[][]> {
  // Read through `vi.spyOn` rather than off `URL`, which keeps the history observable without handing
  // the method away from its object.
  const blob = vi.spyOn(URL, "createObjectURL").mock.calls.at(-1)?.[0];
  if (!(blob instanceof Blob)) throw new Error("The export created no blob for this case to read.");
  return parseCsvText(await readBlobText(blob));
}

beforeEach(() => {
  resetApiState();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The table, its sorting, its totals, its paired chart and its figures, for one report definition. */
async function expectReportSurface(user: UserEvent, definition: ReportDefinition): Promise<void> {
  // The definition's own columns head the table in its own order, and the run's totals row closes it.
  const { table, grid } = await reportTableOf(definition);
  expect(grid[0]).toEqual(definition.columns.map((column) => column.label));
  expect(grid.length).toBeGreaterThan(2);
  expect(grid.at(-1)?.[0]).toBe(REPORTS_COPY.TOTALS_ROW_LABEL);

  // A column of figures aligns on its digits, and activating a header orders the rows by that column.
  const numericColumn = definition.columns.findIndex((column) => column.align === "end");
  const sortColumn = definition.columns.findIndex(
    (column) => column.sortable && column.format === "integer",
  );
  const bodyRow = within(table).getAllByRole("row")[1];
  expect(within(bodyRow).getAllByRole("cell")[numericColumn]).toHaveClass(NUMERIC_CELL_CLASS);
  await user.click(
    within(table).getByRole("button", { name: definition.columns[sortColumn].label }),
  );
  const headers = within(table).getAllByRole("columnheader");
  const sorted = headers.filter((header) => header.getAttribute("aria-sort") === "ascending");
  expect(sorted).toEqual([headers[sortColumn]]);
  const values = tableGrid(table)
    .slice(1, -1)
    .map((row) => numberOf(row[sortColumn]));
  expect(isNonIncreasing([...values].reverse())).toBe(true);

  // The chart beside the table, and the figures the run states, each labelled by its own column.
  expect((await chartGrid(CHART_HEADINGS[definition.kind])).length).toBeGreaterThan(1);
  const terms = within(screen.getByRole("tabpanel")).getAllByRole("term");
  const labels = definition.columns.map((column) => column.label);
  expect(terms.length).toBeGreaterThan(0);
  expect(terms.every((term) => labels.includes(term.textContent ?? ""))).toBe(true);
}

describe("the guard over the administrator routes", () => {
  it("turns a signed-in customer away, and the endpoints refuse the same token", async () => {
    const dashboard = await openAs(DEMO_ACCOUNTS.CUSTOMER_EMAIL, ROUTES.ADMIN);
    await waitFor(() => expect(document.title).toBe(documentTitle(PAGE_TITLES.ACCOUNT)));
    expect(screen.queryByRole("heading", { name: PAGE_TITLES.DASHBOARD, level: 1 })).toBeNull();
    expect(screen.queryByRole("group", { name: DATE_RANGE_COPY.LABEL })).toBeNull();
    // Hiding a screen is not access control: the endpoint re-checks the role the session carries.
    const token = readStored<string | null>(STORAGE_KEYS.SESSION, null);
    const range = defaultReportRange();
    expect(token).not.toBeNull();
    const path = `/api/analytics/kpis?from=${range.from}&to=${range.to}`;
    expect(await handleRequest(path, { sessionToken: token ?? undefined })).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    dashboard.unmount();

    renderApp({ route: ROUTES.ADMIN_REPORTS });
    await waitFor(() => expect(document.title).toBe(documentTitle(PAGE_TITLES.ACCOUNT)));
    expect(screen.queryByRole("tablist", { name: REPORTS_COPY.SELECTOR_LABEL })).toBeNull();
  });
});

describe("the dashboard an administrator sees", () => {
  it("states the four figures, the chart, the breakdown, both tables and no export", async () => {
    const { user } = await openAsAdmin();
    const comparison = describeBaseline(
      BASELINE_OPTIONS[0].value,
      resolveBaselineRange(defaultReportRange(), BASELINE_OPTIONS[0].value),
    );
    // One card per figure: a value, a change said in words and drawn as a glyph, and a named comparison.
    for (const label of [
      ADMIN_COPY.KPI_REVENUE_LABEL,
      ADMIN_COPY.KPI_ORDERS_LABEL,
      ADMIN_COPY.KPI_UNITS_LABEL,
      ADMIN_COPY.KPI_AVERAGE_ORDER_VALUE_LABEL,
    ]) {
      const card = await screen.findByRole("region", { name: label });
      expect(kpiFigure(label)).not.toBe("");
      const change = within(card).getByText((_, el) => KPI_DELTA_TEXT.test(el?.textContent ?? ""));
      expect(change.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      expect(within(card).getByText(comparison)).toBeInTheDocument();
    }
    expect((await chartGrid(ADMIN_COPY.CHART_HEADING)).length - 1).toBe(DEFAULT_REPORT_RANGE_DAYS);
    expect(screen.getByRole("group", { name: ADMIN_COPY.CHART_HEADING })).toBeInTheDocument();

    // The breakdown states each slice's value and share, and a ring total no legend entry carries.
    const breakdown = await screen.findByRole("region", { name: ADMIN_COPY.BREAKDOWN_HEADING });
    const slices = within(breakdown).getAllByRole("listitem");
    const shares = slices.map((slice) =>
      numberOf(within(slice).getByText(PERCENT_TEXT).textContent ?? ""),
    );
    expect(slices.length).toBeGreaterThan(1);
    expect(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 100)).toBeLessThanOrEqual(0.15);
    const ringTotal = within(breakdown)
      .getAllByText(MONEY_TEXT)
      .filter((node) => node.closest("table") === null && !slices.some((s) => s.contains(node)));
    expect(ringTotal).toHaveLength(1);

    // The ranking in the order it was read, and the recent orders, each naming its own status.
    const ranked = await filledGrid(
      await screen.findByRole("table", { name: ADMIN_COPY.TOP_PRODUCTS_HEADING }),
    );
    const revenueColumn = ranked[0].indexOf(columnLabel("products", "revenue"));
    const revenues = ranked.slice(1).map((row) => parseMoneyToMinor(row[revenueColumn]));
    expect(isNonIncreasing(revenues)).toBe(true);

    // The ranking is re-read under the metric the reader picks.
    const unitsColumn = ranked[0].indexOf(columnLabel("products", "unitsSold"));
    const rankToggle = screen.getByRole("group", {
      name: ADMIN_COPY.TOP_PRODUCTS_RANK_CONTROL_LABEL,
    });
    await user.click(within(rankToggle).getByRole("button", { name: ADMIN_COPY.KPI_UNITS_LABEL }));
    await waitFor(() => {
      const grid = tableGrid(screen.getByRole("table", { name: ADMIN_COPY.TOP_PRODUCTS_HEADING }));
      expect(isNonIncreasing(grid.slice(1).map((row) => numberOf(row[unitsColumn])))).toBe(true);
    });

    const orders = await filledGrid(
      await screen.findByRole("table", { name: ADMIN_COPY.RECENT_ORDERS_HEADING }),
    );
    const statuses = ORDER_STATUS_OPTIONS.map((option) => option.label);
    const statusColumn = orders[0].indexOf(ACCOUNT_COPY.ORDERS_COLUMN_STATUS);
    for (const row of orders.slice(1)) expect(statuses).toContain(row[statusColumn]);

    expect(screen.queryByRole("button", { name: EXPORT_ACTION })).toBeNull();
  });

  it("recomputes its figures for a narrower period, a coarser bucket and another split", async () => {
    const { user } = await openAsAdmin();
    const opening = defaultReportRange();
    await screen.findByRole("region", { name: ADMIN_COPY.KPI_REVENUE_LABEL });
    const ordersBefore = numberOf(kpiFigure(ADMIN_COPY.KPI_ORDERS_LABEL));
    const revenueBefore = kpiFigure(ADMIN_COPY.KPI_REVENUE_LABEL);
    expect(bucketCount(ADMIN_COPY.CHART_HEADING)).toBe(DEFAULT_REPORT_RANGE_DAYS);

    // A narrower preset recomputes every figure and redraws the chart over fewer buckets.
    const week = { from: addDays(opening.to, -6), to: opening.to };
    await user.click(screen.getByRole("button", { name: lastDaysLabel(7) }));
    await waitFor(() => expect(bucketCount(ADMIN_COPY.CHART_HEADING)).toBe(7));
    expect(screen.getByText(formatDateRange(week.from, week.to))).toBeInTheDocument();
    expect(numberOf(kpiFigure(ADMIN_COPY.KPI_ORDERS_LABEL))).toBeLessThan(ordersBefore);
    expect(kpiFigure(ADMIN_COPY.KPI_REVENUE_LABEL)).not.toBe(revenueBefore);

    const figure = kpiFigure(ADMIN_COPY.KPI_REVENUE_LABEL);
    await user.selectOptions(
      screen.getByLabelText(ADMIN_COPY.BASELINE_CONTROL_LABEL),
      BASELINE_OPTIONS[1].value,
    );
    const yearOverYear = describeBaseline(
      BASELINE_OPTIONS[1].value,
      resolveBaselineRange(week, BASELINE_OPTIONS[1].value),
    );
    await waitFor(() => {
      const card = screen.getByRole("region", { name: ADMIN_COPY.KPI_REVENUE_LABEL });
      expect(within(card).getByText(yearOverYear)).toBeInTheDocument();
    });
    expect(kpiFigure(ADMIN_COPY.KPI_REVENUE_LABEL)).toBe(figure);

    await user.selectOptions(screen.getByLabelText(BUCKET_CONTROL_LABEL), MONTH_CUT);
    await waitFor(() => expect(bucketCount(ADMIN_COPY.CHART_HEADING)).toBeLessThan(7));
    expect(screen.getByText(formatDateRange(week.from, week.to))).toBeInTheDocument();

    const categories = chartGridSync(ADMIN_COPY.CHART_HEADING)[0].slice(1);
    expect(categories.length).toBeGreaterThan(1);
    const toggle = screen.getByRole("group", { name: ADMIN_COPY.CHART_SERIES_CONTROL_LABEL });
    const [, channelToggle] = within(toggle).getAllByRole("button");
    await user.click(channelToggle);
    const channelLabels = Object.values(CHANNEL_LABELS) as readonly string[];
    await waitFor(() => {
      const channels = chartGridSync(ADMIN_COPY.CHART_HEADING)[0].slice(1);
      expect(channels).not.toEqual(categories);
      expect(channels.every((label) => channelLabels.includes(label))).toBe(true);
    });
  });
});

describe.each(REPORT_CASES)("the %s report", (_name, definition) => {
  it("renders its period's table, totals, figures and chart, and sorts by a column", async () => {
    const { user } = await openAsAdmin(ROUTES.ADMIN_REPORTS);
    await user.click(await screen.findByRole("tab", { name: definition.name }));
    await expectReportSurface(user, definition);
  });
});

describe("the figures a report states for its rows", () => {
  it("gives each product a share of the period, and separates new customers from returning", async () => {
    const { user } = await openAsAdmin(ROUTES.ADMIN_REPORTS);
    const products = definitionOf("products");
    await user.click(await screen.findByRole("tab", { name: products.name }));
    const grid = (await reportTableOf(products)).grid;
    const unitsColumn = grid[0].indexOf(columnLabel("products", "unitsSold"));
    const revenueColumn = grid[0].indexOf(columnLabel("products", "revenue"));
    const shareColumn = grid[0].indexOf(columnLabel("products", "revenueShare"));
    const rows = grid.slice(1, -1);
    const periodRevenue = parseMoneyToMinor(grid.at(-1)?.[revenueColumn] ?? "");
    expect(rows.length).toBeGreaterThan(0);
    expect(periodRevenue).toBeGreaterThan(0);
    for (const row of rows) {
      expect(numberOf(row[unitsColumn])).toBeGreaterThan(0);
      const share = (parseMoneyToMinor(row[revenueColumn]) / periodRevenue) * 100;
      expect(Math.abs(numberOf(row[shareColumn]) - share)).toBeLessThanOrEqual(0.1);
    }

    // A month-bucketed period holds few enough rows to be on one page, so its totals are their sum.
    const customers = definitionOf("customers");
    await user.click(await screen.findByRole("tab", { name: customers.name }));
    await user.selectOptions(screen.getByLabelText(BUCKET_CONTROL_LABEL), MONTH_CUT);
    const customerTable = { name: new RegExp(`^${customers.name}\\.`) };
    await waitFor(() =>
      expect(tableGrid(screen.getByRole("table", customerTable)).length).toBeLessThanOrEqual(4),
    );
    const customerGrid = (await reportTableOf(customers)).grid;
    const newColumn = customerGrid[0].indexOf(columnLabel("customers", "newCustomers"));
    const returningColumn = customerGrid[0].indexOf(columnLabel("customers", "returningCustomers"));
    const ordersColumn = customerGrid[0].indexOf(columnLabel("customers", "orders"));
    const customerRevenue = customerGrid[0].indexOf(columnLabel("customers", "revenue"));
    const valueColumn = customerGrid[0].indexOf(columnLabel("customers", "averageOrderValue"));
    const customerRows = customerGrid.slice(1, -1);
    const totals = customerGrid.at(-1) ?? [];
    expect(newColumn).toBeGreaterThanOrEqual(0);
    expect(returningColumn).toBeGreaterThanOrEqual(0);
    expect(customerRows.length).toBeGreaterThan(0);
    expect(numberOf(totals[ordersColumn])).toBe(
      customerRows.reduce((sum, row) => sum + numberOf(row[ordersColumn]), 0),
    );
    expect(parseMoneyToMinor(totals[customerRevenue])).toBe(
      customerRows.reduce((sum, row) => sum + parseMoneyToMinor(row[customerRevenue]), 0),
    );
    for (const row of customerRows) {
      const orders = numberOf(row[ordersColumn]);
      const revenue = parseMoneyToMinor(row[customerRevenue]);
      expect(Math.abs(parseMoneyToMinor(row[valueColumn]) * orders - revenue)).toBeLessThanOrEqual(
        Math.max(orders, 1),
      );
    }
  });
});

describe("the export a report offers", () => {
  it("writes out the rows on screen, and remembers the range it was run over", async () => {
    const reports = await openAsAdmin(ROUTES.ADMIN_REPORTS);
    const { user } = reports;
    // A seven-day period, so every row the run produced is on one page: the table pages, the export
    // writes the whole run, and only a range this narrow makes the two row counts comparable.
    const today = defaultReportRange().to;
    await applyRange(user, addDays(today, -6), today);
    const sales = definitionOf("sales");
    const { grid } = await reportTableOf(sales);
    expect(grid.length).toBeGreaterThan(2);
    // The note states the cap the export is bounded by, and whose clock its dates follow, before one is made.
    expect(screen.getByText(exportNote(CSV_MAX_ROWS, CSV_MAX_CELL_LENGTH))).toBeInTheDocument();
    expect(screen.getByText(DATE_RANGE_COPY.LOCAL_TIME_NOTE)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: EXPORT_ACTION }));
    const csv = await capturedCsvRows();
    // The download is the table: the same headings, the same rows, the same totals row.
    expect([csv.length, csv[0]]).toEqual([grid.length, grid[0]]);
    const exportedTotals = csv.at(-1) ?? [];
    const renderedTotals = grid.at(-1) ?? [];
    for (const [index, column] of sales.columns.entries()) {
      expect(
        sameCellValue(renderedTotals[index] ?? "", exportedTotals[index] ?? "", column.format),
      ).toBe(true);
    }
    // The cap that bounds the download stands unchanged by the export; the rows the file held are separate.
    expect(screen.getByText(exportNote(CSV_MAX_ROWS, CSV_MAX_CELL_LENGTH))).toBeInTheDocument();
    expect(screen.getByText(exportRowCountNote(csv.length - 1))).toBeInTheDocument();

    // The range last used is the one the next visit opens on, on either administrator surface.
    const chosen = { from: addDays(today, -13), to: today };
    const fromField = (): HTMLElement => screen.getByLabelText(DATE_RANGE_COPY.FROM_LABEL);
    await applyRange(user, chosen.from, chosen.to);
    await waitFor(() => expect(fromField()).toHaveValue(toDateInputValue(chosen.from)));
    reports.unmount();

    const reopened = renderApp({ route: ROUTES.ADMIN_REPORTS });
    await waitFor(() => expect(fromField()).toHaveValue(toDateInputValue(chosen.from)));
    reopened.unmount();

    renderApp({ route: ROUTES.ADMIN });
    await screen.findByRole("heading", { name: PAGE_TITLES.DASHBOARD, level: 1 });
    expect(screen.getByText(formatDateRange(chosen.from, chosen.to))).toBeInTheDocument();
  });
});

describe("a period that recorded nothing", () => {
  it("states the empty period rather than drawing an empty table, and widens it on request", async () => {
    // A thirty-day window that closed long before the seeded year of facts begins, and so holds none.
    const quietTo = addDays(defaultReportRange().to, -730);
    const quiet = { from: addDays(quietTo, -(DEFAULT_REPORT_RANGE_DAYS - 1)), to: quietTo };
    const reports = await openAsAdmin(ROUTES.ADMIN_REPORTS);
    const sales = definitionOf("sales");
    await applyRange(reports.user, quiet.from, quiet.to);
    expect(
      await screen.findByRole("heading", { name: EMPTY_STATES.reportRange.title }),
    ).toBeVisible();
    expect(screen.getByText(EMPTY_STATES.reportRange.description)).toBeInTheDocument();
    // Nothing stands in for the rows: no table and no chart frame claims the period held nothing to plot.
    expect(screen.queryByRole("table", { name: new RegExp(`^${sales.name}\\.`) })).toBeNull();
    expect(
      screen.queryByRole("table", { name: chartDataTableCaption(CHART_HEADINGS.sales) }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: DATE_RANGE_COPY.APPLY_LABEL })).toBeInTheDocument();
    reports.unmount();

    const dashboard = renderApp({ route: ROUTES.ADMIN });
    await screen.findByRole("heading", { name: PAGE_TITLES.DASHBOARD, level: 1 });
    // The dashboard opens on that stored range, so a window a day earlier is what its fields can apply.
    await applyRange(dashboard.user, addDays(quiet.from, -1), quiet.to);
    expect(
      await screen.findByRole("heading", { name: EMPTY_STATES.dashboardRange.title }),
    ).toBeVisible();
    expect(
      screen.queryByRole("table", { name: chartDataTableCaption(ADMIN_COPY.CHART_HEADING) }),
    ).toBeNull();
    await dashboard.user.click(
      screen.getByRole("button", { name: EMPTY_STATES.dashboardRange.actionLabel }),
    );
    expect(
      await screen.findByRole("region", { name: ADMIN_COPY.KPI_REVENUE_LABEL }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(DATE_RANGE_COPY.FROM_LABEL)).toHaveValue(
      toDateInputValue(maxReportRange().from),
    );
  });
});

describe("a read that fails", () => {
  it("announces one failed read once, with a retry that restores the figures", async () => {
    // The dashboard reads first, so the range re-run below is the refresh path a duplicate notice was reported on.
    const dashboard = await openAsAdmin();
    await screen.findByRole("region", { name: ADMIN_COPY.KPI_REVENUE_LABEL });
    const failure = failNext({ path: "/api/analytics/kpis" });
    await applyRange(dashboard.user, addDays(defaultReportRange().to, -6), defaultReportRange().to);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    await dashboard.user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    await screen.findByRole("region", { name: ADMIN_COPY.KPI_REVENUE_LABEL });
    // One failure, one announcement: a duplicate notice would outlive this assertion, not precede it.
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryByText(FEEDBACK_COPY.ERROR_STATE_BODY)).toBeNull();
    failure.disarm();
  });
  it("states the seam's message with a retry that restores the report screen", async () => {
    const failure = failNext({ path: "/api/reports/sales" });
    const reports = await openAsAdmin(ROUTES.ADMIN_REPORTS);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    await reports.user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect((await reportTableOf(definitionOf("sales"))).grid.length).toBeGreaterThan(2);
    failure.disarm();
  });
});
