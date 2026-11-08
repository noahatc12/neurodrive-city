/**
 * Main loop: one requestAnimationFrame callback running a fixed-timestep simulation
 * with an accumulator, plus interpolated rendering.
 *
 * ```
 *   frame time ──▶ accumulator ──▶ n fixed steps of dt (n ≤ 5)  ──▶ render(alpha)
 *                                   × speed multiplier
 *   alpha = leftover / dt   (how far we are between the last two sim states)
 * ```
 *
 * - `dt` never changes; the speed multiplier (×1/×2/×4/×8) changes how many steps run
 *   per frame. This keeps physics deterministic and frame-rate independent.
 * - At most 5 real-time steps per frame: after a long stall the excess time is dropped
 *   instead of trying to catch up forever (the "spiral of death").
 * - Stops while the tab is hidden and resumes without a time jump.
 *
 * @module app/loop
 */

export interface FrameInfo {
  /** Real milliseconds since the previous frame (clamped). */
  dtMs: number;
  /** Monotonic app time in milliseconds (excludes hidden time). */
  timeMs: number;
  /** Interpolation factor between the previous and current sim state. */
  alpha: number;
  /** Simulation steps executed this frame. */
  steps: number;
  /** Milliseconds spent in simulation steps this frame. */
  simCostMs: number;
}

export interface LoopCallbacks {
  /** One fixed simulation step of `dt` seconds. */
  step(dt: number): void;
  /** Called once per animation frame after the steps. */
  frame(info: FrameInfo): void;
}

export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 5;

export class MainLoop {
  readonly dt = FIXED_DT;
  /** Steps per real-time step (1, 2, 4, 8). */
  speed = 1;
  /** When true the simulation does not step (rendering continues). */
  paused = true;
  private readonly cb: LoopCallbacks;
  private accumulator = 0;
  private last = -1;
  private appTime = 0;
  private rafId = 0;
  private running = false;
  /** Reused every frame (no per-frame allocation). */
  private readonly info: FrameInfo = { dtMs: 0, timeMs: 0, alpha: 0, steps: 0, simCostMs: 0 };
  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.cancel();
    } else if (this.running) {
      this.last = -1;
      this.schedule();
    }
  };

  constructor(callbacks: LoopCallbacks) {
    this.cb = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancel();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Runs exactly `n` steps immediately (used by tests and "step" buttons). */
  stepNow(n = 1): void {
    for (let i = 0; i < n; i++) this.cb.step(this.dt);
  }

  /**
   * Advances the loop by `elapsedMs` of real time. Exposed so tests can drive the loop
   * deterministically; the rAF callback calls it with the measured frame time.
   */
  advance(elapsedMs: number): FrameInfo {
    const dtMs = Math.min(Math.max(elapsedMs, 0), 250);
    this.appTime += dtMs;
    let steps = 0;
    let simCostMs = 0;
    if (!this.paused) {
      this.accumulator += dtMs / 1000;
      let real = Math.floor(this.accumulator / this.dt);
      if (real > MAX_SUBSTEPS) {
        real = MAX_SUBSTEPS;
        this.accumulator = this.dt * MAX_SUBSTEPS; // drop excess time
      }
      this.accumulator -= real * this.dt;
      const t0 = performance.now();
      const n = real * this.speed;
      for (let i = 0; i < n; i++) this.cb.step(this.dt);
      simCostMs = performance.now() - t0;
      steps = n;
    } else {
      this.accumulator = 0;
    }
    const info = this.info;
    info.dtMs = dtMs;
    info.timeMs = this.appTime;
    info.alpha = this.paused ? 1 : this.accumulator / this.dt;
    info.steps = steps;
    info.simCostMs = simCostMs;
    this.cb.frame(info);
    return info;
  }

  private schedule(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private cancel(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly tick = (now: number): void => {
    this.rafId = 0;
    if (!this.running) return;
    const elapsed = this.last < 0 ? 1000 / 60 : now - this.last;
    this.last = now;
    this.advance(elapsed);
    this.schedule();
  };
}
