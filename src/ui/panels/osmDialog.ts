/**
 * OSM import dialog (spec J3): paste Overpass JSON, copy a sample query, load the
 * bundled sample, choose options, import. The app never calls the network itself;
 * users run the query on overpass-turbo.eu and paste or upload the result.
 * @module ui/panels/osmDialog
 */
import { SAMPLE_OVERPASS_QUERY, type OsmImportOptions } from '../../engine/osm/osmParse.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { Dialog } from './dialog.ts';

export interface OsmDialogCallbacks {
  onImport: (text: string, opts: OsmImportOptions) => void;
  loadSampleText: () => Promise<string>;
  toast: (msg: string) => void;
}

export class OsmDialog {
  readonly dialog: Dialog;
  private readonly text: HTMLTextAreaElement;
  private readonly scale: HTMLInputElement;
  private readonly scaleOut: HTMLOutputElement;
  private readonly oneWays: HTMLInputElement;

  constructor(cb: OsmDialogCallbacks) {
    this.dialog = new Dialog('Import OpenStreetMap', 'osm-dialog');
    const query = h('pre', { class: 'code', text: SAMPLE_OVERPASS_QUERY });
    const copy = h(
      'button',
      {
        class: 'btn btn-small',
        onclick: () => {
          void navigator.clipboard?.writeText(SAMPLE_OVERPASS_QUERY).then(
            () => cb.toast('Query copied'),
            () => cb.toast('Copy failed: select the text manually'),
          );
        },
      },
      icon('save'),
      h('span', { text: 'Copy query' }),
    );
    this.text = h('textarea', {
      class: 'code-input',
      aria: { label: 'Overpass JSON' },
      attrs: {
        placeholder: '{ "elements": [ ... ] }  (paste Overpass JSON here)',
        spellcheck: 'false',
        rows: '8',
      },
    });
    const file = h('input', {
      type: 'file',
      class: 'sr-only',
      attrs: { accept: '.json,application/json', tabindex: '-1' },
      onchange: () => {
        const f = file.files?.[0];
        if (f) void f.text().then((t) => (this.text.value = t));
        file.value = '';
      },
    });
    this.scale = h('input', {
      type: 'range',
      attrs: { min: '0.5', max: '1.5', step: '0.05', value: '1' },
      aria: { label: 'Road width scale' },
      oninput: () => (this.scaleOut.value = `${Number(this.scale.value).toFixed(2)}×`),
    });
    this.scaleOut = h('output', { class: 'tabular', text: '1.00×' });
    this.oneWays = h('input', { type: 'checkbox' });
    this.oneWays.checked = true;

    this.dialog.body.append(
      h('p', {
        class: 'dialog-text',
        html: 'Run this query on <strong>overpass-turbo.eu</strong> over a small area (a few blocks), export <em>raw OSM data</em> as JSON, then paste or upload it below.',
      }),
      h('div', { class: 'code-wrap' }, query, copy),
      this.text,
      h(
        'div',
        { class: 'dialog-row' },
        h(
          'button',
          { class: 'btn btn-small', onclick: () => file.click() },
          icon('upload'),
          h('span', { text: 'Upload file' }),
        ),
        h(
          'button',
          {
            class: 'btn btn-small',
            onclick: () => {
              void cb.loadSampleText().then((t) => {
                this.text.value = t;
                cb.toast('Sample loaded: a small fictional town');
              });
            },
          },
          icon('globe'),
          h('span', { text: 'Load sample' }),
        ),
        file,
      ),
      h(
        'div',
        { class: 'dialog-row options' },
        h(
          'label',
          { class: 'slider-row inline' },
          h('span', { text: 'Road width scale' }),
          this.scale,
          this.scaleOut,
        ),
        h('label', { class: 'check' }, this.oneWays, h('span', { text: 'Include one-way roads' })),
      ),
    );
    this.dialog.footer.append(
      h('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => this.dialog.hide() }),
      h('button', {
        class: 'btn btn-primary',
        text: 'Import',
        onclick: () => {
          const t = this.text.value.trim();
          if (!t) {
            cb.toast('Paste Overpass JSON or load the sample first');
            return;
          }
          cb.onImport(t, {
            roadWidthScale: Number(this.scale.value),
            includeOneWays: this.oneWays.checked,
          });
          this.dialog.hide();
        },
      }),
    );
  }

  show(): void {
    this.dialog.show();
  }
}
