import { toEntityHandle } from "../../handles/handle.js";
import {
  assignReflectionProbe,
  createLiteProbeSet,
  createLiteReflectionProbe,
  enableReflectionProbes,
  forEachReflectiveMesh,
} from "../../lite/gpu/reflection-probe.js";
import {
  reflectionProbeBlendLayout,
  resolveReflectionProbeRefreshMode,
  resolveReflectionProbeSize,
  selectReflectionProbe,
} from "../reflection-probe.js";
import { EDITOR_ONLY_METADATA_KEY } from "../render-texture.js";
import type { LiteProbeBinding, LiteProbeSet, LiteReflectionProbe } from "../../lite/gpu/reflection-probe.js";
import type { NodeTag } from "../../lite/node.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { Vec3Like } from "../../math/types.js";
import type { World } from "../../world/world.js";
import type {
  ReflectionProbe,
  ReflectionProbeBlendCandidate,
  ReflectionProbeBlendLayout,
} from "../reflection-probe.js";
import type { RenderingQualityPreset } from "../rendering-settings.js";

/**
 * The render layer's half of reflection probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`,
 * step B1): which probe captures when, and which probe each PBR material reflects. Loaded with
 * `../../lite/gpu/reflection-probe.ts` as one chunk, only once a world has a `ReflectionProbe`.
 *
 * Blending (B1b): when `reflectionProbeBlendLayout` says the frame's probes blend and every box probe
 * has finished capturing (none `everyFrame`), one Lite probe set built from their cubes goes on every
 * lit PBR material. The set copies the cubes, so it is rebuilt when a probe moves, recaptures,
 * resizes its box or changes `blendDistance`, and the replaced set is freed once the material
 * rebuilds that dropped it settled. While a box probe is still capturing, the last set stays (or,
 * before the first, the nearest-probe choice applies); while one is being moved or edited (its
 * binding or `blendDistance` changed within the last {@link BLEND_STILL_FRAMES} frames) the
 * nearest-probe choice applies. A material whose nearest probe has no box keeps that probe. A set Lite refuses (more than four probes
 * overlapping in a voxel, too many probes) logs once and the nearest-probe choice applies.
 */

/**
 * How many consecutive frames one capture request renders. Lite compiles material pipelines
 * asynchronously, so a single frame right after start or after a scene change can miss meshes that
 * are still compiling; repeating it for a few frames catches them.
 */
const CAPTURE_FRAMES = 8;

/**
 * How many frames a blended probe's position, box and `blendDistance` must stay unchanged before a
 * probe set is built with it (about 250 ms at 60 Hz). A set copies every cube and rebuilds every lit
 * material, so a probe being moved, dragged or scrubbed falls back to the nearest-probe choice until
 * it rests.
 */
const BLEND_STILL_FRAMES = 15;

/** One component's GPU probe and what it last captured with. */
interface ProbeState {
  /** The GPU probe. */
  lite: LiteReflectionProbe;
  /** How many more frames capture before the probe rests. */
  framesToCapture: number;
  /** The binding materials use, rebuilt when the probe moves or its box changes. */
  binding: LiteProbeBinding | null;
  /** How many captures it ran, so a blended set made before a recapture is rebuilt. */
  generation: number;
  /** The `blendDistance` seen last frame. */
  blendDistance: number;
  /** How many frames its binding and `blendDistance` have not changed. */
  stillFrames: number;
}

/** A material `forEachReflectiveMesh` hands out. */
type ReflectiveMaterial = Parameters<typeof assignReflectionProbe>[1];

/** A candidate with the binding it stands for. */
interface BoundCandidate extends ReflectionProbeBlendCandidate {
  /** The binding. */
  readonly binding: LiteProbeBinding;
  /** Its capture count. */
  readonly generation: number;
  /** Whether it has capture frames left, so a set made of it now would go stale. */
  readonly isCapturing: boolean;
  /** Whether it captures every frame, so any set made of it goes stale at once. */
  readonly isEveryFrame: boolean;
  /** Whether its binding or `blendDistance` changed within {@link BLEND_STILL_FRAMES}. */
  readonly isMoving: boolean;
}

/** A blended set and what it was built from, compared to decide a rebuild. */
interface BlendState {
  readonly lite: LiteProbeSet;
  /** Per volume: binding, generation and blend distance, flattened. */
  readonly key: readonly unknown[];
}

