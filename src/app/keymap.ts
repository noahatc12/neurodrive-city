/**
 * Keyboard shortcuts (spec B7) as data: the same table drives the key handler and the
 * `?` help overlay, so they can never disagree.
 * @module app/keymap
 */

export type ActionId =
  | 'tool.graph'
  | 'tool.stop'
  | 'tool.yield'
  | 'tool.crossing'
  | 'tool.parking'
  | 'tool.light'
  | 'tool.start'
  | 'tool.target'
  | 'tool.erase'
  | 'edit.grid'
  | 'edit.oneWay'
  | 'edit.delete'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cancel'
  | 'mode.toggle'
  | 'view.toggle3d'
  | 'view.cycleCamera'
  | 'view.focusBest'
  | 'sim.pause'
  | 'sim.faster'
  | 'sim.slower'
  | 'view.sensors'
  | 'view.nnPanel'
  | 'view.minimap'
  | 'view.dayNight'
  | 'mode.train'
  | 'brain.save'
  | 'brain.discard'
  | 'file.save'
  | 'file.open'
  | 'help.toggle'
  | 'sim.resetCar';

export interface Binding {
  /** `KeyboardEvent.key`, lower-cased for letters. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  action: ActionId;
}

export interface ShortcutDoc {
  keys: string;
  label: string;
  group: 'Tools' | 'Editing' | 'View' | 'Simulation' | 'File';
}

export const BINDINGS: readonly Binding[] = [
  { key: '1', action: 'tool.graph' },
  { key: '2', action: 'tool.stop' },
  { key: '3', action: 'tool.yield' },
  { key: '4', action: 'tool.crossing' },
  { key: '5', action: 'tool.parking' },
  { key: '6', action: 'tool.light' },
  { key: '7', action: 'tool.start' },
  { key: '8', action: 'tool.target' },
  { key: 'e', action: 'tool.erase' },
  { key: 'g', action: 'edit.grid' },
  { key: 'o', action: 'edit.oneWay' },
  { key: 'delete', action: 'edit.delete' },
  { key: 'backspace', action: 'edit.delete' },
  { key: 'z', ctrl: true, action: 'edit.undo' },
  { key: 'z', ctrl: true, shift: true, action: 'edit.redo' },
  { key: 'y', ctrl: true, action: 'edit.redo' },
  { key: 'escape', action: 'edit.cancel' },
  { key: 'tab', action: 'mode.toggle' },
  { key: 'v', action: 'view.toggle3d' },
  { key: 'c', action: 'view.cycleCamera' },
  { key: 'f', action: 'view.focusBest' },
  { key: '+', action: 'sim.faster' },
  { key: '=', action: 'sim.faster' },
  { key: '-', action: 'sim.slower' },
  { key: 'b', action: 'view.sensors' },
  { key: 'n', action: 'view.nnPanel' },
  { key: 'm', action: 'view.minimap' },
  { key: 'l', action: 'view.dayNight' },
  { key: 't', action: 'mode.train' },
  { key: 's', action: 'brain.save' },
  { key: 'x', action: 'brain.discard' },
  { key: 's', ctrl: true, action: 'file.save' },
  { key: 'o', ctrl: true, action: 'file.open' },
  { key: '?', action: 'help.toggle' },
  { key: 'r', action: 'sim.resetCar' },
];

/** Human-readable shortcut list for the help overlay (Space is handled specially). */
export const SHORTCUT_DOCS: readonly ShortcutDoc[] = [
  { keys: '1', label: 'Graph tool (roads)', group: 'Tools' },
  { keys: '2', label: 'Stop sign', group: 'Tools' },
  { keys: '3', label: 'Yield sign', group: 'Tools' },
  { keys: '4', label: 'Zebra crossing', group: 'Tools' },
  { keys: '5', label: 'Parking bay', group: 'Tools' },
  { keys: '6', label: 'Traffic light', group: 'Tools' },
  { keys: '7', label: 'Start (spawn)', group: 'Tools' },
  { keys: '8', label: 'Target (destination)', group: 'Tools' },
  { keys: 'E', label: 'Erase tool', group: 'Tools' },
  { keys: 'Click', label: 'Add point / select / connect', group: 'Editing' },
  { keys: 'Drag', label: 'Move point (or selection)', group: 'Editing' },
  {
    keys: 'Right-click',
    label: 'Delete hovered point or marking, else deselect',
    group: 'Editing',
  },
  { keys: 'Shift+drag', label: 'Box select', group: 'Editing' },
  { keys: 'Shift+click', label: 'Add segment or point to selection', group: 'Editing' },
  { keys: 'Alt+click', label: 'Split segment', group: 'Editing' },
  { keys: 'Delete', label: 'Delete selection', group: 'Editing' },
  { keys: 'O', label: 'Toggle one-way on selected segments', group: 'Editing' },
  { keys: 'G', label: 'Toggle grid snapping', group: 'Editing' },
  { keys: 'Ctrl+Z', label: 'Undo', group: 'Editing' },
  { keys: 'Ctrl+Shift+Z', label: 'Redo', group: 'Editing' },
  { keys: 'Esc', label: 'Cancel / close', group: 'Editing' },
  { keys: 'Wheel', label: 'Zoom toward cursor', group: 'View' },
  { keys: 'Middle / Right / Space+drag', label: 'Pan', group: 'View' },
  { keys: 'V', label: 'Toggle 2D / 3D', group: 'View' },
  { keys: 'C', label: 'Cycle camera', group: 'View' },
  { keys: 'F', label: 'Follow the AI car / best car', group: 'View' },
  { keys: 'B', label: 'Toggle sensor rays', group: 'View' },
  { keys: 'N', label: 'Toggle neural network panel', group: 'View' },
  { keys: 'M', label: 'Toggle minimap', group: 'View' },
  { keys: 'L', label: 'Day / night (3D view)', group: 'View' },
  { keys: 'Tab', label: 'Toggle Edit / Simulate', group: 'Simulation' },
  { keys: 'T', label: 'Toggle training mode', group: 'Simulation' },
  { keys: 'Space', label: 'Pause / resume', group: 'Simulation' },
  { keys: 'Arrows / WASD', label: 'Drive your car (Simulate)', group: 'Simulation' },
  { keys: 'R', label: 'Reset your car to the start', group: 'Simulation' },
  { keys: '+ / -', label: 'Simulation speed', group: 'Simulation' },
  { keys: 'S', label: 'Save best brain', group: 'Simulation' },
  { keys: 'X', label: 'Discard saved brain', group: 'Simulation' },
  { keys: 'Ctrl+S', label: 'Save world to file', group: 'File' },
  { keys: 'Ctrl+O', label: 'Open world file', group: 'File' },
  { keys: '?', label: 'This help', group: 'File' },
];

/** Finds the action for a key event (null if unbound). */
export function matchBinding(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): ActionId | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  // Shift changes the produced character for '?' and '+', so ignore shift for symbols.
  const isSymbol = key.length === 1 && !/[a-z0-9]/.test(key);
  for (const b of BINDINGS) {
    if (b.key !== key) continue;
    if (!!b.ctrl !== ctrl) continue;
    if (!isSymbol && !!b.shift !== e.shiftKey) {
      // plain letter bindings also accept Shift (e.g. Shift+E) except where shift matters
      if (
        b.ctrl ||
        BINDINGS.some((o) => o.key === key && !!o.ctrl === ctrl && !!o.shift === e.shiftKey)
      )
        continue;
    }
    return b.action;
  }
  return null;
}
