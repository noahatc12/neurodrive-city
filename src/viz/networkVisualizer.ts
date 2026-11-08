/**
 * Live neural network visualizer (spec H1–H5): the focused car's brain, drawn as layers
 * of nodes from inputs (bottom, with ray glyphs) to outputs (top, ↑ ← → ↓).
 *
 * - Connections: colour by weight sign (warm = positive, cool = negative), opacity by
 *   magnitude, dashed with a dash offset that scrolls toward the outputs; connections
 *   whose source neuron is firing flow faster and brighter.
 * - Nodes: the bias is an outer ring (sign colour, width by magnitude), the activation
 *   is the fill; an output that fires pops with a spring and glows.
 * - Performance: the static layer (background, rings, labels) is cached to an offscreen
 *   canvas and rebuilt only when the network's weights change; dynamic drawing runs at
 *   most 30 times per second and only while the panel is visible.
 *
 * @module viz/networkVisualizer
 */
import { Spring } from '../anim/springs.ts';
import type { Level, NeuralNetwork } from '../engine/ai/network.ts';

const POS = '#fbbf24'; // warm (positive)
const NEG = '#22d3ee'; // cool (negative)
const OUTPUT_GLYPHS = ['↑', '←', '→', '↓'];

export interface VizHover {
  text: string;
  x: number;
  y: number;
}

