import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fitLayout,
  inputLayouts,
  inputNames,
  layoutMismatch,
} from '../../../src/engine/ai/brainSchema.ts';
import {
  LIGHT_INPUT,
  NAV_INPUTS,
  Population,
  routeInputNames,
  type EvolutionConfig,
} from '../../../src/engine/ai/evolution.ts';
import {
  LIGHT_RANGE,
  RouteProgress,
  type LightSource,
  type RouteLight,
} from '../../../src/engine/ai/fitness.ts';
import { NeuralNetwork, type Level } from '../../../src/engine/ai/network.ts';
import { Car } from '../../../src/engine/car/car.ts';
import { createCar } from '../../../src/engine/car/carFactory.ts';
import { CollisionWorld, HIT_CAR } from '../../../src/engine/car/damage.ts';
import { parseWorld } from '../../../src/engine/io/serialize.ts';
import type { LightColor } from '../../../src/engine/markings/light.ts';
import type { SpawnPose } from '../../../src/engine/markings/start.ts';
import { Rng } from '../../../src/engine/math/rng.ts';
import type { LanePath } from '../../../src/engine/nav/lanePath.ts';
import type { ProgressTracker, SimExtension, SimHost } from '../../../src/engine/sim/host.ts';
import { Particles, SkidMarks } from '../../../src/engine/sim/particlesSim.ts';
import { Simulation } from '../../../src/engine/sim/simulation.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';

const DT = 1 / 60;
const RW = 100;

/** Straight lane path up (−y) along x = 0, 2000 units. */
function straight(): LanePath {
  const n = 41;
  const xy = new Float64Array(n * 2);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xy[i * 2 + 1] = -i * 50;
    cum[i] = i * 50;
  }
  return { xy, count: n, cum, length: 2000, nodes: [], nodeArc: new Float64Array(0) };
}

/** A light whose colour the test sets. */
class TestLight implements LightSource {
  color: LightColor = 'red';
  colorOf(): LightColor {
    return this.color;
  }
}

/**
 * An empty world with one straight route, an optional light on it, and optional extra
 * cars (traffic) that the test moves itself.
 */
class TrafficHost implements SimHost {
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
  /** Cars that are not population cars (traffic), moved by `move` before each step. */
  others: Car[] = [];
  move: (dt: number) => void = () => {};
  /** Whether population cars are real road users (in the dynamic set). */
  aiInWorld = false;

  readonly pose: SpawnPose;
  readonly routeLights: RouteLight[];
  readonly light: TestLight | null;

  constructor(pose: SpawnPose, routeLights: RouteLight[] = [], light: TestLight | null = null) {
    this.pose = pose;
    this.routeLights = routeLights;
    this.light = light;
  }

  setExtension(ext: SimExtension | null): void {
    this.extension = ext;
    this.cars = [...this.others, ...(ext ? ext.cars : [])];
  }
  damage(car: Car): void {
    car.damaged = true;
    car.speed = 0;
  }
  afterMove(): void {}
  spawnPose(): SpawnPose {
    return this.pose;
  }
  createProgressTracker(capacity: number): ProgressTracker {
    return new RouteProgress(capacity, straight(), 0, 2000, RW, this.routeLights, this.light);
  }
  step(dt: number): void {
    this.move(dt);
    this.world.setDynamic(this.cars, this.cars.length, (c) => c.kind !== 'ai' || this.aiInWorld);
    this.extension?.step(this, dt);
    this.time += dt;
    this.stepCount++;
  }
  getCar(id: number): Car | undefined {
    return this.cars.find((c) => c.id === id);
  }
}

/** One-level tanh brain: full throttle straight ahead (`go`), or brake and stand. */
function brain(inputs: number, go: boolean): NeuralNetwork {
  const net = new NeuralNetwork([inputs, 4], 'tanh');
  (net.levels[0] as Level).biases.set(go ? [-3, 3, 3, 3] : [3, 3, 3, 3]);
  return net;
}

function population(
  host: TrafficHost,
  go: boolean,
  over: Partial<EvolutionConfig> = {},
): Population {
  const cfg: Partial<EvolutionConfig> = {
    population: 1,
    mutation: 0,
    navInputs: true,
    activation: 'tanh',
    hidden: [],
    stuckTimeout: 1,
    timeLimit: 30,
    ...over,
  };
  const inputs = 5 + NAV_INPUTS.length + (cfg.lightInput ? 1 : 0);
  const pop = new Population(host, cfg, brain(inputs, go));
  host.setExtension(pop);
  return pop;
}

function trafficCar(id: number, x: number, y: number, speed: number): Car {
  const c = createCar(id, 'traffic');
  c.reset(x, y, 0);
  c.speed = speed;
  return c;
}

