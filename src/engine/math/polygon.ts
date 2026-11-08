/**
 * Polygon utilities: containment, intersection, distance, splitting and the union of
 * many polygons into a set of border segments.
 *
 * Polygons are simple (non self-intersecting) and may be convex or concave, in either
 * winding order. Inputs are never mutated; every function returns new data.
 *
 * @module engine/math/polygon
 */
import { SpatialHash } from '../graph/spatialHash.ts';
import { bboxOf, bboxOverlap, type BBox } from './bbox.ts';
import {
  PARAM_EPS,
  pointSegmentDistance,
  segmentSegmentDistance,
  segmentsIntersect,
} from './intersect.ts';
import type { Vec2 } from './vec2.ts';

/** A geometric segment (not a graph edge). */
export interface Seg {
  readonly a: Vec2;
  readonly b: Vec2;
}

/** Pieces shorter than this (world units) are dropped when splitting. */
export const MIN_PIECE_LENGTH = 1e-6;

/**
 * Immutable polygon with cached edges and bounding box.
 * The point array is copied, so later changes to the caller's array have no effect.
 */
export class Polygon {
  readonly points: readonly Vec2[];
  readonly segments: readonly Seg[];
  readonly bbox: BBox;
  /** Signed shoelace area; > 0 means the interior is on the (-dy, dx) side of edges. */
  readonly signedArea: number;

  constructor(points: readonly Vec2[]) {
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    const segs: Seg[] = [];
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      segs.push({ a: this.points[i] as Vec2, b: this.points[(i + 1) % n] as Vec2 });
    }
    this.segments = segs;
    this.bbox = bboxOf(this.points);
    this.signedArea = polygonSignedArea(this.points);
  }

  /** Absolute area. */
  get area(): number {
    return Math.abs(this.signedArea);
  }
}

/** Shoelace signed area (sum of x_i·y_{i+1} - x_{i+1}·y_i, halved). */
export function polygonSignedArea(points: readonly Vec2[]): number {
  let s = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i] as Vec2;
    const q = points[(i + 1) % n] as Vec2;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/**
 * Point-in-polygon by ray casting.
 *
 * A horizontal ray is cast from `p` to a point beyond the right edge of the polygon's
 * bounding box and edge crossings are counted (odd = inside). Crossings exactly through
 * a vertex are handled with the half-open rule: an edge counts only if one endpoint is
 * strictly above the ray and the other is on or below it. A vertex touched by the ray is
 * then counted once when the boundary passes through it and zero or two times when the
 * boundary only touches it, which is exactly right.
 *
 * ```
 *        ●              ● vertex on the ray, boundary passes through: counted once
 *   p ──/───────\──▶    ▲ vertex on the ray, boundary only touches:    counted 0 or 2
 *      /    ▲    \
 * ```
 *
 * Points exactly on the boundary may report either value.
 */
export function polygonContainsPoint(poly: Polygon, p: Vec2): boolean {
  const b = poly.bbox;
  if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return false;
  return pointInRing(poly.points, p.x, p.y);
}

