/**
 * World generation pipeline: graph + settings + seed → derived geometry.
 *
 * ```
 *  segments ─▶ envelopes ─▶ union ─▶ road borders (collidable)
 *         ├──▶ half-width envelopes ─▶ union ─▶ lane guides
 *         ├──▶ inset envelopes ─▶ union ─▶ edge lines
 *         ├──▶ wide envelopes ─▶ union ─▶ sidewalks + curbs
 *         ├──▶ guide envelopes ─▶ union ─▶ supports ─▶ buildings
 *         └──▶ rejection sampling (roads + buildings illegal) ─▶ trees
 * ```
 *
 * Deterministic: the only randomness comes from an {@link Rng} seeded by the world seed,
 * forked per stage so stages do not disturb each other's sequences. The function is
 * pure (no DOM), so it runs identically in the main thread, a Web Worker and Vitest.
 *
 * @module engine/world/world
 */
import { SpatialHash } from '../graph/spatialHash.ts';
import { bboxOf, emptyBBox, unionBBox, type BBox } from '../math/bbox.ts';
import { Polygon, type Seg } from '../math/polygon.ts';
import { Rng } from '../math/rng.ts';
import type { Vec2 } from '../math/vec2.ts';
import type { WorldModel } from './worldModel.ts';
import { generateBuildings } from './buildings.ts';
import { laneGuides } from './laneGuides.ts';
import { centerLines, envelopes, oneWayArrows, resolveSegments, unionBorders } from './roads.ts';
import { generateTrees } from './trees.ts';
import type { GenerateOptions, WorldGeometryData, WorldInput } from './types.ts';

export * from './types.ts';

/** Snapshot of a model as plain data (structured-clone friendly). */
export function worldInputFrom(model: WorldModel): WorldInput {
  return {
    version: model.geometryVersion,
    points: model.graph.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    segments: model.graph.segments.map((s) => ({
      id: s.id,
      a: s.a.id,
      b: s.b.id,
      oneWay: s.oneWay,
      bridge: s.bridge,
      tunnel: s.tunnel,
    })),
    settings: { ...model.settings },
    seed: model.seed,
  };
}

/** Runs the full generation pipeline. */
export function generateWorld(input: WorldInput, opts: GenerateOptions = {}): WorldGeometryData {
  const timings: Record<string, number> = {};
  const now = opts.now;
  let t0 = now?.() ?? 0;
  const mark = (stage: string, fraction: number): void => {
    if (now) {
      const t = now();
      timings[stage] = t - t0;
      t0 = t;
    }
    opts.onProgress?.(fraction, stage);
  };
  const s = input.settings;
  const segs = resolveSegments(input);
  const rng = new Rng(input.seed);

  const roadPolys = envelopes(segs, s.roadWidth, s.roadRoundness);
  const roadBorders = unionBorders(segs, s.roadWidth, s.roadRoundness, (f) =>
    opts.onProgress?.(f * 0.25, 'roads'),
  );
  mark('roads', 0.25);
  const guides = laneGuides(segs, s.roadWidth, s.roadRoundness);
  mark('laneGuides', 0.35);
  const edgeLines = unionBorders(segs, s.roadWidth * 0.86, s.roadRoundness);
  const center = centerLines(segs, s.roadWidth);
  const arrows = oneWayArrows(segs, s.roadWidth);
  mark('markings', 0.45);
  const sidewalkWidth = s.roadWidth + s.sidewalkWidth * 2;
  const sidewalkPolys = s.sidewalkWidth > 0 ? envelopes(segs, sidewalkWidth, s.roadRoundness) : [];
  const curbs = s.sidewalkWidth > 0 ? unionBorders(segs, sidewalkWidth, s.roadRoundness) : [];
  mark('sidewalks', 0.6);
  const b = generateBuildings(segs, s, rng.fork('buildings'));
  mark('buildings', 0.85);
  const halfBand = s.roadWidth / 2 + s.sidewalkWidth;
  const trees = generateTrees(segs, halfBand, b.polygons, s, rng.fork('trees'));
  mark('trees', 1);

  let bounds: BBox = emptyBBox();
  for (const p of roadPolys) unionBBox(bounds, p.bbox);
  for (const p of b.polygons) unionBBox(bounds, p.bbox);
  for (const t of trees)
    unionBBox(bounds, {
      minX: t.x - t.radius,
      minY: t.y - t.radius,
      maxX: t.x + t.radius,
      maxY: t.y + t.radius,
    });
  if (bounds.minX > bounds.maxX) bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };

  return {
    version: input.version,
    seed: input.seed,
    roads: segs.map((sg, i) => ({
      segmentId: sg.id,
      points: plain((roadPolys[i] as Polygon).points),
    })),
    roadBorders,
    laneGuides: guides,
    edgeLines,
    centerLines: center,
    arrows,
    sidewalks: sidewalkPolys.map((p) => plain(p.points)),
    curbs,
    buildingGuides: b.guides,
    buildings: b.buildings,
    trees,
    bounds,
    timings,
  };
}

