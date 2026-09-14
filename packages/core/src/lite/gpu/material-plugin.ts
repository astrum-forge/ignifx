import type {
  MaterialPlugin,
  MaterialPluginPoint,
  PbrMaterialProps,
  PluginSamplerDecl,
  PluginTextureBinding,
  PluginUboField,
  StandardMaterialProps,
  Texture2D,
} from "@babylonjs/lite";

/**
 * The Babylon Lite half of surface shaders and raw material plugins
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2). Everything here is `@internal`.
 *
 * A `MaterialPlugin` is plain data with function members, so nothing here needs a device, but the
 * `materialPlugins` rendering feature must have installed the bridges before the scene was
 * registered (`../render-features.ts`). Three facts it is written around:
 *
 * - `getCustomCode`, `getUniforms` and `getSamplers` results are stringified into the pipeline cache
 *   key (`lib/material/plugin/plugin-bridge-shared.js` 21-34), so they must be **stable**; this
 *   module precomputes everything at attach time.
 * - `writeUbo(data, offsets)` gets **byte** offsets (`lib/material/pbr/pbr-renderable.js` 420,
 *   confirmed on a device in spike S0.2) — divide by four for a `Float32Array` index.
 * - PBR fields join the material's own uniform block and need `markMaterialUboDirty`; Standard
 *   fields become a self-managed `pluginUbo` that is re-uploaded only when `dynamic` is set, so
 *   {@link createLiteMaterialPlugin} sets it for a Standard host alone.
 */

/**
 * A Babylon Lite material plugin, re-exported under an ignifx name so feature code can name the
 * type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @internal
 */
export type LiteMaterialPlugin = MaterialPlugin;

/**
 * A Babylon Lite material that can carry plugins: PBR or Standard.
 *
 * @internal
 */
export type LitePluginHost = PbrMaterialProps | StandardMaterialProps;

/**
 * One uniform field a plugin appends to its host's uniform block.
 *
 * @internal
 */
export interface LitePluginField {
  /** The WGSL field name, already prefixed so it cannot collide with the host's own. */
  readonly name: string;
  /** The WGSL type, used verbatim inside the host's struct. */
  readonly type: string;
  /** How many components the CPU-side value holds: 1, 2, 3, 4, or 16. */
  readonly components: number;
}

/**
 * One texture/sampler pair a plugin adds to its host's bind group.
 *
 * @internal
 */
export interface LitePluginSampler {
  /** The WGSL texture variable name, already prefixed. */
  readonly texture: string;
  /** The WGSL sampler variable name, already prefixed. */
  readonly sampler: string;
  /** Whether the binding is a `texture_2d_array<f32>` rather than a `texture_2d<f32>`. */
  readonly array: boolean;
}

/**
 * What a plugin injects, split by shader stage the way Lite asks for it.
 *
 * @internal
 */
export interface LitePluginCode {
  /** Fragment-stage injection points, by Lite point name. */
  readonly fragment: Partial<Record<MaterialPluginPoint, string>>;
  /** Vertex-stage injection points, by Lite point name. */
  readonly vertex: Partial<Record<MaterialPluginPoint, string>>;
}

/**
 * The live state a plugin reads at upload time. The render layer owns it and mutates it in place, so
 * a value or texture write costs no rebuild of the plugin object.
 *
 * @internal
 */
export interface LitePluginState {
  /** Whether the plugin contributes code at all. Toggling it changes Lite's pipeline cache key. */
  enabled: boolean;
  /** Field name to its current CPU-side floats, in component order. */
  readonly values: ReadonlyMap<string, Float32Array>;
  /** The texture for each declared sampler, in declaration order; `null` entries are skipped. */
  readonly textures: readonly (Texture2D | null)[];
}

/**
 * Everything that is fixed for the life of one attached plugin.
 *
 * @internal
 */
export interface LiteMaterialPluginInput {
  /** The plugin's identity; part of Lite's pipeline cache key. */
  readonly name: string;
  /** Lower runs first. */
  readonly priority: number;
  /** The uniform fields, already prefixed. */
  readonly fields: readonly LitePluginField[];
  /** The samplers, already prefixed. */
  readonly samplers: readonly LitePluginSampler[];
  /** The WGSL to inject. */
  readonly code: LitePluginCode;
  /** Whether the host is a Standard material, which needs `dynamic` to re-upload at all. */
  readonly isStandardHost: boolean;
}

/** The Lite point names that belong to the vertex stage. */
const VERTEX_POINTS: readonly string[] = Object.freeze([
  "CUSTOM_VERTEX_MAIN_BEGIN",
  "CUSTOM_VERTEX_UPDATE_WORLDPOS",
  "CUSTOM_VERTEX_MAIN_END",
]);

/**
 * Whether a Lite injection point belongs to the vertex stage.
 *
 * @param point - The point name.
 * @returns `true` for the three vertex points.
 *
 * @internal
 */
