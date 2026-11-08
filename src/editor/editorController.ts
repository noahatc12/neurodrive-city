/**
 * Editor input controller: turns pointer, wheel and touch input on the canvas into
 * camera moves and undoable world edits.
 *
 * Responsibilities:
 * - viewport: wheel zoom toward the cursor (eased), pan with middle-drag, Space+drag or
 *   right-drag on empty space, one-finger pan and pinch zoom on touch;
 * - hover tests in **screen pixels** (converted with the current zoom) so picking feels
 *   the same at every zoom level;
 * - point drags (single or multi-selection) with live movement and a single undo step;
 * - Shift+drag box selection;
 * - delegating clicks to the active tool.
 *
 * Every drag ends cleanly on pointer-up, pointer-cancel, leaving the window or blur.
 *
 * @module editor/editorController
 */
import type { EditorOverlay, ToolId } from '../app/renderer.ts';
import type { MarkingType } from '../engine/markings/marking.ts';
import { resolveMarking, type Side } from '../engine/markings/marking.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import type { Viewport } from '../render2d/viewport.ts';
import { CompositeCommand, type Command, type History } from './history.ts';
import {
  MovePointsCommand,
  RemoveMarkingCommand,
  RemovePointCommand,
  RemoveSegmentCommand,
  SetSegmentFlagsCommand,
} from './commands.ts';
import { snap, type SnapResult } from './snapping.ts';
import { eraseTool } from './tools/eraseTool.ts';
import { graphTool } from './tools/graphTool.ts';
import { markingTool } from './tools/markingTool.ts';
import type { ClickInfo, Tool } from './tools/tool.ts';

/** Hit radii in CSS pixels. */
export const HIT_POINT_PX = 12;
export const HIT_SEGMENT_PX = 9;
export const SNAP_POINT_PX = 14;
const DRAG_THRESHOLD_PX = 4;

export interface EditorState {
  hoverPointId: number | null;
  selectedPointId: number | null;
  selectedPointIds: Set<number>;
  hoverSegmentId: number | null;
  selectedSegmentIds: Set<number>;
  hoverMarkingId: number | null;
  mouseScreen: Vec2 | null;
  mouseWorld: Vec2 | null;
  markingPreview: { type: MarkingType; segmentId: number; t: number; side: Side } | null;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; pointerId: number; last: Vec2; moved: boolean; deselectOnClick: boolean }
  | {
      kind: 'press';
      pointerId: number;
      start: Vec2;
      startWorld: Vec2;
      canDrag: boolean;
      info: ClickInfo;
    }
  | {
      kind: 'drag';
      pointerId: number;
      ids: number[];
      from: Vec2[];
      anchorId: number;
      grabOffset: Vec2;
    }
  | { kind: 'box'; pointerId: number; a: Vec2; b: Vec2 }
  | { kind: 'pinch' };

export interface EditorControllerOptions {
  model: WorldModel;
  history: History;
  viewport: Viewport;
  toast: (msg: string) => void;
}

const TOOLS: Record<ToolId, Tool> = {
  graph: graphTool,
  erase: eraseTool,
  stop: markingTool('stop'),
  yield: markingTool('yield'),
  crossing: markingTool('crossing'),
  parking: markingTool('parking'),
  light: markingTool('light'),
  start: markingTool('start'),
  target: markingTool('target'),
};

