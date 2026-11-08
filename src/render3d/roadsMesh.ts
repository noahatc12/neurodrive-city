/**
 * Ground, sidewalks, road surface and lane markings as a handful of merged meshes
 * (spec K2). Engine (x, y) maps to Three.js (x, 0, y); heights are tiny steps above the
 * ground plus polygonOffset so coplanar layers never z-fight.
 * @module render3d/roadsMesh
 */
import * as THREE from 'three';
import type { Seg } from '../engine/math/polygon.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import type { WorldGeometry } from '../engine/world/world.ts';
import { asphaltTexture, groundTexture } from './textures.ts';

export const Y_SIDEWALK = 0.6;
export const Y_ROAD = 1.2;
export const Y_MARK = 1.8;

/** Fan-triangulates convex polygons into one geometry with world-space UVs. */
export function convexPolygonsGeometry(
  polys: readonly (readonly Vec2[])[],
  y: number,
  uvScale: number,
): THREE.BufferGeometry {
  let tris = 0;
  for (const p of polys) tris += Math.max(0, p.length - 2);
  const pos = new Float32Array(tris * 9);
  const uv = new Float32Array(tris * 6);
  let o = 0;
  let u = 0;
  for (const p of polys) {
    const p0 = p[0];
    if (!p0) continue;
    for (let i = 1; i + 1 < p.length; i++) {
      const a = p[i] as Vec2;
      const b = p[i + 1] as Vec2;
      // counter-clockwise when seen from above (+Y): order p0, b, a in x/z
      for (const q of [p0, b, a]) {
        pos[o++] = q.x;
        pos[o++] = y;
        pos[o++] = q.y;
        uv[u++] = q.x * uvScale;
        uv[u++] = q.y * uvScale;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // force all normals up (fan order can vary with polygon winding)
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Thin flat quads along segments (lane lines, edge lines). */
export function stripsGeometry(
  segs: readonly { a: Vec2; b: Vec2 }[],
  width: number,
  y: number,
): THREE.BufferGeometry {
  const pos = new Float32Array(segs.length * 18);
  let o = 0;
  for (const s of segs) {
    const dx = s.b.x - s.a.x;
    const dz = s.b.y - s.a.y;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    const quad = [
      [s.a.x + nx, s.a.y + nz],
      [s.b.x + nx, s.b.y + nz],
      [s.b.x - nx, s.b.y - nz],
      [s.a.x + nx, s.a.y + nz],
      [s.b.x - nx, s.b.y - nz],
      [s.a.x - nx, s.a.y - nz],
    ];
    for (const [x, z] of quad) {
      pos[o++] = x as number;
      pos[o++] = y;
      pos[o++] = z as number;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Splits centre lines into dash segments (static dashes, spec C4). */
export function dashes(lines: readonly Seg[], dash: number, gap: number): { a: Vec2; b: Vec2 }[] {
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (const s of lines) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (len < 1) continue;
    const ux = (s.b.x - s.a.x) / len;
    const uy = (s.b.y - s.a.y) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      out.push({
        a: { x: s.a.x + ux * d, y: s.a.y + uy * d },
        b: { x: s.a.x + ux * e, y: s.a.y + uy * e },
      });
    }
  }
  return out;
}

export interface RoadMeshes {
  group: THREE.Group;
  dispose(): void;
}

/** Builds ground, sidewalk, road and marking meshes for a world geometry. */
export function buildRoadMeshes(geo: WorldGeometry, roadWidth: number): RoadMeshes {
  const group = new THREE.Group();
  group.name = 'roads';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const b = geo.data.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 3 + 8000;
  const groundTex = track(groundTexture());
  groundTex.repeat.set(size / 600, size / 600);
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(size, size)),
    track(
      new THREE.MeshStandardMaterial({
        map: groundTex,
        roughness: 1,
        metalness: 0,
        color: '#9fb3a6',
      }),
    ),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  const sidewalkMat = track(
    new THREE.MeshStandardMaterial({
      color: '#7d8696',
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  if (geo.data.sidewalks.length > 0) {
    const sw = new THREE.Mesh(
      track(convexPolygonsGeometry(geo.data.sidewalks, Y_SIDEWALK, 1 / 200)),
      sidewalkMat,
    );
    sw.receiveShadow = true;
    sw.name = 'sidewalks';
    group.add(sw);
  }
  const asphalt = track(asphaltTexture());
  const roadMat = track(
    new THREE.MeshStandardMaterial({
      map: asphalt,
      color: '#c9d2e3',
      roughness: 0.92,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const roads = new THREE.Mesh(
    track(
      convexPolygonsGeometry(
        geo.data.roads.map((r) => r.points),
        Y_ROAD,
        1 / 160,
      ),
    ),
    roadMat,
  );
  roads.receiveShadow = true;
  roads.name = 'roads';
  group.add(roads);

  // lane markings: emissive white strips (one merged mesh)
  const markMat = track(
    new THREE.MeshBasicMaterial({
      color: '#e8eef8',
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    }),
  );
  const center = dashes(geo.data.centerLines, roadWidth * 0.26, roadWidth * 0.24);
  const lines = [...center, ...geo.data.edgeLines];
  if (lines.length > 0) {
    const g = track(stripsGeometry(lines, roadWidth * 0.028, Y_MARK));
    const m = new THREE.Mesh(g, markMat);
    m.name = 'laneMarkings';
    group.add(m);
  }
  if (geo.data.arrows.length > 0) {
    const tris: number[] = [];
    const L = roadWidth * 0.22;
    const W = roadWidth * 0.1;
    for (const a of geo.data.arrows) {
      const c = Math.cos(a.angle);
      const s = Math.sin(a.angle);
      const P = (x: number, y: number): number[] => [
        a.x + x * c - y * s,
        Y_MARK,
        a.y + x * s + y * c,
      ];
      tris.push(...P(L, 0), ...P(L * 0.1, W), ...P(L * 0.1, -W));
      tris.push(...P(-L, W * 0.4), ...P(L * 0.12, W * 0.4), ...P(L * 0.12, -W * 0.4));
      tris.push(...P(-L, W * 0.4), ...P(L * 0.12, -W * 0.4), ...P(-L, -W * 0.4));
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
    const m = new THREE.Mesh(
      g,
      track(
        new THREE.MeshBasicMaterial({
          color: '#fbbf24',
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          toneMapped: false,
        }),
      ),
    );
    m.name = 'arrows';
    group.add(m);
  }
  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
