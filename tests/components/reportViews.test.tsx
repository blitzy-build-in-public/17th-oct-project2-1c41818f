/**
 * Path: tests/components/reportViews.test.tsx
 * Purpose: The report views' own states — each report's loaded surface, its busy frame, its failed run with a retry, the empty period it widens, an unreadable period's caveat, the catalogue's failure and the report body's placeholder
 * Lines: 302
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  VALIDATION_MESSAGES,
  chartDataTableCaption,
} from "@/constants/content";
import { DATE_RANGE_COPY, REPORTS_COPY } from "@/constants/content-reports";
import { DEMO_ACCOUNTS } from "@/constants/config";
import { ROUTES } from "@/constants/routes";
import { GRANULARITY_OPTIONS, REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { CustomerReport } from "@/features/reports/CustomerReport";
import { ProductPerformanceReport } from "@/features/reports/ProductPerformanceReport";
import { ReportBodyPlaceholder } from "@/features/reports/ReportPlaceholder";
import { API_PATHS } from "@/lib/mockServer";
import type { BucketGranularity, ReportDefinition, ReportKind } from "@/types/analytics";
import type { DateRange } from "@/types/common";
import { maxReportRange, toDateInputValue } from "@/utils/dates";

import {
  failNext,
  renderApp,
  renderWithProviders,
  resetApiState,
  screen,
  waitFor,
  within,
} from "../testUtils";
import type { RenderHarness, UserEvent } from "../testUtils";

// The reports route over its seeded data, driven the way the administrator flow drives it.

/** The sign-in form's controls; a required field's label also carries the hidden requirement text. */
const EMAIL_FIELD = new RegExp(`^${ACCOUNT_COPY.EMAIL_LABEL}`);
const PASSWORD_FIELD = new RegExp(`^${ACCOUNT_COPY.PASSWORD_LABEL}`);

/** The cut control's name — its own choices' words, joined — and the month cut a case asks for. */
const BUCKET_CONTROL_LABEL = GRANULARITY_OPTIONS.map((option) => option.label).join(" / ");
const MONTH_CUT = GRANULARITY_OPTIONS[2].value;

/** The heading each report charts under, so a paired data table is found by the caption built from it. */
const CHART_HEADINGS: Readonly<Record<ReportKind, string>> = {
  sales: REPORTS_COPY.SALES_CHART_HEADING,
  products: REPORTS_COPY.PRODUCT_CHART_HEADING,
  customers: REPORTS_COPY.CUSTOMER_CHART_HEADING,
};

/** The three report kinds, named for the case title each runs under. */
const REPORT_CASES: readonly (readonly [string, ReportDefinition])[] = REPORT_DEFINITIONS.map(
  (definition) => [definition.name, definition] as const,
);

/** The definition of one report kind, resolved the way `src/lib/reportService.ts` resolves it. */
function definitionOf(kind: ReportKind): ReportDefinition {
  return REPORT_DEFINITIONS.find((definition) => definition.kind === kind) ?? REPORT_DEFINITIONS[0];
}

/** Fills the sign-in screen a guard sent the visitor to and submits it. */
async function submitSignIn(user: UserEvent, email: string): Promise<void> {
  await user.type(await screen.findByLabelText(EMAIL_FIELD), email);
  await user.type(screen.getByLabelText(PASSWORD_FIELD), DEMO_ACCOUNTS.PASSWORD);
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await waitFor(() => expect(screen.queryByLabelText(EMAIL_FIELD)).toBeNull());
}

