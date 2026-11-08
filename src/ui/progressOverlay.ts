/**
 * Non-blocking progress card (world generation in a worker, OSM imports). The app
 * keeps rendering underneath; the card fades in only if the job takes > 150 ms.
 * @module ui/progressOverlay
 */
import { h } from './dom.ts';

export class ProgressOverlay {
  readonly el: HTMLElement;
  private readonly label: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly pct: HTMLElement;
  private showTimer = 0;
  private active = false;

  constructor() {
    this.label = h('span', { class: 'progress-label', text: 'Working…' });
    this.pct = h('span', { class: 'progress-pct tabular', text: '0%' });
    this.bar = h('div', { class: 'progress-fill' });
    this.el = h(
      'div',
      {
        class: 'progress-card glass',
        role: 'progressbar',
        aria: { valuemin: '0', valuemax: '100', valuenow: '0', hidden: 'true' },
      },
      h('div', { class: 'progress-row' }, this.label, this.pct),
      h('div', { class: 'progress-track' }, this.bar),
    );
  }

  get isActive(): boolean {
    return this.active;
  }

  start(label: string): void {
    this.label.textContent = label;
    this.set(0);
    if (this.active) return;
    this.active = true;
    window.clearTimeout(this.showTimer);
    this.showTimer = window.setTimeout(() => {
      if (this.active) {
        this.el.classList.add('open');
        this.el.setAttribute('aria-hidden', 'false');
      }
    }, 150);
  }

  set(fraction: number, label?: string): void {
    const p = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    this.bar.style.transform = `scaleX(${p / 100})`;
    this.pct.textContent = `${p}%`;
    this.el.setAttribute('aria-valuenow', String(p));
    if (label) this.label.textContent = label;
  }

  done(): void {
    this.active = false;
    window.clearTimeout(this.showTimer);
    this.set(1);
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }
}