function plain(points: readonly Vec2[]): Vec2[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

/** Kind of a collidable segment in {@link WorldGeometry.collision}. */
export const COLLIDE_BORDER = 0;
export const COLLIDE_BUILDING = 1;
export const COLLIDE_TREE = 2;

/** Radius of a tree's collidable trunk base as a fraction of its canopy radius. */
export const TREE_BASE_FRACTION = 0.3;

/**
 * Hydrated geometry for the main thread: polygons, plus spatial indexes for rendering
 * (frustum culling) and simulation (sensors, damage). Built once per world version.
 */
export class WorldGeometry {
  readonly data: WorldGeometryData;
  readonly roadPolys: Polygon[];
  readonly buildingPolys: Polygon[];
  /** Flat collision segment arrays: [ax, ay, bx, by] per segment (cache friendly). */
  readonly collision: Float64Array;
  /** Kind of each collision segment (border, building, tree). */
  readonly collisionKind: Uint8Array;
  readonly collisionHash: SpatialHash;
  readonly buildingHash: SpatialHash;
  readonly treeHash: SpatialHash;

  constructor(data: WorldGeometryData) {
    this.data = data;
    this.roadPolys = data.roads.map((r) => new Polygon(r.points));
    this.buildingPolys = data.buildings.map((b) => new Polygon(b.base));
    const segs: Seg[] = [];
    const kinds: number[] = [];
    for (const s of data.roadBorders) {
      segs.push(s);
      kinds.push(COLLIDE_BORDER);
    }
    for (const p of this.buildingPolys) {
      for (const s of p.segments) {
        segs.push(s);
        kinds.push(COLLIDE_BUILDING);
      }
    }
    for (const t of data.trees) {
      const r = t.radius * TREE_BASE_FRACTION;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        segs.push({
          a: { x: t.x + Math.cos(a0) * r, y: t.y + Math.sin(a0) * r },
          b: { x: t.x + Math.cos(a1) * r, y: t.y + Math.sin(a1) * r },
        });
        kinds.push(COLLIDE_TREE);
      }
    }
    this.collision = new Float64Array(segs.length * 4);
    this.collisionKind = Uint8Array.from(kinds);
    this.collisionHash = new SpatialHash(120);
    segs.forEach((s, i) => {
      this.collision[i * 4] = s.a.x;
      this.collision[i * 4 + 1] = s.a.y;
      this.collision[i * 4 + 2] = s.b.x;
      this.collision[i * 4 + 3] = s.b.y;
      this.collisionHash.insert(i, bboxOf([s.a, s.b]));
    });
    this.buildingHash = new SpatialHash(250);
    this.buildingPolys.forEach((p, i) => this.buildingHash.insert(i, p.bbox));
    this.treeHash = new SpatialHash(250);
    data.trees.forEach((t, i) =>
      this.treeHash.insert(i, {
        minX: t.x - t.radius,
        minY: t.y - t.radius,
        maxX: t.x + t.radius,
        maxY: t.y + t.radius,
      }),
    );
  }

  get version(): number {
    return this.data.version;
  }

  /** Number of collidable segments. */
  get collisionCount(): number {
    return this.collisionKind.length;
  }
}
