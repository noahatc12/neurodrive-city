/**
 * Snapping for the graph tool: existing points first (within a screen-pixel radius
 * converted to world units by the caller), then the optional grid.
 * @module editor/snapping
 */
import type { Graph } from '../engine/graph/graph.ts';
import type { Point } from '../engine/graph/point.ts';
import type { Vec2 } from '../engine/math/vec2.ts';

export type SnapKind = 'none' | 'grid' | 'point';

export interface SnapResult {
  x: number;
  y: number;
  kind: SnapKind;
  point: Point | null;
}

export interface SnapOptions {
  gridEnabled: boolean;
  /** Grid spacing in world units. */
  gridSize: number;
  /** Point snap radius in world units. */
  pointRadius: number;
  /** Points that must not be snapped to (e.g. the ones being dragged). */
  exclude?: ReadonlySet<number>;
}

/** Snaps a world position: nearest non-excluded point, else grid, else unchanged. */
export function snap(world: Vec2, graph: Graph, opts: SnapOptions): SnapResult {
  const r = opts.pointRadius;
  let best: Point | null = null;
  let bestD = r;
  for (const p of graph.pointsInRect(world.x - r, world.y - r, world.x + r, world.y + r)) {
    if (opts.exclude?.has(p.id)) continue;
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return { x: best.x, y: best.y, kind: 'point', point: best };
  if (opts.gridEnabled && opts.gridSize > 0) {
    return {
      x: Math.round(world.x / opts.gridSize) * opts.gridSize,
      y: Math.round(world.y / opts.gridSize) * opts.gridSize,
      kind: 'grid',
      point: null,
    };
  }
  return { x: world.x, y: world.y, kind: 'none', point: null };
}
