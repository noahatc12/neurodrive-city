/**
 * Bottom status bar for Edit mode: undo/redo, grid snap state, zoom, cursor position
 * and graph counts. Numbers update only when they change (no layout churn per frame).
 * @module ui/statusbar
 */
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface StatusCallbacks {
  onUndo: () => void;
  onRedo: () => void;
  onGrid: () => void;
}

export class Statusbar {
  readonly el: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly gridBtn: HTMLButtonElement;
  private readonly zoomEl: HTMLElement;
  private readonly posEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private last = { zoom: '', pos: '', count: '' };

  constructor(cb: StatusCallbacks) {
    this.undoBtn = h(
      'button',
      {
        class: 'btn btn-ghost icon-btn',
        aria: { label: 'Undo (Ctrl+Z)' },
        data: { tip: 'Undo  Ctrl+Z' },
        onclick: cb.onUndo,
      },
      icon('undo'),
    );
    this.redoBtn = h(
      'button',
      {
        class: 'btn btn-ghost icon-btn',
        aria: { label: 'Redo (Ctrl+Shift+Z)' },
        data: { tip: 'Redo  Ctrl+Shift+Z' },
        onclick: cb.onRedo,
      },
      icon('redo'),
    );
    this.gridBtn = h(
      'button',
      {
        class: 'btn btn-ghost chip',
        aria: { label: 'Grid snapping (G)', pressed: 'false' },
        data: { tip: 'Grid snapping  G' },
        onclick: cb.onGrid,
      },
      icon('grid'),
      h('span', { text: 'Snap' }),
    );
    this.zoomEl = h('span', { class: 'stat tabular', aria: { label: 'Zoom' } });
    this.posEl = h('span', { class: 'stat tabular', aria: { label: 'Cursor position' } });
    this.countEl = h('span', { class: 'stat tabular', aria: { label: 'Graph size' } });
    this.el = h(
      'div',
      { class: 'statusbar glass' },
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'divider' }),
      this.gridBtn,
      h('span', { class: 'divider' }),
      this.zoomEl,
      this.posEl,
      this.countEl,
    );
  }

  update(s: {
    canUndo: boolean;
    canRedo: boolean;
    grid: boolean;
    zoom: number;
    x: number | null;
    y: number | null;
    points: number;
    segments: number;
    markings: number;
  }): void {
    this.undoBtn.disabled = !s.canUndo;
    this.redoBtn.disabled = !s.canRedo;
    this.gridBtn.classList.toggle('active', s.grid);
    this.gridBtn.setAttribute('aria-pressed', String(s.grid));
    const zoom = `${Math.round(s.zoom * 100)}%`;
    const pos =
      s.x === null || s.y === null ? '' : `${(s.x / 10).toFixed(1)}, ${(s.y / 10).toFixed(1)} m`;
    const count = `${s.points} pts · ${s.segments} roads · ${s.markings} marks`;
    if (zoom !== this.last.zoom) this.zoomEl.textContent = zoom;
    if (pos !== this.last.pos) this.posEl.textContent = pos;
    if (count !== this.last.count) this.countEl.textContent = count;
    this.last = { zoom, pos, count };
  }
}
