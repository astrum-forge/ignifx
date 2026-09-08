import {
  clamp,
  createMaterialAsset,
  createRay,
  defineInputActions,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  Script,
} from "ignifx";
import type {
  App,
  AssetHandle,
  AudioBus,
  Camera,
  ColorLike,
  Entity,
  InputAction,
  InputActionsDefinition,
  MaterialAsset,
  Ray,
  ScriptCallbacks,
} from "ignifx";

/**
 * The mixing desk `audio-mixer` is operated on: four faders that are the four buses of
 * `game.audio.json`, five pads that fire the sounds, and a ring on the floor that is the browser's
 * autoplay lock.
 *
 * Everything here is geometry, for the reason the example's poster gives away: the poster and the
 * golden are captured with `?nopanel=1`, so a mixer that only existed in the kit's parameter panel
 * would not be in the picture. The panel keeps the numbers; this keeps the instrument.
 *
 * ## What each part reads
 *
 * | Part            | Reads                                                                    |
 * | --------------- | ------------------------------------------------------------------------ |
 * | Fader knob      | `bus.volume` — the bus's **own** gain, which is what a fader is          |
 * | Fader fill      | The same, drawn from the plinth up to the knob                            |
 * | Signal lamp     | `bus.effectiveVolume` — own gain times every parent's — while it is busy |
 * | Knob colour     | `bus.muted`                                                               |
 * | Rails           | Nothing. They are the tree: three children into one root                  |
 * | Floor ring      | `app.audio.state`, pulsing while it reads `"locked"`                      |
 *
 * Turning `Master` down dims all four signal lamps while the three faders stay where they are,
 * which is the difference between `volume` and `effectiveVolume` made visible.
 *
 * ## Clicks, and why a click is not a press
 *
 * The camera is the kit's orbit camera, which drags on `<Pointer>/press` — so a pad that fired on
 * press would fire every time the visitor turned the scene. A click is therefore a press and a
 * release with less than {@link CLICK_SLOP} backing-store pixels between them, which is what a
 * game does and what makes both gestures usable on a touch screen.
 */

/** The site's dark palette (`website/plan/02-design-system.md` §2.3), decoded to sRGB `0…1`. */
const INK = {
  /** A plinth: a step lighter than the palette's `--surface`, which reads as black at this size. */
  surface: { r: 0.098, g: 0.118, b: 0.153, a: 1 },
  /** A well: a fader's track, a pad's rim. Darker than the floor, so a knob sits *in* it. */
  sunk: { r: 0.035, g: 0.043, b: 0.059, a: 1 },
  /** A knob at rest, before its accent is written over it. */
  rule: { r: 0.235, g: 0.275, b: 0.337, a: 1 },
  /** A quiet mark: a rail, a lamp that is off. */
  quiet: { r: 0.4, g: 0.451, b: 0.522, a: 1 },
  /** `--flame`: the Music bus and its pad. */
  flame: { r: 1, g: 0.62, b: 0.29, a: 1 },
  /** `--cool`: the SFX bus, its pads, and every fader's fill. */
  cool: { r: 0.353, g: 0.82, b: 0.784, a: 1 },
  /** `--ok`: the Master bus, and the floor ring once the audio context is running. */
  ok: { r: 0.357, g: 0.831, b: 0.541, a: 1 },
  /** `--warn`: the UI bus, its pad, and the floor ring while the audio is locked. */
  warn: { r: 0.949, g: 0.757, b: 0.306, a: 1 },
  /** A muted fader knob. */
  muted: { r: 0.55, g: 0.16, b: 0.16, a: 1 },
  /** White: the frame a pad was clicked in. */
  hot: { r: 1, g: 1, b: 1, a: 1 },
} as const;

/** How far a pointer may travel between press and release and still count as a click, in pixels. */
const CLICK_SLOP = 12;

/** A fader's travel, in metres: the length of its track. */
const FADER_TRAVEL = 0.9;

/** A fader's track width, in metres. */
const FADER_WIDTH = 0.13;

/** How high a fader's track starts above the floor, in metres. */
const FADER_BASE = 0.07;

/** A pad's diameter, in metres. */
const PAD_DIAMETER = 0.56;

/** How long a pad stays lit after it was clicked, in seconds. */
const PAD_FLASH_SECONDS = 0.18;

/** How long a bus's signal lamp stays lit after something played on it, in seconds. */
const SIGNAL_SECONDS = 0.32;

/** How fast the floor ring pulses while the audio is locked, in cycles per second. */
const LOCK_PULSE_HZ = 0.6;

