/**
 * Route following (spec F3): a deterministic driver for traffic cars (and the
 * route-following demo), not the neural network.
 *
 * Steering: pure pursuit. Pick the point a lookahead distance Ld ahead on the lane path,
 * express it in the car frame, and steer along the arc through it:
 *
 * ```
 *   κ = 2·y / Ld²            (y = lateral offset of the lookahead point)
 *   ω = v·κ                  (yaw rate needed at speed v)
 *   steer = clamp(ω / turnRate, −1, 1)
 * ```
 *
 * Speed: the minimum of several limits, each braking-aware (v ≤ √(2·a·d) to stop
 * within distance d): cruise speed, upcoming curvature, end of route, markings ahead
 * (stop, yield, light, crossing), the gap to the car ahead (front sensor rays), and
 * junction reservations (one car inside an intersection at a time).
 *
 * @module engine/nav/routeFollower
 */
import type { Car } from '../car/car.ts';
import type { Graph } from '../graph/graph.ts';
import { crossingMaxSpeed } from '../markings/crossing.ts';
import { facedPoint, mustStopForLight } from '../markings/light.ts';
import {
  resolveMarking,
  type Marking,
  type MarkingBinding,
  type MarkingStore,
} from '../markings/marking.ts';
import { StopLogic, stoppingSpeed } from '../markings/stop.ts';
import type { TrafficLightSystem } from '../markings/trafficLightController.ts';
import { YIELD_DETECT_ROAD_WIDTHS, yieldMaxSpeed } from '../markings/yield.ts';
import type { Vec2 } from '../math/vec2.ts';
import { astarLanes, astarToLane } from './astar.ts';
import { buildLanePath, pointAt, projectOnPath, type LanePath } from './lanePath.ts';
import type { RouteEdge, RouteGraph } from './routeGraph.ts';

export interface FollowerConfig {
  /** Cruise speed as a fraction of the car's max speed. */
  cruise: number;
  /** Comfortable braking used for planning (units/s²). */
  decel: number;
  /** Maximum lateral acceleration in turns (units/s²). */
  latAccel: number;
  /** Bumper-to-bumper gap kept to the car ahead (units). */
  safeGap: number;
}

export const DEFAULT_FOLLOWER: Readonly<FollowerConfig> = Object.freeze({
  cruise: 0.78,
  decel: 380,
  latAccel: 260,
  safeGap: 22,
});

/** What the follower needs from the simulation each step. */
export interface FollowerEnv {
  lights: TrafficLightSystem | null;
  /** Distance from the car's front to the nearest car ahead in its lane (Infinity if none). */
  gapAhead(car: Car): number;
  /** True if another car (heading differs by more than ~25°) is within r of (x, y). */
  crossTrafficNear(x: number, y: number, r: number, car: Car): boolean;
  /** Tries to reserve a junction for a car; true if granted (or already held). */
  reserve(nodeId: number, carId: number): boolean;
  release(nodeId: number, carId: number): void;
}

type RouteMarkingKind = 'stop' | 'yield' | 'light' | 'crossing';

interface RouteMarking {
  id: number;
  kind: RouteMarkingKind;
  /** Arc position of the marking's line (front edge for stops/lights). */
  lineArc: number;
  /** Crossing half length along the road. */
  half: number;
  /** Junction the marking guards (yield conflict detection). */
  jx: number;
  jy: number;
  stop: StopLogic | null;
}

/** A planned route: lane path plus the arc range to drive and markings on it. */
export interface Route {
  path: LanePath;
  sStart: number;
  sEnd: number;
  markings: RouteMarking[];
  /** Destination marking id when the route targets a marking (parking/target). */
  destinationMarking: number | null;
}

/** Where a route should end. */
export type RouteGoal =
  | { node: number }
  | { marking: Marking }
  /** A lane position: segment, parameter t and lane side (+1 travels a→b). */
  | { lane: MarkingBinding };

/**
 * The lane a car is driving on: among nearby segments, the one best aligned with its
 * heading (distance plus a misalignment penalty), in the direction it faces. Near a
 * junction this avoids picking the crossing road just because it is a hair closer.
 */
