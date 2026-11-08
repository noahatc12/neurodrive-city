import { describe, expect, it } from 'vitest';
import {
  Polygon,
  breakAtIntersections,
  classifySegment,
  polygonContainsPoint,
  polygonDistance,
  polygonPointDistance,
  polygonSignedArea,
  polygonsIntersect,
  splitParams,
  unionPolygons,
  type Seg,
} from '../../../src/engine/math/polygon.ts';
import { vec2, type Vec2 } from '../../../src/engine/math/vec2.ts';

const v = vec2;
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon =>
  new Polygon([v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)]);

function segLen(s: Seg): number {
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
}
function totalLength(segs: readonly Seg[]): number {
  return segs.reduce((acc, s) => acc + segLen(s), 0);
}
function mid(s: Seg): Vec2 {
  return v((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2);
}

describe('math/polygon: basics', () => {
  it('copies its points and caches bbox, segments and area', () => {
    const pts = [v(0, 0), v(4, 0), v(4, 2), v(0, 2)];
    const poly = new Polygon(pts);
    pts[0] = v(100, 100);
    expect(poly.points[0]).toEqual({ x: 0, y: 0 });
    expect(poly.segments).toHaveLength(4);
    expect(poly.bbox).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 2 });
    expect(poly.area).toBe(8);
    expect(polygonSignedArea([v(0, 0), v(0, 2), v(4, 2), v(4, 0)])).toBe(-8);
  });
});

describe('math/polygon: point containment', () => {
  const square = rect(0, 0, 10, 10);
  // concave "U" shape
  const u = new Polygon([v(0, 0), v(10, 0), v(10, 10), v(7, 10), v(7, 3), v(3, 3), v(3, 10), v(0, 10)]);

  it('detects inside and outside points', () => {
    expect(polygonContainsPoint(square, v(5, 5))).toBe(true);
    expect(polygonContainsPoint(square, v(15, 5))).toBe(false);
    expect(polygonContainsPoint(square, v(-1, 5))).toBe(false);
  });

  it('handles concave polygons', () => {
    expect(polygonContainsPoint(u, v(1.5, 8))).toBe(true);
    expect(polygonContainsPoint(u, v(5, 8))).toBe(false); // in the notch
    expect(polygonContainsPoint(u, v(5, 1))).toBe(true);
  });

  it('counts a ray through a vertex correctly', () => {
    // Diamond: the horizontal ray from (0,0) passes exactly through vertex (10, 0).
    const diamond = new Polygon([v(0, -10), v(10, 0), v(0, 10), v(-10, 0)]);
    expect(polygonContainsPoint(diamond, v(0, 0))).toBe(true);
    expect(polygonContainsPoint(diamond, v(-12, 0))).toBe(false);
    // Ray grazes the tip of a spike (touching vertex, boundary does not cross).
    const spike = new Polygon([v(0, 0), v(20, 0), v(20, 10), v(15, 5), v(10, 10), v(0, 10)]);
    expect(polygonContainsPoint(spike, v(5, 5))).toBe(true);
    expect(polygonContainsPoint(spike, v(15, 7))).toBe(false);
  });
});

describe('math/polygon: intersection and distance', () => {
  it('detects edge crossings, containment and disjoint polygons', () => {
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true);
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(2, 2, 4, 4))).toBe(true); // contained
    expect(polygonsIntersect(rect(2, 2, 4, 4), rect(0, 0, 10, 10))).toBe(true); // container
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(20, 0, 30, 10))).toBe(false);
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(11, -5, 12, 30))).toBe(false); // bbox overlaps? no
  });

  it('distance uses true segment-to-segment distance, not vertex sampling', () => {
    // A thin wedge whose tip almost touches the middle of a long wall: every vertex is far
    // from every other vertex, but the tip is only 2 units from the wall's edge.
    const wall = rect(0, 0, 200, 10);
    const wedge = new Polygon([v(100, 12), v(60, 80), v(140, 80)]);
    expect(polygonDistance(wall, wedge)).toBeCloseTo(2);
    expect(polygonDistance(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(0);
  });

  it('point distance is 0 inside and edge distance outside', () => {
    expect(polygonPointDistance(rect(0, 0, 10, 10), v(5, 5))).toBe(0);
    expect(polygonPointDistance(rect(0, 0, 10, 10), v(13, 14))).toBeCloseTo(5);
  });
});

describe('math/polygon: segment classification', () => {
  const square = rect(0, 0, 10, 10);
  it('classifies inside, outside and crossing segments', () => {
    expect(classifySegment(v(2, 2), v(8, 8), square)).toBe('inside');
    expect(classifySegment(v(12, 2), v(18, 8), square)).toBe('outside');
    expect(classifySegment(v(5, 5), v(15, 5), square)).toBe('crossing');
  });

  it('is not fooled by a segment whose midpoint is inside but ends outside', () => {
    // midpoint (5, 5) inside, both endpoints outside the concave U's arms
    const u = new Polygon([v(0, 0), v(10, 0), v(10, 10), v(7, 10), v(7, 3), v(3, 3), v(3, 10), v(0, 10)]);
    expect(classifySegment(v(-5, 2), v(15, 2), u)).toBe('crossing');
    expect(classifySegment(v(1, 8), v(9, 8), u)).toBe('crossing'); // crosses the notch
  });
});

