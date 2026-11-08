/**
 * Tweens driven by the main loop clock (not by their own timers), so they pause with
 * the app, respect simulation time where needed and stay deterministic in tests.
 *
 * ```ts
 * const tweens = new TweenManager();
 * tweens.add({ from: 0, to: 1, duration: 300, ease: easeOutCubic, onUpdate: (v) => ... })
 *   .then({ from: 1, to: 0, duration: 200 });   // chained
 * tweens.update(dtMs);                           // once per frame
 * ```
 *
 * @module anim/tween
 */
import { linear, type Easing } from './easing.ts';

export interface TweenOptions {
  from: number;
  to: number;
  /** Duration in milliseconds (0 completes on the next update). */
  duration: number;
  ease?: Easing;
  /** Delay before starting, in milliseconds. */
  delay?: number;
  onUpdate?: (value: number, progress: number) => void;
  onComplete?: () => void;
}

export class Tween {
  private elapsed = 0;
  private _done = false;
  private _cancelled = false;
  private next: Tween | null = null;
  private readonly manager: TweenManager;
  readonly options: Readonly<TweenOptions>;
  /** Current eased value. */
  value: number;

  constructor(manager: TweenManager, options: TweenOptions) {
    this.manager = manager;
    this.options = options;
    this.value = options.from;
  }

  get done(): boolean {
    return this._done;
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  /** Advances by `dtMs`; returns true while still running. */
  step(dtMs: number): boolean {
    if (this._done) return false;
    this.elapsed += dtMs;
    const { delay = 0, duration, from, to, ease = linear } = this.options;
    const local = this.elapsed - delay;
    if (local < 0) return true;
    const p = duration <= 0 ? 1 : Math.min(1, local / duration);
    this.value = from + (to - from) * ease(p);
    this.options.onUpdate?.(this.value, p);
    if (p >= 1) {
      this._done = true;
      this.options.onComplete?.();
      if (this.next && !this._cancelled) this.manager.start(this.next);
      return false;
    }
    return true;
  }

  /** Stops the tween (and its chain) without calling onComplete. */
  cancel(): void {
    this._cancelled = true;
    this._done = true;
    this.next?.cancel();
  }

  /** Queues another tween to start when this one completes; returns the new tween. */
  then(options: TweenOptions): Tween {
    const t = new Tween(this.manager, options);
    this.next = t;
    return t;
  }
}

export class TweenManager {
  private readonly active: Tween[] = [];

  /** Creates and starts a tween. */
  add(options: TweenOptions): Tween {
    const t = new Tween(this, options);
    this.start(t);
    return t;
  }

  /** @internal starts an already-constructed tween (used by chaining). */
  start(t: Tween): void {
    this.active.push(t);
  }

  /** Advances all tweens by `dtMs` and drops finished ones. */
  update(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i] as Tween;
      if (t.cancelled || !t.step(dtMs)) this.active.splice(i, 1);
    }
  }

  /** Cancels everything. */
  cancelAll(): void {
    for (const t of this.active) t.cancel();
    this.active.length = 0;
  }

  get size(): number {
    return this.active.length;
  }
}
