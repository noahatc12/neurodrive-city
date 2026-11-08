import { describe, expect, it } from 'vitest';
import { Graph } from '../../../src/engine/graph/graph.ts';
import { CROSSING_CRAWL_FACTOR, crossingMaxSpeed } from '../../../src/engine/markings/crossing.ts';
import {
  distanceToFacedPoint,
  facedPoint,
  mustStopForLight,
} from '../../../src/engine/markings/light.ts';
import { MarkingStore, resolveMarking } from '../../../src/engine/markings/marking.ts';
import { insideBay } from '../../../src/engine/markings/parking.ts';
import { headingFromDirection, spawnFor, spawnPoses } from '../../../src/engine/markings/start.ts';
import { STOP_WAIT, StopLogic, stoppingSpeed } from '../../../src/engine/markings/stop.ts';
import { activeTarget, targetAnimation } from '../../../src/engine/markings/target.ts';
import {
  DEFAULT_TIMING,
  TrafficLightSystem,
} from '../../../src/engine/markings/trafficLightController.ts';
import { YIELD_SLOW_FACTOR, yieldMaxSpeed } from '../../../src/engine/markings/yield.ts';

/** A 4-way junction at the origin with arms of length 600 and a light on each approach. */
function junction() {
  const g = new Graph();
  const c = g.addPoint(0, 0);
  const arms = [g.addPoint(600, 0), g.addPoint(0, 600), g.addPoint(-600, 0), g.addPoint(0, -600)];
  const segs = arms.map((p) => g.addSegment(p, c)); // a = arm end, b = junction
  const store = new MarkingStore(g);
  const lights = segs.map((s) => store.add('light', { segmentId: s?.id ?? -1, t: 0.85, side: 1 }));
  return { g, c, store, lights };
}

describe('markings/trafficLightController', () => {
  it('groups lights by junction and keeps exactly one approach green', () => {
    const { g, store, lights } = junction();
    const sys = new TrafficLightSystem();
    sys.build(store.ofType('light'), g, 100);
    expect(sys.groups).toHaveLength(1);
    expect(sys.groups[0]?.approaches).toHaveLength(4);
    for (let t = 0; t < 60; t += 0.1) {
      sys.update(0.1);
      const colours = lights.map((l) => sys.colorOf(l.id));
      const green = colours.filter((c) => c === 'green').length;
      const yellow = colours.filter((c) => c === 'yellow').length;
      expect(green + yellow).toBeLessThanOrEqual(1);
    }
  });

  it('cycles green 6 s → yellow 1.5 s → all-red 0.5 s → next approach (simulation time)', () => {
    const { g, store, lights } = junction();
    const sys = new TrafficLightSystem();
    sys.build(store.ofType('light'), g, 100);
    const first = sys.groups[0]?.approaches[0]?.[0] ?? -1;
    const second = sys.groups[0]?.approaches[1]?.[0] ?? -1;
    expect(DEFAULT_TIMING).toEqual({ green: 6, yellow: 1.5, allRed: 0.5 });
    expect(sys.colorOf(first)).toBe('green');
    sys.update(5.9);
    expect(sys.colorOf(first)).toBe('green');
    sys.update(0.2); // 6.1 s
    expect(sys.colorOf(first)).toBe('yellow');
    sys.update(1.5); // 7.6 s: all red
    expect(lights.every((l) => sys.colorOf(l.id) === 'red')).toBe(true);
    sys.update(0.5); // 8.1 s
    expect(sys.colorOf(second)).toBe('green');
    expect(sys.colorOf(first)).toBe('red');
  });

  it('handles large time steps (turbo) and custom timing', () => {
    const { g, store } = junction();
    const sys = new TrafficLightSystem({ green: 1, yellow: 1, allRed: 1 });
    sys.build(store.ofType('light'), g, 100);
    sys.update(3 * 4); // one full cycle through all 4 approaches
    expect(sys.groups[0]?.phase).toBe(0);
  });

  it('a light with no junction nearby forms its own controller, never throws', () => {
    const g = new Graph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(2000, 0);
    const s = g.addSegment(a, b);
    const store = new MarkingStore(g);
    const lone = store.add('light', { segmentId: s?.id ?? -1, t: 0.2, side: 1 });
    const ghost = store.add('light', { segmentId: 999, t: 0.5, side: 1 }); // dangling binding
    const sys = new TrafficLightSystem();
    expect(() => sys.build(store.ofType('light'), g, 100)).not.toThrow();
    expect(sys.groups).toHaveLength(2);
    sys.update(10);
    expect(['green', 'yellow', 'red']).toContain(sys.colorOf(lone.id));
    expect(sys.colorOf(ghost.id)).toBeDefined();
    expect(sys.colorOf(12345)).toBe('red');
    expect(new TrafficLightSystem().groups).toEqual([]);
  });

  it('cross-fades lamps over 150 ms and keeps phase across rebuilds', () => {
    const { g, store } = junction();
    const sys = new TrafficLightSystem();
    sys.build(store.ofType('light'), g, 100, 1);
    const first = sys.groups[0]?.approaches[0]?.[0] ?? -1;
    sys.update(0.01); // first observation: green, fully lit
    sys.update(6.04); // just turned yellow
    const lv = new Float32Array(3);
    sys.lampLevels(first, lv);
    expect(lv[1]).toBeGreaterThan(0);
    expect(lv[1]).toBeLessThan(1);
    expect(lv[2]).toBeGreaterThan(0); // green fading out
    sys.update(0.2);
    sys.lampLevels(first, lv);
    expect(Array.from(lv)).toEqual([0, 1, 0]);
    const phaseBefore = sys.groups[0]?.stage;
    sys.build(store.ofType('light'), g, 100, 2); // markings changed: rebuild keeps the cycle
    expect(sys.groups[0]?.stage).toBe(phaseBefore);
    sys.build(store.ofType('light'), g, 100, 2); // same version: no-op
    expect(sys.groupFor(first)).toBeDefined();
  });
});

