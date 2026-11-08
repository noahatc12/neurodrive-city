/**
 * First-run onboarding (spec M): a 4-step, dismissible coach-mark tour. Each step rings a
 * part of the interface and explains it in a small card with Back / Next / Skip. Esc
 * skips, Enter or → advances, ← goes back. Finishing or skipping is stored in
 * localStorage, so the tour shows once; Help can replay it.
 * @module ui/tour
 */
import { h } from './dom.ts';

export interface TourStep {
  /** Element to ring (looked up when the step opens). */
  target: () => Element | null;
  title: string;
  body: string;
}

export const TOUR_KEY = 'nd:tour';

export function tourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch {
    return true;
  }
}

export class Tour {
  readonly el: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly card: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly steps: readonly TourStep[];
  private index = 0;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.key === 'Escape') this.finish();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') this.go(this.index + 1);
    else if (e.key === 'ArrowLeft') this.go(this.index - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  private readonly onResize = (): void => this.place();

  constructor(steps: readonly TourStep[]) {
    this.steps = steps;
    this.ring = h('div', { class: 'tour-ring', aria: { hidden: 'true' } });
    this.title = h('h2', { class: 'tour-title', id: 'tour-title' });
    this.body = h('p', { class: 'tour-body', id: 'tour-body' });
    this.count = h('span', { class: 'tour-count tabular' });
    this.back = h('button', {
      class: 'btn btn-small',
      type: 'button',
      text: 'Back',
      onclick: () => this.go(this.index - 1),
    });
    this.next = h('button', {
      class: 'btn btn-small btn-primary',
      type: 'button',
      text: 'Next',
      onclick: () => this.go(this.index + 1),
    });
    const skip = h('button', {
      class: 'btn btn-small btn-ghost',
      type: 'button',
      text: 'Skip tour',
      onclick: () => this.finish(),
    });
    this.card = h(
      'div',
      {
        class: 'tour-card glass',
        role: 'dialog',
        aria: { modal: 'true', labelledby: 'tour-title', describedby: 'tour-body' },
      },
      this.count,
      this.title,
      this.body,
      h(
        'div',
        { class: 'tour-actions' },
        skip,
        h('span', { class: 'spacer' }),
        this.back,
        this.next,
      ),
    );
    this.el = h('div', { class: 'tour hidden' }, this.ring, this.card);
  }

  get active(): boolean {
    return !this.el.classList.contains('hidden');
  }

  get step(): number {
    return this.index;
  }

  start(): void {
    this.index = 0;
    this.el.classList.remove('hidden');
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.go(0);
  }

  private go(i: number): void {
    if (i >= this.steps.length) {
      this.finish();
      return;
    }
    this.index = Math.max(0, i);
    const s = this.steps[this.index] as TourStep;
    this.title.textContent = s.title;
    this.body.textContent = s.body;
    this.count.textContent = `${this.index + 1} of ${this.steps.length}`;
    this.back.disabled = this.index === 0;
    this.next.textContent = this.index === this.steps.length - 1 ? 'Done' : 'Next';
    this.place();
    this.next.focus();
  }

  /** Rings the step's target and puts the card beside it, inside the viewport. */
  private place(): void {
    const s = this.steps[this.index];
    const t = s?.target();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = Math.min(320, vw - 32);
    let x = (vw - cw) / 2;
    let y = vh / 2 - 80;
    if (t) {
      const r = t.getBoundingClientRect();
      const pad = 6;
      Object.assign(this.ring.style, {
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`,
        height: `${r.height + pad * 2}px`,
      });
      this.ring.hidden = false;
      // below the target if there is room, else above; to its right for tall targets
      if (r.height > vh * 0.4) {
        x = r.right + 16;
        y = r.top + 16;
      } else {
        x = r.left + r.width / 2 - cw / 2;
        y = r.bottom + 16;
        if (y + 190 > vh) y = r.top - 190;
      }
    } else this.ring.hidden = true;
    x = Math.max(16, Math.min(vw - cw - 16, x));
    y = Math.max(16, Math.min(vh - 200, y));
    Object.assign(this.card.style, { left: `${x}px`, top: `${y}px`, width: `${cw}px` });
  }

  finish(): void {
    this.el.classList.add('hidden');
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    try {
      localStorage.setItem(TOUR_KEY, 'done');
    } catch {
      // storage blocked: the tour simply shows again next time
    }
  }
}
