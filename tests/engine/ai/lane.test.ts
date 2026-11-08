import { describe, expect, it } from 'vitest';
import {
  fitLayout,
  inputLayouts,
  inputNames,
  layoutMismatch,
  parseBrain,
  serializeBrain,
  BRAIN_VERSION,
} from '../../../src/engine/ai/brainSchema.ts';
import { NAV_INPUTS, Population } from '../../../src/engine/ai/evolution.ts';
import {
  AxisProgress,
  RouteProgress,
  laneFactor,
  ONCOMING_LIMIT,
} from '../../../src/engine/ai/fitness.ts';
import { NeuralNetwork, type Level } from '../../../src/engine/ai/network.ts';
import { Car } from '../../../src/engine/car/car.ts';
import { CollisionWorld } from '../../../src/engine/car/damage.ts';
import type { SpawnPose } from '../../../src/engine/markings/start.ts';
import { Rng } from '../../../src/engine/math/rng.ts';
import { projectOnPathSigned, type LanePath } from '../../../src/engine/nav/lanePath.ts';
import type { ProgressTracker, SimExtension, SimHost } from '../../../src/engine/sim/host.ts';
import { InfiniteRoadSim } from '../../../src/engine/sim/infiniteRoad.ts';
import { Particles, SkidMarks } from '../../../src/engine/sim/particlesSim.ts';

const DT = 1 / 60;
const RW = 100;

/** A lane path through the given points (sharp corners, no arcs). */
function polyPath(points: readonly [number, number][]): LanePath {
  const count = points.length;
  const xy = new Float64Array(count * 2);
  const cum = new Float64Array(count);
  points.forEach(([x, y], i) => {
    xy[i * 2] = x;
    xy[i * 2 + 1] = y;
    if (i > 0) {
      const [px, py] = points[i - 1] as [number, number];
      cum[i] = (cum[i - 1] as number) + Math.hypot(x - px, y - py);
    }
  });
  return {
    xy,
    count,
    cum,
    length: cum[count - 1] as number,
    nodes: [],
    nodeArc: new Float64Array(0),
  };
}

/** Straight lane path heading up (−y) along x = 0, 2000 units long. */
const straight = (): LanePath =>
  polyPath([
    [0, 0],
    [0, -1000],
    [0, -2000],
  ]);

function carAt(x: number, y: number, angle = 0, speed = 0): Car {
  const c = new Car(1);
  c.reset(x, y, angle);
  c.speed = speed;
  return c;
}

/** Steps a car straight up by `ds` per update and returns each step's award. */
function drive(t: RouteProgress, car: Car, steps: number, ds: number): number[] {
  const out: number[] = [];
  let last = t.update(0, car, DT);
  for (let k = 0; k < steps; k++) {
    car.y -= ds;
    const now = t.update(0, car, DT);
    out.push(now - last);
    last = now;
  }
  return out;
}

describe('nav/projectOnPathSigned', () => {
  it('signs the lateral offset (right of travel positive) and returns the tangent', () => {
    const p = straight();
    const out = new Float64Array(4);
    const s = projectOnPathSigned(p, 12, -300, 0, p.count, out);
    expect(s).toBeCloseTo(300, 9);
    expect(out[0]).toBeCloseTo(12, 9);
    expect(out[1]).toBeCloseTo(12, 9); // +x is the right of a car driving up
    expect(out[2]).toBeCloseTo(0, 9);
    expect(out[3]).toBeCloseTo(-1, 9);
    projectOnPathSigned(p, -7, -300, 0, p.count, out);
    expect(out[1]).toBeCloseTo(-7, 9);
  });

  it('turns the tangent smoothly through a vertex', () => {
    const p = polyPath([
      [0, 0],
      [0, -100],
      [100, -100],
    ]);
    const out = new Float64Array(4);
    projectOnPathSigned(p, 0, -99.9, 0, p.count, out);
    // halfway between up (0, −1) and right (1, 0)
    expect(out[2]).toBeCloseTo(Math.SQRT1_2, 2);
    expect(out[3]).toBeCloseTo(-Math.SQRT1_2, 2);
    projectOnPathSigned(p, 0, -20, 0, p.count, out);
    expect(out[2]).toBeCloseTo(0, 9);
  });
});

