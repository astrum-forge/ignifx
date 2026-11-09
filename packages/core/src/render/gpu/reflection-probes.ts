import { toEntityHandle } from "../../handles/handle.js";
import {
  assignReflectionProbe,
  createLiteReflectionProbe,
  enableReflectionProbes,
  forEachReflectiveMesh,
} from "../../lite/gpu/reflection-probe.js";
import {
  resolveReflectionProbeRefreshMode,
  resolveReflectionProbeSize,
  selectReflectionProbe,
} from "../reflection-probe.js";
import { EDITOR_ONLY_METADATA_KEY } from "../render-texture.js";
import type { LiteProbeBinding, LiteReflectionProbe } from "../../lite/gpu/reflection-probe.js";
import type { NodeTag } from "../../lite/node.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { Vec3Like } from "../../math/types.js";
import type { World } from "../../world/world.js";
import type { ReflectionProbe, ReflectionProbeCandidate } from "../reflection-probe.js";
import type { RenderingQualityPreset } from "../rendering-settings.js";

/**
 * The render layer's half of reflection probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`,
 * step B1): which probe captures when, and which probe each PBR material reflects. Loaded with
 * `../../lite/gpu/reflection-probe.ts` as one chunk, only once a world has a `ReflectionProbe`.
 */

/**
 * How many consecutive frames one capture request renders. Lite compiles material pipelines
 * asynchronously, so a single frame right after start or after a scene change can miss meshes that
 * are still compiling; repeating it for a few frames catches them.
 */
const CAPTURE_FRAMES = 8;

/** One component's GPU probe and what it last captured with. */
interface ProbeState {
  /** The GPU probe. */
  lite: LiteReflectionProbe;
  /** How many more frames capture before the probe rests. */
  framesToCapture: number;
  /** The binding materials use, rebuilt when the probe moves or its box changes. */
  binding: LiteProbeBinding | null;
}

/** A material `forEachReflectiveMesh` hands out. */
type ReflectiveMaterial = Parameters<typeof assignReflectionProbe>[1];

/** A candidate with the binding it stands for. */
interface BoundCandidate extends ReflectionProbeCandidate {
  /** The binding. */
  readonly binding: LiteProbeBinding;
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
   * so no material still names a cube of the lost device. The probes capture again on the first
   * frame after recovery.
   */
  handleDeviceLost(): void;
  /** Frees every probe and hands every material back to the scene environment. */
  dispose(): void;
}

/**
 * Creates the runtime once Lite's local-cubemap shader path is loaded.
 *
 * @param engine - The engine.
 * @param scene - The registered render scene.
 * @param warn - Where a probe's warning goes: a message with an `{entity}` slot, and the name.
 * @returns The runtime.
 *
 * @internal
 */
export async function createReflectionProbeRuntime(
  engine: LiteEngine,
  scene: LiteScene,
  warn: (message: string, entityName: string) => void,
): Promise<ReflectionProbeRuntime> {
  await enableReflectionProbes();
  const states = new Map<ReflectionProbe, ProbeState>();
  const assigned = new Map<ReflectiveMaterial, LiteProbeBinding | null>();
  const seen = new Set<object>();
  const candidates: BoundCandidate[] = [];
  /** The cubes released this frame, freed once the materials that reflected them are rebuilt. */
  const retiring: { lite: LiteReflectionProbe; environment: LiteProbeBinding["environment"] | null }[] = [];
  /** Material rebuilds started this frame. */
  const rebuilds: Promise<void>[] = [];
  /**
   * Probes whose capture was freed while they stayed (resized, environment gone, device lost); they
   * capture again whatever their mode.
   */
  const recapture = new WeakSet<ReflectionProbe>();
  let hasWarnedEveryFrame = false;

  const assign = (material: ReflectiveMaterial, binding: LiteProbeBinding | null): void => {
    const pending = assignReflectionProbe(scene, material, binding);
    if (pending !== undefined) {
      rebuilds.push(pending);
    }
  };

  const release = (probe: ReflectionProbe, state: ProbeState): void => {
    if (state.lite.environment !== null) {
      recapture.add(probe);
    }
    retiring.push({ lite: state.lite, environment: state.lite.environment });
    states.delete(probe);
  };

  /**
   * Frees the cubes released this frame. A material that reflected one and was not reassigned this
   * frame (its mesh left the scene) goes back to the scene environment first, so it never names a
   * destroyed cube; the cubes then wait for every rebuild started this frame.
   */
  const retire = (): void => {
    if (retiring.length > 0) {
      for (const [material, binding] of assigned) {
        if (binding !== null && retiring.some((entry) => entry.environment === binding.environment)) {
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
    rebuilds.length = 0;
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
    forEachReflectiveMesh(scene, (material, x, y, z) => {
      if (seen.has(material)) {
        return;
      }
      seen.add(material);
      const index = selectReflectionProbe(x, y, z, candidates);
      const binding = candidates[index]?.binding ?? null;
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
      candidates.length = 0;
      if (!hasEnvironment) {
        // A probe borrows the environment's lighting tables, so without one it holds no GPU memory
        // and costs no frame work; refresh requests stay on the component until it can capture.
        for (const [probe, state] of states) {
          release(probe, state);
        }
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
            '{entity} asks its ReflectionProbe for refreshMode "everyFrame", which only the "high" ' +
              'rendering.quality tier allows, so it captures as "once" (when ready and on refresh()).',
            probe.entity.name,
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
        if (
          (state.framesToCapture > 0 || mode === "everyFrame") &&
          state.lite.capture(x, y, z, probe.near, probe.far)
        ) {
          state.framesToCapture = Math.max(0, state.framesToCapture - 1);
        }
        const environment = state.lite.environment;
        if (environment === null) {
          continue;
        }
        const box = probe.boxProjection;
        const binding = bindingFor(state.binding, environment, x, y, z, box);
        state.binding = binding;
        candidates.push({ x, y, z, box, binding });
      }
      assignMaterials();
      retire();
    },
    handleDeviceLost(): void {
      // Lite's recovery rebuilds every material against the new device, so only the bindings are
      // cleared here; the cubes belong to the lost device and go at once.
      for (const [material, binding] of assigned) {
        if (binding !== null) {
          void assignReflectionProbe(null, material, null);
        }
      }
      assigned.clear();
      for (const [probe, state] of states) {
        if (state.lite.environment !== null) {
          recapture.add(probe);
        }
        state.lite.dispose();
      }
      states.clear();
      retiring.length = 0;
      rebuilds.length = 0;
    },
    dispose(): void {
      for (const [probe, state] of states) {
        release(probe, state);
      }
      clearMaterials();
      const settled = Promise.allSettled(rebuilds);
      for (const entry of retiring) {
        entry.lite.dispose(settled);
      }
      retiring.length = 0;
      rebuilds.length = 0;
    },
  };
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
