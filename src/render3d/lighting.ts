/**
 * Scene lighting (spec K8 foundation): a hemisphere fill light, one shadow-casting
 * directional "sun" and distance fog. The sun's shadow camera is an orthographic box
 * fitted to the area around the camera's look-at point; it follows that point and snaps
 * to whole shadow-map texels so shadows do not shimmer while the camera moves.
 *
 * Time of day `t` is in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
 * Everything derived from it (sun direction, colours, intensities, fog and background,
 * the `night` factor that drives window lights) is a smooth function of `t`.
 *
 * @module render3d/lighting
 */
import * as THREE from 'three';

const DAY_SKY = new THREE.Color('#9ec9e8');
const DUSK_SKY = new THREE.Color('#e7a27a');
const NIGHT_SKY = new THREE.Color('#060a14');
const SUN_DAY = new THREE.Color('#fff4e0');
const SUN_DUSK = new THREE.Color('#ffb074');
const MOON = new THREE.Color('#8fb3ff');

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Lighting {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fog: THREE.Fog;
  /** Scene background colour (also the fog colour). */
  readonly sky = new THREE.Color();
  /** 0 by day, 1 at night (drives window and lamp emissives). */
  night = 0;
  /** Current time of day in [0, 1). */
  timeOfDay = 0.42;
  /** Half-size of the shadow box in world units. */
  shadowRadius = 900;
  private readonly sunDir = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#2a3326', 1.1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    const cam = this.sun.shadow.camera;
    cam.near = 10;
    cam.far = 6000;
    this.fog = new THREE.Fog('#9ec9e8', 2500, 12000);
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = this.fog;
    scene.background = this.sky;
    this.setTimeOfDay(this.timeOfDay);
    this.setShadowRadius(this.shadowRadius);
  }

  /** Sets the shadow-map resolution (quality presets) or disables shadows (size 0). */
  setShadowMapSize(size: number): void {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  setShadowRadius(r: number): void {
    this.shadowRadius = r;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
  }

  /** Applies a time of day: sun direction, colours, intensities, sky and fog. */
  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    const a = (this.timeOfDay - 0.25) * Math.PI * 2;
    const elevation = Math.sin(a); // −1 midnight … 1 noon
    this.night = 1 - smoothstep(-0.18, 0.12, elevation);
    const dusk = 1 - smoothstep(0.05, 0.4, Math.abs(elevation));
    // the sun (or the moon at night) sits high enough to keep shadows readable
    const el = Math.max(0.35, Math.abs(elevation));
    this.sunDir.set(Math.cos(a) * 0.8, el, 0.45).normalize();
    // sky and fog colour
    this.sky
      .copy(DAY_SKY)
      .lerp(DUSK_SKY, dusk * (1 - this.night) * 0.75)
      .lerp(NIGHT_SKY, this.night);
    this.fog.color.copy(this.sky);
    // sun / moon
    this.tmpColor.copy(SUN_DAY).lerp(SUN_DUSK, dusk);
    this.sun.color.copy(this.tmpColor).lerp(MOON, this.night);
    this.sun.intensity = 2.6 * (1 - this.night) + 0.35 * this.night;
    this.hemi.intensity = 1.15 * (1 - this.night) + 0.28 * this.night;
    this.hemi.color.set('#cfe4ff').lerp(MOON, this.night * 0.6);
  }

  /** Moves the sun and its shadow box to follow a world point (snapped to texels). */
  follow(x: number, z: number, viewRadius: number): void {
    const r = Math.min(2600, Math.max(500, viewRadius));
    if (Math.abs(r - this.shadowRadius) > this.shadowRadius * 0.25) this.setShadowRadius(r);
    const texel = (this.shadowRadius * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(
      sx + this.sunDir.x * 2500,
      this.sunDir.y * 2500,
      sz + this.sunDir.z * 2500,
    );
    this.sun.target.updateMatrixWorld();
  }

  /** Scales fog with the camera distance so far views stay readable. */
  fitFog(cameraDistance: number): void {
    this.fog.near = Math.max(1500, cameraDistance * 1.6);
    this.fog.far = this.fog.near + Math.max(8000, cameraDistance * 6);
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
  }
}
