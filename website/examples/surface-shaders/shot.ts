/**
 * The stage the surface shaders are shown on, and the table that drives the panel.
 *
 * @remarks
 * Split out of `main.ts` for the reason `pbr-model/shot.ts` is: the placements, the lamp
 * intensities and the panel's bounds are numbers that were found by looking at rendered candidates,
 * and none of them is a lesson about surface shaders.
 *
 * ## Why the ship wears the shaders and the corset does not
 *
 * A surface shader decorates a **`MaterialAsset`**, and a glTF model's materials are Babylon Lite's,
 * built inside the loader — `Model` reaches them only through `materialOverrides`, which *replaces*
 * one by name. So the ship's single material is replaced with the one built in `main.ts`, which
 * carries the four shaders; the Corset beside it keeps everything the file shipped. That is what
 * makes the frame a comparison: the same probe, the same key light, the same shadow map, one object
 * decorated and one not.
 */

import type { ColorLike } from "ignifx";

/** The near-black the frame is cleared to. */
export const CLEAR_COLOR: ColorLike = { r: 0.01, g: 0.013, b: 0.02, a: 1 };

/** The opening shot. */
export const SHOT = {
  fov: 34,
  yaw: 28,
  pitch: 11,
  distance: 2.5,
  target: { x: 0, y: 0.5, z: 0 },
  exposure: 1.05,
  /** How much the probe is blurred; a little turns the softboxes into reflections you can follow. */
  blur: 0.25,
} as const;

/** The glTF material name the ship's single material answers to, from the file itself. */
export const SHIP_MATERIAL = "tripo_material_fedcb3fd-2bd9-4616-af5b-e9682fee6ac0";

/** Where the decorated ship sits: floating, nose out of the frame's left. */
export const SHIP = {
  address: "models/ignifx-ship.glb",
  position: { x: -0.42, y: 0.66, z: 0 },
  pose: { x: -10, y: 22, z: 6 },
} as const;

/** Where the undecorated Corset stands: on the floor, to the right, as the control. */
export const CORSET = {
  address: "models/corset.glb",
  position: { x: 0.62, y: 0, z: 0.12 },
  scale: 16,
} as const;

/** How wide the floor is, in metres. */
export const FLOOR_SIZE = 16;

/** How wide the backdrop sphere is, in metres. */
export const BACKDROP_DIAMETER = 18;

/** The hull the four shaders decorate: metal enough that the probe shows in it. */
export const HULL = { baseColor: { r: 0.29, g: 0.24, b: 0.2, a: 1 }, metallic: 0.45, roughness: 0.4 } as const;

/** How long the hit flash takes to fade back to nothing, in seconds. */
export const FLASH_SECONDS = 0.32;

/** One panel row: the surface shader it belongs to, and how the amount slider is drawn. */
export interface SurfaceRow {
  /** The label on the panel group. */
  readonly label: string;
  /** The `.surface.wgsl` address, under `website/examples/assets/`. */
  readonly address: string;
  /** The name the shader answers to on the material; the address's basename by default. */
  readonly name: string;
  /** Which hook it implements, for the panel's own caption. */
  readonly hook: "surface" | "composite";
  /** The uniform the amount slider writes. */
  readonly amount: string;
  /** The slider's highest value; the lowest is always zero. */
  readonly max: number;
  /** The value the material opens on. */
  readonly value: number;
  /** Whether the shader is on when the example opens. */
  readonly enabled: boolean;
  /** A second slider, when the shader has one worth showing. */
  readonly extra?: {
    /** The visible label. */
    readonly label: string;
    /** The uniform's name. */
    readonly name: string;
    /** The lowest value. */
    readonly min: number;
    /** The highest value. */
    readonly max: number;
    /** The increment. */
    readonly step: number;
    /** The value the material opens on. */
    readonly value: number;
  };
}

/**
 * The four shaders, in the order they are layered onto the material.
 *
 * @remarks
 * Order matters: the two `surface` hooks run first and edit the base colour the lighting is then
 * computed from, and the two `composite` hooks run last and add to the lit result. Snow before
 * wetness, so a wet band under a snow line still reads as wet rock rather than as grey snow.
 */
export const SURFACES: readonly SurfaceRow[] = [
  {
    label: "Snow",
    address: "shaders/surface-shaders/snow.surface.wgsl",
    name: "snow",
    hook: "surface",
    amount: "amount",
    max: 1,
    value: 1,
    enabled: true,
    extra: { label: "Snow line", name: "height", min: 0.2, max: 1.4, step: 0.02, value: 0.62 },
  },
  {
    label: "Wetness",
    address: "shaders/surface-shaders/wetness.surface.wgsl",
    name: "wetness",
    hook: "surface",
    amount: "amount",
    max: 1,
    value: 0.85,
    enabled: true,
    extra: { label: "Water line", name: "waterLine", min: 0.1, max: 1.2, step: 0.02, value: 0.6 },
  },
  {
    label: "Rim light",
    address: "shaders/surface-shaders/rim.surface.wgsl",
    name: "rim",
    hook: "composite",
    amount: "strength",
    max: 3,
    value: 0.55,
    enabled: true,
    extra: { label: "Tightness", name: "power", min: 1, max: 8, step: 0.25, value: 4 },
  },
  {
    label: "Hit flash",
    address: "shaders/surface-shaders/hit-flash.surface.wgsl",
    name: "hit-flash",
    hook: "composite",
    amount: "flash",
    max: 1,
    value: 0,
    enabled: true,
  },
];
