import { defineAnimator } from "../../src/animator/definition.js";
import type { AnimatorDefinition, AnimatorInput } from "../../src/animator/definition.js";

/**
 * The animator documents the node suites run against: one locomotion machine with a blend tree, a
 * trigger, an exit time, and an event, and a small helper for one-off documents.
 */

/**
 * The document the hero fixture describes, as a plain object.
 *
 * @returns The input, fresh each call so a test can mutate it.
 */
export function heroAnimatorInput(): AnimatorInput {
  return {
    format: "ignifx.animator",
    formatVersion: 1,
    parameters: [
      { name: "speed", kind: "float", value: 0 },
      { name: "grounded", kind: "bool", value: true },
      { name: "jump", kind: "trigger" },
    ],
    layers: [{ name: "Base", weight: 1, defaultState: "locomotion" }],
    states: [
      { name: "locomotion", blendTree: "locomotion", loop: true },
      { name: "jump", clip: "jump", loop: false, events: [{ time: 0.75, name: "landed" }] },
    ],
    transitions: [
      { from: "any", to: "jump", conditions: [{ param: "jump", op: "trigger" }], duration: 0.1 },
      {
        from: "jump",
        to: "locomotion",
        conditions: [{ param: "grounded", op: "eq", value: true }],
        duration: 0.2,
        exitTime: 0.9,
      },
    ],
    blendTrees1D: [
      {
        name: "locomotion",
        param: "speed",
        children: [
          { clip: "idle", threshold: 0 },
          { clip: "walk", threshold: 2 },
          { clip: "run", threshold: 6 },
        ],
      },
    ],
  };
}

/**
 * The parsed hero document.
 *
 * @returns The definition.
 */
export function heroAnimator(): AnimatorDefinition {
  return defineAnimator(heroAnimatorInput(), "test/hero.animator.json");
}
