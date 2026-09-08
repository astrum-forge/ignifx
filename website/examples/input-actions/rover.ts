import {
  clamp,
  createMaterialAsset,
  createRay,
  f32,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  Script,
} from "ignifx";
import type {
  App,
  AssetHandle,
  Camera,
  ColorLike,
  Entity,
  InputAction,
  MaterialAsset,
  Ray,
  ScriptCallbacks,
} from "ignifx";

/**
 * The thing the actions move: a small rover on the pad, and the crosshair the pointer aims with.
 *
 * The board next door shows what `@ignifx/input` resolved; this shows what a game does with it.
 * Everything the rover reads is an **action**, never a key or a button, which is why one script
 * drives it from a keyboard, a pad or a touch screen with no branch per device:
 *
 * | Action   | Effect                                                                       |
 * | -------- | ---------------------------------------------------------------------------- |
 * | `move`   | Drives it across the pad and turns it to face where it is going              |
 * | `spin`   | Turns it in place, from the `1DAxis` composite on Q and E or the shoulders   |
 * | `boost`  | Multiplies its speed, from an analog trigger or the shift key                |
 * | `jump`   | One hop, integrated against gravity                                          |
 * | `fire`   | Flashes the muzzle                                                            |
 * | `look`   | Yaws and pitches the turret                                                   |
 * | `aim`    | Places the crosshair, converting backing-store pixels into a point on the pad |
 *
 * A disabled `Player` map makes every one of those read as released, so pressing Escape parks the
 * rover rather than breaking it. That is what "a map is how a game switches context" means.
 */

/** Where the rover's body sits above the pad, in metres. */
const RIDE_HEIGHT = 0.22;

/** The heading the rover starts on, in degrees; a yaw of zero looks away from the camera. */
const START_YAW_DEGREES = 215;

/** How far from the pad's centre the rover may go, in metres. */
const PAD_LIMIT = { x: 2.2, near: -2.4, far: 0.95 } as const;

/** How fast the rover turns to face its heading, in degrees per second. */
const TURN_DEGREES_PER_SECOND = 420;

/** How fast `spin` turns the rover in place, in degrees per second. */
const SPIN_DEGREES_PER_SECOND = 150;

/** How far the turret yaws and pitches, in degrees per second at full stick. */
const TURRET_DEGREES_PER_SECOND = 90;

/** How far the turret may pitch from level, in degrees. */
const TURRET_PITCH_LIMIT = 24;

/** How long the muzzle stays lit after a `fire` press, in seconds. */
const MUZZLE_SECONDS = 0.12;

/** How many steps the thruster's glow is quantised to before it is written. */
const THRUSTER_STEPS = 24;

/** The rover's warm hull, in sRGB. */
const HULL: ColorLike = { r: 0.95, g: 0.45, b: 0.14, a: 1 };

/** The canopy and the skids: near-black metal, in sRGB. */
const METAL: ColorLike = { r: 0.2, g: 0.24, b: 0.3, a: 1 };

/** The muzzle and thruster at rest, in sRGB. */
const EMBER_OFF: ColorLike = { r: 0.42, g: 0.22, b: 0.11, a: 1 };

/** The muzzle and thruster lit, in sRGB. */
const EMBER_ON: ColorLike = { r: 1, g: 0.78, b: 0.42, a: 1 };

/** The crosshair, in sRGB: the site's `--cool`. */
const CROSSHAIR: ColorLike = { r: 0.353, g: 0.82, b: 0.784, a: 1 };

/** A point or a size in metres, named so a doc comment does not have to describe three fields. */
interface Point3 {
  /** Metres along X. */
  readonly x: number;
  /** Metres along Y. */
  readonly y: number;
  /** Metres along Z. */
  readonly z: number;
}

/** The actions one rover reads, resolved once. */
interface RoverActions {
  /** Drives across the pad. */
  readonly move: InputAction | null;
  /** Turns in place. */
  readonly spin: InputAction | null;
  /** Multiplies the speed, and lights the thruster. */
  readonly boost: InputAction | null;
  /** One hop per press. */
  readonly jump: InputAction | null;
  /** Flashes the muzzle. */
  readonly fire: InputAction | null;
  /** Aims the turret. */
  readonly look: InputAction | null;
  /** Places the crosshair. */
  readonly aim: InputAction | null;
}

