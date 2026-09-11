import { PhysicsErrorCode, physicsError } from "./errors.js";
import type { PhysicsMaterialValues } from "./settings.js";
import type { AssetLoader, JsonObject, JsonValue, LoaderContext, SchemaDescription } from "@ignifx/core";

/**
 * The `ignifx.physicsmaterial` asset (`docs/architecture/09-physics.md` §2.4,
 * `05-assets-and-loading.md` §5): a surface's friction and bounciness, saved next to the scene that
 * uses it so an artist can retune a floor without touching code.
 */

/**
 * The asset type name `.physicsmaterial.json` addresses resolve to.
 *
 * @public
 */
export const PHYSICS_MATERIAL_ASSET_TYPE = "physicsmaterial";

/**
 * The address suffix that selects the loader.
 *
 * @public
 */
export const PHYSICS_MATERIAL_FILE_EXTENSION = ".physicsmaterial.json";

/**
 * The `format` string every physics-material document declares.
 *
 * @public
 */
export const PHYSICS_MATERIAL_FILE_FORMAT = "ignifx.physicsmaterial";

/**
 * The file format version; `1` before ignifx 1.0.
 *
 * @public
 */
export const PHYSICS_MATERIAL_FORMAT_VERSION = 1;

/**
 * A loaded surface material. The values are the ones Havok's `setPhysicsShapeMaterial` takes
 * (`index.d.ts` 10853).
 *
 * @example
 * ```ts
 * const ice = await app.assets.load<PhysicsMaterial>("materials/ice.physicsmaterial.json");
 * floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 }, material: ice });
 * ```
 *
 * @public
 */
export class PhysicsMaterial implements PhysicsMaterialValues {
  /** The asset type token, so `asset(PhysicsMaterial)` fields resolve. */
  static assetType: string = PHYSICS_MATERIAL_ASSET_TYPE;

  /** A human-readable name, used in diagnostics. */
  readonly name: string;

  /** The dynamic friction coefficient. */
  readonly friction: number;

  /** The static friction coefficient. */
  readonly staticFriction: number;

  /** How much of the approach speed is returned, `0` to `1`. */
  readonly restitution: number;

  /**
   * Wraps parsed values. The loader constructs these; game code uses
   * {@link PhysicsMaterial.fromValues} when it wants one in code.
   *
   * @param name - A human-readable name.
   * @param values - Friction, static friction, and restitution.
   */
  constructor(name: string, values: PhysicsMaterialValues) {
    this.name = name;
    this.friction = values.friction;
    this.staticFriction = values.staticFriction;
    this.restitution = values.restitution;
  }

  /**
   * Builds a material in code, filling in the fields the caller omitted.
   *
   * @param name - A human-readable name.
   * @param values - Any subset of the three coefficients.
   * @returns The material.
   *
   * @example
   * ```ts
   * const bouncy = PhysicsMaterial.fromValues("bouncy", { restitution: 0.9 });
   * ```
   */
  static fromValues(name: string, values: Partial<PhysicsMaterialValues>): PhysicsMaterial {
    const friction = values.friction ?? 0.6;
    return new PhysicsMaterial(name, {
      friction,
      staticFriction: values.staticFriction ?? friction,
      restitution: values.restitution ?? 0,
    });
  }
}

/**
 * Builds the loader for `.physicsmaterial.json` files.
 *
 * @returns The loader, ready for `ctx.registerAssetLoader`.
 *
 * @public
 */
export function createPhysicsMaterialLoader(): AssetLoader<PhysicsMaterial> {
  return {
    type: PHYSICS_MATERIAL_ASSET_TYPE,
    extensions: [PHYSICS_MATERIAL_FILE_EXTENSION],
    load: async (ctx: LoaderContext): Promise<PhysicsMaterial> => {
      const document = await ctx.fetchJson<JsonValue>();
      return parsePhysicsMaterial(ctx.address, document);
    },
  };
}

/**
 * Parses one `ignifx.physicsmaterial` document.
 *
 * @param address - The address it came from, for the diagnostic.
 * @param document - The parsed JSON.
 * @returns The material.
 * @throws IgnifxError with code `IGX-0904` when the document is not one this build can read.
 *
 * @public
 */
export function parsePhysicsMaterial(address: string, document: JsonValue): PhysicsMaterial {
  const object = asObject(document);
  if (object === null || object["format"] !== PHYSICS_MATERIAL_FILE_FORMAT) {
    throw physicsError(PhysicsErrorCode.invalidMaterialFile, `${address} is not an ${PHYSICS_MATERIAL_FILE_FORMAT}.`, {
      context: { file: address },
      hint: `Add "format": "${PHYSICS_MATERIAL_FILE_FORMAT}" to the document.`,
    });
  }
  const version = numberAt(object, "formatVersion", PHYSICS_MATERIAL_FORMAT_VERSION);
  if (version > PHYSICS_MATERIAL_FORMAT_VERSION) {
    throw physicsError(PhysicsErrorCode.invalidMaterialFile, `${address} is version ${String(version)}.`, {
      context: { file: address, version },
      hint: "Upgrade @ignifx/physics, or re-save the material from this version of the editor.",
    });
  }
  const friction = numberAt(object, "friction", 0.6);
  const name = typeof object["name"] === "string" ? object["name"] : address;
  return new PhysicsMaterial(name, {
    friction,
    staticFriction: numberAt(object, "staticFriction", friction),
    restitution: numberAt(object, "restitution", 0),
  });
}

/**
 * Describes the `ignifx.physicsmaterial` file format for the documentation harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * @returns The description of the top-level file fields.
 *
 * @public
 */
export function describePhysicsMaterialFileFormat(): SchemaDescription {
  return {
    title: "Physics material file",
    format: PHYSICS_MATERIAL_FILE_FORMAT,
    description: "A surface's friction and bounciness, referenced by a collider's material field.",
    fields: {
      format: {
        kind: "str",
        default: PHYSICS_MATERIAL_FILE_FORMAT,
        description: `Always "${PHYSICS_MATERIAL_FILE_FORMAT}".`,
      },
      formatVersion: {
        kind: "u32",
        default: PHYSICS_MATERIAL_FORMAT_VERSION,
        description: "The file format version; 1 before ignifx 1.0.",
      },
      name: { kind: "str", default: "", description: "A human-readable name; defaults to the address." },
      friction: { kind: "f32", default: 0.6, description: "The dynamic friction coefficient." },
      staticFriction: {
        kind: "f32",
        default: 0.6,
        description: "The static friction coefficient; defaults to friction.",
      },
      restitution: { kind: "f32", default: 0, description: "How much approach speed is returned, 0 to 1." },
    },
  };
}

/**
 * Views a JSON value as an object.
 *
 * @param value - The parsed JSON.
 * @returns The object, or `null` when the value is not one.
 */
function asObject(value: JsonValue): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // The guard above is exactly `JsonObject` — an object
  // that is neither `null` nor an array — which is what `JsonValue` leaves in the union.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as JsonObject;
}

/**
 * Reads a numeric property, tolerating its absence.
 *
 * @param object - The document.
 * @param key - The property name.
 * @param fallback - What to use when the property is missing or not a number.
 * @returns The value.
 */
function numberAt(object: JsonObject, key: string, fallback: number): number {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
