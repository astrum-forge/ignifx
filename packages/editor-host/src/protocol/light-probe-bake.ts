// Protocol 0.3, additive: the scene host bakes a `LightProbeVolume` from its live edit-mode world.
// Authored here first; the editor copies it to `packages/editor-protocol/src/light-probe-bake.ts`.
/**
 * Protocol 0.3, additive: a light-probe bake run by the scene host, over the world it already has —
 * prefab instances expanded, models loaded, lights with their `bakeMode`, the environment — rather
 * than over a trimmed copy of the scene file. The host answers the `.probes.json` document; the
 * editor writes the file and points the volume at it. Progress arrives as notifications, and a bake
 * is cancelled by request or by any change to the document.
 */
import { isRecord } from "./rpc.js";
import { isFiniteNumber, isJsonObject, isNumberTuple, isString, isUidString, optionalField } from "./scene-file.js";
import type { RpcSuccessResponse } from "./rpc.js";
import type { JsonObject } from "./scene-file.js";
import type { RpcNotificationWithParams, RpcRequestWithParams } from "./scene.js";

/**
 * Editor → scene host: the light-probe bake methods, answered after `ready`.
 *
 * @remarks
 * A host lists `HostCapability.bakeLightProbes` when it answers them; one that does not answers
 * `RpcErrorCode.methodNotFound`. Both run beside the one-at-a-time queue of the other methods:
 * the bake starts in that queue (so it sees every change sent before it), then traces in slices
 * while the queue goes on, so the view keeps answering `applyOps`, `pick` and the rest.
 *
 * @public
 */
export const LightProbeBakeMethod = {
  /**
   * Bakes one `LightProbeVolume` and answers {@link BakeLightProbesResult} when it is done. Fails
   * with `RpcErrorCode.noScene` while no scene is open, and otherwise with the code and the
   * {@link BakeFailureData} that `BakeFailureReason` lists.
   */
  bakeLightProbes: "bakeLightProbes",
  /** Cancels the running bake, if any; answers {@link CancelBakeResult}. The bake then fails as `cancelled`. */
  cancelBake: "cancelBake",
} as const;

/**
 * The union of the names in `LightProbeBakeMethod`.
 *
 * @public
 */
export type LightProbeBakeMethod = (typeof LightProbeBakeMethod)[keyof typeof LightProbeBakeMethod];

/**
 * Scene host → editor: the light-probe bake notifications.
 *
 * @public
 */
export const LightProbeBakeNotification = {
  /**
   * How far the running bake is: {@link BakeProgressParams}. At most one per
   * {@link BAKE_PROGRESS_INTERVAL_MS}; the first comes once the first probe is baked. The answer to
   * `bakeLightProbes` follows the last one.
   */
  bakeProgress: "bakeProgress",
} as const;

/**
 * The union of the names in `LightProbeBakeNotification`.
 *
 * @public
 */
export type LightProbeBakeNotification = (typeof LightProbeBakeNotification)[keyof typeof LightProbeBakeNotification];

/**
 * The shortest time between two `bakeProgress` notifications, in milliseconds (ten a second).
 *
 * @public
 */
export const BAKE_PROGRESS_INTERVAL_MS = 100;

/**
 * The distance between probes when a request gives neither `counts` nor `spacing`, in metres.
 *
 * @public
 */
export const BAKE_DEFAULT_SPACING = 2;

/**
 * The smallest `spacing` a request may give, in metres.
 *
 * @public
 */
export const BAKE_SPACING_MIN = 0.05;

/**
 * The largest `spacing` a request may give, in metres.
 *
 * @public
 */
export const BAKE_SPACING_MAX = 1000;

/**
 * The most probes along X (the `.probes.json` format's limit).
 *
 * @public
 */
export const BAKE_MAX_COUNT_X = 1024;

/**
 * The most probes in one Y × Z slice (the `.probes.json` format's limit).
 *
 * @public
 */
export const BAKE_MAX_COUNT_YZ = 4096;

/**
 * The most probes one bake traces.
 *
 * @public
 */
export const BAKE_MAX_PROBES = 65_536;

/**
 * The most rays per probe (`bakeLightProbes`' own limit).
 *
 * @public
 */
export const BAKE_MAX_RAYS = 4096;

/**
 * The most skips an answer lists; the count in `stats.skipped` is never cut.
 *
 * @public
 */
export const BAKE_MAX_SKIPS = 256;

/**
 * A linear colour, each channel finite (`a` is ignored).
 *
 * @public
 */
