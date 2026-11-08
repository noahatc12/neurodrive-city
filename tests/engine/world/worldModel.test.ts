import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  settingsEqual,
} from '../../../src/engine/world/settings.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';

describe('world/settings', () => {
  it('defaults match the course constants', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      roadWidth: 100,
      roadRoundness: 10,
      buildingWidth: 150,
      buildingMinLength: 150,
      spacing: 50,
      treeSize: 160,
    });
  });

  it('normalizes, clamps and ignores junk', () => {
    const s = normalizeSettings({
      roadWidth: 9999,
      roadRoundness: 3.6,
      spacing: 'wide',
      treeSize: Number.NaN,
    });
    expect(s.roadWidth).toBe(200);
    expect(s.roadRoundness).toBe(4);
    expect(s.spacing).toBe(50);
    expect(s.treeSize).toBe(160);
    expect(settingsEqual(s, { ...s })).toBe(true);
    expect(settingsEqual(s, DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('world/worldModel', () => {
  it('bumps the geometry version on graph, settings and seed changes only', () => {
    const m = new WorldModel({ seed: 1 });
    let v = m.geometryVersion;
    m.graph.addPoint(0, 0);
    expect(m.geometryVersion).toBeGreaterThan(v);
    v = m.geometryVersion;
    m.setSettings({ roadWidth: 100 }); // unchanged
    m.setSeed(1); // unchanged
    expect(m.geometryVersion).toBe(v);
    m.setSettings({ roadWidth: 80 });
    expect(m.geometryVersion).toBeGreaterThan(v);
    v = m.geometryVersion;
    m.setSeed(2);
    expect(m.geometryVersion).toBeGreaterThan(v);
    expect(m.seed).toBe(2);
    expect(m.settings.roadWidth).toBe(80);
    expect(m.meta.source).toBe('editor');
  });
});
