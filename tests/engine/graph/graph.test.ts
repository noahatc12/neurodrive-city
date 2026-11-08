import { describe, expect, it } from 'vitest';
import { Graph, type GraphEvent } from '../../../src/engine/graph/graph.ts';
import { Point } from '../../../src/engine/graph/point.ts';

function square(): { g: Graph; p: Point[] } {
  const g = new Graph();
  const p = [g.addPoint(0, 0), g.addPoint(100, 0), g.addPoint(100, 100), g.addPoint(0, 100)];
  for (let i = 0; i < 4; i++) g.addSegment(p[i] as Point, p[(i + 1) % 4] as Point);
  return { g, p };
}

describe('graph/graph: points and segments', () => {
  it('assigns stable, increasing ids and looks them up', () => {
    const { g, p } = square();
    expect(p.map((x) => x.id)).toEqual([0, 1, 2, 3]);
    expect(g.getPoint(2)).toBe(p[2]);
    expect(g.segments.map((s) => s.id)).toEqual([0, 1, 2, 3]);
    expect(g.getSegment(1)?.a).toBe(p[1]);
    expect(g.pointCount).toBe(4);
    expect(g.segmentCount).toBe(4);
  });

  it('rejects duplicates, reversed duplicates, self-loops and zero-length segments', () => {
    const { g, p } = square();
    const [a, b] = p as [Point, Point];
    expect(g.addSegment(a, b)).toBeNull();
    expect(g.addSegment(b, a)).toBeNull();
    expect(g.addSegment(a, a)).toBeNull();
    const twin = g.addPoint(0, 0);
    expect(g.addSegment(a, twin)).toBeNull();
    const foreign = new Point(999, 5, 5);
    expect(g.addSegment(a, foreign)).toBeNull();
    expect(g.segmentCount).toBe(4);
  });

  it('removing a point cascades to its segments', () => {
    const { g, p } = square();
    const removed = g.removePoint(p[0] as Point);
    expect(removed?.segments).toHaveLength(2);
    expect(g.pointCount).toBe(3);
    expect(g.segmentCount).toBe(2);
    expect(g.removePoint(p[0] as Point)).toBeNull();
  });

  it('removes single segments', () => {
    const { g } = square();
    const s = g.segments[0];
    expect(s && g.removeSegment(s)).toBe(true);
    expect(s && g.removeSegment(s)).toBe(false);
    expect(g.segmentCount).toBe(3);
  });

  it('moving a point moves its segments and updates picking', () => {
    const { g, p } = square();
    const a = p[0] as Point;
    g.movePoint(a, -50, -50);
    const seg = g.findSegment(a, p[1] as Point);
    expect(seg?.a.x).toBe(-50);
    expect(g.nearestPoint(-49, -49, 5)).toBe(a);
    expect(g.nearestPoint(0, 0, 5)).toBeNull();
    // the moved segment is found near its new location
    const hit = g.nearestSegment(25, -25, 5);
    expect(hit?.segment).toBe(seg);
  });

  it('segmentsWithPoint, degree and findSegment', () => {
    const { g, p } = square();
    expect(g.segmentsWithPoint(p[0] as Point)).toHaveLength(2);
    expect(g.degree(p[0] as Point)).toBe(2);
    const lone = g.addPoint(500, 500);
    expect(g.segmentsWithPoint(lone)).toEqual([]);
    expect(g.degree(new Point(12345, 0, 0))).toBe(0);
    expect(g.segmentsWithPoint(new Point(12345, 0, 0))).toEqual([]);
    expect(g.findSegment(p[0] as Point, p[2] as Point)).toBeUndefined();
  });
});

describe('graph/graph: queries', () => {
  it('nearestPoint respects the threshold and exclusion', () => {
    const { g, p } = square();
    expect(g.nearestPoint(3, 4, 10)).toBe(p[0]);
    expect(g.nearestPoint(3, 4, 4)).toBeNull();
    expect(g.nearestPoint(3, 4, 10, p[0])).toBeNull();
    expect(g.containsPointAt(100, 100)).toBe(true);
    expect(g.containsPointAt(100, 101)).toBe(false);
  });

  it('nearestSegment returns the projection, parameter and distance', () => {
    const { g } = square();
    const hit = g.nearestSegment(30, 4, 10);
    expect(hit?.segment.id).toBe(0);
    expect(hit?.t).toBeCloseTo(0.3);
    expect(hit?.point).toEqual({ x: 30, y: 0 });
    expect(hit?.distance).toBeCloseTo(4);
    expect(g.nearestSegment(50, 50, 10)).toBeNull();
  });

  it('pointsInRect selects points inside a box', () => {
    const { g } = square();
    expect(g.pointsInRect(-1, -1, 101, 50).map((p) => p.id).sort()).toEqual([0, 1]);
  });
});