/** Allocation-free ring test used by {@link polygonContainsPoint}. */
export function pointInRing(points: readonly Vec2[], x: number, y: number): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = points[i] as Vec2;
    const pj = points[j] as Vec2;
    if (pi.y > y !== pj.y > y) {
      const xCross = pj.x + ((y - pj.y) * (pi.x - pj.x)) / (pi.y - pj.y);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** True if any edge of `a` crosses any edge of `b`, or one polygon contains the other. */
export function polygonsIntersect(a: Polygon, b: Polygon): boolean {
  if (!bboxOverlap(a.bbox, b.bbox)) return false;
  for (const s1 of a.segments) {
    for (const s2 of b.segments) {
      if (segmentsTouch(s1, s2)) return true;
    }
  }
  const pa = a.points[0];
  const pb = b.points[0];
  return (
    (pa !== undefined && polygonContainsPoint(b, pa)) ||
    (pb !== undefined && polygonContainsPoint(a, pb))
  );
}

/**
 * Shortest distance between two polygons' boundaries: 0 if they intersect or one
 * contains the other, otherwise the minimum true segment-to-segment distance.
 */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (polygonsIntersect(a, b)) return 0;
  let best = Infinity;
  for (const s1 of a.segments) {
    for (const s2 of b.segments) {
      const d = segmentSegmentDistance(s1.a, s1.b, s2.a, s2.b);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Distance from a point to the polygon: 0 inside, else distance to the nearest edge. */
export function polygonPointDistance(poly: Polygon, p: Vec2): number {
  if (polygonContainsPoint(poly, p)) return 0;
  let best = Infinity;
  for (const s of poly.segments) {
    const d = pointSegmentDistance(p, s.a, s.b);
    if (d < best) best = d;
  }
  return best;
}

/** Where a segment lies relative to a polygon. */
export type SegmentClass = 'inside' | 'outside' | 'crossing';

/**
 * Classifies segment AB against `poly`. Unlike a midpoint test, a segment that is only
 * partly inside is reported as `'crossing'`: AB is split at every proper intersection
 * with the polygon's edges and each piece is tested on its own.
 */
export function classifySegment(a: Vec2, b: Vec2, poly: Polygon): SegmentClass {
  const ts = splitParams(a, b, poly.segments);
  const cuts = [0, ...ts, 1];
  let sawIn = false;
  let sawOut = false;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t = ((cuts[i] as number) + (cuts[i + 1] as number)) / 2;
    const inside = polygonContainsPoint(poly, {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    if (inside) sawIn = true;
    else sawOut = true;
  }
  return sawIn && sawOut ? 'crossing' : sawIn ? 'inside' : 'outside';
}

/**
 * Sorted, de-duplicated parameters t ∈ (0, 1) where AB is cut by the given edges.
 * Collinear overlaps contribute both overlap ends. Endpoint touches (t ≈ 0 or 1) are
 * ignored, so no zero-length piece can result.
 */
export function splitParams(a: Vec2, b: Vec2, edges: readonly Seg[]): number[] {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const rLenSq = rx * rx + ry * ry;
  if (rLenSq === 0) return [];
  const rLen = Math.sqrt(rLenSq);
  const minT = MIN_PIECE_LENGTH / rLen;
  const segMinX = Math.min(a.x, b.x);
  const segMaxX = Math.max(a.x, b.x);
  const segMinY = Math.min(a.y, b.y);
  const segMaxY = Math.max(a.y, b.y);
  const ts: number[] = [];
  const push = (t: number): void => {
    if (t > minT && t < 1 - minT) ts.push(t);
  };
  for (const e of edges) {
    const c = e.a;
    const d = e.b;
    if (
      Math.max(c.x, d.x) < segMinX ||
      Math.min(c.x, d.x) > segMaxX ||
      Math.max(c.y, d.y) < segMinY ||
      Math.min(c.y, d.y) > segMaxY
    ) {
      continue;
    }
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const sLenSq = sx * sx + sy * sy;
    if (sLenSq === 0) continue;
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) <= 1e-12 * rLen * Math.sqrt(sLenSq)) {
      const distToLine = Math.abs(qx * ry - qy * rx) / rLen;
      if (distToLine > 1e-9 * Math.max(1, rLen)) continue;
      push((qx * rx + qy * ry) / rLenSq);
      push(((d.x - a.x) * rx + (d.y - a.y) * ry) / rLenSq);
      continue;
    }
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * ry - qy * rx) / denom;
    if (u < -PARAM_EPS || u > 1 + PARAM_EPS) continue;
    push(t);
  }
  ts.sort((p, q) => p - q);
  // de-duplicate cut points that would create sub-MIN_PIECE_LENGTH pieces
  const out: number[] = [];
  for (const t of ts) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > minT) out.push(t);
  }
  return out;
}

/** Cuts AB at the given sorted parameters into new segments. */
function cutSegment(a: Vec2, b: Vec2, ts: readonly number[]): Seg[] {
  const pieces: Seg[] = [];
  let prev: Vec2 = { x: a.x, y: a.y };
  for (const t of ts) {
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    pieces.push({ a: prev, b: p });
    prev = p;
  }
  pieces.push({ a: prev, b: { x: b.x, y: b.y } });
  return pieces;
}

/**
 * Splits every polygon edge at its intersections with the edges of the *other*
 * polygons. Returns, per input polygon, a fresh list of segments. Never mutates the
 * inputs and never produces pieces shorter than {@link MIN_PIECE_LENGTH}.
 */
export function breakAtIntersections(polys: readonly Polygon[]): Seg[][] {
  const hash = buildPolygonHash(polys);
  const candidates: number[] = [];
  return polys.map((poly, i) => {
    hash.query(poly.bbox, candidates);
    const others: Seg[] = [];
    for (const j of candidates) {
      const other = polys[j];
      if (j !== i && other && bboxOverlap(poly.bbox, other.bbox)) others.push(...other.segments);
    }
    const out: Seg[] = [];
    for (const s of poly.segments) out.push(...cutSegment(s.a, s.b, splitParams(s.a, s.b, others)));
    return out;
  });
}

/** Options for {@link unionPolygons}. */
export interface UnionOptions {
  /** Called with progress in [0, 1] (used by worker generation's progress bar). */
  onProgress?: (fraction: number) => void;
}

