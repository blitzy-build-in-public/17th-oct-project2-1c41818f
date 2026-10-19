/**
 * Path: tests/components/lineChart.test.tsx
 * Purpose: The line renderer's own depth: the band walk and its readout, the markers' limit, the area's closure, the legend's wordless series and the plot model's degenerate inputs
 * Lines: 551
 */

import { describe, expect, it } from "vitest";

import { LineChart } from "@/components/charts/LineChart";
import { collectBandKeys, defaultLabelFormatter } from "@/components/charts/chartScales";
import { bandCentre, buildPlotModel, finiteValueAt } from "@/components/charts/lineChartModel";
import type { PlotModelOptions } from "@/components/charts/lineChartModel";
import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { APP_COPY, EMPTY_STATES, chartDataTableCaption } from "@/constants/content";
import { addDays } from "@/utils/dates";
import { formatMoney, formatMoneyAxis } from "@/utils/format";

import { makeChartSeries } from "../fixtures";
import { renderWithProviders, screen, setupUser, within } from "../testUtils";

import type { ChartSeries } from "@/types/analytics";
import type { MinorUnits } from "@/types/common";

/*
 * What this file covers that `charts.test.tsx` does not. That suite reads one line chart's series paths, its
 * legend totals and its paired table, and the axis notation of a large money figure; the depth left over is
 * the band walk the pointer and the arrow keys drive, the markers' own limit, the area's closure, the legend
 * entry of a series carrying no figure, the wording slots a caller fills, and the model's behaviour where a
 * band has no point at all — which is the sparse series a re-bucketed report hands a chart.
 *
 * `lineChartModel.ts` is asserted here as the pure functions it publishes, on the shapes a renderer's props
 * reach only through a whole drawing: a band a series does not carry, a series whose every point is not a
 * number, and a band list too long for the axis to label in full.
 *
 * Every figure is a pinned whole number of minor units and every band a pinned date, so no case reads a
 * clock, and each series takes its colour from a token reference. The assertions read what a visitor or an
 * assistive technology reads: the readout's sentence, the names a group, a drawing and a table take, the
 * marks a drawing shows or leaves out, the path data's own closure, and the numbers a model returns.
 */

// Test data --------------------------------------------------------------------------------------

const CHART_TITLE = "Revenue by day";
const DAY_ONE = "2025-10-15";
const DAY_TWO = "2025-10-16";
const DAY_ONE_LABEL = defaultLabelFormatter(DAY_ONE);

const NET_ONE: MinorUnits = 45_990;
const NET_TWO: MinorUnits = 52_400;
const GROSS_ONE: MinorUnits = 20_000;
const GROSS_TWO: MinorUnits = 31_000;

/** More bands than the axis labels at once and more than a series may mark, so the thinning rules bite. */
const MANY_BANDS: readonly string[] = Array.from({ length: 40 }, (_unused, index) =>
  addDays(DAY_ONE, index),
);

/** The two money series every renderer case plots. */
const SERIES: readonly ChartSeries[] = [
  makeChartSeries({
    id: "net",
    label: "Net revenue",
    points: [
      { x: DAY_ONE, y: NET_ONE },
      { x: DAY_TWO, y: NET_TWO },
    ],
  }),
  makeChartSeries({
    id: "gross",
    label: "Gross revenue",
    color: CHART_SERIES_TOKEN_REFERENCES[1],
    points: [
      { x: DAY_ONE, y: GROSS_ONE },
      { x: DAY_TWO, y: GROSS_TWO },
    ],
  }),
];

/** One series of a single band, which is the shape a band the other series does not carry is checked with. */
function oneBand(
  id: string,
  label: string,
  token: number,
  band: string,
  value: number,
): ChartSeries {
  return makeChartSeries({
    id,
    label,
    color: CHART_SERIES_TOKEN_REFERENCES[token],
    points: [{ x: band, y: value }],
  });
}

