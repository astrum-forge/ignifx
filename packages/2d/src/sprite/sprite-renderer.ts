import {
  asset,
  bool,
  color,
  Component,
  createDefaults,
  defineSchema,
  enumOf,
  i32,
  optional,
  str,
  vec2,
} from "@ignifx/core";
import { SpriteAtlasAsset } from "../atlas/sprite-atlas-asset.js";
import { SPRITE_BLEND_MODES } from "../lite/sprite-layer.js";
import { DEFAULT_SORTING_LAYER } from "../service/sorting-layers.js";
import type { SpriteBlendName } from "../lite/sprite-layer.js";
import type { LiteSprite2DHandle } from "../lite/types.js";
import type { AssetHandle, ColorLike, ComponentHooks, Schema, Vec2Like } from "@ignifx/core";

/**
 * `SpriteRenderer` (`docs/architecture/11-2d-toolkit.md` §2.2): one sprite drawn from one frame of
 * one atlas.
 *
 * The component holds a single Lite sprite handle inside the layer that matches its
 * (sorting layer, atlas, blend mode, screen-space) key. It creates nothing itself: the 2D sync
 * system owns every layer, so the component only records which layer it belongs in and lets the
 * system reconcile that against the layer it is currently in.
 */

/**
 * The layer key a sprite belongs to.
 *
 * @remarks
 * Two sprites share a Lite layer exactly when all four parts match. The atlas is part of the key
 * because a `Sprite2DLayer` is bound to one atlas for its whole life (`index.d.ts` 11885,
 * `readonly atlas`), and the blend mode is part of it for the same reason (`readonly blendMode`).
 *
 * @public
 */
export interface SpriteLayerKey {
  /** The sorting layer's name. */
  readonly sortingLayer: string;
  /** The atlas every sprite in the layer draws from. */
  readonly atlas: SpriteAtlasAsset;
  /** The blend mode. */
  readonly blend: SpriteBlendName;
  /** Whether the layer keeps the identity view instead of following the `Camera2D`. */
  readonly screenSpace: boolean;
}

/**
 * A sprite.
 *
 * @remarks
 * The `sprite` field is an atlas handle; the frame inside it comes from the address's `#frame:`
 * fragment when there is one, and otherwise from {@link SpriteRenderer.frame}, which game code and
 * `SpriteAnimator` both write. A sprite whose atlas has not finished loading draws nothing and
 * costs nothing.
 *
 * @example
 * ```ts
 * const hero = app.world.createEntity({ name: "hero" });
 * const sprite = hero.addComponent(SpriteRenderer);
 * sprite.sprite = app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json").retain();
 * sprite.sortingLayer = "Default";
 * ```
 *
 * @public
 */
