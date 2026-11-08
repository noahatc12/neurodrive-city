/**
 * Traffic (spec F4): route-following cars with random destinations. They are the moving
 * obstacles AI cars must learn to avoid. When a car arrives, it picks a new random
 * destination (sometimes a parking bay, where it parks for a few seconds); a damaged or
 * stuck car respawns elsewhere after a short delay.
 * @module engine/sim/traffic
 */
import type { Car } from '../car/car.ts';
import { createCar } from '../car/carFactory.ts';
import { HIT_NONE } from '../car/damage.ts';
import { Sensor } from '../car/sensor.ts';
import { headingFromDirection } from '../markings/start.ts';
import { RouteFollower, planRoute, type FollowerEnv } from '../nav/routeFollower.ts';
import type { Simulation } from './simulation.ts';

export interface TrafficStats {
  damageEvents: number;
  arrivals: number;
  parkings: number;
  respawns: number;
  stuckRespawns: number;
}

export class TrafficManager {
  readonly cars: Car[] = [];
  readonly followers: RouteFollower[] = [];
  readonly sensors: Sensor[] = [];
  readonly stats: TrafficStats = {
    damageEvents: 0,
    arrivals: 0,
    parkings: 0,
    respawns: 0,
    stuckRespawns: 0,
  };
  /** Cars currently parked (HUD). */
  parkedNow = 0;
  private respawnAt: Float64Array;
  private stuckFor: Float64Array;
  private holdFor: Float64Array;
  private parkedUntil: Float64Array;
  private readonly sim: Simulation;

  constructor(sim: Simulation, count: number, firstId: number) {
    this.sim = sim;
    this.respawnAt = new Float64Array(count).fill(-1);
    this.stuckFor = new Float64Array(count);
    this.holdFor = new Float64Array(count);
    this.parkedUntil = new Float64Array(count).fill(-1);
    for (let i = 0; i < count; i++) {
      const car = createCar(firstId + i, 'traffic');
      car.tag = i;
      this.cars.push(car);
      this.followers.push(new RouteFollower());
      this.sensors.push(new Sensor({ rayCount: 5, spread: Math.PI / 3, length: 140 }));
    }
  }

  get count(): number {
    return this.cars.length;
  }

  /** Places every car and gives it a destination. */
  spawnAll(env: FollowerEnv): void {
    for (let i = 0; i < this.cars.length; i++) this.respawn(i, env, false);
  }

  /** Puts car i at a random free lane position (or deactivates it if none is found). */
  respawn(i: number, env: FollowerEnv, count = true): void {
    const car = this.cars[i];
    const follower = this.followers[i];
    if (!car || !follower) return;
    follower.releaseAll(car, env);
    const sim = this.sim;
    const g = sim.model.graph;
    const segs = g.segments;
    const rw = sim.model.settings.roadWidth;
    car.active = false;
    if (segs.length === 0) return;
    for (let attempt = 0; attempt < 30; attempt++) {
      const s = segs[sim.rng.int(0, segs.length)];
      if (!s || s.length() < rw * 2.5) continue;
      const forward = s.oneWay || sim.rng.chance(0.5);
      const t = sim.rng.range(0.3, 0.7);
      const ax = forward ? s.a.x : s.b.x;
      const ay = forward ? s.a.y : s.b.y;
      const bx = forward ? s.b.x : s.a.x;
      const by = forward ? s.b.y : s.a.y;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const x = ax + (bx - ax) * t - uy * (rw / 4);
      const y = ay + (by - ay) * t + ux * (rw / 4);
      if (sim.anyCarWithin(x, y, 90, car.id)) continue;
      car.reset(x, y, headingFromDirection(ux, uy));
      car.active = true;
      this.stuckFor[i] = 0;
      this.holdFor[i] = 0;
      this.parkedUntil[i] = -1;
      this.respawnAt[i] = -1;
      if (!this.newDestination(i, env)) {
        car.active = false;
        continue;
      }
      if (count) this.stats.respawns++;
      return;
    }
  }