/** A series whose one band carries a figure that is not a number: data, but no point to draw or to total. */
function wordless(id: string, label: string, token: number): ChartSeries {
  return makeChartSeries({
    id,
    label,
    color: CHART_SERIES_TOKEN_REFERENCES[token],
    points: [{ x: DAY_ONE, y: Number.NaN }],
  });
}

/** The model options a case varies one field of. */
function modelOptions(
  series: readonly ChartSeries[],
  overrides: Partial<PlotModelOptions> = {},
): PlotModelOptions {
  return {
    series,
    bandKeys: collectBandKeys(series),
    height: 280,
    includeZero: true,
    area: false,
    showPoints: true,
    formatValue: formatMoney,
    formatAxisValue: formatMoneyAxis,
    formatLabel: defaultLabelFormatter,
    ...overrides,
  };
}

/** The drawing a chart rendered, or a failure naming the absence rather than a null dereference. */
function drawingOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("the chart rendered no drawing");
  return svg;
}

/** The one pointer region for a band, the drawing publishes as its own index. */
function bandRegionOf(container: HTMLElement, index: number): SVGRectElement {
  const region = container.querySelector<SVGRectElement>(`rect[data-band-index="${index}"]`);
  if (region === null) throw new Error(`the drawing published no region for band ${index}`);
  return region;
}

/** The words the drawing's own value-axis ticks read, which are the ones anchored at their end. */
function valueAxisLabelsOf(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<SVGTextElement>('text.sp-chart__tick[text-anchor="end"]'),
  ].map((node) => node.textContent ?? "");
}

/** The readout's one sentence, or a failure naming the absence rather than a null dereference. */
function readoutOfChart(container: HTMLElement): string {
  const status = container.querySelector('[role="status"]');
  if (status === null) throw new Error("the chart rendered no readout");
  return status.textContent ?? "";
}

// Cases ------------------------------------------------------------------------------------------

