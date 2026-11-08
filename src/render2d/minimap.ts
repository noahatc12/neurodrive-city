/**
 * Minimap (spec I1–I3): roads and buildings in a static layer cached to an offscreen
 * canvas (redrawn only when the world version or size changes), plus per-frame dynamic
 * content: the camera's view rectangle, cars as dots (best car pulses), targets and the
 * active route. Click or drag to move the camera.
 * @module render2d/minimap
 */
import { padBBox, type BBox } from '../engine/math/bbox.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import type { WorldGeometry } from '../engine/world/world.ts';
import { PALETTE } from './palette.ts';

/** Dynamic content for one minimap frame. */
export interface MinimapFrame {
  geometry: WorldGeometry | null;
  /** Fallback when there is no geometry yet: raw segments. */
  segments: readonly { a: Vec2; b: Vec2 }[];
  /** Camera footprint (4 corners in world space; a rectangle in 2D, a frustum in 3D). */
  view: readonly Vec2[];
  /** Car positions packed as [x, y, x, y, ...] and their count. */
  cars: Float64Array | null;
  carCount: number;
  /** Optional per-car flags: 0 population, 1 traffic, 2 damaged. */
  carKinds: Uint8Array | null;
  bestCar: Vec2 | null;
  targets: readonly Vec2[];
  route: readonly Vec2[] | null;
  timeMs: number;
}

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache: HTMLCanvasElement;
  private readonly cacheCtx: CanvasRenderingContext2D;
  private cacheKey = '';
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private w = 220;
  private h = 160;
  private dpr = 1;
  private dragging = false;
  /** Static layer redraw counter (I3 evidence in tests). */
  staticRedraws = 0;
  onNavigate: (world: Vec2) => void = () => {};

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.canvas.setAttribute('aria-label', 'Minimap: click or drag to move the camera');
    this.canvas.setAttribute('role', 'img');
    const ctx = this.canvas.getContext('2d');
    this.cache = document.createElement('canvas');
    const cctx = this.cache.getContext('2d');
    if (!ctx || !cctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.cacheCtx = cctx;
    this.el = document.createElement('div');
    this.el.className = 'minimap glass';
    this.el.append(this.canvas);
    const toWorld = (e: PointerEvent): Vec2 => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      return { x: (x - this.offX) / this.scale, y: (y - this.offY) / this.scale };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.onNavigate(toWorld(e));
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.onNavigate(toWorld(e));
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('lostpointercapture', end);
  }

  /** Sets the CSS size and device pixel ratio. */
  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.cacheKey = '';
  }

  /** PNG data URL of the static layer (roads, buildings, trees) for library thumbnails. */
  thumbnail(): string | null {
    try {
      return this.cache.width > 0 ? this.cache.toDataURL('image/png') : null;
    } catch {
      return null;
    }
  }

  /** World → minimap CSS pixels. */
  project(p: Vec2, out: Vec2): Vec2 {
    out.x = p.x * this.scale + this.offX;
    out.y = p.y * this.scale + this.offY;
    return out;
  }

  private readonly tmp: Vec2 = { x: 0, y: 0 };

  render(f: MinimapFrame): void {
    this.ensureStatic(f);
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.cache, 0, 0);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    // route
    if (f.route && f.route.length > 1) {
      ctx.strokeStyle = PALETTE.cyan;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < f.route.length; i++) {
        const p = this.project(f.route[i] as Vec2, this.tmp);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    // targets
    ctx.fillStyle = PALETTE.magenta;
    for (const t of f.targets) {
      const p = this.project(t, this.tmp);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // cars
    if (f.cars) {
      for (let i = 0; i < f.carCount; i++) {
        const kind = f.carKinds ? f.carKinds[i] : 0;
        ctx.fillStyle =
          kind === 1
            ? PALETTE.amber
            : kind === 2
              ? 'rgba(147,161,184,0.5)'
              : 'rgba(34,211,238,0.75)';
        const x = (f.cars[i * 2] as number) * this.scale + this.offX;
        const y = (f.cars[i * 2 + 1] as number) * this.scale + this.offY;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    if (f.bestCar) {
      const p = this.project(f.bestCar, this.tmp);
      const pulse = 0.5 + 0.5 * Math.sin(f.timeMs / 180);
      ctx.fillStyle = PALETTE.lime;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(163, 230, 53, ${0.8 - pulse * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + pulse * 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // camera footprint
    if (f.view.length >= 3) {
      ctx.strokeStyle = 'rgba(230, 237, 247, 0.9)';
      ctx.fillStyle = 'rgba(230, 237, 247, 0.08)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < f.view.length; i++) {
        const p = this.project(f.view[i] as Vec2, this.tmp);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private ensureStatic(f: MinimapFrame): void {
    const geo = f.geometry;
    const key = `${geo ? geo.version : `g${f.segments.length}`}|${this.w}x${this.h}@${this.dpr}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.staticRedraws++;
    // fit bounds
    let b: BBox;
    if (geo) b = padBBox(geo.data.bounds, 100);
    else if (f.segments.length > 0) {
      b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const s of f.segments) {
        b.minX = Math.min(b.minX, s.a.x, s.b.x);
        b.minY = Math.min(b.minY, s.a.y, s.b.y);
        b.maxX = Math.max(b.maxX, s.a.x, s.b.x);
        b.maxY = Math.max(b.maxY, s.a.y, s.b.y);
      }
      b = padBBox(b, 300);
    } else b = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    this.scale = Math.min((this.w - 12) / bw, (this.h - 12) / bh);
    this.offX = (this.w - bw * this.scale) / 2 - b.minX * this.scale;
    this.offY = (this.h - bh * this.scale) / 2 - b.minY * this.scale;

    this.cache.width = this.canvas.width;
    this.cache.height = this.canvas.height;
    const c = this.cacheCtx;
    const d = this.dpr;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.setTransform(d * this.scale, 0, 0, d * this.scale, d * this.offX, d * this.offY);
    if (geo) {
      c.fillStyle = 'rgba(147, 161, 184, 0.55)';
      c.beginPath();
      for (const r of geo.data.roads) {
        const pts = r.points;
        const p0 = pts[0];
        if (!p0) continue;
        c.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) c.lineTo((pts[i] as Vec2).x, (pts[i] as Vec2).y);
        c.closePath();
      }
      c.fill();
      c.fillStyle = 'rgba(59, 71, 99, 0.85)';
      c.beginPath();
      for (const bd of geo.data.buildings) {
        const p = bd.base;
        const p0 = p[0];
        if (!p0) continue;
        c.moveTo(p0.x, p0.y);
        for (let i = 1; i < 4; i++) c.lineTo((p[i] as Vec2).x, (p[i] as Vec2).y);
        c.closePath();
      }
      c.fill();
      c.fillStyle = 'rgba(44, 122, 85, 0.6)';
      for (const t of geo.data.trees)
        c.fillRect(t.x - t.radius * 0.5, t.y - t.radius * 0.5, t.radius, t.radius);
    } else {
      c.strokeStyle = 'rgba(147, 161, 184, 0.6)';
      c.lineWidth = 60;
      c.lineCap = 'round';
      c.beginPath();
      for (const s of f.segments) {
        c.moveTo(s.a.x, s.a.y);
        c.lineTo(s.b.x, s.b.y);
      }
      c.stroke();
    }
  }
}
