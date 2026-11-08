/**
 * 3D view settings (spec K8, K10, M bottom-right): quality preset (Low / Medium / High)
 * with an "Auto" toggle for frame-time based downgrades, and the time of day as a
 * slider with an auto-cycle toggle. Shown above the camera chips while the 3D view is
 * active.
 * @module ui/panels/settingsPanel
 */
import { h } from '../dom.ts';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface ViewSettingsState {
  quality: QualityLevel;
  autoQuality: boolean;
  /** Time of day in [0, 1). */
  time: number;
  cycle: boolean;
}

export interface ViewSettingsHandlers {
  onQuality(q: QualityLevel): void;
  onAutoQuality(on: boolean): void;
  onTime(t: number): void;
  onCycle(on: boolean): void;
}

const LEVELS: readonly { id: QualityLevel; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

/** "13:45" for a time of day in [0, 1). */
export function formatClock(t: number): string {
  const mins = Math.round((((t % 1) + 1) % 1) * 24 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  private readonly auto: HTMLInputElement;
  private readonly time: HTMLInputElement;
  private readonly clock: HTMLOutputElement;
  private readonly cycle: HTMLInputElement;
  private dragging = false;

  constructor(cb: ViewSettingsHandlers) {
    const chips = LEVELS.map((l) => {
      const b = h('button', {
        class: 'btn chip',
        type: 'button',
        text: l.label,
        aria: { pressed: 'false' },
        data: { quality: l.id },
        onclick: () => cb.onQuality(l.id),
      });
      this.qualityButtons.set(l.id, b);
      return b;
    });
    this.auto = h('input', {
      type: 'checkbox',
      aria: { label: 'Lower quality automatically when frames are slow' },
      onchange: () => cb.onAutoQuality(this.auto.checked),
    });
    this.time = h('input', {
      type: 'range',
      attrs: { min: '0', max: '1', step: '0.005', value: '0.42' },
      aria: { label: 'Time of day' },
      oninput: () => {
        const t = Number(this.time.value);
        this.clock.value = formatClock(t);
        cb.onTime(t);
      },
    });
    this.time.addEventListener('pointerdown', () => (this.dragging = true));
    this.time.addEventListener('pointerup', () => (this.dragging = false));
    this.clock = h('output', { class: 'tabular clock', text: '10:05' });
    this.cycle = h('input', {
      type: 'checkbox',
      aria: { label: 'Cycle day and night automatically' },
      onchange: () => cb.onCycle(this.cycle.checked),
    });
    this.el = h(
      'div',
      { class: 'view-settings glass hidden', role: 'group', aria: { label: '3D view settings' } },
      h(
        'div',
        { class: 'vs-row' },
        h('span', { class: 'vs-label', text: 'Quality' }),
        h('div', { class: 'vs-chips', role: 'group', aria: { label: 'Quality preset' } }, ...chips),
        h(
          'label',
          { class: 'check', title: 'Step down when the average frame takes over 20 ms for 3 s' },
          this.auto,
          h('span', { text: 'Auto' }),
        ),
      ),
      h(
        'div',
        { class: 'vs-row' },
        h('span', { class: 'vs-label', text: 'Time' }),
        this.time,
        this.clock,
        h(
          'label',
          { class: 'check', title: 'Run a full day every 4 minutes (L toggles day and night)' },
          this.cycle,
          h('span', { text: 'Cycle' }),
        ),
      ),
    );
  }

  set(state: ViewSettingsState): void {
    for (const [id, b] of this.qualityButtons) {
      b.classList.toggle('active', id === state.quality);
      b.setAttribute('aria-pressed', String(id === state.quality));
    }
    this.auto.checked = state.autoQuality;
    this.cycle.checked = state.cycle;
    this.setTime(state.time);
  }

  /** Updates the slider and clock unless the user is dragging the slider. */
  setTime(t: number): void {
    if (this.dragging) return;
    this.time.value = String(t);
    this.clock.value = formatClock(t);
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }
}
