import type { App } from "@ignifx/core";

/**
 * The save file, and the four operations the menus need: does one exist, read it, write it, delete
 * it.
 *
 * ## Why this is not `serializeScene`
 *
 * `serializeScene` writes the **world**: every entity, every component, every asset reference. For
 * a template that is the wrong tool twice over. It would store the authored level — the tilemap,
 * the colliders, the materials, the camera rig — none of which a save has any business owning,
 * because all of it is rebuilt from `assets/` on the next boot. And it would break the moment the
 * art is regenerated: a scene file names assets by address, so a new atlas frame or a renamed
 * material would leave a save pointing at something that no longer exists.
 *
 * What actually has to survive a reload is a handful of scalars — where the player was, what they
 * picked up, their score and how long they have played — so that is what this file is: a small,
 * versioned, schema-checked JSON document under `app.storage.namespace("saves")`.
 * `serializeScene` is the right tool when a *player* has built something (a base, a layout, a
 * placed prop); it is the wrong tool for progress through an authored level.
 *
 * ## The header, again
 *
 * A save written by an older build is discarded with a warning rather than migrated or thrown.
 * That is the rule the whole template follows, and it is what makes regenerating the art safe:
 * bump {@link SAVE_FORMAT_VERSION} and every stale save quietly stops being offered.
 */

/** The `format` every save written by this template carries. */
export const SAVE_FORMAT = "ignifx-template.save";

/** The version of {@link SAVE_FORMAT} this build reads and writes. */
export const SAVE_FORMAT_VERSION = 1;

/** The storage namespace saves live in. */
export const SAVE_NAMESPACE = "saves";

/** The key the single save slot is stored under. */
export const SAVE_KEY = "slot0";

/** A point in the world, in metres. The 2D templates leave `z` at zero. */
export interface SavePoint {
  /** The x coordinate. */
  readonly x: number;
  /** The y coordinate. */
  readonly y: number;
  /** The z coordinate. */
  readonly z: number;
}

/** One save. */
export interface SaveFile {
  /** Always {@link SAVE_FORMAT}. Typed as a string because it is read back from JSON. */
  readonly format: string;
  /** The document version; anything but {@link SAVE_FORMAT_VERSION} is discarded. */
  readonly formatVersion: number;
  /** When the save was written, as an ISO 8601 instant. Shown on the title screen. */
  readonly savedAt: string;
  /** Where the player was. */
  readonly position: SavePoint;
  /** The ids of the pickups already collected, so they are not spawned again. */
  readonly collected: readonly string[];
  /** The score. */
  readonly score: number;
  /** How long this run has been played, in seconds. */
  readonly playSeconds: number;
}

/**
 * Reads one finite number out of an unknown value.
 *
 * @param value - The candidate.
 * @returns The number, or `null` when it is not one.
 */
function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads a point out of an unknown value.
 *
 * @remarks
 * Narrowed with `in` rather than with a type assertion: `in` is what actually proves the property
 * is there, and the repository forbids asserting a shape onto a value nobody checked.
 *
 * @param value - The candidate.
 * @returns The point, or `null` when the value is not one.
 */
function asPoint(value: unknown): SavePoint | null {
  if (typeof value !== "object" || value === null || !("x" in value) || !("y" in value) || !("z" in value)) {
    return null;
  }
  const x = asFinite(value.x);
  const y = asFinite(value.y);
  const z = asFinite(value.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}

/**
 * Reads a list of ids out of an unknown value.
 *
 * @param value - The candidate.
 * @returns The ids, or `null` when the value is not a list of strings.
 */
function asIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }
    ids.push(entry);
  }
  return ids;
}

/**
 * Turns a stored record into a save this build can use.
 *
 * @param source - Whatever came back out of storage.
 * @returns The save, or `null` when the header or any field is unusable.
 */
export function parseSave(source: Record<string, unknown>): SaveFile | null {
  if (source["format"] !== SAVE_FORMAT || source["formatVersion"] !== SAVE_FORMAT_VERSION) {
    return null;
  }
  const position = asPoint(source["position"]);
  const collected = asIds(source["collected"]);
  const score = asFinite(source["score"]);
  const playSeconds = asFinite(source["playSeconds"]);
  const savedAt = source["savedAt"];
  if (position === null || collected === null || score === null || playSeconds === null) {
    return null;
  }
  return {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    savedAt: typeof savedAt === "string" ? savedAt : "",
    position,
    collected,
    score,
    playSeconds,
  };
}

/**
 * Reads the save, or `null` when there is none this build can use.
 *
 * @param app - The running app.
 * @returns The save, or `null`.
 */
export async function readSave(app: App): Promise<SaveFile | null> {
  let stored: Record<string, unknown> | null;
  try {
    // The generic is the caller's declaration, unchecked exactly as `JSON.parse`'s is, so the
    // record below is a *claim* about the shape rather than a proof of it — which is why every
    // field is checked before it is used.
    stored = await app.storage.namespace(SAVE_NAMESPACE).get<Record<string, unknown>>(SAVE_KEY);
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0011 the save could not be read and was ignored: {error}", String(error));
    return null;
  }
  if (stored === null) {
    return null;
  }
  const save = parseSave(stored);
  if (save === null) {
    app.log.warn(
      `IGX-TPL-0011 the stored save is not a readable ${SAVE_FORMAT} v${String(SAVE_FORMAT_VERSION)} document; ` +
        "it was discarded.",
    );
    await deleteSave(app);
    return null;
  }
  return save;
}

/**
 * Writes the save.
 *
 * @param app - The running app.
 * @param file - The document to store.
 * @returns A promise that settles once the write is durable.
 */
export async function writeSave(app: App, file: SaveFile): Promise<void> {
  try {
    await app.storage.namespace(SAVE_NAMESPACE).set(SAVE_KEY, { ...file, position: { ...file.position } });
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0012 the save could not be stored: {error}", String(error));
  }
}

/**
 * Removes the save.
 *
 * @param app - The running app.
 * @returns A promise that settles once the key is gone.
 */
export async function deleteSave(app: App): Promise<void> {
  try {
    await app.storage.namespace(SAVE_NAMESPACE).delete(SAVE_KEY);
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0012 the save could not be removed: {error}", String(error));
  }
}

/**
 * Builds a save document from the pieces a template tracks.
 *
 * @param position - Where the player is.
 * @param collected - The ids of the pickups already taken.
 * @param score - The score.
 * @param playSeconds - How long this run has been played.
 * @returns The document to hand {@link writeSave}.
 */
export function makeSave(
  position: SavePoint,
  collected: readonly string[],
  score: number,
  playSeconds: number,
): SaveFile {
  return {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    position: { x: position.x, y: position.y, z: position.z },
    collected: [...collected],
    score,
    playSeconds,
  };
}
