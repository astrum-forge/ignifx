/**
 * The orbit camera every 3D example is looked at through
 * (`website/plan/04-examples-platform.md` §4).
 *
 * It is a `Script` on `@ignifx/input` actions rather than a set of DOM listeners, which is the
 * whole point of showing it on the website: a visitor reading an example sees the same action-based
 * input a game writes, and the same control works on a mouse, a touch screen and a gamepad without
 * a branch per device. `examples/gltf-viewer/src/orbit-camera.ts` is the DOM-listener version this
 * replaces — it predates `@ignifx/input`.
 *
 * ## Input, and why the numbers are what they are
 *
 * | Gesture       | Path                                          | Effect                              |
 * | ------------- | --------------------------------------------- | ----------------------------------- |
 * | Drag          | `<Pointer>/press` + `<Pointer>/delta`         | Yaw and pitch                       |
 * | Wheel         | `<Mouse>/scroll`                              | Dolly in and out                    |
 * | Two-finger    | `<Touch>/touchCount`, `touch0`/`touch1`       | Pinch to dolly                      |
 * | Right stick   | `<Gamepad>/rightStick`, `deadzone(0.15)`      | Yaw and pitch, degrees per second   |
 *
 * `<Pointer>/delta` is in **CSS pixels** of hand motion, and the touch positions are in
 * **backing-store pixels** (the canvas's `width`/`height`, the space `pickAsync` and
 * `Camera.worldToScreen` share) — `docs/architecture/08-input.md` §5 says why the two differ. The
 * drag is therefore divided by the canvas's **CSS** height before it becomes an angle, so the
 * gesture feels the same at a device pixel ratio of 1, 2 and 3, at any render scale and at any
 * canvas size: {@link OrbitCamera.dragDegreesPerScreen} degrees per drag across the canvas,
 * whatever the canvas is. The pinch compares two touch positions with each other, so its unit
 * cancels out.
 *
 * A pointer press that starts on the parameter panel never reaches `<Pointer>/press` — the panel is
 * the canvas's sibling and `@ignifx/input` reads `pointerdown` from the canvas — and a drag that
 * started there is masked by `app.input.uiHasPointer`. So dragging a slider does not also orbit,
 * with nothing in this file to say so.
 *
 * ## Determinism under `?static=1`
 *
 * The damping is exponential towards a target, on the **unscaled** clock, so pausing gameplay does
 * not freeze the camera. `?static=1` stops the clock before `app.start()`, which leaves
 * `unscaledDeltaTime` running but leaves the target where the example put it — and the first update
 * snaps the smoothed values onto their targets rather than damping into them from wherever the
 * fields happened to start. A capture is therefore the authored pose, on the first frame.
 */

import { Camera, clamp, defineInputActions, degToRad, f32, Script, vec3 } from "ignifx";
import type {
  App,
  ComponentInit,
  Entity,
  InputAction,
  InputActionsDefinition,
  ScriptCallbacks,
  Vec3Like,
} from "ignifx";

/** The action map this camera reads. Its own map, so an example's gameplay map is untouched. */
export const ORBIT_ACTION_MAP = "KitOrbit";

/**
 * The actions the orbit camera binds, as a document `app.input.loadActions` takes.
 *
 * @remarks
 * Exported so an example that wants to rename a control, or bind an extra one, has something to
 * start from — and so the map name is stated once.
 */
export const ORBIT_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: ORBIT_ACTION_MAP,
      actions: [
        { name: "orbitDrag", type: "button", bindings: [{ path: "<Pointer>/press" }] },
        { name: "orbitDelta", type: "vector2", bindings: [{ path: "<Pointer>/delta" }] },
        { name: "orbitZoom", type: "vector2", bindings: [{ path: "<Mouse>/scroll" }] },
        {
          name: "orbitStick",
          type: "vector2",
          bindings: [{ path: "<Gamepad>/rightStick", processors: ["deadzone(0.15)"] }],
        },
        { name: "orbitTouchCount", type: "axis", bindings: [{ path: "<Touch>/touchCount" }] },
        { name: "orbitTouchA", type: "vector2", bindings: [{ path: "<Touch>/touch0/position" }] },
        { name: "orbitTouchB", type: "vector2", bindings: [{ path: "<Touch>/touch1/position" }] },
      ],
    },
  ],
});

/** A sphere an example wants the camera to frame; what {@link OrbitCamera.frame} takes. */
export interface OrbitBounds {
  /** The centre, in world metres. */
  readonly center: Vec3Like;
  /** The radius of the sphere that contains the subject, in metres. */
  readonly radius: number;
}

/** The field of view assumed when the camera's entity carries no `Camera` component yet. */
const FALLBACK_FOV_DEGREES = 45;

/** How much empty frame `frame()` leaves around the subject: 1 is edge to edge. */
const DEFAULT_FRAMING_PADDING = 1.25;

/** Below this many pixels a two-finger pinch is ignored, so a stray second touch does nothing. */
const MIN_PINCH_PIXELS = 8;

