import { SchemaIssueCode, throwSchemaError } from "./issues.js";
import { createDefaults } from "./schema.js";
import { FieldKind } from "./types.js";
import type {
  AssetRefValue,
  AssetTypeToken,
  ComponentTypeToken,
  CurveKey,
  CurveValue,
  CustomFieldCodec,
  FieldDefinition,
  FieldOptions,
  FieldSpec,
  FieldsOf,
  Schema,
} from "./types.js";
import type { ColorLike, QuatLike, Vec2Like, Vec3Like, Vec4Like } from "../math/types.js";

/**
 * The default a `vec2()` field takes when none is given.
 *
 * @internal
 */
const ZERO2: Vec2Like = { x: 0, y: 0 };
/**
 * The default a `vec3()` field takes when none is given.
 *
 * @internal
 */
const ZERO3: Vec3Like = { x: 0, y: 0, z: 0 };
/**
 * The default a `vec4()` field takes when none is given.
 *
 * @internal
 */
const ZERO4: Vec4Like = { x: 0, y: 0, z: 0, w: 0 };
/**
 * The identity rotation, the default a `quat()` field takes when none is given.
 *
 * @internal
 */
const IDENTITY_QUAT: QuatLike = { x: 0, y: 0, z: 0, w: 1 };
/**
 * Opaque white, the default a `color()` field takes when none is given.
 *
 * @internal
 */
const WHITE: ColorLike = { r: 1, g: 1, b: 1, a: 1 };
/**
 * The default a `curve()` field takes when none is given.
 *
 * @internal
 */
const EMPTY_CURVE: CurveValue = { keys: [] };
/**
 * Matches `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`.
 *
 * @internal
 */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;

/**
 * Assembles a field definition. Centralising construction keeps `kind` and `spec.kind` in step and
 * keeps every field a plain, frozen-by-convention data object.
 *
 * @param spec - The kind-specific data, which also supplies the discriminant.
 * @param options - Inspector and serializer metadata, if any.
 * @param createDefault - Factory for a fresh default value.
 * @returns The field definition.
 *
 * @internal
 */
function field<T>(spec: FieldSpec, options: FieldOptions | undefined, createDefault: () => T): FieldDefinition<T> {
  return { kind: spec.kind, spec, options: options ?? {}, createDefault };
}

/**
 * Parses a CSS-style hexadecimal color into normalized sRGB channels.
 *
 * @param hex - `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa`.
 * @returns The parsed color with channels in the 0–1 range.
 * @throws A `TypeError` when the string is not one of the accepted forms.
 *
 * @internal
 */
function parseHexColor(hex: string): ColorLike {
  if (!HEX_COLOR_PATTERN.test(hex)) {
    throwSchemaError(
      SchemaIssueCode.typeMismatch,
      `color("${hex}") is not a hexadecimal color; use #rgb, #rgba, #rrggbb, or #rrggbbaa.`,
    );
  }
  const digits = hex.slice(1);
  const short = digits.length <= 4;
  const size = short ? 1 : 2;
  const scale = short ? 15 : 255;
  const channel = (index: number): number => {
    const start = index * size;
    if (start >= digits.length) {
      return 1;
    }
    return Number.parseInt(digits.slice(start, start + size), 16) / scale;
  };
  return { r: channel(0), g: channel(1), b: channel(2), a: channel(3) };
}

/**
 * Declares a single-precision floating point field.
 *
 * @param defaultValue - The value a new component starts with.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" });
 * ```
 *
 * @public
 */
export function f32(defaultValue: number = 0, options?: FieldOptions): FieldDefinition<number> {
  return field({ kind: FieldKind.f32 }, options, () => defaultValue);
}