describe("the line chart's plot model", () => {
  it("reads a band's figure, and tells a missing band from one that is not a number", () => {
    const dense = makeChartSeries({
      id: "net",
      label: "Net revenue",
      points: [
        { x: DAY_ONE, y: NET_ONE },
        { x: DAY_TWO, y: Number.NaN },
      ],
    });

    expect(finiteValueAt(dense, DAY_ONE)).toBe(NET_ONE);
    // A band the series does not carry and one whose point is not a number both read as no figure, which is
    // the difference between no revenue in a period and a period the series says nothing about.
    expect([finiteValueAt(dense, DAY_TWO), finiteValueAt(dense, "2025-10-17")]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("centres a band inside its own step", () => {
    const model = buildPlotModel(modelOptions(SERIES));
    const keys = model.bandKeys;
    const centres = keys.map((key) => bandCentre(model.bandScale, key));

    expect(centres[0]).toBe(model.bandScale.scale(keys[0]) + model.bandScale.bandwidth / 2);
    expect(centres[1]).toBeGreaterThan(centres[0]);
    expect(centres[1] - centres[0]).toBeCloseTo(model.bandScale.step, 9);
  });

  it("draws an area closed on the baseline only where the caller asks for one", () => {
    const plain = buildPlotModel(modelOptions(SERIES));
    const filled = buildPlotModel(modelOptions(SERIES, { area: true }));

    expect(plain.marks.map((mark) => mark.areaPath)).toEqual(["", ""]);
    expect(filled.marks.every((mark) => mark.areaPath.endsWith("Z"))).toBe(true);
    expect(filled.marks.every((mark) => mark.linePath !== mark.areaPath)).toBe(true);
  });

  it("marks a band while the series carries few enough of them, and drops the marks past the limit", () => {
    const twoBands = buildPlotModel(modelOptions(SERIES));
    const manyBands = buildPlotModel(
      modelOptions([
        makeChartSeries({ id: "net", points: MANY_BANDS.map((band) => ({ x: band, y: NET_ONE })) }),
      ]),
    );
    const unmarked = buildPlotModel(modelOptions(SERIES, { showPoints: false }));

    // One marker per band, drawn at the band's own centre.
    expect(twoBands.marks.map((mark) => mark.markers.length)).toEqual([2, 2]);
    expect(twoBands.marks[0].markers[0].x).toBeCloseTo(bandCentre(twoBands.bandScale, DAY_ONE), 9);
    // Forty markers on one line merge into the line they mark, so none is drawn.
    expect(manyBands.marks[0].markers).toEqual([]);
    expect(unmarked.marks.map((mark) => mark.markers.length)).toEqual([0, 0]);
  });

  it("draws a band a series does not carry as zero rather than as a gap", () => {
    // The left series carries only the first band; the model still draws, and tabulates, a figure for the
    // second, because a sparse revenue series means no revenue in that period.
    const sparse: readonly ChartSeries[] = [
      oneBand("net", "Net revenue", 0, DAY_ONE, NET_ONE),
      oneBand("gross", "Gross revenue", 1, DAY_TWO, GROSS_TWO),
    ];
    const model = buildPlotModel(modelOptions(sparse));

    expect(model.bandKeys).toEqual([DAY_ONE, DAY_TWO]);
    expect(model.marks.map((mark) => mark.markers.length)).toEqual([2, 2]);
    expect(model.marks[0].markers[1].y).toBeCloseTo(model.valueScale.scale(0), 9);
    const cells = model.dataTable.rows.map((row) => row.cells);
    expect(cells).toEqual([
      [formatMoney(NET_ONE), formatMoney(0)],
      [formatMoney(0), formatMoney(GROSS_TWO)],
    ]);
  });

  it("gives each band a pointer area spanning its own step, so the axis has no gap to fall through", () => {
    const model = buildPlotModel(modelOptions(SERIES));
    const area = model.plotArea;
    const step = model.bandScale.step;
    const [first, second] = model.hits;

    expect(model.hits.map((hit) => hit.index)).toEqual([0, 1]);
    expect(model.hits.map((hit) => hit.key)).toEqual(model.bandKeys);
    // A band's region is the whole step around its own centre, so the region after it starts exactly where
    // it ends and no pointer lands between two bands.
    expect(first.x).toBeCloseTo(bandCentre(model.bandScale, model.bandKeys[0]) - step / 2, 9);
    expect(first.x + first.width).toBeCloseTo(second.x, 9);
    expect(model.hits.every((hit) => hit.width > 0)).toBe(true);
    expect(model.hits.every((hit) => hit.y === area.y && hit.height === area.height)).toBe(true);
  });

  it("thins a band axis too long to label in full, and keeps every band in the table", () => {
    const many = makeChartSeries({
      id: "net",
      label: "Net revenue",
      points: MANY_BANDS.map((band) => ({ x: band, y: NET_ONE })),
    });
    const model = buildPlotModel(modelOptions([many]));

    expect(model.bandKeys).toHaveLength(MANY_BANDS.length);
    expect(model.bandTicks.length).toBeGreaterThan(1);
    expect(model.bandTicks.length).toBeLessThan(model.bandKeys.length);
    // A thinned label is dropped, never the band it belongs to: the table still states every band.
    expect(model.dataTable.rows).toHaveLength(MANY_BANDS.length);
  });

  it("spans the values themselves where the caller asks for the zoom, and zero otherwise", () => {
    const zoomed = buildPlotModel(modelOptions(SERIES, { includeZero: false }));
    const carried = buildPlotModel(modelOptions(SERIES));

    expect(zoomed.valueScale.domain[0]).toBeGreaterThan(0);
    expect(carried.valueScale.domain[0]).toBeLessThanOrEqual(0);
    expect(carried.valueScale.domain[1]).toBeGreaterThanOrEqual(
      Math.max(NET_ONE, NET_TWO, GROSS_ONE, GROSS_TWO),
    );
  });

  it("falls back to a defined domain where not one point is a number", () => {
    const model = buildPlotModel(modelOptions([wordless("net", "Net revenue", 0)]));

    // The scales stay defined so the drawing can be built at all, and no coordinate reaches a path as NaN.
    expect(model.valueScale.domain).toEqual([0, 1]);
    expect(model.marks[0].linePath).not.toContain("NaN");
    expect(model.dataTable.rows[0].cells).toEqual([formatMoney(0)]);
  });
});

describe("the line renderer's band walk and its readout", () => {
  it("reports the band the pointer is over and clears the readout when it leaves", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    await user.hover(bandRegionOf(container, 1));
    expect(readoutOfChart(container)).toBe(
      `${defaultLabelFormatter(DAY_TWO)} · Net revenue ${formatMoney(NET_TWO)} · Gross revenue ${formatMoney(GROSS_TWO)}`,
    );

    await user.hover(bandRegionOf(container, 0));
    expect(readoutOfChart(container)).toBe(
      `${DAY_ONE_LABEL} · Net revenue ${formatMoney(NET_ONE)} · Gross revenue ${formatMoney(GROSS_ONE)}`,
    );

    // The readout is placed by the plot's own box, published for the stylesheet to clamp by.
    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.getAttribute("style")).toContain("--sp-chart-readout-x");

    await user.unhover(bandRegionOf(container, 0));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("walks the bands with the arrow keys and leaves the vertical keys to the page", async () => {
    const user = setupUser();
    const { container } = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} />);
    await screen.findByRole("img", { name: CHART_TITLE });

    // Focusing the plot shows the first band, so the chart is not entered with nothing to read.
    await user.tab();
    expect(readoutOfChart(container)).toContain(DAY_ONE_LABEL);

    await user.keyboard("{ArrowRight}");
    expect(readoutOfChart(container)).toContain(defaultLabelFormatter(DAY_TWO));
    // The last band is the edge of the axis: a further step forward holds there.
    await user.keyboard("{ArrowRight}");
    expect(readoutOfChart(container)).toContain(defaultLabelFormatter(DAY_TWO));

    await user.keyboard("{ArrowLeft}");
    expect(readoutOfChart(container)).toContain(DAY_ONE_LABEL);
    await user.keyboard("{ArrowLeft}");
    expect(readoutOfChart(container)).toContain(DAY_ONE_LABEL);

    await user.keyboard("{Home}");
    expect(readoutOfChart(container)).toContain(DAY_ONE_LABEL);
    await user.keyboard("{End}");
    expect(readoutOfChart(container)).toContain(defaultLabelFormatter(DAY_TWO));

    // Up and Down are deliberately the page's, not this control's: the chart runs along its band axis, so
    // those keys keep scrolling the page and the readout stays where it is.
    const held = readoutOfChart(container);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("x");
    expect(readoutOfChart(container)).toBe(held);

    // A pointer that leaves the plot while it still holds focus leaves nothing selected, and a backwards
    // step then enters the axis at its last band rather than at a band the pointer had left.
    await user.hover(bandRegionOf(container, 0));
    await user.unhover(bandRegionOf(container, 0));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await user.keyboard("{ArrowLeft}");
    expect(readoutOfChart(container)).toContain(defaultLabelFormatter(DAY_TWO));

    // Forwards from nothing selected enters the axis at its first band, which is the other end from the
    // backwards step above.
    await user.hover(bandRegionOf(container, 1));
    await user.unhover(bandRegionOf(container, 1));
    await user.keyboard("{ArrowRight}");
    expect(readoutOfChart(container)).toContain(DAY_ONE_LABEL);

    // Tabbing on takes focus off the plot, which puts the readout away with it.
    await user.tab();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("states no figure for a series that carries no number, in the readout or the legend", async () => {
    const user = setupUser();
    const empty = wordless("empty", "No figures yet", 1);
    const { container } = renderWithProviders(
      <LineChart series={[SERIES[0], empty]} title={CHART_TITLE} />,
    );
    await screen.findByRole("img", { name: CHART_TITLE });

    // The band's figure for that series is the zero the drawing plots, and the legend entry states no total
    // at all rather than a figure nothing in the series supports.
    await user.hover(bandRegionOf(container, 0));
    expect(readoutOfChart(container)).toBe(
      `${DAY_ONE_LABEL} · Net revenue ${formatMoney(NET_ONE)} · No figures yet ${formatMoney(0)}`,
    );

    const legend = within(container).getAllByRole("listitem");
    expect(legend).toHaveLength(2);
    expect(legend[1].textContent).toBe("No figures yet");
    expect(legend[0]).toHaveTextContent(formatMoney(NET_ONE + NET_TWO));
  });

  it("marks a band while the axis carries few enough of them", async () => {
    const marked = renderWithProviders(<LineChart series={[SERIES[0]]} title={CHART_TITLE} />);
    await within(marked.container).findByRole("img", { name: CHART_TITLE });
    expect(marked.container.querySelectorAll("circle.sp-chart__point")).toHaveLength(2);

    const unmarked = renderWithProviders(
      <LineChart series={[SERIES[0]]} title={CHART_TITLE} showPoints={false} />,
    );
    await within(unmarked.container).findByRole("img", { name: CHART_TITLE });
    expect(unmarked.container.querySelectorAll("circle.sp-chart__point")).toHaveLength(0);

    // Forty bands put one marker per band on a line, where they merge into the line they mark.
    const crowded = renderWithProviders(
      <LineChart
        series={[
          makeChartSeries({
            id: "net",
            points: MANY_BANDS.map((band) => ({ x: band, y: NET_ONE })),
          }),
        ]}
        title={CHART_TITLE}
      />,
    );
    await within(crowded.container).findByRole("img", { name: CHART_TITLE });
    expect(crowded.container.querySelectorAll("circle.sp-chart__point")).toHaveLength(0);
  });

  it("closes the band under each line only where the caller asks for an area", async () => {
    const plain = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} />);
    await within(plain.container).findByRole("img", { name: CHART_TITLE });
    expect(pathsClosedIn(plain.container)).toHaveLength(0);

    const filled = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} area />);
    await within(filled.container).findByRole("img", { name: CHART_TITLE });
    expect(pathsClosedIn(filled.container)).toHaveLength(SERIES.length);
  });

  it("carries zero on the value axis by default and drops it where the caller asks for the zoom", async () => {
    const carried = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} />);
    await within(carried.container).findByRole("img", { name: CHART_TITLE });
    expect(valueAxisLabelsOf(carried.container)).toContain(formatMoney(0));

    const zoomed = renderWithProviders(
      <LineChart series={SERIES} title={CHART_TITLE} includeZero={false} />,
    );
    await within(zoomed.container).findByRole("img", { name: CHART_TITLE });
    const labels = valueAxisLabelsOf(zoomed.container);
    expect(labels).not.toContain(formatMoney(0));
    expect(labels.length).toBeGreaterThan(1);
  });

  it("draws the frame at the height a caller gives it and at the default otherwise", async () => {
    const sized = renderWithProviders(
      <LineChart series={[SERIES[0]]} title={CHART_TITLE} height={320} />,
    );
    await within(sized.container).findByRole("img", { name: CHART_TITLE });
    expect(drawingOf(sized.container).getAttribute("viewBox")).toBe("0 0 720 320");

    const unsized = renderWithProviders(
      <LineChart series={[SERIES[0]]} title={CHART_TITLE} height={0} />,
    );
    await within(unsized.container).findByRole("img", { name: CHART_TITLE });
    expect(drawingOf(unsized.container).getAttribute("viewBox")).toBe("0 0 720 280");
  });
});

