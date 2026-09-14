import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Color } from "../math/color.js";
import {
  attachSurfacePlugins,
  buildSurfacePlugin,
  detachSurfacePlugins,
  markSurfaceValueChanged,
  rebuildSurfaceHost,
  resolveSurfaceFallbacks,
  resolveSurfaceHost,
} from "./gpu/surface-shader-host.js";
import { MATERIAL_PLUGIN_SAMPLER_BUDGET, uniformComponentCount } from "./material-plugin.js";
import { compileSurfaceShader, sanitizeIdentifier } from "./surface-shader-compiler.js";
import type { MaterialAsset } from "./material-asset.js";
import type { ShaderAsset } from "./shader-asset.js";
import type { ShaderUniformDeclaration } from "./shader-declaration.js";
import type { SurfaceHostCapabilities } from "./surface-shader-compiler.js";
import type { TextureAsset } from "./texture-asset.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { LiteMaterialPlugin, LitePluginHost, LitePluginState } from "../lite/gpu/material-plugin.js";
import type { LiteTexture2D } from "../lite/gpu/texture.js";
import type { ColorLike } from "../math/types.js";

/**
 * Surface shaders: lit, shadowed, IBL-lit custom looks on a **PBR** material
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2, ADR-0024).
 *
 * Three named hooks into the engine's own PBR shader, compiled into one Babylon Lite material
 * plugin, so a custom look keeps direct lighting, shadows, IBL, fog and tone mapping.
 * `./surface-shader-compiler.ts` documents the generated WGSL.
 *
 * ```ts
 * const snow = await app.assets.loadAsync<ShaderAsset>("shaders/snow.surface.wgsl");
 * const rock = createMaterialAsset(
 *   app,
 *   pbrMaterialDefinition({
 *     name: "rock",
 *     roughness: 0.9,
 *     surfaces: [{ shader: snow.address, name: "snow", values: {}, textures: {}, enabled: true, priority: 500 }],
 *   }),
 *   [],
 * );
 * rock.value.surface("snow").set("amount", 0.8);
 * ```
 *
 * Four constraints:
 *
 * - A **Standard** host is refused: Lite 1.27.0 bakes a Standard material's plugin signature from
 *   the meshes already in the scene, which in ignifx is never in time.
 * - `rendering.features.materialPlugins` has to be declared before the scene is registered
 *   (`IGX-0716` on a device, one warning headless).
 * - A material's surface shaders share one sampler budget of
 *   {@link MATERIAL_PLUGIN_SAMPLER_BUDGET}, measured on a device beside a fully textured PBR
 *   material with IBL and a shadow light.
 * - Attaching, detaching, toggling `enabled` and binding a texture each change Lite's pipeline cache
 *   key and rebuild the material's renderables; writing a value only re-uploads the uniform block.
 */

/**
 * What a material declares for one attached surface shader.
 *
 * @public
 */
export interface SurfaceShaderInit {
  /** The loaded `.surface.wgsl`. */
  readonly shader: AssetHandle<ShaderAsset>;
  /**
   * The name the shader answers to on this material. Defaults to the address's basename with
   * `.surface.wgsl` removed, so `shaders/snow.surface.wgsl` is `snow`.
   */
  readonly name?: string;
  /** Overrides of the file's declared uniform defaults, by declared name. */
  readonly values?: Readonly<Record<string, number | readonly number[] | ColorLike>>;
  /** Textures for the file's declared samplers, by declared name. */
  readonly textures?: Readonly<Record<string, AssetHandle<TextureAsset>>>;
  /** Whether the shader contributes anything. Defaults to `true`. */
  readonly enabled?: boolean;
  /** Lower runs first among the material's surface shaders. Defaults to `500`, Babylon Lite's own. */
  readonly priority?: number;
}

/**
 * What a `.material.json` writes for one surface shader: the shader's address and its values.
 *
 * @remarks
 * The runtime shape is {@link SurfaceShaderInit}, which carries handles; this is the serialized one,
 * which carries addresses, and is what a PBR or Standard material definition holds.
 *
 * @public
 */
export interface SurfaceShaderReference {
  /** The address of the `.surface.wgsl`. */
  readonly shader: string;
  /** The name the shader answers to; empty takes the address's basename. */
  readonly name: string;
  /** Overrides of the file's declared uniform defaults. */
  readonly values: Readonly<Record<string, number | readonly number[]>>;
  /** Texture addresses by declared sampler name. */
  readonly textures: Readonly<Record<string, string>>;
  /** Whether the shader contributes anything. */
  readonly enabled: boolean;
  /** Lower runs first. */
  readonly priority: number;
}

