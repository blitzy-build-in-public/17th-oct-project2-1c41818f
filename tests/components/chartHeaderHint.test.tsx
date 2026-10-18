/**
 * Path: tests/components/chartHeaderHint.test.tsx
 * Purpose: The chart header's three controls in order, and the hint the last of them reveals
 * Lines: 113
 */

import { describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/constants/content";
import { GRANULARITY_OPTIONS } from "@/constants/taxonomy";
import { SalesChart } from "@/features/admin/SalesChart";
import type { RevenueGroupBy } from "@/types/analytics";

import { makeChartSeries } from "../fixtures";
import { renderWithProviders, screen, within } from "../testUtils";

/*
 * The dashboard's revenue chart mounted on its own. `src/features/admin/SalesChart.tsx` is presentational —
 * the series, the bucket and the split arrive as props and every change goes back through a callback — so
 * this file needs no route, no sign-in and no seam: the chart reads nothing, and the header row it fills is
 * the whole subject. Three claims belong here: the row's three controls in the order the chart mounts them,
 * the hint control's own accessible name, and the supplementary-surface contract that control keeps — focus
 * or the pointer reveals the copy module's sentence through `aria-describedby`, Escape withdraws it, and the
 * focus stays on the control it describes.
 */

/** The name the bucket control goes by: the granularity choices' own words, joined, as the chart words it. */
const BUCKET_CONTROL_LABEL = GRANULARITY_OPTIONS.map((option) => option.label).join(" / ");

/** The bucket the chart opens on, taken from the vocabulary module so no granularity is written here. */
const BUCKET = GRANULARITY_OPTIONS[0].value;

/** The split the chart opens on: the toggle's first position, which the copy module words "By category". */
const GROUP_BY: RevenueGroupBy = "category";

/** The series the chart plots: the fixture's two bands, each a whole number of minor units. */
const SERIES = [makeChartSeries()];

/** The two callbacks the chart reports a change through; this file asserts the header, not a change. */
const NO_BUCKET_CHANGE = (): void => undefined;
const NO_GROUP_BY_CHANGE = (): void => undefined;

/** The header row the chart mounts its controls into, or a failure naming the row's absence. */
function controlsRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>(".sp-chart__controls");
  if (row === null) throw new Error("the chart rendered no header control row");
  return row;
}

/** The chart mounted once, as the dashboard mounts it, with no route, guard or request around it. */
function renderChart() {
  return renderWithProviders(
    <SalesChart
      series={SERIES}
      bucket={BUCKET}
      onBucketChange={NO_BUCKET_CHANGE}
      groupBy={GROUP_BY}
      onGroupByChange={NO_GROUP_BY_CHANGE}
    />,
  );
}

describe("the chart header's controls", () => {
  it("holds the bucket field, the split toggle and the hint in that order", async () => {
    const { container, user } = renderChart();
    const row = controlsRow(container);
    const bucket = within(row).getByLabelText(BUCKET_CONTROL_LABEL);
    const toggle = within(row).getByRole("group", { name: ADMIN_COPY.CHART_SERIES_CONTROL_LABEL });
    // Named by what its hint is about, which is the label the copy module owns.
    const hint = within(row).getByRole("button", { name: ADMIN_COPY.CHART_SERIES_HINT_LABEL });

    // The row mounts the bucket's field, then the split's toggle, then the hint, and the order a keyboard
    // walks them in is that same order: the field, the toggle's two buttons, then the hint last.
    const [category, channel] = within(toggle).getAllByRole("button");
    bucket.focus();
    expect(bucket).toHaveFocus();
    await user.tab();
    expect(category).toHaveFocus();
    await user.tab();
    expect(channel).toHaveFocus();
    await user.tab();
    expect(hint).toHaveFocus();
  });

  it("reveals the hint on focus and on hover, and dismisses it with Escape", async () => {
    const { container, user } = renderChart();
    const hint = screen.getByRole("button", { name: ADMIN_COPY.CHART_SERIES_HINT_LABEL });
    const channel = within(controlsRow(container)).getByRole("button", {
      name: ADMIN_COPY.CHART_SERIES_CHANNEL_LABEL,
    });

    // Reaching it by keyboard describes the control with the copy module's sentence and types nothing.
    channel.focus();
    await user.tab();
    expect(hint).toHaveFocus();
    const bubble = screen.getByRole("tooltip");
    expect(bubble).toHaveTextContent(ADMIN_COPY.CHART_SERIES_HINT);
    expect(hint.getAttribute("aria-describedby")).toBe(bubble.id);

    // Escape dismisses the hint and leaves the focus on the control it describes.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(hint).not.toHaveAttribute("aria-describedby");
    expect(hint).toHaveFocus();

    // The pointer reveals the same description, and leaving the control withdraws it.
    await user.hover(hint);
    expect(screen.getByRole("tooltip")).toHaveTextContent(ADMIN_COPY.CHART_SERIES_HINT);
    expect(hint.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    await user.unhover(hint);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
