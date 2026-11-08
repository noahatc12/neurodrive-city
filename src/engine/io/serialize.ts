/**
 * World model ⇄ world file conversion.
 * @module engine/io/serialize
 */
import type { Point } from '../graph/point.ts';
import type { Segment } from '../graph/segment.ts';
import { bindingAt, markingSize, resolveMarking } from '../markings/marking.ts';
import { WorldModel } from '../world/worldModel.ts';
import { migrateWorld } from './migrate.ts';
import {
  WORLD_FORMAT,
  WORLD_VERSION,
  validateWorld,
  type MarkingRecord,
  type SegmentRecord,
  type Tuple2,
  type ValidationResult,
  type WorldFile,
} from './worldSchema.ts';

/** Camera state stored with a world: `offset` is the world point at the screen centre. */
export interface WorldView {
  zoom: number;
  offset: Tuple2;
}

/** Rounds to 3 decimals: sub-millimetre precision, much smaller files. */
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Serializes the source of truth of a world (no derived geometry). */
export function serializeWorld(model: WorldModel, view?: WorldView): WorldFile {
  const points = model.graph.points;
  const index = new Map<number, number>();
  points.forEach((p, i) => index.set(p.id, i));
  const segments: SegmentRecord[] = model.graph.segments.map((s) => {
    const rec: SegmentRecord = {
      a: index.get(s.a.id) ?? 0,
      b: index.get(s.b.id) ?? 0,
      oneWay: s.oneWay,
    };
    if (s.bridge) rec.bridge = true;
    if (s.tunnel) rec.tunnel = true;
    return rec;
  });
  const file: WorldFile = {
    format: WORLD_FORMAT,
    version: WORLD_VERSION,
    meta: {
      name: model.meta.name,
      createdAt: model.meta.createdAt,
      seed: model.seed,
      source: model.meta.source,
    },
    settings: { ...model.settings, units: '1 unit = 0.1 m' },
    graph: { points: points.map((p) => [r3(p.x), r3(p.y)]), segments },
    markings: serializeMarkings(model),
  };
  if (view) file.view = { zoom: view.zoom, offset: [r3(view.offset[0]), r3(view.offset[1])] };
  return file;
}

/** A world loaded from a file, plus non-fatal warnings (e.g. skipped duplicates). */
export interface LoadedWorld {
  model: WorldModel;
  view: WorldView | null;
  file: WorldFile;
  warnings: string[];
}

/**
 * Migrates, validates and builds a world from parsed JSON. Never throws for bad input:
 * returns `{ ok: false, errors }` with human-readable messages instead.
 */
export function parseWorld(json: unknown): ValidationResult<LoadedWorld> {
  const migrated = migrateWorld(json);
  const result = validateWorld(migrated);
  if (!result.ok) return result;
  const file = result.value;
  const model = new WorldModel({
    seed: file.meta.seed,
    settings: numericSettings(file.settings),
    meta: { name: file.meta.name, createdAt: file.meta.createdAt, source: file.meta.source },
  });
  const warnings: string[] = [];
  const pts: Point[] = file.graph.points.map(([x, y]) => model.graph.addPoint(x, y));
  const segByIndex: (Segment | null)[] = [];
  file.graph.segments.forEach((s, i) => {
    const a = pts[s.a];
    const b = pts[s.b];
    const seg =
      a && b
        ? model.graph.addSegment(a, b, {
            oneWay: s.oneWay,
            bridge: s.bridge === true,
            tunnel: s.tunnel === true,
          })
        : null;
    segByIndex.push(seg);
    if (!seg) warnings.push(`graph.segments[${i}] skipped (duplicate or zero length)`);
  });
  file.markings.forEach((rec, i) => {
    if (!loadMarking(model, rec, segByIndex))
      warnings.push(`markings[${i}] skipped (no road nearby)`);
  });
  return { ok: true, value: { model, view: file.view ?? null, file, warnings } };
}

/** Parses JSON text; syntax errors become a validation error, not an exception. */
export function parseWorldText(text: string): ValidationResult<LoadedWorld> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  return parseWorld(json);
}

function numericSettings(settings: Record<string, number | string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(settings)) if (typeof v === 'number') out[k] = v;
  return out;
}

function serializeMarkings(model: WorldModel): MarkingRecord[] {
  const segIndex = new Map<number, number>();
  model.graph.segments.forEach((s, i) => segIndex.set(s.id, i));
  const out: MarkingRecord[] = [];
  for (const m of model.markings.all()) {
    const r = resolveMarking(m, model.graph, model.settings.roadWidth);
    const seg = segIndex.get(m.binding.segmentId);
    if (!r || seg === undefined) continue;
    out.push({
      type: m.type,
      center: [r3(r.center.x), r3(r.center.y)],
      direction: [r3(r.direction.x), r3(r.direction.y)],
      width: r.width,
      height: r.height,
      props: {
        ...m.props,
        segment: seg,
        t: Math.round(m.binding.t * 1e6) / 1e6,
        side: m.binding.side,
      },
    });
  }
  return out;
}

/** Re-creates a marking from its record; falls back to snapping its centre onto a road. */
function loadMarking(
  model: WorldModel,
  rec: MarkingRecord,
  segByIndex: readonly (Segment | null)[],
): boolean {
  const { segment, t, side, ...rest } = rec.props;
  const seg = typeof segment === 'number' ? segByIndex[segment] : null;
  if (seg && typeof t === 'number' && (side === -1 || side === 0 || side === 1)) {
    model.markings.add(rec.type, { segmentId: seg.id, t: Math.min(1, Math.max(0, t)), side }, rest);
    return true;
  }
  const size = markingSize(rec.type, model.settings.roadWidth);
  const binding = bindingAt(
    model.graph,
    rec.type,
    { x: rec.center[0], y: rec.center[1] },
    size.width * 2,
  );
  if (!binding) return false;
  model.markings.add(rec.type, binding, rest);
  return true;
}
