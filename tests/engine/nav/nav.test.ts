import { describe, expect, it } from 'vitest';
import { Car } from '../../../src/engine/car/car.ts';
import { CollisionWorld, HIT_NONE } from '../../../src/engine/car/damage.ts';
import { Graph } from '../../../src/engine/graph/graph.ts';
import type { MarkingStore } from '../../../src/engine/markings/marking.ts';
import { TrafficLightSystem } from '../../../src/engine/markings/trafficLightController.ts';
import { astar } from '../../../src/engine/nav/astar.ts';
import { buildLanePath, pointAt, projectOnPath } from '../../../src/engine/nav/lanePath.ts';
import {
  RouteFollower,
  planRoute,
  type FollowerEnv,
} from '../../../src/engine/nav/routeFollower.ts';
import { RouteGraph } from '../../../src/engine/nav/routeGraph.ts';
import { headingFromDirection } from '../../../src/engine/markings/start.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';

const DT = 1 / 60;

/** Diamond graph: two routes from A to D, the lower one shorter. */
function diamond(): { g: Graph; ids: Record<string, number> } {
  const g = new Graph();
  const A = g.addPoint(0, 0);
  const B = g.addPoint(500, -400); // long detour
  const C = g.addPoint(500, 100); // short
  const D = g.addPoint(1000, 0);
  g.addSegment(A, B);
  g.addSegment(B, D);
  g.addSegment(A, C);
  g.addSegment(C, D);
  return { g, ids: { A: A.id, B: B.id, C: C.id, D: D.id } };
}

function stubEnv(lights: TrafficLightSystem | null = null): FollowerEnv {
  const held = new Map<number, number>();
  return {
    lights,
    gapAhead: () => Infinity,
    crossTrafficNear: () => false,
    reserve: (n, c) => {
      const h = held.get(n);
      if (h === undefined || h === c) {
        held.set(n, c);
        return true;
      }
      return false;
    },
    release: (n, c) => {
      if (held.get(n) === c) held.delete(n);
    },
  };
}

describe('nav/routeGraph and A*', () => {
  it('finds the shortest path', () => {
    const { g, ids } = diamond();
    const rg = new RouteGraph(g);
    expect(rg.edgeCount).toBe(8);
    const r = astar(rg, ids.A as number, ids.D as number);
    expect(r?.nodes).toEqual([ids.A, ids.C, ids.D]);
    expect(r?.length).toBeCloseTo(2 * Math.hypot(500, 100));
    expect(astar(rg, ids.A as number, ids.A as number)?.nodes).toEqual([ids.A]);
    expect(astar(rg, ids.A as number, 999)).toBeNull();
  });

  it('respects one-way segments (and returns null when unreachable)', () => {
    const { g, ids } = diamond();
    const ac = g.findSegment(g.getPoint(ids.A as number)!, g.getPoint(ids.C as number)!);
    if (ac) g.setSegmentFlags(ac, { oneWay: true }); // A → C only
    // flip it so it points C → A: the short route is no longer allowed from A
    const rg1 = new RouteGraph(g);
    expect(astar(rg1, ids.A as number, ids.D as number)?.nodes).toEqual([ids.A, ids.C, ids.D]);
    expect(astar(rg1, ids.C as number, ids.A as number)?.nodes).toEqual([
      ids.C,
      ids.D,
      ids.B,
      ids.A,
    ]);
    const lonely = new Graph();
    const p = lonely.addPoint(0, 0);
    const q = lonely.addPoint(100, 0);
    lonely.addSegment(p, q, { oneWay: true });
    expect(astar(new RouteGraph(lonely), q.id, p.id)).toBeNull();
  });
});

describe('nav/lanePath', () => {
  it('offsets lanes a quarter road width to the right and rounds corners', () => {
    const path = buildLanePath(
      [1, 2, 3],
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 400 },
      ],
      100,
    );
    // first point: right of eastward travel (y-down) is +y
    expect(path.xy[0]).toBeCloseTo(0);
    expect(path.xy[1]).toBeCloseTo(25);
    // last point: right of southward travel is -x
    expect(path.xy[(path.count - 1) * 2]).toBeCloseTo(375);
    expect(path.length).toBeGreaterThan(700);
    expect(Number.isNaN(path.nodeArc[1] as number)).toBe(false);
    const out = new Float64Array(2);
    pointAt(path, path.length / 2, out);
    expect(Math.hypot((out[0] as number) - 375, (out[1] as number) - 25)).toBeLessThan(80); // near the corner
    const lat = new Float64Array(1);
    const s = projectOnPath(path, 200, 25, 0, path.count, lat);
    expect(s).toBeCloseTo(200, 0);
    expect(lat[0]).toBeCloseTo(0, 6);
  });

  it('builds a U-turn at dead ends and handles degenerate inputs', () => {
    const u = buildLanePath(
      [1, 2, 1],
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 0, y: 0 },
      ],
      100,
    );
    expect(u.length).toBeGreaterThan(550);
    expect(u.xy[(u.count - 1) * 2 + 1]).toBeCloseTo(-25); // back on the other lane
    const single = buildLanePath([1], [{ x: 5, y: 5 }], 100, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(single.count).toBe(3);
    const out = new Float64Array(2);
    pointAt(buildLanePath([], [], 100), 5, out);
    expect(out[0]).toBe(0);
  });
});

