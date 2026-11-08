import { describe, expect, it } from 'vitest';
import {
  AddConnectedPointCommand,
  AddMarkingCommand,
  AddPointCommand,
  AddSegmentCommand,
  DisposeWorldCommand,
  MovePointsCommand,
  RemoveMarkingCommand,
  RemovePointCommand,
  RemoveSegmentCommand,
  SetSegmentFlagsCommand,
  SplitSegmentCommand,
} from '../../src/editor/commands.ts';
import { CompositeCommand, History, type Command } from '../../src/editor/history.ts';
import { WorldModel } from '../../src/engine/world/worldModel.ts';

function world(): WorldModel {
  const m = new WorldModel();
  const a = m.graph.addPoint(0, 0);
  const b = m.graph.addPoint(200, 0);
  const c = m.graph.addPoint(200, 200);
  m.graph.addSegment(a, b);
  m.graph.addSegment(b, c);
  return m;
}

const snapshot = (m: WorldModel): string =>
  `${m.graph.hash()}|${m.markings
    .all()
    .map((k) => `${k.id}:${k.type}:${k.binding.segmentId}:${k.binding.t.toFixed(4)}`)
    .join(',')}`;

/** do → undo → redo → undo must always return to the exact same states. */
function roundTrip(m: WorldModel, cmd: Command): void {
  const h = new History();
  const before = snapshot(m);
  h.push(cmd);
  const after = snapshot(m);
  expect(after).not.toBe(before);
  h.undo();
  expect(snapshot(m)).toBe(before);
  h.redo();
  expect(snapshot(m)).toBe(after);
  h.undo();
  expect(snapshot(m)).toBe(before);
}

describe('editor/history', () => {
  it('undoes and redoes in order and clears redo on push', () => {
    const h = new History();
    const log: string[] = [];
    const cmd = (n: string): Command => ({
      label: n,
      do: () => log.push(`do ${n}`),
      undo: () => log.push(`undo ${n}`),
    });
    let changes = 0;
    h.onChange(() => changes++);
    h.push(cmd('a'));
    h.push(cmd('b'));
    expect(h.undo()?.label).toBe('b');
    expect(h.canRedo).toBe(true);
    h.push(cmd('c'));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(log).toEqual(['do a', 'do b', 'undo b', 'do c']);
    expect(changes).toBe(4);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });

  it('caps the stack at 200 entries', () => {
    const h = new History(200);
    for (let i = 0; i < 250; i++) h.push({ label: String(i), do: () => {}, undo: () => {} });
    expect(h.undoSize).toBe(200);
  });

  it('push(cmd, false) records without executing', () => {
    const h = new History();
    let n = 0;
    h.push({ label: 'x', do: () => n++, undo: () => n-- }, false);
    expect(n).toBe(0);
    h.undo();
    expect(n).toBe(-1);
  });

  it('composite commands undo in reverse order', () => {
    const log: string[] = [];
    const c = new CompositeCommand('both', [
      { label: '1', do: () => log.push('1'), undo: () => log.push('-1') },
      { label: '2', do: () => log.push('2'), undo: () => log.push('-2') },
    ]);
    c.do();
    c.undo();
    expect(log).toEqual(['1', '2', '-2', '-1']);
  });
});

