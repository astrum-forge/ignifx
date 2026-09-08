import { Component } from "../component/component.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { setSceneFog, TONE_MAPPING_NAMES } from "../lite/gpu/environment.js";
import { Color } from "../math/color.js";
import { asset, bool, color, enumOf, f32, record } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { EnvironmentAsset } from "./environment-asset.js";
import {
  applyEnvironmentOrientation,
  applySceneImageProcessing,
  installLoadedEnvironment,
} from "./gpu/environment-install.js";
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
 * ## Switching environments at runtime
 *
 * An `.env` is loaded **onto the scene** by the asset loader, because that is the only shape Lite's
 * `loadEnvironment` has (`./environment-asset.ts` explains it at length). Until 2026-09-08 that
 * meant `environment` was effectively read-only after the first load: the component re-aimed what
 * the loader had installed and nothing more, so assigning a second loaded handle changed the
 * rotation and the blur and left the lighting alone. It now installs the asset's recorded handles
 * on the scene (`./gpu/environment-install.ts`) and reports the install as a **topology change**,
 * which the render-sync system coalesces into the frame's one `rebuildSceneRenderables` — the step
 * that makes every PBR material re-bind the new cube map, because a bind group holds the texture
 * view rather than the scene's slot. Two loaded handles can therefore be swapped back and forth for
 * free: the GPU resources belong to the assets, stay alive while their handles are retained, and are
 * released by the asset system exactly as before.
 *
 * Installing also re-applies rotation, blur, **and** image processing, because Lite's
 * `loadEnvironment` overwrites `scene.imageProcessing` (`toneMappingEnabled`, `exposure = 0.8`,
 * `contrast = 1.2`) as a side effect of every load.
 *
 * ## Assigning `null` leaves the scene lit
 *
 * Lite 1.27.0 has no inverse of `loadEnvironment` — no `unloadEnvironment`, no
 * `scene.environmentTexture` to clear — and clearing its slot by hand would leave every PBR
 * material bound to a cube map the scene no longer admits to having until the next renderable
 * rebuild. So `environment = null` is documented as "stop steering the environment", not "turn the
 * lights off": the last installed environment keeps lighting the scene, exactly as detaching the
 * component does. {@link Environment.installed} keeps naming it, because that is what the scene is
 * actually lit by. To change the lighting, install a different loaded environment.
 *
 * ## `skybox` is decided when the environment loads, not here
 *
 * Lite builds the background inside `loadEnvironment`, as a *feature-owned* `Renderable` pushed
 * onto the scene from a deferred builder that `registerScene` drains
 * (`lib/_chunks/env-helpers-*.js`). `Renderable` (`index.d.ts` 9678) is `{ order, isTransparent,
 * mesh?, bind }` — no visibility flag, no size, no handle — and Lite exposes no way to remove one,
 * so a background that has been built cannot be hidden, resized, or re-aimed at another cube map.
 * The `.environment.json` is therefore the authority: `skyboxEnabled`, `skybox` and `skyboxSize`
 * decide the background when the asset loads. The component's `skybox` record is read every frame
 * so that a value the installed environment cannot deliver is *reported* — `IGX-0711`, once per
 * component — rather than silently ignored, which is what it was until 2026-09-08. A field left at
 * its schema default never reports anything, so only a project that actually asked for a different
 * background hears about it.
 *
 * The one improvement that did fit: an environment with `skyboxEnabled` and no explicit `skybox`
 * now draws **its own** prefiltered cube map (`./loaders/environment-loader.ts`), where Lite's
 * default was a flat box painted in the clear colour. So a bare `.env` gets a real background, and
 * the component's default `skybox.enabled: true` agrees with it.
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
 * Whether a background is drawn, when nothing says otherwise. It matches the `.environment.json`
 * default (`skyboxEnabled`), which is what makes the ordinary case agree with itself.
 */
const SKYBOX_ENABLED_DEFAULT = true;

