/**
 * Pseudo-3D buildings and trees for the 2D view (spec L4): an homage to, and an
 * improvement on, the course's "fake 3D" lesson.
 *
 * Camera model: a viewer above the viewport centre c. A point p at height h is drawn
 * displaced away from c:
 *
 * ```
 *   top(p, h) = p + (p - c)/|p - c| · R·tanh(|p - c| / R) · h / H · k
 * ```
 *
 * Near the centre this is ordinary perspective (displacement ∝ distance); far away the
 * tanh saturates, so buildings at the screen edge lean but never smear across the
 * screen. H (camera height) and R scale with the visible area, so the look is the same
 * at every zoom level.
 *
 * Painter's order: items (buildings, trees and cars) are sorted by distance from c,
 * farthest first. A car farther out than a tall building is drawn before it, so the
 * building's leaning top correctly hides it, which the course's version could not do.
 *
 * Everything is allocation-free per frame: candidates come from spatial hashes into
 * reusable typed arrays, colours are precomputed strings per geometry version.
 *
 * @module render2d/pseudo3d
 */
import type { BuildingData } from '../engine/world/types.ts';
import { TREE_LEVELS, TREE_STEPS, type WorldGeometry } from '../engine/world/world.ts';
import type { Viewport } from './viewport.ts';
import { PALETTE } from './palette.ts';

export const KIND_BUILDING = 0;
export const KIND_TREE = 1;
export const KIND_CAR = 2;

const COS = new Float64Array(TREE_STEPS);
const SIN = new Float64Array(TREE_STEPS);
for (let i = 0; i < TREE_STEPS; i++) {
  COS[i] = Math.cos((i / TREE_STEPS) * Math.PI * 2);
  SIN[i] = Math.sin((i / TREE_STEPS) * Math.PI * 2);
}

/** Light comes from the top-left; shadows fall bottom-right. */
const LIGHT_X = -0.55;
const LIGHT_Y = -0.83;

interface Palette3D {
  version: number;
  top: string[];
  sideLit: string[];
  sideDark: string[];
  roofA: string[];
  roofB: string[];
  treeLevels: string[][];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

function buildPalette(geo: WorldGeometry): Palette3D {
  const top: string[] = [];
  const sideLit: string[] = [];
  const sideDark: string[] = [];
  const roofA: string[] = [];
  const roofB: string[] = [];
  for (const b of geo.data.buildings) {
    // cool slate blues with a few warm accents
    const warm = b.tint > 0.86;
    const hue = warm ? 28 + b.tint * 20 : 212 + (b.tint - 0.5) * 30;
    const sat = warm ? 28 : 18 + b.tint * 10;
    top.push(hsl(hue, sat, 30 + b.tint * 8));
    sideLit.push(hsl(hue, sat, 22 + b.tint * 5));
    sideDark.push(hsl(hue, sat, 14 + b.tint * 4));
    roofA.push(hsl(warm ? 12 : 200, 30, 34 + b.tint * 6));
    roofB.push(hsl(warm ? 12 : 200, 30, 25 + b.tint * 5));
  }
  const treeLevels = geo.data.trees.map((t) => {
    const hue = t.species === 1 ? 150 + t.tint * 15 : 105 + t.tint * 35;
    const sat = t.species === 2 ? 40 : 45;
    const out: string[] = [];
    for (let l = 0; l < TREE_LEVELS; l++)
      out.push(hsl(hue, sat, 16 + (l / (TREE_LEVELS - 1)) * 20 + t.tint * 4));
    return out;
  });
  return { version: geo.version, top, sideLit, sideDark, roofA, roofB, treeLevels };
}

export class Pseudo3D {
  private cap = 1024;
  private kinds = new Uint8Array(this.cap);
  private ids = new Int32Array(this.cap);
  private keys = new Float64Array(this.cap);
  private order: number[] = [];
  private count = 0;
  private readonly scratch: number[] = [];
  private palette: Palette3D | null = null;
  // per-frame camera parameters
  private cx = 0;
  private cy = 0;
  private R = 1;
  private invH = 0;
  private readonly tmp = { x: 0, y: 0 };
  /** Items drawn last frame (stats). */
  drawn = 0;

