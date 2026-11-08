/**
 * 2D vector helpers. World space is x right, y down (canvas convention).
 *
 * Two flavours are provided:
 * - pure functions that return a new vector (clear, used by generation code);
 * - `*Into(out, ...)` variants that write into a caller-owned vector, used by
 *   per-frame / per-step hot loops so they allocate nothing.
 *
 * @module engine/math/vec2
 */
import { EPS, lerp } from './utils.ts';

/** A 2D point or direction. Plain objects keep structured-clone and JSON cheap. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Creates a vector. */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/** Copies `a` into a new vector. */
export function copy(a: Vec2): Vec2 {
  return { x: a.x, y: a.y };
}

/** Sets `out` to (x, y) and returns it. */
export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

/** a + b */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** a - b */
export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** a * s */
export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

/** Euclidean length of `a`. */
export function magnitude(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

/** Unit vector in the direction of `a`; the zero vector stays zero (no NaN). */
export function normalize(a: Vec2): Vec2 {
  const m = magnitude(a);
  return m < EPS ? { x: 0, y: 0 } : { x: a.x / m, y: a.y / m };
}

/**
 * Perpendicular vector, rotated +90° in math terms: (x, y) → (-y, x).
 * In y-down screen space this points to the **right** of travel direction `a`.
 *
 * ```
 *   a = (1, 0)  →  perp = (0, 1)   (east → south, i.e. right-hand side on screen)
 * ```
 */
export function perpendicular(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

/** Dot product. */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (z of the 3D cross): positive when b is clockwise-on-screen of a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Squared distance (cheaper; use for comparisons). */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Angle of `a` measured with `Math.atan2(y, x)`, in (-π, π]. */
export function angle(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

/** Moves `p` by `offset` along direction `angleRad` (atan2 convention). */
export function translate(p: Vec2, angleRad: number, offset: number): Vec2 {
  return { x: p.x + Math.cos(angleRad) * offset, y: p.y + Math.sin(angleRad) * offset };
}

/** Component-wise linear interpolation. */
export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Midpoint of two points. */
export function average(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Arithmetic mean of a list of points (the zero vector for an empty list). */
export function centroid(points: readonly Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Equality within `eps`. */
export function equals(a: Vec2, b: Vec2, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** Rotates `a` by `angleRad` around the origin (atan2 convention). */
export function rotate(a: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

// ---------------------------------------------------------------------------
// Allocation-free variants for hot loops
// ---------------------------------------------------------------------------

/** out = a + b */
export function addInto(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

/** out = a - b */
export function subtractInto(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

/** out = a * s */
export function scaleInto(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** out = lerp(a, b, t) */
export function lerpInto(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** out = normalize(a) */
export function normalizeInto(out: Vec2, a: Vec2): Vec2 {
  const m = Math.hypot(a.x, a.y);
  if (m < EPS) return set(out, 0, 0);
  out.x = a.x / m;
  out.y = a.y / m;
  return out;
}
