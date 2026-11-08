/**
 * Places a representative set of markings in a world so the simulation has something
 * to obey out of the box: a signalised junction, an all-way stop, a yield, a zebra
 * crossing, a parking bay, a start and a target. Deterministic (no randomness).
 * @module engine/world/demoMarkings
 */
import type { Point } from '../graph/point.ts';
import type { Segment } from '../graph/segment.ts';
import type { MarkingType, Side } from '../markings/marking.ts';
import type { WorldModel } from './worldModel.ts';

/** Places a marking on the approach lane of `seg` toward junction `p`, `dist` units before it. */
export function placeApproach(
  model: WorldModel,
  type: MarkingType,
  seg: Segment,
  p: Point,
  dist: number,
): boolean {
  const len = seg.length();
  if (len < dist * 1.6) return false;
  const towardB = seg.b.id === p.id;
  const t = towardB ? 1 - dist / len : dist / len;
  const side: Side = towardB ? 1 : -1;
  model.markings.add(type, { segmentId: seg.id, t, side });
  return true;
}

/** Adds the demo set of markings. Returns how many were placed. */
export function addDemoMarkings(model: WorldModel): number {
  const g = model.graph;
  const rw = model.settings.roadWidth;
  const before = model.markings.size;
  const pts = [...g.points];
  if (pts.length === 0) return 0;
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const byCentre = [...pts].sort(
    (a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy),
  );
  const used = new Set<number>();
  const usedSegs = new Set<number>();
  const pick = (minDegree: number, avoidNear: number): Point | undefined =>
    byCentre.find(
      (p) =>
        g.degree(p) >= minDegree &&
        !used.has(p.id) &&
        [...used].every((id) => {
          const q = g.getPoint(id);
          return !q || Math.hypot(q.x - p.x, q.y - p.y) > avoidNear;
        }),
    );

  // 1. signalised junction nearest the centre
  const lightJ = pick(4, 0) ?? pick(3, 0);
  if (lightJ) {
    used.add(lightJ.id);
    for (const s of g.segmentsWithPoint(lightJ))
      if (placeApproach(model, 'light', s, lightJ, rw * 0.85)) usedSegs.add(s.id);
  }
  // 2. all-way stop at another junction
  const stopJ = pick(4, rw * 6) ?? pick(3, rw * 6);
  if (stopJ) {
    used.add(stopJ.id);
    for (const s of g.segmentsWithPoint(stopJ))
      if (placeApproach(model, 'stop', s, stopJ, rw * 0.75)) usedSegs.add(s.id);
  }
  // 3. yield on one approach of a third junction
  const yieldJ = pick(3, rw * 6);
  if (yieldJ) {
    used.add(yieldJ.id);
    const s = g.segmentsWithPoint(yieldJ).find((x) => !usedSegs.has(x.id));
    if (s && placeApproach(model, 'yield', s, yieldJ, rw * 0.75)) usedSegs.add(s.id);
  }
  // 4. a crossing mid-block on a segment near the centre
  const segs = [...g.segments].filter(
    (s) => s.length() > rw * 4 && !usedSegs.has(s.id) && !s.oneWay,
  );
  const segDist = (s: Segment): number =>
    Math.hypot((s.a.x + s.b.x) / 2 - cx, (s.a.y + s.b.y) / 2 - cy);
  segs.sort((a, b) => segDist(a) - segDist(b));
  const crossSeg = segs[0];
  if (crossSeg) {
    model.markings.add('crossing', { segmentId: crossSeg.id, t: 0.5, side: 0 });
    usedSegs.add(crossSeg.id);
  }
  // 5. parking bay, start and target on outer segments
  const outer = [...segs].reverse().filter((s) => !usedSegs.has(s.id));
  const startSeg = outer[0];
  const targetSeg = outer.find(
    (s) =>
      startSeg &&
      segDist(s) > 0 &&
      Math.hypot(
        (s.a.x + s.b.x) / 2 - (startSeg.a.x + startSeg.b.x) / 2,
        (s.a.y + s.b.y) / 2 - (startSeg.a.y + startSeg.b.y) / 2,
      ) >
        rw * 8,
  );
  if (startSeg) model.markings.add('start', { segmentId: startSeg.id, t: 0.35, side: 1 });
  if (targetSeg)
    model.markings.add('target', { segmentId: targetSeg.id, t: 0.6, side: 1 }, { active: true });
  const parkSeg = outer.find((s) => s !== startSeg && s !== targetSeg);
  if (parkSeg) model.markings.add('parking', { segmentId: parkSeg.id, t: 0.5, side: 1 });
  return model.markings.size - before;
}
