/**
 * Road markings in 2D (spec B5, D1–D6): each marking is drawn in its own local frame
 * (x = travel direction, y = right of travel) from its resolved placement, so it follows
 * its segment automatically.
 *
 * Lamp glows use pre-rendered radial-gradient sprites (one per colour, created once)
 * drawn with additive blending and the controller's cross-faded lamp levels, so there
 * is no gradient allocation per frame.
 *
 * @module render2d/drawMarkings
 */
import type { Graph } from '../engine/graph/graph.ts';
import {
  resolveMarking,
  type Marking,
  type MarkingBinding,
  type MarkingType,
  type ResolvedMarking,
  type Side,
} from '../engine/markings/marking.ts';
import type { TrafficLightSystem } from '../engine/markings/trafficLightController.ts';
import { PALETTE } from './palette.ts';

const sprites = new Map<string, HTMLCanvasElement>();

/** A soft round glow sprite for a colour (cached). */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, `${color}aa`);
    grad.addColorStop(1, `${color}00`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  sprites.set(color, c);
  return c;
}

const LAMP_COLORS = ['#ff3b3b', '#ffc53d', '#3bff7a'] as const;
const LAMP_DIM = ['#3a1414', '#3a3014', '#123a1e'] as const;

export class MarkingPainter {
  private readonly levels = new Float32Array(3);
  private fontPx = 0;
  private font = '';
  private readonly preview: {
    id: number;
    type: MarkingType;
    binding: MarkingBinding;
    props: Record<string, unknown>;
  } = { id: -1, type: 'stop', binding: { segmentId: -1, t: 0, side: 1 }, props: {} };

  /** Draws all markings. */
  drawAll(
    ctx: CanvasRenderingContext2D,
    graph: Graph,
    markings: readonly Marking[],
    roadWidth: number,
    lights: TrafficLightSystem | null,
    timeMs: number,
    hoverId: number | null,
    hoverColor: string,
  ): void {
    this.ensureFont(roadWidth);
    for (const m of markings) {
      const r = resolveMarking(m, graph, roadWidth);
      if (!r) continue;
      this.drawOne(ctx, m, r, roadWidth, lights, timeMs, 1);
      if (m.id === hoverId) this.outline(ctx, r, hoverColor);
    }
  }

  /** Ghost of a marking about to be placed. */
  drawPreview(
    ctx: CanvasRenderingContext2D,
    graph: Graph,
    p: { type: MarkingType; segmentId: number; t: number; side: Side },
    roadWidth: number,
    timeMs: number,
  ): void {
    this.ensureFont(roadWidth);
    const m = this.preview;
    m.type = p.type;
    m.binding.segmentId = p.segmentId;
    m.binding.t = p.t;
    m.binding.side = p.side;
    const r = resolveMarking(m, graph, roadWidth);
    if (!r) return;
    ctx.globalAlpha = 0.55;
    this.drawOne(ctx, m, r, roadWidth, null, timeMs, 0.55);
    ctx.globalAlpha = 1;
    this.outline(ctx, r, PALETTE.cyan);
  }

  private ensureFont(roadWidth: number): void {
    const px = Math.round(roadWidth * 0.17);
    if (px !== this.fontPx) {
      this.fontPx = px;
      this.font = `800 ${px}px system-ui, sans-serif`;
    }
  }

  private outline(ctx: CanvasRenderingContext2D, r: ResolvedMarking, color: string): void {
    ctx.save();
    ctx.translate(r.center.x, r.center.y);
    ctx.rotate(Math.atan2(r.direction.y, r.direction.x));
    ctx.strokeStyle = color;
    ctx.lineWidth = r.width * 0.05;
    ctx.setLineDash([r.width * 0.12, r.width * 0.08]);
    ctx.strokeRect(-r.height / 2 - 4, -r.width / 2 - 4, r.height + 8, r.width + 8);
    ctx.restore();
  }

  private drawOne(
    ctx: CanvasRenderingContext2D,
    m: Marking,
    r: ResolvedMarking,
    roadWidth: number,
    lights: TrafficLightSystem | null,
    timeMs: number,
    alpha: number,
  ): void {
    const w = r.width; // across the lane
    const h = r.height; // along travel
    ctx.save();
    ctx.translate(r.center.x, r.center.y);
    ctx.rotate(Math.atan2(r.direction.y, r.direction.x));
    switch (m.type) {
      case 'stop':
        this.stopLine(ctx, w, h);
        this.roadText(ctx, 'STOP', -h * 0.12);
        this.octagonSign(ctx, h * 0.4, w / 2 + roadWidth * 0.18, roadWidth * 0.09);
        break;
      case 'yield':
        this.sharkTeeth(ctx, w, h);
        this.yieldSign(ctx, h * 0.35, w / 2 + roadWidth * 0.18, roadWidth * 0.1);
        break;
      case 'crossing':
        this.zebra(ctx, w, h);
        break;
      case 'parking':
        this.parking(ctx, w, h);
        break;
      case 'light':
        this.stopLine(ctx, w, h);
        this.trafficLight(ctx, m.id, w, h, roadWidth, lights, alpha);
        break;
      case 'start':
        this.start(ctx, w, h);
        break;
      case 'target':
        this.target(ctx, w, timeMs);
        break;
    }
    ctx.restore();
  }

