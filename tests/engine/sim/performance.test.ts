/**
 * Step-cost benchmark (moved from simulation.test.ts unchanged). It runs in its own
 * Vitest project group after every other test file has finished (vitest.config.ts), so it
 * measures one simulation step on an otherwise idle machine rather than the CPU's
 * all-core clock while a dozen workers run other tests.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/engine/car/car.ts';
import { createCar } from '../../../src/engine/car/carFactory.ts';
import { HIT_NONE } from '../../../src/engine/car/damage.ts';
import { Sensor } from '../../../src/engine/car/sensor.ts';
import { parseWorld } from '../../../src/engine/io/serialize.ts';
import { Simulation, type SimExtension } from '../../../src/engine/sim/simulation.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';
import type { WorldModel } from '../../../src/engine/world/worldModel.ts';

const DT = 1 / 60;

function gridTown(): { model: WorldModel; geo: WorldGeometry } {
  const res = parseWorld(JSON.parse(readFileSync('public/worlds/grid-town.world.json', 'utf8')));
  if (!res.ok) throw new Error(res.errors.join('\n'));
  const model = res.value.model;
  return { model, geo: new WorldGeometry(generateWorld(worldInputFrom(model))) };
}

describe('sim/performance', () => {
  it('steps 300 sensing cars in well under 4 ms (spatial hash broad phase)', () => {
    const { model, geo } = gridTown();
    const sim = new Simulation(model, geo, { trafficCount: 14, manual: false, seed: 5 });
    // an extension with 300 cars driving forward with 5-ray sensors (no network yet)
    const cars: Car[] = [];
    const sensors: Sensor[] = [];
    for (let i = 0; i < 300; i++) {
      const c = createCar(10_000 + i, 'ai');
      const pose = sim.defaultSpawn(i);
      c.reset(pose.x, pose.y, pose.angle + (i % 7) * 0.02);
      cars.push(c);
      sensors.push(new Sensor());
    }
    const ext: SimExtension = {
      cars,
      step(s: Simulation, dt: number) {
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i] as Car;
          if (c.damaged) continue;
          (sensors[i] as Sensor).update(c, s.world, true);
          c.controls.forward = 1;
          c.updatePhysics(dt);
          if (s.world.polygonHit(c.polygon, c.id) !== HIT_NONE) s.damage(c);
        }
      },
    };
    sim.setExtension(ext);
    for (let i = 0; i < 30; i++) sim.step(DT); // warm up
    // reset so cars are alive while timing
    for (const c of cars) {
      const pose = sim.defaultSpawn(c.id);
      c.reset(pose.x, pose.y, pose.angle);
    }
    const t0 = performance.now();
    const N = 60;
    for (let i = 0; i < N; i++) sim.step(DT);
    const ms = (performance.now() - t0) / N;
    console.info(`300-car step (5 rays each + 14 traffic cars): ${ms.toFixed(2)} ms per step`);
    const budget = 4;
    const relaxed = Boolean(process.env['CI']) || process.env['ND_COVERAGE'] === '1';
    if (relaxed && ms > budget) {
      console.warn(
        `perf: ${ms.toFixed(2)} ms exceeds the ${budget} ms budget under ${process.env['ND_COVERAGE'] === '1' ? 'coverage instrumentation' : 'CI'}; asserting ${budget * 3} ms instead`,
      );
      expect(ms).toBeLessThan(budget * 3);
    } else {
      expect(ms).toBeLessThan(budget);
    }
  });
});
