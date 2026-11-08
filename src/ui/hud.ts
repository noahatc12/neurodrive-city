/**
 * Simulation HUD: a glass card of live stats whose numbers tween smoothly instead of
 * jumping (spec L3, M). Values are fed every frame; the DOM updates at ~12 Hz.
 * @module ui/hud
 */
import { SmoothDamp } from '../anim/springs.ts';
import { h } from './dom.ts';

export interface HudRowDef {
  key: string;
  label: string;
  /** Decimals to show. */
  decimals?: number;
  suffix?: string;
  /** Tween numeric changes (default true). */
  smooth?: boolean;
}

interface Row {
  def: HudRowDef;
  value: HTMLElement;
  damp: SmoothDamp;
  target: number;
  text: string;
  row: HTMLElement;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private readonly title: HTMLElement;
  private readonly badge: HTMLElement;
  private acc = 0;

  constructor(defs: readonly HudRowDef[]) {
    this.title = h('span', { class: 'hud-title', text: 'Simulation' });
    this.badge = h('span', { class: 'hud-badge', text: '×1' });
    const grid = h('dl', { class: 'hud-grid' });
    for (const def of defs) {
      const value = h('dd', { class: 'tabular', text: '0' });
      const dt = h('dt', { text: def.label });
      grid.append(dt, value);
      this.rows.set(def.key, {
        def,
        value,
        damp: new SmoothDamp(0, 0.25),
        target: 0,
        text: '',
        row: dt,
      });
    }
    this.el = h(
      'section',
      { class: 'hud glass', aria: { label: 'Simulation statistics', live: 'off' } },
      h('div', { class: 'hud-head' }, this.title, this.badge),
      grid,
    );
  }

  setTitle(t: string): void {
    if (this.title.textContent !== t) this.title.textContent = t;
  }

  setBadge(t: string, warn = false): void {
    if (this.badge.textContent !== t) this.badge.textContent = t;
    this.badge.classList.toggle('warn', warn);
  }

  /** Sets a row's target value (call every frame or whenever it changes). */
  set(key: string, value: number): void {
    const r = this.rows.get(key);
    if (r) r.target = value;
  }

  /** Shows or hides a row. */
  show(key: string, visible: boolean): void {
    const r = this.rows.get(key);
    if (!r) return;
    r.row.hidden = !visible;
    r.value.hidden = !visible;
  }

  /** Advances tweens by `dtMs` and refreshes the DOM at ~12 Hz. */
  update(dtMs: number, reduced: boolean): void {
    const dt = dtMs / 1000;
    for (const r of this.rows.values()) {
      if (reduced || r.def.smooth === false || !Number.isFinite(r.target)) r.damp.reset(r.target);
      else r.damp.update(r.target, dt);
    }
    this.acc += dtMs;
    if (this.acc < 80) return;
    this.acc = 0;
    for (const r of this.rows.values()) {
      const v = Number.isFinite(r.damp.value) ? r.damp.value : r.target;
      const text = Number.isFinite(v)
        ? `${v.toFixed(r.def.decimals ?? 0)}${r.def.suffix ?? ''}`
        : '–';
      if (text !== r.text) {
        r.text = text;
        r.value.textContent = text;
      }
    }
  }
}
