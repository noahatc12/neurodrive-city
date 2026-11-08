/**
 * Traffic light marking helpers: which junction a light guards, and whether an
 * approaching car must stop for its current colour.
 * @module engine/markings/light
 */
import type { Graph } from '../graph/graph.ts';
import type { Point } from '../graph/point.ts';
import type { Marking } from './marking.ts';

export type LightColor = 'green' | 'yellow' | 'red';

/**
 * The graph point a light (or any lane marking) faces: travel on side +1 goes a→b, so
 * the light guards `b`; side -1 guards `a`.
 */
export function facedPoint(m: Marking, graph: Graph): Point | null {
  const s = graph.getSegment(m.binding.segmentId);
  if (!s) return null;
  return m.binding.side === -1 ? s.a : s.b;
}

/**
 * Distance along the segment from the marking to the point it faces (world units).
 */
export function distanceToFacedPoint(m: Marking, graph: Graph): number {
  const s = graph.getSegment(m.binding.segmentId);
  if (!s) return Infinity;
  const len = s.length();
  return m.binding.side === -1 ? m.binding.t * len : (1 - m.binding.t) * len;
}

/**
 * Stopping decision with stopping-distance logic:
 * - red: stop if the line is still ahead;
 * - yellow: stop only if the car can stop comfortably before the line
 *   (v² / 2a ≤ distance), otherwise clear the junction;
 * - green: go.
 */
export function mustStopForLight(
  color: LightColor,
  distToLine: number,
  speed: number,
  decel: number,
): boolean {
  if (distToLine < 0) return false;
  if (color === 'green') return false;
  if (color === 'red') return true;
  const stopping = (speed * speed) / (2 * Math.max(1e-6, decel));
  return stopping <= distToLine;
}
