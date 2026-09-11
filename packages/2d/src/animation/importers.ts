import { asepriteFrameName } from "../atlas/importers.js";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { defineSpriteAnimation } from "./definition.js";
import type { SpriteAnimationDefinition, SpriteClipDefinition } from "./definition.js";

/**
 * The animation importer: a pure function that turns an Aseprite sheet export's tags into an
 * `ignifx.spriteanimation` document (`docs/architecture/11-2d-toolkit.md` §2.4).
 *
 * It reads the same document `importAsepriteAtlas` reads and names frames with the same
 * normaliser, so an atlas and an animation set imported from one export always agree on frame
 * names. Nothing here does I/O; the CLI reads the file and writes the result.
 */

/** The frames-per-second a tag falls back to when Aseprite recorded no usable durations. */
const FALLBACK_FPS = 12;

/** How many decimal places a derived frames-per-second keeps. */
const FPS_DECIMALS = 3;

/** The `repeat` value Aseprite writes for a tag that plays exactly once. */
const PLAY_ONCE_REPEAT = "1";

/** One frame of the document, reduced to what a clip needs. */
interface FrameRecord {
  readonly key: string;
  readonly duration: number;
}

/**
 * Raises the one diagnostic this importer owns.
 *
 * @param reason - What about the document could not be read.
 * @param hint - The remedy sentence, when there is a specific one.
 * @throws IgnifxError with code `IGX-1109`, always.
 */
function failImport(reason: string, hint?: string): never {
  throw twoDError(TwoDErrorCode.unsupportedImport, `importAsepriteAnimations cannot read this document: ${reason}.`, {
    context: { importer: "importAsepriteAnimations" },
    hint: hint ?? "Re-export the sheet from Aseprite with `JSON Data` and `Meta: Tags` enabled.",
  });
}

/**
 * Narrows an unknown value to a plain property bag.
 *
 * @param value - The value to test.
 * @returns Whether it is a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows an unknown value to an array without widening it to `any[]`.
 *
 * @param value - The value to test.
 * @returns Whether it is an array.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Reads the per-frame duration, in milliseconds, out of one frame entry.
 *
 * @param entry - The frame entry.
 * @returns The duration, or `0` when the entry declares none.
 */
function readDuration(entry: Record<string, unknown>): number {
  const duration = entry["duration"];
  return isFiniteNumber(duration) && duration > 0 ? duration : 0;
}

/**
 * Flattens the document's `frames` collection — hash or array — into ordered records.
 *
 * @param frames - The document's `frames` field.
 * @returns The records in document order; empty when `frames` is unreadable.
 */
function collectFrames(frames: unknown): readonly FrameRecord[] {
  const out: FrameRecord[] = [];
  if (isUnknownArray(frames)) {
    for (let index = 0; index < frames.length; index += 1) {
      const entry = frames[index];
      if (!isObject(entry)) {
        continue;
      }
      const filename = entry["filename"];
      out.push({
        key: typeof filename === "string" && filename !== "" ? filename : `frame_${String(index)}`,
        duration: readDuration(entry),
      });
    }
    return out;
  }
  if (isObject(frames)) {
    const keys = Object.keys(frames);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) {
        continue;
      }
      const entry = frames[key];
      if (!isObject(entry)) {
        continue;
      }
      out.push({ key, duration: readDuration(entry) });
    }
    return out;
  }
  return out;
}

/**
 * Rounds a derived frames-per-second to {@link FPS_DECIMALS} places.
 *
 * @param value - The unrounded rate.
 * @returns The rounded rate.
 */
function roundFps(value: number): number {
  const scale = 10 ** FPS_DECIMALS;
  return Math.round(value * scale) / scale;
}

/**
 * What {@link importAsepriteAnimations} accepts alongside the document.
 *
 * @public
 */
export interface AsepriteAnimationImportOptions {
  /** The `.atlas.json` address the clips index into. Defaults to `""`, the renderer's own atlas. */
  readonly atlas?: string;
  /** The rate a tag gets when Aseprite recorded no usable frame durations. Defaults to `12`. */
  readonly defaultFps?: number;
  /**
   * Names the atlas frame at a document frame index. Defaults to the same normalisation
   * `importAsepriteAtlas` applies to the document's own frame keys, which is what makes the two
   * imports agree; override it when the atlas was produced some other way.
   */
  readonly frameNameOf?: (index: number) => string;
}

/**
 * Converts an Aseprite sheet export's tags into an `ignifx.spriteanimation` document.
 *
 * Every entry in `meta.frameTags` becomes one clip, named after the tag, listing the frame names
 * for indices `from` through `to` explicitly rather than as a range — a clip that lists names
 * survives an atlas being repacked in a different order.
 *
 * Playback direction is baked into that list, because ignifx clips play forwards:
 *
 * - `"forward"` (and anything unrecognised) lists `from … to` in order.
 * - `"reverse"` lists them backwards.
 * - `"pingpong"` lists them forwards and then appends the **interior** frames in reverse, so a
 *   three-frame tag becomes `0, 1, 2, 1` — the ends are not repeated, which is what makes the clip
 *   loop seamlessly.
 *
 * `loop` is `true` unless the tag's `repeat` is the string `"1"`, Aseprite's "play once".
 *
 * @remarks
 * Aseprite stores a duration **per frame**, in milliseconds, while an ignifx clip carries a single
 * `fps`. A tag is therefore approximated by the mean of its frames' durations: `fps` is
 * `1000 / averageDuration`, rounded to three decimal places. A tag whose frames all share a
 * duration converts exactly; one with uneven durations does not, and the individual frames will
 * hold for the average instead of their authored time. Split such a tag, or even the durations out
 * in Aseprite, when the timing matters. When no frame in the range declares a positive duration,
 * `options.defaultFps` — itself defaulting to `12` — is used instead.
 *
 * Aseprite has no frame-event concept, so no clip carries `events`.
 *
 * @param json - The parsed Aseprite document.
 * @param options - The atlas address, the fallback rate, and a frame-naming override.
 * @returns The complete animation document, already through `defineSpriteAnimation`.
 * @throws IgnifxError with code `IGX-1109` when the document is not an object, when
 * `meta.frameTags` is missing, is not an array, or is empty, when a tag has no name, or when
 * frames cannot be named because the document has no readable `frames` and no `frameNameOf` was
 * supplied.
 *
 * @example
 * ```ts
 * const animations = importAsepriteAnimations(JSON.parse(text), { atlas: "2d/hero.atlas.json" });
 * animations.clips[0]; // { name: "idle", frames: ["hero_0", "hero_1"], fps: 10, loop: true }
 * ```
 *
 * @public
 */
