import { describe, expect, it } from 'vitest';
import { pointSegmentDistance } from '../../../src/engine/math/intersect.ts';
import {
  Polygon,
  polygonContainsPoint,
  polygonsIntersect,
} from '../../../src/engine/math/polygon.ts';
import { generateDemoCity, isConnected } from '../../../src/engine/world/demoCity.ts';
import { envelope, envelopePoints, rectAround } from '../../../src/engine/world/envelope.ts';
import {
  centerLines,
  mergeCollinear,
  oneWayArrows,
  resolveSegments,
} from '../../../src/engine/world/roads.ts';
import {
  COLLIDE_BORDER,
  WorldGeometry,
  generateWorld,
  worldInputFrom,
} from '../../../src/engine/world/world.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';
import { VersionedCache } from '../../../src/engine/world/worldVersion.ts';
import { unionPolygons } from '../../../src/engine/math/polygon.ts';

describe('world/envelope', () => {
  it('has 2·(roundness + 1) vertices, all at width/2 from the segment', () => {
    for (const r of [1, 4, 10]) {
      const pts = envelopePoints({ x: 0, y: 0 }, { x: 100, y: 30 }, 100, r);
      expect(pts).toHaveLength(2 * (r + 1));
      for (const p of pts)
        expect(pointSegmentDistance(p, { x: 0, y: 0 }, { x: 100, y: 30 })).toBeCloseTo(50, 6);
    }
    expect(envelope({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 10).area).toBeGreaterThan(100 * 100);
    expect(rectAround({ x: 0, y: 0 }, { x: 100, y: 0 }, 20).points).toHaveLength(4);
  });

  it('union of two overlapping envelopes produces no interior segments', () => {
    const e1 = envelope({ x: 0, y: 0 }, { x: 300, y: 0 }, 100, 10);
    const e2 = envelope({ x: 150, y: -200 }, { x: 150, y: 200 }, 100, 10);
    const border = unionPolygons([e1, e2]);
    for (const s of border) {
      const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      // shrink-probe: a point slightly toward the other polygon must not be inside both
      const inside1 = polygonContainsPoint(
        new Polygon(envelopePoints({ x: 0, y: 0 }, { x: 300, y: 0 }, 99, 10)),
        m,
      );
      const inside2 = polygonContainsPoint(
        new Polygon(envelopePoints({ x: 150, y: -200 }, { x: 150, y: 200 }, 99, 10)),
        m,
      );
      expect(inside1 || inside2).toBe(false);
    }
    expect(border.length).toBeGreaterThan(20);
  });
});

describe('world/roads helpers', () => {
  it('mergeCollinear joins straight continuations only', () => {
    const merged = mergeCollinear([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 25, y: 0 } },
      { a: { x: 25, y: 0 }, b: { x: 25, y: 10 } },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.some((s) => s.a.x === 0 && s.b.x === 25 && s.b.y === 0)).toBe(true);
  });

  it('trims centre lines at junctions and places one-way arrows on both lanes', () => {
    const m = new WorldModel();
    const c = m.graph.addPoint(0, 0);
    const ends = [m.graph.addPoint(500, 0), m.graph.addPoint(-500, 0), m.graph.addPoint(0, 500)];
    for (const e of ends) m.graph.addSegment(c, e, { oneWay: e.x === 500 });
    const segs = resolveSegments(worldInputFrom(m));
    const lines = centerLines(segs, 100);
    expect(lines).toHaveLength(3);
    for (const l of lines)
      expect(Math.min(Math.hypot(l.a.x, l.a.y), Math.hypot(l.b.x, l.b.y))).toBeCloseTo(55);
    const arrows = oneWayArrows(segs, 100);
    expect(arrows.length).toBeGreaterThanOrEqual(2);
    expect(arrows.length % 2).toBe(0);
    expect(arrows.every((a) => a.angle === 0)).toBe(true);
  });
});

