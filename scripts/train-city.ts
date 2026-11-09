/**
 * Trains the bundled city brain (AI navigation, F5) in Grid Town with the app's own
 * headless trainer:
 *   node scripts/train-city.ts [--generations 600] [--cars 300] [--seed 1] [--mutation 0.12]
 *                              [--selection tournament|course] [--cycle 0.03,0.06,0.12,0.24]
 *                              [--every 5] [--until 3] [--vary-traffic] [--stuck 5] [--time 60]
 *                              [--broad 20] [--broad-until 0]
 *                              [--out public/brains/city.brain.json]
 *
 * Setup: the city training defaults (`CITY_EVOLUTION`: 7 rays over 5π/6, the five route
 * inputs and the light input, tanh [13, 8, 4], tournament selection with crossover and
 * three elites), the route curriculum, seeded spawn jitter and 14 traffic cars, as Train
 * mode uses them.
 * Fitness is lane-credited progress along the Start → Target route. `--vary-traffic` gives
 * every generation its own traffic seed (1000 + generation; the validation seeds are
 * never used), so brains cannot learn one traffic pattern by heart. `--cycle` replaces the
 * fixed mutation with a repeating per-generation schedule (with course selection the elite
 * is never lost, so coarse generations explore while fine ones refine).
 *
 * Once the curriculum covers the whole route, the best brain is validated every
 * `--every` generations (and whenever a car reached the target): one exact copy drives
 * alone for each of five validation seeds (traffic seed and spawn jitter). A drive passes
 * when it reaches the target with no crash, no lane violation and at least 95% of its
 * time in lane (and, for a brain with the light input, no red light run). A brain that
 * passes at least 3 of the 5 also drives `--broad` unseen traffic seeds (`broadCityCheck`),
 * and candidates are ranked by that broad check first. Training stops once the best brain
 * passes `--until` of the 5 drives and `--broad-until` of the broad ones, and the best brain
 * validated so far is written out. If none
 * does within the generation budget, the best brain seen (most passes, then mean in-lane
 * fraction, then route covered) is written with its real numbers, and the run says so.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputNames, parseBrain, serializeBrain } from '../src/engine/ai/brainSchema.ts';
import { cityEvolution, routeInputNames, type Selection } from '../src/engine/ai/evolution.ts';
import type { NeuralNetwork } from '../src/engine/ai/network.ts';
import {
  broadCityCheck,
  cityDrivePassed,
  cityTrainer,
  validateCityBrain,
  type BroadCheck,
  type CityValidation,
} from '../src/engine/ai/trainer.ts';
import { parseWorld } from '../src/engine/io/serialize.ts';
import { Simulation } from '../src/engine/sim/simulation.ts';
import { WorldGeometry, generateWorld, worldInputFrom } from '../src/engine/world/world.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const argText = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

const generations = arg('generations', 600);
const cars = arg('cars', 300);
const seed = arg('seed', 1);
const mutation = arg('mutation', cityEvolution().mutation ?? 0.12);
const selection: Selection =
  argText('selection', 'tournament') === 'course' ? 'course' : 'tournament';
const cycle = argText('cycle', '')
  .split(',')
  .filter((t) => t.trim() !== '')
  .map(Number)
  .filter((v) => Number.isFinite(v) && v >= 0 && v <= 1);
const varyTraffic = process.argv.includes('--vary-traffic');
/** Seconds without progress before a training car is eliminated, and the generation length. */
const stuck = arg('stuck', cityEvolution().stuckTimeout ?? 5);
const timeLimit = arg('time', cityEvolution().timeLimit ?? 60);
/** Validation passes (of 5) that end the run early; the best brain seen is kept. */
const until = Math.max(3, Math.min(5, arg('until', 3)));
/** Drives in the broad check, and how many must pass to stop early (0: no requirement). */
const broadDrives = Math.max(1, arg('broad', 20));
const broadUntil = Math.max(0, arg('broad-until', 0));
const every = Math.max(1, arg('every', 5));
const out = resolve(argText('out', join(here, '..', 'public', 'brains', 'city.brain.json')));

