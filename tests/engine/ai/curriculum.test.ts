import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CITY_EVOLUTION,
  CURRICULUM_START,
  CURRICULUM_STEP,
  Population,
  cityEvolution,
  type EvolutionConfig,
} from '../../../src/engine/ai/evolution.ts';
import { RouteProgress } from '../../../src/engine/ai/fitness.ts';
import { NeuralNetwork, type Level } from '../../../src/engine/ai/network.ts';
import type { Car } from '../../../src/engine/car/car.ts';
import { CollisionWorld } from '../../../src/engine/car/damage.ts';
import { DEFAULT_CITY_SENSOR } from '../../../src/engine/car/sensor.ts';
import { parseWorld } from '../../../src/engine/io/serialize.ts';
import type { SpawnPose } from '../../../src/engine/markings/start.ts';
import { Rng } from '../../../src/engine/math/rng.ts';
import type { LanePath } from '../../../src/engine/nav/lanePath.ts';
import type { ProgressTracker, SimExtension, SimHost } from '../../../src/engine/sim/host.ts';
import { Particles, SkidMarks } from '../../../src/engine/sim/particlesSim.ts';
import { Simulation } from '../../../src/engine/sim/simulation.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';

const DT = 1 / 60;
const RW = 100;
const ROUTE = 2000;

/** Straight lane path up (−y) along x = 0. */
function straight(): LanePath {
  const n = 41;
  const xy = new Float64Array(n * 2);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xy[i * 2 + 1] = -i * 50;
    cum[i] = i * 50;
  }
  return {
    xy,
    count: n,
    cum,
    length: cum[n - 1] as number,
    nodes: [],
    nodeArc: new Float64Array(0),
  };
}

