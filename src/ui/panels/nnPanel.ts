/**
 * Right panel (Simulate/Train): header stats, the live network visualizer with hover
 * explanations, the fitness sparkline, and the training controls (`TrainingPanel`). Docked right,
 * collapsible with an eased slide, resizable by dragging its left edge.
 * @module ui/panels/nnPanel
 */
import type { GenerationRecord, Selection } from '../../engine/ai/evolution.ts';
import type { NeuralNetwork } from '../../engine/ai/network.ts';
import { NetworkVisualizer } from '../../viz/networkVisualizer.ts';
import { Sparkline } from '../../viz/sparkline.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { TrainingPanel, type TrainingCallbacks } from './trainingPanel.ts';

export type { TrainingCallbacks } from './trainingPanel.ts';

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
  readonly training: TrainingPanel;
  private readonly tooltip: HTMLElement;
  private readonly header: Record<keyof PanelStats, HTMLElement>;
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

    this.training = new TrainingPanel(cb);

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
        this.training.el,
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
    this.training.setMode(train, infinite);
  }

  /**
   * Shows the focused car's brain: `rayCount` inputs drawn as ray glyphs fanned over
   * `spread`, then the `labels` of the remaining (route) inputs.
   */
  setNetwork(
    net: NeuralNetwork | null,
    weightsKey: number,
    rayCount: number,
    labels: readonly string[] = [],
    spread = Math.PI / 2,
  ): void {
    this.viz.setInputs(rayCount, labels, spread);
    this.viz.setNetwork(net, weightsKey);
  }

  /** Curriculum stage line in the training controls. */
  setStage(text: string): void {
    this.training.setStage(text);
  }

  setSpeed(x: number): void {
    this.training.setSpeed(x);
  }

  syncControls(
    cars: number,
    mutation: number,
    selection: Selection,
    curvy: boolean,
    turbo: boolean,
    nav = false,
    curriculum = false,
  ): void {
    this.training.syncControls(cars, mutation, selection, curvy, turbo, nav, curriculum);
  }

  setBrainNote(text: string): void {
    this.training.setBrainNote(text);
  }

  setTurboAvailable(ok: boolean): void {
    this.training.setTurboAvailable(ok);
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