describe('graph/graph: versioning, events and hashing', () => {
  it('bumps the version on every mutation and not on no-ops', () => {
    const g = new Graph();
    let v = g.version;
    const a = g.addPoint(0, 0);
    expect(g.version).toBeGreaterThan(v);
    v = g.version;
    const b = g.addPoint(10, 0);
    const s = g.addSegment(a, b);
    expect(g.version).toBeGreaterThan(v);
    v = g.version;
    g.addSegment(a, b); // rejected duplicate
    g.movePoint(a, 0, 0); // same position
    expect(g.version).toBe(v);
    if (s) g.setSegmentFlags(s, { oneWay: true });
    expect(g.version).toBeGreaterThan(v);
    expect(s?.oneWay).toBe(true);
  });

  it('emits events for each mutation and supports unsubscribe', () => {
    const g = new Graph();
    const events: GraphEvent['type'][] = [];
    const off = g.onChange((e) => events.push(e.type));
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const s = g.addSegment(a, b);
    g.movePoint(b, 20, 0);
    if (s) g.setSegmentFlags(s, { bridge: true, tunnel: true });
    g.removePoint(a);
    g.dispose();
    off();
    g.addPoint(1, 1);
    expect(events).toEqual([
      'point-added',
      'point-added',
      'segment-added',
      'point-moved',
      'segment-changed',
      'segment-removed',
      'point-removed',
      'cleared',
    ]);
  });

  it('hash changes on edits and ignores ids (structural equality)', () => {
    const { g, p } = square();
    const h0 = g.hash();
    g.movePoint(p[0] as Point, 1, 0);
    expect(g.hash()).not.toBe(h0);
    g.movePoint(p[0] as Point, 0, 0);
    expect(g.hash()).toBe(h0);

    // Same geometry, different insertion order and ids, reversed undirected segments
    const other = new Graph();
    const q = [other.addPoint(0, 100), other.addPoint(100, 100), other.addPoint(100, 0), other.addPoint(0, 0)];
    for (let i = 0; i < 4; i++) other.addSegment(q[(i + 1) % 4] as Point, q[i] as Point);
    expect(other.equals(g)).toBe(true);
    const s = other.segments[0];
    if (s) other.setSegmentFlags(s, { oneWay: true });
    expect(other.equals(g)).toBe(false);
  });

  it('restores points and segments with their original ids (undo support)', () => {
    const { g, p } = square();
    const removed = g.removePoint(p[1] as Point);
    expect(removed).not.toBeNull();
    if (!removed) return;
    g.restorePoint(removed.point.id, removed.point.x, removed.point.y);
    for (const s of removed.segments) g.restoreSegment(s.id, s.a.id, s.b.id, s.flags());
    expect(g.segmentCount).toBe(4);
    expect(g.getPoint(1)?.x).toBe(100);
    expect(() => g.restorePoint(1, 0, 0)).toThrow();
    expect(() => g.restoreSegment(0, 0, 1)).toThrow();
    expect(() => g.restoreSegment(77, 0, 0)).toThrow();
    // new ids continue after the restored ones
    expect(g.addPoint(9, 9).id).toBe(4);
  });

  it('splits a segment keeping flags and orientation', () => {
    const { g, p } = square();
    const s = g.findSegment(p[0] as Point, p[1] as Point);
    expect(s).toBeDefined();
    if (!s) return;
    g.setSegmentFlags(s, { oneWay: true });
    const events: string[] = [];
    g.onChange((e) => events.push(e.type));
    const res = g.splitSegment(s, 0.25);
    expect(res).not.toBeNull();
    expect(res?.point.x).toBeCloseTo(25);
    expect(res?.first.a).toBe(p[0]);
    expect(res?.second.b).toBe(p[1]);
    expect(res?.first.oneWay && res.second.oneWay).toBe(true);
    expect(g.getSegment(s.id)).toBeUndefined();
    expect(g.segmentCount).toBe(5);
    expect(events).toEqual(['segment-split']);
    expect(g.splitSegment(s, 0.5)).toBeNull(); // already gone
    const first = res?.first;
    if (first) expect(g.splitSegment(first, 0)).toBeNull(); // degenerate
  });

  it('split can reuse explicit ids (redo support)', () => {
    const { g, p } = square();
    const s = g.findSegment(p[0] as Point, p[1] as Point);
    if (!s) throw new Error('missing');
    const res = g.splitSegment(s, 0.5, { point: 40, first: 41, second: 42 });
    expect(res?.point.id).toBe(40);
    expect(res?.first.id).toBe(41);
    expect(g.addPoint(1, 2).id).toBe(41);
  });

  it('dispose clears everything but keeps ids increasing', () => {
    const { g } = square();
    g.dispose();
    expect(g.pointCount).toBe(0);
    expect(g.segmentCount).toBe(0);
    expect(g.nearestPoint(0, 0, 10)).toBeNull();
    expect(g.addPoint(0, 0).id).toBe(4);
  });

  it('ignores operations on points or segments from another graph', () => {
    const { g } = square();
    const other = square();
    const foreign = other.p[0] as Point;
    g.movePoint(foreign, 5, 5);
    expect(foreign.x).toBe(0);
    const foreignSeg = other.g.segments[0];
    if (foreignSeg) {
      expect(g.removeSegment(foreignSeg)).toBe(false);
      const v = g.version;
      g.setSegmentFlags(foreignSeg, { oneWay: true });
      expect(g.version).toBe(v);
    }
  });
});

describe('graph/segment and point helpers', () => {
  it('segment geometry helpers', () => {
    const { g, p } = square();
    const s = g.findSegment(p[0] as Point, p[1] as Point);
    if (!s) throw new Error('missing');
    expect(s.length()).toBe(100);
    expect(s.direction()).toEqual({ x: 1, y: 0 });
    expect(s.includes(p[0] as Point)).toBe(true);
    expect(s.includes(p[2] as Point)).toBe(false);
    expect(s.other(p[0] as Point)).toBe(p[1]);
    expect(s.other(p[1] as Point)).toBe(p[0]);
    expect(s.pointAt(0.5)).toEqual({ x: 50, y: 0 });
    expect(s.project({ x: 20, y: 30 })).toBeCloseTo(0.2);
    expect(s.distanceTo({ x: 20, y: 30 })).toBeCloseTo(30);
    expect(s.flags()).toEqual({ oneWay: false, bridge: false, tunnel: false });
  });

  it('degenerate direction is zero and points compare locations', () => {
    const a = new Point(0, 1, 1);
    const b = new Point(1, 1, 1);
    expect(a.sameLocation(b)).toBe(true);
    expect(a.sameLocation({ x: 2, y: 1 })).toBe(false);
  });
});
