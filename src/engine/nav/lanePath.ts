/**
 * Turns a node route into a drivable lane polyline: each directed edge is offset a
 * quarter road width to the right (right-hand traffic), turns follow a circular arc
 * around the inner kerb corner, and dead ends get a U-turn semicircle.
 *
 * ```
 *        lane of edge 1 ──────────╮      arc of radius R around the
 *                                  ╰──╮   inner kerb corner ●
 *                                  ●  │ lane of edge 2
 * ```
 *
 * @module engine/nav/lanePath
 */
import type { Vec2 } from '../math/vec2.ts';

/**
 * Minimum distance (in road widths) between a turning path and an inner kerb corner.
 * A 30 × 50 car turning 90° sweeps about 29 units from its centre at the corner, so
 * 0.34 road widths (34 units at the default width) leaves a small margin.
 */
export const MIN_CORNER_RADIUS = 0.34;

export interface LanePath {
  /** Polyline points [x0, y0, x1, y1, ...]. */
  xy: Float64Array;
  /** Number of points. */
  count: number;
  /** Cumulative arc length at each point. */
  cum: Float64Array;
  /** Total length. */
  length: number;
  /** Route node ids (graph points) in order. */
  nodes: number[];
  /** Arc position of each route node's corner centre (NaN for the endpoints). */
  nodeArc: Float64Array;
}

/**
 * Builds the lane polyline for route nodes at `positions`.
 * @param start optional exact start (car position), prepended
 * @param end optional exact end (target), appended
 */