/**
 * Every reflection probe of a renderer.
 *
 * @internal
 */
export interface ReflectionProbeRuntime {
  /**
   * Captures what is due and points each lit PBR material at its probe. Called once per frame from
   * the `PreRender` system.
   *
   * @param world - The world the probes live in.
   * @param probes - Every `ReflectionProbe` in the world.
   * @param isHdr - Whether `rendering.hdr` is on.
   * @param tier - The `rendering.quality` preset, which caps the size and `everyFrame`; `null` for
   * `"custom"`.
   * @param hasEnvironment - Whether the scene has an environment map. Without one every probe is
   * freed and nothing else runs, not even the mesh walk.
   */
  update(
    world: World,
    probes: readonly ReflectionProbe[],
    isHdr: boolean,
    tier: RenderingQualityPreset | null,
    hasEnvironment: boolean,
  ): void;
  /**
   * Drops every GPU probe after the device was lost, before Lite's recovery rebuilds the materials,
   * so no material still names a cube of the lost device. Until {@link handleDeviceRecovered},
   * `update` does nothing; the probes capture again on the first frame after it.
   */
  handleDeviceLost(): void;
  /** Lets `update` run again once Lite rebuilt the scene on the new device. */
  handleDeviceRecovered(): void;
  /** Frees every probe and hands every material back to the scene environment. */
  dispose(): void;
}

/**
 * Creates the runtime once Lite's local-cubemap shader path is loaded.
 *
 * @param engine - The engine.
 * @param scene - The registered render scene.
 * @param warn - Where a probe's warning goes, with the entity's name already in the message.
 * @returns The runtime.
 *
 * @internal
 */