/** The background cube's default size in metres. It matches the file format's `skyboxSize`. */
const SKYBOX_SIZE_DEFAULT = 20;

/**
 * The `skybox` record an `Environment` declares (`docs/architecture/07-rendering.md` §2.5).
 *
 * @remarks
 * Babylon Lite 1.27.0 builds the background inside `loadEnvironment` and hands back no handle on
 * it, so both fields are decided when the environment **loads** and cannot be changed afterwards.
 * Declare them in the `.environment.json` (`skyboxEnabled`, `skyboxSize`); a component that asks
 * for something else logs `IGX-0711` once. The defaults match the file format's, so the ordinary
 * case is silent.
 *
 * @public
 */
export interface EnvironmentSkyboxSettings {
  /** Whether a background is drawn behind the scene. */
  enabled: boolean;
  /** The background cube's size, in metres. */
  size: number;
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
 * const env = world.createEntity("Environment").addComponent(Environment, {
 *   environment: studio.retain(),
 *   imageProcessing: { exposure: 1.2, contrast: 1, toneMapping: "aces" },
 * });
 * ```
 *
 * @example
 * Switching environments at runtime. Both handles stay retained, so switching back costs nothing.
 *
 * ```ts
 * const night = await app.assets.loadAsync<EnvironmentAsset>("environments/night.env");
 * env.environment = night.retain();
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

  declare skybox: EnvironmentSkyboxSettings;

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

  #trackedEnvironment: EnvironmentAsset | null = null;

  #installedEnvironment: EnvironmentAsset | null = null;

  #hasWarnedAboutSkybox = false;

  /**
   * The environment asset this component installed on the scene.
   *
   * @remarks
   * It stops at the **last installed** asset, which is what the scene is actually lit by: setting
   * `environment` back to `null` does not un-light the scene, because Lite has no inverse of
   * `loadEnvironment` (see the module remarks). Headless it names the asset too — what a headless
   * app skips is the cube map, not the bookkeeping.
   *
   * @returns The asset, or `null` when this component has never installed one.
   */
  get installed(): EnvironmentAsset | null {
    return this.#installedEnvironment;
  }

  /** Records that the component exists; the scene is written on the first sync. */
  onAttach(): void {
    this.#trackedEnvironment = null;
    this.#installedEnvironment = null;
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
    this.#trackedEnvironment = null;
    this.#installedEnvironment = null;
  }

  /**
   * Writes every field that changed onto the scene. The `PreRender` system calls it for the winning
   * environment only.
   *
   * @param renderer - The rendering service, for the scene and the headless flag.
   * @returns `true` when a different environment was installed on the scene this frame, which is a
   * topology change: the render-sync system owes the frame one `rebuildSceneRenderables` so that
   * every PBR material re-binds the new cube map.
   *
   * @internal
   */
  sync(renderer: RendererImpl): boolean {
    this.#applyClearColor(renderer);
    this.#applyFog(renderer);
    const installed = this.#applyEnvironment(renderer);
    this.#reportSkybox(renderer);
    this.#applyImageProcessing(renderer);
    return installed;
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
   * Installs a newly assigned environment on the scene, then applies its rotation and blur.
   *
   * @remarks
   * Three things happen only when the field moves to a *different* loaded asset, which is what
   * keeps the "write only what changed" discipline of `07-rendering.md` §2.2: the scene is pointed
   * at the asset's recorded Lite handles, the rotation and the blur are invalidated so they are
   * written against the new cube map, and the image-processing key is cleared — Lite's
   * `loadEnvironment` overwrote `scene.imageProcessing` while that asset was loading, so the
   * component's own exposure, contrast and curve have to be written again.
   *
   * A move to `null` is deliberately *not* an uninstall (see the module remarks): the field stops
   * steering, and the scene stays lit by whatever was installed last.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when the scene's environment slot moved this frame.
   */
  #applyEnvironment(renderer: RendererImpl): boolean {
    const loaded = this.environment?.state === "loaded" ? this.environment.value : null;
    let installed = false;
    if (loaded !== this.#trackedEnvironment) {
      this.#trackedEnvironment = loaded;
      if (loaded !== null && loaded !== this.#installedEnvironment) {
        this.#installedEnvironment = loaded;
        this.#appliedRotation = Number.NaN;
        this.#appliedBlur = Number.NaN;
        this.#appliedImageProcessing = "";
        this.#hasWarnedAboutSkybox = false;
        const textures = loaded.lite.textures;
        // A headless load produced none, and there is no scene slot to move: the asset is still
        // recorded, so `installed` answers.
        installed = textures !== null && installLoadedEnvironment(renderer.scene, textures);
      }
    }
    if (this.#installedEnvironment === null || renderer.isHeadless) {
      // The rotation and the blur are properties of the installed cube map, which a headless load
      // never produced.
      return installed;
    }
    if (this.#appliedRotation !== this.rotation || this.#appliedBlur !== this.blur) {
      this.#appliedRotation = this.rotation;
      this.#appliedBlur = this.blur;
      applyEnvironmentOrientation(renderer.scene, this.rotation, this.blur);
    }
    return installed;
  }