export function startLane(
  graph: Graph,
  rg: RouteGraph,
  from: { x: number; y: number; angle: number },
  roadWidth: number,
): { edge: RouteEdge; t: number } | null {
  const fx = -Math.sin(from.angle);
  const fy = -Math.cos(from.angle);
  let best: { edge: RouteEdge; t: number } | null = null;
  let bestScore = Infinity;
  for (const hit of graph.segmentsNear(from.x, from.y, roadWidth * 2.5)) {
    const s = hit.segment;
    const len = s.length() || 1;
    const dot = ((s.b.x - s.a.x) * fx + (s.b.y - s.a.y) * fy) / len;
    const forward = dot >= 0 ? rg.edge(s.a.id, s.id) : rg.edge(s.b.id, s.id);
    const backward = dot >= 0 ? rg.edge(s.b.id, s.id) : rg.edge(s.a.id, s.id);
    const e = forward ?? backward;
    if (!e) continue;
    const aligned = e === forward ? Math.abs(dot) : -Math.abs(dot);
    const score = hit.distance + (1 - aligned) * roadWidth * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = { edge: e, t: hit.t };
    }
  }
  return best;
}

/** Plans a route from a car pose to a node, a marking or a lane position. */
export function planRoute(
  graph: Graph,
  rg: RouteGraph,
  markings: MarkingStore,
  roadWidth: number,
  from: { x: number; y: number; angle: number },
  goal: RouteGoal,
): Route | null {
  const start = startLane(graph, rg, from, roadWidth);
  if (!start) return null;
  const se = start.edge;
  let nodes: number[];
  let endPos: Vec2 | null = null;
  let destinationMarking: number | null = null;
  if ('node' in goal) {
    const r = astarLanes(rg, se.index, goal.node);
    if (!r) return null;
    nodes = r.nodes;
  } else {
    const binding = 'marking' in goal ? goal.marking.binding : goal.lane;
    const ms = graph.getSegment(binding.segmentId);
    if (!ms) return null;
    const side = binding.side === -1 ? -1 : 1;
    const approachFrom = side === -1 ? ms.b.id : ms.a.id;
    const goalEdge = rg.edge(approachFrom, ms.id);
    if (!goalEdge) return null;
    // lane point of the destination
    const len = ms.length() || 1;
    const ux = (ms.b.x - ms.a.x) / len;
    const uy = (ms.b.y - ms.a.y) / len;
    endPos = {
      x: ms.a.x + (ms.b.x - ms.a.x) * binding.t - uy * side * (roadWidth / 4),
      y: ms.a.y + (ms.b.y - ms.a.y) * binding.t + ux * side * (roadWidth / 4),
    };
    const startT = se.from === ms.a.id ? start.t : 1 - start.t;
    const goalT = side === 1 ? binding.t : 1 - binding.t;
    if (se.index === goalEdge.index && startT < goalT - 0.02) nodes = [se.from, se.to];
    else {
      const r = astarToLane(rg, se.index, goalEdge.index);
      if (!r) return null;
      nodes = r.nodes;
    }
    if ('marking' in goal) destinationMarking = goal.marking.id;
  }
  const positions: Vec2[] = [];
  for (const id of nodes) {
    const p = rg.pos.get(id);
    if (!p) return null;
    positions.push(p);
  }
  const path = buildLanePath(nodes, positions, roadWidth);
  const tmp = new Float64Array(1);
  const sStart = projectOnPath(path, from.x, from.y, 0, Math.min(path.count, 24), tmp);
  let sEnd = path.length;
  if (endPos)
    sEnd = projectOnPath(path, endPos.x, endPos.y, Math.max(0, path.count - 24), path.count, tmp);
  if (sEnd <= sStart + 1) sEnd = Math.min(path.length, sStart + 1);
  return {
    path,
    sStart,
    sEnd,
    markings: routeMarkings(graph, rg, markings, roadWidth, nodes, path),
    destinationMarking,
  };
}

/** Markings that apply to the lanes driven along `nodes`, with their arc positions. */
function routeMarkings(
  graph: Graph,
  rg: RouteGraph,
  store: MarkingStore,
  roadWidth: number,
  nodes: readonly number[],
  path: LanePath,
): RouteMarking[] {
  const out: RouteMarking[] = [];
  const tmp = new Float64Array(1);
  for (let i = 0; i + 1 < nodes.length; i++) {
    const u = nodes[i] as number;
    const v = nodes[i + 1] as number;
    const e = rg.edgesFrom(u).find((x) => x.to === v);
    if (!e) continue;
    const seg = graph.getSegment(e.segmentId);
    if (!seg) continue;
    const side = seg.a.id === u ? 1 : -1;
    for (const m of store.boundTo(seg.id)) {
      if (m.type !== 'stop' && m.type !== 'yield' && m.type !== 'light' && m.type !== 'crossing')
        continue;
      if (m.type !== 'crossing' && m.binding.side !== side) continue;
      const r = resolveMarking(m, graph, roadWidth);
      if (!r) continue;
      const arc = projectOnPath(path, r.center.x, r.center.y, 0, path.count, tmp);
      const j = facedPoint(m, graph);
      out.push({
        id: m.id,
        kind: m.type,
        lineArc: m.type === 'crossing' ? arc : arc + r.height / 2,
        half: r.height / 2,
        jx: j ? j.x : r.center.x,
        jy: j ? j.y : r.center.y,
        stop: m.type === 'stop' ? new StopLogic() : null,
      });
    }
  }
  out.sort((a, b) => a.lineArc - b.lineArc);
  return out;
}