describe('editor/commands round trips', () => {
  it('add point keeps its id on redo', () => {
    const m = world();
    const cmd = new AddPointCommand(m, 50, 50);
    roundTrip(m, cmd);
    const h = new History();
    h.push(cmd);
    expect(m.graph.getPoint(cmd.id ?? -1)?.x).toBe(50);
  });

  it('add segment and connected point', () => {
    const m = world();
    const pts = m.graph.points;
    roundTrip(m, new AddSegmentCommand(m, pts[0]?.id ?? 0, pts[2]?.id ?? 0));
    roundTrip(m, new AddConnectedPointCommand(m, -100, 0, pts[0]?.id ?? 0));
    roundTrip(m, new AddConnectedPointCommand(m, -100, 50, null));
  });

  it('remove point restores segments and their markings', () => {
    const m = world();
    const seg = m.graph.segments[0];
    if (!seg) throw new Error('no segment');
    m.markings.add('stop', { segmentId: seg.id, t: 0.8, side: 1 });
    expect(m.markings.size).toBe(1);
    const pointB = m.graph.points[1];
    roundTrip(m, new RemovePointCommand(m, pointB?.id ?? 0));
    expect(m.markings.size).toBe(1);
  });

  it('remove segment restores markings', () => {
    const m = world();
    const seg = m.graph.segments[1];
    if (!seg) throw new Error('no segment');
    m.markings.add('light', { segmentId: seg.id, t: 0.2, side: -1 });
    roundTrip(m, new RemoveSegmentCommand(m, seg.id));
  });

  it('move points (multi-selection) and flags', () => {
    const m = world();
    const ids = m.graph.points.map((p) => p.id);
    const from = m.graph.points.map((p) => ({ x: p.x, y: p.y }));
    const to = from.map((p) => ({ x: p.x + 10, y: p.y - 5 }));
    roundTrip(m, new MovePointsCommand(m, ids, from, to));
    roundTrip(m, new SetSegmentFlagsCommand(m, [m.graph.segments[0]?.id ?? 0], { oneWay: true }));
  });

  it('split keeps markings on the correct half and undo restores them', () => {
    const m = world();
    const seg = m.graph.segments[0];
    if (!seg) throw new Error('no segment');
    const early = m.markings.add('stop', { segmentId: seg.id, t: 0.2, side: 1 });
    const late = m.markings.add('yield', { segmentId: seg.id, t: 0.9, side: -1 });
    const cmd = new SplitSegmentCommand(m, seg.id, 0.5);
    const h = new History();
    const before = snapshot(m);
    h.push(cmd);
    const ids = cmd.ids;
    expect(ids).not.toBeNull();
    expect(m.markings.get(early.id)?.binding.segmentId).toBe(ids?.first);
    expect(m.markings.get(early.id)?.binding.t).toBeCloseTo(0.4);
    expect(m.markings.get(late.id)?.binding.segmentId).toBe(ids?.second);
    expect(m.markings.get(late.id)?.binding.t).toBeCloseTo(0.8);
    h.undo();
    expect(snapshot(m)).toBe(before);
    expect(m.markings.get(early.id)?.binding).toEqual({
      segmentId: seg.id,
      t: expect.closeTo(0.2) as number,
      side: 1,
    });
    h.redo();
    expect(m.markings.get(late.id)?.binding.segmentId).toBe(ids?.second);
    expect(m.graph.getPoint(ids?.point ?? -1)).toBeDefined();
  });

  it('marking add and remove', () => {
    const m = world();
    const seg = m.graph.segments[0];
    if (!seg) throw new Error('no segment');
    const add = new AddMarkingCommand(m, 'parking', { segmentId: seg.id, t: 0.5, side: 1 });
    roundTrip(m, add);
    const h = new History();
    h.push(add);
    roundTrip(m, new RemoveMarkingCommand(m, add.id ?? -1));
  });

  it('dispose world restores everything with the same ids', () => {
    const m = world();
    const seg = m.graph.segments[0];
    if (!seg) throw new Error('no segment');
    m.markings.add('target', { segmentId: seg.id, t: 0.5, side: 1 });
    roundTrip(m, new DisposeWorldCommand(m));
  });

  it('commands on missing entities are safe no-ops', () => {
    const m = world();
    new RemovePointCommand(m, 999).do();
    new RemovePointCommand(m, 999).undo();
    new RemoveSegmentCommand(m, 999).do();
    new RemoveSegmentCommand(m, 999).undo();
    new SplitSegmentCommand(m, 999, 0.5).do();
    new SplitSegmentCommand(m, 999, 0.5).undo();
    new AddSegmentCommand(m, 998, 999).do();
    new RemoveMarkingCommand(m, 5).do();
    new RemoveMarkingCommand(m, 5).undo();
    expect(m.graph.pointCount).toBe(3);
  });
});
