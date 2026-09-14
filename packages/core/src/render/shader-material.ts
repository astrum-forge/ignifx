import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Color } from "../math/color.js";
import { IGNIFX_UNIFORM_TYPES, IGNIFX_UNIFORM_NAMES, LITE_SYSTEM_UNIFORM_NAMES } from "./shader-declaration.js";
import type { ShaderAsset } from "./shader-asset.js";
import type {
  IgnifxUniformName,
  ShaderDeclaration,
  ShaderTextureDeclaration,
  ShaderUniformDeclaration,
  ShaderUniformType,
} from "./shader-declaration.js";
import type { ShaderMaterialDefinition } from "./shader-material-definition.js";
import type { StorageBufferAsset } from "./storage-buffer-asset.js";
import type { TextureAsset } from "./texture-asset.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type {
  LiteShaderMaterial,
  ShaderMaterialAdapter,
  ShaderMaterialBuildOptions,
  ShaderSamplerEntry,
  ShaderStorageEntry,
  ShaderUniformEntry,
} from "../lite/gpu/shader-material.js";
import type { LiteTexture2D } from "../lite/gpu/texture.js";
import type { ColorLike } from "../math/types.js";
import type { Disconnect } from "../signal/signal.js";

/**
 * The `"shader"` material family (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1): a
 * `ShaderAsset` plus the values a material sets on it.
 *
 * Nothing here imports Babylon Lite: {@link toShaderMaterialOptions} is the whole mapping onto the
 * shape `createShaderMaterial` takes, as plain data, and the adapter itself arrives through
 * {@link loadShaderMaterialAdapter} so a project that loads no `.wgsl` never fetches that chunk
 * (`./shader-support.ts`).
 *
 * Two Lite rules shape the design:
 *
 * - A declared sampler must have something bound (error 309), so an unbound declared texture gets
 *   the declaration's 1x1 fallback and `setTexture(name, null)` restores it rather than unbinding.
 * - A declared storage buffer must have something bound too (error 310), and `array<T>` has no 1x1
 *   equivalent, so such a material is not drawable until `setStorageBuffer` binds one.
 */

/** The uniform names Babylon Lite and ignifx write themselves, which a material may not set. */
const ENGINE_UNIFORM_NAMES: readonly string[] = Object.freeze([...LITE_SYSTEM_UNIFORM_NAMES, ...IGNIFX_UNIFORM_NAMES]);

/** How many floats the `PreRender` system's frame buffer holds: direction, colour, ambient. */
const FRAME_FLOATS = 9;

/** Where the main light's direction starts inside the frame buffer. */
const DIRECTION_OFFSET = 0;

/** Where the main light's colour starts inside the frame buffer. */
const LIGHT_COLOR_OFFSET = 3;

/** Where the ambient colour starts inside the frame buffer. */
const AMBIENT_OFFSET = 6;

/** How many elements each uniform type holds. */
const ELEMENT_COUNTS: Readonly<Record<ShaderUniformType, number>> = Object.freeze({
  f32: 1,
  u32: 1,
  i32: 1,
  "vec2<f32>": 2,
  "vec3<f32>": 3,
  "vec4<f32>": 4,
  "mat4x4<f32>": 16,
});

/**
 * The premultiplied-alpha blend state, which Babylon Lite's two named modes cannot express.
 *
 * @remarks
 * `blendMode: "alpha"` compiles `srcFactor: "src-alpha"` (`lib/material/shader/shader-pipeline.js`),
 * which multiplies the source colour by its alpha a second time. A premultiplied surface has
 * already done that, so it needs `srcFactor: "one"` — the state that lets additive and over-blended
 * particles share one draw.
 */
const PREMULTIPLIED_BLEND: GPUBlendState = Object.freeze({
  color: Object.freeze({ srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }),
  alpha: Object.freeze({ srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }),
});

/**
 * Maps a shader file's declaration and a material's `define` overrides onto the shape
 * `createShaderMaterial` takes.
 *
 * @remarks
 * Pure data in, pure data out, so every mapping rule is asserted headlessly:
 *
 * - `blend opaque` leaves blending off; `alpha` and `additive` are Lite's two named modes;
 *   `premultiplied` supplies an explicit `GPUBlendState`, because Lite's `"alpha"` mode multiplies
 *   by alpha a second time.
 * - `depthWrite` is passed explicitly, because the declaration already resolved Lite's
 *   "blended defaults to off unless stated" rule.
 * - `depthTest off` becomes `depthCompare: "always"`; `depthTest on` passes `null`, which leaves
 *   Lite's reverse-Z default in place.
 * - `instancing matrices` and `matrices-colors` differ only in `useThinInstanceColors`; which
 *   pipeline layout a mesh draws with is Lite's decision at build time, from whether the mesh has a
 *   thin-instance colour stream.
 * - A colour uniform's declared default is sRGB and is decoded here, which is the one place the
 *   conversion happens for defaults.
 *
 * @param name - The material's name, for GPU debug labels.
 * @param source - The whole `.wgsl` file.
 * @param declaration - What the file's pragmas declared.
 * @param uniforms - The initial value of every custom uniform, keyed by name, already **linear**.
 * @param defines - The resolved `define` values.
 * @returns The options.
 *
 * @internal
 */