describe('markings/light helpers', () => {
  it('finds the faced junction and distance to it', () => {
    const { g, c, lights } = junction();
    const l = lights[0];
    if (!l) throw new Error('no light');
    expect(facedPoint(l, g)).toBe(c);
    expect(distanceToFacedPoint(l, g)).toBeCloseTo(90);
    const reversed = { ...l, binding: { ...l.binding, side: -1 as const } };
    expect(facedPoint(reversed, g)?.x).toBe(600);
    expect(facedPoint({ ...l, binding: { ...l.binding, segmentId: 99 } }, g)).toBeNull();
    expect(distanceToFacedPoint({ ...l, binding: { ...l.binding, segmentId: 99 } }, g)).toBe(
      Infinity,
    );
  });

  it('stops for red, for yellow only when it can stop in time, never for green', () => {
    expect(mustStopForLight('green', 50, 100, 300)).toBe(false);
    expect(mustStopForLight('red', 50, 100, 300)).toBe(true);
    expect(mustStopForLight('red', -5, 100, 300)).toBe(false); // already past the line
    // stopping distance at 120 u/s with 300 u/s² is 24 units
    expect(mustStopForLight('yellow', 30, 120, 300)).toBe(true);
    expect(mustStopForLight('yellow', 10, 120, 300)).toBe(false); // too close: clear the junction
  });
});

describe('markings/stop state machine', () => {
  it('requires a full stop and at least 1 s of waiting before proceeding when clear', () => {
    const s = new StopLogic();
    const decel = 300;
    let d = s.update(500, 150, 1 / 60, true, decel, 200);
    expect(d.phase).toBe('approaching');
    d = s.update(150, 150, 1 / 60, true, decel, 200);
    expect(d.phase).toBe('braking');
    expect(d.maxSpeed).toBeLessThan(stoppingSpeed(150, decel) + 1e-9);
    d = s.update(10, 0.5, 1 / 60, true, decel, 200);
    expect(d.phase).toBe('stopped');
    expect(d.maxSpeed).toBe(0);
    let t = 0;
    while (t < STOP_WAIT - 0.05) {
      d = s.update(10, 0, 0.05, true, decel, 200);
      t += 0.05;
      expect(d.phase).toBe('stopped');
    }
    // blocked junction keeps it waiting even after 1 s
    d = s.update(10, 0, 0.1, false, decel, 200);
    expect(d.phase).toBe('stopped');
    d = s.update(10, 0, 0.1, true, decel, 200);
    expect(d.phase).toBe('clear');
    expect(d.maxSpeed).toBe(Infinity);
    s.reset();
    expect(s.phase).toBe('approaching');
  });

  it('gives up on a stop it overshot', () => {
    const s = new StopLogic();
    s.update(100, 150, 1 / 60, true, 300, 200);
    const d = s.update(-50, 150, 1 / 60, true, 300, 200);
    expect(d.phase).toBe('clear');
  });
});

