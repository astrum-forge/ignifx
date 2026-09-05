import { Component } from "../component/component.js";
import { setSceneFog, TONE_MAPPING_NAMES } from "../lite/gpu/environment.js";
import { Color } from "../math/color.js";
import { asset, bool, color, enumOf, f32, record } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { EnvironmentAsset } from "./environment-asset.js";
import { applyEnvironmentOrientation, applySceneImageProcessing } from "./gpu/environment-install.js";
import type { RendererImpl } from "./renderer.js";
import type { AssetHandle } from "../assets/types.js";
import type { ComponentHooks } from "../component/component.js";
import type { FogMode, ToneMappingName, FOG_MODES } from "../lite/gpu/environment.js";
import type { ColorLike } from "../math/types.js";
import type { Schema } from "../schema/types.js";

/**
 * The `Environment` component (`docs/architecture/07-rendering.md` §2.5): image based lighting, the
 * skybox, fog, image processing, and the clear colour — one per world.
 *
 * ## Why the second one wins
 *
 * Every field here is *scene* state: Lite has one `scene.fog`, one `scene.clearColor`, one
 * environment. §2.5 says "the most recently enabled wins" and asks for a warning on the second, so
 * the `PreRender` system picks the enabled `Environment` with the highest creation serial, logs
 * `IGX-0705` once per world while more than one is enabled, and applies only that one. Disabling
 * the winner hands the world back to the previous one on the next frame.
 *
 * ## Image processing is asynchronous, and must not block the frame
 *
 * `setSceneImageProcessing` is async because tone mapping is compiled into the PBR shaders and
 * changing it recompiles the scene's PBR pipelines (`src/lite/gpu/environment.ts`). A `PreRender`
 * system cannot await that. So the component fires the call, keeps the promise, and refuses to fire
 * a second one until the first has settled; a failure is reported through `app.onError` rather than
 * becoming an unhandled rejection (coding standards §8). The visible consequence is that a script
 * that ramps exposure every frame gets as many recompiles as the GPU can keep up with and no queue.
 *
 * ## `ambientColor` does not exist
 *
 * §2.5 lists an `ambientColor` field. Babylon Lite 1.27.0 has no scene-level ambient term:
 * `ambientColor` appears once in `index.d.ts`, on `StandardMaterialProps`, and `SceneContext`
 * declares nothing of the kind. A field that mapped onto nothing would serialise into save files
 * and quietly start mattering when the mapping appeared, so the component does not declare one. The
 * flat term a project wants from it is a hemispheric `Light`, which Lite does have.
 *
 * ## Headless
 *
 * Fog, the clear colour, and the rotation are plain scene state and are applied under the null
 * engine too. Anything that needs the cube map — the environment textures, the skybox, image
 * processing — is skipped (`07-rendering.md` §6).
 */

/** The fog modes an environment can declare, in the order §2.5 lists them. */
/**
 * The `as const` name table behind the public union of the same name.
 *
 * @public
 */
export const FOG_MODE_NAMES = ["none", "linear", "exp", "exp2"] as const;

/**
 * The union of the fog modes.
 *
 * @public
 */
export type EnvironmentFogMode = (typeof FOG_MODE_NAMES)[number];

/**
 * The union of the tone-mapping curves.
 *
 * @public
 */
export type ToneMappingCurve = (typeof TONE_MAPPING_NAMES)[number];

/**
 * The `fog` record an `Environment` declares (`docs/architecture/07-rendering.md` §2.5).
 *
 * @public
 */
export interface EnvironmentFogSettings {
  /** The falloff, or `"none"` to disable fog. */
  mode: EnvironmentFogMode;
  /** The fog's sRGB colour. */
  color: ColorLike;
  /** Density, for the exponential modes. */
  density: number;
  /** Where linear fog begins, in metres. */
  start: number;
  /** Where linear fog reaches full strength, in metres. */
  end: number;
}

/**
 * The `imageProcessing` record an `Environment` declares
 * (`docs/architecture/07-rendering.md` §2.5).
 *
 * @public
 */
export interface ImageProcessingSettings {
  /** Exposure multiplier. */
  exposure: number;
  /** Contrast multiplier. */
  contrast: number;
  /** The tone-mapping curve. */
  toneMapping: ToneMappingCurve;
}

