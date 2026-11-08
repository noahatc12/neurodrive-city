/**
 * Toast notifications that spring in, optionally carry an action (e.g. Undo), and
 * dismiss themselves.
 * @module ui/toast
 */
import { h } from './dom.ts';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Milliseconds before auto-dismiss (0 = sticky). */
  duration?: number;
  action?: { label: string; run: () => void };
  /** Extra lines (e.g. validation errors). */
  details?: string[];
}

export class Toaster {
  readonly el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'toasts', role: 'status', aria: { live: 'polite' } });
  }

  show(message: string, opts: ToastOptions = {}): () => void {
    const kind = opts.kind ?? 'info';
    const close = (): void => {
      item.classList.add('leaving');
      window.setTimeout(() => item.remove(), 220);
    };
    const item = h(
      'div',
      { class: `toast toast-${kind}`, data: { kind } },
      h('div', { class: 'toast-body' }, h('div', { class: 'toast-msg', text: message })),
    );
    if (opts.details && opts.details.length > 0) {
      const list = h('ul', { class: 'toast-details' });
      for (const d of opts.details.slice(0, 6)) list.append(h('li', { text: d }));
      if (opts.details.length > 6)
        list.append(h('li', { text: `…and ${opts.details.length - 6} more` }));
      item.firstElementChild?.append(list);
    }
    if (opts.action) {
      const { label, run } = opts.action;
      item.append(
        h('button', {
          class: 'toast-action',
          text: label,
          onclick: () => {
            run();
            close();
          },
        }),
      );
    }
    item.append(
      h('button', { class: 'toast-close', aria: { label: 'Dismiss' }, text: '×', onclick: close }),
    );
    this.el.append(item);
    while (this.el.children.length > 4) this.el.firstElementChild?.remove();
    const duration = opts.duration ?? (opts.action ? 6000 : kind === 'error' ? 7000 : 2600);
    if (duration > 0) window.setTimeout(close, duration);
    return close;
  }
}
