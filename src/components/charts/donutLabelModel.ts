/**
 * Path: src/components/charts/donutLabelModel.ts
 * Purpose: Where each of a donut's percentages is written — inside its own wedge, or outside the ring on a leader line when the wedge is too thin to hold it — and where its readout is placed
 * Lines: 161
 */

import { polarToCartesian, roundCoordinate } from "@/components/charts/chartScales";
import type { ArcDatum } from "@/components/charts/chartScales";

import { formatShare } from "@/utils/format";

/*
 * A §0.5.5 split of `src/components/charts/DonutChart.tsx`, which could take no rule of its own once every slice
 * needed a label: the component keeps the drawing, the legend, the readout's markup and the paired table, while
 * the question of where each percentage is written lives here. The folder's own pattern — `chartScales.ts`,
 * `chartGeometry.ts`, `barGeometry.ts`, `lineChartModel.ts` — puts the model of a drawing beside the component
 * that draws it, where it is testable without mounting SVG. The readout's own placement is not repeated here:
 * `src/components/charts/readoutPlacement.ts` owns that arithmetic for all three renderers.
 *
 * One rule, stated once: every slice's percentage is written outside the ring, on the surface the legend's
 * shares are read on, in the digits the legend writes, and a leader joins it back to the wedge it belongs to.
 * A slice's own fill is too saturated a ground for any ink a figure could be read in, and a wedge has no room
 * for a figure at all once it is thin, so no figure is ever painted on the ring. Nothing here states a colour,
 * a stroke, a fill or a piece of copy: the only strings this file produces are percentages formatted through
 * `src/utils/format.ts`, so the renderer decides how a figure looks and the stylesheet decides how it is
 * painted.
 *
 * The geometry is reasoned, not measured, so nothing here reads an element's size. The ring takes
 * `DONUT_RING_SHARE` of the half-extent the drawing offers, the rails stand `LABEL_GAP` past it, and a side's
 * rows are `LABEL_ROW` apart as far as the drawing's own height allows, so neither a figure nor a leader is
 * ever painted outside the chart's frame.
 */

/** The digits every slice's figure reads, which are the legend's own: one share is never stated two ways. */
const LABEL_DIGITS = 1;

/** How far past the ring the rails stand, in user units, which is the room a leader needs to leave the rim. */
const LABEL_GAP = 20;

/** The row pitch a side's figures take, in user units, narrowed only where a side carries more rows than fit. */
const LABEL_ROW = 33;

/** The side of the ring a figure's rail runs from: `start` is right of it, `end` left of it. */
type LabelSide = "start" | "end";

/** The two rails, built in this order, so a rail's own index is its side's. */
const LABEL_SIDES: readonly LabelSide[] = ["start", "end"];

/**
 * The share of the half-extent the drawing offers that the ring itself takes, the rest holding the two rails.
 *
 * A ring at this share is centred in the drawing and leaves `LABEL_GAP` and a figure's own width on either
 * side of it, so the drawing is the same box whatever width it is rendered at.
 */
export const DONUT_RING_SHARE = 0.85;

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
  /** How the text hangs off its anchor: `start` reads rightward from its rail, `end` leftward. */
  readonly textAnchor: LabelSide;
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
  /** The ring's outer radius, which both rails stand past. */
  readonly outerRadius: number;
}

/**
 * Where each slice's percentage is written: one mark per arc, in ring order.
 *
 * Every figure stands outside the ring, on the surface the legend's shares are read on and at the digits the
 * legend writes, because a wedge's own fill is too saturated a ground for any ink a figure could be read in and
 * one share cannot be stated at two precisions on one page. A slice's rail is the side its mid-angle falls on —
 * right of the ring reading `start`, left reading `end` — and its row its place in that side's own order down
 * the ring, so a side's leaders run in the order its rows do and no two of them cross. Rows are held inside the
 * drawing, whose own half-height the centred ring puts at `centreY`: a side carrying more rows than fit a line
 * each shares what room there is.
 *
 * A mark carries the leader its figure hangs off — the line from the slice's own mid-angle point on the rim out
 * to the rail — which is the only tie between a figure and its wedge once both are off the fill. A mark's
 * leader therefore accounts for the hairline the drawing joins it back with, and its own rail accounts for the
 * side it reads from.
 *
 * Every coordinate is written through the geometry module's own rounding, so a mark and the path it sits beside
 * state a coordinate at one precision.
 *
 * @param options - The arcs to label and the ring they were drawn in; see {@link SliceLabelInput}.
 * @returns One mark per arc, in ring order.
 */
export function sliceLabelMarks(options: SliceLabelInput): readonly SliceLabelMark[] {
  const { arcs, total, centreX, centreY, outerRadius } = options;
  const onRing = arcs.map((arc) => ({
    arc,
    edge: polarToCartesian(centreX, centreY, outerRadius, arc.midAngle),
  }));
  const rails = LABEL_SIDES.map((side) =>
    onRing
      .filter((one) => (one.edge.x >= centreX ? "start" : "end") === side)
      .sort((one, other) => one.edge.y - other.edge.y),
  );
  const rowCount = Math.max(...rails.map((rail) => rail.length));
  const rowStep =
    rowCount <= 1 ? 0 : Math.min(LABEL_ROW, Math.max(0, 2 * centreY - LABEL_ROW) / (rowCount - 1));
  const marks: SliceLabelMark[] = [];
  LABEL_SIDES.forEach((side, sideIndex) => {
    const rail = rails[sideIndex];
    const anchorX = centreX + (side === "start" ? 1 : -1) * (outerRadius + LABEL_GAP);
    rail.forEach((one, row) => {
      const anchorY = centreY + (row - (rail.length - 1) / 2) * rowStep;
      marks.push({
        id: one.arc.id,
        text: formatShare(one.arc.value, total, LABEL_DIGITS),
        x: roundCoordinate(anchorX),
        y: roundCoordinate(anchorY),
        textAnchor: side,
        leader: {
          x1: roundCoordinate(one.edge.x),
          y1: roundCoordinate(one.edge.y),
          x2: roundCoordinate(anchorX),
          y2: roundCoordinate(anchorY),
        },
      });
    });
  });
  // Back into the ring's own order, so the drawing, its legend and its paired table all read the same way.
  const ringOrder = new Map(arcs.map((arc, index) => [arc.id, index]));
  return [...marks].sort(
    (one, other) => (ringOrder.get(one.id) ?? 0) - (ringOrder.get(other.id) ?? 0),
  );
}
