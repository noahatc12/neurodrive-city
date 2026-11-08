/**
 * Post-processing and quality (spec K10): RenderPass → UnrealBloomPass → OutputPass
 * (ACES filmic tone mapping and sRGB output come from the renderer settings). The bloom
 * threshold sits just above the brightest lit surfaces, so only emissive things whose
 * colour exceeds 1 bloom: sensor rays, traffic lamps, beacons, headlights and lit
 * windows at night.
 *
 * Quality presets change the pixel-ratio cap, the shadow-map size and the bloom
 * resolution. {@link QualityGovernor} steps the preset down when the average frame time
 * stays above 20 ms for 3 s.
 *
 * @module render3d/postfx
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Device-pixel-ratio cap. */
  pixelRatio: number;
  /** Shadow-map size (0 disables shadows). */
  shadowMap: number;
  /** Bloom on/off and its render-target scale. */
  bloom: boolean;
  bloomScale: number;
}

export const QUALITY_PRESETS: Readonly<Record<Quality, QualityPreset>> = Object.freeze({
  low: { pixelRatio: 1, shadowMap: 0, bloom: false, bloomScale: 0.5 },
  medium: { pixelRatio: 1.5, shadowMap: 1024, bloom: true, bloomScale: 0.5 },
  high: { pixelRatio: 2, shadowMap: 2048, bloom: true, bloomScale: 1 },
});

export const QUALITY_ORDER: readonly Quality[] = ['low', 'medium', 'high'];

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private enabled = true;
  private scale = 1;
  private w = 1;
  private h = 1;

  constructor(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.gl = gl;
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(gl);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(width, height);
    this.bloom.setSize(
      Math.max(1, Math.round(width * this.scale)),
      Math.max(1, Math.round(height * this.scale)),
    );
  }

  /** Enables bloom (through the composer) or renders directly; sets the bloom scale. */
  configure(bloom: boolean, scale: number): void {
    this.enabled = bloom;
    this.scale = scale;
    this.setSize(this.w, this.h);
  }

  /** Bloom grows a little at night, when more of the scene is emissive. */
  setNight(night: number): void {
    this.bloom.strength = 0.5 + 0.3 * night;
    this.bloom.radius = 0.45 + 0.1 * night;
  }

  get bloomEnabled(): boolean {
    return this.enabled;
  }

  render(): void {
    if (this.enabled) this.composer.render();
    else this.gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.bloom.dispose();
    this.composer.dispose();
  }
}

/**
 * Watches frame times and asks for a lower preset when the average frame takes longer
 * than `budgetMs` for `holdSeconds` in a row.
 */
export class QualityGovernor {
  enabled = true;
  /** Exponential moving average of the frame time (ms). */
  avgMs = 16.7;
  private over = 0;
  private readonly budgetMs: number;
  private readonly holdSeconds: number;
  constructor(budgetMs = 20, holdSeconds = 3) {
    this.budgetMs = budgetMs;
    this.holdSeconds = holdSeconds;
  }

  /** Returns true when the caller should step the quality down now. */
  sample(frameMs: number): boolean {
    const ms = Math.min(250, Math.max(0, frameMs));
    this.avgMs += (ms - this.avgMs) * 0.1;
    if (!this.enabled) {
      this.over = 0;
      return false;
    }
    if (this.avgMs > this.budgetMs) this.over += ms / 1000;
    else this.over = 0;
    if (this.over >= this.holdSeconds) {
      this.over = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.over = 0;
    this.avgMs = 16.7;
  }
}
