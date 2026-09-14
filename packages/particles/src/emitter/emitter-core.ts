import { resolveScalar } from "../definition/values.js";
import { transformDirection, transformPoint } from "../evaluate/particle-math.js";
import { EmitterRandom, recordSeed } from "./pcg3d.js";
import { isDead, RECORD_FLOATS, SpawnRecordRing } from "./record-ring.js";
import { MeshShapeTable, sampleShape } from "./shapes.js";
import type { RingCensus } from "./record-ring.js";
import type { ParticleDefinition } from "../definition/types.js";

// The whole CPU side of one particle system, with no app, no component and no GPU
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3). `ParticleSystem` drives it from the
// frame loop; `@ignifx/particles-2d` drives the same object and draws the records itself.

/** The sub-step `simulate()` advances in, in seconds. */
const SIMULATE_STEP = 1 / 60;

/** Degrees to radians. */
const DEG_TO_RAD = Math.PI / 180;

/** The largest seed a `u32` holds, plus one. */
const SEED_RANGE = 0x1_0000_0000;

/** How many cycle boundaries one frame may cross before the loop gives up. */
const MAX_CYCLES_PER_FRAME = 1024;

/** How many times one burst may fire inside one segment before the loop gives up. */
const MAX_BURST_FIRINGS = 4096;

/**
 * What {@link ParticleEmitterCore.stop} accepts.
 *
 * @public
 */
export interface ParticleStopOptions {
  /** Whether to forget the live particles too. Defaults to `false`: they finish their lives. */
  readonly clear?: boolean;
}

/**
 * How {@link ParticleEmitterCore} is built.
 *
 * @beta
 */
export interface ParticleEmitterCoreOptions {
  /** The definition to emit. */
  readonly definition: ParticleDefinition;
  /** The ring capacity, after the app's budget clamped it. */
  readonly capacity: number;
  /** The seed; `0` picks a random one on `play()`. */
  readonly seed: number;
}

/**
 * The CPU half of a particle system: the spawn-record ring, the system clock, the seeded random
 * stream, and the emission scheduler.
 *
 * @example
 * ```ts
 * const core = new ParticleEmitterCore({ definition, capacity: 1000, seed: 7 });
 * core.play();
 * core.advance(1 / 60);
 * core.reconcile();
 * ```
 *
 * @beta
 */
export class ParticleEmitterCore {
  /** The definition every record is written from. */
  readonly definition: ParticleDefinition;

  /** The spawn records. */
  readonly ring: SpawnRecordRing;

  /**
   * The emitter's world matrix, column-major; write it before {@link ParticleEmitterCore.advance}.
   * A `"world"` definition bakes it into every record, and `rateOverDistance` reads its translation.
   */
  readonly emitterWorld: Float32Array = identity();

  /** A `0`–`1` multiplier on rates and burst counts; the app's `qualityScale`. */
  qualityScale = 1;

  /** Called once when a non-looping system runs out of cycle and particles. */
  onStopped: (() => void) | null = null;

  readonly #rng: EmitterRandom;

  readonly #declaredSeed: number;

  readonly #meshTable: MeshShapeTable | null;

  readonly #census: RingCensus = { alive: 0, drawCount: 0 };

  readonly #burstFired: Int32Array;

  readonly #position = new Float32Array(3);

  readonly #direction = new Float32Array(3);

  readonly #lastPosition = new Float32Array(3);

  readonly #words = new Uint32Array(3);

  #seed: number;

  #clock = 0;

  #cycleStart = 0;

  #isPlaying = false;

  #isPaused = false;

  #isEmitting = false;

  #rateCarry = 0;

  #distanceCarry = 0;

  #hasLastPosition = false;

  #emittedTotal = 0;

  #droppedTotal = 0;

  /**
   * Creates the core.
   *
   * @param options - The definition, the clamped capacity, and the seed.
   */
  constructor(options: ParticleEmitterCoreOptions) {
    this.definition = options.definition;
    this.ring = new SpawnRecordRing(options.capacity);
    this.#declaredSeed = options.seed >>> 0;
    this.#seed = this.#declaredSeed;
    this.#rng = new EmitterRandom(this.#seed);
    this.#meshTable =
      options.definition.shape.kind === "mesh" ? new MeshShapeTable(options.definition.shape.vertices) : null;
    this.#burstFired = new Int32Array(options.definition.emission.bursts.length);
  }

