/**
 * Target markings (spec D6): route destinations. Several targets are allowed; one is
 * active (the one flagged `props.active`, else the most recently placed).
 * @module engine/markings/target
 */
import type { Marking } from './marking.ts';

/** The active target among `targets` (null if none). */
export function activeTarget(targets: readonly Marking[]): Marking | null {
  let best: Marking | null = null;
  for (const t of targets) {
    if (t.type !== 'target') continue;
    if (t.props.active === true) return t;
    if (!best || t.id > best.id) best = t;
  }
  return best;
}

/** Bobbing offset and pulse for the target pin animation at time `t` (seconds). */
export function targetAnimation(t: number): { bob: number; pulse: number } {
  return { bob: Math.sin(t * 2.4) * 0.5 + 0.5, pulse: (t * 0.8) % 1 };
}
