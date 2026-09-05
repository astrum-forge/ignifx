/**
 * Generation-checked handle allocation (`docs/architecture/00-overview.md` §5). A handle packs a
 * dense slot index with the generation the slot was on when the handle was issued, so a handle kept
 * across a destroy resolves to `null` instead of to whatever object recycled the slot — the bug
 * that dense-index-only schemes are famous for.
 */

/** How many low bits of a handle carry the slot index: 2^20 = 1,048,576 live objects. */
const INDEX_BITS = 20;

/** The mask that extracts the slot index. */
const INDEX_MASK = (1 << INDEX_BITS) - 1;

/** How many generations a slot cycles through before wrapping: 2^11 = 2048. */
const GENERATION_LIMIT = 1 << 11;

/** The highest slot index the packing supports. */
const MAX_SLOTS = INDEX_MASK;

/**
 * A dense table of live objects addressed by generation-checked handles.
 *
 * @typeParam T - The object type stored in the table.
 *
 * @remarks
 * Slot zero is never handed out, so the handle `0` (`INVALID_HANDLE`) can mean "no handle". Freed slots
 * are pushed on a free list and reused in last-freed-first order; each reuse bumps the slot's
 * generation, which is what invalidates the old handle. Generations wrap after 2048 reuses of the
 * same* slot, at which point a handle that old could alias again — the same trade-off Unity and
 * Bevy make, documented here rather than papered over.
 *
 * @example
 * ```ts
 * const allocator = new HandleAllocator<Entity>();
 * const handle = allocator.allocate(entity);
 * allocator.get(handle); // entity
 * allocator.release(handle);
 * allocator.get(handle); // null
 * ```
 *
 * @internal
 */
export class HandleAllocator<T> {
  /** Value per slot; `null` while a slot is reserved but not yet bound. Index 0 is never used. */
  readonly #values: (T | null)[] = [null];

  /** Whether each slot is currently handed out. Index 0 is permanently free. */
  readonly #live: boolean[] = [false];

  /** Current generation per slot. Index 0 is permanently unused. */
  readonly #generations: number[] = [0];

  /** Indices of freed slots, reused last-freed-first. */
  readonly #free: number[] = [];

  /** How many slots currently hold a value. */
  #size = 0;

  /**
   * How many handles are currently live.
   *
   * @returns The number of occupied slots.
   */
  get size(): number {
    return this.#size;
  }

  /**
   * How many slots the table has ever grown to, live or free. Exposed for tests that assert slot
   * reuse rather than growth.
   *
   * @returns The slot count, including the permanently unused slot zero.
   */
  get capacity(): number {
    return this.#values.length;
  }

  /**
   * Stores a value and issues a handle for it.
   *
   * @param value - The object to store.
   * @returns The packed handle. Brand it with `toEntityHandle`/`toComponentHandle`.
   * @throws RangeError when the table is full (2^20 - 1 live objects).
   */
  allocate(value: T): number {
    const handle = this.reserve();
    this.bind(handle, value);
    return handle;
  }

  /**
   * Takes a slot without a value yet, for an object whose constructor needs its own handle.
   *
   * @returns The packed handle. Until {@link HandleAllocator.bind} runs, resolving it yields
   * `null`, exactly as a stale handle does.
   * @throws RangeError when the table is full (2^20 - 1 live objects).
   */
  reserve(): number {
    const recycled = this.#free.pop();
    if (recycled !== undefined) {
      const next = ((this.#generations[recycled] ?? 0) + 1) % GENERATION_LIMIT;
      // Generation zero would collide with the "never allocated" state, so wrapping skips it.
      const generation = next === 0 ? 1 : next;
      this.#generations[recycled] = generation;
      this.#values[recycled] = null;
      this.#live[recycled] = true;
      this.#size += 1;
      return (generation << INDEX_BITS) | recycled;
    }
    const index = this.#values.length;
    if (index > MAX_SLOTS) {
      throw new RangeError(`The handle table is full at ${String(MAX_SLOTS)} live objects.`);
    }
    this.#values.push(null);
    this.#generations.push(1);
    this.#live.push(true);
    this.#size += 1;
    return (1 << INDEX_BITS) | index;
  }

  /**
   * Stores the value of a reserved slot.
   *
   * @param handle - The handle {@link HandleAllocator.reserve} returned.
   * @param value - The object to store.
   */
  bind(handle: number, value: T): void {
    if (!this.isLive(handle)) {
      return;
    }
    this.#values[slotOf(handle)] = value;
  }

  /**
   * Resolves a handle.
   *
   * @param handle - A handle from {@link HandleAllocator.allocate}.
   * @returns The stored value, or `null` when the handle is stale, was never issued, or is zero.
   */
  get(handle: number): T | null {
    if (!this.isLive(handle)) {
      return null;
    }
    return this.#values[slotOf(handle)] ?? null;
  }

  /**
   * Reports whether a handle still resolves.
   *
   * @param handle - The handle to test.
   * @returns `true` when {@link HandleAllocator.get} would return a value.
   */
  isLive(handle: number): boolean {
    const slot = slotOf(handle);
    if (slot === 0 || slot >= this.#values.length) {
      return false;
    }
    return this.#generations[slot] === handle >>> INDEX_BITS && this.#live[slot] === true;
  }

  /**
   * Frees the slot a handle points at, invalidating that handle and every older one for the slot.
   *
   * @param handle - The handle to release.
   * @returns `true` when a live slot was freed, `false` when the handle was already stale.
   */
  release(handle: number): boolean {
    if (!this.isLive(handle)) {
      return false;
    }
    const slot = slotOf(handle);
    this.#values[slot] = null;
    this.#live[slot] = false;
    this.#free.push(slot);
    this.#size -= 1;
    return true;
  }

  /** Frees every slot and forgets every generation, as if the allocator were new. */
  clear(): void {
    this.#values.length = 1;
    this.#generations.length = 1;
    this.#live.length = 1;
    this.#free.length = 0;
    this.#size = 0;
  }
}

/**
 * The slot a handle points at.
 *
 * @param handle - The packed handle.
 * @returns The dense slot index.
 */
function slotOf(handle: number): number {
  return handle & INDEX_MASK;
}
