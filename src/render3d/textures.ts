/**
 * Procedural textures drawn with Canvas 2D (no image assets): asphalt noise, the ground
 * grid and a building facade with windows (plus its emissive mask for night lighting).
 * @module render3d/textures
 */
import * as THREE from 'three';
import { Rng } from '../engine/math/rng.ts';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable for textures');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Fine-grained asphalt noise (tiles seamlessly in world space). */
export function asphaltTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const rng = new Rng(11);
  g.fillStyle = '#3d4350';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = rng.range(0, 1);
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${v * 0.05})` : `rgba(0,0,0,${(1 - v) * 0.12})`;
    g.fillRect(rng.int(0, 256), rng.int(0, 256), rng.chance(0.2) ? 2 : 1, 1);
  }
  return finish(c);
}

/** Ground: dark soil with subtle noise and a faint world grid. */
export function groundTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512);
  const rng = new Rng(12);
  g.fillStyle = '#4a5a4c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const r = rng.range(2, 14);
    g.fillStyle = rng.chance(0.5) ? 'rgba(90,130,90,0.12)' : 'rgba(0,0,0,0.10)';
    g.beginPath();
    g.arc(rng.range(0, 512), rng.range(0, 512), r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(34, 211, 238, 0.06)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 512, 512);
  return finish(c);
}

/**
 * Facade atlas, 4 × 4 window cells per tile: the colour map (concrete with darker glass)
 * and an emissive mask where windows are. Which windows are lit is decided per instance
 * in the shader, so one texture serves every building.
 */
export function facadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const size = 256;
  const [c, g] = canvas(size);
  const [e, ge] = canvas(size);
  g.fillStyle = '#b4bdca';
  g.fillRect(0, 0, size, size);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, size, size);
  const cell = size / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * cell + cell * 0.18;
      const py = y * cell + cell * 0.22;
      const w = cell * 0.64;
      const h = cell * 0.5;
      g.fillStyle = '#26303f';
      g.fillRect(px, py, w, h);
      g.fillStyle = 'rgba(160,190,220,0.18)';
      g.fillRect(px, py, w, h * 0.35);
      ge.fillStyle = '#ffd9a0';
      ge.fillRect(px + 2, py + 2, w - 4, h - 4);
    }
  }
  // subtle vertical panel lines
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let x = 0; x <= size; x += cell) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, size);
    g.stroke();
  }
  return { map: finish(c), emissive: finish(e, true, true) };
}

/** Canvas-text texture for road signs and decals (e.g. "STOP", "P"). */
export function textTexture(
  text: string,
  bg: string,
  fg: string,
  size = 128,
  shape: 'octagon' | 'square' | 'circle' = 'square',
): THREE.CanvasTexture {
  const [c, g] = canvas(size);
  g.clearRect(0, 0, size, size);
  g.fillStyle = bg;
  const r = size / 2;
  g.beginPath();
  if (shape === 'octagon') {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const x = r + Math.cos(a) * r * 0.96;
      const y = r + Math.sin(a) * r * 0.96;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  } else if (shape === 'circle') g.arc(r, r, r * 0.96, 0, Math.PI * 2);
  else g.roundRect(4, 4, size - 8, size - 8, size * 0.12);
  g.closePath();
  g.fill();
  g.lineWidth = size * 0.05;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = fg;
  g.font = `800 ${Math.round(size * (text.length > 2 ? 0.28 : 0.6))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, r, r + size * 0.03);
  return finish(c, false);
}