export class RouteFollower {
  config: FollowerConfig;
  route: Route | null = null;
  /** Current arc position along the path. */
  s = 0;
  arrived = false;
  needsReroute = false;
  /** Target speed chosen last step (units/s), for debugging and tests. */
  targetSpeed = 0;
  /** True while stopped by a marking or reservation (not counted as stuck). */
  holding = false;
  private hint = 0;
  private curveMax = new Float64Array(0);
  private readonly tmp = new Float64Array(2);
  private readonly lat = new Float64Array(1);
  private readonly held = new Set<number>();
  private roadWidth = 100;

  constructor(config: Partial<FollowerConfig> = {}) {
    this.config = { ...DEFAULT_FOLLOWER, ...config };
  }

  /** Installs a new route and precomputes curvature speed limits along it. */
  setRoute(route: Route | null, car: Car, roadWidth: number, env?: FollowerEnv): void {
    if (env) this.releaseAll(car, env);
    this.route = route;
    this.arrived = false;
    this.needsReroute = false;
    this.roadWidth = roadWidth;
    this.hint = 0;
    if (!route) return;
    this.s = route.sStart;
    const p = route.path;
    const n = p.count;
    this.curveMax = new Float64Array(n).fill(car.config.maxSpeed);
    for (let i = 1; i + 1 < n; i++) {
      const ax = (p.xy[i * 2] as number) - (p.xy[i * 2 - 2] as number);
      const ay = (p.xy[i * 2 + 1] as number) - (p.xy[i * 2 - 1] as number);
      const bx = (p.xy[i * 2 + 2] as number) - (p.xy[i * 2] as number);
      const by = (p.xy[i * 2 + 3] as number) - (p.xy[i * 2 + 1] as number);
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue;
      let turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      turn = Math.abs(turn);
      const k = turn / ((la + lb) / 2);
      if (k < 1e-5) continue;
      const v = Math.min(Math.sqrt(this.config.latAccel / k), (car.config.turnRate * 0.62) / k);
      this.curveMax[i] = v;
    }
  }

  /** Releases all junction reservations held by this car. */
  releaseAll(car: Car, env: FollowerEnv): void {
    for (const id of this.held) env.release(id, car.id);
    this.held.clear();
  }