/**
 * The world's lighting environment (`docs/architecture/07-rendering.md` §2.5).
 *
 * @example
 * ```ts
 * const studio = await app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
 * world.createEntity("Environment").addComponent(Environment, {
 *   environment: studio.retain(),
 *   imageProcessing: { exposure: 1.2, contrast: 1, toneMapping: "aces" },
 * });
 * ```
 *
 * @public
 */
export class Environment extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/Environment";

  /** One per entity, and effectively one per world: the fields are all scene state. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = environmentSchema();

  declare environment: AssetHandle<EnvironmentAsset> | null;

  declare rotation: number;

  declare blur: number;

  declare skybox: { enabled: boolean; size: number };

  declare fog: EnvironmentFogSettings;

  declare imageProcessing: ImageProcessingSettings;

  declare clearColor: ColorLike;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Environment.schema));
  }

  #appliedRotation = Number.NaN;

  #appliedBlur = Number.NaN;

  #appliedFog = "";

  #appliedClearColor = "";

  #appliedImageProcessing = "";

  #imageProcessingInFlight = false;

  #appliedEnvironment: EnvironmentAsset | null = null;

  /**
   * The environment asset this component installed, once it has loaded.
   *
   * @returns The asset, or `null` when none is loaded.
   */
  get installed(): EnvironmentAsset | null {
    return this.#appliedEnvironment;
  }

  /** Records that the component exists; the scene is written on the first sync. */
  onAttach(): void {
    this.#appliedEnvironment = null;
  }

  /**
   * Leaves the scene as it is.
   *
   * @remarks
   * Lite offers no "unload environment": `loadEnvironment` installs textures and a skybox and has
   * no inverse. Rather than pretend otherwise, removing an `Environment` leaves what it installed
   * in place until another one replaces it — which is also what "the most recently enabled wins"
   * implies. The `PreRender` system re-picks the winner on the next frame.
   */
  onDetach(): void {
    this.#appliedEnvironment = null;
  }

  /**
   * Writes every field that changed onto the scene. The `PreRender` system calls it for the winning
   * environment only.
   *
   * @param renderer - The rendering service, for the scene and the headless flag.
   *
   * @internal
   */
  sync(renderer: RendererImpl): void {
    this.#applyClearColor(renderer);
    this.#applyFog(renderer);
    this.#applyEnvironment(renderer);
    this.#applyImageProcessing(renderer);
  }

  /**
   * Writes the clear colour, decoded to linear.
   *
   * @remarks
   * Only when the field changed, which is what leaves the `rendering.clearColor` setting standing
   * in a world whose `Environment` never touches its own — and what keeps the main camera's
   * override, written every frame, on top of this one (`RendererImpl.applyClearColor`).
   *
   * @param renderer - The rendering service, for the scene.
   */
  #applyClearColor(renderer: RendererImpl): void {
    const key = colorKey(this.clearColor);
    if (key === this.#appliedClearColor) {
      return;
    }
    this.#appliedClearColor = key;
    renderer.applyClearColor(this.clearColor);
  }

  /**
   * Writes the fog record, decoded to linear.
   *
   * @param renderer - The rendering service, for the scene.
   */
  #applyFog(renderer: RendererImpl): void {
    const fog = this.fog;
    const key = `${fog.mode}|${colorKey(fog.color)}|${String(fog.density)}|${String(fog.start)}|${String(fog.end)}`;
    if (key === this.#appliedFog) {
      return;
    }
    this.#appliedFog = key;
    setSceneFog(
      renderer.scene,
      toFogMode(fog.mode),
      Color.srgbToLinear(fog.color.r),
      Color.srgbToLinear(fog.color.g),
      Color.srgbToLinear(fog.color.b),
      fog.density,
      fog.start,
      fog.end,
    );
  }

  /**
   * Applies the loaded environment's rotation and blur, and records which asset is installed.
   *
   * @param renderer - The rendering service, for the scene.
   */
  #applyEnvironment(renderer: RendererImpl): void {
    const loaded = this.environment?.state === "loaded" ? this.environment.value : null;
    if (loaded !== this.#appliedEnvironment) {
      this.#appliedEnvironment = loaded;
      this.#appliedRotation = Number.NaN;
      this.#appliedBlur = Number.NaN;
    }
    if (loaded === null || renderer.isHeadless) {
      // The rotation and the blur are properties of the installed cube map, which a headless load
      // never produced; the asset is still recorded, so `installed` answers.
      return;
    }
    if (this.#appliedRotation !== this.rotation || this.#appliedBlur !== this.blur) {
      this.#appliedRotation = this.rotation;
      this.#appliedBlur = this.blur;
      applyEnvironmentOrientation(renderer.scene, this.rotation, this.blur);
    }
  }

  /**
   * Fires the asynchronous image-processing update, at most one at a time.
   *
   * @param renderer - The rendering service, for the scene and the error sink.
   */
  #applyImageProcessing(renderer: RendererImpl): void {
    const settings = this.imageProcessing;
    const key = `${String(settings.exposure)}|${String(settings.contrast)}|${settings.toneMapping}`;
    if (key === this.#appliedImageProcessing || this.#imageProcessingInFlight) {
      return;
    }
    this.#appliedImageProcessing = key;
    if (renderer.isHeadless) {
      // Tone mapping is compiled into the PBR shaders; there are none without a device.
      return;
    }
    this.#imageProcessingInFlight = true;
    const curve: ToneMappingName = settings.toneMapping;
    void applySceneImageProcessing(renderer.scene, settings.exposure, settings.contrast, curve)
      .catch((error: unknown): void => {
        renderer.app.onError.emit({
          error,
          source: "system",
          phase: null,
          entity: this.entity,
          component: this,
        });
      })
      .finally((): void => {
        this.#imageProcessingInFlight = false;
      });
  }
}

