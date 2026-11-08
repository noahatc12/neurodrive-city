/**
 * Trains the bundled brain with the app's own headless trainer (spec G6):
 *   node scripts/train.ts [--generations 120] [--cars 400] [--seed 7] [--selection tournament]
 *                         [--mutation 0.25] [--out public/brains/pretrained.brain.json]
 *
 * World: the 3-lane infinite road with traffic (seed 2026), the classic course setup.
 * Fitness is distance travelled up the road; the elite is the best brain ever seen; the
 * second half fine-tunes with smaller mutations.
 *
 * Every 10 generations the current elite is validated alone on the road for 60 s
 * (distance, overtakes, damage). The brain written out is the elite with the best
 * validation (no damage first, then overtakes, then distance), so the shipped brain is
 * chosen on driving behaviour rather than on a single lucky generation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { infiniteTrainer, PRETRAINED_ROAD, TRAIN_DT } from '../src/engine/ai/trainer.ts';
import type { NeuralNetwork } from '../src/engine/ai/network.ts';
import type { Selection } from '../src/engine/ai/evolution.ts';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}
function argText(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const generations = arg('generations', 120);
const cars = arg('cars', 400);
const seed = arg('seed', 7);
const mutation = arg('mutation', 0.25);
const selection = argText('selection', 'tournament') as Selection;
const out = resolve(argText('out', join(here, '..', 'public', 'brains', 'pretrained.brain.json')));

export interface Validation {
  metres: number;
  overtakes: number;
  damaged: boolean;
  seconds: number;
}

/** Drives one exact copy of `net` alone on the training road for 60 s. */
function validate(net: NeuralNetwork): Validation {
  const t = infiniteTrainer(
    { population: 1, mutation: 0, timeLimit: 120, stuckTimeout: 30, seed: 1 },
    PRETRAINED_ROAD,
    net,
  );
  const car = t.population.cars[0];
  if (!car) return { metres: 0, overtakes: 0, damaged: true, seconds: 0 };
  const y0 = car.y;
  const ahead = new Map<number, boolean>();
  let overtakes = 0;
  let i = 0;
  for (; i < 60 / TRAIN_DT && !car.damaged; i++) {
    t.host.step(TRAIN_DT);
    for (const c of t.host.cars) {
      if (c.kind !== 'traffic') continue;
      const now = c.y < car.y;
      if (ahead.get(c.id) === true && !now && c.y - car.y < 120) overtakes++;
      ahead.set(c.id, now);
    }
  }
  return { metres: (y0 - car.y) / 10, overtakes, damaged: car.damaged, seconds: i * TRAIN_DT };
}

function better(a: Validation, b: Validation | null): boolean {
  if (!b) return true;
  if (a.damaged !== b.damaged) return !a.damaged;
  if (a.damaged) return a.seconds > b.seconds;
  if (a.overtakes !== b.overtakes) return a.overtakes > b.overtakes;
  return a.metres > b.metres;
}

const t0 = performance.now();
const trainer = infiniteTrainer(
  { population: cars, mutation, selection, timeLimit: 60, stuckTimeout: 5, seed },
  PRETRAINED_ROAD,
);
const pop = trainer.population;
let chosen: { net: NeuralNetwork; v: Validation; generation: number; fitness: number } | null =
  null;
for (let g = 0; g < generations; g++) {
  if (g === Math.floor(generations / 2)) pop.setMutation(mutation * 0.4);
  const rec = trainer.runGeneration();
  if (!rec) break;
  let note = '';
  if ((g + 1) % 10 === 0 || g === generations - 1) {
    const v = validate(pop.bestEver);
    note = `  validate: ${v.metres.toFixed(0)} m, ${v.overtakes} overtakes, ${v.damaged ? `crashed at ${v.seconds.toFixed(1)} s` : 'no damage'}`;
    if (better(v, chosen?.v ?? null))
      chosen = {
        net: pop.bestEver.clone(),
        v,
        generation: pop.generation,
        fitness: pop.bestEverFitness,
      };
  }
  console.log(
    `gen ${String(rec.generation).padStart(3)}  best ${rec.best.toFixed(0).padStart(6)}  avg ${rec.average.toFixed(0).padStart(6)}  bestEver ${pop.bestEverFitness.toFixed(0)}${note}`,
  );
}
if (!chosen) throw new Error('no generation completed');
// write the chosen elite with its own training numbers
pop.bestEver.copyFrom(chosen.net);
pop.bestEverFitness = chosen.fitness;
const file = trainer.brainFile('infinite-road', '2026-11-07T00:00:00.000Z');
file.training.generations = chosen.generation;
// the mutation amount in force when the chosen elite was bred
file.training.mutation =
  chosen.generation <= Math.floor(generations / 2) ? mutation : mutation * 0.4;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(file)}\n`);
const secs = (performance.now() - t0) / 1000;
console.log(
  `wrote ${out}: elite of generation ${chosen.generation} (best fitness ${file.training.bestFitness} units); validation ${chosen.v.metres.toFixed(0)} m, ${chosen.v.overtakes} overtakes, ${chosen.v.damaged ? 'crashed' : 'no damage'}; ${trainer.steps} steps in ${secs.toFixed(1)} s`,
);