export function toShaderMaterialOptions(
  name: string,
  source: string,
  declaration: ShaderDeclaration,
  uniforms: ReadonlyMap<string, Float32Array>,
  defines: Readonly<Record<string, boolean | number>>,
): ShaderMaterialBuildOptions {
  const entries: ShaderUniformEntry[] = [];
  // `for…of` rather than an indexed loop: this runs once per material build, not per frame, and the
  // iterator yields the element type rather than `T | undefined`.
  for (const system of declaration.system) {
    entries.push(system);
  }
  for (const ignifx of declaration.ignifx) {
    const type = IGNIFX_UNIFORM_TYPES[ignifx];
    entries.push({ name: ignifx, type, defaultValue: zeros(ELEMENT_COUNTS[type]) });
  }
  for (const uniform of declaration.uniforms) {
    entries.push({
      name: uniform.name,
      type: uniform.type,
      defaultValue: Array.from(uniforms.get(uniform.name) ?? uniformStore(uniform)),
    });
  }
  const samplers: ShaderSamplerEntry[] = [];
  for (const texture of declaration.textures) {
    samplers.push({ name: texture.name, viewDimension: texture.array ? "2d-array" : "2d" });
  }
  const storageBuffers: ShaderStorageEntry[] = [];
  for (const storage of declaration.storage) {
    storageBuffers.push({ name: storage.name, type: storage.type });
  }
  const pipeline = declaration.pipeline;
  const blended = pipeline.blend !== "opaque";
  return {
    name,
    source,
    attributes: declaration.attributes,
    uniforms: entries,
    samplers,
    storageBuffers,
    defines,
    useThinInstanceColors: pipeline.instancing === "matrices-colors",
    needAlphaBlending: blended,
    blendMode: pipeline.blend === "additive" ? "additive" : "alpha",
    blend: pipeline.blend === "premultiplied" ? PREMULTIPLIED_BLEND : null,
    transmissive: pipeline.transmissive,
    backFaceCulling: pipeline.cull === "back",
    depthWrite: pipeline.depthWrite,
    depthCompare: pipeline.depthTest ? null : "always",
  };
}

/** The dynamically imported Babylon Lite adapter, memoised for the process. */
let adapter: ShaderMaterialAdapter | null = null;

/**
 * Loads the custom-WGSL half of the Babylon Lite adapter, once per process.
 *
 * @remarks
 * The shader **loader** awaits this before it hands back a `ShaderAsset`, which is what makes
 * {@link shaderMaterialAdapter} safe to call from the synchronous material builders. Loading it also
 * turns on Lite's cached uniform serialization plans, which is what makes the per-frame `time`
 * upload rewrite only the slots that changed.
 *
 * @returns A promise that resolves once the adapter is in place.
 *
 * @internal
 */
export async function loadShaderMaterialAdapter(): Promise<void> {
  if (adapter !== null) {
    return;
  }
  const loaded = await import("../lite/gpu/shader-material.js");
  loaded.enableShaderUniformCaching();
  // The assignment is what checks `ShaderMaterialAdapter` against the module it stands for.
  adapter = loaded;
}

/**
 * The adapter, if it has been loaded.
 *
 * @returns The module, or `null` before any `.wgsl` has been loaded.
 *
 * @internal
 */
export function shaderMaterialAdapter(): ShaderMaterialAdapter | null {
  return adapter;
}

/**
 * The adapter, or the failure a material built before the `.wgsl` loader ran produces.
 *
 * @param shader - The shader being built, for the message.
 * @returns The adapter.
 * @throws IgnifxError with code `IGX-0715` when the chunk has not been loaded.
 */
function requireShaderMaterialAdapter(shader: ShaderAsset): ShaderMaterialAdapter {
  const module = shaderMaterialAdapter();
  if (module === null) {
    throw new IgnifxError(
      CoreErrorCode.shaderCompileFailed,
      `${shader.address} cannot be built because the shader adapter has not been loaded.`,
      {
        context: { asset: shader.address, message: "adapter not loaded" },
        hint: "Load the .wgsl through app.assets, which is what loads the adapter.",
      },
    );
  }
  return module;
}

/**
 * The per-app state the shader material family needs: the 1x1 fallback textures declared samplers
 * fall back to, and the list of live materials whose per-frame ignifx uniforms have to be written.
 *
 * @remarks
 * It hangs off the app through a lazily created `WeakMap` rather than a service, so a shader
 * material works whether or not an extension registered anything, and two apps in one process keep
 * separate state (`CONSTITUTION.md` §3.6).
 *
 * @internal
 */
export class ShaderMaterialRegistry {
  readonly #app: App;

  /** Live materials that declare at least one ignifx uniform, in no particular order. */
  readonly #animated: ShaderMaterialState[] = [];

  readonly #fallbacks = new Map<string, LiteTexture2D>();

  /**
   * Creates the registry.
   *
   * @param app - The app it belongs to.
   */
  constructor(app: App) {
    this.#app = app;
  }

  /**
   * The materials the `PreRender` uniform system has to write this frame.
   *
   * @returns The list; the registry's own array, iterated without copying.
   */
  get animated(): readonly ShaderMaterialState[] {
    return this.#animated;
  }

