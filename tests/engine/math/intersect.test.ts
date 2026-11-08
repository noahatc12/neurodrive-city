import { describe, expect, it } from 'vitest';
import {
  pointSegmentDistance,
  projectParam,
  raySegmentOffset,
  segmentIntersection,
  segmentSegmentDistance,
  segmentsIntersect,
} from '../../../src/engine/math/intersect.ts';
import { vec2 } from '../../../src/engine/math/vec2.ts';

const v = vec2;

describe('math/intersect: segmentIntersection', () => {
  it('finds a proper crossing with offsets on both segments', () => {
    const hit = segmentIntersection(v(0, 0), v(10, 0), v(5, -5), v(5, 5));
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(5);
    expect(hit?.y).toBeCloseTo(0);
    expect(hit?.offset).toBeCloseTo(0.5);
    expect(hit?.u).toBeCloseTo(0.5);
  });

  it('reports the offset along the first segment', () => {
    const hit = segmentIntersection(v(0, 0), v(100, 0), v(25, -1), v(25, 1));
    expect(hit?.offset).toBeCloseTo(0.25);
  });

  it('returns null for segments that would cross only if extended', () => {
    expect(segmentIntersection(v(0, 0), v(1, 0), v(5, -1), v(5, 1))).toBeNull();
    expect(segmentIntersection(v(0, 0), v(10, 0), v(5, 1), v(5, 5))).toBeNull();
  });

  it('returns null for parallel, non-collinear segments', () => {
    expect(segmentIntersection(v(0, 0), v(10, 0), v(0, 1), v(10, 1))).toBeNull();
  });

  it('handles collinear overlap by returning the overlap point closest to A', () => {
    const hit = segmentIntersection(v(0, 0), v(10, 0), v(4, 0), v(20, 0));
    expect(hit?.x).toBeCloseTo(4);
    expect(hit?.offset).toBeCloseTo(0.4);
    expect(hit?.u).toBeCloseTo(0);
    const reversed = segmentIntersection(v(0, 0), v(10, 0), v(20, 0), v(-5, 0));
    expect(reversed?.offset).toBeCloseTo(0);
    expect(reversed?.u).toBeCloseTo(0.8);
  });

  it('returns null for collinear but disjoint segments', () => {
    expect(segmentIntersection(v(0, 0), v(10, 0), v(11, 0), v(20, 0))).toBeNull();
  });

  it('detects segments touching exactly at endpoints', () => {
    const hit = segmentIntersection(v(0, 0), v(10, 0), v(10, 0), v(10, 10));
    expect(hit?.offset).toBeCloseTo(1);
    expect(hit?.u).toBeCloseTo(0);
    expect(segmentsIntersect(v(0, 0), v(10, 0), v(10, 0), v(20, 5))).toBe(true);
  });

  it('detects a T junction (endpoint on the other segment interior)', () => {
    const hit = segmentIntersection(v(0, 0), v(10, 0), v(5, 0), v(5, 10));
    expect(hit?.x).toBeCloseTo(5);
    expect(hit?.u).toBeCloseTo(0);
  });

  it('never intersects zero-length segments', () => {
    expect(segmentIntersection(v(1, 1), v(1, 1), v(0, 0), v(2, 2))).toBeNull();
    expect(segmentIntersection(v(0, 0), v(2, 2), v(1, 1), v(1, 1))).toBeNull();
  });

  it('is robust to tiny rounding at endpoints (epsilon tolerance)', () => {
    expect(segmentsIntersect(v(0, 0), v(1, 0), v(1 + 1e-12, -1), v(1 + 1e-12, 1))).toBe(true);
  });
});

describe('math/intersect: rays and distances', () => {
  it('raySegmentOffset returns the parametric hit or -1', () => {
    expect(raySegmentOffset(0, 0, 0, -150, -50, -75, 50, -75)).toBeCloseTo(0.5);
    expect(raySegmentOffset(0, 0, 0, -50, -50, -75, 50, -75)).toBe(-1);
  });

  it('projectParam clamps to the segment', () => {
    expect(projectParam(v(5, 3), v(0, 0), v(10, 0))).toBeCloseTo(0.5);
    expect(projectParam(v(-5, 3), v(0, 0), v(10, 0))).toBe(0);
    expect(projectParam(v(50, 3), v(0, 0), v(10, 0))).toBe(1);
    expect(projectParam(v(1, 1), v(0, 0), v(0, 0))).toBe(0);
  });

  it('pointSegmentDistance measures to the closest point', () => {
    expect(pointSegmentDistance(v(5, 3), v(0, 0), v(10, 0))).toBeCloseTo(3);
    expect(pointSegmentDistance(v(13, 4), v(0, 0), v(10, 0))).toBeCloseTo(5);
  });

  it('segmentSegmentDistance is 0 for crossings and exact otherwise', () => {
    expect(segmentSegmentDistance(v(0, 0), v(10, 0), v(5, -5), v(5, 5))).toBe(0);
    expect(segmentSegmentDistance(v(0, 0), v(10, 0), v(0, 4), v(10, 4))).toBeCloseTo(4);
    // closest pair is an endpoint of CD against the interior of AB
    expect(segmentSegmentDistance(v(0, 0), v(100, 0), v(50, 2), v(50, 80))).toBeCloseTo(2);
  });
});
