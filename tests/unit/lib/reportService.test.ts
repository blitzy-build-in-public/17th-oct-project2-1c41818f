/**
 * Path: tests/unit/lib/reportService.test.ts
 * Purpose: Report rows, summaries and the CSV matrix for all three report kinds.
 * Lines: 599
 */

// This file runs in the node project. The CSV writer's own escaping, clipping, row-cap and
// download-against-a-document cases are covered by tests/unit/utils/csv.test.ts, and that a download
// matches a rendered table belongs to tests/integration/adminReportsFlow.test.tsx, so what is asserted
// here is the matrix this service hands that writer plus the export path the node project alone reaches.

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_REPORT_RANGE_DAYS, DEMO_ACCOUNTS } from "@/constants/config";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { salesProDataSource } from "@/data/repositories";
// Three imports sit outside this file's listed dependency set: `signIn` is the product's own credential
// path, whose issued session is the one the transport then honours, and the account and common type
// modules own the `Session`, `Result`, `ApiError` and `DateRange` shapes the helpers below state.
import { signIn } from "@/lib/authService";
import {
  API_ERROR_CODES,
  clearInjectedFailures,
  failNext,
  registerDataSource,
} from "@/lib/mockServer";
import {
  buildReportSeries,
  buildRows,
  buildSalesRows,
  defaultReportQuery,
  findDefinition,
  listReportDefinitions,
  runReport,
  summarise,
  summarisePeriodLabel,
  toCsvMatrix,
  totalsRowCells,
  type ReportDataInput,
  type ReportRequestOptions,
  type ReportRunRequest,
} from "@/lib/reportService";
import { CSV_LINE_ENDING, buildCsvResult, downloadCsv, serialiseCsv } from "@/utils/csv";
import { addDays, defaultReportRange, eachBucket, formatDate } from "@/utils/dates";

import {
  FIXED_DATE,
  makeCartLine,
  makeCustomer,
  makeOrder,
  makePricedCart,
  makeSalesRecord,
} from "../../fixtures";

import type * as Account from "@/types/account";
import type * as Analytics from "@/types/analytics";
import type * as Common from "@/types/common";
import type * as Commerce from "@/types/commerce";

// Test data ---------------------------------------------------------------------------------------
// Two sources of truth, kept apart: the fixtures below are built from pinned builders, so every pure
// case states a figure it chose, while the seeded collections are read only through the transport, where
// the claim is structural rather than a figure this file would have to re-derive.

/** The three reports the product offers, the domain every per-kind case is looped over. */
const KINDS: readonly Analytics.ReportKind[] = ["sales", "products", "customers"];

/** The seeded window the reports view opens on, dated by the clock the seeded data is anchored to. */
const TRAILING_MONTH: Common.DateRange = defaultReportRange(new Date());

/** Ten days crossing a month boundary; every bucket of it holds a fact, so a bucketed count is exact. */
const MONTH_EDGE_RANGE: Common.DateRange = { from: "2025-01-27", to: "2025-02-05" };
/** Days crossing a year boundary, for the monthly cut. */
const YEAR_EDGE_RANGE: Common.DateRange = { from: "2024-12-20", to: "2025-01-10" };
/** The shortest range a report accepts. */
const SINGLE_DAY_RANGE: Common.DateRange = { from: FIXED_DATE, to: FIXED_DATE };
/** A window the fixtures record nothing in: the empty range every report has to survive. */
const QUIET_RANGE: Common.DateRange = { from: "2024-06-01", to: "2024-06-30" };

/** One fact per day of `range`, each figure moving with its position, so a sum over the rows is a
 *  figure no single row states and nothing can be read from the first row alone. */
function factsAcross(range: Common.DateRange): Analytics.SalesRecord[] {
  return eachBucket(range, "day").map((bucket, index) =>
    makeSalesRecord({
      date: bucket.start,
      orders: 2 + index,
      units: 5 + index * 2,
      grossRevenueMinor: 40_000 + index * 1_000,
      discountMinor: index * 100,
      refundMinor: 0,
    }),
  );
}

