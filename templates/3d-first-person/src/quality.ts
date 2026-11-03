import { RENDERING_QUALITIES } from "@ignifx/core";
import type { RenderingQuality } from "@ignifx/core";

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
