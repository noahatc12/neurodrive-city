/**
 * Version-keyed caching. Anything derived from the world (geometry, render paths,
 * minimap bitmaps, route graphs) is rebuilt only when the source version changes:
 * a cheap integer comparison instead of hashing JSON every frame.
 * @module engine/world/worldVersion
 */

export class VersionedCache<T> {
  private value: T | null = null;
  private version = Number.NaN;
  /** Number of times the value was (re)built; handy for tests and stats. */
  builds = 0;

  /** Returns the cached value for `version`, building it if the version changed. */
  get(version: number, build: () => T): T {
    if (this.value === null || version !== this.version) {
      this.value = build();
      this.version = version;
      this.builds++;
    }
    return this.value;
  }

  /** The cached value without building (null if none). */
  peek(): T | null {
    return this.value;
  }

  /** True when the cache holds a value for `version`. */
  isFresh(version: number): boolean {
    return this.value !== null && this.version === version;
  }

  /** Stores a value computed elsewhere (e.g. by a worker). */
  set(version: number, value: T): void {
    this.value = value;
    this.version = version;
  }

  invalidate(): void {
    this.value = null;
    this.version = Number.NaN;
  }
}
