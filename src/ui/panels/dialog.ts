/**
 * Shared modal dialog shell: overlay, titled glass card, close button, Esc/backdrop to
 * close, and focus return to the element that opened it.
 * @module ui/panels/dialog
 */
import { h } from '../dom.ts';
import { icon } from '../icons.ts';

export class Dialog {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  private lastFocus: Element | null = null;
  private visible = false;
  onClose: () => void = () => {};

  constructor(title: string, className = '') {
    this.body = h('div', { class: 'dialog-body' });
    this.footer = h('div', { class: 'dialog-footer' });
    const card = h(
      'div',
      {
        class: `help-dialog glass dialog ${className}`,
        role: 'dialog',
        aria: { modal: 'true', label: title },
      },
      h(
        'div',
        { class: 'help-head' },
        h('h2', { text: title }),
        h(
          'button',
          {
            class: 'btn btn-ghost icon-btn',
            aria: { label: `Close ${title}` },
            onclick: () => this.hide(),
          },
          icon('close'),
        ),
      ),
      this.body,
      this.footer,
    );
    this.el = h('div', { class: 'overlay', aria: { hidden: 'true' } }, card);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
      }
    });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.lastFocus = document.activeElement;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    const first = this.el.querySelector<HTMLElement>('textarea, input, button.btn-primary, button');
    first?.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
    this.onClose();
  }
}