  /**
   * The system clock, in seconds: what every record's age is measured against.
   *
   * @returns The clock.
   */
  get time(): number {
    return this.#clock;
  }

  /**
   * Whether the system is playing, paused or not.
   *
   * @returns `true` between `play()` and the stop.
   */
  get isPlaying(): boolean {
    return this.#isPlaying;
  }

  /**
   * Whether the clock is held.
   *
   * @returns `true` after `pause()`.
   */
  get isPaused(): boolean {
    return this.#isPaused;
  }

  /**
   * Whether the current cycle still emits.
   *
   * @returns `true` while emission runs.
   */
  get isEmitting(): boolean {
    return this.#isEmitting;
  }

  /**
   * The seed in use: the declared one, or the random one `play()` picked for a declared `0`.
   *
   * @returns The seed.
   */
  get seed(): number {
    return this.#seed;
  }

  /**
   * How many particles are alive, as of the last {@link ParticleEmitterCore.reconcile}.
   *
   * @returns The exact count.
   */
  get aliveCount(): number {
    return this.#census.alive;
  }

  /**
   * How many records the GPU draws, newest first: from the newest back to the oldest still alive.
   *
   * @returns The draw count.
   */
  get drawCount(): number {
    return this.#census.drawCount;
  }

  /**
   * How many particles have been emitted since the last `play()` from an empty ring.
   *
   * @returns The total.
   */
  get emittedTotal(): number {
    return this.#emittedTotal;
  }

  /**
   * How many spawns landed on a slot whose particle was still alive, so that older particle
   * vanished. It is what "over budget" looks like from inside a system: the capacity the app's
   * `maxParticles` granted is smaller than `rate × lifetime`.
   *
   * @returns The total since the last `play()` from an empty ring.
   */
  get droppedTotal(): number {
    return this.#droppedTotal;
  }

  /**
   * Starts, or resumes after a `stop()`, emission. On an empty ring the clock restarts at zero and
   * a `prewarm` definition fast-forwards one cycle; otherwise the clock keeps counting.
   */
  play(): void {
    if (this.#isPlaying) {
      this.#isPaused = false;
      return;
    }
    if (this.ring.written === 0) {
      this.#clock = 0;
      this.#emittedTotal = 0;
      this.#droppedTotal = 0;
      this.#seed = this.#declaredSeed === 0 ? Math.floor(Math.random() * SEED_RANGE) >>> 0 : this.#declaredSeed;
      this.#rng.reseed(this.#seed);
    }
    this.#isPlaying = true;
    this.#isPaused = false;
    this.#startCycle(this.#clock);
    this.#hasLastPosition = false;
    const main = this.definition.main;
    if (main.prewarm && main.looping) {
      this.simulate(main.duration);
    }
  }

  /**
   * Stops emission. Live particles keep ageing until they die unless `clear` is set.
   *
   * @param options - Whether to clear the particles too.
   */
  stop(options?: ParticleStopOptions): void {
    this.#isPlaying = false;
    this.#isPaused = false;
    this.#isEmitting = false;
    if (options?.clear === true) {
      this.ring.clear();
      this.#clock = 0;
      this.#census.alive = 0;
      this.#census.drawCount = 0;
    }
  }

  /** Holds the clock; emission and ageing stop until {@link ParticleEmitterCore.resume}. */
  pause(): void {
    this.#isPaused = true;
  }

  /** Releases a `pause()`. */
  resume(): void {
    this.#isPaused = false;
  }

  /**
   * Spawns particles now, at the current clock, whether or not the system is playing.
   *
   * @param count - How many; a non-integer is floored, and `qualityScale` does not apply.
   */
  emit(count: number): void {
    const whole = Math.floor(count);
    for (let index = 0; index < whole; index += 1) {
      this.#spawn(this.#clock);
    }
  }

