/**
 * Seedable pseudo-random number generator: the only source of randomness in the
 * engine (`Math.random` is banned there by lint), so world generation, training and
 * traffic are reproducible from a seed.
 *
 * Algorithm: mulberry32, a tiny 32-bit-state generator with good statistical quality
 * for simulation work (not for cryptography).
 *
 * @module engine/math/rng
 */

/** Hashes a string (or number) into a 32-bit unsigned seed (FNV-1a). */
export function hashSeed(input: string | number): number {
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  /** @param seed any integer; it is reduced to 32 bits */
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Current internal state (save it to resume the exact same sequence). */
  getState(): number {
    return this.state;
  }

  /** Restores a state returned by {@link getState}. */
  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    return min + Math.floor((maxExclusive - min) * this.next());
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element of a non-empty array (undefined for an empty one). */
  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.int(0, items.length)];
  }

  /** Standard normal sample (Box-Muller). */
  gaussian(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** In-place Fisher-Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Derives an independent generator for a named sub-system, so adding random calls
   * to one stage (e.g. trees) does not shift the sequence of another (e.g. buildings).
   */
  fork(salt: string | number): Rng {
    return new Rng(hashSeed(`${this.state}:${salt}`));
  }
}
