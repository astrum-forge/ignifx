import { Component } from "../component/component.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { isIgnifxError } from "../errors/ignifx-error.js";
import { array, asset, bool, custom, f32, i32, map, record, u32 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { applyPostProcessSettings, recordPostProcessChain } from "./gpu/post-process-chain.js";
import { hdrBloomSupport, loadHdrBloomSupport } from "./hdr-bloom-support.js";
import { postEffectCompiler } from "./post-effect-support.js";
import { postEffectValuesCodec } from "./post-effect.js";
import { rendererInternals } from "./renderer.js";
import { ScreenSpaceEffects } from "./screen-space-effects.js";
import { ShaderAsset } from "./shader-asset.js";
import { shaderSupport } from "./shader-support.js";
import { TextureAsset } from "./texture-asset.js";
import type { CustomEffectRequest, PostProcessChain, PostProcessEffectRequest } from "./gpu/post-process-chain.js";
import type { CustomEffectSettings } from "./post-effect.js";
import type { RendererImpl } from "./renderer.js";
import type { ShaderTextureDeclaration } from "./shader-declaration.js";
import type { App } from "../app/types.js";
import type { ComponentHooks } from "../component/component.js";
import type { HdrBloom } from "../lite/gpu/bloom-hdr.js";
import type { LiteTexture2D } from "../lite/gpu/texture.js";
import type { Schema } from "../schema/types.js";

/**
 * The `PostProcessStack` component (`docs/architecture/07-rendering.md` §2.7): the three effects the
 * MVP ships — bloom, SMAA, and image processing — inserted into the scene's frame graph.
 *
 * ## The schema is three records, not a discriminated list
 *
 * §2.7 describes an "ordered list of effects". A list of heterogeneous effect records needs either a
 * `custom()` field with a hand-written codec or a tagged union the schema kinds cannot express, and
 * neither is inspectable without extra tooling. Three optional records with an `order` each is the
 * simplest shape that round-trips through `encodeProps`/`decodeProps` unchanged, shows up in the
 * inspector with real field names and tooltips, and still lets a project reorder the chain. The
 * cost is that a fourth effect would add a fourth record rather than a new list entry; that is a
 * schema addition, which the format already tolerates.
 *
 * ## It needs `rendering.features.postProcessing`, declared at app start
 *
 * A chain cannot read the swapchain: `createSurface` configures the canvas context with no `usage`
 * (`lib/engine/surface.js` 30), so its texture is `RENDER_ATTACHMENT` only, binding it as a sampled
 * texture fails WebGPU validation, and the whole frame's command buffer is rejected — a black page.
 * The scene therefore has to be rendered into an offscreen target instead, and *that* is a frame
 * graph decision made inside `createSceneContext`, before a component exists to ask for it
 * (`src/lite/gpu/render-path.ts`). So it is a rendering **feature**, declared with the others
 * (§1.1), and a stack attached without it logs `IGX-0710` once and does nothing.
 *
 * ## How the chain is wired
 *
 * ```text
 * scene ─→ sceneColor ─ bloom ─→ link ─ smaa ─→ swapchain
 *              └─ present ─→ swapchain   (switched off while the chain runs)
 * ```
 *
 * `sceneColor` is the offscreen target the render path drew into — single-sample, resolved from MSAA
 * when MSAA is on, and carrying the `TEXTURE_BINDING` the swapchain lacks. The chain ping-pongs
 * through targets of its own and its last effect writes the swapchain, which is when the render
 * path's compositing blit is disabled. Disable the stack and the blit comes back, so the swapchain
 * always receives the frame.
 *
 * `imageProcessing` is always recorded last, whatever `order` says: Lite's task writes `engine.scRT`
 * unconditionally and takes no target, so nothing can read what it produced.
 *
 * ## `custom` brings one more rebuild trigger
 *
 * A custom effect's chain links are eagerly allocated, fixed-size textures, because Lite's public
 * fullscreen-effect path samples a `Texture2D` (`src/lite/gpu/effect-task.ts`). So the chain's
 * identity includes the surface size while one is enabled, and a canvas resize rebuilds it. Its
 * `values` round-trip through a hand-written codec, for the reason `./post-effect.ts` records.
 *
 * ## Tuning is live; the chain's shape is rebuilt
 *
 * Writing `bloom.threshold`, `bloom.weight`, `bloom.kernel`, `bloom.exposure` or any SMAA field on
 * a running stack reaches the recorded Lite task on the next `PreRender`: the chain re-uploads the
 * task's uniforms, and only when a value actually changed (`PostProcessChain.applySettings`). That is
 * what a settings slider or an inspector edit needs, and it costs nothing on a frame where nothing
 * moved.
 *
 * What a recorded task cannot change is its **shape**: which effects are on, in which `order`, and
 * bloom's `scale`, which sizes the blur targets when the task is created. A change to any of those
 * rebuilds the chain — the old tasks are disabled and their GPU resources freed, new ones recorded.
 *
 * ## The one Lite limit this component still inherits
 *
 * **Nothing can be removed from a frame graph.** `executionEnabled = false` is the substitute, so a
 * rebuilt chain leaves its old tasks in the graph, disabled and disposed, at one branch per frame
 * each. Toggling an effect's `enabled` in a settings menu therefore costs a rebuild per toggle;
 * toggling the whole component's `enabled` costs nothing but a branch, because the chain is kept and
 * merely skipped. The component disposes everything at detach. Resizing, by contrast, is free: every
 * target is sized by the surface and reallocated by the frame-graph rebuild a resize triggers.
 */

/**
 * The `bloom` record a `PostProcessStack` declares (`docs/architecture/07-rendering.md` §2.7).
 *
 * @remarks
 * Two bloom passes share the record. Without `rendering.hdr` it is Lite's LDR bloom, recorded in the
 * chain after tone mapping, and `order`, `weight`, `kernel`, `threshold`, `exposure` and `scale`
 * apply. With `rendering.hdr` the HDR bloom **replaces** it: a downsample/upsample chain on the
 * linear scene colour, always before the output pass whatever `order` says, tuned by `intensity`,
 * `radius` and `hdrThreshold` (GI plan step G12).
 *
 * @public
 */
export interface BloomEffectSettings {
  /** Whether the glow pass runs. */
  enabled: boolean;
  /** Position in the chain; lower runs first. LDR bloom only. */
  order: number;
  /** How strongly the glow is mixed back in. LDR bloom only. */
  weight: number;
  /** The blur kernel width, in pixels. LDR bloom only. */
  kernel: number;
  /** The luminance above which a pixel glows. LDR bloom only; HDR bloom reads `hdrThreshold`. */
  threshold: number;
  /** An exposure applied while extracting highlights. LDR bloom only. */
  exposure: number;
  /** The fraction of full resolution the blur runs at. LDR bloom only. */
  scale: number;
  /** HDR bloom: how much glow is mixed into the frame, 0–1. */
  intensity: number;
  /** HDR bloom: how far the glow spreads, 0 (tight) to 1 (wide). */
  radius: number;
  /** HDR bloom: the linear luminance below which nothing glows; `0`, the default, lets every pixel glow by its energy. */
  hdrThreshold: number;
}

/**
 * The `smaa` record a `PostProcessStack` declares (`docs/architecture/07-rendering.md` §2.7).
 *
 * @public
 */
export interface SmaaEffectSettings {
  /** Whether subpixel morphological anti-aliasing runs. */
  enabled: boolean;
  /** Position in the chain; lower runs first. */
  order: number;
  /** The luma difference that counts as an edge. */
  threshold: number;
  /** How far the pattern search runs along an edge, in pixels. */
  maxSearchSteps: number;
  /** Whether 45-degree patterns are detected. */
  diagonalDetection: boolean;
  /** Whether corner patterns are attenuated. */
  cornerDetection: boolean;
}

/**
 * The `imageProcessing` record a `PostProcessStack` declares
 * (`docs/architecture/07-rendering.md` §2.7).
 *
 * @public
 */
export interface ImageProcessingEffectSettings {
  /** Whether a full-screen grading pass runs. */
  enabled: boolean;
  /** Position in the chain; lower runs first. */
  order: number;
}

/**
 * The `contactShadows` record a `PostProcessStack` declares (GI plan step G10,
 * `docs/architecture/07-rendering.md` §2.7): Lite's screen-space contact shadows towards the main
 * directional light, fed from the shared scene-input depth.
 *
 * @public
 */
export interface ContactShadowsEffectSettings {
  /** Whether the pass runs. */
  enabled: boolean;
  /** How dark a contact gets, 0 to 4. */
  intensity: number;
  /** How far each ray marches towards the light, in world units. */
  length: number;
  /** How thick a surface is assumed to be behind its depth, in world units. */
  thickness: number;
  /** March steps per pixel, 1 to 64. */
  samples: number;
}

/**
 * The `ssgi` record a `PostProcessStack` declares (GI plan step G11,
 * `docs/architecture/07-rendering.md` §2.7): Lite's `@beta` screen-space global illumination, one
 * bounce of the lit scene colour. Desktop tier.
 *
 * @beta
 */
export interface SsgiEffectSettings {
  /** Whether the pass runs. */
  enabled: boolean;
  /** How strongly the bounce is added, 0 to 4. */
  intensity: number;
  /** How far each ray marches, in world units. */
  radius: number;
  /** March steps per ray, 1 to 64. */
  samples: number;
  /** Whether rays are traced at half resolution. A change rebuilds the pass. */
  halfResolution: boolean;
  /**
   * How much of the environment's diffuse light remains while SSGI runs, 0 to 1, so the bounce is
   * not counted twice. Needs `rendering.hdr` or the `materialPlugins` feature; without either the
   * environment is left as it is.
   */
  environmentDiffuse: number;
}

/**
 * One instance of a post-process chain, attached to the main camera's entity
 * (`docs/architecture/07-rendering.md` §2.7).
 *
 * @remarks
 * The stack may be attached and configured either **before** or after `app.start()`. Before start
 * the chain's frame-graph tasks are appended and recorded by the scene registration `start()` runs;
 * after start they are recorded on the spot. Either way the first frame the canvas presents already
 * carries the effects.
 *
 * @example
 * ```ts
 * cameraEntity.addComponent(PostProcessStack, {
 *   bloom: { enabled: true, threshold: 0.85, weight: 0.4 },
 *   smaa: { enabled: true },
 * });
 * ```
 *
 * @public
 */
export class PostProcessStack extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/PostProcessStack";

  /** What the component does, in one line, for an inspector. */
  static description =
    "Bloom, SMAA, image processing, and custom .post.wgsl effects, inserted into the scene's frame graph.";

  /** One chain per camera entity; a second would fight the first for the swapchain. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = postProcessSchema();

  declare bloom: BloomEffectSettings;

  declare smaa: SmaaEffectSettings;

  declare imageProcessing: ImageProcessingEffectSettings;

  declare custom: CustomEffectSettings[];

  declare contactShadows: ContactShadowsEffectSettings;

  /**
   * Screen-space global illumination; see {@link SsgiEffectSettings}.
   *
   * @beta
   */
  declare ssgi: SsgiEffectSettings;

  /** The contact-shadow and SSGI passes, which run on the scene colour before the chain. */
  readonly #screenSpace = new ScreenSpaceEffects();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(PostProcessStack.schema));
  }

  #chain: PostProcessChain | null = null;

  #built = "";

  #hasWarnedAboutFeature = false;

  /** The HDR bloom chain, once a stack under `rendering.hdr` asked for bloom. */
  #hdrBloom: HdrBloom | null = null;

  /** Whether loading the HDR bloom chunk failed, so it is reported once. */
  #hdrBloomFailed = false;

  /** The shader addresses whose compilation already failed, so the report is made once each. */
  readonly #failedShaders = new Set<string>();

  /** The entry buffer `#chainKey` refills every frame. */
  readonly #entryScratch: ChainEntry[] = [];

  /**
   * Reports, once per effect, that its `values` name a uniform the shader does not declare.
   *
   * @remarks
   * A field rather than a method so the chain can hold one stable reference: it is handed over at
   * construction, not per frame.
   *
   * @param address - The shader's address.
   * @param message - What the compiler said.
   */
  readonly #reportRefusedValues = (address: string, message: string): void => {
    this.app.log.error(
      `${CoreErrorCode.shaderCompileFailed}: ${address} has a custom post effect whose values were refused, ` +
        `so it stopped uploading them. ${message}`,
    );
  };

  /**
   * How many frame-graph tasks the stack has recorded.
   *
   * @returns The task count; `0` before the chain is built, under a headless app, and when the
   * `postProcessing` rendering feature is off.
   */
  get taskCount(): number {
    return (this.#chain?.taskCount ?? 0) + (this.#hdrBloom?.taskCount ?? 0);
  }

  /**
   * The HDR bloom chain, once it is recorded.
   *
   * @returns The chain, or `null` without `rendering.hdr`, before bloom was enabled, or while its
   * chunk loads.
   *
   * @internal
   */
  get hdrBloom(): HdrBloom | null {
    return this.#hdrBloom;
  }

  /** Nothing to do at attach: the chain is built on the first sync that wants an effect. */
  onAttach(): void {
    this.#built = "";
    this.#hasWarnedAboutFeature = false;
  }

  /** Disables and disposes every task the stack recorded. */
  onDetach(): void {
    this.#screenSpace.dispose(this.#screenSpace.isBuilt && rendererOfStack(this).isSceneRegistered);
    const chain = this.#chain;
    this.#chain = null;
    this.#built = "";
    chain?.dispose();
    const bloom = this.#hdrBloom;
    this.#hdrBloom = null;
    bloom?.dispose();
  }

  /**
   * Builds the chain when the effects it should hold change, and keeps the recorded tasks' tuning
   * and enabled state in step with the fields after that. The `PreRender` system calls it.
   *
   * @remarks
   * It is also called once by `app.start()`, through `renderer.syncBeforeRegister`, which is what
   * makes a stack configured **before** `start()` work: at that point the scene's frame graph has
   * not been built, so the chain appends its tasks and lets `registerScene` record them
   * (`PostProcessChain`'s `isFrameGraphBuilt`). Recording them early instead binds a scene colour
   * that no task has allocated yet and Lite rejects the whole frame with error 107.
   *
   * The chain's identity is {@link PostProcessStack.plannedChain} plus bloom's `scale`. When it
   * changes, the old chain is disposed and a new one recorded; when it does not, the chain follows
   * the component's `enabled` and re-uploads whatever tuning changed. A rebuild never happens
   * before the frame graph is built, because `syncBeforeRegister` is the only sync `start()` runs.
   *
   * @param renderer - The rendering service, for the engine and the scene.
   *
   * @internal
   */
  sync(renderer: RendererImpl): void {
    this.#syncHdrBloom(renderer);
    this.#screenSpace.sync(renderer, this.contactShadows, this.ssgi, this.isEnabledInHierarchy);
    const wanted = this.#chainKey(renderer);
    if (wanted !== this.#built) {
      this.#rebuild(renderer, wanted);
      return;
    }
    if (!this.#hasWarnedAboutFeature && !renderer.features.postProcessing) {
      this.#warnAboutFeature(renderer, this.plannedChain().length + this.#screenSpaceCount());
    }
    const surface = renderer.surface;
    applyPostProcessSettings(
      this.#chain,
      this.isEnabledInHierarchy,
      this.bloom,
      this.smaa,
      renderer.effectClock,
      surface?.width ?? 0,
      surface?.height ?? 0,
      renderer.isSceneRegistered,
    );
  }

  /**
   * Keeps the HDR bloom chain in step with the `bloom` record under `rendering.hdr`.
   *
   * @remarks
   * The chain is built once, the first frame bloom is wanted after its chunk has loaded, and is
   * then only switched on or off: Lite cannot remove its tasks, and nothing in the record changes
   * its shape. Until the chunk is in, the frame presents without bloom.
   *
   * @param renderer - The rendering service, for the presenter and the scene.
   */
  #syncHdrBloom(renderer: RendererImpl): void {
    const hdr = renderer.presenter?.hdr ?? null;
    const isWanted = hdr !== null && this.bloom.enabled && this.isEnabledInHierarchy;
    if (this.#hdrBloom === null) {
      if (!isWanted || this.#hdrBloomFailed) {
        return;
      }
      const support = hdrBloomSupport();
      if (support === null) {
        loadHdrBloomSupport().catch((failure: unknown) => {
          this.#reportHdrBloomFailure(renderer, failure);
        });
        return;
      }
      this.#hdrBloom = support.installHdrBloom(renderer.engine, renderer.scene, hdr, renderer.isSceneRegistered);
    }
    const bloom = this.bloom;
    this.#hdrBloom.setEnabled(isWanted);
    this.#hdrBloom.apply({ intensity: bloom.intensity, radius: bloom.radius, threshold: bloom.hdrThreshold });
  }

  /**
   * Reports, once, that the HDR bloom chunk did not load.
   *
   * @param renderer - The rendering service, for the log.
   * @param failure - What the import threw.
   */
  #reportHdrBloomFailure(renderer: RendererImpl, failure: unknown): void {
    if (this.#hdrBloomFailed) {
      return;
    }
    this.#hdrBloomFailed = true;
    renderer.app.log.error(
      `HDR bloom could not be loaded, so {entity} renders without it. ${String(failure)}`,
      this.entity.name,
    );
  }

  /**
   * Replaces the chain with one that holds the effects the fields currently ask for.
   *
   * @remarks
   * The request list is the component's own state, so it is built whether or not there is a device
   * to record it into; only the recording is device-only. An old chain is disposed first, which
   * also hands the swapchain back to the compositing blit, so a stack whose last effect was just
   * switched off presents the plain scene from the next frame rather than a stale one.
   *
   * @param renderer - The rendering service, for the engine and the scene.
   * @param wanted - The chain identity the fields currently describe.
   */
  #rebuild(renderer: RendererImpl, wanted: string): void {
    this.#built = wanted;
    const previous = this.#chain;
    this.#chain = null;
    previous?.dispose();
    const requests = this.#requests(renderer);
    this.#chain = recordPostProcessChain(
      renderer.engine,
      renderer.scene,
      renderer.presenter,
      renderer.isHeadless,
      requests,
      renderer.isSceneRegistered,
      this.isEnabledInHierarchy,
      this.#reportRefusedValues,
    );
    this.#warnAboutFeature(renderer, requests.length + this.#screenSpaceCount());
  }

  /**
   * How many of the scene-colour passes the fields ask for.
   *
   * @returns 0, 1 or 2.
   */
  #screenSpaceCount(): number {
    return (this.contactShadows.enabled ? 1 : 0) + (this.ssgi.enabled ? 1 : 0);
  }

  /**
   * Says once, at warning level, that the stack asks for effects the project did not opt into.
   *
   * @remarks
   * Headless does **not** suppress it, for the same reason the shadows warning is not suppressed: a
   * missing opt-in is a configuration problem, and a headless test is exactly where a project should
   * find out about it. A headless app has no presenter either way, so the check is on the feature
   * flag rather than on the presenter.
   *
   * @param renderer - The rendering service, for the feature flags and the log.
   * @param requestedEffects - How many effects the fields currently ask for.
   */
  #warnAboutFeature(renderer: RendererImpl, requestedEffects: number): void {
    if (this.#hasWarnedAboutFeature || requestedEffects === 0 || renderer.features.postProcessing) {
      return;
    }
    this.#hasWarnedAboutFeature = true;
    renderer.app.log.warn(
      `${CoreErrorCode.postProcessingFeatureOff}: {entity} asks for post-processing, but the ` +
        "rendering.features.postProcessing opt-in is off, so the stack is inert. Declare it in the " +
        "rendering.features block of createApp() or ignifx.config.ts.",
      this.entity.name,
    );
  }

  /**
   * The enabled effects, first to last, with the tuning each one needs.
   *
   * @remarks
   * A custom effect is compiled here, which is where a `.post.wgsl` that declares no `mainFragment`
   * or the wrong `@ignifx` kind surfaces: the effect is dropped and the failure is reported once per
   * shader address through `app.log.error`, rather than throwing out of a `PreRender` system on every
   * frame.
   *
   * @param renderer - The rendering service, for the sRGB flag, the app, and the fallback textures.
   * @returns The requests the frame-graph half records.
   */
  #requests(renderer: RendererImpl): readonly PostProcessEffectRequest[] {
    const sourceIsSrgb = renderer.settings.srgb;
    const isHdr = renderer.settings.hdr;
    const requests: PostProcessEffectRequest[] = [];
    for (const entry of this.#entries()) {
      // Under `rendering.hdr` the HDR bloom replaces the LDR one (`#syncHdrBloom`).
      if (!entry.enabled || (isHdr && entry.name === "bloom")) {
        continue;
      }
      const settings = entry.settings;
      if (entry.name !== "custom" || settings === null) {
        requests.push({ name: entry.name, bloom: this.bloom, smaa: this.smaa, sourceIsSrgb, custom: null });
        continue;
      }
      const request = this.#compile(renderer, settings);
      if (request !== null) {
        requests.push({ name: "custom", bloom: this.bloom, smaa: this.smaa, sourceIsSrgb, custom: request });
      }
    }
    return requests;
  }

  /**
   * Compiles one custom effect and resolves its textures.
   *
   * @param renderer - The rendering service.
   * @param settings - The effect's record.
   * @returns The request, or `null` when the shader is missing, unloaded, or does not compile.
   */
  #compile(renderer: RendererImpl, settings: CustomEffectSettings): CustomEffectRequest | null {
    const handle = settings.shader;
    if (handle === null || handle.state !== "loaded") {
      return null;
    }
    const shader = handle.value;
    const compiler = postEffectCompiler();
    if (compiler === null) {
      return null;
    }
    try {
      const compiled = compiler.compiledPostEffect(shader);
      const textures: (LiteTexture2D | null)[] = [];
      for (const declaration of compiled.textures) {
        const bound = settings.textures[declaration.name] ?? null;
        const resolved = bound !== null && bound.state === "loaded" ? bound.value.lite.texture : null;
        textures.push(resolved ?? (renderer.isHeadless ? null : fallbackTexture(renderer.app, declaration)));
      }
      return { address: shader.address, compiled, shader, settings, textures };
    } catch (failure: unknown) {
      if (!this.#failedShaders.has(shader.address)) {
        this.#failedShaders.add(shader.address);
        const message = isIgnifxError(failure) ? failure.message : String(failure);
        renderer.app.log.error(
          `${CoreErrorCode.shaderCompileFailed}: {asset} could not be recorded as a custom post effect. ${message}`,
          shader.address,
        );
      }
      return null;
    }
  }

  /**
   * The effects the fields currently ask for, by name, ordered by `order`. The recorded chain moves
   * `imageProcessing` last whatever its `order` says. It is what
   * {@link PostProcessStack.taskCount} would grow to on a device.
   *
   * @returns The effect names, first to last.
   *
   * @internal
   */
  plannedChain(): readonly string[] {
    const names: string[] = [];
    for (const entry of this.#entries()) {
      if (entry.enabled) {
        names.push(entry.name);
      }
    }
    return names;
  }

  /**
   * The identity of the chain the fields currently ask for: which effects are on, in which order,
   * and — while bloom is one of them — bloom's `scale`, the one tuning Lite fixes when the task is
   * created. A change to it while a chain exists is a rebuild, because Lite cannot re-order a
   * recorded frame graph or resize a bloom task's blur targets.
   *
   * @remarks
   * A custom effect adds its shader address and its bound texture addresses, because both are baked
   * into the effect's shader module and bind group, and — because its chain links are eagerly
   * allocated at a fixed size — the surface's backing-store size, so a resize rebuilds.
   *
   * @param renderer - The rendering service, for the surface size.
   * @returns The key.
   */
  #chainKey(renderer: RendererImpl): string {
    // `sync` builds this every frame, so it fills one reused array rather than allocating three.
    const entries = this.#fillEntries(this.#entryScratch);
    const isHdr = renderer.settings.hdr;
    let key = "";
    let hasCustom = false;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined || !entry.enabled || (isHdr && entry.name === "bloom")) {
        continue;
      }
      const settings = entry.settings;
      if (entry.name !== "custom" || settings === null) {
        key = key === "" ? entry.name : `${key},${entry.name}`;
        continue;
      }
      hasCustom = true;
      const bound = settings.textures;
      const names = Object.keys(bound).toSorted();
      let textures = "";
      for (let slot = 0; slot < names.length; slot += 1) {
        const name = names[slot] ?? "";
        textures += `${slot === 0 ? "" : "&"}${name}=${bound[name]?.address ?? ""}`;
      }
      const part = `custom:${settings.shader?.address ?? ""}:${textures}`;
      key = key === "" ? part : `${key},${part}`;
    }
    if (this.bloom.enabled && !isHdr) {
      key = `${key}|scale=${String(this.bloom.scale)}`;
    }
    if (hasCustom) {
      const surface = renderer.surface;
      key = `${key}|size=${String(surface?.width ?? 0)}x${String(surface?.height ?? 0)}`;
    }
    return key;
  }

  /**
   * The three built-in effect records and every custom effect, as one list ordered by `order`.
   *
   * @remarks
   * Sorted stably, so two custom effects with the same `order` keep the order the list declares.
   *
   * @returns The entries, first to last.
   */
  #entries(): readonly ChainEntry[] {
    return this.#fillEntries([]);
  }

  /**
   * Fills an array with the current entries, ordered by `order`.
   *
   * @param out - The array to refill; its previous contents are discarded.
   * @returns `out`, sorted stably so two effects with the same `order` keep the declared order.
   */
  #fillEntries(out: ChainEntry[]): ChainEntry[] {
    out.length = 0;
    out.push(
      { name: "bloom", enabled: this.bloom.enabled, order: this.bloom.order, settings: null },
      { name: "smaa", enabled: this.smaa.enabled, order: this.smaa.order, settings: null },
      {
        name: "imageProcessing",
        enabled: this.imageProcessing.enabled,
        order: this.imageProcessing.order,
        settings: null,
      },
    );
    for (const settings of this.custom) {
      out.push({
        name: "custom",
        enabled: settings.enabled && settings.shader !== null,
        order: settings.order,
        settings,
      });
    }
    out.sort((left, right) => left.order - right.order);
    return out;
  }
}

