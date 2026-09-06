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
import type { ComponentHooks, Schema, System, SystemContext } from "@ignifx/core";

/**
 * `LodGroup` (`docs/architecture/12-3d-toolkit.md` §6): distance-based `MeshRenderer` switching.
 *
 * Babylon Lite has no automatic level of detail, so this is the whole mechanism: a list of levels,
 * each a renderer and the distance beyond which it takes over, evaluated once per frame in
 * `PreRender` against the main camera. Exactly one level's renderer is enabled at a time; past the
 * last level's distance every one of them is off, which is how a group culls itself entirely.
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
 * group.onLevelChanged.connect((level) => app.log.debug("LOD {level}", level), { owner: group });
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

  /** Turns every level off, so a disabled group leaves nothing drawn. */
  onDetach(): void {
    for (const level of this.levels) {
      const renderer = level.renderer;
      if (renderer !== null && !renderer.isDestroyed) {
        renderer.enabled = false;
      }
    }
    this.#level = LOD_CULLED;
  }

  /**
   * Chooses the level for a distance and enables exactly that renderer.
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
    for (let index = 0; index < levels.length; index += 1) {
      const renderer = levels[index]?.renderer ?? null;
      if (renderer !== null && !renderer.isDestroyed) {
        renderer.enabled = index === next;
      }
    }
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
 * `-10` puts it before `@ignifx/core`'s render sync at `0`, so a renderer switched on this frame is
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
   * Measures each group's distance from the camera and switches it.
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
      if (group !== undefined && group.isEnabledInHierarchy) {
        const position = group.entity.transform.position;
        group.evaluate(Math.hypot(position.x - eye.x, position.y - eye.y, position.z - eye.z));
      }
    }
  }
}