  /** Computes this step's controls and writes them into `car.controls`. */
  update(car: Car, dt: number, env: FollowerEnv): void {
    const route = this.route;
    const c = car.controls;
    if (!route || this.arrived) {
      c.forward = 0;
      c.reverse = car.speed > 1 ? 1 : 0;
      c.left = c.right = 0;
      return;
    }
    const path = route.path;
    const cfg = this.config;
    const halfLen = car.config.length / 2;
    // progress along the path (search a window around the last segment)
    const s = projectOnPath(path, car.x, car.y, this.hint - 3, this.hint + 14, this.lat);
    if (s > this.s - 30) this.s = s;
    this.hint = pointAt(path, this.s, this.tmp, this.hint);
    if (this.lat[0]! > this.roadWidth * 0.9) this.needsReroute = true;
    const remaining = route.sEnd - this.s;

    // --- steering: pure pursuit
    const speed = car.speed;
    const ld = Math.max(26, Math.min(80, 0.28 * Math.abs(speed) + 24));
    pointAt(path, Math.min(this.s + ld, route.sEnd), this.tmp, this.hint);
    const dx = (this.tmp[0] as number) - car.x;
    const dy = (this.tmp[1] as number) - car.y;
    const fx = -Math.sin(car.angle);
    const fy = -Math.cos(car.angle);
    // left of forward in y-down space: (fy, -fx)
    const xf = dx * fx + dy * fy;
    const yl = dx * fy - dy * fx;
    const d2 = Math.max(1, dx * dx + dy * dy);
    let steer: number;
    if (xf < 0) steer = yl >= 0 ? 1 : -1;
    else {
      const kappa = (2 * yl) / d2;
      const omega = Math.max(Math.abs(speed), 25) * kappa;
      steer = Math.max(-1, Math.min(1, omega / car.config.turnRate));
    }
    c.left = steer > 0 ? steer : 0;
    c.right = steer < 0 ? -steer : 0;

    // --- target speed
    let v = car.config.maxSpeed * cfg.cruise;
    // curvature ahead, braking-aware
    const cum = path.cum;
    for (let i = this.hint; i < path.count; i++) {
      const d = (cum[i] as number) - this.s;
      if (d > 240) break;
      if (d < 0) continue;
      const lim = Math.sqrt((this.curveMax[i] ?? Infinity) ** 2 + 2 * cfg.decel * d);
      if (lim < v) v = lim;
    }
    // end of route
    v = Math.min(v, stoppingSpeed(remaining - 3, cfg.decel));
    // markings ahead
    let holding = false;
    const front = this.s + halfLen;
    for (const m of route.markings) {
      const dist = m.lineArc - front;
      if (dist < -m.half - halfLen * 2) continue;
      if (dist > 280) break;
      let lim = Infinity;
      if (m.kind === 'stop' && m.stop) {
        const clear = !env.crossTrafficNear(
          m.jx,
          m.jy,
          this.roadWidth * YIELD_DETECT_ROAD_WIDTHS,
          car,
        );
        const dcs = m.stop.update(dist, speed, dt, clear, cfg.decel, 200);
        lim = dcs.maxSpeed;
        if (dcs.phase === 'stopped' || dcs.phase === 'braking') holding = true;
      } else if (m.kind === 'light') {
        const color = env.lights ? env.lights.colorOf(m.id) : 'green';
        if (mustStopForLight(color, dist, speed, cfg.decel)) {
          lim = stoppingSpeed(dist - 4, cfg.decel);
          holding = true;
        }
      } else if (m.kind === 'yield') {
        const conflict = env.crossTrafficNear(
          m.jx,
          m.jy,
          this.roadWidth * YIELD_DETECT_ROAD_WIDTHS,
          car,
        );
        lim = yieldMaxSpeed(dist, conflict, car.config.maxSpeed, cfg.decel, 220);
        if (conflict && dist >= 0) holding = true;
      } else if (m.kind === 'crossing') {
        lim = crossingMaxSpeed(m.lineArc - this.s, m.half + halfLen, car.config.maxSpeed, 200);
      }
      if (lim < v) v = lim;
    }
    // car ahead (front rays)
    const gap = env.gapAhead(car);
    if (gap < Infinity) {
      const lim = gap <= cfg.safeGap ? 0 : stoppingSpeed(gap - cfg.safeGap, cfg.decel);
      if (lim < v) v = lim;
      if (lim < 1) holding = true;
    }
    // junction reservations: only one car inside an intersection at a time
    const nodeArc = path.nodeArc;
    for (let i = 0; i < nodeArc.length; i++) {
      const a = nodeArc[i] as number;
      if (Number.isNaN(a)) continue;
      const nodeId = path.nodes[i] as number;
      const entry = a - this.roadWidth * 0.95;
      const exit = a + this.roadWidth * 0.95;
      if (this.s - halfLen > exit) {
        if (this.held.has(nodeId)) {
          env.release(nodeId, car.id);
          this.held.delete(nodeId);
        }
        continue;
      }
      const dEntry = entry - front;
      if (dEntry > 90) break;
      if (this.held.has(nodeId)) continue;
      if (v > 1 && dEntry < 60) {
        if (env.reserve(nodeId, car.id)) this.held.add(nodeId);
        else {
          const lim = dEntry <= 2 ? 0 : stoppingSpeed(dEntry - 2, cfg.decel);
          if (lim < v) v = lim;
          holding = true;
        }
      }
      break; // only the next junction matters
    }
    this.holding = holding;
    this.targetSpeed = v;

    // --- throttle / brake
    if (v < 1 && speed < 4) {
      c.forward = 0;
      c.reverse = 0;
    } else {
      const err = v - speed;
      if (err > 0) {
        c.forward = Math.min(1, err / 40 + 0.15);
        c.reverse = 0;
      } else {
        c.forward = 0;
        c.reverse = speed > 0 ? Math.min(1, -err / 45) : 0;
      }
    }
    if (remaining < 14 && Math.abs(speed) < 8) this.arrived = true;
  }
}
