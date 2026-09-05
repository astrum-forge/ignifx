import { Component } from "../component/component.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { bool, f32, i32, record, u32 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { PostProcessChain } from "./gpu/post-process-chain.js";
import { rendererInternals } from "./renderer.js";
import type { PostProcessEffectRequest } from "./gpu/post-process-chain.js";
import type { RendererImpl } from "./renderer.js";
import type { ComponentHooks } from "../component/component.js";
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
 * cost is that adding a fourth effect in Phase 7 adds a fourth record rather than a new list entry;
 * that is a schema addition, which the format already tolerates.
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
 * ## The one Lite limit this component still inherits
 *
 * **Nothing can be removed from a frame graph.** `executionEnabled = false` is the substitute, so
 * disabling an effect leaves its GPU resources allocated and costs one branch per frame. The
 * component disposes them at detach. Resizing, by contrast, is free: every target is sized by the
 * surface and reallocated by the frame-graph rebuild a resize triggers.
 */

/**
 * The `bloom` record a `PostProcessStack` declares (`docs/architecture/07-rendering.md` §2.7).
 *
 * @public
 */
export interface BloomEffectSettings {
  /** Whether the glow pass runs. */
  enabled: boolean;
  /** Position in the chain; lower runs first. */
  order: number;
  /** How strongly the glow is mixed back in. */
  weight: number;
  /** The blur kernel width, in pixels. */
  kernel: number;
  /** The luminance above which a pixel glows. */
  threshold: number;
  /** An exposure applied while extracting highlights. */
  exposure: number;
  /** The fraction of full resolution the blur runs at. */
  scale: number;
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
 * One instance of a post-process chain, attached to the main camera's entity
 * (`docs/architecture/07-rendering.md` §2.7).
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

  /** One chain per camera entity; a second would fight the first for the swapchain. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = postProcessSchema();

  declare bloom: BloomEffectSettings;

  declare smaa: SmaaEffectSettings;

  declare imageProcessing: ImageProcessingEffectSettings;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(PostProcessStack.schema));
  }

  #chain: PostProcessChain | null = null;

  #built = "";

  #hasWarnedAboutFeature = false;

  /**
   * How many frame-graph tasks the stack has recorded.
   *
   * @returns The task count; `0` before the chain is built, under a headless app, and when the
   * `postProcessing` rendering feature is off.
   */
  get taskCount(): number {
    return this.#chain?.taskCount ?? 0;
  }

  /** Nothing to do at attach: the chain is built on the first sync that wants an effect. */
  onAttach(): void {
    this.#built = "";
    this.#hasWarnedAboutFeature = false;
  }

  /** Disables and disposes every task the stack recorded. */
  onDetach(): void {
    const chain = this.#chain;
    this.#chain = null;
    this.#built = "";
    chain?.dispose();
  }

  /**
   * Builds the chain the first time any effect is enabled, and switches individual effects on and
   * off after that. The `PreRender` system calls it.
   *
   * @param renderer - The rendering service, for the engine and the scene.
   *
   * @internal
   */
  sync(renderer: RendererImpl): void {
    const wanted = this.#chainKey();
    if (wanted !== this.#built && this.#chain === null) {
      this.#built = wanted;
      // The request list is the component's own state, so it is built whether or not there is a
      // device to record it into; only the recording is device-only.
      const requests = this.#requests(renderer.settings.srgb);
      const presenter = renderer.presenter;
      if (!renderer.isHeadless && presenter !== null) {
        this.#chain = new PostProcessChain(renderer.engine, renderer.scene, presenter, requests);
      }
      this.#warnAboutFeature(renderer, requests.length);
      return;
    }
    this.#warnAboutFeature(renderer, this.plannedChain().length);
    this.#chain?.setEnabled(this.isEnabledInHierarchy);
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
   * @param sourceIsSrgb - Whether the chain's input is an sRGB target, which decides where the
   * image-processing effect converts.
   * @returns The requests the frame-graph half records.
   */
  #requests(sourceIsSrgb: boolean): readonly PostProcessEffectRequest[] {
    const requests: PostProcessEffectRequest[] = [];
    for (const entry of this.#entries()) {
      if (entry.enabled) {
        requests.push({ name: entry.name, bloom: this.bloom, smaa: this.smaa, sourceIsSrgb });
      }
    }
    return requests;
  }

  /**
   * The chain the fields currently ask for, as an ordered list of effect names. It is what
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
   * The identity of the chain the fields currently ask for: which effects are on, in which order.
   * A change to it while the chain already exists only flips `executionEnabled`, because Lite
   * cannot re-order a recorded frame graph.
   *
   * @returns The key.
   */
  #chainKey(): string {
    return this.plannedChain().join(",");
  }

  /**
   * The three effect records, as a uniform list ordered by their `order` fields.
   *
   * @returns The entries, first to last.
   */
  #entries(): readonly {
    readonly name: "bloom" | "smaa" | "imageProcessing";
    readonly enabled: boolean;
    readonly order: number;
  }[] {
    const entries = [
      { name: "bloom", enabled: this.bloom.enabled, order: this.bloom.order },
      { name: "smaa", enabled: this.smaa.enabled, order: this.smaa.order },
      { name: "imageProcessing", enabled: this.imageProcessing.enabled, order: this.imageProcessing.order },
    ] as const;
    return entries.toSorted((left, right) => left.order - right.order);
  }
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
      },
      { tooltip: "Bloom." },
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
  });
}
