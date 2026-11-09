/**
 * Collision world (spec E3): everything a car can hit or sense.
 *
 * - static segments from the world geometry (road borders, building edges, tree bases),
 *   looked up through the geometry's spatial hash (broad phase) then tested exactly;
 * - extra segments supplied by a mode (the infinite road's borders);
 * - dynamic obstacles: traffic cars (and population cars when car-car collisions are on),
 *   refreshed every step into preallocated typed arrays with bounding boxes.
 *
 * Damage = the car polygon intersects anything in the collidable set. The same set is
 * what sensor rays see, so the network is never blind to something that kills it.
 *
 * @module engine/car/damage
 */
import { raySegmentOffset, segmentIntersectionInto, type Intersection } from '../math/intersect.ts';
import {
  COLLIDE_BORDER,
  COLLIDE_BUILDING,
  COLLIDE_TREE,
  type WorldGeometry,
} from '../world/world.ts';
import type { Car } from './car.ts';

export const HIT_NONE = -1;
export const HIT_BORDER = COLLIDE_BORDER;
export const HIT_BUILDING = COLLIDE_BUILDING;
export const HIT_TREE = COLLIDE_TREE;
export const HIT_CAR = 3;

export interface CollisionFlags {
  /** Buildings are collidable (default on). */
  buildings: boolean;
  /** Tree bases are collidable (default on). */
  trees: boolean;
}

/** Result of a ray cast (reused object). */
export interface RayHit {
  /** Offset along the ray in [0, 1]; 1 when nothing is hit. */
  offset: number;
  /** What was hit (HIT_* constant). */
  kind: number;
  /** Id of the car hit, or -1. */
  carId: number;
}

export class CollisionWorld {
  geometry: WorldGeometry | null = null;
  flags: CollisionFlags = { buildings: true, trees: true };
  /** Extra segments [ax, ay, bx, by] (e.g. infinite road borders); count in `extraCount`. */
  extra = new Float64Array(0);
  extraCount = 0;
  private cap = 0;
  dynCount = 0;
  private dynIds = new Int32Array(0);
  private dynBoxes = new Float64Array(0);
  private dynPolys = new Float64Array(0);
  private readonly scratch: number[] = [];
  private readonly hit: RayHit = { offset: 1, kind: HIT_NONE, carId: -1 };
  private readonly isect: Intersection = { x: 0, y: 0, offset: 0, u: 0 };

  /** Id of the car the last {@link polygonHit} returning HIT_CAR touched (−1 before any). */
  lastHitCarId = -1;

  /** True when car `id` is in the dynamic set (a real road user others can see and hit). */
  hasDynamic(id: number): boolean {
    for (let d = 0; d < this.dynCount; d++) if (this.dynIds[d] === id) return true;
    return false;
  }