/**
 * Declares a double-precision floating point field.
 *
 * @param defaultValue - The value a new component starts with.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function f64(defaultValue: number = 0, options?: FieldOptions): FieldDefinition<number> {
  return field({ kind: FieldKind.f64 }, options, () => defaultValue);
}

/**
 * Declares a signed 32-bit integer field. Validation rejects fractional values and values outside
 * the signed 32-bit range with `IGX-0606`.
 *
 * @param defaultValue - The value a new component starts with.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function i32(defaultValue: number = 0, options?: FieldOptions): FieldDefinition<number> {
  return field({ kind: FieldKind.i32 }, options, () => defaultValue);
}

/**
 * Declares an unsigned 32-bit integer field. Validation rejects fractional and negative values, and
 * values above 4294967295, with `IGX-0606`.
 *
 * @param defaultValue - The value a new component starts with.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function u32(defaultValue: number = 0, options?: FieldOptions): FieldDefinition<number> {
  return field({ kind: FieldKind.u32 }, options, () => defaultValue);
}

/**
 * Declares a boolean field.
 *
 * @param defaultValue - The value a new component starts with.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function bool(defaultValue: boolean = false, options?: FieldOptions): FieldDefinition<boolean> {
  return field({ kind: FieldKind.bool }, options, () => defaultValue);
}

/**
 * Declares a string field.
 *
 * @param defaultValue - The value a new component starts with.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function str(defaultValue: string = "", options?: FieldOptions): FieldDefinition<string> {
  return field({ kind: FieldKind.str }, options, () => defaultValue);
}

/**
 * Declares a 2D vector field. The runtime value type is the structural `Vec2Like`, so the engine's
 * `Vec2` class and plain object literals are both accepted.
 *
 * @param defaultValue - The value a new component starts with; defaults to the origin.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function vec2(defaultValue: Vec2Like = ZERO2, options?: FieldOptions): FieldDefinition<Vec2Like> {
  const { x, y } = defaultValue;
  return field({ kind: FieldKind.vec2, components: 2 }, options, (): Vec2Like => ({ x, y }));
}

/**
 * Declares a 3D vector field.
 *
 * @param defaultValue - The value a new component starts with; defaults to the origin.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * offset: vec3({ x: 0, y: 1, z: 0 });
 * ```
 *
 * @public
 */
export function vec3(defaultValue: Vec3Like = ZERO3, options?: FieldOptions): FieldDefinition<Vec3Like> {
  const { x, y, z } = defaultValue;
  return field({ kind: FieldKind.vec3, components: 3 }, options, (): Vec3Like => ({ x, y, z }));
}

/**
 * Declares a 4D vector field.
 *
 * @param defaultValue - The value a new component starts with; defaults to all zeroes.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function vec4(defaultValue: Vec4Like = ZERO4, options?: FieldOptions): FieldDefinition<Vec4Like> {
  const { x, y, z, w } = defaultValue;
  return field({ kind: FieldKind.vec4, components: 4 }, options, (): Vec4Like => ({ x, y, z, w }));
}

/**
 * Declares a rotation field.
 *
 * @param defaultValue - The value a new component starts with; defaults to the identity rotation.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @public
 */
export function quat(defaultValue: QuatLike = IDENTITY_QUAT, options?: FieldOptions): FieldDefinition<QuatLike> {
  const { x, y, z, w } = defaultValue;
  return field({ kind: FieldKind.quat, components: 4 }, options, (): QuatLike => ({ x, y, z, w }));
}

/**
 * Declares an RGBA color field. Channels are sRGB in the 0–1 range, in memory and in files alike:
 * conversion to linear space belongs to the renderer, not the schema
 * (`docs/architecture/06-serialization-and-scene-format.md` §3).
 *
 * @param defaultValue - The starting color, either as channels or as a `#rgb`/`#rgba`/`#rrggbb`/
 * `#rrggbbaa` string; defaults to opaque white.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 * @throws A `TypeError` when a string default is not a valid hexadecimal color.
 *
 * @example
 * ```ts
 * tint: color("#ffffff");
 * ```
 *
 * @public
 */
export function color(defaultValue: ColorLike | string = WHITE, options?: FieldOptions): FieldDefinition<ColorLike> {
  const { r, g, b, a } = typeof defaultValue === "string" ? parseHexColor(defaultValue) : defaultValue;
  return field({ kind: FieldKind.color }, options, (): ColorLike => ({ r, g, b, a }));
}

