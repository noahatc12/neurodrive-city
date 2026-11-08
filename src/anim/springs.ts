/**
 * Frame-rate independent smoothing.
 *
 * - {@link damp}: exponential smoothing `x += (target - x)·(1 - e^(-k·dt))`. The same
 *   total motion happens at 30 fps and 144 fps because the blend factor is derived from
 *   elapsed time, not from the frame count.
 * - {@link SmoothDamp}: a critically damped spring (no overshoot, smooth velocity),
 *   good for cameras and UI numbers that chase a moving target.
 * - {@link Spring}: an under-damped spring for playful "pop" effects.
 *
 * @module anim/springs
 */

/** Exponential smoothing toward `target` with rate `k` (1/s) over `dt` seconds. */
export function damp(current: number, target: number, k: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

/** Blend factor used by {@link damp}, handy for vectors: lerp(a, b, dampFactor(k, dt)). */
export function dampFactor(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/**
 * Critically damped spring (Game Programming Gems 4, "Critically Damped Ease-In/Ease-Out
 * Smoothing" approximation). `smoothTime` ≈ time to reach the target.
 */
export class SmoothDamp {
  value: number;
  velocity = 0;
  smoothTime: number;

  constructor(value: number, smoothTime = 0.25) {
    this.value = value;
    this.smoothTime = smoothTime;
  }

  /** Advances toward `target` by `dt` seconds and returns the new value. */
  update(target: number, dt: number): number {
    const omega = 2 / Math.max(1e-4, this.smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * exp;
    this.value = target + (change + temp) * exp;
    return this.value;
  }

  /** Jumps to a value with zero velocity. */
  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/** Damped harmonic spring integrated with semi-implicit Euler in fixed sub-steps. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  stiffness: number;
  damping: number;

  constructor(value: number, stiffness = 260, damping = 16) {
    this.value = value;
    this.target = value;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  /** Advances by `dt` seconds; returns the value. */
  update(dt: number): number {
    const h = 1 / 240;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const step = Math.min(h, remaining);
      const accel = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += accel * step;
      this.value += this.velocity * step;
      remaining -= step;
    }
    return this.value;
  }

  /** Gives the spring a kick (e.g. a node "pop"). */
  impulse(v: number): void {
    this.velocity += v;
  }

  /** True when close to rest at the target. */
  get settled(): boolean {
    return Math.abs(this.target - this.value) < 1e-3 && Math.abs(this.velocity) < 1e-3;
  }
}
