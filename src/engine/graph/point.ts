/**
 * Graph vertex with a stable integer id.
 * @module engine/graph/point
 */
import type { Vec2 } from '../math/vec2.ts';

export class Point implements Vec2 {
  /** Stable id, unique within its graph, never reused while the graph lives. */
  readonly id: number;
  x: number;
  y: number;

  constructor(id: number, x: number, y: number) {
    this.id = id;
    this.x = x;
    this.y = y;
  }

  /** True when both coordinates match within `eps`. */
  sameLocation(other: Vec2, eps = 1e-9): boolean {
    return Math.abs(this.x - other.x) <= eps && Math.abs(this.y - other.y) <= eps;
  }
}