/** Two orders inside the fixture window, each holding a different product at a different quantity, so
 *  the product report has two rows whose figures differ. Timestamps carry no offset, the local-time form
 *  `src/utils/dates.ts` reads, so a timestamp's day is the same in every time zone. */
const FIXTURE_ORDERS: readonly Commerce.Order[] = [
  makeOrder({
    orderNumber: "SP-900001",
    placedAt: `${MONTH_EDGE_RANGE.from}T10:15:00`,
    pricedCart: makePricedCart({
      lines: [makeCartLine({ name: "Aurora Desk Lamp", quantity: 2 })],
    }),
  }),
  makeOrder({
    orderNumber: "SP-900002",
    placedAt: `${MONTH_EDGE_RANGE.to}T16:45:00`,
    pricedCart: makePricedCart({ lines: [makeCartLine({ name: "Cascade Speaker", quantity: 1 })] }),
  }),
];

/** Two accounts created inside the fixture window and one before it: one period gains customers, the
 *  returning count has to exclude them, and a third account is not a newcomer at all. */
const FIXTURE_CUSTOMERS: readonly Account.Customer[] = [
  makeCustomer({ email: "ada@example.test", createdAt: `${MONTH_EDGE_RANGE.from}T09:00:00` }),
  makeCustomer({ email: "grace@example.test", createdAt: `${MONTH_EDGE_RANGE.to}T09:00:00` }),
  makeCustomer({ email: "alan@example.test", createdAt: "2024-11-01T09:00:00" }),
];

/** The input each kind runs over: facts answer the sales report, orders the product and customer
 *  reports, and the accounts answer the customer report's newcomers. */
const INPUT_BY_KIND: Readonly<Record<Analytics.ReportKind, ReportDataInput>> = {
  sales: { orders: [], salesRecords: factsAcross(MONTH_EDGE_RANGE), customers: [] },
  products: { orders: FIXTURE_ORDERS, salesRecords: [], customers: FIXTURE_CUSTOMERS },
  customers: { orders: FIXTURE_ORDERS, salesRecords: [], customers: FIXTURE_CUSTOMERS },
};

/** The same shape with nothing in it, which is what an empty range is run over. */
const QUIET_INPUT: ReportDataInput = { orders: [], salesRecords: [], customers: [] };
/** The query the empty-range cases ask with. */
const QUIET_QUERY: Analytics.ReportQuery = {
  from: QUIET_RANGE.from,
  to: QUIET_RANGE.to,
  bucket: "day",
};

/** The query each kind is run with: the definition's own cut, a day for the sales report. */
const QUERY_BY_KIND: Readonly<Record<Analytics.ReportKind, Analytics.ReportQuery>> = {
  sales: { from: MONTH_EDGE_RANGE.from, to: MONTH_EDGE_RANGE.to, bucket: "day" },
  products: { from: MONTH_EDGE_RANGE.from, to: MONTH_EDGE_RANGE.to, bucket: "month" },
  customers: { from: MONTH_EDGE_RANGE.from, to: MONTH_EDGE_RANGE.to, bucket: "month" },
};

/** The columns whose cell is a ratio rather than a quantity: an average is one total divided by
 *  another, so the periods' averages do not add up to the period's average. */
const DERIVED_COLUMNS = new Set(["averageUnitPrice", "averageOrderValue", "revenueShare"]);

// Harness -----------------------------------------------------------------------------------------

/** The administrator's session, issued once through the real sign-in path and reused by every case
 *  that needs the role: the transport checks it, so a fabricated record would prove nothing. */
let adminSession: Common.Result<Account.Session> | null = null;

beforeAll(async () => {
  registerDataSource(salesProDataSource);
  adminSession = await signIn({
    email: DEMO_ACCOUNTS.ADMIN_EMAIL,
    password: DEMO_ACCOUNTS.PASSWORD,
  });
});

afterEach(() => {
  // An armed failure this file did not consume is forgotten, so a later case is answered by its own
  // request rather than by an arm that outlived its test.
  clearInjectedFailures();
});

