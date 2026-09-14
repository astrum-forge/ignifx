import { Vec2 } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import {
  createSpriteScratch,
  createSpriteVisibilityScratch,
  updateSprite,
  updateSpriteVisibility,
  writeScratch,
} from "../lite/sprite-layer.js";
import { spriteRotationToLite, worldToPixelsToRef } from "../math/coords.js";
import { DEFAULT_SORTING_LAYER } from "./sorting-layers.js";
import type { TwoDRuntime } from "./runtime.js";
import type { SpriteAtlasAsset } from "../atlas/sprite-atlas-asset.js";
import type { SpriteBlendName, SpriteScratch, SpriteVisibilityScratch } from "../lite/sprite-layer.js";
import type { LiteSprite2DHandle, LiteSprite2DLayer } from "../lite/types.js";
import type { AssetHandle, MutableVec2 } from "@ignifx/core";

/**
 * `app.twoD.createSpriteBatch` (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2): a
 * fixed-capacity crowd of sprites that no entity owns.
 *
 * A `SpriteRenderer` is the right tool for a sprite that is a *thing* in the world — it has a
 * transform, it can be picked, it serializes. It is the wrong tool for ten thousand bullets, sparks
 * or particles: each one would cost an entity, a component, a transform and a slot in the sync
 * system's walk. A batch is the other end of that trade. It claims `capacity` slots in one Lite
 * layer once, and from then on the caller addresses them by index with a single allocation-free
 * `write` per sprite per frame.
 *
 * ## Why writes flush eagerly
 *
 * The alternative — record the caller's values into a shadow typed array and push them into Lite
 * from a `PreRender` hook — buys nothing here. `updateSprite2D` writes straight into the layer's
 * own `Float32Array` and marks a dirty range that the renderer uploads once at draw time
 * (`lib/sprite/sprite-2d.js`, `writeInstance` and `markDirty`), so a deferred flush would be a
 * second copy of the same numbers and a second pass over them. Writing eagerly is one write per
 * `write()` call and needs no per-frame hook of its own — so the batch has no ordering requirement
 * beyond "before the frame draws", which every phase up to `PreRender` satisfies.
 *
 * The batch itself allocates nothing per write: one scratch props record, one scratch vector, and
 * the two flag arrays are built once. Lite's `updateSprite2DIndex` does take a `subarray` view of
 * the instance data on every call, so one small view object per written sprite per frame is
 * unavoidable through its public API — the same cost the sync system already pays for every sprite
 * that moved (`lib/sprite/sprite-2d.js`). It is an upstream ask, not something a shadow buffer here
 * would avoid, because a deferred flush would make the same call.
 *
 * ## What a batch does not do
 *
 * - **Picking.** Batch slots hold no component, so `app.twoD.pickAt` never resolves one. Address a
 *   batch sprite by the index the caller already has.
 * - **Per-batch Y-sort.** A batch does not sort its own slots in v1. It inherits whatever the Lite
 *   layer does: on a sorting layer the `ySort` setting names, Lite sorts the batch's sprites
 *   together with every `SpriteRenderer` sharing that layer; otherwise slots draw in index order.
 *   Y-sort is not free at this scale — any position change marks Lite's whole layer unsorted and
 *   costs a merge sort and a full re-upload of it that frame (`lib/sprite/sprite-2d-y-sort.js`,
 *   `observeDirty` and `ensureSorted`) — so a big moving batch belongs on a sorting layer that does
 *   not Y-sort.
 * - **Pivots.** Every slot is centred on the `(x, y)` it is written at. Lite carries one pivot per
 *   layer and `SpriteFrame.pivot` is not read by the 2D pipeline, so a batch skips the per-frame
 *   pivot arithmetic a `SpriteRenderer` pays for (see `pivotedPositionToRef`).
 */

/** Returned by a headless batch's `lite.handles`, so the getter allocates no array. */
const NO_HANDLES: readonly LiteSprite2DHandle[] = Object.freeze([]);

/**
 * What {@link TwoDService.createSpriteBatch} accepts.
 *
 * @beta
 */
export interface SpriteBatchOptions {
  /**
   * The atlas every sprite in the batch draws a frame of. It must already be loaded.
   *
   * @remarks
   * The batch does not retain the handle: hold it for as long as the batch lives, exactly as a
   * `SpriteRenderer.sprite` holder does.
   */
  readonly atlas: AssetHandle<SpriteAtlasAsset>;
  /** How many sprite slots to claim. Fixed for the batch's life; a whole number of at least 1. */
  readonly capacity: number;
  /** Which sorting layer the batch draws on. Defaults to `"Default"`. */
  readonly sortingLayer?: string;
  /** How the sprites' colour combines with the background. Defaults to `"alpha"`. */
  readonly blend?: SpriteBlendName;
  /** Whether the batch keeps the identity view instead of following the `Camera2D`. */
  readonly screenSpace?: boolean;
}