export class EditorController {
  model: WorldModel;
  readonly history: History;
  readonly viewport: Viewport;
  readonly toast: (msg: string) => void;
  tool: ToolId = 'graph';
  gridEnabled = false;
  /** When false (simulate mode) clicks do not edit, but the camera still works. */
  editable = true;
  spaceDown = false;
  readonly state: EditorState = {
    hoverPointId: null,
    selectedPointId: null,
    selectedPointIds: new Set(),
    hoverSegmentId: null,
    selectedSegmentIds: new Set(),
    hoverMarkingId: null,
    mouseScreen: null,
    mouseWorld: null,
    markingPreview: null,
  };
  private gesture: Gesture = { kind: 'none' };
  private readonly touches = new Map<number, Vec2>();
  private pinchLast: { dist: number; mid: Vec2 } | null = null;
  private snapState: { kind: 'grid' | 'point'; x: number; y: number; sinceMs: number } | null =
    null;
  private lastSnap: SnapResult | null = null;
  private el: HTMLElement | null = null;
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];
  private nowMs = 0;
  /** Called whenever the selection changes (UI updates). */
  onSelectionChange: () => void = () => {};
  /** Called while dragging so the app can throttle preview regeneration. */
  onDragState: (dragging: boolean) => void = () => {};

  constructor(opts: EditorControllerOptions) {
    this.model = opts.model;
    this.history = opts.history;
    this.viewport = opts.viewport;
    this.toast = opts.toast;
  }

  /** Grid spacing: half a road width, so roads line up neatly. */
  get gridSize(): number {
    return this.model.settings.roadWidth / 2;
  }

  /** Attaches input listeners to the canvas container. */
  attach(el: HTMLElement): void {
    this.el = el;
    const on = (
      target: EventTarget,
      type: string,
      fn: EventListener,
      opts?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn]);
    };
    on(el, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    on(el, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    on(el, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    on(el, 'pointercancel', (e) => this.onPointerCancel(e as PointerEvent));
    on(el, 'pointerleave', () => this.onPointerLeave());
    on(el, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(window, 'blur', () => this.endGesture(true));
  }

  detach(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.el = null;
  }

  /** Replaces the world (load, new world): clears selection and gestures. */
  setModel(model: WorldModel): void {
    this.endGesture(false);
    this.model = model;
    this.clearSelection();
    this.refreshHover();
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.state.markingPreview = null;
    if (tool !== 'graph') this.clearSelection();
    this.refreshHover();
  }

  toggleGrid(): boolean {
    this.gridEnabled = !this.gridEnabled;
    return this.gridEnabled;
  }

  // ---------------------------------------------------------------------------
  // Selection API (used by tools and keyboard shortcuts)
  // ---------------------------------------------------------------------------

  selectPoint(id: number | null): void {
    this.state.selectedPointId = id;
    this.state.selectedPointIds.clear();
    this.state.selectedSegmentIds.clear();
    this.onSelectionChange();
  }

  togglePointInSelection(id: number): void {
    const s = this.state.selectedPointIds;
    if (this.state.selectedPointId !== null && s.size === 0) s.add(this.state.selectedPointId);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.state.selectedPointId = null;
    this.onSelectionChange();
  }

  selectSegment(id: number, additive: boolean): void {
    const s = this.state.selectedSegmentIds;
    if (!additive) {
      s.clear();
      this.state.selectedPointIds.clear();
      s.add(id);
    } else if (s.has(id)) {
      s.delete(id);
    } else {
      s.add(id);
    }
    this.state.selectedPointId = null;
    this.onSelectionChange();
  }

  clearSelection(): void {
    this.state.selectedPointId = null;
    this.state.selectedPointIds.clear();
    this.state.selectedSegmentIds.clear();
    this.onSelectionChange();
  }

  get hasSelection(): boolean {
    return (
      this.state.selectedPointId !== null ||
      this.state.selectedPointIds.size > 0 ||
      this.state.selectedSegmentIds.size > 0
    );
  }

  /** Deletes selected segments and points as one undo step. */
  deleteSelection(): boolean {
    const cmds: Command[] = [];
    for (const id of this.state.selectedSegmentIds)
      cmds.push(new RemoveSegmentCommand(this.model, id));
    const pts = new Set(this.state.selectedPointIds);
    if (this.state.selectedPointId !== null) pts.add(this.state.selectedPointId);
    for (const id of pts) cmds.push(new RemovePointCommand(this.model, id));
    if (cmds.length === 0) return false;
    this.history.push(
      cmds.length === 1
        ? (cmds[0] as Command)
        : new CompositeCommand(`Delete ${cmds.length} items`, cmds),
    );
    this.clearSelection();
    this.refreshHover();
    return true;
  }

  /** Toggles one-way on the selected segments (O). */
  toggleOneWay(): boolean {
    const ids = [...this.state.selectedSegmentIds].filter((id) => this.model.graph.getSegment(id));
    if (ids.length === 0) return false;
    const allOneWay = ids.every((id) => this.model.graph.getSegment(id)?.oneWay);
    this.history.push(
      new SetSegmentFlagsCommand(
        this.model,
        ids,
        { oneWay: !allOneWay },
        allOneWay ? 'Make two-way' : 'Make one-way',
      ),
    );
    return true;
  }

  /** Esc: cancel the current gesture, else clear the selection. */
  cancel(): void {
    if (this.gesture.kind !== 'none') this.endGesture(false, true);
    else this.clearSelection();
  }

  /** Snaps a world position using the current grid and point settings. */
  snapAt(world: Vec2, exclude?: ReadonlySet<number>): SnapResult {
    const opts = {
      gridEnabled: this.gridEnabled,
      gridSize: this.gridSize,
      pointRadius: this.viewport.screenToWorldLength(SNAP_POINT_PX),
    };
    return snap(world, this.model.graph, exclude ? { ...opts, exclude } : opts);
  }

  markingUnderCursorIsType(type: MarkingType): boolean {
    const id = this.state.hoverMarkingId;
    return id !== null && this.model.markings.get(id)?.type === type;
  }

  /** Recomputes hover state from the last known mouse position. */
  refreshHover(): void {
    const w = this.state.mouseWorld;
    if (!w) return;
    this.updateHover(w);
  }

  /** Builds the overlay snapshot the renderer draws. */
  overlay(timeMs: number): EditorOverlay {
    this.nowMs = timeMs;
    const st = this.state;
    const g = this.model.graph;
    let rubberBand: EditorOverlay['rubberBand'] = null;
    const sel = st.selectedPointId !== null ? g.getPoint(st.selectedPointId) : undefined;
    if (
      this.editable &&
      this.tool === 'graph' &&
      sel &&
      st.mouseWorld &&
      this.gesture.kind !== 'drag' &&
      this.gesture.kind !== 'pan' &&
      st.hoverSegmentId === null
    ) {
      const target = this.lastSnap ?? { x: st.mouseWorld.x, y: st.mouseWorld.y };
      const hovered = st.hoverPointId !== null ? g.getPoint(st.hoverPointId) : undefined;
      rubberBand = {
        from: { x: sel.x, y: sel.y },
        to: hovered ? { x: hovered.x, y: hovered.y } : { x: target.x, y: target.y },
      };
    }
    return {
      tool: this.tool,
      hoverPointId: st.hoverPointId,
      selectedPointId: st.selectedPointId,
      selectedPointIds: st.selectedPointIds,
      hoverSegmentId: st.hoverSegmentId,
      selectedSegmentIds: st.selectedSegmentIds,
      hoverMarkingId: st.hoverMarkingId,
      mouseWorld: st.mouseWorld,
      rubberBand,
      snap: this.editable ? this.snapState : null,
      boxSelect: this.gesture.kind === 'box' ? { a: this.gesture.a, b: this.gesture.b } : null,
      markingPreview: this.editable ? st.markingPreview : null,
      gridEnabled: this.gridEnabled,
      gridSize: this.gridSize,
      dragging: this.gesture.kind === 'drag',
    };
  }

  // ---------------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------------

  private localPoint(e: PointerEvent | WheelEvent): Vec2 {
    const r = this.el?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  private onPointerDown(e: PointerEvent): void {
    const p = this.localPoint(e);
    this.el?.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, p);
      this.capture(e);
      if (this.touches.size === 2) {
        this.gesture = { kind: 'pinch' };
        this.pinchLast = this.pinchMetrics();
      } else if (this.touches.size === 1) {
        this.setMouse(p);
        // one finger pans; a quick tap becomes a click on release
        this.gesture = {
          kind: 'press',
          pointerId: e.pointerId,
          start: p,
          startWorld: this.viewport.screenToWorld(p.x, p.y),
          canDrag: false,
          info: {
            world: this.viewport.screenToWorld(p.x, p.y),
            shift: false,
            alt: false,
            ctrl: false,
          },
        };
      }
      return;
    }
    this.setMouse(p);
    if (this.gesture.kind !== 'none') return;
    // Recompute hover at the press position: touch, pen and synthetic input may not send
    // a move before the press, and acting on a stale hover would edit the wrong point.
    if (this.state.mouseWorld) this.updateHover(this.state.mouseWorld);
    const wantsPan = e.button === 1 || (e.button === 0 && this.spaceDown);
    if (wantsPan) {
      e.preventDefault();
      this.capture(e);
      this.gesture = {
        kind: 'pan',
        pointerId: e.pointerId,
        last: p,
        moved: false,
        deselectOnClick: false,
      };
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      if (this.editable && this.state.hoverMarkingId !== null) {
        this.history.push(new RemoveMarkingCommand(this.model, this.state.hoverMarkingId));
        this.refreshHover();
        return;
      }
      if (this.editable && this.tool === 'graph' && this.state.hoverPointId !== null) {
        const id = this.state.hoverPointId;
        this.history.push(new RemovePointCommand(this.model, id));
        if (this.state.selectedPointId === id) this.selectPoint(null);
        this.state.selectedPointIds.delete(id);
        this.refreshHover();
        return;
      }
      this.capture(e);
      this.gesture = {
        kind: 'pan',
        pointerId: e.pointerId,
        last: p,
        moved: false,
        deselectOnClick: true,
      };
      return;
    }
    if (e.button !== 0) return;
    const world = this.viewport.screenToWorld(p.x, p.y);
    const info: ClickInfo = {
      world,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
    if (!this.editable) {
      this.capture(e);
      this.gesture = {
        kind: 'pan',
        pointerId: e.pointerId,
        last: p,
        moved: false,
        deselectOnClick: false,
      };
      return;
    }
    // Shift+drag on empty space: box select
    if (
      e.shiftKey &&
      this.state.hoverPointId === null &&
      this.state.hoverSegmentId === null &&
      this.tool === 'graph'
    ) {
      this.capture(e);
      this.gesture = {
        kind: 'box',
        pointerId: e.pointerId,
        a: world,
        b: { x: world.x, y: world.y },
      };
      return;
    }
    const tool = TOOLS[this.tool];
    const canDrag = tool.onPointerDown?.(this, info) ?? false;
    this.capture(e);
    this.gesture = {
      kind: 'press',
      pointerId: e.pointerId,
      start: p,
      startWorld: world,
      canDrag,
      info,
    };
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.localPoint(e);
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, p);
      if (this.gesture.kind === 'pinch') {
        const m = this.pinchMetrics();
        if (m && this.pinchLast) {
          if (this.pinchLast.dist > 0)
            this.viewport.zoomImmediate(m.mid.x, m.mid.y, m.dist / this.pinchLast.dist);
          this.viewport.panByScreen(m.mid.x - this.pinchLast.mid.x, m.mid.y - this.pinchLast.mid.y);
        }
        this.pinchLast = m;
        return;
      }
      if (this.gesture.kind === 'press' && this.gesture.pointerId === e.pointerId) {
        if (
          Math.hypot(p.x - this.gesture.start.x, p.y - this.gesture.start.y) >
          DRAG_THRESHOLD_PX * 2
        ) {
          this.gesture = {
            kind: 'pan',
            pointerId: e.pointerId,
            last: this.gesture.start,
            moved: true,
            deselectOnClick: false,
          };
        }
      }
      if (this.gesture.kind === 'pan' && this.gesture.pointerId === e.pointerId) {
        this.viewport.panByScreen(p.x - this.gesture.last.x, p.y - this.gesture.last.y);
        this.gesture.last = p;
      }
      return;
    }

    this.setMouse(p);
    const g = this.gesture;
    switch (g.kind) {
      case 'pan':
        if (g.pointerId !== e.pointerId) return;
        if (Math.hypot(p.x - g.last.x, p.y - g.last.y) > 0) {
          if (!g.moved && g.deselectOnClick) {
            // a right press only becomes a pan after a few pixels
            const total = Math.hypot(p.x - g.last.x, p.y - g.last.y);
            if (total < DRAG_THRESHOLD_PX) return;
          }
          this.viewport.panByScreen(p.x - g.last.x, p.y - g.last.y);
          g.last = p;
          g.moved = true;
        }
        return;
      case 'press': {
        if (g.pointerId !== e.pointerId) return;
        const dist = Math.hypot(p.x - g.start.x, p.y - g.start.y);
        if (dist > DRAG_THRESHOLD_PX && g.canDrag) this.beginDrag(g.pointerId, g.startWorld);
        return;
      }
      case 'drag':
        if (g.pointerId === e.pointerId) this.continueDrag();
        return;
      case 'box':
        if (g.pointerId === e.pointerId && this.state.mouseWorld) {
          g.b = { x: this.state.mouseWorld.x, y: this.state.mouseWorld.y };
        }
        return;
      default:
        if (this.state.mouseWorld) this.updateHover(this.state.mouseWorld);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      const wasTap = this.gesture.kind === 'press' && this.gesture.pointerId === e.pointerId;
      this.touches.delete(e.pointerId);
      if (wasTap && this.gesture.kind === 'press' && this.editable) {
        const info = this.gesture.info;
        this.updateHover(info.world);
        TOOLS[this.tool].onClick(this, info);
      }
      if (this.touches.size === 0) this.gesture = { kind: 'none' };
      else if (this.gesture.kind === 'pinch' && this.touches.size === 1) {
        const [id, pt] = [...this.touches.entries()][0] ?? [0, { x: 0, y: 0 }];
        this.gesture = {
          kind: 'pan',
          pointerId: id,
          last: pt,
          moved: true,
          deselectOnClick: false,
        };
      }
      this.pinchLast = null;
      return;
    }
    const g = this.gesture;
    if (g.kind === 'none' || ('pointerId' in g && g.pointerId !== e.pointerId)) return;
    if (g.kind === 'press') {
      this.gesture = { kind: 'none' };
      TOOLS[this.tool].onClick(this, g.info);
      this.refreshHover();
      return;
    }
    if (g.kind === 'pan' && g.deselectOnClick && !g.moved) {
      this.gesture = { kind: 'none' };
      this.clearSelection();
      return;
    }
    this.endGesture(true);
  }

  private onPointerCancel(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    this.endGesture(true);
  }

  private onPointerLeave(): void {
    // With pointer capture, leave only fires after release; end any drag cleanly.
    if (this.gesture.kind === 'none') {
      this.state.hoverPointId = null;
      this.state.hoverSegmentId = null;
      this.state.hoverMarkingId = null;
      this.state.markingPreview = null;
      this.state.mouseWorld = null;
      this.snapState = null;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.localPoint(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const delta = Math.max(-200, Math.min(200, e.deltaY * unit));
    this.viewport.zoomAt(p.x, p.y, Math.exp(-delta * 0.0018));
  }

  private capture(e: PointerEvent): void {
    try {
      this.el?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events in tests may not support capture
    }
  }

  private setMouse(p: Vec2): void {
    this.state.mouseScreen = p;
    this.state.mouseWorld = this.viewport.screenToWorld(p.x, p.y);
  }

  private pinchMetrics(): { dist: number; mid: Vec2 } | null {
    const pts = [...this.touches.values()];
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return null;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  // ---------------------------------------------------------------------------
  // Hover, drag, box
  // ---------------------------------------------------------------------------

  private updateHover(world: Vec2): void {
    const g = this.model.graph;
    const st = this.state;
    const pointR = this.viewport.screenToWorldLength(HIT_POINT_PX);
    const segR = this.viewport.screenToWorldLength(HIT_SEGMENT_PX);
    st.hoverMarkingId = this.markingAt(world);
    const p =
      this.tool === 'graph' || this.tool === 'erase'
        ? g.nearestPoint(world.x, world.y, pointR)
        : null;
    st.hoverPointId = p ? p.id : null;
    const seg =
      !p && (this.tool === 'graph' || this.tool === 'erase')
        ? g.nearestSegment(world.x, world.y, segR)
        : null;
    st.hoverSegmentId = seg ? seg.segment.id : null;
    if (this.tool !== 'graph' && this.tool !== 'erase') TOOLS[this.tool].onHover?.(this, world);
    // snap preview for adding points
    if (this.tool === 'graph' && !p && !seg) {
      const s = this.snapAt(world);
      this.lastSnap = s;
      this.trackSnap(s.kind === 'none' ? null : s);
    } else {
      this.lastSnap = null;
      this.trackSnap(p ? { x: p.x, y: p.y, kind: 'point', point: p } : null);
    }
  }

  private trackSnap(s: SnapResult | null): void {
    if (!s || s.kind === 'none') {
      this.snapState = null;
      return;
    }
    const prev = this.snapState;
    if (!prev || prev.kind !== s.kind || prev.x !== s.x || prev.y !== s.y) {
      this.snapState = { kind: s.kind, x: s.x, y: s.y, sinceMs: this.nowMs };
    }
  }

  private markingAt(world: Vec2): number | null {
    const rw = this.model.settings.roadWidth;
    let best: number | null = null;
    let bestD = Infinity;
    for (const m of this.model.markings.all()) {
      const r = resolveMarking(m, this.model.graph, rw);
      if (!r) continue;
      const d = Math.hypot(r.center.x - world.x, r.center.y - world.y);
      if (d < Math.max(r.width, r.height) / 2 && d < bestD) {
        bestD = d;
        best = m.id;
      }
    }
    return best;
  }

  private beginDrag(pointerId: number, startWorld: Vec2): void {
    const g = this.model.graph;
    const hoverId = this.state.hoverPointId;
    if (hoverId === null) return;
    const anchor = g.getPoint(hoverId);
    if (!anchor) return;
    let ids: number[];
    if (this.state.selectedPointIds.has(hoverId)) {
      ids = [...this.state.selectedPointIds].filter((id) => g.getPoint(id));
    } else {
      ids = [hoverId];
      if (this.state.selectedPointIds.size > 0 || this.state.selectedSegmentIds.size > 0)
        this.clearSelection();
    }
    const from = ids.map((id) => {
      const p = g.getPoint(id);
      return { x: p?.x ?? 0, y: p?.y ?? 0 };
    });
    this.gesture = {
      kind: 'drag',
      pointerId,
      ids,
      from,
      anchorId: hoverId,
      grabOffset: { x: anchor.x - startWorld.x, y: anchor.y - startWorld.y },
    };
    this.onDragState(true);
  }

  private continueDrag(): void {
    const g = this.gesture;
    const w = this.state.mouseWorld;
    if (g.kind !== 'drag' || !w) return;
    const graph = this.model.graph;
    const anchorIndex = g.ids.indexOf(g.anchorId);
    const anchorFrom = g.from[anchorIndex];
    if (!anchorFrom) return;
    const raw = { x: w.x + g.grabOffset.x, y: w.y + g.grabOffset.y };
    const s = this.snapAt(raw, new Set(g.ids));
    this.trackSnap(s.kind === 'none' ? null : s);
    const dx = s.x - anchorFrom.x;
    const dy = s.y - anchorFrom.y;
    g.ids.forEach((id, i) => {
      const p = graph.getPoint(id);
      const f = g.from[i];
      if (p && f) graph.movePoint(p, f.x + dx, f.y + dy);
    });
  }

  /** Ends the current gesture. `commit` keeps drag/box results; `revert` undoes a drag. */
  private endGesture(commit: boolean, revert = false): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') {
      const graph = this.model.graph;
      const to = g.ids.map((id) => {
        const p = graph.getPoint(id);
        return { x: p?.x ?? 0, y: p?.y ?? 0 };
      });
      const moved = to.some((p, i) => {
        const f = g.from[i];
        return !f || p.x !== f.x || p.y !== f.y;
      });
      if (revert) {
        g.ids.forEach((id, i) => {
          const p = graph.getPoint(id);
          const f = g.from[i];
          if (p && f) graph.movePoint(p, f.x, f.y);
        });
      } else if (moved && commit) {
        this.history.push(new MovePointsCommand(this.model, g.ids, g.from, to), false);
      }
      if (g.ids.length === 1 && !this.state.selectedPointIds.size) this.selectPoint(g.anchorId);
      this.onDragState(false);
    } else if (g.kind === 'box' && commit && !revert) {
      this.applyBox(g.a, g.b);
    }
    this.refreshHover();
  }

  private applyBox(a: Vec2, b: Vec2): void {
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x, b.x);
    const maxY = Math.max(a.y, b.y);
    const g = this.model.graph;
    const pts = g.pointsInRect(minX, minY, maxX, maxY);
    const inside = new Set(pts.map((p) => p.id));
    this.state.selectedPointId = null;
    this.state.selectedPointIds = inside;
    this.state.selectedSegmentIds = new Set(
      g.segments.filter((s) => inside.has(s.a.id) && inside.has(s.b.id)).map((s) => s.id),
    );
    this.onSelectionChange();
  }
}
