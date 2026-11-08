/**
 * Car creation helpers and colour palette indexes shared with the renderers.
 * @module engine/car/carFactory
 */
import { Car, DEFAULT_CAR, type CarKind } from './car.ts';
import type { ControlSource } from './controls.ts';

/** Body colours by palette index (renderers map these to sprites/materials). */
export const CAR_COLORS = [
  '#22d3ee', // 0 population (cyan)
  '#fbbf24', // 1 traffic amber
  '#f472b6', // 2 traffic magenta
  '#a3e635', // 3 best car (lime)
  '#e6edf7', // 4 manual (white)
  '#60a5fa', // 5 traffic blue
  '#fb7185', // 6 traffic coral
  '#c084fc', // 7 traffic violet
] as const;

export const COLOR_POPULATION = 0;
export const COLOR_BEST = 3;
export const COLOR_MANUAL = 4;
export const TRAFFIC_COLORS = [1, 2, 5, 6, 7] as const;

/** Creates a car of a kind with its default control source and colour. */
export function createCar(id: number, kind: CarKind, source?: ControlSource): Car {
  const src: ControlSource =
    source ?? (kind === 'traffic' ? 'route' : kind === 'manual' ? 'keys' : 'ai');
  const car = new Car(id, kind, src, DEFAULT_CAR);
  car.color =
    kind === 'manual'
      ? COLOR_MANUAL
      : kind === 'traffic'
        ? (TRAFFIC_COLORS[id % TRAFFIC_COLORS.length] ?? 1)
        : COLOR_POPULATION;
  return car;
}
