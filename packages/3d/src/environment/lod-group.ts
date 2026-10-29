import {
  array,
  Component,
  componentRef,
  createDefaults,
  defineSchema,
  f32,
  MeshRenderer,
  record,
  Signal,
} from "@ignifx/core";
import { mainCamera } from "../camera/main-camera.js";
import { ThreeDErrorCode } from "../errors.js";
import type { ComponentHooks, Schema, System, SystemContext } from "@ignifx/core";

/**
 * `LodGroup` (`docs/architecture/12-3d-toolkit.md` §6): distance-based `MeshRenderer` switching.
 *
 * Babylon Lite has no automatic level of detail, so this is the whole mechanism: a list of levels,
 * each a renderer and the distance beyond which it takes over, evaluated once per frame in
 * `PreRender` against the main camera. Exactly one level's renderer is enabled at a time; past the
 * last level's distance every one of them is off, which is how a group culls itself entirely.
 *
 * ## Edit mode
 *
 * The switch writes `MeshRenderer.enabled`, which scene files save, and an editor's camera moving
 * must not change the document (ADR-0028). So in an edit-mode app the switch is display-only
 * (spike S0.7 §5): the group picks its level from the main camera, which there is the editor's,
 * exactly as in a game, but hides the other levels with `MeshRenderer.displayHidden`, which is not
 * saved. Every level keeps its authored `enabled`, a level the group shows still draws only if it
 * is enabled, and a group that is removed or disabled shows every level again.
 *
 * ## One group per renderer
 *
 * `displayHidden` is one flag, not a count, so a renderer has one owner: the `LodGroup` that lists
 * it as a level. Nothing else in the engine writes it. If two groups list the same renderer, the
 * first to claim it keeps it, and the other warns once with `IGX-1217` and leaves that renderer
 * alone, so the two never undo each other's hides. When the owner lets go (it is removed, disabled,
 * or drops the level), the other group claims the renderer on its next frame. A per-owner count
 * would let both groups hide it, but no second writer exists, and two groups switching one renderer
 * is a scene mistake in a game too, where both write its `enabled`.
 *
 * ## Hysteresis
 *
 * A camera sitting exactly on a threshold would otherwise flip a renderer on and off every frame,
 * which is both visible and expensive. {@link LodGroup.hysteresis} widens each threshold in the
 * direction the camera is *not* moving: a level that is already showing keeps showing until the
 * camera is a little further past the boundary than it took to get there.
 */

/**
 * The level index meaning "past the last level; draw nothing".
 *
 * @public
 */
export const LOD_CULLED = -1;

/** Which group owns each renderer it switches for display; created on first use, not at import. */
let displayOwners: WeakMap<MeshRenderer, LodGroup> | null = null;

/**
 * The display-owner table, created on first use.
 *
 * @returns The table.
 */
function owners(): WeakMap<MeshRenderer, LodGroup> {
  return (displayOwners ??= new WeakMap<MeshRenderer, LodGroup>());
}

/**
 * One level of detail.
 *
 * @public
 */
export interface LodLevel {
  /** The distance from the camera, in metres, beyond which this level takes over. */
  readonly distance: number;
  /** The renderer this level draws. */
  readonly renderer: MeshRenderer | null;
}

/**
 * Builds the `LodGroup` field declarations.
 *
 * @returns The schema.
 */
function lodGroupSchema(): Schema {
  return defineSchema({
    levels: array(
      record({
        distance: f32(10, { min: 0, tooltip: "Beyond this distance, in metres, the level takes over." }),
        renderer: componentRef(MeshRenderer, { tooltip: "The renderer this level draws." }),
      }),
      [],
      { tooltip: "The levels, nearest first." },
    ),
    hysteresis: f32(0.1, { min: 0, max: 1, tooltip: "How far past a threshold a switch waits, as a fraction." }),
  });
}

/**
 * A distance-based renderer switch.
 *
 * @example
 * ```ts
 * const group = tree.addComponent(LodGroup, {
 *   levels: [
 *     { distance: 20, renderer: highDetail },
 *     { distance: 60, renderer: lowDetail },
 *   ],
 * });
 * group.onLevelChanged.connect((level) => app.log.debug("LOD level:", level), { owner: group });
 * ```
 *
 * @public
 */
