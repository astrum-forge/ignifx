import { defineConfig } from "@ignifx/vite-plugin";

/**
 * Project settings, injected as `import.meta.env.IGNIFX_CONFIG` and handed to `createApp`.
 *
 * Everything a scene cannot change at runtime belongs here. In a 2D game that is mostly the
 * sorting-layer list, the collision layers, and the two extension sections: `@ignifx/2d` reads
 * `twoD` and `@ignifx/physics-2d` reads `physics2d`, both before the first frame.
 */
export default defineConfig({
  rendering: {
    // The colour the frame is cleared to before any sprite is drawn. `twoD.mode` is `"sprite"`, so
    // there is no 3D scene under the sprites and this is what shows through the transparent parts
    // of the tilemap.
    clearColor: { r: 0.043, g: 0.059, b: 0.094, a: 1 },
    // Pixel art is sampled `nearest` and drawn axis-aligned, so multisampling buys nothing and
    // costs a resolve every frame.
    msaaSamples: 1,
  },

  time: { fixedDeltaTime: 1 / 60 },

  // Back to front. `@ignifx/2d` draws one Lite layer per sorting layer, so the order here is the
  // draw order; `twoD.ySort` then decides which of them sort by world Y inside themselves.
  // `Decal` exists because `orderInLayer` only reorders inside a Y-sorted layer: a floor marker
  // that has to stay under the tilemap's neighbours needs a layer of its own, not an order.
  sortingLayers: { sortingLayers: ["Background", "Decal", "Default", "Foreground"] },

  // Only the first sixteen layers filter in 2D physics: Rapier packs membership and filter into
  // 16 bits each (`packages/physics-2d/skills/physics-2d/SKILL.md`, "Gotchas").
  layers: { layers: ["Default", "Player", "Solid", "Trigger"] },

  twoD: {
    mode: "sprite",
    // One world metre is one 16-pixel tile. The default is 100, which would make every sprite here
    // a sixth of its intended size.
    pixelsPerUnit: 16,
    // The layer the player and the props share draws back to front by world Y, so a character
    // walking behind a barrel is occluded by it.
    ySort: { Default: true },
  },

  physics2d: {
    // A top-down world has no gravity: the character controller is driven entirely by input.
    gravity: { x: 0, y: 0 },
    collisionMatrix: {
      Trigger: ["Player"],
    },
    defaultMaterial: { friction: 0, restitution: 0 },
  },

  // Neither `input.actions` nor `audio.buses` is set here, on purpose. Both extensions would load
  // their document in `onStart`, and a load started then is delivered in a later frame's
  // `PreUpdate` — so the first frames would run with no action maps at all. `src/main.ts` loads
  // both before `app.start()` instead, where a completed load settles at once, and it names each
  // document's asset type explicitly (see the comment there).
});