export interface BakeColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

/**
 * What rays that hit nothing return, in linear radiance, as core's `LightProbeBakeSky` takes it: a
 * colour, a gradient, or nine spherical-harmonic RGB triples (27 numbers in the order
 * `Y00, Y1-1, Y10, Y11, Y2-2, Y2-1, Y20, Y21, Y22`, on the world axes, Y up).
 *
 * @public
 */
export type BakeSky =
  | BakeColor
  | {
      readonly kind: "gradient";
      readonly sky: BakeColor;
      readonly horizon: BakeColor;
      readonly ground: BakeColor;
    }
  | { readonly kind: "sh9"; readonly coefficients: readonly number[] };

/**
 * The parameters of `bakeLightProbes`.
 *
 * @public
 */
export interface BakeLightProbesParams {
  /**
   * The uid of the entity whose `LightProbeVolume` is baked. Its world position is the box's
   * centre and its world scale the box's size in metres; the grid is axis-aligned (a rotation is
   * ignored). An axis with a size of 0 gets one probe, at the centre.
   */
  readonly volume: string;
  /**
   * The probes along X, Y and Z, each a whole number from 1, spread over the box (one probe on an
   * axis sits at the centre). Not with `spacing`.
   */
  readonly counts?: readonly [number, number, number];
  /**
   * The largest distance between neighbouring probes, in metres, from {@link BAKE_SPACING_MIN} to
   * {@link BAKE_SPACING_MAX}; each axis of size above 0 gets at least two probes, on its faces.
   * Defaults to {@link BAKE_DEFAULT_SPACING} when `counts` is absent too. Not with `counts`.
   */
  readonly spacing?: number;
  /**
   * Whether the probes also store the direct light of `"realtime"` lights (core's
   * `LightProbeBakeOptions.directLight`). Defaults to `"exclude"`.
   */
  readonly directLight?: "include" | "exclude";
  /**
   * What rays that hit nothing return. Absent: the scene's `Environment` diffuse harmonics, rotated
   * as the environment is, when the host has them (a host with a GPU, an installed `.env`); black
   * otherwise. `null`: black.
   */
  readonly sky?: BakeSky | null;
  /** Rays per probe, 1 to {@link BAKE_MAX_RAYS}. Defaults to 128. */
  readonly rays?: number;
  /** How far a ray looks for a surface, in metres; above 0. Defaults to 100. */
  readonly maxDistance?: number;
}

/**
 * The parameters of `bakeProgress`.
 *
 * @public
 */
export interface BakeProgressParams {
  /** The volume being baked. */
  readonly volume: string;
  /** Probes baked so far. */
  readonly done: number;
  /** Probes in the grid. */
  readonly total: number;
}

/**
 * Something the bake could not trace, and why (core's `LightProbeBakeSkip`).
 *
 * @public
 */
export interface BakeSkip {
  /** The entity's name. */
  readonly entity: string;
  /** The entity's uid. */
  readonly uid: string;
  /** The component's type id: `ignifx/MeshRenderer` or `ignifx/Model`. */
  readonly component: string;
  /** Why, in one line. */
  readonly reason: string;
}

/**
 * Where a bake's sky came from: the request, the scene's environment, or nowhere (black).
 *
 * @public
 */
export type BakeSkySource = "request" | "environment" | "none";

/**
 * The answer to `bakeLightProbes`.
 *
 * @public
 */
export interface BakeLightProbesResult {
  /** The `.probes.json` document (`writeLightProbeFile`), for the editor to write. */
  readonly probes: JsonObject;
  /** What was baked. */
  readonly stats: {
    /** Probes in the grid. */
    readonly probes: number;
    /** Triangles the rays were traced against. */
    readonly triangles: number;
    /** Enabled mesh renderers and models that gave no triangles at all. */
    readonly skipped: number;
    /** Wall-clock milliseconds, from the start of the bake to its end. */
    readonly ms: number;
  };
  /** What the bake left out, and why; at most {@link BAKE_MAX_SKIPS}. */
  readonly skips: readonly BakeSkip[];
  /** Where the sky came from. */
  readonly sky: BakeSkySource;
}

/**
 * The answer to `cancelBake`.
 *
 * @public
 */
export interface CancelBakeResult {
  /** Whether a bake was running (it now fails as `cancelled`). */
  readonly cancelled: boolean;
}

