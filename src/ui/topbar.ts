/**
 * Top bar: brand, mode switch (Edit / Simulate / Train), 2D/3D toggle, world menu, help.
 * Segmented controls have a sliding thumb that morphs between options.
 * @module ui/topbar
 */
import type { AppMode } from '../app/renderer.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  separatorBefore?: boolean;
  danger?: boolean;
}

export interface TopbarCallbacks {
  onMode: (mode: AppMode) => void;
  onView: (view: '2d' | '3d') => void;
  onMenu: (id: string) => void;
  onHelp: () => void;
}

/** A segmented control whose highlighted "thumb" slides to the selected option. */
export class Segmented<T extends string> {
  readonly el: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly buttons = new Map<T, HTMLButtonElement>();
  private value: T;

  constructor(
    label: string,
    options: readonly { value: T; label: string; icon?: IconName; tip?: string }[],
    initial: T,
    onChange: (v: T) => void,
  ) {
    this.value = initial;
    this.thumb = h('div', { class: 'seg-thumb', aria: { hidden: 'true' } });
    this.el = h('div', { class: 'segmented', role: 'radiogroup', aria: { label } }, this.thumb);
    for (const o of options) {
      const btn = h(
        'button',
        {
          class: 'seg-btn',
          role: 'radio',
          aria: { checked: String(o.value === initial) },
          data: { value: o.value, ...(o.tip ? { tip: o.tip } : {}) },
          onclick: () => {
            if (btn.disabled) return;
            onChange(o.value);
          },
        },
        o.icon ? icon(o.icon) : null,
        h('span', { text: o.label }),
      );
      this.buttons.set(o.value, btn);
      this.el.append(btn);
    }
    requestAnimationFrame(() => this.place());
  }

  set(value: T): void {
    this.value = value;
    for (const [v, b] of this.buttons) {
      b.classList.toggle('active', v === value);
      b.setAttribute('aria-checked', String(v === value));
    }
    this.place();
  }

  setDisabled(value: T, disabled: boolean, reason?: string): void {
    const b = this.buttons.get(value);
    if (!b) return;
    b.disabled = disabled;
    if (reason) b.dataset.tip = reason;
  }

  private place(): void {
    const b = this.buttons.get(this.value);
    if (!b) return;
    this.thumb.style.width = `${b.offsetWidth}px`;
    this.thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  }
}

export class Topbar {
  readonly el: HTMLElement;
  readonly mode: Segmented<AppMode>;
  readonly view: Segmented<'2d' | '3d'>;
  private readonly menu: HTMLElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private open = false;
  readonly worldName: HTMLElement;

  constructor(cb: TopbarCallbacks, menuItems: readonly MenuItem[]) {
    this.mode = new Segmented<AppMode>(
      'Mode',
      [
        { value: 'edit', label: 'Edit', icon: 'graph', tip: 'Edit the city  Tab' },
        { value: 'simulate', label: 'Simulate', icon: 'play', tip: 'Run traffic and AI  Tab' },
        { value: 'train', label: 'Train', icon: 'brain', tip: 'Evolve the network  T' },
      ],
      'edit',
      cb.onMode,
    );
    this.view = new Segmented<'2d' | '3d'>(
      'View',
      [
        { value: '2d', label: '2D', icon: 'square', tip: '2D view  V' },
        { value: '3d', label: '3D', icon: 'cube', tip: '3D view  V' },
      ],
      '2d',
      cb.onView,
    );
    this.menu = h('div', { class: 'menu glass', role: 'menu', aria: { label: 'World' } });
    for (const item of menuItems) {
      if (item.separatorBefore)
        this.menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      const btn = h(
        'button',
        {
          class: `menu-item${item.danger ? ' danger' : ''}`,
          role: 'menuitem',
          data: { id: item.id },
          onclick: () => {
            this.toggle(false);
            cb.onMenu(item.id);
          },
        },
        icon(item.icon),
        h('span', { class: 'menu-label', text: item.label }),
        item.shortcut ? h('kbd', { text: item.shortcut }) : null,
      );
      this.items.set(item.id, btn);
      this.menu.append(btn);
    }
    this.menuBtn = h(
      'button',
      {
        class: 'btn btn-ghost menu-btn',
        aria: { haspopup: 'menu', expanded: 'false', label: 'World menu' },
        onclick: (e) => {
          e.stopPropagation();
          this.toggle(!this.open);
        },
      },
      icon('city'),
      h('span', { text: 'World' }),
      icon('chevron'),
    );
    this.worldName = h('span', { class: 'world-name', text: 'Untitled world' });
    this.el = h(
      'header',
      { class: 'topbar glass' },
      h(
        'div',
        { class: 'brand' },
        h('span', { class: 'brand-mark', aria: { hidden: 'true' } }),
        h('span', { class: 'brand-name', text: 'NeuroDrive City' }),
        this.worldName,
      ),
      h('div', { class: 'topbar-center' }, this.mode.el, this.view.el),
      h(
        'div',
        { class: 'topbar-right' },
        h('div', { class: 'menu-wrap' }, this.menuBtn, this.menu),
        h(
          'button',
          {
            class: 'btn btn-ghost icon-btn',
            aria: { label: 'Keyboard shortcuts (?)' },
            data: { tip: 'Shortcuts  ?' },
            onclick: cb.onHelp,
          },
          icon('help'),
        ),
      ),
    );
    document.addEventListener('click', (e) => {
      if (this.open && !this.menu.contains(e.target as Node)) this.toggle(false);
    });
    // menu keyboard: arrows move between items, Home/End jump, Esc closes and returns focus
    this.menu.addEventListener('keydown', (e) => {
      const items = [...this.items.values()].filter((b) => !b.disabled);
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: HTMLButtonElement | undefined;
      if (e.key === 'Escape') {
        this.toggle(false);
        this.menuBtn.focus();
      } else if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
      else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
      else if (e.key === 'Home') next = items[0];
      else if (e.key === 'End') next = items[items.length - 1];
      else return;
      next?.focus();
      e.preventDefault();
      e.stopPropagation();
    });
  }

  setItemEnabled(id: string, enabled: boolean): void {
    const b = this.items.get(id);
    if (b) b.disabled = !enabled;
  }

  get menuOpen(): boolean {
    return this.open;
  }

  toggle(open: boolean): void {
    this.open = open;
    this.menu.classList.toggle('open', open);
    this.menuBtn.setAttribute('aria-expanded', String(open));
    if (open) this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
}
