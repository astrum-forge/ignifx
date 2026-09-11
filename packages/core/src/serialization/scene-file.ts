import { toJsonSchema } from "../schema/describe.js";
import type { ComponentRegistry } from "../component/component-registry.js";
import type { SchemaDescription } from "../schema/describe.js";
import type { JsonObject, JsonValue } from "../schema/json.js";

/**
 * The `format` discriminator every scene and prefab file carries
 * (`docs/architecture/06-serialization-and-scene-format.md` §2). Levels (`*.scene.json`) and
 * prefabs (`*.prefab.json`) share it: a prefab is a scene instanced inside another scene
 * (ADR-0005), not a second file type.
 *
 * @public
 */
export const SCENE_FILE_FORMAT = "ignifx.scene";

/**
 * The `formatVersion` this build writes and is the only one it can read. Before 1.0 the number
 * stays `1` and an incompatible change invalidates files rather than migrating them
 * (`CONSTITUTION.md` §4.2); a file declaring anything else is rejected with `IGX-0603`.
 *
 * @public
 */
export const SCENE_FORMAT_VERSION = 1;

/**
 * The file extensions the scene loader claims.
 *
 * @public
 */
export const SCENE_FILE_EXTENSIONS: readonly string[] = Object.freeze([".scene.json", ".prefab.json"]);

/**
 * The asset type name the scene loader registers under.
 *
 * @public
 */
export const SCENE_ASSET_TYPE = "scene";

/**
 * A serialized asset reference: `{ "$asset": "<address>", "type"?: "<type>" }`
 * (`docs/architecture/06-serialization-and-scene-format.md` §3).
 *
 * @public
 */
export interface SceneFileAssetRef {
  /** The address the asset is registered under. */
  readonly $asset: string;
  /** The asset type name, written only when the address extension does not identify it. */
  readonly type?: string;
}

/**
 * An entity's local transform, always present in the file and always three plain number arrays
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @remarks
 * The values are **local** — relative to `parent` — because the file already stores the tree and
 * local values are the ones that survive a parent being moved. The document says only "arrays
 * `[x, y, z]`, `[x, y, z, w]`, `[x, y, z]`"; this is the reading that round trips.
 *
 * @public
 */
export interface SceneFileTransform {
  /** Local position, `[x, y, z]`, in metres. */
  readonly position: readonly [number, number, number];
  /** Local rotation quaternion, `[x, y, z, w]`. */
  readonly rotation: readonly [number, number, number, number];
  /** Local scale, `[x, y, z]`. */
  readonly scale: readonly [number, number, number];
}

/**
 * One component of one entity.
 *
 * @public
 */
export interface SceneFileComponent {
  /** ULID, unique within the file. */
  readonly uid: string;
  /** The component class's registered `typeId`. */
  readonly type: string;
  /** Omitted when `true`, the default. */
  readonly enabled?: boolean;
  /** Written only when the class's `schemaVersion` differs from `1` (§7). */
  readonly schemaVersion?: number;
  /** Values in the component schema's declaration order (§3). */
  readonly props?: JsonObject;
}

/**
 * One override patch applied to an instanced scene, addressed by the *instanced* file's uids
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @remarks
 * `op` defaults to `"replace"`, which is why the common case is the two-key
 * `{ path, value }` object shown in the format document.
 *
 * @public
 */
export interface SceneFileOverride {
  /** `"replace"` (the default) patches a value, `"remove"` deletes a component, `"add"` appends one. */
  readonly op?: "replace" | "remove" | "add";
  /** The path into the instanced file; see {@link parseOverridePath}. */
  readonly path: string;
  /** The new value, for `"replace"` and `"add"`. */
  readonly value?: JsonValue;
}

/**
 * The `instance` entry that turns an entity into the root of an instanced scene — what other
 * engines call a prefab instance (ADR-0005).
 *
 * @public
 */
export interface SceneFileInstance {
  /** The scene asset to instance. */
  readonly scene: SceneFileAssetRef;
  /** The content hash of that asset at save time; a mismatch reports `IGX-0604`. */
  readonly hash?: string;
  /** The patches applied to the instanced entities, in order. */
  readonly overrides?: readonly SceneFileOverride[];
}

/**
 * One entity of a scene file. Entities appear in tree order — parents before children, siblings in
 * `children` order — and `parent` names the uid of the parent, or `null` for a root.
 *
 * @public
 */
