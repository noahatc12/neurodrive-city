import { describe, expect, it } from 'vitest';
import { migrateWorld } from '../../../src/engine/io/migrate.ts';
import { parseWorld, parseWorldText, serializeWorld } from '../../../src/engine/io/serialize.ts';
import { validateWorld, WORLD_FORMAT } from '../../../src/engine/io/worldSchema.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';

function sample(): WorldModel {
  const m = new WorldModel({
    seed: 77,
    settings: { roadWidth: 120 },
    meta: { name: 'Test Town', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  const a = m.graph.addPoint(0, 0);
  const b = m.graph.addPoint(300, 0);
  const c = m.graph.addPoint(300, 300);
  const s1 = m.graph.addSegment(a, b, { oneWay: true });
  const s2 = m.graph.addSegment(b, c, { bridge: true });
  if (!s1 || !s2) throw new Error('setup');
  m.markings.add('stop', { segmentId: s1.id, t: 0.9, side: 1 });
  m.markings.add('crossing', { segmentId: s2.id, t: 0.5, side: 0 }, { note: 'school' });
  return m;
}

describe('io/serialize', () => {
  it('round trips graph, flags, markings, settings, seed and view', () => {
    const m = sample();
    const file = serializeWorld(m, { zoom: 1.5, offset: [10, 20] });
    expect(file.format).toBe(WORLD_FORMAT);
    expect(file.graph.points).toHaveLength(3);
    expect(file.markings).toHaveLength(2);
    const res = parseWorld(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { model, view, warnings } = res.value;
    expect(warnings).toEqual([]);
    expect(model.graph.equals(m.graph)).toBe(true);
    expect(model.seed).toBe(77);
    expect(model.settings.roadWidth).toBe(120);
    expect(model.meta.name).toBe('Test Town');
    expect(view).toEqual({ zoom: 1.5, offset: [10, 20] });
    const types = model.markings
      .all()
      .map((k) => k.type)
      .sort();
    expect(types).toEqual(['crossing', 'stop']);
    expect(model.markings.ofType('crossing')[0]?.props).toEqual({ note: 'school' });
    expect(model.graph.segments.find((s) => s.bridge)).toBeDefined();
  });

  it('stores only source data, so files stay small', () => {
    const m = new WorldModel();
    let prev = m.graph.addPoint(0, 0);
    for (let i = 1; i < 472; i++) {
      const p = m.graph.addPoint((i % 30) * 200, Math.floor(i / 30) * 200);
      m.graph.addSegment(prev, p);
      prev = p;
    }
    const bytes = JSON.stringify(serializeWorld(m)).length;
    expect(bytes).toBeLessThan(60_000); // vs 6.37 MB in the course build
  });

  it('rejects invalid files with precise, helpful messages', () => {
    const bad = parseWorld({
      format: 'nope',
      version: 1,
      meta: {},
      graph: {
        points: [
          [0, 0],
          ['x', 1],
        ],
        segments: [{ a: 0, b: 5, oneWay: 'no' }],
      },
      markings: [{ type: 'banana' }],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const text = bad.errors.join('\n');
    expect(text).toContain('format');
    expect(text).toContain('graph.points[1]');
    expect(text).toContain('graph.segments[0].b: point index 5 out of range');
    expect(text).toContain('oneWay');
    expect(text).toContain('markings[0].type');
    expect(parseWorld(42).ok).toBe(false);
    expect(parseWorldText('{not json').ok).toBe(false);
  });

  it('validates view and marking segment indexes', () => {
    const file = serializeWorld(sample());
    const broken = {
      ...file,
      view: { zoom: 'big' },
      markings: [{ ...file.markings[0], props: { segment: 99 } }],
    };
    const res = validateWorld(broken);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.join(' ')).toContain('view');
      expect(res.errors.join(' ')).toContain('segment index 99');
    }
  });

  it('skips duplicate segments with a warning and snaps unbound markings onto roads', () => {
    const file = serializeWorld(sample());
    file.graph.segments.push({ a: 1, b: 0, oneWay: false });
    file.markings.push({
      type: 'yield',
      center: [150, 20],
      direction: [1, 0],
      width: 60,
      height: 60,
      props: {},
    });
    file.markings.push({
      type: 'yield',
      center: [5000, 5000],
      direction: [1, 0],
      width: 60,
      height: 60,
      props: {},
    });
    const res = parseWorld(file);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings).toHaveLength(2);
    expect(res.value.model.markings.ofType('yield')).toHaveLength(1);
  });

  it('migrates version 0 files', () => {
    const v0 = {
      graph: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        segments: [{ p1: 0, p2: 1 }],
      },
      seed: 9,
    };
    const migrated = migrateWorld(v0);
    const res = parseWorld(migrated);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.model.graph.segmentCount).toBe(1);
      expect(res.value.model.seed).toBe(9);
    }
    expect(migrateWorld('x')).toBe('x');
    const foreign = { format: 'other', points: [] };
    expect(migrateWorld(foreign)).toBe(foreign);
  });
});
