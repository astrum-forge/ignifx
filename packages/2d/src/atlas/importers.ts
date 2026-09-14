import { twoDError, TwoDErrorCode } from "../errors.js";
import { defineSpriteAtlas } from "./definition.js";
import type { SpriteAtlasDefinition, SpriteFrameDefinition } from "./definition.js";
import type { Vec2Like } from "@ignifx/core";

/**
 * Convert packer JSON or a grid description into an `ignifx.spriteatlas` document without I/O.
 * Frame rectangles use image pixels with a top-left origin. Invalid input throws `IGX-1109`.
 */

/** The pivot a frame gets when neither the packer nor the caller names one. */
const CENTRE_PIVOT: Vec2Like = Object.freeze({ x: 0.5, y: 0.5 });

/** The prefix {@link gridAtlas} names frames with when the caller supplies none. */
const DEFAULT_GRID_NAME_PREFIX = "tile";

/** The name a frame falls back to when normalisation leaves nothing usable. */
const FALLBACK_FRAME_NAME = "frame";

/** A rectangle as every packer writes it: left, top, width, height, in image pixels. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One raw frame entry paired with the key it was found under (hash key or `filename`). */
interface RawFrameEntry {
  readonly key: string;
  readonly entry: Record<string, unknown>;
}

/** A slice pivot lifted out of `meta.slices`, still in sprite-canvas pixels. */
interface SlicePivot {
  readonly frame: number;
  readonly bounds: Rect;
  readonly pivot: Vec2Like;
}

/**
 * Raises the one diagnostic these importers own.
 *
 * @param importer - The importer function's name, echoed into the message and the context.
 * @param reason - What about the document could not be read.
 * @param hint - The remedy sentence, when there is a specific one.
 * @throws IgnifxError with code `IGX-1109`, always.
 */
function failImport(importer: string, reason: string, hint?: string): never {
  throw twoDError(TwoDErrorCode.unsupportedImport, `${importer} cannot read this document: ${reason}.`, {
    context: { importer },
    hint: hint ?? "Re-export the atlas from the packer, or check that the document is the one the importer expects.",
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
 * Reads a `{ x, y, w, h }` rectangle out of a property bag.
 *
 * @param entry - The bag to read from.
 * @param key - The field holding the rectangle.
 * @returns The rectangle, or `null` when the field is absent or incomplete.
 */
function readRect(entry: Record<string, unknown>, key: string): Rect | null {
  const raw = entry[key];
  if (!isObject(raw)) {
    return null;
  }
  const x = raw["x"];
  const y = raw["y"];
  const w = raw["w"];
  const h = raw["h"];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
    return null;
  }
  return { x, y, w, h };
}

/**
 * Reads a `{ w, h }` size out of a property bag, as a vector.
 *
 * @param entry - The bag to read from.
 * @param key - The field holding the size.
 * @returns The size as `{ x: w, y: h }`, or `null` when the field is absent or incomplete.
 */
function readSize(entry: Record<string, unknown>, key: string): Vec2Like | null {
  const raw = entry[key];
  if (!isObject(raw)) {
    return null;
  }
  const w = raw["w"];
  const h = raw["h"];
  if (!isFiniteNumber(w) || !isFiniteNumber(h)) {
    return null;
  }
  return { x: w, y: h };
}

/**
 * Reads an `{ x, y }` vector out of a property bag.
 *
 * @param entry - The bag to read from.
 * @param key - The field holding the vector.
 * @returns The vector, or `null` when the field is absent or incomplete.
 */
function readVec2(entry: Record<string, unknown>, key: string): Vec2Like | null {
  const raw = entry[key];
  if (!isObject(raw)) {
    return null;
  }
  const x = raw["x"];
  const y = raw["y"];
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }
  return { x, y };
}

/**
 * Clamps a normalised coordinate into `[0, 1]`.
 *
 * @param value - The coordinate.
 * @returns The coordinate, clamped.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Drops a trailing file extension.
 *
 * Only a dot followed by a letter and up to seven more alphanumerics counts, so `hero_0.png` and
 * `hero 0.aseprite` lose their suffix while `walk.2` — a name, not a file — keeps it.
 *
 * @param raw - The raw frame key.
 * @returns The key without its extension.
 */
function stripFileExtension(raw: string): string {
  return raw.replace(/\.[A-Za-z][A-Za-z0-9]{0,7}$/u, "");
}

/**
 * Flattens a TexturePacker-shaped `frames` collection — hash or array — into ordered entries.
 *
 * @param frames - The document's `frames` field.
 * @param importer - The importer name to blame in an error.
 * @returns The entries, in document order.
 * @throws IgnifxError with code `IGX-1109` when `frames` is neither an object nor an array, or
 * holds something that is not an object.
 */
function collectFrameEntries(frames: unknown, importer: string): readonly RawFrameEntry[] {
  const out: RawFrameEntry[] = [];
  if (isUnknownArray(frames)) {
    for (let index = 0; index < frames.length; index += 1) {
      const entry = frames[index];
      if (!isObject(entry)) {
        failImport(importer, `frame ${String(index)} is not an object`);
      }
      const filename = entry["filename"];
      const key =
        typeof filename === "string" && filename !== "" ? filename : `${FALLBACK_FRAME_NAME}_${String(index)}`;
      out.push({ key, entry });
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
        failImport(importer, `frame ${key} is not an object`);
      }
      out.push({ key, entry });
    }
    return out;
  }
  return failImport(importer, "its frames field is neither an object (hash layout) nor an array (array layout)");
}