export interface SceneFileEntity {
  /** ULID, unique within the file. */
  readonly uid: string;
  /** The display name. */
  readonly name: string;
  /** The parent's uid, or `null` for a root. */
  readonly parent: string | null;
  /** Omitted when `true`, the default. */
  readonly active?: boolean;
  /** Omitted when `false`, the default. */
  readonly static?: boolean;
  /** The layer **name**, omitted when `"Default"`. Names, never indices, so reordering is safe. */
  readonly layer?: string;
  /** The tags, omitted when empty. */
  readonly tags?: readonly string[];
  /** Always present. */
  readonly transform: SceneFileTransform;
  /** Present only on instance roots. */
  readonly instance?: SceneFileInstance;
  /** The entity's own components; on an instance root, the ones added on top of the instance. */
  readonly components?: readonly SceneFileComponent[];
}

/**
 * A whole scene or prefab file (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @example
 * ```ts
 * const file = serializeScene(world.activeScene);
 * await app.storage.write("save.scene.json", stringifySceneFile(file));
 * ```
 *
 * @public
 */
export interface SceneFile {
  /** Always {@link SCENE_FILE_FORMAT}. */
  readonly format: string;
  /** Always {@link SCENE_FORMAT_VERSION} for files this build writes. */
  readonly formatVersion: number;
  /** The `@ignifx/core` version that wrote the file; informational. */
  readonly engineVersion?: string;
  /** The scene's name. */
  readonly name: string;
  /** Scene-level values interpreted by systems (environment, clear colour, physics overrides). */
  readonly settings?: JsonObject;
  /** Every entity, in tree order. */
  readonly entities: readonly SceneFileEntity[];
}

/**
 * Writes a scene file as the canonical UTF-8 JSON text: two-space indentation, keys in the order
 * the serializer built them, numbers already canonicalized by
 * {@link canonicalizeNumber}. Two saves of the same state produce byte-identical text
 * (`docs/architecture/06-serialization-and-scene-format.md` §1).
 *
 * @param file - The file object, normally from `serializeScene`.
 * @returns The JSON text, without a trailing newline.
 *
 * @example
 * ```ts
 * stringifySceneFile(serializeScene(instance)) === stringifySceneFile(serializeScene(instance));
 * ```
 *
 * @public
 */
export function stringifySceneFile(file: SceneFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Reports whether a parsed JSON value carries the `ignifx.scene` header. It is the cheap check the
 * loader runs before anything else, so a `.json` asset handed to the wrong loader fails with
 * `IGX-0308` rather than a confusing field error.
 *
 * @param value - The parsed JSON.
 * @returns `true` when the value is an object whose `format` is {@link SCENE_FILE_FORMAT}.
 *
 * @public
 */
export function isSceneFileHeader(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // The three lines above have established that the
  // value is a non-null, non-array object, which is exactly a string-keyed bag.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const object = value as Record<string, unknown>;
  return object["format"] === SCENE_FILE_FORMAT;
}

/**
 * The draft 2020-12 JSON Schema for a scene file, with `components[].props` narrowed per registered
 * component `typeId` (`docs/architecture/06-serialization-and-scene-format.md` §8). The Vite plugin
 * and the `ignifx schemas` CLI command emit this into `ignifx.schemas.json`, which drives
 * build-time validation and editor autocompletion.
 *
 * @param registry - The component table whose registered classes narrow `props`. Classes without a
 * schema contribute a `type` match with a free-form `props` object.
 * @returns The schema document.
 *
 * @example
 * ```ts
 * const schema = sceneFileJsonSchema(app.world.registry);
 * await writeFile("ignifx.schemas.json", JSON.stringify(schema, null, 2));
 * ```
 *
 * @public
 */
export function sceneFileJsonSchema(registry: ComponentRegistry): JsonObject {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ignifx.com/schemas/ignifx.scene.v1.json",
    title: "ignifx scene file",
    type: "object",
    required: ["format", "formatVersion", "name", "entities"],
    additionalProperties: false,
    properties: {
      format: { const: SCENE_FILE_FORMAT },
      formatVersion: { const: SCENE_FORMAT_VERSION },
      engineVersion: { type: "string" },
      name: { type: "string" },
      settings: { type: "object" },
      entities: { type: "array", items: { $ref: "#/$defs/entity" } },
    },
    $defs: {
      uid: { type: "string", minLength: 1 },
      assetRef: {
        type: "object",
        required: ["$asset"],
        additionalProperties: false,
        properties: { $asset: { type: "string" }, type: { type: "string" } },
      },
      transform: {
        type: "object",
        required: ["position", "rotation", "scale"],
        additionalProperties: false,
        properties: {
          position: numberTuple(3),
          rotation: numberTuple(4),
          scale: numberTuple(3),
        },
      },
      override: {
        type: "object",
        required: ["path"],
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: ["replace", "remove", "add"] },
          path: { type: "string", minLength: 1 },
          value: true,
        },
      },
      instance: {
        type: "object",
        required: ["scene"],
        additionalProperties: false,
        properties: {
          scene: { $ref: "#/$defs/assetRef" },
          hash: { type: "string" },
          overrides: { type: "array", items: { $ref: "#/$defs/override" } },
        },
      },
      component: {
        type: "object",
        required: ["uid", "type"],
        additionalProperties: false,
        properties: {
          uid: { $ref: "#/$defs/uid" },
          type: { type: "string", minLength: 1 },
          enabled: { type: "boolean" },
          schemaVersion: { type: "integer", minimum: 1 },
          props: { type: "object" },
        },
        allOf: componentPropsBranches(registry),
      },
      entity: {
        type: "object",
        required: ["uid", "name", "parent", "transform"],
        additionalProperties: false,
        properties: {
          uid: { $ref: "#/$defs/uid" },
          name: { type: "string" },
          parent: { anyOf: [{ $ref: "#/$defs/uid" }, { type: "null" }] },
          active: { type: "boolean" },
          static: { type: "boolean" },
          layer: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          transform: { $ref: "#/$defs/transform" },
          instance: { $ref: "#/$defs/instance" },
          components: { type: "array", items: { $ref: "#/$defs/component" } },
        },
      },
    },
  };
}

