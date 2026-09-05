import { defineConfig } from "@ignifx/vite-plugin";

/**
 * Project settings, injected as `import.meta.env.IGNIFX_CONFIG` and handed to `createApp`.
 *
 * `features.shadows` has to be decided here rather than at runtime: the flag is read once, when
 * `app.start()` registers the scene with Lite, and asking for it afterwards throws `IGX-0704`.
 */
export default defineConfig({
  rendering: {
    clearColor: { r: 0.043, g: 0.059, b: 0.094, a: 1 },
    msaaSamples: 4,
    features: { shadows: true },
  },
  time: { fixedDeltaTime: 1 / 60 },
});
