/**
 * The numbers the arena and the panel both need: how big it is, where the crates stand, and which
 * frames of `props.atlas.json` the scene draws with.
 */

/** How wide the arena is, in metres. The camera shows a little under nine. */
export const ARENA_WIDTH = 9;

/** Where the crates stand: the column centres, in metres. */
export const COLUMNS = [3.5, 4.5, 5.5] as const;

/** The middle column, which the panel's Throw button aims at. */
export const MIDDLE_COLUMN = COLUMNS[1];

/** How many crates high the opening stack is. */
export const STACK_HEIGHT = 3;

/** The atlas frames the scene draws with, by name in `props.atlas.json`. */
export const FRAMES = {
  /** Grass-topped earth, the floor. */
  ground: "props_0",
  /** Four crate faces, so a stack is not one texture repeated. */
  crates: ["props_18", "props_21", "props_22", "props_23"],
  /** A gold coin: round, which is the whole reason it is here. */
  coin: "props_95",
} as const;

/** How fast a thrown coin leaves the left edge, in metres per second. */
export const THROW_SPEED = 15;

/** Where a thrown coin starts, in metres. */
export const THROW_FROM = { x: 0.5, y: 3.2 } as const;

/** Two coins that start on the floor, so both collider shapes are in the opening frame. */
export const RESTING_COINS = [1.6, 7.4] as const;

/** How many bodies the arena keeps before the oldest is retired. */
export const MAX_BODIES = 60;
