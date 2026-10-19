/**
 * Path: tests/components/chartGeometryGaps.test.ts
 * Purpose: The shared chart geometry at its own edges: the axis formatting hooks, the ring's slice arithmetic, the paired tables a caller leaves unnamed, and the readout's clamp
 * Lines: 317
 */

import { describe, expect, it } from "vitest";

import {
  AXIS_NUMBER_FORMAT,
  buildDonutArcs,
  buildSeriesDataTable,
  buildSliceDataTable,
  chartSeriesTotal,
  defaultValueFormatter,
  defaultLabelFormatter,
  seriesClassName,
  SERIES_COUNT,
} from "@/components/charts/chartScales";
import type { ArcDatum, PlotArea, ValueFormatter } from "@/components/charts/chartScales";
// The band-index helpers are reached at their own module, which the scales republish everything else from but
// these three: `chartScales.ts` re-exports the marks, the paths and the tables, not the point indexes.
import {
  indexSeriesPoints,
  indexedFiniteValueAt,
  indexedValueAt,
} from "@/components/charts/chartGeometry";
import { readoutPlacement } from "@/components/charts/readoutPlacement";
import { CHART_SERIES_TOKEN_REFERENCES } from "@/constants/config";
import { bucketStart, formatBucketLabel } from "@/utils/dates";
import { formatCompactNumber, formatMoney, formatPercent } from "@/utils/format";

import { makeChartSeries } from "../fixtures";

import type { ChartSeries } from "@/types/analytics";

/*
 * `chartGeometry.ts` and `readoutPlacement.ts` are the two halves of the charts' geometry that all three
 * renderers share, and both are pure: they read no document, no clock and no measured element, so their whole
 * contract is the value they return and every case here asserts that value directly rather than mounting SVG.
 *
 * What is left at this level is what a renderer's own props cannot reach, or reaches only through a shape that
 * would say nothing about it: the two non-money axis notations and the count fallback, the week and month key
 * shapes, a slice the ring drops for earning nothing, a figure that is not a number inside a total, a series
 * reference no token declares, a band a series does not carry, a heading a caller left unnamed, and the
 * readout's placement with no room on one side of its anchor and no box at all to read a ratio against.
 *
 * Everything asserted is the module's published contract: the words a figure reads as, the class a series
 * paints through, the cells a paired table holds, and the custom properties `src/styles/admin-reports.css`
 * positions the readout with. Each case states one rule with the one value each reading of it produces, and no
 * case restates a rule `tests/components/charts.test.tsx` or `chartScales.test.ts` already covers.
 */

// Test data --------------------------------------------------------------------------------------

/** The three band keys the geometry cases read: a day, its neighbour, and the day a NaN point sits on. */
const DAY_ONE = "2025-10-15";
const DAY_TWO = "2025-10-16";
const DAY_THREE = "2025-10-17";

/** The two key shapes that are not days, which `defaultLabelFormatter` resolves through their own start. */
const WEEK_KEY = "2025-W05";
const MONTH_KEY = "2025-01";

/** A point on a band: no label, so every key reads through the formatter the caller supplied. */
function point(band: string, value: number): { x: string; y: number } {
  return { x: band, y: value };
}

/** One slice of the ring: a single point, so a series' ring weight is the figure written here. */
function slice(id: string, label: string, token: number, value: number): ChartSeries {
  return makeChartSeries({
    id,
    label,
    color: CHART_SERIES_TOKEN_REFERENCES[token],
    points: [point(DAY_ONE, value)],
  });
}

/** The ring the arc cases split: an earner, a group that earned nothing, a loss and a larger earner. */
const EARNER_FIRST = slice("first", "First slice", 1, 100);
const EARNER_NOTHING = slice("nothing", "Sold nothing", 2, 0);
const EARNER_LOSS = slice("loss", "Refunded more than it sold", 3, -40);
const EARNER_SECOND = slice("second", "Second slice", 4, 300);
const RING: readonly ChartSeries[] = [EARNER_FIRST, EARNER_NOTHING, EARNER_LOSS, EARNER_SECOND];

