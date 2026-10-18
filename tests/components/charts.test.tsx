/**
 * Path: tests/components/charts.test.tsx
 * Purpose: Scale mathematics, rendered geometry and the data-table alternative
 * Lines: 486
 */

import { describe, expect, it } from "vitest";

import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { LineChart } from "@/components/charts/LineChart";
// The subject is imported as a namespace, as pricingService.test.ts does: this file asserts well over a
// dozen of its exports, and naming them singly cost twenty-two lines of the budget.
import * as scales from "@/components/charts/chartScales";
import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { CHART_COLUMN_LABELS, EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import { formatMoney, formatMoneyCompact, formatShare } from "@/utils/format";

import { makeChartSeries } from "../fixtures";
import { renderWithProviders, screen, setupUser, within } from "../testUtils";

import type { ReactElement } from "react";

import type { ChartSeries } from "@/types/analytics";
import type { MinorUnits } from "@/types/common";

/*
 * Every figure is a whole number of minor units and every band a pinned date, so no case reads a clock, and
 * each series takes its colour from a token reference, so no colour literal reaches this file. The
 * mathematics is asserted first, as pure functions, because chartScales.ts is React-free: the renderer cases
 * that follow are therefore few and purposeful.
 */

const BAND_ONE = "2025-10-15";
const BAND_TWO = "2025-10-16";
const BAND_KEYS: readonly string[] = [BAND_ONE, BAND_TWO];
const DAY_ONE_LABEL = scales.defaultLabelFormatter(BAND_ONE);
const DAY_TWO_LABEL = scales.defaultLabelFormatter(BAND_TWO);
const CHART_TITLE = "Revenue by day";

const NET_ONE: MinorUnits = 45_990;
const NET_TWO: MinorUnits = 52_400;
const GROSS_ONE: MinorUnits = 20_000;
const GROSS_TWO: MinorUnits = 31_000;
const SERIES_TOTAL: MinorUnits = NET_ONE + NET_TWO + GROSS_ONE + GROSS_TWO;

/** A point on a band: the value in minor units and no label, so the formatters name the band. */
function point(band: string, value: MinorUnits) {
  return { x: band, y: value };
}

/** The two money series every renderer case plots. */
const SERIES: readonly ChartSeries[] = [
  makeChartSeries({
    id: "net",
    label: "Net revenue",
    points: [point(BAND_ONE, NET_ONE), point(BAND_TWO, NET_TWO)],
  }),
  makeChartSeries({
    id: "gross",
    label: "Gross revenue",
    color: CHART_SERIES_TOKEN_REFERENCES[1],
    points: [point(BAND_ONE, GROSS_ONE), point(BAND_TWO, GROSS_TWO)],
  }),
];

/** A one-band series carrying a single known value, which is the shape the bar and donut cases need. */
function oneBandSeries(id: string, label: string, token: number, value: MinorUnits): ChartSeries {
  return makeChartSeries({
    id,
    label,
    color: CHART_SERIES_TOKEN_REFERENCES[token],
    points: [point(BAND_ONE, value)],
  });
}

/** A ring of three known slices — 100 + 300 + 1 minor units — that the case reads as one whole. */
const SLICE_A = oneBandSeries("slice-a", "First slice", 2, 100);
const SLICE_B = oneBandSeries("slice-b", "Second slice", 3, 300);
const SLICE_C = oneBandSeries("slice-c", "Sliver", 4, 1);
const SLICE_TOTAL: MinorUnits = 401;

/** The one drawing a chart rendered, or a failure naming the absence rather than a null dereference. */
function drawingOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("the chart rendered no drawing");
  return svg;
}

/** The bars a bar chart drew: their pointer regions carry `data-band`, the bars themselves do not. */
function barsOf(container: HTMLElement): SVGRectElement[] {
  return [...container.querySelectorAll("rect")].filter((rect) => !rect.hasAttribute("data-band"));
}