describe('math/polygon: splitting', () => {
  it('splitParams cuts at crossings and collinear overlap ends, ignoring endpoint touches', () => {
    const edges: Seg[] = [
      { a: v(3, -1), b: v(3, 1) },
      { a: v(7, -1), b: v(7, 1) },
      { a: v(10, -1), b: v(10, 1) }, // touches at t = 1: ignored
      { a: v(4, 0), b: v(5, 0) }, // collinear overlap: cuts at 4 and 5
    ];
    expect(splitParams(v(0, 0), v(10, 0), edges).map((t) => +t.toFixed(6))).toEqual([
      0.3, 0.4, 0.5, 0.7,
    ]);
    expect(splitParams(v(0, 0), v(0, 0), edges)).toEqual([]);
  });

  it('breakAtIntersections never mutates inputs and never makes zero-length pieces', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 15, 15);
    // a third polygon whose vertex sits exactly on a's edge (would make a zero-length cut)
    const c = new Polygon([v(10, 2), v(14, 0), v(14, 4)]);
    const before = JSON.stringify([a.points, b.points, c.points]);
    const pieces = breakAtIntersections([a, b, c]);
    expect(JSON.stringify([a.points, b.points, c.points])).toBe(before);
    expect(pieces).toHaveLength(3);
    for (const list of pieces) for (const s of list) expect(segLen(s)).toBeGreaterThan(1e-6);
    // each polygon's perimeter is preserved by splitting
    expect(totalLength(pieces[0] ?? [])).toBeCloseTo(40);
    expect(pieces[0]?.length).toBeGreaterThan(4);
  });
});

describe('math/polygon: union', () => {
  it('two overlapping squares give an outline with no interior segments', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 15, 15);
    const border = unionPolygons([a, b]);
    expect(totalLength(border)).toBeCloseTo(60); // 40 + 40 - 2 * 10 hidden
    for (const s of border) {
      const m = mid(s);
      const strictlyInsideA = m.x > 0 + 1e-6 && m.x < 10 - 1e-6 && m.y > 1e-6 && m.y < 10 - 1e-6;
      const strictlyInsideB = m.x > 5 + 1e-6 && m.x < 15 - 1e-6 && m.y > 5 + 1e-6 && m.y < 15 - 1e-6;
      expect(strictlyInsideA || strictlyInsideB).toBe(false);
    }
  });

  it('removes edges shared by touching polygons (opposite facing)', () => {
    const border = unionPolygons([rect(0, 0, 10, 10), rect(10, 0, 20, 10)]);
    expect(totalLength(border)).toBeCloseTo(60);
    for (const s of border) expect(Math.abs(mid(s).x - 10) < 1e-6 && s.a.x === s.b.x).toBe(false);
  });

  it('keeps exactly one copy of same-facing coincident edges', () => {
    const border = unionPolygons([rect(0, 0, 10, 10), rect(0, 0, 10, 10)]);
    expect(totalLength(border)).toBeCloseTo(40);
  });

  it('keeps disjoint polygons whole and does not mutate inputs', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(50, 50, 60, 60);
    const snapshot = JSON.stringify([a.points, b.points]);
    const border = unionPolygons([a, b]);
    expect(border).toHaveLength(8);
    expect(JSON.stringify([a.points, b.points])).toBe(snapshot);
  });

  it('works for a polygon fully inside another', () => {
    const border = unionPolygons([rect(0, 0, 10, 10), rect(2, 2, 4, 4)]);
    expect(totalLength(border)).toBeCloseTo(40);
  });

  it('reports progress and handles an empty input', () => {
    const progress: number[] = [];
    unionPolygons([rect(0, 0, 1, 1), rect(0.5, 0, 2, 1)], { onProgress: (f) => progress.push(f) });
    expect(progress.at(-1)).toBe(1);
    expect(unionPolygons([])).toEqual([]);
  });

  it('unions a 500-polygon road grid well under a second', () => {
    // 20 x 25 grid of road rectangles (each road 100 wide, overlapping at junctions),
    // with 22-vertex rectangles to match the rounded envelopes used by world generation.
    const polys: Polygon[] = [];
    const spacing = 300;
    const roundRect = (x0: number, y0: number, x1: number, y1: number): Polygon => {
      const pts: Vec2[] = [];
      const n = 5;
      for (let i = 0; i <= n; i++) pts.push(v(x0 + ((x1 - x0) * i) / n, y0));
      for (let i = 1; i <= n; i++) pts.push(v(x1, y0 + ((y1 - y0) * i) / n));
      for (let i = 1; i <= n; i++) pts.push(v(x1 - ((x1 - x0) * i) / n, y1));
      for (let i = 1; i < n; i++) pts.push(v(x0, y1 - ((y1 - y0) * i) / n));
      return new Polygon(pts);
    };
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 13; c++) {
        polys.push(roundRect(c * spacing - 50, r * spacing - 50, (c + 1) * spacing + 50, r * spacing + 50));
      }
    }
    for (let c = 0; c < 20 && polys.length < 500; c++) {
      for (let r = 0; r < 12 && polys.length < 500; r++) {
        polys.push(roundRect(c * spacing - 50, r * spacing - 50, c * spacing + 50, (r + 1) * spacing + 50));
      }
    }
    expect(polys).toHaveLength(500);
    const t0 = performance.now();
    const border = unionPolygons(polys);
    const ms = performance.now() - t0;
    console.info(`union of 500 polygons: ${ms.toFixed(1)} ms, ${border.length} border segments`);
    expect(border.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1000);
  });
});
