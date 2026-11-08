/**
 * World file migrations. Each step upgrades version N to N+1; `migrateWorld` applies
 * them in order before validation, so old files keep loading as the format evolves.
 *
 * @module engine/io/migrate
 */
import { WORLD_FORMAT, WORLD_VERSION } from './worldSchema.ts';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Version 0 was the pre-release editor format: points as `{x, y}` objects, segments as
 * `{p1, p2}` index pairs, no markings array and the seed at the top level.
 */
function v0to1(file: Json): Json {
  const graph = isObject(file.graph) ? file.graph : {};
  const points = Array.isArray(graph.points)
    ? graph.points.map((p: unknown) => (isObject(p) ? [p.x, p.y] : p))
    : [];
  const segments = Array.isArray(graph.segments)
    ? graph.segments.map((s: unknown) =>
        isObject(s) && 'p1' in s ? { a: s.p1, b: s.p2, oneWay: s.oneWay === true } : s,
      )
    : [];
  const meta = isObject(file.meta) ? file.meta : {};
  return {
    ...file,
    format: WORLD_FORMAT,
    version: 1,
    meta: {
      name: typeof meta.name === 'string' ? meta.name : 'Migrated world',
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : new Date(0).toISOString(),
      seed:
        typeof file.seed === 'number' ? file.seed : typeof meta.seed === 'number' ? meta.seed : 1,
      source: 'editor',
    },
    settings: isObject(file.settings) ? file.settings : {},
    graph: { points, segments },
    markings: Array.isArray(file.markings) ? file.markings : [],
  };
}

const STEPS: Record<number, (f: Json) => Json> = { 0: v0to1 };

/**
 * Upgrades `input` to {@link WORLD_VERSION}. Unknown shapes are returned unchanged so the
 * validator can report precise errors. Files from a newer app version are not touched.
 */
export function migrateWorld(input: unknown): unknown {
  if (!isObject(input)) return input;
  let file: Json = input;
  let version = typeof file.version === 'number' ? file.version : 0;
  if (version === 0 && file.format !== undefined && file.format !== WORLD_FORMAT) return input;
  while (version < WORLD_VERSION) {
    const step = STEPS[version];
    if (!step) break;
    file = step(file);
    version = typeof file.version === 'number' ? file.version : version + 1;
  }
  return file;
}
