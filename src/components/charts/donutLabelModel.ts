/**
 * Path: src/components/charts/donutLabelModel.ts
 * Purpose: Where each of a donut's percentages is written — inside its own wedge, or outside the ring on a leader line when the wedge is too thin to hold it — and where its readout is placed
 * Lines: 221
 */

import {
  MIN_SLICE_LABEL_SHARE,
  polarToCartesian,
  roundCoordinate,
} from "@/components/charts/chartScales";
import type { ArcDatum } from "@/components/charts/chartScales";
import type { CSSProperties } from "react";

import { formatShare } from "@/utils/format";

/*
 * A §0.5.5 split of `src/components/charts/DonutChart.tsx`, which could take no rule of its own once every slice
 * needed a label: the component keeps the drawing, the legend, the readout's markup and the paired table, while
 * the two questions of where a percentage is written and where the readout that repeats it is placed live here. The folder's own
 * pattern — `chartScales.ts`, `chartGeometry.ts`, `barGeometry.ts`, `lineChartModel.ts` — puts the model of a
 * drawing beside the component that draws it, where it is testable without mounting SVG.
 *
 * One rule, stated once: a slice with room for it carries its percentage on itself, and a slice too thin to
 * hold one carries the same percentage outside the ring on a leader line, so every segment is annotated and no
 * figure is reachable through the ring's geometry alone. The threshold is `MIN_SLICE_LABEL_SHARE`, read from
 * `chartScales.ts`; the band a label outside the ring needs is `OUTSIDE_LABEL_BAND`. Nothing here states a
 * colour, a stroke, a fill or a piece of copy: the only strings this file produces are percentages formatted
 * through `src/utils/format.ts`, so the renderer decides how a figure looks and the stylesheet decides how it
 * is painted.
 *
 * The geometry is reasoned, not measured, so nothing here reads an element's size. With the band reserved the
 * ring's radius is unchanged — a 720×384 drawing holds the same 124-unit ring it held in 720×280 — and the
 * farthest label sits about 18 units into that 384-unit frame, a line of type's worth of clearance below its
 * top edge, so no label and no leader can be painted outside the chart's frame, which is what the band buys.
 * The band's own arithmetic is in `OUTSIDE_LABEL_BAND`.
 */

/** The share a slice needs to carry its percentage on itself: the same threshold the arcs are read against. */
const INSIDE_LABEL_SHARE = MIN_SLICE_LABEL_SHARE;

/** The digits an on-wedge label reads: whole percents, which is what a wedge has room for. */
const INSIDE_LABEL_DIGITS = 0;

/**
 * The digits a label outside the ring reads: one decimal, matching the legend's own share.
 *
 * A wedge thin enough for this treatment is one small fraction of the ring, and whole percents would round it
 * to `0%` — a label that states nothing. One decimal keeps it a figure, and keeps it reading the same as the
 * row the legend and the paired table carry for it.
 */
const OUTSIDE_LABEL_DIGITS = 1;

/** How far past the ring the leader starts, in user units: the segment gap, so it never touches a wedge. */
const LEADER_GAP = 6;

/** How far past the leader's start the first level of outside labels sits, in user units. */
const OUTSIDE_LABEL_GAP = 14;

/** How much further out each successive level sits, in user units. */
const OUTSIDE_LABEL_STEP = 15;

/**
 * How many levels the outside labels cycle through, in ring order.
 *
 * Two thin wedges beside each other have mid-angles close enough that labels at one radius would collide, so
 * each successive thin slice steps out one level and the fourth returns to the first — by which point the ring
 * has turned far enough that the two labels are no longer neighbours.
 */
const OUTSIDE_LABEL_LEVELS = 3;

/** How far a label clears the leader's end, in user units, in the direction it reads. */
const LABEL_CLEARANCE = 3;

/**
 * The extra band the drawing reserves top and bottom when a thin slice needs its label outside the ring.
 *
 * One label outside the ring reaches `LEADER_GAP + OUTSIDE_LABEL_GAP + 2 × OUTSIDE_LABEL_STEP` = 50 units past
 * it, and the label's own line needs room beyond that: 52 units added to the frame's top and bottom inset —
 * with the same 52 added to the drawing's height, so the ring's radius and centre are what they were — holds
 * the farthest label about ten units clear of the frame's top edge, which is more than a line of type's
 * leading leaves to a font metric or a browser zoom change. A drawing with no thin slice reserves nothing and
 * keeps the height it always had.
 */
export const OUTSIDE_LABEL_BAND = 52;

/** One endpoint pair of a leader line, as the attributes an SVG `<line>` takes. */
export interface SliceLeader {
  /** The end at the ring, on the slice's mid-angle just outside it. */
  readonly x1: number;
  /** The vertical position of the leader's start, in the frame's own coordinate system. */
  readonly y1: number;
  /** The end at the label, at that slice's level. */
  readonly x2: number;
  /** The vertical position of the leader's end, in the frame's own coordinate system. */
  readonly y2: number;
}

