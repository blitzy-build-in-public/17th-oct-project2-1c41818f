/**
 * Path: tests/components/barChart.test.tsx
 * Purpose: The bar renderer's own depth: its pointer and keyboard readout, its chrome and nameless caption, its value labels at their thresholds and its geometry at its own edges
 * Lines: 557
 */

import { describe, expect, it } from "vitest";

import { BarChart } from "@/components/charts/BarChart";
import { buildGeometry, readoutStyle, resolveHeight } from "@/components/charts/barGeometry";
import type { BarGeometry, BarGeometryOptions } from "@/components/charts/barGeometry";
import { readoutPlacement } from "@/components/charts/readoutPlacement";
import {
  CHART_VIEWBOX_WIDTH,
  DEFAULT_CHART_HEIGHT,
  defaultLabelFormatter,
} from "@/components/charts/chartScales";
import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import { addDays } from "@/utils/dates";
import { formatMoney, formatMoneyAxis } from "@/utils/format";

import { makeChartSeries } from "../fixtures";
import { renderWithProviders, screen, setupUser, within } from "../testUtils";

import type { Orientation } from "@/components/charts/chartScales";
import type { ChartSeries } from "@/types/analytics";
import type { MinorUnits } from "@/types/common";

/*
 * What this file covers that `charts.test.tsx` does not. That suite draws each renderer once and reads its
 * marks and its paired table; the depth left over is the bar renderer's interaction — the pointer and the
 * arrow keys walking the bands, the readout's words and its placement — the wording slots a caller fills
 * (the chrome, the empty state, the chart with no name of its own), and the two readings that switch a mark
 * off: a bar too thin or too short to carry its value label, and an axis the caller widened away from zero.
 * `barGeometry.ts` is asserted here too, as the pure functions it publishes, in the shapes a renderer's own
 * props reach only through a whole frame.
 *
 * Every figure is a pinned whole number of minor units and every band a pinned date, so no case reads a
 * clock; every series takes its colour from a token reference, so no colour literal reaches this file. The
 * assertions read what a visitor or an assistive technology reads: the readout's sentence, the words a text
 * mark shows, the anchor a value label is written with, the captions a landmark takes its name from, and the
 * `viewBox` the frame is drawn at. Nothing asserts a class the stylesheet owns beyond locating a mark with
 * it.
 */

// Test data --------------------------------------------------------------------------------------

const CHART_TITLE = "Revenue by day";
const DAY_ONE = "2025-10-15";
const DAY_TWO = "2025-10-16";

const NET_ONE: MinorUnits = 45_990;
const NET_TWO: MinorUnits = 52_400;
const GROSS_ONE: MinorUnits = 20_000;
const GROSS_TWO: MinorUnits = 31_000;
/** One band the chart lost money in, so the baseline has a bar hanging below it. */
const LOSS_TWO: MinorUnits = -12_000;

/** The band keys as the axis writes them, which is the wording the readout opens with. */
const DAY_ONE_LABEL = defaultLabelFormatter(DAY_ONE);
const DAY_TWO_LABEL = defaultLabelFormatter(DAY_TWO);

/** The two money series every renderer case plots. */
function point(x: string, y: number) {
  return { x, y };
}

const SERIES: readonly ChartSeries[] = [
  makeChartSeries({
    id: "net",
    label: "Net revenue",
    points: [point(DAY_ONE, NET_ONE), point(DAY_TWO, NET_TWO)],
  }),
  makeChartSeries({
    id: "gross",
    label: "Gross revenue",
    color: CHART_SERIES_TOKEN_REFERENCES[1],
    points: [point(DAY_ONE, GROSS_ONE), point(DAY_TWO, GROSS_TWO)],
  }),
];

/** The one series whose second band is a loss, which is the shape the under-baseline cases are drawn with. */
const LOSSY: ChartSeries = makeChartSeries({
  id: "net",
  label: "Net revenue",
  points: [point(DAY_ONE, NET_ONE), point(DAY_TWO, LOSS_TWO)],
});

