/**
 * Path: tests/components/kpiCard.test.tsx
 * Purpose: The KPI card's own branches — each of the four figures with its change and comparison, a decline, a flat comparison, a comparison that states no percentage, the loading frame, the label override and the heading levels, and the card's decorative placeholder
 * Lines: 169
 */

import { describe, expect, it } from "vitest";

import { FEEDBACK_COPY } from "@/constants/content";
import { ADMIN_COPY, KPI_CHANGE_WORDS } from "@/constants/content-reports";
import { KpiCard, KpiCardPlaceholder } from "@/features/admin/KpiCard";
import type { KpiCardProps, KpiKind } from "@/features/admin/KpiCard";
import { describeBaseline } from "@/lib/analyticsService";
import type { KpiBaseline } from "@/types/analytics";
import {
  EMPTY_VALUE_PLACEHOLDER,
  formatInteger,
  formatMoneyCompact,
  formatScaledPercent,
} from "@/utils/format";

import { makeKpiBaseline } from "../fixtures";
import { renderWithProviders, screen, waitFor, within } from "../testUtils";

/** The four figures the dashboard states: the kind, its label, how its figure renders and its change field. */
type KpiUnit = "money" | "count";
type KpiChangeField = keyof Pick<
  KpiBaseline,
  | "revenueChangePercent"
  | "ordersChangePercent"
  | "unitsChangePercent"
  | "averageOrderValueChangePercent"
>;

const KPI_CASES: readonly (readonly [KpiKind, string, KpiUnit, KpiChangeField])[] = [
  ["revenue", ADMIN_COPY.KPI_REVENUE_LABEL, "money", "revenueChangePercent"],
  ["orders", ADMIN_COPY.KPI_ORDERS_LABEL, "count", "ordersChangePercent"],
  ["units", ADMIN_COPY.KPI_UNITS_LABEL, "count", "unitsChangePercent"],
  [
    "average-order-value",
    ADMIN_COPY.KPI_AVERAGE_ORDER_VALUE_LABEL,
    "money",
    "averageOrderValueChangePercent",
  ],
];

/** How one figure renders, by the unit the catalogue ties to its kind. */
function figureText(unit: KpiUnit, value: number): string {
  return unit === "money" ? formatMoneyCompact(value) : formatInteger(value);
}

/** Renders one KPI card and returns its region, named by the card's heading once the providers settle. */
async function cardFor(name: string, props: KpiCardProps): Promise<HTMLElement> {
  renderWithProviders(<KpiCard {...props} />);
  return screen.findByRole("region", { name });
}

describe.each(KPI_CASES)("the %s card", (kpi, label, unit, changeField) => {
  it("states its figure, its change in words and its named comparison", async () => {
    const baseline = makeKpiBaseline();
    const value = unit === "money" ? 1_284_500 : 96;
    const card = await cardFor(label, { kpi, value, baseline });

    expect(within(card).getByText(figureText(unit, value))).toBeInTheDocument();
    // The change line states the percentage, keeps the word for the direction, and draws the arrow beside it.
    const change = baseline[changeField];
    expect(within(card).getByText(formatScaledPercent(change))).toBeInTheDocument();
    expect(within(card).getByText(KPI_CHANGE_WORDS.up)).toBeInTheDocument();
    expect(card.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    // The comparison is named and dated by the module that owns both halves.
    expect(within(card).getByText(describeBaseline(baseline.kind, baseline))).toBeInTheDocument();
    // The figure's own label joins the outline at level 3 unless the page asks for another level.
    expect(within(card).getByRole("heading", { level: 3, name: label })).toBeInTheDocument();
  });
});

describe("a KPI whose comparison moved against it", () => {
  it("keeps the decline's minus, names the direction down and reinforces it in colour", async () => {
    const baseline = makeKpiBaseline({ revenueChangePercent: -3.2 });
    const card = await cardFor(ADMIN_COPY.KPI_REVENUE_LABEL, {
      kpi: "revenue",
      value: 900_000,
      baseline,
    });

    const delta = within(card).getByText(formatScaledPercent(-3.2));
    expect(delta).toBeInTheDocument();
    expect(within(card).getByText(KPI_CHANGE_WORDS.down)).toBeInTheDocument();
    expect(delta.className).toContain("sp-kpi-card__delta--down");
  });
});

describe("a KPI whose comparison did not move", () => {
  it("states a flat change with the flat arrow and no colour reinforcement", async () => {
    const baseline = makeKpiBaseline({ revenueChangePercent: 0 });
    const card = await cardFor(ADMIN_COPY.KPI_REVENUE_LABEL, {
      kpi: "revenue",
      value: 900_000,
      baseline,
    });

    const delta = within(card).getByText(formatScaledPercent(0));
    expect(delta.className).toBe("sp-kpi-card__delta");
    expect(within(card).getByText(KPI_CHANGE_WORDS.flat)).toBeInTheDocument();
    expect(card.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });
});

describe("a KPI whose comparison states no percentage", () => {
  it("shows the placeholder with the word for it and no arrow at all", async () => {
    const baseline = makeKpiBaseline({ revenueChangePercent: null });
    const card = await cardFor(ADMIN_COPY.KPI_REVENUE_LABEL, {
      kpi: "revenue",
      value: 900_000,
      baseline,
    });

    expect(within(card).getByText(EMPTY_VALUE_PLACEHOLDER)).toBeInTheDocument();
    expect(within(card).getByText(KPI_CHANGE_WORDS.unknown)).toBeInTheDocument();
    expect(card.querySelector("svg[aria-hidden='true']")).toBeNull();
  });
});

describe("a KPI whose summary is still on its way", () => {
  it("states the region busy and holds back the change and its comparison", async () => {
    const baseline = makeKpiBaseline();
    const card = await cardFor(ADMIN_COPY.KPI_REVENUE_LABEL, {
      kpi: "revenue",
      value: 1_284_500,
      baseline,
      isLoading: true,
    });

    expect(card).toHaveAttribute("aria-busy", "true");
    expect(within(card).getByText(FEEDBACK_COPY.LOADING)).toBeInTheDocument();
    expect(within(card).queryByText(formatScaledPercent(baseline.revenueChangePercent))).toBeNull();
    expect(within(card).queryByText(describeBaseline(baseline.kind, baseline))).toBeNull();
  });
});

describe("a KPI a page names itself", () => {
  it.each([2, 3, 4] as const)("renders the caller's label at heading level %i", async (level) => {
    renderWithProviders(
      <KpiCard
        kpi="orders"
        label="Orders placed"
        value={96}
        baseline={makeKpiBaseline()}
        headingLevel={level}
      />,
    );

    const card = await screen.findByRole("region", { name: "Orders placed" });
    expect(within(card).getByRole("heading", { level, name: "Orders placed" })).toBeInTheDocument();
  });
});

describe("the KPI card's placeholder", () => {
  it("states nothing readable while the summary it stands in for is unread", async () => {
    const { container } = renderWithProviders(<KpiCardPlaceholder />);
    await waitFor(() =>
      expect(container.querySelector(".sp-kpi-card[aria-hidden='true']")).not.toBeNull(),
    );

    expect(within(container).queryByRole("heading")).toBeNull();
    expect(within(container).queryByRole("region")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
