import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWorld, serializeWorld } from '../../../src/engine/io/serialize.ts';
import type { Vec2 } from '../../../src/engine/math/vec2.ts';
import { Polygon, pointInRing, polygonsIntersect } from '../../../src/engine/math/polygon.ts';
import { importOsm } from '../../../src/engine/osm/osmParse.ts';
import {
  COLLIDE_BUILDING,
  WorldGeometry,
  generateWorld,
  worldInputFrom,
} from '../../../src/engine/world/world.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';

const square = (cx: number, cy: number, r: number): Vec2[] => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];
const hexagon = (cx: number, cy: number, r: number): Vec2[] =>
  Array.from({ length: 6 }, (_, i) => ({
    x: cx + Math.cos((i * Math.PI) / 3) * r,
    y: cy + Math.sin((i * Math.PI) / 3) * r,
  }));

function featureWorld(): WorldModel {
  const model = new WorldModel({ seed: 5 });
  const a = model.graph.addPoint(-1100, 0);
  const b = model.graph.addPoint(1100, 0);
  model.graph.addSegment(a, b);
  model.setFeatures({
    buildings: [square(0, -280, 60), square(400, 0, 60), hexagon(-500, 300, 80)],
    water: [square(560, 330, 210)],
  });
  return model;
}

describe('world/OSM features (J6)', () => {
  it('imported footprints replace procedural buildings; water excludes buildings and trees', () => {
    const model = featureWorld();
    const input = worldInputFrom(model);
    expect(input.features?.buildings).toHaveLength(3);
    const data = generateWorld(input);
    const osm = data.buildings.filter((b) => b.osm);
    // the footprint across the road is dropped, the square and the hexagon are kept
    expect(osm).toHaveLength(2);
    expect(osm.map((b) => b.base.length).sort()).toEqual([4, 6]);
    for (const b of osm) {
      expect(b.roof).toBe('flat');
      expect(b.height).toBeGreaterThanOrEqual(70 * 0.85);
    }
    expect(data.water).toHaveLength(1);
    const water = new Polygon(data.water[0] as Vec2[]);
    const fixed = [...osm.map((b) => new Polygon(b.base)), water];
    const procedural = data.buildings.filter((b) => !b.osm);
    expect(procedural.length).toBeGreaterThan(0);
    for (const b of procedural) {
      const p = new Polygon(b.base);
      for (const f of fixed) expect(polygonsIntersect(p, f)).toBe(false);
    }
    for (const t of data.trees) expect(pointInRing(water.points, t.x, t.y)).toBe(false);
    // footprints are solid for cars (collision segments for all six hexagon sides)
    const geo = new WorldGeometry(data);
    const kinds = Array.from(geo.collisionKind).filter((k) => k === COLLIDE_BUILDING).length;
    expect(kinds).toBeGreaterThanOrEqual(4 + 6);
  });

  it('setting features bumps the geometry version and generation stays deterministic', () => {
    const model = featureWorld();
    const v = model.geometryVersion;
    model.setFeatures({ buildings: [square(0, -280, 60)], water: [] });
    expect(model.geometryVersion).toBe(v + 1);
    const a = generateWorld(worldInputFrom(model));
    const b = generateWorld(worldInputFrom(model));
    expect(JSON.stringify(a.buildings)).toBe(JSON.stringify(b.buildings));
    expect(JSON.stringify(a.trees)).toBe(JSON.stringify(b.trees));
  });

  it('features survive a save/load round trip', () => {
    const model = featureWorld();
    const file = serializeWorld(model);
    expect(file.features?.buildings).toHaveLength(3);
    expect(file.features?.water).toHaveLength(1);
    const res = parseWorld(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const m2 = res.value.model;
    expect(m2.features.buildings).toHaveLength(3);
    const g1 = generateWorld(worldInputFrom(model));
    const g2 = generateWorld(worldInputFrom(m2));
    expect(g2.buildings.length).toBe(g1.buildings.length);
    expect(g2.trees.length).toBe(g1.trees.length);
    // invalid features are rejected with a clear message
    const bad = parseWorld({ ...file, features: { buildings: [[[0, 0]]], water: [] } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/features/);
  });

  it('the bundled OSM sample imports its footprints and river into the world', () => {
    const r = importOsm(JSON.parse(readFileSync('public/worlds/osm-sample.osm.json', 'utf8')));
    expect(r.stats.buildings).toBeGreaterThan(10);
    expect(r.model.features.buildings).toHaveLength(r.stats.buildings);
    expect(r.model.features.water).toHaveLength(r.stats.water);
    const data = generateWorld(worldInputFrom(r.model));
    expect(data.buildings.filter((b) => b.osm).length).toBeGreaterThan(5);
    expect(data.water.length).toBe(1);
  });
});
