import { defineConfig } from "@ignifx/vite-plugin";

/**
 * Project settings, injected as `import.meta.env.IGNIFX_CONFIG` and handed to `createApp`.
 *
 * `brdfLut` is an *address*, resolved through the manifest the plugin generates from
 * `vite.config.ts`'s `assetRoot`. The default is `environments/brdf-lut.png`
 * (`DEFAULT_BRDF_LUT_ADDRESS`); this project keeps its fixtures flat, so it says so here.
 */
export default defineConfig({
  rendering: {
    clearColor: { r: 0.043, g: 0.059, b: 0.094, a: 1 },
    msaaSamples: 4,
    brdfLut: "brdf-lut.png",
    // `postProcessing` renders the scene into an offscreen target so the `PostProcessStack` has
    // something it is allowed to sample; it has to be declared here, before `createApp` builds the
    // scene, which is why `?post=1` only switches the *effects* on. It costs one full-screen blit
    // per frame while no chain is recorded.
    features: { shadows: true, postProcessing: true },
  },
  time: { fixedDeltaTime: 1 / 60 },
});
