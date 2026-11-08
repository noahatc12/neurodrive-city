import { describe, expect, it } from 'vitest';
import {
  add,
  addInto,
  angle,
  average,
  centroid,
  copy,
  cross,
  distance,
  distanceSq,
  dot,
  equals,
  lerp2,
  lerpInto,
  magnitude,
  normalize,
  normalizeInto,
  perpendicular,
  rotate,
  scale,
  scaleInto,
  set,
  subtract,
  subtractInto,
  translate,
  vec2,
} from '../../../src/engine/math/vec2.ts';

describe('math/vec2', () => {
  it('creates and copies vectors', () => {
    expect(vec2()).toEqual({ x: 0, y: 0 });
    const a = vec2(1, 2);
    const b = copy(a);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    expect(set(b, 5, 6)).toBe(b);
    expect(b).toEqual({ x: 5, y: 6 });
  });

  it('adds, subtracts and scales', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(subtract(vec2(1, 2), vec2(3, 5))).toEqual({ x: -2, y: -3 });
    expect(scale(vec2(1, -2), 3)).toEqual({ x: 3, y: -6 });
  });

  it('normalizes safely', () => {
    const n = normalize(vec2(3, 4));
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
    expect(magnitude(vec2(3, 4))).toBe(5);
  });

  it('perpendicular points right of travel in y-down space', () => {
    expect(perpendicular(vec2(1, 0))).toEqual({ x: -0, y: 1 });
    expect(dot(vec2(2, 3), perpendicular(vec2(2, 3)))).toBe(0);
  });

  it('dot and cross products', () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(cross(vec2(0, 1), vec2(1, 0))).toBe(-1);
  });

  it('distances and angles', () => {
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(distanceSq(vec2(0, 0), vec2(3, 4))).toBe(25);
    expect(angle(vec2(0, 1))).toBeCloseTo(Math.PI / 2);
    const t = translate(vec2(1, 1), Math.PI / 2, 10);
    expect(t.x).toBeCloseTo(1);
    expect(t.y).toBeCloseTo(11);
  });

  it('interpolates and averages', () => {
    expect(lerp2(vec2(0, 0), vec2(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
    expect(average(vec2(0, 0), vec2(2, 4))).toEqual({ x: 1, y: 2 });
    expect(centroid([vec2(0, 0), vec2(2, 0), vec2(2, 2), vec2(0, 2)])).toEqual({ x: 1, y: 1 });
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });

  it('compares and rotates', () => {
    expect(equals(vec2(1, 1), vec2(1 + 1e-12, 1))).toBe(true);
    expect(equals(vec2(1, 1), vec2(1.1, 1))).toBe(false);
    const r = rotate(vec2(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it('allocation-free variants write into out', () => {
    const out = vec2();
    expect(addInto(out, vec2(1, 2), vec2(3, 4))).toBe(out);
    expect(out).toEqual({ x: 4, y: 6 });
    subtractInto(out, vec2(1, 2), vec2(3, 4));
    expect(out).toEqual({ x: -2, y: -2 });
    scaleInto(out, vec2(1, 2), 2);
    expect(out).toEqual({ x: 2, y: 4 });
    lerpInto(out, vec2(0, 0), vec2(4, 8), 0.25);
    expect(out).toEqual({ x: 1, y: 2 });
    normalizeInto(out, vec2(0, 5));
    expect(out).toEqual({ x: 0, y: 1 });
    normalizeInto(out, vec2(0, 0));
    expect(out).toEqual({ x: 0, y: 0 });
  });
});
