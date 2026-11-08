import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  brainFits,
  inputNames,
  parseBrain,
  serializeBrain,
} from '../../../src/engine/ai/brainSchema.ts';
import { Population } from '../../../src/engine/ai/evolution.ts';
import { AxisProgress, CoverageProgress } from '../../../src/engine/ai/fitness.ts';
import { crossover, mutate } from '../../../src/engine/ai/mutate.ts';
import { NeuralNetwork, type Level } from '../../../src/engine/ai/network.ts';
import { Car } from '../../../src/engine/car/car.ts';
import { parseWorld } from '../../../src/engine/io/serialize.ts';
import { Rng } from '../../../src/engine/math/rng.ts';
import { InfiniteRoadSim } from '../../../src/engine/sim/infiniteRoad.ts';
import { Simulation } from '../../../src/engine/sim/simulation.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';

const DT = 1 / 60;

/** A hand-built [2, 2, 1] network with known weights. */
function known(activation: 'step' | 'tanh' = 'step'): NeuralNetwork {
  const n = new NeuralNetwork([2, 2, 1], activation);
  const l0 = n.levels[0] as Level;
  const l1 = n.levels[1] as Level;
  // hidden0 = x0 + x1 (bias 0.5) ; hidden1 = x0 - x1 (bias 0)
  l0.setWeight(0, 0, 1);
  l0.setWeight(1, 0, 1);
  l0.setWeight(0, 1, 1);
  l0.setWeight(1, 1, -1);
  l0.biases.set([0.5, 0]);
  // out = h0 - h1 (bias 0.5)
  l1.setWeight(0, 0, 1);
  l1.setWeight(1, 0, -1);
  l1.biases.set([0.5]);
  return n;
}

describe('ai/network', () => {
  it('feeds forward with the step activation (output 1 iff sum > bias)', () => {
    const n = known();
    // x = (1, 1): h0 = 2 > 0.5 → 1, h1 = 0 > 0 → 0, out = 1 − 0 = 1 > 0.5 → 1
    expect(Array.from(n.feedForward([1, 1]))).toEqual([1]);
    // x = (1, 0): h0 = 1 → 1, h1 = 1 → 1, out = 0 → 0
    expect(Array.from(n.feedForward([1, 0]))).toEqual([0]);
    // x = (0, 0): h0 = 0 → 0, h1 = 0 → 0 (not > 0), out = 0 → 0
    expect(Array.from(n.feedForward([0, 0]))).toEqual([0]);
  });

  it('feeds forward with tanh (smooth, in (−1, 1))', () => {
    const n = known('tanh');
    const out = n.feedForward([1, 1])[0] as number;
    const h0 = Math.tanh(2 - 0.5);
    const h1 = Math.tanh(0);
    expect(out).toBeCloseTo(Math.tanh(h0 - h1 - 0.5), 12);
    expect(Math.abs(out)).toBeLessThan(1);
  });

  it('random networks have parameters in [−1, 1] and the right shape', () => {
    const n = NeuralNetwork.random([5, 6, 4], new Rng(1));
    expect(n.levels).toHaveLength(2);
    expect(n.inputCount).toBe(5);
    expect(n.outputCount).toBe(4);
    expect(n.parameterCount()).toBe(5 * 6 + 6 + 6 * 4 + 4);
    for (const l of n.levels)
      for (const w of [...l.weights, ...l.biases]) expect(Math.abs(w)).toBeLessThanOrEqual(1);
    expect(n.feedForward([0, 0, 0, 0, 0])).toHaveLength(4);
  });

  it('guards degenerate topologies', () => {
    expect(() => new NeuralNetwork([5])).toThrow(/at least/);
    expect(() => new NeuralNetwork([5, 0, 4])).toThrow(/positive/);
    const single = NeuralNetwork.random([3, 4], new Rng(2)); // one level is valid
    expect(single.feedForward([1, 0, 1])).toHaveLength(4);
  });

  it('clones and copies deeply', () => {
    const a = NeuralNetwork.random([3, 2], new Rng(3));
    const b = a.clone();
    (b.levels[0] as Level).weights[0] = 99;
    expect((a.levels[0] as Level).weights[0]).not.toBe(99);
    a.copyFrom(b);
    expect((a.levels[0] as Level).weights[0]).toBe(99);
    expect(() => a.copyFrom(NeuralNetwork.random([3, 3], new Rng(1)))).toThrow();
  });
});

