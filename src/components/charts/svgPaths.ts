/**
 * Path: src/components/charts/svgPaths.ts
 * Purpose: The SVG path text a chart’s marks are drawn from, in the frame’s own coordinate system
 * Lines: 139
 */

/**
 * Why this file exists beside `chartGeometry.ts`: the charts' geometry is one concern split by what each
 * file owns rather than by size, because one file may not exceed 600 lines. This file owns the coordinate
 * rounding, the polyline and area builders, the polar mapping and the ring segment, and `chartGeometry.ts`
 * imports it and publishes it again, so nothing that draws a chart changed the path it imports.
 *
 * The contract: pure, `readonly` input it never mutates, a fresh string out, and no read of the document, the
 * clock or the platform. Nothing here imports `chartGeometry.ts`, so the dependency runs one way.
 */

/** A point in the frame's coordinate system, where `y` grows downward. */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

const COORDINATE_DECIMALS = 2;

/** `0` for either signed zero, so a coordinate never carries a sign it does not mean. */
const normalizeZero = (value: number): number => (value === 0 ? 0 : value);

/** A coordinate as the short text an SVG path carries. */
const coordinate = (value: number): string => String(roundCoordinate(value));

/** A point as the `x,y` pair an SVG command takes. */
const pointOf = (point: Point2D): string => `${coordinate(point.x)},${coordinate(point.y)}`;

/** The full turn of a circle in degrees, the sweep at which an arc closes on itself. */
export const FULL_TURN_DEGREES = 360;

/** What {@link arcPath} takes: the ring, and the angular span one drawing covers. */
export interface ArcOptions {
  readonly cx: number;
  readonly cy: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

// Paths -------------------------------------------------------------------------------------------

/**
 * A coordinate at the precision every drawing in this folder carries.
 *
 * This is the one rounding the charts' coordinates go through, so a path and the mark model that places a
 * label beside it cannot state the same point at two precisions. A coordinate is
 * {@link COORDINATE_DECIMALS} decimals, and either signed zero is written `0`.
 *
 * @param value - The coordinate, in the frame's own coordinate system.
 * @returns The coordinate, rounded.
 */
export const roundCoordinate = (value: number): number =>
  normalizeZero(Number(value.toFixed(COORDINATE_DECIMALS)));

/**
 * The `d` of a polyline: one `M` and then `L`s, so a single point draws a zero-length move and no points
 * draw nothing at all. A point with a non-finite coordinate is dropped rather than written into the path as
 * `NaN`, which would invalidate the whole `d`.
 */
export const buildLinePath = (points: readonly Point2D[]): string =>
  points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(
      (point, index) => `${index === 0 ? "M" : "L"}${coordinate(point.x)},${coordinate(point.y)}`,
    )
    .join("");

/** The `d` of the band an area encloses: the polyline, out to `baselineY` and back, closed; no finite point or a non-finite baseline gives `""`. */
export const buildAreaPath = (points: readonly Point2D[], baselineY: number): string => {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length === 0 || !Number.isFinite(baselineY)) return "";
  const first = finite[0];
  const last = finite[finite.length - 1];
  const edge = coordinate(baselineY);
  return `${buildLinePath(finite)}L${coordinate(last.x)},${edge}L${coordinate(first.x)},${edge}Z`;
};

/** The point `radius` away from `(cx, cy)` at `angleDeg`, measured clockwise from the top of the circle. */
export const polarToCartesian = (
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): Point2D => {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
};

/**
 * The `d` of one ring segment. A sweep of a full turn or more draws a closed ring rather than a malformed
 * one, and an `innerRadius` of `0` draws a wedge out to the centre. A zero or non-finite outer radius, a
 * negative or non-finite inner radius, an inner radius at or beyond the outer one, a non-finite centre,
 * angle or radius, or a zero sweep, gives `""`, because there is no ring to draw.
 */
export function arcPath(options: ArcOptions): string {
  const { cx, cy, outerRadius, innerRadius, startAngle, endAngle } = options;
  const measurable =
    Number.isFinite(cx) &&
    Number.isFinite(cy) &&
    Number.isFinite(outerRadius) &&
    Number.isFinite(innerRadius) &&
    Number.isFinite(startAngle) &&
    Number.isFinite(endAngle);
  if (!measurable || outerRadius <= 0 || innerRadius < 0) return "";
  if (innerRadius > 0 && innerRadius >= outerRadius) return "";
  const sweep = endAngle - startAngle;
  if (sweep === 0) return "";
  if (Math.abs(sweep) >= FULL_TURN_DEGREES) return fullRingPath(cx, cy, outerRadius, innerRadius);
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const flag = sweep > 0 ? 1 : 0;
  const start = pointOf(polarToCartesian(cx, cy, outerRadius, startAngle));
  const outerArc = `A${coordinate(outerRadius)},${coordinate(outerRadius)} 0 ${largeArc},${flag} `;
  const outerEnd = pointOf(polarToCartesian(cx, cy, outerRadius, endAngle));
  if (innerRadius === 0)
    return `M${start}${outerArc}${outerEnd}L${coordinate(cx)},${coordinate(cy)}Z`;
  const innerArc = `A${coordinate(innerRadius)},${coordinate(innerRadius)} 0 ${largeArc},${flag === 1 ? 0 : 1} `;
  const innerEnd = pointOf(polarToCartesian(cx, cy, innerRadius, endAngle));
  const innerStart = pointOf(polarToCartesian(cx, cy, innerRadius, startAngle));
  return `M${start}${outerArc}${outerEnd}L${innerEnd}${innerArc}${innerStart}Z`;
}

/** A closed ring as two half arcs out and two back, because one arc cannot close on the point it starts from. */
const fullRingPath = (cx: number, cy: number, outerRadius: number, innerRadius: number): string => {
  const outerTop = pointOf(polarToCartesian(cx, cy, outerRadius, 0));
  const outerBottom = pointOf(polarToCartesian(cx, cy, outerRadius, 180));
  const outerArc = `A${coordinate(outerRadius)},${coordinate(outerRadius)} 0 1,1 `;
  if (innerRadius <= 0) return `M${outerTop}${outerArc}${outerBottom}${outerArc}${outerTop}Z`;
  const innerTop = pointOf(polarToCartesian(cx, cy, innerRadius, 0));
  const innerBottom = pointOf(polarToCartesian(cx, cy, innerRadius, 180));
  const innerArc = `A${coordinate(innerRadius)},${coordinate(innerRadius)} 0 1,0 `;
  return `M${outerTop}${outerArc}${outerBottom}${outerArc}${outerTop}L${innerTop}${innerArc}${innerBottom}${innerArc}${innerTop}Z`;
};