/** The parts one rover is built from, handed to its script after the entities exist. */
interface RoverParts {
  /** The turret group, yawed and pitched by `look`. */
  readonly turret: Entity;
  /** The muzzle, lit for {@link MUZZLE_SECONDS} after a `fire` press. */
  readonly muzzle: AssetHandle<MaterialAsset>;
  /** The thruster, lit by `boost`. */
  readonly thruster: AssetHandle<MaterialAsset>;
  /** The crosshair ring, moved to where the pointer meets the pad and hidden when it misses. */
  readonly crosshair: Entity;
  /** The camera the crosshair's ray is cast through. */
  readonly camera: Camera;
  /** The actions the rover reads, resolved once by {@link attachRover}. */
  readonly actions: RoverActions;
}

/**
 * Drives the rover from the `Player` map.
 *
 * @remarks
 * Every field is serialized, so the devtools inspector shows and edits the live numbers and a scene
 * file could carry them.
 */
export class Rover
  extends Script.define({
    speed: f32(2.3, { min: 0, tooltip: "Metres per second at full stick, before boost." }),
    boostFactor: f32(1.8, { min: 1, tooltip: "What a full boost multiplies the speed by." }),
    jumpSpeed: f32(3.1, { min: 0, tooltip: "Upward metres per second at the start of a hop." }),
    gravity: f32(9.5, { min: 0, tooltip: "Downward metres per second squared." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "input-actions/Rover";

  #parts: RoverParts | null = null;

  /** Metres per second upward; `0` while the rover is on the pad. */
  #lift = 0;

  /** Seconds of muzzle flash left. */
  #muzzle = 0;

  /** The turret's yaw, in degrees. */
  #turretYaw = 0;

  /** The turret's pitch, in degrees. */
  #turretPitch = 0;

  /** The last thruster level written, quantised, so an idle thruster uploads nothing. */
  #thrusterLevel = -1;

  /** Whether the muzzle is currently written lit. */
  #muzzleLit = false;

  /**
   * Reused so the per-frame path allocates nothing (coding standards §7).
   *
   * @remarks
   * `createRay()` rather than an object literal, and the difference is not cosmetic: a ray's
   * `length` is how far it reaches, `createRay` sets it to `Number.MAX_VALUE`, and a literal
   * that forgets it stops the cast short of everything in the scene.
   */
  readonly #ray: Ray = createRay();

  /**
   * Hands the script the parts {@link attachRover} built.
   *
   * @param parts - The rover's parts, including its already-resolved actions.
   */
  install(parts: RoverParts): void {
    this.#parts = parts;
  }

  /**
   * Reads the frame's actions and moves the rover.
   *
   * @param dt - Seconds since the previous frame, scaled by `time.timeScale`. Under `?static=1` the
   * scale is zero, so the rover holds the pose this file authored.
   */
  update(dt: number): void {
    const parts = this.#parts;
    if (parts === null) {
      return;
    }
    const actions = parts.actions;
    const boost = clamp(actions.boost?.axis ?? 0, 0, 1);
    this.#drive(actions.move, actions.spin, boost, dt);
    this.#hop(actions.jump, dt);
    this.#aimTurret(actions.look, dt);
    this.#flash(actions.fire, parts, boost);
    this.#placeCrosshair(actions.aim, parts);
  }

  /**
   * Moves the rover across the pad and turns it.
   *
   * @param move - The `move` action.
   * @param spin - The `spin` action.
   * @param boost - The boost level, `0` to `1`.
   * @param dt - The scaled frame delta, in seconds.
   */
  #drive(move: InputAction | null, spin: InputAction | null, boost: number, dt: number): void {
    const x = move?.vector.x ?? 0;
    const z = move?.vector.y ?? 0;
    const speed = this.speed * (1 + boost * (this.boostFactor - 1));
    const position = this.transform.localPosition;
    position.x = clamp(position.x + x * speed * dt, -PAD_LIMIT.x, PAD_LIMIT.x);
    position.z = clamp(position.z + z * speed * dt, PAD_LIMIT.near, PAD_LIMIT.far);

    const turn = spin?.axis ?? 0;
    if (turn !== 0) {
      this.transform.rotate({ x: 0, y: turn * SPIN_DEGREES_PER_SECOND * dt, z: 0 });
      return;
    }
    if (Math.hypot(x, z) < 0.05) {
      return;
    }
    // ignifx is left-handed with +Z forward, so a yaw of zero looks along +Z and the heading of a
    // stick vector is `atan2(x, y)` — the same expression a top-down game uses for its character.
    const target = Math.atan2(x, z) * (180 / Math.PI);
    const current = this.transform.localEulerAngles.y;
    const delta = wrapDegrees(target - current);
    const step = TURN_DEGREES_PER_SECOND * dt;
    this.transform.localEulerAngles = {
      x: 0,
      y: current + (Math.abs(delta) <= step ? delta : Math.sign(delta) * step),
      z: 0,
    };
  }

  /**
   * Integrates one hop.
   *
   * @param jump - The `jump` action.
   * @param dt - The scaled frame delta, in seconds.
   */
  #hop(jump: InputAction | null, dt: number): void {
    const position = this.transform.localPosition;
    if (jump?.wasPressedThisFrame === true && position.y <= RIDE_HEIGHT + 0.001) {
      this.#lift = this.jumpSpeed;
    }
    if (this.#lift === 0 && position.y <= RIDE_HEIGHT) {
      return;
    }
    this.#lift -= this.gravity * dt;
    position.y += this.#lift * dt;
    if (position.y <= RIDE_HEIGHT) {
      position.y = RIDE_HEIGHT;
      this.#lift = 0;
    }
  }

  /**
   * Yaws and pitches the turret from `look`.
   *
   * @param look - The `look` action.
   * @param dt - The scaled frame delta, in seconds.
   */
  #aimTurret(look: InputAction | null, dt: number): void {
    const parts = this.#parts;
    if (parts === null || look === null) {
      return;
    }
    const step = TURRET_DEGREES_PER_SECOND * dt;
    this.#turretYaw = wrapDegrees(this.#turretYaw + look.vector.x * step);
    this.#turretPitch = clamp(this.#turretPitch - look.vector.y * step, -TURRET_PITCH_LIMIT, TURRET_PITCH_LIMIT);
    parts.turret.transform.localEulerAngles = { x: this.#turretPitch, y: this.#turretYaw, z: 0 };
  }

  /**
   * Lights the muzzle after a `fire` press and the thruster while the rover is boosting.
   *
   * @param fire - The `fire` action.
   * @param parts - The rover's parts.
   * @param boost - The boost level, `0` to `1`.
   */
  #flash(fire: InputAction | null, parts: RoverParts, boost: number): void {
    if (fire?.wasPressedThisFrame === true) {
      this.#muzzle = MUZZLE_SECONDS;
    } else if (this.#muzzle > 0) {
      this.#muzzle = Math.max(this.#muzzle - this.app.time.unscaledDeltaTime, 0);
    }
    // Both writes are guarded: `setBaseColor` marks a uniform block dirty and uploads it, and a
    // rover standing still should not be paying for that sixty times a second.
    const lit = this.#muzzle > 0;
    if (lit !== this.#muzzleLit) {
      this.#muzzleLit = lit;
      parts.muzzle.value.setBaseColor(lit ? EMBER_ON : EMBER_OFF);
    }
    const level = Math.round(boost * THRUSTER_STEPS);
    if (level !== this.#thrusterLevel) {
      this.#thrusterLevel = level;
      parts.thruster.value.setBaseColor(mix(EMBER_OFF, EMBER_ON, level / THRUSTER_STEPS));
    }
  }

  /**
   * Puts the crosshair where the pointer meets the pad.
   *
   * @remarks
   * This is the conversion worth reading twice. `<Pointer>/position` is in the canvas's
   * **backing-store pixels** — the space `Camera.screenToRay`, `worldToScreen` and
   * `renderer.pickAsync` all share — so the action's vector goes straight into `screenToRay` with
   * no arithmetic. DOM code is the side that divides by `devicePixelRatio`, not this side.
   *
   * The ray is then met with the pad's plane by hand, because a pad is a plane and not a collider:
   * `t = (padY - originY) / directionY`. A ray that misses the pad, or points away from it, hides
   * the crosshair rather than parking it on an edge.
   *
   * @param aim - The `aim` action.
   * @param parts - The rover's parts.
   */
  #placeCrosshair(aim: InputAction | null, parts: RoverParts): void {
    if (aim === null || (aim.vector.x === 0 && aim.vector.y === 0)) {
      parts.crosshair.active = false;
      return;
    }
    const ray = parts.camera.screenToRay(aim.vector.x, aim.vector.y, this.#ray);
    if (ray === null || ray.direction.y >= 0) {
      parts.crosshair.active = false;
      return;
    }
    const t = -ray.origin.y / ray.direction.y;
    const x = ray.origin.x + ray.direction.x * t;
    const z = ray.origin.z + ray.direction.z * t;
    if (Math.abs(x) > PAD_LIMIT.x + 0.6 || z < PAD_LIMIT.near - 0.6 || z > PAD_LIMIT.far + 0.6) {
      parts.crosshair.active = false;
      return;
    }
    parts.crosshair.active = true;
    parts.crosshair.transform.localPosition.set(x, 0.012, z);
  }
}

