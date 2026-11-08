/**
 * Undoable editor operations. Commands refer to points, segments and markings by their
 * stable ids and re-create them with the same ids on redo/undo, so a chain of commands
 * stays valid no matter how often it is replayed.
 *
 * @module editor/commands
 */
import type { SegmentFlags } from '../engine/graph/segment.ts';
import {
  MarkingStore,
  type Marking,
  type MarkingBinding,
  type MarkingType,
} from '../engine/markings/marking.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import type { Command } from './history.ts';

interface SegmentSnapshot {
  id: number;
  a: number;
  b: number;
  flags: SegmentFlags;
}

function snapshotSegment(model: WorldModel, id: number): SegmentSnapshot | null {
  const s = model.graph.getSegment(id);
  return s ? { id: s.id, a: s.a.id, b: s.b.id, flags: s.flags() } : null;
}

function captureMarkings(model: WorldModel, segmentIds: Iterable<number>): Marking[] {
  const ids = new Set(segmentIds);
  return model.markings
    .all()
    .filter((m) => ids.has(m.binding.segmentId))
    .map((m) => MarkingStore.clone(m));
}

/** Adds a point (same id on redo). */
export class AddPointCommand implements Command {
  readonly label = 'Add point';
  id: number | null = null;
  private readonly model: WorldModel;
  private readonly x: number;
  private readonly y: number;

  constructor(model: WorldModel, x: number, y: number) {
    this.model = model;
    this.x = x;
    this.y = y;
  }

  do(): void {
    if (this.id === null) this.id = this.model.graph.addPoint(this.x, this.y).id;
    else this.model.graph.restorePoint(this.id, this.x, this.y);
  }

  undo(): void {
    const p = this.id === null ? undefined : this.model.graph.getPoint(this.id);
    if (p) this.model.graph.removePoint(p);
  }
}

/** Connects two existing points (no-op if they cannot be connected). */
export class AddSegmentCommand implements Command {
  readonly label = 'Add road';
  id: number | null = null;
  private readonly model: WorldModel;
  private readonly aId: number;
  private readonly bId: number;
  private readonly flags: Partial<SegmentFlags>;

  constructor(model: WorldModel, aId: number, bId: number, flags: Partial<SegmentFlags> = {}) {
    this.model = model;
    this.aId = aId;
    this.bId = bId;
    this.flags = flags;
  }

  do(): void {
    const g = this.model.graph;
    if (this.id === null) {
      const a = g.getPoint(this.aId);
      const b = g.getPoint(this.bId);
      this.id = a && b ? (g.addSegment(a, b, this.flags)?.id ?? null) : null;
    } else {
      g.restoreSegment(this.id, this.aId, this.bId, this.flags);
    }
  }

  undo(): void {
    const s = this.id === null ? undefined : this.model.graph.getSegment(this.id);
    if (s) this.model.graph.removeSegment(s);
  }
}

/** Adds a point and connects it from an existing point (one undo step). */
export class AddConnectedPointCommand implements Command {
  readonly label = 'Add point';
  readonly point: AddPointCommand;
  private segment: AddSegmentCommand | null = null;
  private readonly model: WorldModel;
  private readonly fromId: number | null;

  constructor(model: WorldModel, x: number, y: number, fromId: number | null) {
    this.model = model;
    this.point = new AddPointCommand(model, x, y);
    this.fromId = fromId;
  }

  do(): void {
    this.point.do();
    if (this.segment === null && this.fromId !== null && this.point.id !== null) {
      if (this.model.graph.getPoint(this.fromId)) {
        this.segment = new AddSegmentCommand(this.model, this.fromId, this.point.id);
      }
    }
    this.segment?.do();
  }

  undo(): void {
    this.segment?.undo();
    this.point.undo();
  }
}

/** Removes a point, its segments and the markings bound to them. */
export class RemovePointCommand implements Command {
  readonly label = 'Delete point';
  private readonly model: WorldModel;
  private readonly id: number;
  private point: Vec2 | null = null;
  private segments: SegmentSnapshot[] = [];
  private markings: Marking[] = [];

