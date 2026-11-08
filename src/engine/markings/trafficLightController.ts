/**
 * Traffic light controllers (spec D5).
 *
 * Lights placed near the same junction (within a radius of a graph point) are grouped
 * into one controller. Each distinct approach (incoming road) is one phase. The
 * controller cycles so that exactly one approach is green at a time:
 *
 * ```
 *   approach 0: GREEN ── YELLOW ── all red ┐
 *   approach 1:                            └─ GREEN ── YELLOW ── all red ┐
 *   approach 2:                                                          └─ ...
 * ```
 *
 * Durations (green 6 s, yellow 1.5 s, all-red 0.5 s by default) are measured in
 * simulation seconds passed to {@link TrafficLightSystem.update}, never in frames. A
 * light with no junction nearby forms its own single-light controller. Grouping never
 * throws, whatever the graph looks like.
 *
 * @module engine/markings/trafficLightController
 */
import type { Graph } from '../graph/graph.ts';
import type { LightColor } from './light.ts';
import { facedPoint, distanceToFacedPoint } from './light.ts';
import type { Marking } from './marking.ts';

export interface LightTiming {
  green: number;
  yellow: number;
  allRed: number;
}

export const DEFAULT_TIMING: Readonly<LightTiming> = Object.freeze({
  green: 6,
  yellow: 1.5,
  allRed: 0.5,
});

/** Cross-fade duration for lamp changes (seconds). */
export const LAMP_FADE = 0.15;

type Stage = 'green' | 'yellow' | 'allRed';

export interface LightGroup {
  /** Junction point id, or null for a standalone light. */
  junctionId: number | null;
  /** Light marking ids per approach (phase). */
  approaches: number[][];
  phase: number;
  stage: Stage;
  /** Seconds spent in the current stage. */
  timer: number;
}

export class TrafficLightSystem {
  groups: LightGroup[] = [];
  timing: LightTiming;
  private readonly groupOf = new Map<number, LightGroup>();
  private readonly approachOf = new Map<number, number>();
  /** Seconds since each light last changed colour (for lamp cross-fades). */
  private readonly sinceChange = new Map<number, number>();
  private readonly prevColor = new Map<number, LightColor>();
  private builtVersion = Number.NaN;

  constructor(timing: Partial<LightTiming> = {}) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  /**
   * (Re)groups lights. Cheap; call when the markings version changes. Existing groups
   * with the same junction keep their phase so editing does not reset the cycle.
   */
  build(lights: readonly Marking[], graph: Graph, roadWidth: number, version = Number.NaN): void {
    if (version === this.builtVersion && !Number.isNaN(version)) return;
    this.builtVersion = version;
    const old = new Map<string, LightGroup>();
    for (const g of this.groups)
      old.set(g.junctionId === null ? `s${g.approaches[0]?.[0] ?? -1}` : `j${g.junctionId}`, g);
    this.groups = [];
    this.groupOf.clear();
    this.approachOf.clear();
    const radius = roadWidth * 2.5;
    const byJunction = new Map<number, Marking[]>();
    const singles: Marking[] = [];
    for (const m of lights) {
      if (m.type !== 'light') continue;
      const p = facedPoint(m, graph);
      if (p && distanceToFacedPoint(m, graph) <= radius && graph.degree(p) >= 2) {
        const list = byJunction.get(p.id) ?? [];
        list.push(m);
        byJunction.set(p.id, list);
      } else {
        singles.push(m);
      }
    }
    for (const [jid, ms] of byJunction) {
      const p = graph.getPoint(jid);
      // one approach per segment, ordered by angle around the junction
      const bySeg = new Map<number, number[]>();
      for (const m of ms) {
        const list = bySeg.get(m.binding.segmentId) ?? [];
        list.push(m.id);
        bySeg.set(m.binding.segmentId, list);
      }
      const approaches = [...bySeg.entries()]
        .map(([segId, ids]) => {
          const s = graph.getSegment(segId);
          const other = s && p ? s.other(p) : null;
          const ang = other && p ? Math.atan2(other.y - p.y, other.x - p.x) : 0;
          return { ang, ids };
        })
        .sort((a, b) => a.ang - b.ang)
        .map((a) => a.ids);
      const prev = old.get(`j${jid}`);
      this.addGroup({
        junctionId: jid,
        approaches,
        phase: prev ? Math.min(prev.phase, approaches.length - 1) : 0,
        stage: prev?.stage ?? 'green',
        timer: prev?.timer ?? 0,
      });
    }
    for (const m of singles) {
      const prev = old.get(`s${m.id}`);
      this.addGroup({
        junctionId: null,
        approaches: [[m.id]],
        phase: 0,
        stage: prev?.stage ?? 'green',
        timer: prev?.timer ?? 0,
      });
    }
  }