export class NetworkVisualizer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D | null;
  private width = 280;
  private height = 240;
  private dpr = 1;
  private net: NeuralNetwork | null = null;
  private staticKey = '';
  private weightsKey = 0;
  private lastDraw = -Infinity;
  private offset = 0;
  private readonly springs: Spring[] = [new Spring(1), new Spring(1), new Spring(1), new Spring(1)];
  private readonly prevOut = new Float64Array(4);
  /** Node positions per layer: [x0, y0, x1, y1, ...]. */
  private positions: Float64Array[] = [];
  private hoverPos: { x: number; y: number } | null = null;
  /** Hover explanation (read by the panel to show a tooltip). */
  hover: VizHover | null = null;
  /** Frames actually drawn (for tests: proves it animates). */
  framesDrawn = 0;
  /** How many inputs are sensor rays (the rest are navigation inputs). */
  rayCount = 5;
  /** Spread of the sensor rays (radians), for the input glyphs. */
  raySpread = Math.PI / 2;
  /** Labels of the inputs after the rays (route inputs). */
  extraLabels: readonly string[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'nn-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Neural network of the focused car');
    this.ctx = this.canvas.getContext('2d');
    this.staticCanvas = document.createElement('canvas');
    this.staticCtx = this.staticCanvas.getContext('2d');
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverPos = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverPos = null;
      this.hover = null;
    });
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    for (const c of [this.canvas, this.staticCanvas]) {
      c.width = Math.round(width * this.dpr);
      c.height = Math.round(height * this.dpr);
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.staticKey = '';
  }

  /** Describes the inputs: ray glyphs fanned over `spread`, then labelled extras. */
  setInputs(rayCount: number, labels: readonly string[], spread: number): void {
    if (
      rayCount !== this.rayCount ||
      spread !== this.raySpread ||
      labels.length !== this.extraLabels.length ||
      labels.some((l, i) => l !== this.extraLabels[i])
    ) {
      this.rayCount = rayCount;
      this.raySpread = spread;
      this.extraLabels = labels;
      this.staticKey = '';
    }
  }

  /**
   * Shows a network. `weightsKey` changes whenever the weights change (e.g. the
   * generation number), which invalidates the static cache.
   */
  setNetwork(net: NeuralNetwork | null, weightsKey: number): void {
    if (net !== this.net || weightsKey !== this.weightsKey) {
      this.net = net;
      this.weightsKey = weightsKey;
      this.staticKey = '';
    }
  }

  /** Draws at most 30 times per second. `visible` false skips drawing entirely. */
  update(timeMs: number, dtMs: number, visible: boolean, reducedMotion: boolean): void {
    if (!visible || !this.ctx || !this.net) return;
    for (const s of this.springs) s.update(dtMs / 1000);
    if (timeMs - this.lastDraw < 1000 / 30) return;
    const elapsed = Math.min(100, timeMs - this.lastDraw);
    this.lastDraw = timeMs;
    if (!reducedMotion) this.offset += elapsed * 0.02;
    this.ensureStatic();
    this.drawDynamic(reducedMotion);
    this.framesDrawn++;
  }

  private layout(): void {
    const net = this.net;
    if (!net) return;
    const layers = net.topology.length;
    const top = 34;
    const bottom = this.height - 34;
    const margin = 28;
    this.positions = net.topology.map((count, li) => {
      const y = layers === 1 ? (top + bottom) / 2 : bottom - ((bottom - top) * li) / (layers - 1);
      const arr = new Float64Array(count * 2);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        arr[i * 2] = margin + (this.width - margin * 2) * t;
        arr[i * 2 + 1] = y;
      }
      return arr;
    });
  }

  /** Node radius: scales with the panel, and shrinks so the widest layer never overlaps. */
  private nodeRadius(): number {
    let widest = 1;
    if (this.net) for (const n of this.net.topology) if (n > widest) widest = n;
    const gap = widest > 1 ? (this.width - 56) / (widest - 1) : Infinity;
    return Math.max(5, Math.min(13, this.width / 26, gap * 0.42));
  }

  private ensureStatic(): void {
    const net = this.net;
    const c = this.staticCtx;
    if (!net || !c) return;
    const key = `${this.width}x${this.height}|${net.topology.join(',')}|${this.weightsKey}|${this.rayCount}|${this.raySpread}|${this.extraLabels.join(',')}`;
    if (key === this.staticKey) return;
    this.staticKey = key;
    this.layout();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    const r = this.nodeRadius();
    // input glyphs: little rays fanning like the sensor, then labels for extra inputs
    const inputs = this.positions[0];
    const n = net.inputCount;
    const rays = Math.min(this.rayCount, n);
    if (inputs) {
      c.font = `600 ${Math.round(r * 1.1)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      for (let i = 0; i < n; i++) {
        const x = inputs[i * 2] as number;
        const y = (inputs[i * 2 + 1] as number) + r + 6;
        c.strokeStyle = 'rgba(147, 161, 184, 0.8)';
        c.fillStyle = 'rgba(147, 161, 184, 0.9)';
        if (i < rays) {
          const spread = this.raySpread;
          const a = rays === 1 ? 0 : spread / 2 - spread * (i / (rays - 1));
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(x, y + 14);
          c.lineTo(x - Math.sin(a) * 12, y + 14 - Math.cos(a) * 12);
          c.stroke();
        } else {
          // route inputs: small labels, alternating rows so neighbours never collide
          const k = i - rays;
          const label = this.extraLabels[k] ?? (k === 0 ? 'θ' : 'v');
          const prev = c.font;
          c.font = `600 ${Math.max(8, Math.round(r * 0.95))}px system-ui, sans-serif`;
          c.fillText(label, x, y + (k % 2) * Math.max(9, r));
          c.font = prev;
        }
      }
    }
    // output arrows
    const outs = this.positions[this.positions.length - 1];
    if (outs) {
      c.fillStyle = 'rgba(230, 237, 247, 0.85)';
      c.font = `700 ${Math.round(r * 1.25)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      for (let j = 0; j < net.outputCount; j++) {
        c.fillText(
          OUTPUT_GLYPHS[j] ?? '?',
          outs[j * 2] as number,
          (outs[j * 2 + 1] as number) - r - 4,
        );
      }
    }
  }

  private drawDynamic(reduced: boolean): void {
    const net = this.net;
    const c = this.ctx;
    if (!net || !c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    c.drawImage(this.staticCanvas, 0, 0, this.width, this.height);
    const r = this.nodeRadius();
    let hoverText: string | null = null;
    let hoverBest = Infinity;
    const hp = this.hoverPos;

    // connections (drawn per level, from the level's inputs to its outputs)
    net.levels.forEach((level: Level, li) => {
      const from = this.positions[li];
      const to = this.positions[li + 1];
      if (!from || !to) return;
      for (let i = 0; i < level.inputCount; i++) {
        const src = level.inputs[i] as number;
        const active = Math.abs(src) > 0.5;
        const x0 = from[i * 2] as number;
        const y0 = from[i * 2 + 1] as number;
        for (let j = 0; j < level.outputCount; j++) {
          const w = level.weight(i, j);
          const x1 = to[j * 2] as number;
          const y1 = to[j * 2 + 1] as number;
          c.strokeStyle = w >= 0 ? POS : NEG;
          c.globalAlpha = Math.min(1, Math.abs(w)) * (active ? 0.95 : 0.35);
          c.lineWidth = active ? 2 : 1.2;
          c.setLineDash([6, 5]);
          c.lineDashOffset = reduced ? 0 : -this.offset * (active ? 2.6 : 0.6);
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.stroke();
          if (hp) {
            const d = distToSeg(hp.x, hp.y, x0, y0, x1, y1);
            if (d < 4 && d < hoverBest) {
              hoverBest = d;
              hoverText = `weight ${w.toFixed(3)}  (L${li} n${i} → n${j})`;
            }
          }
        }
      }
    });
    c.setLineDash([]);
    c.globalAlpha = 1;

    // nodes: input layer values, then each level's outputs
    const out = net.outputs;
    for (let j = 0; j < Math.min(4, out.length); j++) {
      const v = out[j] as number;
      if (v > 0.5 && (this.prevOut[j] as number) <= 0.5) this.springs[j]?.impulse(reduced ? 0 : 6);
      this.prevOut[j] = v;
    }
    this.positions.forEach((pos, li) => {
      const count = pos.length / 2;
      const level = li === 0 ? net.levels[0] : net.levels[li - 1];
      if (!level) return;
      const values = li === 0 ? level.inputs : level.outputs;
      const biases = li === 0 ? null : level.biases;
      const isOut = li === this.positions.length - 1;
      for (let k = 0; k < count; k++) {
        const x = pos[k * 2] as number;
        const y = pos[k * 2 + 1] as number;
        const v = values[k] as number;
        const scale = isOut ? (this.springs[k]?.value ?? 1) : 1;
        const rr = r * scale;
        if (isOut && v > 0.5) {
          const g = c.createRadialGradient(x, y, 0, x, y, rr * 2.4);
          g.addColorStop(0, 'rgba(163, 230, 53, 0.55)');
          g.addColorStop(1, 'rgba(163, 230, 53, 0)');
          c.fillStyle = g;
          c.beginPath();
          c.arc(x, y, rr * 2.4, 0, Math.PI * 2);
          c.fill();
        }
        // bias ring
        if (biases) {
          const b = biases[k] as number;
          c.strokeStyle = b >= 0 ? POS : NEG;
          c.globalAlpha = 0.35 + 0.65 * Math.min(1, Math.abs(b));
          c.lineWidth = 1 + 3 * Math.min(1, Math.abs(b));
          c.beginPath();
          c.arc(x, y, rr + 3, 0, Math.PI * 2);
          c.stroke();
          c.globalAlpha = 1;
        }
        // activation fill
        c.fillStyle = '#0b0f17';
        c.beginPath();
        c.arc(x, y, rr, 0, Math.PI * 2);
        c.fill();
        const a = Math.min(1, Math.abs(v));
        c.fillStyle = v >= 0 ? (isOut ? '#a3e635' : POS) : NEG;
        c.globalAlpha = 0.15 + 0.85 * a;
        c.beginPath();
        c.arc(x, y, rr * 0.78, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        if (hp) {
          const d = Math.hypot(hp.x - x, hp.y - y);
          if (d < rr + 4 && d < hoverBest + 6) {
            hoverBest = d - 6;
            hoverText = biases
              ? `value ${v.toFixed(3)}  bias ${(biases[k] as number).toFixed(3)}`
              : `${k < this.rayCount ? `ray ${k}` : (this.extraLabels[k - this.rayCount] ?? `input ${k}`)}: ${v.toFixed(3)}`;
          }
        }
      }
    });
    this.hover = hoverText && hp ? { text: hoverText, x: hp.x, y: hp.y } : null;
  }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
