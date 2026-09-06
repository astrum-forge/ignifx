import { describe, expect, it } from "vitest";
import { ANIMATOR_FORMAT, defaultStateOf, defineAnimator } from "../../src/animator/definition.js";
import { ThreeDErrorCode } from "../../src/errors.js";
import { heroAnimatorInput } from "../support/animator-fixture.js";
import type { AnimatorInput } from "../../src/animator/definition.js";

/** The code every invalid document is expected to carry. */
const INVALID = ThreeDErrorCode.invalidAnimatorFile;

/**
 * Builds a document from the hero fixture with one section replaced.
 *
 * @param patch - What to override.
 * @returns The input.
 */
function withPatch(patch: Partial<AnimatorInput>): AnimatorInput {
  return { ...heroAnimatorInput(), ...patch };
}

describe("defineAnimator", () => {
  it("fills in the defaults and freezes the result", () => {
    const definition = defineAnimator(heroAnimatorInput(), "hero.animator.json");
    expect(definition.format).toBe(ANIMATOR_FORMAT);
    expect(definition.formatVersion).toBe(1);
    expect(definition.layers).toHaveLength(1);
    expect(definition.states.map((state) => state.name)).toEqual(["locomotion", "jump"]);
    expect(definition.states[0]?.layer).toBe("Base");
    expect(definition.states[0]?.speed).toBe(1);
    expect(definition.transitions[0]?.interruptible).toBe(false);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it("synthesises a base layer when the document declares none", () => {
    const definition = defineAnimator({ states: [{ name: "idle", clip: "idle" }] }, "x");
    expect(definition.layers).toHaveLength(1);
    expect(definition.layers[0]?.name).toBe("Base");
    expect(defaultStateOf(definition, definition.layers[0] ?? definition.layers[0]!)).toBe("idle");
  });

  it("sorts a blend tree's children and a state's events", () => {
    const definition = defineAnimator(
      {
        parameters: [{ name: "speed", kind: "float" }],
        states: [
          {
            name: "run",
            blendTree: "t",
            events: [
              { time: 0.8, name: "b" },
              { time: 0.2, name: "a" },
            ],
          },
        ],
        blendTrees1D: [
          {
            name: "t",
            param: "speed",
            children: [
              { clip: "fast", threshold: 5 },
              { clip: "slow", threshold: 1 },
            ],
          },
        ],
      },
      "x",
    );
    expect(definition.blendTrees1D[0]?.children.map((child) => child.clip)).toEqual(["slow", "fast"]);
    expect(definition.states[0]?.events.map((event) => event.name)).toEqual(["a", "b"]);
  });

  it("reads a boolean parameter default as 1 and clears a trigger", () => {
    const definition = defineAnimator(
      {
        parameters: [
          { name: "armed", kind: "bool", value: true },
          { name: "fire", kind: "trigger", value: 5 },
        ],
        states: [{ name: "idle", clip: "idle" }],
      },
      "x",
    );
    expect(definition.parameters[0]?.value).toBe(1);
    expect(definition.parameters[1]?.value).toBe(0);
  });

  it("rejects a wrong format header and an unreadable version", () => {
    expect(() => defineAnimator(withPatch({ format: "ignifx.scene" }), "x")).toThrow(
      expect.objectContaining({ code: INVALID }),
    );
    expect(() => defineAnimator(withPatch({ formatVersion: 99 }), "x")).toThrow(
      expect.objectContaining({ code: INVALID }),
    );
  });

  it("rejects duplicate names", () => {
    expect(() =>
      defineAnimator({ parameters: [{ name: "a" }, { name: "a" }], states: [{ name: "s", clip: "c" }] }, "x"),
    ).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() =>
      defineAnimator(
        {
          states: [
            { name: "s", clip: "c" },
            { name: "s", clip: "d" },
          ],
        },
        "x",
      ),
    ).toThrow(expect.objectContaining({ code: INVALID }));
  });

  it("rejects a state with no clip and a state with both", () => {
    expect(() => defineAnimator({ states: [{ name: "s" }] }, "x")).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() => defineAnimator({ states: [{ name: "s", clip: "c", blendTree: "t" }] }, "x")).toThrow(
      expect.objectContaining({ code: INVALID }),
    );
  });

  it("rejects unknown enum values", () => {
    expect(() =>
      defineAnimator({ parameters: [{ name: "a", kind: "vector" }], states: [{ name: "s", clip: "c" }] }, "x"),
    ).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() =>
      defineAnimator(
        { layers: [{ name: "L", maskMode: "sideways" }], states: [{ name: "s", clip: "c", layer: "L" }] },
        "x",
      ),
    ).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() =>
      defineAnimator(
        {
          parameters: [{ name: "p" }],
          states: [
            { name: "a", clip: "a" },
            { name: "b", clip: "b" },
          ],
          transitions: [{ from: "a", to: "b", conditions: [{ param: "p", op: "approximately" }] }],
        },
        "x",
      ),
    ).toThrow(expect.objectContaining({ code: INVALID }));
  });

  it("rejects references that do not resolve", () => {
    expect(() => defineAnimator({ states: [{ name: "s", blendTree: "missing" }] }, "x")).toThrow(
      expect.objectContaining({ code: INVALID }),
    );
    expect(() =>
      defineAnimator({ states: [{ name: "s", clip: "c" }], transitions: [{ from: "s", to: "gone" }] }, "x"),
    ).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() =>
      defineAnimator(
        {
          states: [
            { name: "a", clip: "a" },
            { name: "b", clip: "b" },
          ],
          transitions: [{ from: "a", to: "b", conditions: [{ param: "ghost", op: "gt", value: 1 }] }],
        },
        "x",
      ),
    ).toThrow(expect.objectContaining({ code: INVALID }));
  });

  it("rejects a transition that crosses layers and a layer with no states", () => {
    expect(() =>
      defineAnimator(
        {
          layers: [{ name: "Base" }, { name: "Upper" }],
          states: [
            { name: "a", clip: "a", layer: "Base" },
            { name: "b", clip: "b", layer: "Upper" },
          ],
          transitions: [{ from: "a", to: "b" }],
        },
        "x",
      ),
    ).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() =>
      defineAnimator({ layers: [{ name: "Base" }, { name: "Empty" }], states: [{ name: "a", clip: "a" }] }, "x"),
    ).toThrow(expect.objectContaining({ code: INVALID }));
  });

  it("rejects an event outside [0, 1] and a document with no states", () => {
    expect(() =>
      defineAnimator({ states: [{ name: "s", clip: "c", events: [{ time: 2, name: "boom" }] }] }, "x"),
    ).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() => defineAnimator({ states: [] }, "x")).toThrow(expect.objectContaining({ code: INVALID }));
  });

  it("rejects malformed sections", () => {
    expect(() => defineAnimator({ states: "nope" as unknown as readonly unknown[] }, "x")).toThrow(
      expect.objectContaining({ code: INVALID }),
    );
    expect(() => defineAnimator({ states: [42] }, "x")).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() => defineAnimator({ states: [{ name: "" }] }, "x")).toThrow(expect.objectContaining({ code: INVALID }));
    expect(() =>
      defineAnimator(
        { blendTrees1D: [{ name: "t", param: "p", children: [] }], states: [{ name: "s", clip: "c" }] },
        "x",
      ),
    ).toThrow(expect.objectContaining({ code: INVALID }));
  });

  it("names the document in the error", () => {
    try {
      defineAnimator({ states: [] }, "3d/hero.animator.json");
      expect.unreachable("an empty document is invalid");
    } catch (error) {
      expect(String(error)).toContain("3d/hero.animator.json");
    }
  });
});