/** The request options an administrator's call carries, asserting the session was issued. */
function adminOptions(): ReportRequestOptions {
  expect(adminSession?.ok).toBe(true);
  const token = adminSession !== null && adminSession.ok ? adminSession.value.token : "";
  return { sessionToken: token };
}

/** The trailing-month request for `kind`: the range every transport case below runs. */
function monthRequest(kind: Analytics.ReportKind): ReportRunRequest {
  return { kind, from: TRAILING_MONTH.from, to: TRAILING_MONTH.to };
}

/** The value of a result that must have succeeded, or the failure it carried. A service answers with a
 *  `Result` rather than throwing, so a case narrows through here instead of wrapping a call in a `try`;
 *  each guard below narrows the type after an assertion that has already failed the test. */
function valueOf<TValue>(result: Common.Result<TValue>): TValue {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected a value, received ${result.error.code}`);
  return result.value;
}

/** The failure a result must have carried, for the cases that expect a refusal. */
function errorOf<TValue>(result: Common.Result<TValue>): Common.ApiError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failure, received a value");
  return result.error;
}

/** The catalogue entry for `kind`, read from the taxonomy rather than from the resolver under test. */
function definitionOf(kind: Analytics.ReportKind): Analytics.ReportDefinition {
  const found = REPORT_DEFINITIONS.find((definition) => definition.kind === kind);
  if (found === undefined) throw new Error(`REPORT_DEFINITIONS declares no ${kind} report`);
  return found;
}

/** The cell a row holds for `key`, as the row's own record reads it. */
function cellOf(row: Analytics.ReportRow, key: string): Analytics.ReportCellValue {
  return row.cells[key] ?? null;
}

/** The numeric cell a row holds for `key`, asserting the column is a money or a count column. */
function numericCellOf(row: Analytics.ReportRow, key: string): number {
  const value = cellOf(row, key);
  expect(typeof value).toBe("number");
  return typeof value === "number" ? value : Number.NaN;
}

/** The item a report states for `key`, or `null` for a column it states no figure for. */
function totalOf(summary: Analytics.ReportSummary, key: string): Analytics.ReportCellValue {
  return summary.items.find((item) => item.key === key)?.value ?? null;
}

/** The numeric figure a report states for `key`, asserting the item exists and holds a number. */
function numericTotal(summary: Analytics.ReportSummary, key: string): number {
  const value = totalOf(summary, key);
  expect(typeof value).toBe("number");
  return typeof value === "number" ? value : Number.NaN;
}

// The catalogue, the range a view opens on, and the period it states ---------------------------------

describe("the report catalogue and the query a report opens on", () => {
  it("resolves every kind the taxonomy declares, and resolves no other", () => {
    for (const kind of KINDS)
      expect(findDefinition(REPORT_DEFINITIONS, kind)).toBe(definitionOf(kind));
    expect(findDefinition(REPORT_DEFINITIONS, "inventory" as Analytics.ReportKind)).toBeUndefined();
    expect(findDefinition([], "sales")).toBeUndefined();
  });

  it("opens on the trailing thirty days at the named definition's cut", () => {
    const query = defaultReportQuery(REPORT_DEFINITIONS, "sales");
    expect(query.to).toBe(TRAILING_MONTH.to);
    expect(query.from).toBe(addDays(query.to, -(DEFAULT_REPORT_RANGE_DAYS - 1)));
    expect(query.bucket).toBe("day");
    // No kind named: the first definition's cut, which is what the reports route opens on.
    expect(defaultReportQuery(REPORT_DEFINITIONS).bucket).toBe(REPORT_DEFINITIONS[0].granularity);
  });

  it("labels the period with both of its ends, and with nothing when an end names no day", () => {
    const label = summarisePeriodLabel({ from: MONTH_EDGE_RANGE.from, to: MONTH_EDGE_RANGE.to });
    expect(label).toContain(formatDate(MONTH_EDGE_RANGE.from));
    expect(label).toContain(formatDate(MONTH_EDGE_RANGE.to));
    expect(summarisePeriodLabel({ from: "not-a-date", to: MONTH_EDGE_RANGE.to })).toBe("");
    expect(summarisePeriodLabel({ from: MONTH_EDGE_RANGE.from, to: "" })).toBe("");
  });
});

// Rows, columns and the totals the table and the download share -----------------------------------

describe.each(KINDS)("buildRows: %s", (kind) => {
  it("fills every column of its definition, in order, with the type its format renders", () => {
    const definition = definitionOf(kind);
    const rows = buildRows(kind, INPUT_BY_KIND[kind], QUERY_BY_KIND[kind]);
    const keys = definition.columns.map((column) => column.key);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.id.length).toBeGreaterThan(0);
      expect(Object.keys(row.cells)).toEqual(keys);
      for (const column of definition.columns) {
        const textual = column.format === "text" || column.format === "date";
        expect(typeof cellOf(row, column.key)).toBe(textual ? "string" : "number");
      }
    }
  });

  it("states a totals row that agrees with the rows above it, column by column", () => {
    const definition = definitionOf(kind);
    const query = QUERY_BY_KIND[kind];
    const rows = buildRows(kind, INPUT_BY_KIND[kind], query);
    const summary = summarise(kind, rows, QUIET_QUERY);
    const totals = totalsRowCells(definition, summary);

    expect(totals).toHaveLength(definition.columns.length);
    for (const [index, column] of definition.columns.entries()) {
      if (index === 0) {
        // The totals row leads with its own label rather than with a figure for the leading column.
        expect(typeof totals[index]).toBe("string");
        continue;
      }
      const sum = rows.reduce((running, row) => running + numericCellOf(row, column.key), 0);
      if (!summary.items.some((item) => item.key === column.key)) {
        // A column the report states no figure for carries an empty cell rather than a total nobody
        // computed: a share of the range's revenue, or a count whose periods add up to one customer
        // twice.
        expect(totals[index]).toBeNull();
      } else if (DERIVED_COLUMNS.has(column.key)) {
        // The figure is stated, and it is the period's ratio rather than the sum of the periods' ratios.
        expect(totals[index]).not.toBe(sum);
      } else {
        expect(numericTotal(summary, column.key)).toBe(sum);
        expect(totals[index]).toBe(sum);
      }
    }
  });
});

describe("buildSalesRows: the periods a range is cut into", () => {
  it("produces one row per bucket the range enumerates, at the day and the week cut alike", () => {
    const daily = buildSalesRows(INPUT_BY_KIND.sales, QUERY_BY_KIND.sales, "day");
    const weekly = buildSalesRows(INPUT_BY_KIND.sales, QUERY_BY_KIND.sales, "week");
    const dayKeys = eachBucket(MONTH_EDGE_RANGE, "day").map((bucket) => bucket.key);
    // Two weeks, because the fixture window crosses the month it covers.
    const weekKeys = eachBucket(MONTH_EDGE_RANGE, "week").map((bucket) => bucket.key);

    expect(daily.map((row) => row.id)).toEqual(dayKeys);
    expect(weekly.map((row) => row.id)).toEqual(weekKeys);
  });

  it("cuts a range crossing a year boundary into one row per month it touches", () => {
    const input = { orders: [], salesRecords: factsAcross(YEAR_EDGE_RANGE), customers: [] };
    const query: Analytics.ReportQuery = { from: YEAR_EDGE_RANGE.from, to: YEAR_EDGE_RANGE.to };
    const rows = buildSalesRows(input, query, "month");

    const monthKeys = eachBucket(YEAR_EDGE_RANGE, "month").map((bucket) => bucket.key);
    expect(rows.map((row) => row.id)).toEqual(monthKeys);
    expect(monthKeys).toEqual(["2024-12", "2025-01"]);
    // The period cell states the bucket's own first day, so a partly covered month is labelled by the
    // day the report covers rather than by the month's end.
    expect(cellOf(rows[0], "period")).toBe("2024-12-01");
  });

  it("yields exactly one row for a single day, the shortest range it accepts", () => {
    const input = { orders: [], salesRecords: factsAcross(SINGLE_DAY_RANGE), customers: [] };
    const rows = buildSalesRows(input, { from: FIXED_DATE, to: FIXED_DATE }, "day");

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(FIXED_DATE);
  });
});

describe("an empty range", () => {
  it("is a report of no rows, zeroed totals and an empty series, for every kind", () => {
    for (const kind of KINDS) {
      const rows = buildRows(kind, QUIET_INPUT, QUIET_QUERY);
      expect(rows).toEqual([]);

      const summary = summarise(kind, rows, QUIET_QUERY);
      expect(summary.items.length).toBeGreaterThan(0);
      // Zero is what nothing came to, and never a `NaN` from dividing by a count of zero.
      for (const item of summary.items) expect(item.value).toBe(0);

      const series = buildReportSeries(kind, rows, definitionOf(kind));
      expect(series.length).toBeGreaterThan(0);
      for (const chart of series) expect(chart.points).toEqual([]);
    }
  });
});

// The chart beside the table ----------------------------------------------------------------------

describe("buildReportSeries", () => {
  it("plots the rows the table shows, one point each, so the two cannot disagree", () => {
    for (const kind of KINDS) {
      const definition = definitionOf(kind);
      const rows = buildRows(kind, INPUT_BY_KIND[kind], QUERY_BY_KIND[kind]);
      const series = buildReportSeries(kind, rows, definition);
      const axis = definition.columns[0].key;

      // One series over the table's total column, or two counts for the customer report.
      expect(series).toHaveLength(kind === "customers" ? 2 : 1);
      for (const chart of series) {
        expect(definition.columns.some((column) => column.key === chart.id)).toBe(true);
        expect(chart.points.map((point) => point.x)).toEqual(rows.map((row) => cellOf(row, axis)));
        expect(chart.points.map((point) => point.y)).toEqual(
          rows.map((row) => cellOf(row, chart.id)),
        );
        for (const point of chart.points) expect(point.label).toBeTruthy();
        expect(chart.color).toMatch(/^var\(--chart-series-\d\)$/);
      }
    }
  });
});

// The transport -----------------------------------------------------------------------------------

describe("the report endpoints", () => {
  it("lists the catalogue the taxonomy declares, to an administrator", async () => {
    const definitions = valueOf(await listReportDefinitions(adminOptions()));
    expect(definitions).toEqual(REPORT_DEFINITIONS);
    expect(definitions.map((definition) => definition.kind)).toEqual(KINDS);
    for (const definition of definitions) {
      const query = defaultReportQuery(REPORT_DEFINITIONS, definition.kind);
      expect(query.bucket).toBe(definition.granularity);
    }
  });

  it("refuses the catalogue to a caller with no session, and a report to a signed-in customer", async () => {
    const anonymous = errorOf(await listReportDefinitions());
    expect(anonymous.status).toBe(401);
    expect(anonymous.code).toBe(API_ERROR_CODES.UNAUTHENTICATED);

    // The role is checked where the endpoint runs, not only by hiding a control on a page.
    const customer = valueOf(
      await signIn({ email: DEMO_ACCOUNTS.CUSTOMER_EMAIL, password: DEMO_ACCOUNTS.PASSWORD }),
    );
    const refused = errorOf(
      await runReport(monthRequest("sales"), { sessionToken: customer.token }),
    );
    expect(refused.status).toBe(403);
    expect(refused.code).toBe(API_ERROR_CODES.FORBIDDEN);
  });

  it("runs every report over the trailing month of the seeded collections", async () => {
    for (const kind of KINDS) {
      const definition = definitionOf(kind);
      const result = valueOf(await runReport(monthRequest(kind), adminOptions()));

      expect(result.kind).toBe(kind);
      expect(result.definitionId).toBe(definition.id);
      expect(result.from).toBe(TRAILING_MONTH.from);
      expect(result.to).toBe(TRAILING_MONTH.to);
      expect(result.granularity).toBe(definition.granularity);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.summary.items.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
    }
  });

  it("cuts the sales report into the days of the range it was asked for, and no day outside it", async () => {
    const buckets = eachBucket(TRAILING_MONTH, "day");
    const result = valueOf(await runReport(monthRequest("sales"), adminOptions()));
    const keys = new Set(buckets.map((bucket) => bucket.key));

    expect(result.rows.length).toBeLessThanOrEqual(buckets.length);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
    for (const row of result.rows) expect(keys.has(row.id)).toBe(true);
    // The summary is the rows' own sum, so the metrics above the table, the table's totals row and the
    // CSV's final row are one computation rather than three that happen to agree.
    const summed = result.rows.reduce(
      (running, row) => running + numericCellOf(row, "netRevenue"),
      0,
    );
    expect(numericTotal(result.summary, "netRevenue")).toBe(summed);
  });

  it("states one revenue basis across the two order-derived reports", async () => {
    const products = valueOf(await runReport(monthRequest("products"), adminOptions()));
    const customers = valueOf(await runReport(monthRequest("customers"), adminOptions()));
    // Both read one period of one order collection, so both state one figure under the label. The sales
    // report deliberately does not: its fact rows carry refunds and their own discount basis, which is
    // the difference between what was invoiced and what was kept.
    expect(numericTotal(products.summary, "revenue")).toBe(
      numericTotal(customers.summary, "revenue"),
    );
  });

  it("runs the parts form at the cut the caller names", async () => {
    const result = valueOf(
      await runReport("sales", TRAILING_MONTH.from, TRAILING_MONTH.to, "week", adminOptions()),
    );
    expect(result.kind).toBe("sales");
    expect(result.granularity).toBe("week");
    for (const row of result.rows) expect(row.id).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("answers an unknown report kind with the seam's not-found failure", async () => {
    const request: ReportRunRequest = {
      ...monthRequest("sales"),
      kind: "inventory" as Analytics.ReportKind,
    };
    const refused = errorOf(await runReport(request, adminOptions()));
    expect(refused.status).toBe(404);
    expect(refused.code).toBe(API_ERROR_CODES.ROUTE_NOT_FOUND);
  });

  it("refuses a range that breaks a rule before the request leaves, naming the field it broke", async () => {
    const cases: readonly (readonly [Analytics.ReportQuery, string])[] = [
      [{ from: MONTH_EDGE_RANGE.to, to: MONTH_EDGE_RANGE.from }, "range"],
      [{ from: addDays(TRAILING_MONTH.to, 1), to: addDays(TRAILING_MONTH.to, 5) }, "from"],
      [{ from: addDays(TRAILING_MONTH.to, -400), to: TRAILING_MONTH.to }, "range"],
      [{ from: "not-a-date", to: TRAILING_MONTH.to }, "from"],
    ];
    for (const [range, field] of cases) {
      const refused = errorOf(await runReport({ kind: "sales", ...range }, adminOptions()));
      expect(refused.status).toBe(422);
      expect(refused.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);
      expect(refused.field).toBe(field);
      expect(refused.message).toBeTruthy();
    }

    // Applied before the request leaves, so a picker is answered with the field it broke without a
    // session and without a round trip.
    const early = errorOf(
      await runReport({ kind: "sales", from: MONTH_EDGE_RANGE.to, to: MONTH_EDGE_RANGE.from }),
    );
    expect(early.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);
    expect(early.field).toBe("range");
  });

  it("refuses a run whose range names no day at all", async () => {
    // The parts form with its options where the range goes — `runReport(kind, options)` — names no day at
    // either end, so the range rule refuses it for the end that is missing rather than dispatching a
    // request no period can answer.
    const refused = errorOf(await runReport("sales", adminOptions()));
    expect(refused.status).toBe(422);
    expect(refused.field).toBe("from");
  });

  it("answers the same query with the same rows twice", async () => {
    const first = valueOf(await runReport(monthRequest("customers"), adminOptions()));
    const second = valueOf(await runReport(monthRequest("customers"), adminOptions()));

    expect(second.rows).toEqual(first.rows);
    expect(second.summary).toEqual(first.summary);
    expect(second.series).toEqual(first.series);
  });

  it("reports a range with no activity as a result with no rows, not as a failure", async () => {
    const request: ReportRunRequest = { kind: "sales", from: QUIET_RANGE.from, to: QUIET_RANGE.to };
    const result = valueOf(await runReport(request, adminOptions()));

    expect(result.rows).toEqual([]);
    expect(result.series[0]?.points).toEqual([]);
  });

  it("answers an armed failure with a failure value rather than throwing across the seam", async () => {
    failNext({ routeId: "reports.run" });
    const refused = errorOf(await runReport(monthRequest("sales"), adminOptions()));
    expect(refused.status).toBe(503);
    expect(refused.code).toBe(API_ERROR_CODES.DATA_SOURCE_UNAVAILABLE);

    failNext({ routeId: "reports.list" });
    const listed = errorOf(await listReportDefinitions(adminOptions()));
    expect(listed.code).toBe(API_ERROR_CODES.DATA_SOURCE_UNAVAILABLE);
  });
});

// The export matrix the CSV writer is handed -------------------------------------------------------

describe.each(KINDS)("toCsvMatrix: %s", (kind) => {
  it("writes the definition's headings and the table's own rows, in the table's order", () => {
    const definition = definitionOf(kind);
    const rows = buildRows(kind, INPUT_BY_KIND[kind], QUERY_BY_KIND[kind]);
    const matrix = toCsvMatrix(definition, rows, summarise(kind, rows, QUERY_BY_KIND[kind]));
    const leading = definition.columns[0].key;

    expect(matrix.header).toEqual(definition.columns.map((column) => column.label));
    expect(matrix.rows).toHaveLength(rows.length + 1);
    rows.forEach((row, index) => {
      // The leading cell is the row's own label — its period, or the product — so the k-th body row is
      // the k-th row of the table and not another one holding a similar figure.
      expect(matrix.rows[index][0]).toBe(String(cellOf(row, leading)));
    });
  });

  it("ends with the totals row the table renders, its money stated as a plain figure", () => {
    const definition = definitionOf(kind);
    const query = QUERY_BY_KIND[kind];
    const rows = buildRows(kind, INPUT_BY_KIND[kind], query);
    const summary = summarise(kind, rows, query);
    const totals = toCsvMatrix(definition, rows, summary).rows[rows.length];

    expect(totals[0]).toBe(String(totalsRowCells(definition, summary)[0]));
    definition.columns.forEach((column, index) => {
      if (column.format !== "money") return;
      const stated = totalOf(summary, column.key);
      // Money leaves as the decimal a spreadsheet can sum: the figure the table shows, and no symbol.
      if (typeof stated === "number") expect(Number(totals[index])).toBeCloseTo(stated / 100, 5);
      expect(totals[index]).not.toContain("$");
    });
  });

  it("serialises without loss, so the file holds one line per row it reports", () => {
    const definition = definitionOf(kind);
    const rows = buildRows(kind, INPUT_BY_KIND[kind], QUERY_BY_KIND[kind]);
    const matrix = toCsvMatrix(definition, rows, summarise(kind, rows, QUERY_BY_KIND[kind]));
    const result = buildCsvResult(matrix);

    expect(result.rowCount).toBe(rows.length + 1);
    expect(result.droppedRowCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.text.split(CSV_LINE_ENDING)).toHaveLength(result.rowCount + 1);
    expect(serialiseCsv(matrix)).toBe(result.text);
  });
});

describe("downloadCsv: the export a reports view starts", () => {
  it("reports the missing document where no DOM exists, instead of throwing", () => {
    // This project runs in node, where `tests/setup.ts` installs no shim because its DOM stubs are
    // skipped when there is no window: the document check is the first `src/utils/csv.ts` makes, so it
    // answers here and the object-URL and anchor path is never reached. That path and the blob it hands
    // the browser are covered under jsdom by tests/unit/utils/csv.test.ts.
    expect(typeof document).toBe("undefined");
    const matrix = toCsvMatrix(definitionOf("sales"), [], summarise("sales", [], QUIET_QUERY));
    expect(downloadCsv("sales-report", serialiseCsv(matrix))).toEqual({
      ok: false,
      fileName: "sales-report.csv",
      reason: "no-document",
    });
  });
});
