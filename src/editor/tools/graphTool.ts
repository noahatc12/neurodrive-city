/**
 * Graph tool (spec B1, B8): add and connect points, select points and segments,
 * Alt+click splits a segment.
 * @module editor/tools/graphTool
 */
import { AddConnectedPointCommand, AddSegmentCommand, SplitSegmentCommand } from '../commands.ts';
import type { EditorController } from '../editorController.ts';
import type { ClickInfo, Tool } from './tool.ts';

export const graphTool: Tool = {
  id: 'graph',

  onPointerDown(ctl: EditorController, info: ClickInfo): boolean {
    // A press on a point may become a drag; clicks are resolved on release.
    return ctl.state.hoverPointId !== null && !info.alt;
  },

  onClick(ctl: EditorController, info: ClickInfo): void {
    const { model, state } = ctl;
    const g = model.graph;

    // Alt+click on a segment splits it at the cursor.
    if (info.alt && state.hoverSegmentId !== null) {
      const seg = g.getSegment(state.hoverSegmentId);
      if (!seg) return;
      const t = seg.project(info.world);
      const cmd = new SplitSegmentCommand(model, seg.id, t);
      ctl.history.push(cmd);
      if (cmd.ids) ctl.selectPoint(cmd.ids.point);
      else ctl.toast('Too close to an end to split');
      return;
    }

    // Click on an existing point: connect from the current selection, then select it.
    const hovered = state.hoverPointId !== null ? g.getPoint(state.hoverPointId) : undefined;
    if (hovered) {
      if (info.shift) {
        ctl.togglePointInSelection(hovered.id);
        return;
      }
      const sel = state.selectedPointId !== null ? g.getPoint(state.selectedPointId) : undefined;
      if (sel && sel !== hovered && g.canConnect(sel, hovered)) {
        ctl.history.push(new AddSegmentCommand(model, sel.id, hovered.id));
      }
      ctl.selectPoint(hovered.id);
      return;
    }

    // Click on a segment selects it (shift adds to the selection).
    if (state.hoverSegmentId !== null) {
      ctl.selectSegment(state.hoverSegmentId, info.shift);
      return;
    }

    // Click on empty space adds a point (snapped) and connects it from the selection.
    const s = ctl.snapAt(info.world);
    if (s.point) {
      const sel = state.selectedPointId !== null ? g.getPoint(state.selectedPointId) : undefined;
      if (sel && sel !== s.point && g.canConnect(sel, s.point)) {
        ctl.history.push(new AddSegmentCommand(model, sel.id, s.point.id));
      }
      ctl.selectPoint(s.point.id);
      return;
    }
    const cmd = new AddConnectedPointCommand(model, s.x, s.y, state.selectedPointId);
    ctl.history.push(cmd);
    if (cmd.point.id !== null) ctl.selectPoint(cmd.point.id);
  },
};
