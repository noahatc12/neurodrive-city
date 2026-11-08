/**
 * Street lights (spec K8): lamp posts along every road, alternating sides every ~380
 * units, placed just outside the carriageway (buildings keep at least `spacing` further
 * back). Three instanced meshes: posts, lamp heads and an additive light pool on the
 * ground. Heads and pools fade in with the `night` factor, and the heads exceed 1 so they
 * bloom.
 * @module render3d/streetLights
 */
import * as THREE from 'three';
import type { WorldGeometry } from '../engine/world/world.ts';
import { glowTexture } from './effects.ts';
import { Y_MARK } from './roadsMesh.ts';

export interface StreetLights {
  readonly group: THREE.Group;
  readonly count: number;
  setNight(n: number): void;
  dispose(): void;
}

const SPACING = 380;
const HEIGHT = 46;

export function buildStreetLights(geo: WorldGeometry, roadWidth: number): StreetLights {
  const spots: number[] = [];
  let side = 1;
  for (const s of geo.data.centerLines) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < SPACING * 0.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    const off = roadWidth / 2 + 10;
    for (let d = SPACING * 0.5; d < len; d += SPACING) {
      spots.push(s.a.x + ux * d - uy * off * side, s.a.y + uy * d + ux * off * side);
      side = -side;
    }
  }
  const n = spots.length / 2;
  const group = new THREE.Group();
  group.name = 'streetLights';
  const postGeo = new THREE.CylinderGeometry(1, 1.3, 1, 6).translate(0, 0.5, 0);
  const headGeo = new THREE.SphereGeometry(1, 8, 6);
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const postMat = new THREE.MeshStandardMaterial({
    color: '#5d6675',
    roughness: 0.6,
    metalness: 0.5,
  });
  const headMat = new THREE.MeshBasicMaterial({ color: '#ffd59a', toneMapped: false });
  const glow = glowTexture();
  const poolMat = new THREE.MeshBasicMaterial({
    color: '#ffcf8a',
    map: glow,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  const cap = Math.max(1, n);
  const posts = new THREE.InstancedMesh(postGeo, postMat, cap);
  const heads = new THREE.InstancedMesh(headGeo, headMat, cap);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, cap);
  posts.castShadow = true;
  posts.name = 'streetLightPosts';
  heads.name = 'streetLightHeads';
  pools.name = 'streetLightPools';
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const x = spots[i * 2] as number;
    const z = spots[i * 2 + 1] as number;
    posts.setMatrixAt(i, m.makeScale(1, HEIGHT, 1).setPosition(x, 0, z));
    heads.setMatrixAt(i, m.makeScale(3.2, 2.2, 3.2).setPosition(x, HEIGHT + 1, z));
    pools.setMatrixAt(i, m.makeScale(150, 1, 150).setPosition(x, Y_MARK + 0.4, z));
  }
  for (const im of [posts, heads, pools]) {
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (n > 0) group.add(im);
  }
  const warm = new THREE.Color('#ffd59a');
  return {
    group,
    count: n,
    setNight: (night) => {
      headMat.color.copy(warm).multiplyScalar(0.2 + night * 2.8);
      poolMat.opacity = night * 0.42;
      pools.visible = night > 0.02;
    },
    dispose: () => {
      for (const g of [postGeo, headGeo, poolGeo]) g.dispose();
      for (const mat of [postMat, headMat, poolMat]) mat.dispose();
      glow.dispose();
      for (const im of [posts, heads, pools]) im.dispose();
    },
  };
}