/** The smallest scale an element is given, so no transform is ever singular. */
const MIN_SCALE = 0.004;

/** How many steps a level is quantised to before it is written. */
const LEVEL_STEPS = 48;

/** The action map the desk reads its clicks from. Its own name, so the kit's `KitOrbit` is intact. */
export const MIXER_ACTION_MAP = "AudioMixer";

/** Which pad was clicked. */
export type PadId = "click" | "jump" | "land" | "music" | "pickup";

/** What the desk asks the example to do when a pad is clicked. */
export interface MixerHooks {
  /**
   * Plays whatever that pad plays.
   *
   * @param pad - The pad that was clicked.
   */
  readonly play: (pad: PadId) => void;
  /**
   * Toggles a bus's mute, when a fader knob is clicked.
   *
   * @param bus - The bus name.
   */
  readonly toggleMute: (bus: string) => void;
}

/** The actions the desk binds: one press and one position, both from the unified pointer. */
export const MIXER_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: MIXER_ACTION_MAP,
      actions: [
        { name: "deskPress", type: "button", bindings: [{ path: "<Pointer>/press" }] },
        { name: "deskPointer", type: "vector2", bindings: [{ path: "<Pointer>/position" }] },
      ],
    },
  ],
});

/** One element that changes colour. */
interface Lamp {
  /** The element's own material. */
  readonly material: AssetHandle<MaterialAsset>;
  /** The colour at level 0. */
  readonly off: ColorLike;
  /** The colour at level 1. */
  readonly on: ColorLike;
  /** The last level written, quantised, so an unchanged lamp costs nothing. */
  written: number;
}

/** One fader: the bus it is, the knob that shows its gain, and the lamp that shows its signal. */
interface Fader {
  /** The bus name, as `game.audio.json` declares it. */
  readonly name: string;
  /** The bus, or `null` when the tree does not declare it. */
  readonly bus: AudioBus | null;
  /** The knob, slid up the track by the bus's own gain. */
  readonly knob: Entity;
  /** The track behind it; clickable too, so the whole fader mutes its bus. */
  readonly track: Entity;
  /** The knob's lamp: the bus's accent, or red when the bus is muted. */
  readonly knobLamp: Lamp;
  /** The fill under the knob. */
  readonly fill: Entity;
  /** The fill's lamp. */
  readonly fillLamp: Lamp;
  /** The lamp on top, lit by `effectiveVolume` while the bus is busy. */
  readonly signal: Lamp;
  /** Where the track starts above the floor, in metres: `FADER_BASE` plus the fader's own lift. */
  readonly base: number;
  /** Seconds of signal left, counted down on the unscaled clock. */
  busy: number;
}

/** One pad: a drum you click to fire a sound. */
interface Pad {
  /** Which pad it is. */
  readonly id: PadId;
  /** The bus the sound it fires is routed to, so a click can light the right lamps. */
  readonly bus: string;
  /** The disc's lamp. */
  readonly lamp: Lamp;
  /** Seconds of flash left. */
  flash: number;
  /** Whether the pad is a latch that is currently on, which is how the music pad reads. */
  latched: boolean;
}

/** The parts one desk is made of. */
interface Parts {
  /** The four faders, left to right, root last. */
  readonly faders: readonly Fader[];
  /** The five pads, left to right. */
  readonly pads: readonly Pad[];
  /** The ring on the floor: the autoplay lock. */
  readonly ring: Lamp;
  /** Which entity does what when it is clicked. */
  readonly targets: ReadonlyMap<Entity, () => void>;
  /** The camera the click's ray is cast through. */
  readonly camera: Camera;
  /** The press action. */
  readonly press: InputAction | null;
  /** The pointer-position action, in backing-store pixels. */
  readonly pointer: InputAction | null;
}

/**
 * Writes a lamp's colour for a level in `0…1`.
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
 * A dark shade of one colour: what a lamp of that colour looks like switched off.
 *
 * @remarks
 * Lamps rest at a shade of their **own** accent rather than at one neutral grey, because a level
 * between a blue-grey and an orange passes through mud, and half the desk sits at a level between
 * the two most of the time.
 *
 * @param color - The accent.
 * @param scale - How much of it is left; `0.22` is the resting shade.
 * @returns The darkened colour, opaque.
 */
function shade(color: ColorLike, scale: number): ColorLike {
  return { r: color.r * scale, g: color.g * scale, b: color.b * scale, a: 1 };
}

