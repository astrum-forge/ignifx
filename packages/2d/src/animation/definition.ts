import { twoDError, TwoDErrorCode } from "../errors.js";

/**
 * The `ignifx.spriteanimation` document — the `.spriteanim.json` file that names an atlas and the
 * clips cut out of its frames (`docs/architecture/06-serialization-and-scene-format.md` §6,
 * `11-2d-toolkit.md` §2.4).
 *
 * A clip lists frame names explicitly, or names the first and last frame of a contiguous run in the
 * atlas. ignifx drives these on its own clock in `PostUpdate`, not on Lite's
 * `SpriteAnimationManager`, so `timeScale`, pause, and frame events behave exactly as they do for
 * 3D animation (ADR-0003).
 */

/**
 * The `format` discriminator every `.spriteanim.json` document carries.
 *
 * @public
 */
export const SPRITE_ANIMATION_FORMAT = "ignifx.spriteanimation";

/**
 * The document version this build reads and writes.
 *
 * @public
 */
export const SPRITE_ANIMATION_FORMAT_VERSION = 1;

/**
 * The asset type name the loader registers.
 *
 * @public
 */
export const SPRITE_ANIMATION_ASSET_TYPE = "spriteanimation";

/**
 * The address suffixes that select the sprite-animation loader.
 *
 * @public
 */
export const SPRITE_ANIMATION_FILE_EXTENSIONS: readonly string[] = Object.freeze([".spriteanim.json"]);

/**
 * A frame event: a name emitted on `SpriteAnimator.onEvent` when the clip reaches a frame.
 *
 * @public
 */
export interface SpriteAnimationEvent {
  /** The zero-based index **within the clip**, not within the atlas. */
  readonly frame: number;
  /** The name emitted on `SpriteAnimator.onEvent`. */
  readonly name: string;
}

/**
 * One clip: an ordered run of atlas frames with a rate and a loop flag.
 *
 * @remarks
 * A clip names its frames one of two ways, and they mean different things.
 *
 * - `frames` is an explicit **list of frame names**, played in the order written. Anything the
 *   atlas does not carry is dropped, and the frames need not be adjacent in the atlas.
 * - `from`/`to` is an **index range over the atlas**, not a pair of endpoints joined by name. Both
 *   names are resolved to their atlas indices and *every index between them is played*, in atlas
 *   order, endpoints included. So a range whose endpoints are not adjacent in the sheet plays
 *   whatever the packer happened to put between them — a `from: "run_0"`, `to: "run_5"` over an
 *   atlas ordered `run_0, idle_0, run_1, …` plays `idle_0` too. Use `frames` whenever the run is
 *   not contiguous in the atlas.
 * - `to` before `from` is legal and plays the range backwards.
 *
 * @public
 */
export interface SpriteClipDefinition {
  /** The clip's name, unique within the document; what `SpriteAnimator.play` takes. */
  readonly name: string;
  /**
   * The atlas frame names, in play order; they need not be adjacent in the atlas. Absent or empty
   * when `from`/`to` name a range instead.
   */
  readonly frames?: readonly string[];
  /**
   * The atlas frame whose **index** starts the range, when `frames` is absent. The clip plays every
   * atlas index from here to `to`, so the two must bracket a contiguous run in the sheet.
   */
  readonly from?: string;
  /**
   * The atlas frame whose **index** ends the range, inclusive. An index below `from`'s plays the
   * range backwards.
   */
  readonly to?: string;
  /** Frames per second. Defaults to `12`. */
  readonly fps?: number;
  /** Whether the clip restarts at its end. Defaults to `true`. */
  readonly loop?: boolean;
  /** Events fired as the clip passes a frame. */
  readonly events?: readonly SpriteAnimationEvent[];
}

/**
 * The parsed `.spriteanim.json` document.
 *
 * @public
 */
export interface SpriteAnimationDefinition {
  /** Always `"ignifx.spriteanimation"`. */
  readonly format: typeof SPRITE_ANIMATION_FORMAT;
  /** Always `1` in this build. */
  readonly formatVersion: number;
  /** The address of the `.atlas.json` the clips index into; empty uses the renderer's own atlas. */
  readonly atlas: string;
  /** The clips, in declaration order; the first is the default when the component names none. */
  readonly clips: readonly SpriteClipDefinition[];
}

/**
 * What {@link defineSpriteAnimation} accepts.
 *
 * @public
 */
