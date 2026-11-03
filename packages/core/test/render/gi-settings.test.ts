import { describe, expect, it } from "vitest";
import {
  defaultAutoExposureSettings,
  defaultRenderingSettings,
  resolveAmbientOcclusion,
  resolveTaaSettings,
  toAutoExposureOptions,
  toRenderingFeatures,
} from "../../src/render/rendering-settings.js";
import type { RenderingSettings } from "../../src/render/rendering-settings.js";

/**
 * The GI records of the `rendering` section read as complete records (GI plan G8, G5–G6, G14): the
 * settings store merges a section shallowly, so each resolver fills in what a project left out and
 * clamps what it wrote out of range.
 */

/**
 * The defaults with some fields replaced.
 *
 * @param patch - The fields to replace.
 * @returns The section.
 */
function settingsWith(patch: Partial<RenderingSettings>): RenderingSettings {
  return { ...defaultRenderingSettings(), ...patch };
}

describe("resolveAmbientOcclusion", () => {
  it("reads a missing record as off, at half quality, with the defaults", () => {
    const resolved = resolveAmbientOcclusion(undefined);
    expect(resolved.enabled).toBe(false);
    expect(resolved.quality).toBe("half");
    expect(resolved).toEqual(resolveAmbientOcclusion({}));
  });

  it("keeps in-range values and full quality", () => {
    expect(resolveAmbientOcclusion({ enabled: true, quality: "full", radius: 2, intensity: 3, falloff: 0.5 })).toEqual({
      enabled: true,
      quality: "full",
      radius: 2,
      intensity: 3,
      falloff: 0.5,
    });
  });

  it("clamps out-of-range values and replaces non-finite ones", () => {
    const low = resolveAmbientOcclusion({ radius: -1, intensity: -1, falloff: -1 });
    expect(low).toMatchObject({ radius: 0.01, intensity: 0, falloff: 0 });
    const high = resolveAmbientOcclusion({ intensity: 100, falloff: 5 });
    expect(high).toMatchObject({ intensity: 8, falloff: 1 });
    const defaults = resolveAmbientOcclusion(undefined);
    expect(resolveAmbientOcclusion({ radius: Number.NaN, intensity: Number.POSITIVE_INFINITY })).toMatchObject({
      radius: defaults.radius,
      intensity: defaults.intensity,
    });
  });
});

describe("toRenderingFeatures with ambient occlusion", () => {
  it("turns material plugins on when GTAO is enabled, since it reaches PBR through one", () => {
    expect(toRenderingFeatures(settingsWith({})).materialPlugins).toBe(false);
    const withAo = settingsWith({ ambientOcclusion: { ...resolveAmbientOcclusion(undefined), enabled: true } });
    expect(toRenderingFeatures(withAo).materialPlugins).toBe(true);
  });
});

describe("resolveTaaSettings", () => {
  it("reads a section without a taa record as off with the defaults", () => {
    const { taa: _taa, ...rest } = defaultRenderingSettings();
    // A section saved before `taa` existed has no record at all.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const resolved = resolveTaaSettings(rest as RenderingSettings);
    expect(resolved.enabled).toBe(false);
    expect(resolved.clamp).toBe(true);
    expect(resolved).toEqual(resolveTaaSettings(defaultRenderingSettings()));
  });

  it("keeps declared values and falls back for non-finite ones", () => {
    const defaults = resolveTaaSettings(defaultRenderingSettings());
    const declared = resolveTaaSettings(
      settingsWith({ taa: { enabled: true, blend: 0.2, sharpness: 0.4, clamp: false, cutDistance: 3 } }),
    );
    expect(declared).toEqual({ enabled: true, blend: 0.2, sharpness: 0.4, clamp: false, cutDistance: 3 });
    const broken = resolveTaaSettings(
      settingsWith({
        taa: { enabled: true, blend: Number.NaN, sharpness: Number.NaN, clamp: true, cutDistance: Number.NaN },
      }),
    );
    expect(broken).toMatchObject({
      blend: defaults.blend,
      sharpness: defaults.sharpness,
      cutDistance: defaults.cutDistance,
    });
  });
});

describe("toAutoExposureOptions", () => {
  it("is null unless both hdr and autoExposure.enabled are on", () => {
    const on = { ...defaultAutoExposureSettings(), enabled: true };
    expect(toAutoExposureOptions(settingsWith({ hdr: false, autoExposure: on }))).toBeNull();
    expect(toAutoExposureOptions(settingsWith({ hdr: true }))).toBeNull();
  });

  it("fills every knob a partial record leaves out with its default", () => {
    const defaults = defaultAutoExposureSettings();
    // The store merges shallowly, so `{ enabled: true }` arrives with nothing else.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const partial = { enabled: true } as RenderingSettings["autoExposure"];
    expect(toAutoExposureOptions(settingsWith({ hdr: true, autoExposure: partial }))).toEqual({
      minEv: defaults.minEv,
      maxEv: defaults.maxEv,
      speedUp: defaults.speedUp,
      speedDown: defaults.speedDown,
      compensation: defaults.compensation,
    });
  });

  it("keeps every knob a full record declares", () => {
    const declared = { enabled: true, minEv: -2, maxEv: 4, speedUp: 1, speedDown: 0.5, compensation: 0.25 };
    expect(toAutoExposureOptions(settingsWith({ hdr: true, autoExposure: declared }))).toEqual({
      minEv: -2,
      maxEv: 4,
      speedUp: 1,
      speedDown: 0.5,
      compensation: 0.25,
    });
  });
});