export class SpriteRenderer extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/SpriteRenderer";

  /** Several sprites may share an entity — a character and its shadow, for instance. */
  static allowMultiple = true;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = spriteRendererSchema();

  /** The atlas this sprite draws a frame of. */
  declare sprite: AssetHandle<SpriteAtlasAsset> | null;

  /** The tint multiplied into every texel. */
  declare color: ColorLike;

  /** Whether the sprite is mirrored horizontally. */
  declare flipX: boolean;

  /** Whether the sprite is mirrored vertically. */
  declare flipY: boolean;

  /** Which sorting layer the sprite draws on. */
  declare sortingLayer: string;

  /** The sub-order within the sorting layer; higher draws in front. */
  declare orderInLayer: number;

  /** How the sprite's colour combines with what is behind it. */
  declare blend: SpriteBlendName;

  /** The pivot in `[0, 1]` of the frame, overriding the frame's own; `null` uses the frame's. */
  declare pivotOverride: Vec2Like | null;

  /** Whether the sprite keeps the identity view instead of following the `Camera2D`. */
  declare screenSpace: boolean;

  /** Whether `app.twoD.pickAt` considers this sprite. */
  declare pickable: boolean;

  /** The atlas frame index drawn; `SpriteAnimator` writes this. */
  #frame = 0;

  /** The Lite handle, or `null` while the sprite is not in a layer. */
  #handle: LiteSprite2DHandle | null = null;

  /** The key of the layer the handle currently lives in, or `null`. */
  #layerKey: string | null = null;

  /** The `worldMatrixVersion` the last sync wrote at, so a still entity costs one comparison. */
  #syncedMatrixVersion = -1;

  /** Whether a field changed since the last sync. */
  #isDirty = true;

  /** Whether a static entity has been synced at least once. */
  #hasSyncedStatic = false;

  /** The visibility the last sync wrote, so toggling `enabled` reaches Lite. */
  #appliedVisible = false;

  /** The world AABB the last sync computed, as `minX, minY, maxX, maxY` in metres. */
  readonly #bounds = new Float64Array(4);

  /**
   * Builds a sprite with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(SpriteRenderer.schema));
  }

  /**
   * Resets the sync shadow state, so a recycled component does not inherit the previous one's.
   */
  onAttach(): void {
    this.#syncedMatrixVersion = -1;
    this.#hasSyncedStatic = false;
    this.#appliedVisible = false;
    this.#isDirty = true;
  }

  /**
   * Marks the sprite for removal from its layer. The sync system does the removal, because it owns
   * the layer.
   */
  onDetach(): void {
    this.#isDirty = true;
  }

  /**
   * The atlas frame drawn.
   *
   * @returns The frame index.
   */
  get frame(): number {
    return this.#frame;
  }

  /**
   * Sets the atlas frame drawn, marking the sprite for the next sync when it changes.
   *
   * @param value - The frame index.
   */
  set frame(value: number) {
    if (value !== this.#frame) {
      this.#frame = value;
      this.#isDirty = true;
    }
  }

  /**
   * The Babylon Lite objects the component uses. Unstable escape hatch
   * (`CONSTITUTION.md` §3.4).
   *
   * @returns The sprite handle, or `null` when the sprite is not in a layer.
   */
  get lite(): { readonly sprite: LiteSprite2DHandle | null } {
    return { sprite: this.#handle };
  }

  /**
   * The sprite's world-space axis-aligned bounding box, for coarse queries
   * (`docs/architecture/11-2d-toolkit.md` §5).
   *
   * @remarks
   * The box is the one the last sync computed, so it is a frame behind a sprite that has just
   * moved, and it is the origin-sized empty box until the sprite has been synced once. It ignores
   * rotation: a rotated sprite reports the box of its unrotated quad, which is the cheap
   * conservative answer only for rotations that are multiples of a quarter turn.
   *
   * @returns A freshly allocated box in world metres.
   */
  get bounds(): { readonly min: Vec2Like; readonly max: Vec2Like } {
    return {
      min: { x: this.#bounds[0] ?? 0, y: this.#bounds[1] ?? 0 },
      max: { x: this.#bounds[2] ?? 0, y: this.#bounds[3] ?? 0 },
    };
  }

  /**
   * The loaded atlas, or `null` while it is still loading or failed.
   *
   * @returns The atlas.
   */
  get atlas(): SpriteAtlasAsset | null {
    const handle = this.sprite;
    return handle?.state === "loaded" ? handle.value : null;
  }

  /**
   * Whether anything about this sprite needs writing to Lite this frame.
   *
   * @param isStatic - Whether the owning entity is marked static.
   * @param matrixVersion - The entity transform's `worldMatrixVersion`.
   * @returns `true` when the sync system must write the sprite.
   *
   * @internal
   */
  needsSync(isStatic: boolean, matrixVersion: number): boolean {
    if (this.#isDirty) {
      return true;
    }
    // Enabling or disabling the component, or anything above it in the hierarchy, changes nothing
    // the transform version or the dirty flag can see — but it does change what Lite must draw.
    if (this.isEnabledInHierarchy !== this.#appliedVisible) {
      return true;
    }
    if (isStatic) {
      return !this.#hasSyncedStatic;
    }
    return matrixVersion !== this.#syncedMatrixVersion;
  }

  /**
   * Records that the sync system has written this sprite.
   *
   * @param isStatic - Whether the owning entity is marked static.
   * @param matrixVersion - The transform version written at.
   * @param minX - The world AABB, in metres.
   * @param minY - The world AABB, in metres.
   * @param maxX - The world AABB, in metres.
   * @param maxY - The world AABB, in metres.
   *
   * @internal
   */
  // oxlint-disable-next-line max-params -- once per moved sprite per frame; an options object would allocate.
  markSynced(isStatic: boolean, matrixVersion: number, minX: number, minY: number, maxX: number, maxY: number): void {
    this.#isDirty = false;
    this.#appliedVisible = this.isEnabledInHierarchy;
    this.#hasSyncedStatic = isStatic;
    this.#syncedMatrixVersion = matrixVersion;
    this.#bounds[0] = minX;
    this.#bounds[1] = minY;
    this.#bounds[2] = maxX;
    this.#bounds[3] = maxY;
  }

  /**
   * Forces the next sync to rewrite this sprite.
   *
   * @internal
   */
  invalidate(): void {
    this.#isDirty = true;
    this.#hasSyncedStatic = false;
  }

  /**
   * The Lite handle and the key of the layer holding it.
   *
   * @returns The placement, or `null` when the sprite is not in a layer.
   *
   * @internal
   */
  placement(): { readonly handle: LiteSprite2DHandle; readonly key: string } | null {
    const handle = this.#handle;
    const key = this.#layerKey;
    return handle === null || key === null ? null : { handle, key };
  }

  /**
   * Records the layer the sync system put this sprite in.
   *
   * @param handle - The Lite handle, or `null` when the sprite was removed.
   * @param key - The layer key, or `null`.
   *
   * @internal
   */
  setPlacement(handle: LiteSprite2DHandle | null, key: string | null): void {
    this.#handle = handle;
    this.#layerKey = key;
  }
}

/**
 * The `SpriteRenderer` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function spriteRendererSchema(): Schema {
  return defineSchema({
    sprite: asset(SpriteAtlasAsset, { tooltip: "The atlas this sprite draws a frame of." }),
    color: color("#ffffffff", { tooltip: "Tint multiplied into every texel." }),
    flipX: bool(false, { tooltip: "Mirror horizontally." }),
    flipY: bool(false, { tooltip: "Mirror vertically." }),
    sortingLayer: str(DEFAULT_SORTING_LAYER, { tooltip: "Which sorting layer the sprite draws on." }),
    orderInLayer: i32(0, { tooltip: "Sub-order within the sorting layer; higher draws in front." }),
    blend: enumOf(SPRITE_BLEND_MODES, "alpha", { tooltip: "How the colour combines with the background." }),
    pivotOverride: optional(vec2(), { tooltip: "Overrides the frame's own pivot, in [0,1] of the frame." }),
    screenSpace: bool(false, { tooltip: "Keep the identity view instead of following the Camera2D." }),
    pickable: bool(true, { tooltip: "Whether app.twoD.pickAt considers this sprite." }),
  });
}
