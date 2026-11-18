import { describe, expect, it } from "vitest";
import { planSceneColorPasses, sceneColorPassTarget } from "../../../src/lite/gpu/scene-color-passes.js";

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

/** Plans the passes and writes each step as `source>target`, a copy in brackets. */
function steps(inPlace: readonly boolean[], isTargetWritable: boolean): string[] {
  return planSceneColorPasses(inPlace, "S", isTargetWritable, [], (at) => `scratch${String(at)}`).map((step) =>
    step.pass === null ? `[${step.source}>${step.target}]` : `${step.source}>${step.target}`,
  );
}

describe("planSceneColorPasses", () => {
  it("copies an odd count of two-target passes back into the scene target", () => {
    expect(steps([false], true)).toEqual(["S>scratch0", "[scratch0>S]"]);
    expect(steps([false, false], true)).toEqual(["S>scratch0", "scratch0>S"]);
  });

  it("lets an in-place pass blend straight into a writable scene target (HDR)", () => {
    expect(steps([true], true)).toEqual(["S>S"]);
  });

  it("runs an in-place pass on the scratch the pass before it wrote", () => {
    expect(steps([false, true], true)).toEqual(["S>scratch0", "scratch0>scratch0", "[scratch0>S]"]);
    expect(steps([false, true], false)).toEqual(["S>scratch0", "scratch0>scratch0", "[scratch0>S]"]);
  });

  it("stages a scene target no pass may write before an in-place pass (plain path)", () => {
    expect(steps([true], false)).toEqual(["[S>scratch0]", "scratch0>scratch0", "[scratch0>S]"]);
  });

  it("plans nothing for no passes", () => {
    expect(steps([], true)).toEqual([]);
  });
});