/**
 * Lifts every `meta.slices[].keys[]` entry that declares a pivot out of an Aseprite document.
 *
 * @param meta - The document's `meta` object, or `null` when it has none.
 * @returns The slice pivots, in document order.
 */
function collectSlicePivots(meta: Record<string, unknown> | null): readonly SlicePivot[] {
  const out: SlicePivot[] = [];
  if (meta === null) {
    return out;
  }
  const slices = meta["slices"];
  if (!isUnknownArray(slices)) {
    return out;
  }
  for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
    const slice = slices[sliceIndex];
    if (!isObject(slice)) {
      continue;
    }
    const keys = slice["keys"];
    if (!isUnknownArray(keys)) {
      continue;
    }
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (!isObject(key)) {
        continue;
      }
      const pivot = readVec2(key, "pivot");
      const bounds = readRect(key, "bounds");
      if (pivot === null || bounds === null) {
        continue;
      }
      const frame = key["frame"];
      out.push({ frame: isFiniteNumber(frame) ? frame : 0, bounds, pivot });
    }
  }
  return out;
}

/**
 * Picks the slice pivot that applies to one frame and normalises it into `[0, 1]`.
 *
 * @param pivots - Every slice pivot in the document.
 * @param frameIndex - The frame's index in the document's own frame order.
 * @param sourceWidth - The untrimmed frame width the pivot is measured against.
 * @param sourceHeight - The untrimmed frame height the pivot is measured against.
 * @returns The normalised pivot, or `null` when no slice covers the frame.
 */
function slicePivotFor(
  pivots: readonly SlicePivot[],
  frameIndex: number,
  sourceWidth: number,
  sourceHeight: number,
): Vec2Like | null {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return null;
  }
  let best: SlicePivot | null = null;
  for (let index = 0; index < pivots.length; index += 1) {
    const candidate = pivots[index];
    if (candidate === undefined || candidate.frame > frameIndex) {
      continue;
    }
    if (best === null || candidate.frame > best.frame) {
      best = candidate;
    }
  }
  if (best === null) {
    return null;
  }
  return {
    x: clamp01((best.bounds.x + best.pivot.x) / sourceWidth),
    y: clamp01((best.bounds.y + best.pivot.y) / sourceHeight),
  };
}