/** The bands a chart too narrow to label its bars is drawn over: one more than the axis may label at once. */
const MANY_BANDS: readonly string[] = Array.from({ length: 40 }, (_unused, index) =>
  addDays(DAY_ONE, index),
);

/** The `buildGeometry` options a case varies one field of. */
function geometryOptions(overrides: Partial<BarGeometryOptions> = {}): BarGeometryOptions {
  return {
    series: SERIES,
    height: DEFAULT_CHART_HEIGHT,
    orientation: "vertical",
    mode: "grouped",
    includeZero: true,
    showValues: true,
    formatValue: formatMoney,
    formatAxisValue: formatMoneyAxis,
    formatLabel: defaultLabelFormatter,
    ...overrides,
  };
}

/** The words the label of one named text mark reads, which is how a value label or an axis tick is found. */
function textMarksOf(container: HTMLElement, className: string, name: string): SVGTextElement[] {
  return [...container.querySelectorAll<SVGTextElement>(`text.${className}`)].filter(
    (node) => node.textContent === name,
  );
}

/** The words the drawing's own value labels show, in the order they are drawn. */
function valueLabelsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll<SVGTextElement>("text.sp-chart__label")].map(
    (node) => node.textContent ?? "",
  );
}

/**
 * The value axis' own ticks. A value tick is anchored at its end and a band tick at its middle, so the two
 * axes of one bar chart are told apart by the anchor rather than by their order in the markup.
 */
function valueAxisLabelsOf(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<SVGTextElement>('text.sp-chart__tick[text-anchor="end"]'),
  ].map((node) => node.textContent ?? "");
}

/** The readout's one sentence, or a failure naming the absence rather than a null dereference. */
function readoutOf(container: HTMLElement): string {
  return readoutElementOf(container).textContent ?? "";
}

/** The readout's own element, so a case reads the box the placement is published on. */
function readoutElementOf(container: HTMLElement): HTMLElement {
  const status = container.querySelector<HTMLElement>('[role="status"]');
  if (status === null) throw new Error("the chart rendered no readout");
  return status;
}

/** The pointer regions a drawing publishes, or a failure in place of an empty hover. */
function hitRegionsOf(container: HTMLElement): HTMLElement[] {
  const regions = [...container.querySelectorAll<HTMLElement>("rect.sp-chart__hit")];
  if (regions.length === 0) throw new Error("the chart drew no band pointer region");
  return regions;
}

// Cases ------------------------------------------------------------------------------------------

