import { describe, expect, it } from 'vitest';
import { CameraRig, TWEEN_MS, type CameraFocus } from '../../src/render3d/cameraRig.ts';

/** Just enough of an element for OrbitControls to attach its listeners in Node. */
function fakeElement(): HTMLElement {
  const noop = (): void => {};
  return {
    addEventListener: noop,
    removeEventListener: noop,
    style: {},
    ownerDocument: { addEventListener: noop, removeEventListener: noop },
  } as unknown as HTMLElement;
}

function focusAt(x: number, y: number, angle = 0, speed = 0): CameraFocus {
  return { x, y, angle, speed, maxSpeed: 180 };
}

function pos(rig: CameraRig): [number, number, number] {
  const p = rig.camera.position;
  return [p.x, p.y, p.z];
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}

describe('render3d/camera rig', () => {
  it('blends between modes without a hard cut (camera sampled every frame)', () => {
    const rig = new CameraRig(fakeElement(), 16 / 9);
    const car = focusAt(300, -200);
    rig.setMode('chase');
    for (let i = 0; i < 180; i++) rig.update(1 / 60, car, null, 0); // settle behind the car
    const start = pos(rig);
    rig.setMode('top');
    expect(rig.tweening).toBe(true);
    const samples: [number, number, number][] = [start];
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, car, null, 0);
      samples.push(pos(rig));
    }
    const end = samples[samples.length - 1] ?? start;
    const total = dist(start, end);
    expect(total).toBeGreaterThan(1000); // chase (y≈70) to top (y≈1700)
    const steps = samples.slice(1).map((p, i) => dist(p, samples[i] ?? p));
    // continuous: a 750 ms blend spans 45 frames, so the average frame moves 1/45 of the
    // path and easeInOutCubic peaks at 3× the average (its slope at t = 0.5). A hard cut
    // would move the whole path in one frame; allow at most 4× the average.
    const avgStep = total / ((TWEEN_MS / 1000) * 60);
    expect(Math.max(...steps)).toBeLessThan(avgStep * 4);
    // eased: the first and last frames of the blend move far less than the middle
    expect(steps[0] ?? 1).toBeLessThan((steps[22] ?? 0) * 0.2);
    // the blend finishes within the tween time plus a few frames and lands on the top pose
    expect(rig.tweening).toBe(false);
    expect(end[1]).toBeGreaterThan(1600);
    expect(Math.abs(end[0] - car.x)).toBeLessThan(5);
    rig.dispose();
  });

  it('chase damping is frame-rate independent (1 − e^(−k·dt))', () => {
    const run = (dt: number): [number, number, number] => {
      const rig = new CameraRig(fakeElement(), 16 / 9);
      rig.setMode('chase');
      const car = focusAt(0, 0, 0, 150);
      // drive up the screen (−y) at 150 units/s for 3 s
      for (let t = 0; t < 3 - 1e-9; t += dt) {
        car.y -= 150 * dt;
        rig.update(dt, car, null, 0);
      }
      const p = pos(rig);
      rig.dispose();
      return p;
    };
    const a = run(1 / 60);
    const b = run(1 / 30);
    const c = run(1 / 120);
    expect(dist(a, b)).toBeLessThan(12);
    expect(dist(a, c)).toBeLessThan(8);
    // and it trails behind the car (car at y = −450 heading −y: camera at larger y)
    expect(a[2]).toBeGreaterThan(-450 + 60);
  });

  it('kicks the field of view with speed, and less so with reduced motion', () => {
    const settle = (speed: number, reduced: boolean): number => {
      const rig = new CameraRig(fakeElement(), 16 / 9);
      rig.reducedMotion = reduced;
      rig.setMode('chase');
      for (let i = 0; i < 400; i++) rig.update(1 / 60, focusAt(0, 0, 0, speed), null, 0);
      const fov = rig.camera.fov;
      rig.dispose();
      return fov;
    };
    expect(settle(0, false)).toBeCloseTo(55, 0);
    expect(settle(180, false)).toBeGreaterThan(62);
    expect(settle(180, true)).toBeCloseTo(55, 0);
  });

  it('reduced motion shortens mode blends to a third', () => {
    const rig = new CameraRig(fakeElement(), 1);
    rig.reducedMotion = true;
    rig.setMode('top');
    let frames = 0;
    while (rig.tweening && frames < 200) {
      rig.update(1 / 60, focusAt(0, 0), null, 0);
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(Math.ceil((TWEEN_MS / 3 / 1000) * 60) + 1);
    rig.dispose();
  });

  it('cinematic mode glides between candidate cars', () => {
    const rig = new CameraRig(fakeElement(), 1);
    rig.setMode('cinematic');
    const cine = new Float64Array([0, 0, 2000, 0]);
    let prev = pos(rig);
    let maxStep = 0;
    for (let i = 0; i < 60 * 12; i++) {
      rig.update(1 / 60, null, cine, 2);
      const p = pos(rig);
      if (i > 60) maxStep = Math.max(maxStep, dist(p, prev));
      prev = p;
    }
    // after ~8 s it switches to the second car, gliding (never jumping) there
    expect(rig.look.x).toBeGreaterThan(300);
    expect(maxStep).toBeLessThan(40);
    rig.dispose();
  });
});
