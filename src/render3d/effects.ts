/**
 * Dynamic 3D effects (spec K6, L2 in 3D), all with fixed-capacity buffers written in
 * place every frame (no per-frame allocation):
 *
 * - {@link SensorRays}: every visible ray in one `LineSegments` with additive blending and
 *   a per-vertex gradient from cyan at the car to hot magenta at a close hit, plus a
 *   glowing sprite at each hit point. Colours exceed 1 so the bloom pass picks them up.
 * - {@link ParticleCloud}: exhaust puffs and smoke (alpha blended) and collision sparks
 *   (additive) as two point clouds read straight from the engine's particle ring buffer.
 * - {@link SkidTrail}: tyre marks as quads in a ring-buffer mesh; each new engine mark is
 *   written once into its slot and faded in the shader from its birth time.
 * - {@link Headlights}: at night every car gets an additive light cone (instanced, faded
 *   along its length); the focused car also carries a real spot light (see threeRenderer).
 *
 * @module render3d/effects
 */
import * as THREE from 'three';
import { HIT_NONE } from '../engine/car/damage.ts';
import type { Sensor } from '../engine/car/sensor.ts';
import { P_SPARK, type Particles, type SkidMarks } from '../engine/sim/particlesSim.ts';
import type { Car } from '../engine/car/car.ts';
import { fadeTexture } from './textures.ts';

/** Ray height above the ground (car mid-height). */
const RAY_Y = 11;

/** Radial glow sprite drawn once on a small canvas. */
export function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

export class SensorRays {
  readonly group = new THREE.Group();
  private readonly maxRays: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly hitPos: Float32Array;
  private readonly hitCol: Float32Array;
  private readonly lineGeo = new THREE.BufferGeometry();
  private readonly hitGeo = new THREE.BufferGeometry();
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly hitMat: THREE.PointsMaterial;
  private readonly sprite: THREE.CanvasTexture;
  private rayN = 0;
  private hitN = 0;