export async function createReflectionProbeRuntime(
  engine: LiteEngine,
  scene: LiteScene,
  warn: (message: string) => void,
): Promise<ReflectionProbeRuntime> {
  await enableReflectionProbes();
  const states = new Map<ReflectionProbe, ProbeState>();
  const assigned = new Map<ReflectiveMaterial, LiteProbeBinding | LiteProbeSet | null>();
  /** The blended set on every lit material, or `null` for the nearest-probe choice. */
  let blend: BlendState | null = null;
  /** The key of a set Lite refused, so it is not tried again every frame. */
  let refusedKey: readonly unknown[] | null = null;
  let hasWarnedRefusal = false;
  const warnedLeaks = new Set<string>();
  const warnLeakOnce = (message: string): void => {
    if (!warnedLeaks.has(message)) {
      warnedLeaks.add(message);
      warn(`Reflection probe blending: ${message}.`);
    }
  };
  /** Sets replaced this frame, freed with the retired cubes. */
  const retiringSets: LiteProbeSet[] = [];
  const seen = new Set<object>();
  const candidates: BoundCandidate[] = [];
  /** The cubes released this frame, freed once the materials that reflected them are rebuilt. */
  const retiring: { lite: LiteReflectionProbe; environment: LiteProbeBinding["environment"] | null }[] = [];
  /**
   * Material rebuilds still in flight, whichever frame started them: a rebuild started a frame ago
   * may still draw with a cube retired now, so a retired cube waits for all of them.
   */
  const rebuilds = new Set<Promise<void>>();
  /**
   * Probes whose capture was freed while they stayed (resized, environment gone, device lost); they
   * capture again whatever their mode.
   */
  const recapture = new WeakSet<ReflectionProbe>();
  let hasWarnedEveryFrame = false;
  /** Between a device loss and Lite's recovery, nothing on the GPU may be touched. */
  let isDeviceLost = false;

  const assign = (material: ReflectiveMaterial, binding: LiteProbeBinding | LiteProbeSet | null): void => {
    const pending = assignReflectionProbe(scene, material, binding);
    if (pending !== undefined) {
      rebuilds.add(pending);
      const forget = (): void => {
        rebuilds.delete(pending);
      };
      pending.then(forget, forget);
    }
  };

  const release = (probe: ReflectionProbe, state: ProbeState): void => {
    // A capture still under way (an `onDemand` refresh whose frames are not done) counts as wanted.
    if (state.lite.environment !== null || state.framesToCapture > 0) {
      recapture.add(probe);
    }
    retiring.push({ lite: state.lite, environment: state.lite.environment });
    states.delete(probe);
  };

  /**
   * Frees the cubes released this frame. A material that reflected one and was not reassigned this
   * frame (its mesh left the scene) goes back to the scene environment first, so it never names a
   * destroyed cube; the cubes then wait for every rebuild still in flight, from any frame.
   */
  const retire = (): void => {
    if (retiring.length > 0) {
      for (const [material, binding] of assigned) {
        if (
          binding !== null &&
          !("set" in binding) &&
          retiring.some((entry) => entry.environment === binding.environment)
        ) {
          assigned.set(material, null);
          assign(material, null);
        }
      }
      const settled = Promise.allSettled(rebuilds);
      for (const entry of retiring) {
        entry.lite.dispose(settled);
      }
      retiring.length = 0;
    }
    if (retiringSets.length > 0) {
      // A material still on a retired set was reassigned this frame or is gone from the scene.
      for (const [material, binding] of assigned) {
        if (binding !== null && "set" in binding && retiringSets.includes(binding)) {
          assigned.set(material, null);
          assign(material, null);
        }
      }
      const settled = Promise.allSettled(rebuilds);
      for (const set of retiringSets) {
        set.dispose(settled);
      }
      retiringSets.length = 0;
    }
  };

  /** Stops blending; the set goes once the materials that used it were rebuilt. */
  const dropBlend = (): void => {
    if (blend !== null) {
      retiringSets.push(blend.lite);
      blend = null;
    }
  };

  /**
   * Builds, keeps or drops the blended set for this frame's candidates.
   *
   * @param layout - The blend layout, or `null` when the probes do not blend.
   */
  const updateBlend = (layout: ReflectionProbeBlendLayout | null): void => {
    if (layout === null) {
      dropBlend();
      refusedKey = null;
      return;
    }
    let isCapturing = false;
    let hasEveryFrame = false;
    let isMoving = false;
    for (const volume of layout.volumes) {
      const candidate = candidates[volume.index];
      isCapturing ||= candidate?.isCapturing === true;
      hasEveryFrame ||= candidate?.isEveryFrame === true;
      isMoving ||= candidate?.isMoving === true;
    }
    if (hasEveryFrame || isMoving) {
      // A probe capturing every frame would leave any set stale at once; one being moved would
      // rebuild it every frame. Both take the nearest-probe choice until that stops.
      dropBlend();
      return;
    }
    if (isCapturing) {
      return;
    }
    const key: unknown[] = [];
    const volumes = layout.volumes.map((volume) => {
      const candidate = candidates[volume.index];
      if (candidate !== undefined) {
        key.push(candidate.binding, candidate.generation, candidate.blendDistance);
      }
      return {
        environment: candidate?.binding.environment ?? null,
        position: volume.position,
        outer: volume.outer,
        inner: volume.inner,
      };
    });
    if (sameKey(blend?.key ?? null, key) || sameKey(refusedKey, key)) {
      return;
    }
    const ready = volumes.filter(
      (volume): volume is typeof volume & { environment: NonNullable<typeof volume.environment> } =>
        volume.environment !== null,
    );
    try {
      const created = createLiteProbeSet(
        engine,
        scene,
        ready,
        layout.minimum,
        layout.maximum,
        layout.cellSize,
        warnLeakOnce,
      );
      dropBlend();
      blend = { lite: created, key };
      refusedKey = null;
    } catch (error) {
      dropBlend();
      refusedKey = key;
      if (!hasWarnedRefusal) {
        hasWarnedRefusal = true;
        warn(
          `The reflection probes cannot blend (${error instanceof Error ? error.message : String(error)}), ` +
            "so each material reflects its nearest probe. Lite blends at most four overlapping probes.",
        );
      }
    }
  };

  /** Hands every material back to the scene environment, without walking the scene. */
  const clearMaterials = (): void => {
    for (const [material, binding] of assigned) {
      if (binding !== null) {
        assign(material, null);
      }
    }
    assigned.clear();
  };

  const assignMaterials = (): void => {
    if (candidates.length === 0) {
      clearMaterials();
      return;
    }
    seen.clear();
    const blended = blend?.lite ?? null;
    forEachReflectiveMesh(scene, (material, x, y, z) => {
      if (seen.has(material)) {
        return;
      }
      seen.add(material);
      // A material whose nearest probe has no box keeps it: such probes are not in the set.
      const chosen = candidates[selectReflectionProbe(x, y, z, candidates)];
      const binding = blended !== null && chosen?.box !== null ? blended : (chosen?.binding ?? null);
      const current = assigned.get(material);
      if (current === binding || (current === undefined && binding === null)) {
        return;
      }
      assigned.set(material, binding);
      assign(material, binding);
    });
  };

  return {
    update(
      world: World,
      probes: readonly ReflectionProbe[],
      isHdr: boolean,
      tier: RenderingQualityPreset | null,
      hasEnvironment: boolean,
    ): void {
      if (isDeviceLost) {
        return;
      }
      candidates.length = 0;
      if (!hasEnvironment) {
        // A probe borrows the environment's lighting tables, so without one it holds no GPU memory
        // and costs no frame work; refresh requests stay on the component until it can capture.
        for (const [probe, state] of states) {
          release(probe, state);
        }
        dropBlend();
        clearMaterials();
        retire();
        return;
      }
      const maxSize = tier?.reflectionProbeMaxSize;
      const allowsEveryFrame = tier?.reflectionProbeEveryFrame ?? true;
      for (const [probe, state] of states) {
        if (!probes.includes(probe) || resolveReflectionProbeSize(probe.size, maxSize) !== state.lite.size) {
          release(probe, state);
        }
      }
      for (const probe of probes) {
        const wantsRefresh = probe.consumeRefreshRequest();
        if (!probe.isEnabledInHierarchy) {
          continue;
        }
        const mode = resolveReflectionProbeRefreshMode(probe.refreshMode, allowsEveryFrame);
        if (mode !== probe.refreshMode && !hasWarnedEveryFrame) {
          hasWarnedEveryFrame = true;
          warn(
            `${JSON.stringify(probe.entity.name)} asks its ReflectionProbe for refreshMode "everyFrame", ` +
              'which only the "high" rendering.quality tier allows, so it captures as "once" (when ready ' +
              "and on refresh()).",
          );
        }
        let state = states.get(probe);
        if (state === undefined) {
          // Nothing is allocated until a capture is due: an `onDemand` probe waits for refresh().
          if (mode === "onDemand" && !wantsRefresh && !recapture.has(probe)) {
            continue;
          }
          recapture.delete(probe);
          state = {
            lite: createLiteReflectionProbe(
              engine,
              scene,
              resolveReflectionProbeSize(probe.size, maxSize),
              EDITOR_ONLY_METADATA_KEY,
              cullingFilter(world, probe),
            ),
            framesToCapture: CAPTURE_FRAMES,
            binding: null,
            generation: 0,
            blendDistance: probe.blendDistance,
            stillFrames: 0,
          };
          states.set(probe, state);
        }
        state.lite.resolve(!isHdr);
        const matrix = probe.entity.transform.worldMatrix;
        const x = matrix[12] ?? 0;
        const y = matrix[13] ?? 0;
        const z = matrix[14] ?? 0;
        if (wantsRefresh) {
          state.framesToCapture = CAPTURE_FRAMES;
        }
        const isCapturing = state.framesToCapture > 0 || mode === "everyFrame";
        if (isCapturing && state.lite.capture(x, y, z, probe.near, probe.far)) {
          state.framesToCapture = Math.max(0, state.framesToCapture - 1);
          state.generation += 1;
        }
        const environment = state.lite.environment;
        if (environment === null) {
          continue;
        }
        const box = probe.boxProjection;
        const binding = bindingFor(state.binding, environment, x, y, z, box);
        state.stillFrames =
          binding === state.binding && probe.blendDistance === state.blendDistance ? state.stillFrames + 1 : 0;
        state.binding = binding;
        state.blendDistance = probe.blendDistance;
        candidates.push({
          x,
          y,
          z,
          box,
          binding,
          blendDistance: probe.blendDistance,
          generation: state.generation,
          isCapturing: state.framesToCapture > 0,
          isEveryFrame: mode === "everyFrame",
          isMoving: state.stillFrames < BLEND_STILL_FRAMES,
        });
      }
      updateBlend(mayBlend(candidates) ? reflectionProbeBlendLayout(candidates) : null);
      assignMaterials();
      retire();
    },
    handleDeviceLost(): void {
      isDeviceLost = true;
      // The set's copies belong to the lost device; Lite would otherwise recopy from dead cubes.
      blend?.lite.dispose();
      blend = null;
      refusedKey = null;
      for (const set of retiringSets) {
        set.dispose();
      }
      retiringSets.length = 0;
      // Lite's recovery rebuilds every material against the new device, so only the bindings are
      // cleared here; the cubes belong to the lost device and go at once.
      for (const [material, binding] of assigned) {
        if (binding !== null) {
          void assignReflectionProbe(null, material, null);
        }
      }
      assigned.clear();
      for (const [probe, state] of states) {
        if (state.lite.environment !== null || state.framesToCapture > 0) {
          recapture.add(probe);
        }
        state.lite.dispose();
      }
      states.clear();
      // The retired cubes belonged to the lost device too.
      for (const entry of retiring) {
        entry.lite.dispose();
      }
      retiring.length = 0;
      rebuilds.clear();
    },
    handleDeviceRecovered(): void {
      isDeviceLost = false;
    },
    dispose(): void {
      for (const [probe, state] of states) {
        release(probe, state);
      }
      dropBlend();
      clearMaterials();
      const settled = Promise.allSettled(rebuilds);
      for (const entry of retiring) {
        entry.lite.dispose(settled);
      }
      retiring.length = 0;
      for (const set of retiringSets) {
        set.dispose(settled);
      }
      retiringSets.length = 0;
      rebuilds.clear();
    },
  };
}

