import { toEntityHandle } from "../../handles/handle.js";
import {
  assignReflectionProbe,
  createLiteReflectionProbe,
  enableReflectionProbes,
  forEachReflectiveMesh,
} from "../../lite/gpu/reflection-probe.js";
import { resolveReflectionProbeSize, selectReflectionProbe } from "../reflection-probe.js";
import { EDITOR_ONLY_METADATA_KEY } from "../render-texture.js";
import type { LiteProbeBinding, LiteReflectionProbe } from "../../lite/gpu/reflection-probe.js";
import type { NodeTag } from "../../lite/node.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { Vec3Like } from "../../math/types.js";
import type { World } from "../../world/world.js";
import type { ReflectionProbe, ReflectionProbeCandidate } from "../reflection-probe.js";

/**
 * The render layer's half of reflection probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`,
 * step B1): which probe captures when, and which probe each PBR material reflects. Loaded with
 * `../../lite/gpu/reflection-probe.ts` as one chunk, only once a world has a `ReflectionProbe`.
 */

/** One component's GPU probe and what it last captured with. */
interface ProbeState {
  /** The GPU probe. */
  lite: LiteReflectionProbe;
  /** Whether a capture has been requested at least once. */
  hasCaptured: boolean;
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
   */
  update(world: World, probes: readonly ReflectionProbe[], isHdr: boolean): void;
  /** Frees every probe and hands every material back to the scene environment. */
  dispose(): void;
}

/**
 * Creates the runtime once Lite's local-cubemap shader path is loaded.
 *
 * @param engine - The engine.
 * @param scene - The registered render scene.
 * @returns The runtime.
 *
 * @internal
 */
export async function createReflectionProbeRuntime(
  engine: LiteEngine,
  scene: LiteScene,
): Promise<ReflectionProbeRuntime> {
  await enableReflectionProbes();
  const states = new Map<ReflectionProbe, ProbeState>();
  const assigned = new Map<ReflectiveMaterial, LiteProbeBinding | null>();
  const seen = new Set<object>();
  const candidates: BoundCandidate[] = [];

  const release = (probe: ReflectionProbe, state: ProbeState): void => {
    state.lite.dispose();
    states.delete(probe);
  };

  const assignMaterials = (): void => {
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
      assignReflectionProbe(scene, material, binding);
    });
  };

  return {
    update(world: World, probes: readonly ReflectionProbe[], isHdr: boolean): void {
      for (const [probe, state] of states) {
        if (!probes.includes(probe) || resolveReflectionProbeSize(probe.size) !== state.lite.size) {
          release(probe, state);
        }
      }
      candidates.length = 0;
      for (const probe of probes) {
        const wantsRefresh = probe.consumeRefreshRequest();
        if (!probe.isEnabledInHierarchy) {
          continue;
        }
        let state = states.get(probe);
        if (state === undefined) {
          state = {
            lite: createLiteReflectionProbe(
              engine,
              scene,
              resolveReflectionProbeSize(probe.size),
              EDITOR_ONLY_METADATA_KEY,
              cullingFilter(world, probe),
            ),
            hasCaptured: false,
            binding: null,
          };
          states.set(probe, state);
        }
        state.lite.resolve(!isHdr);
        const matrix = probe.entity.transform.worldMatrix;
        const x = matrix[12] ?? 0;
        const y = matrix[13] ?? 0;
        const z = matrix[14] ?? 0;
        const due =
          wantsRefresh || probe.refreshMode === "everyFrame" || (probe.refreshMode === "once" && !state.hasCaptured);
        if (due) {
          state.lite.capture(x, y, z, probe.near, probe.far);
          state.hasCaptured = true;
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
    },
    dispose(): void {
      for (const [probe, state] of states) {
        release(probe, state);
      }
      for (const [material, binding] of assigned) {
        if (binding !== null) {
          assignReflectionProbe(scene, material, null);
        }
      }
      assigned.clear();
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