/**
 * Declares a field restricted to a fixed set of string values.
 *
 * @param values - Every accepted value, in the order the inspector should list them.
 * @param defaultValue - The value a new component starts with; `NoInfer` keeps it out of the
 * inference for `T`, so passing a value `values` does not contain is a compile error as well as a
 * runtime one.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 * @throws A `TypeError` when `defaultValue` is not one of `values`.
 *
 * @example
 * ```ts
 * mode: enumOf(["walk", "run"] as const, "walk");
 * ```
 *
 * @public
 */
export function enumOf<const T extends string>(
  values: readonly T[],
  defaultValue: NoInfer<T>,
  options?: FieldOptions,
): FieldDefinition<T> {
  if (!values.includes(defaultValue)) {
    throwSchemaError(
      SchemaIssueCode.outOfRange,
      `enumOf default "${defaultValue}" is not one of [${values.join(", ")}].`,
    );
  }
  return field({ kind: FieldKind.enum, values: [...values] }, options, () => defaultValue);
}

/**
 * Declares a reference to another entity in the same scene file. The value is `null` until the
 * scene is fully constructed and is nulled again when the target is destroyed
 * (`docs/architecture/03-scripting-and-components.md` §3).
 *
 * The entity type is supplied by the caller because `Entity` lives in the kernel, which is layered
 * above this module.
 *
 * @typeParam E - The entity type the reference resolves to.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * target: entityRef<Entity>();
 * ```
 *
 * @public
 */
export function entityRef<E = unknown>(options?: FieldOptions): FieldDefinition<E | null> {
  return field({ kind: FieldKind.entityRef }, options, (): E | null => null);
}

/**
 * Declares a reference to a component on an entity in the same scene file.
 *
 * @typeParam C - The component type the reference resolves to, inferred from the class.
 * @param type - The component class the field may point at.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * follow: componentRef(Camera); // Camera | null
 * ```
 *
 * @public
 */
export function componentRef<C>(type: ComponentTypeToken<C>, options?: FieldOptions): FieldDefinition<C | null> {
  return field({ kind: FieldKind.componentRef, componentType: type }, options, (): C | null => null);
}

/**
 * Declares a reference to an addressable asset. In Phase 1 the field holds the *address*; the
 * loaded handle arrives with the assets service in Phase 2
 * (`docs/architecture/05-assets-and-loading.md` §3).
 *
 * @typeParam A - The asset type the reference points at, inferred from the class.
 * @param type - The asset class the field may point at.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * clip: asset(AudioClip); // AssetRefValue<AudioClip> | null
 * ```
 *
 * @public
 */
export function asset<A>(type: AssetTypeToken<A>, options?: FieldOptions): FieldDefinition<AssetRefValue<A> | null> {
  const typeName = type.assetType ?? null;
  return field({ kind: FieldKind.asset, assetType: type, typeName }, options, (): AssetRefValue<A> | null => null);
}

/**
 * Declares a list field. The runtime value type is a *mutable* array because game code is expected
 * to push to it (`this.waypoints.push(p)`); the default is copied on every instantiation, shallowly,
 * so element objects supplied as defaults are shared and should be treated as immutable.
 *
 * @typeParam T - The element value type, inferred from `item`.
 * @param item - The field definition every element follows.
 * @param defaultValue - The list a new component starts with; defaults to empty.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * waypoints: array(vec3()); // Vec3Like[]
 * ```
 *
 * @public
 */
export function array<T>(
  item: FieldDefinition<T>,
  defaultValue: readonly T[] = [],
  options?: FieldOptions,
): FieldDefinition<T[]> {
  const snapshot = [...defaultValue];
  return field({ kind: FieldKind.array, item }, options, (): T[] => [...snapshot]);
}

/**
 * Declares a fixed group of named sub-fields. Sub-fields are serialized as a nested JSON object in
 * declaration order and validated recursively.
 *
 * @typeParam S - The sub-schema, inferred from `fields`.
 * @param fields - The sub-fields.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * stats: record({ hp: i32(10), armor: f32(0) }); // { hp: number; armor: number }
 * ```
 *
 * @public
 */
