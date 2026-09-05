import { Script } from "../../../src/index.js";
import type { App, Entity, Mat4Like } from "../../../src/index.js";

/**
 * The S1.3 determinism scene, rebuilt on the ignifx kernel: 50 entities animated by a `Script` in
 * `fixedUpdate`, driven by `app.step(1 / 60)`. The Lite-level version of the same experiment lives
 * in `test/lite/fixtures/determinism-scene.ts`; this one adds the whole kernel — the scheduler, the
 * accumulator, the dispatch lists, and `Transform` — to what is being compared.
 *
 * The animation uses only integer arithmetic and additions of multiples of `2^-12`, so it
 * introduces no rounding of its own. `Math.sin`, `Math.cos`, `Math.sqrt` and division are avoided
 * because the ECMAScript specification lets an implementation approximate them, which would make a
 * Node-versus-Chromium comparison unfair (ADR-0003 Validation, S1.3).
 */

/** Entities in the scene. */
export const ENTITY_COUNT = 50;

/** Depth of the chain the remaining entities hang off. */
const CHAIN_LENGTH = 10;

/** Frames every determinism run advances. */
export const STEP_COUNT = 600;

/** The fixed step both runs use, in seconds. */
export const FIXED_STEP_SECONDS = 1 / 60;

/** Quantum for every animated value: `2^-12`, so sums stay exact well inside a double's mantissa. */
const QUANTUM = 2 ** -12;

/** Half-width of the wrap interval for positions, in quanta. */
const POSITION_WRAP = 8 * 4096;

/** Half-width of the wrap interval for quaternion components, in quanta. */
const ROTATION_WRAP = 2048;

/** Half-width of the wrap interval for the scale offset, in quanta. */
const SCALE_WRAP = 1024;

/** Multiplier of the 32-bit LCG that generates the per-entity increments. */
const LCG_MULTIPLIER = 1_664_525;

/** Increment of the 32-bit LCG. */
const LCG_INCREMENT = 1_013_904_223;

/** Seed of the LCG; any fixed value works, this one is committed with the expected hash. */
const LCG_SEED = 0x9e37_79b9;

/** How many animated values each entity carries. */
const VALUES_PER_ENTITY = 7;

/**
 * Advances a 32-bit LCG.
 *
 * @param state - The current state.
 * @returns The next state, as a signed 32-bit integer.
 */
function nextState(state: number): number {
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

/** The script that animates one entity with exact integer arithmetic. */
export class Drift extends Script {
  static typeId = "test/Drift";

  /** Per-value increments, in quanta. */
  readonly increments = new Int32Array(VALUES_PER_ENTITY);

  /** Per-value accumulators, in quanta. */
  readonly counters = new Int32Array(VALUES_PER_ENTITY);

  fixedUpdate(): void {
    const increments = this.increments;
    const counters = this.counters;
    const px = wrap((counters[0] ?? 0) + (increments[0] ?? 0), POSITION_WRAP);
    const py = wrap((counters[1] ?? 0) + (increments[1] ?? 0), POSITION_WRAP);
    const pz = wrap((counters[2] ?? 0) + (increments[2] ?? 0), POSITION_WRAP);
    const qx = wrap((counters[3] ?? 0) + (increments[3] ?? 0), ROTATION_WRAP);
    const qy = wrap((counters[4] ?? 0) + (increments[4] ?? 0), ROTATION_WRAP);
    const qz = wrap((counters[5] ?? 0) + (increments[5] ?? 0), ROTATION_WRAP);
    const ds = wrap((counters[6] ?? 0) + (increments[6] ?? 0), SCALE_WRAP);
    counters[0] = px;
    counters[1] = py;
    counters[2] = pz;
    counters[3] = qx;
    counters[4] = qy;
    counters[5] = qz;
    counters[6] = ds;
    const transform = this.transform;
    transform.localPosition.set(px * QUANTUM, py * QUANTUM, pz * QUANTUM);
    transform.localRotation.set(qx * QUANTUM, qy * QUANTUM, qz * QUANTUM, 1);
    const scale = 1 + ds * QUANTUM;
    transform.localScale.set(scale, scale, scale);
  }
}

/**
 * Builds the scene in a world: a chain of {@link CHAIN_LENGTH} entities with the rest distributed
 * as children of the chain, each carrying a {@link Drift} script seeded from the LCG.
 *
 * @param app - The app whose world the scene is built in.
 * @returns The entities, in the stable order the hash walks.
 */
export function buildDeterminismScene(app: App): readonly Entity[] {
  const entities: Entity[] = [];
  for (let index = 0; index < ENTITY_COUNT; index += 1) {
    entities.push(app.world.createEntity(`entity-${String(index)}`));
  }
  for (let index = 1; index < CHAIN_LENGTH; index += 1) {
    entities[index]?.setParent(entities[index - 1] ?? null, { worldPositionStays: false });
  }
  for (let index = CHAIN_LENGTH; index < ENTITY_COUNT; index += 1) {
    entities[index]?.setParent(entities[index % CHAIN_LENGTH] ?? null, { worldPositionStays: false });
  }
  let state = LCG_SEED;
  for (let index = 0; index < ENTITY_COUNT; index += 1) {
    const drift = entities[index]?.addComponent(Drift);
    if (drift === undefined) {
      continue;
    }
    for (let value = 0; value < VALUES_PER_ENTITY; value += 1) {
      state = nextState(state);
      drift.increments[value] = ((state >>> 16) & 0xff) - 128;
    }
  }
  return entities;
}

/**
 * FNV-1a over the IEEE-754 big-endian bit patterns of every element of every entity's world matrix
 * — the same algorithm as `test/lite/fixtures/determinism-scene.ts`, reading through the public
 * `Transform.worldMatrix` instead of the adapter.
 *
 * @param entities - The entities to hash, in order.
 * @returns The 32-bit hash as eight lowercase hex digits.
 */
export function hashWorldMatrices(entities: readonly Entity[]): string {
  const bytes = new DataView(new ArrayBuffer(8));
  let hash = 0x811c_9dc5;
  for (const entity of entities) {
    const matrix: Mat4Like = entity.transform.worldMatrix;
    for (let element = 0; element < 16; element += 1) {
      bytes.setFloat64(0, matrix[element] ?? 0, false);
      for (let byte = 0; byte < 8; byte += 1) {
        hash = Math.imul(hash ^ bytes.getUint8(byte), 16_777_619);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