describe('ai/lane-discipline fitness', () => {
  it('laneFactor: 1 up to 0.15 w, linear to 0.25 at 0.35 w, 0 beyond', () => {
    expect(laneFactor(0, RW)).toBe(1);
    expect(laneFactor(15, RW)).toBe(1);
    expect(laneFactor(-15, RW)).toBe(1);
    expect(laneFactor(30, RW)).toBeCloseTo(0.4375, 12);
    expect(laneFactor(35, RW)).toBeCloseTo(0.25, 12);
    expect(laneFactor(35.01, RW)).toBe(0);
  });

  it('a car on the lane centre earns Δs per step', () => {
    const t = new RouteProgress(1, straight(), 0, 2000, RW);
    const car = carAt(0, 0, 0, 120);
    t.reset(0, car);
    const steps = drive(t, car, 50, 2);
    for (const d of steps) expect(d).toBeCloseTo(2, 9);
    expect(t.inLaneFraction(0)).toBe(1);
    expect(t.laneFactor(0)).toBe(1);
  });

  it('at 0.3 × roadWidth it earns ≈ 0.44 × Δs, and nothing beyond 0.35 w', () => {
    const t = new RouteProgress(1, straight(), 0, 2000, RW);
    const car = carAt(0.3 * RW, 0, 0, 120);
    t.reset(0, car);
    for (const d of drive(t, car, 30, 2)) expect(d).toBeCloseTo(0.4375 * 2, 9);
    expect(t.inLaneFraction(0)).toBe(0);
    car.x = 0.4 * RW;
    for (const d of drive(t, car, 10, 2)) expect(d).toBe(0);
    // driving back into the lane does not re-earn ground already consumed
    car.x = 0;
    car.y += 40;
    for (const d of drive(t, car, 20, 2)) expect(d).toBe(0);
  });

  it('counts time over the centre line; more than 1 s is a lane violation', () => {
    const t = new RouteProgress(1, straight(), 0, 2000, RW);
    const car = carAt(-0.3 * RW, 0, 0, 120);
    t.reset(0, car);
    let k = 0;
    while (!t.laneViolation(0) && k < 200) {
      car.y -= 2;
      t.update(0, car, DT);
      k++;
    }
    expect(t.oncomingTime(0)).toBeGreaterThan(ONCOMING_LIMIT);
    expect(k * DT).toBeCloseTo(ONCOMING_LIMIT, 1);
    // just left of the lane centre (not over the centre line) never counts
    const t2 = new RouteProgress(1, straight(), 0, 2000, RW);
    const c2 = carAt(-0.2 * RW, 0, 0, 120);
    t2.reset(0, c2);
    for (let j = 0; j < 200; j++) {
      c2.y -= 2;
      t2.update(0, c2, DT);
    }
    expect(t2.laneViolation(0)).toBe(false);
  });

  it('a car heading the wrong way while moving earns nothing and keeps its hint', () => {
    const p = polyPath(Array.from({ length: 41 }, (_, i) => [0, -i * 50] as [number, number]));
    const t = new RouteProgress(1, p, 0, 2000, RW);
    const car = carAt(0, -500, Math.PI, -150); // facing down, reversing up the road
    t.reset(0, car);
    const before = t.update(0, car, DT);
    for (let k = 0; k < 40; k++) {
      car.y -= 3;
      expect(t.update(0, car, DT)).toBe(before);
    }
    expect(t.laneFactor(0)).toBe(0);
    // a slow car facing backwards is not "moving": its lane factor stays as usual
    car.speed = 0.5;
    t.update(0, car, DT);
    expect(t.laneFactor(0)).toBe(1);
  });

  it('arrival adds the evaluated route length as a bonus and finishes the car', () => {
    const t = new RouteProgress(1, straight(), 0, 600, RW);
    const car = carAt(0, 0, 0, 120);
    t.reset(0, car);
    let last = 0;
    for (let k = 0; k < 400 && !t.finished(0); k++) {
      car.y -= 2;
      last = t.update(0, car, DT);
    }
    expect(t.finished(0)).toBe(true);
    expect(last).toBeGreaterThan(600 + 570);
    expect(t.routeLength).toBe(600);
  });
});

