/**
 * `bakeLightProbes` (`LightProbeBakeMethod`): the scene host bakes a `LightProbeVolume` with core's
 * `bakeLightProbes` over its live edit-mode world, so the bake traces what the view shows — prefab
 * instance members, models (read from their drawn meshes under a GPU), lights with their
 * `bakeMode`, transforms with their rotations — and the environment's diffuse harmonics as the sky.
 * The host writes no file: the answer carries the `.probes.json` document.
 *
 * The pure parts (the grid for a volume, the progress throttle, the sky from Lite's harmonics) are
 * exported for the Node tests.
 */

import {
  bakeLightProbes,
  CoreErrorCode,
  Environment,
  isIgnifxError,
  LightProbeVolume,
  writeLightProbeFile,
} from "@ignifx/core";
import { InvalidParamsError, RpcFailure } from "../channel.js";
import {
  BAKE_COEFFICIENT_DIGITS,
  BAKE_DEFAULT_SPACING,
  BAKE_MAX_COEFFICIENT,
  BAKE_MAX_COUNT_X,
  BAKE_MAX_COUNT_YZ,
  BAKE_MAX_PROBES,
  BAKE_MAX_SKIPS,
  BAKE_PROGRESS_INTERVAL_MS,
  BakeCancelCause,
  BakeFailureReason,
  isBakeLightProbesParams,
  LightProbeBakeNotification,
  RpcErrorCode,
} from "../protocol/index.js";
import type {
  BakeFailureData,
  BakeLightProbesParams,
  BakeLightProbesResult,
  BakeProgressParams,
  BakeSkySource,
  JsonObject,
} from "../protocol/index.js";
import type { App, LightProbeBakeSky, LightProbeBakeSkyHarmonics, SceneInstance } from "@ignifx/core";

/** A probe grid, as core's `bakeLightProbes` takes it. */
export interface BakeGrid {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly cellSize: { readonly x: number; readonly y: number; readonly z: number };
  readonly counts: { readonly x: number; readonly y: number; readonly z: number };
}

/** One axis of a grid: how many probes and the distance between them. */
interface AxisProbes {
  readonly count: number;
  readonly cell: number;
}

/**
 * The probes along one axis of a box for a spacing: one for a flat side, else at least two (on the
 * box's faces) and enough that neighbours are at most `spacing` apart. The editor's own planner
 * (`probeGridForVolume`) does the same.
 *
 * @param size - The box's side, in metres.
 * @param spacing - The largest distance between probes.
 * @returns The axis.
 */
function axisForSpacing(size: number, spacing: number): AxisProbes {
  if (!(size > 1e-6)) {
    return { count: 1, cell: 1 };
  }
  const count = Math.max(2, Math.ceil(size / spacing - 1e-9) + 1);
  return { count, cell: size / (count - 1) };
}

/**
 * The probes along one axis of a box for a count: one at the centre, else spread face to face.
 *
 * @param size - The box's side, in metres.
 * @param count - How many probes.
 * @returns The axis.
 */
function axisForCount(size: number, count: number): AxisProbes {
  if (count === 1) {
    return { count, cell: 1 };
  }
  // A flat side keeps a positive cell, as the format needs, so its probes stack at the centre.
  return { count, cell: Math.max(size, 1e-6) / (count - 1) };
}

/**
 * The grid for a volume: the volume entity's box (centred on its world position, its world scale
 * as the size in metres, axis-aligned), with the request's counts or spacing.
 *
 * @param world - The volume entity's world matrix, column-major.
 * @param request - The request's `counts` or `spacing`.
 * @param request.counts - Probes along X, Y and Z.
 * @param request.spacing - The largest distance between probes, in metres.
 * @returns The grid, or why it cannot be baked.
 */
