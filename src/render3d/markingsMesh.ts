/**
 * Markings in 3D (spec K7): stop and yield signs on posts with Canvas-text faces, zebra
 * stripes, parking bays with a "P" decal and sign, traffic-light poles with three
 * emissive lamps (bright enough to bloom), a checkered start arch and a target beacon
 * (vertical light beam plus a rotating ring).
 *
 * Every kind is one `InstancedMesh` (or one merged mesh for painted lines and stripes),
 * so the draw-call count does not grow with the number of markings. The meshes are
 * rebuilt only when the markings, the graph or the road width change; per frame only the
 * lamp colours and the beacon rings are rewritten in place.
 *
 * Orientation: for a marking travelling along d, a sign that faces approaching drivers
 * and a road decal whose text reads in the travel direction share the same yaw,
 * atan2(−d.x, −d.y) (the car heading convention).
 *
 * @module render3d/markingsMesh
 */
import * as THREE from 'three';
import { resolveMarking, type Marking, type ResolvedMarking } from '../engine/markings/marking.ts';
import { activeTarget } from '../engine/markings/target.ts';
import type { TrafficLightSystem } from '../engine/markings/trafficLightController.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import { Y_MARK } from './roadsMesh.ts';
import { checkerTexture, decalTexture, fadeTexture, textTexture } from './textures.ts';

const LAMP_COLORS = [
  new THREE.Color('#ff2d3b'),
  new THREE.Color('#ffc21a'),
  new THREE.Color('#22e07a'),
];
const PAINT = '#e6ebf3';

interface Placed {
  m: Marking;
  r: ResolvedMarking;
  yaw: number;
}

/** Shared, renderer-lifetime resources (textures, materials, base geometries). */
class Shared {
  readonly post = new THREE.CylinderGeometry(1.4, 1.6, 1, 8).translate(0, 0.5, 0);
  readonly plane = new THREE.PlaneGeometry(1, 1);
  readonly flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  readonly box = new THREE.BoxGeometry(1, 1, 1);
  readonly lamp = new THREE.SphereGeometry(1, 10, 8);
  readonly beam = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  readonly ring = new THREE.TorusGeometry(1, 0.09, 8, 40).rotateX(Math.PI / 2);
  readonly tex = {
    stop: textTexture('STOP', '#d91e2c', '#ffffff', 128, 'octagon'),
    yield: textTexture('YIELD', '#ffffff', '#d91e2c', 128, 'triangle'),
    park: textTexture('P', '#1f5fd6', '#ffffff', 128, 'square'),
    stopDecal: decalTexture('STOP', '#e6ebf3'),
    yieldDecal: decalTexture('YIELD', '#e6ebf3'),
    parkDecal: decalTexture('P', '#e6ebf3'),
    checker: checkerTexture(),
    fade: fadeTexture(),
  };
  readonly metal = new THREE.MeshStandardMaterial({
    color: '#6f7a8a',
    roughness: 0.6,
    metalness: 0.4,
  });
  readonly housing = new THREE.MeshStandardMaterial({ color: '#1a1f29', roughness: 0.7 });
  readonly paint = new THREE.MeshBasicMaterial({
    color: PAINT,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  });
  readonly lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  readonly beamMat: THREE.MeshBasicMaterial;
  readonly ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  readonly signMats: Record<'stop' | 'yield' | 'park', THREE.MeshStandardMaterial>;
  readonly decalMats: Record<'stop' | 'yield' | 'park', THREE.MeshBasicMaterial>;
  readonly bannerMat: THREE.MeshStandardMaterial;

  constructor() {
    const sign = (map: THREE.Texture): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        map,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.55,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: map,
        emissiveIntensity: 0.18,
      });
    const decal = (map: THREE.Texture): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
    this.signMats = {
      stop: sign(this.tex.stop),
      yield: sign(this.tex.yield),
      park: sign(this.tex.park),
    };
    this.decalMats = {
      stop: decal(this.tex.stopDecal),
      yield: decal(this.tex.yieldDecal),
      park: decal(this.tex.parkDecal),
    };
    this.bannerMat = new THREE.MeshStandardMaterial({
      map: this.tex.checker,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    this.beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.55, 1.4, 0.3),
      alphaMap: this.tex.fade,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  dispose(): void {
    for (const g of [this.post, this.plane, this.flat, this.box, this.lamp, this.beam, this.ring])
      g.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
    for (const m of [
      this.metal,
      this.housing,
      this.paint,
      this.lampMat,
      this.beamMat,
      this.ringMat,
      this.bannerMat,
    ])
      m.dispose();
    for (const m of Object.values(this.signMats)) m.dispose();
    for (const m of Object.values(this.decalMats)) m.dispose();
  }
}