/**
 * Why `bakeLightProbes` failed, in its error's `data.reason`, with the error code each comes with:
 *
 * - `unknownEntity` (`RpcErrorCode.unknownEntity`): `volume` names no entity of the open scene;
 * - `notAVolume` (`RpcErrorCode.invalidParams`): the entity has no `LightProbeVolume`;
 * - `invalidGrid` (`RpcErrorCode.invalidParams`): the grid is more than a `.probes.json` holds or
 *   more than {@link BAKE_MAX_PROBES}, or the volume's transform is not finite;
 * - `busy` (`RpcErrorCode.invalidRequest`): a bake is running; cancel it or wait;
 * - `cancelled` (`RpcErrorCode.invalidRequest`): `cancelBake`, or a change to the document, stopped
 *   it (`data.cause`).
 *
 * @public
 */
export const BakeFailureReason = {
  unknownEntity: "unknownEntity",
  notAVolume: "notAVolume",
  invalidGrid: "invalidGrid",
  busy: "busy",
  cancelled: "cancelled",
} as const;

/**
 * The union of the names in `BakeFailureReason`.
 *
 * @public
 */
export type BakeFailureReason = (typeof BakeFailureReason)[keyof typeof BakeFailureReason];

/**
 * What stopped a cancelled bake: `cancelBake`, or a change to the open document (`openScene`,
 * `closeScene`, `applyOps`, `setTilemapCells`, an asset reload that rebuilt instances, or a hot
 * reload's new defaults), since a bake must not mix the old world with the new.
 *
 * @public
 */
export const BakeCancelCause = {
  cancelBake: "cancelBake",
  sceneChanged: "sceneChanged",
} as const;

/**
 * The union of the names in `BakeCancelCause`.
 *
 * @public
 */
export type BakeCancelCause = (typeof BakeCancelCause)[keyof typeof BakeCancelCause];

/**
 * The `data` of a failed `bakeLightProbes`.
 *
 * @public
 */
export interface BakeFailureData {
  /** Why. */
  readonly reason: BakeFailureReason;
  /** What cancelled it, for `cancelled`. */
  readonly cause?: BakeCancelCause;
}

/**
 * Editor → scene host: one of the `LightProbeBakeMethod`s.
 *
 * @public
 */
export type LightProbeBakeRequest =
  | RpcRequestWithParams<typeof LightProbeBakeMethod.bakeLightProbes, BakeLightProbesParams>
  | RpcRequestWithParams<typeof LightProbeBakeMethod.cancelBake, Readonly<Record<string, never>>>;

/**
 * Scene host → editor: `bakeProgress`.
 *
 * @public
 */
export type BakeProgressNotification = RpcNotificationWithParams<
  typeof LightProbeBakeNotification.bakeProgress,
  BakeProgressParams
>;

/**
 * The success answer to `bakeLightProbes`.
 *
 * @public
 */
export type BakeLightProbesResponse = RpcSuccessResponse<BakeLightProbesResult>;

/**
 * The success answer to `cancelBake`.
 *
 * @public
 */
export type CancelBakeResponse = RpcSuccessResponse<CancelBakeResult>;

/**
 * Tells whether a value is a colour with finite `r`, `g`, `b` and, when present, `a`.
 *
 * @param value - The value to test.
 * @returns True for a colour.
 */
function isBakeColor(value: unknown): value is BakeColor {
  return (
    isRecord(value) &&
    isFiniteNumber(value["r"]) &&
    isFiniteNumber(value["g"]) &&
    isFiniteNumber(value["b"]) &&
    optionalField(value, "a", isFiniteNumber)
  );
}

/**
 * Checks a sky.
 *
 * @param value - The value to test.
 * @returns True for a colour, a gradient of three colours, or 27 finite harmonics.
 *
 * @public
 */
export function isBakeSky(value: unknown): value is BakeSky {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value["kind"];
  if (kind === undefined) {
    return isBakeColor(value);
  }
  if (kind === "gradient") {
    return isBakeColor(value["sky"]) && isBakeColor(value["horizon"]) && isBakeColor(value["ground"]);
  }
  return kind === "sh9" && isNumberTuple(value["coefficients"], 27);
}

/**
 * Tells whether a value is three probe counts the format holds, no more than {@link BAKE_MAX_PROBES} in all.
 *
 * @param value - The value to test.
 * @returns True for three whole numbers from 1 in range.
 */
