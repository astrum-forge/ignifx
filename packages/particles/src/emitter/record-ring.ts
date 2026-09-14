// The CPU mirror of the storage buffer the vertex shader indexes
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.4). A record is 48 bytes in the byte order
// the WGSL `Particle` struct declares, so it uploads unchanged.

/**
 * Floats per record.
 *
 * @beta
 */
export const RECORD_FLOATS = 12;

/**
 * Bytes per record, matching the WGSL `Particle` struct's size.
 *
 * @beta
 */
export const RECORD_BYTES: number = RECORD_FLOATS * 4;

/**
 * The float index of `spawnTime` inside a record.
 *
 * @beta
 */
export const RECORD_SPAWN_TIME = 0;

/**
 * The float index of `lifetime` inside a record.
 *
 * @beta
 */
export const RECORD_LIFETIME = 1;

/**
 * The word index of `seed` inside a record; read it from the ring's `words`, not its floats.
 *
 * @beta
 */
export const RECORD_SEED = 2;

/** The word index of `flags` inside a record. */
export const RECORD_FLAGS = 3;

/**
 * The float index of `position.x` inside a record.
 *
 * @beta
 */
export const RECORD_POSITION = 4;

/**
 * The float index of `size` inside a record.
 *
 * @beta
 */
export const RECORD_SIZE = 7;

/**
 * The float index of `velocity.x` inside a record.
 *
 * @beta
 */
export const RECORD_VELOCITY = 8;

/**
 * The float index of `rotation` inside a record, in radians.
 *
 * @beta
 */
export const RECORD_ROTATION = 11;

/**
 * A contiguous run of records to upload, in slots.
 *
 * @beta
 */
export interface UploadRange {
  /** The first slot. */
  readonly start: number;
  /** How many records. */
  readonly count: number;
}

/**
 * What one reconciliation pass found.
 *
 * @beta
 */
export interface RingCensus {
  /** Records whose age is inside their lifetime. Exact. */
  alive: number;
  /** Records from the newest back to the oldest still alive: what the GPU draws. */
  drawCount: number;
}

/**
 * The CPU copy of a system's spawn records. Record `n` lives in slot `n % capacity`, so the newest
 * record is the one the shader draws first and an overwritten record simply disappears.
 *
 * @beta
 */
export class SpawnRecordRing {
  /** How many records the ring holds. */
  readonly capacity: number;

  /** The records as floats, `capacity * RECORD_FLOATS` long. */
  readonly floats: Float32Array;

  /** The same bytes as words, for `seed` and `flags`. */
  readonly words: Uint32Array;

  #written = 0;

  #uploaded = 0;

  #tail = 0;

  readonly #rangeA: { start: number; count: number } = { start: 0, count: 0 };

  readonly #rangeB: { start: number; count: number } = { start: 0, count: 0 };

