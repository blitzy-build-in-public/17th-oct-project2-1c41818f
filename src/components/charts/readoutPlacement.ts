/**
 * Path: src/components/charts/readoutPlacement.ts
 * Purpose: Places a chart's hover readout inside the plot area, as the custom properties its stylesheet clamps by
 * Lines: 137
 */

import type { CSSProperties } from "react";

import type { PlotArea } from "@/components/charts/chartScales";

/**
 * Why this file exists beside the three renderers: where the readout of a hovered band or wedge sits, how
 * wide a reserve its own words ask for and how it is held inside the plot area is one concern all three of
 * them need and none of them owns. The placement arithmetic must have one home, because three
 * renderers computing it separately is how a readout leaves its frame: the clamp that holds the box
 * inside the plot reads a width the placement publishes, and a second implementation of a shared
 * concern is a defect rather than a convenience.
 *
 * The contract: pure, `readonly` input it never mutates, a fresh style object out, and no read of the
 * document, the clock or the platform — so a placement is checkable without mounting SVG and without a
 * layout engine. No colour, `stroke`, `fill` or copy appears here either: the properties named below are
 * consumed by `src/styles/admin-reports.css`, which owns the box's paint, its wrapping and its clamp.
 */

// Constants ---------------------------------------------------------------------------------------

/** The decimals every published percentage carries, so one anchor always produces one style object. */
const PERCENT_DECIMALS = 2;

// Types -------------------------------------------------------------------------------------------

/** The style a readout carries: React's own properties, plus the placement's custom properties. */
export type ReadoutStyle = CSSProperties & Record<`--${string}`, string>;

/**
 * Everything {@link readoutPlacement} reads: the anchor in the drawing's own user units, the plot area the
 * marks are drawn in, the drawing's box, and the readout's own length.
 */
export interface ReadoutPlacement {
  /** Where the readout is anchored across the drawing, in the frame's user units. */
  readonly anchorX: number;
  /** Where the readout is anchored down the drawing, in the frame's user units. */
  readonly anchorY: number;
  /**
   * The rectangle the marks are drawn in, which the readout is bounded by on both axes: its `x` is published
   * as `--sp-chart-readout-left`, the left edge of the plot area, which the sheet holds the box's inline start
   * at or past so the readout can never cover the value axis or a category label in the gutter.
   */
  readonly plotArea: PlotArea;
  /** The drawing's width in user units, which the inline percentage is read against. */
  readonly width: number;
  /** The drawing's height in user units, which the block percentage and the bound are read against. */
  readonly height: number;
  /** The readout's words as a character count, which the width it reserves is measured from. */
  readonly characters: number;
}

// Helpers -----------------------------------------------------------------------------------------

/**
 * A position as the percentage of a box: two decimals, clamped into `0..100` so no offset is published
 * outside the box it is read against, and zero for a position or a box no ratio can be read from — a
 * non-finite value or a box of no extent would otherwise publish `NaN%`.
 */
function ratio(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return (0).toFixed(PERCENT_DECIMALS);
  }
  return Math.min(Math.max((value / total) * 100, 0), 100).toFixed(PERCENT_DECIMALS);
}

/** The length a reserved width is measured from: a whole, non-negative count of characters. */
function characterCount(characters: number): number {
  return Number.isFinite(characters) ? Math.max(0, Math.trunc(characters)) : 0;
}

// Placement ---------------------------------------------------------------------------------------

/**
 * The readout's placement, as the six custom properties `src/styles/admin-reports.css` positions and bounds
 * the box with: `--sp-chart-readout-x` and `-y` for the anchor, `-left` for the inline floor the box's start is
 * held at or past — the left edge of the plot area, so a long sentence may not reach the value-axis gutter —
 * `-w` for the width the inline clamp reserves, `-flip` for the block direction the box grows in, and `-max`
 * for the height it may grow to.
 *
 * The percentages are taken against the drawing's own box rather than the frame's, because each renderer
 * wraps the drawing in `.sp-chart__plot` — a `position: relative` box whose size is the SVG's, since the
 * sheet draws the SVG at the plot's full width and lets its height follow the viewBox's ratio. An anchor in
 * the frame's user units therefore maps straight onto the box the readout is measured in, so a percentage
 * inset lands on the point the pointer is over rather than a padding-width away from it. The sheet could not
 * do this arithmetic itself: a stylesheet can neither clamp an inline inset nor measure the box a wrapped
 * readout will take, and reading a rendered box here would mean measuring layout, which no renderer does.
 *
 * The box is held inside the plot area on both axes, and the flip and max pair is what makes that provable.
 * The anchor is clamped into the plot area first, so it is never outside it, and the room on each side of it
 * is then read: a box hung above the anchor has the flip move it up by its own height, putting its bottom edge
 * on the anchor, and the max caps that height at the room above, so its top edge cannot rise past the plot's
 * top; a box hung below the anchor is capped at the room below, so its bottom edge cannot pass the plot's
 * bottom. A centred box takes the same guarantee from the other side: the flip moves it up by half its own
 * height so it straddles the anchor, and the max caps it at twice the smaller of the two rooms, which leaves
 * that half-height inside the nearer edge.
 *
 * The side is chosen by which one holds more height, so the cap is never the smaller room and the box is as
 * tall as its plot allows wherever the anchor sits. Centring wins whenever twice the smaller room beats the
 * roomier side on its own, which covers every anchor whose two rooms are equal: a box straddling such an
 * anchor holds twice what either side holds alone. Otherwise the box hangs off the roomier side — above when
 * that is the room above — and the room it is capped by is that one room. Inline, the published left and right
 * edges are the plot area's own span, which the sheet's clamp holds the box inside, so it can never reach the
 * value axis' gutter or a category label beside it; the reserved width is the measure that clamp subtracts from
 * the room between the two edges, and the sheet's own maximum width and wrapping turn a sentence longer than
 * the plot into more lines rather than a box that leaves the drawing.
 *
 * @param placement - The anchor, the plot area, the drawing's box and the readout's length in characters.
 * @returns The style the readout element carries, holding only geometry and no paint.
 */
export function readoutPlacement(placement: ReadoutPlacement): ReadoutStyle {
  const { plotArea, width, height } = placement;
  const top = plotArea.y;
  const bottom = plotArea.y + plotArea.height;
  const anchorY = Math.min(Math.max(placement.anchorY, top), bottom);
  const topRoom = anchorY - top;
  const bottomRoom = bottom - anchorY;
  const centredRoom = 2 * Math.min(topRoom, bottomRoom);
  const sideAbove = topRoom >= bottomRoom;
  const sideRoom = sideAbove ? topRoom : bottomRoom;
  const centred = centredRoom > sideRoom;
  const limit = centred ? centredRoom : sideRoom;
  return {
    "--sp-chart-readout-x": `${ratio(placement.anchorX, width)}%`,
    "--sp-chart-readout-y": `${ratio(anchorY, height)}%`,
    "--sp-chart-readout-left": `${ratio(plotArea.x, width)}%`,
    "--sp-chart-readout-right": `${ratio(plotArea.x + plotArea.width, width)}%`,
    "--sp-chart-readout-w": `calc(${characterCount(placement.characters)}ch + 2 * var(--space-3))`,
    "--sp-chart-readout-flip": centred ? "-50%" : sideAbove ? "-100%" : "0px",
    "--sp-chart-readout-max": `${ratio(limit, height)}%`,
  };
}