/**
 * Normalises an Aseprite frame key into an identifier a clip and a `#frame:` fragment can name.
 *
 * The rule, applied in this order:
 *
 * 1. Drop a trailing file extension — a dot, a letter, then up to seven more alphanumerics — so
 *    `hero 0.aseprite` and `hero_0.png` both lose their suffix but `walk.2` does not.
 * 2. Replace every run of non-alphanumeric characters with a single `_`.
 * 3. Trim leading and trailing `_`.
 *
 * Case is preserved: `Hero (Idle) 0.aseprite` becomes `Hero_Idle_0`, not `hero_idle_0`. A key that
 * normalises to nothing at all (`"###.png"`) becomes `frame`.
 *
 * {@link importAsepriteAtlas} and `importAsepriteAnimations` both run keys through this function,
 * which is what makes an imported clip's frame names line up with the imported atlas's.
 *
 * @param raw - The frame key as Aseprite wrote it — a hash key, or an array entry's `filename`.
 * @returns The normalised frame name.
 *
 * @example
 * ```ts
 * asepriteFrameName("hero (idle) 0.aseprite"); // "hero_idle_0"
 * asepriteFrameName("hero_0.png"); // "hero_0"
 * ```
 *
 * @public
 */
export function asepriteFrameName(raw: string): string {
  const normalised = stripFileExtension(raw)
    .replaceAll(/[^0-9A-Za-z]+/gu, "_")
    .replace(/^_+/u, "")
    .replace(/_+$/u, "");
  return normalised === "" ? FALLBACK_FRAME_NAME : normalised;
}

/**
 * What {@link gridAtlas} needs to cut an evenly spaced sheet into frames.
 *
 * @public
 */
export interface GridAtlasImportOptions {
  /** The address of the image the frames are cut from. */
  readonly image: string;
  /** The image's full width, in pixels. */
  readonly imageWidth: number;
  /** The image's full height, in pixels. */
  readonly imageHeight: number;
  /** One cell's width, in pixels. Must be positive. */
  readonly cellWidth: number;
  /** One cell's height, in pixels. Must be positive. */
  readonly cellHeight: number;
  /** How many columns to emit. Defaults to as many as the image holds; clamped to that. */
  readonly columns?: number;
  /** How many rows to emit. Defaults to as many as the image holds; clamped to that. */
  readonly rows?: number;
  /** The border left around the whole grid, in pixels. Defaults to `0`. */
  readonly margin?: number;
  /** The gap between adjacent cells, in pixels. Defaults to `0`. */
  readonly spacing?: number;
  /** The pivot every frame gets, in `[0, 1]`. Defaults to the centre. */
  readonly pivot?: Vec2Like;
  /** The `<prefix>_<index>` frame names use. Defaults to `"tile"`. */
  readonly namePrefix?: string;
  /** The min/mag filter. Defaults to `"linear"`; pixel art wants `"nearest"`. */
  readonly sampling?: "linear" | "nearest";
  /** Whether the image's RGB is already multiplied by its alpha. Defaults to `false`. */
  readonly premultipliedAlpha?: boolean;
}

/**
 * Cuts an evenly spaced sprite sheet into an `ignifx.spriteatlas` document.
 *
 * Frames come out in reading order — left to right, then top to bottom — named
 * `<namePrefix>_<index>` with `index` counting from `0` across the whole sheet, so a 4×2
 * grid ends at `tile_7`. `columns` and `rows` default to as many whole cells as the image holds
 * (`floor((imageWidth - 2·margin + spacing) / (cellWidth + spacing))`, and likewise for rows) and
 * are clamped to that capacity when given, so an over-large explicit count never produces a frame
 * that falls off the image.
 *
 * @remarks
 * `namePrefix` is how a grid atlas lines up with the rest of the toolkit: `@ignifx/2d`'s Tiled
 * importer names a tileset's frames `<tilesetName>_<index>`, so passing the tileset's name
 * as `namePrefix` makes a hand-cut grid atlas addressable by exactly the names a tilemap emits.
 *
 * @param options - The sheet's geometry and the frame naming.
 * @returns The complete atlas document.
 * @throws IgnifxError with code `IGX-1109` when a cell dimension is not positive, or when the
 * geometry yields no frames at all.
 *
 * @example
 * ```ts
 * const atlas = gridAtlas({
 *   image: "2d/terrain.png",
 *   imageWidth: 64,
 *   imageHeight: 64,
 *   cellWidth: 32,
 *   cellHeight: 32,
 *   namePrefix: "terrain",
 *   sampling: "nearest",
 * });
 * atlas.frames.map((frame) => frame.name); // ["terrain_0", "terrain_1", "terrain_2", "terrain_3"]
 * ```
 *
 * @public
 */