/** Builds instance matrices with reused scratch objects. */
class Placer {
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  set(
    im: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    this.q.setFromAxisAngle(this.up, yaw);
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    im.setMatrixAt(i, this.m);
  }
}

/** Appends a flat quad (2 triangles) centred at (cx, cy) with half extents along u and its normal. */
function quad(
  out: number[],
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  halfLen: number,
  halfWid: number,
  y: number,
): void {
  const vx = -uy;
  const vy = ux;
  const ax = cx - ux * halfLen - vx * halfWid;
  const ay = cy - uy * halfLen - vy * halfWid;
  const bx = cx + ux * halfLen - vx * halfWid;
  const by = cy + uy * halfLen - vy * halfWid;
  const c2x = cx + ux * halfLen + vx * halfWid;
  const c2y = cy + uy * halfLen + vy * halfWid;
  const dx = cx - ux * halfLen + vx * halfWid;
  const dy = cy - uy * halfLen + vy * halfWid;
  out.push(ax, y, ay, c2x, y, c2y, bx, y, by, ax, y, ay, dx, y, dy, c2x, y, c2y);
}

function flatGeometry(tris: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
  return g;
}

export class MarkingMeshes {
  readonly group = new THREE.Group();
  private readonly shared = new Shared();
  private readonly place = new Placer();
  private key = '';
  private built: THREE.Object3D[] = [];
  private builtGeometries: THREE.BufferGeometry[] = [];
  private lamps: THREE.InstancedMesh | null = null;
  private lightIds: number[] = [];
  private rings: THREE.InstancedMesh | null = null;
  private beams: THREE.InstancedMesh | null = null;
  private targets: Placed[] = [];
  private activeTargetId = -1;
  private readonly levels = new Float32Array(3);
  private readonly color = new THREE.Color();
  /** Number of markings currently built (tests and stats). */
  count = 0;

  constructor() {
    this.group.name = 'markings';
  }

  private clear(): void {
    for (const o of this.built) {
      this.group.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
    }
    for (const g of this.builtGeometries) g.dispose();
    this.built = [];
    this.builtGeometries = [];
    this.lamps = null;
    this.rings = null;
    this.beams = null;
    this.lightIds = [];
    this.targets = [];
  }