/**
 * The colour a bus's accent is.
 *
 * @param name - The bus name.
 * @returns Its accent colour.
 */
function accentOf(name: string): ColorLike {
  if (name === "Music") {
    return INK.flame;
  }
  if (name === "UI") {
    return INK.warn;
  }
  if (name === "Master") {
    return INK.ok;
  }
  return INK.cool;
}

/**
 * The desk's per-frame update: read the buses, write the geometry, and route a click.
 *
 * @remarks
 * A `Script`, so it runs in `Update` with everything else and the devtools inspector lists it.
 */
export class MixerDesk extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "audio-mixer/MixerDesk";

  #parts: Parts | null = null;

  /** Where the pointer was pressed, in backing-store pixels; `null` while nothing is held. */
  #pressedAt: { x: number; y: number } | null = null;

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
   * Hands the script the parts {@link attachMixer} built.
   *
   * @param parts - The desk's parts.
   */
  install(parts: Parts): void {
    this.#parts = parts;
  }

  /**
   * Pings one bus's signal lamp, and its ancestors' with it.
   *
   * @remarks
   * The example calls this when it plays something, because nothing in `app.audio` reports which
   * bus a sound is on: a voice is created against a bus and the mixer is a chain of gains, not a
   * meter. Walking to the root is what makes `Master`'s lamp light for every sound.
   *
   * @param bus - The bus a sound was just played on.
   */
  ping(bus: string): void {
    const parts = this.#parts;
    if (parts === null) {
      return;
    }
    for (const fader of parts.faders) {
      if (fader.name === bus || isAncestorOf(fader.name, parts, bus)) {
        fader.busy = SIGNAL_SECONDS;
      }
    }
  }

  /**
   * Latches or unlatches one pad, which is how the music pad shows that the loop is running.
   *
   * @param pad - Which pad.
   * @param on - Whether it is latched on.
   */
  latch(pad: PadId, on: boolean): void {
    const found = this.#parts?.pads.find((candidate: Pad) => candidate.id === pad);
    if (found !== undefined) {
      found.latched = on;
    }
  }

  /** Reads the buses and the click, and writes the desk. */
  update(): void {
    const parts = this.#parts;
    if (parts === null) {
      return;
    }
    const unscaled = this.app.time.unscaledDeltaTime;
    this.#readClick(parts);
    for (const fader of parts.faders) {
      updateFader(fader, unscaled);
    }
    for (const pad of parts.pads) {
      updatePad(pad, unscaled);
    }
    this.#updateRing(parts);
  }

  /**
   * Turns a press-and-release into a click on whatever was under it.
   *
   * @param parts - The desk's parts.
   */
  #readClick(parts: Parts): void {
    const press = parts.press;
    const pointer = parts.pointer;
    if (press === null || pointer === null) {
      return;
    }
    if (press.wasPressedThisFrame) {
      this.#pressedAt = { x: pointer.vector.x, y: pointer.vector.y };
    }
    // No early return after the press: a frame's events are all applied together in `PreUpdate`,
    // so a press and its release can resolve in the same frame and a handler that returned above
    // would drop that click. A click shorter than one frame is a different thing and is not
    // recoverable here at all — the control is back at zero before anything reads it, so neither
    // edge flag is ever set. `app.input.events` still holds both records for a game that needs
    // them; an action reports the state of a control, not the history of it.
    if (!press.wasReleasedThisFrame) {
      return;
    }
    const from = this.#pressedAt;
    this.#pressedAt = null;
    if (from === null || Math.hypot(pointer.vector.x - from.x, pointer.vector.y - from.y) > CLICK_SLOP) {
      return;
    }
    // `<Pointer>/position` is in the canvas's **backing-store pixels**, which is the space
    // `Camera.screenToRay` and `renderer.pickAsync` both speak — so the action's vector goes
    // straight in. DOM code is the side that divides by `devicePixelRatio`.
    const ray = parts.camera.screenToRay(pointer.vector.x, pointer.vector.y, this.#ray);
    if (ray === null) {
      return;
    }
    // A synchronous CPU raycast over the pickable renderers, rather than `pickAsync`, because the
    // answer is wanted in this frame and a desk is a handful of meshes.
    const hit = this.app.world.raycastRender(ray);
    if (hit === null) {
      return;
    }
    const run = parts.targets.get(hit.entity);
    if (run !== undefined) {
      run();
    }
  }

  /**
   * Lights the ring on the floor: amber and pulsing while the audio is locked, green once it runs.
   *
   * @remarks
   * The pulse is on `time.time`, the **scaled** clock, so `?static=1` — which stops the clock
   * before the first frame — freezes the ring at a known brightness and the golden does not
   * depend on when the page happened to load.
   *
   * @param parts - The desk's parts.
   */
  #updateRing(parts: Parts): void {
    const running = this.app.audio.state === "running";
    const pulse = running ? 1 : 0.5 + 0.5 * Math.sin(this.app.time.time * LOCK_PULSE_HZ * Math.PI * 2);
    // The two states are two different colours, not two ends of one ramp: a level between amber and
    // green is mud, and the ring is the one thing on the desk that has to be readable at a glance.
    const step = Math.round(pulse * LEVEL_STEPS) + (running ? LEVEL_STEPS + 1 : 0);
    if (step === parts.ring.written) {
      return;
    }
    parts.ring.written = step;
    const from = running ? INK.ok : shade(INK.warn, 0.3);
    const to = running ? INK.ok : INK.warn;
    parts.ring.material.value.setBaseColor({
      r: from.r + (to.r - from.r) * pulse,
      g: from.g + (to.g - from.g) * pulse,
      b: from.b + (to.b - from.b) * pulse,
      a: 1,
    });
  }
}

