import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  brainFits,
  fitLayout,
  inputLayouts,
  parseBrain,
} from '../../../src/engine/ai/brainSchema.ts';
import { LIGHT_INPUT, NAV_INPUTS } from '../../../src/engine/ai/evolution.ts';
import {
  broadCityCheck,
  infiniteTrainer,
  PRETRAINED_ROAD,
  TRAIN_DT,
  validateCityBrain,
} from '../../../src/engine/ai/trainer.ts';
import { Sensor } from '../../../src/engine/car/sensor.ts';
import { parseWorld } from '../../../src/engine/io/serialize.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';

function loadBundled() {
  const res = parseBrain(JSON.parse(readFileSync('public/brains/pretrained.brain.json', 'utf8')));
  if (!res.ok) throw new Error(res.errors.join('\n'));
  return res;
}

describe('ai/pre-trained brain (public/brains)', () => {
  it('is a valid brain file that fits the default sensors and documents its training', () => {
    const { net, file } = loadBundled();
    expect(brainFits(net, new Sensor().rayCount)).toBe(true);
    expect(file.training.world).toBe('infinite-road');
    expect(file.training.generations).toBeGreaterThanOrEqual(5);
    expect(file.training.bestFitness).toBeGreaterThan(8000);
  });

  it('drives 60 s on its training road without damage (seeded)', () => {
    const { net } = loadBundled();
    // one car carrying the exact brain (mutation 0), on the same seeded road and traffic
    const trainer = infiniteTrainer(
      { population: 1, mutation: 0, timeLimit: 120, stuckTimeout: 30, seed: 1 },
      PRETRAINED_ROAD,
      net,
    );
    const car = trainer.population.cars[0];
    expect(car).toBeDefined();
    if (!car) return;
    const y0 = car.y;
    // overtakes: a traffic car goes from ahead of the AI car (smaller y) to just behind it
    // (traffic left far behind is recycled ahead, which is not counted)
    const ahead = new Map<number, boolean>();
    let overtakes = 0;
    for (let i = 0; i < 60 / TRAIN_DT; i++) {
      trainer.host.step(TRAIN_DT);
      expect(car.damaged, `damaged after ${(i * TRAIN_DT).toFixed(1)} s`).toBe(false);
      for (const t of trainer.host.cars) {
        if (t.kind !== 'traffic') continue;
        const now = t.y < car.y;
        if (ahead.get(t.id) === true && !now && t.y - car.y < 120) overtakes++;
        ahead.set(t.id, now);
      }
    }
    // it actually drives: well over 300 m up the road in a minute, weaving past traffic
    const travelled = y0 - car.y;
    expect(travelled).toBeGreaterThan(3000);
    expect(overtakes).toBeGreaterThan(3);
    console.info(
      `pre-trained brain: ${(travelled / 10).toFixed(0)} m in 60 s, ${overtakes} overtakes, no damage`,
    );
    expect(trainer.population.generation).toBe(0);
  });
});

function loadCity() {
  const res = parseBrain(JSON.parse(readFileSync('public/brains/city.brain.json', 'utf8')));
  if (!res.ok) throw new Error(res.errors.join('\n'));
  return res;
}

function gridTown() {
  const res = parseWorld(JSON.parse(readFileSync('public/worlds/grid-town.world.json', 'utf8')));
  if (!res.ok) throw new Error(res.errors.join('\n'));
  const model = res.value.model;
  return { model, geo: new WorldGeometry(generateWorld(worldInputFrom(model))) };
}

describe('ai/pre-trained city brain (public/brains/city.brain.json)', () => {
  it('is a v2 route-input brain for the city sensors and documents its training', () => {
    const { net, file } = loadCity();
    expect(file.version).toBe(2);
    // v1.2: the five route inputs plus the traffic-light input (DECISIONS #108)
    expect(net.topology).toEqual([13, 8, 4]);
    expect(net.activation).toBe('tanh');
    expect(fitLayout(net, file.inputs, inputLayouts(7, NAV_INPUTS, [LIGHT_INPUT]))).toMatchObject({
      nav: true,
      light: true,
    });
    expect(file.inputs.slice(7)).toEqual(['lat', 'hdg', 'wpNear', 'wpFar', 'speed', 'light']);
    expect(file.training.world).toBe('grid-town');
    expect(file.training.generations).toBeGreaterThan(0);
    expect(file.training.population).toBe(300);
    expect(file.training.inLaneFraction).toBeGreaterThanOrEqual(0.95);
    expect(file.training.validation).toMatch(/of 5 validation drives passed/);
  });

  it('drives Grid Town from the Start to the Target in its lane without a crash (seeded)', () => {
    const { net } = loadCity();
    const { model, geo } = gridTown();
    // one exact copy, alone, with the world's own traffic seed (what Simulate shows)
    const v = validateCityBrain(model, geo, net, model.seed, 0);
    console.info(
      `city brain: ${v.arrived ? 'arrived' : 'did not arrive'} in ${v.seconds.toFixed(1)} s, ${(v.inLane * 100).toFixed(1)}% in lane, ${(v.routeShare * 100).toFixed(0)}% of the route`,
    );
    expect(v.crashed).toBe(false);
    expect(v.laneViolation).toBe(false);
    expect(v.redLight).toBe(false);
    expect(v.arrived).toBe(true);
    expect(v.inLane).toBeGreaterThanOrEqual(0.95);
  }, 60_000);

  it('on 20 unseen traffic seeds: reaches the target cleanly in 9, never runs a red light (seeded)', () => {
    const { net } = loadCity();
    const { model, geo } = gridTown();
    const b = broadCityCheck(model, geo, net, 20);
    console.info(
      `city brain on 20 unseen traffic seeds: ${b.passes} passed, ${b.crashed} crashed, ${b.violations} lane violations, ${b.redLights} red lights, ${(b.inLane * 100).toFixed(1)}% in lane`,
    );
    // the shipped claim (README "AI navigation"): measured, not a target
    expect(b.passes).toBeGreaterThanOrEqual(9);
    expect(b.violations).toBe(0);
    expect(b.redLights).toBe(0);
    expect(b.inLane).toBeGreaterThanOrEqual(0.95);
  }, 180_000);
});
