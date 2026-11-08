/**
 * World generation off the main thread: the same engine code as the synchronous path,
 * reporting progress so the UI can show a progress bar and never freezes.
 * @module workers/worldgen.worker
 */
import { generateWorld } from '../engine/world/world.ts';
import type { WorldGenRequest, WorldGenResponse } from './protocol.ts';

interface WorkerScope {
  postMessage(message: WorldGenResponse): void;
  onmessage: ((e: MessageEvent<WorldGenRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent<WorldGenRequest>): void => {
  const { id, input } = e.data;
  const t0 = performance.now();
  try {
    let lastPost = 0;
    const data = generateWorld(input, {
      now: () => performance.now(),
      onProgress: (fraction, stage) => {
        const t = performance.now();
        if (t - lastPost > 30 || fraction >= 1) {
          lastPost = t;
          scope.postMessage({ type: 'progress', id, fraction, stage });
        }
      },
    });
    scope.postMessage({ type: 'done', id, data, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