describe('markings/yield, crossing, parking, start, target', () => {
  it('yield slows when clear and stops for conflicts', () => {
    expect(yieldMaxSpeed(500, false, 180, 300, 200)).toBe(Infinity);
    expect(yieldMaxSpeed(0, false, 180, 300, 200)).toBeCloseTo(180 * YIELD_SLOW_FACTOR);
    expect(yieldMaxSpeed(100, false, 180, 300, 200)).toBeGreaterThan(180 * YIELD_SLOW_FACTOR);
    expect(yieldMaxSpeed(5, true, 180, 300, 200)).toBe(0);
    expect(yieldMaxSpeed(-1, true, 180, 300, 200)).toBe(Infinity);
  });

  it('crossing ramps down to a crawl', () => {
    expect(crossingMaxSpeed(400, 25, 180, 200)).toBe(Infinity);
    expect(crossingMaxSpeed(0, 25, 180, 200)).toBeCloseTo(180 * CROSSING_CRAWL_FACTOR);
    expect(crossingMaxSpeed(-20, 25, 180, 200)).toBeCloseTo(180 * CROSSING_CRAWL_FACTOR);
    expect(crossingMaxSpeed(-30, 25, 180, 200)).toBe(Infinity);
    const mid = crossingMaxSpeed(110, 25, 180, 200);
    expect(mid).toBeGreaterThan(45);
    expect(mid).toBeLessThan(180);
  });

  it('parking bay containment and start poses', () => {
    const { g, store } = junction();
    const seg = g.segments[0];
    if (!seg) throw new Error('no seg');
    const bay = store.add('parking', { segmentId: seg.id, t: 0.5, side: 1 });
    const r = resolveMarking(bay, g, 100);
    if (!r) throw new Error('no bay');
    expect(insideBay(r, r.center.x, r.center.y)).toBe(true);
    expect(insideBay(r, r.center.x + 200, r.center.y)).toBe(false);
    // car heading convention: 0 = up (-y); travelling west (-x) is +90° (left turn)
    expect(headingFromDirection(0, -1)).toBeCloseTo(0);
    expect(headingFromDirection(-1, 0)).toBeCloseTo(Math.PI / 2);
    const s1 = store.add('start', { segmentId: seg.id, t: 0.3, side: 1 });
    const s2 = store.add('start', { segmentId: g.segments[1]?.id ?? -1, t: 0.3, side: 1 });
    const poses = spawnPoses([s2, s1], g, 100);
    expect(poses).toHaveLength(2);
    expect(spawnFor(0, poses)).toEqual(poses[0]);
    expect(spawnFor(3, poses)).toEqual(poses[1]);
    expect(spawnFor(0, [])).toBeNull();
  });

  it('active target and its animation', () => {
    const { g, store } = junction();
    const seg = g.segments[0];
    if (!seg) throw new Error('no seg');
    expect(activeTarget([])).toBeNull();
    const t1 = store.add('target', { segmentId: seg.id, t: 0.2, side: 1 });
    const t2 = store.add('target', { segmentId: seg.id, t: 0.4, side: 1 });
    expect(activeTarget(store.ofType('target'))?.id).toBe(t2.id);
    const t3 = store.add('target', { segmentId: seg.id, t: 0.6, side: 1 }, { active: true });
    expect(activeTarget([t1, t3, t2])?.id).toBe(t3.id);
    const a = targetAnimation(1.3);
    expect(a.bob).toBeGreaterThanOrEqual(0);
    expect(a.pulse).toBeLessThan(1);
  });
});