  /**
   * Says once, at warning level, that the `skybox` record asks for a background the installed
   * environment was not loaded with.
   *
   * @remarks
   * The field cannot be honoured here and this is not an oversight: Lite 1.27.0 builds the
   * background inside `loadEnvironment`, as a `Renderable` with no visibility flag, no size and no
   * handle, and offers nothing that removes or re-aims one (see the module remarks). So the record
   * is compared with what the installed asset's declaration actually delivered, and a disagreement
   * is reported rather than dropped.
   *
   * A field still sitting at its schema default is **not** a disagreement, whatever the declaration
   * says. Otherwise every project whose `.environment.json` turns the background off would be told
   * off for never having touched a component field, which is the opposite of actionable. The
   * warning therefore means "you asked for something and did not get it", never "these two numbers
   * differ".
   *
   * @param renderer - The rendering service, for the log sink.
   */
  #reportSkybox(renderer: RendererImpl): void {
    const installed = this.#installedEnvironment;
    if (installed === null || this.#hasWarnedAboutSkybox) {
      return;
    }
    const definition = installed.definition;
    const skybox = this.skybox;
    const askedForEnabled = skybox.enabled !== SKYBOX_ENABLED_DEFAULT && skybox.enabled !== definition.skyboxEnabled;
    const askedForSize = skybox.size !== SKYBOX_SIZE_DEFAULT && skybox.size !== definition.skyboxSize;
    if (!askedForEnabled && !askedForSize) {
      return;
    }
    this.#hasWarnedAboutSkybox = true;
    renderer.app.log.warn(
      `${CoreErrorCode.skyboxFixedAtLoad}: {entity} asks for skybox ` +
        "{requested}, but {asset} was loaded with {loaded} and Babylon Lite builds the background " +
        "when the environment loads, with no handle to change it afterwards. Declare skyboxEnabled " +
        "and skyboxSize in the .environment.json instead.",
      this.entity.name,
      `{ enabled: ${String(skybox.enabled)}, size: ${String(skybox.size)} }`,
      installed.address,
      `{ enabled: ${String(definition.skyboxEnabled)}, size: ${String(definition.skyboxSize)} }`,
    );
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
        enabled: bool(SKYBOX_ENABLED_DEFAULT, {
          tooltip: "Whether a skybox is drawn; set it in the .environment.json.",
        }),
        size: f32(SKYBOX_SIZE_DEFAULT, {
          min: 0.001,
          tooltip: "The skybox cube's size in metres; set it in the .environment.json.",
        }),
      },
      { tooltip: "The background, as the installed .environment.json declared it. Read-only in practice." },
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
