/**
 * Brain file format (`*.brain.json`) with a hand-written validator.
 *
 * Version 2 (v1.1) changed the route inputs of the AI navigation mode from
 * `wpAngle, speed` to `lat, hdg, wpNear, wpFar, speed`. The weight layout is unchanged,
 * so version 1 files still parse (and are reported as version 2); whether a brain fits
 * is decided by its input names, so an old route-input brain is rejected by
 * {@link fitLayout} even when its input count happens to match.
 *
 * @module engine/ai/brainSchema
 */
import { NeuralNetwork, type Activation, type Level } from './network.ts';

export const BRAIN_FORMAT = 'neurodrive.brain';
export const BRAIN_VERSION = 2;
/** Versions {@link parseBrain} reads (older ones are migrated on load). */
export const BRAIN_VERSIONS_READ: readonly number[] = [1, 2];

export interface BrainTraining {
  generations: number;
  bestFitness: number;
  world: string;
  mutation: number;
  date: string;
}

export interface BrainFile {
  format: typeof BRAIN_FORMAT;
  version: number;
  topology: number[];
  activation: Activation;
  inputs: string[];
  outputs: string[];
  levels: { weights: number[][]; biases: number[] }[];
  training: BrainTraining;
}

export const OUTPUT_NAMES = ['forward', 'left', 'right', 'reverse'] as const;

/** Input names for a sensor configuration (rays plus optional navigation extras). */
export function inputNames(rayCount: number, extras: readonly string[] = []): string[] {
  return [...Array.from({ length: rayCount }, (_, i) => `ray${i}`), ...extras];
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Serializes a network (weights as an inputs × outputs matrix per level). */
export function serializeBrain(
  net: NeuralNetwork,
  inputs: readonly string[],
  training: BrainTraining,
): BrainFile {
  return {
    format: BRAIN_FORMAT,
    version: BRAIN_VERSION,
    topology: [...net.topology],
    activation: net.activation,
    inputs: [...inputs],
    outputs: [...OUTPUT_NAMES],
    levels: net.levels.map((l: Level) => ({
      weights: Array.from({ length: l.inputCount }, (_, i) =>
        Array.from({ length: l.outputCount }, (_, j) => r6(l.weight(i, j))),
      ),
      biases: Array.from(l.biases, r6),
    })),
    training: { ...training },
  };
}

export type BrainResult =
  { ok: true; net: NeuralNetwork; file: BrainFile } | { ok: false; errors: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates and builds a network from parsed JSON. */
export function parseBrain(input: unknown): BrainResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['brain file is not a JSON object'] };
  if (input.format !== BRAIN_FORMAT) errors.push(`format: expected "${BRAIN_FORMAT}"`);
  if (typeof input.version !== 'number' || !BRAIN_VERSIONS_READ.includes(input.version))
    errors.push(`version: expected one of ${BRAIN_VERSIONS_READ.join(', ')}`);
  const topo = input.topology;
  if (
    !Array.isArray(topo) ||
    topo.length < 2 ||
    !topo.every((n) => Number.isInteger(n) && (n as number) > 0)
  ) {
    errors.push('topology: expected an array of at least two positive integers');
    return { ok: false, errors };
  }
  const activation =
    input.activation === 'tanh' ? 'tanh' : input.activation === 'step' ? 'step' : null;
  if (!activation) errors.push('activation: expected "step" or "tanh"');
  const levels = input.levels;
  if (!Array.isArray(levels) || levels.length !== topo.length - 1) {
    errors.push(`levels: expected ${topo.length - 1} levels`);
    return { ok: false, errors };
  }
  const net = new NeuralNetwork(topo as number[], activation ?? 'step');
  levels.forEach((lv, li) => {
    const level = net.levels[li] as Level;
    if (!isObj(lv) || !Array.isArray(lv.weights) || !Array.isArray(lv.biases)) {
      errors.push(`levels[${li}]: expected { weights, biases }`);
      return;
    }
    if (lv.weights.length !== level.inputCount)
      errors.push(`levels[${li}].weights: expected ${level.inputCount} rows`);
    (lv.weights as unknown[]).forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== level.outputCount || !row.every(num)) {
        errors.push(`levels[${li}].weights[${i}]: expected ${level.outputCount} numbers`);
        return;
      }
      row.forEach((w, j) => level.setWeight(i, j, w));
    });
    if (lv.biases.length !== level.outputCount || !(lv.biases as unknown[]).every(num)) {
      errors.push(`levels[${li}].biases: expected ${level.outputCount} numbers`);
    } else level.biases.set(lv.biases as number[]);
  });
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 12) };
  const t = isObj(input.training) ? input.training : {};
  const file: BrainFile = {
    format: BRAIN_FORMAT,
    version: BRAIN_VERSION,
    topology: [...(topo as number[])],
    activation: activation ?? 'step',
    inputs: Array.isArray(input.inputs) ? input.inputs.map(String) : inputNames(topo[0] as number),
    outputs: [...OUTPUT_NAMES],
    levels: levels as BrainFile['levels'],
    training: {
      generations: num(t.generations) ? t.generations : 0,
      bestFitness: num(t.bestFitness) ? t.bestFitness : 0,
      world: typeof t.world === 'string' ? t.world : 'unknown',
      mutation: num(t.mutation) ? t.mutation : 0.1,
      date: typeof t.date === 'string' ? t.date : new Date(0).toISOString(),
    },
  };
  return { ok: true, net, file };
}

/**
 * True when a brain fits an input layout: the input count (or the expected input names,
 * in order, when `names` gives the brain's own) and the four outputs.
 */
export function brainFits(
  net: NeuralNetwork,
  expected: number | readonly string[],
  names: readonly string[] | null = null,
): boolean {
  const count = typeof expected === 'number' ? expected : expected.length;
  if (net.inputCount !== count || net.outputCount !== OUTPUT_NAMES.length) return false;
  if (typeof expected === 'number' || !names) return true;
  return names.length === count && names.every((n, i) => n === expected[i]);
}

/** A network input layout a world accepts: rays alone, or rays plus the route inputs. */
export interface InputLayout {
  /** True when the layout includes the route inputs. */
  nav: boolean;
  inputs: string[];
}

/** The layouts for `rayCount` rays: with the route inputs first, then rays only. */
export function inputLayouts(rayCount: number, navInputs: readonly string[]): InputLayout[] {
  return [
    { nav: true, inputs: inputNames(rayCount, navInputs) },
    { nav: false, inputs: inputNames(rayCount) },
  ];
}

/** The first layout a brain (with its input names) fits, or null. */
export function fitLayout(
  net: NeuralNetwork,
  names: readonly string[],
  layouts: readonly InputLayout[],
): InputLayout | null {
  return layouts.find((l) => brainFits(net, l.inputs, names)) ?? null;
}

/** The message shown when a brain fits none of a world's layouts. */
export function layoutMismatch(
  net: NeuralNetwork,
  names: readonly string[],
  layouts: readonly InputLayout[],
): string {
  const nav = layouts.find((l) => l.nav);
  const plain = layouts.find((l) => !l.nav);
  const counts = [
    nav ? `${nav.inputs.length} inputs with route inputs` : null,
    plain ? `${plain.inputs.length} without` : null,
  ]
    .filter((x) => x !== null)
    .join(', or ');
  const sameCount = layouts.some((l) => l.inputs.length === net.inputCount);
  const why = sameCount ? ` Its inputs (${names.join(', ')}) are an older layout.` : '';
  return `Brain topology [${net.topology.join(', ')}] does not match the current sensors (${counts}, and ${OUTPUT_NAMES.length} outputs); not applied.${why}`;
}