/** Babylon Lite's own default plugin priority; the surface shaders of one material sort by it. */
const DEFAULT_PRIORITY = 500;

/**
 * What a binding tells its attachment when something changes.
 *
 * @internal
 */
export interface SurfaceShaderOwner {
  /** A uniform was written: re-upload the host material's uniform block. */
  onValueChanged(): void;
  /**
   * The pipeline cache key moved — a texture was bound, or `enabled` was toggled — so the host
   * material's renderables have to be rebuilt.
   */
  onShapeChanged(): void;
}

/**
 * The live state one attached surface shader's Lite plugin reads, with the fields the binding
 * writes.
 *
 * @internal
 */
export interface MutablePluginState extends LitePluginState {
  /** Whether the plugin contributes code. */
  enabled: boolean;
  /** The texture bound to each declared sampler, in declaration order. */
  readonly textures: (LiteTexture2D | null)[];
  /** The Lite plugin object, or `null` under a headless app, which builds none. */
  plugin: LiteMaterialPlugin | null;
}

/**
 * What a {@link SurfaceShaderBinding} is built from.
 *
 * @internal
 */
export interface SurfaceShaderBindingInput {
  /** The name the shader answers to. */
  readonly name: string;
  /** The shader asset. */
  readonly shader: ShaderAsset;
  /** The sort priority. */
  readonly priority: number;
  /** The host material's name, for diagnostics. */
  readonly material: string;
  /** The generated identifier prefix, including the trailing underscore. */
  readonly prefix: string;
  /** The declared uniforms, by the name the file wrote. */
  readonly uniforms: ReadonlyMap<string, ShaderUniformDeclaration>;
  /** The CPU-side values, by prefixed field name; the same map the Lite plugin reads. */
  readonly values: ReadonlyMap<string, Float32Array>;
  /** Declared sampler name to its index in the texture lists. */
  readonly textureIndex: ReadonlyMap<string, number>;
  /** The 1x1 texture each declared sampler falls back to, in declaration order. */
  readonly fallbacks: readonly (LiteTexture2D | null)[];
  /** The live state the Lite plugin reads. */
  readonly state: MutablePluginState;
  /** The attachment, which reacts to a change. */
  readonly owner: SurfaceShaderOwner;
}

/**
 * One surface shader attached to one material: the handle a game holds to change its values.
 *
 * @remarks
 * A material's bindings live as long as its attachment; reach them with `material.surfaces` and
 * `material.surface(name)`.
 *
 * @public
 */
export class SurfaceShaderBinding {
  /** The name the shader answers to on this material. */
  readonly name: string;

  /** The `.surface.wgsl` this binding was compiled from. */
  readonly shader: ShaderAsset;

  /** Lower runs first among the material's surface shaders. */
  readonly priority: number;

  readonly #material: string;

  readonly #prefix: string;

  readonly #uniforms: ReadonlyMap<string, ShaderUniformDeclaration>;

  readonly #values: ReadonlyMap<string, Float32Array>;

  readonly #textureIndex: ReadonlyMap<string, number>;

  readonly #fallbacks: readonly (LiteTexture2D | null)[];

  readonly #handles: (AssetHandle<TextureAsset> | null)[];

  readonly #state: MutablePluginState;

  readonly #owner: SurfaceShaderOwner;

  /**
   * Wraps one compiled, attached surface shader. `attachSurfaceShaders` constructs these.
   *
   * @param input - Everything the binding needs; assembled by `attachSurfaceShaders`.
   *
   * @internal
   */
  constructor(input: SurfaceShaderBindingInput) {
    this.name = input.name;
    this.shader = input.shader;
    this.priority = input.priority;
    this.#material = input.material;
    this.#prefix = input.prefix;
    this.#uniforms = input.uniforms;
    this.#values = input.values;
    this.#textureIndex = input.textureIndex;
    this.#fallbacks = input.fallbacks;
    this.#handles = input.fallbacks.map(() => null);
    this.#state = input.state;
    this.#owner = input.owner;
  }

  /**
   * Whether the shader contributes anything.
   *
   * @returns `true` while it does.
   */
  get enabled(): boolean {
    return this.#state.enabled;
  }

