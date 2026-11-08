/**
 * World generation benchmark (moved from world.test.ts unchanged). Like every wall-clock
 * budget it runs in its own Vitest project group after the other files (vitest.config.ts).
 */
import { describe, expect, it } from 'vitest';
import { generateDemoCity } from '../../../src/engine/world/demoCity.ts';
import { generateWorld, worldInputFrom } from '../../../src/engine/world/world.ts';

describe('world/generateWorld', () => {
  it('regenerates a 200-segment world quickly (logged; budget 150 ms in the browser)', () => {
    const m = generateDemoCity(3, { cols: 11, rows: 10, removeFraction: 0 });
    expect(m.graph.segmentCount).toBeGreaterThanOrEqual(189);
    // add a few to reach 200
    const pts = m.graph.points;
    for (let i = 0; m.graph.segmentCount < 200 && i < pts.length - 12; i++) {
      const p = pts[i];
      const q = pts[i + 12];
      if (p && q) m.graph.addSegment(p, q);
    }
    const input = worldInputFrom(m);
    generateWorld(input); // warm up the JIT
    const t0 = performance.now();
    const d = generateWorld(input, { now: () => performance.now() });
    const ms = performance.now() - t0;
    console.info(`200-segment world generated in ${ms.toFixed(1)} ms`, d.timings);
    expect(ms).toBeLessThan(process.env['CI'] ? 1500 : 600);
  });
});
