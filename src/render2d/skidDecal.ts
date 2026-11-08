/**
 * Persistent skid-mark decal for the 2D view (spec L2), stored as sparse tiles.
 *
 * The world is divided into 512-unit tiles; a tile's offscreen canvas exists only once a
 * tyre mark lands in it. New marks from the engine's ring buffer are stamped once; every
 * half second each live tile fades a little (destination-out), and a tile that has not
 * received marks for ~30 s is fully faded and freed. Drawing blits only the visible live
 * tiles, so an empty or mostly empty decal costs nothing (a single world-sized decal
 * canvas cost ~10 ms per frame to resample in software rendering).
 *
 * @module render2d/skidDecal
 */
import type { BBox } from '../engine/math/bbox.ts';
import type { SkidMarks } from '../engine/sim/particlesSim.ts';

const TILE = 512; // world units per tile
const SCALE = 0.5; // pixels per world unit
const PX = TILE * SCALE;
const FADE_EVERY_MS = 500;
const FADE_STYLE = 'rgba(0, 0, 0, 0.06)';
const FADES_UNTIL_FREE = 60;

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tx: number;
  ty: number;
  fadesSinceStamp: number;
}

export class SkidDecal {
  private readonly tiles = new Map<number, Tile>();
  private consumed = 0;
  private fadeTimer = 0;
  private key = '';

  /** Resets the decal when the world changes. */
  ensure(_bounds: BBox, key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.clear();
  }

  /** Live tile count (stats/tests). */
  get tileCount(): number {
    return this.tiles.size;
  }

  private tileAt(tx: number, ty: number): Tile | null {
    const k = (tx + 32768) * 65536 + (ty + 32768);
    let t = this.tiles.get(k);
    if (!t) {
      const canvas = document.createElement('canvas');
      canvas.width = PX;
      canvas.height = PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(SCALE, 0, 0, SCALE, -tx * TILE * SCALE, -ty * TILE * SCALE);
      ctx.strokeStyle = 'rgba(8, 10, 14, 0.55)';
      ctx.lineCap = 'round';
      t = { canvas, ctx, tx, ty, fadesSinceStamp: 0 };
      this.tiles.set(k, t);
    }
    return t;
  }

  /** Stamps new marks and applies the periodic fade. */
  update(skids: SkidMarks, dtMs: number): void {
    if (skids.written < this.consumed) this.consumed = 0;
    const from = Math.max(this.consumed, skids.written - skids.capacity);
    for (let n = from; n < skids.written; n++) {
      const i = skids.slotOf(n);
      const x1 = skids.seg[i * 4] as number;
      const y1 = skids.seg[i * 4 + 1] as number;
      const x2 = skids.seg[i * 4 + 2] as number;
      const y2 = skids.seg[i * 4 + 3] as number;
      const w = skids.width[i] as number;
      // marks are short: stamp into the tiles of both endpoints (usually the same one)
      const ax = Math.floor(x1 / TILE);
      const ay = Math.floor(y1 / TILE);
      const bx = Math.floor(x2 / TILE);
      const by = Math.floor(y2 / TILE);
      this.stamp(ax, ay, x1, y1, x2, y2, w);
      if (bx !== ax || by !== ay) this.stamp(bx, by, x1, y1, x2, y2, w);
    }
    this.consumed = skids.written;
    this.fadeTimer += dtMs;
    if (this.fadeTimer < FADE_EVERY_MS || this.tiles.size === 0) return;
    this.fadeTimer = 0;
    for (const [k, t] of this.tiles) {
      t.fadesSinceStamp++;
      if (t.fadesSinceStamp > FADES_UNTIL_FREE) {
        this.tiles.delete(k);
        continue;
      }
      const c = t.ctx;
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = FADE_STYLE;
      c.fillRect(0, 0, PX, PX);
      c.restore();
    }
  }

  private stamp(
    tx: number,
    ty: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
  ): void {
    const t = this.tileAt(tx, ty);
    if (!t) return;
    t.fadesSinceStamp = 0;
    t.ctx.lineWidth = w;
    t.ctx.beginPath();
    t.ctx.moveTo(x1, y1);
    t.ctx.lineTo(x2, y2);
    t.ctx.stroke();
  }

  /** Draws the visible live tiles (world transform must be active). */
  draw(ctx: CanvasRenderingContext2D, view: BBox): void {
    if (this.tiles.size === 0) return;
    for (const t of this.tiles.values()) {
      const x = t.tx * TILE;
      const y = t.ty * TILE;
      if (x > view.maxX || x + TILE < view.minX || y > view.maxY || y + TILE < view.minY) continue;
      ctx.drawImage(t.canvas, x, y, TILE, TILE);
    }
  }

  clear(): void {
    this.tiles.clear();
    this.consumed = 0;
    this.fadeTimer = 0;
  }
}
