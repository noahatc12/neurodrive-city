/**
 * Stop sign behaviour (spec D1) as a small state machine, used by route-following cars.
 *
 * ```
 *   approaching ──(within braking zone)──▶ braking ──(speed≈0 at the line)──▶ stopped
 *        ▲                                                                  │
 *        └──────────── reset() for the next stop ◀── clear ◀──(waited ≥ 1 s and junction clear)
 * ```
 *
 * The car must come to a full stop at the line and wait at least {@link STOP_WAIT}
 * seconds; it proceeds only when the junction is clear.
 *
 * @module engine/markings/stop
 */

export type StopPhase = 'approaching' | 'braking' | 'stopped' | 'clear';

/** Minimum wait at a stop line (seconds). */
export const STOP_WAIT = 1;
/** Speed (units/s) below which a car counts as stopped. */
export const STOPPED_SPEED = 2;
/** How close to the line counts as "at the line" (units). */
export const STOP_LINE_TOLERANCE = 18;

export interface StopDecision {
  /** Maximum speed the car may drive this step (units/s); Infinity = no limit. */
  maxSpeed: number;
  phase: StopPhase;
}

/** Comfortable speed that still allows stopping within `dist` at deceleration `decel`. */
export function stoppingSpeed(dist: number, decel: number): number {
  return Math.sqrt(2 * decel * Math.max(0, dist));
}

export class StopLogic {
  phase: StopPhase = 'approaching';
  waited = 0;
  private readonly decision: StopDecision = { maxSpeed: Infinity, phase: 'approaching' };

  /** Starts over for the next stop line. */
  reset(): void {
    this.phase = 'approaching';
    this.waited = 0;
  }

  /**
   * Advances the state machine.
   * @param dist distance from the car's front to the stop line (units; may be negative once past)
   * @param speed current forward speed (units/s)
   * @param dt step (seconds)
   * @param junctionClear true when no other car occupies or approaches the junction
   * @param decel comfortable deceleration (units/s²)
   * @param brakingZone distance at which to start braking (units)
   */
  update(
    dist: number,
    speed: number,
    dt: number,
    junctionClear: boolean,
    decel: number,
    brakingZone: number,
  ): StopDecision {
    const d = this.decision;
    switch (this.phase) {
      case 'approaching':
        if (dist <= brakingZone) this.phase = 'braking';
        break;
      case 'braking':
        if (dist <= STOP_LINE_TOLERANCE && Math.abs(speed) <= STOPPED_SPEED) {
          this.phase = 'stopped';
          this.waited = 0;
        } else if (dist < -STOP_LINE_TOLERANCE) {
          // overshot without stopping (should not happen for route cars): treat as done
          this.phase = 'clear';
        }
        break;
      case 'stopped':
        this.waited += dt;
        if (this.waited >= STOP_WAIT && junctionClear) this.phase = 'clear';
        break;
      case 'clear':
        break;
    }
    d.phase = this.phase;
    if (this.phase === 'braking')
      d.maxSpeed = Math.max(0, stoppingSpeed(dist - STOP_LINE_TOLERANCE * 0.4, decel));
    else if (this.phase === 'stopped') d.maxSpeed = 0;
    else d.maxSpeed = Infinity;
    return d;
  }
}