describe('ai/route observation (observe)', () => {
  const obs = (t: RouteProgress, car: Car): Float64Array => {
    const out = new Float64Array(5);
    t.reset(0, car);
    t.observe(0, car, out);
    return out;
  };

  it('lat is negative left of the lane (toward oncoming), positive toward the kerb', () => {
    const t = new RouteProgress(1, straight(), 0, 2000, RW);
    const left = obs(t, carAt(-10, -300));
    expect(left[0]).toBeCloseTo(-10 / (RW / 4), 9);
    const right = obs(t, carAt(10, -300));
    expect(right[0]).toBeCloseTo(10 / (RW / 4), 9);
    expect(obs(t, carAt(-80, -300))[0]).toBe(-1); // clamped
  });

  it('hdg ≈ +0.33 for a car heading 30° left of the lane tangent', () => {
    const t = new RouteProgress(1, straight(), 0, 2000, RW);
    const o = obs(t, carAt(0, -300, Math.PI / 6));
    expect(o[1]).toBeCloseTo(1 / 3, 6);
    expect(obs(t, carAt(0, -300, -Math.PI / 6))[1]).toBeCloseTo(-1 / 3, 6);
  });

  it('a corner 100 units ahead shows in wpFar while wpNear stays ≈ 0', () => {
    const p = polyPath([
      [0, 0],
      [0, -400],
      [-400, -400], // left turn at y = −400
    ]);
    const t = new RouteProgress(1, p, 0, 800, RW);
    const o = obs(t, carAt(0, -300, 0, 90));
    expect(Math.abs(o[2] as number)).toBeLessThan(1e-9);
    // the far point is 60 units past the corner, to the left: positive
    expect(o[3]).toBeGreaterThan(0.1);
    expect(o[3]).toBeCloseTo(Math.atan2(60, 100) / Math.PI, 6);
    expect(o[4]).toBeCloseTo(90 / 180, 9);
  });

  it('the infinite road observes the nearest lane', () => {
    const host = new InfiniteRoadSim({ seed: 1, trafficCount: 0 });
    const t = new AxisProgress(1, host);
    const out = new Float64Array(5);
    const laneX = host.laneX(2, 0);
    const car = carAt(laneX - 11, -40, Math.PI / 6, 60);
    t.reset(0, car);
    t.observe(0, car, out);
    expect(out[0]).toBeCloseTo(-11 / (host.laneWidth / 2), 9);
    expect(out[1]).toBeCloseTo(1 / 3, 9);
    expect(out[4]).toBeCloseTo(60 / 180, 9);
  });
});

/** A minimal host: an empty world with one straight lane route (no traffic, no walls). */
class LaneHost implements SimHost {
  readonly kind = 'city' as const;
  readonly roadWidth = RW;
  readonly world = new CollisionWorld();
  readonly particles = new Particles(16);
  readonly skids = new SkidMarks(16);
  readonly rng = new Rng(1);
  readonly lights = null;
  time = 0;
  stepCount = 0;
  cars: Car[] = [];
  manual: Car | null = null;
  extension: SimExtension | null = null;
  readonly pose: SpawnPose;

  constructor(pose: SpawnPose) {
    this.pose = pose;
  }

  setExtension(ext: SimExtension | null): void {
    this.extension = ext;
    this.cars = ext ? [...ext.cars] : [];
  }
  damage(car: Car): void {
    car.damaged = true;
  }
  afterMove(): void {}
  spawnPose(): SpawnPose {
    return this.pose;
  }
  createProgressTracker(capacity: number): ProgressTracker {
    return new RouteProgress(capacity, straight(), 0, 2000, RW);
  }
  step(dt: number): void {
    this.extension?.step(this, dt);
    this.time += dt;
    this.stepCount++;
  }
  getCar(id: number): Car | undefined {
    return this.cars.find((c) => c.id === id);
  }
}

/** A tanh brain that drives straight ahead at full throttle whatever it sees. */
function straightBrain(inputs: number): NeuralNetwork {
  const net = new NeuralNetwork([inputs, 4], 'tanh');
  (net.levels[0] as Level).biases.set([-3, 3, 3, 3]); // forward ≈ 1, the rest < 0
  return net;
}

