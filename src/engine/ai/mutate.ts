/**
 * Genetic operators (spec G2, G5).
 *
 * Mutation moves every parameter part of the way toward a fresh random value:
 *
 *     w ← lerp(w, random(−1, 1), amount)
 *
 * amount = 0 leaves the network unchanged (the identity); amount = 1 replaces it with a
 * completely random one; small amounts (0.05–0.2) explore near a good solution. Because
 * both endpoints lie in [−1, 1], mutated parameters stay in [−1, 1] too.
 *
 * Uniform crossover picks each parameter from one of two parents with equal odds.
 *
 * @module engine/ai/mutate
 */
import { lerp } from '../math/utils.ts';
import type { Rng } from '../math/rng.ts';
import { NeuralNetwork, sameTopology, type Level } from './network.ts';

/** Mutates `net` in place by `amount` ∈ [0, 1]. */
export function mutate(net: NeuralNetwork, amount: number, rng: Rng): NeuralNetwork {
  const a = Math.min(1, Math.max(0, amount));
  if (a === 0) return net;
  for (const level of net.levels) {
    for (let k = 0; k < level.weights.length; k++)
      level.weights[k] = lerp(level.weights[k] as number, rng.range(-1, 1), a);
    for (let j = 0; j < level.biases.length; j++)
      level.biases[j] = lerp(level.biases[j] as number, rng.range(-1, 1), a);
  }
  return net;
}

/** Uniform crossover of two parents with the same topology into a new child. */
export function crossover(a: NeuralNetwork, b: NeuralNetwork, rng: Rng): NeuralNetwork {
  if (!sameTopology(a, b)) throw new Error('Crossover needs parents with the same topology');
  const child = new NeuralNetwork(a.topology, a.activation);
  child.levels.forEach((lc, li) => {
    const la = a.levels[li] as Level;
    const lb = b.levels[li] as Level;
    for (let k = 0; k < lc.weights.length; k++)
      lc.weights[k] = rng.chance(0.5) ? (la.weights[k] as number) : (lb.weights[k] as number);
    for (let j = 0; j < lc.biases.length; j++)
      lc.biases[j] = rng.chance(0.5) ? (la.biases[j] as number) : (lb.biases[j] as number);
  });
  return child;
}