/**
 * Orbits its entity around a target point on `@ignifx/input` actions.
 *
 * @remarks
 * Every field is serialized, so a scene file can frame a shot and this component replays it, and
 * the devtools inspector shows and edits the live pose.
 *
 * @example
 * ```ts
 * const orbit = attachOrbit(app, cameraEntity, { yaw: 35, pitch: 14 });
 * orbit.frame({ center: { x: 0, y: 0.5, z: 0 }, radius: 0.6 });
 * ```
 */
export class OrbitCamera
  extends Script.define({
    yaw: f32(35, { tooltip: "Rotation about world Y, in degrees." }),
    pitch: f32(14, { tooltip: "Elevation above the horizon, in degrees." }),
    distance: f32(4, { min: 0, tooltip: "Distance from the target, in metres." }),
    target: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "The world point the camera looks at." }),
    minPitch: f32(-80, { min: -89, max: 89 }),
    maxPitch: f32(80, { min: -89, max: 89 }),
    minDistance: f32(0.2, { min: 0.001 }),
    maxDistance: f32(60, { min: 0.001 }),
    damping: f32(14, { min: 0, tooltip: "How fast the pose catches its target; 0 is instant." }),
    dragDegreesPerScreen: f32(360, { min: 1, tooltip: "Degrees per drag across the whole canvas." }),
    zoomPerScrollUnit: f32(0.0015, { min: 0, tooltip: "Dolly factor per unit of wheel delta." }),
    stickDegreesPerSecond: f32(140, { min: 0, tooltip: "Gamepad orbit speed, degrees per second." }),
    idleDegreesPerSecond: f32(0, { min: 0, tooltip: "Turntable speed until the first input, per second." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "ignifx-example-kit/OrbitCamera";

  /** The smoothed yaw actually applied to the transform. */
  #yaw = 0;

  /** The smoothed pitch actually applied to the transform. */
  #pitch = 0;

  /** The smoothed distance actually applied to the transform. */
  #distance = 0;

  /** Whether the smoothed values have been seeded from the fields yet. */
  #settled = false;

  /** The pinch span of the previous frame, in backing pixels; `-1` when no pinch is in progress. */
  #pinch = -1;

  /** Whether the visitor has taken the camera; the turntable stops for good at the first input. */
  #taken = false;

  /**
   * Frames a subject: points the camera at its centre and pulls back far enough to contain it.
   *
   * @remarks
   * The distance is the one that makes the sphere subtend the vertical field of view, times
   * `padding`. The camera's own `fov` is used when the entity has a `Camera`, so an example that
   * changes the lens does not also have to recompute the shot.
   *
   * @param bounds - The sphere to contain.
   * @param padding - How much empty frame to leave; 1 is edge to edge, 1.25 is the default.
   */
  frame(bounds: OrbitBounds, padding = DEFAULT_FRAMING_PADDING): void {
    // A whole new object rather than three assignments: `Vec3Like` is an input-only shape with
    // readonly members (the engine's own convention — a mutable view is a `Vec3`), and the field
    // itself is what a caller replaces.
    this.target = { x: bounds.center.x, y: bounds.center.y, z: bounds.center.z };
    const fov = this.entity.getComponent(Camera)?.fov ?? FALLBACK_FOV_DEGREES;
    this.distance = clamp((bounds.radius * padding) / Math.sin(degToRad(fov) / 2), this.minDistance, this.maxDistance);
    this.#settled = false;
  }

  /**
   * Reads the frame's input, damps towards it, and places the camera.
   *
   * @remarks
   * Two clocks, on purpose. The damping runs on `app.time.unscaledDeltaTime`, so a camera keeps
   * catching up while gameplay is slowed or stopped; the idle turntable runs on `dt`, the scaled
   * delta, so `?static=1` freezes it. The first input of any kind stops the turntable for good.
   *
   * @param dt - Seconds since the previous frame, scaled by `time.timeScale`.
   */
  update(dt: number): void {
    const unscaled = this.app.time.unscaledDeltaTime;
    const before = this.yaw + this.pitch + this.distance;
    this.#readDrag();
    this.#readStick(unscaled);
    this.#readZoom();
    this.#readPinch();
    if (this.yaw + this.pitch + this.distance !== before) {
      this.#taken = true;
    } else if (!this.#taken) {
      // The turntable runs on the **scaled** delta, unlike the damping below. That is what makes
      // `?static=1` — which sets `time.timeScale = 0` before `app.start()` — freeze the pose, and
      // it is the right clock anyway: an idle spin is something the scene does, not something the
      // camera does while the scene is stopped.
      this.yaw += this.idleDegreesPerSecond * dt;
    }

    this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
    this.distance = clamp(this.distance, this.minDistance, this.maxDistance);

    if (this.#settled) {
      // Exponential smoothing, framerate independent: the fraction of the remaining error removed
      // in one second is fixed, so a 30 Hz and a 144 Hz browser reach the target together.
      const alpha = this.damping <= 0 ? 1 : 1 - Math.exp(-this.damping * unscaled);
      this.#yaw += (this.yaw - this.#yaw) * alpha;
      this.#pitch += (this.pitch - this.#pitch) * alpha;
      this.#distance += (this.distance - this.#distance) * alpha;
    } else {
      // The first frame is the authored pose, not a spring starting from zero — which is what a
      // `?static=1` capture and a fresh page load both need.
      this.#settled = true;
      this.#yaw = this.yaw;
      this.#pitch = this.pitch;
      this.#distance = this.distance;
    }

    const yaw = degToRad(this.#yaw);
    const pitch = degToRad(this.#pitch);
    const horizontal = Math.cos(pitch) * this.#distance;
    this.transform.localPosition.set(
      this.target.x + Math.sin(yaw) * horizontal,
      this.target.y + Math.sin(pitch) * this.#distance,
      // ignifx is left-handed with +Z forward, so the camera sits on -Z at a yaw of zero and looks
      // back along +Z at the target.
      this.target.z - Math.cos(yaw) * horizontal,
    );
    this.transform.lookAt(this.target);
  }

  /**
   * The canvas's height in **CSS pixels**, which the drag delta is normalised by.
   *
   * @remarks
   * `<Pointer>/delta` reports CSS pixels, so the divisor has to be the CSS height, not the backing
   * store's: dividing by `canvas.height` would make a drag turn the camera less on a retina display
   * and again less when a render-scale setting grows the backing store. An `OffscreenCanvas` has no
   * layout box; its backing height is the only figure there is.
   *
   * @returns The height, or `1` when there is no surface, so a division is always safe.
   */
  get #screenHeight(): number {
    const surface = this.app.renderer.surface;
    if (surface === null) {
      return 1;
    }
    const layoutHeight = "clientHeight" in surface ? surface.clientHeight : 0;
    if (layoutHeight > 0) {
      return layoutHeight;
    }
    return surface.height <= 0 ? 1 : surface.height;
  }

  /**
   * One action of the camera's own map, or `null` when the map is not loaded.
   *
   * @param name - The action name.
   * @returns The action, or `null`.
   */
  #action(name: string): InputAction | null {
    return this.app.input.actions.find(name);
  }

  /** Turns a one-finger or mouse drag into yaw and pitch. */
  #readDrag(): void {
    const press = this.#action("orbitDrag");
    const delta = this.#action("orbitDelta");
    if (press === null || delta === null || !press.isPressed) {
      return;
    }
    // A two-finger gesture is a pinch, not a drag: the primary pointer's delta would otherwise
    // spin the camera every time the fingers moved together.
    if ((this.#action("orbitTouchCount")?.axis ?? 0) >= 2) {
      return;
    }
    const perPixel = this.dragDegreesPerScreen / this.#screenHeight;
    this.yaw -= delta.vector.x * perPixel;
    this.pitch += delta.vector.y * perPixel;
  }

  /**
   * Turns the gamepad's right stick into yaw and pitch.
   *
   * @param unscaled - The unscaled frame delta, in seconds.
   */
  #readStick(unscaled: number): void {
    const stick = this.#action("orbitStick");
    if (stick === null) {
      return;
    }
    const step = this.stickDegreesPerSecond * unscaled;
    this.yaw += stick.vector.x * step;
    this.pitch += stick.vector.y * step;
  }

  /** Turns the wheel into a dolly. */
  #readZoom(): void {
    const zoom = this.#action("orbitZoom");
    const scroll = zoom?.vector.y ?? 0;
    if (scroll === 0) {
      return;
    }
    // Multiplicative, so one notch covers the same visual amount close up and far away.
    this.distance *= 1 + scroll * this.zoomPerScrollUnit;
  }

  /** Turns a two-finger pinch into a dolly. */
  #readPinch(): void {
    const count = this.#action("orbitTouchCount")?.axis ?? 0;
    const a = this.#action("orbitTouchA");
    const b = this.#action("orbitTouchB");
    if (count < 2 || a === null || b === null) {
      this.#pinch = -1;
      return;
    }
    const span = Math.hypot(a.vector.x - b.vector.x, a.vector.y - b.vector.y);
    if (span < MIN_PINCH_PIXELS) {
      return;
    }
    if (this.#pinch > 0) {
      this.distance *= this.#pinch / span;
    }
    this.#pinch = span;
  }
}

/**
 * Registers the orbit camera, loads its actions, and attaches it to an entity.
 *
 * @remarks
 * The one call an example makes. `loadActions` merges by map name, so calling this for a second
 * camera re-installs the same map rather than duplicating it, and an example's own action document
 * is left alone.
 *
 * @param app - The running app; needs the `input()` extension.
 * @param entity - The camera's entity.
 * @param init - Field overrides, usually `yaw`, `pitch`, `distance` and `target`.
 * @returns The attached component.
 *
 * @example
 * ```ts
 * const eye = app.world.createEntity("Main Camera");
 * eye.addComponent(Camera, { fov: 40, near: 0.05, far: 100 });
 * const orbit = attachOrbit(app, eye, { yaw: 40, pitch: 16, distance: 2 });
 * ```
 */
export function attachOrbit(app: App, entity: Entity, init?: ComponentInit<OrbitCamera>): OrbitCamera {
  app.registerComponents([OrbitCamera]);
  app.input.loadActions(ORBIT_ACTIONS);
  return entity.addComponent(OrbitCamera, init);
}