describe('ai/population lane rules', () => {
  it('a car over the centre line for 1.2 s is eliminated with its fitness × 0.8', () => {
    const host = new LaneHost({ x: -0.3 * RW, y: 0, angle: 0 });
    const pop = new Population(
      host,
      { population: 1, mutation: 0, navInputs: true, activation: 'tanh', hidden: [] },
      straightBrain(5 + NAV_INPUTS.length),
    );
    host.setExtension(pop);
    const car = pop.cars[0] as Car;
    const tracker = pop.progress as RouteProgress;
    let award = 0;
    for (let k = 0; k < Math.round(1.2 / DT) && pop.eliminated[0] === 0; k++) {
      host.step(DT);
      if (pop.eliminated[0] === 0) award = pop.fitness[0] as number;
    }
    expect(pop.eliminated[0]).toBe(1);
    expect(car.damaged).toBe(false);
    expect(tracker.oncomingTime(0)).toBeGreaterThan(1);
    // the award kept growing at 0.4375 per unit until the last step, then × 0.8
    expect(pop.fitness[0]).toBeGreaterThan(0);
    expect(pop.fitness[0]).toBeLessThan(award);
    expect(pop.fitness[0] as number).toBeCloseTo(0.8 * tracker.update(0, car, 0), 9);
  });

  it('feeds the five route inputs after the rays', () => {
    const host = new LaneHost({ x: 10, y: 0, angle: 0.2 });
    const pop = new Population(
      host,
      { population: 1, mutation: 0, navInputs: true, activation: 'tanh', hidden: [] },
      straightBrain(10),
    );
    host.setExtension(pop);
    host.step(DT); // inputs are read before moving: the second step sees a moving car
    host.step(DT);
    const brain = pop.brains[0] as NeuralNetwork;
    const seen = Array.from((brain.levels[0] as Level).inputs);
    expect(seen).toHaveLength(10);
    expect(seen[5]).toBeGreaterThan(0); // lat: right of the lane
    expect(seen[6]).toBeGreaterThan(0); // hdg: pointing left
    expect(seen[9]).toBeGreaterThan(0); // speed
    expect(pop.inLaneFraction(0)).toBe(1);
  });
});

describe('ai/brain io (format v2)', () => {
  const training = {
    generations: 12,
    bestFitness: 4321,
    world: 'grid-town',
    mutation: 0.12,
    date: '2026-11-08T00:00:00.000Z',
  };

  it('a 12-input city brain round-trips and fits the route-input layout', () => {
    const net = NeuralNetwork.random([12, 8, 4], new Rng(21), 'tanh');
    const names = inputNames(7, NAV_INPUTS);
    expect(names.slice(7)).toEqual(['lat', 'hdg', 'wpNear', 'wpFar', 'speed']);
    const file = serializeBrain(net, names, training);
    expect(file.version).toBe(BRAIN_VERSION);
    expect(file.version).toBe(2);
    const res = parseBrain(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.file.inputs).toEqual(names);
    const x = [0.1, 0.5, 0.9, 0.3, 0, 0.2, 0.7, -0.4, 0.3, 0.1, -0.2, 0.6];
    const ya = Array.from(net.feedForward(x));
    Array.from(res.net.feedForward(x)).forEach((v, i) => expect(v).toBeCloseTo(ya[i] as number, 5));
    const layout = fitLayout(res.net, res.file.inputs, inputLayouts(7, NAV_INPUTS));
    expect(layout?.nav).toBe(true);
  });

  it('a 7-input (v1 route-input) brain is rejected with the mismatch message', () => {
    const old = NeuralNetwork.random([7, 6, 4], new Rng(22), 'tanh');
    const file = {
      ...serializeBrain(old, inputNames(5, ['wpAngle', 'speed']), training),
      version: 1,
    };
    const res = parseBrain(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true); // v1 files still parse (migrated to v2)
    if (!res.ok) return;
    expect(res.file.version).toBe(2);
    const city = inputLayouts(7, NAV_INPUTS);
    // 7 inputs matches the rays-only city count, but not the input names
    expect(fitLayout(res.net, res.file.inputs, city)).toBeNull();
    const msg = layoutMismatch(res.net, res.file.inputs, city);
    expect(msg).toContain('Brain topology [7, 6, 4] does not match the current sensors');
    expect(msg).toContain('12 inputs with route inputs, or 7 without');
    expect(msg).toContain('wpAngle');
    // and on the infinite road (5 rays: 10 or 5 inputs) it does not fit either
    const road = inputLayouts(5, NAV_INPUTS);
    expect(fitLayout(res.net, res.file.inputs, road)).toBeNull();
    expect(layoutMismatch(res.net, res.file.inputs, road)).toContain(
      '10 inputs with route inputs, or 5 without',
    );
  });

  it('a v1 rays-only brain still fits after migration', () => {
    const v1 = NeuralNetwork.random([5, 6, 4], new Rng(23));
    const file = { ...serializeBrain(v1, inputNames(5), training), version: 1 };
    const res = parseBrain(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(fitLayout(res.net, res.file.inputs, inputLayouts(5, NAV_INPUTS))?.nav).toBe(false);
    expect(parseBrain({ ...file, version: 3 }).ok).toBe(false);
  });
});
