/**
 * Kinematic car (spec E1): the course's driving feel, re-expressed in per-second units
 * so behaviour is identical at any step size.
 *
 * Course constants are per 60 Hz step; conversion to per-second:
 *
 * | quantity      | course (per step)   | here (per second)            |
 * |---------------|---------------------|------------------------------|
 * | acceleration  | 0.2 u/step²         | 0.2 · 60 · 60 = 720 u/s²     |
 * | max speed     | 3 u/step            | 3 · 60 = 180 u/s (≈ 18 m/s)  |
 * | reverse max   | 1.5 u/step          | 90 u/s                       |
 * | friction      | 0.05 u/step²        | 0.05 · 60 · 60 = 180 u/s²    |
 * | steering      | 0.03 rad/step       | 0.03 · 60 = 1.8 rad/s        |
 *
 * Heading 0 points up (−y); positive angles turn left (counter-clockwise on screen).
 * Steering only acts while moving and flips direction when reversing, like a real car.
 *
 * ```
 *        forward = (−sin θ, −cos θ)
 *              ▲
 *         ┌────┴────┐   length 50 (≈ 5 m)
 *         │   car   │   width 30 (≈ 3 m)
 *         └─────────┘
 * ```
 *
 * @module engine/car/car
 */
import { makeControls, type ControlSource, type Controls } from './controls.ts';

export interface CarConfig {
  /** Width in world units. */
  width: number;
  /** Length in world units. */
  length: number;
  /** Acceleration from throttle, units/s². */
  acceleration: number;
  /** Forward top speed, units/s. */
  maxSpeed: number;
  /** Reverse top speed, units/s. */
  maxReverse: number;
  /** Rolling friction deceleration, units/s². */
  friction: number;
  /** Steering rate at full lock, rad/s. */
  turnRate: number;
}

export const DEFAULT_CAR: Readonly<CarConfig> = Object.freeze({
  width: 30,
  length: 50,
  acceleration: 720,
  maxSpeed: 180,
  maxReverse: 90,
  friction: 180,
  turnRate: 1.8,
});

export type CarKind = 'ai' | 'traffic' | 'manual';

/** Pooled car object: all state preallocated, nothing allocated per step. */
export class Car {
  readonly id: number;
  kind: CarKind;
  source: ControlSource;
  config: CarConfig;
  x = 0;
  y = 0;
  angle = 0;
  speed = 0;
  /** Pose at the previous step, for render interpolation. */
  prevX = 0;
  prevY = 0;
  prevAngle = 0;
  readonly controls: Controls = makeControls();
  /** Steering actually applied last step (−1..1), for wheel yaw and skid marks. */
  steer = 0;
  /** Acceleration last step (units/s², signed), for brake lights and exhaust. */
  accel = 0;
  /** True while decelerating by more than friction (brake lights). */
  braking = false;
  damaged = false;
  /** Simulation time of damage (s). */
  damagedAt = 0;
  /** Corner coordinates [x0, y0, ..., x3, y3]: front-left, front-right, rear-right, rear-left. */
  readonly polygon = new Float64Array(8);
  /** Palette index for rendering. */
  color = 0;
  /** Free-form slot used by the owning system (traffic route, AI index, ...). */
  tag = -1;
  active = true;

  constructor(
    id: number,
    kind: CarKind = 'ai',
    source: ControlSource = 'ai',
    config: CarConfig = DEFAULT_CAR,
  ) {
    this.id = id;
    this.kind = kind;
    this.source = source;
    this.config = config;
  }

  /** Places the car (no interpolation jump). */
  reset(x: number, y: number, angle: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.angle = this.prevAngle = angle;
    this.speed = 0;
    this.steer = 0;
    this.accel = 0;
    this.braking = false;
    this.damaged = false;
    this.damagedAt = 0;
    this.controls.forward = this.controls.reverse = this.controls.left = this.controls.right = 0;
    this.updatePolygon();
  }

  /** Forward unit vector x component. */
  get fx(): number {
    return -Math.sin(this.angle);
  }

  /** Forward unit vector y component. */
  get fy(): number {
    return -Math.cos(this.angle);
  }

  /** Advances the kinematics by `dt` seconds using the current controls. */
  updatePhysics(dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
    if (this.damaged) {
      this.speed = 0;
      return;
    }
    const c = this.controls;
    const cfg = this.config;
    const before = this.speed;
    this.speed += cfg.acceleration * dt * (c.forward - c.reverse);
    if (this.speed > cfg.maxSpeed) this.speed = cfg.maxSpeed;
    if (this.speed < -cfg.maxReverse) this.speed = -cfg.maxReverse;
    const fr = cfg.friction * dt;
    if (this.speed > 0) this.speed = this.speed > fr ? this.speed - fr : 0;
    else if (this.speed < 0) this.speed = this.speed < -fr ? this.speed + fr : 0;
    // steering only while moving; reversing flips it
    this.steer = c.left - c.right;
    if (this.speed !== 0) {
      const flip = this.speed > 0 ? 1 : -1;
      this.angle += cfg.turnRate * dt * flip * this.steer;
    }
    this.x -= Math.sin(this.angle) * this.speed * dt;
    this.y -= Math.cos(this.angle) * this.speed * dt;
    this.accel = (this.speed - before) / dt;
    this.braking = this.speed > 1 && this.accel < -cfg.friction * 1.2;
    this.updatePolygon();
  }

  /** Recomputes the four corners from pose and size. */
  updatePolygon(): void {
    const hw = this.config.width / 2;
    const hl = this.config.length / 2;
    const s = Math.sin(this.angle);
    const c = Math.cos(this.angle);
    // forward f = (-s, -c), right r = (c, -s)
    const fx = -s * hl;
    const fy = -c * hl;
    const rx = c * hw;
    const ry = -s * hw;
    const p = this.polygon;
    p[0] = this.x + fx - rx; // front-left
    p[1] = this.y + fy - ry;
    p[2] = this.x + fx + rx; // front-right
    p[3] = this.y + fy + ry;
    p[4] = this.x - fx + rx; // rear-right
    p[5] = this.y - fy + ry;
    p[6] = this.x - fx - rx; // rear-left
    p[7] = this.y - fy - ry;
  }

  /** Interpolated pose between the previous and current step. */
  lerpX(alpha: number): number {
    return this.prevX + (this.x - this.prevX) * alpha;
  }

  lerpY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha;
  }

  lerpAngle(alpha: number): number {
    let d = this.angle - this.prevAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    return this.prevAngle + d * alpha;
  }
}
