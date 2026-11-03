import type { ContactShadowsEffectSettings, SsgiEffectSettings } from "./post-process-stack.js";
import type { RendererImpl } from "./renderer.js";
import type { ContactShadowsPass } from "../lite/gpu/contact-shadows.js";
import type { InstalledSceneColorPasses, SceneColorPass } from "../lite/gpu/scene-color-passes.js";
import type { SceneInputs } from "../lite/gpu/scene-inputs.js";
import type { SsgiPass } from "../lite/gpu/ssgi.js";

/**
 * The `contactShadows` and `ssgi` records of a `PostProcessStack` (GI plan steps G10 and G11,
 * `docs/architecture/07-rendering.md` §2.7): the thin side that decides when to build, and the
 * lifecycle of what it built. Everything Lite does sits in chunks it imports only while one of the
 * two is enabled — `../lite/gpu/contact-shadows.ts`, `../lite/gpu/ssgi.ts`,
 * `../lite/gpu/scene-color-passes.ts` and the shared scene inputs — so a stack that enables neither
 * loads none of them (`CONSTITUTION.md` §2.5).
 *
 * What a recorded pass cannot change — which of the two run, SSGI's `halfResolution`, and the camera
 * Lite's tasks were created with — is the build's key; any change to it rebuilds. Everything else is
 * written onto the tasks every frame.
 */

/** What one build holds. */
interface Built {
  readonly inputs: SceneInputs;
  readonly installed: InstalledSceneColorPasses;
  readonly contact: ContactShadowsPass | null;
  readonly ssgi: SsgiPass | null;
}

/** Numbers each Lite camera object, so the key can name it. */
let cameraIds: WeakMap<object, number> | null = null;

/** The next camera number. */
let nextCameraId = 1;

/**
 * The scene-colour effects of one `PostProcessStack`.
 *
 * @internal
 */
export class ScreenSpaceEffects {
  /** The key the current (or pending) build was started for; `""` when nothing should run. */
  #key = "";

  /** Bumped by every new build and by dispose, so a superseded async build cleans up after itself. */
  #generation = 0;

  #built: Built | null = null;

  /**
   * Whether a build is live.
   *
   * @returns `true` once the passes are in the frame graph.
   */
  get isBuilt(): boolean {
    return this.#built !== null;
  }

  /**
   * How many frame-graph tasks the passes added.
   *
   * @returns The count, `0` while nothing is built.
   */
  get taskCount(): number {
    return this.#built?.installed.taskCount ?? 0;
  }