export interface SpriteAnimationInput {
  /** Always `"ignifx.spriteanimation"` when present. */
  readonly format?: string;
  /** The document version. */
  readonly formatVersion?: number;
  /** The address of the `.atlas.json` the clips index into. */
  readonly atlas?: string;
  /** The clips. */
  readonly clips: readonly SpriteClipDefinition[];
}

/**
 * The frames-per-second a clip that declares none plays at.
 *
 * @public
 */
export const DEFAULT_CLIP_FPS = 12;

/**
 * Fills in the defaults of an animation document and checks the invariants the animator relies on.
 *
 * @param input - The document, as authored or as an importer emitted it.
 * @param address - What to name in an error; defaults to `"<inline>"`.
 * @returns The complete document.
 * @throws IgnifxError with code `IGX-1104` when the format tag, the version, or a clip is wrong.
 *
 * @public
 */
export function defineSpriteAnimation(input: SpriteAnimationInput, address = "<inline>"): SpriteAnimationDefinition {
  const fail = (reason: string): never => {
    throw twoDError(
      TwoDErrorCode.invalidAnimationFile,
      `${address} is not a readable ignifx.spriteanimation document: ${reason}.`,
      { context: { file: address }, hint: "Check the format, version, and clip fields." },
    );
  };
  if (input.format !== undefined && input.format !== SPRITE_ANIMATION_FORMAT) {
    fail(`its format is ${input.format}, not ${SPRITE_ANIMATION_FORMAT}`);
  }
  if (input.formatVersion !== undefined && input.formatVersion !== SPRITE_ANIMATION_FORMAT_VERSION) {
    fail(
      `its formatVersion is ${String(input.formatVersion)}, and this build reads ${String(SPRITE_ANIMATION_FORMAT_VERSION)}`,
    );
  }
  if (!Array.isArray(input.clips) || input.clips.length === 0) {
    fail("it declares no clips");
  }
  const seen = new Set<string>();
  for (let index = 0; index < input.clips.length; index += 1) {
    const clip = input.clips[index];
    if (clip === undefined || typeof clip.name !== "string" || clip.name === "") {
      fail(`clip ${String(index)} has no name`);
      continue;
    }
    if (seen.has(clip.name)) {
      fail(`two clips are named ${clip.name}`);
    }
    seen.add(clip.name);
    const hasList = clip.frames !== undefined && clip.frames.length > 0;
    const hasRange = typeof clip.from === "string" && typeof clip.to === "string";
    if (!hasList && !hasRange) {
      fail(`clip ${clip.name} names neither a frame list nor a from/to range`);
    }
    if (clip.fps !== undefined && !(clip.fps > 0)) {
      fail(`clip ${clip.name} has a non-positive fps`);
    }
  }
  return {
    format: SPRITE_ANIMATION_FORMAT,
    formatVersion: SPRITE_ANIMATION_FORMAT_VERSION,
    atlas: input.atlas ?? "",
    clips: input.clips,
  };
}

/**
 * Resolves a clip's frame names into atlas frame indices.
 *
 * @remarks
 * `frames` resolves name by name and skips what the atlas does not carry. `from`/`to` resolves both
 * endpoints to atlas **indices** and walks every index between them — ascending or descending — so
 * a range over non-adjacent frames plays everything the packer put in between
 * ({@link SpriteClipDefinition}).
 *
 * @param clip - The clip to resolve.
 * @param indexOf - Maps an atlas frame name to its index, or `-1` when the atlas has no such frame.
 * @returns The indices in play order; empty when the clip names nothing the atlas has.
 *
 * @public
 */
export function resolveClipFrames(clip: SpriteClipDefinition, indexOf: (name: string) => number): readonly number[] {
  const list = clip.frames;
  if (list !== undefined && list.length > 0) {
    const out: number[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const name = list[index];
      const resolved = name === undefined ? -1 : indexOf(name);
      if (resolved >= 0) {
        out.push(resolved);
      }
    }
    return out;
  }
  const first = clip.from === undefined ? -1 : indexOf(clip.from);
  const last = clip.to === undefined ? -1 : indexOf(clip.to);
  if (first < 0 || last < 0) {
    return [];
  }
  const out: number[] = [];
  const step = last >= first ? 1 : -1;
  for (let frame = first; step > 0 ? frame <= last : frame >= last; frame += step) {
    out.push(frame);
  }
  return out;
}
