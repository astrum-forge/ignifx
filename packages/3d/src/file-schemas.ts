import { array, bool, defineSchema, enumOf, f32, record, str, u32 } from "@ignifx/core";
import {
  ANIMATOR_CONDITION_OPS,
  ANIMATOR_FORMAT,
  ANIMATOR_FORMAT_VERSION,
  ANIMATOR_MASK_MODES,
  ANIMATOR_PARAMETER_KINDS,
} from "./animator/definition.js";
import type { Schema } from "@ignifx/core";

/**
 * The declarative schema for the one file format `@ignifx/3d` reads
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * It exists for **documentation and tooling**, not for the loader: `defineAnimator` validates with
 * hand-written checks that produce an actionable `IGX-1201` message naming the offending state or
 * transition. The schema here is what `pnpm docs:schemas` renders into
 * `skills/ignifx/references/formats/`, and what a JSON Schema for an editor is generated from. A
 * test asserts that a fixture the loader accepts also validates against this schema.
 */

/**
 * The `ignifx.animator` document schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function animatorFileSchema(): Schema {
  return defineSchema({
    format: str(ANIMATOR_FORMAT, { tooltip: "Always ignifx.animator." }),
    formatVersion: u32(ANIMATOR_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    parameters: array(
      record({
        name: str("", { tooltip: "The parameter's name; what setFloat and a condition's param use." }),
        kind: enumOf(ANIMATOR_PARAMETER_KINDS, "float", { tooltip: "float, int, bool, or trigger." }),
        value: f32(0, { tooltip: "The value it starts at; ignored for a trigger." }),
      }),
      [],
      { tooltip: "The parameters the state machine reads." },
    ),
    layers: array(
      record({
        name: str("Base", { tooltip: "The layer's name." }),
        weight: f32(1, { min: 0, max: 1, tooltip: "How much of this layer's pose reaches the result." }),
        mask: array(str(), [], { tooltip: "The bone names the mask lists." }),
        maskMode: enumOf(ANIMATOR_MASK_MODES, "include", { tooltip: "Whether mask lists what animates." }),
        additive: bool(false, { tooltip: "Whether the layer adds to the pose beneath it." }),
        defaultState: str("", { tooltip: "The state the layer starts in; its first state when empty." }),
      }),
      [],
      { tooltip: "The layers, base first." },
    ),
    states: array(
      record({
        name: str("", { tooltip: "The state's name; what play() and a transition's to take." }),
        layer: str("", { tooltip: "The layer the state belongs to; the base layer when empty." }),
        clip: str("", { tooltip: "The animation-group name this state plays." }),
        blendTree: str("", { tooltip: "The 1D blend tree this state plays, instead of a clip." }),
        speed: f32(1, { tooltip: "A multiplier on the clip's own rate." }),
        loop: bool(true, { tooltip: "Whether the state restarts at its end." }),
        events: array(
          record({
            time: f32(0, { min: 0, max: 1, tooltip: "Where in the clip the event sits, as a fraction." }),
            name: str("", { tooltip: "The name emitted on Animator.onEvent." }),
          }),
          [],
          { tooltip: "Events fired as the state plays." },
        ),
      }),
      [],
      { tooltip: "The states." },
    ),
    transitions: array(
      record({
        from: str("", { tooltip: "The state this leaves, or any." }),
        to: str("", { tooltip: "The state this enters." }),
        conditions: array(
          record({
            param: str("", { tooltip: "The parameter to test." }),
            op: enumOf(ANIMATOR_CONDITION_OPS, "eq", { tooltip: "The comparison." }),
            value: f32(0, { tooltip: "What to compare against; ignored by trigger." }),
          }),
          [],
          { tooltip: "Every condition, all of which must pass." },
        ),
        duration: f32(0.2, { min: 0, tooltip: "How long the crossfade takes, in seconds." }),
        exitTime: f32(0, { min: 0, max: 1, tooltip: "The earliest normalized time the source may be left at." }),
        interruptible: bool(false, { tooltip: "Whether this may start while another transition runs." }),
      }),
      [],
      { tooltip: "The transitions, in priority order." },
    ),
    blendTrees1D: array(
      record({
        name: str("", { tooltip: "The tree's name; what a state's blendTree takes." }),
        param: str("", { tooltip: "The parameter the tree reads." }),
        children: array(
          record({
            clip: str("", { tooltip: "The animation-group name this child plays." }),
            threshold: f32(0, { tooltip: "The parameter value at which this child reaches full weight." }),
          }),
          [],
          { tooltip: "The children, sorted ascending by threshold." },
        ),
      }),
      [],
      { tooltip: "The 1D blend trees." },
    ),
  });
}
