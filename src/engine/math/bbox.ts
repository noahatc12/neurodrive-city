/**
 * Axis-aligned bounding boxes.
 * @module engine/math/bbox
 */
import type { Vec2 } from './vec2.ts';

/** Axis-aligned bounding box (inclusive). */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** An "empty" box that any point will expand. */
export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** Bounding box of a point list (empty box for no points). */
export function bboxOf(points: readonly Vec2[]): BBox {
  const b = emptyBBox();
  for (const p of points) expandBBox(b, p.x, p.y);
  return b;
}

/** Grows `b` in place to include (x, y). */
export function expandBBox(b: BBox, x: number, y: number): BBox {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
  return b;
}

/** Grows `b` in place to include box `o`. */
export function unionBBox(b: BBox, o: BBox): BBox {
  if (o.minX < b.minX) b.minX = o.minX;
  if (o.minY < b.minY) b.minY = o.minY;
  if (o.maxX > b.maxX) b.maxX = o.maxX;
  if (o.maxY > b.maxY) b.maxY = o.maxY;
  return b;
}

/** True when the boxes overlap or touch. */
export function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** True when (x, y) is inside or on the border of `b`. */
export function bboxContains(b: BBox, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** Returns a copy of `b` grown by `pad` on every side. */
export function padBBox(b: BBox, pad: number): BBox {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/** Box of segment AB. */
export function segmentBBox(a: Vec2, b: Vec2): BBox {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** True if the box is empty (no point was ever added). */
export function isEmptyBBox(b: BBox): boolean {
  return b.minX > b.maxX || b.minY > b.maxY;
}