/**
 * The docs-harness description of the scene file format
 * (`scripts/README.md`, "Schema discovery convention"), so `pnpm docs:schemas` can render
 * `references/formats/scene.md` beside the component pages.
 *
 * @returns The description of the top-level file fields.
 *
 * @public
 */
export function describeSceneFileFormat(): SchemaDescription {
  return {
    title: "Scene file",
    format: SCENE_FILE_FORMAT,
    description:
      "A level or a prefab: a tree of entities with components, instanced scenes, and overrides. One format for both (ADR-0005).",
    fields: {
      format: { kind: "str", default: SCENE_FILE_FORMAT, description: 'Always "ignifx.scene".' },
      formatVersion: {
        kind: "u32",
        default: SCENE_FORMAT_VERSION,
        description: "The file format version; 1 before ignifx 1.0.",
      },
      engineVersion: { kind: "str", default: "", description: "The @ignifx/core version that wrote the file." },
      name: { kind: "str", default: "", description: "The scene's name." },
      settings: { kind: "map", default: {}, description: "Scene-level values interpreted by systems." },
      entities: { kind: "array", default: [], description: "Every entity, in tree order." },
    },
  };
}

/**
 * A fixed-length JSON Schema array of numbers.
 *
 * @param length - How many entries.
 * @returns The fragment.
 */
function numberTuple(length: number): JsonObject {
  return { type: "array", items: { type: "number" }, minItems: length, maxItems: length };
}

/**
 * One `if`/`then` branch per registered component `typeId`, narrowing `props` to that class's
 * generated schema.
 *
 * @param registry - The component table.
 * @returns The branches, in `typeId` order so the document is stable.
 */
function componentPropsBranches(registry: ComponentRegistry): readonly JsonValue[] {
  const branches: JsonValue[] = [];
  const entries: { readonly typeId: string; readonly props: JsonObject }[] = [];
  const registrations = registry.registrations();
  for (let index = 0; index < registrations.length; index += 1) {
    const registration = registrations[index];
    if (registration === undefined) {
      continue;
    }
    const [typeId, type] = registration;
    const schema = registry.describe(type).schema;
    if (schema === null) {
      continue;
    }
    entries.push({ typeId, props: toJsonSchema(schema) });
  }
  entries.sort((left, right) => (left.typeId < right.typeId ? -1 : left.typeId > right.typeId ? 1 : 0));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    branches.push({
      if: { properties: { type: { const: entry.typeId } }, required: ["type"] },
      // `then` is JSON Schema's conditional keyword here, not a promise method; the object never
      // reaches an `await`, it is serialized into the schema document.
      // oxlint-disable-next-line unicorn/no-thenable
      then: { properties: { props: entry.props } },
    });
  }
  return branches;
}