  private instanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    n: number,
    name: string,
    shadow = false,
  ): THREE.InstancedMesh | null {
    if (n <= 0) return null;
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.name = name;
    im.castShadow = shadow;
    this.group.add(im);
    this.built.push(im);
    return im;
  }

  private merged(tris: number[], mat: THREE.Material, name: string): void {
    if (tris.length === 0) return;
    const g = flatGeometry(tris);
    this.builtGeometries.push(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    this.group.add(mesh);
    this.built.push(mesh);
  }

  private rebuild(model: WorldModel, rw: number): void {
    this.clear();
    const sh = this.shared;
    const placed: Record<string, Placed[]> = {
      stop: [],
      yield: [],
      crossing: [],
      parking: [],
      light: [],
      start: [],
      target: [],
    };
    for (const m of model.markings.all()) {
      const r = resolveMarking(m, model.graph, rw);
      if (!r) continue;
      placed[m.type]?.push({ m, r, yaw: Math.atan2(-r.direction.x, -r.direction.y) });
    }
    const list = (t: string): Placed[] => placed[t] ?? [];
    this.count = Object.values(placed).reduce((a, b) => a + b.length, 0);
    const kerb = rw / 4 + 9; // from the lane centre to the sidewalk
    const signs = [...list('stop'), ...list('yield'), ...list('parking')];
    const lights = list('light');
    const starts = list('start');
    const postCount = signs.length + lights.length + starts.length * 2;
    const posts = this.instanced(sh.post, sh.metal, postCount, 'markingPosts', true);
    const lines: number[] = [];
    const zebra: number[] = [];
    let pi = 0;
    const P = this.place;
    const side = (pl: Placed, dist: number): [number, number] => {
      // right of travel in y-down coordinates is (−dy, dx)
      const d = pl.r.direction;
      return [pl.r.center.x - d.y * dist, pl.r.center.y + d.x * dist];
    };
    // signs on posts + painted lines and decals
    const signKinds: [string, 'stop' | 'yield' | 'park'][] = [
      ['stop', 'stop'],
      ['yield', 'yield'],
      ['parking', 'park'],
    ];
    for (const [type, key] of signKinds) {
      const items = list(type);
      const faces = this.instanced(sh.plane, sh.signMats[key], items.length, `${type}Signs`, true);
      const decals = this.instanced(sh.flat, sh.decalMats[key], items.length, `${type}Decals`);
      items.forEach((pl, i) => {
        const [sx, sy] = side(pl, kerb);
        if (posts) P.set(posts, pi++, sx, 0, sy, pl.yaw, 1, 34, 1);
        if (faces) P.set(faces, i, sx, 40, sy, pl.yaw, 17, 17, 1);
        const d = pl.r.direction;
        const s = pl.r.height;
        if (decals)
          P.set(
            decals,
            i,
            pl.r.center.x - d.x * s * 0.1,
            Y_MARK + 0.2,
            pl.r.center.y - d.y * s * 0.1,
            pl.yaw,
            rw * 0.34,
            1,
            rw * 0.34,
          );
        if (type === 'stop')
          quad(
            lines,
            pl.r.center.x + d.x * s * 0.42,
            pl.r.center.y + d.y * s * 0.42,
            -d.y,
            d.x,
            pl.r.width / 2,
            2.6,
            Y_MARK + 0.1,
          );
        if (type === 'yield')
          for (let k = -2; k <= 2; k++) {
            const off = (k * pl.r.width) / 5.4;
            quad(
              lines,
              pl.r.center.x + d.x * s * 0.42 - d.y * off,
              pl.r.center.y + d.y * s * 0.42 + d.x * off,
              -d.y,
              d.x,
              pl.r.width / 14,
              2.2,
              Y_MARK + 0.1,
            );
          }
        if (type === 'parking') {
          // bay outline: two sides and the far end
          const hw = pl.r.width / 2;
          const hh = s / 2;
          const nx = -d.y;
          const ny = d.x;
          quad(
            lines,
            pl.r.center.x + nx * hw,
            pl.r.center.y + ny * hw,
            d.x,
            d.y,
            hh,
            1.6,
            Y_MARK + 0.1,
          );
          quad(
            lines,
            pl.r.center.x - nx * hw,
            pl.r.center.y - ny * hw,
            d.x,
            d.y,
            hh,
            1.6,
            Y_MARK + 0.1,
          );
          quad(
            lines,
            pl.r.center.x + d.x * hh,
            pl.r.center.y + d.y * hh,
            nx,
            ny,
            hw,
            1.6,
            Y_MARK + 0.1,
          );
        }
      });
    }
    // zebra crossings: stripes parallel to traffic across the whole road
    for (const pl of list('crossing')) {
      const d = pl.r.direction;
      const nx = -d.y;
      const ny = d.x;
      const n = Math.max(3, Math.floor(pl.r.width / 18));
      for (let k = 0; k < n; k++) {
        const off = -pl.r.width / 2 + (k + 0.5) * (pl.r.width / n);
        quad(
          zebra,
          pl.r.center.x + nx * off,
          pl.r.center.y + ny * off,
          d.x,
          d.y,
          pl.r.height * 0.42,
          pl.r.width / n / 3.4,
          Y_MARK + 0.1,
        );
      }
    }
    // traffic lights: pole, housing facing traffic, three lamps
    const housings = this.instanced(sh.box, sh.housing, lights.length, 'lightHousings', true);
    const lamps = this.instanced(sh.lamp, sh.lampMat, lights.length * 3, 'lightLamps');
    lights.forEach((pl, i) => {
      const [sx, sy] = side(pl, kerb);
      if (posts) P.set(posts, pi++, sx, 0, sy, pl.yaw, 1.3, 48, 1.3);
      if (housings) P.set(housings, i, sx, 58, sy, pl.yaw, 9, 26, 6);
      const d = pl.r.direction;
      // lamps sit on the housing face toward approaching cars (−d)
      for (let k = 0; k < 3; k++) {
        if (lamps)
          P.set(
            lamps,
            i * 3 + k,
            sx - d.x * 3.4,
            66 - k * 8,
            sy - d.y * 3.4,
            pl.yaw,
            2.8,
            2.8,
            2.8,
          );
        lamps?.setColorAt(i * 3 + k, LAMP_COLORS[k] as THREE.Color);
      }
      quad(
        lines,
        pl.r.center.x + d.x * pl.r.height * 0.42,
        pl.r.center.y + d.y * pl.r.height * 0.42,
        -d.y,
        d.x,
        pl.r.width / 2,
        2.6,
        Y_MARK + 0.1,
      );
      this.lightIds.push(pl.m.id);
    });
    this.lamps = lamps;
    // start arch: two posts and a checkered banner across the lane
    const banners = this.instanced(sh.plane, sh.bannerMat, starts.length, 'startBanners');
    starts.forEach((pl, i) => {
      const half = rw / 4 + 3;
      const [ax, ay] = side(pl, half);
      const [bx, by] = side(pl, -half);
      if (posts) {
        P.set(posts, pi++, ax, 0, ay, pl.yaw, 1.2, 50, 1.2);
        P.set(posts, pi++, bx, 0, by, pl.yaw, 1.2, 50, 1.2);
      }
      if (banners)
        P.set(banners, i, pl.r.center.x, 44, pl.r.center.y, pl.yaw, half * 2, half * 2, 1);
      const d = pl.r.direction;
      quad(lines, pl.r.center.x, pl.r.center.y, -d.y, d.x, pl.r.width / 2, 3, Y_MARK + 0.1);
    });
    // target beacons: additive beam + rotating ring (matrices animated per frame)
    this.targets = list('target');
    const active = activeTarget(this.targets.map((t) => t.m));
    this.activeTargetId = active ? active.id : -1;
    this.beams = this.instanced(sh.beam, sh.beamMat, this.targets.length, 'targetBeams');
    this.rings = this.instanced(sh.ring, sh.ringMat, this.targets.length, 'targetRings');
    this.targets.forEach((pl, i) => {
      const on = pl.m.id === this.activeTargetId;
      if (this.beams)
        P.set(
          this.beams,
          i,
          pl.r.center.x,
          0,
          pl.r.center.y,
          0,
          on ? 16 : 10,
          on ? 320 : 160,
          on ? 16 : 10,
        );
      this.rings?.setColorAt(i, this.color.setRGB(0.6, 2.4, 0.35).multiplyScalar(on ? 1 : 0.4));
    });
    this.merged(lines, sh.paint, 'markingLines');
    this.merged(zebra, sh.paint, 'zebraStripes');
    for (const o of this.built)
      if (o instanceof THREE.InstancedMesh) {
        o.instanceMatrix.needsUpdate = true;
        if (o.instanceColor) o.instanceColor.needsUpdate = true;
      }
  }

  /**
   * Rebuilds when the markings change and animates lamps and beacons.
   * @param timeSec seconds (beacon rotation and bob)
   */
  sync(
    model: WorldModel,
    rw: number,
    lights: TrafficLightSystem | null,
    timeSec: number,
    visible: boolean,
  ): void {
    this.group.visible = visible;
    if (!visible) return;
    const key = `${model.markings.version}|${model.graph.version}|${rw}`;
    if (key !== this.key) {
      this.key = key;
      this.rebuild(model, rw);
    }
    const lamps = this.lamps;
    if (lamps) {
      for (let i = 0; i < this.lightIds.length; i++) {
        const id = this.lightIds[i] as number;
        if (lights) lights.lampLevels(id, this.levels);
        else {
          this.levels[0] = 1;
          this.levels[1] = 0;
          this.levels[2] = 0;
        }
        for (let k = 0; k < 3; k++) {
          const lv = this.levels[k] as number;
          // off lamps stay faintly visible; lit lamps exceed 1 so they bloom
          this.color.copy(LAMP_COLORS[k] as THREE.Color).multiplyScalar(0.12 + lv * 3.2);
          lamps.setColorAt(i * 3 + k, this.color);
        }
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    }
    const rings = this.rings;
    if (rings) {
      for (let i = 0; i < this.targets.length; i++) {
        const pl = this.targets[i] as Placed;
        const on = pl.m.id === this.activeTargetId;
        const bob = Math.sin(timeSec * 2.4 + i) * 0.5 + 0.5;
        const r = on ? 26 : 18;
        this.place.set(
          rings,
          i,
          pl.r.center.x,
          12 + bob * 18,
          pl.r.center.y,
          timeSec * 1.3,
          r,
          r,
          r,
        );
      }
      rings.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
    this.shared.dispose();
  }
}
