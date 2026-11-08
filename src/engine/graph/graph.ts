/**
 * Spatial road graph: points and undirected segments with stable integer ids.
 *
 * Every mutation bumps {@link Graph.version}; consumers (world generation, renderers,
 * minimap caches) compare versions instead of hashing JSON every frame. Mutations also
 * emit {@link GraphEvent}s so indexes can update incrementally, and an internal spatial
 * hash keeps nearest-point / nearest-segment picking fast in large (OSM) graphs.
 *
 * @module engine/graph/graph
 */
import { segmentBBox } from '../math/bbox.ts';
import { projectParam } from '../math/intersect.ts';
import type { Vec2 } from '../math/vec2.ts';
import { Point } from './point.ts';
import { Segment, type SegmentFlags } from './segment.ts';
import { SpatialHash } from './spatialHash.ts';

/** Change notifications emitted after each mutation. */
export type GraphEvent =
  | { readonly type: 'point-added'; readonly point: Point }
  | { readonly type: 'point-removed'; readonly point: Point }
  | { readonly type: 'point-moved'; readonly point: Point; readonly from: Vec2 }
  | { readonly type: 'segment-added'; readonly segment: Segment }
  | { readonly type: 'segment-removed'; readonly segment: Segment }
  | { readonly type: 'segment-changed'; readonly segment: Segment }
  | {
      readonly type: 'segment-split';
      readonly segment: Segment;
      readonly t: number;
      readonly point: Point;
      readonly first: Segment;
      readonly second: Segment;
    }
  | { readonly type: 'cleared' };

export type GraphListener = (event: GraphEvent) => void;

/** Result of {@link Graph.nearestSegment}. */
export interface SegmentHit {
  segment: Segment;
  /** Parameter along the segment (0 at a, 1 at b). */
  t: number;
  /** Closest point on the segment. */
  point: Vec2;
  distance: number;
}

/** Result of {@link Graph.removePoint}: everything that was removed. */
export interface RemovedPoint {
  point: Point;
  segments: Segment[];
}

/** Minimum segment length; shorter segments are rejected as degenerate. */
export const MIN_SEGMENT_LENGTH = 1e-6;

export class Graph {
  private readonly pointMap = new Map<number, Point>();
  private readonly segmentMap = new Map<number, Segment>();
  /** point id → ids of segments touching it */
  private readonly adjacency = new Map<number, Set<number>>();
  private readonly pointIndex: SpatialHash;
  private readonly segmentIndex: SpatialHash;
  private readonly listeners = new Set<GraphListener>();
  private nextPointId = 0;
  private nextSegmentId = 0;
  private _version = 0;
  private readonly scratch: number[] = [];
  private pointCache: Point[] = [];
  private pointCacheVersion = -1;
  private segmentCache: Segment[] = [];
  private segmentCacheVersion = -1;

  /** @param cellSize spatial-hash cell size for picking (world units) */
  constructor(cellSize = 250) {
    this.pointIndex = new SpatialHash(cellSize);
    this.segmentIndex = new SpatialHash(cellSize);
  }

  /** Incremented on every mutation. */
  get version(): number {
    return this._version;
  }

  /**
   * Points in insertion order. The array is cached and rebuilt only after a mutation,
   * so per-frame iteration allocates nothing. Do not hold on to it across edits.
   */
  get points(): readonly Point[] {
    if (this.pointCacheVersion !== this._version) {
      this.pointCache = [...this.pointMap.values()];
      this.pointCacheVersion = this._version;
    }
    return this.pointCache;
  }

  /** Segments in insertion order (cached like {@link points}). */
  get segments(): readonly Segment[] {
    if (this.segmentCacheVersion !== this._version) {
      this.segmentCache = [...this.segmentMap.values()];
      this.segmentCacheVersion = this._version;
    }
    return this.segmentCache;
  }

  get pointCount(): number {
    return this.pointMap.size;
  }

