/**
 * Three.js renderer (spec K1 to K11). This module and everything it imports is
 * loaded on demand with a dynamic `import()`, so Three.js never weighs on the initial
 * bundle. Constructing it throws when a WebGL context cannot be created; the app catches
 * that, shows a toast and stays in 2D.
 *
 * Mapping: engine (x, y) → three (x, 0, y), Y up; a car heading `a` is a rotation of `a`
 * about +Y because car meshes face −Z.
 *
 * Per frame: car instances, sensor rays, particles, skid marks, headlight cones and lamp
 * colours are rewritten in place, the focused car gets a full-detail mesh and a real spot
 * light at night, the camera rig, the sun's shadow box and the sky follow, then the
 * frame goes through the bloom composer (or straight to the canvas on Low quality). Draw
 * calls and triangles come from `renderer.info` (reset manually so every pass counts).
 *
 * @module render3d/threeRenderer
 */
import * as THREE from 'three';
import type { CameraMode, FrameContext, PickResult, Renderer } from '../app/renderer.ts';
import { pickWorld } from '../app/picking.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import type { Car } from '../engine/car/car.ts';
import type { Sensor } from '../engine/car/sensor.ts';
import { CAR_COLORS } from '../engine/car/carFactory.ts';
import { InfiniteRoadSim } from '../engine/sim/infiniteRoad.ts';
import type { SimHost } from '../engine/sim/host.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import { CameraRig, type CameraFocus } from './cameraRig.ts';
import {
  createCarGeometries,
  createCarMaterials,
  DetailedCar,
  type CarGeometries,
  type CarMaterials,
} from './carMeshFactory.ts';
import { CarInstances, MAX_CARS } from './instancing.ts';
import { Lighting } from './lighting.ts';
import { buildWorldMeshes, InfiniteStrip, type WorldMeshes } from './sceneBuilder.ts';
import { Headlights, ParticleCloud, SensorRays, SkidTrail } from './effects.ts';
import { MarkingMeshes } from './markingsMesh.ts';
import { PostFX, QUALITY_ORDER, QUALITY_PRESETS, QualityGovernor, type Quality } from './postfx.ts';
import { easeInOutCubic } from '../anim/easing.ts';
import { Y_SIDEWALK } from './roadsMesh.ts';

const NO_CARS: readonly Car[] = [];
const NO_SENSORS: readonly Sensor[] = [];

/** Snapshot of renderer statistics for the debug hooks and the stats overlay. */
export interface ThreeStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  buildMs: number;
  builds: number;
  cameraMode: CameraMode;
  camera: [number, number, number];
  glRenderer: string;
  quality: Quality;
  autoQuality: boolean;
  bloom: boolean;
  shadows: boolean;
  timeOfDay: number;
  night: number;
  autoCycle: boolean;
  rays: number;
  markings: number;
  avgFrameMs: number;
  footprints: number;
  water: number;
}

/** Seconds for one full day in auto-cycle mode. */
export const DAY_SECONDS = 240;

