/**
 * Buildings as instanced unit boxes (spec K3): one draw call for every wall, one for
 * every pitched roof. Each footprint is a rectangle, so the instance matrix is just
 * translate(center, h/2) · rotateY(−angle) · scale(length, height, depth).
 *
 * The facade shader (patched into MeshStandardMaterial with onBeforeCompile) repeats a
 * window texture in world-sized cells using the instance scale, leaves roofs plain, and
 * lights a per-building random subset of windows at night (`uNight` uniform).
 *
 * @module render3d/buildingsMesh
 */
import * as THREE from 'three';
import type { WorldGeometry } from '../engine/world/world.ts';
import { facadeTextures } from './textures.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingData } from '../engine/world/types.ts';
import type { Vec2 } from '../engine/math/vec2.ts';

export interface BuildingMeshes {
  group: THREE.Group;
  /** 0 = day, 1 = night: drives lit windows. */
  setNight(n: number): void;
  dispose(): void;
}

const WINDOW_W = 34; // world units per window cell horizontally
const WINDOW_H = 38; // per floor

/** A triangular prism roof of unit size (ridge along local X, base at y = 0). */
function roofGeometry(): THREE.BufferGeometry {
  const h = 1;
  const v = [
    // gable ends
    -0.5,
    0,
    -0.5,
    -0.5,
    0,
    0.5,
    -0.5,
    h,
    0,
    0.5,
    0,
    0.5,
    0.5,
    0,
    -0.5,
    0.5,
    h,
    0,
    // slopes
    -0.5,
    0,
    0.5,
    0.5,
    0,
    0.5,
    0.5,
    h,
    0,
    -0.5,
    0,
    0.5,
    0.5,
    h,
    0,
    -0.5,
    h,
    0,
    0.5,
    0,
    -0.5,
    -0.5,
    0,
    -0.5,
    -0.5,
    h,
    0,
    0.5,
    0,
    -0.5,
    -0.5,
    h,
    0,
    0.5,
    h,
    0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

export function buildBuildingMeshes(geo: WorldGeometry): BuildingMeshes {
  const group = new THREE.Group();
  group.name = 'buildings';
  // procedural rectangles are instanced boxes; imported OSM footprints are extruded (J6)
  const data = geo.data.buildings.filter((b) => !b.osm);
  const osm = geo.data.buildings.filter((b) => b.osm === true);
  const n = data.length;
  const { map, emissive } = facadeTextures();
  const night = { value: 0 };
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const wallMat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: emissive,
    emissive: new THREE.Color('#ffcf8a'),
    emissiveIntensity: 1.35,
    roughness: 0.85,
    metalness: 0.05,
  });
  wallMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aLit;
        varying float vLit;
        varying float vRoof;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        float faceW = abs(normal.x) > 0.5 ? sc.z : sc.x;
        vRoof = normal.y > 0.5 ? 1.0 : 0.0;
        vMapUv = vec2(uv.x * faceW / ${WINDOW_W.toFixed(1)}, uv.y * sc.y / ${WINDOW_H.toFixed(1)}) * 0.25;
        vEmissiveMapUv = vMapUv;
        vLit = aLit;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying float vLit;
        varying float vRoof;
        float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vRoof > 0.5) diffuseColor.rgb = vec3(0.30, 0.33, 0.40);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
        // one random draw per window (sine-free hash: stable on software GPUs)
        vec2 cell = floor(vEmissiveMapUv * 4.0) + vec2(vLit * 517.0, vLit * 131.0);
        float h = hash21(cell);
        float lit = step(0.64, h) * (0.55 + 0.45 * fract(h * 7.31));
        totalEmissiveRadiance *= emissiveColor.rgb * lit * uNight * (1.0 - vRoof);`,
      );
  };
  const walls = new THREE.InstancedMesh(box, wallMat, Math.max(1, n));
  walls.name = 'buildingWalls';
  walls.castShadow = true;
  walls.receiveShadow = true;
  const lit = new Float32Array(Math.max(1, n));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const roofs = data.filter((b) => b.roof === 'pitched');
  const roofMesh = new THREE.InstancedMesh(
    roofGeometry(),
    new THREE.MeshStandardMaterial({ color: '#8a5a48', roughness: 0.8 }),
    Math.max(1, roofs.length),
  );
  roofMesh.name = 'buildingRoofs';
  roofMesh.castShadow = true;
  let r = 0;
  data.forEach((b, i) => {
    q.setFromAxisAngle(up, -b.angle);
    pos.set(b.center.x, 0, b.center.y);
    scl.set(b.length, b.height, b.depth);
    m4.compose(pos, q, scl);
    walls.setMatrixAt(i, m4);
    const warm = b.tint > 0.86;
    col.setHSL(
      warm ? 0.08 + b.tint * 0.03 : 0.6 + (b.tint - 0.5) * 0.08,
      warm ? 0.3 : 0.12 + b.tint * 0.1,
      0.62 + b.tint * 0.18,
    );
    walls.setColorAt(i, col);
    lit[i] = (b.detailSeed % 1000) / 1000;
    if (b.roof === 'pitched') {
      pos.set(b.center.x, b.height, b.center.y);
      scl.set(b.length, b.depth * 0.45, b.depth);
      m4.compose(pos, q, scl);
      roofMesh.setMatrixAt(r, m4);
      col.setHSL(warm ? 0.03 : 0.58, 0.3, 0.35 + b.tint * 0.15);
      roofMesh.setColorAt(r, col);
      r++;
    }
  });
  walls.count = n;
  roofMesh.count = roofs.length;
  box.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
  walls.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  roofMesh.instanceMatrix.needsUpdate = true;
  if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
  if (n > 0) group.add(walls);
  const footprints = osm.length > 0 ? extrudeFootprints(osm) : null;
  if (footprints) group.add(footprints);
  if (roofs.length > 0) group.add(roofMesh);
  return {
    group,
    setNight: (v) => {
      night.value = v;
    },
    dispose: () => {
      box.dispose();
      wallMat.dispose();
      map.dispose();
      emissive.dispose();
      roofMesh.geometry.dispose();
      (roofMesh.material as THREE.Material).dispose();
      walls.dispose();
      roofMesh.dispose();
      if (footprints) {
        footprints.geometry.dispose();
        (footprints.material as THREE.Material).dispose();
      }
    },
  };
}

/** Shape in the XY plane whose y is flipped, so rotateX(−π/2) maps it to (x, h, y). */
function flatShape(ring: readonly Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  ring.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.y) : shape.lineTo(p.x, -p.y)));
  shape.closePath();
  return shape;
}

/** Imported OSM footprints: every polygon extruded to its height, merged into one mesh. */
function extrudeFootprints(list: readonly BuildingData[]): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  const col = new THREE.Color();
  for (const b of list) {
    const g = new THREE.ExtrudeGeometry(flatShape(b.base), {
      depth: b.height,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    col.setHSL(0.58 + (b.tint - 0.5) * 0.06, 0.1 + b.tint * 0.08, 0.6 + b.tint * 0.15);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) return null;
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }),
  );
  mesh.name = 'osmBuildings';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Water polygons (J6) as one flat, glossy mesh just above the ground. */
export function buildWaterMesh(water: readonly (readonly Vec2[])[]): THREE.Mesh | null {
  if (water.length === 0) return null;
  const parts = water.map((ring) => new THREE.ShapeGeometry(flatShape(ring)).rotateX(-Math.PI / 2));
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) return null;
  merged.translate(0, 0.35, 0);
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshStandardMaterial({
      color: '#1f5a80',
      roughness: 0.12,
      metalness: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5,
    }),
  );
  mesh.name = 'water';
  mesh.receiveShadow = true;
  return mesh;
}