export function gridAtlas(options: GridAtlasImportOptions): SpriteAtlasDefinition {
  const importer = "gridAtlas";
  const { cellWidth, cellHeight, imageWidth, imageHeight } = options;
  if (!(cellWidth > 0) || !(cellHeight > 0)) {
    failImport(
      importer,
      `the cell size ${String(cellWidth)}x${String(cellHeight)} is not positive`,
      "Pass the cell size in pixels; both cellWidth and cellHeight must be greater than zero.",
    );
  }
  const margin = options.margin ?? 0;
  const spacing = options.spacing ?? 0;
  const capacityColumns = gridCapacity(imageWidth, cellWidth, margin, spacing);
  const capacityRows = gridCapacity(imageHeight, cellHeight, margin, spacing);
  const columns =
    options.columns === undefined ? capacityColumns : Math.min(clampCount(options.columns), capacityColumns);
  const rows = options.rows === undefined ? capacityRows : Math.min(clampCount(options.rows), capacityRows);
  if (columns === 0 || rows === 0) {
    failImport(
      importer,
      `a ${String(imageWidth)}x${String(imageHeight)} image with ${String(cellWidth)}x${String(cellHeight)} cells, margin ${String(margin)} and spacing ${String(spacing)} holds no whole cells`,
      "Check the image size, the cell size, the margin, and the spacing against the sheet.",
    );
  }
  const prefix = options.namePrefix ?? DEFAULT_GRID_NAME_PREFIX;
  const pivot = options.pivot ?? CENTRE_PIVOT;
  const frames: SpriteFrameDefinition[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      frames.push({
        name: `${prefix}_${String(row * columns + column)}`,
        x: margin + column * (cellWidth + spacing),
        y: margin + row * (cellHeight + spacing),
        w: cellWidth,
        h: cellHeight,
        pivot: { x: pivot.x, y: pivot.y },
      });
    }
  }
  return defineSpriteAtlas(
    {
      image: options.image,
      ...(options.sampling === undefined ? {} : { sampling: options.sampling }),
      ...(options.premultipliedAlpha === undefined ? {} : { premultipliedAlpha: options.premultipliedAlpha }),
      frames,
    },
    options.image,
  );
}

/**
 * How many whole cells fit along one axis.
 *
 * @param extent - The image's size along the axis, in pixels.
 * @param cell - One cell's size along the axis, in pixels.
 * @param margin - The border left at both ends, in pixels.
 * @param spacing - The gap between adjacent cells, in pixels.
 * @returns The cell count, never negative.
 */
