/**
 * AI navigation experiment (spec F5): trains in Grid Town with and without the two route
 * inputs (signed angle to the next waypoint, normalised speed) and reports how far along
 * the Start → Target lane route the best car gets.
 *   node scripts/train-nav.ts [--generations 40] [--cars 200] [--seed 3] [--activation step|tanh]
 *
 * Fitness is progress along the route (arrival counts the route length again), so a car
 * that reaches the target scores more than the route length.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RouteProgress } from '../src/engine/ai/fitness.ts';
import { cityTrainer } from '../src/engine/ai/trainer.ts';
import { parseWorld } from '../src/engine/io/serialize.ts';
import { WorldGeometry, generateWorld, worldInputFrom } from '../src/engine/world/world.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const generations = arg('generations', 40);
const cars = arg('cars', 200);
const seed = arg('seed', 3);
const ai = process.argv.indexOf('--activation');
const activation = ai >= 0 && process.argv[ai + 1] === 'tanh' ? 'tanh' : 'step';

const file: unknown = JSON.parse(
  readFileSync(join(here, '..', 'public', 'worlds', 'grid-town.world.json'), 'utf8'),
);

for (const nav of [false, true]) {
  const res = parseWorld(file);
  if (!res.ok) throw new Error(res.errors.join('\n'));
  const model = res.value.model;
  const geo = new WorldGeometry(generateWorld(worldInputFrom(model)));
  const t0 = performance.now();
  const trainer = cityTrainer(model, geo, {
    population: cars,
    mutation: 0.15,
    selection: 'tournament',
    timeLimit: 40,
    stuckTimeout: 5,
    navInputs: nav,
    activation,
    seed,
  });
  const pop = trainer.population;
  const tracker = (pop as unknown as { tracker: unknown }).tracker;
  const routeLen = tracker instanceof RouteProgress ? tracker.sEnd - tracker.sStart : NaN;
  const marks: string[] = [];
  for (let g = 0; g < generations; g++) {
    const rec = trainer.runGeneration();
    if (!rec) break;
    if ((g + 1) % 10 === 0) marks.push(`g${g + 1}: ${rec.best.toFixed(0)}`);
  }
  const best = pop.bestEverFitness;
  const pct = Number.isFinite(routeLen) ? Math.min(200, (best / routeLen) * 100) : NaN;
  console.log(
    `${activation} ${nav ? 'with route inputs' : 'sensors only     '}  route ${routeLen.toFixed(0)} units  best ${best.toFixed(0)} (${pct.toFixed(0)}% of the route${best > routeLen ? ', reached the target' : ''})  [${marks.join(', ')}]  ${((performance.now() - t0) / 1000).toFixed(0)} s`,
  );
}
