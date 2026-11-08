import { describe, expect, it } from 'vitest';
import { Car, DEFAULT_CAR } from '../../../src/engine/car/car.ts';
import { CAR_COLORS, createCar } from '../../../src/engine/car/carFactory.ts';
import {
  applyDummy,
  applyKeys,
  makeKeyState,
  resetControls,
} from '../../../src/engine/car/controls.ts';
import { CollisionWorld, HIT_BORDER, HIT_CAR, HIT_NONE } from '../../../src/engine/car/damage.ts';
import { Sensor } from '../../../src/engine/car/sensor.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../../../src/engine/world/world.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';

const DT = 1 / 60;

function wall(world: CollisionWorld, segs: number[][]): void {
  world.extra = Float64Array.from(segs.flat());
  world.extraCount = segs.length;
}

describe('car/kinematics', () => {
  it('uses the course constants converted to per-second units', () => {
    expect(DEFAULT_CAR).toMatchObject({
      width: 30,
      length: 50,
      acceleration: 720,
      maxSpeed: 180,
      maxReverse: 90,
      friction: 180,
      turnRate: 1.8,
    });
  });

  it('accelerates forward (up = -y) and clamps to max speed', () => {
    const car = new Car(1);
    car.reset(0, 0, 0);
    car.controls.forward = 1;
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      car.updatePhysics(DT);
      peak = Math.max(peak, car.speed);
    }
    // like the course: clamp to max speed, then friction acts (steady state 2.95 u/step)
    expect(peak).toBeLessThanOrEqual(180);
    expect(car.speed).toBeCloseTo(180 - 180 * DT, 6);
    expect(car.y).toBeLessThan(-1000);
    expect(Math.abs(car.x)).toBeLessThan(1e-6);
  });

  it('matches the course per-step behaviour at 60 Hz (one step = +0.2 - 0.05 units/step)', () => {
    const car = new Car(1);
    car.reset(0, 0, 0);
    car.controls.forward = 1;
    car.updatePhysics(DT);
    expect(car.speed / 60).toBeCloseTo(0.15, 9);
  });

  it('friction brings the car to a complete stop', () => {
    const car = new Car(1);
    car.reset(0, 0, 0);
    car.speed = 150;
    for (let i = 0; i < 120; i++) car.updatePhysics(DT);
    expect(car.speed).toBe(0);
    car.speed = -50;
    for (let i = 0; i < 60; i++) car.updatePhysics(DT);
    expect(car.speed).toBe(0);
  });

  it('clamps reverse speed to half the forward maximum', () => {
    const car = new Car(1);
    car.reset(0, 0, 0);
    car.controls.reverse = 1;
    for (let i = 0; i < 600; i++) car.updatePhysics(DT);
    expect(car.speed).toBeCloseTo(-90 + 180 * DT, 6);
    expect(car.speed).toBeGreaterThanOrEqual(-90);
  });

  it('steers only while moving and inverts steering in reverse', () => {
    const still = new Car(1);
    still.reset(0, 0, 0);
    still.controls.left = 1;
    still.updatePhysics(DT);
    expect(still.angle).toBe(0);

    const fwd = new Car(2);
    fwd.reset(0, 0, 0);
    fwd.speed = 100;
    fwd.controls.left = 1;
    fwd.updatePhysics(DT);
    expect(fwd.angle).toBeGreaterThan(0); // left = counter-clockwise

    const rev = new Car(3);
    rev.reset(0, 0, 0);
    rev.speed = -60;
    rev.controls.left = 1;
    rev.updatePhysics(DT);
    expect(rev.angle).toBeLessThan(0); // flipped while reversing
  });

  it('builds its polygon (front-left first) and interpolates poses', () => {
    const car = new Car(1);
    car.reset(100, 200, 0);
    expect(Array.from(car.polygon)).toEqual([85, 175, 115, 175, 115, 225, 85, 225]);
    car.speed = 120;
    car.controls.right = 1;
    car.updatePhysics(DT);
    expect(car.lerpX(0)).toBe(100);
    expect(car.lerpY(1)).toBeCloseTo(car.y);
    expect(car.lerpAngle(0.5)).toBeCloseTo(car.angle / 2);
    expect(car.fx).toBeCloseTo(-Math.sin(car.angle));
    expect(car.fy).toBeCloseTo(-Math.cos(car.angle));
  });

  it('flags braking when slowing faster than friction alone', () => {
    const car = new Car(1);
    car.reset(0, 0, 0);
    car.speed = 150;
    car.controls.reverse = 1;
    car.updatePhysics(DT);
    expect(car.braking).toBe(true);
  });

  it('damaged cars do not move', () => {
    const car = new Car(1);
    car.reset(0, 0, 0);
    car.damaged = true;
    car.controls.forward = 1;
    car.updatePhysics(DT);
    expect(car.y).toBe(0);
    expect(car.speed).toBe(0);
  });
});