/** The ring's own box: the ring geometry is asserted, so the frame it is drawn in is fixed here. */
const RING_BOX = { cx: 0, cy: 0, outerRadius: 100, innerRadius: 60 } as const;

/** One series, one band: the shape the paired table's heading cases need and nothing more. */
const NET = slice("net", "Net revenue", 0, 45_990);
const GROSS = slice("gross", "Gross revenue", 1, 20_000);

/** A series carrying a figure that is not a number, beside ones it does: 100 and 50 are its finite points. */
const UNMEASURED = makeChartSeries({
  id: "unmeasured",
  label: "Partly measured",
  points: [point(DAY_ONE, 100), point(DAY_TWO, Number.NaN), point(DAY_THREE, 50)],
});

/** The plot area the readout cases are bounded by, taken from the shared frame's own insets. */
const PLOT_AREA: PlotArea = { x: 56, y: 16, width: 640, height: 232 };

/** The drawing's box those placements are read against, in the frame's own user units. */
const DRAWING_WIDTH = 720;
const DRAWING_HEIGHT = 280;

/** One readout placement, as the custom properties the sheet positions and bounds the box with. */
function placementAt(
  anchor: { readonly anchorX: number; readonly anchorY: number },
  overrides: Partial<Parameters<typeof readoutPlacement>[0]> = {},
): ReturnType<typeof readoutPlacement> {
  return readoutPlacement({
    anchorX: anchor.anchorX,
    anchorY: anchor.anchorY,
    plotArea: PLOT_AREA,
    width: DRAWING_WIDTH,
    height: DRAWING_HEIGHT,
    characters: 12,
    ...overrides,
  });
}

// The axis formatting hooks ------------------------------------------------------------------------

describe("the chart geometry's axis hooks", () => {
  it("writes a ratio and a share as percentages, and every other reading as a compact count", () => {
    // A share is written without the decimal a wedge label has no room for, and a ratio with it.
    expect(defaultValueFormatter("share")(0.4)).toBe(formatPercent(0.4, 0));
    expect(defaultValueFormatter("percent")(0.35)).toBe(formatPercent(0.35, 1));
    // The default reading is the count's, which is also the one the value axes are given by name.
    expect(defaultValueFormatter("number")(1234)).toBe(formatCompactNumber(1234));
    expect(defaultValueFormatter()(1234)).toBe(formatCompactNumber(1234));
    expect(AXIS_NUMBER_FORMAT).toBe(defaultValueFormatter("number"));
  });

  it("words a week and a month bucket through the start of the bucket they name", () => {
    // Neither key parses as a day, so the bucket's own start is what the label is written from.
    expect(defaultLabelFormatter(WEEK_KEY)).toBe(
      formatBucketLabel(bucketStart(WEEK_KEY, "week"), "week"),
    );
    expect(defaultLabelFormatter(MONTH_KEY)).toBe(
      formatBucketLabel(bucketStart(MONTH_KEY, "month"), "month"),
    );
    // A day key is its own bucket start, and no key reads back as the raw key it arrived as.
    expect(defaultLabelFormatter(DAY_ONE)).toBe(formatBucketLabel(DAY_ONE, "day"));
    expect([WEEK_KEY, MONTH_KEY, DAY_ONE].map(defaultLabelFormatter)).not.toContain(WEEK_KEY);
  });
});

// The ring ----------------------------------------------------------------------------------------

