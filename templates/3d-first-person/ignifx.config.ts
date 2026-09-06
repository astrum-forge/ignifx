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
    clearColor: { r: 0.043, g: 0.055, b: 0.078, a: 1 },
    msaaSamples: 4,
    features: { shadows: true },
  },

  time: { fixedDeltaTime: 1 / 60 },

  // `Interactable` is its own layer so the interaction ray can be filtered to it with a layer mask
  // instead of walking every hit and asking what it is.
  layers: { layers: ["Default", "Level", "Prop", "Player", "Interactable"] },

  physics: {
    gravity: { x: 0, y: -9.81, z: 0 },
    defaultMaterial: { friction: 0.6, restitution: 0 },
  },

  // The crosshair and the touch sticks sit in `hud`, the pause dialog in `menu`, and the loading
  // screen in `overlay` so it covers both.
  ui: { scaling: "css", layers: ["hud", "menu", "overlay"] },

  // Loaded before `app.start()` by `src/main.ts` rather than declared here: an extension that
  // starts its own load in `onStart` gets it delivered in a later frame's `PreUpdate`, so the
  // first frames would run with no action maps.
});
