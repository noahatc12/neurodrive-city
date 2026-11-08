/**
 * Parking bays (spec D4): a route can target a parking marking; the car stops inside
 * the bay and is counted as parked.
 * @module engine/markings/parking
 */
import type { ResolvedMarking } from './marking.ts';

/** True when point (x, y) lies inside the bay rectangle (with a small margin). */
export function insideBay(bay: ResolvedMarking, x: number, y: number, margin = 0): boolean {
  const dx = x - bay.center.x;
  const dy = y - bay.center.y;
  const along = dx * bay.direction.x + dy * bay.direction.y;
  const across = -dx * bay.direction.y + dy * bay.direction.x;
  return Math.abs(along) <= bay.height / 2 + margin && Math.abs(across) <= bay.width / 2 + margin;
}