/**
 * Whether one bus is an ancestor of another, by walking the tree the service built.
 *
 * @param candidate - The bus that might be an ancestor.
 * @param parts - The desk's parts, for the fader table.
 * @param of - The bus a sound was played on.
 * @returns `true` when `candidate` is `of`'s parent, grandparent, and so on.
 */
function isAncestorOf(candidate: string, parts: Parts, of: string): boolean {
  let bus = parts.faders.find((fader: Fader) => fader.name === of)?.bus?.parent ?? null;
  while (bus !== null) {
    if (bus.name === candidate) {
      return true;
    }
    bus = bus.parent;
  }
  return false;
}

/**
 * Slides one fader's knob, scales its fill, and lights its signal lamp.
 *
 * @param fader - The fader to update.
 * @param unscaled - The unscaled frame delta, in seconds.
 */
function updateFader(fader: Fader, unscaled: number): void {
  const bus = fader.bus;
  const own = clamp(bus?.volume ?? 0, 0, 1);
  fader.knob.transform.localPosition.y = fader.base + own * FADER_TRAVEL;
  const height = Math.max(own * FADER_TRAVEL, MIN_SCALE);
  fader.fill.transform.localScale.set(FADER_WIDTH * 0.55, height, FADER_WIDTH * 0.55);
  fader.fill.transform.localPosition.y = fader.base + height / 2;
  setLevel(fader.fillLamp, own);
  setLevel(fader.knobLamp, bus?.muted === true ? 0 : 1);
  if (fader.busy > 0) {
    fader.busy = Math.max(fader.busy - unscaled, 0);
  }
  // `effectiveVolume` is the bus's own gain times every parent's, so turning `Master` down dims
  // every lamp on the desk while the three faders under it stay exactly where they are.
  setLevel(fader.signal, fader.busy > 0 ? clamp(bus?.effectiveVolume ?? 0, 0, 1) : 0);
}

/**
 * Lights one pad: white for the frames after a click, its accent while it is latched on.
 *
 * @param pad - The pad to update.
 * @param unscaled - The unscaled frame delta, in seconds.
 */
function updatePad(pad: Pad, unscaled: number): void {
  if (pad.flash > 0) {
    pad.flash = Math.max(pad.flash - unscaled, 0);
  }
  setLevel(pad.lamp, pad.flash > 0 ? 1 : pad.latched ? 0.9 : 0.44);
}

/**
 * Builds an unlit material for one part of the desk.
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
      name: `mixer/${name}`,
      baseColor: color,
      metallic: 0,
      roughness: 1,
      unlit: true,
      doubleSided: true,
    }),
    [],
  );
}

/** Where a part sits and how big it is, in the parent's metres. */
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
 * Adds one part of the desk.
 *
 * @param app - The app.
 * @param name - The entity's name, which the devtools scene tree shows.
 * @param mesh - The template it clones.
 * @param material - The material it wears.
 * @param at - Where it sits and how big it is.
 * @param pickable - Whether a click can find it.
 * @returns The entity.
 */
