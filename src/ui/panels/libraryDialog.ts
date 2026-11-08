/**
 * World library (spec J1): every world autosaved to IndexedDB with its name, minimap
 * thumbnail and timestamp. Switch worlds without losing work, rename the current one,
 * delete with undo, or start an empty world.
 * @module ui/panels/libraryDialog
 */
import type { WorldSummary } from '../../app/storage.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { Dialog } from './dialog.ts';

export interface LibraryCallbacks {
  list: () => Promise<WorldSummary[]>;
  currentId: () => string;
  currentName: () => string;
  open: (id: string) => void;
  remove: (id: string) => Promise<void>;
  rename: (name: string) => void;
  newWorld: () => void;
}

export class LibraryDialog {
  readonly dialog: Dialog;
  private readonly grid: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly cb: LibraryCallbacks;

  constructor(cb: LibraryCallbacks) {
    this.cb = cb;
    this.dialog = new Dialog('World library', 'library-dialog');
    this.name = h('input', {
      class: 'name-input',
      aria: { label: 'Current world name' },
      attrs: { maxlength: '60' },
      onchange: () => {
        const v = this.name.value.trim();
        if (v) cb.rename(v);
        void this.refresh();
      },
    });
    this.grid = h('div', { class: 'library-grid', role: 'list' });
    this.dialog.body.append(
      h('label', { class: 'dialog-row name-row' }, h('span', { text: 'Current world' }), this.name),
      this.grid,
    );
    this.dialog.footer.append(
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            cb.newWorld();
            this.dialog.hide();
          },
        },
        icon('graph'),
        h('span', { text: 'New empty world' }),
      ),
    );
  }

  async show(): Promise<void> {
    this.name.value = this.cb.currentName();
    this.dialog.show();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const worlds = await this.cb.list();
    this.grid.replaceChildren();
    if (worlds.length === 0) {
      this.grid.append(
        h('p', { class: 'dialog-text', text: 'No saved worlds yet. Worlds autosave as you edit.' }),
      );
      return;
    }
    const current = this.cb.currentId();
    for (const w of worlds) {
      const thumb = w.thumbnail
        ? h('img', { class: 'lib-thumb', attrs: { src: w.thumbnail, alt: '' } })
        : h('div', { class: 'lib-thumb empty' }, icon('city'));
      const card = h(
        'div',
        { class: `lib-card${w.id === current ? ' current' : ''}`, role: 'listitem' },
        thumb,
        h(
          'div',
          { class: 'lib-meta' },
          h('div', { class: 'lib-name', text: w.name }),
          h('div', { class: 'lib-time tabular', text: new Date(w.updatedAt).toLocaleString() }),
        ),
        h(
          'div',
          { class: 'lib-actions' },
          h('button', {
            class: 'btn btn-small btn-primary',
            text: w.id === current ? 'Open (current)' : 'Open',
            onclick: () => {
              this.cb.open(w.id);
              this.dialog.hide();
            },
          }),
          h(
            'button',
            {
              class: 'btn btn-small btn-ghost',
              aria: { label: `Delete ${w.name}` },
              onclick: () => void this.cb.remove(w.id).then(() => this.refresh()),
            },
            icon('trash'),
          ),
        ),
      );
      this.grid.append(card);
    }
  }
}
