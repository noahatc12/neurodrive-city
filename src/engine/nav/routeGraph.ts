/**
 * Directed lane graph (spec F1): every undirected road segment becomes two directed
 * edges (one per lane); one-way segments become a single edge from `a` to `b`.
 * @module engine/nav/routeGraph
 */
import type { Graph } from '../graph/graph.ts';

export interface RouteEdge {
  /** Index in {@link RouteGraph.edges}. */
  index: number;
  from: number;
  to: number;
  segmentId: number;
  length: number;
}

export class RouteGraph {
  /** Outgoing edges per point id. */
  readonly out = new Map<number, RouteEdge[]>();
  /** Point positions by id. */
  readonly pos = new Map<number, { x: number; y: number }>();
  /** All directed edges by index. */
  readonly edges: RouteEdge[] = [];
  readonly version: number;
  edgeCount = 0;
  private readonly degrees = new Map<number, number>();

  constructor(graph: Graph) {
    this.version = graph.version;
    for (const p of graph.points) {
      this.pos.set(p.id, { x: p.x, y: p.y });
      this.out.set(p.id, []);
    }
    for (const s of graph.segments) {
      const len = s.length();
      this.add(s.a.id, s.b.id, s.id, len);
      if (!s.oneWay) this.add(s.b.id, s.a.id, s.id, len);
    }
    for (const p of graph.points) this.degrees.set(p.id, graph.degree(p));
  }

  private add(from: number, to: number, segmentId: number, length: number): void {
    const list = this.out.get(from);
    if (!list) return;
    const e: RouteEdge = { index: this.edges.length, from, to, segmentId, length };
    this.edges.push(e);
    list.push(e);
    this.edgeCount++;
  }

  /** Undirected degree of a point (number of distinct neighbours). */
  degree(id: number): number {
    return this.degrees.get(id) ?? 0;
  }

  /** Outgoing edges of a point (empty array if none). */
  edgesFrom(id: number): readonly RouteEdge[] {
    return this.out.get(id) ?? EMPTY;
  }

  /** Directed edge along `segmentId` that starts at `from`, if it exists. */
  edge(from: number, segmentId: number): RouteEdge | undefined {
    return this.edgesFrom(from).find((e) => e.segmentId === segmentId);
  }

  /** Point ids that have at least one outgoing edge. */
  nodesWithEdges(): number[] {
    const out: number[] = [];
    for (const [id, edges] of this.out) if (edges.length > 0) out.push(id);
    return out;
  }
}

const EMPTY: readonly RouteEdge[] = Object.freeze([]);