  /**
   * Starts writing a material's ignifx uniforms every frame.
   *
   * @param state - The material.
   */
  add(state: ShaderMaterialState): void {
    if (!this.#animated.includes(state)) {
      this.#animated.push(state);
    }
  }

  /**
   * Stops writing a material's ignifx uniforms.
   *
   * @param state - The material.
   */
  remove(state: ShaderMaterialState): void {
    const index = this.#animated.indexOf(state);
    if (index < 0) {
      return;
    }
    const last = this.#animated.pop();
    if (last !== undefined && index < this.#animated.length) {
      this.#animated[index] = last;
    }
  }

  /**
   * The 1x1 texture a declared-but-unbound sampler is filled with, created on first use and shared
   * for the life of the app.
   *
   * @param declaration - The sampler declaration, for its `default` and `array` flags.
   * @returns The texture, or `null` under a headless app or before the adapter has loaded.
   */
  fallbackTexture(declaration: ShaderTextureDeclaration): LiteTexture2D | null {
    const module = shaderMaterialAdapter();
    if (module === null || this.#app.isHeadless) {
      return null;
    }
    return module.resolveFallbackTexture(
      this.#app.lite.engine,
      this.#fallbacks,
      declaration.fallback,
      declaration.array,
    );
  }
}

/** The per-app registries, created on first use so module scope allocates nothing. */
let registries: WeakMap<App, ShaderMaterialRegistry> | null = null;

/**
 * The shader material state of one app.
 *
 * @param app - The app.
 * @returns Its registry, created on first use.
 *
 * @internal
 */
export function shaderMaterialsOf(app: App): ShaderMaterialRegistry {
  const map = (registries ??= new WeakMap<App, ShaderMaterialRegistry>());
  const existing = map.get(app);
  if (existing !== undefined) {
    return existing;
  }
  const created = new ShaderMaterialRegistry(app);
  map.set(app, created);
  return created;
}

/**
 * One live `"shader"` material: the Babylon Lite material, the CPU-side copy of every value written
 * to it, and the bindings it has to replay when the shader file or a `define` changes.
 *
 * @remarks
 * `MaterialAsset` owns one of these and forwards `setUniform`, `getUniform`, `setTexture`,
 * `setDefine`, and `setStorageBuffer` to it. It is `@internal` because the public surface is the
 * material's methods, not this object.
 *
 * @internal
 */
export class ShaderMaterialState {
  /** The definition the material was built from; a clone replays it. */
  readonly definition: ShaderMaterialDefinition;

  readonly #app: App;

  readonly #values = new Map<string, Float32Array>();

  readonly #textures = new Map<string, AssetHandle<TextureAsset> | null>();

  readonly #storage = new Map<string, AssetHandle<StorageBufferAsset> | null>();

  readonly #defines = new Map<string, boolean | number>();

  /** The last light values written, so an unchanged light costs no upload. */
  readonly #light = new Float32Array(FRAME_FLOATS);

  /** The ignifx-provided uniforms the file declares, paired with their stores. */
  readonly #engineSlots: { readonly name: IgnifxUniformName; readonly store: Float32Array }[] = [];

  #shader: ShaderAsset;

  #material: LiteShaderMaterial;

  /**
   * The adapter every write goes through. Captured once, because a state can only be built after
   * {@link buildLiteShaderMaterial} has proved the chunk is in memory.
   */
  readonly #adapter: ShaderMaterialAdapter;

  #hasLight = false;

  #hasWarnedAboutLight = false;

  #onReplaced: Disconnect | null = null;

  /**
   * Builds the material. Use {@link buildShaderMaterialState}.
   *
   * @param app - The app that owns the engine, the log, and the registry.
   * @param shader - The shader the material sets values on.
   * @param definition - The declaration.
   * @param material - The already-built Babylon Lite material.
   * @param liteAdapter - The custom-WGSL adapter every write goes through.
   */
  constructor(
    app: App,
    shader: ShaderAsset,
    definition: ShaderMaterialDefinition,
    material: LiteShaderMaterial,
    liteAdapter: ShaderMaterialAdapter,
  ) {
    this.#app = app;
    this.#adapter = liteAdapter;
    this.#shader = shader;
    this.definition = definition;
    this.#material = material;
    // Not zeros: a light really at the origin pointing along +Z would then never be written.
    this.#light.fill(Number.NaN);
  }

  /**
   * The shader the material is values for.
   *
   * @returns The shader asset, which a hot reload replaces.
   */
  get shader(): ShaderAsset {
    return this.#shader;
  }

  /**
   * The Babylon Lite material, which `setDefine` and a hot reload replace with a new object.
   *
   * @returns The material.
   */
  get material(): LiteShaderMaterial {
    return this.#material;
  }

  /**
   * Whether the shader declares any ignifx-provided uniform, and so needs a per-frame write.
   *
   * @returns `true` when the `PreRender` system has work to do for this material.
   */
  get isAnimated(): boolean {
    return this.#shader.declaration.ignifx.length > 0;
  }