/** Where one slice's percentage is written, and the leader its label hangs off when it is written outside. */
export interface SliceLabelMark {
  /** The mark's identity: the slice's own id, so a mark and its wedge share one key. */
  readonly id: string;
  /** The percentage as it reads, already formatted. */
  readonly text: string;
  /** Where the text's anchor sits horizontally, in the frame's own coordinate system. */
  readonly x: number;
  /** Where the text's anchor sits vertically, in the frame's own coordinate system. */
  readonly y: number;
  /** How the text hangs off its anchor: centred inside a wedge, and clear of a leader outside the ring. */
  readonly textAnchor: "middle" | "start" | "end";
  /** The leader line, present only when the label was drawn outside the ring. */
  readonly leader?: SliceLeader;
}

/** What {@link sliceLabelMarks} places its marks on: the ring's arcs and the frame they were drawn in. */
export interface SliceLabelInput {
  /** The ring's slices, in the order they were drawn. */
  readonly arcs: readonly ArcDatum[];
  /** The ring's positive total, which every mark's share is read against. */
  readonly total: number;
  /** The ring's centre, horizontally, in the frame's own coordinate system. */
  readonly centreX: number;
  /** The ring's centre, vertically, in the frame's own coordinate system. */
  readonly centreY: number;
  /** The ring's outer radius, which an outside label is placed past. */
  readonly outerRadius: number;
}

/** A style object that also carries the custom properties `src/styles/admin-reports.css` positions by. */
export type ReadoutStyle = CSSProperties & Record<`--${string}`, string>;

/**
 * The custom properties the donut's readout is placed by, in the frame's own box.
 *
 * The anchor is a point of the drawing, so it is mapped onto the box the drawing occupies rather than onto
 * the frame's padding box: a bare percentage of the frame would place the readout a padding-width away from
 * the slice it describes.
 *
 * The anchor is also the box's own top-left corner, not its centre. `src/styles/admin-reports.css` clamps the
 * readout's inline start between zero and the frame's width less the reserved width, and that clamp bounds a
 * left edge: an offset is what it holds inside the frame, and a box centred on its anchor would be pushed off
 * the slice by a reserve wider than the text and could still hang past the frame. That is why the width is
 * given as the text's own `ch` measure plus its horizontal padding — a reserve, deliberately on the generous
 * side — rather than measured, which would also take state written from an effect.
 *
 * @param anchorX - The anchor's horizontal position in the drawing's own units.
 * @param anchorY - The anchor's vertical position in the drawing's own units.
 * @param width - The drawing's width in those units.
 * @param height - The drawing's height in those units.
 * @param characters - The number of characters the readout's words take.
 * @returns The style object the readout element carries.
 */
export function readoutPlacement(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  characters: number,
): ReadoutStyle {
  const origin = "var(--space-4)";
  const span = `(100% - 2 * ${origin})`;
  const ratio = (value: number): string => Math.min(Math.max(value, 0), 1).toFixed(4);
  return {
    "--sp-chart-readout-x": `calc(${origin} + ${span} * ${ratio(anchorX / width)})`,
    "--sp-chart-readout-y": `calc(${origin} + ${span} * ${ratio(anchorY / height)})`,
    "--sp-chart-readout-w": `calc(${characters}ch + 2 * var(--space-3))`,
  };
}
/**
 * Where each slice's percentage is written: one mark per arc, in ring order.
 *
 * A slice holding at least {@link INSIDE_LABEL_SHARE} of the ring keeps its label on itself, at the arc's own
 * label position and anchored in the middle of it. A thinner slice carries its label outside the ring: a leader
 * runs from just past the outer edge to that slice's own level at the slice's mid-angle, and the text sits three
 * units clear of the leader's end, reading outward — anchored `start` on the right half of the ring and `end` on
 * the left, so no text runs back across the ring it describes.
 *
 * Every coordinate is written through the geometry module's own rounding, so a mark and the path it sits beside
 * state a coordinate at one precision.
 *
 * @param options - The arcs to label and the ring they were drawn in; see {@link SliceLabelInput}.
 * @returns One mark per arc, in ring order.
 */
export function sliceLabelMarks(options: SliceLabelInput): readonly SliceLabelMark[] {
  const { arcs, total, centreX, centreY, outerRadius } = options;
  let thin = 0;
  return arcs.map((arc): SliceLabelMark => {
    if (arc.share >= INSIDE_LABEL_SHARE) {
      return {
        id: arc.id,
        text: formatShare(arc.value, total, INSIDE_LABEL_DIGITS),
        x: roundCoordinate(arc.labelX),
        y: roundCoordinate(arc.labelY),
        textAnchor: "middle",
      };
    }
    const level = thin % OUTSIDE_LABEL_LEVELS;
    thin += 1;
    const start = polarToCartesian(centreX, centreY, outerRadius + LEADER_GAP, arc.midAngle);
    const end = polarToCartesian(
      centreX,
      centreY,
      outerRadius + LEADER_GAP + OUTSIDE_LABEL_GAP + level * OUTSIDE_LABEL_STEP,
      arc.midAngle,
    );
    const readsRight = end.x >= centreX;
    return {
      id: arc.id,
      text: formatShare(arc.value, total, OUTSIDE_LABEL_DIGITS),
      x: roundCoordinate(end.x + (readsRight ? LABEL_CLEARANCE : -LABEL_CLEARANCE)),
      y: roundCoordinate(end.y),
      textAnchor: readsRight ? "start" : "end",
      leader: {
        x1: roundCoordinate(start.x),
        y1: roundCoordinate(start.y),
        x2: roundCoordinate(end.x),
        y2: roundCoordinate(end.y),
      },
    };
  });
}