  private addGroup(g: LightGroup): void {
    this.groups.push(g);
    g.approaches.forEach((ids, i) => {
      for (const id of ids) {
        this.groupOf.set(id, g);
        this.approachOf.set(id, i);
      }
    });
  }

  /** Advances all controllers by `dt` simulation seconds. */
  update(dt: number): void {
    const { green, yellow, allRed } = this.timing;
    for (const g of this.groups) {
      g.timer += dt;
      // loop handles large dt (e.g. turbo) by stepping through stages
      for (let guard = 0; guard < 64; guard++) {
        if (g.stage === 'green' && g.timer >= green) {
          g.timer -= green;
          g.stage = 'yellow';
        } else if (g.stage === 'yellow' && g.timer >= yellow) {
          g.timer -= yellow;
          g.stage = 'allRed';
        } else if (g.stage === 'allRed' && g.timer >= allRed) {
          g.timer -= allRed;
          g.stage = 'green';
          g.phase = (g.phase + 1) % Math.max(1, g.approaches.length);
        } else break;
      }
    }
    for (const id of this.groupOf.keys()) {
      const c = this.colorOf(id);
      const prev = this.prevColor.get(id);
      if (prev === undefined) {
        // first observation: show the colour fully, no fade
        this.prevColor.set(id, c);
        this.sinceChange.set(id, LAMP_FADE);
      } else if (prev !== c) {
        // changed during this step: the fade started `timer` seconds ago
        this.prevColor.set(id, c);
        this.sinceChange.set(id, this.groupOf.get(id)?.timer ?? 0);
      } else {
        this.sinceChange.set(id, (this.sinceChange.get(id) ?? 0) + dt);
      }
    }
  }

  /** Current colour of a light (red for unknown ids). */
  colorOf(lightId: number): LightColor {
    const g = this.groupOf.get(lightId);
    if (!g) return 'red';
    const approach = this.approachOf.get(lightId);
    if (approach !== g.phase || g.stage === 'allRed') return 'red';
    return g.stage === 'green' ? 'green' : 'yellow';
  }

  /** The group a light belongs to. */
  groupFor(lightId: number): LightGroup | undefined {
    return this.groupOf.get(lightId);
  }

  /**
   * Lamp intensities [red, yellow, green] in 0..1 with a {@link LAMP_FADE} cross-fade,
   * written into `out` (allocation-free for renderers).
   */
  lampLevels(lightId: number, out: Float32Array | number[]): void {
    const c = this.colorOf(lightId);
    const t = Math.min(1, (this.sinceChange.get(lightId) ?? LAMP_FADE) / LAMP_FADE);
    out[0] = c === 'red' ? t : 0;
    out[1] = c === 'yellow' ? t : 0;
    out[2] = c === 'green' ? t : 0;
    // previous lamp fading out
    const prev = this.previousColor(lightId, c);
    if (prev && t < 1) {
      const idx = prev === 'red' ? 0 : prev === 'yellow' ? 1 : 2;
      out[idx] = Math.max(out[idx] as number, 1 - t);
    }
  }

  private previousColor(id: number, current: LightColor): LightColor | null {
    const g = this.groupOf.get(id);
    if (!g) return null;
    // derive the colour before the last transition from the stage sequence
    if (current === 'yellow') return 'green';
    if (current === 'green') return 'red';
    return this.approachOf.get(id) === g.phase || g.stage === 'allRed' ? 'yellow' : null;
  }
}