  /**
   * Whether every declared storage buffer has a buffer bound, which is what Babylon Lite needs
   * before the material can be drawn at all.
   *
   * @returns `true` when the material is drawable.
   */
  get isDrawable(): boolean {
    const declared = this.#shader.declaration.storage;
    for (let index = 0; index < declared.length; index += 1) {
      const name = declared[index]?.name;
      if (name !== undefined && (this.#storage.get(name) ?? null) === null) {
        return false;
      }
    }
    return true;
  }

  /**
   * Writes a declared uniform.
   *
   * @param name - The uniform's name.
   * @param value - The value: a number, a numeric array, or — for a `color` uniform — an sRGB
   * colour, which is uploaded linear.
   * @throws IgnifxError with code `IGX-0712` when the shader declares no such uniform or the engine
   * writes it, or `IGX-0713` when the value has the wrong shape.
   */
  setUniform(name: string, value: number | readonly number[] | Float32Array | ColorLike): void {
    const declaration = this.#writableUniform(name);
    const store = this.#values.get(name) ?? uniformStore(declaration);
    this.#values.set(name, store);
    writeUniformValue(store, declaration, value, this.definition.name);
    this.#write(name, store);
  }

  /**
   * Reads the current CPU-side value of a declared uniform.
   *
   * @param name - The uniform's name.
   * @param out - Receives the value for a vector or matrix uniform; a fresh array is allocated when
   * it is omitted.
   * @returns The number for a scalar uniform, or the filled array.
   * @throws IgnifxError with code `IGX-0712` when the shader declares no such uniform, or
   * `IGX-0713` when `out` is too short.
   */
  getUniform(name: string, out?: Float32Array): number | Float32Array {
    const declaration = this.#uniform(name);
    const store = this.#values.get(name) ?? uniformStore(declaration);
    this.#values.set(name, store);
    if (store.length === 1 && out === undefined) {
      return store[0] ?? 0;
    }
    if (out === undefined) {
      return Float32Array.from(store);
    }
    if (out.length < store.length) {
      throw new IgnifxError(
        CoreErrorCode.shaderValueMismatch,
        `${name} on ${this.definition.name} expects ${String(store.length)} floats, not ${String(out.length)}.`,
        {
          context: { name, material: this.definition.name, expected: store.length, actual: out.length },
          hint: "Pass an out array at least as long as the uniform's element count.",
        },
      );
    }
    out.set(store);
    return out;
  }

  /**
   * Binds a texture to a declared sampler, or restores the declaration's fallback.
   *
   * @param name - The sampler's name.
   * @param texture - The texture, or `null` for the declared 1x1 fallback.
   * @throws IgnifxError with code `IGX-0712` when the shader declares no such sampler.
   */
  setTexture(name: string, texture: AssetHandle<TextureAsset> | null): void {
    const declaration = this.#texture(name);
    this.#textures.set(name, texture);
    this.#bindTexture(declaration, texture);
  }

  /**
   * Binds a storage buffer to a declared binding.
   *
   * @param name - The binding's name.
   * @param buffer - The buffer, or `null` to unbind. A material with an unbound declared storage
   * buffer cannot be drawn.
   * @throws IgnifxError with code `IGX-0712` when the shader declares no such storage buffer.
   */
  setStorageBuffer(name: string, buffer: AssetHandle<StorageBufferAsset> | null): void {
    const declared = this.#shader.declaration.storage;
    let found = false;
    for (let index = 0; index < declared.length; index += 1) {
      if (declared[index]?.name === name) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw this.#unknownBinding(name, "storage buffer");
    }
    this.#storage.set(name, buffer);
    this.#bindStorage(name, buffer);
  }

  /**
   * Overrides a declared `define` and rebuilds the Babylon Lite material, because a define is a
   * WGSL `const` baked into the compiled pipeline.
   *
   * @remarks
   * The rebuild replaces the Lite material **object**. `MeshRenderer` re-reads
   * `MaterialAsset.lite.material` every `PreRender` and writes it onto its mesh when it changed,
   * and Lite's `mesh.material` setter enqueues a material swap that the next frame drains
   * (`lib/scene/mesh-scene-registry.js`), so the new pipeline is picked up on the following frame
   * with no explicit topology flag.
   *
   * @param name - The define's name.
   * @param value - The new value.
   * @throws IgnifxError with code `IGX-0712` when the shader declares no such define.
   */
  setDefine(name: string, value: boolean | number): void {
    const declared = this.#shader.declaration.defines;
    let fileValue: boolean | number | undefined;
    for (let index = 0; index < declared.length; index += 1) {
      const definition = declared[index];
      if (definition?.name === name) {
        fileValue = definition.value;
        break;
      }
    }
    if (fileValue === undefined) {
      throw this.#unknownBinding(name, "define");
    }
    // Compared against the value in force, not against the override map, so re-setting what the
    // file already declares is not a pipeline rebuild.
    if ((this.#defines.get(name) ?? fileValue) === value) {
      return;
    }
    this.#defines.set(name, value);
    this.#rebuild(this.#shader);
  }

  /**
   * Writes this frame's ignifx uniforms. The `PreRender` system calls it.
   *
   * @param time - Scaled seconds since `app.start()`.
   * @param unscaledTime - Unscaled seconds since `app.start()`.
   * @param deltaTime - Scaled seconds since the previous frame.
   * @param light - Nine floats: the main light's world direction, its linear colour times its
   * intensity, and the ambient colour.
   * @param hasLight - Whether an enabled directional light supplied the first six.
   */
  writeFrameUniforms(
    time: number,
    unscaledTime: number,
    deltaTime: number,
    light: Float32Array,
    hasLight: boolean,
  ): void {
    let lightChanged = this.#hasLight !== hasLight;
    this.#hasLight = hasLight;
    for (let index = 0; index < this.#light.length; index += 1) {
      if (this.#light[index] !== light[index]) {
        this.#light[index] = light[index] ?? 0;
        lightChanged = true;
      }
    }
    const slots = this.#engineSlots;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot === undefined) {
        continue;
      }
      switch (slot.name) {
        case "time":
          this.#writeScalar(slot.name, slot.store, time);
          break;
        case "unscaledTime":
          this.#writeScalar(slot.name, slot.store, unscaledTime);
          break;
        case "deltaTime":
          this.#writeScalar(slot.name, slot.store, deltaTime);
          break;
        case "mainLightDirection":
          if (lightChanged) {
            this.#writeTriple(slot.name, slot.store, light, DIRECTION_OFFSET);
          }
          break;
        case "mainLightColor":
          if (lightChanged) {
            this.#writeTriple(slot.name, slot.store, light, LIGHT_COLOR_OFFSET);
          }
          break;
        case "ambientColor":
          if (lightChanged) {
            this.#writeTriple(slot.name, slot.store, light, AMBIENT_OFFSET);
          }
          break;
        default:
          break;
      }
    }
    if (!hasLight && !this.#hasWarnedAboutLight && this.#needsLight()) {
      this.#hasWarnedAboutLight = true;
      const declared = this.#engineSlots.map((slot) => slot.name).join(", ");
      this.#app.log.warnOnce(
        `${CoreErrorCode.shaderLightUniformWithoutLight}:${this.definition.name}`,
        `${CoreErrorCode.shaderLightUniformWithoutLight}: ${this.definition.name} declares ${declared}, ` +
          "but this world has no enabled directional light; zeros are uploaded.",
      );
    }
  }

  /**
   * Replays the definition's values, textures, defines, and storage bindings onto a freshly built
   * Babylon Lite material, and connects the hot-reload hook. Called once, by
   * {@link buildShaderMaterialState}.
   *
   * @param textures - The texture handles the loader resolved, in declaration order.
   */
  initialise(textures: readonly AssetHandle<TextureAsset>[]): void {
    const declaration = this.#shader.declaration;
    for (const name of Object.keys(this.definition.defines)) {
      const value = this.definition.defines[name];
      if (value !== undefined) {
        this.#defines.set(name, value);
      }
    }
    for (const name of Object.keys(this.definition.values)) {
      const value = this.definition.values[name];
      if (value !== undefined) {
        this.setUniform(name, value);
      }
    }
    const addresses = Object.keys(this.definition.textures);
    for (let index = 0; index < declaration.textures.length; index += 1) {
      const declared = declaration.textures[index];
      if (declared === undefined) {
        continue;
      }
      const slot = addresses.indexOf(declared.name);
      const handle = slot < 0 ? undefined : textures[slot];
      this.#textures.set(declared.name, handle ?? null);
      this.#bindTexture(declared, handle ?? null);
    }
    this.#refreshEngineSlots();
    if (this.isAnimated) {
      shaderMaterialsOf(this.#app).add(this);
    }
    const source = this.#app.assets.get<ShaderAsset>(this.definition.shader);
    this.#onReplaced =
      source?.onReplaced.connect((value: ShaderAsset): void => {
        this.#reload(value);
      }) ?? null;
  }

  /**
   * Stops the per-frame writes and the hot-reload hook. The `material` asset type's `unload` runs
   * it when the last holder releases the material.
   */
  dispose(): void {
    this.#onReplaced?.();
    this.#onReplaced = null;
    shaderMaterialsOf(this.#app).remove(this);
  }

  /**
   * Rebuilds the Lite material for a replaced shader file, keeping the previous one on failure.
   *
   * @param shader - The re-parsed shader asset.
   */
  #reload(shader: ShaderAsset): void {
    try {
      this.#rebuild(shader);
      this.#shader = shader;
    } catch (error: unknown) {
      this.#app.onError.emit({
        error: new IgnifxError(
          CoreErrorCode.shaderCompileFailed,
          `${shader.address} failed to rebuild; the previous material stays in use. ${String(error)}`,
          {
            context: { asset: shader.address, message: String(error) },
            cause: error,
            hint: "Fix the shader file; the running material is the last one that built.",
          },
        ),
        source: "asset",
        phase: null,
        entity: null,
        component: null,
      });
    }
  }

  /**
   * Builds a new Lite material from a declaration and replays every binding that still exists.
   *
   * @param shader - The shader to build from.
   */
  #rebuild(shader: ShaderAsset): void {
    const declaration = shader.declaration;
    const previous = this.#shader;
    // The Lite material is replaced halfway through, so a failure has to put the old one back or the
    // material would be left drawing a new program against the old declaration's bindings.
    const previousMaterial = this.#material;
    const previousValues = new Map(this.#values);
    this.#shader = shader;
    try {
      const values = new Map<string, Float32Array>();
      for (let index = 0; index < declaration.uniforms.length; index += 1) {
        const uniform = declaration.uniforms[index];
        if (uniform === undefined) {
          continue;
        }
        const kept = this.#values.get(uniform.name);
        values.set(
          uniform.name,
          kept !== undefined && kept.length === ELEMENT_COUNTS[uniform.type] ? kept : uniformStore(uniform),
        );
      }
      this.#material = buildLiteShaderMaterial(this.definition.name, shader, values, this.#resolveDefines(shader));
      this.#values.clear();
      for (const [name, store] of values) {
        this.#values.set(name, store);
      }
      this.#rebind(declaration);
    } catch (error: unknown) {
      this.#shader = previous;
      this.#material = previousMaterial;
      this.#values.clear();
      for (const [name, store] of previousValues) {
        this.#values.set(name, store);
      }
      throw error;
    }
  }

  /**
   * Re-applies the texture and storage bindings that the new declaration still has, dropping the
   * ones it no longer declares.
   *
   * @param declaration - The new declaration.
   */
  #rebind(declaration: ShaderDeclaration): void {
    const textures = new Map(this.#textures);
    this.#textures.clear();
    for (let index = 0; index < declaration.textures.length; index += 1) {
      const declared = declaration.textures[index];
      if (declared === undefined) {
        continue;
      }
      const handle = textures.get(declared.name) ?? null;
      this.#textures.set(declared.name, handle);
      this.#bindTexture(declared, handle);
    }
    const storage = new Map(this.#storage);
    this.#storage.clear();
    for (let index = 0; index < declaration.storage.length; index += 1) {
      const name = declaration.storage[index]?.name;
      if (name === undefined) {
        continue;
      }
      const handle = storage.get(name) ?? null;
      this.#storage.set(name, handle);
      this.#bindStorage(name, handle);
    }
    this.#refreshEngineSlots();
    const registry = shaderMaterialsOf(this.#app);
    if (this.isAnimated) {
      registry.add(this);
    } else {
      registry.remove(this);
    }
    this.#light.fill(Number.NaN);
  }

  /**
   * The declared `define` values with this material's overrides applied.
   *
   * @param shader - The shader whose declaration supplies the defaults.
   * @returns The resolved values.
   */
  #resolveDefines(shader: ShaderAsset): Readonly<Record<string, boolean | number>> {
    const resolved: Record<string, boolean | number> = {};
    const declared = shader.declaration.defines;
    for (let index = 0; index < declared.length; index += 1) {
      const define = declared[index];
      if (define === undefined) {
        continue;
      }
      resolved[define.name] = this.#defines.get(define.name) ?? define.value;
    }
    return resolved;
  }

  /**
   * Binds a texture, or the declaration's fallback when there is none.
   *
   * @param declaration - The sampler declaration.
   * @param handle - The texture handle, or `null`.
   */
  #bindTexture(declaration: ShaderTextureDeclaration, handle: AssetHandle<TextureAsset> | null): void {
    const loaded = handle?.state === "loaded" ? handle.value.lite.texture : null;
    this.#adapter.writeShaderTexture(
      this.#material,
      declaration.name,
      loaded ?? shaderMaterialsOf(this.#app).fallbackTexture(declaration),
    );
  }

  /**
   * Binds a storage buffer.
   *
   * @param name - The binding's name.
   * @param handle - The buffer handle, or `null`.
   */
  #bindStorage(name: string, handle: AssetHandle<StorageBufferAsset> | null): void {
    this.#adapter.writeShaderStorageBuffer(
      this.#material,
      name,
      handle?.state === "loaded" ? handle.value.lite.buffer : null,
    );
  }

  /**
   * Writes one CPU-side value through to Babylon Lite.
   *
   * @param name - The uniform's name.
   * @param store - The value.
   */
  #write(name: string, store: Float32Array): void {
    this.#adapter.writeShaderUniform(this.#material, name, store);
  }

  /**
   * Writes one engine-owned scalar uniform through its CPU-side store.
   *
   * @param name - The uniform's name.
   * @param store - The store, which is also what `getUniform` reads.
   * @param value - The value.
   */
  #writeScalar(name: string, store: Float32Array, value: number): void {
    store[0] = value;
    this.#adapter.writeShaderUniform(this.#material, name, store);
  }

  /**
   * Writes three floats of an engine-owned `vec3<f32>` uniform, without allocating.
   *
   * @param name - The uniform's name.
   * @param store - The store, which is also what `getUniform` reads.
   * @param source - The nine-float frame buffer.
   * @param offset - Where the triple starts inside it.
   */
  #writeTriple(name: string, store: Float32Array, source: Float32Array, offset: number): void {
    store.set(source.subarray(offset, offset + 3));
    this.#adapter.writeShaderUniform(this.#material, name, store);
  }

  /**
   * Resolves the CPU-side store of every ignifx-provided uniform the file declares, so the
   * per-frame write is an indexed loop with no name lookup (coding standards §7).
   */
  #refreshEngineSlots(): void {
    const slots = this.#engineSlots;
    slots.length = 0;
    const declared = this.#shader.declaration.ignifx;
    for (let index = 0; index < declared.length; index += 1) {
      const name = declared[index];
      if (name === undefined) {
        continue;
      }
      const count = ELEMENT_COUNTS[IGNIFX_UNIFORM_TYPES[name]];
      const store = this.#values.get(name) ?? new Float32Array(count);
      this.#values.set(name, store);
      slots.push({ name, store });
    }
  }

  /**
   * Whether the shader declares a uniform that needs a directional light.
   *
   * @returns `true` when `mainLightDirection` or `mainLightColor` is declared.
   */
  #needsLight(): boolean {
    const declared = this.#shader.declaration.ignifx;
    for (let index = 0; index < declared.length; index += 1) {
      const name = declared[index];
      if (name === "mainLightDirection" || name === "mainLightColor") {
        return true;
      }
    }
    return false;
  }

  /**
   * Looks a custom uniform declaration up.
   *
   * @param name - The uniform's name.
   * @returns The declaration.
   * @throws IgnifxError with code `IGX-0712`.
   */
  #uniform(name: string): ShaderUniformDeclaration {
    const custom = this.#customUniform(name);
    if (custom !== null) {
      return custom;
    }
    const engine = this.#engineUniform(name);
    if (engine !== null) {
      return engine;
    }
    throw this.#unknownBinding(name, "uniform");
  }

  /**
   * Looks a custom uniform declaration up, refusing the ones the engine writes.
   *
   * @param name - The uniform's name.
   * @returns The declaration.
   * @throws IgnifxError with code `IGX-0712`.
   */
  #writableUniform(name: string): ShaderUniformDeclaration {
    const custom = this.#customUniform(name);
    if (custom !== null) {
      return custom;
    }
    if (ENGINE_UNIFORM_NAMES.includes(name)) {
      throw new IgnifxError(
        CoreErrorCode.unknownShaderBinding,
        `${name} on ${this.definition.name} is written by the engine every frame and cannot be set.`,
        {
          context: { material: this.definition.name, name },
          hint: "System uniforms come from Babylon Lite and the ignifx uniforms from the PreRender system.",
        },
      );
    }
    throw this.#unknownBinding(name, "uniform");
  }

  /**
   * The file's own declaration of a uniform, if it declares one by that name.
   *
   * @param name - The uniform's name.
   * @returns The declaration, or `null`.
   */
  #customUniform(name: string): ShaderUniformDeclaration | null {
    const declared = this.#shader.declaration.uniforms;
    for (let index = 0; index < declared.length; index += 1) {
      const uniform = declared[index];
      if (uniform !== undefined && uniform.name === name) {
        return uniform;
      }
    }
    return null;
  }

  /**
   * The synthetic declaration of an ignifx-provided uniform the file declared, so `getUniform` can
   * read back what the `PreRender` system wrote.
   *
   * @param name - The uniform's name.
   * @returns The declaration, or `null` when the file declares no such engine uniform.
   */
  #engineUniform(name: string): ShaderUniformDeclaration | null {
    const declared = this.#shader.declaration.ignifx;
    for (let index = 0; index < declared.length; index += 1) {
      const ignifx = declared[index];
      if (ignifx !== undefined && ignifx === name) {
        return {
          name: ignifx,
          type: IGNIFX_UNIFORM_TYPES[ignifx],
          defaultValue: zeros(ELEMENT_COUNTS[IGNIFX_UNIFORM_TYPES[ignifx]]),
          color: false,
          range: null,
          step: null,
          tooltip: null,
        };
      }
    }
    return null;
  }

  /**
   * Looks a sampler declaration up.
   *
   * @param name - The sampler's name.
   * @returns The declaration.
   * @throws IgnifxError with code `IGX-0712`.
   */
  #texture(name: string): ShaderTextureDeclaration {
    const declared = this.#shader.declaration.textures;
    for (let index = 0; index < declared.length; index += 1) {
      const texture = declared[index];
      if (texture !== undefined && texture.name === name) {
        return texture;
      }
    }
    throw this.#unknownBinding(name, "texture");
  }

  /**
   * Builds the `IGX-0712` failure an undeclared binding name produces.
   *
   * @param name - The name that was asked for.
   * @param what - What kind of binding was expected.
   * @returns The error to throw.
   */
  #unknownBinding(name: string, what: string): IgnifxError {
    return new IgnifxError(
      CoreErrorCode.unknownShaderBinding,
      `${this.definition.name} declares no ${what} named ${name}.`,
      {
        context: { material: this.definition.name, name },
        hint: `Declare it in ${this.#shader.address} with an // @ignifx ${what} pragma.`,
      },
    );
  }
}

