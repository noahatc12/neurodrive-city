/**
 * Scene lighting and sky (spec K8): a hemisphere fill light, one shadow-casting
 * directional "sun", distance fog and a shader sky dome (vertical gradient, sun glow and
 * stars at night). The sun's shadow camera is an orthographic box fitted to the area
 * around the camera's look-at point; it follows that point and snaps to whole shadow-map
 * texels so shadows do not shimmer while the camera moves.
 *
 * Time of day `t` is in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
 * Everything derived from it (sun direction, colours, intensities, sky, fog and the
 * `night` factor that drives windows, lamps and headlights) is a smooth function of `t`,
 * so tweening `t` tweens the whole look.
 *
 * @module render3d/lighting
 */
import * as THREE from 'three';

const DAY_TOP = new THREE.Color('#4f8fd0');
const DAY_HORIZON = new THREE.Color('#b9dcf2');
const DUSK_TOP = new THREE.Color('#3b4f86');
const DUSK_HORIZON = new THREE.Color('#f0a477');
const NIGHT_TOP = new THREE.Color('#02040b');
const NIGHT_HORIZON = new THREE.Color('#0b1324');
const GROUND = new THREE.Color('#1c241f');
const SUN_DAY = new THREE.Color('#fff4e0');
const SUN_DUSK = new THREE.Color('#ffb074');
const MOON = new THREE.Color('#8fb3ff');

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uGround, pow(min(1.0, -h * 4.0), 0.6));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 8.0 + pow(s, 12.0) * 0.22) * (1.0 - uNight);
  if (uNight > 0.01 && h > 0.02) {
    vec3 cell = floor(d * 380.0);
    float n = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col += vec3(step(0.9984, n)) * uNight * 1.8 * smoothstep(0.02, 0.3, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Lighting {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fog: THREE.Fog;
  readonly sky: THREE.Mesh;
  /** Fog colour (the sky's horizon colour). */
  readonly horizon = new THREE.Color();
  /** 0 by day, 1 at night (drives window, lamp and headlight emissives). */
  night = 0;
  /** Current time of day in [0, 1). */
  timeOfDay = 0.42;
  /** Half-size of the shadow box in world units. */
  shadowRadius = 900;
  /** Shadow-casting light direction (the sun by day, the moon at night). */
  private readonly lightDir = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly u: {
    uTop: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uGround: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uNight: { value: number };
  };

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
    this.fog = new THREE.Fog('#b9dcf2', 2500, 12000);
    this.u = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: GROUND.clone() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 },
    };
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.u,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), this.skyMat);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.hemi, this.sun, this.sun.target, this.sky);
    scene.fog = this.fog;
    scene.background = null;
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
    const dusk = (1 - smoothstep(0.05, 0.45, Math.abs(elevation))) * (1 - this.night * 0.7);
    // the shadow light (sun by day, moon by night) stays high enough for readable shadows
    const el = Math.max(0.35, Math.abs(elevation));
    this.lightDir.set(Math.cos(a) * 0.8, el, 0.45).normalize();
    // the visible sun disk follows the real elevation (it sets below the horizon)
    this.u.uSunDir.value.set(Math.cos(a) * 0.8, elevation, 0.45).normalize();
    // sky gradient and fog
    this.u.uTop.value.copy(DAY_TOP).lerp(DUSK_TOP, dusk).lerp(NIGHT_TOP, this.night);
    this.horizon.copy(DAY_HORIZON).lerp(DUSK_HORIZON, dusk).lerp(NIGHT_HORIZON, this.night);
    this.u.uHorizon.value.copy(this.horizon);
    this.u.uNight.value = this.night;
    this.fog.color.copy(this.horizon);
    // sun / moon light
    this.tmpColor.copy(SUN_DAY).lerp(SUN_DUSK, dusk);
    this.u.uSunColor.value.copy(this.tmpColor);
    this.sun.color.copy(this.tmpColor).lerp(MOON, this.night);
    this.sun.intensity = 2.6 * (1 - this.night) + 0.32 * this.night;
    this.hemi.intensity = 1.15 * (1 - this.night) + 0.3 * this.night;
    this.hemi.color.set('#cfe4ff').lerp(MOON, this.night * 0.7);
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
      sx + this.lightDir.x * 2500,
      this.lightDir.y * 2500,
      sz + this.lightDir.z * 2500,
    );
    this.sun.target.updateMatrixWorld();
  }

  /** Keeps the sky dome centred on the camera. */
  centerSky(camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
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
    this.sky.geometry.dispose();
    this.skyMat.dispose();
  }
}
