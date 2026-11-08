/**
 * Turbo training (spec G8): runs evolution headless in a Web Worker with the same engine
 * code as the visible simulation, as fast as the CPU allows. Progress is streamed after
 * every generation; on "stop" the worker hands back the best brain seen.
 *
 * Generations are simulated in chunks of 600 steps with a yield in between, so a stop
 * request is handled within a few milliseconds even in long generations.
 * @module workers/trainer.worker
 */
import { parseBrain } from '../engine/ai/brainSchema.ts';
import type { HeadlessTrainer} from '../engine/ai/trainer.ts';
import { cityTrainer, infiniteTrainer } from '../engine/ai/trainer.ts';
import { parseWorldText } from '../engine/io/serialize.ts';
import { generateWorld, worldInputFrom, WorldGeometry } from '../engine/world/world.ts';
import type { TrainerRequest, TrainerResponse } from './protocol.ts';

interface WorkerScope {
  postMessage(message: TrainerResponse): void;
  onmessage: ((e: MessageEvent<TrainerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
let stopRequested = false;
let running = false;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function build(msg: Extract<TrainerRequest, { type: 'start' }>): {
  trainer: HeadlessTrainer;
  world: string;
} {
  const seed = msg.seedBrain ? parseBrain(msg.seedBrain) : null;
  const net = seed && seed.ok ? seed.net : null;
  if (msg.host === 'infinite') {
    return {
      trainer: infiniteTrainer(msg.evo, { curvy: msg.curvy, seed: 2026 }, net),
      world: msg.curvy ? 'infinite-road-curvy' : 'infinite-road',
    };
  }
  const res = parseWorldText(msg.worldText ?? '');
  if (!res.ok) throw new Error(`world file rejected: ${res.errors.join('; ')}`);
  const model = res.value.model;
  const geo = new WorldGeometry(generateWorld(worldInputFrom(model)));
  return { trainer: cityTrainer(model, geo, msg.evo, net), world: model.meta.name };
}

async function run(msg: Extract<TrainerRequest, { type: 'start' }>): Promise<void> {
  running = true;
  stopRequested = false;
  const t0 = performance.now();
  try {
    const { trainer, world } = build(msg);
    const pop = trainer.population;
    while (!stopRequested) {
      const rec = trainer.runGeneration(600);
      if (rec) {
        scope.postMessage({
          type: 'progress',
          generation: pop.generation,
          best: rec.best,
          average: rec.average,
          bestEver: pop.bestEverFitness,
          steps: trainer.steps,
          elapsedMs: performance.now() - t0,
        });
      }
      await tick();
    }
    scope.postMessage({
      type: 'done',
      brain: trainer.brainFile(world),
      generation: pop.generation,
      bestEver: pop.bestEverFitness,
      history: pop.history.map((r) => ({ ...r })),
      steps: trainer.steps,
      elapsedMs: performance.now() - t0,
    });
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

scope.onmessage = (e: MessageEvent<TrainerRequest>): void => {
  const msg = e.data;
  if (msg.type === 'stop') stopRequested = true;
  else if (!running) void run(msg);
};