describe('sim/collision world reports the car it hit', () => {
  it('lastHitCarId and hasDynamic', () => {
    const w = new CollisionWorld();
    const a = trafficCar(7, 0, 0, 0);
    const b = trafficCar(8, 0, -500, 0);
    w.setDynamic([a, b], 2, () => true);
    expect(w.hasDynamic(7)).toBe(true);
    expect(w.hasDynamic(9)).toBe(false);
    const probe = trafficCar(9, 0, -510, 0);
    expect(w.polygonHit(probe.polygon, probe.id)).toBe(HIT_CAR);
    expect(w.lastHitCarId).toBe(8);
  });
});

describe('ai/ghost fault rule', () => {
  it('a waiting ghost is not damaged by traffic driving into its back', () => {
    const host = new TrafficHost({ x: 0, y: -300, angle: 0 });
    const t = trafficCar(500, 0, -150, 120); // behind the AI car, driving up at 120 u/s
    host.others = [t];
    host.move = (dt) => {
      t.y -= t.speed * dt;
      t.updatePolygon();
    };
    const pop = population(host, false, { stuckTimeout: 30 });
    let overlapped = false;
    for (let k = 0; k < 120; k++) {
      host.step(DT);
      if (Math.abs(t.y - (pop.cars[0] as Car).y) < 30) overlapped = true;
    }
    expect(overlapped).toBe(true);
    expect((pop.cars[0] as Car).damaged).toBe(false);
  });

  it('a ghost that drives into a standing car is damaged', () => {
    const host = new TrafficHost({ x: 0, y: 0, angle: 0 });
    host.others = [trafficCar(500, 0, -200, 0)];
    const pop = population(host, true);
    for (let k = 0; k < 120 && !(pop.cars[0] as Car).damaged; k++) host.step(DT);
    expect((pop.cars[0] as Car).damaged).toBe(true);
    expect(pop.fitness[0]).toBeGreaterThan(0);
  });

  it('a real road user (traffic can see it) counts every car contact', () => {
    const host = new TrafficHost({ x: 0, y: -300, angle: 0 });
    host.aiInWorld = true;
    const t = trafficCar(500, 0, -150, 120);
    host.others = [t];
    host.move = (dt) => {
      t.y -= t.speed * dt;
      t.updatePolygon();
    };
    const pop = population(host, false, { stuckTimeout: 30 });
    for (let k = 0; k < 120 && !(pop.cars[0] as Car).damaged; k++) host.step(DT);
    expect((pop.cars[0] as Car).damaged).toBe(true);
  });
});

describe('ai/traffic-light input and red-light runs', () => {
  const at = (y: number): Car => {
    const c = new Car(1);
    c.reset(0, y, 0);
    c.speed = 60;
    return c;
  };
  const setup = (): { t: RouteProgress; light: TestLight } => {
    const light = new TestLight();
    const t = new RouteProgress(1, straight(), 0, 2000, RW, [{ id: 3, arc: 400 }], light);
    return { t, light };
  };

  it('observes the proximity of the next red or yellow light (0 when green or far)', () => {
    const { t, light } = setup();
    const out = new Float64Array(6);
    const car = at(-200); // front at 225: 175 units before the line
    t.reset(0, car);
    t.observe(0, car, out);
    expect(out[5]).toBeCloseTo(1 - 175 / LIGHT_RANGE, 9);
    expect(t.stopAhead(0)).toBe(true);
    light.color = 'yellow';
    t.observe(0, car, out);
    expect(out[5]).toBeCloseTo(1 - 175 / LIGHT_RANGE, 9);
    light.color = 'green';
    t.observe(0, car, out);
    expect(out[5]).toBe(0);
    light.color = 'red';
    const far = at(0); // front at 25: 375 units away, beyond the range
    t.reset(0, far);
    t.observe(0, far, out);
    expect(out[5]).toBe(0);
    expect(t.stopAhead(0)).toBe(false);
    expect(t.lightCount).toBe(1);
  });

  it('crossing the stop line on red is a violation; on yellow or green it is not', () => {
    for (const [color, run] of [
      ['red', true],
      ['yellow', false],
      ['green', false],
    ] as const) {
      const { t, light } = setup();
      light.color = color;
      const car = at(-300);
      t.reset(0, car);
      for (let k = 0; k < 40; k++) {
        car.y -= 3;
        t.update(0, car, DT);
      }
      expect(t.redLightViolation(0), color).toBe(run);
      // past the line the light no longer shows
      const out = new Float64Array(6);
      t.observe(0, car, out);
      expect(out[5]).toBe(0);
    }
  });

  it('a car with the light input running a red light is eliminated with fitness × 0.8', () => {
    const light = new TestLight();
    const host = new TrafficHost({ x: 0, y: 0, angle: 0 }, [{ id: 3, arc: 400 }], light);
    const pop = population(host, true, { lightInput: true });
    expect(pop.topology).toEqual([11, 4]);
    let before = 0;
    for (let k = 0; k < 240 && pop.eliminated[0] === 0; k++) {
      before = pop.fitness[0] as number;
      host.step(DT);
    }
    expect(pop.eliminated[0]).toBe(1);
    expect((pop.cars[0] as Car).damaged).toBe(false);
    expect((pop.progress as RouteProgress).redLightViolation(0)).toBe(true);
    expect(pop.fitness[0]).toBeLessThan(before);
    // without the light input the same run is not judged by the light
    const host2 = new TrafficHost({ x: 0, y: 0, angle: 0 }, [{ id: 3, arc: 400 }], light);
    const pop2 = population(host2, true);
    for (let k = 0; k < 240; k++) host2.step(DT);
    expect(pop2.eliminated[0]).toBe(0);
  });
});