/**
 * The Babylon Lite objects a {@link SpriteBatch} owns. Unstable escape hatch
 * (`CONSTITUTION.md` §3.4).
 *
 * @beta
 */
export interface SpriteBatchLiteHandles {
  /**
   * One handle per slot, in slot order; empty under a headless app and after `dispose()`.
   *
   * @remarks
   * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
   */
  readonly handles: readonly LiteSprite2DHandle[];
}

/**
 * A fixed-capacity crowd of sprites addressed by index, for bullet hells, debris, and 2D particles.
 *
 * @remarks
 * Under a headless app the batch is state only: it validates indices and remembers `count`, and
 * writes nothing, because there is no uploaded atlas to draw from
 * (`docs/architecture/07-rendering.md` §6).
 *
 * @example
 * ```ts
 * using batch = app.twoD.createSpriteBatch({ atlas, capacity: 1024, blend: "additive" });
 * batch.count = 3;
 * batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
 * ```
 *
 * @beta
 */
export interface SpriteBatch {
  /** How many slots the batch claimed. Fixed for its life. */
  readonly capacity: number;
  /**
   * How many leading slots draw. Slots at an index of `count` or above are hidden.
   *
   * @remarks
   * Lowering `count` hides the slots that fall out of range; raising it again reveals those that
   * have been written since the batch was created and not explicitly hidden, with the geometry they
   * last carried. A slot that was never written stays invisible until it is.
   *
   * @throws IgnifxError with code `IGX-1115` when the value is not a whole number in
   * `0 .. capacity`, or `IGX-1116` when the batch is disposed.
   */
  count: number;
  /**
   * Writes one slot, in **world** units: metres, +Y up, exactly as a `SpriteRenderer`'s transform
   * and frame mean them. The batch applies `pixelsPerUnit` and the +Y-down flip itself.
   *
   * @remarks
   * `pixelsPerUnit` is read at the moment of the write, so a scene that changes it does not move
   * slots written before the change; rewrite them.
   *
   * @param index - The slot, in `0 .. capacity - 1`.
   * @param x - The sprite's centre, in world metres.
   * @param y - The sprite's centre, in world metres, +Y up.
   * @param width - The drawn width, in world metres.
   * @param height - The drawn height, in world metres.
   * @param frame - The atlas frame index; floored, and replaced by frame 0 when out of range.
   * @param rotation - The rotation, in degrees counter-clockwise, as `Transform.rotation2D` reads.
   * @param r - The red tint, `0` to `1`.
   * @param g - The green tint.
   * @param b - The blue tint.
   * @param a - The alpha.
   * @param flipX - Whether the sprite is mirrored horizontally. Defaults to `false`.
   * @param flipY - Whether the sprite is mirrored vertically. Defaults to `false`.
   * @throws IgnifxError with code `IGX-1115` for a slot outside the capacity, or `IGX-1116` when
   * the batch is disposed.
   */
  // oxlint-disable-next-line max-params -- one call per sprite per frame; an options object would allocate.
  write(
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    frame: number,
    rotation: number,
    r: number,
    g: number,
    b: number,
    a: number,
    flipX?: boolean,
    flipY?: boolean,
  ): void;
  /**
   * Hides one slot until it is written again, whatever `count` says.
   *
   * @param index - The slot.
   * @throws IgnifxError with code `IGX-1115` for a slot outside the capacity, or `IGX-1116` when
   * the batch is disposed.
   */
  hide(index: number): void;
  /**
   * Releases every slot back to its Lite layer. Idempotent; the batch cannot be reused afterwards.
   */
  dispose(): void;
  /**
   * The Babylon Lite objects the batch owns. Unstable escape hatch
   * (`CONSTITUTION.md` §3.4).
   */
  readonly lite: SpriteBatchLiteHandles;
  /** Disposes the batch when it leaves a `using` block — exactly {@link SpriteBatch.dispose}. */
  [Symbol.dispose](): void;
}

/**
 * The one implementation of {@link SpriteBatch}.
 */
class SpriteBatchImpl implements SpriteBatch {
  readonly capacity: number;

  readonly #runtime: TwoDRuntime;

  /** How many frames the atlas declares, so an out-of-range frame draws frame 0 as sprites do. */
  readonly #frameCount: number;

  /** The key of the Lite layer holding the slots, or `null` under a headless app. */
  #key: string | null = null;

  /** The Lite layer holding the slots, so {@link SpriteBatchImpl.#live} can read its count. */
  #layer: LiteSprite2DLayer | null = null;

  /** One handle per slot, or `null` under a headless app and after disposal. */
  #handles: LiteSprite2DHandle[] | null = null;

  /** Per slot: `1` once written and not hidden, so raising `count` can reveal it again. */
  readonly #wanted: Uint8Array;