  private readonly compare = (a: number, b: number): number =>
    (this.keys[b] ?? 0) - (this.keys[a] ?? 0);

  /** Sets the camera for this frame from the viewport. */
  setCamera(vp: Viewport, strength = 1): void {
    this.cx = vp.center.x;
    this.cy = vp.center.y;
    const halfDiag = Math.hypot(vp.width, vp.height) / 2 / vp.zoom;
    this.R = halfDiag * 0.85;
    this.invH = (1.5 * strength) / (halfDiag * 2.4);
  }

  /** Displaced top position of (x, y) at height h; writes into the shared tmp vector. */
  top(x: number, y: number, h: number): { x: number; y: number } {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    const f = d < 1e-6 ? 0 : ((this.R * Math.tanh(d / this.R)) / d) * h * this.invH;
    this.tmp.x = x + dx * f;
    this.tmp.y = y + dy * f;
    return this.tmp;
  }

  /** Starts a frame: gathers visible buildings and trees. */
  begin(geo: WorldGeometry | null, vp: Viewport, buildings: boolean, trees: boolean): void {
    this.count = 0;
    if (!geo) return;
    if (!this.palette || this.palette.version !== geo.version) this.palette = buildPalette(geo);
    const pad = this.R * 0.6;
    const b = vp.visibleBounds(pad);
    if (buildings) {
      geo.buildingHash.query(b, this.scratch);
      for (const i of this.scratch) {
        const d = geo.data.buildings[i];
        if (d) this.push(KIND_BUILDING, i, d.center.x, d.center.y);
      }
    }
    if (trees) {
      geo.treeHash.query(b, this.scratch);
      for (const i of this.scratch) {
        const t = geo.data.trees[i];
        if (t) this.push(KIND_TREE, i, t.x, t.y);
      }
    }
  }

  /** Adds a car (or any custom item) to the depth sort. */
  addItem(kind: number, id: number, x: number, y: number): void {
    this.push(kind, id, x, y);
  }

  private push(kind: number, id: number, x: number, y: number): void {
    if (this.count >= this.cap) this.grow();
    const dx = x - this.cx;
    const dy = y - this.cy;
    this.kinds[this.count] = kind;
    this.ids[this.count] = id;
    this.keys[this.count] = dx * dx + dy * dy;
    this.count++;
  }

  private grow(): void {
    this.cap *= 2;
    const k = new Uint8Array(this.cap);
    k.set(this.kinds);
    this.kinds = k;
    const i = new Int32Array(this.cap);
    i.set(this.ids);
    this.ids = i;
    const y = new Float64Array(this.cap);
    y.set(this.keys);
    this.keys = y;
  }