describe('ai/mutate and crossover', () => {
  it('mutate(0) is the identity', () => {
    const a = NeuralNetwork.random([5, 6, 4], new Rng(4));
    const b = mutate(a.clone(), 0, new Rng(5));
    expect(serializeBrain(b, inputNames(5), training()).levels).toEqual(
      serializeBrain(a, inputNames(5), training()).levels,
    );
  });

  it('mutate(1) is fully random but stays within [−1, 1]', () => {
    const a = NeuralNetwork.random([5, 6, 4], new Rng(6));
    const b = mutate(a.clone(), 1, new Rng(7));
    let differ = 0;
    b.levels.forEach((l, li) => {
      for (let k = 0; k < l.weights.length; k++) {
        const w = l.weights[k] as number;
        expect(Math.abs(w)).toBeLessThanOrEqual(1);
        if (w !== (a.levels[li] as Level).weights[k]) differ++;
      }
    });
    expect(differ).toBeGreaterThan(50);
  });

  it('small mutations stay close to the parent', () => {
    const a = NeuralNetwork.random([5, 6, 4], new Rng(8));
    const b = mutate(a.clone(), 0.1, new Rng(9));
    const w0 = (a.levels[0] as Level).weights;
    const w1 = (b.levels[0] as Level).weights;
    for (let k = 0; k < w0.length; k++)
      expect(Math.abs((w1[k] as number) - (w0[k] as number))).toBeLessThanOrEqual(0.2 + 1e-12);
  });

  it('uniform crossover takes every parameter from one of the parents', () => {
    const a = NeuralNetwork.random([4, 3], new Rng(10));
    const b = NeuralNetwork.random([4, 3], new Rng(11));
    const c = crossover(a, b, new Rng(12));
    const la = a.levels[0] as Level;
    const lb = b.levels[0] as Level;
    const lc = c.levels[0] as Level;
    let fromA = 0;
    for (let k = 0; k < lc.weights.length; k++) {
      const w = lc.weights[k];
      expect(w === la.weights[k] || w === lb.weights[k]).toBe(true);
      if (w === la.weights[k]) fromA++;
    }
    expect(fromA).toBeGreaterThan(0);
    expect(fromA).toBeLessThan(lc.weights.length);
    expect(() => crossover(a, NeuralNetwork.random([4, 2], new Rng(1)), new Rng(1))).toThrow();
  });
});

function training() {
  return {
    generations: 3,
    bestFitness: 1234.5,
    world: 'grid-town',
    mutation: 0.1,
    date: '2026-11-07T00:00:00.000Z',
  };
}

