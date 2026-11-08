import { describe, expect, it } from 'vitest';
import { generateDemoCity } from '../../../src/engine/world/demoCity.ts';
import { addDemoMarkings, placeApproach } from '../../../src/engine/world/demoMarkings.ts';
import { WorldModel } from '../../../src/engine/world/worldModel.ts';

describe('world/demoMarkings', () => {
  it('places lights, stops, a yield, a crossing, parking, start and target', () => {
    const m = generateDemoCity(12345);
    const n = addDemoMarkings(m);
    expect(n).toBeGreaterThanOrEqual(10);
    const types = new Set(m.markings.all().map((k) => k.type));
    for (const t of ['light', 'stop', 'yield', 'crossing', 'parking', 'start', 'target'])
      expect(types.has(t as never)).toBe(true);
    expect(m.markings.ofType('target')[0]?.props.active).toBe(true);
  });

  it('is a no-op on an empty world and skips short segments', () => {
    expect(addDemoMarkings(new WorldModel())).toBe(0);
    const m = new WorldModel();
    const a = m.graph.addPoint(0, 0);
    const b = m.graph.addPoint(50, 0);
    const s = m.graph.addSegment(a, b);
    if (!s) throw new Error('no seg');
    expect(placeApproach(m, 'stop', s, b, 80)).toBe(false);
  });
});
