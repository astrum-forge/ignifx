import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import {
  AUDIO_BUSES_FORMAT,
  AUDIO_BUSES_FORMAT_VERSION,
  describeAudioBusesFormat,
  parseAudioBusesFile,
} from "../../src/assets/bus-file.js";

/**
 * Builds a well-formed document around a bus list.
 *
 * @param buses - The entries.
 * @returns The document.
 */
function file(buses: readonly unknown[]): unknown {
  return { format: AUDIO_BUSES_FORMAT, formatVersion: AUDIO_BUSES_FORMAT_VERSION, buses };
}

/**
 * The `IGX-####` code an assertion threw with.
 *
 * @param run - What should throw.
 * @returns The code, or `"none"` when nothing was thrown.
 */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : "not-an-ignifx-error";
  }
  return "none";
}

describe("parseAudioBusesFile", () => {
  it("reads a tree of buses with their parents, gains, and pause behaviour", () => {
    const buses = parseAudioBusesFile(
      file([
        { name: "Master" },
        { name: "Music", parent: "Master", volume: 0.8 },
        { name: "UI", parent: "Master", pausable: false },
      ]),
      "audio/buses.audio.json",
    );

    expect(buses).toHaveLength(3);
    expect(buses[0]).toEqual({ name: "Master", parent: null, volume: 1, pausable: null });
    expect(buses[1]).toEqual({ name: "Music", parent: "Master", volume: 0.8, pausable: null });
    expect(buses[2]?.pausable).toBe(false);
  });

  it("takes the default gain for an entry that declares none, or declares a bad one", () => {
    const buses = parseAudioBusesFile(file([{ name: "Master", volume: "loud" }]), "a.audio.json");

    expect(buses[0]?.volume).toBe(1);
  });

  it("refuses a document that is not an ignifx.audiobuses file", () => {
    expect(codeOf(() => parseAudioBusesFile({ format: "ignifx.scene" }, "a.audio.json"))).toBe("IGX-1003");
    expect(codeOf(() => parseAudioBusesFile([], "a.audio.json"))).toBe("IGX-1003");
    expect(codeOf(() => parseAudioBusesFile(null, "a.audio.json"))).toBe("IGX-1003");
  });

  it("refuses a document with no buses at all", () => {
    expect(codeOf(() => parseAudioBusesFile(file([]), "a.audio.json"))).toBe("IGX-1003");
  });

  it("refuses a format version this build cannot read", () => {
    const future = { format: AUDIO_BUSES_FORMAT, formatVersion: 99, buses: [{ name: "Master" }] };

    expect(codeOf(() => parseAudioBusesFile(future, "a.audio.json"))).toBe("IGX-1004");
  });

  it("refuses an entry with no usable name", () => {
    expect(codeOf(() => parseAudioBusesFile(file([{ volume: 1 }]), "a.audio.json"))).toBe("IGX-1003");
    expect(codeOf(() => parseAudioBusesFile(file([{ name: "" }]), "a.audio.json"))).toBe("IGX-1003");
    expect(codeOf(() => parseAudioBusesFile(file(["Master"]), "a.audio.json"))).toBe("IGX-1003");
  });

  it("refuses a duplicate bus name", () => {
    const document = file([{ name: "Master" }, { name: "Master", parent: "Master" }]);

    expect(codeOf(() => parseAudioBusesFile(document, "a.audio.json"))).toBe("IGX-1005");
  });

  it("refuses a parent that is not declared before the bus that names it", () => {
    const forward = file([{ name: "Music", parent: "Master" }, { name: "Master" }]);

    expect(codeOf(() => parseAudioBusesFile(forward, "a.audio.json"))).toBe("IGX-1006");
  });

  it("treats a self-parent as the same forward reference, which is what a cycle reduces to", () => {
    expect(codeOf(() => parseAudioBusesFile(file([{ name: "Master", parent: "Master" }]), "a.audio.json"))).toBe(
      "IGX-1006",
    );
  });
});

describe("describeAudioBusesFormat", () => {
  it("describes the file under its own format name, so the harness gives it its own page", () => {
    const description = describeAudioBusesFormat();

    expect(description.format).toBe(AUDIO_BUSES_FORMAT);
    expect(description.fields["format"]?.default).toBe(AUDIO_BUSES_FORMAT);
    expect(description.fields["buses[].name"]).toBeDefined();
  });
});
