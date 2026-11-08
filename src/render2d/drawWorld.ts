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
  // water first (rivers pass under bridges)
  ctx.fillStyle = PALETTE.water;
  ctx.fill(paths.water);
  ctx.strokeStyle = PALETTE.waterEdge;
  ctx.lineWidth = roadWidth * 0.04;
  ctx.stroke(paths.water);
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

/** Shape of the infinite road the renderer needs (kept structural to avoid an import cycle). */
export interface InfiniteRoadView {
  readonly roadWidth: number;
  readonly config: { readonly lanes: number; readonly laneWidth: number };
  centerX(y: number): number;
}

/** Draws the infinite road (spec G7) for the visible window: verge, asphalt, edges, lane dashes. */
export function drawInfiniteRoad(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  road: InfiniteRoadView,
): void {
  const b = vp.visibleBounds(60);
  const step = 30;
  const y0 = Math.ceil(b.maxY / step) * step;
  const half = road.roadWidth / 2;
  // verge
  ctx.fillStyle = '#0f1a14';
  ctx.beginPath();
  for (let y = y0; y >= b.minY - step; y -= step) ctx.lineTo(road.centerX(y) - half - 40, y);
  for (let y = b.minY - step; y <= y0; y += step) ctx.lineTo(road.centerX(y) + half + 40, y);
  ctx.closePath();
  ctx.fill();
  // asphalt
  ctx.fillStyle = PALETTE.asphalt;
  ctx.beginPath();
  for (let y = y0; y >= b.minY - step; y -= step) ctx.lineTo(road.centerX(y) - half, y);
  for (let y = b.minY - step; y <= y0; y += step) ctx.lineTo(road.centerX(y) + half, y);
  ctx.closePath();
  ctx.fill();
  // solid edges and dashed lane dividers
  const lanes = road.config.lanes;
  for (let k = 0; k <= lanes; k++) {
    const off = -half + k * road.config.laneWidth;
    const edge = k === 0 || k === lanes;
    ctx.save();
    ctx.strokeStyle = edge ? PALETTE.edgeLine : PALETTE.laneLine;
    ctx.lineWidth = edge ? 3 : 2.5;
    if (!edge) ctx.setLineDash([24, 26]);
    ctx.beginPath();
    for (let y = y0; y >= b.minY - step; y -= step)
      ctx.lineTo(road.centerX(y) + off * (edge ? 0.97 : 1), y);
    ctx.stroke();
    ctx.restore();
  }
}
