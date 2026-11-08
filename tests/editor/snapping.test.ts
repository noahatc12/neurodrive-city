import { describe, expect, it } from 'vitest';
import { snap } from '../../src/editor/snapping.ts';
import { matchBinding } from '../../src/app/keymap.ts';
import { Graph } from '../../src/engine/graph/graph.ts';

describe('editor/snapping', () => {
  const g = new Graph();
  const p = g.addPoint(100, 100);
  const q = g.addPoint(104, 100);

  it('snaps to the nearest point within the radius first', () => {
    expect(
      snap({ x: 103, y: 101 }, g, { gridEnabled: true, gridSize: 50, pointRadius: 10 }),
    ).toMatchObject({ kind: 'point', point: q });
  });

  it('skips excluded points (the ones being dragged)', () => {
    const r = snap({ x: 104, y: 101 }, g, {
      gridEnabled: false,
      gridSize: 50,
      pointRadius: 10,
      exclude: new Set([q.id]),
    });
    expect(r.point).toBe(p);
  });

  it('falls back to the grid, then to the raw position', () => {
    expect(
      snap({ x: 260, y: 330 }, g, { gridEnabled: true, gridSize: 50, pointRadius: 10 }),
    ).toMatchObject({ x: 250, y: 350, kind: 'grid' });
    expect(
      snap({ x: 260, y: 330 }, g, { gridEnabled: false, gridSize: 50, pointRadius: 10 }),
    ).toMatchObject({ x: 260, y: 330, kind: 'none' });
  });
});

describe('app/keymap', () => {
  const ev = (key: string, mods: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: false,
  });

  it('maps every documented shortcut', () => {
    expect(matchBinding(ev('1'))).toBe('tool.graph');
    expect(matchBinding(ev('8'))).toBe('tool.target');
    expect(matchBinding(ev('E'))).toBe('tool.erase');
    expect(matchBinding(ev('Delete'))).toBe('edit.delete');
    expect(matchBinding(ev('Tab'))).toBe('mode.toggle');
    expect(matchBinding(ev('?', { shift: true }))).toBe('help.toggle');
    expect(matchBinding(ev('+', { shift: true }))).toBe('sim.faster');
    expect(matchBinding(ev('s'))).toBe('brain.save');
    expect(matchBinding(ev('o'))).toBe('edit.oneWay');
  });

  it('distinguishes ctrl and shift combinations', () => {
    expect(matchBinding(ev('z', { ctrl: true }))).toBe('edit.undo');
    expect(matchBinding(ev('Z', { ctrl: true, shift: true }))).toBe('edit.redo');
    expect(matchBinding(ev('z', { meta: true }))).toBe('edit.undo');
    expect(matchBinding(ev('s', { ctrl: true }))).toBe('file.save');
    expect(matchBinding(ev('o', { ctrl: true }))).toBe('file.open');
    expect(matchBinding(ev('q'))).toBeNull();
    expect(matchBinding(ev('q', { ctrl: true }))).toBeNull();
  });
});
