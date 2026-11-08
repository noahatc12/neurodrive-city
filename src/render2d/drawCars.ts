/**
 * Cars, sensors, routes and particles in 2D (spec L2, L4, E4, F2).
 *
 * Car sprites are drawn procedurally once per colour (plus a desaturated "damaged"
 * variant) into offscreen canvases and reused with drawImage, so drawing hundreds of
 * cars is cheap. Sensor rays glow with additive blending; the route is a dashed path
 * whose dash offset scrolls to suggest flow.
 *
 * @module render2d/drawCars
 */
import type { Car } from '../engine/car/car.ts';
import { CAR_COLORS } from '../engine/car/carFactory.ts';
import { HIT_NONE } from '../engine/car/damage.ts';
import type { Sensor } from '../engine/car/sensor.ts';
import type { LanePath } from '../engine/nav/lanePath.ts';
import { P_EXHAUST, P_SMOKE, P_SPARK, type Particles } from '../engine/sim/particlesSim.ts';
import { glowSprite } from './drawMarkings.ts';
import { PALETTE } from './palette.ts';

const SPRITE_SCALE = 3; // sprite pixels per world unit
const PAD = 6; // world units of padding around the body (for the glow/shadow)

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Draws one car body pointing up (−y), centred, in a canvas. */
function paintCar(color: string, damaged: boolean, w: number, l: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil((w + PAD * 2) * SPRITE_SCALE);
  c.height = Math.ceil((l + PAD * 2) * SPRITE_SCALE);
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.translate(PAD + w / 2, PAD + l / 2);
  const body = damaged ? '#5b6474' : color;
  // soft shadow
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.roundRect(-w / 2 + 1.5, -l / 2 + 2.5, w, l, 7);
  g.fill();
  // body
  const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, shade(body, 0.62));
  grad.addColorStop(0.5, shade(body, 1.05));
  grad.addColorStop(1, shade(body, 0.62));
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(-w / 2, -l / 2, w, l, 7);
  g.fill();
  // windshield, roof and rear window
  g.fillStyle = damaged ? '#2a2f38' : '#0d1726';
  g.beginPath();
  g.roundRect(-w * 0.38, -l * 0.26, w * 0.76, l * 0.16, 3);
  g.fill();
  g.beginPath();
  g.roundRect(-w * 0.36, l * 0.18, w * 0.72, l * 0.12, 3);
  g.fill();
  g.fillStyle = shade(body, damaged ? 0.9 : 1.25);
  g.beginPath();
  g.roundRect(-w * 0.34, -l * 0.09, w * 0.68, l * 0.26, 3);
  g.fill();
  // headlights and taillights
  g.fillStyle = damaged ? '#777' : '#fff6cf';
  g.fillRect(-w * 0.42, -l / 2 + 0.6, w * 0.22, 2.2);
  g.fillRect(w * 0.2, -l / 2 + 0.6, w * 0.22, 2.2);
  g.fillStyle = damaged ? '#4a3a3a' : '#a3142a';
  g.fillRect(-w * 0.42, l / 2 - 2.6, w * 0.24, 2);
  g.fillRect(w * 0.18, l / 2 - 2.6, w * 0.24, 2);
  // mirrors
  g.fillStyle = shade(body, 0.7);
  g.fillRect(-w / 2 - 2, -l * 0.2, 2.5, 3.5);
  g.fillRect(w / 2 - 0.5, -l * 0.2, 2.5, 3.5);
  return c;
}

export interface CarDrawOptions {
  alpha: number;
  timeMs: number;
  focusId: number | null;
  bestId: number | null;
  reducedMotion: boolean;
  showPolygons: boolean;
}

export class CarPainter {
  /** Sprites indexed by colour index × 2 + damaged (all cars share one size). */
  private readonly sprites: (HTMLCanvasElement | undefined)[] = [];
  private readonly tmp = new Float64Array(2);

  private sprite(colorIndex: number, damaged: boolean, w: number, l: number): HTMLCanvasElement {
    const key = colorIndex * 2 + (damaged ? 1 : 0);
    let s = this.sprites[key];
    if (!s) {
      s = paintCar(CAR_COLORS[colorIndex] ?? CAR_COLORS[0], damaged, w, l);
      this.sprites[key] = s;
    }
    return s;
  }

