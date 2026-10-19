/**
 * Path: tests/components/donutChart.test.tsx
 * Purpose: The donut's own depth: the slice walk and its readout, the hole's share and its total, the wording slots, and the two ways a ring comes to have no slice
 * Lines: 403
 */

import { describe, expect, it } from "vitest";

import { DonutChart } from "@/components/charts/DonutChart";
import { CHART_VIEWBOX_WIDTH, DEFAULT_CHART_HEIGHT } from "@/components/charts/chartScales";
import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import { formatMoney, formatMoneyCompact, formatShare } from "@/utils/format";

import { makeChartSeries } from "../fixtures";
import { renderWithProviders, screen, setupUser, within } from "../testUtils";

import type { ChartSeries } from "@/types/analytics";
import type { MinorUnits } from "@/types/common";

/*
 * What this file covers that `charts.test.tsx` does not. That suite draws a three-slice ring once and reads
 * its percentages, its legend and its paired table; the depth left over is the ring's own interaction — the
 * pointer selecting a slice and the keys walking it, Home and End reaching its ends, and the readout's words
 * and placement — the hole's share, the wording slots a caller fills (the centre's label, the legend's and
 * the percentages' switches, the empty state's headline, the chart's name), and the two shapes a ring comes
 * to hold no slice at all: a series carrying no finite point, and a breakdown whose total is not positive.
 *
 * Every figure is a pinned whole number of minor units, and every slice's own share is read through the same
 * formatter the legend writes with, so a case states one reading of a figure rather than a literal. The
 * assertions read what a visitor or an assistive technology reads: the readout's sentence, the names a group
 * and a table take, the words the ring writes, the drawings' own path data where a ratio is what is under
 * test, and the presence or absence of a legend, a label or a control.
 */

// Test data --------------------------------------------------------------------------------------

const CHART_TITLE = "Revenue by category";
const CHART_DESCRIPTION = "Net revenue in the selected range";
const CHART_LABEL = "Revenue split by category";

/** A ring of three known slices — 100 + 300 + 1 minor units — that a case reads as one whole. */
function slice(id: string, label: string, token: number, value: MinorUnits): ChartSeries {
  return makeChartSeries({
    id,
    label,
    color: CHART_SERIES_TOKEN_REFERENCES[token],
    points: [{ x: "2025-10-15", y: value }],
  });
}

const FIRST = slice("first", "Online store", 0, 100);
const SECOND = slice("second", "Marketplace", 1, 300);
const THIRD = slice("third", "Wholesale", 2, 1);
const SLICES: readonly ChartSeries[] = [FIRST, SECOND, THIRD];
const SLICE_TOTAL: MinorUnits = 401;

/** A slice's three readings, as the readout writes them: its label, its value and its share. */
function sliceReadout(sliced: ChartSeries, total: number): string {
  const value = sliced.points[0].y;
  return `${sliced.label} ${formatMoney(value)} ${formatShare(value, total, 1)}`;
}

/** The frame's drawing, or a failure naming the absence rather than a null dereference. */
function drawingOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("the donut rendered no drawing");
  return svg;
}

/** Every wedge's own path data, which is where the ring's two radii are observable. */
function slicePathsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll("path.sp-chart__slice")].map(
    (path) => path.getAttribute("d") ?? "",
  );
}

/** The readout's one sentence, or a failure naming the absence rather than a null dereference. */
function readoutOfChart(container: HTMLElement): string {
  const status = container.querySelector('[role="status"]');
  if (status === null) throw new Error("the donut rendered no readout");
  return status.textContent ?? "";
}

/** One drawing's wedges, in ring order, with a failure in place of an empty hover. */
function wedgesOf(container: HTMLElement): SVGPathElement[] {
  const wedges = [...container.querySelectorAll<SVGPathElement>("path.sp-chart__slice")];
  if (wedges.length === 0) throw new Error("the donut drew no slice");
  return wedges;
}

/** The words the ring writes beside its wedges, in the order the marks were built. */
function sliceLabelsOf(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll<SVGTextElement>("text.sp-chart__label")].map(
    (node) => node.textContent,
  );
}

// Cases ------------------------------------------------------------------------------------------

