import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DRIVABLE_HIGHWAYS,
  OsmFormatError,
  importOsm,
  onewayDirection,
} from '../../../src/engine/osm/osmParse.ts';
import { haversineMeters, makeProjection } from '../../../src/engine/osm/projection.ts';

/** 6 nodes, 2 drivable ways sharing node 3 (a T junction). */
const tiny = {
  elements: [
    { type: 'node', id: 1, lat: 47.0, lon: 8.0 },
    { type: 'node', id: 2, lat: 47.0, lon: 8.001 },
    { type: 'node', id: 3, lat: 47.0, lon: 8.002 },
    { type: 'node', id: 4, lat: 47.001, lon: 8.002 },
    { type: 'node', id: 5, lat: 47.002, lon: 8.002 },
    { type: 'node', id: 6, lat: 47.003, lon: 8.002 },
    { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
    { type: 'way', id: 11, nodes: [3, 4, 5, 6], tags: { highway: 'primary', oneway: 'yes' } },
  ],
};

describe('osm/projection', () => {
  it('preserves distances within 1% over a few kilometres', () => {
    const p = makeProjection(47.0, 8.0);
    const pairs = [
      [47.0, 8.0, 47.0, 8.03],
      [47.0, 8.0, 47.02, 8.0],
      [46.99, 7.99, 47.012, 8.027],
    ] as const;
    for (const [la1, lo1, la2, lo2] of pairs) {
      const a = p.project(la1, lo1);
      const b = p.project(la2, lo2);
      const units = Math.hypot(b.x - a.x, b.y - a.y);
      const metres = haversineMeters(la1, lo1, la2, lo2);
      expect(Math.abs(units / 10 - metres) / metres).toBeLessThan(0.01);
    }
  });

  it('puts north up (negative y) and round trips', () => {
    const p = makeProjection(47.0, 8.0);
    expect(p.project(47.001, 8.0).y).toBeLessThan(0);
    expect(p.project(47.0, 8.001).x).toBeGreaterThan(0);
    const ll = p.unproject(1234, -567);
    const xy = p.project(ll.lat, ll.lon);
    expect(xy.x).toBeCloseTo(1234, 6);
    expect(xy.y).toBeCloseTo(-567, 6);
  });
});

describe('osm/osmParse', () => {
  it('imports the 6-node / 2-way fixture with the expected counts and one-way flags', () => {
    const r = importOsm(tiny);
    expect(r.model.graph.pointCount).toBe(6); // node 3 shared, not duplicated
    expect(r.model.graph.segmentCount).toBe(5);
    const oneWays = r.model.graph.segments.filter((s) => s.oneWay);
    expect(oneWays).toHaveLength(3);
    // one-way segments follow the way order (south → north = decreasing y)
    for (const s of oneWays) expect(s.b.y).toBeLessThan(s.a.y);
    expect(r.stats).toMatchObject({ nodes: 6, ways: 2, highways: 2, oneWay: 1, skipped: 0 });
    expect(r.model.meta.source).toBe('osm');
    // 0.002° of longitude at 47°N ≈ 151.7 m ≈ 1517 units
    const xs = r.model.graph.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1517, -1);
  });

  it('interprets oneway values correctly (no is two-way, -1 reverses, roundabouts are one-way)', () => {
    expect(onewayDirection({ oneway: 'yes' })).toBe(1);
    expect(onewayDirection({ oneway: 'true' })).toBe(1);
    expect(onewayDirection({ oneway: '1' })).toBe(1);
    expect(onewayDirection({ oneway: '-1' })).toBe(-1);
    expect(onewayDirection({ oneway: 'no' })).toBe(0);
    expect(onewayDirection({ junction: 'roundabout' })).toBe(1);
    expect(onewayDirection({ junction: 'roundabout', oneway: 'no' })).toBe(0);
    expect(onewayDirection({ highway: 'residential' })).toBe(0);
    expect(onewayDirection({ highway: 'motorway' })).toBe(1);

    const data = {
      elements: [
        ...tiny.elements.filter((e) => e.type === 'node'),
        { type: 'way', id: 20, nodes: [1, 2], tags: { highway: 'residential', oneway: '-1' } },
        { type: 'way', id: 21, nodes: [2, 3], tags: { highway: 'residential', oneway: 'no' } },
        {
          type: 'way',
          id: 22,
          nodes: [3, 4],
          tags: { highway: 'tertiary', junction: 'roundabout' },
        },
      ],
    };
    const r = importOsm(data);
    const segs = r.model.graph.segments;
    const rev = segs.find((s) => s.oneWay && Math.abs(s.a.y - s.b.y) < 1 && s.a.x > s.b.x);
    expect(rev).toBeDefined(); // reversed: drawn east → west
    expect(segs.filter((s) => s.oneWay)).toHaveLength(2);
    expect(
      importOsm(data, { includeOneWays: false }).model.graph.segments.some((s) => s.oneWay),
    ).toBe(false);
  });

  it('skips untagged and non-drivable ways, carries bridge/tunnel, collects buildings and water', () => {
    const data = {
      elements: [
        ...tiny.elements.filter((e) => e.type === 'node'),
        { type: 'node', id: 7, lat: 47.0005, lon: 8.0005 },
        { type: 'way', id: 30, nodes: [1, 2] }, // no tags
        { type: 'way', id: 31, nodes: [2, 3], tags: { highway: 'footway' } },
        { type: 'way', id: 32, nodes: [3, 4], tags: { highway: 'service', bridge: 'yes' } },
        {
          type: 'way',
          id: 33,
          nodes: [4, 5],
          tags: { highway: 'service', tunnel: 'yes', bridge: 'no' },
        },
        { type: 'way', id: 34, nodes: [1, 2, 7, 1], tags: { building: 'yes' } },
        { type: 'way', id: 35, nodes: [2, 3, 7, 2], tags: { natural: 'water' } },
        { type: 'way', id: 36, nodes: [5, 6, 99], tags: { highway: 'residential' } }, // missing node
        { type: 'relation', id: 40, members: [] },
        'garbage',
      ],
    };
    const r = importOsm(data);
    expect(r.model.graph.segmentCount).toBe(3);
    expect(r.model.graph.segments.filter((s) => s.bridge)).toHaveLength(1);
    expect(r.model.graph.segments.filter((s) => s.tunnel)).toHaveLength(1);
    expect(r.buildings).toHaveLength(1);
    expect(r.water).toHaveLength(1);
    expect(r.stats.skipped).toBe(2);
    expect(r.warnings.some((w) => w.includes('missing node'))).toBe(true);
    expect(DRIVABLE_HIGHWAYS.has('footway')).toBe(false);
    expect(DRIVABLE_HIGHWAYS.has('trunk_link')).toBe(true);
  });

  it('rejects data that is not Overpass JSON with a helpful message', () => {
    expect(() => importOsm({})).toThrow(OsmFormatError);
    expect(() => importOsm('nope')).toThrow(/elements/);
    expect(() => importOsm({ elements: [] })).toThrow(/No nodes/);
    const noRoads = importOsm({ elements: [{ type: 'node', id: 1, lat: 1, lon: 1 }] });
    expect(noRoads.model.graph.segmentCount).toBe(0);
    expect(noRoads.warnings[0]).toContain('No drivable roads');
  });

  it('imports the bundled sample town with more than 50 segments', () => {
    const json: unknown = JSON.parse(readFileSync('public/worlds/osm-sample.osm.json', 'utf8'));
    const r = importOsm(json, { roadWidthScale: 0.9 });
    expect(r.model.graph.segmentCount).toBeGreaterThan(50);
    expect(r.stats.oneWay).toBeGreaterThanOrEqual(3);
    expect(r.stats.bridges).toBeGreaterThan(0);
    expect(r.model.settings.roadWidth).toBeCloseTo(90);
  });
});
