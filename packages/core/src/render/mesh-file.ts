import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { MESH_PRIMITIVES } from "./mesh-asset.js";
import type { MeshPrimitive, MeshPrimitiveDefinition } from "./mesh-asset.js";
import type { JsonSchemaObject } from "../schema/describe.js";
import type { JsonObject } from "../schema/json.js";

/**
 * The `.mesh.json` file format (ADR-0029): one primitive and the options its `MeshAsset` factory
 * takes, so a scene file can name a primitive by address.
 *
 * ```json
 * { "format": "ignifx.mesh", "formatVersion": 1, "primitive": "box", "options": { "size": 1 } }
 * ```
 *
 * One table, {@link MESH_PRIMITIVE_OPTIONS}, drives the runtime check and the JSON Schema, so the
 * two cannot drift apart.
 */

/**
 * The `format` header a `.mesh.json` carries.
 *
 * @public
 */
export const MESH_FILE_FORMAT = "ignifx.mesh";

/**
 * The only `.mesh.json` `formatVersion` this build reads.
 *
 * @public
 */
export const MESH_FORMAT_VERSION = 1;

/**
 * The address suffix that selects the mesh loader.
 *
 * @public
 */
export const MESH_FILE_EXTENSION = ".mesh.json";

/**
 * What a primitive option holds: a length in metres (finite, zero or more), a segment count
 * (a whole number, one or more), or a pair of finite numbers.
 *
 * @public
 */
export type MeshOptionKind = "length" | "count" | "pair";

/**
 * For each primitive, every option its factory's options type declares, and what it holds.
 *
 * @public
 */
export type MeshPrimitiveOptionKinds = {
  readonly [P in MeshPrimitive]: {
    readonly [K in keyof Extract<MeshPrimitiveDefinition, { readonly primitive: P }>["options"]]-?: MeshOptionKind;
  };
};

/**
 * Every option each primitive takes, and what it holds. The keys are exactly the fields of the
 * factory's options type (`BoxMeshOptions`, …); the compiler checks that.
 *
 * @public
 */
export const MESH_PRIMITIVE_OPTIONS: MeshPrimitiveOptionKinds = {
  box: { size: "length", width: "length", height: "length", depth: "length" },
  sphere: { diameter: "length", segments: "count" },
  plane: { size: "length", width: "length", height: "length" },
  ground: { width: "length", height: "length", subdivisions: "count", uvScale: "pair" },
  cylinder: {
    height: "length",
    diameter: "length",
    diameterTop: "length",
    diameterBottom: "length",
    tessellation: "count",
  },
  capsule: { height: "length", radius: "length", tessellation: "count" },
  torus: { diameter: "length", thickness: "length", tessellation: "count" },
};

/** The top-level fields a mesh file may carry. */
const MESH_FILE_FIELDS: Readonly<Record<string, true>> = Object.freeze({
  format: true,
  formatVersion: true,
  name: true,
  primitive: true,
  options: true,
});

/**
 * A `.mesh.json` file, read and checked.
 *
 * @internal
 */
export interface MeshFile {
  /** The name the file gives the mesh, or `null` to use its address. */
  readonly name: string | null;
  /** The primitive and its options. */
  readonly definition: MeshPrimitiveDefinition;
}

/**
 * Reads and checks a parsed `.mesh.json`.
 *
 * @param parsed - The parsed JSON.
 * @param address - The file's address, for error messages.
 * @returns The file.
 * @throws IgnifxError with code `IGX-0709` when the file has no `ignifx.mesh` header, `IGX-0603`
 * when its format version is not 1, or `IGX-0507` when it names an unknown primitive, an option the
 * primitive does not take, or a value the option cannot hold.
 *
 * @internal
 */
export function readMeshFile(parsed: unknown, address: string): MeshFile {
  const file = asObject(parsed);
  if (file === null || file["format"] !== MESH_FILE_FORMAT) {
    throw new IgnifxError(CoreErrorCode.invalidAssetFile, `${address} is not an ${MESH_FILE_FORMAT} file.`, {
      context: { file: address, format: MESH_FILE_FORMAT },
      hint: `A mesh file starts with { "format": "${MESH_FILE_FORMAT}", "formatVersion": ${String(MESH_FORMAT_VERSION)} }.`,
    });
  }
  const version = file["formatVersion"];
  if (version !== MESH_FORMAT_VERSION) {
    throw new IgnifxError(
      CoreErrorCode.unsupportedFormatVersion,
      `${address} declares format version ${JSON.stringify(version ?? null)}, which this build cannot read.`,
      {
        context: { file: address, version: JSON.stringify(version ?? null) },
        hint: `This build reads ${MESH_FILE_FORMAT} version ${String(MESH_FORMAT_VERSION)}.`,
      },
    );
  }
  for (const key of Object.keys(file)) {
    if (!Object.hasOwn(MESH_FILE_FIELDS, key)) {
      throw invalidMesh(address, `"${key}" is not a mesh file field`);
    }
  }
  const name = file["name"];
  if (name !== undefined && typeof name !== "string") {
    throw invalidMesh(address, '"name" must be a string');
  }
  const primitive = readPrimitive(file["primitive"], address);
  const options = readOptions(file["options"], primitive, address);
  // The options were checked key by key against this primitive's row of the table, which lists
  // exactly the fields of its options type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const definition = { primitive, options } as MeshPrimitiveDefinition;
  return { name: name ?? null, definition };
}

