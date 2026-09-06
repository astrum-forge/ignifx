import { Physics2DErrorCode, physics2DError } from "./errors.js";
import type { Physics2DMaterialValues } from "./settings.js";
import type { AssetLoader, JsonObject, JsonValue, LoaderContext } from "@ignifx/core";

/**
 * The `ignifx.physicsmaterial` asset, read by the 2D extension.
 *
 * ## Why the format is the 3D one
 *
 * `11-2d-toolkit.md` §8 lists a `PhysicsMaterial2D`, and `09-physics.md` §2.4 already defines
 * `{ "format": "ignifx.physicsmaterial", "friction": …, "staticFriction": …, "restitution": … }`.
 * Inventing a second document for the same two numbers would give artists two files to keep in
 * step, so this package reads **the same format and the same `.physicsmaterial.json` extension**,
 * ignoring `staticFriction` (Rapier 2D has one friction coefficient, `geometry/collider.d.ts`).
 * `@ignifx/physics` and `@ignifx/physics-2d` never run in one world — `IGX-1101` — so the two
 * loaders never collide.
 *
 * The 2D-only knobs, how two surfaces' friction and restitution are **combined**, are fields on the
 * collider rather than on the asset, so the document stays byte-identical to the 3D one.
 */

/**
 * The asset type name `.physicsmaterial.json` addresses resolve to.
 *
 * @public
 */
export const PHYSICS_MATERIAL_2D_ASSET_TYPE = "physicsmaterial";

/**
 * The address suffix that selects the loader.
 *
 * @public
 */
export const PHYSICS_MATERIAL_2D_FILE_EXTENSION = ".physicsmaterial.json";

/**
 * The `format` string every physics-material document declares.
 *
 * @public
 */
export const PHYSICS_MATERIAL_2D_FILE_FORMAT = "ignifx.physicsmaterial";

/**
 * The file format version; `1` before ignifx 1.0.
 *
 * @public
 */
export const PHYSICS_MATERIAL_2D_FORMAT_VERSION = 1;

/**
 * A loaded 2D surface.
 *
 * @example
 * ```ts
 * const ice = await app.assets.load<PhysicsMaterial2D>("materials/ice.physicsmaterial.json");
 * floor.addComponent(BoxCollider2D, { size: { x: 10, y: 1 }, material: ice });
 * ```
 *
 * @public
 */
export class PhysicsMaterial2D implements Physics2DMaterialValues {
  /** The asset type token, so `asset(PhysicsMaterial2D)` fields resolve. */
  static assetType: string = PHYSICS_MATERIAL_2D_ASSET_TYPE;

  /** A human-readable name, used in diagnostics. */
  readonly name: string;

  /** The friction coefficient. */
  readonly friction: number;

  /** How much of the approach speed is returned, `0` to `1`. */
  readonly restitution: number;

  /**
   * Wraps parsed values.
   *
   * @param name - A human-readable name.
   * @param values - Friction and restitution.
   */
  constructor(name: string, values: Physics2DMaterialValues) {
    this.name = name;
    this.friction = values.friction;
    this.restitution = values.restitution;
  }

  /**
   * Builds a material in code, filling in the fields the caller omitted.
   *
   * @param name - A human-readable name.
   * @param values - Any subset of the two coefficients.
   * @returns The material.
   *
   * @example
   * ```ts
   * const bouncy = PhysicsMaterial2D.fromValues("bouncy", { restitution: 0.9 });
   * ```
   */
  static fromValues(name: string, values: Partial<Physics2DMaterialValues>): PhysicsMaterial2D {
    return new PhysicsMaterial2D(name, {
      friction: values.friction ?? 0.6,
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
export function createPhysicsMaterial2DLoader(): AssetLoader<PhysicsMaterial2D> {
  return {
    type: PHYSICS_MATERIAL_2D_ASSET_TYPE,
    extensions: [PHYSICS_MATERIAL_2D_FILE_EXTENSION],
    load: async (ctx: LoaderContext): Promise<PhysicsMaterial2D> => {
      const document = await ctx.fetchJson<JsonValue>();
      return parsePhysicsMaterial2D(ctx.address, document);
    },
  };
}

/**
 * Parses one `ignifx.physicsmaterial` document into a 2D surface.
 *
 * @param address - The address it came from, for the diagnostic.
 * @param document - The parsed JSON.
 * @returns The material.
 * @throws IgnifxError with code `IGX-1154` when the document is not one this build can read.
 *
 * @public
 */
export function parsePhysicsMaterial2D(address: string, document: JsonValue): PhysicsMaterial2D {
  const object = asObject(document);
  if (object === null || object["format"] !== PHYSICS_MATERIAL_2D_FILE_FORMAT) {
    throw physics2DError(
      Physics2DErrorCode.invalidMaterialFile,
      `${address} is not an ${PHYSICS_MATERIAL_2D_FILE_FORMAT}.`,
      {
        context: { file: address },
        hint: `Add "format": "${PHYSICS_MATERIAL_2D_FILE_FORMAT}" to the document.`,
      },
    );
  }
  const version = numberAt(object, "formatVersion", PHYSICS_MATERIAL_2D_FORMAT_VERSION);
  if (version > PHYSICS_MATERIAL_2D_FORMAT_VERSION) {
    throw physics2DError(Physics2DErrorCode.invalidMaterialFile, `${address} is version ${String(version)}.`, {
      context: { file: address, version },
      hint: "Upgrade @ignifx/physics-2d, or re-save the material from this version of the editor.",
    });
  }
  const name = typeof object["name"] === "string" ? object["name"] : address;
  return new PhysicsMaterial2D(name, {
    friction: numberAt(object, "friction", 0.6),
    restitution: numberAt(object, "restitution", 0),
  });
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
  // Boundary assertion (coding standards §5.2): the guard above is exactly `JsonObject`.
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
