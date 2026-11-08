import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brainFits, parseBrain } from '../../../src/engine/ai/brainSchema.ts';
import { infiniteTrainer, PRETRAINED_ROAD, TRAIN_DT } from '../../../src/engine/ai/trainer.ts';
import { Sensor } from '../../../src/engine/car/sensor.ts';

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