  /**
   * Fast-forwards the system by `seconds` in fixed sub-steps, emitting as it goes — what `prewarm`
   * does, and what a test does to reach a known state. The definition's `timeScale` does not apply.
   *
   * @param seconds - How far to advance the system clock.
   */
  simulate(seconds: number): void {
    // The whole sub-steps are counted up front rather than subtracted one at a time, so
    // `simulate(2)` really is 120 steps of a sixtieth and matches 120 frames record for record.
    const whole = Math.floor(seconds / SIMULATE_STEP);
    for (let index = 0; index < whole; index += 1) {
      this.#advanceClock(SIMULATE_STEP);
    }
    const rest = seconds - whole * SIMULATE_STEP;
    if (rest > SIMULATE_STEP * 1e-6) {
      this.#advanceClock(rest);
    }
  }

  /**
   * Advances one frame. It does nothing while paused, and nothing once a stopped system's last
   * particle has died.
   *
   * @param dt - The frame's scaled seconds; the definition's own `timeScale` is applied here.
   */
  advance(dt: number): void {
    if (this.#isPaused || dt <= 0) {
      return;
    }
    if (!this.#isPlaying && this.#census.alive === 0) {
      return;
    }
    this.#advanceClock(dt * this.definition.main.timeScale);
  }

  /**
   * Recounts the ring at the current clock and fires `onStopped` once a non-looping system has
   * nothing left to do.
   *
   * @returns The census.
   */
  reconcile(): RingCensus {
    const census = this.ring.reconcile(this.#clock, this.#census);
    if (this.#isPlaying && !this.#isEmitting && census.alive === 0) {
      this.#isPlaying = false;
      this.#isPaused = false;
      this.onStopped?.();
    }
    return census;
  }

  /**
   * Begins a cycle at a clock value.
   *
   * @param at - The clock the cycle starts at.
   */
  #startCycle(at: number): void {
    this.#cycleStart = at;
    this.#isEmitting = true;
    this.#rateCarry = 0;
    this.#burstFired.fill(0);
  }

