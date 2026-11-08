/**
 * Uniform-grid spatial hash for anything with a bounding box (segments, polygons,
 * points). Items are integer ids; the caller owns the id → object mapping.
 *
 * ```
 *   cell size = s           item bbox
 *   +-----+-----+-----+     +-----------+
 *   |     |  ■  |  ■  |  ←  | inserted  |  into every cell it overlaps
 *   +-----+-----+-----+     +-----------+
 *   |     |  ■  |  ■  |
 *   +-----+-----+-----+
 * ```
 *
 * Supports incremental insert / update / remove, so editing one road does not rebuild
 * the whole index. Queries de-duplicate ids with a stamp array instead of a Set, so a
 * query with a caller-provided output array allocates nothing.
 *
 * @module engine/graph/spatialHash
 */
import type { BBox } from '../math/bbox.ts';

const OFFSET = 1 << 20; // supports cell coordinates in [-1 048 576, 1 048 575]
const SPAN = 1 << 21;

/** Packs integer cell coordinates into one safe integer key. */
function cellKey(cx: number, cy: number): number {
  return (cx + OFFSET) * SPAN + (cy + OFFSET);
}

export class SpatialHash {
  /** Side length of a grid cell, in world units. */
  readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();
  private readonly itemCells = new Map<number, number[]>();
  private stamps = new Uint32Array(64);
  private stamp = 0;

  /** @param cellSize grid cell size in world units (> 0) */
  constructor(cellSize: number) {
    if (!(cellSize > 0)) throw new Error('SpatialHash cellSize must be > 0');
    this.cellSize = cellSize;
  }

  /** Number of items in the index. */
  get size(): number {
    return this.itemCells.size;
  }

  /** True if `id` is indexed. */
  has(id: number): boolean {
    return this.itemCells.has(id);
  }

  /** Inserts `id` covering `bbox`. Re-inserting an existing id updates it. */
  insert(id: number, bbox: BBox): void {
    if (this.itemCells.has(id)) this.remove(id);
    const keys: number[] = [];
    const x0 = Math.floor(bbox.minX / this.cellSize);
    const y0 = Math.floor(bbox.minY / this.cellSize);
    const x1 = Math.floor(bbox.maxX / this.cellSize);
    const y1 = Math.floor(bbox.maxY / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(id);
        keys.push(key);
      }
    }
    this.itemCells.set(id, keys);
  }

  /** Moves `id` to a new bounding box (alias of insert, named for intent). */
  update(id: number, bbox: BBox): void {
    this.insert(id, bbox);
  }

  /** Removes `id`; returns false if it was not indexed. */
  remove(id: number): boolean {
    const keys = this.itemCells.get(id);
    if (!keys) return false;
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      const i = cell.indexOf(id);
      if (i >= 0) {
        cell[i] = cell[cell.length - 1] as number;
        cell.pop();
      }
      if (cell.length === 0) this.cells.delete(key);
    }
    this.itemCells.delete(id);
    return true;
  }

  /** Removes everything. */
  clear(): void {
    this.cells.clear();
    this.itemCells.clear();
  }

  /**
   * Collects the ids of all items whose cells overlap `bbox` (a superset of the items
   * whose boxes overlap it; callers do the exact test). Results are appended to a
   * cleared `out` array, which is returned.
   */
  query(bbox: BBox, out: number[] = []): number[] {
    return this.queryRect(bbox.minX, bbox.minY, bbox.maxX, bbox.maxY, out);
  }

  /** Same as {@link query} with explicit coordinates (no bbox object needed). */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: number[] = []): number[] {
    out.length = 0;
    const stamp = this.nextStamp();
    const x0 = Math.floor(minX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(cellKey(cx, cy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i] as number;
          this.ensureStampCapacity(id);
          if (this.stamps[id] === stamp) continue;
          this.stamps[id] = stamp;
          out.push(id);
        }
      }
    }
    return out;
  }

  /** Items near a point: cells overlapping the square of half-size `radius`. */
  queryPoint(x: number, y: number, radius: number, out: number[] = []): number[] {
    return this.queryRect(x - radius, y - radius, x + radius, y + radius, out);
  }

  /** Visits every occupied cell (used by the debug "spatial-hash cells" layer). */
  forEachCell(visit: (cx: number, cy: number, count: number) => void): void {
    for (const [key, cell] of this.cells) {
      const cx = Math.floor(key / SPAN) - OFFSET;
      const cy = (key % SPAN) - OFFSET;
      visit(cx, cy, cell.length);
    }
  }

  private nextStamp(): number {
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  private ensureStampCapacity(id: number): void {
    if (id < this.stamps.length) return;
    let n = this.stamps.length;
    while (n <= id) n *= 2;
    const next = new Uint32Array(n);
    next.set(this.stamps);
    this.stamps = next;
  }
}