/** The administrator's view of the reports route, reached through the guard's own sign-in redirect. */
async function openAsReports(): Promise<RenderHarness> {
  const app = renderApp({ route: ROUTES.ADMIN_REPORTS });
  await submitSignIn(app.user, DEMO_ACCOUNTS.ADMIN_EMAIL);
  return app;
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

/** A thirty-day window years before the seeded history, so no report over it holds a row. */
function quietRange(): DateRange {
  return { from: "2015-01-01", to: "2015-01-30" };
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

beforeEach(() => {
  resetApiState();
});

describe.each(REPORT_CASES)("the %s report", (_name, definition) => {
  it("renders its figures, chart, table and export under its own tab and heading", async () => {
    const { user } = await openAsReports();
    await user.click(await screen.findByRole("tab", { name: definition.name }));

    // The panel is named by its tab and opens with the report's own level-2 heading, hidden from sight but
    // present to a reader navigating by heading.
    const panel = await screen.findByRole("tabpanel", { name: definition.name });
    expect(
      within(panel).getByRole("heading", { level: 2, name: definition.name }),
    ).toBeInTheDocument();

    const grid = tableGrid(
      await screen.findByRole("table", { name: new RegExp(`^${definition.name}\\.`) }),
    );
    expect(grid[0]).toEqual(definition.columns.map((column) => column.label));
    expect(grid.length).toBeGreaterThan(2);
    expect(grid.at(-1)?.[0]).toBe(REPORTS_COPY.TOTALS_ROW_LABEL);

    // The summary terms are the report's own column labels, and the chart repeats every figure it draws in a
    // paired data table banded by the column its bars are drawn along.
    const labels = definition.columns.map((column) => column.label);
    const terms = within(panel).getAllByRole("term");
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.every((term) => labels.includes(term.textContent ?? ""))).toBe(true);
    const chartGrid = tableGrid(
      screen.getByRole("table", { name: chartDataTableCaption(CHART_HEADINGS[definition.kind]) }),
    );
    expect(chartGrid[0][0]).not.toBe("");
    expect(chartGrid.length).toBeGreaterThan(1);

    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${REPORTS_COPY.EXPORT_LABEL}: ${definition.name}`),
      }),
    ).toBeInTheDocument();
  });
});

describe("a report re-run over a moved cut", () => {
  it.each(["products", "customers"] as const)(
    "keeps the %s report's figures and states its region busy until the new run lands",
    async (kind) => {
      const definition = definitionOf(kind);
      const { user } = await openAsReports();
      await user.click(await screen.findByRole("tab", { name: definition.name }));
      await screen.findByRole("table", { name: new RegExp(`^${definition.name}\\.`) });

      // A run in flight is what the busy frame reports, so its latency is widened for the length of it.
      vi.stubEnv("VITE_API_LATENCY_MS", "150");
      try {
        await user.selectOptions(screen.getByLabelText(BUCKET_CONTROL_LABEL), MONTH_CUT);
        await waitFor(() =>
          expect(screen.getByRole("tabpanel").querySelector("[aria-busy='true']")).not.toBeNull(),
        );
      } finally {
        vi.stubEnv("VITE_API_LATENCY_MS", "0");
      }
      await waitFor(() =>
        expect(screen.getByRole("tabpanel").querySelector("[aria-busy='true']")).toBeNull(),
      );
    },
  );
});

describe.each(REPORT_CASES)("a %s report whose run fails", (_name, definition) => {
  it("states the seam's message with a retry that restores the report", async () => {
    const failure = failNext({ path: `/api/reports/${definition.kind}` });
    const { user } = await openAsReports();
    await user.click(await screen.findByRole("tab", { name: definition.name }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    expect(screen.queryByRole("table", { name: new RegExp(`^${definition.name}\\.`) })).toBeNull();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(
      tableGrid(await screen.findByRole("table", { name: new RegExp(`^${definition.name}\\.`) }))
        .length,
    ).toBeGreaterThan(2);
    failure.disarm();
  });
});

describe("the catalogue a report is selected from", () => {
  it("states a failed read, then restores the selector and its report on retry", async () => {
    const failure = failNext({ path: API_PATHS.REPORT_DEFINITIONS });
    const app = renderApp({ route: ROUTES.ADMIN_REPORTS });
    await submitSignIn(app.user, DEMO_ACCOUNTS.ADMIN_EMAIL);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    // Without a definition there is nothing to name, run or export.
    expect(screen.queryByRole("tablist", { name: REPORTS_COPY.SELECTOR_LABEL })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    await app.user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(await screen.findAllByRole("tab")).toHaveLength(REPORT_DEFINITIONS.length);
    expect(
      tableGrid(await screen.findByRole("table", { name: /^Sales\./ })).length,
    ).toBeGreaterThan(2);
    failure.disarm();
  });
});

describe("a period that recorded nothing", () => {
  it("states the empty period for every report and widens it on request", async () => {
    const { user } = await openAsReports();
    // A window years before the seeded history took no order and gained no account, so every report over it
    // is empty — the customers report included, which a recent window still fills with its new accounts.
    const quiet = quietRange();
    await applyRange(user, quiet.from, quiet.to);
    expect(
      await screen.findByRole("heading", { name: EMPTY_STATES.reportRange.title }),
    ).toBeVisible();
    expect(screen.getByText(EMPTY_STATES.reportRange.description)).toBeInTheDocument();

    // Every report states the empty period in its own panel, and each offers the one action that resolves it.
    for (const definition of REPORT_DEFINITIONS) {
      await user.click(await screen.findByRole("tab", { name: definition.name }));
      expect(
        await screen.findByRole("heading", { name: EMPTY_STATES.reportRange.title }),
      ).toBeVisible();
      expect(
        screen.queryByRole("table", { name: new RegExp(`^${definition.name}\\.`) }),
      ).toBeNull();
    }

    await user.click(screen.getByRole("button", { name: EMPTY_STATES.dashboardRange.actionLabel }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: EMPTY_STATES.reportRange.title })).toBeNull(),
    );
    expect(screen.getByLabelText(DATE_RANGE_COPY.FROM_LABEL)).toHaveValue(
      toDateInputValue(maxReportRange().from),
    );
  });
});

describe("a report handed a period that cannot be read", () => {
  const NO_RANGE: DateRange = { from: "", to: "" };
  const GRANULARITY: BucketGranularity = GRANULARITY_OPTIONS[0].value;
  const WIDEN = (): void => {};

  it("leaves the customer chart's note as the caveat alone while no session is held", async () => {
    renderWithProviders(
      <CustomerReport range={NO_RANGE} granularity={GRANULARITY} onWidenRange={WIDEN} />,
    );
    // No session is in hand, so the run stays pending and the placeholder notes the caveat on its own.
    expect(await screen.findByText(DATE_RANGE_COPY.LOCAL_TIME_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves the product chart's supporting line as the caveat alone on the first frame", async () => {
    renderWithProviders(
      <ProductPerformanceReport range={NO_RANGE} granularity={GRANULARITY} onWidenRange={WIDEN} />,
    );
    expect(screen.getByText(DATE_RANGE_COPY.LOCAL_TIME_NOTE)).toBeInTheDocument();
    // The range breaks a rule, so the run is refused before the request leaves and the view states the refusal.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(VALIDATION_MESSAGES.REQUIRED);
  });
});

describe("the report body's placeholder", () => {
  const chart = { title: REPORTS_COPY.SALES_CHART_HEADING, rows: 3, series: 1 };

  it("draws no summary entry for a figure count that is not a number", async () => {
    const { container } = renderWithProviders(
      <ReportBodyPlaceholder figures={Number.NaN} chart={chart} />,
    );
    await waitFor(() =>
      expect(
        container
          .querySelector(".sp-report__summary")
          ?.querySelectorAll(".sp-report__summary-item"),
      ).toHaveLength(0),
    );
  });

  it("draws one summary entry per figure the run states", async () => {
    const { container } = renderWithProviders(<ReportBodyPlaceholder figures={4} chart={chart} />);
    await waitFor(() =>
      expect(
        container
          .querySelector(".sp-report__summary")
          ?.querySelectorAll(".sp-report__summary-item"),
      ).toHaveLength(4),
    );
  });
});