function addPart(
  app: App,
  name: string,
  mesh: AssetHandle<MeshAsset>,
  material: AssetHandle<MaterialAsset>,
  at: Placement,
  pickable = false,
): Entity {
  const entity = app.world.createEntity(name);
  entity.transform.localPosition.set(at.x, at.y, at.z);
  entity.transform.localScale.set(at.sx, at.sy, at.sz);
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: false,
    receiveShadows: false,
    pickable,
  });
  return entity;
}

/** The templates the desk shares. */
interface Shapes {
  /** A unit box: plinths, tracks, fills, knobs, rails, lamps. */
  readonly box: AssetHandle<MeshAsset>;
  /** A unit cylinder standing along Y: the pads. */
  readonly disc: AssetHandle<MeshAsset>;
  /** A unit ring in the XZ plane: the pad rims. */
  readonly ring: AssetHandle<MeshAsset>;
  /** A much thinner unit ring: the floor ring, whose tube would otherwise scale to a hoop. */
  readonly hoop: AssetHandle<MeshAsset>;
}

/**
 * Builds one fader.
 *
 * @param app - The app.
 * @param shapes - The shared templates.
 * @param name - The bus's name.
 * @param x - Where the fader stands, in metres right of the desk's centre.
 * @param z - Where the fader stands, in metres forward of the desk's centre.
 * @param lift - How far the whole fader is raised, in metres; the root stands on a taller plinth.
 * @returns The fader, and the knob a click can find.
 */
function addFader(app: App, shapes: Shapes, name: string, x: number, z: number, lift: number): Fader {
  const accent = accentOf(name);
  const base = FADER_BASE + lift;
  addPart(app, `${name} plinth`, shapes.box, createInkMaterial(app, `${name} plinth`, INK.surface), {
    x,
    y: (base + 0.01) / 2,
    z,
    sx: 0.32,
    sy: base + 0.01,
    sz: 0.32,
  });
  // The track is pickable as well as the knob: a knob is nine centimetres tall and a click has to
  // land somewhere, so the whole fader is the target for its bus's mute.
  const track = addPart(
    app,
    `${name} track`,
    shapes.box,
    createInkMaterial(app, `${name} track`, INK.sunk),
    { x, y: base + FADER_TRAVEL / 2, z, sx: FADER_WIDTH, sy: FADER_TRAVEL, sz: FADER_WIDTH },
    true,
  );
  const fillMaterial = createInkMaterial(app, `${name} fill`, accent);
  const fill = addPart(app, `${name} fill`, shapes.box, fillMaterial, {
    x,
    y: base,
    z: z - 0.045,
    sx: FADER_WIDTH * 0.55,
    sy: MIN_SCALE,
    sz: FADER_WIDTH * 0.55,
  });
  const knobMaterial = createInkMaterial(app, `${name} knob`, accent);
  const knob = addPart(
    app,
    `${name} knob`,
    shapes.box,
    knobMaterial,
    { x, y: base, z, sx: 0.3, sy: 0.13, sz: 0.26 },
    true,
  );
  const signalMaterial = createInkMaterial(app, `${name} signal`, INK.quiet);
  addPart(app, `${name} signal`, shapes.box, signalMaterial, {
    x,
    y: base + FADER_TRAVEL + 0.08,
    z,
    sx: 0.2,
    sy: 0.06,
    sz: 0.2,
  });
  return {
    name,
    bus: app.audio.tryBus(name),
    knob,
    track,
    knobLamp: { material: knobMaterial, off: INK.muted, on: accent, written: -1 },
    fill,
    fillLamp: { material: fillMaterial, off: shade(accent, 0.22), on: accent, written: -1 },
    signal: { material: signalMaterial, off: INK.quiet, on: accent, written: -1 },
    base,
    busy: 0,
  };
}

/**
 * Builds one pad.
 *
 * @param app - The app.
 * @param shapes - The shared templates.
 * @param id - Which pad it is.
 * @param label - The pad's name, for the scene tree.
 * @param bus - The bus the sound it fires is routed to.
 * @param x - Where it sits, in metres right of the desk's centre.
 * @param accent - Its accent colour, which is its bus's.
 * @returns The pad and its clickable disc.
 */