export function record<S extends Schema>(fields: S, options?: FieldOptions): FieldDefinition<FieldsOf<S>> {
  return field({ kind: FieldKind.record, fields }, options, () => createDefaults(fields));
}

/**
 * Declares a string-keyed dictionary field. Keys are written in lexicographic order so that two
 * saves of the same state are byte-identical
 * (`docs/architecture/06-serialization-and-scene-format.md` §1).
 *
 * @typeParam T - The entry value type, inferred from `value`.
 * @param value - The field definition every entry's value follows.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * ammo: map(i32(0)); // Record<string, number>
 * ```
 *
 * @public
 */
export function map<T>(value: FieldDefinition<T>, options?: FieldOptions): FieldDefinition<Record<string, T>> {
  return field({ kind: FieldKind.map, value }, options, (): Record<string, T> => ({}));
}

/**
 * Declares a field that may also be `null`, defaulting to `null` (coding standards §5.5: `null` is
 * "absent value", `undefined` never reaches a file).
 *
 * @typeParam T - The value type when present, inferred from `inner`.
 * @param inner - The field definition a non-`null` value follows.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * nickname: optional(str()); // string | null
 * ```
 *
 * @public
 */
export function optional<T>(inner: FieldDefinition<T>, options?: FieldOptions): FieldDefinition<T | null> {
  return field({ kind: FieldKind.optional, inner }, options, (): T | null => null);
}

/**
 * Declares a set of layers. Layers are stored by *name*, not by bit value, so renaming a layer in
 * project settings does not silently repoint existing files
 * (`docs/architecture/06-serialization-and-scene-format.md` §3).
 *
 * The value type is a read-only array of names in Phase 1; the kernel's `LayerMask` class arrives
 * with the layer registry and will satisfy the same structural shape.
 *
 * @param defaultValue - The names a new component starts with; defaults to empty.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * collidesWith: layerMask(["Default", "Enemy"]);
 * ```
 *
 * @public
 */
export function layerMask(
  defaultValue: readonly string[] = [],
  options?: FieldOptions,
): FieldDefinition<readonly string[]> {
  const snapshot = [...defaultValue];
  return field({ kind: FieldKind.layerMask }, options, (): readonly string[] => [...snapshot]);
}

/**
 * Declares an animation curve field.
 *
 * @param defaultValue - The curve a new component starts with; defaults to no keys.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * falloff: curve({ keys: [[0, 1, 0, 0], [1, 0, 0, 0]] });
 * ```
 *
 * @public
 */
export function curve(defaultValue: CurveValue = EMPTY_CURVE, options?: FieldOptions): FieldDefinition<CurveValue> {
  const keys = defaultValue.keys.map((key): CurveKey => [key[0], key[1], key[2], key[3]]);
  return field({ kind: FieldKind.curve }, options, (): CurveValue => ({ keys: [...keys] }));
}

/**
 * Declares a field whose JSON form is written by hand. Use it for value types the built-in kinds
 * cannot express; the codec owns the default, the encoding, and the generated JSON Schema fragment.
 *
 * @typeParam T - The runtime value type.
 * @param codec - The default factory, `serialize`, `deserialize`, and optional `jsonSchema`.
 * @param options - Inspector and serializer metadata.
 * @returns The field definition.
 *
 * @example
 * ```ts
 * grid: custom({
 *   createDefault: () => new Uint8Array(16),
 *   serialize: (value) => [...value],
 *   deserialize: (json) => Uint8Array.from(Array.isArray(json) ? json.map(Number) : []),
 *   jsonSchema: { type: "array", items: { type: "integer" } },
 * });
 * ```
 *
 * @public
 */
export function custom<T>(codec: CustomFieldCodec<T>, options?: FieldOptions): FieldDefinition<T> {
  return field({ kind: FieldKind.custom, codec }, options, () => codec.createDefault());
}