/**
 * The JSON Schema `@ignifx/vite-plugin` validates `.mesh.json` files against, built from
 * {@link MESH_PRIMITIVE_OPTIONS}.
 *
 * @returns The schema document.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * ignifx({ schemas: { formats: { [MESH_FILE_FORMAT]: meshFileJsonSchema() } } });
 * ```
 *
 * @public
 */
export function meshFileJsonSchema(): JsonSchemaObject {
  const branches: JsonSchemaObject[] = [];
  for (const primitive of MESH_PRIMITIVES) {
    const properties: Record<string, JsonSchemaObject> = {};
    for (const [option, kind] of Object.entries(MESH_PRIMITIVE_OPTIONS[primitive])) {
      properties[option] = { $ref: `#/$defs/${kind}` };
    }
    branches.push({
      properties: {
        primitive: { const: primitive },
        options: { type: "object", additionalProperties: false, properties },
      },
    });
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://ignifx.com/schemas/${MESH_FILE_FORMAT}.v${String(MESH_FORMAT_VERSION)}.json`,
    title: "ignifx mesh file",
    type: "object",
    required: ["format", "formatVersion", "primitive"],
    additionalProperties: false,
    properties: {
      format: { const: MESH_FILE_FORMAT },
      formatVersion: { const: MESH_FORMAT_VERSION },
      name: { type: "string" },
      primitive: { enum: [...MESH_PRIMITIVES] },
      options: { type: "object" },
    },
    oneOf: branches,
    $defs: {
      length: { type: "number", minimum: 0 },
      count: { type: "integer", minimum: 1 },
      pair: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
    },
  };
}

/**
 * Narrows a JSON value to an object.
 *
 * @param value - The value.
 * @returns The object, or `null` when it is not one.
 */
function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // Arrays and `null` are ruled out, so this is a parsed JSON object.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as JsonObject;
}

/**
 * Reads the `primitive` field.
 *
 * @param value - The field's value.
 * @param address - The file's address.
 * @returns The primitive.
 * @throws IgnifxError with code `IGX-0507` when it is not one of {@link MESH_PRIMITIVES}.
 */
function readPrimitive(value: unknown, address: string): MeshPrimitive {
  for (const primitive of MESH_PRIMITIVES) {
    if (value === primitive) {
      return primitive;
    }
  }
  throw invalidMesh(
    address,
    `"primitive" is ${JSON.stringify(value ?? null)}; expected one of ${MESH_PRIMITIVES.join(", ")}`,
  );
}

/**
 * Reads and checks the `options` field against one primitive's row of the table.
 *
 * @param value - The field's value; missing means every option takes its default.
 * @param primitive - The primitive the options are for.
 * @param address - The file's address.
 * @returns A copy of the options.
 * @throws IgnifxError with code `IGX-0507` when an option is unknown or holds the wrong value.
 */
function readOptions(value: unknown, primitive: MeshPrimitive, address: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  const options = asObject(value);
  if (options === null) {
    throw invalidMesh(address, '"options" must be an object');
  }
  const kinds: Readonly<Record<string, MeshOptionKind>> = MESH_PRIMITIVE_OPTIONS[primitive];
  const result: Record<string, unknown> = {};
  for (const [option, optionValue] of Object.entries(options)) {
    const kind = Object.hasOwn(kinds, option) ? kinds[option] : undefined;
    if (kind === undefined) {
      throw invalidMesh(address, `a ${primitive} has no option "${option}"; it takes ${Object.keys(kinds).join(", ")}`);
    }
    if (!isOptionValue(optionValue, kind)) {
      throw invalidMesh(
        address,
        `options.${option} must be ${OPTION_KIND_TEXT[kind]}; got ${JSON.stringify(optionValue)}`,
      );
    }
    result[option] = optionValue;
  }
  return result;
}

/** How an error message describes each option kind. */
const OPTION_KIND_TEXT: Readonly<Record<MeshOptionKind, string>> = {
  length: "a number of metres, zero or more",
  count: "a whole number, one or more",
  pair: "an array of two numbers",
};

/**
 * Checks one option value against its kind.
 *
 * @param value - The value.
 * @param kind - What the option holds.
 * @returns `true` when the value fits.
 */
function isOptionValue(value: unknown, kind: MeshOptionKind): boolean {
  if (kind === "length") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }
  if (kind === "count") {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
  }
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item: unknown) => typeof item === "number" && Number.isFinite(item))
  );
}

/**
 * Builds the `IGX-0507` failure.
 *
 * @param address - The file's address.
 * @param problem - What is wrong, without a trailing period.
 * @returns The error to throw.
 */
function invalidMesh(address: string, problem: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidMeshFile, `${address} is not a valid mesh file: ${problem}.`, {
    context: { file: address, problem },
    hint: "See MESH_PRIMITIVE_OPTIONS for the options each primitive takes.",
  });
}