describe("the bar renderer's readout", () => {
  it("reports the band the pointer is over and clears the readout when it leaves", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<BarChart series={SERIES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    // A pointer names its band through the region it entered, so the gaps between grouped bars and the
    // space above a short bar clear nothing.
    const regions = hitRegionsOf(container);
    expect(regions).toHaveLength(2);
    await user.hover(regions[0]);
    expect(readoutOf(container)).toBe(
      `${DAY_ONE_LABEL} · Net revenue ${formatMoney(NET_ONE)} · Gross revenue ${formatMoney(GROSS_ONE)}`,
    );

    // The readout's placement is the box's own style, published for the stylesheet to clamp by.
    expect(readoutElementOf(container).getAttribute("style")).toContain("--sp-chart-readout-x");

    await user.hover(regions[1]);
    expect(readoutOf(container)).toBe(
      `${DAY_TWO_LABEL} · Net revenue ${formatMoney(NET_TWO)} · Gross revenue ${formatMoney(GROSS_TWO)}`,
    );

    // Leaving the band it named takes the readout off the plot entirely, rather than leaving the last
    // sentence standing over a band the pointer is no longer on.
    await user.unhover(regions[1]);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("walks the bands with the arrow keys and holds the readout at either end", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<BarChart series={SERIES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    // A band the pointer already named keeps the readout where it is when the plot takes focus.
    await user.hover(hitRegionsOf(container)[0]);
    await user.tab();
    expect(readoutOf(container)).toContain(DAY_ONE_LABEL);

    await user.keyboard("{ArrowRight}");
    expect(readoutOf(container)).toContain(DAY_TWO_LABEL);
    // The last band is the edge: a further step forward stays on it rather than past it.
    await user.keyboard("{ArrowRight}");
    expect(readoutOf(container)).toContain(DAY_TWO_LABEL);

    await user.keyboard("{ArrowLeft}");
    expect(readoutOf(container)).toContain(DAY_ONE_LABEL);
    await user.keyboard("{ArrowUp}");
    expect(readoutOf(container)).toContain(DAY_ONE_LABEL);
    await user.keyboard("{ArrowDown}");
    expect(readoutOf(container)).toContain(DAY_TWO_LABEL);

    // Home and End are the two ends themselves, and a step past either of them holds.
    await user.keyboard("{Home}");
    expect(readoutOf(container)).toContain(DAY_ONE_LABEL);
    await user.keyboard("{End}");
    expect(readoutOf(container)).toContain(DAY_TWO_LABEL);
    await user.keyboard("{ArrowDown}");
    expect(readoutOf(container)).toContain(DAY_TWO_LABEL);

    // A key the plot does not act on leaves the readout exactly where it stands.
    const held = readoutOf(container);
    await user.keyboard("x");
    expect(readoutOf(container)).toBe(held);

    // Tabbing on takes focus off the plot, which puts the readout away with it.
    await user.tab();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps the readout inside the plot however long its sentence is", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<BarChart series={SERIES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    await user.hover(hitRegionsOf(container)[0]);
    const style = readoutElementOf(container).style;
    const percentOf = (name: string): number => Number.parseFloat(style.getPropertyValue(name));
    // The box is bounded by the plot area, which is inside the drawing, and the width it reserves is
    // measured from the sentence it holds rather than left to the browser.
    expect(percentOf("--sp-chart-readout-x")).toBeGreaterThanOrEqual(0);
    expect(percentOf("--sp-chart-readout-x")).toBeLessThanOrEqual(100);
    expect(percentOf("--sp-chart-readout-y")).toBeGreaterThanOrEqual(0);
    expect(percentOf("--sp-chart-readout-y")).toBeLessThanOrEqual(100);
    expect(style.getPropertyValue("--sp-chart-readout-w")).toMatch(
      /^calc\(\d+ch \+ 2 \* var\(--space-3\)\)$/,
    );
    expect(["-50%", "-100%", "0px"]).toContain(style.getPropertyValue("--sp-chart-readout-flip"));
  });
});

describe("the bar renderer's chrome and its wording slots", () => {
  it("draws the heading, the supporting line, the controls and the footer", async () => {
    renderWithProviders(
      <BarChart
        series={SERIES}
        title={CHART_TITLE}
        description="Last seven days"
        actions={<button type="button">Group by week</button>}
        footer={<p>Figures exclude tax.</p>}
      />,
    );

    expect(await screen.findByRole("heading", { level: 3, name: CHART_TITLE })).toBeInTheDocument();
    expect(screen.getByText("Last seven days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group by week" })).toBeInTheDocument();
    expect(screen.getByText("Figures exclude tax.")).toBeInTheDocument();
    // The chart's own landmark takes the visible heading as its name, so the drawing sits in the page's
    // outline under a heading a visitor can see.
    expect(screen.getByRole("region", { name: CHART_TITLE })).toBeInTheDocument();
  });

  it("names the drawing with the caller's label where a caller gives one", async () => {
    const { container } = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} ariaLabel="Revenue, last seven days" />,
    );

    expect(
      await screen.findByRole("img", { name: "Revenue, last seven days" }),
    ).toBeInTheDocument();
    // The label names the graphic; the heading still names the block and its landmark, and the paired
    // table below — and the region it scrolls in — take the same words, so the alternative to the drawing
    // is named by what names the drawing.
    expect(screen.getByRole("heading", { level: 3, name: CHART_TITLE })).toBeInTheDocument();
    const caption = chartDataTableCaption("Revenue, last seven days");
    expect(within(container).getByRole("table", { name: caption })).toBeInTheDocument();
    expect(within(container).getByRole("region", { name: caption })).toBeInTheDocument();
  });

  it("names a chart given no wording at all by the series it draws", async () => {
    const drawn = SERIES.map((one) => one.label).join(", ");
    const { container } = renderWithProviders(<BarChart series={SERIES} />);
    await screen.findByRole("img");

    // Nothing is invented in the renderer for a chart a caller left unnamed: the drawing states no name of
    // its own, the block takes none from a heading, and the paired table's caption — and the region it
    // scrolls in — say what the figures are, which is the series drawn.
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBeNull();
    expect(container.querySelector("section")?.getAttribute("aria-labelledby")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    const caption = chartDataTableCaption(drawn);
    expect(container.querySelector("svg")?.getAttribute("aria-describedby")).not.toBeNull();

    expect(screen.getByRole("table", { name: caption })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: caption })).toBeInTheDocument();
  });

  it("shows a caller's own wording where a period sold nothing", async () => {
    renderWithProviders(<BarChart series={[]} emptyMessage="No orders in this range" />);

    const heading = await screen.findByRole("heading", {
      level: 3,
      name: "No orders in this range",
    });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATES.dashboardRange.description)).toBeInTheDocument();
  });

  it("draws the legend for a chart of several series and for no other", async () => {
    const several = renderWithProviders(<BarChart series={SERIES} title={CHART_TITLE} />);
    await within(several.container).findByRole("img", { name: CHART_TITLE });
    expect(within(several.container).getAllByRole("listitem")).toHaveLength(SERIES.length);

    // One series is named by the chart's own heading and its one axis, so no legend repeats it.
    const single = renderWithProviders(<BarChart series={[SERIES[0]]} title={CHART_TITLE} />);
    await within(single.container).findByRole("img", { name: CHART_TITLE });
    expect(within(single.container).queryByRole("list")).toBeNull();

    const suppressed = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} showLegend={false} />,
    );
    await within(suppressed.container).findByRole("img", { name: CHART_TITLE });
    expect(within(suppressed.container).queryByRole("list")).toBeNull();
  });
});