/**
 * Union of many polygons, returned as the border segments of the merged shape.
 *
 * For each polygon, its edges are split where other polygons cross them, then each
 * piece is kept only if it lies outside every other polygon. "Outside" is decided by
 * probing a point a hair outward from the piece's midpoint (along the polygon's outward
 * normal) rather than the midpoint itself, so pieces that coincide with another
 * polygon's edge are handled: opposite-facing shared edges are interior (dropped), and
 * same-facing duplicates keep exactly one copy.
 *
 * Candidate pairs are pre-filtered with a spatial hash plus bounding-box overlap, so the
 * cost grows with the number of *touching* polygons rather than n².
 */
export function unionPolygons(polys: readonly Polygon[], options: UnionOptions = {}): Seg[] {
  const hash = buildPolygonHash(polys);
  const candidates: number[] = [];
  const result: Seg[] = [];
  const reportEvery = Math.max(1, Math.floor(polys.length / 20));

  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i] as Polygon;
    hash.query(poly.bbox, candidates);
    const others: Polygon[] = [];
    const otherIdx: number[] = [];
    const otherEdges: Seg[] = [];
    for (const j of candidates) {
      const other = polys[j];
      if (j === i || !other || !bboxOverlap(poly.bbox, other.bbox)) continue;
      others.push(other);
      otherIdx.push(j);
      otherEdges.push(...other.segments);
    }
    const outwardSign = poly.signedArea >= 0 ? 1 : -1;

    for (const s of poly.segments) {
      const pieces =
        otherEdges.length > 0
          ? cutSegment(s.a, s.b, splitParams(s.a, s.b, otherEdges))
          : [{ a: s.a, b: s.b }];
      for (const piece of pieces) {
        if (others.length === 0 || keepPiece(piece, outwardSign, others, otherIdx, i)) {
          result.push(piece);
        }
      }
    }
    if (options.onProgress && i % reportEvery === 0) options.onProgress(i / polys.length);
  }
  options.onProgress?.(1);
  return result;
}

/** Decides whether a piece of polygon `self` is on the union's outer border. */
function keepPiece(
  piece: Seg,
  outwardSign: number,
  others: readonly Polygon[],
  otherIdx: readonly number[],
  self: number,
): boolean {
  const dx = piece.b.x - piece.a.x;
  const dy = piece.b.y - piece.a.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_PIECE_LENGTH) return false;
  // outward normal = sign * (dy, -dx) / len  (interior is on (-dy, dx) for positive area)
  const nx = (outwardSign * dy) / len;
  const ny = (outwardSign * -dx) / len;
  const delta = Math.min(1e-2, len * 0.1);
  const mx = (piece.a.x + piece.b.x) / 2;
  const my = (piece.a.y + piece.b.y) / 2;
  const outX = mx + nx * delta;
  const outY = my + ny * delta;
  const inX = mx - nx * delta;
  const inY = my - ny * delta;
  for (let k = 0; k < others.length; k++) {
    const o = others[k] as Polygon;
    if (pointInBox(o.bbox, outX, outY) && pointInRing(o.points, outX, outY)) return false;
    // Same-facing coincident edge: inner side inside `o`, outer side outside it.
    // Keep only the copy from the lower polygon index.
    if (
      (otherIdx[k] as number) < self &&
      pointInBox(o.bbox, inX, inY) &&
      pointInRing(o.points, inX, inY) &&
      polygonEdgeDistance(o, mx, my) < delta * 0.5
    ) {
      return false;
    }
  }
  return true;
}

function pointInBox(b: BBox, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

function polygonEdgeDistance(poly: Polygon, x: number, y: number): number {
  let best = Infinity;
  const p = { x, y };
  for (const s of poly.segments) {
    const d = pointSegmentDistance(p, s.a, s.b);
    if (d < best) best = d;
  }
  return best;
}

/** Spatial hash over polygon bounding boxes with a cell size near the average size. */
function buildPolygonHash(polys: readonly Polygon[]): SpatialHash {
  let total = 0;
  for (const p of polys) total += Math.max(p.bbox.maxX - p.bbox.minX, p.bbox.maxY - p.bbox.minY);
  const cell = polys.length > 0 ? Math.max(1, total / polys.length) : 1;
  const hash = new SpatialHash(cell);
  polys.forEach((p, i) => hash.insert(i, p.bbox));
  return hash;
}

/** True if two segments intersect or touch. */
function segmentsTouch(s1: Seg, s2: Seg): boolean {
  return segmentsIntersect(s1.a, s1.b, s2.a, s2.b);
}