  constructor(maxRays = 1600) {
    this.maxRays = maxRays;
    this.pos = new Float32Array(maxRays * 6);
    this.col = new Float32Array(maxRays * 6);
    this.hitPos = new Float32Array(maxRays * 3);
    this.hitCol = new Float32Array(maxRays * 3);
    this.lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.lineGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.hitGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.hitPos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.hitGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.hitCol, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sprite = glowTexture();
    this.hitMat = new THREE.PointsMaterial({
      size: 16,
      map: this.sprite,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const lines = new THREE.LineSegments(this.lineGeo, this.lineMat);
    const hits = new THREE.Points(this.hitGeo, this.hitMat);
    lines.frustumCulled = false;
    hits.frustumCulled = false;
    lines.name = 'sensorRays';
    hits.name = 'sensorHits';
    lines.renderOrder = 5;
    hits.renderOrder = 6;
    this.group.add(lines, hits);
  }

  /** Number of rays written last frame (tests and stats). */
  get rayCount(): number {
    return this.rayN;
  }

  private add(s: Sensor, bright: number): void {
    const p = this.pos;
    const c = this.col;
    for (let i = 0; i < s.rayCount && this.rayN < this.maxRays; i++) {
      const ox = s.rays[i * 4] as number;
      const oy = s.rays[i * 4 + 1] as number;
      const ex = s.rays[i * 4 + 2] as number;
      const ey = s.rays[i * 4 + 3] as number;
      const off = s.offsets[i] as number;
      const hx = ox + (ex - ox) * off;
      const hy = oy + (ey - oy) * off;
      const k = this.rayN * 6;
      p[k] = ox;
      p[k + 1] = RAY_Y;
      p[k + 2] = oy;
      p[k + 3] = hx;
      p[k + 4] = RAY_Y;
      p[k + 5] = hy;
      // origin: cyan
      c[k] = 0.13 * bright;
      c[k + 1] = 0.83 * bright;
      c[k + 2] = 0.93 * bright;
      const hit = s.kinds[i] !== HIT_NONE;
      if (hit) {
        // closer hits are hotter: blend cyan → magenta by (1 − offset)
        const heat = 1 - off;
        const r = (0.13 + (0.96 - 0.13) * heat) * bright * 1.3;
        const g = (0.83 + (0.28 - 0.83) * heat) * bright * 1.3;
        const b = (0.93 + (0.6 - 0.93) * heat) * bright * 1.3;
        c[k + 3] = r;
        c[k + 4] = g;
        c[k + 5] = b;
        if (this.hitN < this.maxRays) {
          const h = this.hitN * 3;
          this.hitPos[h] = hx;
          this.hitPos[h + 1] = RAY_Y;
          this.hitPos[h + 2] = hy;
          this.hitCol[h] = r;
          this.hitCol[h + 1] = g;
          this.hitCol[h + 2] = b;
          this.hitN++;
        }
      } else {
        // clear ray fades out toward its tip
        c[k + 3] = 0.13 * bright * 0.25;
        c[k + 4] = 0.83 * bright * 0.25;
        c[k + 5] = 0.93 * bright * 0.25;
      }
      this.rayN++;
    }
  }

  /** Writes the focused sensor (bright) and any extra sensors (dimmer). */
  update(focus: Sensor | null, extra: readonly Sensor[]): void {
    this.rayN = 0;
    this.hitN = 0;
    for (const s of extra) if (s !== focus) this.add(s, 0.9);
    if (focus) this.add(focus, 2.2);
    this.lineGeo.setDrawRange(0, this.rayN * 2);
    this.hitGeo.setDrawRange(0, this.hitN);
    (this.lineGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.lineGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.hitGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.hitGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.group.visible = this.rayN > 0;
  }

  dispose(): void {
    this.lineGeo.dispose();
    this.hitGeo.dispose();
    this.lineMat.dispose();
    this.hitMat.dispose();
    this.sprite.dispose();
  }
}

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const POINT_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vColor, vAlpha * (1.0 - r));
}`;

/** One point cloud (alpha or additive) with per-point size, alpha and colour. */
class PointCloud {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly color: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  constructor(capacity: number, additive: boolean) {
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    const dyn = (a: Float32Array, n: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    this.geo.setAttribute('aColor', dyn(this.color, 3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }
  setScale(s: number): void {
    (this.mat.uniforms.uScale as { value: number }).value = s;
  }
  commit(n: number): void {
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor'] as const)
      (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Exhaust, smoke and sparks from the engine's particle pool. */
export class ParticleCloud {
  readonly group = new THREE.Group();
  private readonly soft: PointCloud;
  private readonly sparks: PointCloud;

  constructor(capacity = 2048) {
    this.soft = new PointCloud(capacity, false);
    this.sparks = new PointCloud(capacity, true);
    this.soft.points.name = 'smoke';
    this.sparks.points.name = 'sparks';
    this.sparks.points.renderOrder = 4;
    this.group.add(this.soft.points, this.sparks.points);
  }

  /** Copies live particles; `viewportHeight` scales point sizes to the canvas. */
  update(p: Particles, viewportHeight: number, fovDeg: number): void {
    const scale = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.soft.setScale(scale);
    this.sparks.setScale(scale);
    let ns = 0;
    let nk = 0;
    const cap = Math.min(p.capacity, this.soft.size.length);
    for (let i = 0; i < cap; i++) {
      const life = p.life[i] as number;
      if (life <= 0) continue;
      const t = life / (p.maxLife[i] as number);
      const x = p.x[i] as number;
      const y = p.y[i] as number;
      if (p.type[i] === P_SPARK) {
        const k = nk * 3;
        this.sparks.pos[k] = x;
        this.sparks.pos[k + 1] = 6 + (1 - t) * 8;
        this.sparks.pos[k + 2] = y;
        this.sparks.size[nk] = 5;
        this.sparks.alpha[nk] = t;
        this.sparks.color[k] = 3.0;
        this.sparks.color[k + 1] = 1.4;
        this.sparks.color[k + 2] = 0.4;
        nk++;
      } else {
        const smoke = p.type[i] !== 0;
        const k = ns * 3;
        this.soft.pos[k] = x;
        this.soft.pos[k + 1] = 4 + (1 - t) * (smoke ? 26 : 12);
        this.soft.pos[k + 2] = y;
        this.soft.size[ns] = (p.size[i] as number) * 2.2;
        this.soft.alpha[ns] = smoke ? t * 0.6 : t * 0.3;
        const g = smoke ? 0.08 : 0.55;
        this.soft.color[k] = g;
        this.soft.color[k + 1] = g * 1.05;
        this.soft.color[k + 2] = g * 1.15;
        ns++;
      }
    }
    this.soft.commit(ns);
    this.sparks.commit(nk);
  }

  dispose(): void {
    this.soft.dispose();
    this.sparks.dispose();
  }
}

const SKID_VERT = /* glsl */ `
attribute float aBirth;
uniform float uTime;
uniform float uFade;
varying float vAlpha;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = clamp(1.0 - (uTime - aBirth) / uFade, 0.0, 1.0) * 0.55;
  #include <fog_vertex>
}`;

const SKID_FRAG = /* glsl */ `
varying float vAlpha;
#include <common>
#include <fog_pars_fragment>
void main() {
  if (vAlpha <= 0.0) discard;
  gl_FragColor = vec4(0.03, 0.03, 0.04, vAlpha);
  #include <fog_fragment>
}`;

/** Skid marks as a ring buffer of quads, faded by age in the shader. */
export class SkidTrail {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly birth: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private consumed = 0;
  private lastSource: SkidMarks | null = null;

  constructor(capacity = 4096, fadeSeconds = 12) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 4 * 3);
    this.birth = new Float32Array(capacity * 4).fill(-1e9);
    const idx = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      const o = i * 6;
      idx[o] = v;
      idx[o + 1] = v + 2;
      idx[o + 2] = v + 1;
      idx[o + 3] = v + 1;
      idx[o + 4] = v + 2;
      idx[o + 5] = v + 3;
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'aBirth',
      new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uFade: { value: fadeSeconds } },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'skidTrail';
    this.mesh.renderOrder = 2;
  }

  /** Writes marks added since the last call into their ring slots. */
  update(skids: SkidMarks, simTime: number, y: number): void {
    if (skids !== this.lastSource || skids.written < this.consumed) {
      this.lastSource = skids;
      this.consumed = Math.max(0, skids.written - this.capacity);
      this.birth.fill(-1e9);
    }
    const from = Math.max(this.consumed, skids.written - Math.min(this.capacity, skids.capacity));
    for (let n = from; n < skids.written; n++) {
      const src = skids.slotOf(n);
      const dst = n % this.capacity;
      const x1 = skids.seg[src * 4] as number;
      const y1 = skids.seg[src * 4 + 1] as number;
      const x2 = skids.seg[src * 4 + 2] as number;
      const y2 = skids.seg[src * 4 + 3] as number;
      const w = (skids.width[src] as number) / 2;
      let dx = x2 - x1;
      let dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const nx = -dy * w;
      const ny = dx * w;
      const p = this.pos;
      const o = dst * 12;
      p[o] = x1 + nx;
      p[o + 1] = y;
      p[o + 2] = y1 + ny;
      p[o + 3] = x1 - nx;
      p[o + 4] = y;
      p[o + 5] = y1 - ny;
      p[o + 6] = x2 + nx;
      p[o + 7] = y;
      p[o + 8] = y2 + ny;
      p[o + 9] = x2 - nx;
      p[o + 10] = y;
      p[o + 11] = y2 - ny;
      const t = skids.time[src] as number;
      this.birth[dst * 4] = t;
      this.birth[dst * 4 + 1] = t;
      this.birth[dst * 4 + 2] = t;
      this.birth[dst * 4 + 3] = t;
    }
    if (skids.written !== this.consumed) {
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aBirth') as THREE.BufferAttribute).needsUpdate = true;
      this.consumed = skids.written;
    }
    (this.mat.uniforms.uTime as { value: number }).value = simTime;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Night headlight cones for every active car: one instanced, additive mesh. */
export class Headlights {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly fade: THREE.CanvasTexture;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(30, 9, 150);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(capacity: number) {
    // apex at the origin, opening along −Z (car forward); v = 1 at the apex
    this.geo = new THREE.ConeGeometry(1, 1, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    this.fade = fadeTexture(true);
    this.mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffe2a8'),
      alphaMap: this.fade,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'headlightCones';
    this.mesh.renderOrder = 3;
  }

  /** Places a cone in front of every active, undamaged car; fades with `night`. */
  update(cars: readonly Car[], alpha: number, night: number): void {
    this.mat.opacity = night * 0.32;
    if (night < 0.02) {
      this.mesh.count = 0;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    let n = 0;
    const cap = this.mesh.instanceMatrix.count;
    for (let i = 0; i < cars.length && n < cap; i++) {
      const c = cars[i] as Car;
      if (!c.active || c.damaged) continue;
      const a = c.lerpAngle(alpha);
      const fx = -Math.sin(a);
      const fz = -Math.cos(a);
      this.p.set(c.lerpX(alpha) + fx * 25, 9, c.lerpY(alpha) + fz * 25);
      this.q.setFromAxisAngle(this.up, a);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.fade.dispose();
    this.mesh.dispose();
  }
}
