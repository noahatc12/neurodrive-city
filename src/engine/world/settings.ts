/**
 * World generation settings. Defaults match the course's constants so the city feels
 * the same before this build goes further. Units: 1 world unit ≈ 0.1 m.
 *
 * @module engine/world/settings
 */

export interface WorldSettings {
  /** Road width (units). Lane centres sit at ±roadWidth/4 from the centre line. */
  roadWidth: number;
  /** Vertices per half-circle cap of a road envelope (rounded ends). */
  roadRoundness: number;
  /** Building footprint depth, perpendicular to the road (units). */
  buildingWidth: number;
  /** Minimum building length along the road (units). */
  buildingMinLength: number;
  /** Gap between road edge and buildings, and between buildings (units). */
  spacing: number;
  /** Tree canopy diameter (units). */
  treeSize: number;
  /** Tree count multiplier (0 = no trees, 1 = default density, 2 = dense). */
  treeDensity: number;
  /** Sidewalk band width outside the road edge (units). */
  sidewalkWidth: number;
}

export const DEFAULT_SETTINGS: Readonly<WorldSettings> = Object.freeze({
  roadWidth: 100,
  roadRoundness: 10,
  buildingWidth: 150,
  buildingMinLength: 150,
  spacing: 50,
  treeSize: 160,
  treeDensity: 1,
  sidewalkWidth: 16,
});

/** Slider ranges used by the settings panel and by validation. */
export const SETTINGS_LIMITS: Readonly<Record<keyof WorldSettings, readonly [number, number]>> =
  Object.freeze({
    roadWidth: [40, 200],
    roadRoundness: [1, 24],
    buildingWidth: [60, 300],
    buildingMinLength: [60, 400],
    spacing: [10, 150],
    treeSize: [60, 300],
    treeDensity: [0, 2],
    sidewalkWidth: [0, 40],
  });

/** Returns complete settings: defaults overridden by valid, clamped values from `partial`. */
export function normalizeSettings(
  partial: Partial<Record<keyof WorldSettings, unknown>>,
): WorldSettings {
  const out: WorldSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof WorldSettings)[]) {
    const v = partial[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = SETTINGS_LIMITS[key];
      out[key] = Math.min(hi, Math.max(lo, v));
    }
  }
  out.roadRoundness = Math.round(out.roadRoundness);
  return out;
}

/** True when every generation-relevant field is equal. */
export function settingsEqual(a: WorldSettings, b: WorldSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof WorldSettings)[]).every((k) => a[k] === b[k]);
}
