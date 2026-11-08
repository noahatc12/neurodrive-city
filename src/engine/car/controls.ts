/**
 * Control inputs for a car. Values are in [0, 1]; binary sources (keyboard, step
 * activation network) use exactly 0 or 1, analog sources (route follower, tanh network)
 * use the full range.
 * @module engine/car/controls
 */

export interface Controls {
  forward: number;
  reverse: number;
  left: number;
  right: number;
}

/** Where a car's controls come from (spec E2). */
export type ControlSource = 'keys' | 'ai' | 'dummy' | 'route';

export function makeControls(): Controls {
  return { forward: 0, reverse: 0, left: 0, right: 0 };
}

export function resetControls(c: Controls): void {
  c.forward = 0;
  c.reverse = 0;
  c.left = 0;
  c.right = 0;
}

/**
 * Keyboard state written by the app (arrows / WASD) and read by the engine. The engine
 * never touches DOM events; it only sees this plain object.
 */
export interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export function makeKeyState(): KeyState {
  return { up: false, down: false, left: false, right: false };
}

/** Copies key state into controls (binary). */
export function applyKeys(keys: KeyState, out: Controls): void {
  out.forward = keys.up ? 1 : 0;
  out.reverse = keys.down ? 1 : 0;
  out.left = keys.left ? 1 : 0;
  out.right = keys.right ? 1 : 0;
}

/** Dummy traffic: constant forward throttle (the course's "DUMMY" cars). */
export function applyDummy(out: Controls, throttle = 1): void {
  out.forward = throttle;
  out.reverse = 0;
  out.left = 0;
  out.right = 0;
}
