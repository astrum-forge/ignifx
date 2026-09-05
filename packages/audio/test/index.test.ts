import { describe, expect, it } from "vitest";

/**
 * The barrel is imported dynamically: awaiting the import proves the module evaluates without
 * throwing and without doing anything (`CONSTITUTION.md` §3.5), which a static import would only
 * prove as a side effect of whatever else the file does.
 */
describe("@ignifx/audio barrel", () => {
  it("imports without executing anything", async () => {
    const barrel = await import("../src/index.js");

    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });

  it("exports the extension factory, the components, and the two backends", async () => {
    const barrel = await import("../src/index.js");
    const names = new Set(Object.keys(barrel));

    for (const name of [
      "audio",
      "AudioService",
      "AudioSource",
      "AudioListener",
      "MusicPlayer",
      "AudioClip",
      "AudioBusesAsset",
      "HeadlessBackend",
      "WebAudioBackend",
      "describeSchemas",
      "AudioErrorCode",
      "AUDIO_PUMP_ORDER",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("exports no `default`, as coding standards §4 requires of a package barrel", async () => {
    const barrel = await import("../src/index.js");

    expect(Object.keys(barrel)).not.toContain("default");
  });
});
