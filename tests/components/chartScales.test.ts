/**
 * Path: tests/components/chartScales.test.ts
 * Purpose: The chart scales' own mathematics: the steps a value axis ticks at, the extent it spans and the room a band label takes
 * Lines: 172
 */

import { describe, expect, it } from "vitest";

import * as scales from "@/components/charts/chartScales";
import { addDays, formatBucketLabel } from "@/utils/dates";
import { formatMoney, formatMoneyAxis } from "@/utils/format";

import { makeChartSeries } from "../fixtures";

/*
 * A §0.5.5 split of `tests/components/charts.test.tsx`: the chart-mathematics cases that need no renderer — the
 * step a value axis ticks at, the extent a degenerate series spans, the room a band label takes and the notation
 * a money axis is written in — are their own suite here, because the renderer suite reached the 600-line ceiling
 * once both this checkpoint's cases and the previous lane's had landed in it. Every case asserts
 * `chartScales.ts`'s exported contract, which is React-free, so nothing is mocked and nothing is mounted.
 */

/** The 53 weekly buckets a 366-day range produces, worded as the reports word them: the wide labels a band axis
 *  has to thin by measurement rather than by count. */
const WEEK_LABELS: readonly string[] = Array.from({ length: 53 }, (_value, index) =>
  formatBucketLabel(addDays("2025-10-18", index * 7), "week"),
);

describe("the chart scales' axis mathematics", () => {
  it.each([
    {
      name: "a bucket holding one person",
      extent: [0, 1] as const,
      domain: [0, 1],
      ticks: [0, 1],
      unfixed: [0, 0.2, 0.4, 0.6, 0.8, 1],
    },
    {
      name: "a bucket holding six",
      extent: [0, 6] as const,
      domain: [0, 6],
      ticks: [0, 2, 4, 6],
      unfixed: [0, 2, 4, 6],
    },
  ])(
    "ticks a whole-number metric in whole numbers: $name",
    ({ extent, domain, ticks: expected, unfixed }) => {
      const [low, high] = extent;
      expect(scales.niceDomain(low, high, undefined, scales.WHOLE_NUMBER_STEP)).toEqual(domain);
      expect(scales.linearTicks(low, high, undefined, scales.WHOLE_NUMBER_STEP)).toEqual(expected);
      // The same extent without the floor is what the count axis used to state.
      expect(scales.linearTicks(low, high)).toEqual(unfixed);
    },
  );

  it("collapses a zero extent to one tick on the end the value axis starts at", () => {
    const scale = scales.createLinearScale({ domain: [0, 0], range: [232, 0], nice: true });
    const ticks = scales.buildValueTicks(scale, (value: number) => formatMoney(value));
    expect(scales.niceDomain(0, 0)).toEqual([0, 0]);
    expect(scales.niceMoneyDomain(0, 0)).toEqual([0, 0]);
    expect(scale.domain).toEqual([0, 0]);
    expect([scale.scale(0), scale.scale(1), scale.invert(116)]).toEqual([232, 232, 0]);
    expect(ticks.map((tick) => tick.label)).toEqual([formatMoney(0)]);
    expect(ticks[0].position).toBe(232);
  });

  it("thins a long run of band labels by the room one takes, and reserves both ends for it", () => {
    const widest = Math.max(...WEEK_LABELS.map(scales.estimateLabelWidth));
    const room = widest + scales.MIN_BAND_LABEL_GAP;
    const padding = scales.bandAxisPadding(scales.DEFAULT_PADDING, WEEK_LABELS);
    expect(padding.left).toBeGreaterThanOrEqual(Math.ceil(widest / 2) + scales.MIN_BAND_LABEL_GAP);
    expect(padding.right).toBeGreaterThanOrEqual(Math.ceil(widest / 2) + scales.MIN_BAND_LABEL_GAP);
    // An inset the caller already declares wider than the room keeps its own, because it was reserved for more.
    const wide = { top: 8, right: 400, bottom: 8, left: 400 };
    expect(scales.bandAxisPadding(wide, WEEK_LABELS)).toEqual(wide);

    const plotArea = scales.computePlotArea({
      width: scales.CHART_VIEWBOX_WIDTH,
      height: 280,
      padding,
    });
    const bandScale = scales.createBandScale({
      domain: WEEK_LABELS,
      range: [plotArea.x, plotArea.x + plotArea.width],
    });
    const ticks = scales.buildBandTicks(bandScale, (key) => key, {
      axisLength: plotArea.width,
      measureLabel: scales.estimateLabelWidth,
    });
    const first = ticks[0];
    const last = ticks[ticks.length - 1];
    expect(ticks.length).toBeLessThanOrEqual(scales.MAX_AXIS_LABELS);
    expect(ticks.length).toBeLessThan(WEEK_LABELS.length);
    expect(last.key).toBe(WEEK_LABELS[WEEK_LABELS.length - 1]);
    // No two kept labels sit closer than the room one takes, which is what stops them superimposing.
    ticks.slice(1).forEach((tick, index) => {
      expect(tick.position - ticks[index].position).toBeGreaterThanOrEqual(room);
    });
    // Both end labels stay inside the frame the padding reserved, so neither is cut by its edge.
    expect(first.position - scales.estimateLabelWidth(first.label) / 2).toBeGreaterThanOrEqual(0);
    expect(last.position + scales.estimateLabelWidth(last.label) / 2).toBeLessThanOrEqual(
      scales.CHART_VIEWBOX_WIDTH,
    );
    // With no axis length stated, the count rule alone decides, exactly as it always did.
    expect(scales.buildBandTicks(bandScale, (key) => key)).toHaveLength(scales.MAX_AXIS_LABELS);
  });

  it("tells a count of people from a metric that carries a fraction", () => {
    const series = (id: string, y: number, broken = false) =>
      makeChartSeries({
        id,
        label: id,
        points: [{ x: "2025-10-15", y: broken ? Number.NaN : y }],
      });
    const counts = [series("new", 3), series("back", 0)];
    expect(scales.hasWholeValues(counts)).toBe(true);
    expect(scales.hasWholeValues([...counts, series("conversion", 0.35)])).toBe(false);
    // A series carrying no finite point states nothing, and neither does a set of them.
    expect([
      scales.hasWholeValues([]),
      scales.hasWholeValues([makeChartSeries({ points: [] })]),
    ]).toEqual([false, false]);
    expect(scales.hasWholeValues([series("units", 2), series("broken", 2, true)])).toBe(true);
  });
});