  /** Picks a random destination (node or parking bay) and plans the route. */
  newDestination(i: number, env: FollowerEnv): boolean {
    const car = this.cars[i];
    const follower = this.followers[i];
    if (!car || !follower) return false;
    const sim = this.sim;
    const rw = sim.model.settings.roadWidth;
    const parkings = sim.model.markings.ofType('parking');
    for (let attempt = 0; attempt < 8; attempt++) {
      let route = null;
      if (parkings.length > 0 && sim.rng.chance(0.15)) {
        const p = parkings[sim.rng.int(0, parkings.length)];
        if (p)
          route = planRoute(sim.model.graph, sim.routeGraph, sim.model.markings, rw, car, {
            marking: p,
          });
      } else {
        // a random mid-block lane position, so the next route starts cleanly in a lane
        const edges = sim.routeGraph.edges;
        const e = edges[sim.rng.int(0, edges.length)];
        const seg = e ? sim.model.graph.getSegment(e.segmentId) : undefined;
        if (!e || !seg || seg.length() < rw * 2.5) continue;
        const side = seg.a.id === e.from ? 1 : -1;
        const t = sim.rng.range(0.3, 0.7);
        const mx = seg.a.x + (seg.b.x - seg.a.x) * t;
        const my = seg.a.y + (seg.b.y - seg.a.y) * t;
        if (Math.hypot(mx - car.x, my - car.y) < rw * 6) continue;
        route = planRoute(sim.model.graph, sim.routeGraph, sim.model.markings, rw, car, {
          lane: { segmentId: seg.id, t, side },
        });
      }
      if (route && route.sEnd - route.sStart > rw) {
        follower.setRoute(route, car, rw, env);
        return true;
      }
    }
    return false;
  }

  /** One simulation step for all traffic cars. */
  step(dt: number, env: FollowerEnv): void {
    const sim = this.sim;
    const t = sim.time;
    let parked = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i] as Car;
      const follower = this.followers[i] as RouteFollower;
      const sensor = this.sensors[i] as Sensor;
      if (!car.active) {
        if ((this.respawnAt[i] as number) >= 0 && t >= (this.respawnAt[i] as number))
          this.respawn(i, env);
        continue;
      }
      if (car.damaged) {
        if ((this.respawnAt[i] as number) < 0) this.respawnAt[i] = t + 2.5;
        else if (t >= (this.respawnAt[i] as number)) this.respawn(i, env);
        car.updatePhysics(dt);
        continue;
      }
      // parked: wait, then leave for a new destination
      if ((this.parkedUntil[i] as number) >= 0) {
        parked++;
        car.controls.forward = car.controls.reverse = car.controls.left = car.controls.right = 0;
        car.updatePhysics(dt);
        if (t >= (this.parkedUntil[i] as number)) {
          this.parkedUntil[i] = -1;
          if (!this.newDestination(i, env)) this.respawn(i, env);
        }
        continue;
      }
      sensor.update(car, sim.world, true);
      follower.update(car, dt, env);
      car.updatePhysics(dt);
      sim.afterMove(car);
      const hit = sim.world.polygonHit(car.polygon, car.id);
      if (hit !== HIT_NONE) {
        sim.damage(car);
        this.stats.damageEvents++;
        follower.releaseAll(car, env);
        this.respawnAt[i] = t + 2.5;
        continue;
      }
      if (follower.arrived) {
        this.stats.arrivals++;
        if (
          follower.route?.destinationMarking !== null &&
          follower.route?.destinationMarking !== undefined
        ) {
          this.stats.parkings++;
          this.parkedUntil[i] = t + sim.rng.range(4, 8);
          follower.releaseAll(car, env);
        } else if (!this.newDestination(i, env)) this.respawn(i, env);
        continue;
      }
      if (follower.needsReroute && !this.newDestination(i, env)) {
        this.respawn(i, env);
        continue;
      }
      // stuck detection (not counting legitimate waits at markings or behind cars)
      if (Math.abs(car.speed) < 3) {
        if (follower.holding) this.holdFor[i] = (this.holdFor[i] as number) + dt;
        else this.stuckFor[i] = (this.stuckFor[i] as number) + dt;
      } else {
        this.stuckFor[i] = 0;
        this.holdFor[i] = 0;
      }
      if ((this.stuckFor[i] as number) > 6 || (this.holdFor[i] as number) > 30) {
        this.stats.stuckRespawns++;
        this.respawn(i, env);
      }
    }
    this.parkedNow = parked;
  }

  /** Fraction of the fleet damaged so far (damage events / car count). */
  damageRate(): number {
    return this.cars.length === 0 ? 0 : this.stats.damageEvents / this.cars.length;
  }
}
