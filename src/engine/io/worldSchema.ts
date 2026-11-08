/**
 * Versioned world file format (`*.world.json`) and its hand-written validator.
 *
 * Only the source of truth is stored: graph, markings, settings, seed and view.
 * Borders, buildings, trees and lane guides are regenerated deterministically, which
 * keeps files small (a 472-segment town is tens of kilobytes, not megabytes).
 *
 * @module engine/io/worldSchema
 */

export const WORLD_FORMAT = 'neurodrive.world';
export const WORLD_VERSION = 1;

export const MARKING_TYPES = [
  'stop',
  'yield',
  'crossing',
  'parking',
  'light',
  'start',
  'target',
] as const;
export type MarkingType = (typeof MARKING_TYPES)[number];

export type Tuple2 = [number, number];

export interface SegmentRecord {
  a: number;
  b: number;
  oneWay: boolean;
  bridge?: boolean;
  tunnel?: boolean;
}

export interface MarkingRecord {
  type: MarkingType;
  center: Tuple2;
  direction: Tuple2;
  width: number;
  height: number;
  /** Binding and type-specific data, e.g. `{ segment: 3, t: 0.5, side: 1 }`. */
  props: Record<string, unknown>;
}

export interface WorldFile {
  format: typeof WORLD_FORMAT;
  version: number;
  meta: { name: string; createdAt: string; seed: number; source: 'editor' | 'osm' | 'procedural' };
  settings: Record<string, number | string>;
  graph: { points: Tuple2[]; segments: SegmentRecord[] };
  markings: MarkingRecord[];
  view?: { zoom: number; offset: Tuple2 };
  /** Imported OSM building footprints and water polygons (spec J6). */
  features?: { buildings: Tuple2[][]; water: Tuple2[][] };
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isTuple2(v: unknown): v is Tuple2 {
  return Array.isArray(v) && v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1]);
}

/**
 * Validates an already-migrated object as a {@link WorldFile}. Errors name the exact
 * path (e.g. `graph.segments[3].b: point index 99 out of range`) and are capped at 20.
 */
export function validateWorld(input: unknown): ValidationResult<WorldFile> {
  const errors: string[] = [];
  const err = (msg: string): void => {
    if (errors.length < 20) errors.push(msg);
  };
  if (!isObject(input)) return { ok: false, errors: ['file is not a JSON object'] };
  if (input.format !== WORLD_FORMAT) err(`format: expected "${WORLD_FORMAT}"`);
  if (input.version !== WORLD_VERSION)
    err(`version: expected ${WORLD_VERSION}, got ${String(input.version)}`);

  const meta = input.meta;
  if (!isObject(meta)) err('meta: missing object');
  else {
    if (typeof meta.name !== 'string') err('meta.name: expected string');
    if (typeof meta.createdAt !== 'string') err('meta.createdAt: expected ISO string');
    if (!isFiniteNumber(meta.seed)) err('meta.seed: expected number');
    if (meta.source !== 'editor' && meta.source !== 'osm' && meta.source !== 'procedural') {
      err('meta.source: expected "editor", "osm" or "procedural"');
    }
  }

  if (!isObject(input.settings)) err('settings: missing object');

  const graph = input.graph;
  let pointCount = 0;
  let segmentCount = 0;
  if (!isObject(graph)) err('graph: missing object');
  else {
    if (!Array.isArray(graph.points)) err('graph.points: expected array');
    else {
      pointCount = graph.points.length;
      graph.points.forEach((p, i) => {
        if (!isTuple2(p)) err(`graph.points[${i}]: expected [x, y] numbers`);
      });
    }
    if (!Array.isArray(graph.segments)) err('graph.segments: expected array');
    else {
      segmentCount = graph.segments.length;
      graph.segments.forEach((s, i) => {
        if (!isObject(s)) return err(`graph.segments[${i}]: expected object`);
        for (const end of ['a', 'b'] as const) {
          const idx = s[end];
          if (!Number.isInteger(idx)) err(`graph.segments[${i}].${end}: expected integer index`);
          else if ((idx as number) < 0 || (idx as number) >= pointCount) {
            err(`graph.segments[${i}].${end}: point index ${String(idx)} out of range`);
          }
        }
        if (s.a === s.b) err(`graph.segments[${i}]: a and b are the same point`);
        if (typeof s.oneWay !== 'boolean') err(`graph.segments[${i}].oneWay: expected boolean`);
      });
    }
  }

  if (!Array.isArray(input.markings)) err('markings: expected array');
  else {
    input.markings.forEach((m, i) => {
      if (!isObject(m)) return err(`markings[${i}]: expected object`);
      if (!MARKING_TYPES.includes(m.type as MarkingType))
        err(`markings[${i}].type: unknown "${String(m.type)}"`);
      if (!isTuple2(m.center)) err(`markings[${i}].center: expected [x, y]`);
      if (!isTuple2(m.direction)) err(`markings[${i}].direction: expected [dx, dy]`);
      if (!isFiniteNumber(m.width) || !isFiniteNumber(m.height))
        err(`markings[${i}]: width/height must be numbers`);
      if (!isObject(m.props)) err(`markings[${i}].props: expected object`);
      else if (m.props.segment !== undefined) {
        const seg = m.props.segment;
        if (!Number.isInteger(seg) || (seg as number) < 0 || (seg as number) >= segmentCount) {
          err(`markings[${i}].props.segment: segment index ${JSON.stringify(seg)} out of range`);
        }
      }
    });
  }

  if (input.features !== undefined) {
    const f = input.features;
    const rings = (v: unknown): boolean =>
      Array.isArray(v) && v.every((r) => Array.isArray(r) && r.length >= 3 && r.every(isTuple2));
    if (!isObject(f) || !rings(f.buildings) || !rings(f.water)) {
      err('features: expected { buildings: [[x, y], ...][], water: [[x, y], ...][] }');
    }
  }

  if (input.view !== undefined) {
    const view = input.view;
    if (!isObject(view) || !isFiniteNumber(view.zoom) || !isTuple2(view.offset)) {
      err('view: expected { zoom: number, offset: [x, y] }');
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as WorldFile };
}