export class ThreeRenderer implements Renderer {
  readonly kind = '3d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly lighting: Lighting;
  /** UNMASKED_RENDERER_WEBGL when the debug extension is available. */
  readonly glRenderer: string;
  drawCalls = 0;
  triangles = 0;
  buildMs = 0;
  builds = 0;
  /** True once the first frame with a world (or the infinite road) has rendered. */
  ready = false;
  /** Pixel-ratio cap (quality presets lower it). */
  pixelRatioCap = 2;
  private world: WorldMeshes | null = null;
  private strip: InfiniteStrip | null = null;
  private stripLanes = 0;
  private readonly carGeo: CarGeometries;
  private readonly carMats: CarMaterials;
  private readonly instances: CarInstances;
  private readonly detailed: DetailedCar;
  private readonly palette: THREE.Color[] = CAR_COLORS.map((c) => new THREE.Color(c));
  private readonly detailColor = new THREE.Color();
  private readonly focusInfo: CameraFocus = { x: 0, y: 0, angle: 0, speed: 0, maxSpeed: 1 };
  private readonly cine = new Float64Array(16);
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly flat = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lastSim: SimHost | null = null;
  private lastModel: WorldModel | null = null;
  private framedVersion = -1;
  private framedInfinite = false;
  private forceRebuild = false;
  private readonly sensors = new SensorRays();
  private readonly particles = new ParticleCloud(2048);
  private readonly skids = new SkidTrail(4096);
  private readonly headlights = new Headlights(MAX_CARS);
  private readonly markings = new MarkingMeshes();
  private readonly spot: THREE.SpotLight;
  readonly postfx: PostFX;
  readonly governor = new QualityGovernor(20, 3);
  quality: Quality = 'medium';
  /** Called when the governor lowers the quality on its own. */
  onAutoDowngrade: ((q: Quality) => void) | null = null;
  /** Auto day/night cycle. */
  autoCycle = false;
  private timeTween: { from: number; to: number; t: number; ms: number } | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas stage-3d';
    this.canvas.setAttribute('aria-label', '3D city view');
    this.canvas.setAttribute('role', 'img');
    // throws "Error creating WebGL context" when WebGL is unavailable
    this.gl = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    const gl = this.gl;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.info.autoReset = false;
    this.glRenderer = ThreeRenderer.rendererString(gl);
    this.rig = new CameraRig(this.canvas, 1);
    this.lighting = new Lighting(this.scene);
    this.carGeo = createCarGeometries();
    this.carMats = createCarMaterials();
    this.instances = new CarInstances(this.carGeo, this.carMats);
    this.detailed = new DetailedCar(this.carGeo, this.carMats);
    this.detailed.group.visible = false;
    // the focused car's real headlight (the others get additive cones)
    this.spot = new THREE.SpotLight('#ffe6b8', 0, 900, 0.5, 0.55, 1.1);
    this.spot.position.set(0, 11, -26);
    this.spot.target.position.set(0, 0, -260);
    this.detailed.group.add(this.spot, this.spot.target);
    this.scene.add(
      this.instances.group,
      this.detailed.group,
      this.sensors.group,
      this.particles.group,
      this.skids.mesh,
      this.headlights.mesh,
      this.markings.group,
    );
    this.postfx = new PostFX(gl, this.scene, this.rig.camera);
    this.setQuality(this.quality);
  }

  /** Applies a quality preset: pixel-ratio cap, shadow map size and bloom. */
  setQuality(q: Quality): void {
    this.quality = q;
    const p = QUALITY_PRESETS[q];
    this.pixelRatioCap = p.pixelRatio;
    this.lighting.setShadowMapSize(p.shadowMap);
    this.postfx.configure(p.bloom, p.bloomScale);
    this.resize(this.width, this.height, this.dpr);
    this.governor.reset();
  }

  /** Sets the time of day, optionally tweening there over `ms` (easeInOutCubic). */
  setTimeOfDay(t: number, ms = 0): void {
    if (ms <= 0) {
      this.timeTween = null;
      this.lighting.setTimeOfDay(t);
      return;
    }
    const from = this.lighting.timeOfDay;
    // take the short way round the clock
    let to = ((t % 1) + 1) % 1;
    if (to - from > 0.5) to -= 1;
    if (from - to > 0.5) to += 1;
    this.timeTween = { from, to, t: 0, ms };
  }

  get timeOfDay(): number {
    return this.lighting.timeOfDay;
  }

  private advanceTime(dtMs: number): void {
    const tw = this.timeTween;
    if (tw) {
      tw.t = Math.min(1, tw.t + dtMs / tw.ms);
      this.lighting.setTimeOfDay(tw.from + (tw.to - tw.from) * easeInOutCubic(tw.t));
      if (tw.t >= 1) this.timeTween = null;
    } else if (this.autoCycle) {
      this.lighting.setTimeOfDay(this.lighting.timeOfDay + dtMs / 1000 / DAY_SECONDS);
    }
  }

  private static rendererString(gl: THREE.WebGLRenderer): string {
    const ctx = gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    const v: unknown = ext
      ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : ctx.getParameter(ctx.RENDERER);
    return typeof v === 'string' ? v : 'unknown';
  }

  mount(container: HTMLElement): void {
    container.prepend(this.canvas);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.gl.setPixelRatio(Math.min(dpr, this.pixelRatioCap));
    this.gl.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.rig.camera.aspect = this.width / this.height;
    this.rig.camera.updateProjectionMatrix();
    // postfx is created after the first resize in the constructor
    if (this.postfx as PostFX | undefined) this.postfx.setSize(this.width, this.height);
  }

  /** Changes the pixel-ratio cap (quality presets) and reapplies the size. */
  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = cap;
    this.resize(this.width, this.height, this.dpr);
  }

  setCameraMode(mode: CameraMode): void {
    if (mode !== '2d-pan') this.rig.setMode(mode);
  }

  /** Eases the orbit target to a world point (minimap clicks in 3D). */
  panTo(p: Vec2): void {
    this.rig.panTo(p.x, p.y);
  }

  /** Projects a screen point (CSS pixels, relative to the canvas) onto the ground plane. */
  screenToGround(sx: number, sy: number, out: Vec2): boolean {
    this.ndc.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const ray = this.raycaster.ray;
    const p = ray.intersectPlane(this.groundPlane, this.hit);
    const cam = this.rig.camera.position;
    const maxDist = 7000;
    if (!p || p.distanceTo(cam) > maxDist) {
      // above the horizon (or very far): clamp to a point at maxDist along the ground
      this.flat.set(ray.direction.x, 0, ray.direction.z);
      if (this.flat.lengthSq() < 1e-9) return false;
      this.flat.normalize().multiplyScalar(maxDist);
      out.x = cam.x + this.flat.x;
      out.y = cam.z + this.flat.z;
      return true;
    }
    out.x = p.x;
    out.y = p.z;
    return true;
  }

  /** Projects a world point (engine x, y at ground level) to canvas CSS pixels. */
  worldToScreen(x: number, y: number): Vec2 {
    const v = this.hit.set(x, 0, y).project(this.rig.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** Camera footprint on the ground (4 corners) for the minimap. */
  footprint(out: Vec2[]): void {
    for (let i = 0; i < 4 && i < out.length; i++) {
      const o = out[i] as Vec2;
      // bottom-left, bottom-right, top-right, top-left
      const sx = i === 1 || i === 2 ? this.width : 0;
      const sy = i < 2 ? this.height : 0;
      if (!this.screenToGround(sx, sy, o)) {
        o.x = this.rig.look.x;
        o.y = this.rig.look.z;
      }
    }
  }

  pick(screenX: number, screenY: number): PickResult | null {
    const p = { x: 0, y: 0 };
    if (!this.screenToGround(screenX, screenY, p)) return null;
    return pickWorld(p.x, p.y, this.lastSim, this.lastModel);
  }

  /** Forces the world scene to be rebuilt on the next frame (memory checks). */
  rebuild(): void {
    this.forceRebuild = true;
  }

  stats(): ThreeStats {
    const info = this.gl.info;
    const cam = this.rig.camera.position;
    return {
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      buildMs: this.buildMs,
      builds: this.builds,
      cameraMode: this.rig.mode,
      camera: [cam.x, cam.y, cam.z],
      glRenderer: this.glRenderer,
      quality: this.quality,
      autoQuality: this.governor.enabled,
      bloom: this.postfx.bloomEnabled,
      shadows: this.lighting.sun.castShadow,
      timeOfDay: this.lighting.timeOfDay,
      night: this.lighting.night,
      autoCycle: this.autoCycle,
      rays: this.sensors.rayCount,
      markings: this.markings.count,
      avgFrameMs: this.governor.avgMs,
      footprints: this.world?.features.footprints ?? 0,
      water: this.world?.features.water ?? 0,
    };
  }

  private syncWorld(frame: FrameContext, infinite: InfiniteRoadSim | null): void {
    if (infinite) {
      if (this.world) this.world.group.visible = false;
      if (!this.strip || this.stripLanes !== infinite.config.lanes) {
        this.strip?.dispose();
        if (this.strip) this.scene.remove(this.strip.group);
        this.strip = new InfiniteStrip(infinite.config.lanes);
        this.stripLanes = infinite.config.lanes;
        this.scene.add(this.strip.group);
      }
      this.strip.group.visible = true;
      return;
    }
    if (this.strip) {
      this.scene.remove(this.strip.group);
      this.strip.dispose();
      this.strip = null;
      this.framedInfinite = false;
    }
    const geo = frame.geometry;
    if (!geo) return;
    const rw = frame.model.settings.roadWidth;
    if (
      this.forceRebuild ||
      !this.world ||
      this.world.version !== geo.version ||
      this.world.roadWidth !== rw
    ) {
      this.forceRebuild = false;
      if (this.world) {
        this.scene.remove(this.world.group);
        this.world.dispose();
      }
      this.world = buildWorldMeshes(geo, rw);
      this.buildMs = this.world.buildMs;
      this.builds++;
      this.scene.add(this.world.group);
    }
    this.world.group.visible = true;
    this.world.setLayers(frame.layers);
  }

  render(frame: FrameContext): void {
    const dt = Math.min(0.1, frame.dtMs / 1000);
    const sim = frame.sim;
    this.lastSim = sim;
    this.lastModel = frame.model;
    const infinite = sim instanceof InfiniteRoadSim ? sim : null;
    this.syncWorld(frame, infinite);

    // cars
    const focus = sim && frame.focusCarId !== null ? (sim.getCar(frame.focusCarId) ?? null) : null;
    this.instances.update(
      sim ? sim.cars : NO_CARS,
      frame.alpha,
      dt,
      focus ? focus.id : null,
      frame.bestCarId,
    );
    const d = this.detailed;
    if (focus && focus.active) {
      d.group.visible = true;
      const base = this.palette[focus.id === frame.bestCarId ? 3 : focus.color] ?? this.palette[0];
      if (base) this.detailColor.copy(base);
      d.update(
        focus.lerpX(frame.alpha),
        focus.lerpY(frame.alpha),
        focus.lerpAngle(frame.alpha),
        focus.speed,
        focus.steer,
        dt,
        this.detailColor,
        focus.braking,
        focus.damaged,
      );
    } else d.group.visible = false;

    // camera
    this.rig.reducedMotion = frame.reducedMotion;
    let fi: CameraFocus | null = null;
    if (focus) {
      const f = this.focusInfo;
      f.x = focus.lerpX(frame.alpha);
      f.y = focus.lerpY(frame.alpha);
      f.angle = focus.lerpAngle(frame.alpha);
      f.speed = focus.speed;
      f.maxSpeed = focus.config.maxSpeed;
      fi = f;
    }
    if (infinite && this.strip) this.strip.update(infinite, fi ? fi.y : this.rig.look.z);
    this.frameOnce(infinite);
    const n = this.cinematicTargets(sim, frame.bestCarId);
    this.rig.update(dt, fi, n > 0 ? this.cine : null, n);
    const look = this.rig.look;
    const cam = this.rig.camera;
    const dist = cam.position.distanceTo(look);
    this.lighting.follow(look.x, look.z, dist * 0.9);
    this.lighting.fitFog(dist);
    this.lighting.centerSky(cam);

    // time of day and everything driven by it
    this.advanceTime(frame.dtMs);
    const night = this.lighting.night;
    if (this.world) {
      this.world.trees.setTime(frame.reducedMotion ? 0 : frame.timeMs / 1000);
      this.world.buildings.setNight(night);
      this.world.streetLights.setNight(night);
    }
    this.postfx.setNight(night);
    this.spot.intensity = d.group.visible ? night * 2600 : 0;

    // markings, rays, particles, skid marks, headlights
    const rw = frame.model.settings.roadWidth;
    this.markings.sync(
      frame.model,
      rw,
      frame.lights,
      frame.timeMs / 1000,
      frame.layers.markings && !infinite,
    );
    if (sim) {
      this.sensors.update(frame.focusSensor, frame.extraSensors);
      this.particles.update(sim.particles, this.height, cam.fov);
      this.skids.update(sim.skids, sim.time, Y_SIDEWALK + 0.9);
      this.headlights.update(sim.cars, frame.alpha, night);
    } else {
      this.sensors.update(null, NO_SENSORS);
      this.headlights.update(NO_CARS, 0, 0);
    }
    this.particles.group.visible = sim !== null;
    this.skids.mesh.visible = sim !== null;

    this.gl.info.reset();
    this.postfx.render();
    this.drawCalls = this.gl.info.render.calls;
    this.triangles = this.gl.info.render.triangles;
    if (this.world || this.strip) this.ready = true;

    // auto-downgrade when frames stay slow
    if (this.governor.sample(frame.dtMs)) {
      const i = QUALITY_ORDER.indexOf(this.quality);
      if (i > 0) {
        const q = QUALITY_ORDER[i - 1] as Quality;
        this.setQuality(q);
        this.onAutoDowngrade?.(q);
      }
    }
  }

  /** Frames the whole world once per new world (orbit mode only). */
  private frameOnce(infinite: InfiniteRoadSim | null): void {
    if (infinite) {
      if (!this.framedInfinite) {
        this.framedInfinite = true;
        this.rig.frame(0, -400, 700);
      }
      return;
    }
    const w = this.world;
    if (!w || this.framedVersion === w.version) return;
    this.framedVersion = w.version;
    this.rig.frame(w.cx, w.cz, w.radius * 0.9);
  }

  /** Fills the cinematic candidate list: best car first, then a spread of live cars. */
  private cinematicTargets(sim: SimHost | null, bestId: number | null): number {
    if (!sim || this.rig.mode !== 'cinematic') return 0;
    let n = 0;
    const max = this.cine.length / 2;
    const best = bestId !== null ? sim.getCar(bestId) : undefined;
    if (best && best.active) {
      this.cine[0] = best.x;
      this.cine[1] = best.y;
      n = 1;
    }
    const cars = sim.cars;
    const stride = Math.max(1, Math.floor(cars.length / (max - 1)));
    for (let i = 0; i < cars.length && n < max; i += stride) {
      const c = cars[i];
      if (!c || !c.active || c.damaged || c === best) continue;
      this.cine[n * 2] = c.x;
      this.cine[n * 2 + 1] = c.y;
      n++;
    }
    return n;
  }

  dispose(): void {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
      this.world = null;
    }
    if (this.strip) {
      this.strip.dispose();
      this.strip = null;
    }
    this.instances.dispose();
    this.detailed.dispose();
    this.sensors.dispose();
    this.particles.dispose();
    this.skids.dispose();
    this.headlights.dispose();
    this.markings.dispose();
    this.postfx.dispose();
    this.carGeo.dispose();
    this.carMats.dispose();
    this.lighting.dispose();
    this.rig.dispose();
    this.gl.dispose();
    this.canvas.remove();
  }
}
