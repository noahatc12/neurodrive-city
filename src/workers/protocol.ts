/**
 * Message protocol between the main thread and Web Workers. Payloads are plain data so
 * they survive structured clone.
 * @module workers/protocol
 */
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