describe("the donut's slice walk and its readout", () => {
  it("reports the slice the pointer is over and clears the readout when it leaves", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<DonutChart series={SLICES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });
    const wedges = wedgesOf(container);

    await user.hover(wedges[1]);
    expect(readoutOfChart(container)).toBe(sliceReadout(SECOND, SLICE_TOTAL));
    // The readout is placed by the ring's own box, published for the stylesheet to clamp by.
    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.getAttribute("style")).toContain("--sp-chart-readout-x");

    // A second wedge reports its own three readings, so the readout follows the pointer rather than a state
    // written once.
    await user.hover(wedges[0]);
    expect(readoutOfChart(container)).toBe(sliceReadout(FIRST, SLICE_TOTAL));

    // Leaving the plot takes the readout off the ring instead of leaving the last sentence standing.
    await user.unhover(wedges[0]);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("walks the ring with the arrow keys, wraps at its ends, and holds an unrelated key", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<DonutChart series={SLICES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    // Focusing the plot selects the first slice, so the ring is not entered with nothing to read.
    await user.tab();
    expect(readoutOfChart(container)).toBe(sliceReadout(FIRST, SLICE_TOTAL));

    // Backwards off the first slice wraps to the last, and forward walks on from there.
    await user.keyboard("{ArrowLeft}");
    expect(readoutOfChart(container)).toBe(sliceReadout(THIRD, SLICE_TOTAL));
    await user.keyboard("{ArrowLeft}");
    expect(readoutOfChart(container)).toBe(sliceReadout(SECOND, SLICE_TOTAL));
    await user.keyboard("{ArrowRight}");
    expect(readoutOfChart(container)).toBe(sliceReadout(THIRD, SLICE_TOTAL));

    // Home and End are the two ends of the ring themselves rather than a step towards one.
    await user.keyboard("{Home}");
    expect(readoutOfChart(container)).toBe(sliceReadout(FIRST, SLICE_TOTAL));
    await user.keyboard("{End}");
    expect(readoutOfChart(container)).toBe(sliceReadout(THIRD, SLICE_TOTAL));

    // A key the plot does not act on leaves the readout exactly where it stands.
    const held = readoutOfChart(container);
    await user.keyboard("x");
    expect(readoutOfChart(container)).toBe(held);

    // A pointer that leaves the ring while the plot still holds focus leaves nothing selected, and the next
    // arrow enters the ring at its first slice rather than at an index the data may no longer have.
    await user.hover(wedgesOf(container)[2]);
    await user.unhover(wedgesOf(container)[2]);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(readoutOfChart(container)).toBe(sliceReadout(SECOND, SLICE_TOTAL));

    // Tabbing on takes focus off the plot, which puts the readout away with it.
    await user.tab();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps the readout inside the ring's own box however long its sentence runs", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<DonutChart series={SLICES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });
    await user.hover(wedgesOf(container)[0]);

    const status = container.querySelector<HTMLElement>('[role="status"]');
    const style = (status as HTMLElement).style;
    const percentOf = (name: string): number => Number.parseFloat(style.getPropertyValue(name));
    // The box is anchored on the ring, so it can neither stand on the centre total's hole nor leave the
    // drawing, and the width it reserves is measured from the sentence it holds.
    expect(percentOf("--sp-chart-readout-x")).toBeGreaterThanOrEqual(0);
    expect(percentOf("--sp-chart-readout-x")).toBeLessThanOrEqual(100);
    expect(percentOf("--sp-chart-readout-y")).toBeGreaterThanOrEqual(0);
    expect(percentOf("--sp-chart-readout-y")).toBeLessThanOrEqual(100);
    expect(style.getPropertyValue("--sp-chart-readout-w")).toMatch(
      /^calc\(\d+ch \+ 2 \* var\(--space-3\)\)$/,
    );
  });
});

