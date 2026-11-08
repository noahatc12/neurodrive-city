/**
 * Persistent skid-mark decal for the 2D view (spec L2): a world-aligned offscreen canvas
 * covering the world bounds. New tyre-track segments from the engine's ring buffer are
 * stamped onto it once; the whole decal fades a little every half second
 * (destination-out), so old marks disappear without being tracked individually.
 * @module render2d/skidDecal
 */
import type { BBox } from '../engine/math/bbox.ts';
import type { SkidMarks } from '../engine/sim/particlesSim.ts';

const MAX_DIM = 2048;

export class SkidDecal {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bounds: BBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  private scale = 1;
  private consumed = 0;
  private fadeTimer = 0;
  private key = '';

  /** (Re)creates the decal for new world bounds. */
  ensure(bounds: BBox, key: string): void {
    if (key === this.key && this.canvas) return;
    this.key = key;
    this.bounds = {
      minX: bounds.minX - 200,
      minY: bounds.minY - 200,
      maxX: bounds.maxX + 200,
      maxY: bounds.maxY + 200,
    };
    const w = this.bounds.maxX - this.bounds.minX;
    const h = this.bounds.maxY - this.bounds.minY;
    this.scale = Math.min(1, MAX_DIM / Math.max(w, h));
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
    this.canvas.width = Math.max(1, Math.ceil(w * this.scale));
    this.canvas.height = Math.max(1, Math.ceil(h * this.scale));
    this.consumed = 0;
  }

  /** Stamps new marks and applies the periodic fade. */
  update(skids: SkidMarks, dtMs: number): void {
    const c = this.ctx;
    if (!c || !this.canvas) return;
    const s = this.scale;
    if (skids.written < this.consumed) this.consumed = 0;
    const from = Math.max(this.consumed, skids.written - skids.capacity);
    if (from < skids.written) {
      c.setTransform(s, 0, 0, s, -this.bounds.minX * s, -this.bounds.minY * s);
      c.strokeStyle = 'rgba(8, 10, 14, 0.55)';
      c.lineCap = 'round';
      for (let n = from; n < skids.written; n++) {
        const i = skids.slotOf(n);
        c.lineWidth = skids.width[i] as number;
        c.beginPath();
        c.moveTo(skids.seg[i * 4] as number, skids.seg[i * 4 + 1] as number);
        c.lineTo(skids.seg[i * 4 + 2] as number, skids.seg[i * 4 + 3] as number);
        c.stroke();
      }
      this.consumed = skids.written;
    }
    this.fadeTimer += dtMs;
    if (this.fadeTimer > 500) {
      this.fadeTimer = 0;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0, 0, 0, 0.06)';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      c.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * Draws the visible part of the decal (world transform must be active). Only the
   * source rectangle under `view` is sampled, so a 2048-pixel decal costs no more than
   * the screen area it covers; nothing is drawn before the first skid mark.
   */
  draw(ctx: CanvasRenderingContext2D, view: BBox): void {
    if (!this.canvas || this.consumed === 0) return;
    const b = this.bounds;
    const x0 = Math.max(b.minX, view.minX);
    const y0 = Math.max(b.minY, view.minY);
    const x1 = Math.min(b.maxX, view.maxX);
    const y1 = Math.min(b.maxY, view.maxY);
    if (x1 <= x0 || y1 <= y0) return;
    const s = this.scale;
    ctx.drawImage(
      this.canvas,
      (x0 - b.minX) * s,
      (y0 - b.minY) * s,
      (x1 - x0) * s,
      (y1 - y0) * s,
      x0,
      y0,
      x1 - x0,
      y1 - y0,
    );
  }

  clear(): void {
    if (this.ctx && this.canvas) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.consumed = 0;
  }
}