const res = parseWorld(
  JSON.parse(readFileSync(join(here, '..', 'public', 'worlds', 'grid-town.world.json'), 'utf8')),
);
if (!res.ok) throw new Error(res.errors.join('\n'));
const model = res.value.model;
const geo = new WorldGeometry(generateWorld(worldInputFrom(model)));

/** Validation drives: the world's own traffic seed (what Simulate shows) and four others. */
const VALIDATION = [
  { traffic: model.seed, jitter: 0 },
  { traffic: 101, jitter: 11 },
  { traffic: 202, jitter: 22 },
  { traffic: 303, jitter: 33 },
  { traffic: 404, jitter: 44 },
] as const;

interface Candidate {
  net: NeuralNetwork;
  generation: number;
  fitness: number;
  drives: CityValidation[];
  passes: number;
  /** The broad check, for candidates that passed at least 3 of the 5 drives. */
  broad: BroadCheck | null;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function better(a: Candidate, b: Candidate | null): boolean {
  if (!b) return true;
  const pa = a.broad?.passes ?? -1;
  const pb = b.broad?.passes ?? -1;
  if (pa !== pb) return pa > pb;
  if (a.passes !== b.passes) return a.passes > b.passes;
  const ia = mean(a.drives.map((d) => d.inLane));
  const ib = mean(b.drives.map((d) => d.inLane));
  const ra = mean(a.drives.map((d) => d.routeShare));
  const rb = mean(b.drives.map((d) => d.routeShare));
  if (Math.abs(ra - rb) > 0.02) return ra > rb;
  return ia > ib;
}

const fmt = (d: CityValidation): string =>
  `${d.arrived ? 'arrived' : d.crashed ? 'crashed' : d.laneViolation ? 'violation' : d.redLight ? 'ran a red light' : 'stopped'} ${(d.routeShare * 100).toFixed(0)}% route, ${(d.inLane * 100).toFixed(1)}% in lane, ${d.seconds.toFixed(1)} s`;

const t0 = performance.now();
const trainer = cityTrainer(
  model,
  geo,
  cityEvolution({ population: cars, seed, mutation, selection, stuckTimeout: stuck, timeLimit }),
);
console.log(
  `Grid Town: route ${trainer.population.routeLength.toFixed(0)} units, ${cars} cars, seed ${seed}, mutation ${cycle.length > 0 ? `cycle ${cycle.join('/')}` : mutation}, ${selection} selection, stuck ${stuck} s, generations of ${timeLimit} s${varyTraffic ? ', new traffic every generation' : ''}`,
);
const pop = trainer.population;
const routeLength = pop.routeLength;
let chosen: Candidate | null = null;
let bestStage = 1;
let bestShare = 0;

/**
 * The network exactly as a brain file stores it (weights rounded to 6 decimals). Driving is
 * chaotic enough that the rounding changes some runs, so every check uses this copy and the
 * numbers recorded describe the shipped file.
 */
function asShipped(net: NeuralNetwork): NeuralNetwork {
  const names = inputNames(pop.sensors[0]?.rayCount ?? 7, routeInputNames(pop.config.lightInput));
  const file = serializeBrain(net, names, {
    generations: 0,
    bestFitness: 0,
    world: 'grid-town',
    mutation,
    date: '',
  });
  const res = parseBrain(JSON.parse(JSON.stringify(file)));
  if (!res.ok) throw new Error(res.errors.join('; '));
  return res.net;
}

function validate(raw: NeuralNetwork, generation: number, fitness: number): Candidate {
  const net = asShipped(raw);
  const drives = VALIDATION.map((v) => validateCityBrain(model, geo, net, v.traffic, v.jitter));
  return {
    net,
    generation,
    fitness,
    drives,
    passes: drives.filter(cityDrivePassed).length,
    broad: null,
  };
}

/** The broad check, run only for candidates that pass at least 3 of the 5 drives. */
function withBroad(c: Candidate): Candidate {
  if (c.passes >= 3) c.broad = broadCityCheck(model, geo, c.net, broadDrives);
  return c;
}

const fmtBroad = (b: BroadCheck | null): string =>
  b
    ? `On ${b.drives} unseen traffic seeds: ${b.passes} passed (${b.arrived} reached the target, ${b.crashed} crashed, ${b.violations} lane violations, ${b.redLights} red lights run), ${(b.inLane * 100).toFixed(1)}% in lane, ${(b.routeShare * 100).toFixed(0)}% of the route on average.`
    : '';

/** Writes a validated brain with its own numbers (`final`: the run is over). */
function writeBrain(c: Candidate, final: boolean): string {
  const passed = c.passes >= 3;
  const inLane = mean(c.drives.filter((d) => d.arrived).map((d) => d.inLane));
  const brain = serializeBrain(
    c.net,
    inputNames(pop.sensors[0]?.rayCount ?? 7, routeInputNames(pop.config.lightInput)),
    {
      world: 'grid-town',
      mutation: cycle.length > 0 ? Math.round(mean(cycle) * 1000) / 1000 : mutation,
      date: `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
      generations: c.generation,
      bestFitness: Math.round(c.fitness * 10) / 10,
      population: cars,
      inLaneFraction: Math.round((Number.isFinite(inLane) ? inLane : 0) * 1000) / 1000,
      validation: `${c.passes} of 5 validation drives passed (target reached, no crash, no lane violation, ≥ 95% in lane): ${c.drives.map(fmt).join('; ')}. ${fmtBroad(c.broad)} Curriculum: stage ${bestStage}, ${(bestShare * 100).toFixed(0)}% of the ${routeLength.toFixed(0)}-unit route. Trained with ${selection} selection, seed ${seed}, mutation ${cycle.length > 0 ? `cycling ${cycle.join('/')}` : mutation}${varyTraffic ? ', a new traffic seed every generation' : ''}, stuck timeout ${stuck} s, ${timeLimit} s generations.${passed || !final ? '' : ' Did not meet the 3-of-5 bar within the generation budget.'}`,
    },
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(brain)}\n`);
  return brain.training.validation ?? '';
}

for (let g = 0; g < generations; g++) {
  if (cycle.length > 0) pop.setMutation(cycle[g % cycle.length] as number);
  // the traffic of the next generation (re-seeded when this one ends)
  if (varyTraffic && trainer.host instanceof Simulation) trainer.host.config.seed = 1000 + g + 1;
  const rec = trainer.runGeneration();
  if (!rec) break;
  bestStage = Math.max(bestStage, rec.stage ?? 1);
  bestShare = Math.max(bestShare, Math.min(1, (rec.horizon ?? 0) / routeLength));
  let note = '';
  const full = (rec.horizon ?? 0) >= routeLength;
  if (full && ((rec.reached ?? 0) > 0 || (g + 1) % every === 0 || g === generations - 1)) {
    const c = withBroad(validate(pop.bestEver, pop.generation, pop.eliteFitness));
    note = `  validate ${c.passes}/5 (${c.drives.map((d) => (d.arrived ? (d.crashed ? 'C' : 'A') : d.crashed ? 'c' : d.laneViolation ? 'v' : d.redLight ? 'r' : 's')).join('')}, in lane ${(mean(c.drives.map((d) => d.inLane)) * 100).toFixed(1)}%)${c.broad ? ` broad ${c.broad.passes}/${c.broad.drives}` : ''}`;
    if (better(c, chosen)) {
      chosen = c;
      writeBrain(c, false); // keep the best so far on disk
    }
  }
  console.log(
    `gen ${String(rec.generation).padStart(3)}  stage ${String(rec.stage).padStart(2)} (${(Math.min(1, (rec.horizon ?? 0) / routeLength) * 100).toFixed(0).padStart(3)}%)  reached ${String(rec.reached).padStart(3)}  best ${rec.best.toFixed(0).padStart(6)}  avg ${rec.average.toFixed(0).padStart(5)}  ${((performance.now() - t0) / 1000).toFixed(0)} s${note}`,
  );
  if (chosen && chosen.passes >= until && (chosen.broad?.passes ?? 0) >= broadUntil) break;
}
if (!chosen) {
  // the curriculum never covered the whole route: validate the best brain anyway
  chosen = validate(pop.bestEver, pop.generation, pop.eliteFitness);
}
const summary = writeBrain(chosen, true);
console.log(
  `wrote ${out}: generation ${chosen.generation}, ${summary} ${trainer.steps} steps in ${((performance.now() - t0) / 1000).toFixed(0)} s`,
);
