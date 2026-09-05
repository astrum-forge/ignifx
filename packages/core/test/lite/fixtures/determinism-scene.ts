import { createNode, disposeNode, linkParent, readWorldMatrix } from "../../../src/lite/node.js";

/**
 * The S1.3 determinism scene, shared by the Node run (`determinism.test.ts`) and the Chromium run
 * (`determinism.browser.test.ts`) so the two hash exactly the same work.
 *
 * The per-frame mutation uses **only** integer arithmetic and additions of dyadic rationals
 * (multiples of `2^-12`, wrapped into a bounded range). Every intermediate value is exactly
 * representable as an IEEE-754 double, so the animation itself introduces no rounding at all and
 * cannot drift between two JavaScript engines. `Math.sin`, `Math.cos`, `Math.sqrt` and division are
 * avoided on purpose: the ECMAScript specification lets an implementation approximate the
 * transcendental functions, so a hash that depended on them would not be a fair Node-vs-Chromium
 * comparison. The rounding that remains happens where it matters — inside Lite's matrix compose and
 * multiply, and in its `Float32Array` world-matrix storage — and that is exactly what S1.3 is
 * testing.
 */

/**
 * A Lite transform node, named through the adapter rather than imported from `@babylonjs/lite`:
 * fixtures are not adapter-compatibility tests, so the boundary rule applies to them
 * (`ignifx/no-lite-outside-adapter`, coding standards §4).
 */
type Node = ReturnType<typeof createNode>;

/** Nodes in the scene: a 10-deep chain plus 40 siblings hanging off it. */
export const NODE_COUNT = 50;

/** Depth of the chain the siblings attach to. */
const CHAIN_LENGTH = 10;

/** Frames every determinism run advances. */
export const STEP_COUNT = 600;

/** The fixed step both runs use, in seconds. */
export const FIXED_STEP_SECONDS = 1 / 60;

/** The same step in Lite's milliseconds; `(1 / 60) * 1000` is this exact double. */
export const FIXED_STEP_MS = 1000 / 60;

/** Quantum for every animated value: `2^-12`, so sums stay exact well inside a double's mantissa. */
const QUANTUM = 2 ** -12;

/** Half-width of the wrap interval for positions, in quanta. */
const POSITION_WRAP = 8 * 4096;

/** Half-width of the wrap interval for quaternion components, in quanta. */
const ROTATION_WRAP = 2048;

/** Half-width of the wrap interval for the scale offset, in quanta. */
const SCALE_WRAP = 1024;

/** Multiplier of the 32-bit LCG that generates the per-node increments. */
const LCG_MULTIPLIER = 1664525;

/** Increment of the 32-bit LCG. */
const LCG_INCREMENT = 1013904223;

/** Seed of the LCG; any fixed value works, this one is committed with the expected hash. */
const LCG_SEED = 0x9e37_79b9;

/** A determinism scene: its nodes and the per-frame mutation that drives them. */
export interface DeterminismScene {
  /** Every node, in a stable order — the order the hash walks. */
  readonly nodes: readonly Node[];
  /**
   * Advances the animation by one frame.
   *
   * @param deltaMs - The frame delta Lite delivered, asserted rather than integrated.
   */
  advance(deltaMs: number): void;
  /** Unlinks and releases every node. */
  dispose(): void;
}

/**
 * Advances a 32-bit LCG.
 *
 * @param state - The current state.
 * @returns The next state, as a signed 32-bit integer.
 */
function nextState(state: number): number {
  // `Math.imul` and `>>>` both coerce through the 32-bit integer conversions, so the sequence
  // wraps modulo 2^32 without an explicit truncation.
  return Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT;
}

/**
 * Wraps an integer count of quanta into `[-halfWidth, halfWidth)`.
 *
 * @param value - The current count.
 * @param halfWidth - Half the width of the interval.
 * @returns The wrapped count.
 */
function wrap(value: number, halfWidth: number): number {
  let wrapped = value;
  const width = halfWidth * 2;
  while (wrapped >= halfWidth) {
    wrapped -= width;
  }
  while (wrapped < -halfWidth) {
    wrapped += width;
  }
  return wrapped;
}

