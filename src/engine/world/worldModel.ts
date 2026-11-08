/**
 * The editable world document: road graph, generation settings, seed and metadata.
 * Derived geometry (borders, buildings, trees...) is never stored here; it is
 * regenerated from this model whenever {@link WorldModel.geometryVersion} changes.
 *
 * @module engine/world/worldModel
 */
import { Graph } from '../graph/graph.ts';
import { MarkingStore } from '../markings/marking.ts';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  settingsEqual,
  type WorldSettings,
} from './settings.ts';
import type { WorldFeatures } from './types.ts';

export type WorldSource = 'editor' | 'osm' | 'procedural';

export interface WorldMeta {
  name: string;
  createdAt: string;
  source: WorldSource;
}

export class WorldModel {
  readonly graph: Graph;
  /** Markings bound to graph segments (kept consistent through graph events). */
  readonly markings: MarkingStore;
  private _settings: WorldSettings;
  private _seed: number;
  meta: WorldMeta;
  private _geometryVersion = 0;
  private _features: WorldFeatures = { buildings: [], water: [] };

  constructor(
    options: { seed?: number; settings?: Partial<WorldSettings>; meta?: Partial<WorldMeta> } = {},
  ) {
    this.graph = new Graph();
    this.graph.onChange(() => {
      this._geometryVersion++;
    });
    this.markings = new MarkingStore(this.graph);
    this._settings = normalizeSettings(options.settings ?? DEFAULT_SETTINGS);
    this._seed = (options.seed ?? 12345) >>> 0;
    this.meta = {
      name: options.meta?.name ?? 'Untitled world',
      createdAt: options.meta?.createdAt ?? new Date(0).toISOString(),
      source: options.meta?.source ?? 'editor',
    };
  }

  get settings(): Readonly<WorldSettings> {
    return this._settings;
  }

  get seed(): number {
    return this._seed;
  }

  /**
   * Changes whenever anything that affects derived geometry changes: the graph,
   * the settings or the seed. Cheap integer compare for caches.
   */
  get geometryVersion(): number {
    return this._geometryVersion;
  }

  /** Merges and clamps new settings; bumps the version only if something changed. */
  setSettings(partial: Partial<WorldSettings>): void {
    const next = normalizeSettings({ ...this._settings, ...partial });
    if (settingsEqual(next, this._settings)) return;
    this._settings = next;
    this._geometryVersion++;
  }

  /** Sets the generation seed. */
  /** Imported OSM buildings and water (spec J6); empty for editor worlds. */
  get features(): Readonly<WorldFeatures> {
    return this._features;
  }

  /** Replaces the imported features (regenerates the world). */
  setFeatures(features: WorldFeatures): void {
    this._features = {
      buildings: features.buildings
        .filter((p) => p.length >= 3)
        .map((p) => p.map((v) => ({ x: v.x, y: v.y }))),
      water: features.water
        .filter((p) => p.length >= 3)
        .map((p) => p.map((v) => ({ x: v.x, y: v.y }))),
    };
    this._geometryVersion++;
  }

  setSeed(seed: number): void {
    const s = seed >>> 0;
    if (s === this._seed) return;
    this._seed = s;
    this._geometryVersion++;
  }
}
