import { AudioErrorCode, audioError } from "../errors.js";
import type { IgnifxError, SchemaDescription } from "@ignifx/core";

/**
 * The `ignifx.audiobuses` file format
 * (`docs/architecture/06-serialization-and-scene-format.md` §6, `10-audio.md` §1): the project's
 * mixer tree, in declaration order.
 *
 * ```json
 * {
 *   "format": "ignifx.audiobuses",
 *   "formatVersion": 1,
 *   "buses": [
 *     { "name": "Master" },
 *     { "name": "Music", "parent": "Master", "volume": 0.8 },
 *     { "name": "SFX", "parent": "Master" },
 *     { "name": "UI", "parent": "Master", "pausable": false }
 *   ]
 * }
 * ```
 *
 * ## Why the order in the array matters
 *
 * A bus routes into its parent, so the parent has to exist before the child can be attached to it
 * (Lite's `createAudioBusAsync` takes the parent as `outBus`, `index.d.ts` 2091). Requiring parents
 * to appear earlier in the array is what turns "is this tree well formed?" into one linear pass:
 * a forward reference and a cycle are the same failure, `IGX-1006`, and there is no graph walk.
 * The first bus in the file is the root and needs no parent.
 *
 * ## Failures
 *
 * A malformed tree throws rather than degrading, unlike a material file: everything a game plays is
 * routed through this, so a silent fallback would mean a game shipping with no mixing at all rather
 * than with one dull-looking surface.
 */

/**
 * The `format` discriminator every bus file carries.
 *
 * @public
 */
export const AUDIO_BUSES_FORMAT = "ignifx.audiobuses";

/**
 * The bus-file format version this build reads.
 *
 * @public
 */
export const AUDIO_BUSES_FORMAT_VERSION = 1;

/**
 * The address suffix that selects the bus loader.
 *
 * @public
 */
export const AUDIO_BUSES_FILE_EXTENSION = ".audio.json";

/**
 * The asset type bus files are registered under.
 *
 * @public
 */
export const AUDIO_BUSES_ASSET_TYPE = "audiobuses";

/**
 * One bus of a tree, as the file declares it and as `app.audio` builds it.
 *
 * @public
 */
export interface AudioBusDefinition {
  /** The bus name, unique within the tree; what `app.audio.bus(name)` and `AudioSource.bus` use. */
  readonly name: string;
  /** The bus this one routes into, or `null` for the root. */
  readonly parent: string | null;
  /** The bus's own linear gain, in `[0, 1]`. Defaults to `1`. */
  readonly volume: number;
  /**
   * Whether `app.pause()` pauses the sounds on this bus. `null` defers to the `audio` settings
   * section's `pausableBuses` list, which is the usual case.
   */
  readonly pausable: boolean | null;
}

/**
 * A parsed `.audio.json` (`docs/architecture/10-audio.md` §1).
 *
 * @example
 * ```ts
 * const tree = await app.assets.loadAsync<AudioBusesAsset>("audio/buses.audio.json");
 * tree.value.buses[0].name; // "Master"
 * ```
 *
 * @public
 */
export class AudioBusesAsset {
  /** The type name the asset service registers bus files under. */
  static assetType: string = AUDIO_BUSES_ASSET_TYPE;

  /** The address the tree was loaded from. */
  readonly address: string;

  /** The buses, parents before children. */
  readonly buses: readonly AudioBusDefinition[];

  /**
   * Wraps a validated tree. The `audiobuses` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param buses - The validated definitions, parents before children.
   *
   * @internal
   */
  constructor(address: string, buses: readonly AudioBusDefinition[]) {
    this.address = address;
    this.buses = buses;
  }
}

/**
 * Narrows an unknown JSON value to an object.
 *
 * @param value - The value to test.
 * @returns The value as a record, or `null`.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // A non-null, non-array object is a string-keyed bag.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, unknown>;
}

/**
 * Builds the "not a bus file" failure.
 *
 * @param address - The address that failed.
 * @returns The error to throw.
 */
function notABusFile(address: string): IgnifxError {
  return audioError(AudioErrorCode.invalidBusFile, `${address} is not an ${AUDIO_BUSES_FORMAT} file.`, {
    context: { file: address, format: AUDIO_BUSES_FORMAT },
    hint: `A bus file carries { "format": "${AUDIO_BUSES_FORMAT}", "formatVersion": ${String(AUDIO_BUSES_FORMAT_VERSION)}, "buses": [...] }.`,
  });
}

/**
 * Reads one bus entry over its defaults.
 *
 * @param entry - The array element.
 * @param address - The file address, for diagnostics.
 * @param index - Which element this is, for diagnostics.
 * @param declared - The names declared before this one.
 * @returns The definition.
 * @throws IgnifxError with code `IGX-1003` when the entry has no usable name, `IGX-1005` when the
 * name repeats, or `IGX-1006` when the parent was not declared earlier.
 */
