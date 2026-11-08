/**
 * Canvas 2D renderer: a full view of the world (not a debug view). Owns its canvas and
 * device-pixel-ratio handling and draws a {@link FrameContext} snapshot each frame.
 * @module render2d/canvas2dRenderer
 */
import type { CameraMode, FrameContext, PickResult, Renderer } from '../app/renderer.ts';
import { drawEditorOverlay, drawSnapGrid } from './drawEditor.ts';
import { drawBackground, drawGraphPreview } from './drawWorld.ts';
import type { Viewport } from './viewport.ts';
import { PALETTE } from './palette.ts';

export class Canvas2DRenderer implements Renderer {
  readonly kind = '2d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Number of draw "passes" issued last frame (reported in stats). */
  drawCalls = 0;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('aria-label', 'City editor canvas');
    this.canvas.setAttribute('role', 'img');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
  }

  mount(container: HTMLElement): void {
    container.prepend(this.canvas);
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.viewport.resize(width, height);
  }

  setCameraMode(_mode: CameraMode): void {
    // The 2D view only has a pan/zoom camera.
  }

  pick(screenX: number, screenY: number): PickResult | null {
    return { kind: 'ground', id: null, world: this.viewport.screenToWorld(screenX, screenY) };
  }

  render(frame: FrameContext): void {
    const ctx = this.ctx;
    const vp = this.viewport;
    this.drawCalls = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.dpr * vp.zoom;
    ctx.setTransform(
      s,
      0,
      0,
      s,
      this.dpr * (vp.width / 2 - vp.center.x * vp.zoom),
      this.dpr * (vp.height / 2 - vp.center.y * vp.zoom),
    );

    drawBackground(ctx, vp);
    this.drawCalls++;
    if (frame.editor?.gridEnabled && frame.mode === 'edit') {
      drawSnapGrid(ctx, vp, frame.editor.gridSize);
      this.drawCalls++;
    }
    if (frame.layers.roads) {
      drawGraphPreview(ctx, vp, frame.model.graph, frame.model.settings.roadWidth);
      this.drawCalls += 2;
    }
    if (frame.editor && frame.mode === 'edit') {
      drawEditorOverlay(
        ctx,
        vp,
        frame.model.graph,
        frame.editor,
        frame.timeMs,
        frame.reducedMotion,
      );
      this.drawCalls++;
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