export function buildLanePath(
  nodes: readonly number[],
  positions: readonly Vec2[],
  roadWidth: number,
  start: Vec2 | null = null,
  end: Vec2 | null = null,
): LanePath {
  const pts: number[] = [];
  const nodeArcIdx: number[] = new Array<number>(nodes.length).fill(-1);
  const push = (x: number, y: number): void => {
    const n = pts.length;
    if (n >= 2 && Math.hypot(x - (pts[n - 2] as number), y - (pts[n - 1] as number)) < 0.5) return;
    pts.push(x, y);
  };
  const o = roadWidth / 4;
  if (start) push(start.x, start.y);
  const k = positions.length;
  if (k === 1) {
    const p = positions[0] as Vec2;
    push(p.x, p.y);
  }
  for (let i = 0; i + 1 < k; i++) {
    const a = positions[i] as Vec2;
    const b = positions[i + 1] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const rx = -uy * o;
    const ry = ux * o;
    // start of this edge's lane (corners handled at the previous node)
    if (i === 0) push(a.x + rx, a.y + ry);
    const next = positions[i + 2];
    if (!next) {
      push(b.x + rx, b.y + ry);
      continue;
    }
    const len2 = Math.hypot(next.x - b.x, next.y - b.y) || 1;
    const vx = (next.x - b.x) / len2;
    const vy = (next.y - b.y) / len2;
    const cos = ux * vx + uy * vy;
    const sx = -vy * o;
    const sy = vx * o;
    if (cos > 0.995) {
      // straight through
      nodeArcIdx[i + 1] = pts.length / 2;
      push(b.x + rx, b.y + ry);
    } else if (cos < -0.9) {
      // U-turn around the node: right lane → ahead → right lane of the reverse edge
      const a0 = Math.atan2(ry, rx);
      push(b.x + rx, b.y + ry);
      nodeArcIdx[i + 1] = pts.length / 2;
      // sweep through the forward direction (u): angle from r to -r passing u
      const forward = Math.atan2(uy, ux);
      let sweep = forward - a0;
      while (sweep <= -Math.PI) sweep += Math.PI * 2;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      const dir = sweep >= 0 ? 1 : -1;
      for (let s = 1; s <= 8; s++) {
        const ang = a0 + (dir * Math.PI * s) / 8;
        push(b.x + Math.cos(ang) * o, b.y + Math.sin(ang) * o);
      }
      push(b.x + sx, b.y + sy);
    } else {
      // Turn: a circular arc around the inner kerb corner on the turning side.
      //   right turn: corner = meeting point of the right road borders (w/2 to the
      //   right of both edges); the lanes are only w/4 from it, so the arc radius is
      //   raised to MIN_CORNER_RADIUS · w and the path bulges out slightly;
      //   left turn: corner on the left, 3w/4 from the lanes: a tangent quarter arc.
      const cross = ux * vy - uy * vx; // > 0: right turn in y-down space
      const side = cross > 0 ? 1 : -1;
      const half = roadWidth / 2;
      const denom = cross;
      const ax = b.x - uy * half * side;
      const ay = b.y + ux * half * side;
      const bx2 = b.x - vy * half * side;
      const by2 = b.y + vx * half * side;
      const tI = ((bx2 - ax) * vy - (by2 - ay) * vx) / denom;
      const ix = ax + ux * tI;
      const iy = ay + uy * tI;
      const laneDist = Math.abs(half * side - o);
      const R = Math.max(laneDist, roadWidth * MIN_CORNER_RADIUS);
      // feet of the perpendiculars from the corner onto both lanes
      const l1x = b.x + rx;
      const l1y = b.y + ry;
      const f1 = (ix - l1x) * ux + (iy - l1y) * uy; // along lane 1, relative to b
      const l2x = b.x + sx;
      const l2y = b.y + sy;
      const f2 = (ix - l2x) * vx + (iy - l2y) * vy; // along lane 2, relative to b
      const lead = R > laneDist + 0.5 ? Math.min(roadWidth * 0.6, len * 0.4) : 0;
      // approach on lane 1 up to the transition, then the arc, then lane 2
      if (lead > 0) push(l1x + ux * (f1 - lead), l1y + uy * (f1 - lead));
      const a0 = Math.atan2(l1y + uy * f1 - iy, l1x + ux * f1 - ix);
      const a1 = Math.atan2(l2y + vy * f2 - iy, l2x + vx * f2 - ix);
      let sweep = a1 - a0;
      while (sweep <= -Math.PI) sweep += Math.PI * 2;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
      for (let k = 0; k <= steps; k++) {
        if (k === Math.floor(steps / 2)) nodeArcIdx[i + 1] = pts.length / 2;
        const ang = a0 + (sweep * k) / steps;
        push(ix + Math.cos(ang) * R, iy + Math.sin(ang) * R);
      }
      if (lead > 0)
        push(
          l2x + vx * (f2 + Math.min(roadWidth * 0.6, len2 * 0.4)),
          l2y + vy * (f2 + Math.min(roadWidth * 0.6, len2 * 0.4)),
        );
    }
  }
  if (end) push(end.x, end.y);
  const count = pts.length / 2;
  const xy = Float64Array.from(pts);
  const cum = new Float64Array(count);
  for (let i = 1; i < count; i++) {
    cum[i] =
      (cum[i - 1] as number) +
      Math.hypot(
        (xy[i * 2] as number) - (xy[i * 2 - 2] as number),
        (xy[i * 2 + 1] as number) - (xy[i * 2 - 1] as number),
      );
  }
  const nodeArc = new Float64Array(nodes.length).fill(Number.NaN);
  nodeArcIdx.forEach((idx, i) => {
    if (idx >= 0 && idx < count) nodeArc[i] = cum[idx] as number;
  });
  return {
    xy,
    count,
    cum,
    length: count > 0 ? (cum[count - 1] as number) : 0,
    nodes: [...nodes],
    nodeArc,
  };
}

/**
 * Projects (x, y) onto the polyline, searching segments [from, to). Returns the arc
 * position and writes the lateral distance into `out[0]`. Allocation-free.
 */
export function projectOnPath(
  path: LanePath,
  x: number,
  y: number,
  from: number,
  to: number,
  out: Float64Array,
): number {
  let bestD = Infinity;
  let bestS = 0;
  const xy = path.xy;
  const lo = Math.max(0, from);
  const hi = Math.min(path.count - 1, to);
  for (let i = lo; i < hi; i++) {
    const ax = xy[i * 2] as number;
    const ay = xy[i * 2 + 1] as number;
    const bx = xy[i * 2 + 2] as number;
    const by = xy[i * 2 + 3] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      bestS = (path.cum[i] as number) + Math.sqrt(l2) * t;
    }
  }
  out[0] = bestD;
  return bestS;
}

/**
 * Like {@link projectOnPath}, plus the side of the path and its direction. Writes
 * `out = [distance, signedLateral, tx, ty]`:
 *
 * - `signedLateral`: the distance with a sign, positive to the right of travel (toward
 *   the kerb in right-hand traffic), negative to the left (toward oncoming traffic). In
 *   y-down space the right of a direction (tx, ty) is (−ty, tx).
 * - `(tx, ty)`: the unit tangent at the projection. Within half the shorter neighbouring
 *   segment of a vertex it blends toward the neighbour, so the tangent turns smoothly
 *   through the short segments of a corner arc instead of jumping at every vertex.
 *
 * Returns the arc position. Allocation-free; `out` needs four slots.
 */
