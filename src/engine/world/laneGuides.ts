/**
 * Lane guides: the union of half-width envelopes. Its border segments run along the
 * lane centres (a quarter road width from the centre line), merging cleanly at
 * junctions. Used as a debug layer and as the lines markings conceptually sit on.
 * @module engine/world/laneGuides
 */
import type { Seg } from '../math/polygon.ts';
import { unionBorders, type ResolvedSegment } from './roads.ts';

export function laneGuides(
  segs: readonly ResolvedSegment[],
  roadWidth: number,
  roundness: number,
): Seg[] {
  return unionBorders(segs, roadWidth / 2, roundness);
}
