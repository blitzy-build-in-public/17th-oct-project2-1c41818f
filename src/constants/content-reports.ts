/**
 * Path: src/constants/content-reports.ts
 * Purpose: The back-office register of the user-facing copy: the refusal a signed-in visitor whose role cannot reach an admin path is told, the shared range control's labels, presets and messages, the dashboard's labels and the reports' headings and export note, split out of src/constants/content.ts, which re-exports them
 * Lines: 130
 */

/*
 * A §0.5.5 split of `src/constants/content.ts`. The back-office register is one concern: the copy the admin-only
 * surfaces share — the refusal a visitor without the role is told, the range control the dashboard and the reports
 * are both read over, the dashboard's own labels and the reports' headings and export note. The file that held it
 * had grown past the request's 600-line ceiling, and §0.5.5 answers that by splitting a concern into a second file
 * rather than raising the ceiling. `src/constants/content.ts` re-exports this module, so no consumer's import path
 * and no exported name changed, and the dependency runs one way: this file imports nothing from content.ts.
 */

// Back-office access ---------------------------------------------------------------------------
/**
 * What a signed-in visitor whose role cannot reach the path they asked for is told. Consumer:
 * `src/features/account/LoginPage.tsx`, which states the refusal instead of offering to continue to it.
 */
export const ACCOUNT_ACCESS_COPY = {
  HEADING: "You do not have access to that page",
  BODY: "That page is for administrators, and the account you are signed in with is not one.",
  CONTINUE_LABEL: "Go to my account",
} as const;

// Dashboard and reports, over their shared range control ----------------------------------------
/** The range control's labels, presets and messages, kept once for both consumers. */
export const DATE_RANGE_COPY = {
  LABEL: "Reporting period",
  FROM_LABEL: "Start date",
  TO_LABEL: "End date",
  APPLY_LABEL: "Apply range",
  THIS_MONTH_PRESET_LABEL: "This month",
  THIS_YEAR_PRESET_LABEL: "This year",
  RANGE_INVERTED_MESSAGE: "The end date is before the start date. Swap the two dates.",
  RANGE_IN_FUTURE_MESSAGE: "The period cannot include dates after today.",
  /**
   * States whose days a period boundary falls on, so a range control says which "today" its figures are
   * bounded by instead of leaving it to be inferred. Rendered under the resolved range by every range
   * control: `src/features/reports/DateRangePicker.tsx` and the dashboard's own.
   */
  LOCAL_TIME_NOTE: "Period boundaries are whole days in your local time zone.",
} as const;
/** Names the preset that reaches back a given number of days. */
export const lastDaysLabel = (days: number): string => `Last ${days} days`;
/** Preset and range labels, each taking the value its caller has already resolved. */
export const resolvedRangeLabel = (formattedFrom: string, formattedTo: string): string =>
  `${formattedFrom} to ${formattedTo}`;
export const rangeTooLongMessage = (maxDays: number): string =>
  `Choose a period of ${maxDays} days or fewer.`;

/** Dashboard copy. Consumers: `src/features/admin/*`, with ranges from {@link DATE_RANGE_COPY}. */
export const ADMIN_COPY = {
  HEADING: "Sales dashboard",
  SUBHEADING: "Revenue, orders and product performance for the period you choose.",
  BASELINE_CONTROL_LABEL: "Compare with",
  KPI_REVENUE_LABEL: "Revenue",
  KPI_ORDERS_LABEL: "Orders",
  KPI_UNITS_LABEL: "Units sold",
  KPI_AVERAGE_ORDER_VALUE_LABEL: "Average order value",
  CHART_HEADING: "Revenue over time",
  CHART_SERIES_CONTROL_LABEL: "Show",
  CHART_SERIES_TOTAL_LABEL: "Total",
  CHART_SERIES_CATEGORY_LABEL: "By category",
  CHART_SERIES_CHANNEL_LABEL: "By channel",
  /**
   * The hint the chart header's information control reveals: what the two splits have in common, which the
   * toggle's own labels cannot say. The control that reveals it is named by the key below.
   */
  CHART_SERIES_HINT:
    "Either split breaks down the same revenue total, by product category or by sales channel.",
  /** Names the chart header's hint control by what its hint is about. */
  CHART_SERIES_HINT_LABEL: "About the revenue split",
  BREAKDOWN_HEADING: "Where the revenue came from",
  TOP_PRODUCTS_HEADING: "Top products",
  TOP_PRODUCTS_RANK_CONTROL_LABEL: "Rank by",
  TOP_PRODUCTS_RANK_COLUMN_LABEL: "Rank",
  RECENT_ORDERS_HEADING: "Recent orders",
  NOT_AUTHORIZED_TITLE: "This area is for administrators",
  NOT_AUTHORIZED_BODY: "The signed-in account does not hold the administrator role.",
  NOT_AUTHORIZED_ACTION_LABEL: "Go to the storefront",
} as const;
/** The name each sales channel shows in the revenue breakdown's series labels. */
export const CHANNEL_LABELS = { web: "Web", mobile: "Mobile app", store: "Store" } as const;
/** The word each KPI change's direction is stated in, beside the figure the formatter writes.
 *  Consumer: `src/features/admin/KpiCard.tsx`, whose arrow is hidden from assistive technology, so the
 *  direction has to be written as well — a rise and a fall of equal size must not read as one text. */
export const KPI_CHANGE_WORDS = {
  up: "up",
  down: "down",
  flat: "no change",
  unknown: "no comparable data",
} as const;
/** States how one KPI moved against its named baseline, from both values already formatted. */
export const kpiChangeLabel = (formattedChange: string, baselineLabel: string): string =>
  `${formattedChange} versus the ${baselineLabel.toLowerCase()}`;

/** Reports copy. Consumers: `src/features/reports/*`, with ranges from {@link DATE_RANGE_COPY}. */
export const REPORTS_COPY = {
  HEADING: "Reports",
  INTRO: "Run a report over any period, then take the rows away as CSV.",
  SELECTOR_LABEL: "Report",
  EXPORT_LABEL: "Download CSV",
  TOTALS_ROW_LABEL: "Total",
  SALES_CHART_HEADING: "Revenue by period",
  PRODUCT_CHART_HEADING: "Revenue by product",
  CUSTOMER_CHART_HEADING: "New and returning customers",
} as const;
/**
 * Picks the singular or plural noun a count needs. The one home of the rule, so a count is worded the same way
 * wherever the copy is: `src/constants/content.ts` reads it for its own sentences and this module for the export's.
 */
export const countNoun = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;
/** States how many rows the export produced. Consumer: `src/features/reports/ReportTable.tsx`. */
export const exportRowCountNote = (rowCount: number): string =>
  `The last export held ${rowCount} ${countNoun(rowCount, "row", "rows")}.`;
/** Describes the export's row cap and cell limit, and whose clock its dates use. */
export const exportNote = (rowCap: number, cellLimit: number): string =>
  `The export holds up to ${rowCap} rows and clips each cell at ${cellLimit} characters, so it opens in a spreadsheet. Dates and times are yours, not the server's.`;
/**
 * States the bound the product-performance chart plots to, so the leading products are not read as the
 * whole ranking: the chart draws the N products with the highest revenue, the table lists every product.
 *
 * @param limit - How many products the chart plots.
 * @returns The note that sits under the chart.
 */
export const productChartBoundNote = (limit: number): string =>
  `The chart plots the ${String(limit)} products with the highest revenue; the table below lists every product that sold.`;
