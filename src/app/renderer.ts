/**
 * The contract every renderer implements. Renderers read a per-frame snapshot and
 * never mutate engine state.
 * @module app/renderer
 */
import type { Vec2 } from '../engine/math/vec2.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import type { WorldGeometry } from '../engine/world/world.ts';
import type { TrafficLightSystem } from '../engine/markings/trafficLightController.ts';
import type { Simulation } from '../engine/sim/simulation.ts';
import type { Sensor } from '../engine/car/sensor.ts';
import type { LanePath } from '../engine/nav/lanePath.ts';
import type { MarkingType } from '../engine/markings/marking.ts';
import type { Side } from '../engine/markings/marking.ts';

export type CameraMode = '2d-pan' | 'chase' | 'orbit' | 'cinematic' | 'top';
export type AppMode = 'edit' | 'simulate' | 'train';
export type ToolId =
  'graph' | 'erase' | 'stop' | 'yield' | 'crossing' | 'parking' | 'light' | 'start' | 'target';

export interface PickResult {
  kind: 'car' | 'marking' | 'point' | 'segment' | 'ground';
  id: number | null;
  world: Vec2;
}

/** Visibility toggles (spec B9). */
export interface LayerFlags {
  roads: boolean;
  laneMarkings: boolean;
  sidewalks: boolean;
  buildings: boolean;
  trees: boolean;
  markings: boolean;
  minimap: boolean;
  debugBorders: boolean;
  debugLaneGuides: boolean;
  debugBuildingGuides: boolean;
  debugHashCells: boolean;
  debugCarPolygons: boolean;
  debugSensors: boolean;
}

export const DEFAULT_LAYERS: Readonly<LayerFlags> = Object.freeze({
  roads: true,
  laneMarkings: true,
  sidewalks: true,
  buildings: true,
  trees: true,
  markings: true,
  minimap: true,
  debugBorders: false,
  debugLaneGuides: false,
  debugBuildingGuides: false,
  debugHashCells: false,
  debugCarPolygons: false,
  debugSensors: false,
});

/** Editor state the renderer draws as an overlay (read-only for the renderer). */
export interface EditorOverlay {
  tool: ToolId;
  hoverPointId: number | null;
  selectedPointId: number | null;
  selectedPointIds: ReadonlySet<number>;
  hoverSegmentId: number | null;
  selectedSegmentIds: ReadonlySet<number>;
  hoverMarkingId: number | null;
  mouseWorld: Vec2 | null;
  /** Rubber band from the selected point to the (snapped) cursor. */
  rubberBand: { from: Vec2; to: Vec2 } | null;
  snap: { kind: 'grid' | 'point'; x: number; y: number; sinceMs: number } | null;
  boxSelect: { a: Vec2; b: Vec2 } | null;
  /** Ghost of the marking that would be placed by a marking tool. */
  markingPreview: { type: MarkingType; segmentId: number; t: number; side: Side } | null;
  gridEnabled: boolean;
  gridSize: number;
  dragging: boolean;
}

/** Per-frame snapshot handed to renderers. */
export interface FrameContext {
  model: WorldModel;
  /** Derived geometry (may be one version behind while regenerating). */
  geometry: WorldGeometry | null;
  /** True when `geometry` is older than the model. */
  geometryStale: boolean;
  /** Segments being dragged: drawn as a cheap preview over stale geometry. */
  previewSegmentIds: ReadonlySet<number> | null;
  /** Traffic light controllers (lamp states for rendering). */
  lights: TrafficLightSystem | null;
  /** Running simulation (null in Edit mode). */
  sim: Simulation | null;
  /** Best car of the current generation (Phase 6), for highlighting. */
  bestCarId: number | null;
  /** Sensor of the focused car (drawn with glow). */
  focusSensor: Sensor | null;
  /** Additional sensors to draw (the "all rays" debug toggle). */
  extraSensors: readonly Sensor[];
  /** Route to highlight: a lane path and the arc range to draw. */
  route: { path: LanePath; from: number; to: number } | null;
  mode: AppMode;
  editor: EditorOverlay | null;
  layers: Readonly<LayerFlags>;
  /** Fixed-step interpolation factor in [0, 1). */
  alpha: number;
  timeMs: number;
  dtMs: number;
  focusCarId: number | null;
  reducedMotion: boolean;
}

export interface Renderer {
  readonly kind: '2d' | '3d';
  mount(container: HTMLElement): void;
  resize(width: number, height: number, dpr: number): void;
  render(frame: FrameContext): void;
  setCameraMode(mode: CameraMode): void;
  pick(screenX: number, screenY: number): PickResult | null;
  dispose(): void;
}