/**
 * Builds the determinism scene: a chain of {@link CHAIN_LENGTH} nodes with the remaining nodes
 * distributed as children of the chain, plus per-node increments drawn from the LCG.
 *
 * @returns The scene.
 */
export function createDeterminismScene(): DeterminismScene {
  const nodes: Node[] = [];
  for (let index = 0; index < NODE_COUNT; index += 1) {
    nodes.push(createNode(`node-${String(index)}`));
  }
  for (let index = 1; index < CHAIN_LENGTH; index += 1) {
    linkParent(nodes[index]!, nodes[index - 1]!);
  }
  for (let index = CHAIN_LENGTH; index < NODE_COUNT; index += 1) {
    linkParent(nodes[index]!, nodes[index % CHAIN_LENGTH]!);
  }

  // Seven signed increments per node, each an integer number of quanta in [-128, 127].
  const increments = new Int32Array(NODE_COUNT * 7);
  let state = LCG_SEED;
  for (let index = 0; index < increments.length; index += 1) {
    state = nextState(state);
    increments[index] = ((state >>> 16) & 0xff) - 128;
  }

  // Accumulators, in quanta, so every step is exact integer arithmetic.
  const counters = new Int32Array(NODE_COUNT * 7);

  return {
    nodes,
    advance(deltaMs: number): void {
      if (deltaMs !== FIXED_STEP_MS) {
        throw new Error(`determinism scene expected ${String(FIXED_STEP_MS)} ms, got ${String(deltaMs)}`);
      }
      for (let index = 0; index < NODE_COUNT; index += 1) {
        const base = index * 7;
        const node = nodes[index]!;

        const px = wrap(counters[base]! + increments[base]!, POSITION_WRAP);
        const py = wrap(counters[base + 1]! + increments[base + 1]!, POSITION_WRAP);
        const pz = wrap(counters[base + 2]! + increments[base + 2]!, POSITION_WRAP);
        const qx = wrap(counters[base + 3]! + increments[base + 3]!, ROTATION_WRAP);
        const qy = wrap(counters[base + 4]! + increments[base + 4]!, ROTATION_WRAP);
        const qz = wrap(counters[base + 5]! + increments[base + 5]!, ROTATION_WRAP);
        const ds = wrap(counters[base + 6]! + increments[base + 6]!, SCALE_WRAP);

        counters[base] = px;
        counters[base + 1] = py;
        counters[base + 2] = pz;
        counters[base + 3] = qx;
        counters[base + 4] = qy;
        counters[base + 5] = qz;
        counters[base + 6] = ds;

        node.position.set(px * QUANTUM, py * QUANTUM, pz * QUANTUM);
        node.rotationQuaternion.set(qx * QUANTUM, qy * QUANTUM, qz * QUANTUM, 1);
        const scale = 1 + ds * QUANTUM;
        node.scaling.set(scale, scale, scale);
      }
    },
    dispose(): void {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        disposeNode(nodes[index]!);
      }
    },
  };
}

/**
 * FNV-1a over the IEEE-754 big-endian bit patterns of every element of every node's world matrix.
 *
 * @remarks
 * The matrices are read through the adapter's `readWorldMatrix`, so the hash covers the copy path
 * the kernel actually uses. Values come out of a `Float32Array`, which makes every one of them
 * exactly representable as a double, so widening to `Float64` before hashing loses nothing and
 * gives a bit pattern that cannot depend on the host's float formatting.
 *
 * @param nodes - The nodes to hash, in order.
 * @returns The 32-bit hash as eight lowercase hex digits.
 */
export function hashWorldMatrices(nodes: readonly Node[]): string {
  const matrix = new Float32Array(16);
  const bytes = new DataView(new ArrayBuffer(8));
  let hash = 0x811c_9dc5;
  for (const node of nodes) {
    readWorldMatrix(node, matrix);
    for (let element = 0; element < 16; element += 1) {
      bytes.setFloat64(0, matrix[element]!, false);
      for (let byte = 0; byte < 8; byte += 1) {
        hash = Math.imul(hash ^ bytes.getUint8(byte), 16_777_619);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
