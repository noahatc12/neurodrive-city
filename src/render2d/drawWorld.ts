/**
 * World layers for the 2D renderer.
 * @module render2d/drawWorld
 */
import type { Graph } from '../engine/graph/graph.ts';
import type { Viewport } from './viewport.ts';
import { PALETTE } from './palette.ts';

/** Fills the screen with the ground colour and a subtle world-aligned grid. */
export function drawBackground(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const b = vp.visibleBounds();
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  // pick a grid step that stays 40..200 px on screen
  let step = 100;
  while (step * vp.zoom < 40) step *= 5;
  while (step * vp.zoom > 200) step /= 5;
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1 / vp.zoom;
  ctx.beginPath();
  for (let x = Math.floor(b.minX / step) * step; x <= b.maxX; x += step) {
    ctx.moveTo(x, b.minY);
    ctx.lineTo(x, b.maxY);
  }
  for (let y = Math.floor(b.minY / step) * step; y <= b.maxY; y += step) {
    ctx.moveTo(b.minX, y);
    ctx.lineTo(b.maxX, y);
  }
  ctx.stroke();
}

/**
 * Cheap road preview straight from the graph: round-capped thick strokes plus a dashed
 * centre line. Used before generation exists and for segments being dragged.
 */
export function drawGraphPreview(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  graph: Graph,
  roadWidth: number,
  only?: ReadonlySet<number>,
): void {
  const segs = graph.segments;
  if (segs.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PALETTE.asphalt;
  ctx.lineWidth = roadWidth;
  ctx.beginPath();
  for (const s of segs) {
    if (only && !only.has(s.id)) continue;
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
  }
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = PALETTE.laneLine;
  ctx.lineWidth = Math.max(roadWidth / 25, 1 / vp.zoom);
  ctx.setLineDash([roadWidth / 4, roadWidth / 4]);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (const s of segs) {
    if (only && !only.has(s.id)) continue;
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
  }
  ctx.stroke();
  ctx.restore();
}