  /** Per slot: the visibility Lite currently holds, so a `count` change writes only what changed. */
  readonly #applied: Uint8Array;

  #count = 0;

  #isDisposed = false;

  readonly #scratch: SpriteScratch = createSpriteScratch();

  readonly #visibility: SpriteVisibilityScratch = createSpriteVisibilityScratch();

  readonly #pixels: MutableVec2 = new Vec2();

  /**
   * Claims the slots. `app.twoD.createSpriteBatch` does this; a game never constructs one.
   *
   * @param runtime - The app's 2D runtime state.
   * @param options - The atlas, the capacity, and the layer key's other parts.
   * @throws IgnifxError with code `IGX-1114` for a capacity that is not a whole number of at least
   * 1, `IGX-1117` for an atlas that has not finished loading, or `IGX-1107` for an undeclared
   * sorting layer.
   */
  constructor(runtime: TwoDRuntime, options: SpriteBatchOptions) {
    const capacity = options.capacity;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw twoDError(
        TwoDErrorCode.invalidBatchCapacity,
        `A sprite batch capacity must be a whole number of at least 1; got ${String(capacity)}.`,
        { context: { capacity }, hint: "Pass the largest number of sprites the batch will ever draw." },
      );
    }
    const handle = options.atlas;
    if (handle.state !== "loaded") {
      throw twoDError(
        TwoDErrorCode.batchAtlasNotLoaded,
        `The atlas handle for a sprite batch is ${handle.state}, not loaded.`,
        {
          context: { address: handle.address, state: handle.state },
          hint: "Await the handle's promise before creating the batch.",
        },
      );
    }
    const atlas = handle.value;
    const sortingLayer = options.sortingLayer ?? DEFAULT_SORTING_LAYER;
    // Refuse an undeclared sorting layer here rather than on the first write, where the throw would
    // land in the middle of a frame.
    runtime.sortingLayers.require(sortingLayer);
    this.capacity = capacity;
    this.#runtime = runtime;
    this.#frameCount = atlas.frameCount;
    this.#wanted = new Uint8Array(capacity);
    this.#applied = new Uint8Array(capacity);
    if (atlas.lite.atlas === null) {
      // Headless: no layer, no handles, state only.
      return;
    }
    const handles: LiteSprite2DHandle[] = [];
    // Every slot starts invisible and zero-sized, so a batch that is created and not written draws
    // nothing at all.
    writeScratch(this.#scratch, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, false, false, false);
    const placed = runtime.layers.placeBatch(
      sortingLayer,
      atlas,
      options.blend ?? "alpha",
      options.screenSpace === true,
      capacity,
      this.#scratch,
      handles,
    );
    this.#key = placed.key;
    this.#layer = placed.layer;
    this.#handles = handles;
  }

  /**
   * How many leading slots draw.
   *
   * @returns The count.
   */
  get count(): number {
    return this.#count;
  }

  /**
   * Sets how many leading slots draw.
   *
   * @param value - The new count, in `0 .. capacity`.
   */
  set count(value: number) {
    this.#requireNotDisposed();
    if (!Number.isInteger(value) || value < 0 || value > this.capacity) {
      throw twoDError(TwoDErrorCode.batchIndexOutOfRange, `${String(value)} is outside the sprite batch's slots.`, {
        context: { index: value, capacity: this.capacity },
        hint: "A batch's count runs from 0 to its capacity.",
      });
    }
    const previous = this.#count;
    if (value === previous) {
      return;
    }
    this.#count = value;
    if (value < previous) {
      for (let index = value; index < previous; index += 1) {
        this.#setVisible(index, false);
      }
      return;
    }
    for (let index = previous; index < value; index += 1) {
      if (this.#wanted[index] === 1) {
        this.#setVisible(index, true);
      }
    }
  }

