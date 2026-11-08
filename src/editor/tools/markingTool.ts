/**
 * Marking tools (spec B5): stop, yield, crossing, parking, light, start, target.
 * The marking snaps onto the nearest lane (crossings onto the centre line), is
 * previewed under the cursor, and is bound to the segment it sits on.
 * @module editor/tools/markingTool
 */
import { bindingAt, type MarkingType } from '../../engine/markings/marking.ts';
import type { Vec2 } from '../../engine/math/vec2.ts';
import { AddMarkingCommand } from '../commands.ts';
import type { EditorController } from '../editorController.ts';
import type { Tool } from './tool.ts';

/** Creates the tool for one marking type. */
export function markingTool(type: MarkingType): Tool {
  return {
    id: type,
    onHover(ctl: EditorController, world: Vec2): void {
      const b = bindingAt(ctl.model.graph, type, world, ctl.model.settings.roadWidth);
      ctl.state.markingPreview = b ? { type, ...b } : null;
    },
    onClick(ctl: EditorController, info): void {
      if (ctl.state.hoverMarkingId !== null && ctl.markingUnderCursorIsType(type)) return;
      const b = bindingAt(ctl.model.graph, type, info.world, ctl.model.settings.roadWidth);
      if (!b) {
        ctl.toast('Place markings on a road');
        return;
      }
      ctl.history.push(new AddMarkingCommand(ctl.model, type, b));
    },
  };
}
