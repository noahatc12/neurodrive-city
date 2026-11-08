/**
 * Road markings bound to graph segments.
 *
 * A marking never stores an absolute position. It stores a **binding**: the segment it
 * sits on, a normalised position t along it, and which lane (side) it occupies. Its
 * world position and heading are derived from the segment's current endpoints, so
 * markings follow when points move, are re-bound onto the right half when a segment is
 * split, and are removed with their segment: never orphaned.
 *
 * ```
 *        side = -1 lane  ◀── travel b→a
 *   a ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━● b      (graph segment = road centre line)
 *        side = +1 lane  ──▶ travel a→b      (offset roadWidth/4 to the right of a→b)
 * ```
 *
 * @module engine/markings/marking
 */
import type { Graph, GraphEvent } from '../graph/graph.ts';
import type { MarkingType } from '../io/worldSchema.ts';
import type { Vec2 } from '../math/vec2.ts';

export type { MarkingType };

/** Lane side: +1 right of a→b, -1 right of b→a, 0 on the centre line (crossings). */
export type Side = -1 | 0 | 1;

export interface MarkingBinding {
  segmentId: number;
  /** Position along the segment, 0 at `a`, 1 at `b`. */
  t: number;
  side: Side;
}

export interface Marking {
  readonly id: number;
  readonly type: MarkingType;
  binding: MarkingBinding;
  /** Type-specific data (e.g. a light's controller group override). */
  props: Record<string, unknown>;
}

/** Derived placement of a marking in world space. */
export interface ResolvedMarking {
  center: Vec2;
  /** Unit vector of travel direction for this marking's lane. */
  direction: Vec2;
  width: number;
  height: number;
}

/** Marking size from road width (spec B5): squares of roadWidth/2, crossings roadWidth × roadWidth/2. */
export function markingSize(
  type: MarkingType,
  roadWidth: number,
): { width: number; height: number } {
  return type === 'crossing'
    ? { width: roadWidth, height: roadWidth / 2 }
    : { width: roadWidth / 2, height: roadWidth / 2 };
}

/** Which lane a marking type sits in: crossings sit on the centre line. */
export function defaultSide(type: MarkingType, side: Side): Side {
  return type === 'crossing' ? 0 : side === 0 ? 1 : side;
}

/**
 * Computes a marking's world placement from its binding, or null if its segment is
 * missing (which the store prevents) or degenerate.
 */
export function resolveMarking(
  m: Marking,
  graph: Graph,
  roadWidth: number,
): ResolvedMarking | null {
  const seg = graph.getSegment(m.binding.segmentId);
  if (!seg) return null;
  const len = seg.length();
  if (len === 0) return null;
  const dx = (seg.b.x - seg.a.x) / len;
  const dy = (seg.b.y - seg.a.y) / len;
  const t = m.binding.t;
  const side = m.binding.side;
  const off = (side * roadWidth) / 4;
  // right of a→b in y-down space is (-dy, dx)
  const center = {
    x: seg.a.x + (seg.b.x - seg.a.x) * t - dy * off,
    y: seg.a.y + (seg.b.y - seg.a.y) * t + dx * off,
  };
  const sign = side === -1 ? -1 : 1;
  return { center, direction: { x: dx * sign, y: dy * sign }, ...markingSize(m.type, roadWidth) };
}

/**
 * Finds the binding for a world position: nearest segment within `maxDistance`, the
 * projected t, and the lane on the side of the centre line where `p` lies.
 */
export function bindingAt(
  graph: Graph,
  type: MarkingType,
  p: Vec2,
  maxDistance: number,
): MarkingBinding | null {
  const hit = graph.nearestSegment(p.x, p.y, maxDistance);
  if (!hit) return null;
  const s = hit.segment;
  const len = s.length();
  const dx = (s.b.x - s.a.x) / len;
  const dy = (s.b.y - s.a.y) / len;
  // side of p relative to a→b: positive when p is on the right ((-dy, dx) direction)
  const rel = (p.x - hit.point.x) * -dy + (p.y - hit.point.y) * dx;
  const side: Side = rel >= 0 ? 1 : -1;
  return { segmentId: s.id, t: hit.t, side: defaultSide(type, side) };
}

/**
 * Owns all markings of a world and keeps them consistent with the graph by listening
 * to its events (cascade delete, split re-binding, clear).
 */
export class MarkingStore {
  private readonly map = new Map<number, Marking>();
  private readonly listeners = new Set<() => void>();
  private nextId = 0;
  private _version = 0;
  private cache: Marking[] = [];
  private cacheVersion = -1;

  constructor(graph: Graph) {
    graph.onChange((e) => this.onGraph(e));
  }

  /** Bumped on any marking change, including moves of the segments they sit on. */
  get version(): number {
    return this._version;
  }

  get size(): number {
    return this.map.size;
  }

  /** All markings (cached array, rebuilt only after a change). */
  all(): readonly Marking[] {
    if (this.cacheVersion !== this._version) {
      this.cache = [...this.map.values()];
      this.cacheVersion = this._version;
    }
    return this.cache;
  }

  get(id: number): Marking | undefined {
    return this.map.get(id);
  }

  ofType(type: MarkingType): Marking[] {
    return this.all().filter((m) => m.type === type);
  }

  /** Markings bound to a segment. */
  boundTo(segmentId: number): Marking[] {
    return this.all().filter((m) => m.binding.segmentId === segmentId);
  }

  add(type: MarkingType, binding: MarkingBinding, props: Record<string, unknown> = {}): Marking {
    const m: Marking = { id: this.nextId++, type, binding: { ...binding }, props: { ...props } };
    this.map.set(m.id, m);
    this.changed();
    return m;
  }

  /** Re-inserts a marking with its original id (undo). */
  restore(m: Marking): Marking {
    const copy: Marking = {
      id: m.id,
      type: m.type,
      binding: { ...m.binding },
      props: { ...m.props },
    };
    this.map.set(copy.id, copy);
    this.nextId = Math.max(this.nextId, copy.id + 1);
    this.changed();
    return copy;
  }

  remove(id: number): Marking | undefined {
    const m = this.map.get(id);
    if (!m) return undefined;
    this.map.delete(id);
    this.changed();
    return m;
  }

  /** Deep copy of a marking (for undo snapshots). */
  static clone(m: Marking): Marking {
    return { id: m.id, type: m.type, binding: { ...m.binding }, props: { ...m.props } };
  }

  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onGraph(e: GraphEvent): void {
    switch (e.type) {
      case 'segment-removed': {
        let removed = false;
        for (const m of this.map.values()) {
          if (m.binding.segmentId === e.segment.id) {
            this.map.delete(m.id);
            removed = true;
          }
        }
        if (removed) this.changed();
        break;
      }
      case 'segment-split': {
        let moved = false;
        for (const m of this.map.values()) {
          if (m.binding.segmentId !== e.segment.id) continue;
          if (m.binding.t <= e.t) {
            m.binding = {
              ...m.binding,
              segmentId: e.first.id,
              t: e.t === 0 ? 0 : m.binding.t / e.t,
            };
          } else {
            m.binding = {
              ...m.binding,
              segmentId: e.second.id,
              t: (m.binding.t - e.t) / (1 - e.t),
            };
          }
          moved = true;
        }
        if (moved) this.changed();
        break;
      }
      case 'cleared':
        this.clear();
        break;
      case 'point-moved':
      case 'segment-changed':
        this.changed();
        break;
      default:
        break;
    }
  }

  private changed(): void {
    this._version++;
    for (const l of this.listeners) l();
  }
}