function addPad(
  app: App,
  shapes: Shapes,
  id: PadId,
  label: string,
  bus: string,
  x: number,
  accent: ColorLike,
): { readonly pad: Pad; readonly disc: Entity } {
  const z = -0.72;
  addPart(app, `${label} rim`, shapes.ring, createInkMaterial(app, `${label} rim`, INK.sunk), {
    x,
    y: 0.03,
    z,
    sx: PAD_DIAMETER + 0.09,
    sy: 0.07,
    sz: PAD_DIAMETER + 0.09,
  });
  const material = createInkMaterial(app, `${label} pad`, accent);
  const disc = addPart(
    app,
    `${label} pad`,
    shapes.disc,
    material,
    { x, y: 0.05, z, sx: PAD_DIAMETER, sy: 0.1, sz: PAD_DIAMETER },
    true,
  );
  return {
    pad: { id, bus, lamp: { material, off: shade(accent, 0.24), on: accent, written: -1 }, flash: 0, latched: false },
    disc,
  };
}

/**
 * Builds the desk and attaches the script that drives it.
 *
 * @param app - The running app; needs `audio()`, `input()`, and a built bus tree.
 * @param camera - The camera a click's ray is cast through.
 * @param hooks - What a click on a pad or a knob does.
 * @returns The desk's script, so the example can ping its lamps and latch its music pad.
 *
 * @example
 * ```ts
 * const desk = attachMixer(app, camera, { play, toggleMute });
 * desk.ping("SFX");
 * ```
 */
export function attachMixer(app: App, camera: Camera, hooks: MixerHooks): MixerDesk {
  app.registerComponents([MixerDesk]);
  app.input.loadActions(MIXER_ACTIONS);
  const shapes: Shapes = {
    box: MeshAsset.box(app, { size: 1 }),
    disc: MeshAsset.cylinder(app, { diameter: 1, height: 1, tessellation: 24 }),
    ring: MeshAsset.torus(app, { diameter: 1, thickness: 0.09, tessellation: 32 }),
    hoop: MeshAsset.torus(app, { diameter: 1, thickness: 0.022, tessellation: 64 }),
  };

  const faders = [
    addFader(app, shapes, "Music", -1.25, 0.75, 0),
    addFader(app, shapes, "SFX", 0, 0.75, 0),
    addFader(app, shapes, "UI", 1.25, 0.75, 0),
    // The root stands behind the three and a third of a metre higher, so its column clears the
    // fader in front of it from the camera's own start pose.
    addFader(app, shapes, "Master", 0, 2.05, 0.34),
  ];
  // Three rails into one: the routing `game.audio.json` declares, drawn rather than described.
  for (const x of [-1.25, 0, 1.25]) {
    addPart(app, `Rail ${String(x)}`, shapes.box, createInkMaterial(app, `rail ${String(x)}`, INK.quiet), {
      x,
      y: 0.012,
      z: 1.24,
      sx: 0.05,
      sy: 0.024,
      sz: 0.98,
    });
  }
  addPart(app, "Rail bus", shapes.box, createInkMaterial(app, "rail bus", INK.quiet), {
    x: 0,
    y: 0.012,
    z: 1.44,
    sx: 2.55,
    sy: 0.024,
    sz: 0.05,
  });

  const built = [
    addPad(app, shapes, "music", "Music loop", "Music", -1.7, INK.flame),
    addPad(app, shapes, "pickup", "Pickup", "SFX", -0.85, INK.cool),
    addPad(app, shapes, "jump", "Jump", "SFX", 0, INK.cool),
    addPad(app, shapes, "land", "Land", "SFX", 0.85, INK.cool),
    addPad(app, shapes, "click", "UI click", "UI", 1.7, INK.warn),
  ];

  const ringMaterial = createInkMaterial(app, "lock ring", INK.warn);
  addPart(app, "Lock ring", shapes.hoop, ringMaterial, {
    x: 0,
    y: 0.014,
    z: 0.45,
    sx: 4.3,
    sy: 0.06,
    sz: 4.3,
  });

  const desk = app.world.createEntity("Mixer").addComponent(MixerDesk);
  const targets = new Map<Entity, () => void>();
  for (const entry of built) {
    targets.set(entry.disc, (): void => {
      entry.pad.flash = PAD_FLASH_SECONDS;
      // The desk lights its own lamps, so the example's hook only has to make the sound.
      desk.ping(entry.pad.bus);
      hooks.play(entry.pad.id);
    });
  }
  for (const fader of faders) {
    const mute = (): void => {
      hooks.toggleMute(fader.name);
    };
    targets.set(fader.knob, mute);
    targets.set(fader.track, mute);
  }
  desk.install({
    faders,
    pads: built.map((entry) => entry.pad),
    ring: { material: ringMaterial, off: INK.warn, on: INK.ok, written: -1 },
    targets,
    camera,
    press: app.input.actions.find("deskPress"),
    pointer: app.input.actions.find("deskPointer"),
  });
  return desk;
}
