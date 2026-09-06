import { describe, expect, it } from "vitest";
import { resolveClipFrames } from "../../src/animation/definition.js";

/**
 * What `from`/`to` means in an `ignifx.spriteanimation` clip.
 *
 * The pair is an **inclusive range over atlas indices**, not two endpoints joined by name, so a
 * range whose endpoints are not adjacent in the sheet plays everything the packer put between them.
 * Phase 12 read it the other way round and got frames it did not ask for; these are the assertions
 * the TSDoc and the generated format page now describe.
 */

/** An atlas whose `run` frames are deliberately not contiguous. */
const ATLAS: readonly string[] = ["run_0", "idle_0", "run_1", "idle_1", "run_2"];

/**
 * Looks a frame name up in {@link ATLAS}.
 *
 * @param name - The frame name.
 * @returns Its index, or `-1`.
 */
function indexOf(name: string): number {
  return ATLAS.indexOf(name);
}

describe("resolveClipFrames", () => {
  it("plays an explicit frame list in the order written, however the atlas is packed", () => {
    expect(resolveClipFrames({ name: "run", frames: ["run_0", "run_1", "run_2"] }, indexOf)).toEqual([0, 2, 4]);
  });

  it("drops a listed frame the atlas does not carry", () => {
    expect(resolveClipFrames({ name: "run", frames: ["run_0", "missing", "run_1"] }, indexOf)).toEqual([0, 2]);
  });

  it("walks every atlas index between from and to, including the ones nobody asked for", () => {
    expect(resolveClipFrames({ name: "run", from: "run_0", to: "run_2" }, indexOf)).toEqual([0, 1, 2, 3, 4]);
  });

  it("plays the range backwards when to sits before from", () => {
    expect(resolveClipFrames({ name: "back", from: "run_2", to: "run_1" }, indexOf)).toEqual([4, 3, 2]);
  });

  it("resolves a single-frame range to that one index", () => {
    expect(resolveClipFrames({ name: "pose", from: "idle_0", to: "idle_0" }, indexOf)).toEqual([1]);
  });

  it("resolves to nothing when an endpoint is not in the atlas", () => {
    expect(resolveClipFrames({ name: "run", from: "run_0", to: "missing" }, indexOf)).toEqual([]);
  });

  it("prefers the frame list when a clip carries both", () => {
    expect(resolveClipFrames({ name: "run", frames: ["run_0", "run_2"], from: "run_0", to: "run_2" }, indexOf)).toEqual(
      [0, 4],
    );
  });
});
