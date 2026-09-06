import { bool, createDefaults, defineSchema, f32, Quat, vec3, Vec3 } from "@ignifx/core";
import { UiErrorCode } from "../errors.js";
import {
  attachSceneText,
  createSceneText,
  destroySceneText,
  detachSceneText,
  moveSceneText,
  rotateSceneText,
  scaleSceneText,
} from "../lite/text.js";
import { TextComponent, textSchemaFields } from "./text-component.js";
import type { I18nService } from "../i18n/i18n-service.js";
import type { LiteTextRenderable } from "../lite/text.js";
import type { ComponentHooks, LiteScene, MutableQuat, MutableVec3, QuatLike, Schema, Vec3Like } from "@ignifx/core";

/**
 * `WorldText` (`docs/architecture/13-ui.md` §2): text that is part of the world — a sign, a
 * banner, a floating label that is hidden by the wall in front of it — drawn as a Babylon Lite
 * `TextRenderable` inside the render scene.
 *
 * ## Blocks are laid out in pixels, so the renderable is scaled down
 *
 * `createDefaultTextData` shapes in pixels: at `fontSize` 32 a capital letter is about 32 units
 * tall. A renderable at scale 1 would therefore be tens of metres high. {@link WorldText.pixelsPerUnit}
 * is the divisor, defaulting to 100 to match `@ignifx/2d`'s own default, so a 32-pixel block is
 * 0.32 m tall.
 *
 * ## It has to exist before `app.start()`
 *
 * `addTextRenderable` (`index.d.ts` 208) pushes a **deferred builder** onto the scene
 * (`lib/text/text-renderable.js` 242-249), and the only thing that drains those builders is
 * `buildScene`, which `registerScene` calls once (`lib/scene/scene-core.js` 228-241 and 246-262).
 * `rebuildSceneRenderables` — the one public rebuild — explicitly does not: it rebuilds *groups*
 * and returns early on an unbuilt scene, and Lite's runtime-build machinery is for meshes only. So
 * a renderable added after `app.start()` has registered the scene never materialises, and there is
 * no public call that would make it.
 *
 * A `WorldText` whose font and text are both present before the app starts therefore draws; one
 * that first gets its text mid-game does not, and says so once with `IGX-1308`. Until Lite exposes
 * a way to drain a late deferred renderable, the answers are to author signs in the scene file the
 * game starts with, or to use {@link WorldText2D}, which owns a text *layer* and can be added at
 * any time.
 *
 * ## Removal is one-way
 *
 * Babylon Lite 1.27.0 has `addTextRenderable` (`index.d.ts` 208) and **no inverse**:
 * `removeFromScene` (9613) accepts meshes, lights, cameras, shadow generators, transform nodes and
 * asset containers, and a `TextRenderable` is none of them. A destroyed `WorldText` therefore
 * empties its block and zeroes the renderable's opacity — it draws nothing and holds no GPU
 * buffers — but the record itself stays in the scene's renderable list until the scene is disposed.
 * A game that spawns and destroys thousands of signs should pool the components rather than the
 * entities. This is recorded as a Lite gap rather than worked around.
 */

/**
 * World-space 3D text.
 *
 * @example
 * ```ts
 * const sign = app.world.createEntity("sign").addComponent(WorldText);
 * sign.font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
 * sign.text = "Danger";
 * sign.billboard = true;
 * ```
 *
 * @public
 */
