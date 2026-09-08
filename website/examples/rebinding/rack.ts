import { clamp, createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import type { App, AssetHandle, ColorLike, Entity, InputAction, MaterialAsset, ScriptCallbacks } from "ignifx";

/**
 * The settings rack `rebinding` shows its bindings on, and the puck the four actions push around.
 *
 * The panel says what each action is bound to in words (`formatBindingPath`, the same helper
 * `@ignifx/ui`'s `Menu` uses). The rack says it in colour: **a key cap takes the colour of the
 * device family its binding now names**, so rebinding `hop` from the W key to a gamepad button
 * turns that cap from orange to green, and you can see a rebind land without reading anything.
 *
 * A cap lights up while its action is held, and pulses white while a rebind is listening for the
 * next control. The puck at the front is what the actions actually do, so a rebind can be felt as
 * well as seen.
 */

/** The site's dark palette (`website/plan/02-design-system.md` §2.3), decoded to sRGB `0…1`. */
const INK = {
  /** A plinth. */
  surface: { r: 0.098, g: 0.118, b: 0.153, a: 1 },
  /** A well: the puck's track. A shade above the clear colour, so it is a groove, not a hole. */
  sunk: { r: 0.055, g: 0.067, b: 0.088, a: 1 },
  /** A cap bound to nothing at all. */
  rule: { r: 0.235, g: 0.275, b: 0.337, a: 1 },
  /** White: the frame an action was pressed in, and the peak of the listening pulse. */
  hot: { r: 1, g: 1, b: 1, a: 1 },
} as const;

/**
 * The colour a cap takes for each device family, so a rebind is visible without a word of text.
 *
 * @remarks
 * Keyed by the `DeviceKind` names `@ignifx/input` uses in a binding path — `<Keyboard>/w` is the
 * `Keyboard` family — so a path this table does not know still gets a colour rather than nothing.
 */
const DEVICE_COLOURS: Readonly<Record<string, ColorLike>> = {
  /** `--flame`. */
  Keyboard: { r: 1, g: 0.62, b: 0.29, a: 1 },
  /** `--cool`. */
  Mouse: { r: 0.353, g: 0.82, b: 0.784, a: 1 },
  /** `--cool`, a shade down: the unified pointer is a mouse, a pen or the first touch. */
  Pointer: { r: 0.24, g: 0.62, b: 0.62, a: 1 },
  /** `--ok`. */
  Gamepad: { r: 0.357, g: 0.831, b: 0.541, a: 1 },
  /** `--warn`. */
  Touch: { r: 0.949, g: 0.757, b: 0.306, a: 1 },
};

/** How far apart the four plinths stand, in metres. */
const RACK_PITCH = 1.12;

/** Where the rack stands, in metres forward of the origin. */
const RACK_Z = 1.35;

/** How tall a plinth is, in metres. */
const PLINTH_HEIGHT = 0.72;

/** How fast a listening cap pulses, in cycles per second. */
const LISTEN_PULSE_HZ = 1.4;

/** How long a `wasPressedThisFrame` flash takes to fall back to the held colour, in seconds. */
const FLASH_SECONDS = 0.18;

/** The level a cap holds while its action is merely held. */
const HELD_LEVEL = 1;

/** The level a cap rests at: its device colour, dimmed. */
const REST_LEVEL = 0.42;

/** How many steps a level is quantised to before it is written. */
const LEVEL_STEPS = 48;

/** How far the puck may roll from the centre of its track, in metres. */
const TRACK_LIMIT = 2.15;

/** The puck's radius, in metres. */
const PUCK_RADIUS = 0.26;

/** One row of the rack: an action, its cap and the colour that cap currently rests at. */
interface Row {
  /** The action name, as `player.input.json` declares it. */
  readonly name: string;
  /** The action, or `null` when the document declares no such action. */
  readonly action: InputAction | null;
  /** The cap's material. */
  readonly material: AssetHandle<MaterialAsset>;
  /** The colour the cap rests at: the family of the binding it currently carries. */
  device: ColorLike;
  /** The last level written, quantised, so an idle cap uploads nothing. */
  written: number;
  /** Seconds of press flash left. */
  flash: number;
}

/** What one rack drives. */
interface Parts {
  /** The four rows, left to right. */
  readonly rows: readonly Row[];
  /** The puck the actions push. */
  readonly puck: Entity;
  /** Which row is listening for a control, or `""` when none is. */
  listening: string;
}

/**
 * Writes a cap's colour by blending its device colour towards white.
 *
 * @param row - The row to write.
 * @param level - How lit it is: `REST_LEVEL` at rest, `1` while pressed or at the pulse's peak.
 */
function setLevel(row: Row, level: number): void {
  const step = Math.round(clamp(level, 0, 1) * LEVEL_STEPS);
  if (step === row.written) {
    return;
  }
  row.written = step;
  // Below `REST_LEVEL` the cap fades towards black, above it towards white — so one number carries
  // both "this is a keyboard binding" and "this control is down right now".
  const t = step / LEVEL_STEPS;
  const from = t < REST_LEVEL ? { r: 0, g: 0, b: 0, a: 1 } : row.device;
  const to = t < REST_LEVEL ? row.device : INK.hot;
  const span = t < REST_LEVEL ? t / REST_LEVEL : (t - REST_LEVEL) / (1 - REST_LEVEL);
  row.material.value.setBaseColor({
    r: from.r + (to.r - from.r) * span,
    g: from.g + (to.g - from.g) * span,
    b: from.b + (to.b - from.b) * span,
    a: 1,
  });
}

/**
 * The colour a binding path implies.
 *
 * @param path - A binding path such as `<Keyboard>/w`, or `""` for an unbound binding.
 * @returns The device family's colour, or the neutral rule colour.
 */
export function colourForPath(path: string): ColorLike {
  const slash = path.indexOf("/");
  const device = slash > 0 ? path.slice(1, slash - 1) : "";
  return DEVICE_COLOURS[device] ?? INK.rule;
}

/**
 * Drives the rack: the caps' colours, the press flashes, the listening pulse and the puck.
 *
 * @remarks
 * A `Script`, so it runs in `Update` with everything else and the devtools inspector lists it.
 */
export class BindingRack extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "rebinding/BindingRack";

  #parts: Parts | null = null;

  /** The puck's speed along the track, in metres per second. */
  #speed = 0;

  /** The puck's vertical speed, in metres per second. */
  #lift = 0;

  /**
   * Hands the script the parts {@link attachRack} built.
   *
   * @param parts - The rack's rows and its puck.
   */
  install(parts: Parts): void {
    this.#parts = parts;
  }

  /**
   * Tells the rack which row is listening for a control, so its cap pulses.
   *
   * @param name - The action name, or `""` when no rebind is in flight.
   */
  setListening(name: string): void {
    if (this.#parts !== null) {
      this.#parts.listening = name;
    }
  }

  /**
   * Re-reads the colour every cap should rest at, after a rebind or a reset changed the bindings.
   *
   * @remarks
   * `binding.effectivePath` is the override when there is one and the document's path when there
   * is not, which is exactly what a settings row shows and exactly what this colours by.
   */
  refreshBindings(): void {
    const parts = this.#parts;
    if (parts === null) {
      return;
    }
    for (const row of parts.rows) {
      row.device = colourForPath(row.action?.bindings[0]?.effectivePath ?? "");
      // Forces the next `setLevel` to write, because the level may not have moved even though the
      // colour it interpolates between did.
      row.written = -1;
    }
  }

  /**
   * Lights the caps and moves the puck.
   *
   * @param dt - Seconds since the previous frame, scaled by `time.timeScale`. Under `?static=1` the
   * scale is zero, so the puck holds the pose this file authored and the pulse stands still.
   */
  update(dt: number): void {
    const parts = this.#parts;
    if (parts === null) {
      return;
    }
    const unscaled = this.app.time.unscaledDeltaTime;
    const pulse = 0.5 + 0.5 * Math.sin(this.app.time.time * LISTEN_PULSE_HZ * Math.PI * 2);
    for (const row of parts.rows) {
      updateRow(row, parts.listening === row.name, pulse, unscaled);
    }
    this.#movePuck(parts, dt);
  }

  /**
   * Rolls, hops and brakes the puck from the four actions.
   *
   * @param parts - The rack's parts.
   * @param dt - The scaled frame delta, in seconds.
   */
  #movePuck(parts: Parts, dt: number): void {
    const held = (name: string): boolean =>
      parts.rows.find((row: Row) => row.name === name)?.action?.isPressed === true;
    const push = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
    this.#speed += push * PUSH_METRES_PER_SECOND_SQUARED * dt;
    // Braking is a hard drag rather than a stop, so a tap slows the puck and a hold parks it.
    const drag = held("brake") ? BRAKE_DRAG : ROLL_DRAG;
    this.#speed -= this.#speed * Math.min(drag * dt, 1);
    this.#speed = clamp(this.#speed, -MAX_SPEED, MAX_SPEED);

    const position = parts.puck.transform.localPosition;
    position.x = clamp(position.x + this.#speed * dt, -TRACK_LIMIT, TRACK_LIMIT);
    if (Math.abs(position.x) >= TRACK_LIMIT) {
      this.#speed = 0;
    }
    const hop = parts.rows.find((row: Row) => row.name === "hop")?.action;
    if (hop?.wasPressedThisFrame === true && position.y <= PUCK_RADIUS + 0.001) {
      this.#lift = HOP_METRES_PER_SECOND;
    }
    if (this.#lift !== 0 || position.y > PUCK_RADIUS) {
      this.#lift -= GRAVITY * dt;
      position.y += this.#lift * dt;
      if (position.y <= PUCK_RADIUS) {
        position.y = PUCK_RADIUS;
        this.#lift = 0;
      }
    }
    // Rolling is the puck's own rotation about Z, so the direction reads even on a flat colour.
    parts.puck.transform.rotate({ x: 0, y: 0, z: (-this.#speed * dt * 180) / (Math.PI * PUCK_RADIUS) });
  }
}

/** How hard `left` and `right` push the puck, in metres per second squared. */
const PUSH_METRES_PER_SECOND_SQUARED = 6;

/** How fast the puck may roll, in metres per second. */
const MAX_SPEED = 3.2;

/** The drag a free-rolling puck feels, per second. */
const ROLL_DRAG = 0.9;

/** The drag `brake` adds, per second. */
const BRAKE_DRAG = 9;

/** The puck's upward speed at the start of a hop, in metres per second. */
const HOP_METRES_PER_SECOND = 3;

/** Downward acceleration, in metres per second squared. */
const GRAVITY = 9.5;

/**
 * Lights one cap.
 *
 * @param row - The row to update.
 * @param listening - Whether a rebind is waiting for this row's next control.
 * @param pulse - The listening pulse, `0` to `1`.
 * @param unscaled - The unscaled frame delta, in seconds.
 */
function updateRow(row: Row, listening: boolean, pulse: number, unscaled: number): void {
  if (row.action?.wasPressedThisFrame === true) {
    row.flash = FLASH_SECONDS;
  } else if (row.flash > 0) {
    row.flash = Math.max(row.flash - unscaled, 0);
  }
  if (listening) {
    setLevel(row, REST_LEVEL + (1 - REST_LEVEL) * pulse);
    return;
  }
  if (row.flash > 0 || row.action?.isPressed === true) {
    setLevel(row, HELD_LEVEL);
    return;
  }
  setLevel(row, REST_LEVEL);
}

/**
 * Builds an unlit material.
 *
 * @param app - The app the asset belongs to.
 * @param name - The material's name.
 * @param color - The colour it starts at.
 * @returns The handle, with one holder.
 */
function createInkMaterial(app: App, name: string, color: ColorLike): AssetHandle<MaterialAsset> {
  return createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: `rack/${name}`,
      baseColor: color,
      metallic: 0,
      roughness: 1,
      unlit: true,
      doubleSided: true,
    }),
    [],
  );
}