  /**
   * Switches the shader off, which restores the host material's plain look.
   *
   * @remarks
   * A disabled plugin contributes no WGSL but still changes Lite's pipeline cache key, so each
   * toggle costs a pipeline rebuild — a settings-screen operation, not a per-frame one.
   *
   * @param value - `false` to switch it off.
   */
  set enabled(value: boolean) {
    if (this.#state.enabled === value) {
      return;
    }
    this.#state.enabled = value;
    this.#owner.onShapeChanged();
  }

  /**
   * Writes one of the shader's declared uniforms.
   *
   * @remarks
   * The value is checked against the `// @ignifx uniform` declaration in the file, so a typo fails
   * at the call site rather than as a black surface. A uniform declared `color(…)` takes a
   * {@link ColorLike} in **sRGB** and is uploaded linear, like every other colour in ignifx. The
   * write re-uploads the host material's uniform block and recompiles nothing.
   *
   * @param name - The declared uniform's name, as the file wrote it.
   * @param value - A number, a numeric array of the declared length, or an sRGB colour.
   * @throws IgnifxError with code `IGX-0712` when the file declares no such uniform, or `IGX-0713`
   * when the value's shape does not match the declared type.
   *
   * @example
   * ```ts
   * snow.set("amount", 0.8);
   * snow.set("snowColor", { r: 0.95, g: 0.97, b: 1, a: 1 });
   * ```
   */
  set(name: string, value: number | readonly number[] | Float32Array | ColorLike): void {
    const declaration = this.#uniforms.get(name);
    const store = this.#values.get(`${this.#prefix}${name}`);
    if (declaration === undefined || store === undefined) {
      throw this.#unknownBinding(name, this.#uniforms.keys());
    }
    writeSurfaceValue(store, declaration, value, this.#material, this.name);
    this.#owner.onValueChanged();
  }

  /**
   * Reads a declared uniform's current value, as it stands on the CPU side. A colour reads back
   * **linear**, which is what the shader sees.
   *
   * @param name - The declared uniform's name.
   * @param out - Receives a vector or matrix value; omit it for a fresh array, or read a scalar's
   * number directly.
   * @returns The number for `f32`, `u32`, and `i32`, and the filled array for everything else.
   * @throws IgnifxError with code `IGX-0712` when the file declares no such uniform, or `IGX-0713`
   * when `out` is shorter than the value.
   */
  get(name: string, out?: Float32Array): number | Float32Array {
    const store = this.#values.get(`${this.#prefix}${name}`);
    if (store === undefined) {
      throw this.#unknownBinding(name, this.#uniforms.keys());
    }
    if (out === undefined) {
      return store.length === 1 ? (store[0] ?? 0) : store.slice();
    }
    if (out.length < store.length) {
      throw new IgnifxError(
        CoreErrorCode.shaderValueMismatch,
        `${name} on ${this.#material} expects ${String(store.length)} floats, not ${String(out.length)}.`,
        {
          context: { material: this.#material, name, expected: store.length, actual: out.length },
          hint: "Pass a Float32Array at least as long as the declared type.",
        },
      );
    }
    out.set(store);
    return out;
  }

  /**
   * Binds a texture to one of the shader's declared samplers.
   *
   * @remarks
   * There is no "unbound": a bind group with a missing entry fails WebGPU validation, so `null`
   * restores the declaration's 1x1 fallback — white unless the file said
   * `default black` or `default transparent`. The change rebuilds the material's renderables.
   *
   * @param name - The declared sampler's name.
   * @param texture - The texture, or `null` for the fallback.
   * @throws IgnifxError with code `IGX-0712` when the file declares no such sampler.
   */
  setTexture(name: string, texture: AssetHandle<TextureAsset> | null): void {
    const index = this.#textureIndex.get(name);
    if (index === undefined) {
      throw this.#unknownBinding(name, this.#textureIndex.keys());
    }
    this.#handles[index] = texture;
    const loaded = texture !== null && texture.state === "loaded" ? texture.value.lite.texture : null;
    this.#state.textures[index] = loaded ?? this.#fallbacks[index] ?? null;
    this.#owner.onShapeChanged();
  }

  /**
   * The texture currently bound to a declared sampler.
   *
   * @param name - The declared sampler's name.
   * @returns The handle, or `null` when the declaration's fallback is bound.
   * @throws IgnifxError with code `IGX-0712` when the file declares no such sampler.
   */
  getTexture(name: string): AssetHandle<TextureAsset> | null {
    const index = this.#textureIndex.get(name);
    if (index === undefined) {
      throw this.#unknownBinding(name, this.#textureIndex.keys());
    }
    return this.#handles[index] ?? null;
  }

  /**
   * The Babylon Lite plugin this binding drives. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The plugin, or `null` under a headless app, which builds none.
   */
  get lite(): LiteMaterialPlugin | null {
    return this.#state.plugin;
  }

  /**
   * The `IGX-0712` failure an undeclared name produces.
   *
   * @param name - The name the caller passed.
   * @param declared - The names the file did declare.
   * @returns The error to throw.
   */
  #unknownBinding(name: string, declared: Iterable<string>): IgnifxError {
    return new IgnifxError(
      CoreErrorCode.unknownShaderBinding,
      `${this.#material} declares no uniform, texture, or storage buffer named ${name}.`,
      {
        context: { material: this.#material, surface: this.name, name },
        hint: `${this.shader.address} declares ${describeNames(declared)}.`,
      },
    );
  }
}

/** Everything one material's surface shaders share. */
class SurfaceShaderAttachment implements SurfaceShaderOwner {
  readonly bindings: SurfaceShaderBinding[] = [];

  readonly #app: App | null;

  readonly #host: LitePluginHost | null;

  readonly #isPbr: boolean;

  #isLive = false;

  /**
   * Creates the attachment.
   *
   * @param app - The app, or `null` for a pure unit-test attach.
   * @param host - The Lite PBR or Standard material, or `null` under a headless app.
   * @param isPbr - Whether the host is a PBR material, which needs an explicit UBO dirty mark.
   */
  constructor(app: App | null, host: LitePluginHost | null, isPbr: boolean) {
    this.#app = app;
    this.#host = host;
    this.#isPbr = isPbr;
  }

  /** Records that Lite has been handed the plugin list, so later changes rebuild. */
  goLive(): void {
    this.#isLive = true;
  }

  /** Re-uploads the host material's uniform block. */
  onValueChanged(): void {
    markSurfaceValueChanged(this.#host, this.#isPbr);
  }

  /** Rebuilds the host material's renderables, which is what a bind-group or feature change needs. */
  onShapeChanged(): void {
    rebuildSurfaceHost(this.#app, this.#host, this.#isLive);
  }
}

/** One attachment per material, created on first use so module scope allocates nothing. */
let attachments: WeakMap<MaterialAsset, SurfaceShaderAttachment> | null = null;

/**
 * Compiles a material's surface shaders, attaches them to its Babylon Lite material, and returns the
 * handles a game changes their values through.
 *
 * @remarks
 * Replaces whatever was attached before, so calling it twice is a re-attach rather than an addition,
 * and an empty list detaches. Under a headless app — or with `app` `null`, which is how a unit test
 * attaches — every value and texture is held and validated and no Lite plugin is built.
 *
 * The second parameter is the **app**, not the rendering service: a runtime import of `renderer.ts`
 * from a module that `material-asset.ts` imports would close a dependency cycle, because
 * `renderer.ts` builds the default `MaterialAsset`. Everything the attach path needs —
 * `renderer.features`, `isHeadless`, `lite.scene`, `log` — is on the public app.
 *
 * @param material - The PBR material to decorate.
 * @param app - The app, or `null` to compile and validate without touching Babylon Lite.
 * @param surfaces - The shaders to attach, with their values.
 * @returns One binding per shader, in the order given.
 * @throws IgnifxError with code `IGX-0716` when `rendering.features.materialPlugins` is off on a
 * device, `IGX-0708` on a `"shader"` host, `IGX-0709` when a file is not a `surface` one, `IGX-0712`
 * when a declared value or texture name is unknown or two shaders share a name, `IGX-0713` on a
 * wrongly shaped value, `IGX-0726` when the material's shaders exceed the sampler budget, and
 * `IGX-0723` when a file declares no hook, declares one this host cannot run, or names a Standard
 * material as its host.
 *
 * @public
 */
export function attachSurfaceShaders(
  material: MaterialAsset,
  app: App | null,
  surfaces: readonly SurfaceShaderInit[],
): readonly SurfaceShaderBinding[] {
  detachSurfaceShaders(material);
  if (surfaces.length === 0) {
    return [];
  }
  const capabilities = assertHostFamily(material);
  const isHeadless = app === null || app.isHeadless;
  assertFeature(material, app, isHeadless, surfaces.length);
  assertPbrHost(material, capabilities);
  const host = resolveSurfaceHost(material, isHeadless);
  const attachment = new SurfaceShaderAttachment(app, host, capabilities.family === "pbr");
  const plugins: LiteMaterialPlugin[] = [];
  const names = new Set<string>();
  let samplers = 0;
  for (const init of surfaces) {
    const shader = assertLoadedSurfaceShader(material, init);
    const name = init.name ?? surfaceShaderName(shader.address);
    assertUniqueName(material, name, names);
    samplers += shader.declaration.textures.length;
    if (samplers > MATERIAL_PLUGIN_SAMPLER_BUDGET) {
      throw new IgnifxError(
        CoreErrorCode.surfaceSamplerBudgetExceeded,
        `${material.name} attaches surface shaders declaring ${String(samplers)} samplers; ${String(MATERIAL_PLUGIN_SAMPLER_BUDGET)} fit beside a textured PBR material.`,
        {
          context: { material: material.name, samplers, budget: MATERIAL_PLUGIN_SAMPLER_BUDGET },
          hint: "Pack the maps into fewer textures — an RGBA control map rather than four masks.",
        },
      );
    }
    const binding = buildBinding(material, app, capabilities, init, name, shader, attachment);
    attachment.bindings.push(binding.binding);
    const plugin = binding.state.plugin;
    if (plugin !== null) {
      plugins.push(plugin);
    }
  }
  attachSurfacePlugins(host, plugins);
  attachment.goLive();
  // Lite reads `material.plugins` when it builds the pipeline, so a material that is already
  // drawing needs its renderables rebuilt before the plugin's WGSL reaches the screen. Before
  // `app.start()` nothing has been built and the rebuild is a cheap no-op, so it is unconditional.
  attachment.onShapeChanged();
  (attachments ??= new WeakMap<MaterialAsset, SurfaceShaderAttachment>()).set(material, attachment);
  return attachment.bindings;
}

/**
 * Removes every surface shader from a material, restoring its plain look.
 *
 * @remarks
 * Idempotent, and safe on a material that never had one. It clears Lite's plugin list, which changes
 * the pipeline cache key, so the material's renderables are rebuilt.
 *
 * @param material - The material.
 *
 * @public
 */
export function detachSurfaceShaders(material: MaterialAsset): void {
  const existing = attachments?.get(material);
  if (existing === undefined) {
    return;
  }
  attachments?.delete(material);
  detachSurfacePlugins(material);
  existing.onShapeChanged();
}

/**
 * The surface shaders currently attached to a material, in the order they were attached.
 *
 * @param material - The material.
 * @returns The bindings, or an empty array.
 *
 * @public
 */
export function surfaceShaders(material: MaterialAsset): readonly SurfaceShaderBinding[] {
  return attachments?.get(material)?.bindings ?? [];
}

/**
 * One attached surface shader, by the name it answers to.
 *
 * @param material - The material.
 * @param name - The shader's name — the address's basename unless the material renamed it.
 * @returns The binding.
 * @throws IgnifxError with code `IGX-0712` when the material carries no such surface shader.
 *
 * @example
 * ```ts
 * surfaceShaderBinding(rock.value, "snow").set("amount", 0.4);
 * ```
 *
 * @public
 */
export function surfaceShaderBinding(material: MaterialAsset, name: string): SurfaceShaderBinding {
  for (const binding of surfaceShaders(material)) {
    if (binding.name === name) {
      return binding;
    }
  }
  throw new IgnifxError(
    CoreErrorCode.unknownShaderBinding,
    `${material.name} carries no surface shader named ${name}.`,
    {
      context: { material: material.name, name },
      hint: "The name is the .surface.wgsl basename unless the material's surfaces entry renamed it.",
    },
  );
}

/**
 * The name a surface shader answers to when its material does not rename it: the address's basename
 * with `.surface.wgsl` removed.
 *
 * @param address - The shader's asset address.
 * @returns The name.
 *
 * @example
 * ```ts
 * surfaceShaderName("shaders/terrain/snow.surface.wgsl"); // "snow"
 * ```
 *
 * @public
 */
export function surfaceShaderName(address: string): string {
  const slash = address.lastIndexOf("/");
  const basename = slash < 0 ? address : address.slice(slash + 1);
  if (basename.endsWith(".surface.wgsl")) {
    return basename.slice(0, -".surface.wgsl".length);
  }
  return basename.endsWith(".wgsl") ? basename.slice(0, -".wgsl".length) : basename;
}

/** What {@link buildBinding} produces. */
interface BuiltBinding {
  /** The public handle. */
  readonly binding: SurfaceShaderBinding;
  /** Its live state, which carries the Lite plugin. */
  readonly state: MutablePluginState;
}

/**
 * Compiles one surface shader and builds its binding and Lite plugin.
 *
 * @param material - The host material.
 * @param app - The app, or `null`.
 * @param capabilities - The host family and what its template exposes.
 * @param init - What the material declared for this shader.
 * @param name - The name the shader answers to.
 * @param shader - The loaded shader asset.
 * @param owner - The attachment.
 * @returns The binding and its state.
 * @throws IgnifxError as `attachSurfaceShaders` documents.
 */
function buildBinding(
  material: MaterialAsset,
  app: App | null,
  capabilities: SurfaceHostCapabilities,
  init: SurfaceShaderInit,
  name: string,
  shader: ShaderAsset,
  owner: SurfaceShaderAttachment,
): BuiltBinding {
  const compiled = compileSurfaceShader({
    name,
    address: shader.address,
    source: shader.source,
    declaration: shader.declaration,
    host: capabilities,
  });
  const uniforms = new Map<string, ShaderUniformDeclaration>();
  const values = new Map<string, Float32Array>();
  for (const uniform of shader.declaration.uniforms) {
    uniforms.set(uniform.name, uniform);
    values.set(`${compiled.prefix}${uniform.name}`, defaultValueStore(uniform));
  }
  const textureIndex = new Map<string, number>();
  const declarations = shader.declaration.textures;
  for (let index = 0; index < declarations.length; index += 1) {
    textureIndex.set(declarations[index]?.name ?? "", index);
  }
  const fallbacks = resolveSurfaceFallbacks(app, declarations);
  const state: MutablePluginState = {
    enabled: init.enabled ?? true,
    values,
    textures: [...fallbacks],
    plugin: null,
  };
  state.plugin = buildSurfacePlugin(app, compiled, init, capabilities, state);
  const binding = new SurfaceShaderBinding({
    name,
    shader,
    priority: init.priority ?? DEFAULT_PRIORITY,
    material: material.name,
    prefix: compiled.prefix,
    uniforms,
    values,
    textureIndex,
    fallbacks,
    state,
    owner,
  });
  applyInitialValues(binding, init);
  return { binding, state };
}

/**
 * Writes a material's declared value and texture overrides onto a fresh binding.
 *
 * @param binding - The binding.
 * @param init - What the material declared.
 * @throws IgnifxError with code `IGX-0712` or `IGX-0713`.
 */
function applyInitialValues(binding: SurfaceShaderBinding, init: SurfaceShaderInit): void {
  const values = init.values;
  if (values !== undefined) {
    for (const name of Object.keys(values)) {
      const value = values[name];
      if (value !== undefined) {
        binding.set(name, value);
      }
    }
  }
  const textures = init.textures;
  if (textures !== undefined) {
    for (const name of Object.keys(textures)) {
      binding.setTexture(name, textures[name] ?? null);
    }
  }
}

/**
 * Refuses a surface shader on a material family that cannot host one, and reports what the host's
 * template exposes.
 *
 * @param material - The material.
 * @returns The capabilities.
 * @throws IgnifxError with code `IGX-0708` on a `"shader"` material.
 */
function assertHostFamily(material: MaterialAsset): SurfaceHostCapabilities {
  const definition = material.definition;
  if (definition.kind === "shader") {
    throw new IgnifxError(
      CoreErrorCode.unsupportedMaterialKind,
      `${material.name} is a shader material, which owns its whole pipeline and cannot host a surface shader.`,
      {
        context: { material: material.name, kind: definition.kind },
        hint: "Attach surface shaders to a pbr or standard material, or write the effect into the .wgsl itself.",
      },
    );
  }
  if (definition.kind === "pbr") {
    return { family: "pbr", hasUv: true, hasNormal: !definition.unlit };
  }
  return {
    family: "standard",
    // Standard declares its UV varying only when a texture asks for it (`standard-flags.js`
    // NEEDS_UV); with none, `in.uv` reads (0, 0) rather than failing to compile.
    hasUv: Object.keys(definition.textures).length > 0,
    hasNormal: !definition.unlit,
  };
}

/**
 * Refuses a surface shader when the project did not opt into Lite's plugin bridges, and warns when
 * it is only a headless app that would have been affected.
 *
 * @param material - The material, for diagnostics.
 * @param app - The app, or `null`.
 * @param isHeadless - Whether there is no device to patch.
 * @param count - How many shaders are being attached, for the message.
 * @throws IgnifxError with code `IGX-0716` on a device.
 */
function assertFeature(material: MaterialAsset, app: App | null, isHeadless: boolean, count: number): void {
  if (app === null || app.renderer.features.materialPlugins) {
    return;
  }
  if (!isHeadless) {
    throw new IgnifxError(
      CoreErrorCode.surfaceShaderFeatureOff,
      `${material.name} carries a surface shader, but rendering.features.materialPlugins is off.`,
      {
        context: { material: material.name, surfaces: count },
        hint: "Declare materialPlugins in the rendering.features block of createApp() or ignifx.config.ts.",
      },
    );
  }
  app.log.warn(
    `${CoreErrorCode.surfaceShaderFeatureOff}: {material} carries a surface shader, but ` +
      "rendering.features.materialPlugins is off, so it would be inert on a device.",
    material.name,
  );
}

/**
 * Refuses a surface shader on a **Standard** host, which Babylon Lite 1.27.0 cannot carry one on.
 *
 * @remarks
 * `registerStdPlugins` bakes a per-signature index into every Standard material it finds by walking
 * `scene.meshes` (`lib/material/plugin/std-plugin-bridge.js` 133-155), and ignifx creates a
 * renderer's Lite mesh in the first frame's `PreRender` — after that walk — so a Standard host would
 * silently draw as if it carried nothing. PBR's bridge encodes the signature into the material's
 * feature bits at build time and has no such rule. The compiler can still generate for a Standard
 * host, so the refusal lifts as soon as Lite exposes a way to bake one late.
 *
 * @param material - The material, for diagnostics.
 * @param capabilities - The host family.
 * @throws IgnifxError with code `IGX-0723`.
 */
function assertPbrHost(material: MaterialAsset, capabilities: SurfaceHostCapabilities): void {
  if (capabilities.family === "pbr") {
    return;
  }
  throw new IgnifxError(
    CoreErrorCode.surfaceHookMissing,
    `${material.name} is a standard material, and Babylon Lite bakes a standard material's plugins from the meshes already in the scene, so it cannot carry a surface shader.`,
    {
      context: { material: material.name, kind: "standard" },
      hint: "Use a pbr material as the host; surfaces are a pbr-only feature in this release.",
    },
  );
}

/**
 * The shader asset one entry names, checked for being a loaded `surface` file.
 *
 * @param material - The host material, for diagnostics.
 * @param init - The entry.
 * @returns The shader asset.
 * @throws IgnifxError with code `IGX-0501` when it is not loaded, or `IGX-0709` when it is not a
 * `// @ignifx surface` file.
 */
function assertLoadedSurfaceShader(material: MaterialAsset, init: SurfaceShaderInit): ShaderAsset {
  const handle = init.shader;
  if (handle.state !== "loaded") {
    throw new IgnifxError(CoreErrorCode.assetNotLoaded, `The surface shader ${handle.address} is not loaded.`, {
      context: { asset: handle.address, material: material.name },
      hint: "await app.assets.loadAsync(address) before building a material from it.",
    });
  }
  const shader = handle.value;
  if (shader.declaration.kind !== "surface") {
    throw new IgnifxError(
      CoreErrorCode.invalidAssetFile,
      `${shader.address} declares @ignifx ${shader.declaration.kind}, not @ignifx surface.`,
      {
        context: {
          file: shader.address,
          format: "@ignifx surface",
          material: material.name,
          kind: shader.declaration.kind,
        },
        hint: "A material's surfaces list takes .surface.wgsl files whose pragma is @ignifx surface.",
      },
    );
  }
  return shader;
}

/**
 * Refuses two surface shaders that would answer to the same name — and therefore generate the same
 * WGSL identifiers — on one material.
 *
 * @param material - The host material.
 * @param name - The name this entry resolved to.
 * @param taken - The names already used; the accepted one is added.
 * @throws IgnifxError with code `IGX-0712`.
 */
function assertUniqueName(material: MaterialAsset, name: string, taken: Set<string>): void {
  const sanitized = sanitizeIdentifier(name);
  if (taken.has(sanitized)) {
    throw new IgnifxError(
      CoreErrorCode.unknownShaderBinding,
      `${material.name} attaches two surface shaders that both answer to ${name}.`,
      {
        context: { material: material.name, name },
        hint: "Name one of them in its surfaces entry; the name prefixes every generated WGSL identifier.",
      },
    );
  }
  taken.add(sanitized);
}

/**
 * A uniform's CPU-side store, filled with its declared default and decoded from sRGB when the
 * declaration says it is a colour.
 *
 * @param declaration - The uniform declaration.
 * @returns The store.
 */
function defaultValueStore(declaration: ShaderUniformDeclaration): Float32Array {
  const store = new Float32Array(uniformComponentCount(declaration.type));
  const value = declaration.defaultValue;
  if (typeof value === "number") {
    store[0] = value;
  } else {
    store.set(value.slice(0, store.length));
  }
  if (declaration.color) {
    decodeColourComponents(store);
  }
  return store;
}

/**
 * Writes a caller's value into a uniform's store, checking its shape and decoding a colour.
 *
 * @param store - The store.
 * @param declaration - The uniform declaration.
 * @param value - The caller's value.
 * @param material - The host material's name, for diagnostics.
 * @param surface - The surface shader's name, for diagnostics.
 * @throws IgnifxError with code `IGX-0713` when the shape does not match.
 */
function writeSurfaceValue(
  store: Float32Array,
  declaration: ShaderUniformDeclaration,
  value: number | readonly number[] | Float32Array | ColorLike,
  material: string,
  surface: string,
): void {
  const count = store.length;
  if (typeof value === "number") {
    if (count !== 1) {
      throw valueMismatch(declaration, material, surface, `${String(count)} floats`, "a single number");
    }
    store[0] = value;
    return;
  }
  if (isColorLike(value)) {
    if (count !== 3 && count !== 4) {
      throw valueMismatch(declaration, material, surface, `${String(count)} floats`, "a colour");
    }
    store[0] = Color.srgbToLinear(value.r);
    store[1] = Color.srgbToLinear(value.g);
    store[2] = Color.srgbToLinear(value.b);
    if (count === 4) {
      store[3] = value.a;
    }
    return;
  }
  if (value.length !== count) {
    throw valueMismatch(declaration, material, surface, `${String(count)} floats`, `${String(value.length)} floats`);
  }
  store.set(value instanceof Float32Array ? value : Float32Array.from(value));
  if (declaration.color) {
    decodeColourComponents(store);
  }
}

/**
 * The `IGX-0713` failure a wrongly shaped value produces.
 *
 * @param declaration - The uniform declaration.
 * @param material - The host material's name.
 * @param surface - The surface shader's name.
 * @param expected - What the uniform takes.
 * @param actual - What the caller passed.
 * @returns The error to throw.
 */
function valueMismatch(
  declaration: ShaderUniformDeclaration,
  material: string,
  surface: string,
  expected: string,
  actual: string,
): IgnifxError {
  return new IgnifxError(
    CoreErrorCode.shaderValueMismatch,
    `${declaration.name} on ${material} expects ${declaration.type} (${expected}), not ${actual}.`,
    {
      context: { name: declaration.name, material, surface, expected, actual },
      hint: "A colour uniform takes a ColorLike or its element count; every other uniform takes its element count.",
    },
  );
}

/**
 * Decodes a store's first three components from sRGB to linear, in place.
 *
 * @remarks
 * A `subarray` view and `map` rather than three indexed reads: a `Float32Array` element is typed
 * `number | undefined` under `noUncheckedIndexedAccess`, and `map` hands the callback a `number`.
 * It runs on a value write, never per frame.
 *
 * @param store - The store, at least three floats long.
 */
function decodeColourComponents(store: Float32Array): void {
  const rgb = store.subarray(0, 3);
  rgb.set(rgb.map((component) => Color.srgbToLinear(component)));
}

/**
 * Whether a value is an sRGB colour rather than a numeric array.
 *
 * @param value - The candidate.
 * @returns `true` for an object carrying `r`, `g`, `b`, and `a`.
 */
function isColorLike(value: readonly number[] | Float32Array | ColorLike): value is ColorLike {
  return !Array.isArray(value) && !(value instanceof Float32Array);
}

/**
 * A readable list of declared names, for an error hint.
 *
 * @param names - The names.
 * @returns The list, or a note that there are none.
 */
function describeNames(names: Iterable<string>): string {
  const list = [...names];
  return list.length === 0 ? "no bindings of that kind" : list.join(", ");
}
