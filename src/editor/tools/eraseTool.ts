/**
 * Erase tool (E): click a marking, point or segment to delete it (in that priority).
 * @module editor/tools/eraseTool
 */
import { RemoveMarkingCommand, RemovePointCommand, RemoveSegmentCommand } from '../commands.ts';
import type { EditorController } from '../editorController.ts';
import type { Tool } from './tool.ts';

export const eraseTool: Tool = {
  id: 'erase',
  onClick(ctl: EditorController): void {
    const { state, model } = ctl;
    if (state.hoverMarkingId !== null) {
      ctl.history.push(new RemoveMarkingCommand(model, state.hoverMarkingId));
    } else if (state.hoverPointId !== null) {
      ctl.history.push(new RemovePointCommand(model, state.hoverPointId));
    } else if (state.hoverSegmentId !== null) {
      ctl.history.push(new RemoveSegmentCommand(model, state.hoverSegmentId));
    } else {
      return;
    }
    ctl.clearSelection();
    ctl.refreshHover();
  },
};
