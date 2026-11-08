/**
 * Bitmap cache for static ground layers (sidewalks, roads, lane markings).
 *
 * The layers are rendered once into an offscreen canvas covering the visible area plus
 * a generous margin, at the current zoom and device pixel ratio. Following frames just
 * blit it with one drawImage while the view stays inside the cached region. It is
 * rebuilt when the geometry/layers key changes, the zoom settles at a new level, or the
 * camera pans past the margin. While the zoom is animating, layers are drawn directly
 * (cached Path2D objects) so zooming stays smooth and sharp.
 *
 * @module render2d/staticCache
 */
import type { BBox } from '../engine/math/bbox.ts';
import type { Viewport } from './viewport.ts';

const MAX_DIM = 4096;

export class StaticLayerCache {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private key = '';
  private zoom = 0;
  private bounds: BBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  /** Rebuild counter (stats/debug). */
  rebuilds = 0;

  /**
   * Draws the static layers either from the cache or directly. `ctx` must already have
   * the world transform applied. Returns true if the cache was used.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    dpr: number,
    key: string,
    drawLayers: (c: CanvasRenderingContext2D) => void,
  ): boolean {
    if (vp.zoom !== vp.targetZoom) {
      drawLayers(ctx);
      return false;
    }
    const vis = vp.visibleBounds();
    const inside =
      vis.minX >= this.bounds.minX &&
      vis.minY >= this.bounds.minY &&
      vis.maxX <= this.bounds.maxX &&
      vis.maxY <= this.bounds.maxY;
    if (!this.canvas || key !== this.key || vp.zoom !== this.zoom || !inside) {
      if (!this.rebuild(vp, dpr, key, drawLayers)) {
        drawLayers(ctx);
        return false;
      }
    }
    if (!this.canvas) return false;
    const b = this.bounds;
    ctx.drawImage(this.canvas, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    return true;
  }

  invalidate(): void {
    this.key = '';
  }

  private rebuild(
    vp: Viewport,
    dpr: number,
    key: string,
    drawLayers: (c: CanvasRenderingContext2D) => void,
  ): boolean {
    const vis = vp.visibleBounds();
    const w = vis.maxX - vis.minX;
    const h = vis.maxY - vis.minY;
    let pad = 0.5;
    let pxW = Math.ceil(w * (1 + 2 * pad) * vp.zoom * dpr);
    let pxH = Math.ceil(h * (1 + 2 * pad) * vp.zoom * dpr);
    if (pxW > MAX_DIM || pxH > MAX_DIM) {
      pad = 0.1;
      pxW = Math.ceil(w * (1 + 2 * pad) * vp.zoom * dpr);
      pxH = Math.ceil(h * (1 + 2 * pad) * vp.zoom * dpr);
      if (pxW > MAX_DIM || pxH > MAX_DIM) return false;
    }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
    const c = this.ctx;
    if (!c) return false;
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    } else {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, pxW, pxH);
    }
    this.bounds = {
      minX: vis.minX - w * pad,
      minY: vis.minY - h * pad,
      maxX: vis.maxX + w * pad,
      maxY: vis.maxY + h * pad,
    };
    const s = vp.zoom * dpr;
    c.setTransform(s, 0, 0, s, -this.bounds.minX * s, -this.bounds.minY * s);
    drawLayers(c);
    this.key = key;
    this.zoom = vp.zoom;
    this.rebuilds++;
    return true;
  }
}