/**
 * The 1x1 texture a declared-but-unbound post-effect sampler is filled with.
 *
 * @param app - The app whose shader-material registry owns the fallbacks.
 * @param declaration - The sampler declaration, for its `default` and `array` flags.
 * @returns The texture, or `null` when the custom-shader layer has not loaded.
 */
function fallbackTexture(app: App, declaration: ShaderTextureDeclaration): LiteTexture2D | null {
  return shaderSupport()?.shaderMaterialsOf(app).fallbackTexture(declaration) ?? null;
}

/** One entry of the ordered chain the component's fields describe. */
interface ChainEntry {
  /** Which effect it is. */
  readonly name: "bloom" | "smaa" | "imageProcessing" | "custom";
  /** Whether it runs. */
  readonly enabled: boolean;
  /** Position in the chain; lower runs first. */
  readonly order: number;
  /** The record, for a `"custom"` entry; `null` for the three built-ins. */
  readonly settings: CustomEffectSettings | null;
}

/**
 * Reaches the rendering service from a stack, for the tests that drive `sync` by hand.
 *
 * @param stack - The component.
 * @returns The service.
 *
 * @internal
 */
export function rendererOfStack(stack: PostProcessStack): RendererImpl {
  return rendererInternals(stack.app.renderer);
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function, not at module scope: a schema field is a function
 * call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4).
 */