describe("the donut's ring and its hole", () => {
  it("draws the hole at the share the caller asks for and clamps a share with no ring left", async () => {
    const carried = renderWithProviders(<DonutChart series={SLICES} title={CHART_TITLE} />);
    await within(carried.container).findByRole("img", { name: CHART_TITLE });
    const atDefault = slicePathsOf(carried.container);

    const narrower = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} innerRadiusRatio={0.4} />,
    );
    await within(narrower.container).findByRole("img", { name: CHART_TITLE });
    expect(slicePathsOf(narrower.container)).not.toEqual(atDefault);

    // A ratio at the outer radius would leave no ring to draw, so it is clamped to the largest hole that
    // still leaves one — the same drawing as that bound stated exactly.
    const clamped = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} innerRadiusRatio={2} />,
    );
    await within(clamped.container).findByRole("img", { name: CHART_TITLE });
    const atBound = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} innerRadiusRatio={0.95} />,
    );
    await within(atBound.container).findByRole("img", { name: CHART_TITLE });
    expect(slicePathsOf(clamped.container)).toEqual(slicePathsOf(atBound.container));
    expect(slicePathsOf(clamped.container)).not.toEqual(atDefault);
  });

  it("states the whole in the hole and the caller's own caption under it", async () => {
    const labelled = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} centreLabel="Revenue" />,
    );
    await within(labelled.container).findByRole("img", { name: CHART_TITLE });
    expect(
      within(labelled.container).getByText(formatMoneyCompact(SLICE_TOTAL)),
    ).toBeInTheDocument();
    expect(within(labelled.container).getByText("Revenue")).toBeInTheDocument();

    // The sentence under the total belongs to the caller's surface, so a caller that gives none gets none.
    const bare = renderWithProviders(<DonutChart series={SLICES} title={CHART_TITLE} />);
    await within(bare.container).findByRole("img", { name: CHART_TITLE });
    expect(within(bare.container).getByText(formatMoneyCompact(SLICE_TOTAL))).toBeInTheDocument();
    expect(within(bare.container).queryByText("Revenue")).toBeNull();
  });

  it("draws the frame at the height a caller gives it and at the default otherwise", async () => {
    const sized = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} height={320} />,
    );
    await within(sized.container).findByRole("img", { name: CHART_TITLE });
    expect(drawingOf(sized.container).getAttribute("viewBox")).toBe(
      `0 0 ${CHART_VIEWBOX_WIDTH} 320`,
    );

    const unsized = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} height={0} />,
    );
    await within(unsized.container).findByRole("img", { name: CHART_TITLE });
    expect(drawingOf(unsized.container).getAttribute("viewBox")).toBe(
      `0 0 ${CHART_VIEWBOX_WIDTH} ${DEFAULT_CHART_HEIGHT}`,
    );
  });
});

describe("the donut's wording slots", () => {
  it("takes the drawing's name from the label, the heading, the sentence or its own slices", async () => {
    const labelled = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} ariaLabel={CHART_LABEL} />,
    );
    await within(labelled.container).findByRole("group", { name: CHART_LABEL });
    expect(within(labelled.container).getByRole("img", { name: CHART_LABEL })).toBeInTheDocument();
    // The heading still names the block, and the table below is captioned by the caller's own words.
    expect(
      within(labelled.container).getByRole("heading", { level: 3, name: CHART_TITLE }),
    ).toBeInTheDocument();
    expect(
      within(labelled.container).getByRole("table", {
        name: chartDataTableCaption(CHART_TITLE),
      }),
    ).toBeInTheDocument();

    // With no label the heading names the drawing, and with neither the sentence does.
    const headed = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} description={CHART_DESCRIPTION} />,
    );
    await within(headed.container).findByRole("group", { name: CHART_TITLE });
    expect(
      within(headed.container).getByRole("table", { name: chartDataTableCaption(CHART_TITLE) }),
    ).toBeInTheDocument();

    const described = renderWithProviders(
      <DonutChart series={SLICES} description={CHART_DESCRIPTION} />,
    );
    await within(described.container).findByRole("group", { name: CHART_DESCRIPTION });
    expect(within(described.container).getByText(CHART_DESCRIPTION)).toBeInTheDocument();

    // A ring a caller named nowhere is named by the slices it splits, which is the ring's own subject.
    const drawn = SLICES.map((one) => one.label).join(", ");
    const nameless = renderWithProviders(<DonutChart series={SLICES} />);
    await within(nameless.container).findByRole("group", { name: drawn });
    expect(
      within(nameless.container).getByRole("table", { name: chartDataTableCaption(drawn) }),
    ).toBeInTheDocument();
  });

  it("renders the header only where a caller gave it something to hold", async () => {
    const controls = renderWithProviders(
      <DonutChart series={SLICES} actions={<button type="button">Group by channel</button>} />,
    );
    await within(controls.container).findByRole("button", { name: "Group by channel" });
    expect(
      within(controls.container).getByRole("img", {
        name: SLICES.map((one) => one.label).join(", "),
      }),
    ).toBeInTheDocument();

    // A control slot that paints nothing is no header at all, rather than an empty band above the drawing.
    for (const empty of [null, false, ""] as const) {
      const bare = renderWithProviders(
        <DonutChart series={SLICES} title={CHART_TITLE} actions={empty} />,
      );
      await within(bare.container).findByRole("img", { name: CHART_TITLE });
      expect(within(bare.container).queryByRole("button")).toBeNull();
      expect(within(bare.container).getAllByRole("heading")).toHaveLength(1);
    }
  });

  it("draws the legend and the wedge percentages only where the caller leaves them on", async () => {
    const drawn = SLICES.map((one) => one.label).join(", ");
    const bare = renderWithProviders(<DonutChart series={SLICES} showPercentages={false} />);
    await within(bare.container).findByRole("img", { name: drawn });
    // Suppressing the annotations takes nothing out of the chart: every share and figure stays in the
    // legend and in the paired table below it.
    expect(sliceLabelsOf(bare.container)).toEqual([]);
    expect(bare.container.querySelectorAll("line.sp-chart__leader")).toHaveLength(0);
    const legend = within(bare.container).getAllByRole("listitem");
    expect(legend).toHaveLength(SLICES.length);
    expect(legend[0]).toHaveTextContent(formatShare(100, SLICE_TOTAL, 1));
    expect(
      within(bare.container).getByRole("table", { name: chartDataTableCaption(drawn) }),
    ).toBeInTheDocument();

    const unlegended = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} showLegend={false} />,
    );
    await within(unlegended.container).findByRole("img", { name: CHART_TITLE });
    expect(within(unlegended.container).queryByRole("list")).toBeNull();
    // The annotations stay drawn where the legend is the thing suppressed.
    expect(sliceLabelsOf(unlegended.container)).toHaveLength(SLICES.length);
    expect(
      within(unlegended.container).getByRole("table", {
        name: chartDataTableCaption(CHART_TITLE),
      }),
    ).toBeInTheDocument();
  });
});