describe("the line renderer's wording slots", () => {
  it("draws the header only where a caller gave it a heading or a control", async () => {
    const full = renderWithProviders(
      <LineChart
        series={[SERIES[0]]}
        title={CHART_TITLE}
        description="Last seven days"
        actions={<button type="button">Group by week</button>}
        footer={<p>Figures exclude tax.</p>}
      />,
    );
    await within(full.container).findByRole("img", { name: CHART_TITLE });
    expect(
      within(full.container).getByRole("heading", { level: 3, name: CHART_TITLE }),
    ).toBeInTheDocument();
    expect(within(full.container).getByText("Last seven days")).toBeInTheDocument();
    expect(
      within(full.container).getByRole("button", { name: "Group by week" }),
    ).toBeInTheDocument();
    expect(within(full.container).getByText("Figures exclude tax.")).toBeInTheDocument();

    // Controls without a heading still get a header row, and a chart given neither keeps no empty band above
    // its drawing.
    const controlled = renderWithProviders(
      <LineChart series={[SERIES[0]]} actions={<button type="button">Group by week</button>} />,
    );
    await within(controlled.container).findByRole("button", { name: "Group by week" });

    // A sentence with no heading leaves the chart without an <h3> while still naming it by the series it
    // draws, which is the shape a chart sitting under a screen's own section heading takes.
    const described = renderWithProviders(
      <LineChart series={[SERIES[0]]} description="Last seven days" />,
    );
    await within(described.container).findByRole("group", { name: SERIES[0].label });
    expect(within(described.container).queryByRole("heading")).toBeNull();
    expect(within(described.container).getByText("Last seven days")).toBeInTheDocument();

    const bare = renderWithProviders(<LineChart series={[SERIES[0]]} />);
    await within(bare.container).findByRole("img");
    expect(within(bare.container).queryByRole("heading")).toBeNull();
    expect(within(bare.container).queryByRole("button")).toBeNull();
  });

  it("takes the drawing's name from the heading, the label, its own series or the product", async () => {
    const headed = renderWithProviders(<LineChart series={SERIES} title={CHART_TITLE} />);
    await within(headed.container).findByRole("group", { name: CHART_TITLE });
    expect(
      within(headed.container).getByRole("region", { name: chartDataTableCaption(CHART_TITLE) }),
    ).toBeInTheDocument();

    const labelled = renderWithProviders(<LineChart series={SERIES} ariaLabel="Revenue per day" />);
    await within(labelled.container).findByRole("group", { name: "Revenue per day" });
    expect(
      within(labelled.container).getByRole("region", {
        name: chartDataTableCaption("Revenue per day"),
      }),
    ).toBeInTheDocument();

    const phrase = SERIES.map((one) => one.label).join(", ");
    const named = renderWithProviders(<LineChart series={SERIES} />);
    await within(named.container).findByRole("group", { name: phrase });
    expect(
      within(named.container).getByRole("region", { name: chartDataTableCaption(phrase) }),
    ).toBeInTheDocument();

    // A series that names nothing leaves the chart with the product's own name rather than a blank one.
    const anonymous = makeChartSeries({
      id: "net",
      label: "",
      points: [{ x: DAY_ONE, y: NET_ONE }],
    });
    const product = renderWithProviders(<LineChart series={[anonymous]} />);
    await within(product.container).findByRole("group", { name: APP_COPY.APP_NAME });
  });

  it("shows the shared no-data state, or a caller's own headline", async () => {
    const shared = renderWithProviders(<LineChart series={[]} />);
    expect(
      await within(shared.container).findByRole("heading", {
        level: 3,
        name: EMPTY_STATES.dashboardRange.title,
      }),
    ).toBeInTheDocument();
    expect(shared.container.querySelector("svg")).toBeNull();
    expect(within(shared.container).queryByRole("table")).toBeNull();

    const caller = renderWithProviders(
      <LineChart series={[]} emptyMessage="No revenue in this range" />,
    );
    expect(
      await within(caller.container).findByRole("heading", {
        level: 3,
        name: "No revenue in this range",
      }),
    ).toBeInTheDocument();
    expect(
      within(caller.container).getByText(EMPTY_STATES.dashboardRange.description),
    ).toBeInTheDocument();
  });
});

/** The paths of one drawing that close on the baseline, which is what an area's own path data does. */
function pathsClosedIn(container: HTMLElement): string[] {
  return [...container.querySelectorAll("path")]
    .map((path) => path.getAttribute("d") ?? "")
    .filter((data) => data.endsWith("Z"));
}