export class WorldText extends TextComponent implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/WorldText";

  /** One sign per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = worldTextSchema();

  /** A local offset added to the entity's world position, in metres. */
  declare offset: Vec3Like;

  /** How many pixels of laid-out text span one world metre. */
  declare pixelsPerUnit: number;

  /** Whether the text turns to face the camera instead of following the entity's rotation. */
  declare billboard: boolean;

  /** Whether the text draws through geometry in front of it. */
  declare alwaysOnTop: boolean;

  #renderable: LiteTextRenderable | null = null;

  #scene: LiteScene | null = null;

  readonly #position: MutableVec3 = new Vec3();

  readonly #rotation: MutableQuat = new Quat();

  /** Builds a sign with the schema's defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(WorldText.schema));
  }

  /**
   * The Babylon Lite objects the component owns. Unstable escape hatch.
   *
   * @returns The renderable, or `null` before the first frame that had a font and a string.
   */
  get lite(): { readonly renderable: LiteTextRenderable | null } {
    return { renderable: this.#renderable };
  }

  /** Silences and releases the renderable when the component goes away. */
  onDetach(): void {
    const renderable = this.#renderable;
    if (renderable !== null) {
      detachSceneText(renderable);
      destroySceneText(renderable);
      this.#renderable = null;
    }
    this.releaseBlock();
  }

  /**
   * Brings the renderable in line with the component's fields and the entity's transform.
   *
   * @param scene - The Lite scene the renderable is added to, from `app.lite.scene`.
   * @param i18n - The localization service, or `null`.
   * @param cameraRotation - The main camera's world rotation, for billboarding, or `null` when the
   * world has no camera.
   *
   * @internal
   */
  sync(scene: LiteScene, i18n: I18nService | null, cameraRotation: QuatLike | null): void {
    const change = this.syncBlock(i18n);
    const block = this.block;
    if (block === null) {
      const existing = this.#renderable;
      if (existing !== null) {
        detachSceneText(existing);
        destroySceneText(existing);
        this.#renderable = null;
      }
      return;
    }
    if (change === "created" || this.#renderable === null) {
      const previous = this.#renderable;
      if (previous !== null) {
        detachSceneText(previous);
        destroySceneText(previous);
      }
      const renderable = createSceneText(block, this.opacity);
      renderable.ignoreDepth = this.alwaysOnTop;
      attachSceneText(scene, renderable);
      this.#renderable = renderable;
      this.#scene = scene;
      this.#warnIfLate();
    }
    const renderable = this.#renderable;
    renderable.opacity = this.isEnabledInHierarchy ? this.opacity : 0;
    renderable.ignoreDepth = this.alwaysOnTop;
    const transform = this.transform;
    transform.positionToRef(this.#position);
    moveSceneText(
      renderable,
      this.#position.x + this.offset.x,
      this.#position.y + this.offset.y,
      this.#position.z + this.offset.z,
    );
    const rotation =
      this.billboard && cameraRotation !== null ? cameraRotation : transform.rotationToRef(this.#rotation);
    rotateSceneText(renderable, rotation.x, rotation.y, rotation.z, rotation.w);
    const divisor = this.pixelsPerUnit > 0 ? this.pixelsPerUnit : 1;
    scaleSceneText(renderable, 1 / divisor);
  }

  /**
   * Reports `IGX-1308` once when the renderable was built too late for Lite to draw it. See the
   * module's own remarks.
   */
  #warnIfLate(): void {
    const app = this.app;
    if (!app.isRunning || app.isHeadless) {
      return;
    }
    app.log.warnOnce(
      "ignifx/ui/world-text-late",
      `${WorldText.typeId} was given its text after app.start(), so Babylon Lite will not draw it ` +
        `(${UiErrorCode.sceneAlreadyBuilt}). Author the sign before starting, or use WorldText2D.`,
    );
  }

  /**
   * The scene the renderable was added to, for diagnostics.
   *
   * @returns The scene, or `null` when nothing has been added yet.
   *
   * @internal
   */
  get scene(): LiteScene | null {
    return this.#scene;
  }
}

/**
 * The `WorldText` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function worldTextSchema(): Schema {
  return defineSchema({
    ...textSchemaFields(),
    offset: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "A local offset added to the entity's position, in metres." }),
    pixelsPerUnit: f32(100, { min: 1, tooltip: "How many pixels of laid-out text span one metre." }),
    billboard: bool(false, { tooltip: "Turn the text to face the camera." }),
    alwaysOnTop: bool(false, { tooltip: "Draw through geometry in front of the text." }),
  });
}