/**
 * Whether a frame's probes can blend at all, checked without allocating: two box probes, one with a
 * `blendDistance`.
 *
 * @param candidates - The frame's candidates.
 * @returns `true` when {@link reflectionProbeBlendLayout} is worth calling.
 */
function mayBlend(candidates: readonly BoundCandidate[]): boolean {
  let boxes = 0;
  let blends = false;
  for (const candidate of candidates) {
    if (candidate.box !== null) {
      boxes += 1;
      blends ||= candidate.blendDistance > 0;
    }
  }
  return boxes >= 2 && blends;
}

/**
 * Whether two set keys are equal, element by element.
 *
 * @param a - A key, or `null`.
 * @param b - Another key.
 * @returns `true` when both have the same elements.
 */
function sameKey(a: readonly unknown[] | null, b: readonly unknown[]): boolean {
  return a !== null && a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Builds the mesh filter of a probe's capture: with a non-empty `cullingMask`, only meshes whose
 * entity is on one of its layers.
 *
 * @param world - The world, for the handle and layer tables.
 * @param probe - The probe; its mask is read on every call, so edits apply to the next capture.
 * @returns The filter.
 */
function cullingFilter(world: World, probe: ReflectionProbe): (tag: NodeTag | null) => boolean {
  return (tag): boolean => {
    const mask = probe.cullingMask;
    if (mask.length === 0) {
      return true;
    }
    const entity = tag === null ? null : world.getEntityByHandle(toEntityHandle(tag.entity));
    if (entity === null) {
      return false;
    }
    for (const name of mask) {
      if (world.layers.indexOf(name) === entity.layer) {
        return true;
      }
    }
    return false;
  };
}

/**
 * The binding a probe's materials use: the previous one while nothing it holds changed, so a still
 * probe never rebuilds its materials.
 *
 * @param previous - The binding last used, or `null`.
 * @param environment - The probe's environment.
 * @param x - The probe's world X.
 * @param y - The probe's world Y.
 * @param z - The probe's world Z.
 * @param box - The projection box size, or `null`.
 * @returns The binding.
 */
function bindingFor(
  previous: LiteProbeBinding | null,
  environment: LiteProbeBinding["environment"],
  x: number,
  y: number,
  z: number,
  box: Vec3Like | null,
): LiteProbeBinding {
  if (
    previous !== null &&
    previous.environment === environment &&
    previous.position[0] === x &&
    previous.position[1] === y &&
    previous.position[2] === z &&
    (box === null
      ? previous.box === null
      : previous.box !== null && previous.box[0] === box.x && previous.box[1] === box.y && previous.box[2] === box.z)
  ) {
    return previous;
  }
  return { environment, position: [x, y, z], box: box === null ? null : [box.x, box.y, box.z] };
}
