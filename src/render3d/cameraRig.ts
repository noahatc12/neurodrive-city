/**
 * Camera rig (spec K9).
 *
 * - chase: behind and above the focused car; position and look-at follow with
 *   frame-rate independent exponential damping (1 − e^(−k·dt)); the FOV widens a little
 *   with speed.
 * - orbit: OrbitControls with damping; its target eases toward the focused car.
 * - top: a high camera looking almost straight down (orthographic feel).
 * - cinematic: a slow auto-orbit that glides between interesting cars every ~8 s.
 *
 * Mode changes never hard-cut: the camera blends from where it was to the new mode's
 * pose over 750 ms with easeInOutCubic.
 *
 * @module render3d/cameraRig
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { easeInOutCubic } from '../anim/easing.ts';
import type { CameraMode } from '../app/renderer.ts';

export interface CameraFocus {
  x: number;
  y: number;
  angle: number;
  speed: number;
  maxSpeed: number;
}

export const TWEEN_MS = 750;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CameraMode = 'orbit';
  /** Current look-at point. */
  readonly look = new THREE.Vector3();
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private tweenT = 1;
  private cineAngle = 0;
  private cineTargetIndex = 0;
  private cineTimer = 0;
  private readonly cineLook = new THREE.Vector3();
  /** Eased orbit target for minimap navigation. */
  private navTarget: THREE.Vector3 | null = null;
  reducedMotion = false;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 5, 40000);
    this.camera.position.set(0, 900, 900);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 9000;
    this.controls.screenSpacePanning = false;
    this.look.set(0, 0, 0);
    this.controls.target.copy(this.look);
  }

  /** True while blending between modes. */
  get tweening(): boolean {
    return this.tweenT < 1;
  }

  /** Switches mode with a smooth blend from the current pose. */
  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.fromPos.copy(this.camera.position);
    this.fromLook.copy(this.look);
    this.tweenT = 0;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') this.controls.target.copy(this.look);
  }

  /** Frames a world-space box (used when a 3D view opens on a new world). */
  frame(cx: number, cz: number, radius: number): void {
    this.look.set(cx, 0, cz);
    this.controls.target.copy(this.look);
    this.camera.position.set(cx + radius * 0.55, radius * 0.75, cz + radius * 0.85);
    this.camera.lookAt(this.look);
  }

  /** Eases the orbit target (and top camera) to a world point (minimap clicks). */
  panTo(x: number, z: number): void {
    this.navTarget = new THREE.Vector3(x, 0, z);
  }

  /**
   * Advances the rig.
   * @param focus focused car (null: free orbit)
   * @param cine candidate positions for the cinematic camera [x0, z0, x1, z1, ...]
   */
  update(
    dt: number,
    focus: CameraFocus | null,
    cine: Float64Array | null,
    cineCount: number,
  ): void {
    const cam = this.camera;
    const k = 1 - Math.exp(-4.5 * dt);
    let fov = 50;
    switch (this.mode) {
      case 'chase': {
        if (!focus) {
          this.wantPos.copy(cam.position);
          this.wantLook.copy(this.look);
          break;
        }
        const fx = -Math.sin(focus.angle);
        const fz = -Math.cos(focus.angle);
        this.wantPos.set(focus.x - fx * 150, 70, focus.y - fz * 150);
        this.wantLook.set(focus.x + fx * 90, 8, focus.y + fz * 90);
        const ratio = Math.min(1, Math.abs(focus.speed) / Math.max(1, focus.maxSpeed));
        fov = this.reducedMotion ? 55 : 55 + ratio * 9;
        break;
      }
      case 'top': {
        const cx = focus ? focus.x : this.look.x;
        const cz = focus ? focus.y : this.look.z;
        if (this.navTarget && !focus) {
          this.wantLook.lerp(this.navTarget, k);
        } else this.wantLook.set(cx, 0, cz);
        this.wantPos.set(this.wantLook.x, 1700, this.wantLook.z + 40);
        fov = 42;
        break;
      }
      case 'cinematic': {
        this.cineTimer += dt;
        if (cine && cineCount > 0 && (this.cineTimer > 8 || this.cineTargetIndex >= cineCount)) {
          this.cineTimer = 0;
          this.cineTargetIndex = (this.cineTargetIndex + 1) % cineCount;
        }
        if (cine && cineCount > 0) {
          const i = Math.min(this.cineTargetIndex, cineCount - 1);
          this.tmp.set(cine[i * 2] as number, 0, cine[i * 2 + 1]);
          this.cineLook.lerp(this.tmp, 1 - Math.exp(-0.8 * dt));
        } else if (focus) this.cineLook.set(focus.x, 0, focus.y);
        this.cineAngle += dt * (this.reducedMotion ? 0.04 : 0.12);
        const dist = 520 + 140 * Math.sin(this.cineAngle * 0.7);
        this.wantLook.copy(this.cineLook);
        this.wantPos.set(
          this.cineLook.x + Math.cos(this.cineAngle) * dist,
          260 + 80 * Math.sin(this.cineAngle * 0.5),
          this.cineLook.z + Math.sin(this.cineAngle) * dist,
        );
        fov = 45;
        break;
      }
      default: {
        // orbit: user controls the camera; the target eases toward the focus or nav point
        const t = this.controls.target;
        if (this.navTarget) {
          t.lerp(this.navTarget, k);
          if (t.distanceTo(this.navTarget) < 1) this.navTarget = null;
        } else if (focus) {
          this.tmp.set(focus.x, 0, focus.y);
          const before = this.tmp.clone().sub(t);
          t.lerp(this.tmp, 1 - Math.exp(-3 * dt));
          // keep the camera's offset so it follows the target rather than rotating
          cam.position.add(before.sub(this.tmp.clone().sub(t)));
        }
        this.controls.update();
        this.wantPos.copy(cam.position);
        this.wantLook.copy(t);
      }
    }

    if (this.tweenT < 1) {
      this.tweenT = Math.min(
        1,
        this.tweenT + (dt * 1000) / (this.reducedMotion ? TWEEN_MS / 3 : TWEEN_MS),
      );
      const e = easeInOutCubic(this.tweenT);
      cam.position.lerpVectors(this.fromPos, this.wantPos, e);
      this.look.lerpVectors(this.fromLook, this.wantLook, e);
      if (this.tweenT >= 1 && this.mode === 'orbit') this.controls.target.copy(this.look);
    } else if (this.mode === 'orbit') {
      this.look.copy(this.wantLook);
    } else {
      const kk = this.mode === 'chase' ? 1 - Math.exp(-6 * dt) : k;
      cam.position.lerp(this.wantPos, kk);
      this.look.lerp(this.wantLook, kk);
    }
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-3 * dt));
    cam.updateProjectionMatrix();
    cam.lookAt(this.look);
  }

  dispose(): void {
    this.controls.dispose();
  }
}