/** An empty world with one straight route of ROUTE units. */
class RouteHost implements SimHost {
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
  setExtension(ext: SimExtension | null): void {
    this.extension = ext;
    this.cars = ext ? [...ext.cars] : [];
  }
  damage(car: Car): void {
    car.damaged = true;
  }
  afterMove(): void {}
  spawnPose(): SpawnPose {
    return { x: 0, y: 0, angle: 0 };
  }
  createProgressTracker(capacity: number): ProgressTracker {
    return new RouteProgress(capacity, straight(), 0, ROUTE, RW);
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

/** One-level tanh brain: full throttle straight ahead (`go`) or brake and stay (`!go`). */
function brain(go: boolean): NeuralNetwork {
  const net = new NeuralNetwork([10, 4], 'tanh');
  (net.levels[0] as Level).biases.set(go ? [-3, 3, 3, 3] : [3, 3, 3, 3]);
  return net;
}

function population(
  over: Partial<EvolutionConfig>,
  seed = brain(true),
): {
  host: RouteHost;
  pop: Population;
} {
  const host = new RouteHost();
  const pop = new Population(
    host,
    {
      population: 20,
      mutation: 0,
      navInputs: true,
      activation: 'tanh',
      hidden: [],
      selection: 'tournament',
      curriculum: true,
      stuckTimeout: 1,
      timeLimit: 30,
      ...over,
    },
    seed,
  );
  host.setExtension(pop);
  return { host, pop };
}

/** Steps until the current generation ends. */
function finishGeneration(host: RouteHost, pop: Population): void {
  const g = pop.generation;
  for (let k = 0; k < 60 * 60 && pop.generation === g; k++) host.step(DT);
  expect(pop.generation).toBe(g + 1);
}

describe('ai/curriculum', () => {
  it('starts at min(route, 320) and grows by 260 once ≥ 10% of the cars reach the horizon', () => {
    const { host, pop } = population({});
    expect(pop.horizon).toBe(CURRICULUM_START);
    expect(pop.stage).toBe(1);
    expect(pop.routeLength).toBe(ROUTE);
    expect(pop.routeShare).toBeCloseTo(CURRICULUM_START / ROUTE, 12);
    finishGeneration(host, pop);
    const rec = pop.history[0];
    expect(rec?.reached).toBe(20); // every car drives straight to the horizon
    expect(rec?.stage).toBe(1);
    expect(rec?.horizon).toBe(CURRICULUM_START);
    expect(pop.horizon).toBe(CURRICULUM_START + CURRICULUM_STEP);
    expect(pop.stage).toBe(2);
    // and so on, until the whole route, where it stops growing
    for (let g = 0; g < 10; g++) finishGeneration(host, pop);
    expect(pop.horizon).toBe(ROUTE);
    expect(pop.routeShare).toBe(1);
  });

  it('does not grow when fewer than 10% reach it, unless the best car reaches it twice in a row', () => {
    const stop = brain(false);
    const { host, pop } = population({ elite: 1 });
    const restrain = (): void => {
      for (let i = 1; i < pop.brains.length; i++) (pop.brains[i] as NeuralNetwork).copyFrom(stop);
    };
    restrain(); // only car 0 drives: 1 of 20 = 5%
    finishGeneration(host, pop);
    expect(pop.history[0]?.reached).toBe(1);
    expect(pop.horizon).toBe(CURRICULUM_START); // first time: no growth
    restrain();
    finishGeneration(host, pop);
    expect(pop.history[1]?.reached).toBe(1);
    expect(pop.horizon).toBe(CURRICULUM_START + CURRICULUM_STEP); // second in a row: grows
    // nobody reaching it: no growth
    for (const b of pop.brains) b.copyFrom(stop);
    finishGeneration(host, pop);
    expect(pop.history[2]?.reached).toBe(0);
    expect(pop.horizon).toBe(CURRICULUM_START + CURRICULUM_STEP);
  });

  it('the arrival bonus and the freeze use the current horizon', () => {
    const { host, pop } = population({ population: 1 });
    const t = pop.progress as RouteProgress;
    expect(t.horizon).toBe(CURRICULUM_START);
    let k = 0;
    while (pop.eliminated[0] === 0 && k++ < 600) host.step(DT);
    const car = pop.cars[0] as Car;
    expect(t.finished(0)).toBe(true);
    expect(car.speed).toBe(0); // frozen with full credit
    // progress just short of the horizon (arrival counts 25 units early) plus the horizon
    const f = pop.fitness[0] as number;
    expect(f).toBeGreaterThan(CURRICULUM_START - 25 + CURRICULUM_START);
    expect(f).toBeLessThan(CURRICULUM_START + CURRICULUM_START);
    // next stage: the bonus is the new horizon
    finishGeneration(host, pop);
    const t2 = pop.progress as RouteProgress;
    expect(t2.horizon).toBe(CURRICULUM_START + CURRICULUM_STEP);
    k = 0;
    while (pop.eliminated[0] === 0 && k++ < 900) host.step(DT);
    expect(pop.fitness[0]).toBeGreaterThan(2 * (CURRICULUM_START + CURRICULUM_STEP) - 25);
  });

  it('is off by default: the whole route is evaluated', () => {
    const { pop } = population({ curriculum: false });
    expect(pop.horizon).toBe(ROUTE);
    expect((pop.progress as RouteProgress).horizon).toBe(ROUTE);
    expect(pop.routeShare).toBe(1);
  });

  it('can start from a given horizon (turbo hand-back)', () => {
    const { pop } = population({ startHorizon: 900 });
    expect(pop.horizon).toBe(900);
    expect((pop.progress as RouteProgress).horizon).toBe(900);
  });
});

describe('ai/elites and spawn jitter', () => {
  it('copies the best ever and the next best brains unmutated (elite 3)', () => {
    const { host, pop } = population(
      { population: 12, mutation: 0.3, elite: 3, curriculum: false },
      brain(true),
    );
    const params = (b: NeuralNetwork): number[] =>
      b.levels.flatMap((l) => [...Array.from(l.weights), ...Array.from(l.biases)]);
    for (let k = 0; k < 90; k++) host.step(DT); // 1.5 s: everyone still driving
    const fit = Array.from(pop.fitness);
    const ranked = Array.from({ length: 12 }, (_, i) => i).sort(
      (a, b) => (fit[b] as number) - (fit[a] as number),
    );
    const snap = pop.brains.map(params);
    expect(fit[ranked[2] as number]).toBeGreaterThan(fit[ranked[3] as number] as number);
    pop.nextGeneration(host);
    const slots = pop.brains.map(params);
    // generation 0's best is the new best ever (slot 0), then the next two, unmutated
    expect(slots[0]).toEqual(snap[ranked[0] as number]);
    expect(slots[1]).toEqual(snap[ranked[1] as number]);
    expect(slots[2]).toEqual(snap[ranked[2] as number]);
    // the rest are bred (crossover + mutation 0.3): none is an exact copy of a parent
    for (let i = 3; i < 12; i++) expect(snap).not.toContainEqual(slots[i]);
  });

  it('jitters spawns by ±0.08 road widths and ±4°, seeded and different per generation', () => {
    const spawns = (seed: number): { x: number; a: number }[][] => {
      const { host, pop } = population({
        population: 30,
        jitterLateral: 0.08,
        jitterHeading: (4 * Math.PI) / 180,
        seed,
      });
      const out = [pop.cars.map((c) => ({ x: c.x, a: c.angle }))];
      pop.nextGeneration(host);
      out.push(pop.cars.map((c) => ({ x: c.x, a: c.angle })));
      return out;
    };
    const a = spawns(4);
    const b = spawns(4);
    expect(b).toEqual(a); // seeded
    const g0 = a[0] ?? [];
    for (const s of g0) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(0.08 * RW + 1e-9);
      expect(Math.abs(s.a)).toBeLessThanOrEqual((4 * Math.PI) / 180 + 1e-9);
    }
    expect(new Set(g0.map((s) => s.x.toFixed(6))).size).toBeGreaterThan(25);
    expect(Math.max(...g0.map((s) => Math.abs(s.x)))).toBeGreaterThan(0.06 * RW);
    expect(a[1]).not.toEqual(a[0]); // a new draw each generation
    // no jitter: the exact pose
    const { pop } = population({ population: 3 });
    for (const c of pop.cars) {
      expect(c.x).toBe(0);
      expect(c.angle).toBe(0);
    }
  });
});

describe('ai/city training defaults', () => {
  it('route inputs, 7 rays over 5π/6 reaching 200, tanh [12, 8, 4], tournament with 3 elites', () => {
    expect(DEFAULT_CITY_SENSOR).toEqual({ rayCount: 7, spread: (5 * Math.PI) / 6, length: 200 });
    expect(CITY_EVOLUTION).toMatchObject({
      navInputs: true,
      activation: 'tanh',
      hidden: [8],
      selection: 'tournament',
      tournamentK: 5,
      mutation: 0.12,
      elite: 3,
      curriculum: true,
      jitterLateral: 0.08,
    });
    expect(CITY_EVOLUTION.jitterHeading).toBeCloseTo((4 * Math.PI) / 180, 12);
    const res = parseWorld(JSON.parse(readFileSync('public/worlds/grid-town.world.json', 'utf8')));
    if (!res.ok) throw new Error('world');
    const model = res.value.model;
    const sim = new Simulation(model, new WorldGeometry(generateWorld(worldInputFrom(model))), {
      trafficCount: 2,
      manual: false,
      seed: 3,
    });
    const pop = new Population(sim, cityEvolution({ population: 10, seed: 2 }));
    sim.setExtension(pop);
    expect(pop.topology).toEqual([12, 8, 4]);
    expect(pop.sensors[0]?.config).toEqual(DEFAULT_CITY_SENSOR);
    expect(pop.brains[0]?.activation).toBe('tanh');
    expect(pop.config.elite).toBe(3);
    // the Grid Town route is long: the curriculum starts at 320 units of it
    expect(pop.routeLength).toBeGreaterThan(5000);
    expect(pop.horizon).toBe(CURRICULUM_START);
    for (let i = 0; i < 120; i++) sim.step(DT);
    expect(pop.inLaneFraction(0)).toBeGreaterThanOrEqual(0);
    // overrides merge (the sensor is kept)
    expect(cityEvolution({ hidden: [6], mutation: 0.2 })).toMatchObject({
      hidden: [6],
      mutation: 0.2,
      sensor: DEFAULT_CITY_SENSOR,
    });
  });
});
