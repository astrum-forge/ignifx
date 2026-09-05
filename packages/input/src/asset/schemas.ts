import { INPUT_ACTIONS_FORMAT, INPUT_ACTIONS_FORMAT_VERSION } from "./definition.js";
import type { JsonSchemaObject, SchemaDescription } from "@ignifx/core";

/**
 * What `pnpm docs:schemas` renders for this package
 * (`docs/architecture/16-docs-harness-and-skill.md` §3, `scripts/README.md`). The generated page
 * takes its name from the format id, so the field table lands on
 * `skills/ignifx/references/formats/ignifx.inputactions.md`, with the hand-written prose page
 * `inputactions.md` beside it — the same split Phase 2 settled for the scene and material formats.
 */

/**
 * Describes the `ignifx.inputactions` file format for the documentation harness.
 *
 * @returns The description of the top-level file fields.
 *
 * @public
 */
export function describeInputActionsFormat(): SchemaDescription {
  return {
    title: "Input actions file",
    format: INPUT_ACTIONS_FORMAT,
    description: "Action maps, their actions, the bindings that feed them, and the control schemes that group devices.",
    fields: {
      format: { kind: "str", default: INPUT_ACTIONS_FORMAT, description: `Always "${INPUT_ACTIONS_FORMAT}".` },
      formatVersion: {
        kind: "u32",
        default: INPUT_ACTIONS_FORMAT_VERSION,
        description: "The file format version; 1 before ignifx 1.0.",
      },
      controlSchemes: {
        kind: "array",
        default: [],
        description: 'Named device groups: { "name": "Gamepad", "devices": ["Gamepad"] }.',
      },
      maps: {
        kind: "array",
        default: [],
        description: 'Action maps: { "name": "Player", "enabled": true, "actions": [ … ] }.',
      },
    },
  };
}

/**
 * The JSON Schema the Vite plugin validates `.input.json` files against
 * (`docs/architecture/06-serialization-and-scene-format.md` §6, §8).
 *
 * @returns The schema document.
 *
 * @example
 * ```ts
 * await writeFile("inputactions.schema.json", JSON.stringify(inputActionsJsonSchema(), null, 2));
 * ```
 *
 * @public
 */
export function inputActionsJsonSchema(): JsonSchemaObject {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ignifx.com/schemas/ignifx.inputactions.v1.json",
    title: "ignifx input actions file",
    type: "object",
    required: ["format", "formatVersion", "maps"],
    additionalProperties: false,
    properties: {
      format: { const: INPUT_ACTIONS_FORMAT },
      formatVersion: { const: INPUT_ACTIONS_FORMAT_VERSION },
      controlSchemes: { type: "array", items: { $ref: "#/$defs/controlScheme" } },
      maps: { type: "array", items: { $ref: "#/$defs/map" } },
    },
    $defs: {
      controlScheme: {
        type: "object",
        required: ["name", "devices"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          devices: {
            type: "array",
            items: { type: "string", enum: ["Keyboard", "Mouse", "Pointer", "Touch", "Gamepad", "Virtual"] },
          },
        },
      },
      map: {
        type: "object",
        required: ["name", "actions"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          enabled: { type: "boolean" },
          actions: { type: "array", items: { $ref: "#/$defs/action" } },
        },
      },
      action: {
        type: "object",
        required: ["name", "bindings"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["button", "axis", "vector2"] },
          bindings: { type: "array", items: { $ref: "#/$defs/binding" } },
        },
      },
      binding: {
        type: "object",
        additionalProperties: false,
        anyOf: [{ required: ["path"] }, { required: ["composite"] }],
        properties: {
          path: { $ref: "#/$defs/path" },
          composite: { type: "string", enum: ["2DVector", "1DAxis", "ButtonWithModifier"] },
          up: { $ref: "#/$defs/path" },
          down: { $ref: "#/$defs/path" },
          left: { $ref: "#/$defs/path" },
          right: { $ref: "#/$defs/path" },
          negative: { $ref: "#/$defs/path" },
          positive: { $ref: "#/$defs/path" },
          modifier: { $ref: "#/$defs/path" },
          button: { $ref: "#/$defs/path" },
          processors: { type: "array", items: { type: "string" } },
          scheme: { type: "string" },
        },
      },
      path: {
        type: "string",
        pattern: "^<(Keyboard|Mouse|Pointer|Touch|Gamepad|Virtual)>(\\{\\d+\\})?/.+$",
      },
    },
  };
}