  constructor(model: WorldModel, id: number) {
    this.model = model;
    this.id = id;
  }

  do(): void {
    const g = this.model.graph;
    const p = g.getPoint(this.id);
    if (!p) return;
    this.point = { x: p.x, y: p.y };
    this.segments = g
      .segmentsWithPoint(p)
      .map((s) => ({ id: s.id, a: s.a.id, b: s.b.id, flags: s.flags() }));
    this.markings = captureMarkings(
      this.model,
      this.segments.map((s) => s.id),
    );
    g.removePoint(p);
  }

  undo(): void {
    if (!this.point) return;
    const g = this.model.graph;
    g.restorePoint(this.id, this.point.x, this.point.y);
    for (const s of this.segments) {
      if (g.getPoint(s.a) && g.getPoint(s.b)) g.restoreSegment(s.id, s.a, s.b, s.flags);
    }
    for (const m of this.markings) this.model.markings.restore(m);
  }
}

/** Removes one segment (endpoints stay) and its markings. */
export class RemoveSegmentCommand implements Command {
  readonly label = 'Delete road';
  private readonly model: WorldModel;
  private readonly id: number;
  private snapshot: SegmentSnapshot | null = null;
  private markings: Marking[] = [];

  constructor(model: WorldModel, id: number) {
    this.model = model;
    this.id = id;
  }

  do(): void {
    this.snapshot = snapshotSegment(this.model, this.id);
    const s = this.model.graph.getSegment(this.id);
    if (!s) return;
    this.markings = captureMarkings(this.model, [this.id]);
    this.model.graph.removeSegment(s);
  }

  undo(): void {
    const s = this.snapshot;
    if (!s) return;
    this.model.graph.restoreSegment(s.id, s.a, s.b, s.flags);
    for (const m of this.markings) this.model.markings.restore(m);
  }
}

/** Moves a set of points (a finished drag, possibly of a multi-selection). */
export class MovePointsCommand implements Command {
  readonly label: string;
  private readonly model: WorldModel;
  private readonly ids: number[];
  private readonly from: Vec2[];
  private readonly to: Vec2[];

  constructor(model: WorldModel, ids: number[], from: Vec2[], to: Vec2[]) {
    this.model = model;
    this.ids = ids;
    this.from = from.map((p) => ({ x: p.x, y: p.y }));
    this.to = to.map((p) => ({ x: p.x, y: p.y }));
    this.label = ids.length > 1 ? `Move ${ids.length} points` : 'Move point';
  }

  do(): void {
    this.apply(this.to);
  }

  undo(): void {
    this.apply(this.from);
  }

  private apply(pos: Vec2[]): void {
    this.ids.forEach((id, i) => {
      const p = this.model.graph.getPoint(id);
      const q = pos[i];
      if (p && q) this.model.graph.movePoint(p, q.x, q.y);
    });
  }
}

/** Splits a segment at t, inserting a point; bound markings move to the correct half. */
export class SplitSegmentCommand implements Command {
  readonly label = 'Split road';
  private readonly model: WorldModel;
  private readonly segmentId: number;
  private readonly t: number;
  private original: SegmentSnapshot | null = null;
  ids: { point: number; first: number; second: number } | null = null;

  constructor(model: WorldModel, segmentId: number, t: number) {
    this.model = model;
    this.segmentId = segmentId;
    this.t = t;
  }

  do(): void {
    const seg = this.model.graph.getSegment(this.segmentId);
    if (!seg) return;
    this.original = snapshotSegment(this.model, this.segmentId);
    const res = this.model.graph.splitSegment(seg, this.t, this.ids ?? undefined);
    if (res) this.ids = { point: res.point.id, first: res.first.id, second: res.second.id };
  }

  undo(): void {
    const ids = this.ids;
    const orig = this.original;
    if (!ids || !orig) return;
    const g = this.model.graph;
    // Map markings on the halves back onto the original segment's parameter range.
    const restored: Marking[] = [];
    for (const m of captureMarkings(this.model, [ids.first, ids.second])) {
      const t =
        m.binding.segmentId === ids.first
          ? m.binding.t * this.t
          : this.t + m.binding.t * (1 - this.t);
      restored.push({ ...m, binding: { ...m.binding, segmentId: orig.id, t } });
    }
    const p = g.getPoint(ids.point);
    if (p) g.removePoint(p);
    g.restoreSegment(orig.id, orig.a, orig.b, orig.flags);
    for (const m of restored) this.model.markings.restore(m);
  }
}