  /** Ground shadows for everything gathered (drawn before roads' markings, after ground). */
  drawShadows(ctx: CanvasRenderingContext2D, geo: WorldGeometry): void {
    ctx.fillStyle = PALETTE.roadShadow;
    ctx.beginPath();
    for (let n = 0; n < this.count; n++) {
      const id = this.ids[n] as number;
      const kind = this.kinds[n];
      if (kind === KIND_BUILDING) {
        const b = geo.data.buildings[id];
        if (!b) continue;
        const off = b.height * 0.32;
        const ox = -LIGHT_X * off;
        const oy = -LIGHT_Y * off;
        // swept footprint: base ∪ shifted base ∪ connecting quads (one path, nonzero fill)
        const p = b.base;
        const n = p.length;
        for (let i = 0; i < n; i++) {
          const a = p[i] as { x: number; y: number };
          const c = p[(i + 1) % n] as { x: number; y: number };
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(c.x, c.y);
          ctx.lineTo(c.x + ox, c.y + oy);
          ctx.lineTo(a.x + ox, a.y + oy);
          ctx.closePath();
        }
      } else if (kind === KIND_TREE) {
        const t = geo.data.trees[id];
        if (!t) continue;
        const off = t.height * 0.3;
        const x = t.x - LIGHT_X * off;
        const y = t.y - LIGHT_Y * off;
        ctx.moveTo(x + t.radius * 0.9, y);
        ctx.ellipse(x, y, t.radius * 0.9, t.radius * 0.75, 0.6, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  /**
   * Draws all gathered items far-to-near. `drawCustom` renders custom items (cars) when
   * their turn comes in the sort.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    geo: WorldGeometry | null,
    drawCustom: ((ctx: CanvasRenderingContext2D, kind: number, id: number) => void) | null,
  ): void {
    const n = this.count;
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort(this.compare);
    this.drawn = n;
    for (let k = 0; k < n; k++) {
      const slot = order[k] as number;
      const kind = this.kinds[slot] as number;
      const id = this.ids[slot] as number;
      if (kind === KIND_BUILDING && geo) this.drawBuilding(ctx, geo.data.buildings[id], id);
      else if (kind === KIND_TREE && geo) this.drawTree(ctx, geo, id);
      else if (drawCustom) drawCustom(ctx, kind, id);
    }
  }

  private drawBuilding(
    ctx: CanvasRenderingContext2D,
    b: BuildingData | undefined,
    id: number,
  ): void {
    const pal = this.palette;
    if (!b || !pal) return;
    const p = b.base;
    const n = p.length;
    const h = b.height;
    // orientation of the footprint (sign of area) to get outward normals
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = p[i] as { x: number; y: number };
      const c = p[(i + 1) % n] as { x: number; y: number };
      area += a.x * c.y - c.x * a.y;
    }
    const sgn = area >= 0 ? 1 : -1;
    // OSM footprints can have many corners: grow the scratch buffer once when needed
    if (this.tops.length < n * 2) this.tops = new Float64Array(n * 2);
    const tops = this.tops;
    for (let i = 0; i < n; i++) {
      const a = p[i] as { x: number; y: number };
      const t = this.top(a.x, a.y, h);
      tops[i * 2] = t.x;
      tops[i * 2 + 1] = t.y;
    }
    // sides facing the viewer
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = p[i] as { x: number; y: number };
      const c = p[j] as { x: number; y: number };
      const ex = c.x - a.x;
      const ey = c.y - a.y;
      const nx = sgn * ey; // outward normal (unnormalised)
      const ny = -sgn * ex;
      const mx = (a.x + c.x) / 2;
      const my = (a.y + c.y) / 2;
      if (nx * (this.cx - mx) + ny * (this.cy - my) <= 0) continue;
      const lit = nx * LIGHT_X + ny * LIGHT_Y > 0;
      ctx.fillStyle = lit
        ? (pal.sideLit[id] ?? PALETTE.buildingSide)
        : (pal.sideDark[id] ?? PALETTE.buildingSideDark);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(tops[j * 2] as number, tops[j * 2 + 1] as number);
      ctx.lineTo(tops[i * 2] as number, tops[i * 2 + 1] as number);
      ctx.closePath();
      ctx.fill();
    }
    if (b.roof === 'pitched' && n === 4) {
      this.drawPitchedRoof(ctx, b, id, pal);
      return;
    }
    // flat roof with a parapet line
    ctx.fillStyle = pal.top[id] ?? PALETTE.buildingTop;
    ctx.beginPath();
    ctx.moveTo(tops[0] as number, tops[1] as number);
    for (let i = 1; i < n; i++) ctx.lineTo(tops[i * 2] as number, tops[i * 2 + 1] as number);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = b.depth * 0.04;
    ctx.stroke();
  }

  private tops = new Float64Array(64);
  private readonly ridge = new Float64Array(4);

  private drawPitchedRoof(
    ctx: CanvasRenderingContext2D,
    b: BuildingData,
    id: number,
    pal: Palette3D,
  ): void {
    const tops = this.tops;
    const p = b.base;
    // base order from rectAround: 0 (a+n), 1 (b+n), 2 (b-n), 3 (a-n): long sides 0-1 and 2-3
    const p0 = p[0] as { x: number; y: number };
    const p1 = p[1] as { x: number; y: number };
    const p2 = p[2] as { x: number; y: number };
    const p3 = p[3] as { x: number; y: number };
    const rh = b.height + b.depth * 0.45;
    let t = this.top((p0.x + p3.x) / 2, (p0.y + p3.y) / 2, rh);
    this.ridge[0] = t.x;
    this.ridge[1] = t.y;
    t = this.top((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, rh);
    this.ridge[2] = t.x;
    this.ridge[3] = t.y;
    const r = this.ridge;
    // gables (triangles at the short ends), then the two roof planes; the plane nearer
    // the viewer is drawn last
    ctx.fillStyle = pal.sideDark[id] ?? PALETTE.buildingSideDark;
    ctx.beginPath();
    ctx.moveTo(tops[0] as number, tops[1] as number);
    ctx.lineTo(tops[6] as number, tops[7] as number);
    ctx.lineTo(r[0] as number, r[1] as number);
    ctx.closePath();
    ctx.moveTo(tops[2] as number, tops[3] as number);
    ctx.lineTo(tops[4] as number, tops[5] as number);
    ctx.lineTo(r[2] as number, r[3] as number);
    ctx.closePath();
    ctx.fill();
    const side01Near =
      Math.hypot((p0.x + p1.x) / 2 - this.cx, (p0.y + p1.y) / 2 - this.cy) <
      Math.hypot((p2.x + p3.x) / 2 - this.cx, (p2.y + p3.y) / 2 - this.cy);
    // the plane nearer the viewer is drawn last
    if (side01Near) {
      this.roofPlane(ctx, pal.roofB[id], 4, 6, 0, 2);
      this.roofPlane(ctx, pal.roofA[id], 0, 2, 2, 0);
    } else {
      this.roofPlane(ctx, pal.roofA[id], 0, 2, 2, 0);
      this.roofPlane(ctx, pal.roofB[id], 4, 6, 0, 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = b.depth * 0.03;
    ctx.beginPath();
    ctx.moveTo(r[0] as number, r[1] as number);
    ctx.lineTo(r[2] as number, r[3] as number);
    ctx.stroke();
  }

  /** One roof plane: two top corners (offsets into `tops`) and two ridge ends. */
  private roofPlane(
    ctx: CanvasRenderingContext2D,
    color: string | undefined,
    t0: number,
    t1: number,
    r0: number,
    r1: number,
  ): void {
    const tops = this.tops;
    const r = this.ridge;
    ctx.fillStyle = color ?? PALETTE.roof;
    ctx.beginPath();
    ctx.moveTo(tops[t0] as number, tops[t0 + 1] as number);
    ctx.lineTo(tops[t1] as number, tops[t1 + 1] as number);
    ctx.lineTo(r[r0] as number, r[r0 + 1] as number);
    ctx.lineTo(r[r1] as number, r[r1 + 1] as number);
    ctx.closePath();
    ctx.fill();
  }

  private drawTree(ctx: CanvasRenderingContext2D, geo: WorldGeometry, id: number): void {
    const t = geo.data.trees[id];
    const pal = this.palette;
    if (!t || !pal) return;
    const colors = pal.treeLevels[id];
    // trunk
    const trunkTop = this.top(t.x, t.y, t.height * 0.35);
    ctx.strokeStyle = PALETTE.trunk;
    ctx.lineWidth = t.radius * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(trunkTop.x, trunkTop.y);
    ctx.stroke();
    for (let l = 0; l < TREE_LEVELS; l++) {
      const f = l / (TREE_LEVELS - 1);
      const h = t.height * (0.3 + 0.7 * f);
      const r = t.radius * (t.species === 1 ? 1 - 0.82 * f : 1 - 0.55 * f * f);
      const c = this.top(t.x, t.y, h);
      const cx = c.x;
      const cy = c.y;
      ctx.fillStyle = colors?.[l] ?? PALETTE.treeA;
      ctx.beginPath();
      for (let s = 0; s < TREE_STEPS; s++) {
        const rr = r * (t.canopy[l * TREE_STEPS + s] ?? 1);
        const x = cx + (COS[s] as number) * rr;
        const y = cy + (SIN[s] as number) * rr;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}
