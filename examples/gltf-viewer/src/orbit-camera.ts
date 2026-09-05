import { clamp, degToRad, f32, Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * A drag-to-orbit camera control, written against the DOM because `@ignifx/input` arrives in
 * Phase 3. When it does, the pointer plumbing here becomes an action map and the maths stays.
 */

/** How far the pitch may travel from the horizon, in degrees. */
const MAX_PITCH_DEGREES = 85;

/** The closest the camera may orbit, in metres. */
const MIN_DISTANCE = 1.2;

/** The furthest the camera may orbit, in metres. */
const MAX_DISTANCE = 20;

/**
 * Orbits its entity around a target point. Drag yaws and pitches; the wheel dollies.
 *
 * The angles are serialized fields, so a scene file can frame a shot and the same component
 * replays it.
 */
export class OrbitCamera
  extends Script.define({
    yaw: f32(35),
    pitch: f32(18),
    distance: f32(4.6),
    height: f32(0.2),
    dragSensitivity: f32(0.35),
    zoomSensitivity: f32(0.0025),
  })
  implements ScriptCallbacks
{
  static typeId = "gltf-viewer/OrbitCamera";

  #surface: HTMLElement | null = null;

  #pointer = -1;

  #lastX = 0;

  #lastY = 0;

  // Bound once at construction, never per frame (coding standards §7).
  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#pointer !== -1) {
      return;
    }
    this.#pointer = event.pointerId;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#surface?.setPointerCapture(event.pointerId);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) {
      return;
    }
    this.yaw -= (event.clientX - this.#lastX) * this.dragSensitivity;
    this.pitch = clamp(
      this.pitch + (event.clientY - this.#lastY) * this.dragSensitivity,
      -MAX_PITCH_DEGREES,
      MAX_PITCH_DEGREES,
    );
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer) {
      return;
    }
    this.#pointer = -1;
    this.#surface?.releasePointerCapture(event.pointerId);
  };

  readonly #onWheel = (event: WheelEvent): void => {
    this.distance = clamp(this.distance * (1 + event.deltaY * this.zoomSensitivity), MIN_DISTANCE, MAX_DISTANCE);
  };

  /**
   * Starts listening to the element the game is drawn on.
   *
   * @param surface - The canvas, or any element that receives the pointer.
   */
  bind(surface: HTMLElement): void {
    this.unbind();
    surface.addEventListener("pointerdown", this.#onPointerDown);
    surface.addEventListener("pointermove", this.#onPointerMove);
    surface.addEventListener("pointerup", this.#onPointerUp);
    surface.addEventListener("pointercancel", this.#onPointerUp);
    surface.addEventListener("wheel", this.#onWheel, { passive: true });
    this.#surface = surface;
  }

  /** Stops listening. Called for you when the component is destroyed. */
  unbind(): void {
    const surface = this.#surface;
    if (surface === null) {
      return;
    }
    surface.removeEventListener("pointerdown", this.#onPointerDown);
    surface.removeEventListener("pointermove", this.#onPointerMove);
    surface.removeEventListener("pointerup", this.#onPointerUp);
    surface.removeEventListener("pointercancel", this.#onPointerUp);
    surface.removeEventListener("wheel", this.#onWheel);
    this.#surface = null;
  }

  /** Places the camera on its orbit. Runs every frame, and does not read `dt`. */
  update(): void {
    const yaw = degToRad(this.yaw);
    const pitch = degToRad(this.pitch);
    const horizontal = Math.cos(pitch) * this.distance;
    this.transform.localPosition.set(
      Math.sin(yaw) * horizontal,
      this.height + Math.sin(pitch) * this.distance,
      -Math.cos(yaw) * horizontal,
    );
    this.transform.lookAt({ x: 0, y: this.height, z: 0 });
  }

  /** Releases the pointer listeners. */
  onDestroy(): void {
    this.unbind();
  }
}
