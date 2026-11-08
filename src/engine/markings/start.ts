/**
 * Start markings (spec D6): spawn poses for AI and traffic cars. Several starts are
 * allowed; the population is distributed across them round-robin.
 * @module engine/markings/start
 */
import type { Graph } from '../graph/graph.ts';
import { resolveMarking, type Marking } from './marking.ts';

export interface SpawnPose {
  x: number;
  y: number;
  /** Car heading (0 = up, positive turns left), see car kinematics. */
  angle: number;
}

/** Converts a travel direction vector into the car heading convention (0 = -y, CCW +). */
export function headingFromDirection(dx: number, dy: number): number {
  // car forward vector is (-sin a, -cos a)  ⇒  a = atan2(-dx, -dy)
  return Math.atan2(-dx, -dy);
}

/** Spawn poses for all start markings (in marking id order). */
export function spawnPoses(
  starts: readonly Marking[],
  graph: Graph,
  roadWidth: number,
): SpawnPose[] {
  const out: SpawnPose[] = [];
  for (const m of [...starts].sort((a, b) => a.id - b.id)) {
    const r = resolveMarking(m, graph, roadWidth);
    if (r)
      out.push({
        x: r.center.x,
        y: r.center.y,
        angle: headingFromDirection(r.direction.x, r.direction.y),
      });
  }
  return out;
}

/** Round-robin pose for car `index` (null when there are no starts). */
export function spawnFor(index: number, poses: readonly SpawnPose[]): SpawnPose | null {
  return poses.length === 0 ? null : (poses[index % poses.length] ?? null);
}
