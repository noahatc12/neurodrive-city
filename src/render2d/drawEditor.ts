/**
 * Editor overlays: point handles, hover ring, pulsing selection, segment highlights,
 * rubber band, magnetic snap indicator and box selection. Drawn in world space with
 * line widths divided by zoom so they stay crisp in screen pixels.
 * @module render2d/drawEditor
 */
import type { EditorOverlay } from '../app/renderer.ts';
import type { Graph } from '../engine/graph/graph.ts';
import type { Viewport } from './viewport.ts';
import { PALETTE } from './palette.ts';
import { easeOutBack } from '../anim/easing.ts';

/** Draws the grid of snapping dots when grid snapping is enabled. */
export function drawSnapGrid(ctx: CanvasRenderingContext2D, vp: Viewport, size: number): void {
  const px = size * vp.zoom;
  if (px < 10) return;
  const b = vp.visibleBounds();
  const r = 1.4 / vp.zoom;
  ctx.fillStyle = PALETTE.gridStrong;
  ctx.beginPath();
  for (let x = Math.floor(b.minX / size) * size; x <= b.maxX; x += size) {
    for (let y = Math.floor(b.minY / size) * size; y <= b.maxY; y += size) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/** Draws all editor overlays. */
export function drawEditorOverlay(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  graph: Graph,
  ov: EditorOverlay,
  timeMs: number,
  reducedMotion: boolean,
): void {
  const z = vp.zoom;
  const px = (n: number): number => n / z;
  const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(timeMs / 260);

  // selected segments: glowing cyan band
  if (ov.selectedSegmentIds.size > 0 || ov.hoverSegmentId !== null) {
    ctx.lineCap = 'round';
    for (const s of graph.segments) {
      const selected = ov.selectedSegmentIds.has(s.id);
      const hovered = ov.hoverSegmentId === s.id;
      if (!selected && !hovered) continue;
      ctx.strokeStyle = selected ? 'rgba(34, 211, 238, 0.85)' : 'rgba(34, 211, 238, 0.45)';
      ctx.lineWidth = px(selected ? 5 : 4);
      ctx.shadowColor = PALETTE.cyan;
      ctx.shadowBlur = selected ? 10 : 0;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // rubber band from the selected point to the cursor
  if (ov.rubberBand) {
    const { from, to } = ov.rubberBand;
    ctx.save();
    ctx.setLineDash([px(8), px(6)]);
    ctx.lineDashOffset = reducedMotion ? 0 : -timeMs / 40 / z;
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  // point handles (only for the graph and erase tools, and only when zoomed in enough)
  const showHandles = (ov.tool === 'graph' || ov.tool === 'erase') && z > 0.08;
  if (showHandles) {
    const r = px(5.5);
    ctx.fillStyle = 'rgba(230, 237, 247, 0.9)';
    ctx.strokeStyle = PALETTE.bg;
    ctx.lineWidth = px(2);
    ctx.beginPath();
    for (const p of graph.points) {
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }

  // multi-selection
  for (const id of ov.selectedPointIds) {
    const p = graph.getPoint(id);
    if (!p) continue;
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = px(2.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, px(9), 0, Math.PI * 2);
    ctx.stroke();
  }

  // selected point: pulsing outline
  const sel = ov.selectedPointId !== null ? graph.getPoint(ov.selectedPointId) : undefined;
  if (sel) {
    ctx.fillStyle = PALETTE.cyan;
    ctx.beginPath();
    ctx.arc(sel.x, sel.y, px(6.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(34, 211, 238, ${0.35 + 0.5 * pulse})`;
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.arc(sel.x, sel.y, px(11 + 4 * pulse), 0, Math.PI * 2);
    ctx.stroke();
  }

  // hovered point: animated rotating dashed ring
  const hov = ov.hoverPointId !== null ? graph.getPoint(ov.hoverPointId) : undefined;
  if (hov) {
    ctx.save();
    ctx.translate(hov.x, hov.y);
    if (!reducedMotion) ctx.rotate(timeMs / 600);
    ctx.setLineDash([px(4), px(3)]);
    ctx.strokeStyle = ov.tool === 'erase' ? PALETTE.red : PALETTE.amber;
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.arc(0, 0, px(13), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // magnetic snap indicator: a ring that collapses onto the target
  if (ov.snap && !hov) {
    const t = Math.min(1, (timeMs - ov.snap.sinceMs) / 220);
    const e = reducedMotion ? 1 : easeOutBack(t);
    const radius = px(18 - 10 * e);
    ctx.strokeStyle = ov.snap.kind === 'point' ? PALETTE.lime : 'rgba(34, 211, 238, 0.9)';
    ctx.globalAlpha = 0.4 + 0.6 * t;
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.arc(ov.snap.x, ov.snap.y, Math.max(px(4), radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // box selection rectangle
  if (ov.boxSelect) {
    const { a, b } = ov.boxSelect;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.setLineDash([px(6), px(4)]);
    ctx.lineDashOffset = reducedMotion ? 0 : -timeMs / 50 / z;
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = px(1.5);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
