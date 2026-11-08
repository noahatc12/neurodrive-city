/**
 * Left toolbar (Edit mode): tool buttons with icons, tooltips that show the shortcut,
 * and an active-tool highlight that morphs (slides and resizes) between buttons.
 * @module ui/toolbar
 */
import type { ToolId } from '../app/renderer.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: IconName;
}

export const TOOL_DEFS: readonly ToolDef[] = [
  { id: 'graph', label: 'Roads', key: '1', icon: 'graph' },
  { id: 'stop', label: 'Stop', key: '2', icon: 'stop' },
  { id: 'yield', label: 'Yield', key: '3', icon: 'yield' },
  { id: 'crossing', label: 'Crossing', key: '4', icon: 'crossing' },
  { id: 'parking', label: 'Parking', key: '5', icon: 'parking' },
  { id: 'light', label: 'Traffic light', key: '6', icon: 'light' },
  { id: 'start', label: 'Start', key: '7', icon: 'start' },
  { id: 'target', label: 'Target', key: '8', icon: 'target' },
  { id: 'erase', label: 'Erase', key: 'E', icon: 'erase' },
];

export class Toolbar {
  readonly el: HTMLElement;
  private readonly indicator: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private active: ToolId = 'graph';

  constructor(onSelect: (id: ToolId) => void) {
    this.indicator = h('div', { class: 'tool-indicator', aria: { hidden: 'true' } });
    this.el = h(
      'nav',
      { class: 'toolbar glass', aria: { label: 'Editing tools' }, role: 'toolbar' },
      this.indicator,
    );
    TOOL_DEFS.forEach((def, i) => {
      if (i === 1 || i === TOOL_DEFS.length - 1)
        this.el.append(h('div', { class: 'tool-sep', aria: { hidden: 'true' } }));
      const btn = h(
        'button',
        {
          class: 'tool-btn',
          aria: { label: `${def.label} (${def.key})`, pressed: 'false' },
          data: { tool: def.id, tip: `${def.label}  ${def.key}` },
          onclick: () => onSelect(def.id),
        },
        icon(def.icon),
      );
      this.buttons.set(def.id, btn);
      this.el.append(btn);
    });
    requestAnimationFrame(() => this.moveIndicator());
  }

  setActive(id: ToolId): void {
    this.active = id;
    for (const [tid, btn] of this.buttons) {
      btn.classList.toggle('active', tid === id);
      btn.setAttribute('aria-pressed', String(tid === id));
    }
    this.moveIndicator();
  }

  private moveIndicator(): void {
    const btn = this.buttons.get(this.active);
    if (!btn) return;
    this.indicator.style.transform = `translateY(${btn.offsetTop}px)`;
    this.indicator.style.height = `${btn.offsetHeight}px`;
  }
}