/**
 * Builds the live state of a `"shader"` material: the Babylon Lite material, then every value,
 * texture, and define the definition names.
 *
 * @param app - The app that owns the engine, the log, and the registry.
 * @param shader - The shader the material sets values on.
 * @param definition - The declaration.
 * @param textures - The texture handles the loader resolved, in the order the definition's
 * `textures` record names them.
 * @returns The state.
 * @throws IgnifxError with code `IGX-0715` when the adapter has not been loaded, `IGX-0712` for an
 * undeclared value or define name, or `IGX-0713` for a value of the wrong shape.
 *
 * @internal
 */
export function buildShaderMaterialState(
  app: App,
  shader: ShaderAsset,
  definition: ShaderMaterialDefinition,
  textures: readonly AssetHandle<TextureAsset>[],
): ShaderMaterialState {
  const defines: Record<string, boolean | number> = {};
  const declared = shader.declaration.defines;
  for (let index = 0; index < declared.length; index += 1) {
    const define = declared[index];
    if (define !== undefined) {
      defines[define.name] = definition.defines[define.name] ?? define.value;
    }
  }
  for (const name of Object.keys(definition.defines)) {
    if (!(name in defines)) {
      throw new IgnifxError(
        CoreErrorCode.unknownShaderBinding,
        `${definition.name} declares no define named ${name}.`,
        {
          context: { material: definition.name, name },
          hint: `Declare it in ${shader.address} with an // @ignifx define pragma.`,
        },
      );
    }
  }
  const material = buildLiteShaderMaterial(definition.name, shader, new Map(), defines);
  const state = new ShaderMaterialState(app, shader, definition, material, requireShaderMaterialAdapter(shader));
  state.initialise(textures);
  return state;
}