/**
 * Maps the component's fog mode name onto the adapter's.
 *
 * @remarks
 * They differ by one name: `07-rendering.md` §2.5 spells the modes
 * `"none" | "linear" | "exp" | "exp2"`, and the adapter's table is keyed the same way
 * (`FOG_MODES`), so the mapping is the identity — stated explicitly so a rename on either side
 * fails to compile instead of silently picking mode `0`.
 *
 * @param mode - The declared mode.
 * @returns The adapter's mode name.
 */
function toFogMode(mode: EnvironmentFogMode): FogMode {
  return mode satisfies keyof typeof FOG_MODES;
}

/**
 * A colour's change key.
 *
 * @param value - The colour.
 * @returns The key.
 */
function colorKey(value: ColorLike): string {
  return `${String(value.r)},${String(value.g)},${String(value.b)},${String(value.a)}`;
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function, not at module scope: a schema field is a function
 * call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4).
 */
function environmentSchema(): Schema {
  return defineSchema({
    environment: asset(EnvironmentAsset, { tooltip: "The .env image-based lighting to install." }),
    rotation: f32(0, { tooltip: "Rotation of the environment around world Y, in degrees." }),
    blur: f32(0, { min: 0, max: 1, tooltip: "How blurred the specular reflection is." }),
    skybox: record(
      {
        enabled: bool(true, { tooltip: "Whether a skybox is drawn behind the scene." }),
        size: f32(20, { min: 0.001, tooltip: "The skybox cube's size, in metres." }),
      },
      { tooltip: "The background the environment draws." },
    ),
    fog: record(
      {
        mode: enumOf(FOG_MODE_NAMES, "none", { tooltip: "Fog falloff, or none." }),
        color: color("#c8c8c8", { tooltip: "The fog's sRGB colour." }),
        density: f32(0.01, { min: 0, tooltip: "Density, for the exponential modes." }),
        start: f32(10, { min: 0, tooltip: "Where linear fog begins, in metres." }),
        end: f32(100, { min: 0, tooltip: "Where linear fog reaches full strength, in metres." }),
      },
      { tooltip: "Distance fog." },
    ),
    imageProcessing: record(
      {
        exposure: f32(1, { min: 0, tooltip: "Exposure multiplier." }),
        contrast: f32(1, { min: 0, tooltip: "Contrast multiplier." }),
        toneMapping: enumOf(TONE_MAPPING_NAMES, "none", { tooltip: "The tone-mapping curve." }),
      },
      { tooltip: "Exposure, contrast, and tone mapping. Recompiles PBR pipelines when it changes." },
    ),
    clearColor: color("#000000", { tooltip: "The colour the scene is cleared to, in sRGB." }),
  });
}