describe('ai/brainSchema', () => {
  it('round trips a network through the brain file format', () => {
    const a = NeuralNetwork.random([7, 6, 4], new Rng(13), 'tanh');
    const file = serializeBrain(a, inputNames(5, ['wpAngle', 'speed']), training());
    expect(file.topology).toEqual([7, 6, 4]);
    expect(file.inputs).toEqual(['ray0', 'ray1', 'ray2', 'ray3', 'ray4', 'wpAngle', 'speed']);
    expect(file.outputs).toEqual(['forward', 'left', 'right', 'reverse']);
    const res = parseBrain(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.net.activation).toBe('tanh');
    const x = [0.1, 0.5, 0.9, 0.3, 0, 0.2, -0.4];
    const ya = Array.from(a.feedForward(x));
    const yb = Array.from(res.net.feedForward(x));
    yb.forEach((v, i) => expect(v).toBeCloseTo(ya[i] as number, 5));
    expect(res.file.training.generations).toBe(3);
    expect(brainFits(res.net, 7)).toBe(true);
    expect(brainFits(res.net, 5)).toBe(false);
  });

  it('rejects malformed brains with precise messages', () => {
    expect(parseBrain(null).ok).toBe(false);
    const bad = parseBrain({
      format: 'x',
      version: 9,
      topology: [5, 4],
      activation: 'relu',
      levels: [{ weights: [[1]], biases: [0] }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const t = bad.errors.join(' ');
      expect(t).toContain('format');
      expect(t).toContain('activation');
      expect(t).toContain('weights');
    }
    expect(parseBrain({ format: 'neurodrive.brain', version: 1, topology: [5] }).ok).toBe(false);
    expect(
      parseBrain({
        format: 'neurodrive.brain',
        version: 1,
        topology: [2, 2],
        activation: 'step',
        levels: [],
      }).ok,
    ).toBe(false);
  });
});

describe('ai/fitness trackers', () => {
  it('axis progress is monotone along −y', () => {
    const t = new AxisProgress(1);
    const car = new Car(1);
    car.reset(0, 0, 0);
    t.reset(0, car);
    car.y = -100;
    expect(t.update(0, car)).toBe(100);
    car.y = -50;
    expect(t.update(0, car)).toBe(100);
    const out = new Float64Array(1);
    car.angle = Math.PI / 2;
    t.waypoint(0, car, out);
    expect(out[0]).toBeCloseTo(-0.5);
  });

  it('coverage progress counts distinct cells, not distance', () => {
    const t = new CoverageProgress(1, 40);
    const car = new Car(1);
    car.reset(0, 0, 0);
    t.reset(0, car);
    t.update(0, car);
    for (let k = 0; k < 10; k++) {
      car.x = k * 40;
      t.update(0, car);
    }
    const p = t.update(0, car);
    for (let k = 0; k < 10; k++) {
      car.x = (9 - k) * 40; // drive back over the same cells
      t.update(0, car);
    }
    expect(t.update(0, car)).toBe(p);
    expect(p).toBe(9 * 40);
  });
});

describe('ai/evolution', () => {
  it('improves on the infinite road: best of generation 10 beats generation 1 (seeded)', () => {
    const host = new InfiniteRoadSim({ seed: 2026, trafficCount: 6 });
    const pop = new Population(host, { population: 60, timeLimit: 20, seed: 7, mutation: 0.15 });
    host.setExtension(pop);
    let guard = 0;
    while (pop.history.length < 10 && guard++ < 60 * 20 * 12) host.step(DT);
    expect(pop.history.length).toBe(10);
    const first = pop.history[0]?.best ?? 0;
    const tenth = pop.history[9]?.best ?? 0;
    console.info(
      'infinite road best fitness by generation:',
      pop.history.map((h) => Math.round(h.best)).join(', '),
    );
    expect(tenth).toBeGreaterThan(first);
    // elitism with identical traffic per generation: the best never gets worse
    for (let g = 1; g < pop.history.length; g++) {
      expect(pop.history[g]?.best ?? 0).toBeGreaterThanOrEqual(
        (pop.history[g - 1]?.best ?? 0) - 1e-9,
      );
    }
  }, 30_000);

  it('runs generations in the city with traffic, tournament selection and a seed brain', () => {
    const res = parseWorld(JSON.parse(readFileSync('public/worlds/grid-town.world.json', 'utf8')));
    if (!res.ok) throw new Error('world');
    const model = res.value.model;
    const sim = new Simulation(model, new WorldGeometry(generateWorld(worldInputFrom(model))), {
      trafficCount: 6,
      manual: false,
      seed: 3,
    });
    const seed = NeuralNetwork.random([5, 6, 4], new Rng(99));
    const pop = new Population(
      sim,
      { population: 30, timeLimit: 8, selection: 'tournament', seed: 5 },
      seed,
    );
    sim.setExtension(pop);
    expect(sim.cars.length).toBe(6 + 30);
    // car 0 keeps the seed brain exactly; the others are mutated copies
    expect(Array.from((pop.brains[0]?.levels[0] as Level).weights)).toEqual(
      Array.from((seed.levels[0] as Level).weights),
    );
    expect(Array.from((pop.brains[1]?.levels[0] as Level).weights)).not.toEqual(
      Array.from((seed.levels[0] as Level).weights),
    );
    for (let i = 0; i < 60 * 20; i++) sim.step(DT);
    expect(pop.generation).toBeGreaterThanOrEqual(2);
    expect(pop.history[0]?.best).toBeGreaterThan(0);
    expect(pop.bestEverFitness).toBeGreaterThan(0);
    pop.setMutation(0.3);
    pop.setSelection('course');
    pop.reset(sim);
    expect(pop.generation).toBe(0);
    expect(pop.history).toHaveLength(0);
  }, 30_000);

  it('clamps the population size and supports navigation inputs', () => {
    const host = new InfiniteRoadSim({ seed: 1, trafficCount: 2, curvy: true });
    const pop = new Population(host, {
      population: 5000,
      navInputs: true,
      activation: 'tanh',
      seed: 1,
    });
    expect(pop.cars).toHaveLength(1000);
    // 5 rays + the 5 route inputs of brain format v2 (was 5 + 2 in v1; DECISIONS #88)
    expect(pop.topology).toEqual([10, 6, 4]);
    const small = new Population(host, {
      population: 3,
      navInputs: true,
      activation: 'tanh',
      seed: 1,
    });
    host.setExtension(small);
    for (let i = 0; i < 120; i++) host.step(DT);
    expect(small.bestCar).toBeDefined();
    expect(host.world.extraCount).toBeGreaterThan(10); // curvy borders are polylines
    expect(host.centerX(275)).not.toBe(0);
  });
});
