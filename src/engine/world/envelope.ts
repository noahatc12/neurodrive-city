/**
 * Envelope: the polygon a road of a given width sweeps around a segment, with rounded
 * (semicircular) caps.
 *
 * ```
 *        ╭───────────────────────╮      radius = width / 2
 *       │  a ●━━━━━━━━━━━━━━━━● b  │     each cap: `roundness` arc steps over π
 *        ╰───────────────────────╯
 * ```
 *
 * With `roundness` = r, each cap has r + 1 vertices (both arc ends included), so the
 * polygon has 2·(r + 1) vertices. Every vertex lies exactly at distance width/2 from
 * the segment.
 *
 * @module engine/world/envelope
 */
import { Polygon } from '../math/polygon.ts';
import type { Vec2 } from '../math/vec2.ts';

/** Builds the vertex list of an envelope around a→b (counter-clockwise on screen). */
export function envelopePoints(a: Vec2, b: Vec2, width: number, roundness: number): Vec2[] {
  const r = width / 2;
  const steps = Math.max(1, Math.round(roundness));
  const alpha = Math.atan2(b.y - a.y, b.x - a.x);
  const pts: Vec2[] = [];
  // cap around b: from alpha - π/2 to alpha + π/2 (sweeping through the forward direction)
  for (let i = 0; i <= steps; i++) {
    const t = alpha - Math.PI / 2 + (Math.PI * i) / steps;
    pts.push({ x: b.x + Math.cos(t) * r, y: b.y + Math.sin(t) * r });
  }
  // cap around a: from alpha + π/2 to alpha + 3π/2 (sweeping through the backward direction)
  for (let i = 0; i <= steps; i++) {
    const t = alpha + Math.PI / 2 + (Math.PI * i) / steps;
    pts.push({ x: a.x + Math.cos(t) * r, y: a.y + Math.sin(t) * r });
  }
  return pts;
}

/** Envelope polygon around segment a→b. */
export function envelope(a: Vec2, b: Vec2, width: number, roundness: number): Polygon {
  return new Polygon(envelopePoints(a, b, width, roundness));
}

/**
 * Oriented rectangle around a→b (no caps), `width` wide. Used for building footprints:
 * the result has exactly four vertices.
 */
export function rectAround(a: Vec2, b: Vec2, width: number): Polygon {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * (width / 2);
  const ny = ((b.x - a.x) / len) * (width / 2);
  return new Polygon([
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ]);
}
