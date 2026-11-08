/**
 * Builds the static 3D scene for a world geometry (roads, sidewalks, markings, buildings,
 * trees) and the streaming road strip used by the infinite road mode.
 *
 * The world scene is rebuilt only when the geometry version or road width changes, and
 * every geometry, material and texture it creates is disposed with it, so GPU memory
 * returns to its baseline after a rebuild (checked by the sim3d e2e spec).
 *
 * @module render3d/sceneBuilder
 */
import * as THREE from 'three';
import type { LayerFlags } from '../app/renderer.ts';
import type { WorldGeometry } from '../engine/world/world.ts';
import type { InfiniteRoadSim } from '../engine/sim/infiniteRoad.ts';
import { buildBuildingMeshes, type BuildingMeshes } from './buildingsMesh.ts';
import { buildRoadMeshes, Y_MARK, Y_ROAD, type RoadMeshes } from './roadsMesh.ts';
import { asphaltTexture, groundTexture } from './textures.ts';
import { buildTreeMeshes, type TreeMeshes } from './treesMesh.ts';

export interface WorldMeshes {
  readonly group: THREE.Group;
  readonly roads: RoadMeshes;
  readonly buildings: BuildingMeshes;
  readonly trees: TreeMeshes;
  /** Geometry version and road width the scene was built for. */
  readonly version: number;
  readonly roadWidth: number;
  /** Wall-clock build time (ms). */
  readonly buildMs: number;
  /** Bounding circle of the world (for framing the camera). */
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  setLayers(layers: Readonly<LayerFlags>): void;
  dispose(): void;
}