function gridCapacity(extent: number, cell: number, margin: number, spacing: number): number {
  const usable = extent - 2 * margin + spacing;
  const count = Math.floor(usable / (cell + spacing));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Coerces a caller-supplied count into a non-negative whole number.
 *
 * @param value - The requested count.
 * @returns The count, truncated and floored at zero.
 */
function clampCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * What {@link importTexturePackerAtlas} accepts alongside the document.
 *
 * @public
 */
export interface TexturePackerImportOptions {
  /** The image address to write into the atlas. Defaults to the document's `meta.image`. */
  readonly image?: string;
  /** Whether to keep the `.png` on frame names. Defaults to `false`, which strips it. */
  readonly keepExtensions?: boolean;
  /** The min/mag filter. Defaults to `"linear"`. */
  readonly sampling?: "linear" | "nearest";
  /** Whether the image's RGB is already multiplied by its alpha. Defaults to `false`. */
  readonly premultipliedAlpha?: boolean;
}

/**
 * Converts a TexturePacker JSON export into an `ignifx.spriteatlas` document.
 *
 * Both of TexturePacker's JSON layouts are read and produce identical output for the same sheet:
 * the **hash** layout, whose `frames` is an object keyed by file name, and the **array** layout,
 * whose `frames` is an array of entries carrying a `filename`. Frame names lose their trailing file
 * extension (`hero_0.png` becomes `hero_0`) unless `keepExtensions` is set.
 *
 * A frame's `pivot` is used as-is when the document declares one: TexturePacker already writes
 * pivots normalised into `[0, 1]` against a top-left origin, which is exactly ignifx's convention.
 * Frames without one get the centre. A frame marked `trimmed` carries its `sourceSize` through so
 * the loader can lay the trimmed rectangle back inside its original bounds.
 *
 * @remarks
 * Rotated frames are rejected rather than silently drawn wrong — the sprite pipeline has no
 * per-frame rotation flag.
 *
 * `spriteSourceSize`'s **offset** (`x`/`y`) has no home in `SpriteFrameDefinition`, which records
 * only the untrimmed size, so a trimmed frame whose art is not centred in its source bounds may sit
 * slightly off. Pack with trimming disabled, or with `spriteSourceSize` centred, when that matters.
 *
 * @param json - The parsed TexturePacker document.
 * @param options - The image override, name handling, and sampling.
 * @returns The complete atlas document.
 * @throws IgnifxError with code `IGX-1109` when the document is not an object, when `frames` is
 * neither an object nor an array, when it is empty, when no image address can be found, when a
 * frame has no rectangle, or when a frame is rotated.
 *
 * @example
 * ```ts
 * const atlas = importTexturePackerAtlas(JSON.parse(text), { image: "2d/hero.png" });
 * atlas.frames[0]?.name; // "hero_0"
 * ```
 *
 * @public
 */
export function importTexturePackerAtlas(json: unknown, options?: TexturePackerImportOptions): SpriteAtlasDefinition {
  const importer = "importTexturePackerAtlas";
  if (!isObject(json)) {
    failImport(importer, "the document is not a JSON object");
  }
  const meta = isObject(json["meta"]) ? json["meta"] : null;
  const entries = collectFrameEntries(json["frames"], importer);
  if (entries.length === 0) {
    failImport(importer, "it declares no frames");
  }
  const image = resolveImage(options?.image, meta, importer);
  const keepExtensions = options?.keepExtensions ?? false;
  const frames: SpriteFrameDefinition[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    if (item === undefined) {
      continue;
    }
    if (item.entry["rotated"] === true) {
      failImport(
        importer,
        `frame ${item.key} is rotated`,
        "TexturePacker rotated frames are not supported; disable rotation when packing.",
      );
    }
    const rect = readRect(item.entry, "frame");
    if (rect === null) {
      failImport(importer, `frame ${item.key} has no {x, y, w, h} frame rectangle`);
    }
    const pivot = readVec2(item.entry, "pivot") ?? CENTRE_PIVOT;
    const sourceSize = item.entry["trimmed"] === true ? readSize(item.entry, "sourceSize") : null;
    frames.push({
      name: keepExtensions ? item.key : stripFileExtension(item.key),
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      pivot: { x: pivot.x, y: pivot.y },
      ...(sourceSize === null ? {} : { sourceSize }),
    });
  }
  return defineSpriteAtlas(
    {
      image,
      ...(options?.sampling === undefined ? {} : { sampling: options.sampling }),
      ...(options?.premultipliedAlpha === undefined ? {} : { premultipliedAlpha: options.premultipliedAlpha }),
      frames,
    },
    image,
  );
}

/**
 * Picks the image address an imported atlas points at.
 *
 * @param override - The caller's `options.image`, when given.
 * @param meta - The document's `meta` object, or `null`.
 * @param importer - The importer name to blame in an error.
 * @returns The image address.
 * @throws IgnifxError with code `IGX-1109` when neither source names an image.
 */
function resolveImage(override: string | undefined, meta: Record<string, unknown> | null, importer: string): string {
  if (override !== undefined && override !== "") {
    return override;
  }
  const fromMeta = meta === null ? undefined : meta["image"];
  if (typeof fromMeta === "string" && fromMeta !== "") {
    return fromMeta;
  }
  return failImport(
    importer,
    "neither options.image nor meta.image names an image",
    "Pass options.image, or re-export the sheet with the image name included in its metadata.",
  );
}

/**
 * What {@link importAsepriteAtlas} accepts alongside the document.
 *
 * @public
 */
export interface AsepriteImportOptions {
  /** The image address to write into the atlas. Defaults to the document's `meta.image`. */
  readonly image?: string;
  /** The min/mag filter. Defaults to `"linear"`; pixel art wants `"nearest"`. */
  readonly sampling?: "linear" | "nearest";
  /** Whether the image's RGB is already multiplied by its alpha. Defaults to `false`. */
  readonly premultipliedAlpha?: boolean;
}

/**
 * Converts an Aseprite JSON sheet export into an `ignifx.spriteatlas` document.
 *
 * Aseprite writes a TexturePacker-shaped document — `frames` as either a hash or an array,
 * `meta.image`, `meta.size` — plus its own `meta.frameTags`, `meta.slices` and `meta.layers`. The
 * frame keys it produces are file-ish (`hero 0.aseprite`, `hero (idle) 0.aseprite`), so every one
 * is put through {@link asepriteFrameName}; `importAsepriteAnimations` uses the same normaliser,
 * which is what makes the imported clips and the imported atlas agree on names.
 *
 * A trimmed frame keeps its `sourceSize` so the loader can place the trimmed rectangle back inside
 * its original bounds.
 *
 * @remarks
 * Pivots are **best-effort**. Aseprite has no per-frame pivot; it has slices, which carry an
 * optional pivot in sprite-canvas pixels relative to the slice's own bounds and apply from their
 * key's `frame` index onwards. This importer takes the slice key with the greatest `frame` index at
 * or below the frame being converted (ties going to the earlier slice in document order) and
 * normalises `bounds + pivot` against the frame's untrimmed size, clamped into `[0, 1]`. That is
 * right for the common case — one slice covering the character, authored on an untrimmed sheet —
 * and approximate for anything else. Frames no slice covers get the centre.
 *
 * @param json - The parsed Aseprite document.
 * @param options - The image override and sampling.
 * @returns The complete atlas document.
 * @throws IgnifxError with code `IGX-1109` when the document is not an object, when `frames` is
 * neither an object nor an array, when it is empty, when no image address can be found, or when a
 * frame has no rectangle.
 *
 * @example
 * ```ts
 * const atlas = importAsepriteAtlas(JSON.parse(text), { sampling: "nearest" });
 * atlas.frames[0]?.name; // "hero_idle_0", from the key "hero (idle) 0.aseprite"
 * ```
 *
 * @public
 */
export function importAsepriteAtlas(json: unknown, options?: AsepriteImportOptions): SpriteAtlasDefinition {
  const importer = "importAsepriteAtlas";
  if (!isObject(json)) {
    failImport(importer, "the document is not a JSON object");
  }
  const meta = isObject(json["meta"]) ? json["meta"] : null;
  const entries = collectFrameEntries(json["frames"], importer);
  if (entries.length === 0) {
    failImport(importer, "it declares no frames");
  }
  const image = resolveImage(options?.image, meta, importer);
  const slicePivots = collectSlicePivots(meta);
  const frames: SpriteFrameDefinition[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    if (item === undefined) {
      continue;
    }
    const rect = readRect(item.entry, "frame");
    if (rect === null) {
      failImport(importer, `frame ${item.key} has no {x, y, w, h} frame rectangle`);
    }
    const declaredSource = readSize(item.entry, "sourceSize");
    const trimmed = item.entry["trimmed"] === true;
    const sourceWidth = declaredSource === null ? rect.w : declaredSource.x;
    const sourceHeight = declaredSource === null ? rect.h : declaredSource.y;
    const pivot = slicePivotFor(slicePivots, index, sourceWidth, sourceHeight) ?? CENTRE_PIVOT;
    frames.push({
      name: asepriteFrameName(item.key),
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      pivot: { x: pivot.x, y: pivot.y },
      ...(trimmed && declaredSource !== null ? { sourceSize: declaredSource } : {}),
    });
  }
  return defineSpriteAtlas(
    {
      image,
      ...(options?.sampling === undefined ? {} : { sampling: options.sampling }),
      ...(options?.premultipliedAlpha === undefined ? {} : { premultipliedAlpha: options.premultipliedAlpha }),
      frames,
    },
    image,
  );
}
