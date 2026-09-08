/**
 * The composition: what `pbr-model` shows, where it stands, how it is graded, and what the frame is
 * cleared to. Everything a designer tunes, in one file, so `main.ts` is only about the engine.
 *
 * @remarks
 * Every number here was chosen against rendered candidates rather than guessed
 * (`website/plan/08-execution.md` §4.4), and several of them are measurements — the two subjects'
 * authored extents, the pose that puts the nose where the frame wants it, the lamp ratios, and the
 * bloom's cost in clipped pixels. The viewer page shows this file beside `main.ts`, which is the
 * point: it is the part a reader is most likely to want to change. Two numbers here are load
 * bearing outside it: `exposure` and `pitch`, which `_tools/make-backdrop-texture.ts` solves its
 * bytes and centres its pool of light for.
 */

import type { ToneMappingCurve } from "ignifx";

/** A rotation in degrees about each axis, as the engine's public API takes one. */
export interface Euler {
  /** Pitch, in degrees. */
  readonly x: number;
  /** Yaw, in degrees. */
  readonly y: number;
  /** Roll, in degrees. */
  readonly z: number;
}

/** One subject the Model select can show. */
export interface Subject {
  /** The model's address, under the asset root the examples build points the plugin at. */
  readonly address: string;
  /** The uniform scale the entity is drawn at. */
  readonly scale: number;
  /** How high the entity's origin sits above the floor, in metres. */
  readonly height: number;
  /** The pose the subject is placed in, in degrees. */
  readonly pose: Euler;
  /**
   * Whether the studio floor is shown under this subject. The ship is key art — a ship in flight
   * has no floor, and any lit floor puts a horizon across a frame whose edges are meant to be
   * quiet — while the corset is a physical object that wants one to stand on.
   */
  readonly floor: boolean;
}

/**
 * The subjects, by the label the panel shows. The ship is the mascot and the default; the corset is
 * here because swapping a model at runtime is one assignment, and that is worth showing.
 *
 * @remarks
 * The two are authored at wildly different scales, which is the normal state of borrowed art: the
 * ship spans 0.488 x 0.504 x 0.980 metres and needs none, the Khronos Corset spans
 * 0.0390 x 0.0578 x 0.0390 and needs 16, and `_tools/compress-model.ts` prints both extents on
 * every run. `height` floats the ship clear of the floor, so it reads as a ship rather than as a
 * model on a shelf.
 *
 * `pose` is the ship's attitude, and it is what makes a static mesh read as something in motion:
 * fourteen degrees of nose-down and eight of bank, with the hull turned fifteen degrees off the
 * camera's axis so the frame gets a front three-quarter — the nose out of the frame's lower left
 * and towards the viewer, the length of the hull running back up to the right, and the engines
 * highest. The ship's nose is its `-Z` end (measured: the cross-section tapers from 1,757 square
 * millimetres at `+Z` to 43 at `-Z`), and the pose is applied in Babylon's order, `Y * X * Z`, so
 * the three numbers were solved rather than swept: against this camera they put the nose 0.74 of a
 * unit to the left of the frame's centre, 0.15 down, and 0.65 towards the viewer — 49 degrees off
 * the camera's axis, which is what a three-quarter is — with the deck tipped 0.09 away, so the
 * frame gets a sliver of the belly.
 */
export const SUBJECTS: Readonly<Record<string, Subject>> = {
  Ship: { address: "models/ignifx-ship.glb", scale: 1, height: 0.7, pose: { x: -14, y: 15, z: 8 }, floor: false },
  Corset: { address: "models/corset.glb", scale: 16, height: 0.46, pose: { x: 0, y: 0, z: 0 }, floor: true },
};

/** The subject the example opens on, and the one every capture shows. */
export const START_SUBJECT = "Ship";

/** The radius of the sphere the camera frames, in metres. Both subjects fit inside it. */
export const SUBJECT_RADIUS = 0.62;