/** Where a part sits and how big it is, in metres. */
interface Placement {
  /** Metres along X. */
  readonly x: number;
  /** Metres along Y. */
  readonly y: number;
  /** Metres along Z. */
  readonly z: number;
  /** Scale along X. */
  readonly sx: number;
  /** Scale along Y. */
  readonly sy: number;
  /** Scale along Z. */
  readonly sz: number;
}

/**
 * Adds one part of the rack.
 *
 * @param app - The app.
 * @param name - The entity's name, which the devtools scene tree shows.
 * @param mesh - The template it clones.
 * @param material - The material it wears.
 * @param at - Where it sits and how big it is.
 * @param casts - Whether it casts a shadow.
 * @returns The entity.
 */
function addPart(
  app: App,
  name: string,
  mesh: AssetHandle<MeshAsset>,
  material: AssetHandle<MaterialAsset>,
  at: Placement,
  casts = false,
): Entity {
  const entity = app.world.createEntity(name);
  entity.transform.localPosition.set(at.x, at.y, at.z);
  entity.transform.localScale.set(at.sx, at.sy, at.sz);
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: casts,
    receiveShadows: false,
    pickable: false,
  });
  return entity;
}

/**
 * Builds the rack and the puck, and attaches the script that drives them.
 *
 * @param app - The running app; needs the `input()` extension and a loaded action document.
 * @param names - The four action names, left to right.
 * @returns The script, so the example can tell it what is listening and when a binding changed.
 *
 * @example
 * ```ts
 * const rack = attachRack(app, ["left", "right", "hop", "brake"]);
 * rack.setListening("hop");
 * ```
 */
