/**
 * Everything in `lights` that is not a light: the numbers each lamp is tuned to, the shapes the
 * light falls on, the script that walks the lamp around them, and the plumbing the parameter panel
 * needs to drive a light from a slider and a colour picker.
 *
 * @remarks
 * Split out for the reason `pbr-model/shot.ts` is: what a reader wants from `main.ts` is the four
 * lights and their fields, not a scene file with four lights somewhere in it. Every number here is
 * a composition choice and none of it is a lesson about ignifx.
 */

import { createMaterialAsset, f32, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import { createGridGround } from "../_kit/stage.ts";
import type { App, AssetHandle, ColorLike, Entity, Light, ScriptCallbacks } from "ignifx";

/** The point the directional and spot lights are aimed at, and what the camera looks at. */
export const FOCUS = { x: 0, y: 0.4, z: 0 } as const;

/** The directional light: a warm sun from the front upper left, and the one that casts by default. */
export const SUN = { color: "#ffe9c4", intensity: 2, at: { x: -3.6, y: 4.4, z: -3.6 }, arrow: 1.6 } as const;

/** The point light: a cool lamp that walks a circle around the subjects. */
export const LAMP = { color: "#7fb8ff", intensity: 22, range: 5, at: { x: 3.1, y: 1.5, z: 0 }, spin: 16 } as const;

/** The spot light: warm, tight, from above and to the right, aimed just off the centre sphere. */
export const SPOT = {
  color: "#ffb04a",
  intensity: 250,
  range: 14,
  angle: 34,
  exponent: 2,
  at: { x: 3.9, y: 3.5, z: 1 },
  aim: { x: 1.9, y: 0, z: -2.8 },
  /** How far down the beam the cone gizmo is drawn: just short of the floor. */
  cone: 5.2,
} as const;

/** The hemispheric light: pale sky above, warm bounce below, and no position that matters. */
export const SKY = { color: "#8fb6ff", ground: "#5a4632", intensity: 0.3, at: { x: -4.4, y: 1.9, z: 3.2 } } as const;

/** The shadow map both casters use, in texels per side. `shadows` is the example that tunes it. */
export const SHADOW_MAP_SIZE = 1024;

/** The matte off-white every subject is drawn in, so the light is the only thing that varies. */
const SUBJECT_COLOR: ColorLike = { r: 0.79, g: 0.8, b: 0.83, a: 1 };

/** How rough the subjects are: high enough that the shape reads, low enough to catch a highlight. */
const SUBJECT_ROUGHNESS = 0.52;

/** The ground plane's edge length, in metres. One grid cell per metre. */
const GROUND_SIZE = 44;

/** How many radial segments a subject is built from. */
const SUBJECT_SEGMENTS = 32;

/** The radix an `#rrggbb` string is parsed in. */
const HEX_RADIX = 16;

/** The largest value one 8-bit colour channel can hold. */
const CHANNEL_MAX = 255;

/**
 * Reads an `#rrggbb` string as an ignifx colour.
 *
 * @remarks
 * Every colour in the engine's public API is sRGB in `0…1` (`references/formats/material.md`), and
 * an `<input type="color">` reports sRGB in `0…255`. This is the whole conversion, and it lives in
 * an example rather than in the kit because only a panel with a colour picker in it needs one.
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns The colour, opaque.
 */
export function fromHex(hex: string): ColorLike {
  const value = Number.parseInt(hex.slice(1), HEX_RADIX);
  return {
    r: ((value >> 16) & CHANNEL_MAX) / CHANNEL_MAX,
    g: ((value >> 8) & CHANNEL_MAX) / CHANNEL_MAX,
    b: (value & CHANNEL_MAX) / CHANNEL_MAX,
    a: 1,
  };
}

/**
 * Turns one colour picker into a write to each thing that has to change colour with it.
 *
 * @remarks
 * A lamp and its gizmo are two objects with one colour between them, and the panel should not have
 * to say so four times. This is what makes each `color` row in `main.ts` a single line.
 *
 * @param setters - Everything to repaint, in any order.
 * @returns The `change` callback a `color` control takes.
 *
 * @example
 * ```ts
 * color("Colour", { value: SUN.color, change: paints(lightColor(sun), arrow.setColor) });
 * ```
 */
export function paints(...setters: readonly ((color: ColorLike) => void)[]): (hex: string) => void {
  return (hex: string): void => {
    const value = fromHex(hex);
    for (const set of setters) {
      set(value);
    }
  };
}

/**
 * A setter that writes one light's own colour, for {@link paints}.
 *
 * @param light - The light to repaint.
 * @returns The setter.
 */
export function lightColor(light: Light): (color: ColorLike) => void {
  return (color: ColorLike): void => {
    light.color = color;
  };
}

/**
 * A setter that writes one hemispheric light's `groundColor` — the colour it lights from below.
 *
 * @param light - The hemispheric light.
 * @returns The setter.
 */
export function groundColor(light: Light): (color: ColorLike) => void {
  return (color: ColorLike): void => {
    light.groundColor = color;
  };
}

/**
 * Writes a slider's value as a distance.
 *
 * @param value - Metres.
 * @returns The text for the slider's value cell.
 */
export function metres(value: number): string {
  return `${value.toFixed(1)} m`;
}

/**
 * Writes a slider's value as an angle.
 *
 * @param value - Degrees.
 * @returns The text for the slider's value cell.
 */
export function degrees(value: number): string {
  return `${String(value)}°`;
}

/**
 * Writes a slider's value as a rate.
 *
 * @param value - Degrees per second.
 * @returns The text for the slider's value cell.
 */
export function degreesPerSecond(value: number): string {
  return `${String(value)}°/s`;
}

/** Walks its entity around the world Y axis, in degrees per second. */
export class Spinner extends Script.define({ speed: f32(0) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "lights/Spinner";

  /** Reused so the per-frame path allocates nothing (coding standards §7). */
  readonly #step = { x: 0, y: 0, z: 0 };

  /**
   * Advances the rotation.
   *
   * @param dt - Seconds since the previous frame, already scaled by `time.timeScale`. Under
   * `?static=1` the scale is zero, so the lamp holds the angle it was authored at.
   */
  update(dt: number): void {
    this.#step.y = this.speed * dt;
    this.transform.rotate(this.#step);
  }
}

/** One lamp the panel can switch off and set a level for. */
export interface LightSwitch {
  /**
   * Switches the lamp on or off, and its gizmos with it.
   *
   * @param on - Whether the lamp should light the scene.
   */
  readonly setOn: (on: boolean) => void;
  /**
   * Sets the intensity the lamp uses while it is on.
   *
   * @param level - The new intensity.
   */
  readonly setLevel: (level: number) => void;
}

/**
 * Wires a light and its gizmos to one on/off state and one intensity.
 *
 * @remarks
 * **`intensity = 0` is the switch, not `enabled = false`.** `Light` is the one render component
 * with no visibility path: the `PreRender` sync reads `isEnabledInHierarchy` for a `MeshRenderer`,
 * a `Model`, a `Camera` and an `Environment`, and calls `Light.sync` unconditionally
 * (`packages/core/src/render/render-sync-system.ts`), so a light on a deactivated entity keeps
 * shading the scene. Zero intensity is what turns one off today. The gizmos are meshes and do
 * follow `active`, so they are hidden the ordinary way.
 *
 * @param light - The light to switch.
 * @param level - The intensity it opens on and returns to.
 * @param gizmos - The gizmo roots to hide with it.
 * @returns The switch the panel drives.
 *
 * @example
 * ```ts
 * const sun = createLightSwitch(light, 2.2, [arrow.entity]);
 * sun.setOn(false);
 * ```
 */
export function createLightSwitch(light: Light, level: number, gizmos: readonly Entity[]): LightSwitch {
  let isOn = true;
  let intensity = level;
  return {
    setOn: (on: boolean): void => {
      isOn = on;
      light.intensity = on ? intensity : 0;
      for (const gizmo of gizmos) {
        gizmo.active = on;
      }
    },
    setLevel: (next: number): void => {
      intensity = next;
      if (isOn) {
        light.intensity = next;
      }
    },
  };
}

/**
 * Builds the ground and the five primitives the lights fall on.
 *
 * @remarks
 * Five different shapes on purpose: a sphere shows a highlight's shape, a box shows three faces at
 * three brightnesses, a cylinder shows a gradient wrapping away from the light, a torus shows a
 * surface shadowing itself, and a capsule shows both at once. Every one of them is a `MeshAsset`
 * factory call, so the example loads no geometry.
 *
 * The ground is the kit's grid, which is the one texture here, and it is awaited before
 * `app.start()` because `createMaterialAsset` binds its textures once and a still-loading handle
 * binds as none at all (`_kit/stage.ts` says so at length).
 *
 * @param app - The app the entities and assets belong to.
 * @returns A promise that resolves once the ground's texture has loaded.
 *
 * @example
 * ```ts
 * await createSubjects(app);
 * ```
 */
export async function createSubjects(app: App): Promise<void> {
  await createGridGround(app, { size: GROUND_SIZE });

  const matte = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "lights/matte",
      baseColor: SUBJECT_COLOR,
      metallic: 0.04,
      roughness: SUBJECT_ROUGHNESS,
      // No environment is loaded here — the four lights are the whole of the lighting — so this
      // only states the intent: nothing in this scene is lit by a probe.
      environmentIntensity: 0,
    }),
    [],
  );

  const place = (name: string, mesh: AssetHandle<MeshAsset>, x: number, y: number, z: number): void => {
    const entity = app.world.createEntity(name, { position: { x, y, z } });
    entity.addComponent(MeshRenderer, { mesh, materials: [matte], castShadows: true, receiveShadows: true });
  };

  const segments = SUBJECT_SEGMENTS;
  place("Sphere", MeshAsset.sphere(app, { diameter: 1.3, segments }), 0, 0.65, 0);
  place("Box", MeshAsset.box(app, { width: 1, height: 1.7, depth: 1 }), -2.4, 0.85, 0.7);
  place("Cylinder", MeshAsset.cylinder(app, { height: 1.5, diameter: 0.95, tessellation: segments }), 2.4, 0.75, 0.7);
  place("Torus", MeshAsset.torus(app, { diameter: 1.7, thickness: 0.34, tessellation: segments }), 0, 0.34, -2.7);
  place("Capsule", MeshAsset.capsule(app, { height: 1.7, radius: 0.36, tessellation: segments }), 3.8, 0.85, -1.8);
}