  get segmentCount(): number {
    return this.segmentMap.size;
  }

  /** Subscribes to mutations; returns an unsubscribe function. */
  onChange(listener: GraphListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPoint(id: number): Point | undefined {
    return this.pointMap.get(id);
  }

  getSegment(id: number): Segment | undefined {
    return this.segmentMap.get(id);
  }

  /** Adds a point and returns it. Points are not de-duplicated by location here. */
  addPoint(x: number, y: number): Point {
    return this.insertPoint(this.nextPointId++, x, y);
  }

  /**
   * Re-inserts a point with a specific id (used by undo and deserialization).
   * @throws if the id is already in use
   */
  restorePoint(id: number, x: number, y: number): Point {
    if (this.pointMap.has(id)) throw new Error(`point id ${id} already exists`);
    this.nextPointId = Math.max(this.nextPointId, id + 1);
    return this.insertPoint(id, x, y);
  }

  /** True if a point exists within `eps` of (x, y). */
  containsPointAt(x: number, y: number, eps = 1e-9): boolean {
    const hit = this.nearestPoint(x, y, eps);
    return hit !== null;
  }

  /**
   * Adds segment a-b. Returns `null` (and changes nothing) for self-loops, zero-length
   * segments, unknown points, or a duplicate in either direction.
   */
  addSegment(a: Point, b: Point, flags: Partial<SegmentFlags> = {}): Segment | null {
    if (!this.canConnect(a, b)) return null;
    return this.insertSegment(this.nextSegmentId++, a, b, flags);
  }

  /**
   * Re-inserts a segment with a specific id (undo / deserialization).
   * @throws if the id is in use or the segment would be invalid
   */
  restoreSegment(id: number, aId: number, bId: number, flags: Partial<SegmentFlags> = {}): Segment {
    if (this.segmentMap.has(id)) throw new Error(`segment id ${id} already exists`);
    const a = this.pointMap.get(aId);
    const b = this.pointMap.get(bId);
    if (!a || !b || !this.canConnect(a, b)) throw new Error(`cannot restore segment ${id}`);
    this.nextSegmentId = Math.max(this.nextSegmentId, id + 1);
    return this.insertSegment(id, a, b, flags);
  }

  /** Whether a segment a-b could be added. */
  canConnect(a: Point, b: Point): boolean {
    if (a.id === b.id) return false;
    if (this.pointMap.get(a.id) !== a || this.pointMap.get(b.id) !== b) return false;
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEGMENT_LENGTH) return false;
    return this.findSegment(a, b) === undefined;
  }

  /** The segment joining a and b in either direction, if any. */
  findSegment(a: Point, b: Point): Segment | undefined {
    const ids = this.adjacency.get(a.id);
    if (!ids) return undefined;
    for (const id of ids) {
      const s = this.segmentMap.get(id);
      if (s && s.connects(a, b)) return s;
    }
    return undefined;
  }

