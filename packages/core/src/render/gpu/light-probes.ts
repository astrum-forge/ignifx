import { readSceneEnvironment } from "../../lite/gpu/environment.js";
import {
  createLightProbePlugin,
  createLightProbeTexture,
  enableLightProbePlugins,
  swapLightProbePlugin,
} from "../../lite/gpu/light-probes.js";
import { packLightProbeTexels } from "../light-probe-asset.js";
import type { LiteMaterialPlugin } from "../../lite/gpu/material-plugin.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { LightProbeAsset } from "../light-probe-asset.js";
import type { LightProbeVolume } from "../light-probe-volume.js";

/**
 * The render layer's half of light probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step
 * B2): which volume lights the scene, and keeping its plugin on every lit PBR material. Loaded with
 * `../../lite/gpu/light-probes.ts` as one chunk, only once a world has a `LightProbeVolume`.
 */

/** Frames a replaced texture outlives its plugin, so no in-flight bind group still names it. */
const RETIRE_FRAMES = 8;

/** What is applied: which grid, at which intensity, through which plugin. */
interface Applied {
  readonly asset: LightProbeAsset;
  readonly intensity: number;
  readonly plugin: LiteMaterialPlugin;
  readonly destroy: () => void;
}

/**
 * The light probes of a renderer.
 *
 * @internal
 */
export interface LightProbeRuntime {
  /** Whether a grid is applied. */
  readonly isLighting: boolean;
  /**
   * Picks the volume that lights the scene and keeps its plugin on every lit PBR material.
   *
   * @param volumes - Every `LightProbeVolume` in the world.
   */
  update(volumes: readonly LightProbeVolume[]): void;
  /** Takes the plugin off every material and frees the texture. */
  dispose(): void;
}

/**
 * Creates the runtime.
 *
 * @param engine - The engine.
 * @param scene - The registered render scene.
 * @returns The runtime.
 *
 * @internal
 */
export function createLightProbeRuntime(engine: LiteEngine, scene: LiteScene): LightProbeRuntime {
  enableLightProbePlugins(scene);
  let applied: Applied | null = null;
  const retiring: { destroy: () => void; frames: number }[] = [];

  const apply = (asset: LightProbeAsset, intensity: number): Applied | null => {
    const { data } = asset;
    const packed = packLightProbeTexels(data);
    const texture = createLightProbeTexture(engine, packed.width, packed.height, packed.texels);
    if (texture === null) {
      return null;
    }
    const plugin = createLightProbePlugin(
      {
        origin: [data.origin.x, data.origin.y, data.origin.z],
        cellSize: [data.cellSize.x, data.cellSize.y, data.cellSize.z],
        counts: [data.counts.x, data.counts.y, data.counts.z],
        intensity,
      },
      texture,
    );
    return { asset, intensity, plugin, destroy: () => texture.texture.destroy() };
  };

  const replace = (next: Applied | null): void => {
    swapLightProbePlugin(scene, applied?.plugin ?? null, next?.plugin ?? null);
    if (applied !== null) {
      retiring.push({ destroy: applied.destroy, frames: RETIRE_FRAMES });
    }
    applied = next;
  };

  return {
    get isLighting(): boolean {
      return applied !== null;
    },
    update(volumes: readonly LightProbeVolume[]): void {
      for (let index = retiring.length - 1; index >= 0; index -= 1) {
        const entry = retiring[index];
        if (entry !== undefined && --entry.frames <= 0) {
          entry.destroy();
          retiring.splice(index, 1);
        }
      }
      let winner: LightProbeVolume | null = null;
      let asset: LightProbeAsset | null = null;
      // The plugin recomputes the environment's harmonics, so it needs one installed.
      if (readSceneEnvironment(scene) !== null) {
        for (const volume of volumes) {
          const loaded = volume.isEnabledInHierarchy ? volume.loadedProbes() : null;
          if (loaded !== null) {
            winner = volume;
            asset = loaded;
          }
        }
      }
      if (winner === null || asset === null) {
        if (applied !== null) {
          replace(null);
        }
        return;
      }
      if (applied === null || applied.asset !== asset || applied.intensity !== winner.intensity) {
        replace(apply(asset, winner.intensity));
        return;
      }
      // Meshes created since the last frame get the plugin too; nothing is rebuilt otherwise.
      swapLightProbePlugin(scene, null, applied.plugin);
    },
    dispose(): void {
      replace(null);
      for (const entry of retiring) {
        entry.destroy();
      }
      retiring.length = 0;
    },
  };
}