/**
 * Builds the Babylon Lite material a declaration describes, through the dynamically loaded adapter.
 *
 * @param name - The material's name.
 * @param shader - The shader.
 * @param values - Current custom uniform values to seed the declaration's defaults with.
 * @param defines - The resolved `define` values.
 * @returns The Lite material.
 * @throws IgnifxError with code `IGX-0715` when the adapter has not been loaded yet.
 */
function buildLiteShaderMaterial(
  name: string,
  shader: ShaderAsset,
  values: ReadonlyMap<string, Float32Array>,
  defines: Readonly<Record<string, boolean | number>>,
): LiteShaderMaterial {
  return requireShaderMaterialAdapter(shader).createShaderMaterialFromOptions(
    toShaderMaterialOptions(name, shader.source, shader.declaration, values, defines),
  );
}

/**
 * A number, or an array of that many zeros, matching what a uniform of that arity starts at.
 *
 * @param count - How many elements the uniform holds.
 * @returns The zero value.
 */
function zeros(count: number): number | readonly number[] {
  if (count === 1) {
    return 0;
  }
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(0);
  }
  return values;
}

/**
 * A fresh CPU-side store for one uniform, filled with its declared default — **linear** for a
 * colour, because that is what the GPU reads.
 *
 * @param declaration - The uniform declaration.
 * @returns The store.
 */
