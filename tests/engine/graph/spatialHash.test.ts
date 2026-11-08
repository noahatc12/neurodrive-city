import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../../src/engine/graph/spatialHash.ts';

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('graph/spatialHash', () => {
  it('rejects a non-positive cell size', () => {
    expect(() => new SpatialHash(0)).toThrow();
    expect(() => new SpatialHash(-5)).toThrow();
  });

  it('finds items in overlapping cells and de-duplicates multi-cell items', () => {
    const h = new SpatialHash(10);
    h.insert(1, box(0, 0, 25, 5)); // spans 3 cells
    h.insert(2, box(100, 100, 101, 101));
    expect(h.size).toBe(2);
    expect(h.query(box(0, 0, 30, 30)).sort()).toEqual([1]);
    expect(h.query(box(-1000, -1000, 1000, 1000)).sort()).toEqual([1, 2]);
    expect(h.queryPoint(100.5, 100.5, 1)).toEqual([2]);
  });

  it('supports negative coordinates', () => {
    const h = new SpatialHash(50);
    h.insert(7, box(-120, -80, -110, -70));
    expect(h.queryPoint(-115, -75, 2)).toEqual([7]);
    expect(h.queryPoint(115, 75, 2)).toEqual([]);
  });

  it('updates and removes incrementally', () => {
    const h = new SpatialHash(10);
    h.insert(3, box(0, 0, 1, 1));
    h.update(3, box(50, 50, 51, 51));
    expect(h.queryPoint(0.5, 0.5, 0.1)).toEqual([]);
    expect(h.queryPoint(50.5, 50.5, 0.1)).toEqual([3]);
    expect(h.has(3)).toBe(true);
    expect(h.remove(3)).toBe(true);
    expect(h.remove(3)).toBe(false);
    expect(h.has(3)).toBe(false);
    expect(h.size).toBe(0);
  });

  it('reuses the output array and grows its stamp table for large ids', () => {
    const h = new SpatialHash(10);
    h.insert(5000, box(0, 0, 1, 1));
    h.insert(4, box(0, 0, 1, 1));
    const out: number[] = [999];
    const res = h.queryRect(0, 0, 1, 1, out);
    expect(res).toBe(out);
    expect(res.sort((a, b) => a - b)).toEqual([4, 5000]);
  });

  it('enumerates cells and clears', () => {
    const h = new SpatialHash(10);
    h.insert(1, box(0, 0, 15, 5));
    h.insert(2, box(-5, -5, -1, -1));
    const cells: Array<[number, number, number]> = [];
    h.forEachCell((cx, cy, n) => cells.push([cx, cy, n]));
    expect(cells.sort()).toEqual(
      [
        [-1, -1, 1],
        [0, 0, 1],
        [1, 0, 1],
      ].sort(),
    );
    h.clear();
    expect(h.size).toBe(0);
    expect(h.query(box(-100, -100, 100, 100))).toEqual([]);
  });
});

describe('graph/spatialHash huge queries', () => {
  it('answers an enormous query rectangle quickly by walking occupied cells', () => {
    const h = new SpatialHash(10);
    h.insert(1, box(0, 0, 5, 5));
    h.insert(2, box(1000, 1000, 1001, 1001));
    const t0 = performance.now();
    expect(h.queryPoint(0, 0, 1e9).sort()).toEqual([1, 2]);
    expect(h.queryRect(500, 500, 1e8, 1e8)).toEqual([2]);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