/** Sets flags (e.g. one-way) on several segments. */
export class SetSegmentFlagsCommand implements Command {
  readonly label: string;
  private readonly model: WorldModel;
  private readonly ids: number[];
  private readonly next: Partial<SegmentFlags>;
  private before: SegmentFlags[] = [];

  constructor(
    model: WorldModel,
    ids: number[],
    next: Partial<SegmentFlags>,
    label = 'Change road',
  ) {
    this.model = model;
    this.ids = ids;
    this.next = next;
    this.label = label;
  }

  do(): void {
    this.before = this.ids.map(
      (id) =>
        this.model.graph.getSegment(id)?.flags() ?? { oneWay: false, bridge: false, tunnel: false },
    );
    for (const id of this.ids) {
      const s = this.model.graph.getSegment(id);
      if (s) this.model.graph.setSegmentFlags(s, this.next);
    }
  }

  undo(): void {
    this.ids.forEach((id, i) => {
      const s = this.model.graph.getSegment(id);
      const f = this.before[i];
      if (s && f) this.model.graph.setSegmentFlags(s, f);
    });
  }
}

/** Places a marking. */
export class AddMarkingCommand implements Command {
  readonly label: string;
  id: number | null = null;
  private readonly model: WorldModel;
  private readonly type: MarkingType;
  private readonly binding: MarkingBinding;
  private readonly props: Record<string, unknown>;

  constructor(
    model: WorldModel,
    type: MarkingType,
    binding: MarkingBinding,
    props: Record<string, unknown> = {},
  ) {
    this.model = model;
    this.type = type;
    this.binding = { ...binding };
    this.props = { ...props };
    this.label = `Place ${type}`;
  }

  do(): void {
    if (this.id === null) this.id = this.model.markings.add(this.type, this.binding, this.props).id;
    else
      this.model.markings.restore({
        id: this.id,
        type: this.type,
        binding: this.binding,
        props: this.props,
      });
  }

  undo(): void {
    if (this.id !== null) this.model.markings.remove(this.id);
  }
}

/** Removes a marking. */
export class RemoveMarkingCommand implements Command {
  readonly label = 'Remove marking';
  private readonly model: WorldModel;
  private readonly id: number;
  private snapshot: Marking | null = null;

  constructor(model: WorldModel, id: number) {
    this.model = model;
    this.id = id;
  }

  do(): void {
    const m = this.model.markings.get(this.id);
    this.snapshot = m ? MarkingStore.clone(m) : null;
    this.model.markings.remove(this.id);
  }

  undo(): void {
    if (this.snapshot) this.model.markings.restore(this.snapshot);
  }
}

/** Clears the whole world (undoable: everything comes back with the same ids). */
export class DisposeWorldCommand implements Command {
  readonly label = 'Dispose world';
  private readonly model: WorldModel;
  private points: { id: number; x: number; y: number }[] = [];
  private segments: SegmentSnapshot[] = [];
  private markings: Marking[] = [];

  constructor(model: WorldModel) {
    this.model = model;
  }

  do(): void {
    const g = this.model.graph;
    this.points = g.points.map((p) => ({ id: p.id, x: p.x, y: p.y }));
    this.segments = g.segments.map((s) => ({ id: s.id, a: s.a.id, b: s.b.id, flags: s.flags() }));
    this.markings = this.model.markings.all().map((m) => MarkingStore.clone(m));
    g.dispose();
  }

  undo(): void {
    const g = this.model.graph;
    for (const p of this.points) g.restorePoint(p.id, p.x, p.y);
    for (const s of this.segments) g.restoreSegment(s.id, s.a, s.b, s.flags);
    for (const m of this.markings) this.model.markings.restore(m);
  }
}
