/**
 * `?` help overlay listing every keyboard shortcut, generated from the keymap table.
 * @module ui/panels/helpOverlay
 */
import { SHORTCUT_DOCS, type ShortcutDoc } from '../../app/keymap.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';

export class HelpOverlay {
  readonly el: HTMLElement;
  private visible = false;
  private lastFocus: Element | null = null;

  constructor(onTour?: () => void) {
    const groups = new Map<ShortcutDoc['group'], ShortcutDoc[]>();
    for (const d of SHORTCUT_DOCS) {
      const list = groups.get(d.group) ?? [];
      list.push(d);
      groups.set(d.group, list);
    }
    const cols = h('div', { class: 'help-grid' });
    for (const [group, docs] of groups) {
      const table = h('dl', { class: 'help-list' });
      for (const d of docs)
        table.append(
          h(
            'dt',
            {},
            ...d.keys.split(' / ').flatMap((k, i) => [i > 0 ? ' / ' : null, h('kbd', { text: k })]),
          ),
          h('dd', { text: d.label }),
        );
      cols.append(h('section', { class: 'help-group' }, h('h3', { text: group }), table));
    }
    const dialog = h(
      'div',
      {
        class: 'help-dialog glass',
        role: 'dialog',
        aria: { modal: 'true', label: 'Keyboard shortcuts' },
      },
      h(
        'div',
        { class: 'help-head' },
        h('h2', { text: 'Keyboard shortcuts' }),
        h(
          'button',
          {
            class: 'btn btn-ghost icon-btn',
            aria: { label: 'Close help' },
            onclick: () => this.hide(),
          },
          icon('close'),
        ),
      ),
      cols,
      onTour
        ? h(
            'div',
            { class: 'help-foot' },
            h('button', {
              class: 'btn btn-small',
              type: 'button',
              text: 'Replay the tour',
              onclick: () => {
                this.hide();
                onTour();
              },
            }),
          )
        : null,
    );
    this.el = h('div', { class: 'overlay help-overlay', aria: { hidden: 'true' } }, dialog);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    this.visible = true;
    this.lastFocus = document.activeElement;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.el.querySelector<HTMLButtonElement>('button')?.focus();
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
  }
}
