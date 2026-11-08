/**
 * OpenStreetMap (Overpass JSON) → road graph (spec J4).
 *
 * - Ways are kept only if `highway` is in the drivable include-list.
 * - Nodes are projected with {@link makeProjection} centred on the data bounds and
 *   de-duplicated by node id, so shared nodes become graph junctions.
 * - One-way handling: `oneway=yes|true|1` keeps way order, `-1` reverses it, `no` is
 *   two-way (the course treated "no" as one-way), and `junction=roundabout` implies
 *   one-way unless `oneway=no`.
 * - Ways without tags or with unknown highway types are skipped, never crash.
 * - `bridge` / `tunnel` tags are carried onto segments (no buildings along them).
 * - `building=*` and `natural=water` / `waterway=riverbank` closed ways are collected
 *   as footprints and water polygons for the stretch feature (J6).
 *
 * The import is a generator so the app can spread large files over several frames
 * (spec J5): each `yield` reports progress.
 *
 * @module engine/osm/osmParse
 */
import type { Point } from '../graph/point.ts';
import type { Vec2 } from '../math/vec2.ts';
import { WorldModel } from '../world/worldModel.ts';
import { makeProjection, UNITS_PER_METER } from './projection.ts';

export const DRIVABLE_HIGHWAYS: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);

/** Sample Overpass query shown in the import dialog ({{bbox}} is filled by overpass-turbo). */
export const SAMPLE_OVERPASS_QUERY = `[out:json][timeout:25];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]({{bbox}});
(._;>;);
out body;`;

export interface OsmImportOptions {
  /** World units per metre (default 10). */
  unitsPerMeter?: number;
  /** Multiplies the default road width (0.5..1.5). */
  roadWidthScale?: number;
  /** When false, every road is imported as two-way. */
  includeOneWays?: boolean;
  /** World name. */
  name?: string;
  seed?: number;
}

export interface OsmStats {
  nodes: number;
  ways: number;
  highways: number;
  skipped: number;
  oneWay: number;
  bridges: number;
  tunnels: number;
  buildings: number;
  water: number;
}

export interface OsmResult {
  model: WorldModel;
  stats: OsmStats;
  /** Building footprints (world coordinates) from closed `building=*` ways. */
  buildings: Vec2[][];
  /** Water polygons from closed `natural=water` / `waterway=riverbank` ways. */
  water: Vec2[][];
  warnings: string[];
}

interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}

interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

/** Thrown for input that is not Overpass JSON at all. */
export class OsmFormatError extends Error {
  override name = 'OsmFormatError';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readElements(json: unknown): { nodes: OsmNode[]; ways: OsmWay[] } {
  if (!isRecord(json) || !Array.isArray(json.elements)) {
    throw new OsmFormatError(
      'Expected Overpass JSON with an "elements" array (use [out:json] and "out body;").',
    );
  }
  const nodes: OsmNode[] = [];
  const ways: OsmWay[] = [];
  for (const e of json.elements as unknown[]) {
    if (!isRecord(e)) continue;
    if (
      e.type === 'node' &&
      typeof e.id === 'number' &&
      typeof e.lat === 'number' &&
      typeof e.lon === 'number'
    ) {
      nodes.push({ type: 'node', id: e.id, lat: e.lat, lon: e.lon });
    } else if (e.type === 'way' && typeof e.id === 'number' && Array.isArray(e.nodes)) {
      const ids = (e.nodes as unknown[]).filter((n): n is number => typeof n === 'number');
      const tags = isRecord(e.tags)
        ? Object.fromEntries(
            Object.entries(e.tags).filter(
              (kv): kv is [string, string] => typeof kv[1] === 'string',
            ),
          )
        : undefined;
      ways.push(
        tags ? { type: 'way', id: e.id, nodes: ids, tags } : { type: 'way', id: e.id, nodes: ids },
      );
    }
  }
  return { nodes, ways };
}

/** One-way direction for a way: 1 forward, -1 reversed, 0 two-way. */
export function onewayDirection(tags: Readonly<Record<string, string>>): -1 | 0 | 1 {
  const v = (tags.oneway ?? '').toLowerCase();
  if (v === 'yes' || v === 'true' || v === '1') return 1;
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'no' || v === 'false' || v === '0') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway') return 1; // motorways are one-way by OSM convention
  return 0;
}

