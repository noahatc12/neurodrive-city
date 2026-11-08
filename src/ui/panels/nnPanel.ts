/**
 * Right panel (Simulate/Train): header stats, the live network visualizer with hover
 * explanations, the fitness sparkline, and the training controls. Docked right,
 * collapsible with an eased slide, resizable by dragging its left edge.
 * @module ui/panels/nnPanel
 */
import type { GenerationRecord, Selection } from '../../engine/ai/evolution.ts';
import type { NeuralNetwork } from '../../engine/ai/network.ts';
import { NetworkVisualizer } from '../../viz/networkVisualizer.ts';
import { Sparkline } from '../../viz/sparkline.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';

export interface TrainingCallbacks {
  onCars: (n: number) => void;
  onMutation: (m: number) => void;
  onSpeed: (x: number) => void;
  onSelection: (s: Selection) => void;
  onTurbo: (on: boolean) => void;
  onCurvy: (on: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onNextGen: () => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onCollapse: (collapsed: boolean) => void;
}

export interface PanelStats {
  generation: number;
  fitness: number;
  bestEver: number;
  speed: number;
  alive: number;
  total: number;
}

export class NnPanel {
  readonly el: HTMLElement;
  readonly viz = new NetworkVisualizer();
  readonly spark = new Sparkline(260, 54);
  private readonly tooltip: HTMLElement;
  private readonly header: Record<keyof PanelStats, HTMLElement>;
  private readonly trainControls: HTMLElement;
  private readonly carsInput: HTMLInputElement;
  private readonly carsOut: HTMLOutputElement;
  private readonly mutInput: HTMLInputElement;
  private readonly mutOut: HTMLOutputElement;
  private readonly speedBtns = new Map<number, HTMLButtonElement>();
  private readonly selection: HTMLSelectElement;
  private readonly turbo: HTMLInputElement;
  private readonly curvy: HTMLInputElement;
  private readonly curvyRow: HTMLElement;
  private readonly brainNote: HTMLElement;
  private collapsed = false;
  private width = 300;
  private lastStats = '';

  constructor(cb: TrainingCallbacks) {
    const stat = (): HTMLElement => h('dd', { class: 'tabular', text: '–' });
    this.header = {
      generation: stat(),
      fitness: stat(),
      bestEver: stat(),
      speed: stat(),
      alive: stat(),
      total: stat(),
    };
    const head = h(
      'dl',
      { class: 'nn-stats' },
      h('dt', { text: 'Generation' }),
      this.header.generation,
      h('dt', { text: 'Fitness' }),
      this.header.fitness,
      h('dt', { text: 'Best ever' }),
      this.header.bestEver,
      h('dt', { text: 'Speed' }),
      this.header.speed,
      h('dt', { text: 'Alive' }),
      this.header.alive,
      h('dt', { text: 'Total' }),
      this.header.total,
    );
    this.tooltip = h('div', { class: 'nn-tooltip', role: 'tooltip' });
    const vizWrap = h('div', { class: 'nn-viz' }, this.viz.canvas, this.tooltip);

    // training controls
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
    this.trainControls = h(
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

    const toggle = h(
      'button',
      {
        class: 'btn btn-ghost icon-btn panel-collapse',
        aria: { label: 'Toggle neural network panel (N)', expanded: 'true' },
        data: { tip: 'Network panel  N' },
        onclick: () => {
          this.setCollapsed(!this.collapsed);
          cb.onCollapse(this.collapsed);
        },
      },
      icon('brain'),
    );
    const grip = h('div', { class: 'panel-grip', aria: { hidden: 'true' } });
    this.el = h(
      'aside',
      { class: 'nn-panel glass', aria: { label: 'Neural network and training' } },
      grip,
      h('div', { class: 'nn-head' }, h('h2', { text: 'Neural network' }), toggle),
      h(
        'div',
        { class: 'nn-body' },
        head,
        vizWrap,
        h(
          'div',
          { class: 'spark-wrap' },
          h('span', { class: 'spark-label', text: 'Best (line) and average (area) fitness' }),
          this.spark.canvas,
        ),
        this.trainControls,
      ),
    );
    this.bindResize(grip);
    this.layout();
  }

  private bindResize(grip: HTMLElement): void {
    let startX = 0;
    let startW = 0;
    const move = (e: PointerEvent): void => {
      this.width = Math.max(260, Math.min(520, startW + (startX - e.clientX)));
      this.layout();
    };
    grip.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startW = this.width;
      grip.setPointerCapture(e.pointerId);
      grip.addEventListener('pointermove', move);
    });
    grip.addEventListener('pointerup', () => grip.removeEventListener('pointermove', move));
  }

  private layout(): void {
    this.el.style.width = `${this.width}px`;
    const inner = this.width - 28;
    this.viz.resize(inner, Math.round(inner * 0.78));
    this.spark.resize(inner, 54);
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.el.classList.toggle('collapsed', c);
    this.el.querySelector('.panel-collapse')?.setAttribute('aria-expanded', String(!c));
  }

  /** Train controls are only meaningful in Train mode. */
  setTrainMode(train: boolean, infinite: boolean): void {
    this.trainControls.hidden = !train;
    this.curvyRow.hidden = !infinite;
  }

  setNetwork(net: NeuralNetwork | null, weightsKey: number, rayCount: number): void {
    this.viz.rayCount = rayCount;
    this.viz.setNetwork(net, weightsKey);
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
  ): void {
    if (document.activeElement !== this.carsInput) this.carsInput.value = String(cars);
    this.carsOut.value = String(cars);
    if (document.activeElement !== this.mutInput) this.mutInput.value = String(mutation);
    this.mutOut.value = mutation.toFixed(2);
    this.selection.value = selection;
    this.curvy.checked = curvy;
    this.turbo.checked = turbo;
  }

  setBrainNote(text: string): void {
    if (this.brainNote.textContent !== text) this.brainNote.textContent = text;
  }

  setTurboAvailable(ok: boolean): void {
    this.turbo.disabled = !ok;
  }

  /** Per-frame update: draws the visualizer (≤ 30 Hz) and refreshes stats text. */
  update(
    timeMs: number,
    dtMs: number,
    stats: PanelStats,
    history: readonly GenerationRecord[],
    reduced: boolean,
  ): void {
    const visible = !this.collapsed && !this.el.hidden;
    this.viz.update(timeMs, dtMs, visible, reduced);
    if (!visible) return;
    this.spark.draw(history, `${history.length}`);
    const text = `${stats.generation}|${Math.round(stats.fitness)}|${Math.round(stats.bestEver)}|${Math.round(stats.speed)}|${stats.alive}|${stats.total}`;
    if (text !== this.lastStats) {
      this.lastStats = text;
      this.header.generation.textContent = String(stats.generation);
      this.header.fitness.textContent = Math.round(stats.fitness).toLocaleString('en-US');
      this.header.bestEver.textContent = Math.round(stats.bestEver).toLocaleString('en-US');
      this.header.speed.textContent = `${Math.round(stats.speed)} km/h`;
      this.header.alive.textContent = String(stats.alive);
      this.header.total.textContent = String(stats.total);
    }
    const hv = this.viz.hover;
    if (hv) {
      this.tooltip.textContent = hv.text;
      this.tooltip.style.transform = `translate(${Math.round(hv.x + 12)}px, ${Math.round(hv.y + 12)}px)`;
      this.tooltip.classList.add('show');
    } else this.tooltip.classList.remove('show');
  }
}