/**
 * The opening shot: the pose and the grading every capture is taken from — the viewer page opens on
 * it, the poster and the golden are it, and the first input moves away from all of it.
 *
 * @remarks
 * Key art, not a turntable. A long lens (26 degrees) flattens the perspective and lets the hull
 * fill the frame from further away; the camera sits *below* the ship's centre line and looks a
 * little upward (`pitch` is negative), which is what shows the profile and the belly rather than
 * the deck; `padding` crops into the bounding sphere, because a ship's silhouette is a long
 * diagonal and not a ball. `idle` is zero: a still is a still — the field is in `orbit.ts` for
 * anything that wants a turntable.
 *
 * The lighting is three lamps, all directional, so their positions are only directions and no
 * intensity falls off with distance: a warm key from the front upper left, a cooler fill from the
 * opposite side so a panel line has two edges, and a warm-orange rim from behind and to the right,
 * which is what burns the wing edges and the engine housings out of the dark. The ratios are
 * measured rather than conventional. The fill is 0.42 of the key rather than the usual third,
 * because the subject is dark, worn metal and a third left its shadow side unreadable at the size
 * a poster is seen at; the rim is 1.5 times the key rather than the two to three a product shot
 * would use, because at 2.4 times — rendered, compared side by side — it flared the whole upper
 * silhouette into one line and took the panel work with it.
 *
 * **The lamps are bright and the exposure is low, and that is deliberate.** Exposure multiplies
 * everything in the frame, the unlit backdrop included, so raising it to brighten the ship raises
 * the backdrop with it and the frame stops being key art. Raising the lamps instead brightens only
 * what they touch, which is why the ship can be the brightest thing in the frame by a wide margin.
 * The low exposure has a second benefit worth knowing before changing it: it leaves
 * `_tools/make-backdrop-texture.ts` a wide range of bytes to paint the vignette's falloff with —
 * that file solves its bytes for this number and says so.
 *
 * The bloom is small on purpose, and how small was measured rather than judged: at the threshold
 * and weight below, 1,485 pixels of a 1280x720 frame reach 250 or brighter, against 797 with
 * `bloomWeight` at zero. So the effect is 700 pixels — the glints on the engine housings, the rim
 * along the wing edges, and nothing else. A threshold above about 0.6 does nothing at all, because
 * it is compared against the *linear* offscreen target rather than the graded frame.
 */
export const SHOT = {
  fov: 26,
  yaw: 35,
  pitch: -8,
  padding: 0.6,
  idle: 0,
  exposure: 0.8,
  blur: 0.08,
  /** The backdrop sphere's own yaw, which is what puts its pool of light behind the subject. */
  backdropYaw: 54,
  /** The warm key, from the front upper left. */
  key: { intensity: 24, at: { x: -0.56, y: 1.6, z: -2.34 }, color: { r: 1, g: 0.851, b: 0.659, a: 1 } },
  /** The cooler directional fill, opposite the key at a third of its intensity. */
  fill: { intensity: 10, at: { x: 2.44, y: 0.8, z: 0 }, color: { r: 0.68, g: 0.79, b: 1, a: 1 } },
  /** The rim, behind the ship and to the right, at two and a half times the key. */
  rim: { intensity: 36, at: { x: -0.12, y: 1.1, z: 2.6 }, color: { r: 1, g: 0.72, b: 0.44, a: 1 } },
  bloomThreshold: 0.35,
  bloomWeight: 0.24,
  bloomKernel: 48,
} as const;

/**
 * The floor and the backdrop, in the site's own dark tones (`02-design-system.md` §2.3: `--bg` is
 * `#0D1015`), because the page wraps the frame in its ember glow.
 *
 * @remarks
 * `clear` is what shows where the backdrop sphere does not reach, and it is the same near-black the
 * backdrop's own edges are painted to render as. `floor` — the corset's floor, not the ship's —
 * is dark and bluish on purpose: the floor is lit, the probe's neutral bounce desaturates it, and
 * what it has to do is disappear into the backdrop's near-black edges while still catching the
 * subject's shadow. The backdrop itself is a soft pool of light behind the subject falling to
 * near-black at the frame's edges: the engine has no vignette pass, so the falloff is painted into
 * `textures/backdrop.png` — which solves its own bytes for the tones it has to *render* as — and
 * turned to face the camera by `main.ts`.
 */
export const GROUND = {
  clear: { r: 0.008, g: 0.01, b: 0.016, a: 1 },
  floor: { r: 0.004, g: 0.02, b: 0.075, a: 1 },
  floorSize: 16,
  backdropDiameter: 20,
} as const;

/**
 * The tone-mapping curves, by the label the panel shows; the engine's own names are the lower-case
 * values (`TONE_MAPPING_NAMES`). ACES is what most engines call "filmic" and rolls a bright
 * highlight off instead of clipping it to white.
 */
export const CURVES: Readonly<Record<string, ToneMappingCurve>> = {
  None: "none",
  Standard: "standard",
  ACES: "aces",
  Neutral: "neutral",
};

/** The label {@link CURVES} opens on. */
export const START_CURVE = "ACES";
