/**
 * Renderer-independent picking (spec K11): given a world point (from the 2D viewport or
 * a 3D ray hitting the ground plane), find the car or marking under it.
 * @module app/picking
 */
import { resolveMarking } from '../engine/markings/marking.ts';
import type { SimHost } from '../engine/sim/host.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import type { PickResult } from './renderer.ts';

/** Cars within this distance of the point (world units) can be picked. */
export const CAR_PICK_RADIUS = 34;

/**
 * Picks the nearest active car within {@link CAR_PICK_RADIUS}, else the marking whose
 * footprint contains the point, else the ground.
 */
export function pickWorld(
  x: number,
  y: number,
  sim: SimHost | null,
  model: WorldModel | null,
): PickResult {
  if (sim) {
    let best = CAR_PICK_RADIUS * CAR_PICK_RADIUS;
    let id: number | null = null;
    for (const c of sim.cars) {
      if (!c.active) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < best) {
        best = d;
        id = c.id;
      }
    }
    if (id !== null) return { kind: 'car', id, world: { x, y } };
  }
  if (model && sim?.kind !== 'infinite') {
    const rw = model.settings.roadWidth;
    for (const m of model.markings.all()) {
      const r = resolveMarking(m, model.graph, rw);
      if (!r) continue;
      // local frame: along = direction, across = its perpendicular
      const dx = x - r.center.x;
      const dy = y - r.center.y;
      const along = dx * r.direction.x + dy * r.direction.y;
      const across = -dx * r.direction.y + dy * r.direction.x;
      if (Math.abs(along) <= r.height / 2 && Math.abs(across) <= r.width / 2)
        return { kind: 'marking', id: m.id, world: { x, y } };
    }
  }
  return { kind: 'ground', id: null, world: { x, y } };
}
