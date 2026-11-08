/**
 * Procedural buildings along roads.
 *
 * ```
 *   road centre ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *               │ roadWidth/2 │ spacing │ buildingWidth │
 *                             ┌─────────┐ ┌─────────┐
 *   guide border (union) ─────┼─────────┼─┼─────────┼────  ← building centre line
 *                             └─────────┘ └─────────┘
 *                               length     spacing
 * ```
 *
 * 1. Wide "guide" envelopes (roadWidth + 2·spacing + buildingWidth) around every road
 *    that is not a bridge or tunnel are unioned; the border runs exactly where building
 *    centre lines should be.
 * 2. Long border pieces (merged when collinear) become supports, cut into lots of at
 *    least `buildingMinLength` separated by `spacing`.
 * 3. Each lot becomes a rectangle; its depth varies (the road-facing side stays put),
 *    its height and roof come from the seeded RNG.
 * 4. Footprints that touch a road or another building are discarded (spatial hash).
 *
 * @module engine/world/buildings
 */
import { SpatialHash } from '../graph/spatialHash.ts';
import { segmentBBox } from '../math/bbox.ts';
import { segmentSegmentDistance } from '../math/intersect.ts';
import type { Polygon } from '../math/polygon.ts';
import { polygonDistance, polygonsIntersect, unionPolygons, type Seg } from '../math/polygon.ts';
import type { Rng } from '../math/rng.ts';
import { rectAround } from './envelope.ts';
import { envelopes, mergeCollinear, type ResolvedSegment } from './roads.ts';
import type { WorldSettings } from './settings.ts';
import type { BuildingData } from './types.ts';

export interface BuildingResult {
  guides: Seg[];
  buildings: BuildingData[];
  polygons: Polygon[];
}

export function generateBuildings(
  segs: readonly ResolvedSegment[],
  settings: Readonly<WorldSettings>,
  rng: Rng,
): BuildingResult {
  const { roadWidth, roadRoundness, buildingWidth, buildingMinLength, spacing } = settings;
  const eligible = segs.filter((s) => !s.bridge && !s.tunnel);
  const guideWidth = roadWidth + buildingWidth + spacing * 2;
  const guides = unionPolygons(envelopes(eligible, guideWidth, roadRoundness));
  const supports = mergeCollinear(guides).filter(
    (s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= buildingMinLength,
  );

  // Index road centre segments. A road envelope is exactly the set of points within
  // roadWidth/2 of its segment (a Minkowski sum), so "building overlaps road" reduces to
  // a cheap polygon-to-segment distance test instead of polygon-vs-polygon.
  const roadHash = new SpatialHash(Math.max(roadWidth * 2, 100));
  segs.forEach((sg, i) => roadHash.insert(i, segmentBBox(sg.a, sg.b)));
  const roadClear = roadWidth / 2 + spacing * 0.9;
  const buildingHash = new SpatialHash(Math.max(buildingMinLength, 100));
  const accepted: Polygon[] = [];
  const data: BuildingData[] = [];
  const scratch: number[] = [];

  for (const s of supports) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const ux = (s.b.x - s.a.x) / len;
    const uy = (s.b.y - s.a.y) / len;
    // union pieces keep their source winding: outward (away from the road) is (uy, -ux)
    const ox = uy;
    const oy = -ux;
    const count = Math.max(1, Math.floor((len + spacing) / (buildingMinLength + spacing)));
    const lotLen = (len + spacing) / count - spacing;
    for (let k = 0; k < count; k++) {
      const start = k * (lotLen + spacing);
      const depth = buildingWidth * rng.range(0.72, 1);
      const shift = (depth - buildingWidth) / 2; // keep the road-facing side fixed
      const ax = s.a.x + ux * start + ox * shift;
      const ay = s.a.y + uy * start + oy * shift;
      const a = { x: ax, y: ay };
      const b = { x: ax + ux * lotLen, y: ay + uy * lotLen };
      const poly = rectAround(a, b, depth);
      if (nearRoad(poly, segs, roadHash, roadClear, scratch)) continue;
      if (overlapsAny(poly, accepted, buildingHash, spacing * 0.4, scratch)) continue;
      buildingHash.insert(accepted.length, poly.bbox);
      accepted.push(poly);
      const tall = rng.next();
      const height = buildingWidth * (0.55 + tall * tall * 2.4);
      const roof = height < buildingWidth * 0.95 && rng.chance(0.55) ? 'pitched' : 'flat';
      data.push({
        base: poly.points.map((p) => ({ x: p.x, y: p.y })),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        angle: Math.atan2(uy, ux),
        length: lotLen,
        depth,
        height,
        roof,
        tint: rng.next(),
        detailSeed: Math.floor(rng.next() * 0x7fffffff),
      });
    }
  }
  return { guides, buildings: data, polygons: accepted };
}

/** True if any edge of `poly` comes within `clear` of a road centre segment. */
function nearRoad(
  poly: Polygon,
  segs: readonly ResolvedSegment[],
  hash: SpatialHash,
  clear: number,
  scratch: number[],
): boolean {
  const b = poly.bbox;
  hash.queryRect(b.minX - clear, b.minY - clear, b.maxX + clear, b.maxY + clear, scratch);
  for (const i of scratch) {
    const sg = segs[i];
    if (!sg) continue;
    for (const e of poly.segments) {
      if (segmentSegmentDistance(e.a, e.b, sg.a, sg.b) < clear) return true;
    }
  }
  return false;
}

/** True if `poly` intersects or comes within `minGap` of any indexed polygon. */
function overlapsAny(
  poly: Polygon,
  others: readonly Polygon[],
  hash: SpatialHash,
  minGap: number,
  scratch: number[],
): boolean {
  const b = poly.bbox;
  hash.queryRect(b.minX - minGap, b.minY - minGap, b.maxX + minGap, b.maxY + minGap, scratch);
  for (const i of scratch) {
    const o = others[i];
    if (!o) continue;
    if (polygonsIntersect(poly, o)) return true;
    if (minGap > 0 && polygonDistance(poly, o) < minGap - 1e-6) return true;
  }
  return false;
}
