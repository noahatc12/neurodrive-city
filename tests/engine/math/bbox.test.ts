import { describe, expect, it } from 'vitest';
import {
  bboxContains,
  bboxOf,
  bboxOverlap,
  emptyBBox,
  expandBBox,
  isEmptyBBox,
  padBBox,
  segmentBBox,
  unionBBox,
} from '../../../src/engine/math/bbox.ts';

describe('math/bbox', () => {
  it('builds boxes from points and segments', () => {
    expect(
      bboxOf([
        { x: 1, y: 5 },
        { x: -2, y: 3 },
      ]),
    ).toEqual({ minX: -2, minY: 3, maxX: 1, maxY: 5 });
    expect(segmentBBox({ x: 4, y: 0 }, { x: 1, y: 2 })).toEqual({
      minX: 1,
      minY: 0,
      maxX: 4,
      maxY: 2,
    });
    expect(isEmptyBBox(emptyBBox())).toBe(true);
    expect(isEmptyBBox(bboxOf([{ x: 0, y: 0 }]))).toBe(false);
  });

  it('expands, unions and pads', () => {
    const b = expandBBox(emptyBBox(), 1, 1);
    expandBBox(b, 3, -1);
    expect(b).toEqual({ minX: 1, minY: -1, maxX: 3, maxY: 1 });
    unionBBox(b, { minX: -5, minY: 0, maxX: 0, maxY: 9 });
    expect(b).toEqual({ minX: -5, minY: -1, maxX: 3, maxY: 9 });
    expect(padBBox(b, 1)).toEqual({ minX: -6, minY: -2, maxX: 4, maxY: 10 });
  });

  it('tests overlap and containment (touching counts)', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(bboxOverlap(a, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true);
    expect(bboxOverlap(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(bboxContains(a, 5, 5)).toBe(true);
    expect(bboxContains(a, 10, 0)).toBe(true);
    expect(bboxContains(a, 11, 0)).toBe(false);
  });
});