export function bakeGridForVolume(
  world: ArrayLike<number>,
  request: { readonly counts?: readonly [number, number, number]; readonly spacing?: number },
): BakeGrid | { readonly problem: string } {
  const at = (index: number): number => world[index] ?? 0;
  const size = [Math.hypot(at(0), at(1), at(2)), Math.hypot(at(4), at(5), at(6)), Math.hypot(at(8), at(9), at(10))];
  const centre = [at(12), at(13), at(14)];
  if (![...size, ...centre].every(Number.isFinite)) {
    return { problem: "The volume's transform is not finite." };
  }
  const counts = request.counts;
  const axes = size.map((side, axis) =>
    counts === undefined
      ? axisForSpacing(side, request.spacing ?? BAKE_DEFAULT_SPACING)
      : axisForCount(side, counts[axis] ?? 1),
  );
  const [x, y, z] = axes;
  if (x === undefined || y === undefined || z === undefined) {
    return { problem: "The grid has no axes." };
  }
  const shape = `A ${String(x.count)} × ${String(y.count)} × ${String(z.count)} grid`;
  if (x.count > BAKE_MAX_COUNT_X || y.count * z.count > BAKE_MAX_COUNT_YZ) {
    return {
      problem: `${shape} is more than a .probes.json holds (X at most ${String(BAKE_MAX_COUNT_X)}, Y × Z at most ${String(BAKE_MAX_COUNT_YZ)}).`,
    };
  }
  if (x.count * y.count * z.count > BAKE_MAX_PROBES) {
    return { problem: `${shape} is more than ${String(BAKE_MAX_PROBES)} probes.` };
  }
  const first = (axis: AxisProbes, index: number): number =>
    (centre[index] ?? 0) - (axis.count === 1 ? 0 : (axis.cell * (axis.count - 1)) / 2);
  return {
    origin: { x: first(x, 0), y: first(y, 1), z: first(z, 2) },
    cellSize: { x: x.cell, y: y.cell, z: z.cell },
    counts: { x: x.count, y: y.count, z: z.count },
  };
}

/**
 * Lets progress through at most once per interval: the first report at once, then one whenever the
 * interval has passed since the last one let through.
 */
export class ProgressThrottle {
  readonly #intervalMs: number;

  readonly #now: () => number;

  readonly #emit: (done: number, total: number) => void;

  #last = Number.NEGATIVE_INFINITY;

  /**
   * Creates the throttle.
   *
   * @param intervalMs - The shortest time between two reports let through.
   * @param now - The clock, in milliseconds.
   * @param emit - Receives each report let through.
   */
  constructor(intervalMs: number, now: () => number, emit: (done: number, total: number) => void) {
    this.#intervalMs = intervalMs;
    this.#now = now;
    this.#emit = emit;
  }

  /**
   * Reports progress; it goes through when the interval has passed.
   *
   * @param done - Probes baked.
   * @param total - Probes in all.
   */
  report(done: number, total: number): void {
    const now = this.#now();
    if (now - this.#last < this.#intervalMs) {
      return;
    }
    this.#last = now;
    this.#emit(done, total);
  }
}

/** The real SH basis constants for bands 0–2, in the order of `LightProbeBakeSkyHarmonics`. */
const SH_BASIS = [
  0.282_094_791_773_878_1, 0.488_602_511_902_919_9, 0.488_602_511_902_919_9, 0.488_602_511_902_919_9,
  1.092_548_430_592_079_2, 1.092_548_430_592_079_2, 0.315_391_565_252_520_05, 1.092_548_430_592_079_2,
  0.546_274_215_296_039_6,
];

/** The clamped-cosine convolution per band, over π: 1, 2/3 and 1/4. */
const LAMBERT_OVER_PI = [1, 2 / 3, 2 / 3, 2 / 3, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4];

/**
 * Turns an installed environment's diffuse harmonics, as Lite holds them, into a radiance sky for
 * the bake.
 *
 * @remarks
 * Lite's PBR shader (`lib/material/pbr/fragments/ibl-fragment.js`) lights a surface of normal `N`
 * with `Σ Pᵢ·bᵢ(N')`: `Pᵢ` the nine pre-scaled harmonics (`EnvironmentTextures.sphericalHarmonics`,
 * 36 floats in stride 4: `L00, L1-1, L10, L11, L2-2, L2-1, L20, L21, L22`), `bᵢ` the polynomials
 * `1, y, z, x, xy, yz, 3z²−1, zx, x²−y²`, and `N' = rotateY(N, envRotationY)`. That sum is the
 * outgoing radiance of a white Lambertian surface. The bake's sky is incident radiance
 * `Σ cᵢ·Kᵢ·bᵢ(d)`, so `cᵢ = Qᵢ / (Kᵢ·Aₗ/π)`, with `Qᵢ` the shader's polynomial turned into world
 * axes (the rotation folded in) and `Aₗ/π` the band's cosine convolution: a uniform environment
 * then bakes to the same `c0` the shader shows.
 *
 * @param preScaled - Lite's 36 floats.
 * @param rotation - The environment's Y rotation, in radians (`Environment.rotation` in degrees, converted).
 * @returns The sky, or `null` when the harmonics are not 36 finite numbers.
 */
