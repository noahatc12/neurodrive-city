/**
 * Tool interface: the controller handles panning, zooming, hovering, dragging and box
 * selection; tools decide what a primary click does and what preview to show.
 * @module editor/tools/tool
 */
import type { ToolId } from '../../app/renderer.ts';
import type { Vec2 } from '../../engine/math/vec2.ts';
import type { EditorController } from '../editorController.ts';

/** Information about a completed primary click (no drag happened). */
export interface ClickInfo {
  /** Raw world position under the pointer. */
  world: Vec2;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface Tool {
  readonly id: ToolId;
  /** Primary pointer pressed: return true to start a point drag (graph tool only). */
  onPointerDown?(ctl: EditorController, info: ClickInfo): boolean;
  /** Primary click (press and release without dragging). */
  onClick(ctl: EditorController, info: ClickInfo): void;
  /** Pointer moved while hovering (not dragging): update tool previews. */
  onHover?(ctl: EditorController, world: Vec2): void;
}
