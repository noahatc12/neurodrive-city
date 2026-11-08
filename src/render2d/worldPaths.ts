/**
 * Path2D caches for the static ground layers, rebuilt only when the geometry version
 * changes. Drawing a cached Path2D is one call regardless of how many polygons it holds.
 * @module render2d/worldPaths
 */
import type { Seg } from '../engine/math/polygon.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import type { WorldGeometry } from '../engine/world/world.ts';

export interface WorldPaths {
  version: number;
  /** Water polygons (OSM features, J6). */
  water: Path2D;
  sidewalks: Path2D;
  roads: Path2D;
  /** Road surface shifted toward the light: a cheap soft shadow. */
  roadShadow: Path2D;
  edges: Path2D;
  centers: Path2D;
  curbs: Path2D;
  borders: Path2D;
  laneGuides: Path2D;
  buildingGuides: Path2D;
  arrows: Path2D;
}

function polysPath(polys: readonly (readonly Vec2[])[], dx = 0, dy = 0): Path2D {
  const p = new Path2D();
  for (const pts of polys) {
    const first = pts[0];
    if (!first) continue;
    p.moveTo(first.x + dx, first.y + dy);
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i] as Vec2;
      p.lineTo(q.x + dx, q.y + dy);
    }
    p.closePath();
  }
  return p;
}

function segsPath(segs: readonly Seg[]): Path2D {
  const p = new Path2D();
  for (const s of segs) {
    p.moveTo(s.a.x, s.a.y);
    p.lineTo(s.b.x, s.b.y);
  }
  return p;
}

/** Builds all paths for a geometry. `roadWidth` sizes the arrow glyphs. */
export function buildWorldPaths(geo: WorldGeometry, roadWidth: number): WorldPaths {
  const d = geo.data;
  const roadPts = d.roads.map((r) => r.points);
  const shadowOff = roadWidth * 0.06;
  const arrows = new Path2D();
  const L = roadWidth * 0.22;
  const W = roadWidth * 0.09;
  for (const a of d.arrows) {
    const c = Math.cos(a.angle);
    const s = Math.sin(a.angle);
    // arrow pointing along +x, rotated by angle: shaft and head
    const pt = (x: number, y: number): [number, number] => [
      a.x + x * c - y * s,
      a.y + x * s + y * c,
    ];
    const poly: [number, number][] = [
      pt(-L, -W * 0.45),
      pt(L * 0.2, -W * 0.45),
      pt(L * 0.2, -W),
      pt(L, 0),
      pt(L * 0.2, W),
      pt(L * 0.2, W * 0.45),
      pt(-L, W * 0.45),
    ];
    const [x0, y0] = poly[0] as [number, number];
    arrows.moveTo(x0, y0);
    for (let i = 1; i < poly.length; i++) {
      const [x, y] = poly[i] as [number, number];
      arrows.lineTo(x, y);
    }
    arrows.closePath();
  }
  return {
    water: polysPath(d.water ?? []),
    version: geo.version,
    sidewalks: polysPath(d.sidewalks),
    roads: polysPath(roadPts),
    roadShadow: polysPath(roadPts, shadowOff, shadowOff * 1.4),
    edges: segsPath(d.edgeLines),
    centers: segsPath(d.centerLines),
    curbs: segsPath(d.curbs),
    borders: segsPath(d.roadBorders),
    laneGuides: segsPath(d.laneGuides),
    buildingGuides: segsPath(d.buildingGuides),
    arrows,
  };
}