export function skyFromPreScaledHarmonics(
  preScaled: ArrayLike<number>,
  rotation: number,
): LightProbeBakeSkyHarmonics | null {
  if (preScaled.length < 36 || !Number.isFinite(rotation)) {
    return null;
  }
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const coefficients: number[] = Array.from({ length: 27 }, () => 0);
  for (let channel = 0; channel < 3; channel += 1) {
    const p = (term: number): number => preScaled[term * 4 + channel] ?? Number.NaN;
    // `rotateY(v, a) = (x·c + z·s, y, −x·s + z·c)`, substituted into each polynomial and re-expressed
    // in the same basis (with x² + y² + z² = 1).
    const q = [
      p(0),
      p(1),
      c * p(2) + s * p(3),
      -s * p(2) + c * p(3),
      c * p(4) - s * p(5),
      s * p(4) + c * p(5),
      (c * c - (s * s) / 2) * p(6) + ((s * c) / 2) * p(7) + ((s * s) / 2) * p(8),
      -6 * s * c * p(6) + (c * c - s * s) * p(7) + 2 * s * c * p(8),
      ((3 * s * s) / 2) * p(6) - ((s * c) / 2) * p(7) + ((1 + c * c) / 2) * p(8),
    ];
    for (let term = 0; term < 9; term += 1) {
      coefficients[term * 3 + channel] = (q[term] ?? 0) / ((SH_BASIS[term] ?? 1) * (LAMBERT_OVER_PI[term] ?? 1));
    }
  }
  return coefficients.every(Number.isFinite) ? { kind: "sh9", coefficients } : null;
}

/**
 * The sky of the open document's environment: the first enabled `Environment` in it whose
 * installed asset has Lite harmonics (only under a GPU).
 *
 * @param app - The scene view's app.
 * @param scene - The open document.
 * @returns The sky, or `null`.
 */
export function environmentSky(app: App, scene: SceneInstance): LightProbeBakeSkyHarmonics | null {
  for (const environment of app.world.components(Environment)) {
    if (!environment.isEnabledInHierarchy || environment.entity.scene !== scene) {
      continue;
    }
    const harmonics = environment.installed?.lite.textures?.sphericalHarmonics;
    if (harmonics !== undefined) {
      return skyFromPreScaledHarmonics(harmonics, (environment.rotation * Math.PI) / 180);
    }
  }
  return null;
}

/** The reason an aborted bake rejects with. */
class BakeCancelled extends Error {
  /** What cancelled it. */
  readonly bakeCause: BakeCancelCause;

  /**
   * Creates the reason.
   *
   * @param cause - What cancelled the bake.
   */
  constructor(cause: BakeCancelCause) {
    super(`The bake was cancelled (${cause}).`);
    this.name = "BakeCancelled";
    this.bakeCause = cause;
  }
}

/**
 * A failure with {@link BakeFailureData}.
 *
 * @param code - The error code.
 * @param message - What went wrong.
 * @param data - Why.
 * @returns The failure.
 */
function bakeFailure(code: RpcErrorCode, message: string, data: BakeFailureData): RpcFailure {
  return new RpcFailure(code, message, data);
}

/** A started bake. */
export interface StartedBake {
  /** Settles with the answer, or rejects with an `RpcFailure`. */
  readonly finished: Promise<BakeLightProbesResult>;
}

/** A bake asked for whose queue slot has not run yet. */
export interface PendingBake {
  /** Set by `cancelBake` before the slot runs: the slot then fails without baking. */
  cancelled: boolean;
}

/**
 * Rounds the baked coefficients for the answer: {@link BAKE_COEFFICIENT_DIGITS} significant digits,
 * `0` below `1e-6` in magnitude.
 *
 * @param coefficients - The baked coefficients.
 * @returns The rounded ones, or `null` when one is not finite or above {@link BAKE_MAX_COEFFICIENT}.
 */
export function answerCoefficients(coefficients: readonly number[]): number[] | null {
  const out: number[] = [];
  for (const value of coefficients) {
    if (!Number.isFinite(value) || Math.abs(value) > BAKE_MAX_COEFFICIENT) {
      return null;
    }
    // `+ 0` turns a rounded `-0` into `0`.
    out.push(Math.abs(value) < 1e-6 ? 0 : Number(value.toPrecision(BAKE_COEFFICIENT_DIGITS)) + 0);
  }
  return out;
}

