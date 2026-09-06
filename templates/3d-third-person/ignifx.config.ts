import { defineConfig } from "@ignifx/vite-plugin";

/**
 * Project settings, injected as `import.meta.env.IGNIFX_CONFIG` and handed to `createApp`.
 *
 * Everything a scene cannot change at runtime belongs here. `rendering.features.shadows` is the
 * clearest example: the flag is read once, when `app.start()` registers the scene with Lite, and
 * asking for it afterwards throws `IGX-0704`.
 */
export default defineConfig({
  rendering: {
    // The colour behind the level. `src/level.ts` draws an unlit gradient sphere around the scene,
    // so this only shows through where the sphere does not reach.
    clearColor: { r: 0.055, g: 0.067, b: 0.094, a: 1 },
    msaaSamples: 4,
    // `deviceLostRecovery` is on because this template is the one the desktop suite drives, and a
    // desktop game is exactly where a lost device is worth surviving: a laptop waking from sleep, a
    // GPU driver update, an external display unplugged. Recovery has to be enabled **before any
    // resource exists** — the capture that stamps a rebuild source onto every texture is installed
    // by that call — which is why it is a startup setting rather than something a script turns on.
    features: { shadows: true, deviceLostRecovery: true, postProcessing: true },
  },

  time: { fixedDeltaTime: 1 / 60 },

  // `Level` is the static floor and walls, `Prop` the crates that can be pushed, `Player` the
  // character and `Companion` the navigating friend. The camera's collision sweep is filtered to
  // `Level` and `Prop` in `src/level.ts`, so the boom never shortens on the character itself.
  layers: { layers: ["Default", "Level", "Prop", "Player", "Companion"] },

  physics: {
    gravity: { x: 0, y: -9.81, z: 0 },
    // A crate that a character walks into should slide and stop, not skate away.
    defaultMaterial: { friction: 0.6, restitution: 0 },
  },

  // The overlay's three layers, back to front: the HUD and the touch controls sit in `hud`, the
  // pause dialog in `menu`, and the loading screen in `overlay` so it covers both.
  ui: { scaling: "css", layers: ["hud", "menu", "overlay"] },

  // Recast is seeded so two runs of one build lay the same navmesh polygons down in the same
  // order, which is what makes the companion's path reproducible.
  threeD: { navigationSeed: 1337 },

  // Neither `input.actions` nor `audio.buses` is set here, on purpose, and neither is `ui()`'s
  // `strings` option. Each of them would start its load in `onStart`, and a load started then is
  // delivered in a later frame's `PreUpdate` — so the first frames would run with no action maps
  // at all. `src/main.ts` loads all three before `app.start()` instead, where a completed load
  // settles at once.
});