  /**
   * Moves the clock forward and emits everything due.
   *
   * @param dt - The seconds to advance, already scaled.
   */
  #advanceClock(dt: number): void {
    const main = this.definition.main;
    let segmentStart = this.#clock;
    const target = this.#clock + dt;
    this.#clock = target;
    // One frame may cross the end of a cycle, and each segment has to be emitted inside its own.
    let guard = 0;
    while (segmentStart < target && guard < MAX_CYCLES_PER_FRAME) {
      guard += 1;
      const cycleEnd = this.#cycleStart + main.startDelay + main.duration;
      const segmentEnd = this.#isEmitting && target > cycleEnd ? cycleEnd : target;
      if (this.#isEmitting) {
        this.#emitSegment(segmentStart, segmentEnd);
      }
      if (this.#isEmitting && segmentEnd >= cycleEnd) {
        if (main.looping) {
          this.#startCycle(cycleEnd);
        } else {
          this.#isEmitting = false;
        }
      }
      segmentStart = segmentEnd;
      if (!this.#isEmitting) {
        break;
      }
    }
    this.#emitOverDistance();
  }

  /**
   * Emits what the rate and the bursts owe inside one segment of one cycle.
   *
   * @param from - The segment's start clock.
   * @param to - The segment's end clock.
   */
  #emitSegment(from: number, to: number): void {
    const main = this.definition.main;
    const emission = this.definition.emission;
    const emissionStart = this.#cycleStart + main.startDelay;
    const windowStart = from > emissionStart ? from : emissionStart;
    const rate = emission.rateOverTime * this.qualityScale;
    if (to > windowStart && rate > 0) {
      // The fractional part carries to the next frame, so the count over any run of steps is
      // exactly `floor(rate × elapsed)` and each particle gets its own sub-frame spawn time.
      const owed = this.#rateCarry + rate * (to - windowStart);
      const count = Math.floor(owed);
      const period = 1 / rate;
      for (let index = 0; index < count; index += 1) {
        const spawnTime = windowStart + (index + 1 - this.#rateCarry) * period;
        this.#spawn(spawnTime > to ? to : spawnTime);
      }
      this.#rateCarry = owed - count;
    }
    const bursts = emission.bursts;
    for (let index = 0; index < bursts.length; index += 1) {
      const burst = bursts[index];
      if (burst === undefined) {
        continue;
      }
      // `cycles: 0` means "until the cycle ends", which only makes sense with a gap between
      // firings; with no gap it is one firing, not an infinite loop at the same instant.
      const limit = burst.cycles === 0 && burst.interval > 0 ? MAX_BURST_FIRINGS : Math.max(1, burst.cycles);
      let fired = this.#burstFired[index] ?? 0;
      while (fired < limit) {
        const due = emissionStart + burst.time + fired * burst.interval;
        if (due > to) {
          break;
        }
        fired += 1;
        if (burst.probability >= 1 || this.#rng.next() < burst.probability) {
          const rolled = resolveScalar(burst.count, this.#rng.next(), this.#cycleFraction(due)) * this.qualityScale;
          const count = Math.floor(rolled);
          for (let spawned = 0; spawned < count; spawned += 1) {
            this.#spawn(due < windowStart ? windowStart : due);
          }
        }
      }
      this.#burstFired[index] = fired;
    }
  }

  /** Emits what the emitter's movement since the last frame owes. */
  #emitOverDistance(): void {
    const rate = this.definition.emission.rateOverDistance * this.qualityScale;
    const world = this.emitterWorld;
    const x = world[12] ?? 0;
    const y = world[13] ?? 0;
    const z = world[14] ?? 0;
    if (rate > 0 && this.#isEmitting && this.#hasLastPosition) {
      const dx = x - (this.#lastPosition[0] ?? 0);
      const dy = y - (this.#lastPosition[1] ?? 0);
      const dz = z - (this.#lastPosition[2] ?? 0);
      const owed = this.#distanceCarry + Math.hypot(dx, dy, dz) * rate;
      const count = Math.floor(owed);
      for (let index = 0; index < count; index += 1) {
        this.#spawn(this.#clock);
      }
      this.#distanceCarry = owed - count;
    }
    this.#lastPosition[0] = x;
    this.#lastPosition[1] = y;
    this.#lastPosition[2] = z;
    this.#hasLastPosition = true;
  }

  /**
   * Where a clock value sits inside the current cycle, for the start curves.
   *
   * @param at - The clock value.
   * @returns The fraction in `[0, 1]`.
   */
  #cycleFraction(at: number): number {
    const main = this.definition.main;
    const fraction = (at - this.#cycleStart - main.startDelay) / main.duration;
    return fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction;
  }

  /**
   * Writes one record, counting the live particle it displaced if the ring had wrapped.
   *
   * @param spawnTime - The clock the particle is born at.
   */
  #spawn(spawnTime: number): void {
    const definition = this.definition;
    const rng = this.#rng;
    const position = this.#position;
    const direction = this.#direction;
    const ring = this.ring;
    if (ring.written >= ring.capacity && !isDead(ring.floats, ring.head * RECORD_FLOATS, Math.fround(spawnTime))) {
      this.#droppedTotal += 1;
    }
    sampleShape(definition.shape, rng, this.#meshTable, position, direction);
    const t = this.#cycleFraction(spawnTime);
    const start = definition.start;
    const lifetime = resolveScalar(start.lifetime, rng.next(), t);
    const speed = resolveScalar(start.speed, rng.next(), t);
    const size = resolveScalar(start.size, rng.next(), t);
    const rotation = resolveScalar(start.rotation, rng.next(), t) * DEG_TO_RAD;
    direction[0] = (direction[0] ?? 0) * speed;
    direction[1] = (direction[1] ?? 0) * speed;
    direction[2] = (direction[2] ?? 0) * speed;
    if (definition.main.simulationSpace === "world") {
      transformPoint(this.emitterWorld, position);
      transformDirection(this.emitterWorld, direction);
    }
    const seed = recordSeed(this.#seed, ring.written, this.#words);
    ring.write(
      spawnTime,
      lifetime,
      seed,
      0,
      component(position, 0),
      component(position, 1),
      component(position, 2),
      size,
      component(direction, 0),
      component(direction, 1),
      component(direction, 2),
      rotation,
    );
    this.#emittedTotal += 1;
  }
}

/**
 * Reads one component of a scratch vector `sampleShape` filled in.
 *
 * @param vector - The vector.
 * @param index - Which component.
 * @returns The component, or zero when the vector is shorter than the index.
 */
function component(vector: Float32Array, index: number): number {
  return vector[index] ?? 0;
}

/**
 * A fresh identity matrix.
 *
 * @returns Sixteen column-major floats.
 */
function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}
