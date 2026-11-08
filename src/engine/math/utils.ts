/**
 * Scalar helpers shared by the whole engine.
 * @module engine/math/utils
 */

/** Floating point tolerance used by geometry predicates (world units). */
export const EPS = 1e-9;

/** Linear interpolation: t=0 → a, t=1 → b (t is not clamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Inverse of {@link lerp}: where `v` sits between `a` and `b` (0 at a, 1 at b).
 * Returns 0 when a === b to avoid NaN.
 */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Clamps `v` into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Maps `v` from range [a0, a1] to [b0, b1] (unclamped). */
export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return lerp(b0, b1, invLerp(a0, a1, v));
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Smallest signed difference `to - from` between two angles, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Converts degrees to radians. */
export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Converts radians to degrees. */
export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Approximate equality within `eps`. */
export function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}
