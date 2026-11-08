import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from '../../../src/engine/math/rng.ts';

describe('math/rng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    const sc = Array.from({ length: 20 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('produces values in [0, 1) with a sane mean', () => {
    const r = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });

  it('range, int, chance and pick respect bounds', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const f = r.range(-3, 5);
      expect(f).toBeGreaterThanOrEqual(-3);
      expect(f).toBeLessThan(5);
      const n = r.int(2, 6);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThan(6);
    }
    expect(new Rng(3).chance(0)).toBe(false);
    expect(new Rng(3).chance(1)).toBe(true);
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(r.pick([])).toBeUndefined();
  });

  it('saves and restores state to replay a sequence', () => {
    const r = new Rng(99);
    r.next();
    const state = r.getState();
    const first = [r.next(), r.next()];
    r.setState(state);
    expect([r.next(), r.next()]).toEqual(first);
  });

  it('gaussian samples are finite with roughly zero mean', () => {
    const r = new Rng(5);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const g = r.gaussian();
      expect(Number.isFinite(g)).toBe(true);
      sum += g;
    }
    expect(Math.abs(sum / 5000)).toBeLessThan(0.1);
  });

  it('shuffle permutes in place deterministically', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = new Rng(11).shuffle([...arr]);
    expect([...out].sort()).toEqual(arr);
    expect(new Rng(11).shuffle([...arr])).toEqual(out);
  });

  it('fork gives independent, reproducible streams', () => {
    const a = new Rng(10).fork('trees');
    const b = new Rng(10).fork('trees');
    const c = new Rng(10).fork('buildings');
    expect(a.next()).toBe(b.next());
    expect(new Rng(10).fork('trees').next()).not.toBe(c.next());
  });

  it('hashSeed maps strings to stable 32-bit seeds', () => {
    expect(hashSeed('grid-town')).toBe(hashSeed('grid-town'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed(123)).toBeGreaterThanOrEqual(0);
    expect(hashSeed(123)).toBeLessThan(2 ** 32);
  });
});
