import { defineConfig } from "@ignifx/vite-plugin";

/**
 * Project settings, injected as `import.meta.env.IGNIFX_CONFIG` and handed to `createApp`.
 *
 * A side-scroller's settings differ from a top-down game's in two places: gravity is real, and the
 * sorting-layer list has one entry per parallax band, because `ParallaxLayer` slows down a whole
 * sorting layer rather than a single sprite.
 */
export default defineConfig({
  rendering: {
    clearColor: { r: 0.055, g: 0.063, b: 0.11, a: 1 },
    // Multisampling would soften exactly the edges `pixelPerfect` exists to keep sharp.
    msaaSamples: 1,
  },

  time: { fixedDeltaTime: 1 / 60 },

  // Back to front. `Sky`, `Hills` and `Trees` each carry one `ParallaxLayer` with its own factor;
  // `Terrain` is the tilemap; `Default` is everything that moves.
  sortingLayers: { sortingLayers: ["Sky", "Hills", "Trees", "Terrain", "Default", "Foreground"] },

  // Only the first sixteen layers filter in 2D physics (`IGX-1152`).
  layers: { layers: ["Default", "Player", "Terrain", "Pickup"] },

  twoD: {
    mode: "sprite",
    // One world metre is one 16-pixel tile.
    pixelsPerUnit: 16,
    // No Y-sort: a side-scroller's depth comes from its sorting layers, and sorting the moving
    // layer by world Y would make a jumping character pass in front of and behind a coin.
    ySort: {},
  },

  physics2d: {
    // Only rigid bodies fall under this. `CharacterController2D` is purely kinematic, so
    // `PlatformerController` owns the player's vertical velocity — that is what makes coyote time
    // and a variable jump height possible at all.
    gravity: { x: 0, y: -24 },
    collisionMatrix: {
      Pickup: ["Player"],
    },
    defaultMaterial: { friction: 0.4, restitution: 0 },
  },

  // As in the top-down template, neither `input.actions` nor `audio.buses` is set: a document
  // loaded by the extension in `onStart` arrives a few frames later, and `src/main.ts` needs the
  // action maps installed before the first `update`.
});
