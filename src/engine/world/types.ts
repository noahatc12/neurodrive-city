/**
 * Plain-data types for world generation. Everything here survives structured clone
 * (Web Worker transfer) and JSON, so the same generator runs in the main thread, a
 * worker and Vitest.
 * @module engine/world/types
 */
import type { BBox } from '../math/bbox.ts';
import type { Seg } from '../math/polygon.ts';
import type { Vec2 } from '../math/vec2.ts';
import type { WorldSettings } from './settings.ts';

/** Input snapshot of a world model (graph + settings + seed). */
/** Fixed map features imported from OSM (spec J6), in world coordinates. */
export interface WorldFeatures {
  /** Building footprints (closed rings without the repeated first point). */
  buildings: Vec2[][];
  /** Water polygons (rivers, lakes). */
  water: Vec2[][];
}

export interface WorldInput {
  /** The model's geometry version this input was taken at. */
  version: number;
  points: { id: number; x: number; y: number }[];
  segments: {
    id: number;
    a: number;
    b: number;
    oneWay: boolean;
    bridge: boolean;
    tunnel: boolean;
  }[];
  settings: WorldSettings;
  seed: number;
  /** Imported OSM buildings and water (absent for editor and procedural worlds). */
  features?: WorldFeatures;
}

export type RoofKind = 'flat' | 'pitched';

export interface BuildingData {
  /** Four footprint corners. */
  base: Vec2[];
  center: Vec2;
  /** Direction of the long side (atan2 convention). */
  angle: number;
  length: number;
  depth: number;
  height: number;
  roof: RoofKind;
  /** 0..1 colour variation. */
  tint: number;
  /** Seed for per-building details (lit windows at night). */
  detailSeed: number;
  /** True for an imported OSM footprint (any polygon; extruded rather than a box). */
  osm?: true;
}

export type TreeSpecies = 0 | 1 | 2; // 0 broadleaf, 1 conifer, 2 bush

export interface TreeData {
  x: number;
  y: number;
  /** Canopy radius (units). */
  radius: number;
  height: number;
  species: TreeSpecies;
  tint: number;
  /**
   * Canopy shape cached at generation: radius factors for each level × each angle step
   * (`TREE_LEVELS × TREE_STEPS` values). Renderers never recompute noise per frame.
   */
  canopy: Float32Array;
}

export const TREE_LEVELS = 6;
export const TREE_STEPS = 14;

export interface ArrowData {
  x: number;
  y: number;
  /** Travel direction (atan2 convention). */
  angle: number;
}

/** Derived geometry: regenerated from a {@link WorldInput}, never saved. */
export interface WorldGeometryData {
  version: number;
  seed: number;
  /** Road surface polygons (one envelope per segment). */
  roads: { segmentId: number; points: Vec2[] }[];
  /** Outer borders of the unioned road surface (collidable). */
  roadBorders: Seg[];
  /** Lane centre lines (union of half-width envelopes). */
  laneGuides: Seg[];
  /** Solid edge lines just inside the road border. */
  edgeLines: Seg[];
  /** Dashed centre-line pieces (trimmed at junctions). */
  centerLines: Seg[];
  /** Direction arrows on one-way segments. */
  arrows: ArrowData[];
  /** Sidewalk band polygons (wider envelopes; the road is drawn on top). */
  sidewalks: Vec2[][];
  /** Outer curb lines of the sidewalk union. */
  curbs: Seg[];
  /** Building guide border (debug layer). */
  buildingGuides: Seg[];
  buildings: BuildingData[];
  /** Water polygons (from OSM features). */
  water: Vec2[][];
  trees: TreeData[];
  bounds: BBox;
  /** Milliseconds per stage when a clock was provided. */
  timings: Record<string, number>;
}

/** Options for the generator. */
export interface GenerateOptions {
  /** Progress callback with a fraction in [0, 1] and the current stage name. */
  onProgress?: (fraction: number, stage: string) => void;
  /** Clock in milliseconds (performance.now in browsers); enables timings. */
  now?: () => number;
}
