import { describe, expect, it } from "vitest";
import { sceneColorPassTarget } from "../../../src/lite/gpu/scene-color-passes.js";

/** Runs the target picker over `count` passes and returns every target, then the scratches. */
function plan(count: number, isTargetWritable: boolean): { readonly targets: string[]; readonly scratches: string[] } {
  const scratches: string[] = [];
  const targets: string[] = [];
  let source = "S";
  for (let index = 0; index < count; index += 1) {
    source = sceneColorPassTarget(source, "S", isTargetWritable, scratches, (at) => `scratch${String(at)}`);
    targets.push(source);
  }
  return { targets, scratches };
}

describe("sceneColorPassTarget", () => {
  it("ping-pongs through the scene target when it may be written (HDR)", () => {
    expect(plan(3, true)).toEqual({ targets: ["scratch0", "S", "scratch0"], scratches: ["scratch0"] });
  });

  it("never writes a scene target that a write would reallocate (plain path)", () => {
    expect(plan(3, false)).toEqual({
      targets: ["scratch0", "scratch1", "scratch0"],
      scratches: ["scratch0", "scratch1"],
    });
  });
});
