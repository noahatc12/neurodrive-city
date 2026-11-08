/**
 * Canvas 2D renderer: a full view of the world (not a debug view). Owns its canvas and
 * device-pixel-ratio handling and draws a {@link FrameContext} snapshot each frame.
 *
 * Layer order:
 *   ground grid → static layers (bitmap-cached: sidewalks, road shadow, asphalt, lane
 *   lines, arrows) → debug layers → drag preview → object shadows → markings →
 *   depth-sorted pseudo-3D buildings, trees and cars → editor overlay.
 *
 * @module render2d/canvas2dRenderer
 */
import type {
  CameraMode,
  FrameContext,
  LayerFlags,
  PickResult,
  Renderer,
} from '../app/renderer.ts';
import type { WorldGeometry } from '../engine/world/world.ts';
import { drawEditorOverlay, drawSnapGrid } from './drawEditor.ts';
import { MarkingPainter } from './drawMarkings.ts';
import {
  drawBackground,
  drawDebugLayers,
  drawGraphPreview,
  drawStaticLayers,
} from './drawWorld.ts';
import { PALETTE } from './palette.ts';
import { Pseudo3D } from './pseudo3d.ts';
import { StaticLayerCache } from './staticCache.ts';
import type { Viewport } from './viewport.ts';
import { buildWorldPaths, type WorldPaths } from './worldPaths.ts';

export class Canvas2DRenderer implements Renderer {
  readonly kind = '2d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  readonly pseudo3d = new Pseudo3D();
  readonly staticCache = new StaticLayerCache();
  readonly markingPainter = new MarkingPainter();
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private paths: WorldPaths | null = null;
  private pathsRoadWidth = 0;
  private curPaths: WorldPaths | null = null;
  private curLayers: Readonly<LayerFlags> | null = null;
  private curRoadWidth = 100;
  /** Number of draw passes issued last frame (reported in stats). */
  drawCalls = 0;
  /** Static-layer bitmap cache hits last frame (1/0). */
  cacheHit = false;

  /** Created once (no per-frame closure): draws the static layers for the cache. */
  private readonly drawStatic = (c: CanvasRenderingContext2D): void => {
    if (this.curPaths && this.curLayers)
      drawStaticLayers(c, this.curPaths, this.curLayers, this.curRoadWidth);
  };

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('aria-label', 'City view');
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
    this.staticCache.invalidate();
  }

  setCameraMode(_mode: CameraMode): void {
    // The 2D view only has a pan/zoom camera.
  }

  pick(screenX: number, screenY: number): PickResult | null {
    return { kind: 'ground', id: null, world: this.viewport.screenToWorld(screenX, screenY) };
  }

  /** Cached paths for a geometry (rebuilt on version or road width change). */
  private pathsFor(geo: WorldGeometry, roadWidth: number): WorldPaths {
    if (!this.paths || this.paths.version !== geo.version || this.pathsRoadWidth !== roadWidth) {
      this.paths = buildWorldPaths(geo, roadWidth);
      this.pathsRoadWidth = roadWidth;
      this.staticCache.invalidate();
    }
    return this.paths;
  }

  render(frame: FrameContext): void {
    const ctx = this.ctx;
    const vp = this.viewport;
    const layers = frame.layers;
    const roadWidth = frame.model.settings.roadWidth;
    const geo = frame.geometry;
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

    if (geo) {
      const paths = this.pathsFor(geo, roadWidth);
      this.curPaths = paths;
      this.curLayers = layers;
      this.curRoadWidth = roadWidth;
      const key = `${geo.version}|${roadWidth}|${layers.roads ? 1 : 0}${layers.sidewalks ? 1 : 0}${layers.laneMarkings ? 1 : 0}`;
      this.cacheHit = this.staticCache.draw(ctx, vp, this.dpr, key, this.drawStatic);
      this.drawCalls += this.cacheHit ? 1 : 8;
      drawDebugLayers(ctx, vp, paths, layers, layers.debugHashCells ? geo.collisionHash : null);
    } else if (layers.roads) {
      drawGraphPreview(ctx, vp, frame.model.graph, roadWidth);
      this.drawCalls += 2;
    }
    if (frame.geometryStale && frame.previewSegmentIds && frame.previewSegmentIds.size > 0) {
      drawGraphPreview(ctx, vp, frame.model.graph, roadWidth, frame.previewSegmentIds, true);
      this.drawCalls += 3;
    }

    // pseudo-3D objects
    this.pseudo3d.setCamera(vp, frame.reducedMotion ? 0.8 : 1);
    this.pseudo3d.begin(geo, vp, layers.buildings, layers.trees);
    if (geo) {
      this.pseudo3d.drawShadows(ctx, geo);
      this.drawCalls++;
    }
    if (layers.markings) {
      const ed = frame.mode === 'edit' ? frame.editor : null;
      this.markingPainter.drawAll(
        ctx,
        frame.model.graph,
        frame.model.markings.all(),
        roadWidth,
        frame.lights,
        frame.timeMs,
        ed ? ed.hoverMarkingId : null,
        ed?.tool === 'erase' ? PALETTE.red : PALETTE.amber,
      );
      if (ed?.markingPreview) {
        this.markingPainter.drawPreview(
          ctx,
          frame.model.graph,
          ed.markingPreview,
          roadWidth,
          frame.timeMs,
        );
      }
      this.drawCalls += frame.model.markings.size + 1;
    }
    this.pseudo3d.draw(ctx, geo, null);
    this.drawCalls += this.pseudo3d.drawn;

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