/** Runs one bake at a time over the scene view's world. */
export class LightProbeBaker {
  readonly #notify: (method: string, params: unknown) => void;

  readonly #now: () => number;

  #running: AbortController | null = null;

  #pending: PendingBake | null = null;

  /**
   * Creates the baker.
   *
   * @param notify - Sends a notification to the editor.
   * @param now - The clock, in milliseconds.
   */
  constructor(notify: (method: string, params: unknown) => void, now: () => number = () => performance.now()) {
    this.#notify = notify;
    this.#now = now;
  }

  /**
   * Whether a bake is pending or running.
   *
   * @returns True from a reservation to the bake's end.
   */
  get busy(): boolean {
    return this.#running !== null || this.#pending !== null;
  }

  /**
   * Reserves the baker for a request whose queue slot is still to run, so `cancelBake` can cancel it
   * before it starts and a second request is `busy` at once.
   *
   * @returns The reservation, for {@link LightProbeBaker.start}.
   * @throws RpcFailure `busy` while a bake is pending or running.
   */
  reserve(): PendingBake {
    if (this.busy) {
      throw busyFailure();
    }
    const pending: PendingBake = { cancelled: false };
    this.#pending = pending;
    return pending;
  }

  /**
   * Checks the request and starts the bake. Everything the bake reads of the world — meshes, models,
   * lights, transforms, the environment — is read before this returns (core reads the world once,
   * before its first yield), so it must run in the host's queue.
   *
   * @param app - The scene view's app.
   * @param scene - The open document, or `null`.
   * @param params - The request's parameters.
   * @param pending - The reservation, from {@link LightProbeBaker.reserve}; released here.
   * @returns The started bake.
   * @throws RpcFailure as `BakeFailureReason` lists, `InvalidParamsError` for bad parameters,
   * `RpcErrorCode.noScene` with no document.
   */
  start(app: App, scene: SceneInstance | null, params: unknown, pending: PendingBake): StartedBake {
    try {
      if (pending.cancelled) {
        throw toFailure(new BakeCancelled(BakeCancelCause.cancelBake));
      }
      return this.#start(app, scene, params);
    } finally {
      if (this.#pending === pending) {
        this.#pending = null;
      }
    }
  }