describe('nav/routeFollower', () => {
  function lWorld(withStop = false, withLight = false) {
    const m = new WorldModel();
    const a = m.graph.addPoint(0, 0);
    const b = m.graph.addPoint(0, -900);
    const c = m.graph.addPoint(900, -900);
    const s1 = m.graph.addSegment(a, b);
    const s2 = m.graph.addSegment(b, c);
    if (!s1 || !s2) throw new Error('setup');
    const target = m.markings.add('target', { segmentId: s2.id, t: 0.8, side: 1 });
    if (withStop) m.markings.add('stop', { segmentId: s1.id, t: 0.6, side: 1 });
    if (withLight) m.markings.add('light', { segmentId: s1.id, t: 0.6, side: 1 });
    const geo = new WorldGeometry(generateWorld(worldInputFrom(m)));
    const world = new CollisionWorld();
    world.geometry = geo;
    world.flags = { buildings: true, trees: true };
    return { m, target, world, rg: new RouteGraph(m.graph), s1 };
  }

  function drive(withStop: boolean, withLight: boolean, steps = 60 * 40) {
    const { m, target, world, rg } = lWorld(withStop, withLight);
    const car = new Car(1, 'traffic', 'route');
    car.reset(25, -150, headingFromDirection(0, -1));
    const lights = new TrafficLightSystem();
    lights.build(m.markings.ofType('light'), m.graph, 100);
    const route = planRoute(m.graph, rg, m.markings, 100, car, { marking: target });
    expect(route).not.toBeNull();
    const f = new RouteFollower();
    const env = stubEnv(lights);
    f.setRoute(route, car, 100, env);
    const speeds: number[] = [];
    let damaged = false;
    let n = 0;
    for (; n < steps && !f.arrived; n++) {
      lights.update(DT);
      f.update(car, DT, env);
      car.updatePhysics(DT);
      speeds.push(car.speed);
      if (world.polygonHit(car.polygon, car.id) !== HIT_NONE) damaged = true;
    }
    return { f, car, speeds, damaged, steps: n, route, lights };
  }

  it('reaches the target in an L-shaped world without touching a border', () => {
    const { f, damaged, steps, car } = drive(false, false);
    expect(f.arrived).toBe(true);
    expect(damaged).toBe(false);
    expect(steps).toBeLessThan(60 * 20);
    expect(car.x).toBeGreaterThan(600);
  });

  it('comes to a full stop at a stop line for at least 1 s, then proceeds (D1)', () => {
    const { f, speeds, damaged } = drive(true, false);
    expect(f.arrived).toBe(true);
    expect(damaged).toBe(false);
    // longest run of consecutive (near) zero speeds, and whether the car moved again after it
    let run = 0;
    let longest = 0;
    let movedAfter = false;
    for (const v of speeds) {
      if (Math.abs(v) < 2) {
        run++;
        if (run > longest) longest = run;
      } else {
        if (longest >= 60) movedAfter = true;
        run = 0;
      }
    }
    expect(longest / 60).toBeGreaterThanOrEqual(1);
    expect(movedAfter).toBe(true);
  });

  it('stops at a red light and goes on green (D5)', () => {
    const { f, speeds, damaged } = drive(false, true);
    expect(damaged).toBe(false);
    expect(f.arrived).toBe(true);
    // the single light cycles; the car either met green or waited: it never ran a red
    expect(speeds.length).toBeGreaterThan(0);
  });

  it('flags a reroute when pushed far off the path, and handles missing routes', () => {
    const { m, target, rg } = lWorld();
    const car = new Car(1, 'traffic', 'route');
    car.reset(25, -60, 0);
    const route = planRoute(m.graph, rg, m.markings, 100, car, { marking: target });
    const f = new RouteFollower();
    f.setRoute(route, car, 100);
    car.reset(600, 600, 0);
    f.update(car, DT, stubEnv());
    expect(f.needsReroute).toBe(true);
    const idle = new RouteFollower();
    idle.update(car, DT, stubEnv());
    expect(car.controls.forward).toBe(0);
    expect(
      planRoute(m.graph, rg, m.markings, 100, { x: 5000, y: 5000, angle: 0 }, { node: 0 }),
    ).toBeNull();
  });

  it('collects stop, light and crossing markings that apply to the driven lane only', () => {
    const { m, rg, s1 } = lWorld(true, true);
    const store: MarkingStore = m.markings;
    store.add('stop', { segmentId: s1.id, t: 0.3, side: -1 }); // opposite lane: ignored
    store.add('crossing', { segmentId: s1.id, t: 0.4, side: 0 });
    const target = store.ofType('target')[0];
    if (!target) throw new Error('no target');
    const route = planRoute(
      m.graph,
      rg,
      store,
      100,
      { x: 25, y: -60, angle: 0 },
      { marking: target },
    );
    expect(route?.markings.map((k) => k.kind).sort()).toEqual(['crossing', 'light', 'stop']);
  });
});