export function attachRack(app: App, names: readonly string[]): BindingRack {
  app.registerComponents([BindingRack]);
  const box = MeshAsset.box(app, { size: 1 });
  const sphere = MeshAsset.sphere(app, { diameter: 1, segments: 20 });

  const rows: Row[] = names.map((name: string, index: number): Row => {
    const x = (index - (names.length - 1) / 2) * RACK_PITCH;
    addPart(app, `${name} plinth`, box, createInkMaterial(app, `${name} plinth`, INK.surface), {
      x,
      y: PLINTH_HEIGHT / 2,
      z: RACK_Z,
      sx: 0.5,
      sy: PLINTH_HEIGHT,
      sz: 0.5,
    });
    const material = createInkMaterial(app, `${name} cap`, INK.rule);
    addPart(app, `${name} cap`, box, material, {
      x,
      y: PLINTH_HEIGHT + 0.07,
      z: RACK_Z,
      sx: 0.48,
      sy: 0.14,
      sz: 0.48,
    });
    return {
      name,
      action: app.input.actions.find(name),
      material,
      device: INK.rule,
      written: -1,
      flash: 0,
    };
  });

  addPart(app, "Track", box, createInkMaterial(app, "track", INK.sunk), {
    x: 0,
    y: 0.015,
    z: -0.95,
    sx: TRACK_LIMIT * 2 + 0.7,
    sy: 0.03,
    sz: 0.66,
  });
  const puck = addPart(
    app,
    "Puck",
    sphere,
    createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: "rack/puck",
        baseColor: { r: 0.95, g: 0.45, b: 0.14, a: 1 },
        metallic: 0.2,
        roughness: 0.4,
      }),
      [],
    ),
    { x: 0, y: PUCK_RADIUS, z: -0.95, sx: PUCK_RADIUS * 2, sy: PUCK_RADIUS * 2, sz: PUCK_RADIUS * 2 },
    true,
  );

  const rack = app.world.createEntity("Rack").addComponent(BindingRack);
  rack.install({ rows, puck, listening: "" });
  rack.refreshBindings();
  return rack;
}
