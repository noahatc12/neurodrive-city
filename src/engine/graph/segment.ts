/**
 * Undirected graph edge between two points, with road flags.
 * @module engine/graph/segment
 */
import { projectParam } from '../math/intersect.ts';
import type { Vec2 } from '../math/vec2.ts';
import type { Point } from './point.ts';

/** Per-segment road attributes. */
export interface SegmentFlags {
  /** Traffic flows only from `a` to `b`. */
  oneWay: boolean;
  /** Elevated road: no buildings are generated along it. */
  bridge: boolean;
  /** Underground road: no buildings are generated along it. */
  tunnel: boolean;
}

export const DEFAULT_FLAGS: Readonly<SegmentFlags> = Object.freeze({
  oneWay: false,
  bridge: false,
  tunnel: false,
});

export class Segment implements SegmentFlags {
  readonly id: number;
  readonly a: Point;
  readonly b: Point;
  oneWay: boolean;
  bridge: boolean;
  tunnel: boolean;

  constructor(id: number, a: Point, b: Point, flags: Partial<SegmentFlags> = {}) {
    this.id = id;
    this.a = a;
    this.b = b;
    this.oneWay = flags.oneWay ?? false;
    this.bridge = flags.bridge ?? false;
    this.tunnel = flags.tunnel ?? false;
  }

  /** Current length (points can move). */
  length(): number {
    return Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
  }

  /** Unit direction from a to b (zero vector for a degenerate segment). */
  direction(): Vec2 {
    const len = this.length();
    return len === 0
      ? { x: 0, y: 0 }
      : { x: (this.b.x - this.a.x) / len, y: (this.b.y - this.a.y) / len };
  }

  /** True if `p` is one of the endpoints (by id). */
  includes(p: Point): boolean {
    return this.a.id === p.id || this.b.id === p.id;
  }

  /** The endpoint that is not `p`. */
  other(p: Point): Point {
    return this.a.id === p.id ? this.b : this.a;
  }

  /** Same endpoints in either order. */
  connects(p: Point, q: Point): boolean {
    return (this.a.id === p.id && this.b.id === q.id) || (this.a.id === q.id && this.b.id === p.id);
  }

  /** Point at parameter t (0 = a, 1 = b). */
  pointAt(t: number): Vec2 {
    return { x: this.a.x + (this.b.x - this.a.x) * t, y: this.a.y + (this.b.y - this.a.y) * t };
  }

  /** Closest parameter t ∈ [0, 1] to `p`. */
  project(p: Vec2): number {
    return projectParam(p, this.a, this.b);
  }

  /** Distance from `p` to this segment. */
  distanceTo(p: Vec2): number {
    const q = this.pointAt(this.project(p));
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  /** Copy of the flags. */
  flags(): SegmentFlags {
    return { oneWay: this.oneWay, bridge: this.bridge, tunnel: this.tunnel };
  }
}