export function projectOnPathSigned(
  path: LanePath,
  x: number,
  y: number,
  from: number,
  to: number,
  out: Float64Array,
): number {
  let bestD = Infinity;
  let bestS = 0;
  let bestI = -1;
  let bestT = 0;
  const xy = path.xy;
  const lo = Math.max(0, from);
  const hi = Math.min(path.count - 1, to);
  for (let i = lo; i < hi; i++) {
    const ax = xy[i * 2] as number;
    const ay = xy[i * 2 + 1] as number;
    const dx = (xy[i * 2 + 2] as number) - ax;
    const dy = (xy[i * 2 + 3] as number) - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < bestD) {
      bestD = d;
      bestI = i;
      bestT = t;
      bestS = (path.cum[i] as number) + Math.sqrt(l2) * t;
    }
  }
  if (bestI < 0) {
    out[0] = Infinity;
    out[1] = 0;
    out[2] = 0;
    out[3] = -1;
    return 0;
  }
  const i = bestI;
  const ax = xy[i * 2] as number;
  const ay = xy[i * 2 + 1] as number;
  const dx = (xy[i * 2 + 2] as number) - ax;
  const dy = (xy[i * 2 + 3] as number) - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // side from the segment's own direction: right of (ux, uy) is (−uy, ux)
  const side = (x - ax) * -uy + (y - ay) * ux;
  out[0] = bestD;
  out[1] = side < 0 ? -bestD : bestD;
  // smooth tangent near the vertices
  let tx = ux;
  let ty = uy;
  const along = bestT * len;
  if (i > 0 && along < len / 2) {
    const px = ax - (xy[i * 2 - 2] as number);
    const py = ay - (xy[i * 2 - 1] as number);
    const pl = Math.hypot(px, py);
    const blend = 0.5 * Math.min(len, pl);
    if (pl > 1e-9 && along < blend) {
      const w = 0.5 * (1 - along / blend);
      tx = tx * (1 - w) + (px / pl) * w;
      ty = ty * (1 - w) + (py / pl) * w;
    }
  } else if (i + 2 < path.count) {
    const nx = (xy[i * 2 + 4] as number) - (xy[i * 2 + 2] as number);
    const ny = (xy[i * 2 + 5] as number) - (xy[i * 2 + 3] as number);
    const nl = Math.hypot(nx, ny);
    const blend = 0.5 * Math.min(len, nl);
    const rest = len - along;
    if (nl > 1e-9 && rest < blend) {
      const w = 0.5 * (1 - rest / blend);
      tx = tx * (1 - w) + (nx / nl) * w;
      ty = ty * (1 - w) + (ny / nl) * w;
    }
  }
  const tl = Math.hypot(tx, ty) || 1;
  out[2] = tx / tl;
  out[3] = ty / tl;
  return bestS;
}

/** Point at arc position `s` (clamped), written into `out` [x, y]; returns the segment index. */
export function pointAt(path: LanePath, s: number, out: Float64Array, hint = 0): number {
  const n = path.count;
  if (n === 0) {
    out[0] = 0;
    out[1] = 0;
    return 0;
  }
  if (s <= 0 || n === 1) {
    out[0] = path.xy[0] as number;
    out[1] = path.xy[1] as number;
    return 0;
  }
  if (s >= path.length) {
    out[0] = path.xy[(n - 1) * 2] as number;
    out[1] = path.xy[(n - 1) * 2 + 1] as number;
    return n - 2;
  }
  let i = Math.max(0, Math.min(hint, n - 2));
  while (i > 0 && (path.cum[i] as number) > s) i--;
  while (i < n - 2 && (path.cum[i + 1] as number) < s) i++;
  const c0 = path.cum[i] as number;
  const c1 = path.cum[i + 1] as number;
  const t = c1 > c0 ? (s - c0) / (c1 - c0) : 0;
  out[0] =
    (path.xy[i * 2] as number) + ((path.xy[i * 2 + 2] as number) - (path.xy[i * 2] as number)) * t;
  out[1] =
    (path.xy[i * 2 + 1] as number) +
    ((path.xy[i * 2 + 3] as number) - (path.xy[i * 2 + 1] as number)) * t;
  return i;
}