describe("the ring's slice arithmetic", () => {
  it("draws one slice per series that earned something and drops the rest from the ring", () => {
    const arcs = buildDonutArcs({ series: RING, ...RING_BOX });

    // The series that earned nothing and the one that earned less than nothing draw no wedge: neither has an
    // area, and a share of the ring read from a non-positive weight would be a wedge drawn backwards.
    expect(arcs.map((arc) => arc.id)).toEqual([EARNER_FIRST.id, EARNER_SECOND.id]);
    expect(arcs.map((arc) => arc.value)).toEqual([100, 300]);
    // The surviving weights are read against the positive total alone, so their shares still close the turn.
    expect(arcs.map((arc) => arc.share)).toEqual([0.25, 0.75]);
    expect(arcs[0].share + arcs[1].share).toBe(1);
    // A slice the ring dropped keeps its place in the ring order, and the slice after it starts later.
    expect(arcs[1].midAngle).toBeGreaterThan(arcs[0].midAngle);
    expect(arcs.every((arc) => arc.path.startsWith("M") && arc.path.endsWith("Z"))).toBe(true);
  });

  it("reads a slice with no formatter through the shared count notation, never through raw digits", () => {
    const [arc] = buildDonutArcs({
      series: [slice("big", "Big slice", 0, 1_450_000)],
      ...RING_BOX,
    });

    expect(arc.formattedValue).toBe(formatCompactNumber(1_450_000));
    expect(arc.formattedValue).not.toBe("1450000");
  });

  it("totals the finite points of a series, so a figure that is not a number adds nothing", () => {
    expect(chartSeriesTotal([UNMEASURED])).toBe(150);
    expect(chartSeriesTotal([UNMEASURED, UNMEASURED])).toBe(300);
    expect(chartSeriesTotal([])).toBe(0);
  });
});

// Series identity and band reads -------------------------------------------------------------------

describe("a series' identity and the bands it carries", () => {
  it("colours a series no token declares by its own position, clamped into the declared colours", () => {
    // A reference from outside the palette falls back to the series' place, one-based.
    expect(seriesClassName("var(--chart-series-absent)", 1)).toBe(
      seriesClassName(CHART_SERIES_TOKEN_REFERENCES[1], 1),
    );
    // A position that is not a number falls back to the first colour, and one past the palette is clamped.
    expect(seriesClassName(undefined, Number.NaN)).toBe(
      seriesClassName(CHART_SERIES_TOKEN_REFERENCES[0], 0),
    );
    expect(seriesClassName(undefined, SERIES_COUNT + 4)).toBe(
      seriesClassName(CHART_SERIES_TOKEN_REFERENCES[SERIES_COUNT - 1], 0),
    );
  });

  it("reads a band a series does not carry, or carries without a figure, as no figure at all", () => {
    const index = indexSeriesPoints(UNMEASURED);

    expect(indexedFiniteValueAt(index, DAY_ONE)).toBe(100);
    // The band the series carries with a figure that is not a number states nothing...
    expect(indexedFiniteValueAt(index, DAY_TWO)).toBeUndefined();
    // ...and so does the band it carries no point at, which the tables above draw as a zero.
    expect(indexedFiniteValueAt(index, "2025-10-31")).toBeUndefined();
    expect([indexedValueAt(index, DAY_TWO), indexedValueAt(index, "2025-10-31")]).toEqual([0, 0]);
  });
});

// The paired data tables ---------------------------------------------------------------------------

describe("the paired tables' headings", () => {
  it("states no column heading a caller left unnamed, rather than one invented here", () => {
    const grouped = buildSeriesDataTable([NET, GROSS], formatMoney);
    const ring = buildDonutArcs({ series: [EARNER_FIRST, EARNER_SECOND], ...RING_BOX });
    const shareFormatter: ValueFormatter = (share) => formatPercent(share, 1);

    // The leading heading is the caller's word for the dimension the rows are drawn along, and a caller who
    // names none leaves it empty rather than leaving the module to invent one.
    expect(grouped.columns).toEqual(["", NET.label, GROSS.label]);
    expect(buildSliceDataTable(ring, formatMoney, shareFormatter).columns).toEqual(["", "", ""]);
  });

  it("carries a caller's own words for the columns it does name", () => {
    const ring = buildDonutArcs({ series: [EARNER_FIRST], ...RING_BOX });
    const shareFormatter: ValueFormatter = (share) => formatPercent(share, 1);
    const words = { labelHeader: "Group", valueHeader: "Value", shareHeader: "Share" };

    expect(buildSeriesDataTable([NET], formatMoney, { labelHeader: "Product" }).columns).toEqual([
      "Product",
      NET.label,
    ]);
    expect(buildSliceDataTable(ring, formatMoney, shareFormatter, words).columns).toEqual([
      "Group",
      "Value",
      "Share",
    ]);
    // And the rows are stated under those headings, so no figure in the alternative is left unnamed.
    expect(ring.map((arc: ArcDatum) => arc.label)).toEqual([EARNER_FIRST.label]);
  });
});