/** Builds every static mesh for a world. */
export function buildWorldMeshes(geo: WorldGeometry, roadWidth: number): WorldMeshes {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'world';
  const roads = buildRoadMeshes(geo, roadWidth);
  const buildings = buildBuildingMeshes(geo);
  const trees = buildTreeMeshes(geo);
  group.add(roads.group, buildings.group, trees.group);
  const b = geo.data.bounds;
  const finite = Number.isFinite(b.minX) && b.maxX > b.minX;
  const cx = finite ? (b.minX + b.maxX) / 2 : 0;
  const cz = finite ? (b.minY + b.maxY) / 2 : 0;
  const radius = finite ? Math.max(400, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2) : 800;
  const byName = (name: string): THREE.Object3D | undefined => roads.group.getObjectByName(name);
  return {
    group,
    roads,
    buildings,
    trees,
    version: geo.version,
    roadWidth,
    buildMs: performance.now() - t0,
    cx,
    cz,
    radius,
    setLayers: (layers) => {
      const set = (name: string, on: boolean): void => {
        const o = byName(name);
        if (o) o.visible = on;
      };
      set('roads', layers.roads);
      set('sidewalks', layers.sidewalks);
      set('laneMarkings', layers.laneMarkings && layers.roads);
      set('arrows', layers.laneMarkings && layers.roads);
      buildings.group.visible = layers.buildings;
      trees.group.visible = layers.trees;
    },
    dispose: () => {
      roads.dispose();
      buildings.dispose();
      trees.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Infinite road strip
// ---------------------------------------------------------------------------

const SLICES = 96;
const STEP = 30;
const DASH = 50;

/** Static triangle indices for a ribbon of `slices` cross-sections (2 vertices each). */
function ribbonIndex(slices: number): THREE.BufferAttribute {
  const idx = new Uint16Array((slices - 1) * 6);
  for (let i = 0; i < slices - 1; i++) {
    const a = i * 2;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return new THREE.BufferAttribute(idx, 1);
}

/** A ribbon mesh whose vertices are rewritten in place every frame. */
class Ribbon {
  readonly geometry = new THREE.BufferGeometry();
  readonly pos: Float32Array;
  readonly uv: Float32Array;
  constructor(slices: number) {
    this.pos = new Float32Array(slices * 6);
    this.uv = new Float32Array(slices * 4);
    const normal = new Float32Array(slices * 6);
    for (let i = 0; i < slices * 2; i++) normal[i * 3 + 1] = 1;
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    this.geometry.setIndex(ribbonIndex(slices));
  }
  /** Writes cross-section `i` from x0 to x1 at depth z (u across, v along). */
  set(i: number, x0: number, x1: number, y: number, z: number, v: number): void {
    const p = this.pos;
    const o = i * 6;
    p[o] = x0;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = x1;
    p[o + 4] = y;
    p[o + 5] = z;
    const u = this.uv;
    const q = i * 4;
    u[q] = 0;
    u[q + 1] = v;
    u[q + 2] = 1;
    u[q + 3] = v;
  }
  commit(): void {
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 4, 31);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * The infinite road drawn around the focused car: verge, asphalt, solid edge lines and
 * dashed lane dividers as ribbons that follow the road's centre line, plus a ground
 * plane that tracks the camera in whole texture tiles (so its pattern never swims).
 * All buffers are allocated once; `update` only rewrites numbers.
 */
export class InfiniteStrip {
  readonly group = new THREE.Group();
  private readonly verge = new Ribbon(SLICES);
  private readonly asphalt = new Ribbon(SLICES);
  private readonly edges: Ribbon[] = [];
  private readonly dividers: Ribbon[] = [];
  private readonly ground: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(lanes: number) {
    this.group.name = 'infiniteRoad';
    const track = <T extends { dispose(): void }>(x: T): T => {
      this.disposables.push(x);
      return x;
    };
    const gtex = track(groundTexture());
    gtex.repeat.set(100, 100);
    this.ground = new THREE.Mesh(
      track(new THREE.PlaneGeometry(60000, 60000)),
      track(new THREE.MeshStandardMaterial({ map: gtex, color: '#9fb3a6', roughness: 1 })),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    const vergeMat = track(
      new THREE.MeshStandardMaterial({
        color: '#2c3a30',
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    const tex = track(asphaltTexture());
    tex.repeat.set(1, 1);
    const roadMat = track(
      new THREE.MeshStandardMaterial({
        map: tex,
        color: '#c9d2e3',
        roughness: 0.92,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    const lineMat = track(
      new THREE.MeshBasicMaterial({
        color: '#e8eef8',
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    const dash = track(dashTexture());
    const dashMat = track(
      new THREE.MeshBasicMaterial({
        color: '#e8eef8',
        map: dash,
        alphaTest: 0.5,
        transparent: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    const add = (r: Ribbon, m: THREE.Material, shadow: boolean): void => {
      track(r.geometry);
      const mesh = new THREE.Mesh(r.geometry, m);
      mesh.receiveShadow = shadow;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    };
    this.group.add(this.ground);
    add(this.verge, vergeMat, true);
    add(this.asphalt, roadMat, true);
    for (let k = 0; k < 2; k++) {
      const r = new Ribbon(SLICES);
      this.edges.push(r);
      add(r, lineMat, false);
    }
    for (let k = 1; k < lanes; k++) {
      const r = new Ribbon(SLICES);
      this.dividers.push(r);
      add(r, dashMat, false);
    }
  }

  /** Rewrites every ribbon for a window of road around world height `focusY`. */
  update(road: InfiniteRoadSim, focusY: number): void {
    const half = road.roadWidth / 2;
    const lw = road.config.laneWidth;
    const y0 = Math.ceil((focusY + 900) / STEP) * STEP;
    const line = 3;
    for (let i = 0; i < SLICES; i++) {
      const y = y0 - i * STEP;
      const cx = road.centerX(y);
      this.verge.set(i, cx - half - 60, cx + half + 60, Y_ROAD * 0.5, y, 0);
      this.asphalt.set(i, cx - half, cx + half, Y_ROAD, y, y / 160);
      const e0 = this.edges[0];
      const e1 = this.edges[1];
      if (e0) e0.set(i, cx - half + 2, cx - half + 2 + line, Y_MARK, y, 0);
      if (e1) e1.set(i, cx + half - 2 - line, cx + half - 2, Y_MARK, y, 0);
      for (let k = 0; k < this.dividers.length; k++) {
        const x = cx - half + (k + 1) * lw;
        this.dividers[k]?.set(i, x - 1.4, x + 1.4, Y_MARK, y, y / (DASH * 2));
      }
    }
    // asphalt u spans the road width in world units
    const uv = this.asphalt.uv;
    for (let i = 0; i < SLICES; i++) uv[i * 4 + 2] = road.roadWidth / 160;
    this.verge.commit();
    this.asphalt.commit();
    for (const r of this.edges) r.commit();
    for (const r of this.dividers) r.commit();
    // ground follows in whole 600-unit tiles
    const tile = 600;
    this.ground.position.set(0, 0, Math.round(focusY / tile) * tile);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
