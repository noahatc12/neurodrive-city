/**
 * Instanced cars (spec K5): every car body, cabin, wheel, headlight and taillight in the
 * simulation is drawn by five InstancedMeshes, i.e. five draw calls for up to 1 100
 * cars. Matrices are composed in place each frame from interpolated poses with reused
 * scratch objects (no per-frame allocation). Wheels spin with speed and the front pair
 * yaws with steering; damaged cars are dimmed; braking brightens taillights.
 * @module render3d/instancing
 */
import * as THREE from 'three';
import type { Car } from '../engine/car/car.ts';
import { CAR_COLORS } from '../engine/car/carFactory.ts';
import { WHEEL_POS, WHEEL_R, type CarGeometries, type CarMaterials } from './carMeshFactory.ts';

export const MAX_CARS = 1100;

export class CarInstances {
  readonly group = new THREE.Group();
  readonly bodies: THREE.InstancedMesh;
  readonly cabins: THREE.InstancedMesh;
  readonly wheels: THREE.InstancedMesh;
  readonly heads: THREE.InstancedMesh;
  readonly tails: THREE.InstancedMesh;
  private readonly spin = new Float32Array(MAX_CARS);
  private readonly palette: THREE.Color[] = CAR_COLORS.map((c) => new THREE.Color(c));
  private readonly m = new THREE.Matrix4();
  private readonly w = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qw = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  private readonly tailOn = new THREE.Color(3, 0.15, 0.2);
  private readonly tailOff = new THREE.Color(0.9, 0.06, 0.09);
  private readonly dim = new THREE.Color(0.3, 0.32, 0.36);

  constructor(geo: CarGeometries, mats: CarMaterials) {
    this.bodies = new THREE.InstancedMesh(geo.body, mats.body, MAX_CARS);
    this.cabins = new THREE.InstancedMesh(geo.cabin, mats.cabin, MAX_CARS);
    this.wheels = new THREE.InstancedMesh(geo.wheel, mats.wheel, MAX_CARS * 4);
    this.heads = new THREE.InstancedMesh(geo.headlights, mats.headlights, MAX_CARS);
    this.tails = new THREE.InstancedMesh(geo.taillights, mats.taillights, MAX_CARS);
    for (const im of [this.bodies, this.cabins, this.wheels, this.heads, this.tails]) {
      im.frustumCulled = false; // instances move every frame
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    this.bodies.castShadow = true;
    this.cabins.castShadow = true;
    // allocate colour buffers up front
    this.bodies.setColorAt(0, this.c.set('#ffffff'));
    this.tails.setColorAt(0, this.tailOff);
    this.group.name = 'cars';
  }

  /**
   * Writes instances for every active car except `skipId` (drawn in full detail).
   * @param bestId highlighted in the "best" colour
   */
  update(
    cars: readonly Car[],
    alpha: number,
    dt: number,
    skipId: number | null,
    bestId: number | null,
  ): void {
    let n = 0;
    const count = Math.min(cars.length, MAX_CARS);
    for (let i = 0; i < count; i++) {
      const car = cars[i] as Car;
      this.spin[i] = (this.spin[i] as number) - (car.speed * dt) / WHEEL_R;
      if (!car.active || car.id === skipId) continue;
      const x = car.lerpX(alpha);
      const z = car.lerpY(alpha);
      const a = car.lerpAngle(alpha);
      this.q.setFromAxisAngle(this.up, a);
      this.p.set(x, 0, z);
      this.m.compose(this.p, this.q, this.s);
      this.bodies.setMatrixAt(n, this.m);
      this.cabins.setMatrixAt(n, this.m);
      this.heads.setMatrixAt(n, this.m);
      this.tails.setMatrixAt(n, this.m);
      const base = this.palette[car.id === bestId ? 3 : car.color] ?? this.palette[0];
      if (base) this.c.copy(base);
      if (car.damaged) this.c.multiply(this.dim);
      else if (car.kind === 'ai' && car.id !== bestId) this.c.multiplyScalar(0.75);
      this.bodies.setColorAt(n, this.c);
      this.tails.setColorAt(n, car.braking && !car.damaged ? this.tailOn : this.tailOff);
      for (let k = 0; k < 4; k++) {
        const wp = WHEEL_POS[k] as readonly [number, number, number];
        this.e.set(this.spin[i] as number, k < 2 ? car.steer * 0.45 : 0, 0);
        this.qw.setFromEuler(this.e);
        this.p.set(wp[0], wp[1], wp[2]);
        this.w.compose(this.p, this.qw, this.s);
        this.w.premultiply(this.m);
        this.wheels.setMatrixAt(n * 4 + k, this.w);
      }
      n++;
    }
    this.bodies.count = n;
    this.cabins.count = n;
    this.heads.count = n;
    this.tails.count = n;
    this.wheels.count = n * 4;
    for (const im of [this.bodies, this.cabins, this.wheels, this.heads, this.tails])
      im.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const im of [this.bodies, this.cabins, this.wheels, this.heads, this.tails]) im.dispose();
  }
}