// The readout's placement ---------------------------------------------------------------------------

describe("the readout's placement", () => {
  it("publishes the plot's own edges, the room its words take and the side it grows from", () => {
    // The anchor and the two edges the sheet's clamp holds the box between, each as a percentage of the
    // drawing's own box, which is what puts the box on the point rather than a padding-width away from it.
    expect(placementAt({ anchorX: 376, anchorY: 248 })).toEqual({
      "--sp-chart-readout-x": "52.22%",
      "--sp-chart-readout-y": "88.57%",
      "--sp-chart-readout-left": "7.78%",
      "--sp-chart-readout-right": "96.67%",
      "--sp-chart-readout-w": "calc(12ch + 2 * var(--space-3))",
      // Lifted by its own height, because every unit of room the plot has lies above the anchor: the box hangs
      // above the band rather than falling outside the bottom of the plot.
      "--sp-chart-readout-flip": "-100%",
      "--sp-chart-readout-max": "82.86%",
    });
  });

  it.each([
    { where: "the plot's top", anchorY: 16, flip: "0px" },
    { where: "the plot's bottom", anchorY: 248, flip: "-100%" },
  ])("hangs the box off the roomier side at $where", ({ anchorY, flip }) => {
    const style = placementAt({ anchorX: 376, anchorY });

    expect(style["--sp-chart-readout-flip"]).toBe(flip);
    // One side holds the whole plot, which is what the box may grow to there.
    expect(style["--sp-chart-readout-max"]).toBe("82.86%");
  });

  it("straddles an anchor with room on both sides, holding twice the smaller room", () => {
    const style = placementAt({ anchorX: 376, anchorY: 120 });

    expect(style["--sp-chart-readout-flip"]).toBe("-50%");
    // 104 units above and 128 below, so the box straddles the anchor and may reach 208 units tall.
    expect(style["--sp-chart-readout-max"]).toBe("74.29%");
  });

  it("clamps an anchor into the plot before reading the room around it", () => {
    // An anchor above or below the plot is held on the edge it passed, which is what keeps the box in the
    // drawing whatever the mark that named the band reports.
    expect(placementAt({ anchorX: 0, anchorY: -500 })).toMatchObject({
      "--sp-chart-readout-x": "0.00%",
      "--sp-chart-readout-y": "5.71%",
    });
    expect(placementAt({ anchorX: 0, anchorY: 9_999 })["--sp-chart-readout-y"]).toBe("88.57%");
  });

  it("publishes no ratio it cannot read rather than a percentage that is not a number", () => {
    // A box of no extent and an anchor that is not a number read as the box's own origin on every axis.
    const degenerate = placementAt(
      { anchorX: Number.NaN, anchorY: 120 },
      { plotArea: { x: 0, y: 0, width: 0, height: 0 }, height: 0, characters: Number.NaN },
    );

    expect(degenerate).toMatchObject({
      "--sp-chart-readout-x": "0.00%",
      "--sp-chart-readout-y": "0.00%",
      "--sp-chart-readout-max": "0.00%",
      "--sp-chart-readout-w": "calc(0ch + 2 * var(--space-3))",
    });

    // The reserved width is a whole, non-negative count of characters, whatever length it is handed.
    const widthFor = (characters: number): string =>
      placementAt({ anchorX: 376, anchorY: 120 }, { characters })["--sp-chart-readout-w"];

    expect(widthFor(12.7)).toBe("calc(12ch + 2 * var(--space-3))");
    expect(widthFor(-4)).toBe("calc(0ch + 2 * var(--space-3))");
  });
});