  /** Replaces the dynamic obstacle set with the given cars (copied, allocation-free once warm). */
  setDynamic(cars: readonly Car[], count: number, include: (c: Car) => boolean): void {
    if (count > this.cap) this.grow(count);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const c = cars[i];
      if (!c || !c.active || !include(c)) continue;
      const p = c.polygon;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < 8; k += 2) {
        const x = p[k] as number;
        const y = p[k + 1] as number;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        this.dynPolys[n * 8 + k] = x;
        this.dynPolys[n * 8 + k + 1] = y;
      }
      this.dynIds[n] = c.id;
      this.dynBoxes[n * 4] = minX;
      this.dynBoxes[n * 4 + 1] = minY;
      this.dynBoxes[n * 4 + 2] = maxX;
      this.dynBoxes[n * 4 + 3] = maxY;
      n++;
    }
    this.dynCount = n;
  }

  private grow(n: number): void {
    this.cap = Math.max(n, this.cap * 2, 16);
    this.dynIds = new Int32Array(this.cap);
    this.dynBoxes = new Float64Array(this.cap * 4);
    this.dynPolys = new Float64Array(this.cap * 8);
  }

  private kindEnabled(kind: number): boolean {
    if (kind === COLLIDE_BUILDING) return this.flags.buildings;
    if (kind === COLLIDE_TREE) return this.flags.trees;
    return true;
  }

  /**
   * Returns the kind of the first thing the polygon touches (HIT_NONE if clear).
   * `selfId` excludes the car's own entry from the dynamic set.
   */
  polygonHit(poly: Float64Array, selfId: number): number {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      const x = poly[k] as number;
      const y = poly[k + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const geo = this.geometry;
    if (geo) {
      const segs = geo.collision;
      const kinds = geo.collisionKind;
      geo.collisionHash.queryRect(minX, minY, maxX, maxY, this.scratch);
      for (let n = 0; n < this.scratch.length; n++) {
        const i = this.scratch[n] as number;
        const kind = kinds[i] as number;
        if (!this.kindEnabled(kind)) continue;
        if (
          this.polyTouchesSeg(
            poly,
            segs[i * 4] as number,
            segs[i * 4 + 1] as number,
            segs[i * 4 + 2] as number,
            segs[i * 4 + 3] as number,
          )
        ) {
          return kind;
        }
      }
    }
    for (let i = 0; i < this.extraCount; i++) {
      const e = this.extra;
      const ax = e[i * 4] as number;
      const ay = e[i * 4 + 1] as number;
      const bx = e[i * 4 + 2] as number;
      const by = e[i * 4 + 3] as number;
      if (
        Math.min(ax, bx) > maxX ||
        Math.max(ax, bx) < minX ||
        Math.min(ay, by) > maxY ||
        Math.max(ay, by) < minY
      )
        continue;
      if (
        this.polyTouchesSeg(
          poly,
          e[i * 4] as number,
          e[i * 4 + 1] as number,
          e[i * 4 + 2] as number,
          e[i * 4 + 3] as number,
        )
      ) {
        return HIT_BORDER;
      }
    }
    for (let d = 0; d < this.dynCount; d++) {
      if (this.dynIds[d] === selfId) continue;
      const b = this.dynBoxes;
      if (
        (b[d * 4] as number) > maxX ||
        (b[d * 4 + 2] as number) < minX ||
        (b[d * 4 + 1] as number) > maxY ||
        (b[d * 4 + 3] as number) < minY
      )
        continue;
      const q = this.dynPolys;
      const o = d * 8;
      for (let k = 0; k < 8; k += 2) {
        const k2 = (k + 2) % 8;
        if (
          this.polyTouchesSeg(
            poly,
            q[o + k] as number,
            q[o + k + 1] as number,
            q[o + k2] as number,
            q[o + k2 + 1] as number,
          )
        ) {
          this.lastHitCarId = this.dynIds[d] as number;
          return HIT_CAR;
        }
      }
    }
    return HIT_NONE;
  }

  private polyTouchesSeg(
    poly: Float64Array,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): boolean {
    for (let k = 0; k < 8; k += 2) {
      const k2 = (k + 2) % 8;
      if (
        segmentIntersectionInto(
          this.isect,
          poly[k] as number,
          poly[k + 1] as number,
          poly[k2] as number,
          poly[k2 + 1] as number,
          ax,
          ay,
          bx,
          by,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Casts a ray from (ox, oy) to (ex, ey) and returns the closest hit (reused object).
   * @param includeCars whether dynamic cars are visible to this ray
   */
  castRay(
    ox: number,
    oy: number,
    ex: number,
    ey: number,
    selfId: number,
    includeCars: boolean,
  ): RayHit {
    const hit = this.hit;
    hit.offset = 1;
    hit.kind = HIT_NONE;
    hit.carId = -1;
    const minX = ox < ex ? ox : ex;
    const maxX = ox < ex ? ex : ox;
    const minY = oy < ey ? oy : ey;
    const maxY = oy < ey ? ey : oy;
    const geo = this.geometry;
    if (geo) {
      const segs = geo.collision;
      const kinds = geo.collisionKind;
      geo.collisionHash.queryRect(minX, minY, maxX, maxY, this.scratch);
      for (let n = 0; n < this.scratch.length; n++) {
        const i = this.scratch[n] as number;
        const kind = kinds[i] as number;
        if (!this.kindEnabled(kind)) continue;
        const t = raySegmentOffset(
          ox,
          oy,
          ex,
          ey,
          segs[i * 4] as number,
          segs[i * 4 + 1] as number,
          segs[i * 4 + 2] as number,
          segs[i * 4 + 3] as number,
        );
        if (t >= 0 && t < hit.offset) {
          hit.offset = t;
          hit.kind = kind;
        }
      }
    }
    const e = this.extra;
    for (let i = 0; i < this.extraCount; i++) {
      const ax = e[i * 4] as number;
      const ay = e[i * 4 + 1] as number;
      const bx = e[i * 4 + 2] as number;
      const by = e[i * 4 + 3] as number;
      if (
        Math.min(ax, bx) > maxX ||
        Math.max(ax, bx) < minX ||
        Math.min(ay, by) > maxY ||
        Math.max(ay, by) < minY
      )
        continue;
      const t = raySegmentOffset(
        ox,
        oy,
        ex,
        ey,
        e[i * 4] as number,
        e[i * 4 + 1] as number,
        e[i * 4 + 2] as number,
        e[i * 4 + 3] as number,
      );
      if (t >= 0 && t < hit.offset) {
        hit.offset = t;
        hit.kind = HIT_BORDER;
      }
    }
    if (includeCars) {
      const b = this.dynBoxes;
      const q = this.dynPolys;
      for (let d = 0; d < this.dynCount; d++) {
        if (this.dynIds[d] === selfId) continue;
        if (
          (b[d * 4] as number) > maxX ||
          (b[d * 4 + 2] as number) < minX ||
          (b[d * 4 + 1] as number) > maxY ||
          (b[d * 4 + 3] as number) < minY
        )
          continue;
        const o = d * 8;
        for (let k = 0; k < 8; k += 2) {
          const k2 = (k + 2) % 8;
          const t = raySegmentOffset(
            ox,
            oy,
            ex,
            ey,
            q[o + k] as number,
            q[o + k + 1] as number,
            q[o + k2] as number,
            q[o + k2 + 1] as number,
          );
          if (t >= 0 && t < hit.offset) {
            hit.offset = t;
            hit.kind = HIT_CAR;
            hit.carId = this.dynIds[d] as number;
          }
        }
      }
    }
    return hit;
  }
}
