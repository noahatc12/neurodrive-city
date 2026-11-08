/**
 * World settings panel (spec B9): collapsible, with sliders for generation settings, a
 * seed field with a reseed button, and layer toggles (including debug layers).
 * Slider changes are debounced before they reach the model, so dragging a slider
 * regenerates the world live without thrashing.
 * @module ui/panels/worldPanel
 */
import type { LayerFlags } from '../../app/renderer.ts';
import { SETTINGS_LIMITS, type WorldSettings } from '../../engine/world/settings.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';

interface SliderDef {
  key: keyof WorldSettings;
  label: string;
  step: number;
  unit?: string;
}

const SLIDERS: readonly SliderDef[] = [
  { key: 'roadWidth', label: 'Road width', step: 2 },
  { key: 'roadRoundness', label: 'Roundness', step: 1 },
  { key: 'buildingWidth', label: 'Building width', step: 5 },
  { key: 'buildingMinLength', label: 'Building min length', step: 5 },
  { key: 'spacing', label: 'Spacing', step: 2 },
  { key: 'treeSize', label: 'Tree size', step: 5 },
  { key: 'treeDensity', label: 'Tree density', step: 0.05 },
  { key: 'sidewalkWidth', label: 'Sidewalk width', step: 1 },
];

const LAYERS: readonly { key: keyof LayerFlags; label: string; debug?: boolean }[] = [
  { key: 'roads', label: 'Roads' },
  { key: 'laneMarkings', label: 'Lane markings' },
  { key: 'sidewalks', label: 'Sidewalks' },
  { key: 'buildings', label: 'Buildings' },
  { key: 'trees', label: 'Trees' },
  { key: 'markings', label: 'Markings' },
  { key: 'minimap', label: 'Minimap' },
  { key: 'debugBorders', label: 'Road borders', debug: true },
  { key: 'debugLaneGuides', label: 'Lane guides', debug: true },
  { key: 'debugBuildingGuides', label: 'Building guides', debug: true },
  { key: 'debugHashCells', label: 'Spatial-hash cells', debug: true },
  { key: 'debugCarPolygons', label: 'Car polygons', debug: true },
  { key: 'debugSensors', label: 'All sensor rays', debug: true },
];

export interface WorldPanelCallbacks {
  onSettings: (partial: Partial<WorldSettings>) => void;
  onSeed: (seed: number) => void;
  onReseed: () => void;
  onLayer: (key: keyof LayerFlags, value: boolean) => void;
}

export class WorldPanel {
  readonly el: HTMLElement;
  private readonly inputs = new Map<
    keyof WorldSettings,
    { input: HTMLInputElement; out: HTMLOutputElement }
  >();
  private readonly layerInputs = new Map<keyof LayerFlags, HTMLInputElement>();
  private readonly seedInput: HTMLInputElement;
  private collapsed: boolean;
  private debounce = 0;
  private pending: Partial<WorldSettings> = {};

  constructor(cb: WorldPanelCallbacks, collapsed = true) {
    this.collapsed = collapsed;
    const body = h('div', { class: 'panel-body', id: 'world-panel-body' });

    const sliders = h('div', { class: 'sliders' });
    for (const def of SLIDERS) {
      const [min, max] = SETTINGS_LIMITS[def.key];
      const id = `ws-${def.key}`;
      const input = h('input', {
        id,
        type: 'range',
        attrs: { min: String(min), max: String(max), step: String(def.step) },
        oninput: () => {
          out.value = format(def.key, Number(input.value));
          this.pending[def.key] = Number(input.value);
          window.clearTimeout(this.debounce);
          this.debounce = window.setTimeout(() => {
            cb.onSettings(this.pending);
            this.pending = {};
          }, 120);
        },
      });
      const out = h('output', { class: 'tabular', attrs: { for: id } });
      this.inputs.set(def.key, { input, out });
      sliders.append(
        h(
          'label',
          { class: 'slider-row', attrs: { for: id } },
          h('span', { text: def.label }),
          out,
        ),
        input,
      );
    }

    this.seedInput = h('input', {
      class: 'seed-input tabular',
      type: 'number',
      aria: { label: 'Seed' },
      attrs: { min: '0', step: '1' },
      onchange: () => {
        const v = Math.floor(Number(this.seedInput.value));
        if (Number.isFinite(v) && v >= 0) cb.onSeed(v);
      },
    });
    const seedRow = h(
      'div',
      { class: 'seed-row' },
      h('span', { text: 'Seed' }),
      this.seedInput,
      h(
        'button',
        {
          class: 'btn btn-small',
          aria: { label: 'Reseed' },
          data: { tip: 'New random seed' },
          onclick: cb.onReseed,
        },
        icon('dice'),
        h('span', { text: 'Reseed' }),
      ),
    );

    const layers = h('div', { class: 'layers' });
    const debug = h('div', { class: 'layers' });
    for (const l of LAYERS) {
      const input = h('input', {
        type: 'checkbox',
        onchange: () => cb.onLayer(l.key, input.checked),
      });
      this.layerInputs.set(l.key, input);
      (l.debug ? debug : layers).append(
        h('label', { class: 'check' }, input, h('span', { text: l.label })),
      );
    }

    body.append(
      h('h3', { class: 'panel-sub', text: 'Generation' }),
      sliders,
      seedRow,
      h('h3', { class: 'panel-sub', text: 'Layers' }),
      layers,
      h('h3', { class: 'panel-sub', text: 'Debug layers' }),
      debug,
    );

    const toggle = h(
      'button',
      {
        class: 'panel-toggle',
        aria: { expanded: String(!collapsed), controls: 'world-panel-body' },
        onclick: () => this.setCollapsed(!this.collapsed),
      },
      icon('sliders'),
      h('span', { text: 'World settings' }),
      h('span', { class: 'chev' }, icon('chevron')),
    );
    this.el = h(
      'section',
      {
        class: `world-panel glass${collapsed ? ' collapsed' : ''}`,
        aria: { label: 'World settings' },
      },
      toggle,
      body,
    );
  }

  setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.el.classList.toggle('collapsed', c);
    this.el.querySelector('.panel-toggle')?.setAttribute('aria-expanded', String(!c));
  }

  /** Reflects model values into the controls. */
  sync(settings: Readonly<WorldSettings>, seed: number, layers: Readonly<LayerFlags>): void {
    for (const [key, { input, out }] of this.inputs) {
      if (document.activeElement !== input) input.value = String(settings[key]);
      out.value = format(key, settings[key]);
    }
    if (document.activeElement !== this.seedInput) this.seedInput.value = String(seed);
    for (const [key, input] of this.layerInputs) input.checked = layers[key];
  }
}

function format(key: keyof WorldSettings, v: number): string {
  return key === 'treeDensity'
    ? `${Math.round(v * 100)}%`
    : key === 'roadRoundness'
      ? String(v)
      : `${(v / 10).toFixed(1)} m`;
}
