/**
 * Segment / segment and ray / segment intersection.
 *
 * Both segments are written parametrically:
 *
 * ```
 *   P(t) = A + t·r,  r = B - A,  t ∈ [0, 1]
 *   Q(u) = C + u·s,  s = D - C,  u ∈ [0, 1]
 *
 *   A + t·r = C + u·s   ⇒   t = ((C - A) × s) / (r × s)
 *                           u = ((C - A) × r) / (r × s)
 * ```
 *
 * where × is the 2D cross product. `r × s = 0` means the segments are parallel.
 *
 * Tolerances (documented, see DECISIONS.md):
 * - `PARAM_EPS = 1e-9`: t and u may overshoot [0, 1] by this much and still count,
 *   so segments that touch exactly at endpoints intersect despite rounding.
 * - Parallel test is relative: |r × s| ≤ 1e-12·|r|·|s| (the sine of the angle between
 *   the segments is below 1e-12).
 * - Collinear test: the distance from C to line AB is ≤ 1e-9·max(1, |r|) world units.
 * - Zero-length segments never intersect anything (they have no direction).
 *
 * @module engine/math/intersect
 */
import type { Vec2 } from './vec2.ts';

/** Parametric tolerance on t and u. */
export const PARAM_EPS = 1e-9;

/** Result of an intersection query. */
export interface Intersection {
  x: number;
  y: number;
  /** Parameter along the first segment (0 at A, 1 at B), a.k.a. the course's "offset". */
  offset: number;
  /** Parameter along the second segment (0 at C, 1 at D). */
  u: number;
}

/**
 * Intersection of segment AB with segment CD, or `null` when they do not meet.
 *
 * For collinear overlapping segments the returned point is the overlap point closest
 * to A (smallest `offset`), which is what a ray caster wants.
 */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Intersection | null {
  const out: Intersection = { x: 0, y: 0, offset: 0, u: 0 };
  return segmentIntersectionInto(out, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y) ? out : null;
}

/** Boolean form of {@link segmentIntersection}. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return segmentIntersectionInto(SCRATCH, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
}

const SCRATCH: Intersection = { x: 0, y: 0, offset: 0, u: 0 };

/**
 * Allocation-free core: writes the intersection into `out` and returns `true`, or
 * returns `false` (leaving `out` unspecified) when the segments do not meet.
 */
export function segmentIntersectionInto(
  out: Intersection,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const rLenSq = rx * rx + ry * ry;
  const sLenSq = sx * sx + sy * sy;
  if (rLenSq === 0 || sLenSq === 0) return false;

  const qx = cx - ax;
  const qy = cy - ay;
  const denom = rx * sy - ry * sx;
  const rLen = Math.sqrt(rLenSq);
  const sLen = Math.sqrt(sLenSq);

  if (Math.abs(denom) <= 1e-12 * rLen * sLen) {
    // Parallel. Collinear only if C lies on line AB.
    const distToLine = Math.abs(qx * ry - qy * rx) / rLen;
    if (distToLine > 1e-9 * Math.max(1, rLen)) return false;
    // Project C and D onto AB as parameters along r.
    const tc = (qx * rx + qy * ry) / rLenSq;
    const td = ((dx - ax) * rx + (dy - ay) * ry) / rLenSq;
    const lo = Math.max(0, Math.min(tc, td));
    const hi = Math.min(1, Math.max(tc, td));
    if (lo > hi + PARAM_EPS) return false;
    const t = Math.min(lo, 1);
    out.x = ax + rx * t;
    out.y = ay + ry * t;
    out.offset = t;
    out.u = ((out.x - cx) * sx + (out.y - cy) * sy) / sLenSq;
    return true;
  }

  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < -PARAM_EPS || t > 1 + PARAM_EPS || u < -PARAM_EPS || u > 1 + PARAM_EPS) return false;
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + rx * tc;
  out.y = ay + ry * tc;
  out.offset = tc;
  out.u = u < 0 ? 0 : u > 1 ? 1 : u;
  return true;
}

/**
 * Ray (as a finite segment from `origin` to `end`) against segment CD.
 * Returns the offset t ∈ [0, 1] along the ray, or -1 when there is no hit.
 * Allocation-free; this is the sensor hot path.
 */
export function raySegmentOffset(
  ox: number,
  oy: number,
  ex: number,
  ey: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  return segmentIntersectionInto(SCRATCH, ox, oy, ex, ey, cx, cy, dx, dy) ? SCRATCH.offset : -1;
}

/**
 * Closest point on segment AB to point P, as the parameter t ∈ [0, 1].
 * A zero-length segment returns 0.
 */
export function projectParam(p: Vec2, a: Vec2, b: Vec2): number {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const lenSq = rx * rx + ry * ry;
  if (lenSq === 0) return 0;
  const t = ((p.x - a.x) * rx + (p.y - a.y) * ry) / lenSq;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Distance from point P to segment AB. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const t = projectParam(p, a, b);
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  return Math.hypot(p.x - x, p.y - y);
}

/**
 * True shortest distance between segments AB and CD: 0 if they intersect, otherwise
 * the minimum of the four endpoint-to-segment distances (for non-intersecting
 * segments in 2D the closest pair always involves at least one endpoint).
 */
export function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}
