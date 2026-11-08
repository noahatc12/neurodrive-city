import { describe, expect, it } from 'vitest';
import { EASINGS, easeInOutCubic } from '../../src/anim/easing.ts';
import { SmoothDamp, Spring, damp, dampFactor } from '../../src/anim/springs.ts';
import { TweenManager } from '../../src/anim/tween.ts';
import { MainLoop } from '../../src/app/loop.ts';

describe('anim/easing', () => {
  it('every easing starts at 0 and ends at 1', () => {
    for (const [name, f] of Object.entries(EASINGS)) {
      expect(f(0), name).toBeCloseTo(0, 6);
      expect(f(1), name).toBeCloseTo(1, 6);
    }
  });

  it('in-out easings are symmetric around the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
  });

  it('back easing overshoots', () => {
    expect(Math.min(...[0.1, 0.2, 0.3].map((t) => EASINGS.easeInBack(t)))).toBeLessThan(0);
    expect(Math.max(...[0.7, 0.8, 0.9].map((t) => EASINGS.easeOutBack(t)))).toBeGreaterThan(1);
  });
});

describe('anim/tween', () => {
  it('advances with the loop clock, then chains', () => {
    const tw = new TweenManager();
    const values: number[] = [];
    let done = 0;
    tw.add({
      from: 0,
      to: 10,
      duration: 100,
      onUpdate: (v) => values.push(v),
      onComplete: () => done++,
    }).then({
      from: 10,
      to: 0,
      duration: 50,
      onComplete: () => done++,
    });
    tw.update(50);
    expect(values.at(-1)).toBeCloseTo(5);
    tw.update(50);
    expect(done).toBe(1);
    expect(tw.size).toBe(1);
    tw.update(60);
    expect(done).toBe(2);
    expect(tw.size).toBe(0);
  });

  it('respects delay and cancellation', () => {
    const tw = new TweenManager();
    let completed = false;
    const t = tw.add({
      from: 0,
      to: 1,
      duration: 10,
      delay: 20,
      onComplete: () => (completed = true),
    });
    tw.update(15);
    expect(t.value).toBe(0);
    t.cancel();
    tw.update(100);
    expect(completed).toBe(false);
    expect(t.cancelled).toBe(true);
    tw.add({ from: 0, to: 1, duration: 0 });
    tw.cancelAll();
    expect(tw.size).toBe(0);
  });
});

describe('anim/springs', () => {
  it('damp is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 30; i++) a = damp(a, 1, 5, 1 / 30);
    let b = 0;
    for (let i = 0; i < 144; i++) b = damp(b, 1, 5, 1 / 144);
    expect(a).toBeCloseTo(b, 6);
    expect(dampFactor(5, 1)).toBeCloseTo(1 - Math.exp(-5));
  });

  it('SmoothDamp converges without overshoot', () => {
    const s = new SmoothDamp(0, 0.2);
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, s.update(10, 1 / 60));
    expect(s.value).toBeCloseTo(10, 2);
    expect(max).toBeLessThanOrEqual(10 + 1e-6);
    s.reset(3);
    expect(s.velocity).toBe(0);
  });

  it('Spring pops past the target and settles', () => {
    const s = new Spring(0);
    s.target = 1;
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, s.update(1 / 60));
    expect(max).toBeGreaterThan(1);
    expect(s.settled).toBe(true);
    s.impulse(5);
    expect(s.settled).toBe(false);
  });
});

describe('app/loop (fixed timestep)', () => {
  it('runs fixed steps from the accumulator and interpolates with alpha', () => {
    let steps = 0;
    const loop = new MainLoop({ step: () => steps++, frame: () => {} });
    loop.paused = false;
    const f = loop.advance(25); // 1.5 steps of 16.67 ms
    expect(f.steps).toBe(1);
    expect(f.alpha).toBeCloseTo(0.5, 1);
    loop.advance(25);
    expect(steps).toBe(3);
  });

  it('caps sub-steps at 5 per frame (no spiral of death) and scales with speed', () => {
    let steps = 0;
    const loop = new MainLoop({ step: () => steps++, frame: () => {} });
    loop.paused = false;
    loop.advance(250);
    expect(steps).toBe(5);
    steps = 0;
    loop.speed = 8;
    loop.advance(1000 / 60 + 0.01);
    expect(steps).toBeGreaterThanOrEqual(8);
    expect(steps % 8).toBe(0);
  });

  it('does not step while paused, but still renders', () => {
    let steps = 0;
    let frames = 0;
    const loop = new MainLoop({ step: () => steps++, frame: () => frames++ });
    loop.advance(100);
    expect(steps).toBe(0);
    expect(frames).toBe(1);
    loop.stepNow(3);
    expect(steps).toBe(3);
  });
});