describe("the bar renderer's value labels", () => {
  it("writes no figure beside the bars when the caller suppresses them", async () => {
    const { container } = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} showValues={false} />,
    );
    await screen.findByRole("img", { name: CHART_TITLE });

    expect(valueLabelsOf(container)).toEqual([]);
    // Suppressing the label takes nothing out of the chart: the same figure stays in the paired table and
    // in the readout, which is where a visitor who cannot see the bars reads it.
    const table = screen.getByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
    expect(within(table).getByRole("cell", { name: formatMoney(NET_ONE) })).toBeInTheDocument();
  });

  it("writes no figure on a bar with no extent to write it past", async () => {
    const flat = makeChartSeries({
      id: "net",
      label: "Net revenue",
      points: [point(DAY_ONE, NET_ONE), point(DAY_TWO, 0)],
    });
    const { container } = renderWithProviders(<BarChart series={[flat]} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    // The band that sold nothing keeps its bar at the baseline, where there is no outer end to hang a
    // figure off, so only the band that sold something is labelled.
    expect(valueLabelsOf(container)).toEqual([formatMoney(NET_ONE)]);
  });

  it("leaves the figures off bars too thin to carry them", async () => {
    const many = makeChartSeries({
      id: "net",
      label: "Net revenue",
      points: MANY_BANDS.map((band) => point(band, NET_ONE)),
    });
    const { container } = renderWithProviders(<BarChart series={[many]} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    // Forty bands share the plot, so no bar is wide enough for a money figure drawn across it and every
    // label is dropped rather than written over the bar beside it.
    expect(valueLabelsOf(container)).toEqual([]);
    const table = screen.getByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
    expect(
      within(table).getAllByRole("cell", { name: formatMoney(NET_ONE) }).length,
    ).toBeGreaterThan(0);
  });

  it.each<[string, Orientation, string, string]>([
    ["upright", "vertical", "middle", "hanging"],
    ["sideways", "horizontal", "end", "middle"],
  ])(
    "writes a loss %s under the baseline, clear of the bar it names",
    async (_case, orientation, anchor, dominantBaseline) => {
      const { container } = renderWithProviders(
        <BarChart series={[LOSSY]} title={CHART_TITLE} orientation={orientation} />,
      );
      await screen.findByRole("img", { name: CHART_TITLE });

      const loss = textMarksOf(container, "sp-chart__label", formatMoney(LOSS_TWO));
      expect(loss.map((mark) => mark.textContent)).toEqual([formatMoney(LOSS_TWO)]);
      // The label sits past the end the bar reaches away from the baseline, so it is anchored at its
      // matching side rather than centred on the bar it would otherwise cover.
      expect(loss[0]?.getAttribute("text-anchor")).toBe(anchor);
      expect(loss[0]?.getAttribute("dominant-baseline")).toBe(dominantBaseline);
      // The band's figure is what the readout reports too, sign and all.
      expect(
        within(container).getByRole("table", { name: chartDataTableCaption(CHART_TITLE) }),
      ).toHaveTextContent(formatMoney(LOSS_TWO));
    },
  );
});