  /** Draws one car (interpolated pose) with brake lights and focus/best highlights. */
  drawCar(ctx: CanvasRenderingContext2D, car: Car, o: CarDrawOptions): void {
    const x = car.lerpX(o.alpha);
    const y = car.lerpY(o.alpha);
    const a = car.lerpAngle(o.alpha);
    const w = car.config.width;
    const l = car.config.length;
    const colorIndex = car.id === o.bestId ? 3 : car.color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-a);
    if (car.kind === 'ai' && car.id !== o.bestId && car.id !== o.focusId)
      ctx.globalAlpha = car.damaged ? 0.35 : 0.6;
    ctx.drawImage(
      this.sprite(colorIndex, car.damaged, w, l),
      -w / 2 - PAD,
      -l / 2 - PAD,
      w + PAD * 2,
      l + PAD * 2,
    );
    ctx.globalAlpha = 1;
    if (car.braking && !car.damaged) {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      const g = glowSprite('#ff2a3d');
      ctx.drawImage(g, -w * 0.45 - 6, l / 2 - 8, 14, 14);
      ctx.drawImage(g, w * 0.3 - 7, l / 2 - 8, 14, 14);
      ctx.globalCompositeOperation = prev;
    }
    if (car.id === o.focusId || car.id === o.bestId) {
      const pulse = o.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(o.timeMs / 200);
      ctx.strokeStyle = car.id === o.bestId ? PALETTE.lime : PALETTE.cyan;
      ctx.globalAlpha = 0.35 + 0.4 * pulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-w / 2 - 5, -l / 2 - 5, w + 10, l + 10, 10);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (o.showPolygons) {
      const p = car.polygon;
      ctx.strokeStyle = car.damaged ? PALETTE.red : PALETTE.lime;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p[0] as number, p[1] as number);
      for (let k = 2; k < 8; k += 2) ctx.lineTo(p[k] as number, p[k + 1] as number);
      ctx.closePath();
      ctx.stroke();
    }
  }

  /** Glowing sensor rays: cyan when clear, hot magenta near hits, with a hit dot. */
  drawSensor(ctx: CanvasRenderingContext2D, sensor: Sensor, glow: boolean): void {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    // cheap glow: a wide faint stroke under each ray (shadowBlur is costly in software)
    if (glow) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.12)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let i = 0; i < sensor.rayCount; i++) {
        const ox = sensor.rays[i * 4] as number;
        const oy = sensor.rays[i * 4 + 1] as number;
        const off = sensor.offsets[i] as number;
        ctx.moveTo(ox, oy);
        ctx.lineTo(
          ox + ((sensor.rays[i * 4 + 2] as number) - ox) * off,
          oy + ((sensor.rays[i * 4 + 3] as number) - oy) * off,
        );
      }
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (let i = 0; i < sensor.rayCount; i++) {
      const ox = sensor.rays[i * 4] as number;
      const oy = sensor.rays[i * 4 + 1] as number;
      const ex = sensor.rays[i * 4 + 2] as number;
      const ey = sensor.rays[i * 4 + 3] as number;
      const off = sensor.offsets[i] as number;
      const hx = ox + (ex - ox) * off;
      const hy = oy + (ey - oy) * off;
      const hit = sensor.kinds[i] !== HIT_NONE;
      ctx.strokeStyle = hit
        ? off < 0.35
          ? 'rgba(244,114,182,0.95)'
          : 'rgba(251,191,36,0.9)'
        : 'rgba(34,211,238,0.75)';
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      if (hit) {
        ctx.strokeStyle = 'rgba(147,161,184,0.25)';
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.drawImage(glowSprite('#f472b6'), hx - 7, hy - 7, 14, 14);
      }
    }
    ctx.globalCompositeOperation = prev;
  }

  /** Animated glowing route (dash offset scrolls along the travel direction). */
  drawRoute(
    ctx: CanvasRenderingContext2D,
    path: LanePath,
    fromS: number,
    toS: number,
    timeMs: number,
    zoom: number,
    reduced: boolean,
  ): void {
    if (path.count < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < path.count; i++) {
      const s = path.cum[i] as number;
      if (s < fromS - 1 || s > toS + 1) continue;
      const x = path.xy[i * 2] as number;
      const y = path.xy[i * 2 + 1] as number;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.18)';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = reduced ? 0 : -timeMs / 25;
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.85)';
    ctx.lineWidth = Math.max(3, 2 / zoom);
    ctx.stroke();
    ctx.restore();
  }

  /** Exhaust, smoke and sparks from the particle ring buffer. */
  drawParticles(ctx: CanvasRenderingContext2D, p: Particles): void {
    for (let i = 0; i < p.capacity; i++) {
      const life = p.life[i] as number;
      if (life <= 0) continue;
      const t = life / (p.maxLife[i] as number);
      const x = p.x[i] as number;
      const y = p.y[i] as number;
      const r = p.size[i] as number;
      const type = p.type[i];
      if (type === P_SPARK) {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffb347';
        ctx.globalAlpha = t;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (p.vx[i] as number) * 0.03, y - (p.vy[i] as number) * 0.03);
        ctx.stroke();
        ctx.globalCompositeOperation = prev;
      } else {
        ctx.fillStyle = type === P_SMOKE ? '#1b1f27' : '#9aa4b5';
        ctx.globalAlpha = type === P_EXHAUST ? t * 0.28 : t * 0.55;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Subtle motion streaks behind the focused car above 80% of max speed. */
  drawSpeedLines(ctx: CanvasRenderingContext2D, car: Car, alpha: number, timeMs: number): void {
    const ratio = car.speed / car.config.maxSpeed;
    if (ratio < 0.8) return;
    const x = car.lerpX(alpha);
    const y = car.lerpY(alpha);
    const a = car.lerpAngle(alpha);
    const fx = -Math.sin(a);
    const fy = -Math.cos(a);
    const strength = (ratio - 0.8) / 0.2;
    ctx.strokeStyle = 'rgba(230, 237, 247, 0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const side = ((i * 37 + Math.floor(timeMs / 60) * 13) % 40) - 20;
      const back = 30 + ((i * 53 + timeMs / 4) % 50);
      const len = 20 + strength * 30;
      const bx = x - fx * back + fy * side;
      const by = y - fy * back - fx * side;
      ctx.globalAlpha = 0.25 * strength;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - fx * len, by - fy * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Writes the route point at arc `s` into a reused buffer (for markers). */
  routePoint(path: LanePath, s: number): Float64Array {
    let i = 0;
    while (i < path.count - 2 && (path.cum[i + 1] as number) < s) i++;
    this.tmp[0] = path.xy[i * 2] as number;
    this.tmp[1] = path.xy[i * 2 + 1] as number;
    return this.tmp;
  }
}
