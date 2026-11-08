import { describe, expect, it } from 'vitest';
import { Viewport } from '../../src/render2d/viewport.ts';

function vp(): Viewport {
  const v = new Viewport();
  v.resize(800, 600);
  v.set({ x: 100, y: 50 }, 2);
  return v;
}

describe('render2d/viewport', () => {
  it('converts world to screen and back (round trip)', () => {
    const v = vp();
    const s = v.worldToScreen(100, 50);
    expect(s).toEqual({ x: 400, y: 300 }); // centre maps to screen centre
    const s2 = v.worldToScreen(110, 40);
    expect(s2).toEqual({ x: 420, y: 280 });
    const w = v.screenToWorld(s2.x, s2.y);
    expect(w.x).toBeCloseTo(110);
    expect(w.y).toBeCloseTo(40);
    expect(v.screenToWorldLength(20)).toBe(10);
  });

  it('writes into a provided out vector', () => {
    const v = vp();
    const out = { x: 0, y: 0 };
    expect(v.worldToScreen(0, 0, out)).toBe(out);
    expect(v.screenToWorld(0, 0, out)).toBe(out);
  });

  it('pans by screen deltas', () => {
    const v = vp();
    v.panByScreen(40, -20);
    expect(v.center).toEqual({ x: 80, y: 60 });
  });

  it('eased zoom keeps the anchored world point under the cursor', () => {
    const v = vp();
    const anchor = v.screenToWorld(600, 100);
    v.zoomAt(600, 100, 2);
    expect(v.targetZoom).toBe(4);
    for (let i = 0; i < 5; i++) {
      v.update(1 / 60);
      const w = v.screenToWorld(600, 100);
      expect(w.x).toBeCloseTo(anchor.x, 6);
      expect(w.y).toBeCloseTo(anchor.y, 6);
    }
    expect(v.zoom).toBeGreaterThan(2);
    expect(v.zoom).toBeLessThan(4); // eased, not a jump
    for (let i = 0; i < 300; i++) v.update(1 / 60);
    expect(v.zoom).toBe(4);
  });

  it('zooms in both directions and clamps to the range', () => {
    const v = vp();
    v.zoomAt(400, 300, 1000);
    expect(v.targetZoom).toBe(8);
    v.zoomAt(400, 300, 1e-6);
    expect(v.targetZoom).toBe(0.1);
  });

  it('pinch zoom is immediate and anchored', () => {
    const v = vp();
    const before = v.screenToWorld(200, 200);
    v.zoomImmediate(200, 200, 1.5);
    expect(v.zoom).toBe(3);
    const after = v.screenToWorld(200, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('fits a bounding box and eases panTo', () => {
    const v = vp();
    v.fit({ minX: 0, minY: 0, maxX: 680, maxY: 480 }, 60);
    expect(v.zoom).toBeCloseTo(1);
    expect(v.center).toEqual({ x: 340, y: 240 });
    v.panTo({ x: 1000, y: 1000 });
    expect(v.update(1 / 60)).toBe(true);
    expect(v.center.x).toBeGreaterThan(340);
    expect(v.center.x).toBeLessThan(1000);
    for (let i = 0; i < 600; i++) v.update(1 / 60);
    expect(v.center).toEqual({ x: 1000, y: 1000 });
    expect(v.update(1 / 60)).toBe(false);
    v.fitPoints([]);
    v.fitPoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      10,
      true,
    );
  });

  it('reports visible bounds', () => {
    const v = vp();
    expect(v.visibleBounds()).toEqual({ minX: -100, minY: -100, maxX: 300, maxY: 200 });
    expect(v.visibleBounds(10).minX).toBe(-110);
  });
});
