import { describe, expect, it } from 'vitest';
import { QUALITY_ORDER, QUALITY_PRESETS, QualityGovernor } from '../../src/render3d/postfx.ts';
import { formatClock } from '../../src/ui/panels/settingsPanel.ts';

describe('render3d/quality governor', () => {
  it('asks for a downgrade only after 3 s of frames averaging over 20 ms', () => {
    const g = new QualityGovernor(20, 3);
    let asked = -1;
    for (let i = 0; i < 400 && asked < 0; i++) if (g.sample(33)) asked = i;
    // the average needs a few frames to rise past 20 ms, then 3 s of 33 ms frames
    expect(asked).toBeGreaterThan(85);
    expect(asked).toBeLessThan(110);
  });

  it('never asks while frames are fast, or when disabled', () => {
    const fast = new QualityGovernor();
    for (let i = 0; i < 2000; i++) expect(fast.sample(12)).toBe(false);
    const off = new QualityGovernor();
    off.enabled = false;
    for (let i = 0; i < 2000; i++) expect(off.sample(60)).toBe(false);
  });

  it('a short hitch does not trigger it', () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 300; i++) {
      const slow = i % 100 < 20; // 20 slow frames out of every 100
      expect(g.sample(slow ? 45 : 10)).toBe(false);
    }
  });

  it('presets step down from high to low with fewer pixels, shadows and bloom', () => {
    expect(QUALITY_ORDER).toEqual(['low', 'medium', 'high']);
    expect(QUALITY_PRESETS.high.shadowMap).toBe(2048);
    expect(QUALITY_PRESETS.medium.shadowMap).toBe(1024);
    expect(QUALITY_PRESETS.low.shadowMap).toBe(0);
    expect(QUALITY_PRESETS.low.bloom).toBe(false);
    expect(QUALITY_PRESETS.low.pixelRatio).toBeLessThan(QUALITY_PRESETS.high.pixelRatio);
  });

  it('formats the time of day as a 24-hour clock', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(0.5)).toBe('12:00');
    expect(formatClock(0.75)).toBe('18:00');
    expect(formatClock(1.25)).toBe('06:00');
  });
});