  /**
   * The Babylon Lite objects the batch owns.
   *
   * @returns The handles, in slot order.
   */
  get lite(): SpriteBatchLiteHandles {
    return { handles: this.#handles ?? NO_HANDLES };
  }

  /**
   * Writes one slot.
   *
   * @param index - The slot.
   * @param x - The centre, in world metres.
   * @param y - The centre, in world metres, +Y up.
   * @param width - The drawn width, in world metres.
   * @param height - The drawn height, in world metres.
   * @param frame - The atlas frame index.
   * @param rotation - The rotation, in degrees counter-clockwise.
   * @param r - The red tint.
   * @param g - The green tint.
   * @param b - The blue tint.
   * @param a - The alpha.
   * @param flipX - Whether the sprite is mirrored horizontally.
   * @param flipY - Whether the sprite is mirrored vertically.
   */
  // oxlint-disable-next-line max-params -- one call per sprite per frame; an options object would allocate.
  write(
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    frame: number,
    rotation: number,
    r: number,
    g: number,
    b: number,
    a: number,
    flipX = false,
    flipY = false,
  ): void {
    this.#requireSlot(index);
    this.#wanted[index] = 1;
    // `undefined` under a headless app and once the layer is gone: the batch is state only then.
    const handle = this.#live()?.[index];
    if (handle === undefined) {
      return;
    }
    const pixelsPerUnit = this.#runtime.pixelsPerUnit;
    const position = worldToPixelsToRef(x, y, pixelsPerUnit, this.#pixels);
    const whole = Math.floor(frame);
    // Lite throws on a frame index outside the atlas; a `SpriteRenderer` falls back to frame 0
    // instead, and a batch driven by a frame-over-time curve needs the same tolerance.
    const safeFrame = whole >= 0 && whole < this.#frameCount ? whole : 0;
    const isVisible = index < this.#count;
    writeScratch(
      this.#scratch,
      position.x,
      position.y,
      width * pixelsPerUnit,
      height * pixelsPerUnit,
      safeFrame,
      spriteRotationToLite(rotation),
      r,
      g,
      b,
      a,
      flipX,
      flipY,
      isVisible,
    );
    updateSprite(handle, this.#scratch);
    this.#applied[index] = isVisible ? 1 : 0;
  }

  /**
   * Hides one slot until it is written again.
   *
   * @param index - The slot.
   */
  hide(index: number): void {
    this.#requireSlot(index);
    this.#wanted[index] = 0;
    this.#setVisible(index, false);
  }

  /**
   * Releases every slot back to its Lite layer.
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#count = 0;
    const handles = this.#handles;
    const key = this.#key;
    this.#handles = null;
    this.#key = null;
    this.#layer = null;
    if (handles === null || key === null) {
      return;
    }
    // Back to front: Lite swap-removes, so taking the last slot first never moves a slot this loop
    // has yet to reach. `removeRaw` tolerates a handle whose layer is already gone, which is what
    // happens when the app was disposed first.
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      const handle = handles[index];
      if (handle !== undefined) {
        this.#runtime.layers.removeRaw(key, handle);
      }
    }
    handles.length = 0;
  }

  /**
   * Disposes the batch at the end of a `using` block.
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Shows or hides one slot, skipping the write when Lite already agrees.
   *
   * @param index - The slot.
   * @param isVisible - Whether it should draw.
   */
  #setVisible(index: number, isVisible: boolean): void {
    const handle = this.#live()?.[index];
    if (handle === undefined) {
      return;
    }
    const flag = isVisible ? 1 : 0;
    if (this.#applied[index] === flag) {
      return;
    }
    updateSpriteVisibility(handle, this.#visibility, isVisible);
    this.#applied[index] = flag;
  }

  /**
   * The handles, or `null` once the layer holding them is gone.
   *
   * @remarks
   * `app.dispose()` empties every layer, which kills the batch's handles — and writing through a
   * dead handle is a raw Lite throw, not an ignifx error. The check that catches it has to be free,
   * because it runs on every write: the batch's own slots are always in the layer, so the layer's
   * `count` can never fall below the batch's capacity while they live, and a smaller count means
   * they are gone. That is one property read, where asking Lite whether a handle is alive would be
   * another hash lookup per sprite per frame.
   *
   * @returns The handles, or `null`.
   */
  #live(): LiteSprite2DHandle[] | null {
    const layer = this.#layer;
    if (layer === null) {
      return null;
    }
    if (layer.count < this.capacity) {
      this.#layer = null;
      this.#handles = null;
      this.#key = null;
      return null;
    }
    return this.#handles;
  }

  /**
   * Refuses a slot index the batch does not have, and a batch that is gone.
   *
   * @param index - The slot.
   */
  #requireSlot(index: number): void {
    this.#requireNotDisposed();
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) {
      throw twoDError(TwoDErrorCode.batchIndexOutOfRange, `${String(index)} is outside the sprite batch's slots.`, {
        context: { index, capacity: this.capacity },
        hint: "Slots run from 0 to capacity - 1.",
      });
    }
  }

  /**
   * Refuses a batch that has been disposed.
   */
  #requireNotDisposed(): void {
    if (this.#isDisposed) {
      throw twoDError(TwoDErrorCode.batchDisposed, "This sprite batch was disposed; create another one.", {
        hint: "Create a new batch with app.twoD.createSpriteBatch.",
      });
    }
  }
}

/**
 * Builds a sprite batch. `TwoDService.createSpriteBatch` is the public door.
 *
 * @param runtime - The app's 2D runtime state.
 * @param options - The atlas, the capacity, and the layer key's other parts.
 * @returns The batch.
 *
 * @internal
 */
export function createSpriteBatch(runtime: TwoDRuntime, options: SpriteBatchOptions): SpriteBatch {
  return new SpriteBatchImpl(runtime, options);
}
