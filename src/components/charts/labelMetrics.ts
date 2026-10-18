/**
 * Path: src/components/charts/labelMetrics.ts
 * Purpose: How wide one chart label is, in the frame's own user units, for the axes that thin and inset by it
 * Lines: 51
 */

/**
 * Why this file exists beside `chartGeometry.ts`: the charts' geometry is one concern the plan's 600-line
 * ceiling split once already, and the axis-label half of it outgrew the room left. The rule stays one rule —
 * the axis that thins a run of labels and the insets that reserve room for the labels at either end call
 * {@link estimateLabelWidth} rather than reading the text themselves — and both modules that need it reach it
 * from here, `chartGeometry.ts` first among them.
 *
 * The contract: pure, no read of the document, the clock or the platform, and a fresh number out.
 */

/** The size a label is written at along an axis, in the frame's user units: `.sp-chart__tick` is `--font-size-xs`,
 *  `0.75rem` of the document's 16px root, and a font size inside an SVG is a length in that SVG's own system. */
export const LABEL_FONT_SIZE = 12;

/** The widest advance each class of character reaches in the system sans-serif stack the sheet draws labels with,
 *  as a share of {@link LABEL_FONT_SIZE}: the thin characters, the glyphs that fill their own cell, the lowercase
 *  letters and digits, and the capitals. Each is at or above what its class measures, so a label summed from them
 *  is never narrower than the room it is measured against. */
const NARROW_LABEL_CHARS = " !'(),-./:;[]\\fijlrIt";
const NARROW_LABEL_ADVANCE = 0.44;
const WIDE_LABEL_CHARS = "MWmw@%";
const WIDE_LABEL_ADVANCE = 1.02;
const LOWER_LABEL_ADVANCE = 0.66;
const UPPER_LABEL_ADVANCE = 0.85;

/** What one character of a label is charged, as a share of {@link LABEL_FONT_SIZE}. A character in none of the
 *  classes is charged the widest advance of all rather than an average, because a label is whatever a caller's
 *  formatter writes — a product name, an accented one, a figure — and each must be measured rather than assumed. */
function advanceOf(char: string): number {
  if (NARROW_LABEL_CHARS.includes(char)) return NARROW_LABEL_ADVANCE;
  if (WIDE_LABEL_CHARS.includes(char)) return WIDE_LABEL_ADVANCE;
  if (char >= "A" && char <= "Z") return UPPER_LABEL_ADVANCE;
  if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) return LOWER_LABEL_ADVANCE;
  return WIDE_LABEL_ADVANCE;
}

/**
 * The room one label takes along an axis its text runs across, in user units, and the one home of that rule, so the
 * axis that thins a run of labels and the insets that reserve room for the labels at either end cannot disagree
 * about how wide one is. No font metric is read — that would mean measuring the document — so the estimate stands
 * at or above the width the system stack measures, and a label written down an axis instead of across it needs
 * {@link LABEL_FONT_SIZE} alone.
 */
export const estimateLabelWidth = (label: string): number =>
  [...label].reduce((width, char) => width + advanceOf(char), 0) * LABEL_FONT_SIZE;
