import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  clamp,
  degToRad,
  invLerp,
  lerp,
  nearlyEqual,
  radToDeg,
  remap,
  wrapAngle,
} from '../../../src/engine/math/utils.ts';

describe('math/utils', () => {
  it('lerp interpolates and extrapolates', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it('invLerp is the inverse of lerp and safe for a === b', () => {
    expect(invLerp(0, 10, 2.5)).toBe(0.25);
    expect(invLerp(10, 0, 2.5)).toBe(0.75);
    expect(invLerp(3, 3, 3)).toBe(0);
    for (const t of [0, 0.1, 0.5, 0.9, 1]) expect(invLerp(-4, 8, lerp(-4, 8, t))).toBeCloseTo(t);
  });

  it('clamp bounds values', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('remap maps between ranges', () => {
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
  });

  it('wrapAngle keeps angles in (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });

  it('angleDelta returns the shortest signed turn', () => {
    expect(angleDelta(degToRad(170), degToRad(-170))).toBeCloseTo(degToRad(20));
    expect(angleDelta(degToRad(-170), degToRad(170))).toBeCloseTo(degToRad(-20));
  });

  it('converts degrees and radians', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });

  it('nearlyEqual uses a tolerance', () => {
    expect(nearlyEqual(1, 1 + 1e-9)).toBe(true);
    expect(nearlyEqual(1, 1.1)).toBe(false);
  });
});