export class LodGroup extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/LodGroup";

  /** One group per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = lodGroupSchema();

  /** The levels, nearest first. */
  declare levels: LodLevel[];

  /** How far past a threshold a switch waits, as a fraction of the threshold. */
  declare hysteresis: number;

  #level = LOD_CULLED;

  /** The renderers this group owns for display in an edit-mode app, so it can show them again. */
  readonly #owned: MeshRenderer[] = [];

  /** Level renderers another group owns, so this one can claim them once that group lets go. */
  readonly #contested: MeshRenderer[] = [];

  /** Each level's renderer when the display was last applied, to notice an edited level list. */
  readonly #displayed: (MeshRenderer | null)[] = [];

  /** The renderer shown when the display was last applied. */
  #shown: MeshRenderer | null = null;

  readonly #onLevelChanged: Signal<number> = new Signal<number>();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(LodGroup.schema));
  }

  /**
   * Fires with the new level index each time the group switches; `-1` means culled.
   *
   * @returns Fires with the new level index each time the group switches; `-1` means culled.
   */
  get onLevelChanged(): Signal<number> {
    return this.#onLevelChanged;
  }

  /**
   * Which level is showing, or `-1` when the group is past its last threshold.
   *
   * @returns Which level is showing, or `-1` when the group is past its last threshold.
   */
  get level(): number {
    return this.#level;
  }

  /**
   * Turns every level off, so a removed group leaves nothing drawn. In an edit-mode app it leaves
   * `enabled` as authored, because scene files save it, and shows again the levels it hid for
   * display.
   */
  onDetach(): void {
    this.#level = LOD_CULLED;
    if (this.app.isEditMode) {
      this.releaseDisplay();
      return;
    }
    for (const level of this.levels) {
      const renderer = level.renderer;
      if (renderer !== null && !renderer.isDestroyed) {
        renderer.enabled = false;
      }
    }
  }

  /**
   * Chooses the level for a distance and enables exactly that renderer; in an edit-mode app it
   * hides the others for display instead and leaves `enabled` alone.
   *
   * @param distance - How far the camera is from the group, in metres.
   *
   * @internal
   */
  evaluate(distance: number): void {
    const next = this.#pick(distance);
    if (next !== this.#level) {
      this.#level = next;
      this.#onLevelChanged.emit(next);
    }
    const levels = this.levels;
    if (this.app.isEditMode) {
      this.#display(levels[next]?.renderer ?? null);
      return;
    }
    for (let index = 0; index < levels.length; index += 1) {
      const renderer = levels[index]?.renderer ?? null;
      if (renderer !== null && !renderer.isDestroyed) {
        renderer.enabled = index === next;
      }
    }
  }

  /**
   * Shows again every renderer this group hid for display. The LOD system calls it for a group that
   * is not enabled in the hierarchy; it does nothing outside an edit-mode app, where nothing is
   * hidden that way.
   *
   * @internal
   */
  releaseDisplay(): void {
    const owned = this.#owned;
    const table = owners();
    for (let index = 0; index < owned.length; index += 1) {
      const renderer = owned[index];
      if (renderer === undefined) {
        continue;
      }
      if (table.get(renderer) === this) {
        table.delete(renderer);
      }
      if (!renderer.isDestroyed) {
        renderer.displayHidden = false;
      }
    }
    owned.length = 0;
    this.#contested.length = 0;
    this.#displayed.length = 0;
    this.#shown = null;
  }

  /**
   * Hides for display every level's renderer but the one shown, and shows again any it hid before
   * that is no longer a level, so an edited level list leaves nothing hidden behind. A renderer
   * another group owns is left alone (`IGX-1217`). It writes only when the shown renderer or the
   * level list changed since the last call, or a renderer another group owned has been let go.
   *
   * @param shown - The chosen level's renderer, or `null` when the group is culled.
   */
  #display(shown: MeshRenderer | null): void {
    if (shown === this.#shown && this.#displayed.length > 0 && this.#isDisplayed() && this.#isStillContested()) {
      return;
    }
    this.releaseDisplay();
    this.#shown = shown;
    const table = owners();
    const levels = this.levels;
    for (let index = 0; index < levels.length; index += 1) {
      const renderer = levels[index]?.renderer ?? null;
      this.#displayed.push(renderer);
      if (renderer === null || renderer.isDestroyed) {
        continue;
      }
      const owner = table.get(renderer);
      if (owner !== undefined && owner !== this && !owner.isDestroyed) {
        this.#contested.push(renderer);
        this.#warnShared(renderer, owner);
        continue;
      }
      if (owner !== this) {
        table.set(renderer, this);
        this.#owned.push(renderer);
      }
      if (renderer !== shown) {
        renderer.displayHidden = true;
      }
    }
  }

  /**
   * Whether every level renderer another group owned at the last display is still owned by one.
   *
   * @returns `false` once one of them has been let go, so this group can claim it.
   */
  #isStillContested(): boolean {
    const contested = this.#contested;
    const table = owners();
    for (let index = 0; index < contested.length; index += 1) {
      const renderer = contested[index];
      const owner = renderer === undefined ? undefined : table.get(renderer);
      if (owner === undefined || owner.isDestroyed) {
        return false;
      }
    }
    return true;
  }

  /**
   * Warns, once per pair, that a level renderer already belongs to another group.
   *
   * @param renderer - The shared renderer.
   * @param owner - The group that owns it.
   */
  #warnShared(renderer: MeshRenderer, owner: LodGroup): void {
    const code = ThreeDErrorCode.sharedLodLevel;
    this.app.log.warnOnce(
      `${code}:${this.entity.uid}:${renderer.entity.uid}`,
      `${code}: the MeshRenderer on ${renderer.entity.name} is a level of the LodGroups on ` +
        `${owner.entity.name} and ${this.entity.name}. A renderer belongs to one LodGroup; ` +
        `${this.entity.name}'s leaves it to ${owner.entity.name}'s.`,
    );
  }

  /**
   * Whether the level list still names the renderers the display was last applied to.
   *
   * @returns `true` when nothing in the list changed.
   */
  #isDisplayed(): boolean {
    const levels = this.levels;
    const displayed = this.#displayed;
    if (levels.length !== displayed.length) {
      return false;
    }
    for (let index = 0; index < levels.length; index += 1) {
      if ((levels[index]?.renderer ?? null) !== displayed[index]) {
        return false;
      }
    }
    return true;
  }

  /**
   * The level a distance falls in, with hysteresis around the level currently showing.
   *
   * @param distance - How far the camera is, in metres.
   * @returns The level index, or `-1` past the last threshold.
   */
  #pick(distance: number): number {
    const levels = this.levels;
    const slack = Math.max(0, this.hysteresis);
    for (let index = 0; index < levels.length; index += 1) {
      const threshold = levels[index]?.distance ?? 0;
      // Widen the boundary the camera would have to cross to *leave* the current level.
      const widened = index === this.#level ? threshold * (1 + slack) : threshold;
      if (distance <= widened) {
        return index;
      }
    }
    return LOD_CULLED;
  }
}

/**
 * The `PreRender` order the LOD system runs at.
 *
 * @remarks
 * `-10` puts it before `@ignifx/core`'s render sync at `900`, so a renderer switched on this frame is
 * reconciled with the Lite scene in the same frame rather than the next one.
 *
 * @public
 */
export const LOD_ORDER = -10;

/**
 * Evaluates every `LodGroup` against the main camera.
 *
 * @public
 */
export class LodSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/3d-lod";

  /**
   * Measures each group's distance from the camera and switches it. A group that is not enabled in
   * the hierarchy is left as it is, less what it hid for display in an edit-mode app.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const camera = mainCamera(ctx.world);
    if (camera === null) {
      return;
    }
    const eye = camera.entity.transform.position;
    const groups = ctx.world.components(LodGroup);
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group === undefined) {
        continue;
      }
      if (group.isEnabledInHierarchy) {
        const position = group.entity.transform.position;
        group.evaluate(Math.hypot(position.x - eye.x, position.y - eye.y, position.z - eye.z));
      } else {
        group.releaseDisplay();
      }
    }
  }
}
