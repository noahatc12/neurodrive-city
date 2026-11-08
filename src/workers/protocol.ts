/**
 * Message protocol between the main thread and Web Workers. Payloads are plain data so
 * they survive structured clone.
 * @module workers/protocol
 */
import type { BrainFile } from '../engine/ai/brainSchema.ts';
import type { EvolutionConfig, GenerationRecord } from '../engine/ai/evolution.ts';
import type { WorldGeometryData, WorldInput } from '../engine/world/types.ts';

/** Main → world generation worker. */
export interface WorldGenRequest {
  type: 'generate';
  id: number;
  input: WorldInput;
}

/** World generation worker → main. */
export type WorldGenResponse =
  | { type: 'progress'; id: number; fraction: number; stage: string }
  | { type: 'done'; id: number; data: WorldGeometryData; ms: number }
  | { type: 'error'; id: number; message: string };

/** Main → turbo trainer worker (spec G8). */
export type TrainerRequest =
  | {
      type: 'start';
      /** Infinite road, or a city given as a world file (JSON text). */
      host: 'infinite' | 'city';
      worldText: string | null;
      curvy: boolean;
      evo: Partial<EvolutionConfig>;
      /** Brain to seed generation 0 (car 0 keeps it exactly). */
      seedBrain: BrainFile | null;
    }
  | { type: 'stop' };

/** Turbo trainer worker → main. */
export type TrainerResponse =
  | {
      type: 'progress';
      generation: number;
      best: number;
      average: number;
      bestEver: number;
      /** Curriculum stage and horizon (units; Infinity without a route). */
      stage: number;
      horizon: number;
      steps: number;
      elapsedMs: number;
    }
  | {
      type: 'done';
      brain: BrainFile;
      generation: number;
      bestEver: number;
      history: GenerationRecord[];
      /** Curriculum horizon reached (the visible population continues from it). */
      horizon: number;
      steps: number;
      elapsedMs: number;
    }
  | { type: 'error'; message: string };
