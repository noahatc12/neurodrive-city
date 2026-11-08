/**
 * Trees as instanced meshes (spec K4): trunks, conifer cones and broadleaf icospheres:
 * three draw calls for any number of trees. Each instance gets a colour variation and
 * the canopy sways gently with a vertex-shader wind (time uniform via onBeforeCompile).
 * @module render3d/treesMesh
 */
import * as THREE from 'three';
import type { WorldGeometry } from '../engine/world/world.ts';

export interface TreeMeshes {
  group: THREE.Group;
  setTime(seconds: number): void;
  dispose(): void;
}

function windy(mat: THREE.MeshStandardMaterial, time: { value: number }, amount: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 ip = instanceMatrix[3].xz;
        float sway = sin(uTime * 1.3 + ip.x * 0.013 + ip.y * 0.017) + 0.4 * sin(uTime * 2.7 + ip.y * 0.021);
        float hgt = max(0.0, position.y);
        transformed.x += sway * ${amount.toFixed(3)} * hgt;
        transformed.z += sway * ${(amount * 0.6).toFixed(3)} * hgt;`,
      );
  };
}

export function buildTreeMeshes(geo: WorldGeometry): TreeMeshes {
  const group = new THREE.Group();
  group.name = 'trees';
  const trees = geo.data.trees;
  const time = { value: 0 };
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  coneGeo.translate(0, 0.5, 0);
  const ballGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4330', roughness: 1 });
  const coneMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.9,
    flatShading: true,
  });
  const ballMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.9,
    flatShading: true,
  });
  windy(coneMat, time, 0.05);
  windy(ballMat, time, 0.06);
  const conifers = trees.filter((t) => t.species === 1);
  const round = trees.filter((t) => t.species !== 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, trees.length));
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, Math.max(1, conifers.length));
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, Math.max(1, round.length));
  for (const m of [trunks, cones, balls]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  trunks.name = 'treeTrunks';
  cones.name = 'treeCones';
  balls.name = 'treeCanopies';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  trees.forEach((t, i) => {
    p.set(t.x, 0, t.y);
    s.set(t.radius * 0.9, t.height * (t.species === 1 ? 0.35 : 0.55), t.radius * 0.9);
    m4.compose(p, q, s);
    trunks.setMatrixAt(i, m4);
  });
  conifers.forEach((t, i) => {
    p.set(t.x, t.height * 0.22, t.y);
    s.set(t.radius, t.height * 0.95, t.radius);
    m4.compose(p, q, s);
    cones.setMatrixAt(i, m4);
    c.setHSL(0.4 + t.tint * 0.05, 0.45, 0.22 + t.tint * 0.1);
    cones.setColorAt(i, c);
  });
  round.forEach((t, i) => {
    const bush = t.species === 2;
    p.set(t.x, bush ? t.radius * 0.6 : t.height * 0.62, t.y);
    s.set(t.radius, t.radius * (bush ? 0.7 : 0.85), t.radius);
    m4.compose(p, q, s);
    balls.setMatrixAt(i, m4);
    c.setHSL(0.27 + t.tint * 0.08, 0.5, 0.24 + t.tint * 0.12);
    balls.setColorAt(i, c);
  });
  trunks.count = trees.length;
  cones.count = conifers.length;
  balls.count = round.length;
  for (const m of [trunks, cones, balls]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (m.count > 0) group.add(m);
  }
  return {
    group,
    setTime: (sec) => {
      time.value = sec;
    },
    dispose: () => {
      for (const g of [trunkGeo, coneGeo, ballGeo]) g.dispose();
      for (const m of [trunkMat, coneMat, ballMat]) m.dispose();
      for (const m of [trunks, cones, balls]) m.dispose();
    },
  };
}
