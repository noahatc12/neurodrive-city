/**
 * Particle and skid-mark spawn data (spec L2). The engine only owns the data: fixed
 * capacity ring buffers of typed arrays, so emitting and updating never allocates.
 * Renderers (2D canvas, 3D instanced quads) draw from these buffers.
 * @module engine/sim/particlesSim
 */
import type { Rng } from '../math/rng.ts';

export const P_EXHAUST = 0;
export const P_SMOKE = 1;
export const P_SPARK = 2;

export class Particles {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly growth: Float32Array;
  readonly type: Uint8Array;
  /** Next slot to overwrite (ring buffer). */
  private head = 0;

  constructor(capacity = 2048) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
  }

  emit(
    type: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    growth: number,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.type[i] = type;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.growth[i] = growth;
  }

  /** Exhaust puff behind a car (more when accelerating). */
  exhaust(x: number, y: number, backX: number, backY: number, rng: Rng): void {
    this.emit(
      P_EXHAUST,
      x,
      y,
      backX * 25 + rng.range(-8, 8),
      backY * 25 + rng.range(-8, 8),
      rng.range(0.5, 0.9),
      4,
      18,
    );
  }

  /** Spark and smoke burst on damage. */
  burst(x: number, y: number, rng: Rng): void {
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = rng.range(80, 260);
      this.emit(P_SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, rng.range(0.25, 0.6), 2.5, -2);
    }
    for (let i = 0; i < 8; i++) {
      const a = rng.range(0, Math.PI * 2);
      this.emit(P_SMOKE, x, y, Math.cos(a) * 20, Math.sin(a) * 20, rng.range(1.2, 2.2), 10, 22);
    }
  }

  update(dt: number): void {
    const damp = Math.exp(-2.5 * dt);
    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i] as number;
      if (l <= 0) continue;
      this.life[i] = l - dt;
      this.x[i] = (this.x[i] as number) + (this.vx[i] as number) * dt;
      this.y[i] = (this.y[i] as number) + (this.vy[i] as number) * dt;
      this.vx[i] = (this.vx[i] as number) * damp;
      this.vy[i] = (this.vy[i] as number) * damp;
      this.size[i] = Math.max(0.5, (this.size[i] as number) + (this.growth[i] as number) * dt);
    }
  }

  /** Number of live particles (O(capacity); for stats/tests). */
  liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if ((this.life[i] as number) > 0) n++;
    return n;
  }

  clear(): void {
    this.life.fill(0);
  }
}

/**
 * Skid marks: tyre-track segments in a ring buffer with their creation time; renderers
 * fade them by age (2D stamps them onto a decal canvas, 3D writes a trail mesh).
 */
export class SkidMarks {
  readonly capacity: number;
  /** [x1, y1, x2, y2] per mark. */
  readonly seg: Float32Array;
  readonly time: Float32Array;
  readonly width: Float32Array;
  /** Total marks ever written (renderers track what they have consumed). */
  written = 0;
  private head = 0;

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.seg = new Float32Array(capacity * 4);
    this.time = new Float32Array(capacity).fill(-1e9);
    this.width = new Float32Array(capacity);
  }

  add(x1: number, y1: number, x2: number, y2: number, width: number, t: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.seg[i * 4] = x1;
    this.seg[i * 4 + 1] = y1;
    this.seg[i * 4 + 2] = x2;
    this.seg[i * 4 + 3] = y2;
    this.width[i] = width;
    this.time[i] = t;
    this.written++;
  }

  /** Slot index of the n-th written mark (valid while within capacity of `written`). */
  slotOf(n: number): number {
    return n % this.capacity;
  }

  clear(): void {
    this.time.fill(-1e9);
    this.written = 0;
    this.head = 0;
  }
}
