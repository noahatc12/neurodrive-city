/**
 * World layers for the 2D renderer.
 * @module render2d/drawWorld
 */
import type { LayerFlags } from '../app/renderer.ts';
import type { Graph } from '../engine/graph/graph.ts';
import type { SpatialHash } from '../engine/graph/spatialHash.ts';
import type { Viewport } from './viewport.ts';
import type { WorldPaths } from './worldPaths.ts';
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

/** Static ground layers: sidewalks, road shadow and surface, edge and centre lines, arrows. */
export function drawStaticLayers(
  ctx: CanvasRenderingContext2D,
  paths: WorldPaths,
  layers: Readonly<LayerFlags>,
  roadWidth: number,
): void {
  if (layers.sidewalks) {
    ctx.fillStyle = PALETTE.sidewalk;
    ctx.fill(paths.sidewalks);
    ctx.strokeStyle = PALETTE.curb;
    ctx.lineWidth = roadWidth * 0.035;
    ctx.lineCap = 'round';
    ctx.stroke(paths.curbs);
  }
  if (layers.roads) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fill(paths.roadShadow);
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fill(paths.roads);
  }
  if (layers.laneMarkings && layers.roads) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = PALETTE.edgeLine;
    ctx.lineWidth = roadWidth * 0.022;
    ctx.stroke(paths.edges);
    ctx.save();
    ctx.strokeStyle = PALETTE.laneLine;
    ctx.lineWidth = roadWidth * 0.03;
    ctx.setLineDash([roadWidth * 0.26, roadWidth * 0.24]);
    ctx.stroke(paths.centers);
    ctx.restore();
    ctx.fillStyle = PALETTE.arrow;
    ctx.fill(paths.arrows);
  }
}

/** Debug overlays: borders, lane guides, building guides, spatial-hash cells. */
export function drawDebugLayers(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  paths: WorldPaths,
  layers: Readonly<LayerFlags>,
  hash: SpatialHash | null,
): void {
  const px = 1 / vp.zoom;
  if (layers.debugHashCells && hash) {
    const cs = hash.cellSize;
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.25)';
    ctx.fillStyle = 'rgba(34, 211, 238, 0.05)';
    ctx.lineWidth = px;
    hash.forEachCell((cx, cy, n) => {
      ctx.globalAlpha = Math.min(1, 0.3 + n / 12);
      ctx.fillRect(cx * cs, cy * cs, cs, cs);
      ctx.strokeRect(cx * cs, cy * cs, cs, cs);
    });
    ctx.globalAlpha = 1;
  }
  if (layers.debugBuildingGuides) {
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 2 * px;
    ctx.stroke(paths.buildingGuides);
  }
  if (layers.debugLaneGuides) {
    ctx.strokeStyle = PALETTE.lime;
    ctx.lineWidth = 2 * px;
    ctx.stroke(paths.laneGuides);
  }
  if (layers.debugBorders) {
    ctx.strokeStyle = PALETTE.magenta;
    ctx.lineWidth = 2.5 * px;
    ctx.stroke(paths.borders);
  }
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
  only: ReadonlySet<number> | null = null,
  highlight = false,
): void {
  const segs = graph.segments;
  if (segs.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = highlight ? 'rgba(34, 46, 66, 0.92)' : PALETTE.asphalt;
  ctx.lineWidth = roadWidth;
  ctx.beginPath();
  for (const s of segs) {
    if (only && !only.has(s.id)) continue;
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
  }
  ctx.stroke();
  if (highlight) {
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = roadWidth + 4 / vp.zoom;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.save();
  ctx.strokeStyle = PALETTE.laneLine;
  ctx.lineWidth = Math.max(roadWidth / 30, 1 / vp.zoom);
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