function readBus(entry: unknown, address: string, index: number, declared: ReadonlySet<string>): AudioBusDefinition {
  const bus = asRecord(entry);
  const name = bus?.["name"];
  if (bus === null || typeof name !== "string" || name === "") {
    throw audioError(AudioErrorCode.invalidBusFile, `${address} declares a bus with no name at index ${index}.`, {
      context: { file: address, index: String(index) },
      hint: 'Every entry of "buses" needs a non-empty "name".',
    });
  }
  if (declared.has(name)) {
    throw audioError(AudioErrorCode.duplicateBusName, `The bus ${name} is declared twice in ${address}.`, {
      context: { file: address, bus: name },
      hint: "Bus names are the keys game code routes by, so they have to be unique.",
    });
  }
  const rawParent = bus["parent"];
  const parent = typeof rawParent === "string" && rawParent !== "" ? rawParent : null;
  if (parent !== null && !declared.has(parent)) {
    throw audioError(
      AudioErrorCode.invalidBusParent,
      `The bus ${name} names the parent ${parent}, which ${address} does not declare before it.`,
      {
        context: { file: address, bus: name, parent },
        hint: "List a bus after the bus it routes into; the first entry is the root.",
      },
    );
  }
  const rawVolume = bus["volume"];
  const rawPausable = bus["pausable"];
  return {
    name,
    parent,
    volume: typeof rawVolume === "number" && Number.isFinite(rawVolume) ? rawVolume : 1,
    pausable: typeof rawPausable === "boolean" ? rawPausable : null,
  };
}

/**
 * Parses and validates a `.audio.json` document.
 *
 * @param parsed - The parsed JSON.
 * @param address - The address it came from, for diagnostics.
 * @returns The buses, parents before children.
 * @throws IgnifxError with code `IGX-1003` when the header or the `buses` array is missing,
 * `IGX-1004` when the format version is not readable, `IGX-1005` on a duplicate name, or
 * `IGX-1006` on a parent that is not declared earlier.
 *
 * @example
 * ```ts
 * const buses = parseAudioBusesFile(await ctx.fetchJson(), ctx.address);
 * ```
 *
 * @public
 */
export function parseAudioBusesFile(parsed: unknown, address: string): readonly AudioBusDefinition[] {
  const file = asRecord(parsed);
  if (file === null || file["format"] !== AUDIO_BUSES_FORMAT) {
    throw notABusFile(address);
  }
  const version = file["formatVersion"];
  if (version !== AUDIO_BUSES_FORMAT_VERSION) {
    throw audioError(
      AudioErrorCode.unsupportedBusFileVersion,
      `${address} declares bus format version ${String(version)}, which this build cannot read.`,
      {
        context: { file: address, version: String(version) },
        hint: `This build reads ${AUDIO_BUSES_FORMAT} version ${String(AUDIO_BUSES_FORMAT_VERSION)}.`,
      },
    );
  }
  const entries: unknown = file["buses"];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw notABusFile(address);
  }
  const declared = new Set<string>();
  const buses: AudioBusDefinition[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const bus = readBus(entries[index], address, index, declared);
    declared.add(bus.name);
    buses.push(bus);
  }
  return buses;
}

/**
 * Describes the `ignifx.audiobuses` file format for the documentation harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * @returns The description of the file's fields.
 *
 * @public
 */
export function describeAudioBusesFormat(): SchemaDescription {
  return {
    title: "Audio buses file",
    format: AUDIO_BUSES_FORMAT,
    description:
      "The project's mixer tree: named buses, each routed into a bus declared before it. The first entry is the root.",
    fields: {
      format: { kind: "str", default: AUDIO_BUSES_FORMAT, description: `Always "${AUDIO_BUSES_FORMAT}".` },
      formatVersion: {
        kind: "u32",
        default: AUDIO_BUSES_FORMAT_VERSION,
        description: "The file format version; 1 before ignifx 1.0.",
      },
      buses: {
        kind: "array",
        default: [],
        description: "The buses, parents before children; the first entry is the root.",
      },
      "buses[].name": {
        kind: "str",
        default: "",
        description: 'The bus name game code routes by, for example "SFX".',
      },
      "buses[].parent": {
        kind: "str",
        default: "",
        description: "The bus this one outputs into; empty for the root.",
      },
      "buses[].volume": { kind: "f32", default: 1, description: "The bus's own linear gain, 0 to 1." },
      "buses[].pausable": {
        kind: "bool",
        default: null,
        description: "Whether app.pause() pauses this bus; omitted defers to audio.pausableBuses.",
      },
    },
  };
}