  /**
   * Builds, rebuilds or tears down the passes to match the records, then pushes the live tuning.
   * Called from the stack's `sync` every `PreRender`.
   *
   * @param renderer - The rendering service.
   * @param contact - The `contactShadows` record.
   * @param ssgi - The `ssgi` record.
   * @param isEnabled - Whether the stack is enabled in the hierarchy.
   */
  sync(
    renderer: RendererImpl,
    contact: ContactShadowsEffectSettings,
    ssgi: SsgiEffectSettings,
    isEnabled: boolean,
  ): void {
    // A `rendering.quality` tier below the effect's own switches it off (`./rendering-settings.ts`).
    const tier = renderer.qualityPreset;
    const runsContact = contact.enabled && (tier === null || tier.contactShadows);
    const runsSsgi = ssgi.enabled && (tier === null || tier.ssgi);
    const key = buildKey(renderer, runsContact, runsSsgi, ssgi.halfResolution, isEnabled);
    if (key !== this.#key) {
      this.#key = key;
      this.#teardown(renderer.isSceneRegistered);
      if (key !== "") {
        this.#build(renderer, runsContact ? contact : null, runsSsgi ? ssgi : null, this.#generation).catch(
          (failure: unknown) => {
            renderer.app.log.error(
              `PostProcessStack could not build contact shadows or SSGI: ${failure instanceof Error ? failure.message : String(failure)}`,
            );
          },
        );
      }
      return;
    }
    const built = this.#built;
    if (built === null) {
      return;
    }
    built.contact?.update(contact);
    built.ssgi?.update(ssgi, renderer.isSceneRegistered);
  }

  /**
   * Removes everything, and stops a build in flight.
   *
   * @param isSceneRegistered - Whether materials the SSGI plugin leaves must be rebuilt.
   */
  dispose(isSceneRegistered: boolean): void {
    this.#key = "";
    this.#teardown(isSceneRegistered);
  }

  /**
   * Frees the current build and invalidates any pending one.
   *
   * @param isSceneRegistered - Whether materials the SSGI plugin leaves must be rebuilt.
   */
  #teardown(isSceneRegistered: boolean): void {
    this.#generation += 1;
    const built = this.#built;
    this.#built = null;
    if (built === null) {
      return;
    }
    built.ssgi?.dispose(isSceneRegistered);
    built.installed.dispose();
    built.inputs.release();
  }

  /**
   * Loads the chunks, leases the scene inputs, and installs the passes.
   *
   * @param renderer - The rendering service.
   * @param contact - The `contactShadows` record, or `null` when it does not run.
   * @param ssgi - The `ssgi` record, or `null` when it does not run.
   * @param generation - The generation this build belongs to.
   */
  async #build(
    renderer: RendererImpl,
    contact: ContactShadowsEffectSettings | null,
    ssgi: SsgiEffectSettings | null,
    generation: number,
  ): Promise<void> {
    const [inputs, wiring, contactModule, ssgiModule] = await Promise.all([
      renderer.acquireSceneInputs(),
      import("../lite/gpu/scene-color-passes.js"),
      contact === null ? null : import("../lite/gpu/contact-shadows.js"),
      ssgi === null ? null : import("../lite/gpu/ssgi.js"),
    ]);
    const presenter = renderer.presenter;
    const camera = renderer.isHeadless ? null : renderer.scene.camera;
    if (generation !== this.#generation || inputs === null || presenter === null || camera === null) {
      inputs?.release();
      return;
    }
    const { engine, scene } = renderer;
    const passes: SceneColorPass[] = [];
    const contactPass =
      contact === null
        ? null
        : (contactModule?.createContactShadowsPass(engine, scene, inputs.depthTarget, camera, contact) ?? null);
    if (contactPass !== null) {
      passes.push(contactPass);
    }
    const ssgiPass =
      ssgi === null
        ? null
        : (ssgiModule?.createSsgiPass(engine, scene, inputs.depthTarget, camera, {
            tuning: ssgi,
            halfResolution: ssgi.halfResolution,
            usePlugin: renderer.settings.hdr || renderer.features.materialPlugins,
          }) ?? null);
    if (ssgiPass !== null) {
      passes.push(ssgiPass);
    }
    const installed = wiring.installSceneColorPasses(engine, scene, presenter, passes, renderer.isSceneRegistered);
    this.#built = { inputs, installed, contact: contactPass, ssgi: ssgiPass };
    if (contact !== null) {
      contactPass?.update(contact);
    }
    if (ssgi !== null) {
      ssgiPass?.update(ssgi, renderer.isSceneRegistered);
    }
  }
}

/**
 * The build's identity: which passes run, SSGI's resolution, and the camera; `""` for none.
 *
 * @param renderer - The rendering service.
 * @param runsContact - Whether contact shadows run.
 * @param runsSsgi - Whether SSGI runs.
 * @param ssgiHalf - SSGI's `halfResolution`.
 * @param isEnabled - Whether the stack is enabled in the hierarchy.
 * @returns The key.
 */
function buildKey(
  renderer: RendererImpl,
  runsContact: boolean,
  runsSsgi: boolean,
  ssgiHalf: boolean,
  isEnabled: boolean,
): string {
  if (!isEnabled || (!runsContact && !runsSsgi) || renderer.isHeadless || renderer.presenter === null) {
    return "";
  }
  const camera = renderer.scene.camera;
  if (camera === null) {
    return "";
  }
  cameraIds ??= new WeakMap();
  let id = cameraIds.get(camera);
  if (id === undefined) {
    id = nextCameraId;
    nextCameraId += 1;
    cameraIds.set(camera, id);
  }
  const gi = runsSsgi ? `ssgi:${ssgiHalf ? "half" : "full"}` : "";
  return `${runsContact ? "contact" : ""}|${gi}|camera:${String(id)}`;
}
