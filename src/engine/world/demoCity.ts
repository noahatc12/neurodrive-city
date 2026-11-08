/**
 * Procedural demo city (spec B6): a jittered street grid with a few missing blocks, one
 * one-way street pair, and seeded randomness throughout, so the same seed always gives
 * the same city.
 * @module engine/world/demoCity
 */
import type { Point } from '../graph/point.ts';
import type { Segment } from '../graph/segment.ts';
import { Rng } from '../math/rng.ts';
import { WorldModel } from './worldModel.ts';

export interface DemoCityOptions {
  cols?: number;
  rows?: number;
  /** Block size in world units (centre to centre). */
  block?: number;
  /** Fraction of interior streets removed (keeping the graph connected). */
  removeFraction?: number;
  /** Fraction of the block size used as random point jitter. */
  jitter?: number;
}

export function generateDemoCity(seed: number, opts: DemoCityOptions = {}): WorldModel {
  const cols = opts.cols ?? 6;
  const rows = opts.rows ?? 5;
  const block = opts.block ?? 560;
  const jitter = (opts.jitter ?? 0.07) * block;
  const rng = new Rng(seed);
  const model = new WorldModel({
    seed,
    meta: { name: 'Demo City', createdAt: new Date(0).toISOString(), source: 'procedural' },
  });
  const g = model.graph;
  const grid: Point[][] = [];
  const x0 = (-(cols - 1) * block) / 2;
  const y0 = (-(rows - 1) * block) / 2;
  for (let r = 0; r < rows; r++) {
    const row: Point[] = [];
    for (let c = 0; c < cols; c++) {
      const edge = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      const j = edge ? jitter * 0.4 : jitter;
      row.push(g.addPoint(x0 + c * block + rng.range(-j, j), y0 + r * block + rng.range(-j, j)));
    }
    grid.push(row);
  }
  const at = (r: number, c: number): Point => (grid[r] as Point[])[c] as Point;
  const segs: Segment[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        const s = g.addSegment(at(r, c), at(r, c + 1));
        if (s) segs.push(s);
      }
      if (r + 1 < rows) {
        const s = g.addSegment(at(r, c), at(r + 1, c));
        if (s) segs.push(s);
      }
    }
  }

  // Remove a few interior streets for variety, never disconnecting the network.
  const removeCount = Math.floor(segs.length * (opts.removeFraction ?? 0.08));
  const candidates = rng.shuffle(segs.filter((s) => g.degree(s.a) > 2 && g.degree(s.b) > 2));
  let removed = 0;
  for (const s of candidates) {
    if (removed >= removeCount) break;
    if (g.degree(s.a) <= 2 || g.degree(s.b) <= 2) continue;
    const flags = s.flags();
    const { a, b, id } = s;
    g.removeSegment(s);
    if (isConnected(model)) removed++;
    else g.restoreSegment(id, a.id, b.id, flags);
  }

  // One one-way street: the middle row's first two blocks, eastbound.
  const midRow = Math.floor(rows / 2);
  for (let c = 0; c < Math.min(2, cols - 1); c++) {
    const s = g.findSegment(at(midRow, c), at(midRow, c + 1));
    if (s) g.setSegmentFlags(s, { oneWay: true });
  }
  return model;
}

/** True when every point with a segment is reachable from the first one. */
export function isConnected(model: WorldModel): boolean {
  const g = model.graph;
  const pts = g.points.filter((p) => g.degree(p) > 0);
  const start = pts[0];
  if (!start) return true;
  const seen = new Set<number>([start.id]);
  const stack: Point[] = [start];
  while (stack.length > 0) {
    const p = stack.pop() as Point;
    for (const s of g.segmentsWithPoint(p)) {
      const q = s.other(p);
      if (!seen.has(q.id)) {
        seen.add(q.id);
        stack.push(q);
      }
    }
  }
  return seen.size === pts.length;
}
