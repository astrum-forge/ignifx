import { twoDError, TwoDErrorCode } from "../errors.js";
import { resolveClipFrames, SPRITE_ANIMATION_ASSET_TYPE, DEFAULT_CLIP_FPS } from "./definition.js";
import type { SpriteAnimationDefinition, SpriteAnimationEvent, SpriteClipDefinition } from "./definition.js";
import type { SpriteAtlasAsset } from "../atlas/sprite-atlas-asset.js";

/**
 * The value a `.spriteanim.json` address loads to: the parsed document plus, once the atlas it
 * names has loaded, every clip resolved to atlas frame indices
 * (`docs/architecture/11-2d-toolkit.md` §2.4).
 */

/**
 * One clip, resolved against an atlas.
 *
 * @public
 */
export interface SpriteClip {
  /** The clip's name. */
  readonly name: string;
  /** The atlas frame indices, in play order. */
  readonly frames: readonly number[];
  /** Frames per second. */
  readonly fps: number;
  /** Whether the clip restarts at its end. */
  readonly loop: boolean;
  /** Events fired as the clip passes a frame. */
  readonly events: readonly SpriteAnimationEvent[];
  /** How long one pass through the clip takes, in seconds. */
  readonly durationSeconds: number;
}

/**
 * A loaded sprite-animation document.
 *
 * @remarks
 * Resolution needs an atlas, and a document may be loaded before, after, or without one. The asset
 * therefore keeps the parsed clips and resolves them lazily the first time an atlas is offered;
 * `SpriteAnimator` offers its renderer's atlas. Under a headless app everything here works
 * unchanged, which is what makes animation timing testable with `app.step`.
 *
 * @example
 * ```ts
 * const clips = await app.assets.load<SpriteAnimationAsset>("2d/hero.spriteanim.json").promise;
 * clips.clipNames(); // ["idle", "run"]
 * ```
 *
 * @public
 */
export class SpriteAnimationAsset {
  /** The type name the asset service registers animation documents under. */
  static assetType: string = SPRITE_ANIMATION_ASSET_TYPE;

  /** The address the document was loaded from. */
  readonly address: string;

  /** The parsed document. */
  readonly definition: SpriteAnimationDefinition;

  /** The atlas address the document names, already resolved against its own address. */
  readonly atlasAddress: string;

  #resolved: ReadonlyMap<string, SpriteClip> | null = null;

  #resolvedAgainst: SpriteAtlasAsset | null = null;

  /**
   * Wraps a parsed document. The `spriteanimation` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param definition - The parsed document.
   * @param atlasAddress - The atlas address, resolved against `address`.
   *
   * @internal
   */
  constructor(address: string, definition: SpriteAnimationDefinition, atlasAddress: string) {
    this.address = address;
    this.definition = definition;
    this.atlasAddress = atlasAddress;
  }

  /**
   * Every clip name, in declaration order.
   *
   * @returns A freshly allocated array.
   */
  clipNames(): readonly string[] {
    const names: string[] = [];
    for (let index = 0; index < this.definition.clips.length; index += 1) {
      const clip = this.definition.clips[index];
      if (clip !== undefined) {
        names.push(clip.name);
      }
    }
    return names;
  }

  /**
   * The name of the clip a component that names none plays.
   *
   * @returns The first clip's name, or `""` when the document is empty.
   */
  get defaultClipName(): string {
    return this.definition.clips[0]?.name ?? "";
  }

  /**
   * Resolves every clip's frame names against an atlas.
   *
   * @remarks
   * The result is cached against the atlas it was resolved with, so playing ten characters off one
   * atlas resolves once. Offering a different atlas re-resolves.
   *
   * @param atlas - The atlas the frame names index into.
   * @returns The clips, keyed by name.
   */
  resolve(atlas: SpriteAtlasAsset): ReadonlyMap<string, SpriteClip> {
    const cached = this.#resolved;
    if (cached !== null && this.#resolvedAgainst === atlas) {
      return cached;
    }
    const clips = new Map<string, SpriteClip>();
    const indexOf = (name: string): number => atlas.frameIndex(name);
    for (let index = 0; index < this.definition.clips.length; index += 1) {
      const declared = this.definition.clips[index];
      if (declared === undefined) {
        continue;
      }
      clips.set(declared.name, toClip(declared, resolveClipFrames(declared, indexOf)));
    }
    this.#resolved = clips;
    this.#resolvedAgainst = atlas;
    return clips;
  }

  /**
   * Looks a clip up, resolving against an atlas first.
   *
   * @param name - The clip name.
   * @param atlas - The atlas the frame names index into.
   * @returns The clip.
   * @throws IgnifxError with code `IGX-1108` when the document declares no such clip.
   */
  requireClip(name: string, atlas: SpriteAtlasAsset): SpriteClip {
    const clip = this.resolve(atlas).get(name);
    if (clip === undefined) {
      throw twoDError(TwoDErrorCode.unknownClip, `${this.address} declares no clip named ${name}.`, {
        context: { asset: this.address, clip: name },
        hint: `Known clips: ${this.clipNames().join(", ")}.`,
      });
    }
    return clip;
  }
}

/**
 * Builds a resolved clip from a declaration and its frame indices.
 *
 * @param declared - The clip as the document wrote it.
 * @param frames - Its atlas frame indices.
 * @returns The clip.
 */
function toClip(declared: SpriteClipDefinition, frames: readonly number[]): SpriteClip {
  const fps = declared.fps !== undefined && declared.fps > 0 ? declared.fps : DEFAULT_CLIP_FPS;
  return {
    name: declared.name,
    frames,
    fps,
    loop: declared.loop ?? true,
    events: declared.events ?? EMPTY_EVENTS,
    durationSeconds: frames.length / fps,
  };
}

/** The event list a clip that declares none carries. */
const EMPTY_EVENTS: readonly SpriteAnimationEvent[] = Object.freeze([]);