function truthyTag(v: string | undefined): boolean {
  return v !== undefined && v !== 'no' && v !== 'false' && v !== '0';
}

/**
 * Generator form of the import: yields progress fractions in [0, 1) and returns the
 * result. Drive it with `next()` until `done`.
 */
export function* importOsmSteps(
  json: unknown,
  opts: OsmImportOptions = {},
): Generator<number, OsmResult, void> {
  const { nodes, ways } = readElements(json);
  const warnings: string[] = [];
  const stats: OsmStats = {
    nodes: nodes.length,
    ways: ways.length,
    highways: 0,
    skipped: 0,
    oneWay: 0,
    bridges: 0,
    tunnels: 0,
    buildings: 0,
    water: 0,
  };
  if (nodes.length === 0)
    throw new OsmFormatError('No nodes found. Make sure the query ends with "(._;>;); out body;".');

  // projection centred on the bounding box of all nodes
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const n of nodes) {
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
  }
  const proj = makeProjection(
    (minLat + maxLat) / 2,
    (minLon + maxLon) / 2,
    opts.unitsPerMeter ?? UNITS_PER_METER,
  );
  const nodeById = new Map<number, OsmNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  yield 0.05;

  const model = new WorldModel({
    seed: opts.seed ?? 4242,
    meta: { name: opts.name ?? 'OSM import', createdAt: new Date(0).toISOString(), source: 'osm' },
    settings: { roadWidth: 100 * (opts.roadWidthScale ?? 1) },
  });
  const g = model.graph;
  const pointByNode = new Map<number, Point>();
  const pointFor = (id: number): Point | null => {
    const existing = pointByNode.get(id);
    if (existing) return existing;
    const n = nodeById.get(id);
    if (!n) return null;
    const p = proj.project(n.lat, n.lon);
    const pt = g.addPoint(p.x, p.y);
    pointByNode.set(id, pt);
    return pt;
  };
  const buildings: Vec2[][] = [];
  const water: Vec2[][] = [];
  const includeOneWays = opts.includeOneWays ?? true;

  for (let wi = 0; wi < ways.length; wi++) {
    const w = ways[wi] as OsmWay;
    const tags = w.tags;
    if (!tags) {
      stats.skipped++;
    } else if (tags.highway !== undefined && DRIVABLE_HIGHWAYS.has(tags.highway)) {
      stats.highways++;
      const dir = includeOneWays ? onewayDirection(tags) : 0;
      const bridge = truthyTag(tags.bridge);
      const tunnel = truthyTag(tags.tunnel);
      if (dir !== 0) stats.oneWay++;
      if (bridge) stats.bridges++;
      if (tunnel) stats.tunnels++;
      const ids = dir === -1 ? [...w.nodes].reverse() : w.nodes;
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = pointFor(ids[i] as number);
        const b = pointFor(ids[i + 1] as number);
        if (!a || !b) {
          warnings.push(`way ${w.id}: missing node`);
          continue;
        }
        g.addSegment(a, b, { oneWay: dir !== 0, bridge, tunnel });
      }
    } else if (
      truthyTag(tags.building) ||
      tags.natural === 'water' ||
      tags.waterway === 'riverbank'
    ) {
      const closed = w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1];
      if (closed) {
        const poly: Vec2[] = [];
        for (let i = 0; i + 1 < w.nodes.length; i++) {
          const n = nodeById.get(w.nodes[i] as number);
          if (n) poly.push(proj.project(n.lat, n.lon));
        }
        if (poly.length >= 3) {
          if (truthyTag(tags.building)) {
            buildings.push(poly);
            stats.buildings++;
          } else {
            water.push(poly);
            stats.water++;
          }
        }
      } else stats.skipped++;
    } else {
      stats.skipped++;
    }
    if (wi % 200 === 199) yield 0.05 + 0.9 * (wi / ways.length);
  }

  // drop isolated points left by skipped or degenerate segments
  for (const p of g.points) if (g.degree(p) === 0) g.removePoint(p);
  if (g.segmentCount === 0) warnings.push('No drivable roads found in this data.');
  // fixed footprints and water become part of the world (regenerated with it, J6)
  model.setFeatures({ buildings, water });
  return { model, stats, buildings, water, warnings };
}

/** Synchronous convenience wrapper around {@link importOsmSteps}. */
export function importOsm(json: unknown, opts: OsmImportOptions = {}): OsmResult {
  const it = importOsmSteps(json, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