describe('world/generateWorld', () => {
  it('is deterministic for a fixed seed (snapshot of counts) and differs across seeds', () => {
    const a = generateWorld(worldInputFrom(generateDemoCity(12345)));
    const b = generateWorld(worldInputFrom(generateDemoCity(12345)));
    const counts = (d: typeof a) => ({
      roads: d.roads.length,
      roadBorders: d.roadBorders.length,
      laneGuides: d.laneGuides.length,
      edgeLines: d.edgeLines.length,
      centerLines: d.centerLines.length,
      arrows: d.arrows.length,
      sidewalks: d.sidewalks.length,
      curbs: d.curbs.length,
      buildings: d.buildings.length,
      trees: d.trees.length,
    });
    expect(counts(a)).toEqual(counts(b));
    expect(a.buildings.map((x) => x.center)).toEqual(b.buildings.map((x) => x.center));
    expect(a.trees.map((t) => [t.x, t.y, t.radius])).toEqual(
      b.trees.map((t) => [t.x, t.y, t.radius]),
    );
    expect(Array.from(a.trees[0]?.canopy ?? [])).toEqual(Array.from(b.trees[0]?.canopy ?? []));
    expect(counts(a)).toMatchSnapshot();
    const c = generateWorld(worldInputFrom(generateDemoCity(999)));
    expect(c.trees.map((t) => t.x)).not.toEqual(a.trees.map((t) => t.x));
  });

  it('reseeding the same graph moves trees and buildings but keeps roads', () => {
    const m = generateDemoCity(5);
    const g1 = generateWorld(worldInputFrom(m));
    m.setSeed(6);
    const g2 = generateWorld(worldInputFrom(m));
    expect(g2.roadBorders.length).toBe(g1.roadBorders.length);
    expect(g2.trees.map((t) => t.x)).not.toEqual(g1.trees.map((t) => t.x));
  });

  it('buildings never overlap roads or each other; trees stay outside roads and buildings', () => {
    const data = generateWorld(worldInputFrom(generateDemoCity(42)));
    const roads = data.roads.map((r) => new Polygon(r.points));
    const buildings = data.buildings.map((b) => new Polygon(b.base));
    expect(buildings.length).toBeGreaterThan(20);
    expect(data.trees.length).toBeGreaterThan(20);
    for (const b of buildings) for (const r of roads) expect(polygonsIntersect(b, r)).toBe(false);
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        expect(polygonsIntersect(buildings[i] as Polygon, buildings[j] as Polygon)).toBe(false);
      }
    }
    for (const t of data.trees) {
      for (const r of roads) expect(polygonContainsPoint(r, t)).toBe(false);
      for (const b of buildings) expect(polygonContainsPoint(b, t)).toBe(false);
    }
  });

  it('puts no buildings along bridges or tunnels', () => {
    const m = new WorldModel();
    const a = m.graph.addPoint(0, 0);
    const b = m.graph.addPoint(1200, 0);
    m.graph.addSegment(a, b, { bridge: true });
    expect(generateWorld(worldInputFrom(m)).buildings).toHaveLength(0);
    const s = m.graph.segments[0];
    if (s) m.graph.setSegmentFlags(s, { bridge: false });
    expect(generateWorld(worldInputFrom(m)).buildings.length).toBeGreaterThan(0);
  });

  it('handles an empty world and reports progress and timings', () => {
    const empty = generateWorld(worldInputFrom(new WorldModel()));
    expect(empty.roads).toHaveLength(0);
    expect(empty.trees).toHaveLength(0);
    const stages: string[] = [];
    let t = 0;
    const d = generateWorld(worldInputFrom(generateDemoCity(1, { cols: 3, rows: 3 })), {
      onProgress: (_f, stage) => stages.push(stage),
      now: () => (t += 1),
    });
    expect(stages.at(-1)).toBe('trees');
    expect(Object.keys(d.timings)).toEqual([
      'roads',
      'laneGuides',
      'markings',
      'sidewalks',
      'buildings',
      'trees',
    ]);
  });

  it('regenerates a 200-segment world quickly (logged; budget 150 ms in the browser)', () => {
    const m = generateDemoCity(3, { cols: 11, rows: 10, removeFraction: 0 });
    expect(m.graph.segmentCount).toBeGreaterThanOrEqual(189);
    // add a few to reach 200
    const pts = m.graph.points;
    for (let i = 0; m.graph.segmentCount < 200 && i < pts.length - 12; i++) {
      const p = pts[i];
      const q = pts[i + 12];
      if (p && q) m.graph.addSegment(p, q);
    }
    const input = worldInputFrom(m);
    generateWorld(input); // warm up the JIT
    const t0 = performance.now();
    const d = generateWorld(input, { now: () => performance.now() });
    const ms = performance.now() - t0;
    console.info(`200-segment world generated in ${ms.toFixed(1)} ms`, d.timings);
    expect(ms).toBeLessThan(process.env['CI'] ? 1500 : 600);
  });
});

describe('world/WorldGeometry and caches', () => {
  it('builds collision arrays and spatial indexes', () => {
    const data = generateWorld(worldInputFrom(generateDemoCity(8, { cols: 3, rows: 3 })));
    const geo = new WorldGeometry(data);
    expect(geo.collisionCount).toBe(
      data.roadBorders.length + data.buildings.length * 4 + data.trees.length * 6,
    );
    expect(geo.collisionKind[0]).toBe(COLLIDE_BORDER);
    expect(geo.collision.length).toBe(geo.collisionCount * 4);
    expect(geo.version).toBe(data.version);
    const b = data.bounds;
    expect(geo.collisionHash.query(b).length).toBe(geo.collisionCount);
  });

  it('VersionedCache rebuilds only on version change', () => {
    const c = new VersionedCache<number>();
    let n = 0;
    expect(c.get(1, () => ++n)).toBe(1);
    expect(c.get(1, () => ++n)).toBe(1);
    expect(c.get(2, () => ++n)).toBe(2);
    expect(c.builds).toBe(2);
    expect(c.isFresh(2)).toBe(true);
    c.set(3, 99);
    expect(c.peek()).toBe(99);
    c.invalidate();
    expect(c.peek()).toBeNull();
  });

  it('demo city is connected and has a one-way street', () => {
    const m = generateDemoCity(77);
    expect(isConnected(m)).toBe(true);
    expect(m.graph.segments.some((s) => s.oneWay)).toBe(true);
    expect(isConnected(new WorldModel())).toBe(true);
  });
});
