/**
 * Road geometry: envelopes, unioned borders, edge lines, sidewalks, centre dashes and
 * one-way arrows.
 * @module engine/world/roads
 */
import type { Polygon } from '../math/polygon.ts';
import { unionPolygons, type Seg } from '../math/polygon.ts';
import type { Vec2 } from '../math/vec2.ts';
import { envelope } from './envelope.ts';
import type { ArrowData, WorldInput } from './types.ts';

export interface ResolvedSegment {
  id: number;
  a: Vec2;
  b: Vec2;
  aId: number;
  bId: number;
  oneWay: boolean;
  bridge: boolean;
  tunnel: boolean;
}

/** Resolves point ids to coordinates, dropping segments with missing endpoints. */
export function resolveSegments(input: WorldInput): ResolvedSegment[] {
  const byId = new Map<number, Vec2>();
  for (const p of input.points) byId.set(p.id, { x: p.x, y: p.y });
  const out: ResolvedSegment[] = [];
  for (const s of input.segments) {
    const a = byId.get(s.a);
    const b = byId.get(s.b);
    if (!a || !b) continue;
    out.push({
      id: s.id,
      a,
      b,
      aId: s.a,
      bId: s.b,
      oneWay: s.oneWay,
      bridge: s.bridge,
      tunnel: s.tunnel,
    });
  }
  return out;
}

/** One envelope polygon per segment at the given width. */
export function envelopes(
  segs: readonly ResolvedSegment[],
  width: number,
  roundness: number,
): Polygon[] {
  return segs.map((s) => envelope(s.a, s.b, width, roundness));
}

/** Border segments of the union of envelopes at `width`. */
export function unionBorders(
  segs: readonly ResolvedSegment[],
  width: number,
  roundness: number,
  onProgress?: (f: number) => void,
): Seg[] {
  return unionPolygons(envelopes(segs, width, roundness), onProgress ? { onProgress } : {});
}

/**
 * Centre-line pieces: each segment trimmed by half a road width at junctions
 * (degree ≥ 3) so dashes do not cross the intersection box.
 */
export function centerLines(segs: readonly ResolvedSegment[], roadWidth: number): Seg[] {
  const degree = new Map<number, number>();
  for (const s of segs) {
    degree.set(s.aId, (degree.get(s.aId) ?? 0) + 1);
    degree.set(s.bId, (degree.get(s.bId) ?? 0) + 1);
  }
  const out: Seg[] = [];
  for (const s of segs) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (len === 0) continue;
    const ux = (s.b.x - s.a.x) / len;
    const uy = (s.b.y - s.a.y) / len;
    const trimA = (degree.get(s.aId) ?? 0) >= 3 ? roadWidth * 0.55 : 0;
    const trimB = (degree.get(s.bId) ?? 0) >= 3 ? roadWidth * 0.55 : 0;
    if (trimA + trimB >= len - 1) continue;
    out.push({
      a: { x: s.a.x + ux * trimA, y: s.a.y + uy * trimA },
      b: { x: s.b.x - ux * trimB, y: s.b.y - uy * trimB },
    });
  }
  return out;
}

/** Direction arrows on both lanes of each one-way segment, spaced along it. */
export function oneWayArrows(segs: readonly ResolvedSegment[], roadWidth: number): ArrowData[] {
  const out: ArrowData[] = [];
  const spacing = roadWidth * 2.2;
  for (const s of segs) {
    if (!s.oneWay) continue;
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (len < roadWidth) continue;
    const ux = (s.b.x - s.a.x) / len;
    const uy = (s.b.y - s.a.y) / len;
    const angle = Math.atan2(uy, ux);
    const n = Math.max(1, Math.floor((len - roadWidth) / spacing));
    for (let i = 0; i < n; i++) {
      const t = (roadWidth / 2 + (i + 0.5) * ((len - roadWidth) / n)) / len;
      const cx = s.a.x + (s.b.x - s.a.x) * t;
      const cy = s.a.y + (s.b.y - s.a.y) * t;
      for (const side of [-1, 1]) {
        out.push({
          x: cx - uy * side * (roadWidth / 4),
          y: cy + ux * side * (roadWidth / 4),
          angle,
        });
      }
    }
  }
  return out;
}

/**
 * Merges segments that continue each other in a straight line (shared endpoint, same
 * direction). Union output splits long straight borders wherever other envelopes touch
 * them; merging restores the long sides that buildings are placed along.
 */
export function mergeCollinear(segs: readonly Seg[], angleEps = 1e-4): Seg[] {
  const key = (p: Vec2): string => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const byStart = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const k = key(s.a);
    const list = byStart.get(k) ?? [];
    list.push(i);
    byStart.set(k, list);
  });
  const used = new Uint8Array(segs.length);
  const hasPredecessor = new Uint8Array(segs.length);
  const dir = (s: Seg): number => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  const nextOf = (i: number): number => {
    const s = segs[i] as Seg;
    const cands = byStart.get(key(s.b));
    if (!cands) return -1;
    for (const j of cands) {
      if (j === i || used[j]) continue;
      let d = Math.abs(dir(segs[j] as Seg) - dir(s));
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < angleEps) return j;
    }
    return -1;
  };
  segs.forEach((_, i) => {
    const j = nextOf(i);
    if (j >= 0) hasPredecessor[j] = 1;
  });
  const out: Seg[] = [];
  const walk = (start: number): void => {
    used[start] = 1;
    const first = segs[start] as Seg;
    let end = first.b;
    let cur = start;
    for (;;) {
      const j = nextOf(cur);
      if (j < 0) break;
      used[j] = 1;
      end = (segs[j] as Seg).b;
      cur = j;
    }
    out.push({ a: { x: first.a.x, y: first.a.y }, b: { x: end.x, y: end.y } });
  };
  for (let i = 0; i < segs.length; i++) if (!used[i] && !hasPredecessor[i]) walk(i);
  for (let i = 0; i < segs.length; i++) if (!used[i]) walk(i); // closed loops
  return out;
}
