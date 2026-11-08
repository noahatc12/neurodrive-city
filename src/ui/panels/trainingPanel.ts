/**
 * Training controls (spec G3, G5, G8, F5): number of AI cars, mutation amount, simulation
 * speed, selection strategy, turbo training, the curvy-road toggle (infinite road), the
 * AI navigation toggle (city), and the brain buttons (save, discard, next generation,
 * reset, export, import). Lives inside the network panel in Train mode.
 * @module ui/panels/trainingPanel
 */
import type { Selection } from '../../engine/ai/evolution.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';

export interface TrainingCallbacks {
  onCars: (n: number) => void;
  onMutation: (m: number) => void;
  onSpeed: (x: number) => void;
  onSelection: (s: Selection) => void;
  onTurbo: (on: boolean) => void;
  onCurvy: (on: boolean) => void;
  onNav: (on: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onNextGen: () => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onCollapse: (collapsed: boolean) => void;
}

export class TrainingPanel {
  readonly el: HTMLElement;
  private readonly carsInput: HTMLInputElement;
  private readonly carsOut: HTMLOutputElement;
  private readonly mutInput: HTMLInputElement;
  private readonly mutOut: HTMLOutputElement;
  private readonly speedBtns = new Map<number, HTMLButtonElement>();
  private readonly selection: HTMLSelectElement;
  private readonly turbo: HTMLInputElement;
  private readonly curvy: HTMLInputElement;
  private readonly curvyRow: HTMLElement;
  private readonly nav: HTMLInputElement;
  private readonly navRow: HTMLElement;
  private readonly brainNote: HTMLElement;

  constructor(cb: TrainingCallbacks) {
    this.carsInput = h('input', {
      type: 'range',
      attrs: { min: '1', max: '1000', step: '1', value: '300' },
      aria: { label: 'Number of AI cars' },
      oninput: () => (this.carsOut.value = this.carsInput.value),
      onchange: () => cb.onCars(Number(this.carsInput.value)),
    });
    this.carsOut = h('output', { class: 'tabular', text: '300' });
    this.mutInput = h('input', {
      type: 'range',
      attrs: { min: '0', max: '1', step: '0.01', value: '0.1' },
      aria: { label: 'Mutation amount' },
      oninput: () => {
        this.mutOut.value = Number(this.mutInput.value).toFixed(2);
        cb.onMutation(Number(this.mutInput.value));
      },
    });
    this.mutOut = h('output', { class: 'tabular', text: '0.10' });
    const speeds = h('div', { class: 'chips', role: 'group', aria: { label: 'Simulation speed' } });
    for (const x of [1, 2, 4, 8]) {
      const b = h('button', {
        class: 'btn chip',
        text: `×${x}`,
        aria: { pressed: String(x === 1) },
        onclick: () => cb.onSpeed(x),
      });
      this.speedBtns.set(x, b);
      speeds.append(b);
    }
    this.selection = h('select', {
      class: 'select',
      aria: { label: 'Selection strategy' },
      onchange: () => cb.onSelection(this.selection.value as Selection),
    });
    this.selection.append(
      h('option', { attrs: { value: 'course' }, text: 'Course (one elite)' }),
      h('option', { attrs: { value: 'tournament' }, text: 'Tournament + crossover' }),
    );
    this.turbo = h('input', { type: 'checkbox', onchange: () => cb.onTurbo(this.turbo.checked) });
    this.curvy = h('input', { type: 'checkbox', onchange: () => cb.onCurvy(this.curvy.checked) });
    this.curvyRow = h('label', { class: 'check' }, this.curvy, h('span', { text: 'Curvy road' }));
    this.nav = h('input', {
      type: 'checkbox',
      aria: { label: 'AI navigation: add route inputs (waypoint angle and speed)' },
      onchange: () => cb.onNav(this.nav.checked),
    });
    this.navRow = h(
      'label',
      {
        class: 'check',
        title: 'Adds two inputs: the signed angle to the next route waypoint and the speed',
      },
      this.nav,
      h('span', { text: 'Route inputs (AI navigation)' }),
    );
    const file = h('input', {
      type: 'file',
      class: 'sr-only',
      attrs: { accept: '.json,application/json', tabindex: '-1' },
      onchange: () => {
        const f = file.files?.[0];
        if (f) cb.onImport(f);
        file.value = '';
      },
    });
    this.brainNote = h('p', { class: 'brain-note', text: 'No saved brain yet.' });
    this.el = h(
      'div',
      { class: 'train-controls' },
      h('label', { class: 'slider-row' }, h('span', { text: 'AI cars' }), this.carsOut),
      this.carsInput,
      h('label', { class: 'slider-row' }, h('span', { text: 'Mutation' }), this.mutOut),
      this.mutInput,
      h('div', { class: 'row' }, h('span', { class: 'row-label', text: 'Speed' }), speeds),
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'row-label', text: 'Selection' }),
        this.selection,
      ),
      h(
        'div',
        { class: 'row' },
        h('label', { class: 'check' }, this.turbo, h('span', { text: 'Turbo (worker)' })),
        this.curvyRow,
      ),
      h('div', { class: 'row' }, this.navRow),
      h(
        'div',
        { class: 'btn-grid' },
        h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            data: { tip: 'Save best brain  S' },
            onclick: cb.onSave,
          },
          icon('save'),
          h('span', { text: 'Save best' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-small',
            data: { tip: 'Discard saved brain  X' },
            onclick: cb.onDiscard,
          },
          icon('trash'),
          h('span', { text: 'Discard' }),
        ),
        h(
          'button',
          { class: 'btn btn-small', onclick: cb.onNextGen },
          icon('skip'),
          h('span', { text: 'Next gen' }),
        ),
        h(
          'button',
          { class: 'btn btn-small', onclick: cb.onReset },
          icon('reset'),
          h('span', { text: 'Reset' }),
        ),
        h(
          'button',
          { class: 'btn btn-small', onclick: cb.onExport },
          icon('download'),
          h('span', { text: 'Export' }),
        ),
        h(
          'button',
          { class: 'btn btn-small', onclick: () => file.click() },
          icon('upload'),
          h('span', { text: 'Import' }),
        ),
      ),
      this.brainNote,
      file,
    );
  }

  /** Shown in Train mode; the curvy toggle on the infinite road, navigation in cities. */
  setMode(train: boolean, infinite: boolean): void {
    this.el.hidden = !train;
    this.curvyRow.hidden = !infinite;
    this.navRow.hidden = infinite;
  }

  setSpeed(x: number): void {
    for (const [v, b] of this.speedBtns) {
      b.classList.toggle('active', v === x);
      b.setAttribute('aria-pressed', String(v === x));
    }
  }

  syncControls(
    cars: number,
    mutation: number,
    selection: Selection,
    curvy: boolean,
    turbo: boolean,
    nav: boolean,
  ): void {
    if (document.activeElement !== this.carsInput) this.carsInput.value = String(cars);
    this.carsOut.value = String(cars);
    if (document.activeElement !== this.mutInput) this.mutInput.value = String(mutation);
    this.mutOut.value = mutation.toFixed(2);
    this.selection.value = selection;
    this.curvy.checked = curvy;
    this.turbo.checked = turbo;
    this.nav.checked = nav;
  }

  setBrainNote(text: string): void {
    if (this.brainNote.textContent !== text) this.brainNote.textContent = text;
  }

  setTurboAvailable(ok: boolean): void {
    this.turbo.disabled = !ok;
  }
}
