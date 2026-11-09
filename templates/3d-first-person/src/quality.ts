import { Environment, ReflectionProbe, RENDERING_QUALITIES } from "@ignifx/core";
import type { App, RenderingQuality } from "@ignifx/core";

/**
 * The tier the desktop build runs at. `"high"` turns on HDR, TAA and full-resolution GTAO; the
 * post-process stack's bloom becomes HDR bloom under HDR, and {@link addTierLook} adds AgX.
 */
export const DESKTOP_QUALITY: RenderingQuality = "high";

/**
 * Reads a `rendering.quality` tier from the `?quality=` query flag.
 *
 * @param flag - The flag's value, or `null` when the URL has none.
 * @returns The tier, or `null` when the flag is absent or names no tier.
 */
export function qualityFlag(flag: string | null): RenderingQuality | null {
  return RENDERING_QUALITIES.find((tier: RenderingQuality) => tier === flag) ?? null;
}

/**
 * The tier this run uses: the `?quality=` flag when it names one, {@link DESKTOP_QUALITY} in the
 * Electron build (whose preload hands the page `window.ignifxHost`), and otherwise none, which keeps
 * `ignifx.config.ts` as written. The browser build stays at the config's own effects so it runs on
 * phones and integrated GPUs; a desktop is the device the `high` budget is written for.
 *
 * @param flag - The `?quality=` flag's value, or `null`.
 * @returns The tier, or `null` to keep the config's.
 */
export function chooseQuality(flag: string | null): RenderingQuality | null {
  return qualityFlag(flag) ?? ("ignifxHost" in window ? DESKTOP_QUALITY : null);
}

/**
 * Adds the look that goes with a named tier: an `Environment` that tone maps with AgX, which keeps
 * bright HDR colour from clipping to flat white, and at `"high"` one `ReflectionProbe` over the
 * arena. Nothing for `null` or `"custom"`.
 *
 * @remarks
 * The probe borrows its lighting tables from a loaded environment map, and the template loads none
 * (`Environment.environment` stays `null`), so it captures nothing until a game assigns an `.env`
 * to the `Environment`; from then on shiny materials reflect the arena instead of the sky map.
 *
 * @param app - The app, before `app.start()`.
 * @param quality - The tier this run uses.
 */
export function addTierLook(app: App, quality: RenderingQuality | null): void {
  if (quality === null || quality === "custom") {
    return;
  }
  app.world.createEntity("Environment").addComponent(Environment, {
    imageProcessing: { exposure: 1, contrast: 1, toneMapping: "agx" },
  });
  if (quality === "high") {
    // The arena's walls stand at ±12 m; the box is as tall so the sky reads as far away.
    app.world
      .createEntity("Reflection probe", { position: { x: 0, y: 1.5, z: 0 } })
      .addComponent(ReflectionProbe, { size: 256, boxProjection: { x: 24, y: 24, z: 24 } });
  }
}

/**
 * The project settings with `rendering.quality` set to `quality`, keeping the rest of the section.
 *
 * @param config - The settings from `ignifx.config.ts`.
 * @param quality - The tier to run at, or `null` to keep the config's own.
 * @returns The settings to hand `createApp`.
 */
export function withQuality(
  config: Readonly<Record<string, unknown>>,
  quality: RenderingQuality | null,
): Readonly<Record<string, unknown>> {
  if (quality === null) {
    return config;
  }
  const rendering: unknown = config["rendering"];
  const section = typeof rendering === "object" && rendering !== null ? rendering : {};
  return { ...config, rendering: { ...section, quality } };
}