function postProcessSchema(): Schema {
  return defineSchema({
    bloom: record(
      {
        enabled: bool(false, { tooltip: "Whether the glow pass runs." }),
        order: i32(0, { tooltip: "Position in the chain; lower runs first." }),
        weight: f32(0.15, { min: 0, tooltip: "How strongly the glow is mixed back in." }),
        kernel: u32(64, { min: 1, tooltip: "Blur kernel width, in pixels." }),
        threshold: f32(0.9, { min: 0, tooltip: "The luminance above which a pixel glows." }),
        exposure: f32(1, { min: 0, tooltip: "Exposure applied while extracting highlights." }),
        scale: f32(0.5, { min: 0.05, max: 1, tooltip: "Fraction of full resolution the blur runs at." }),
        intensity: f32(0.1, {
          min: 0,
          max: 1,
          tooltip: "HDR bloom only: how much glow is mixed into the frame.",
        }),
        radius: f32(0.7, {
          min: 0,
          max: 1,
          tooltip: "HDR bloom only: how far the glow spreads, from tight (0) to wide (1).",
        }),
        hdrThreshold: f32(0, {
          min: 0,
          tooltip: "HDR bloom only: linear luminance below which nothing glows; 0 lets every pixel glow by its energy.",
        }),
      },
      {
        tooltip:
          "Bloom. With rendering.hdr on, HDR bloom on the linear scene colour replaces the LDR pass and " +
          "reads intensity, radius and hdrThreshold; without it, the other fields apply.",
      },
    ),
    smaa: record(
      {
        enabled: bool(false, { tooltip: "Whether subpixel morphological anti-aliasing runs." }),
        order: i32(1, { tooltip: "Position in the chain; lower runs first." }),
        threshold: f32(0.05, { min: 0, max: 1, tooltip: "The luma difference that counts as an edge." }),
        maxSearchSteps: u32(16, { min: 1, tooltip: "How far the pattern search runs along an edge." }),
        diagonalDetection: bool(false, { tooltip: "Detect 45-degree patterns." }),
        cornerDetection: bool(false, { tooltip: "Attenuate corner patterns." }),
      },
      { tooltip: "SMAA anti-aliasing. Needs a single-sample source." },
    ),
    imageProcessing: record(
      {
        enabled: bool(false, { tooltip: "Whether a full-screen grading pass runs." }),
        order: i32(2, { tooltip: "Position in the chain; lower runs first." }),
      },
      { tooltip: "Exposure, contrast, and tone mapping as a pass — the alternative to Environment." },
    ),
    custom: array(
      record({
        shader: asset(ShaderAsset, { tooltip: "The .post.wgsl whose mainFragment runs full-screen." }),
        enabled: bool(true, { tooltip: "Whether the effect runs." }),
        order: i32(10, { tooltip: "Position in the chain; lower runs first." }),
        values: custom(postEffectValuesCodec(), {
          tooltip: "Overrides of the file's declared uniform defaults, by declared name.",
        }),
        textures: map(asset(TextureAsset), { tooltip: "Textures for the file's declared samplers." }),
      }),
      [],
      { tooltip: "Custom full-screen WGSL effects, ordered among the built-ins by order." },
    ),
    contactShadows: record(
      {
        enabled: bool(false, { tooltip: "Whether screen-space contact shadows run." }),
        intensity: f32(0.6, { min: 0, max: 4, tooltip: "How dark a contact gets." }),
        length: f32(0.3, { min: 0.001, tooltip: "How far each ray marches towards the light, in world units." }),
        thickness: f32(0.35, { min: 0.001, tooltip: "Assumed thickness behind each depth sample, in world units." }),
        samples: u32(8, { min: 1, max: 64, tooltip: "March steps per pixel." }),
      },
      {
        tooltip:
          "Short shadows where objects meet, towards the main directional light. Runs on the scene colour before the chain; needs rendering.features.postProcessing.",
      },
    ),
    ssgi: record(
      {
        enabled: bool(false, { tooltip: "Whether screen-space global illumination runs (beta, desktop tier)." }),
        intensity: f32(1, { min: 0, max: 4, tooltip: "How strongly the bounced light is added." }),
        radius: f32(2, { min: 0.001, tooltip: "How far each ray marches, in world units." }),
        samples: u32(8, { min: 1, max: 64, tooltip: "March steps per ray." }),
        halfResolution: bool(true, { tooltip: "Trace at half resolution. A change rebuilds the pass." }),
        environmentDiffuse: f32(0.5, {
          min: 0,
          max: 1,
          tooltip:
            "How much of the environment's diffuse light remains while SSGI runs, so the bounce is not counted twice. Needs rendering.hdr or the materialPlugins feature.",
        }),
      },
      {
        tooltip:
          "One bounce of the lit scene colour (beta, desktop tier). Runs on the scene colour before the chain; needs rendering.features.postProcessing.",
      },
    ),
  });
}
