/**
 * Tree placement by rejection sampling.
 *
 * A candidate point inside the padded world bounds is accepted only if it is
 * - outside every road band (road + sidewalk, tested as distance to the centre
 *   segment) and every building polygon, with clearance;
 * - not too close to another tree;
 * - near *something* (a road or building), so forests hug the city instead of
 *   filling empty voids.
 *
 * The count is capped by area and density. Each tree's canopy shape (radius noise per
 * level and angle) is computed once here from the seed and cached in the data.
 *
 * @module engine/world/trees
 */
import { SpatialHash } from '../graph/spatialHash.ts';
import { emptyBBox, padBBox, segmentBBox, unionBBox, type BBox } from '../math/bbox.ts';
import { pointSegmentDistance } from '../math/intersect.ts';
import { polygonPointDistance, type Polygon } from '../math/polygon.ts';
import type { Rng } from '../math/rng.ts';
import type { ResolvedSegment } from './roads.ts';
import type { WorldSettings } from './settings.ts';
import { TREE_LEVELS, TREE_STEPS, type TreeData, type TreeSpecies } from './types.ts';

export const MAX_TREES = 2500;

export function generateTrees(
  roads: readonly ResolvedSegment[],
  /** Half-width of the no-tree band around road centre lines (road + sidewalk). */
  roadHalfWidth: number,
  buildings: readonly Polygon[],
  settings: Readonly<WorldSettings>,
  rng: Rng,
): TreeData[] {
  const { treeSize, treeDensity } = settings;
  if (roads.length === 0 || treeDensity <= 0) return [];
  let bounds: BBox = emptyBBox();
  for (const r of roads) unionBBox(bounds, segmentBBox(r.a, r.b));
  for (const b of buildings) unionBBox(bounds, b.bbox);
  bounds = padBBox(bounds, roadHalfWidth + treeSize);
  const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const maxTrees = Math.min(
    MAX_TREES,
    Math.floor((area / (treeSize * treeSize * 7)) * treeDensity),
  );
  if (maxTrees <= 0) return [];

  const clearance = treeSize * 0.4;
  const nearEnough = treeSize * 2.2;
  const minTreeGap = treeSize * 0.75;
  const roadHash = new SpatialHash(Math.max(treeSize * 2, 100));
  roads.forEach((r, i) => roadHash.insert(i, segmentBBox(r.a, r.b)));
  const buildingHash = new SpatialHash(Math.max(treeSize * 2, 100));
  buildings.forEach((poly, i) => buildingHash.insert(i, poly.bbox));
  const treeHash = new SpatialHash(Math.max(treeSize, 50));
  const trees: TreeData[] = [];
  const scratch: number[] = [];
  const maxTries = maxTrees * 30;
  const roadReject = roadHalfWidth + clearance;
  const roadNear = roadHalfWidth + nearEnough;
  const p = { x: 0, y: 0 };

  for (let tries = 0; tries < maxTries && trees.length < maxTrees; tries++) {
    const x = rng.range(bounds.minX, bounds.maxX);
    const y = rng.range(bounds.minY, bounds.maxY);
    p.x = x;
    p.y = y;
    // 1. roads: distance to centre segments (envelope = Minkowski sum, so this is exact)
    roadHash.queryPoint(x, y, roadNear, scratch);
    let minRoad = Infinity;
    for (const i of scratch) {
      const r = roads[i];
      if (!r) continue;
      const d = pointSegmentDistance(p, r.a, r.b);
      if (d < minRoad) minRoad = d;
    }
    if (minRoad < roadReject) continue;
    let near = minRoad < roadNear;
    // 2. trees: spacing (cheap, before polygon tests)
    treeHash.queryPoint(x, y, minTreeGap, scratch);
    let crowded = false;
    for (const j of scratch) {
      const t = trees[j];
      if (t && Math.hypot(t.x - x, t.y - y) < minTreeGap) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    // 3. buildings: outside with clearance; also counts as "near something"
    buildingHash.queryPoint(x, y, nearEnough, scratch);
    let ok = true;
    for (const i of scratch) {
      const poly = buildings[i];
      if (!poly) continue;
      const d = polygonPointDistance(poly, p);
      if (d < clearance) {
        ok = false;
        break;
      }
      if (d < nearEnough) near = true;
    }
    if (!ok || !near) continue;
    const species = pickSpecies(rng);
    const scale = species === 2 ? 0.55 : species === 1 ? 0.85 : 1;
    const radius = (treeSize / 2) * scale * rng.range(0.75, 1.15);
    treeHash.insert(trees.length, { minX: x, minY: y, maxX: x, maxY: y });
    trees.push({
      x,
      y,
      radius,
      height: radius * (species === 1 ? 3.2 : species === 2 ? 1.1 : 2.2),
      species,
      tint: rng.next(),
      canopy: canopyNoise(rng, species),
    });
  }
  return trees;
}

function pickSpecies(rng: Rng): TreeSpecies {
  const r = rng.next();
  return r < 0.5 ? 0 : r < 0.82 ? 1 : 2;
}

/** Radius factors per (level, step): smooth-ish noise from a few random harmonics. */
function canopyNoise(rng: Rng, species: TreeSpecies): Float32Array {
  const out = new Float32Array(TREE_LEVELS * TREE_STEPS);
  const amp = species === 1 ? 0.08 : 0.16;
  for (let l = 0; l < TREE_LEVELS; l++) {
    const p1 = rng.range(0, Math.PI * 2);
    const p2 = rng.range(0, Math.PI * 2);
    for (let s = 0; s < TREE_STEPS; s++) {
      const a = (s / TREE_STEPS) * Math.PI * 2;
      const n = Math.sin(a * 2 + p1) * 0.6 + Math.sin(a * 3 + p2) * 0.4;
      out[l * TREE_STEPS + s] = 1 + n * amp + rng.range(-amp, amp) * 0.35;
    }
  }
  return out;
}