/**
 * Wraps an angle into `-180…180`.
 *
 * @param degrees - The angle.
 * @returns The same angle, in the shortest form.
 */
function wrapDegrees(degrees: number): number {
  const wrapped = (((degrees + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

/**
 * Interpolates two sRGB colours.
 *
 * @param from - The colour at `t = 0`.
 * @param to - The colour at `t = 1`.
 * @param t - Where to sample, `0` to `1`.
 * @returns The blended colour, opaque.
 */
function mix(from: ColorLike, to: ColorLike, t: number): ColorLike {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: 1,
  };
}

/**
 * Builds the rover, the crosshair, and the script that drives them.
 *
 * @param app - The running app; needs the `input()` extension and a loaded action document.
 * @param camera - The camera the crosshair's ray is cast through.
 * @returns The rover's script, so the panel can bind its fields.
 *
 * @example
 * ```ts
 * const rover = attachRover(app, camera);
 * rover.speed = 4;
 * ```
 */
export function attachRover(app: App, camera: Camera): Rover {
  app.registerComponents([Rover]);
  const lit = (name: string, color: ColorLike, metallic: number, roughness: number): AssetHandle<MaterialAsset> =>
    createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: `rover/${name}`, baseColor: color, metallic, roughness }),
      [],
    );
  const glow = (name: string, color: ColorLike): AssetHandle<MaterialAsset> =>
    createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: `rover/${name}`, baseColor: color, metallic: 0, roughness: 1, unlit: true }),
      [],
    );

  const box = MeshAsset.box(app, { size: 1 });
  const sphere = MeshAsset.sphere(app, { diameter: 1, segments: 16 });
  const tube = MeshAsset.cylinder(app, { diameter: 1, height: 1, tessellation: 16 });
  const hull = lit("hull", HULL, 0.35, 0.42);
  const metal = lit("metal", METAL, 0.25, 0.38);
  const muzzle = glow("muzzle", EMBER_OFF);
  const thruster = glow("thruster", EMBER_OFF);

  const root = app.world.createEntity("Rover");
  root.transform.localPosition.set(0, RIDE_HEIGHT, -0.9);
  // Three-quarters on to the camera at the start, so a frozen capture shows the nose, the mast and
  // one flank rather than the back of a box. `#drive` only turns it once the player moves.
  root.transform.localEulerAngles = { x: 0, y: START_YAW_DEGREES, z: 0 };
  // The camera looks down on the pad, so the rover is built to read from above: a flat deck, four
  // wheels outside its silhouette, a light bar at the nose and a glowing vent at the tail.
  addPart(app, root, "Deck", box, hull, { x: 0, y: 0, z: 0 }, { x: 0.62, y: 0.18, z: 0.94 }, true);
  addPart(app, root, "Nose", box, hull, { x: 0, y: -0.02, z: 0.56 }, { x: 0.44, y: 0.13, z: 0.22 }, true);
  addPart(app, root, "Light bar", box, muzzle, { x: 0, y: 0.03, z: 0.66 }, { x: 0.34, y: 0.06, z: 0.05 }, false);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const label = `${side < 0 ? "Left" : "Right"} ${end < 0 ? "rear" : "front"} wheel`;
      addPart(
        app,
        root,
        label,
        tube,
        metal,
        { x: side * 0.37, y: -0.05, z: end * 0.31 },
        // Scale first, then rotate: a unit cylinder is a disc of diameter 1 in XZ standing 1 along
        // Y, so 0.26 across and 0.12 tall is a wheel, and the quarter turn lays it on its axle.
        { x: 0.26, y: 0.12, z: 0.26 },
        true,
        // `MeshAsset.cylinder` stands along Y, so a quarter turn about Z lays a wheel on its axle.
        { x: 0, y: 0, z: 90 },
      );
    }
  }
  addPart(app, root, "Vent", tube, thruster, { x: 0, y: 0.02, z: -0.5 }, { x: 0.3, y: 0.08, z: 0.3 }, false, {
    x: 90,
    y: 0,
    z: 0,
  });

  const turret = app.world.createEntity("Turret");
  turret.setParent(root);
  turret.transform.localPosition.set(0, 0.11, -0.06);
  addPart(app, turret, "Canopy", sphere, metal, { x: 0, y: 0, z: 0 }, { x: 0.32, y: 0.2, z: 0.36 }, true);
  addPart(app, turret, "Mast", box, metal, { x: 0, y: 0.03, z: 0.28 }, { x: 0.07, y: 0.06, z: 0.36 }, true);
  addPart(app, turret, "Muzzle", box, muzzle, { x: 0, y: 0.03, z: 0.47 }, { x: 0.1, y: 0.07, z: 0.09 }, false);

  // A flat ring on the pad. `MeshAsset.torus` is built in the XZ plane, which is where a mark on
  // the ground wants to be, so this one needs no rotation at all.
  const crosshair = app.world.createEntity("Crosshair");
  crosshair.transform.localScale.set(0.34, 0.06, 0.34);
  crosshair.addComponent(MeshRenderer, {
    mesh: MeshAsset.torus(app, { diameter: 1, thickness: 0.12, tessellation: 24 }),
    materials: [glow("crosshair", CROSSHAIR)],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
  crosshair.active = false;

  // `find` rather than `get`: `get` searches the *enabled* maps and throws `IGX-0801` the moment
  // Escape disables `Player`, while a handle taken this way keeps working and reads as released.
  const find = (name: string): InputAction | null => app.input.actions.find(name);
  const rover = root.addComponent(Rover);
  rover.install({
    turret,
    muzzle,
    thruster,
    crosshair,
    camera,
    actions: {
      move: find("move"),
      spin: find("spin"),
      boost: find("boost"),
      jump: find("jump"),
      fire: find("fire"),
      look: find("look"),
      aim: find("aim"),
    },
  });
  return rover;
}

/**
 * Adds one part of the rover.
 *
 * @param app - The app.
 * @param parent - The entity the part hangs from.
 * @param name - The part's name.
 * @param mesh - The template it clones.
 * @param material - The material it wears.
 * @param at - Where its centre sits, in the parent's metres.
 * @param size - Its size along each axis, in metres.
 * @param casts - Whether it casts a shadow.
 * @param spin - Euler angles in degrees, for a part whose template stands the wrong way.
 */
function addPart(
  app: App,
  parent: Entity,
  name: string,
  mesh: AssetHandle<MeshAsset>,
  material: AssetHandle<MaterialAsset>,
  at: Point3,
  size: Point3,
  casts: boolean,
  spin?: Point3,
): void {
  const entity = app.world.createEntity(name);
  entity.setParent(parent);
  entity.transform.localPosition.set(at.x, at.y, at.z);
  entity.transform.localScale.set(size.x, size.y, size.z);
  if (spin !== undefined) {
    entity.transform.localEulerAngles = spin;
  }
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: casts,
    receiveShadows: false,
    pickable: false,
  });
}