  /**
   * Allocates a ring.
   *
   * @param capacity - How many records it holds; at least one.
   */
  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.trunc(capacity));
    const buffer = new ArrayBuffer(this.capacity * RECORD_BYTES);
    this.floats = new Float32Array(buffer);
    this.words = new Uint32Array(buffer);
  }

  /**
   * How many records have been written since the last clear.
   *
   * @returns The count; it never decreases except through {@link SpawnRecordRing.clear}.
   */
  get written(): number {
    return this.#written;
  }

  /**
   * The slot the next record goes into.
   *
   * @returns `written % capacity`.
   */
  get head(): number {
    return this.#written % this.capacity;
  }

  /**
   * The index of the oldest record still inside the draw window.
   *
   * @returns The record index, not the slot.
   */
  get tail(): number {
    return this.#tail;
  }

  /**
   * How many records have been written and not yet uploaded, capped at the capacity because older
   * ones were overwritten anyway.
   *
   * @returns The pending count.
   */
  get pendingCount(): number {
    return Math.min(this.#written - this.#uploaded, this.capacity);
  }

  /**
   * The slot of a record.
   *
   * @param index - The record index.
   * @returns The slot.
   */
  slotOf(index: number): number {
    return index % this.capacity;
  }

  /**
   * Writes one record and returns its slot.
   *
   * @param spawnTime - The system clock at spawn.
   * @param lifetime - Seconds the particle lives.
   * @param seed - The per-record hash seed.
   * @param flags - Reserved; write `0`.
   * @param px - Start position X.
   * @param py - Start position Y.
   * @param pz - Start position Z.
   * @param size - Start size.
   * @param vx - Start velocity X.
   * @param vy - Start velocity Y.
   * @param vz - Start velocity Z.
   * @param rotation - Start rotation, in radians.
   * @returns The slot written.
   */
  write(
    spawnTime: number,
    lifetime: number,
    seed: number,
    flags: number,
    px: number,
    py: number,
    pz: number,
    size: number,
    vx: number,
    vy: number,
    vz: number,
    rotation: number,
  ): number {
    const slot = this.#written % this.capacity;
    const base = slot * RECORD_FLOATS;
    const floats = this.floats;
    const words = this.words;
    floats[base + RECORD_SPAWN_TIME] = spawnTime;
    floats[base + RECORD_LIFETIME] = lifetime;
    words[base + RECORD_SEED] = seed >>> 0;
    words[base + RECORD_FLAGS] = flags >>> 0;
    floats[base + RECORD_POSITION] = px;
    floats[base + RECORD_POSITION + 1] = py;
    floats[base + RECORD_POSITION + 2] = pz;
    floats[base + RECORD_SIZE] = size;
    floats[base + RECORD_VELOCITY] = vx;
    floats[base + RECORD_VELOCITY + 1] = vy;
    floats[base + RECORD_VELOCITY + 2] = vz;
    floats[base + RECORD_ROTATION] = rotation;
    this.#written += 1;
    return slot;
  }

  /**
   * The runs of slots written since the last upload, at most two because a ring wraps at most once
   * per frame that matters — anything older than a whole ring was overwritten.
   *
   * @param out - Receives up to two ranges.
   * @returns How many of `out`'s entries are meaningful: `0`, `1`, or `2`.
   */
  pendingRanges(out: [UploadRange, UploadRange]): number {
    const pending = this.pendingCount;
    if (pending === 0) {
      return 0;
    }
    if (pending >= this.capacity) {
      this.#rangeA.start = 0;
      this.#rangeA.count = this.capacity;
      out[0] = this.#rangeA;
      return 1;
    }
    const startIndex = this.#written - pending;
    const startSlot = startIndex % this.capacity;
    const endSlot = startSlot + pending;
    if (endSlot <= this.capacity) {
      this.#rangeA.start = startSlot;
      this.#rangeA.count = pending;
      out[0] = this.#rangeA;
      return 1;
    }
    this.#rangeA.start = startSlot;
    this.#rangeA.count = this.capacity - startSlot;
    this.#rangeB.start = 0;
    this.#rangeB.count = endSlot - this.capacity;
    out[0] = this.#rangeA;
    out[1] = this.#rangeB;
    return 2;
  }

  /** Records that everything written so far has reached the GPU. */
  markUploaded(): void {
    this.#uploaded = this.#written;
  }

  /**
   * Advances the tail past leading dead records and counts the alive ones behind it. One pass over
   * the draw window, no allocation.
   *
   * @param clock - The system clock.
   * @param out - Receives the counts.
   * @returns `out`.
   */
  reconcile(clock: number, out: RingCensus): RingCensus {
    const written = this.#written;
    const capacity = this.capacity;
    const floats = this.floats;
    // The shader reads the clock as an `f32` uniform, and a spawn time is rounded to `f32` on the
    // way into the ring. Comparing in `f32` here is what stops a particle born this frame from
    // looking unborn and being left behind the tail for ever.
    const now = Math.fround(clock);
    let tail = Math.max(this.#tail, written - capacity);
    while (tail < written && isDead(floats, (tail % capacity) * RECORD_FLOATS, now)) {
      tail += 1;
    }
    this.#tail = tail;
    let alive = 0;
    for (let index = tail; index < written; index += 1) {
      if (!isDead(floats, (index % capacity) * RECORD_FLOATS, now)) {
        alive += 1;
      }
    }
    out.alive = alive;
    out.drawCount = written - tail;
    return out;
  }

  /** Forgets every record, so the next frame draws nothing and uploads nothing. */
  clear(): void {
    this.#written = 0;
    this.#uploaded = 0;
    this.#tail = 0;
  }
}

/**
 * Whether a record is dead at a clock: the same rule the shader applies, `age < 0 || age > lifetime`.
 *
 * @param floats - The ring's floats.
 * @param base - The record's first float index.
 * @param clock - The system clock, already rounded to `f32` by the caller.
 * @returns `true` when the shader would collapse the record.
 */
export function isDead(floats: Float32Array, base: number, clock: number): boolean {
  const age = clock - (floats[base + RECORD_SPAWN_TIME] ?? 0);
  return age < 0 || age > (floats[base + RECORD_LIFETIME] ?? 0);
}
