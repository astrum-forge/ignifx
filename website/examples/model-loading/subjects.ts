/**
 * The three models `model-loading` swaps between, and the arithmetic that stands each one on the
 * floor at the same height.
 *
 * @remarks
 * Borrowed art arrives at whatever scale and origin its author worked in, and these three are as
 * far apart as sample models get: the avocado is 63 millimetres tall with its origin on its base,
 * the water bottle is 260 millimetres tall with its origin in its middle, and the lantern is a
 * 25-unit street lamp whose origin is under the *post* while the lamp itself hangs out at
 * `x = 9.6`. Every figure below was printed by `_tools/compress-model.ts` and re-measured from the
 * committed `.glb` with `@gltf-transform/core`'s `getBounds` on 2026-09-08, which is why the table
 * is data rather than three guessed numbers: {@link fit} turns it into the one scale and the one
 * offset that make the model {@link TARGET_HEIGHT} tall, centred over the origin, standing on the
 * grid. The camera then never has to move, so the example is about the loading and not about the
 * framing.
 */

/** A three-component point in glTF units, as the bounds tables below record one. */
export interface Extent {
  /** Along X. */
  readonly x: number;
  /** Along Y. */
  readonly y: number;
  /** Along Z. */
  readonly z: number;
}

/** One model the panel's select can show. */
export interface Subject {
  /** The address, under the asset root the examples build points the plugin at. */
  readonly address: string;
  /** The lowest corner of the model's own bounding box, in the units the file is authored in. */
  readonly min: Extent;
  /** The highest corner of the same box. */
  readonly max: Extent;
}

/** How the entity is placed so a subject stands centred on the floor. */
export interface Placement {
  /** The uniform scale to draw the model at. */
  readonly scale: number;
  /** Where the entity's origin goes, in metres. */
  readonly offset: Extent;
}

/**
 * How tall every subject is drawn, in metres.
 *
 * @remarks
 * Chosen against the grid the kit's ground draws, which is one cell per metre: at 0.9 m a subject
 * is most of a cell tall, so the frame says how big it is without a ruler in it — and all three
 * subjects being one height is what lets a single camera pose frame the avocado and the street lamp
 * equally well.
 */
export const TARGET_HEIGHT = 0.9;

/**
 * The subjects, by the label the panel shows, in ascending file size.
 *
 * @remarks
 * The order is the committed file sizes — 364 960, 570 720 and 851 508 bytes — so the select reads
 * as a cost as well as a list. All three are CC0; `assets/ATTRIBUTION.md` records each licence, its
 * digest and the day it was confirmed.
 */
export const SUBJECTS: Readonly<Record<string, Subject>> = {
  Avocado: {
    address: "models/avocado.glb",
    min: { x: -0.021_281, y: -0.000_048, z: -0.013_809 },
    max: { x: 0.021_281, y: 0.062_848, z: 0.013_809 },
  },
  "Water bottle": {
    address: "models/water-bottle.glb",
    min: { x: -0.054_45, y: -0.130_22, z: -0.054_45 },
    max: { x: 0.054_45, y: 0.130_22, z: 0.054_45 },
  },
  Lantern: {
    address: "models/lantern.glb",
    min: { x: -3.9224, y: 0.1839, z: -2.3157 },
    max: { x: 11.5688, y: 25.8481, z: 2.3157 },
  },
};

/**
 * The subject the example opens on, and the one every capture shows.
 *
 * @remarks
 * The lantern rather than the first item of the select: it is the one whose silhouette still reads
 * at the size the gallery draws a poster, and it is the one whose authored scale is most obviously
 * not metres.
 */
export const START_SUBJECT = "Lantern";

/**
 * The radius of the sphere the camera frames, in metres.
 *
 * @remarks
 * Half of {@link TARGET_HEIGHT} would be the sphere around a subject centred on the origin, but a
 * subject *stands* on the floor, so the sphere the camera has to contain is centred half way up and
 * has to reach the widest subject's corners. The lantern is the widest: 15.49 units across against
 * 25.66 tall, which is 0.543 m across once it is 0.9 m tall.
 */
export const SUBJECT_RADIUS = 0.62;

/**
 * Turns a subject's authored bounds into the scale and offset that stand it on the floor.
 *
 * @remarks
 * Three lines of arithmetic, and they are the reason this file exists: a `Model` instantiates the
 * glTF's own node tree under its entity, so the only handles on where the art ends up are the
 * entity's scale and position. Height sets the scale; the box's horizontal centre and its lowest
 * point set the offset. Nothing here asks the file to have been authored sensibly.
 *
 * @param subject - The subject, with the bounds measured from its committed `.glb`.
 * @param height - How tall the model should be drawn, in metres.
 * @returns The uniform scale, and where to put the entity's origin.
 */
export function fit(subject: Subject, height: number): Placement {
  const spanY = subject.max.y - subject.min.y;
  const scale = spanY <= 0 ? 1 : height / spanY;
  return {
    scale,
    offset: {
      x: (-(subject.min.x + subject.max.x) / 2) * scale,
      y: -subject.min.y * scale,
      z: (-(subject.min.z + subject.max.z) / 2) * scale,
    },
  };
}
