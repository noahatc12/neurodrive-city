/**
 * Fitness sparkline: best and average fitness per generation (spec G5, H4).
 * Redrawn only when the history grows or the size changes.
 * @module viz/sparkline
 */
import type { GenerationRecord } from '../engine/ai/evolution.ts';

export class Sparkline {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private drawnCount = -1;
  private drawnKey = '';

  constructor(width = 260, height = 54) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sparkline';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Best and average fitness per generation');
    this.ctx = this.canvas.getContext('2d');
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.drawnCount = -1;
  }

  /** Redraws if the history changed. */
  draw(history: readonly GenerationRecord[], key = ''): void {
    const c = this.ctx;
    if (!c) return;
    if (history.length === this.drawnCount && key === this.drawnKey) return;
    this.drawnCount = history.length;
    this.drawnKey = key;
    const w = this.canvas.width;
    const h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    const pad = 4 * (w / parseFloat(this.canvas.style.width || '260'));
    if (history.length === 0) {
      c.fillStyle = 'rgba(147,161,184,0.5)';
      c.font = `${Math.round(h * 0.22)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('fitness per generation', w / 2, h / 2);
      return;
    }
    const max = Math.max(1, ...history.map((r) => r.best));
    const n = history.length;
    const x = (i: number): number => (n === 1 ? w / 2 : pad + ((w - pad * 2) * i) / (n - 1));
    const y = (v: number): number => h - pad - ((h - pad * 2) * v) / max;
    // average as a filled area
    c.beginPath();
    c.moveTo(x(0), h - pad);
    history.forEach((r, i) => c.lineTo(x(i), y(r.average)));
    c.lineTo(x(n - 1), h - pad);
    c.closePath();
    c.fillStyle = 'rgba(34, 211, 238, 0.18)';
    c.fill();
    // best as a line
    c.beginPath();
    history.forEach((r, i) => (i === 0 ? c.moveTo(x(i), y(r.best)) : c.lineTo(x(i), y(r.best))));
    c.strokeStyle = '#a3e635';
    c.lineWidth = Math.max(1.5, w / 200);
    c.stroke();
    const last = history[n - 1];
    if (last) {
      c.fillStyle = '#a3e635';
      c.beginPath();
      c.arc(x(n - 1), y(last.best), Math.max(2.5, w / 110), 0, Math.PI * 2);
      c.fill();
    }
  }
}
