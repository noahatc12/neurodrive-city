/**
 * Procedural low-poly car (spec K5), built from primitives: a bevelled body, a glass
 * cabin, four wheels, headlights and taillights. Car local frame: forward = −Z, up = +Y,
 * so an engine heading `a` is simply a rotation of `a` about Y.
 *
 * Dimensions follow the engine car (30 × 50 units ≈ 3 × 5 m).
 *
 * @module render3d/carMeshFactory
 */
import * as THREE from 'three';

export const CAR_W = 30;
export const CAR_L = 50;
export const WHEEL_R = 5.2;
export const WHEEL_W = 4.5;
/** Wheel positions in car space: front-left, front-right, rear-left, rear-right. */
export const WHEEL_POS: readonly (readonly [number, number, number])[] = [
  [-13.2, WHEEL_R, -16],
  [13.2, WHEEL_R, -16],
  [-13.2, WHEEL_R, 15],
  [13.2, WHEEL_R, 15],
];

function roundedRect(w: number, l: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -l / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + l - r);
  s.quadraticCurveTo(x + w, y + l, x + w - r, y + l);
  s.lineTo(x + r, y + l);
  s.quadraticCurveTo(x, y + l, x, y + l - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Shared geometries for all cars (created once per renderer). */
export interface CarGeometries {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  headlights: THREE.BufferGeometry;
  taillights: THREE.BufferGeometry;
  dispose(): void;
}

export function createCarGeometries(): CarGeometries {
  const body = new THREE.ExtrudeGeometry(roundedRect(CAR_W - 3, CAR_L - 3, 6), {
    depth: 8,
    bevelEnabled: true,
    bevelThickness: 2.2,
    bevelSize: 1.5,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // extrude goes along +Z: rotate so it goes up (+Y); shape Y becomes −Z (forward)
  body.rotateX(-Math.PI / 2);
  body.translate(0, 4.5, 0);
  body.computeVertexNormals();

  const cabin = new THREE.ExtrudeGeometry(roundedRect(CAR_W - 9, CAR_L * 0.42, 4), {
    depth: 6.5,
    bevelEnabled: true,
    bevelThickness: 2.5,
    bevelSize: 2.2,
    bevelSegments: 2,
    curveSegments: 3,
  });
  cabin.rotateX(-Math.PI / 2);
  cabin.translate(0, 15.5, 2.5);
  cabin.computeVertexNormals();

  const wheel = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 14);
  wheel.rotateZ(Math.PI / 2); // axle along X

  const head = new THREE.BoxGeometry(6, 2.4, 1.2);
  const headL = head.clone().translate(-8.5, 10, -CAR_L / 2 - 0.4);
  const headR = head.clone().translate(8.5, 10, -CAR_L / 2 - 0.4);
  const headlights = mergeTwo(headL, headR);
  const tail = new THREE.BoxGeometry(7, 2.2, 1.2);
  const tailL = tail.clone().translate(-8.5, 10.5, CAR_L / 2 + 0.4);
  const tailR = tail.clone().translate(8.5, 10.5, CAR_L / 2 + 0.4);
  const taillights = mergeTwo(tailL, tailR);
  head.dispose();
  tail.dispose();
  for (const g of [headL, headR, tailL, tailR]) g.dispose();
  return {
    body,
    cabin,
    wheel,
    headlights,
    taillights,
    dispose: () => {
      for (const g of [body, cabin, wheel, headlights, taillights]) g.dispose();
    },
  };
}

/** Merges two non-indexed copies of indexed geometries into one geometry. */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const na = a.toNonIndexed();
  const nb = b.toNonIndexed();
  const pa = na.getAttribute('position') as THREE.BufferAttribute;
  const pb = nb.getAttribute('position') as THREE.BufferAttribute;
  const pos = new Float32Array(pa.count * 3 + pb.count * 3);
  pos.set(pa.array, 0);
  pos.set(pb.array, pa.count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  na.dispose();
  nb.dispose();
  return g;
}

/** Shared materials for all cars. */
export interface CarMaterials {
  body: THREE.MeshStandardMaterial;
  cabin: THREE.MeshStandardMaterial;
  wheel: THREE.MeshStandardMaterial;
  headlights: THREE.MeshBasicMaterial;
  taillights: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createCarMaterials(): CarMaterials {
  const body = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.4,
    metalness: 0.12,
  });
  const cabin = new THREE.MeshStandardMaterial({
    color: '#3a4f6b',
    roughness: 0.18,
    metalness: 0.25,
  });
  const wheel = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.9 });
  const headlights = new THREE.MeshBasicMaterial({ color: '#fff3d1', toneMapped: false });
  const taillights = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  return {
    body,
    cabin,
    wheel,
    headlights,
    taillights,
    dispose: () => {
      for (const m of [body, cabin, wheel, headlights, taillights]) m.dispose();
    },
  };
}

/** A full-detail car (individual meshes) for the focused car: wheels spin and steer. */
export class DetailedCar {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly wheels: THREE.Mesh[] = [];
  readonly tail: THREE.Mesh;
  private spin = 0;

  constructor(geo: CarGeometries, mats: CarMaterials) {
    this.body = new THREE.Mesh(geo.body, mats.body.clone());
    this.body.castShadow = true;
    const cabin = new THREE.Mesh(geo.cabin, mats.cabin);
    cabin.castShadow = true;
    const head = new THREE.Mesh(geo.headlights, mats.headlights);
    this.tail = new THREE.Mesh(geo.taillights, mats.taillights.clone());
    this.group.add(this.body, cabin, head, this.tail);
    for (const [x, y, z] of WHEEL_POS) {
      const w = new THREE.Mesh(geo.wheel, mats.wheel);
      w.position.set(x, y, z);
      w.castShadow = true;
      w.rotation.order = 'YXZ';
      this.wheels.push(w);
      this.group.add(w);
    }
    this.group.name = 'focusedCar';
  }

  /** Places the car and animates wheels (spin from speed, yaw from steering). */
  update(
    x: number,
    z: number,
    angle: number,
    speed: number,
    steer: number,
    dt: number,
    color: THREE.Color,
    braking: boolean,
    damaged: boolean,
  ): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = angle;
    this.spin -= (speed * dt) / WHEEL_R;
    this.wheels.forEach((w, i) => {
      w.rotation.x = this.spin;
      w.rotation.y = i < 2 ? steer * 0.45 : 0;
    });
    const m = this.body.material as THREE.MeshStandardMaterial;
    m.color.copy(color);
    if (damaged) m.color.multiplyScalar(0.35);
    (this.tail.material as THREE.MeshBasicMaterial).color.setRGB(
      braking ? 3 : 0.9,
      braking ? 0.15 : 0.05,
      braking ? 0.2 : 0.08,
    );
  }

  dispose(): void {
    (this.body.material as THREE.Material).dispose();
    (this.tail.material as THREE.Material).dispose();
  }
}