/** Every word the drawing's text nodes hold, which is how a value label or a slice label is read. */
function labelsOf(svg: SVGSVGElement): (string | null)[] {
  return [...svg.querySelectorAll("text")].map((node) => node.textContent);
}

/** A rect side as a number, so two marks can be compared by the geometry they were drawn with. */
function sideOf(rect: SVGRectElement, name: "x" | "y" | "width" | "height"): number {
  return Number(rect.getAttribute(name));
}

/**
 * Renders a chart with nothing to plot and asserts the shared no-data state replaces the figure.
 *
 * The state's heading level is asserted with it: a chart that renders its own heading above the state nests
 * it one level under that heading, and one that renders none takes the level its own heading would have
 * taken, so a page's outline never skips a level.
 *
 * @param element - The chart to render, with nothing to plot.
 * @param level - The level the no-data heading must carry.
 */
async function expectNoData(element: ReactElement, level: number = 3): Promise<void> {
  const { container } = renderWithProviders(element);
  const heading = await within(container).findByRole("heading", {
    level,
    name: EMPTY_STATES.dashboardRange.title,
  });
  expect(heading).toBeInTheDocument();
  expect(container.querySelector("svg")).toBeNull();
  expect(within(container).queryByRole("table")).toBeNull();
}

describe("the chart scales", () => {
  it("maps a linear domain onto its range and clamps a value outside it", () => {
    const scale = scales.createLinearScale({ domain: [0, 100], range: [0, 200] });
    const clamped = scales.createLinearScale({ domain: [0, 100], range: [0, 200], clamp: true });
    expect([scale.scale(0), scale.scale(50), scale.scale(100), scale.scale(150)]).toEqual([
      0, 100, 200, 300,
    ]);
    expect(scale.invert(100)).toBe(50);
    expect([clamped.scale(150), clamped.scale(-50)]).toEqual([200, 0]);
  });

  it("gives every band key its own position and a uniform bandwidth", () => {
    const band = scales.createBandScale({
      domain: [BAND_ONE, BAND_TWO, BAND_ONE],
      range: [0, 300],
    });
    const first = band.scale(BAND_ONE);
    const second = band.scale(BAND_TWO);
    expect(band.domain).toEqual(BAND_KEYS);
    expect(second).toBeGreaterThan(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(band.bandwidth).toBeGreaterThan(0);
    expect(band.bandwidth).toBeLessThan(band.step);
    expect(second + band.bandwidth).toBeLessThanOrEqual(300);
  });

  it("widens a domain to human bounds and keeps money on whole minor units", () => {
    const bounds = scales.niceMoneyDomain(0, NET_ONE);
    expect(scales.niceDomain(0, 7)).toEqual([0, 8]);
    expect(bounds).toEqual([0, 50_000]);
    expect(bounds.every((bound) => Number.isInteger(bound))).toBe(true);
    expect(bounds[1]).toBeGreaterThanOrEqual(NET_ONE);
  });

  it("generates ascending, evenly spaced ticks and writes each through its formatter", () => {
    const ticks = scales.linearTicks(0, 100, 5);
    const scale = scales.createLinearScale({ domain: [0, 20_000], range: [200, 0], nice: true });
    const marks = scales.buildValueTicks(scale, formatMoneyCompact);
    const bands = scales.buildBandTicks(
      scales.createBandScale({ domain: BAND_KEYS, range: [0, 100] }),
    );
    const gaps = new Set(ticks.slice(1).map((value, index) => value - ticks[index]));
    expect(Math.abs(ticks.length - 5)).toBeLessThanOrEqual(2);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);
    expect(gaps.size).toBe(1);
    expect(marks.map((mark) => mark.label)).toEqual(
      marks.map((mark) => formatMoneyCompact(mark.value)),
    );
    expect(marks.every((mark) => mark.position === scale.scale(mark.value))).toBe(true);
    expect(bands.map((tick) => tick.label)).toEqual(BAND_KEYS.map(scales.defaultLabelFormatter));
  });

  it("draws a line with one segment per point and closes an area on its baseline", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 10 },
    ];
    const line = scales.buildLinePath(points);
    const area = scales.buildAreaPath(points, 100);
    expect(line).toBe("M0,0L10,5L20,10");
    expect(line.match(/L/g) ?? []).toHaveLength(points.length - 1);
    expect(area).toBe("M0,0L10,5L20,10L20,100L0,100Z");
    expect(area.endsWith("Z")).toBe(true);
    expect(scales.buildLinePath([])).toBe("");
  });

  it("emits an arc whose large-arc flag follows the fraction drawn", () => {
    const ring = { cx: 0, cy: 0, outerRadius: 100, innerRadius: 50 };
    const quarter = scales.arcPath({ ...ring, startAngle: 0, endAngle: 90 });
    expect(quarter).toContain("A100,100 0 0,1 ");
    expect(quarter.endsWith("Z")).toBe(true);
    expect(scales.arcPath({ ...ring, startAngle: 0, endAngle: 270 })).toContain("A100,100 0 1,1 ");
  });

  it("anchors the axis labels and the grid lines on the ticks they belong to", () => {
    const area = scales.computePlotArea({ width: 720, height: 280 });
    expect(area).toEqual({ x: 56, y: 16, width: 640, height: 232 });
    const label = scales.axisLabelTransform("vertical", "value", area, 42);
    expect(label).toEqual({ x: 48, y: 42, textAnchor: "end", dominantBaseline: "middle" });
    expect(scales.gridLineFor("vertical", area, 42)).toEqual({ x1: 56, y1: 42, x2: 696, y2: 42 });
    expect(scales.gridLineFor("horizontal", area, 42)).toEqual({ x1: 42, y1: 16, x2: 42, y2: 248 });
  });

  it("collects band keys in first-seen order and stacks each band's values", () => {
    expect(scales.collectBandKeys([SERIES[1], SERIES[0]])).toEqual(BAND_KEYS);
    expect(scales.stackValues(SERIES, BAND_ONE)).toEqual([NET_ONE, NET_ONE + GROSS_ONE]);
    expect(scales.stackValues(SERIES, BAND_TWO)).toEqual([NET_TWO, NET_TWO + GROSS_TWO]);
  });

  it("lays grouped bars side by side and stacks them to the cumulative total", () => {
    const bandScale = scales.createBandScale({ domain: [BAND_ONE], range: [0, 100] });
    const valueScale = scales.createLinearScale({ domain: [0, 400], range: [400, 0] });
    const plotArea = { x: 0, y: 0, width: 100, height: 400 };
    const bars = {
      series: [SLICE_A, SLICE_B],
      bandScale,
      valueScale,
      plotArea,
      orientation: "vertical" as const,
    };
    const grouped = scales.buildBarRects({ ...bars, mode: "grouped" });
    const stacked = scales.buildBarRects({ ...bars, mode: "stacked" });
    expect(grouped).toHaveLength(2);
    expect(grouped.map((rect) => rect.height)).toEqual([100, 300]);
    expect(grouped[0].x + grouped[0].width).toBeLessThanOrEqual(grouped[1].x);
    expect(stacked).toHaveLength(2);
    expect(stacked.map((rect) => rect.height)).toEqual([100, 300]);
    expect(stacked[0].y).toBe(300);
    expect(stacked[1].y + stacked[1].height).toBe(stacked[0].y);
  });

  it("splits the ring into slices whose shares match the series and close the turn", () => {
    const arcs = scales.buildDonutArcs({
      series: [SLICE_A, SLICE_B],
      cx: 0,
      cy: 0,
      outerRadius: 100,
      innerRadius: 60,
      formatValue: formatMoney,
    });
    expect(arcs).toHaveLength(2);
    expect(arcs.map((arc) => arc.share)).toEqual([0.25, 0.75]);
    expect(arcs[0].share + arcs[1].share).toBeCloseTo(1, 9);
    expect(arcs.map((arc) => arc.midAngle)).toEqual([45, 225]);
    expect(arcs[1].formattedValue).toBe(formatMoney(300));
    expect(arcs[1].path.startsWith("M") && arcs[1].path.endsWith("Z")).toBe(true);
  });

  it("knows when there is nothing to plot and totals what there is", () => {
    expect(scales.hasChartData([])).toBe(false);
    expect(scales.hasChartData([makeChartSeries({ points: [] })])).toBe(false);
    expect(scales.hasChartData(SERIES)).toBe(true);
    // A period of zeros sold nothing rather than carrying no figure, so the shared predicate reads it as
    // data; the ring is where an all-zero breakdown has no slice to draw and shows the no-data state.
    expect(scales.hasChartData([oneBandSeries("zero", "Nothing sold", 0, 0)])).toBe(true);
    expect([scales.chartSeriesTotal(SERIES), scales.chartSeriesTotal([])]).toEqual([
      SERIES_TOTAL,
      0,
    ]);
  });

  it("maps each series token reference to one stable, distinct class name", () => {
    const names = CHART_SERIES_TOKEN_REFERENCES.map((reference, index) =>
      scales.seriesClassName(reference, index),
    );
    const first = names[0];
    const last = names[scales.SERIES_COUNT - 1];
    expect(new Set(names).size).toBe(CHART_SERIES_TOKEN_REFERENCES.length);
    expect(scales.seriesClassName(CHART_SERIES_TOKEN_REFERENCES[0], 5)).toBe(first);
    expect(scales.seriesClassName(undefined, 0)).toBe(first);
    expect(scales.seriesClassName(undefined, scales.SERIES_COUNT + 3)).toBe(last);
  });
});

