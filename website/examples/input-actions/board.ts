import { clamp, createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import type { App, AssetHandle, ColorLike, Entity, InputAction, MaterialAsset, ScriptCallbacks } from "ignifx";

/**
 * The instrument board `input-actions` reads its own input on: a standing panel of unlit geometry
 * that shows every value `@ignifx/input` resolved this frame.
 *
 * It is geometry rather than DOM or text for three reasons, and they are the reasons a game's HUD
 * is usually geometry too:
 *
 * 1. The example's poster and its golden are captured with `?nopanel=1`, so anything that only
 *    exists in the kit's parameter panel is not in the picture. A board made of meshes is.
 * 2. `HudText` and `WorldText` need a `FontAsset`, and no font is vendored under
 *    `website/examples/assets/`. Shape and colour carry the meaning instead — which is why the
 *    keyboard cluster is drawn as **key caps in the WASD arrangement** rather than as labelled
 *    boxes: the shape is the label.
 * 3. The kit is the only part of an example that touches the DOM
 *    (`website/plan/04-examples-platform.md` §4). A board of entities keeps that true.
 *
 * ## Three mesh templates, thirty-odd elements
 *
 * A unit box, a unit sphere and a unit ring are built once and shared; every element scales the
 * template it points at. A `MeshAsset` is a template entities clone, so sharing is the ordinary
 * thing to do and it keeps the whole panel at three pieces of geometry.
 *
 * Materials are **not** shared, because a material is what an element lights up with.
 * `MaterialAsset.setBaseColor` marks one uniform block dirty and recompiles nothing
 * (`packages/core/src/render/material-asset.ts`), so a lamp costs a colour write — and
 * {@link setLevel} skips even that when the value has not moved, which is why a board with nothing
 * happening on it costs nothing at all.
 *
 * Every board material is `unlit`, so a lamp shows exactly the colour it was given whatever the
 * scene's lights are doing. That is what makes the golden reproducible.
 */

/** The site's dark palette (`website/plan/02-design-system.md` §2.3), decoded to sRGB `0…1`. */
const INK = {
  /**
   * The board's face. A step lighter than `--surface`, because the board is a small object in a
   * dark frame rather than a panel filling a screen, and the palette's own surface tone reads as
   * black at this size — measured by capturing the poster and looking at it.
   */
  surface: { r: 0.098, g: 0.118, b: 0.153, a: 1 },
  /** A well: a gate's plate, a bar's track. Darker than the face, so an element sits *in* it. */
  sunk: { r: 0.035, g: 0.043, b: 0.059, a: 1 },
  /** A key cap or a lamp at rest: light enough to read as an object that is currently off. */
  rule: { r: 0.235, g: 0.275, b: 0.337, a: 1 },
  /** A quiet mark: a ring, a dot at rest. */
  quiet: { r: 0.4, g: 0.451, b: 0.522, a: 1 },
  /** `--flame`: pressed, and the accent of the whole site. */
  flame: { r: 1, g: 0.62, b: 0.29, a: 1 },
  /** `--cool`: a resolved value — a stick dot, a bar fill. */
  cool: { r: 0.353, g: 0.82, b: 0.784, a: 1 },
  /** `--ok`: a device that is producing input, a map that is enabled. */
  ok: { r: 0.357, g: 0.831, b: 0.541, a: 1 },
  /** White: the frame `wasPressedThisFrame` is true in. */
  hot: { r: 1, g: 1, b: 1, a: 1 },
} as const;

/** The board's face, in metres: wide enough to read at 640×360, and 16:9 in shape. */
const FACE = { width: 5, height: 1.98, depth: 0.06 } as const;

/** A gate's face, in metres. */
const GATE_SIZE = 0.94;

/** How far a gate's dot travels for a value of 1, in metres. */
const GATE_REACH = 0.38;

/** A bar's track height, in metres. */
const BAR_HEIGHT = 0.9;

/** A bar's track width, in metres. */
const BAR_WIDTH = 0.22;

/** The smallest scale an element is given, so no transform is ever singular. */
const MIN_SCALE = 0.004;

/** How long a `wasPressedThisFrame` flash takes to fall back to the held colour, in seconds. */
const FLASH_SECONDS = 0.22;

/** How long a device lamp stays lit after that device last produced input, in seconds. */
const DEVICE_HOLD_SECONDS = 0.35;

/** The level a lamp holds while its action is merely held, under the white of a fresh press. */
const HELD_LEVEL = 0.58;

/** The level a device lamp holds while its device is present but quiet. */
const PRESENT_LEVEL = 0.36;

/** How many steps a level is quantised to before it is written. */
const LEVEL_STEPS = 48;

/** How tall the board's legs are, in metres. */
const LEG_HEIGHT = 0.3;

/** The map the gameplay actions live in; `System` holds the one action that switches it off. */
export const PLAYER_MAP = "Player";

/** Where the board stands, in world metres, and how far it leans back. */
export const BOARD_PLACEMENT = { x: 0, y: FACE.height / 2 + LEG_HEIGHT, z: 1.75, pitch: -6 } as const;

/** A point on the board's face, in board-local metres. */
interface Spot {
  /** Metres right of the board's centre. */
  readonly x: number;
  /** Metres above the board's centre. */
  readonly y: number;
}

/** A box on the board, in board-local metres. `z` is negative towards the camera. */
interface Box {
  /** Metres right of the board's centre. */
  readonly x: number;
  /** Metres above the board's centre. */
  readonly y: number;
  /** Metres towards the camera from the board's centre plane. */
  readonly z: number;
  /** Width, in metres. */
  readonly w: number;
  /** Height, in metres. */
  readonly h: number;
  /** Depth, in metres. */
  readonly d: number;
}

/** The three mesh templates every element shares. */
interface Shapes {
  /** A unit box: every plate, cap, track and fill. */
  readonly box: AssetHandle<MeshAsset>;
  /** A unit-diameter sphere: the gates' dots. */
  readonly sphere: AssetHandle<MeshAsset>;
  /** A unit-diameter ring, built in the XZ plane, so an element stands it up. */
  readonly ring: AssetHandle<MeshAsset>;
}

/** One element that changes colour: its own material, and the two colours it moves between. */
interface Lamp {
  /** The element's material. Nothing else uses it. */
  readonly material: AssetHandle<MaterialAsset>;
  /** The colour at level 0. */
  readonly off: ColorLike;
  /** The colour at level 1. */
  readonly on: ColorLike;
  /** The last level written, quantised, so an unchanged lamp costs nothing. */
  written: number;
}

/** One key cap: a lamp lit by whatever the cap's key contributes to an action. */
interface Cap {
  /** The cap's lamp. */
  readonly lamp: Lamp;
  /**
   * How lit the cap is, `0` to `1`.
   *
   * @returns The level.
   */
  readonly read: () => number;
}

/** One stick gate: a dot that tracks a `vector2` action inside its rings. */
interface Gate {
  /** The action the dot follows, or `null` when the document declares no such action. */
  readonly action: InputAction | null;
  /** The dot's entity, moved every frame. */
  readonly dot: Entity;
  /** The dot's lamp, lit by the action's magnitude. */
  readonly lamp: Lamp;
}

/** One bar: a fill that grows out of a track. */
interface Bar {
  /** The action the fill follows. */
  readonly action: InputAction | null;
  /** The fill's entity, scaled and moved every frame. */
  readonly fill: Entity;
  /** The fill's lamp. */
  readonly lamp: Lamp;
  /** The track's centre, in board-local metres above the board's centre. */
  readonly centreY: number;
  /** Whether the fill grows out of the track's centre in both directions. */
  readonly bipolar: boolean;
}

/** One button lamp, and the flash it carries after a press. */
interface Button {
  /** The action it watches. */
  readonly action: InputAction | null;
  /** The lamp. */
  readonly lamp: Lamp;
  /** Seconds of flash left, counted down on the unscaled clock. */
  flash: number;
}

/** Which device family a lamp watches. */
type DeviceRow = "keyboard" | "mouse" | "pointer" | "touch" | "gamepad";

/** One device lamp: dim while its device is present, bright while it is producing input. */
interface DeviceLamp {
  /** The family it watches. */
  readonly row: DeviceRow;
  /** The lamp. */
  readonly lamp: Lamp;
  /** Seconds of hold left, so a keystroke reads rather than blinking for one frame. */
  hold: number;
}

/** One control-scheme lamp, lit while `app.input.currentScheme` names it. */
interface SchemeLamp {
  /** The scheme's name, as the document declares it. */
  readonly name: string;
  /** The lamp. */
  readonly lamp: Lamp;
}

/** Which device families produced input in one frame. */
interface Activity {
  /** A `keydown` or `keyup` arrived. */
  keyboard: boolean;
  /** A pointer event from a mouse, or a wheel, arrived. */
  mouse: boolean;
  /** Any pointer event arrived; every pointing device feeds `<Pointer>`. */
  pointer: boolean;
  /** A pointer event from a touch arrived. */
  touch: boolean;
  /** A connected pad is holding something down. Pads are polled, not evented. */
  gamepad: boolean;
}

/** The elements one board is made of, in the order the update walks them. */
interface Elements {
  /** The WASD cluster, the shift cap and the space bar. */
  readonly caps: readonly Cap[];
  /** The two stick gates: `move` and `look`. */
  readonly gates: readonly Gate[];
  /** The two bars: `boost` and `spin`. */
  readonly bars: readonly Bar[];
  /** The four button lamps. */
  readonly buttons: readonly Button[];
  /** One lamp per device family. */
  readonly devices: readonly DeviceLamp[];
  /** One lamp per control scheme, in the document's order. */
  readonly schemes: readonly SchemeLamp[];
  /** The lamp that says whether the `Player` map is enabled. */
  readonly mapLamp: Lamp;
}

/**
 * Writes a lamp's colour for a level in `0…1`.
 *
 * @remarks
 * Quantised to {@link LEVEL_STEPS} and skipped when the quantised level has not moved. A material
 * write marks a uniform block dirty and uploads it, so a still board should cost nothing — which is
 * what keeps this example inside its frame budget with thirty elements on screen.
 *
 * @param lamp - The lamp to write.
 * @param level - How lit it is, `0` to `1`.
 */
function setLevel(lamp: Lamp, level: number): void {
  const step = Math.round(clamp(level, 0, 1) * LEVEL_STEPS);
  if (step === lamp.written) {
    return;
  }
  lamp.written = step;
  const t = step / LEVEL_STEPS;
  lamp.material.value.setBaseColor({
    r: lamp.off.r + (lamp.on.r - lamp.off.r) * t,
    g: lamp.off.g + (lamp.on.g - lamp.off.g) * t,
    b: lamp.off.b + (lamp.on.b - lamp.off.b) * t,
    a: 1,
  });
}

/**
 * Builds an unlit material for one board element.
 *
 * @param app - The app the asset belongs to.
 * @param name - The material's name, which the devtools inspector shows.
 * @param color - The colour it starts at.
 * @returns The handle, with one holder.
 */
function createInkMaterial(app: App, name: string, color: ColorLike): AssetHandle<MaterialAsset> {
  return createMaterialAsset(
    app,
    // `unlit` so the colour written is the colour drawn, and `doubleSided` so nothing depends on
    // which way a shared template's winding happens to face.
    pbrMaterialDefinition({
      name: `board/${name}`,
      baseColor: color,
      metallic: 0,
      roughness: 1,
      unlit: true,
      doubleSided: true,
    }),
    [],
  );
}

/**
 * Adds one box to the board.
 *
 * @param app - The app the entity and its material belong to.
 * @param parent - The entity the box is parented to.
 * @param shapes - The shared templates.
 * @param name - The entity's name, which is what the devtools scene tree shows.
 * @param box - Where it sits and how big it is, in the parent's metres.
 * @param color - Its colour.
 * @returns The entity and its own material.
 */
function addBox(
  app: App,
  parent: Entity,
  shapes: Shapes,
  name: string,
  box: Box,
  color: ColorLike,
): { readonly entity: Entity; readonly material: AssetHandle<MaterialAsset> } {
  const material = createInkMaterial(app, name, color);
  const entity = app.world.createEntity(name);
  entity.setParent(parent);
  entity.transform.localPosition.set(box.x, box.y, box.z);
  entity.transform.localScale.set(box.w, box.h, box.d);
  entity.addComponent(MeshRenderer, {
    mesh: shapes.box,
    materials: [material],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
  return { entity, material };
}

/**
 * Adds one lamp: a box that changes colour.
 *
 * @param app - The app.
 * @param parent - The board.
 * @param shapes - The shared templates.
 * @param name - The entity's name.
 * @param box - Where it sits and how big it is.
 * @param off - The colour at level 0.
 * @param on - The colour at level 1.
 * @returns The lamp.
 */
function addLamp(
  app: App,
  parent: Entity,
  shapes: Shapes,
  name: string,
  box: Box,
  off: ColorLike,
  on: ColorLike,
): Lamp {
  return { material: addBox(app, parent, shapes, name, box, off).material, off, on, written: 0 };
}

/**
 * Adds one ring, standing in the board's face rather than lying in the ground.
 *
 * @param app - The app.
 * @param parent - The gate's group.
 * @param shapes - The shared templates.
 * @param name - The entity's name.
 * @param diameter - The ring's diameter, in metres.
 * @param color - Its colour.
 */
function addRing(app: App, parent: Entity, shapes: Shapes, name: string, diameter: number, color: ColorLike): void {
  const entity = app.world.createEntity(name);
  entity.setParent(parent);
  // `MeshAsset.torus` is built in the XZ plane — it lies flat, the way the ground does — so a
  // quarter turn about X is what stands it up in the face.
  entity.transform.localEulerAngles = { x: 90, y: 0, z: 0 };
  entity.transform.localScale.set(diameter, 0.05, diameter);
  entity.transform.localPosition.set(0, 0, -0.03);
  entity.addComponent(MeshRenderer, {
    mesh: shapes.ring,
    materials: [createInkMaterial(app, name, color)],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
}

/**
 * Builds one stick gate: a plate, a ring at a value of 1, an optional dead-zone ring, and a dot.
 *
 * @param app - The app.
 * @param parent - The board.
 * @param shapes - The shared templates.
 * @param name - The gate's name, used for its entities.
 * @param at - The gate's centre on the face, in board-local metres.
 * @param action - The `vector2` action the dot follows.
 * @param deadzone - The dead zone the action's processors apply, as a fraction of a value of 1;
 * `0` draws no inner ring.
 * @returns The gate.
 */
function addGate(
  app: App,
  parent: Entity,
  shapes: Shapes,
  name: string,
  at: Spot,
  action: InputAction | null,
  deadzone: number,
): Gate {
  // A group at scale 1, so every child below is stated in metres. A gate's plate is a sibling of
  // its rings rather than their parent, because a non-uniform parent scale distorts a rotated child
  // and the rings are rotated.
  const group = app.world.createEntity(`${name} gate`);
  group.setParent(parent);
  group.transform.localPosition.set(at.x, at.y, -FACE.depth / 2);
  addBox(app, group, shapes, `${name} plate`, { x: 0, y: 0, z: -0.015, w: GATE_SIZE, h: GATE_SIZE, d: 0.03 }, INK.sunk);
  addRing(app, group, shapes, `${name} unit ring`, GATE_REACH * 2, INK.rule);
  if (deadzone > 0) {
    addRing(app, group, shapes, `${name} dead zone`, GATE_REACH * 2 * deadzone, INK.quiet);
  }
  const material = createInkMaterial(app, `${name} dot`, INK.quiet);
  const dot = app.world.createEntity(`${name} dot`);
  dot.setParent(group);
  dot.transform.localScale.set(0.15, 0.15, 0.15);
  dot.transform.localPosition.set(0, 0, -0.09);
  dot.addComponent(MeshRenderer, {
    mesh: shapes.sphere,
    materials: [material],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
  return { action, dot, lamp: { material, off: INK.quiet, on: INK.cool, written: 0 } };
}

/**
 * Builds one bar: a sunk track with a fill in front of it.
 *
 * @param app - The app.
 * @param parent - The board.
 * @param shapes - The shared templates.
 * @param name - The bar's name.
 * @param at - The track's centre on the face, in board-local metres.
 * @param action - The action the fill follows.
 * @param bipolar - Whether the fill grows out of the track's centre in both directions.
 * @returns The bar.
 */
function addBar(
  app: App,
  parent: Entity,
  shapes: Shapes,
  name: string,
  at: Spot,
  action: InputAction | null,
  bipolar: boolean,
): Bar {
  const face = -FACE.depth / 2;
  addBox(
    app,
    parent,
    shapes,
    `${name} track`,
    { x: at.x, y: at.y, z: face - 0.015, w: BAR_WIDTH, h: BAR_HEIGHT, d: 0.03 },
    INK.sunk,
  );
  const material = createInkMaterial(app, `${name} fill`, INK.quiet);
  const fill = app.world.createEntity(`${name} fill`);
  fill.setParent(parent);
  fill.transform.localPosition.set(at.x, at.y - BAR_HEIGHT / 2, face - 0.05);
  fill.transform.localScale.set(BAR_WIDTH * 0.6, MIN_SCALE, 0.06);
  fill.addComponent(MeshRenderer, {
    mesh: shapes.box,
    materials: [material],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
  return { action, fill, lamp: { material, off: INK.quiet, on: INK.cool, written: 0 }, centreY: at.y, bipolar };
}

/**
 * The board's per-frame update: read the actions, write the geometry.
 *
 * @remarks
 * A `Script`, so it runs in `Update` with everything else and the devtools inspector lists it. Its
 * actions were looked up once with `app.input.actions.find`, which searches **every** map rather
 * than only the enabled ones — a held action whose map has been disabled reads as released, which
 * is exactly what the board should show when Escape has taken the `Player` map away.
 */
export class ActionBoard extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "input-actions/ActionBoard";

  #elements: Elements | null = null;

  /** Reused every frame, so the per-frame path allocates nothing (coding standards §7). */
  readonly #activity: Activity = { keyboard: false, mouse: false, pointer: false, touch: false, gamepad: false };

  /**
   * Hands the script the elements {@link attachBoard} built.
   *
   * @param elements - The board's elements.
   */
  install(elements: Elements): void {
    this.#elements = elements;
  }

  /**
   * Reads this frame's input and writes it onto the board.
   *
   * @remarks
   * Nothing here is integrated, so the scaled delta is not needed: the flashes and the device holds
   * run on `time.unscaledDeltaTime`, which keeps them decaying while the game is slowed and stops
   * them dead under `?static=1`, where the clock is frozen before the first frame.
   */
  update(): void {
    const elements = this.#elements;
    if (elements === null) {
      return;
    }
    const unscaled = this.app.time.unscaledDeltaTime;
    this.#readActivity();
    for (const cap of elements.caps) {
      setLevel(cap.lamp, cap.read());
    }
    for (const gate of elements.gates) {
      updateGate(gate);
    }
    for (const bar of elements.bars) {
      updateBar(bar);
    }
    for (const button of elements.buttons) {
      updateButton(button, unscaled);
    }
    for (const device of elements.devices) {
      this.#updateDevice(device, unscaled);
    }
    const current = this.app.input.currentScheme;
    for (const scheme of elements.schemes) {
      setLevel(scheme.lamp, scheme.name === current ? 1 : 0);
    }
    setLevel(elements.mapLamp, this.app.input.actions.map(PLAYER_MAP).enabled ? 1 : 0);
  }

  /**
   * Fills {@link ActionBoard.#activity} from this frame's raw events and the polled pads.
   *
   * @remarks
   * `app.input.events` is the frame's event list in arrival order, and its records are **pooled** —
   * valid for the frame and recycled after it — so this reads them and keeps none. Whether a device
   * is present is a different question, and a duller one: a keyboard always is, and what a visitor
   * wants to see is which device the input they just gave came from.
   */
  #readActivity(): void {
    const activity = this.#activity;
    activity.keyboard = false;
    activity.mouse = false;
    activity.pointer = false;
    activity.touch = false;
    activity.gamepad = false;
    const events = this.app.input.events;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event === undefined) {
        continue;
      }
      if (event.type === "keydown" || event.type === "keyup") {
        activity.keyboard = true;
        continue;
      }
      if (event.type === "wheel") {
        activity.mouse = true;
        continue;
      }
      activity.pointer = true;
      if (event.pointerType === "touch") {
        activity.touch = true;
      } else {
        activity.mouse = true;
      }
    }
    const pads = this.app.input.gamepads;
    for (let slot = 0; slot < pads.length; slot += 1) {
      const pad = pads[slot];
      if (pad === undefined || !pad.isConnected) {
        continue;
      }
      const controls = pad.controls;
      for (let index = 0; index < controls.length; index += 1) {
        const control = controls[index];
        if (control !== undefined && pad.valueAt(control.offset) !== 0) {
          activity.gamepad = true;
          break;
        }
      }
    }
  }

  /**
   * Lights one device lamp.
   *
   * @param device - The device lamp to update.
   * @param unscaled - The unscaled frame delta, in seconds.
   */
  #updateDevice(device: DeviceLamp, unscaled: number): void {
    if (this.#activity[device.row]) {
      device.hold = DEVICE_HOLD_SECONDS;
    } else if (device.hold > 0) {
      device.hold = Math.max(device.hold - unscaled, 0);
    }
    if (device.hold > 0) {
      setLevel(device.lamp, 1);
      return;
    }
    const present = device.row === "gamepad" ? this.#anyPadConnected() : true;
    setLevel(device.lamp, present ? PRESENT_LEVEL : 0);
  }

  /**
   * Whether any gamepad slot is filled.
   *
   * @returns `true` when a pad has announced itself. A browser hides a pad until a button is
   * pressed on it, so this starts `false` even with a pad plugged in.
   */
  #anyPadConnected(): boolean {
    const pads = this.app.input.gamepads;
    for (let slot = 0; slot < pads.length; slot += 1) {
      if (pads[slot]?.isConnected === true) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Moves one gate's dot and lights it by the action's magnitude.
 *
 * @param gate - The gate to update.
 */
function updateGate(gate: Gate): void {
  const action = gate.action;
  const x = action === null ? 0 : clamp(action.vector.x, -1, 1);
  const y = action === null ? 0 : clamp(action.vector.y, -1, 1);
  gate.dot.transform.localPosition.set(x * GATE_REACH, y * GATE_REACH, -0.09);
  setLevel(gate.lamp, Math.hypot(x, y));
}

/**
 * Scales and places one bar's fill.
 *
 * @param bar - The bar to update.
 */
function updateBar(bar: Bar): void {
  const value = clamp(bar.action?.axis ?? 0, -1, 1);
  if (bar.bipolar) {
    // A bipolar fill grows out of the middle of its track, which is what an axis from two keys
    // looks like: Q one way, E the other, nothing in the middle.
    const height = Math.max(Math.abs(value) * (BAR_HEIGHT / 2), MIN_SCALE);
    bar.fill.transform.localScale.set(BAR_WIDTH * 0.6, height, 0.06);
    bar.fill.transform.localPosition.y = bar.centreY + Math.sign(value) * (height / 2);
  } else {
    const height = Math.max(value * BAR_HEIGHT, MIN_SCALE);
    bar.fill.transform.localScale.set(BAR_WIDTH * 0.6, height, 0.06);
    bar.fill.transform.localPosition.y = bar.centreY - BAR_HEIGHT / 2 + height / 2;
  }
  setLevel(bar.lamp, Math.abs(value));
}

/**
 * Lights one button lamp, and flashes it white for {@link FLASH_SECONDS} after the press frame.
 *
 * @param button - The button to update.
 * @param unscaled - The unscaled frame delta, in seconds.
 */
function updateButton(button: Button, unscaled: number): void {
  const action = button.action;
  if (action !== null && action.wasPressedThisFrame) {
    button.flash = FLASH_SECONDS;
  } else if (button.flash > 0) {
    button.flash = Math.max(button.flash - unscaled, 0);
  }
  if (button.flash > 0) {
    setLevel(button.lamp, 1);
    return;
  }
  setLevel(button.lamp, action?.isPressed === true ? HELD_LEVEL : 0);
}

/**
 * Clamps a signed axis to the positive half: what one key of a `2DVector` composite contributes.
 *
 * @param value - The axis value.
 * @returns `0` for a negative value, the clamped value for a positive one.
 */
function positive(value: number): number {
  return value > 0 ? Math.min(value, 1) : 0;
}

/**
 * Whether an action is held, as a level.
 *
 * @param action - The action, or `null`.
 * @returns `1` while it is pressed.
 */
function held(action: InputAction | null): number {
  return action?.isPressed === true ? 1 : 0;
}

/**
 * Builds the key-cap cluster: WASD in its cross, a shift cap and a space bar under it.
 *
 * @remarks
 * The caps are lit from the **actions**, not from the raw keys: W is lit by whatever `move` resolved
 * upwards this frame, which is why pushing a gamepad stick forward lights the W cap too. That is
 * the whole idea of an action map — the game asks for `"move"`, and the cluster is one view of it.
 *
 * @param app - The app.
 * @param parent - The board.
 * @param shapes - The shared templates.
 * @param move - The `move` action.
 * @param boost - The `boost` action, on the shift cap.
 * @param jump - The `jump` action, on the space bar.
 * @returns The caps, in reading order.
 */
function addCaps(
  app: App,
  parent: Entity,
  shapes: Shapes,
  move: InputAction | null,
  boost: InputAction | null,
  jump: InputAction | null,
): readonly Cap[] {
  const z = -FACE.depth / 2 - 0.055;
  const cap = (name: string, x: number, y: number, w: number, read: () => number): Cap => ({
    lamp: addLamp(app, parent, shapes, `${name} key`, { x, y, z, w, h: 0.3, d: 0.11 }, INK.rule, INK.flame),
    read,
  });
  return [
    cap("W", -1.74, 0.64, 0.3, (): number => positive(move?.vector.y ?? 0)),
    cap("A", -2.1, 0.28, 0.3, (): number => positive(-(move?.vector.x ?? 0))),
    cap("S", -1.74, 0.28, 0.3, (): number => positive(-(move?.vector.y ?? 0))),
    cap("D", -1.38, 0.28, 0.3, (): number => positive(move?.vector.x ?? 0)),
    cap("Shift", -2.11, -0.14, 0.66, (): number => clamp(boost?.axis ?? 0, 0, 1)),
    cap("Space", -1.33, -0.14, 0.84, (): number => held(jump)),
  ];
}

/**
 * Builds the device row: one lamp per device family `@ignifx/input` has, left to right.
 *
 * @param app - The app.
 * @param parent - The board.
 * @param shapes - The shared templates.
 * @returns The five lamps.
 */
function addDeviceLamps(app: App, parent: Entity, shapes: Shapes): readonly DeviceLamp[] {
  const rows: readonly DeviceRow[] = ["keyboard", "mouse", "pointer", "touch", "gamepad"];
  const z = -FACE.depth / 2 - 0.06;
  return rows.map((row: DeviceRow, index: number): DeviceLamp => {
    const name = `${row.charAt(0).toUpperCase()}${row.slice(1)}`;
    return {
      row,
      lamp: addLamp(
        app,
        parent,
        shapes,
        `${name} device`,
        { x: -2.16 + index * 0.44, y: -0.7, z, w: 0.38, h: 0.3, d: 0.07 },
        INK.rule,
        INK.ok,
      ),
      hold: 0,
    };
  });
}

/**
 * Builds the scheme row: one lamp per control scheme the document declares.
 *
 * @remarks
 * `app.input.controlSchemes` is the document's own list, so this row is whatever the `.input.json`
 * says and nothing is hard-coded here. The active scheme follows the device that produced input
 * last, which is what a HUD reads to choose its glyphs.
 *
 * @param app - The app.
 * @param parent - The board.
 * @param shapes - The shared templates.
 * @returns One lamp per scheme, in the document's order.
 */
function addSchemeLamps(app: App, parent: Entity, shapes: Shapes): readonly SchemeLamp[] {
  const z = -FACE.depth / 2 - 0.06;
  return app.input.controlSchemes.map((scheme, index): SchemeLamp => ({
    name: scheme.name,
    lamp: addLamp(
      app,
      parent,
      shapes,
      `${scheme.name} scheme`,
      { x: 1.0 + index * 0.58, y: -0.7, z, w: 0.52, h: 0.3, d: 0.07 },
      INK.rule,
      INK.flame,
    ),
  }));
}

/**
 * Builds the board and attaches the script that drives it.
 *
 * @remarks
 * One call, the way the kit's `attachOrbit` is one call. Every action is looked up **once**, here,
 * because `find` walks the map table and the update runs sixty times a second — and because a name
 * the `.input.json` does not declare should read as `null` from the start rather than as a lookup
 * that fails every frame.
 *
 * @param app - The running app; needs the `input()` extension and a loaded action document.
 * @returns The board's root entity, so a caller can move or hide it.
 *
 * @example
 * ```ts
 * app.input.loadActions(actions);
 * const board = attachBoard(app);
 * ```
 */
export function attachBoard(app: App): Entity {
  app.registerComponents([ActionBoard]);
  const shapes: Shapes = {
    box: MeshAsset.box(app, { size: 1 }),
    sphere: MeshAsset.sphere(app, { diameter: 1, segments: 12 }),
    ring: MeshAsset.torus(app, { diameter: 1, thickness: 0.075, tessellation: 32 }),
  };

  const root = app.world.createEntity("Board");
  root.transform.localPosition.set(BOARD_PLACEMENT.x, BOARD_PLACEMENT.y, BOARD_PLACEMENT.z);
  root.transform.localEulerAngles = { x: BOARD_PLACEMENT.pitch, y: 0, z: 0 };
  addBox(app, root, shapes, "Face", { x: 0, y: 0, z: 0, w: FACE.width, h: FACE.height, d: FACE.depth }, INK.surface);
  // Two legs, so the panel stands on the pad rather than floating over it. `BOARD_PLACEMENT.y` is
  // half the face plus this height, which is what puts their feet on the ground.
  for (const side of [-1, 1]) {
    addBox(
      app,
      root,
      shapes,
      side < 0 ? "Leg left" : "Leg right",
      { x: side * 2.16, y: -(FACE.height + LEG_HEIGHT) / 2, z: 0, w: 0.14, h: LEG_HEIGHT, d: 0.14 },
      INK.rule,
    );
  }

  // A sunk strip under the status row, so its lamps read against a well rather than against the
  // face they are almost the same size as.
  addBox(
    app,
    root,
    shapes,
    "Status well",
    { x: 0, y: -0.7, z: -FACE.depth / 2 - 0.015, w: FACE.width - 0.36, h: 0.44, d: 0.03 },
    INK.sunk,
  );

  const find = (name: string): InputAction | null => app.input.actions.find(name);
  const move = find("move");
  const jump = find("jump");
  const boost = find("boost");
  const buttonZ = -FACE.depth / 2 - 0.045;
  const buttonBox = (x: number, y: number): Box => ({ x, y, z: buttonZ, w: 0.32, h: 0.32, d: 0.09 });
  const buttonLamp = (name: string, x: number, y: number): Lamp =>
    addLamp(app, root, shapes, `${name} lamp`, buttonBox(x, y), INK.rule, INK.hot);

  const elements: Elements = {
    caps: addCaps(app, root, shapes, move, boost, jump),
    gates: [
      addGate(app, root, shapes, "Move", { x: -0.5, y: 0.22 }, move, 0.2),
      addGate(app, root, shapes, "Look", { x: 0.52, y: 0.22 }, find("look"), 0.15),
    ],
    bars: [
      addBar(app, root, shapes, "Boost", { x: 1.16, y: 0.22 }, boost, false),
      addBar(app, root, shapes, "Spin", { x: 1.46, y: 0.22 }, find("spin"), true),
    ],
    buttons: [
      { action: jump, lamp: buttonLamp("Jump", 1.84, 0.47), flash: 0 },
      { action: find("fire"), lamp: buttonLamp("Fire", 2.22, 0.47), flash: 0 },
      { action: find("sprint"), lamp: buttonLamp("Sprint", 1.84, 0.07), flash: 0 },
      { action: find("toggleMap"), lamp: buttonLamp("Escape", 2.22, 0.07), flash: 0 },
    ],
    devices: addDeviceLamps(app, root, shapes),
    schemes: addSchemeLamps(app, root, shapes),
    mapLamp: addLamp(
      app,
      root,
      shapes,
      "Player map",
      { x: 0.2, y: -0.7, z: -FACE.depth / 2 - 0.06, w: 0.72, h: 0.3, d: 0.07 },
      INK.rule,
      INK.ok,
    ),
  };
  root.addComponent(ActionBoard).install(elements);
  return root;
}
