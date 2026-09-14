import {
  attachLiteMaterialPlugins,
  createLiteMaterialPlugin,
  detachLiteMaterialPlugins,
  isVertexPluginPoint,
} from "../../lite/gpu/material-plugin.js";
import { markMaterialDirty, rebuildMaterialPipelines } from "../../lite/material.js";
import { uniformComponentCount } from "../material-plugin.js";
import { shaderMaterialsOf } from "../shader-material.js";
import type { App } from "../../app/types.js";
import type {
  LiteMaterialPlugin,
  LitePluginCode,
  LitePluginHost,
  LitePluginState,
} from "../../lite/gpu/material-plugin.js";
import type { LiteTexture2D } from "../../lite/gpu/texture.js";
import type { MaterialAsset } from "../material-asset.js";
import type { LiteMaterialPluginPoint } from "../material-plugin.js";
import type { ShaderTextureDeclaration } from "../shader-declaration.js";
import type { CompiledSurfaceShader, SurfaceHostCapabilities } from "../surface-shader-compiler.js";
import type { SurfaceShaderInit } from "../surface-shader.js";

/**
 * The device-only half of surface shaders: the Lite plugin a compiled `.surface.wgsl` becomes, and
 * the host-material writes that follow it (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2).
 *
 * Each entry point takes the app or the host as a nullable and returns early when it is `null`, so
 * `../surface-shader.ts` keeps no headless branch of its own.
 */

/**
 * The host material a surface shader attaches to, when there is a device.
 *
 * @remarks
 * `assertHostFamily` refused the shader family, so the Lite material is a PBR or Standard one and
 * both carry `plugins` (`index.d.ts` 8175, 12253).
 *
 * @param material - The material asset.
 * @param isHeadless - Whether the app has a device.
 * @returns The Lite material, or `null`.
 *
 * @internal
 */
export function resolveSurfaceHost(material: MaterialAsset, isHeadless: boolean): LitePluginHost | null {
  return isHeadless ? null : material.lite.material;
}

/**
 * Re-uploads the host material's uniform block after a value write.
 *
 * @remarks
 * Lite ignores `dynamic` for a PBR host and re-reads the plugin slice only after this (spike S0.2);
 * a Standard host re-uploads every frame because the plugin sets `dynamic`.
 *
 * @param host - The host material, or `null`.
 * @param isPbr - Whether the host is a PBR material.
 *
 * @internal
 */
export function markSurfaceValueChanged(host: LitePluginHost | null, isPbr: boolean): void {
  if (host === null || !isPbr) {
    return;
  }
  markMaterialDirty(host);
}

/**
 * Rebuilds the host material's renderables, which a bind-group or feature change needs.
 *
 * @param app - The app, or `null` when the attachment was built without one.
 * @param host - The host material, or `null`.
 * @param isLive - Whether Lite has already been handed the plugin list.
 *
 * @internal
 */
export function rebuildSurfaceHost(app: App | null, host: LitePluginHost | null, isLive: boolean): void {
  if (!isLive || app === null || host === null || app.isHeadless) {
    return;
  }
  rebuildMaterialPipelines(app.lite.scene, host);
}

/**
 * Hands Lite the plugins a material's surface shaders compiled to, when there are any.
 *
 * @param host - The host material, or `null`.
 * @param plugins - The plugins, in attach order.
 *
 * @internal
 */
export function attachSurfacePlugins(host: LitePluginHost | null, plugins: readonly LiteMaterialPlugin[]): void {
  if (host === null || plugins.length === 0) {
    return;
  }
  attachLiteMaterialPlugins(host, plugins);
}

/**
 * Takes a material's surface-shader plugins off its Lite material.
 *
 * @remarks
 * A `"shader"` material never hosts one, and its Lite object carries no `plugins` field to clear.
 *
 * @param material - The material asset.
 *
 * @internal
 */
export function detachSurfacePlugins(material: MaterialAsset): void {
  if (material.definition.kind === "shader") {
    return;
  }
  detachLiteMaterialPlugins(material.lite.material);
}

/**
 * The 1x1 fallback each declared sampler falls back to, or nulls under a headless app.
 *
 * @param app - The app, or `null`.
 * @param declarations - The file's declared samplers, in declaration order.
 * @returns One entry per declaration.
 *
 * @internal
 */
export function resolveSurfaceFallbacks(
  app: App | null,
  declarations: readonly ShaderTextureDeclaration[],
): (LiteTexture2D | null)[] {
  if (app === null || app.isHeadless) {
    return declarations.map((): null => null);
  }
  const registry = shaderMaterialsOf(app);
  return declarations.map((declaration) => registry.fallbackTexture(declaration));
}

/**
 * Builds the Lite plugin for one compiled surface shader, when there is a device.
 *
 * @param app - The app, or `null`.
 * @param compiled - The compiled shader.
 * @param init - What the material declared, for the priority.
 * @param capabilities - The host family, which decides how a value reaches the GPU.
 * @param state - The live state the plugin reads.
 * @returns The plugin, or `null` under a headless app.
 *
 * @internal
 */
export function buildSurfacePlugin(
  app: App | null,
  compiled: CompiledSurfaceShader,
  init: SurfaceShaderInit,
  capabilities: SurfaceHostCapabilities,
  state: LitePluginState,
): LiteMaterialPlugin | null {
  if (app === null || app.isHeadless) {
    return null;
  }
  return buildLitePlugin(compiled, init, capabilities, state);
}

/**
 * Builds the Lite plugin for one compiled surface shader.
 *
 * @param compiled - The compiled shader.
 * @param init - What the material declared, for the priority.
 * @param capabilities - The host family, which decides how a value reaches the GPU.
 * @param state - The live state the plugin reads.
 * @returns The plugin.
 */
function buildLitePlugin(
  compiled: CompiledSurfaceShader,
  init: SurfaceShaderInit,
  capabilities: SurfaceHostCapabilities,
  state: LitePluginState,
): LiteMaterialPlugin {
  const fragment: Record<string, string> = {};
  const vertex: Record<string, string> = {};
  for (const point of Object.keys(compiled.plugin.code)) {
    // The keys came from the compiler, which only ever writes Lite's own point names.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const wgsl = compiled.plugin.code[point as LiteMaterialPluginPoint];
    if (wgsl === undefined) {
      continue;
    }
    if (isVertexPluginPoint(point)) {
      vertex[point] = wgsl;
    } else {
      fragment[point] = wgsl;
    }
  }
  // The two records are keyed by Lite's own point names, which the compiler produced, so the shape
  // is the `Partial<Record<MaterialPluginPoint, string>>` the adapter declares.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const code = { fragment, vertex } as LitePluginCode;
  return createLiteMaterialPlugin(
    {
      name: compiled.plugin.name,
      priority: init.priority ?? compiled.plugin.priority,
      fields: compiled.plugin.uniforms.map((uniform) => ({
        name: uniform.name,
        type: uniform.type,
        components: uniformComponentCount(uniform.type),
      })),
      samplers: compiled.plugin.textures.map((texture) => ({
        texture: texture.name,
        sampler: `${texture.name}Sampler`,
        array: texture.array,
      })),
      code,
      isStandardHost: capabilities.family === "standard",
    },
    state,
  );
}