function uniformStore(declaration: ShaderUniformDeclaration): Float32Array {
  const count = ELEMENT_COUNTS[declaration.type];
  const store = new Float32Array(count);
  const value = declaration.defaultValue;
  if (typeof value === "number") {
    store[0] = value;
  } else {
    store.set(value.slice(0, count));
  }
  if (declaration.color) {
    decodeColourComponents(store);
  }
  return store;
}

/**
 * Writes a caller's value into a uniform's CPU-side store, checking its shape and decoding a
 * colour.
 *
 * @param store - The store to write into.
 * @param declaration - The uniform declaration.
 * @param value - The caller's value.
 * @param material - The material's name, for diagnostics.
 * @throws IgnifxError with code `IGX-0713` when the value's shape does not match the declared type.
 */
function writeUniformValue(
  store: Float32Array,
  declaration: ShaderUniformDeclaration,
  value: number | readonly number[] | Float32Array | ColorLike,
  material: string,
): void {
  const count = store.length;
  if (typeof value === "number") {
    if (count !== 1) {
      throw shapeMismatch(declaration, material, `${declaration.type} (${String(count)} floats)`, "a single number");
    }
    store[0] = value;
    return;
  }
  if (isColorLike(value)) {
    if (count !== 3 && count !== 4) {
      throw shapeMismatch(declaration, material, `${declaration.type} (${String(count)} floats)`, "a colour");
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
    throw shapeMismatch(
      declaration,
      material,
      `${declaration.type} (${String(count)} floats)`,
      `${String(value.length)} floats`,
    );
  }
  store.set(value instanceof Float32Array ? value : Float32Array.from(value));
  if (declaration.color) {
    decodeColourComponents(store);
  }
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
 * Builds the `IGX-0713` failure a wrongly shaped value produces.
 *
 * @param declaration - The uniform declaration.
 * @param material - The material's name.
 * @param expected - What the uniform takes.
 * @param actual - What the caller passed.
 * @returns The error to throw.
 */
function shapeMismatch(
  declaration: ShaderUniformDeclaration,
  material: string,
  expected: string,
  actual: string,
): IgnifxError {
  return new IgnifxError(
    CoreErrorCode.shaderValueMismatch,
    `${declaration.name} on ${material} expects ${expected}, not ${actual}.`,
    {
      context: { name: declaration.name, material, expected, actual },
      hint: "A colour uniform takes a ColorLike or its element count; every other uniform takes its element count.",
    },
  );
}
