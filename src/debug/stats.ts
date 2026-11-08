/**
 * Frame statistics: fps, frame time, simulation time, draw calls. Rolling averages over
 * a fixed ring buffer (no allocation per frame).
 * @module debug/stats
 */

const N = 120;

export class Stats {
  private readonly frameMs = new Float64Array(N);
  private readonly simMs = new Float64Array(N);
  private i = 0;
  private count = 0;
  drawCalls = 0;
  triangles = 0;
  stepsLastFrame = 0;
  /** Exposed for e2e: rolling average frame interval in ms. */
  avgFrameMs = 0;
  avgSimMs = 0;
  fps = 0;

  /** Records one frame's interval and simulation cost. */
  record(frameIntervalMs: number, simCostMs: number): void {
    this.frameMs[this.i] = frameIntervalMs;
    this.simMs[this.i] = simCostMs;
    this.i = (this.i + 1) % N;
    if (this.count < N) this.count++;
    let f = 0;
    let s = 0;
    for (let k = 0; k < this.count; k++) {
      f += this.frameMs[k] ?? 0;
      s += this.simMs[k] ?? 0;
    }
    this.avgFrameMs = f / this.count;
    this.avgSimMs = s / this.count;
    this.fps = this.avgFrameMs > 0 ? 1000 / this.avgFrameMs : 0;
  }

  /** Average over the most recent `frames` samples (for auto quality downgrade). */
  recentAverage(frames: number): number {
    const n = Math.min(frames, this.count);
    if (n === 0) return 0;
    let f = 0;
    for (let k = 1; k <= n; k++) f += this.frameMs[(this.i - k + N) % N] ?? 0;
    return f / n;
  }

  reset(): void {
    this.count = 0;
    this.i = 0;
    this.avgFrameMs = 0;
    this.avgSimMs = 0;
    this.fps = 0;
  }
}