describe("the bar renderer's value axis", () => {
  it("carries zero by default and drops it where the caller asks for the zoom", async () => {
    const carried = renderWithProviders(<BarChart series={SERIES} title={CHART_TITLE} />);
    await within(carried.container).findByRole("img", { name: CHART_TITLE });
    // An axis starting above zero makes a rise of a fifth look like a rise from nothing.
    expect(valueAxisLabelsOf(carried.container)).toContain(formatMoney(0));

    const zoomed = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} includeZero={false} />,
    );
    await within(zoomed.container).findByRole("img", { name: CHART_TITLE });
    const labels = valueAxisLabelsOf(zoomed.container);
    expect(labels).not.toContain(formatMoney(0));
    expect(labels.length).toBeGreaterThan(1);
  });

  it.each<[string, number, number]>([
    ["the height a caller gives it", 360, 360],
    ["a height no frame can be drawn at", 0, DEFAULT_CHART_HEIGHT],
  ])("draws the frame at %s", async (_case, height, drawn) => {
    const { container } = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} height={height} />,
    );
    await screen.findByRole("img", { name: CHART_TITLE });

    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      `0 0 ${CHART_VIEWBOX_WIDTH} ${drawn}`,
    );
  });
});

describe("the bar geometry at its own edges", () => {
  it("anchors a readout at the band's centre across and its bars' outer end down", () => {
    const geometry = buildGeometry(geometryOptions());
    const centre = geometry.bandScale.scale(DAY_ONE) + geometry.bandScale.bandwidth / 2;
    const atCentre = readoutPlacement({
      anchorX: centre,
      anchorY: centre,
      plotArea: geometry.plotArea,
      width: CHART_VIEWBOX_WIDTH,
      height: DEFAULT_CHART_HEIGHT,
      characters: 12,
    });
    const upright = readoutStyle({
      geometry,
      bandKey: DAY_ONE,
      height: DEFAULT_CHART_HEIGHT,
      horizontal: false,
      characters: 12,
    });

    // Across the drawing the readout sits over the band's centre, and down it at the outer end of the
    // band's bars — pulled back by the room a value label takes, so it is nearer the plot's top than the
    // centre the bars are read against.
    expect(upright["--sp-chart-readout-x"]).toBe(atCentre["--sp-chart-readout-x"]);
    expect(Number.parseFloat(upright["--sp-chart-readout-y"])).toBeLessThan(
      Number.parseFloat(atCentre["--sp-chart-readout-y"]),
    );

    // A horizontal chart swaps the two: the readout follows the length of the bars across the frame and
    // keeps the band's centre down it, which is the placement the two halves publish between them.
    const ends = geometry.bars
      .filter((mark) => mark.bandKey === DAY_ONE)
      .map((mark) => mark.area.x + mark.area.width);
    const sideways = readoutStyle({
      geometry,
      bandKey: DAY_ONE,
      height: DEFAULT_CHART_HEIGHT,
      horizontal: true,
      characters: 12,
    });
    expect(sideways).toEqual(
      readoutPlacement({
        anchorX: Math.max(...ends),
        anchorY: centre,
        plotArea: geometry.plotArea,
        width: CHART_VIEWBOX_WIDTH,
        height: DEFAULT_CHART_HEIGHT,
        characters: 12,
      }),
    );
  });

  it("falls back to the band's own centre where the band was drawn as no bar", () => {
    const drawn = buildGeometry(geometryOptions());
    // The one shape the renderer's own props cannot reach: a geometry whose bars were all taken away, which
    // is what a band the chart drew nothing for looks like to this function.
    const barless: BarGeometry = { ...drawn, bars: [] };
    const centre = drawn.bandScale.scale(DAY_ONE) + drawn.bandScale.bandwidth / 2;
    const sideways = readoutStyle({
      geometry: barless,
      bandKey: DAY_ONE,
      height: DEFAULT_CHART_HEIGHT,
      horizontal: true,
      characters: 12,
    });

    expect(sideways).toEqual(
      readoutPlacement({
        anchorX: centre,
        anchorY: centre,
        plotArea: drawn.plotArea,
        width: CHART_VIEWBOX_WIDTH,
        height: DEFAULT_CHART_HEIGHT,
        characters: 12,
      }),
    );
    // A chart that drew no bar reads a lower anchor down the frame than one that did, which is what makes
    // the bars themselves the reading rather than a constant.
    expect(
      readoutStyle({
        geometry: barless,
        bandKey: DAY_ONE,
        height: DEFAULT_CHART_HEIGHT,
        horizontal: false,
        characters: 12,
      })["--sp-chart-readout-y"],
    ).not.toBe(
      readoutStyle({
        geometry: drawn,
        bandKey: DAY_ONE,
        height: DEFAULT_CHART_HEIGHT,
        horizontal: false,
        characters: 12,
      })["--sp-chart-readout-y"],
    );
  });

  it("spans the values themselves where the caller asks for the zoom, and zero otherwise", () => {
    const zoomed = buildGeometry(geometryOptions({ includeZero: false }));
    const carried = buildGeometry(geometryOptions({ includeZero: true }));

    expect(zoomed.valueScale.domain[0]).toBeGreaterThan(0);
    expect(carried.valueScale.domain[0]).toBeLessThanOrEqual(0);
    expect(carried.valueScale.domain[1]).toBeGreaterThanOrEqual(
      Math.max(NET_ONE, NET_TWO, GROSS_ONE, GROSS_TWO),
    );
  });

  it("answers the default frame height for a height no frame can be drawn at", () => {
    expect([
      resolveHeight(360),
      resolveHeight(0),
      resolveHeight(-10),
      resolveHeight(Number.NaN),
      resolveHeight(Number.POSITIVE_INFINITY),
    ]).toEqual([
      360,
      DEFAULT_CHART_HEIGHT,
      DEFAULT_CHART_HEIGHT,
      DEFAULT_CHART_HEIGHT,
      DEFAULT_CHART_HEIGHT,
    ]);
  });
});
