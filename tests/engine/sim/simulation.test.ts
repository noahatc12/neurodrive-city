import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/engine/car/car.ts';
import { createCar } from '../../../src/engine/car/carFactory.ts';
import { HIT_NONE } from '../../../src/engine/car/damage.ts';
import { Sensor } from '../../../src/engine/car/sensor.ts';
import { parseWorld } from '../../../src/engine/io/serialize.ts';
import { Particles, SkidMarks, P_SPARK } from '../../../src/engine/sim/particlesSim.ts';
import { Simulation, type SimExtension } from '../../../src/engine/sim/simulation.ts';
import { Rng } from '../../../src/engine/math/rng.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';
import type { WorldModel } from '../../../src/engine/world/worldModel.ts';

const DT = 1 / 60;

function gridTown(): { model: WorldModel; geo: WorldGeometry } {
  const res = parseWorld(JSON.parse(readFileSync('public/worlds/grid-town.world.json', 'utf8')));
  if (!res.ok) throw new Error(res.errors.join('\n'));
  const model = res.value.model;
  return { model, geo: new WorldGeometry(generateWorld(worldInputFrom(model))) };
}

describe('sim/traffic', () => {
  it('traffic routes to random targets, obeys markings and stays under 5% damaged over 60 s', () => {
    const { model, geo } = gridTown();
    const sim = new Simulation(model, geo, { trafficCount: 16, manual: false, seed: 7 });
    expect(sim.traffic.cars.filter((c) => c.active)).toHaveLength(16);
    const start = sim.traffic.cars.map((c) => ({ x: c.x, y: c.y }));
    for (let i = 0; i < 60 * 60; i++) sim.step(DT);
    const st = sim.traffic.stats;
    console.info(
      '60 s traffic run:',
      st,
      `damage rate ${(sim.traffic.damageRate() * 100).toFixed(1)}%`,
    );
    expect(sim.time).toBeCloseTo(60, 6);
    expect(sim.stepCount).toBe(3600);
    expect(st.arrivals).toBeGreaterThan(5);
    expect(sim.traffic.damageRate()).toBeLessThanOrEqual(0.05);
    const moved = sim.traffic.cars.filter((c, i) => {
      const s = start[i];
      return s && Math.hypot(c.x - s.x, c.y - s.y) > 100;
    }).length;
    expect(moved).toBeGreaterThan(10);
  }, 30_000);

  it('is deterministic for a seed', () => {
    const run = (): string => {
      const { model, geo } = gridTown();
      const sim = new Simulation(model, geo, { trafficCount: 6, manual: false, seed: 3 });
      for (let i = 0; i < 600; i++) sim.step(DT);
      return sim.traffic.cars.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).join(';');
    };
    expect(run()).toBe(run());
  });
});

describe('sim/manual car and damage', () => {
  it('drives with the keyboard state and crashes into a border', () => {
    const { model, geo } = gridTown();
    const sim = new Simulation(model, geo, { trafficCount: 0, manual: true, seed: 1 });
    const car = sim.manual;
    expect(car).not.toBeNull();
    if (!car) return;
    const y0 = car.y;
    const x0 = car.x;
    sim.keys.up = true;
    for (let i = 0; i < 30; i++) sim.step(DT);
    expect(Math.hypot(car.x - x0, car.y - y0)).toBeGreaterThan(20);
    sim.keys.left = true; // steer hard into the kerb
    for (let i = 0; i < 600 && !car.damaged; i++) sim.step(DT);
    expect(car.damaged).toBe(true);
    expect(sim.damageCount.manual).toBe(1);
    expect(sim.particles.liveCount()).toBeGreaterThan(0);
    sim.resetManual();
    expect(car.damaged).toBe(false);
    expect(sim.manualSensor?.rayCount).toBe(5);
  });

  it('spawns at a Start marking (round-robin) or near the centre without one', () => {
    const { model, geo } = gridTown();
    const sim = new Simulation(model, geo, { trafficCount: 0 });
    expect(sim.starts.length).toBeGreaterThan(0);
    const p = sim.defaultSpawn();
    expect(sim.world.polygonHit(sim.manual?.polygon ?? new Float64Array(8), 1)).toBe(HIT_NONE);
    expect(p).toEqual(sim.starts[0]);
    for (const m of model.markings.ofType('start')) model.markings.remove(m.id);
    const sim2 = new Simulation(model, geo, { trafficCount: 0 });
    expect(sim2.starts).toHaveLength(0);
    const q = sim2.defaultSpawn();
    expect(Number.isFinite(q.x)).toBe(true);
  });
});

describe('sim/particles', () => {
  it('ring buffers wrap, age and never grow', () => {
    const p = new Particles(8);
    const rng = new Rng(1);
    p.burst(0, 0, rng); // 22 particles into 8 slots
    expect(p.liveCount()).toBe(8);
    p.exhaust(0, 0, 0, 1, rng);
    p.update(0.1);
    expect(p.liveCount()).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) p.update(0.1);
    expect(p.liveCount()).toBe(0);
    p.emit(P_SPARK, 1, 1, 0, 0, 1, 1, 0);
    p.clear();
    expect(p.liveCount()).toBe(0);
    const s = new SkidMarks(4);
    for (let i = 0; i < 6; i++) s.add(i, 0, i + 1, 0, 5, i);
    expect(s.written).toBe(6);
    expect(s.slotOf(5)).toBe(1);
    s.clear();
    expect(s.written).toBe(0);
  });
});

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
