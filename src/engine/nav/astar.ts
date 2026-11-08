/**
 * A* shortest path on the directed lane graph (spec F2) with a Euclidean heuristic.
 *
 * The heuristic never overestimates (a straight line is the shortest possible road), so
 * the first time the goal is popped from the open set its path is optimal.
 *
 * @module engine/nav/astar
 */
import type { RouteGraph } from './routeGraph.ts';

/** Minimal binary min-heap keyed by f-score. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= key) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.ids[0] as number;
    const lastId = this.ids.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.keys.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.ids[a] as number;
    this.ids[a] = this.ids[b] as number;
    this.ids[b] = ti;
    const tk = this.keys[a] as number;
    this.keys[a] = this.keys[b] as number;
    this.keys[b] = tk;
  }
}

export interface AStarResult {
  /** Point ids from start to goal (inclusive). */
  nodes: number[];
  /** Total route length in world units. */
  length: number;
  /** Nodes expanded (for tests and stats). */
  expanded: number;
}

/** Shortest path from `start` to `goal`, or null if unreachable. */
export function astar(rg: RouteGraph, start: number, goal: number): AStarResult | null {
  const goalPos = rg.pos.get(goal);
  if (!goalPos || !rg.pos.has(start)) return null;
  if (start === goal) return { nodes: [start], length: 0, expanded: 0 };
  const h = (id: number): number => {
    const p = rg.pos.get(id);
    return p ? Math.hypot(p.x - goalPos.x, p.y - goalPos.y) : Infinity;
  };
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  open.push(start, h(start));
  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    if (cur === goal) {
      const nodes = [cur];
      let c = cur;
      while (came.has(c)) {
        c = came.get(c) as number;
        nodes.push(c);
      }
      nodes.reverse();
      return { nodes, length: g.get(goal) ?? 0, expanded };
    }
    closed.add(cur);
    expanded++;
    const gc = g.get(cur) ?? Infinity;
    for (const e of rg.edgesFrom(cur)) {
      if (closed.has(e.to)) continue;
      const tentative = gc + e.length;
      if (tentative < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, tentative);
        came.set(e.to, cur);
        open.push(e.to, tentative + h(e.to));
      }
    }
  }
  return null;
}

/**
 * A* over directed edges (lanes) that never makes a U-turn except at a dead end.
 * Node-based A* happily routes "drive to the next junction and come straight back",
 * which no driver would do; searching over edges forbids the reversal, so the route
 * goes around the block instead.
 */
function searchLanes(
  rg: RouteGraph,
  startEdge: number,
  isGoal: (edgeIndex: number) => boolean,
  goalPos: { x: number; y: number },
): AStarResult | null {
  const first = rg.edges[startEdge];
  if (!first) return null;
  const h = (node: number): number => {
    const p = rg.pos.get(node);
    return p ? Math.hypot(p.x - goalPos.x, p.y - goalPos.y) : Infinity;
  };
  const g = new Map<number, number>([[startEdge, first.length]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  open.push(startEdge, first.length + h(first.to));
  let expanded = 0;
  while (open.size > 0) {
    const ei = open.pop();
    if (closed.has(ei)) continue;
    const e = rg.edges[ei];
    if (!e) continue;
    if (isGoal(ei)) {
      const chain = [ei];
      let c = ei;
      while (came.has(c)) {
        c = came.get(c) as number;
        chain.push(c);
      }
      chain.reverse();
      const nodes = [first.from];
      for (const idx of chain) nodes.push((rg.edges[idx] as { to: number }).to);
      return { nodes, length: g.get(ei) ?? 0, expanded };
    }
    closed.add(ei);
    expanded++;
    const ge = g.get(ei) ?? Infinity;
    const deadEnd = rg.degree(e.to) <= 1;
    for (const n of rg.edgesFrom(e.to)) {
      if (closed.has(n.index)) continue;
      if (!deadEnd && n.to === e.from && n.segmentId === e.segmentId) continue; // no U-turns
      const tentative = ge + n.length;
      if (tentative < (g.get(n.index) ?? Infinity)) {
        g.set(n.index, tentative);
        came.set(n.index, ei);
        open.push(n.index, tentative + h(n.to));
      }
    }
  }
  return null;
}

/**
 * Lane-level route from the lane `startEdge` to point `goal` (no U-turns except at dead
 * ends). Returns point ids from the start lane's `from` to `goal`.
 */
export function astarLanes(rg: RouteGraph, startEdge: number, goal: number): AStarResult | null {
  const goalPos = rg.pos.get(goal);
  if (!goalPos) return null;
  return searchLanes(rg, startEdge, (ei) => rg.edges[ei]?.to === goal, goalPos);
}

/** Lane-level route from lane `startEdge` that ends by driving along lane `goalEdge`. */
export function astarToLane(
  rg: RouteGraph,
  startEdge: number,
  goalEdge: number,
): AStarResult | null {
  const ge = rg.edges[goalEdge];
  const goalPos = ge ? rg.pos.get(ge.from) : undefined;
  if (!ge || !goalPos) return null;
  return searchLanes(rg, startEdge, (ei) => ei === goalEdge, goalPos);
}
