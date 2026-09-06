import { twoDError, TwoDErrorCode } from "../errors.js";
import { readVec2, SPRITE_ATLAS_ASSET_TYPE } from "./definition.js";
import type { SpriteAtlasDefinition } from "./definition.js";
import type { LiteSpriteAtlas, LiteSpriteFrame } from "../lite/types.js";
import type { Vec2Like } from "@ignifx/core";

/**
 * The value a `.atlas.json` address loads to: the parsed document, the Lite `SpriteAtlas` built
 * from it, and a name-to-index map so `#frame:` addressing is a hash lookup rather than a scan
 * (`docs/architecture/11-2d-toolkit.md` §2.3).
 */

/**
 * The Babylon Lite objects a {@link SpriteAtlasAsset} owns.
 *
 * @public
 */
export interface SpriteAtlasAssetLiteHandles {
  /** The Lite atlas, or `null` under a headless app, which uploads nothing. */
  readonly atlas: LiteSpriteAtlas | null;
}

/**
 * One frame of a loaded atlas, as game code sees it.
 *
 * @public
 */
export interface SpriteFrameInfo {
  /** The frame's name. */
  readonly name: string;
  /** Its index in the atlas, which is what Lite addresses frames by. */
  readonly index: number;
  /** Its drawn width, in image pixels. */
  readonly widthPx: number;
  /** Its drawn height, in image pixels. */
  readonly heightPx: number;
  /** Its pivot in `[0, 1]` of the frame, `[0, 0]` top-left. */
  readonly pivot: Vec2Like;
}

/**
 * A loaded sprite atlas.
 *
 * @remarks
 * Under a headless app the document is parsed and every frame is queryable, but `lite.atlas` is
 * `null` — nothing is uploaded (`docs/architecture/07-rendering.md` §6). That is what lets a
 * headless test assert frame counts, pivots, and animation timing without a GPU.
 *
 * @example
 * ```ts
 * const handle = app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
 * const atlas = await handle.promise;
 * atlas.frameIndex("idle_0"); // 0
 * ```
 *
 * @public
 */
export class SpriteAtlasAsset {
  /** The type name the asset service registers sprite atlases under. */
  static assetType: string = SPRITE_ATLAS_ASSET_TYPE;

  /** The address the atlas was loaded from. */
  readonly address: string;

  /** The parsed `.atlas.json` document. */
  readonly definition: SpriteAtlasDefinition;

  #atlas: LiteSpriteAtlas | null;

  readonly #indices: ReadonlyMap<string, number>;

  readonly #release: (() => void) | null;

  /**
   * Wraps a parsed atlas. The `spriteatlas` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param definition - The parsed document.
   * @param atlas - The Lite atlas, or `null` under a headless app.
   * @param release - Frees the GPU texture, or `null` when there is nothing to free.
   *
   * @internal
   */
  constructor(
    address: string,
    definition: SpriteAtlasDefinition,
    atlas: LiteSpriteAtlas | null,
    release: (() => void) | null,
  ) {
    this.address = address;
    this.definition = definition;
    this.#atlas = atlas;
    this.#release = release;
    const indices = new Map<string, number>();
    for (let index = 0; index < definition.frames.length; index += 1) {
      const frame = definition.frames[index];
      if (frame !== undefined) {
        indices.set(frame.name, index);
      }
    }
    this.#indices = indices;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch
   * (`CONSTITUTION.md` §3.4).
   *
   * @returns The Lite atlas, or `null` under a headless app.
   */
  get lite(): SpriteAtlasAssetLiteHandles {
    return { atlas: this.#atlas };
  }

  /**
   * How many frames the atlas declares.
   *
   * @returns The frame count.
   */
  get frameCount(): number {
    return this.definition.frames.length;
  }

  /**
   * Looks a frame up by name.
   *
   * @param name - The frame name.
   * @returns The index, or `-1` when the atlas has no such frame.
   */
  frameIndex(name: string): number {
    return this.#indices.get(name) ?? -1;
  }

  /**
   * Looks a frame up by name and refuses to guess.
   *
   * @param name - The frame name.
   * @returns The index.
   * @throws IgnifxError with code `IGX-1106` when the atlas declares no such frame.
   */
  requireFrame(name: string): number {
    const index = this.#indices.get(name);
    if (index === undefined) {
      throw twoDError(TwoDErrorCode.unknownFrame, `${this.address} declares no frame named ${name}.`, {
        context: { atlas: this.address, frame: name },
        hint: `Known frames: ${this.frameNames().join(", ")}.`,
      });
    }
    return index;
  }

  /**
   * Every frame name, in index order.
   *
   * @returns A freshly allocated array.
   */
  frameNames(): readonly string[] {
    const names: string[] = [];
    for (let index = 0; index < this.definition.frames.length; index += 1) {
      const frame = this.definition.frames[index];
      if (frame !== undefined) {
        names.push(frame.name);
      }
    }
    return names;
  }

  /**
   * Describes one frame.
   *
   * @param index - The frame index.
   * @returns The frame, or `null` when the index is out of range.
   */
  frame(index: number): SpriteFrameInfo | null {
    const declared = this.definition.frames[index];
    if (declared === undefined) {
      return null;
    }
    // `defineSpriteAtlas` normalised both fields, so they are always `{ x, y }` here.
    const pivot = readVec2(declared.pivot, DEFAULT_PIVOT);
    const source = readVec2(declared.sourceSize, { x: declared.w, y: declared.h });
    return { name: declared.name, index, widthPx: source.x, heightPx: source.y, pivot };
  }

  /**
   * The Lite frame record, for the sync system.
   *
   * @param index - The frame index.
   * @returns The record, or `null` under a headless app or for an out-of-range index.
   *
   * @internal
   */
  liteFrame(index: number): LiteSpriteFrame | null {
    return this.#atlas?.frames[index] ?? null;
  }

  /**
   * Whether the atlas was uploaded to a device at all.
   *
   * @returns `true` once the GPU texture has been given up, or under a headless app.
   */
  get isReleased(): boolean {
    return this.#atlas === null;
  }

  /**
   * Frees the GPU texture. The asset service calls this on unload.
   *
   * @internal
   */
  releaseGpu(): void {
    if (this.#atlas === null) {
      return;
    }
    this.#atlas = null;
    this.#release?.();
  }
}

/** The pivot a frame that declares none uses: the centre. */
const DEFAULT_PIVOT: Vec2Like = Object.freeze({ x: 0.5, y: 0.5 });

/**
 * A sprite: one frame of one atlas, which is what `SpriteRenderer.sprite` points at.
 *
 * @remarks
 * A bare `"2d/hero.atlas.json"` address resolves to frame `0`; the `#frame:` fragment picks another
 * (`docs/architecture/11-2d-toolkit.md` §2.2). The asset service shares the underlying atlas
 * between every fragment of the same address, so ten sprites off one atlas upload one texture.
 *
 * @public
 */
export interface SpriteAsset {
  /** The atlas the frame lives in. */
  readonly atlas: SpriteAtlasAsset;
  /** The frame index. */
  readonly frame: number;
  /** The frame's name. */
  readonly name: string;
}