describe('car/controls and factory', () => {
  it('maps keys and dummy throttle', () => {
    const car = createCar(5, 'manual');
    const keys = makeKeyState();
    keys.up = true;
    keys.left = true;
    applyKeys(keys, car.controls);
    expect(car.controls).toEqual({ forward: 1, reverse: 0, left: 1, right: 0 });
    applyDummy(car.controls, 0.7);
    expect(car.controls.forward).toBe(0.7);
    resetControls(car.controls);
    expect(car.controls.forward).toBe(0);
    expect(car.source).toBe('keys');
    expect(createCar(2, 'traffic').source).toBe('route');
    expect(createCar(3, 'ai').source).toBe('ai');
    expect(CAR_COLORS.length).toBeGreaterThan(4);
  });
});

describe('car/damage', () => {
  it('detects contact with a road border and stays clear inside the road', () => {
    const m = new WorldModel();
    const a = m.graph.addPoint(0, 0);
    const b = m.graph.addPoint(0, -1000);
    m.graph.addSegment(a, b);
    const geo = new WorldGeometry(generateWorld(worldInputFrom(m)));
    const world = new CollisionWorld();
    world.geometry = geo;
    const car = new Car(1);
    car.reset(0, -500, 0);
    expect(world.polygonHit(car.polygon, car.id)).toBe(HIT_NONE);
    car.reset(40, -500, 0); // right edge of the car at x = 55 > road half-width 50
    expect(world.polygonHit(car.polygon, car.id)).toBe(HIT_BORDER);
  });

  it('detects other cars in the dynamic set but not itself', () => {
    const world = new CollisionWorld();
    const a = new Car(1);
    const b = new Car(2);
    a.reset(0, 0, 0);
    b.reset(20, 10, 0.3);
    world.setDynamic([a, b], 2, () => true);
    expect(world.dynCount).toBe(2);
    expect(world.polygonHit(a.polygon, a.id)).toBe(HIT_CAR);
    world.setDynamic([a, b], 2, (c) => c.id === 1);
    expect(world.polygonHit(a.polygon, a.id)).toBe(HIT_NONE);
  });

  it('honours the building/tree collision toggles', () => {
    const world = new CollisionWorld();
    world.flags = { buildings: false, trees: false };
    expect(world.polygonHit(new Car(1).polygon, 1)).toBe(HIT_NONE);
  });
});

describe('car/sensor', () => {
  it('a wall at distance 75 with ray length 150 reads 0.5 on the centre ray', () => {
    const world = new CollisionWorld();
    wall(world, [[-200, -75, 200, -75]]);
    const car = new Car(1);
    car.reset(0, 0, 0);
    const s = new Sensor({ rayCount: 5, spread: Math.PI / 2, length: 150 });
    s.update(car, world, false);
    expect(s.readings[2]).toBeCloseTo(0.5, 9);
    expect(s.offsets[2]).toBeCloseTo(0.5, 9);
    // outer rays at ±45° travel 75/cos45 ≈ 106 to reach the wall
    expect(s.offsets[0]).toBeCloseTo(75 / Math.cos(Math.PI / 4) / 150, 6);
    expect(s.kinds[2]).toBe(HIT_BORDER);
  });

  it('reads 0 when nothing is in range, sees cars only when asked, and clears', () => {
    const world = new CollisionWorld();
    const car = new Car(1);
    car.reset(0, 0, 0);
    const other = new Car(2);
    other.reset(0, -100, 0);
    world.setDynamic([car, other], 2, () => true);
    const s = new Sensor({ rayCount: 3 });
    s.update(car, world, false);
    expect(Array.from(s.readings)).toEqual([0, 0, 0]);
    s.update(car, world, true);
    expect(s.readings[1]).toBeGreaterThan(0.4);
    expect(s.kinds[1]).toBe(HIT_CAR);
    s.clear();
    expect(s.readings[1]).toBe(0);
  });

  it('spreads rays left to right and clamps the ray count', () => {
    const s = new Sensor({ rayCount: 1 });
    expect(s.rayAngle(0)).toBe(0);
    const s5 = new Sensor();
    expect(s5.rayAngle(0)).toBeCloseTo(Math.PI / 4);
    expect(s5.rayAngle(4)).toBeCloseTo(-Math.PI / 4);
    expect(new Sensor({ rayCount: 40 }).rayCount).toBe(15);
  });
});
