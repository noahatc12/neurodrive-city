/**
 * 2D camera: pan, eased zoom toward the cursor, and screen ⇄ world conversion.
 *
 * ```
 *   screen = (world - center) · zoom + (width / 2, height / 2)
 *   world  = (screen - (width / 2, height / 2)) / zoom + center
 * ```
 *
 * `zoom` is CSS pixels per world unit. Screen coordinates are CSS pixels (pointer event
 * space); the renderer multiplies by devicePixelRatio when drawing, so hit thresholds
 * expressed in screen pixels feel identical at every zoom and on every display.
 *
 * Zooming is eased in log space and anchored: the world point under the cursor when the
 * wheel turned stays under the cursor for the whole animation.
 *
 * @module render2d/viewport
 */
import { bboxOf, type BBox } from '../engine/math/bbox.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import { clamp } from '../engine/math/utils.ts';

export interface ViewportOptions {
  minZoom?: number;
  maxZoom?: number;
  /** Zoom easing rate (1/s); higher is snappier. */
  zoomRate?: number;
}

export class Viewport {
  width = 1;
  height = 1;
  zoom = 0.5;
  targetZoom = 0.5;
  readonly center: Vec2 = { x: 0, y: 0 };
  minZoom: number;
  maxZoom: number;
  zoomRate: number;
  private anchorScreen: Vec2 | null = null;
  private readonly anchorWorld: Vec2 = { x: 0, y: 0 };
  private targetCenter: Vec2 | null = null;
  /** performance.now() until which camera-follow yields to manual panning. */
  followPausedUntil = 0;
  private readonly tmp: Vec2 = { x: 0, y: 0 };

  constructor(options: ViewportOptions = {}) {
    this.minZoom = options.minZoom ?? 0.1;
    this.maxZoom = options.maxZoom ?? 8;
    this.zoomRate = options.zoomRate ?? 16;
  }

  /** Sets the viewport size in CSS pixels. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** World → screen (CSS px). Writes into `out` (allocation-free). */
  worldToScreen(x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = (x - this.center.x) * this.zoom + this.width / 2;
    out.y = (y - this.center.y) * this.zoom + this.height / 2;
    return out;
  }

  /** Screen (CSS px) → world. Writes into `out` (allocation-free). */
  screenToWorld(sx: number, sy: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = (sx - this.width / 2) / this.zoom + this.center.x;
    out.y = (sy - this.height / 2) / this.zoom + this.center.y;
    return out;
  }

  /** Converts a length in screen pixels to world units at the current zoom. */
  screenToWorldLength(px: number): number {
    return px / this.zoom;
  }

  /** Pans by a screen-space delta (dragging the world with the pointer). */
  panByScreen(dx: number, dy: number): void {
    this.followPausedUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + 2500;
    this.center.x -= dx / this.zoom;
    this.center.y -= dy / this.zoom;
    this.targetCenter = null;
    if (this.anchorScreen)
      this.screenToWorld(this.anchorScreen.x, this.anchorScreen.y, this.anchorWorld);
  }

  /**
   * Starts an eased zoom by `factor` anchored at screen point (sx, sy).
   * Repeated wheel events compound into the target.
   */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    this.anchorScreen = { x: sx, y: sy };
    this.screenToWorld(sx, sy, this.anchorWorld);
    this.targetCenter = null;
  }

  /** Immediate zoom (pinch gestures), anchored at (sx, sy). */
  zoomImmediate(sx: number, sy: number, factor: number): void {
    const w = this.screenToWorld(sx, sy, this.tmp);
    const wx = w.x;
    const wy = w.y;
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.targetZoom = this.zoom;
    this.center.x = wx - (sx - this.width / 2) / this.zoom;
    this.center.y = wy - (sy - this.height / 2) / this.zoom;
    this.anchorScreen = null;
  }

  /** Jumps to a camera state. */
  set(center: Vec2, zoom: number): void {
    this.center.x = center.x;
    this.center.y = center.y;
    this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.targetZoom = this.zoom;
    this.anchorScreen = null;
    this.targetCenter = null;
  }

  /** Eases the camera centre to a world point (minimap clicks, focus). */
  panTo(world: Vec2, zoom?: number): void {
    this.targetCenter = { x: world.x, y: world.y };
    this.anchorScreen = null;
    if (zoom !== undefined) this.targetZoom = clamp(zoom, this.minZoom, this.maxZoom);
  }

  /** Frames a bounding box with `padding` screen pixels on each side. */
  fit(bbox: BBox, padding = 60, animate = false): void {
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    const z = clamp(
      Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h),
      this.minZoom,
      this.maxZoom,
    );
    const c = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
    if (animate) this.panTo(c, z);
    else this.set(c, z);
  }

  /** Frames a list of points (no-op for an empty list). */
  fitPoints(points: readonly Vec2[], padding = 60, animate = false): void {
    if (points.length === 0) return;
    this.fit(bboxOf(points), padding, animate);
  }

  /**
   * Advances the easing by `dt` seconds. Returns true if the camera moved, so the
   * renderer can skip redraws of static layers when nothing changed.
   */
  update(dt: number): boolean {
    let moved = false;
    if (this.zoom !== this.targetZoom) {
      const k = 1 - Math.exp(-this.zoomRate * dt);
      const lz = Math.log(this.zoom) + (Math.log(this.targetZoom) - Math.log(this.zoom)) * k;
      this.zoom = Math.abs(lz - Math.log(this.targetZoom)) < 1e-4 ? this.targetZoom : Math.exp(lz);
      if (this.anchorScreen) {
        this.center.x = this.anchorWorld.x - (this.anchorScreen.x - this.width / 2) / this.zoom;
        this.center.y = this.anchorWorld.y - (this.anchorScreen.y - this.height / 2) / this.zoom;
      }
      moved = true;
    }
    if (this.targetCenter) {
      const k = 1 - Math.exp(-10 * dt);
      this.center.x += (this.targetCenter.x - this.center.x) * k;
      this.center.y += (this.targetCenter.y - this.center.y) * k;
      if (
        Math.hypot(this.targetCenter.x - this.center.x, this.targetCenter.y - this.center.y) *
          this.zoom <
        0.25
      ) {
        this.center.x = this.targetCenter.x;
        this.center.y = this.targetCenter.y;
        this.targetCenter = null;
      }
      moved = true;
    }
    if (this.zoom === this.targetZoom) this.anchorScreen = null;
    return moved;
  }

  /**
   * Smoothly follows a world point (the focused car) with frame-rate independent
   * exponential damping. Yields to manual panning for a couple of seconds.
   */
  follow(x: number, y: number, dt: number, k = 5): void {
    if (this.targetCenter) return;
    if (typeof performance !== 'undefined' && performance.now() < this.followPausedUntil) return;
    const f = 1 - Math.exp(-k * dt);
    this.center.x += (x - this.center.x) * f;
    this.center.y += (y - this.center.y) * f;
    if (this.anchorScreen)
      this.screenToWorld(this.anchorScreen.x, this.anchorScreen.y, this.anchorWorld);
  }

  /** World-space rectangle currently visible, grown by `pad` world units. */
  visibleBounds(pad = 0): BBox {
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    return {
      minX: this.center.x - hw - pad,
      minY: this.center.y - hh - pad,
      maxX: this.center.x + hw + pad,
      maxY: this.center.y + hh + pad,
    };
  }
}