  private stopLine(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(h / 2 - h * 0.14, -w / 2, h * 0.14, w);
  }

  private roadText(ctx: CanvasRenderingContext2D, text: string, x: number): void {
    ctx.save();
    ctx.translate(x, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(230, 237, 247, 0.9)';
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  private octagonSign(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.fillStyle = '#d61f2c';
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private yieldSign(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    // inverted triangle as seen by the approaching driver (point toward them, -x)
    ctx.fillStyle = PALETTE.white;
    ctx.strokeStyle = '#d61f2c';
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r * 0.7, y - r);
    ctx.lineTo(x + r * 0.7, y + r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private sharkTeeth(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const n = 5;
    const tw = w / n;
    const x0 = h / 2 - h * 0.05;
    const depth = h * 0.3;
    ctx.fillStyle = PALETTE.white;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y0 = -w / 2 + i * tw + tw * 0.12;
      const y1 = y0 + tw * 0.76;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0 - depth, (y0 + y1) / 2);
      ctx.closePath();
    }
    ctx.fill();
  }

  private zebra(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const n = 7;
    const sw = w / (n * 2 - 1);
    ctx.fillStyle = 'rgba(240, 244, 250, 0.92)';
    for (let i = 0; i < n; i++) ctx.fillRect(-h / 2, -w / 2 + i * sw * 2, h, sw);
  }

  private parking(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(59, 130, 246, 0.18)';
    ctx.fillRect(-h / 2, -w / 2, h, w);
    ctx.strokeStyle = 'rgba(230, 237, 247, 0.85)';
    ctx.lineWidth = w * 0.05;
    ctx.strokeRect(-h / 2, -w / 2, h, w);
    const s = w * 0.42;
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.save();
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = PALETTE.white;
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 0, s * 0.04);
    ctx.restore();
  }

  private trafficLight(
    ctx: CanvasRenderingContext2D,
    id: number,
    w: number,
    h: number,
    roadWidth: number,
    lights: TrafficLightSystem | null,
    alpha: number,
  ): void {
    const levels = this.levels;
    if (lights) lights.lampLevels(id, levels);
    else {
      levels[0] = 1;
      levels[1] = 0;
      levels[2] = 0;
    }
    const lr = roadWidth * 0.055; // lamp radius
    const hx = h * 0.25; // housing centre along travel
    const hy = w / 2 + roadWidth * 0.17; // roadside
    const len = lr * 7;
    // pole shadow and housing
    ctx.fillStyle = '#0d1118';
    ctx.strokeStyle = '#3a4456';
    ctx.lineWidth = lr * 0.3;
    ctx.beginPath();
    ctx.roundRect(hx - len / 2, hy - lr * 1.5, len, lr * 3, lr);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      // red nearest the junction (front), green at the back
      const lx = hx + len / 2 - lr * 1.4 - i * lr * 2.1;
      const level = levels[i] as number;
      const lampColor = LAMP_COLORS[i] ?? '#ff3b3b';
      ctx.fillStyle = level > 0.05 ? lampColor : (LAMP_DIM[i] ?? '#222');
      ctx.globalAlpha = alpha * (0.35 + 0.65 * Math.max(level, 0.0));
      ctx.beginPath();
      ctx.arc(lx, hy, lr, 0, Math.PI * 2);
      ctx.fill();
      if (level > 0.01) {
        const prevOp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * level * 0.9;
        const g = lr * 6;
        ctx.drawImage(glowSprite(lampColor), lx - g / 2, hy - g / 2, g, g);
        ctx.globalCompositeOperation = prevOp;
      }
      ctx.globalAlpha = alpha;
    }
  }

  private start(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // chequered start strip + chevron
    const cells = 6;
    const cw = w / cells;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? 'rgba(240,244,250,0.9)' : 'rgba(20,24,32,0.9)';
        ctx.fillRect(-h / 2 + j * cw * 0.6, -w / 2 + i * cw, cw * 0.6, cw);
      }
    }
    ctx.fillStyle = PALETTE.lime;
    ctx.beginPath();
    ctx.moveTo(h / 2, 0);
    ctx.lineTo(h * 0.02, -w * 0.32);
    ctx.lineTo(h * 0.02, -w * 0.12);
    ctx.lineTo(-h * 0.12, -w * 0.12);
    ctx.lineTo(-h * 0.12, w * 0.12);
    ctx.lineTo(h * 0.02, w * 0.12);
    ctx.lineTo(h * 0.02, w * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  private target(ctx: CanvasRenderingContext2D, w: number, timeMs: number): void {
    const t = timeMs / 1000;
    const pulse = (t * 0.8) % 1;
    const bob = (Math.sin(t * 2.4) * 0.5 + 0.5) * w * 0.18;
    // expanding pulse ring on the ground
    ctx.strokeStyle = PALETTE.magenta;
    ctx.globalAlpha = (1 - pulse) * 0.8;
    ctx.lineWidth = w * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, w * (0.2 + pulse * 0.55), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(244, 114, 182, 0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // pin, bobbing "up" (toward the screen top regardless of road direction is not
    // possible inside the rotated frame, so it bobs along the travel axis)
    ctx.save();
    ctx.translate(bob * 0.3, 0);
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glowSprite('#f472b6'), -w * 0.5, -w * 0.5, w, w);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
    ctx.fillStyle = PALETTE.magenta;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.white;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