describe('ai/waiting is not being stuck', () => {
  it('standing at a red light keeps the stuck timer still; standing for no reason does not', () => {
    const light = new TestLight();
    const host = new TrafficHost({ x: 0, y: -250, angle: 0 }, [{ id: 3, arc: 400 }], light);
    const pop = population(host, false, { lightInput: true, stuckTimeout: 1 });
    for (let k = 0; k < 180; k++) host.step(DT); // 3 s at red
    expect(pop.eliminated[0]).toBe(0);
    expect(pop.generation).toBe(0);
    light.color = 'green';
    for (let k = 0; k < 90; k++) host.step(DT); // 1.5 s with no reason to stand
    expect(pop.generation).toBe(1); // eliminated as stuck: the generation ended
    expect(pop.history[0]?.duration).toBeGreaterThan(3.9);
  });

  it('standing behind a car keeps the stuck timer still', () => {
    const host = new TrafficHost({ x: 0, y: 0, angle: 0 });
    host.others = [trafficCar(500, 0, -70, 0)]; // 70 units ahead: inside the wait gap
    const pop = population(host, false, { stuckTimeout: 1 });
    for (let k = 0; k < 180; k++) host.step(DT);
    expect(pop.eliminated[0]).toBe(0);
    expect(pop.generation).toBe(0);
    // and with nothing ahead the same car is stuck
    const host2 = new TrafficHost({ x: 0, y: 0, angle: 0 });
    const pop2 = population(host2, false, { stuckTimeout: 1 });
    for (let k = 0; k < 180; k++) host2.step(DT);
    expect(pop2.generation).toBeGreaterThanOrEqual(1); // eliminated as stuck: a new generation
  });
});

describe('ai/brain layouts with the light input', () => {
  it('the city accepts route + light (13), route (12, v1.1) and rays-only (7) brains', () => {
    expect(routeInputNames(true)).toEqual([...NAV_INPUTS, LIGHT_INPUT]);
    expect(routeInputNames(false)).toEqual([...NAV_INPUTS]);
    const layouts = inputLayouts(7, NAV_INPUTS, [LIGHT_INPUT]);
    const v12 = NeuralNetwork.random([13, 8, 4], new Rng(1), 'tanh');
    expect(fitLayout(v12, inputNames(7, routeInputNames(true)), layouts)).toMatchObject({
      nav: true,
      light: true,
    });
    const v11 = NeuralNetwork.random([12, 8, 4], new Rng(2), 'tanh');
    expect(fitLayout(v11, inputNames(7, NAV_INPUTS), layouts)).toMatchObject({
      nav: true,
      light: false,
    });
    const old = NeuralNetwork.random([7, 6, 4], new Rng(3), 'tanh');
    const names = inputNames(5, ['wpAngle', 'speed']);
    expect(fitLayout(old, names, layouts)).toBeNull();
    expect(layoutMismatch(old, names, layouts)).toContain(
      '13 or 12 inputs with route inputs, or 7 without',
    );
  });

  it("Grid Town's route passes one signalised junction", () => {
    const res = parseWorld(JSON.parse(readFileSync('public/worlds/grid-town.world.json', 'utf8')));
    if (!res.ok) throw new Error('world');
    const model = res.value.model;
    const sim = new Simulation(model, new WorldGeometry(generateWorld(worldInputFrom(model))), {
      trafficCount: 0,
      manual: false,
      seed: 1,
    });
    const t = sim.createProgressTracker(1);
    expect(t).toBeInstanceOf(RouteProgress);
    expect((t as RouteProgress).lightCount).toBe(1);
  });
});
