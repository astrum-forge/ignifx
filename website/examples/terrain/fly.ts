/**
 * The fly camera the island is toured with: one action map and one `Script`, on the same
 * `@ignifx/input` actions a game would use rather than DOM listeners.
 *
 * It keeps itself above the ground by asking the terrain — `heightAt` is a bilinear read of the
 * height field and needs no collider, no physics extension and no raycast — and it clamps itself to
 * the field's own extent, so the camera cannot wander off into empty space.
 */

import { clamp, defineInputActions, degToRad, f32, Script, Vec3 } from "ignifx";
import type {
  App,
  ComponentInit,
  Entity,
  InputAction,
  InputActionsDefinition,
  MutableVec3,
  ScriptCallbacks,
  Terrain,
} from "ignifx";

/** The action map the fly camera reads. Its own map, so an example's gameplay map is untouched. */
export const FLY_ACTION_MAP = "TerrainFly";

/** The actions the fly camera binds, as a document `app.input.loadActions` takes. */
export const FLY_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: FLY_ACTION_MAP,
      actions: [
        {
          name: "flyMove",
          type: "vector2",
          bindings: [
            {
              composite: "2DVector",
              up: "<Keyboard>/w",
              down: "<Keyboard>/s",
              left: "<Keyboard>/a",
              right: "<Keyboard>/d",
            },
            {
              composite: "2DVector",
              up: "<Keyboard>/arrowUp",
              down: "<Keyboard>/arrowDown",
              left: "<Keyboard>/arrowLeft",
              right: "<Keyboard>/arrowRight",
            },
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.2)"] },
            { path: "<Gamepad>/dpad" },
            { path: "<Virtual>/joystick", processors: ["deadzone(0.15)"] },
          ],
        },
        { name: "flyDrag", bindings: [{ path: "<Pointer>/press" }] },
        { name: "flyLook", type: "vector2", bindings: [{ path: "<Pointer>/delta" }] },
        {
          name: "flyStick",
          type: "vector2",
          bindings: [{ path: "<Gamepad>/rightStick", processors: ["deadzone(0.2)"] }],
        },
        { name: "flyRise", bindings: [{ path: "<Keyboard>/e" }, { path: "<Gamepad>/buttonSouth" }] },
        { name: "flyDive", bindings: [{ path: "<Keyboard>/q" }, { path: "<Gamepad>/buttonEast" }] },
        { name: "flyBoost", bindings: [{ path: "<Keyboard>/shiftLeft" }, { path: "<Gamepad>/leftStickPress" }] },
      ],
    },
  ],
});

/**
 * Flies its entity over a terrain.
 *
 * @example
 * ```ts
 * const camera = attachFly(app, eye, { yaw: 40, pitch: -14 });
 * camera.ground = island;
 * ```
 */