  /** Segments touching `p`. */
  segmentsWithPoint(p: Point): Segment[] {
    const ids = this.adjacency.get(p.id);
    if (!ids) return [];
    const out: Segment[] = [];
    for (const id of ids) {
      const s = this.segmentMap.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Number of segments touching `p`. */
  degree(p: Point): number {
    return this.adjacency.get(p.id)?.size ?? 0;
  }

  /** Removes a segment; returns false if it was not in the graph. */
  removeSegment(segment: Segment): boolean {
    if (this.segmentMap.get(segment.id) !== segment) return false;
    this.detachSegment(segment);
    this._version++;
    this.emit({ type: 'segment-removed', segment });
    return true;
  }

  /** Removes a point and (first) every segment touching it. */
  removePoint(point: Point): RemovedPoint | null {
    if (this.pointMap.get(point.id) !== point) return null;
    const removed = this.segmentsWithPoint(point);
    for (const s of removed) this.removeSegment(s);
    this.pointMap.delete(point.id);
    this.adjacency.delete(point.id);
    this.pointIndex.remove(point.id);
    this._version++;
    this.emit({ type: 'point-removed', point });
    return { point, segments: removed };
  }

  /** Moves a point; its segments follow because they reference it. */
  movePoint(point: Point, x: number, y: number): void {
    if (this.pointMap.get(point.id) !== point) return;
    if (point.x === x && point.y === y) return;
    const from = { x: point.x, y: point.y };
    point.x = x;
    point.y = y;
    this.pointIndex.update(point.id, { minX: x, minY: y, maxX: x, maxY: y });
    for (const s of this.segmentsWithPoint(point)) {
      this.segmentIndex.update(s.id, segmentBBox(s.a, s.b));
    }
    this._version++;
    this.emit({ type: 'point-moved', point, from });
  }

  /** Updates a segment's flags (one-way, bridge, tunnel). */
  setSegmentFlags(segment: Segment, flags: Partial<SegmentFlags>): void {
    if (this.segmentMap.get(segment.id) !== segment) return;
    if (flags.oneWay !== undefined) segment.oneWay = flags.oneWay;
    if (flags.bridge !== undefined) segment.bridge = flags.bridge;
    if (flags.tunnel !== undefined) segment.tunnel = flags.tunnel;
    this._version++;
    this.emit({ type: 'segment-changed', segment });
  }

  /**
   * Splits `segment` at parameter t ∈ (0, 1), inserting a new point. The two halves
   * keep the original flags and orientation (a → p → b). Returns null if t would
   * create a degenerate piece.
   */
  splitSegment(
    segment: Segment,
    t: number,
    ids?: { point: number; first: number; second: number },
  ): { point: Point; first: Segment; second: Segment } | null {
    if (this.segmentMap.get(segment.id) !== segment) return null;
    const len = segment.length();
    if (t * len < MIN_SEGMENT_LENGTH || (1 - t) * len < MIN_SEGMENT_LENGTH) return null;
    const { a, b } = segment;
    const flags = segment.flags();
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    this.detachSegment(segment);
    const pid = ids?.point ?? this.nextPointId++;
    const fid = ids?.first ?? this.nextSegmentId++;
    const sid = ids?.second ?? this.nextSegmentId++;
    this.nextPointId = Math.max(this.nextPointId, pid + 1);
    this.nextSegmentId = Math.max(this.nextSegmentId, fid + 1, sid + 1);
    const point = this.insertPoint(pid, x, y, false);
    const first = this.insertSegment(fid, a, point, flags, false);
    const second = this.insertSegment(sid, point, b, flags, false);
    this._version++;
    this.emit({ type: 'segment-split', segment, t, point, first, second });
    return { point, first, second };
  }

  /** Nearest point within `threshold` of (x, y), or null. */
  nearestPoint(x: number, y: number, threshold: number, exclude?: Point): Point | null {
    const ids = this.pointIndex.queryPoint(x, y, threshold, this.scratch);
    let best: Point | null = null;
    let bestD = threshold;
    for (const id of ids) {
      const p = this.pointMap.get(id);
      if (!p || p === exclude) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Nearest segment within `threshold` of (x, y), or null. */
  nearestSegment(x: number, y: number, threshold: number): SegmentHit | null {
    const ids = this.segmentIndex.queryPoint(x, y, threshold, this.scratch);
    let best: SegmentHit | null = null;
    const p = { x, y };
    for (const id of ids) {
      const s = this.segmentMap.get(id);
      if (!s) continue;
      const t = projectParam(p, s.a, s.b);
      const qx = s.a.x + (s.b.x - s.a.x) * t;
      const qy = s.a.y + (s.b.y - s.a.y) * t;
      const d = Math.hypot(qx - x, qy - y);
      if (d <= threshold && (!best || d < best.distance)) {
        best = { segment: s, t, point: { x: qx, y: qy }, distance: d };
      }
    }
    return best;
  }

  /** All segments within `threshold` of (x, y), nearest first. */
  segmentsNear(x: number, y: number, threshold: number): SegmentHit[] {
    const ids = this.segmentIndex.queryPoint(x, y, threshold, this.scratch);
    const out: SegmentHit[] = [];
    const p = { x, y };
    for (const id of ids) {
      const s = this.segmentMap.get(id);
      if (!s) continue;
      const t = projectParam(p, s.a, s.b);
      const qx = s.a.x + (s.b.x - s.a.x) * t;
      const qy = s.a.y + (s.b.y - s.a.y) * t;
      const d = Math.hypot(qx - x, qy - y);
      if (d <= threshold) out.push({ segment: s, t, point: { x: qx, y: qy }, distance: d });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** Points whose coordinates fall inside the rectangle (inclusive). */
  pointsInRect(minX: number, minY: number, maxX: number, maxY: number): Point[] {
    const out: Point[] = [];
    for (const id of this.pointIndex.queryRect(minX, minY, maxX, maxY, this.scratch)) {
      const p = this.pointMap.get(id);
      if (p && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) out.push(p);
    }
    return out;
  }

  /**
   * Id-independent structural hash: two graphs with the same geometry and flags hash
   * equal even if their ids differ (e.g. after save → load).
   */
  hash(): string {
    const pts = this.points
      .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)
      .sort()
      .join(';');
    const segs = this.segments
      .map((s) => {
        const a = `${s.a.x.toFixed(6)},${s.a.y.toFixed(6)}`;
        const b = `${s.b.x.toFixed(6)},${s.b.y.toFixed(6)}`;
        // one-way segments are directional; others are canonicalised by ordering
        const key = s.oneWay || a < b ? `${a}>${b}` : `${b}>${a}`;
        return `${key}|${s.oneWay ? 1 : 0}${s.bridge ? 1 : 0}${s.tunnel ? 1 : 0}`;
      })
      .sort()
      .join(';');
    return fnv1a(`${pts}#${segs}`);
  }

  /** Structural equality (see {@link hash}). */
  equals(other: Graph): boolean {
    return (
      this.pointCount === other.pointCount &&
      this.segmentCount === other.segmentCount &&
      this.hash() === other.hash()
    );
  }

  /** Removes everything. Ids keep increasing (never reused). */
  dispose(): void {
    this.pointMap.clear();
    this.segmentMap.clear();
    this.adjacency.clear();
    this.pointIndex.clear();
    this.segmentIndex.clear();
    this._version++;
    this.emit({ type: 'cleared' });
  }

  private insertPoint(id: number, x: number, y: number, notify = true): Point {
    const p = new Point(id, x, y);
    this.pointMap.set(id, p);
    this.adjacency.set(id, new Set());
    this.pointIndex.insert(id, { minX: x, minY: y, maxX: x, maxY: y });
    if (notify) {
      this._version++;
      this.emit({ type: 'point-added', point: p });
    }
    return p;
  }

  private insertSegment(
    id: number,
    a: Point,
    b: Point,
    flags: Partial<SegmentFlags>,
    notify = true,
  ): Segment {
    const s = new Segment(id, a, b, flags);
    this.segmentMap.set(id, s);
    this.adjacency.get(a.id)?.add(id);
    this.adjacency.get(b.id)?.add(id);
    this.segmentIndex.insert(id, segmentBBox(a, b));
    if (notify) {
      this._version++;
      this.emit({ type: 'segment-added', segment: s });
    }
    return s;
  }

  private detachSegment(segment: Segment): void {
    this.segmentMap.delete(segment.id);
    this.adjacency.get(segment.a.id)?.delete(segment.id);
    this.adjacency.get(segment.b.id)?.delete(segment.id);
    this.segmentIndex.remove(segment.id);
  }

  private emit(event: GraphEvent): void {
    for (const l of this.listeners) l(event);
  }
}

/** 32-bit FNV-1a hash of a string, as 8 hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