describe("the chart renderers", () => {
  it("draws a line per series, a legend and the paired data table", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} />);
    const svg = drawingOf(container);

    expect(await screen.findByRole("img", { name: CHART_TITLE })).toBeInTheDocument();
    expect(svg.querySelectorAll("g")).toHaveLength(SERIES.length);
    expect(svg.querySelectorAll("path")).toHaveLength(SERIES.length);
    expect(svg.querySelectorAll("circle")).toHaveLength(SERIES.length * BAND_KEYS.length);
    expect(svg.querySelectorAll("rect")).toHaveLength(BAND_KEYS.length);

    const table = screen.getByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(BAND_KEYS.length + 1);
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent(DAY_ONE_LABEL);
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([formatMoney(NET_ONE), formatMoney(GROSS_ONE)]);

    const legend = screen.getAllByRole("listitem");
    expect(legend).toHaveLength(SERIES.length);
    expect(within(legend[0]).getByText("Net revenue")).toBeInTheDocument();
    expect(legend[0]).toHaveTextContent(formatMoney(NET_TWO));

    await user.tab();
    const bandOne = screen.getByRole("status").textContent;
    expect(bandOne).toBe(
      `${DAY_ONE_LABEL} · Net revenue ${formatMoney(NET_ONE)} · Gross revenue ${formatMoney(GROSS_ONE)}`,
    );
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent(DAY_TWO_LABEL);
    await user.hover(svg.querySelectorAll("rect")[0]);
    expect(screen.getByRole("status").textContent).toBe(bandOne);
  });

  it("draws grouped bars, their value labels, a legend and the paired data table", async () => {
    const { container } = renderWithProviders(<BarChart series={SERIES} title={CHART_TITLE} />);
    const svg = drawingOf(container);
    const bars = barsOf(container);

    expect(await screen.findByRole("img", { name: CHART_TITLE })).toBeInTheDocument();
    expect(svg.querySelectorAll("rect[data-band]")).toHaveLength(BAND_KEYS.length);
    expect(bars).toHaveLength(BAND_KEYS.length * SERIES.length);
    expect(sideOf(bars[0], "x") + sideOf(bars[0], "width")).toBeLessThanOrEqual(
      sideOf(bars[1], "x"),
    );
    expect(labelsOf(svg)).toEqual(
      expect.arrayContaining([
        formatMoney(NET_ONE),
        formatMoney(NET_TWO),
        formatMoney(GROSS_ONE),
        formatMoney(GROSS_TWO),
      ]),
    );

    const table = screen.getByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
    expect(within(table).getAllByRole("row")).toHaveLength(BAND_KEYS.length + 1);
    // The column the band names sit in is headed too, so no figure in the alternative is unlabelled.
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent(
      CHART_COLUMN_LABELS.GROUP_LABEL,
    );
    expect(within(table).getByRole("columnheader", { name: "Gross revenue" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(formatMoney(NET_ONE + NET_TWO));
  });

  // A caller that charts per-band counts which must not be added together — a report's returning-customer
  // column, say — names the series in `legendTotals` and its legend entry then states no figure, while a
  // series the record does not suppress keeps the total the chart reads from its own points. Suppression
  // reaches the legend alone: the entry still names its series, and the paired table still carries every
  // band's figure, so the figure is neither lost nor contradicted.
  it("states no total for the series `legendTotals` suppresses, and totals the rest", async () => {
    const { container } = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} legendTotals={{ net: true, gross: false }} />,
    );
    expect(await screen.findByRole("img", { name: CHART_TITLE })).toBeInTheDocument();

    const legend = screen.getAllByRole("listitem");
    expect(legend).toHaveLength(SERIES.length);
    expect(legend[0]).toHaveTextContent(formatMoney(NET_ONE + NET_TWO));

    // The suppressed series is still named and its swatch still drawn, so the bars stay tellable apart; it
    // is the value alone that is absent, which is what `textContent` holds the entry to.
    expect(legend[1]).toHaveTextContent("Gross revenue");
    expect(legend[1]).not.toHaveTextContent(formatMoney(GROSS_ONE + GROSS_TWO));
    expect(legend[1].textContent).toBe("Gross revenue");

    const table = screen.getByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
    expect(within(table).getAllByRole("row")).toHaveLength(BAND_KEYS.length + 1);
    expect(table).toHaveTextContent(formatMoney(GROSS_ONE));
    expect(table).toHaveTextContent(formatMoney(GROSS_TWO));
    // Nothing the chart draws moved for the suppressed series: its bars and their value labels are its own.
    expect(barsOf(container)).toHaveLength(BAND_KEYS.length * SERIES.length);
    expect(labelsOf(drawingOf(container))).toEqual(
      expect.arrayContaining([formatMoney(GROSS_ONE), formatMoney(GROSS_TWO)]),
    );
  });

  it("draws horizontal bars and a stack's geometry beside the figures it keeps off the marks", async () => {
    const horizontal = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} orientation="horizontal" />,
    );
    await within(horizontal.container).findByRole("img", { name: CHART_TITLE });
    const across = barsOf(horizontal.container);
    expect(across).toHaveLength(BAND_KEYS.length * SERIES.length);
    expect(labelsOf(drawingOf(horizontal.container))).toEqual(
      expect.arrayContaining([formatMoney(NET_ONE), formatMoney(GROSS_TWO)]),
    );
    // A bar's extent is its figure, so the band's larger figure draws the longer bar.
    expect(sideOf(across[0], "width")).toBeGreaterThan(sideOf(across[1], "width"));

    const stacked = renderWithProviders(
      <BarChart series={SERIES} title={CHART_TITLE} mode="stacked" />,
    );
    await within(stacked.container).findByRole("img", { name: CHART_TITLE });
    const segments = barsOf(stacked.container);
    expect(segments).toHaveLength(BAND_KEYS.length * SERIES.length);
    expect(sideOf(segments[1], "y") + sideOf(segments[1], "height")).toBeCloseTo(
      sideOf(segments[0], "y"),
      5,
    );
    // A stack labels no segment: a segment's outer end is the neighbouring segment's fill, so the figures
    // stay in the readout, the legend and the paired table, which the last assertion holds it to.
    expect(labelsOf(drawingOf(stacked.container))).not.toContain(formatMoney(NET_ONE));
    expect(
      within(stacked.container).getByRole("table", { name: chartDataTableCaption(CHART_TITLE) }),
    ).toHaveTextContent(formatMoney(NET_ONE));
  });

  it("splits the ring, labels every wedge and carries every figure in its table", async () => {
    const user = setupUser();
    const slices = [SLICE_A, SLICE_B, SLICE_C];
    const { container } = renderWithProviders(<DonutChart series={slices} title={CHART_TITLE} />);
    const svg = drawingOf(container);

    expect(await screen.findByRole("img", { name: CHART_TITLE })).toBeInTheDocument();
    expect(svg.querySelectorAll("path")).toHaveLength(slices.length);
    // Every wedge is labelled: the two roomy ones carry their whole-percent share inside the ring, and the
    // sliver — whose share is below the slice-label minimum — carries its one-decimal share outside it, on the
    // one leader line its mark reserved. Nothing is dropped for want of room.
    expect(labelsOf(svg)).toEqual([
      formatShare(100, SLICE_TOTAL, 0),
      formatShare(300, SLICE_TOTAL, 0),
      formatShare(1, SLICE_TOTAL, 1),
    ]);
    expect(svg.querySelectorAll("line.sp-chart__leader")).toHaveLength(1);
    expect(screen.getByText(formatMoneyCompact(SLICE_TOTAL))).toBeInTheDocument();

    const table = screen.getByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(slices.length + 1);
    // The header row names all three columns, so neither figure a row states is left unlabelled.
    expect(
      within(rows[0])
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      CHART_COLUMN_LABELS.GROUP_LABEL,
      CHART_COLUMN_LABELS.VALUE_LABEL,
      CHART_COLUMN_LABELS.SHARE_LABEL,
    ]);
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent(SLICE_A.label);
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([formatMoney(100), formatShare(100, SLICE_TOTAL, 1)]);

    // The marker-less flex legend keeps its list semantics, which the base sheet documents the role for.
    expect(container.querySelector("ul.sp-chart__legend")).toHaveAttribute("role", "list");
    const legend = screen.getAllByRole("listitem");
    expect(legend[2]).toHaveTextContent(formatMoney(1));
    expect(legend[2]).toHaveTextContent(formatShare(1, SLICE_TOTAL, 1));

    await user.tab();
    expect(screen.getByRole("status")).toHaveTextContent(
      `${SLICE_A.label} ${formatMoney(100)} ${formatShare(100, SLICE_TOTAL, 1)}`,
    );
  });

  it.each<[string, (word: string) => ReactElement]>([
    ["bar chart", (word) => <BarChart series={SERIES} title={CHART_TITLE} labelHeader={word} />],
    ["donut", (word) => <DonutChart series={[SLICE_A]} title={CHART_TITLE} labelHeader={word} />],
  ])(
    "takes a caller's own word for the %s paired table's leading column",
    async (_chart, build) => {
      const leadingHeader = "Product";
      renderWithProviders(build(leadingHeader));

      const table = await screen.findByRole("table", { name: chartDataTableCaption(CHART_TITLE) });
      expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent(leadingHeader);
    },
  );

  it("shows its no-data state instead of drawing an empty figure", async () => {
    await expectNoData(<LineChart series={[]} />);
    await expectNoData(<BarChart series={[]} />);
    await expectNoData(<DonutChart series={[]} />);
    await expectNoData(<DonutChart series={[oneBandSeries("zero", "Nothing sold", 0, 0)]} />);
    // A chart that renders its own heading nests the state one level under it instead of skipping to h4.
    await expectNoData(<DonutChart series={[]} title={CHART_TITLE} />, 4);
  });
});