export class FlyCamera
  extends Script.define({
    yaw: f32(0, { tooltip: "Heading about world Y, in degrees." }),
    pitch: f32(-12, { min: -89, max: 89, tooltip: "Elevation above the horizon, in degrees." }),
    speed: f32(34, { min: 1, tooltip: "Travel speed, in metres per second." }),
    boost: f32(3.5, { min: 1, tooltip: "How much faster Shift is." }),
    clearance: f32(6, { min: 0, tooltip: "The least distance kept above the ground, in metres." }),
    lookDegreesPerScreen: f32(200, { min: 1, tooltip: "Degrees per drag across the whole canvas." }),
    stickDegreesPerSecond: f32(120, { min: 0 }),
    minPitch: f32(-85, { min: -89, max: 89 }),
    maxPitch: f32(70, { min: -89, max: 89 }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "terrain-example/FlyCamera";

  /**
   * The ground the camera stays above, or `null` to fly freely.
   *
   * @remarks
   * Assigned in code rather than declared as a schema field, because an example's terrain is built
   * in `main.ts` and there is no scene file here for a reference to live in.
   */
  ground: Terrain | null = null;

  /** Where the camera looks, rebuilt each frame; a field so no frame allocates (standards §7). */
  readonly #target = new Vec3();

  /**
   * Reads the frame's input, moves, and points the camera.
   *
   * @remarks
   * Travel runs on the scaled delta, so `?static=1` — which stops the clock before `app.start()` —
   * freezes the shot at the authored pose. The look runs on the unscaled delta, matching the kit's
   * orbit camera, so a paused example can still be looked around.
   *
   * @param dt - Seconds since the previous frame, scaled by `time.timeScale`.
   */
  update(dt: number): void {
    this.#look(this.app.time.unscaledDeltaTime);
    this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);

    const yaw = degToRad(this.yaw);
    const pitch = degToRad(this.pitch);
    const cosPitch = Math.cos(pitch);
    // ignifx is left-handed with +Z forward, so a yaw of zero looks down +Z.
    const forwardX = Math.sin(yaw) * cosPitch;
    const forwardY = Math.sin(pitch);
    const forwardZ = Math.cos(yaw) * cosPitch;

    const move = this.#action("flyMove");
    const rise = (this.#pressed("flyRise") ? 1 : 0) - (this.#pressed("flyDive") ? 1 : 0);
    const step = this.speed * (this.#pressed("flyBoost") ? this.boost : 1) * dt;
    const forward = move?.vector.y ?? 0;
    const strafe = move?.vector.x ?? 0;
    const position = this.transform.localPosition;
    position.set(
      position.x + (forwardX * forward + Math.cos(yaw) * strafe) * step,
      position.y + (forwardY * forward + rise) * step,
      position.z + (forwardZ * forward - Math.sin(yaw) * strafe) * step,
    );
    this.#keepAboveGround(position);

    this.#target.set(position.x + forwardX, position.y + forwardY, position.z + forwardZ);
    this.transform.lookAt(this.#target);
  }

  /**
   * Turns a drag and the right stick into yaw and pitch.
   *
   * @param unscaled - The unscaled frame delta, in seconds.
   */
  #look(unscaled: number): void {
    const stick = this.#action("flyStick");
    if (stick !== null) {
      const rate = this.stickDegreesPerSecond * unscaled;
      this.yaw += stick.vector.x * rate;
      this.pitch += stick.vector.y * rate;
    }
    const delta = this.#action("flyLook");
    if (delta === null || !this.#pressed("flyDrag")) {
      return;
    }
    // `<Pointer>/delta` is in CSS pixels, so the divisor is the canvas's CSS height and a drag
    // turns the camera by the same amount at any device pixel ratio (`08-input.md` §5).
    const perPixel = this.lookDegreesPerScreen / this.#screenHeight;
    this.yaw += delta.vector.x * perPixel;
    this.pitch -= delta.vector.y * perPixel;
  }

  /**
   * Holds the camera inside the terrain's extent and above its surface.
   *
   * @param position - The camera's local position, written in place.
   */
  #keepAboveGround(position: MutableVec3): void {
    const ground = this.ground;
    if (ground === null || !ground.isLoaded) {
      return;
    }
    const size = ground.size;
    const origin = ground.transform.position;
    const halfWidth = size.width / 2;
    const halfDepth = size.depth / 2;
    const x = clamp(position.x, origin.x - halfWidth, origin.x + halfWidth);
    const z = clamp(position.z, origin.z - halfDepth, origin.z + halfDepth);
    position.set(x, Math.max(position.y, ground.heightAt(x, z) + this.clearance), z);
  }

  /**
   * One action of the camera's own map.
   *
   * @param name - The action name.
   * @returns The action, or `null` when the map is not loaded.
   */
  #action(name: string): InputAction | null {
    return this.app.input.actions.find(name);
  }

  /**
   * Whether a button action is held this frame.
   *
   * @param name - The action name.
   * @returns `true` while it is pressed.
   */
  #pressed(name: string): boolean {
    return this.#action(name)?.isPressed ?? false;
  }

  /**
   * The canvas's height in CSS pixels, which the drag delta is normalised by.
   *
   * @returns The height, or `1` when there is no surface, so a division is always safe.
   */
  get #screenHeight(): number {
    const surface = this.app.renderer.surface;
    if (surface === null) {
      return 1;
    }
    const layoutHeight = "clientHeight" in surface ? surface.clientHeight : 0;
    return layoutHeight > 0 ? layoutHeight : Math.max(1, surface.height);
  }
}

/**
 * Registers the fly camera, loads its actions, and attaches it to an entity.
 *
 * @param app - The running app; needs the `input()` extension.
 * @param entity - The camera's entity.
 * @param init - Field overrides, usually `yaw`, `pitch` and `speed`.
 * @returns The attached component.
 */
export function attachFly(app: App, entity: Entity, init?: ComponentInit<FlyCamera>): FlyCamera {
  app.registerComponents([FlyCamera]);
  app.input.loadActions(FLY_ACTIONS);
  return entity.addComponent(FlyCamera, init);
}