function isBakeCounts(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((count) => Number.isSafeInteger(count))) {
    return false;
  }
  const [x, y, z] = value.map(Number);
  return (
    x !== undefined &&
    y !== undefined &&
    z !== undefined &&
    x >= 1 &&
    y >= 1 &&
    z >= 1 &&
    x <= BAKE_MAX_COUNT_X &&
    y * z <= BAKE_MAX_COUNT_YZ &&
    x * y * z <= BAKE_MAX_PROBES
  );
}

/**
 * Checks the parameters of `bakeLightProbes`.
 *
 * @param value - The received `params`.
 * @returns True for a volume uid and, when given, counts or a spacing (not both), a direct-light
 * rule, a sky or `null`, rays and a ray length in range.
 *
 * @public
 */
export function isBakeLightProbesParams(value: unknown): value is BakeLightProbesParams {
  return (
    isRecord(value) &&
    isUidString(value["volume"]) &&
    !(value["counts"] !== undefined && value["spacing"] !== undefined) &&
    optionalField(value, "counts", isBakeCounts) &&
    optionalField(
      value,
      "spacing",
      (spacing) => isFiniteNumber(spacing) && spacing >= BAKE_SPACING_MIN && spacing <= BAKE_SPACING_MAX,
    ) &&
    optionalField(value, "directLight", (rule) => rule === "include" || rule === "exclude") &&
    optionalField(value, "sky", (sky) => sky === null || isBakeSky(sky)) &&
    optionalField(
      value,
      "rays",
      (rays) => Number.isSafeInteger(rays) && Number(rays) >= 1 && Number(rays) <= BAKE_MAX_RAYS,
    ) &&
    optionalField(value, "maxDistance", (distance) => isFiniteNumber(distance) && distance > 0)
  );
}

/**
 * Checks the parameters of `bakeProgress`.
 *
 * @param value - The received `params`.
 * @returns True for a volume uid and `0 ≤ done ≤ total`, whole numbers.
 *
 * @public
 */
export function isBakeProgressParams(value: unknown): value is BakeProgressParams {
  if (!isRecord(value) || !isUidString(value["volume"])) {
    return false;
  }
  const done = value["done"];
  const total = value["total"];
  return (
    Number.isSafeInteger(done) && Number.isSafeInteger(total) && Number(done) >= 0 && Number(done) <= Number(total)
  );
}

/**
 * Tells whether a value is one skip.
 *
 * @param value - The value to test.
 * @returns True for four strings.
 */
function isBakeSkip(value: unknown): value is BakeSkip {
  return (
    isRecord(value) &&
    isString(value["entity"]) &&
    isString(value["uid"]) &&
    isString(value["component"]) &&
    isString(value["reason"])
  );
}

/**
 * Checks the result of `bakeLightProbes`.
 *
 * @param value - The received `result`.
 * @returns True for a `.probes.json` document, whole-number stats, at most {@link BAKE_MAX_SKIPS}
 * skips and a sky source.
 *
 * @public
 */
export function isBakeLightProbesResult(value: unknown): value is BakeLightProbesResult {
  if (!isRecord(value) || !isJsonObject(value["probes"]) || value["probes"]["format"] !== "ignifx-probes") {
    return false;
  }
  const stats = value["stats"];
  const skips = value["skips"];
  const sky = value["sky"];
  return (
    isRecord(stats) &&
    Number.isSafeInteger(stats["probes"]) &&
    Number.isSafeInteger(stats["triangles"]) &&
    Number.isSafeInteger(stats["skipped"]) &&
    isFiniteNumber(stats["ms"]) &&
    Array.isArray(skips) &&
    skips.length <= BAKE_MAX_SKIPS &&
    skips.every((skip) => isBakeSkip(skip)) &&
    (sky === "request" || sky === "environment" || sky === "none")
  );
}

/**
 * Checks the result of `cancelBake`.
 *
 * @param value - The received `result`.
 * @returns True for `{ cancelled: boolean }`.
 *
 * @public
 */
export function isCancelBakeResult(value: unknown): value is CancelBakeResult {
  return isRecord(value) && typeof value["cancelled"] === "boolean";
}

/**
 * Checks the `data` of a failed `bakeLightProbes`.
 *
 * @param value - The received error `data`.
 * @returns True for a known reason and, when present, a known cause.
 *
 * @public
 */
export function isBakeFailureData(value: unknown): value is BakeFailureData {
  return (
    isRecord(value) &&
    Object.values(BakeFailureReason).some((reason) => reason === value["reason"]) &&
    optionalField(value, "cause", (cause) => Object.values(BakeCancelCause).some((known) => known === cause))
  );
}