describe("a ring with no slice to draw", () => {
  it("shows the no-data state for a breakdown whose total is not positive", async () => {
    // Every point is finite, so the chart has data; no point is positive, so no slice earns a wedge of the
    // ring and nothing may divide by a total of zero. This is the shape a period that sold nothing and
    // refunded leaves: a chart with figures but no ring to draw.
    const refunded = makeChartSeries({
      id: "net",
      label: "Net revenue",
      points: [
        { x: "2025-10-15", y: 0 },
        { x: "2025-10-16", y: -300 },
      ],
    });
    const { container } = renderWithProviders(
      <DonutChart series={[refunded]} title={CHART_TITLE} />,
    );

    expect(
      await within(container).findByRole("heading", {
        level: 4,
        name: EMPTY_STATES.dashboardRange.title,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    expect(within(container).queryByRole("table")).toBeNull();
    expect(within(container).queryByRole("list")).toBeNull();
  });

  it("shows a caller's own headline in the empty state, over the shared explanation", async () => {
    const { container } = renderWithProviders(
      <DonutChart series={[]} emptyMessage="No revenue in this range" />,
    );

    // With no heading of its own the state is the block's first heading; the sentence under it stays the
    // library's, so no explanation is invented at a call site.
    expect(
      await within(container).findByRole("heading", {
        level: 3,
        name: "No revenue in this range",
      }),
    ).toBeInTheDocument();
    expect(
      within(container).getByText(EMPTY_STATES.dashboardRange.description),
    ).toBeInTheDocument();
  });

  it("renders the footer whether or not there is a ring to draw", async () => {
    const drawn = renderWithProviders(
      <DonutChart series={SLICES} title={CHART_TITLE} footer={<p>Figures cover October.</p>} />,
    );
    await within(drawn.container).findByRole("img", { name: CHART_TITLE });
    expect(within(drawn.container).getByText("Figures cover October.")).toBeInTheDocument();

    const empty = renderWithProviders(
      <DonutChart series={[]} title={CHART_TITLE} footer={<p>Figures cover October.</p>} />,
    );
    await within(empty.container).findByRole("heading", {
      level: 4,
      name: EMPTY_STATES.dashboardRange.title,
    });
    expect(within(empty.container).getByText("Figures cover October.")).toBeInTheDocument();
  });
});
