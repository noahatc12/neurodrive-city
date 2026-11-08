import { describe, expect, it } from 'vitest';
import { Graph } from '../../../src/engine/graph/graph.ts';
import {
  MarkingStore,
  bindingAt,
  defaultSide,
  markingSize,
  resolveMarking,
} from '../../../src/engine/markings/marking.ts';

function setup() {
  const g = new Graph();
  const a = g.addPoint(0, 0);
  const b = g.addPoint(200, 0);
  const seg = g.addSegment(a, b);
  if (!seg) throw new Error('no segment');
  const store = new MarkingStore(g);
  return { g, a, b, seg, store };
}

describe('markings/marking', () => {
  it('sizes derive from road width', () => {
    expect(markingSize('stop', 100)).toEqual({ width: 50, height: 50 });
    expect(markingSize('crossing', 100)).toEqual({ width: 100, height: 50 });
    expect(defaultSide('crossing', 1)).toBe(0);
    expect(defaultSide('stop', 0)).toBe(1);
    expect(defaultSide('stop', -1)).toBe(-1);
  });

  it('resolves to the lane centre, facing the lane direction', () => {
    const { g, seg, store } = setup();
    const right = store.add('stop', { segmentId: seg.id, t: 0.5, side: 1 });
    const left = store.add('stop', { segmentId: seg.id, t: 0.5, side: -1 });
    const r = resolveMarking(right, g, 100);
    // a→b is east; right of east in y-down space is +y (south)
    expect(r?.center).toEqual({ x: 100, y: 25 });
    expect(r?.direction).toEqual({ x: 1, y: 0 });
    const l = resolveMarking(left, g, 100);
    expect(l?.center).toEqual({ x: 100, y: -25 });
    expect(l?.direction).toEqual({ x: -1, y: -0 });
  });

  it('bindingAt picks the nearest segment, parameter and side', () => {
    const { g, seg } = setup();
    expect(bindingAt(g, 'stop', { x: 50, y: 20 }, 100)).toEqual({
      segmentId: seg.id,
      t: 0.25,
      side: 1,
    });
    expect(bindingAt(g, 'stop', { x: 50, y: -20 }, 100)?.side).toBe(-1);
    expect(bindingAt(g, 'crossing', { x: 50, y: -20 }, 100)?.side).toBe(0);
    expect(bindingAt(g, 'stop', { x: 50, y: 500 }, 100)).toBeNull();
  });

  it('follows the segment when its points move', () => {
    const { g, b, seg, store } = setup();
    const m = store.add('yield', { segmentId: seg.id, t: 0.5, side: 1 });
    const v0 = store.version;
    g.movePoint(b, 0, 200); // segment now points south
    expect(store.version).toBeGreaterThan(v0);
    const r = resolveMarking(m, g, 100);
    expect(r?.center.x).toBeCloseTo(-25); // right of south is west
    expect(r?.center.y).toBeCloseTo(100);
  });

  it('is removed with its segment (never orphaned)', () => {
    const { g, a, seg, store } = setup();
    store.add('stop', { segmentId: seg.id, t: 0.5, side: 1 });
    store.add('light', { segmentId: seg.id, t: 0.1, side: -1 });
    g.removePoint(a);
    expect(store.size).toBe(0);
  });

  it('re-binds to the correct half on split', () => {
    const { g, seg, store } = setup();
    const m1 = store.add('stop', { segmentId: seg.id, t: 0.25, side: 1 });
    const m2 = store.add('stop', { segmentId: seg.id, t: 0.75, side: 1 });
    const res = g.splitSegment(seg, 0.5);
    expect(store.get(m1.id)?.binding).toEqual({ segmentId: res?.first.id, t: 0.5, side: 1 });
    expect(store.get(m2.id)?.binding).toEqual({ segmentId: res?.second.id, t: 0.5, side: 1 });
    // world positions did not change
    expect(resolveMarking(store.get(m1.id) ?? m1, g, 100)?.center.x).toBeCloseTo(50);
  });

  it('clears with the graph and supports restore, ofType, boundTo, listeners', () => {
    const { g, seg, store } = setup();
    let n = 0;
    const off = store.onChange(() => n++);
    const m = store.add('target', { segmentId: seg.id, t: 0.5, side: 1 }, { active: true });
    expect(store.ofType('target')).toHaveLength(1);
    expect(store.boundTo(seg.id)).toHaveLength(1);
    const copy = MarkingStore.clone(m);
    store.remove(m.id);
    expect(store.remove(m.id)).toBeUndefined();
    store.restore(copy);
    expect(store.get(m.id)?.props).toEqual({ active: true });
    g.dispose();
    expect(store.size).toBe(0);
    store.clear(); // no-op on empty
    off();
    expect(n).toBe(4);
  });

  it('resolve returns null for a missing segment', () => {
    const { g, store } = setup();
    const m = store.add('stop', { segmentId: 999, t: 0.5, side: 1 });
    expect(resolveMarking(m, g, 100)).toBeNull();
  });
});
