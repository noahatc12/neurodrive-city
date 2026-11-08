/**
 * A small fully-connected feed-forward neural network, written from scratch (spec G1).
 *
 * ```
 *   inputs (rays…)        hidden (6)          outputs (4)
 *      ●  ─────────────▶   ●  ─────────────▶   ● forward
 *      ●  ─ w[i][j] ───▶   ●                   ● left
 *      ●                   ●                   ● right
 *      ●                   ●                   ● reverse
 * ```
 *
 * Each level computes, for every output j:
 *
 *     sum_j = Σ_i input_i · w[i][j]
 *     step:  out_j = sum_j > bias_j ? 1 : 0     (binary controls, like the course)
 *     tanh:  out_j = tanh(sum_j − bias_j)       (proportional controls, optional)
 *
 * The step activation makes every output a yes/no decision, matching keyboard-like
 * controls; tanh gives smooth values in (−1, 1) for proportional steering and throttle.
 *
 * Weights and biases start uniform in [−1, 1]. All buffers are typed arrays allocated
 * once; `feedForward` allocates nothing.
 *
 * @module engine/ai/network
 */
import type { Rng } from '../math/rng.ts';

export type Activation = 'step' | 'tanh';

export class Level {
  readonly inputCount: number;
  readonly outputCount: number;
  readonly inputs: Float64Array;
  readonly outputs: Float64Array;
  readonly biases: Float64Array;
  /** Row-major weights: weights[i * outputCount + j] connects input i to output j. */
  readonly weights: Float64Array;

  constructor(inputCount: number, outputCount: number) {
    this.inputCount = inputCount;
    this.outputCount = outputCount;
    this.inputs = new Float64Array(inputCount);
    this.outputs = new Float64Array(outputCount);
    this.biases = new Float64Array(outputCount);
    this.weights = new Float64Array(inputCount * outputCount);
  }

  /** Weight from input i to output j. */
  weight(i: number, j: number): number {
    return this.weights[i * this.outputCount + j] as number;
  }

  setWeight(i: number, j: number, w: number): void {
    this.weights[i * this.outputCount + j] = w;
  }

  /** Uniform random weights and biases in [−1, 1]. */
  randomize(rng: Rng): void {
    for (let k = 0; k < this.weights.length; k++) this.weights[k] = rng.range(-1, 1);
    for (let j = 0; j < this.biases.length; j++) this.biases[j] = rng.range(-1, 1);
  }

  /** Feeds `given` through this level; returns the outputs buffer. */
  feed(given: ArrayLike<number>, activation: Activation): Float64Array {
    const n = this.inputCount;
    const m = this.outputCount;
    for (let i = 0; i < n; i++) this.inputs[i] = given[i] ?? 0;
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++)
        sum += (this.inputs[i] as number) * (this.weights[i * m + j] as number);
      const b = this.biases[j] as number;
      this.outputs[j] = activation === 'step' ? (sum > b ? 1 : 0) : Math.tanh(sum - b);
    }
    return this.outputs;
  }
}

export class NeuralNetwork {
  readonly levels: Level[];
  readonly topology: readonly number[];
  activation: Activation;

  /**
   * @param topology neuron counts per layer, e.g. [5, 6, 4]; must have at least two
   *   entries (one level). A single entry is rejected with a clear error.
   */
  constructor(topology: readonly number[], activation: Activation = 'step') {
    if (topology.length < 2)
      throw new Error('A network needs at least an input and an output layer');
    if (topology.some((n) => !Number.isInteger(n) || n < 1))
      throw new Error('Layer sizes must be positive integers');
    this.topology = [...topology];
    this.activation = activation;
    this.levels = [];
    for (let i = 0; i + 1 < topology.length; i++)
      this.levels.push(new Level(topology[i] as number, topology[i + 1] as number));
  }

  /** A network with uniform random parameters. */
  static random(
    topology: readonly number[],
    rng: Rng,
    activation: Activation = 'step',
  ): NeuralNetwork {
    const n = new NeuralNetwork(topology, activation);
    for (const l of n.levels) l.randomize(rng);
    return n;
  }

  get inputCount(): number {
    return this.topology[0] as number;
  }

  get outputCount(): number {
    return this.topology[this.topology.length - 1] as number;
  }

  /** Output buffer of the last level (valid after feedForward). */
  get outputs(): Float64Array {
    return (this.levels[this.levels.length - 1] as Level).outputs;
  }

  /** Runs the network; returns the final outputs (a reused buffer). */
  feedForward(inputs: ArrayLike<number>): Float64Array {
    let out: ArrayLike<number> = inputs;
    for (const l of this.levels) out = l.feed(out, this.activation);
    return out as Float64Array;
  }

  /** Deep copy. */
  clone(): NeuralNetwork {
    const n = new NeuralNetwork(this.topology, this.activation);
    this.levels.forEach((l, i) => {
      const c = n.levels[i] as Level;
      c.weights.set(l.weights);
      c.biases.set(l.biases);
    });
    return n;
  }

  /** Copies parameters from a network with the same topology (no allocation). */
  copyFrom(other: NeuralNetwork): void {
    if (!sameTopology(this, other)) throw new Error('Topology mismatch');
    this.activation = other.activation;
    this.levels.forEach((l, i) => {
      const o = other.levels[i] as Level;
      l.weights.set(o.weights);
      l.biases.set(o.biases);
    });
  }

  /** Total number of trainable parameters. */
  parameterCount(): number {
    return this.levels.reduce((a, l) => a + l.weights.length + l.biases.length, 0);
  }
}

export function sameTopology(a: NeuralNetwork, b: NeuralNetwork): boolean {
  return a.topology.length === b.topology.length && a.topology.every((n, i) => n === b.topology[i]);
}
