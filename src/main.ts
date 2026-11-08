import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import { clamp } from './engine/math/utils.ts';

/**
 * Phase 0 placeholder: a styled title card over an animated grid canvas.
 * Replaced by the real app shell in Phase 2.
 */
function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');

  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  root.append(canvas);

  const card = document.createElement('div');
  card.className = 'glass placeholder';
  card.innerHTML = '<h1>NeuroDrive City</h1><p>Self-driving cars that learn. Coming online.</p>';
  root.append(card);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const resize = (): void => {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const draw = (t: number): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, w, h);
    const step = 48;
    const off = (t * 0.02) % step;
    ctx.strokeStyle = '#22d3ee22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -off; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = -off; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 1.6);
    g.addColorStop(0, '#22d3ee18');
    g.addColorStop(1, '#0b0f17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  (window as unknown as { __ND__: unknown }).__ND__ = { ready: true, phase: 0 };
}

boot();