describe("the money axis formatter", () => {
  it.each([
    {
      name: "an axis reaching the compact threshold",
      domain: [0, 1_500_000] as const,
      ticks: [0, 500_000, 1_000_000, 1_500_000],
      expected: ["$0", "$5K", "$10K", "$15K"],
    },
    {
      name: "an axis below it",
      domain: [0, 45_990] as const,
      ticks: [0, 20_000, 40_000],
      expected: ["$0.00", "$200.00", "$400.00"],
    },
    { name: "a zero extent", domain: [0, 0] as const, ticks: [0], expected: ["$0.00"] },
    {
      name: "an extent below zero",
      domain: [-235_378, 0] as const,
      ticks: [-235_378, 0],
      expected: ["-$2.4K", "$0"],
    },
  ])("writes every tick of $name in one notation", ({ domain, ticks, expected }) => {
    expect(ticks.map((value) => formatMoneyAxis(value, domain))).toEqual(expected);
  });

  it("keeps one axis out of the other axis's notation entirely", () => {
    // The defect this replaces: an axis that shortened only its large ticks wrote `$0.00` beside `$2K`.
    const compact = [0, 500_000, 1_500_000].map((value) => formatMoneyAxis(value, [0, 1_500_000]));
    const full = [0, 20_000].map((value) => formatMoneyAxis(value, [0, 20_000]));
    expect(compact).not.toContain(formatMoney(0));
    expect(full.some((label) => label.includes("K"))).toBe(false);
    expect(full).toContain(formatMoney(0));
  });

  it.each([Number.NaN, Infinity, null])(
    "renders the unusable amount %s as the placeholder",
    (minor) => {
      expect(formatMoneyAxis(minor, [0, 1_500_000])).not.toMatch(/NaN|Infinity|K/);
    },
  );

  it("reads a domain with no usable bound as a small one", () => {
    expect(formatMoneyAxis(45_990, [Number.NaN, Number.NaN])).toBe(formatMoney(45_990));
    expect(formatMoneyAxis(45_990, [0, Infinity])).toBe(formatMoney(45_990));
  });
});