export function isVertexPluginPoint(point: string): boolean {
  return VERTEX_POINTS.includes(point);
}

/**
 * Builds the Babylon Lite plugin object for one attached surface shader or raw plugin.
 *
 * @remarks
 * The returned object closes over `state`, so the render layer changes a value by writing into
 * `state.values` and then marking the host dirty; the plugin object itself never changes, which is
 * what keeps Lite's pipeline cache key stable.
 *
 * `getCustomCode` returns `null` for a stage with no code and for every stage while the plugin is
 * disabled. Lite already treats a disabled plugin as contributing nothing (`isEnabled`), and the
 * `null` keeps the signature short.
 *
 * @param input - What is fixed about the plugin.
 * @param state - The live values, textures, and enabled flag.
 * @returns The Lite plugin, ready for {@link attachLiteMaterialPlugins}.
 *
 * @internal
 */
export function createLiteMaterialPlugin(input: LiteMaterialPluginInput, state: LitePluginState): MaterialPlugin {
  const ubo: PluginUboField[] = input.fields.map((field) => ({ name: field.name, type: field.type }));
  const samplers: PluginSamplerDecl[] = input.samplers.map((sampler) =>
    sampler.array
      ? // The declared type is wider than Lite's TypeScript literal, and the bind-group layout
        // derives `viewDimension` from the string, so the cast is the documented route (spike S0.2).
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        ({
          texture: sampler.texture,
          sampler: sampler.sampler,
          textureType: "texture_2d_array<f32>",
        } as unknown as PluginSamplerDecl)
      : { texture: sampler.texture, sampler: sampler.sampler },
  );
  const uniforms = { ubo };
  let integerView: Int32Array | null = null;
  let integerBuffer: ArrayBufferLike | null = null;
  const plugin: MaterialPlugin = {
    name: input.name,
    priority: input.priority,
    get isEnabled(): boolean {
      return state.enabled;
    },
    dynamic: input.isStandardHost,
    getCustomCode(stage: "vertex" | "fragment"): Partial<Record<MaterialPluginPoint, string>> | null {
      const code = stage === "vertex" ? input.code.vertex : input.code.fragment;
      return Object.keys(code).length === 0 ? null : code;
    },
    getUniforms(): { ubo?: PluginUboField[] } {
      return uniforms;
    },
    getSamplers(): PluginSamplerDecl[] {
      return samplers;
    },
    writeUbo(data: Float32Array, offsets: ReadonlyMap<string, number>): void {
      for (const field of input.fields) {
        const byteOffset = offsets.get(field.name);
        const values = state.values.get(field.name);
        if (byteOffset === undefined || values === undefined) {
          continue;
        }
        const index = byteOffset / 4;
        if (field.type === "u32" || field.type === "i32") {
          if (integerBuffer !== data.buffer) {
            integerBuffer = data.buffer;
            integerView = new Int32Array(data.buffer, data.byteOffset, data.length);
          }
          const view = integerView;
          if (view !== null) {
            view[index] = values[0] ?? 0;
          }
          continue;
        }
        for (let component = 0; component < field.components; component += 1) {
          data[index + component] = values[component] ?? 0;
        }
      }
    },
    bindTextures(out: PluginTextureBinding[]): void {
      for (const texture of state.textures) {
        if (texture !== null) {
          out.push({ texture });
        }
      }
    },
    getActiveTextures(out: Texture2D[]): void {
      for (const texture of state.textures) {
        if (texture !== null) {
          out.push(texture);
        }
      }
    },
  };
  return plugin;
}

/**
 * Replaces a material's plugin list.
 *
 * @remarks
 * `material.plugins = [plugin]` is the documented attach path (`index.d.ts` 8175, 12253). The list
 * is read when the pipeline is built, so a change to it needs a rebuild of the material's
 * renderables — `rebuildMaterialPipelines` in `src/lite/material.ts` — before it shows up.
 *
 * @param material - The PBR or Standard host.
 * @param plugins - The plugins, in any order; Lite sorts them by `priority`.
 *
 * @internal
 */
export function attachLiteMaterialPlugins(material: LitePluginHost, plugins: readonly MaterialPlugin[]): void {
  material.plugins = [...plugins];
}

/**
 * Clears a material's plugin list.
 *
 * @param material - The PBR or Standard host.
 *
 * @internal
 */
export function detachLiteMaterialPlugins(material: LitePluginHost): void {
  material.plugins = [];
}

/**
 * The plugins currently attached to a material.
 *
 * @param material - The PBR or Standard host.
 * @returns The list, or an empty array when it carries none.
 *
 * @internal
 */
export function liteMaterialPlugins(material: LitePluginHost): readonly MaterialPlugin[] {
  return material.plugins ?? [];
}
