/**
 * Easing functions mapping t ∈ [0, 1] to progress (0 at t=0, 1 at t=1).
 * "In" accelerates, "Out" decelerates, "InOut" does both.
 * @module anim/easing
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeInQuad: Easing = (t) => t * t;
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad: Easing = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export const easeInCubic: Easing = (t) => t * t * t;
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const easeInQuart: Easing = (t) => t ** 4;
export const easeOutQuart: Easing = (t) => 1 - (1 - t) ** 4;
export const easeInOutQuart: Easing = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);

export const easeInExpo: Easing = (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10));
export const easeOutExpo: Easing = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeInOutExpo: Easing = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;

/** Overshoot amount for the "back" family. */
const BACK = 1.70158;
export const easeInBack: Easing = (t) => (BACK + 1) * t ** 3 - BACK * t * t;
export const easeOutBack: Easing = (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2;
export const easeInOutBack: Easing = (t) => {
  const c = BACK * 1.525;
  return t < 0.5
    ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2
    : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
};

const ELASTIC = (2 * Math.PI) / 3;
const ELASTIC_IO = (2 * Math.PI) / 4.5;
export const easeInElastic: Easing = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ELASTIC);
export const easeOutElastic: Easing = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC) + 1;
export const easeInOutElastic: Easing = (t) =>
  t <= 0
    ? 0
    : t >= 1
      ? 1
      : t < 0.5
        ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_IO)) / 2
        : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_IO)) / 2 + 1;

/** Lookup by name (used by settings and tests). */
export const EASINGS = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,
} as const satisfies Record<string, Easing>;

export type EasingName = keyof typeof EASINGS;