export function importAsepriteAnimations(
  json: unknown,
  options?: AsepriteAnimationImportOptions,
): SpriteAnimationDefinition {
  if (!isObject(json)) {
    failImport("the document is not a JSON object");
  }
  const meta = isObject(json["meta"]) ? json["meta"] : null;
  const tags = meta === null ? undefined : meta["frameTags"];
  if (!isUnknownArray(tags) || tags.length === 0) {
    failImport(
      "it declares no meta.frameTags, and tags are what become clips",
      "Re-export from Aseprite with `Meta: Tags` ticked, and tag the animations in the timeline first.",
    );
  }
  const records = collectFrames(json["frames"]);
  const nameOf = options?.frameNameOf;
  if (nameOf === undefined && records.length === 0) {
    failImport(
      "it declares no readable frames, so tag indices cannot be turned into frame names",
      "Re-export with `Meta: Frames` included, or pass options.frameNameOf to name frames yourself.",
    );
  }
  const defaultFps = options?.defaultFps ?? FALLBACK_FPS;
  const clips: SpriteClipDefinition[] = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (!isObject(tag)) {
      failImport(`tag ${String(index)} is not an object`);
    }
    const name = tag["name"];
    if (typeof name !== "string" || name === "") {
      failImport(`tag ${String(index)} has no name`);
    }
    const rawFrom = tag["from"];
    const rawTo = tag["to"];
    const first = isFiniteNumber(rawFrom) && rawFrom > 0 ? Math.trunc(rawFrom) : 0;
    const last = isFiniteNumber(rawTo) && rawTo > first ? Math.trunc(rawTo) : first;
    const ordered = orderedFrameNames(first, last, tag["direction"], records, nameOf);
    clips.push({
      name,
      frames: ordered,
      fps: tagFps(records, first, last, defaultFps),
      loop: tag["repeat"] !== PLAY_ONCE_REPEAT,
    });
  }
  return defineSpriteAnimation({ ...(options?.atlas === undefined ? {} : { atlas: options.atlas }), clips });
}

/**
 * Builds one tag's frame-name list, with its direction already baked in.
 *
 * @param first - The tag's first frame index.
 * @param last - The tag's last frame index, inclusive.
 * @param direction - The tag's `direction` field, unnarrowed.
 * @param records - The document's frames, in order.
 * @param nameOf - The caller's frame namer, or `undefined` to use the document's own keys.
 * @returns The frame names in play order.
 */
function orderedFrameNames(
  first: number,
  last: number,
  direction: unknown,
  records: readonly FrameRecord[],
  nameOf: ((index: number) => string) | undefined,
): readonly string[] {
  const forward: string[] = [];
  for (let index = first; index <= last; index += 1) {
    forward.push(frameNameAt(index, records, nameOf));
  }
  if (direction === "reverse") {
    return forward.toReversed();
  }
  if (direction === "pingpong") {
    const out = forward.slice();
    for (let index = forward.length - 2; index >= 1; index -= 1) {
      const name = forward[index];
      if (name !== undefined) {
        out.push(name);
      }
    }
    return out;
  }
  return forward;
}

/**
 * Names the atlas frame at one document frame index.
 *
 * @param index - The frame index the tag refers to.
 * @param records - The document's frames, in order.
 * @param nameOf - The caller's frame namer, or `undefined` to use the document's own keys.
 * @returns The atlas frame name.
 */
function frameNameAt(
  index: number,
  records: readonly FrameRecord[],
  nameOf: ((index: number) => string) | undefined,
): string {
  if (nameOf !== undefined) {
    return nameOf(index);
  }
  const record = records[index];
  return asepriteFrameName(record === undefined ? `frame_${String(index)}` : record.key);
}

/**
 * Derives a tag's frames-per-second from the mean of its frames' durations.
 *
 * @param records - The document's frames, in order.
 * @param first - The tag's first frame index.
 * @param last - The tag's last frame index, inclusive.
 * @param defaultFps - The rate to fall back to when no duration is usable.
 * @returns The rate, rounded to three decimal places.
 */
function tagFps(records: readonly FrameRecord[], first: number, last: number, defaultFps: number): number {
  let total = 0;
  let count = 0;
  for (let index = first; index <= last; index += 1) {
    const record = records[index];
    if (record === undefined || record.duration <= 0) {
      continue;
    }
    total += record.duration;
    count += 1;
  }
  if (count === 0 || total <= 0) {
    return defaultFps;
  }
  return roundFps(1000 / (total / count));
}