  /**
   * {@link LightProbeBaker.start}, once the reservation stands.
   *
   * @param app - The scene view's app.
   * @param scene - The open document, or `null`.
   * @param params - The request's parameters.
   * @returns The started bake.
   */
  #start(app: App, scene: SceneInstance | null, params: unknown): StartedBake {
    if (!isBakeLightProbesParams(params)) {
      throw new InvalidParamsError(
        'bakeLightProbes takes { volume: uid, counts?: [x, y, z] | spacing?: metres, directLight?: "include" | "exclude", sky?, rays?, maxDistance? }.',
      );
    }
    if (scene === null) {
      throw new RpcFailure(RpcErrorCode.noScene, 'No scene is open; send "openScene" before "bakeLightProbes".');
    }
    if (this.#running !== null) {
      throw busyFailure();
    }
    const entity = app.world.getEntity(params.volume);
    if (entity === null || entity.scene !== scene) {
      throw bakeFailure(RpcErrorCode.unknownEntity, `The open scene has no entity ${params.volume}.`, {
        reason: BakeFailureReason.unknownEntity,
      });
    }
    if (entity.getComponent(LightProbeVolume) === null) {
      throw bakeFailure(RpcErrorCode.invalidParams, `${entity.name} has no LightProbeVolume.`, {
        reason: BakeFailureReason.notAVolume,
      });
    }
    const grid = bakeGridForVolume(entity.transform.worldMatrix, params);
    if ("problem" in grid) {
      throw bakeFailure(RpcErrorCode.invalidParams, grid.problem, { reason: BakeFailureReason.invalidGrid });
    }
    const { sky, source } = this.#sky(app, scene, params);
    const controller = new AbortController();
    const started = this.#now();
    const volume = params.volume;
    const throttle = new ProgressThrottle(BAKE_PROGRESS_INTERVAL_MS, this.#now, (done, total) => {
      const progress: BakeProgressParams = { volume, done, total };
      this.#notify(LightProbeBakeNotification.bakeProgress, progress);
    });
    this.#running = controller;
    let baking: ReturnType<typeof bakeLightProbes>;
    try {
      // Synchronous up to its first yield: the world is read here, in the caller's queue slot.
      baking = bakeLightProbes(app.world, {
        ...grid,
        ...(params.rays === undefined ? {} : { rays: params.rays }),
        ...(params.maxDistance === undefined ? {} : { maxDistance: params.maxDistance }),
        ...(params.directLight === undefined ? {} : { directLight: params.directLight }),
        ...(sky === null ? {} : { sky }),
        signal: controller.signal,
        onProgress: (done, total) => {
          throttle.report(done, total);
        },
      });
    } catch (error) {
      this.#running = null;
      throw toFailure(error);
    }
    const finished = baking.then(
      (baked): BakeLightProbesResult => {
        this.#end(controller);
        const coefficients = answerCoefficients(baked.data.coefficients);
        if (coefficients === null) {
          throw bakeFailure(
            RpcErrorCode.invalidRequest,
            `The bake gave a coefficient that is not finite or above ${String(BAKE_MAX_COEFFICIENT)}: a light or the sky is far too bright.`,
            { reason: BakeFailureReason.outOfRange },
          );
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `writeLightProbeFile` writes numbers, strings and plain records only.
        const probes = writeLightProbeFile({ ...baked.data, coefficients }) as JsonObject;
        return {
          probes,
          stats: {
            probes: grid.counts.x * grid.counts.y * grid.counts.z,
            triangles: baked.triangles,
            skipped: baked.skipped,
            ms: Math.round(this.#now() - started),
          },
          skips: baked.skips
            .slice(0, BAKE_MAX_SKIPS)
            .map((skip) => ({ entity: skip.entity, uid: skip.uid, component: skip.component, reason: skip.reason })),
          sky: source,
        };
      },
      (error: unknown): never => {
        this.#end(controller);
        throw toFailure(error);
      },
    );
    return { finished };
  }

  /**
   * Cancels the running bake, if any, or with `cancelBake` the pending one. A document change leaves
   * a pending bake alone: it has not read the world yet, and will read the changed one.
   *
   * @param cause - What cancels it.
   * @returns Whether one was cancelled.
   */
  cancel(cause: BakeCancelCause): boolean {
    const running = this.#running;
    if (running === null) {
      const pending = this.#pending;
      if (pending === null || pending.cancelled || cause !== BakeCancelCause.cancelBake) {
        return false;
      }
      pending.cancelled = true;
      return true;
    }
    this.#running = null;
    running.abort(new BakeCancelled(cause));
    return true;
  }

  /** Cancels the running bake; the host is going away. */
  dispose(): void {
    this.cancel(BakeCancelCause.sceneChanged);
  }

  /**
   * Forgets a bake that ended, unless another has started since.
   *
   * @param controller - The bake's controller.
   */
  #end(controller: AbortController): void {
    if (this.#running === controller) {
      this.#running = null;
    }
  }

  /**
   * The sky a request bakes with, and where it came from.
   *
   * @param app - The app.
   * @param scene - The open document.
   * @param params - The request.
   * @returns The sky (`null` for black) and its source.
   */
  #sky(
    app: App,
    scene: SceneInstance,
    params: BakeLightProbesParams,
  ): { readonly sky: LightProbeBakeSky | null; readonly source: BakeSkySource } {
    if (params.sky === null) {
      return { sky: null, source: "none" };
    }
    if (params.sky !== undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `isBakeSky` checked the same shapes core takes.
      return { sky: params.sky as LightProbeBakeSky, source: "request" };
    }
    const fromEnvironment = environmentSky(app, scene);
    return fromEnvironment === null ? { sky: null, source: "none" } : { sky: fromEnvironment, source: "environment" };
  }
}

/**
 * The failure of a request made while a bake is pending or running.
 *
 * @returns The failure.
 */
function busyFailure(): RpcFailure {
  return bakeFailure(RpcErrorCode.invalidRequest, "A light-probe bake is already running; cancel it or wait.", {
    reason: BakeFailureReason.busy,
  });
}

/**
 * Turns what a bake threw into the method's failure.
 *
 * @param error - What it threw: a cancellation, a refused option, or a bug.
 * @returns The failure to answer with.
 */
function toFailure(error: unknown): unknown {
  if (error instanceof BakeCancelled) {
    return bakeFailure(RpcErrorCode.invalidRequest, error.message, {
      reason: BakeFailureReason.cancelled,
      cause: error.bakeCause,
    });
  }
  if (isIgnifxError(error) && error.code === CoreErrorCode.invalidLightProbeBake) {
    return new InvalidParamsError(error.message, { code: error.code });
  }
  return error;
}
