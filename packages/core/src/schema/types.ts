import type { JsonObject, JsonValue } from "./json.js";

/**
 * Every field kind a component schema can declare
 * (`docs/architecture/03-scripting-and-components.md` §3). Declared as an `as const` table with a
 * derived union rather than an `enum`, which `erasableSyntaxOnly` bans (coding standards §5.2).
 *
 * @public
 */
export const FieldKind = {
  /** A 32-bit-ranged floating point number. */
  f32: "f32",
  /** A double-precision floating point number. */
  f64: "f64",
  /** A signed 32-bit integer. */
  i32: "i32",
  /** An unsigned 32-bit integer. */
  u32: "u32",
  /** A boolean toggle. */
  bool: "bool",
  /** A UTF-8 string. */
  str: "str",
  /** A 2D vector. */
  vec2: "vec2",
  /** A 3D vector. */
  vec3: "vec3",
  /** A 4D vector. */
  vec4: "vec4",
  /** A rotation quaternion. */
  quat: "quat",
  /** An RGBA color. */
  color: "color",
  /** One of a fixed set of string values. */
  enum: "enum",
  /** A reference to another entity in the same scene file. */
  entityRef: "entityRef",
  /** A reference to a component on an entity in the same scene file. */
  componentRef: "componentRef",
  /** A reference to an addressable asset. */
  asset: "asset",
  /** A list of values of one kind. */
  array: "array",
  /** A fixed group of named sub-fields. */
  record: "record",
  /** A string-keyed dictionary of values of one kind. */
  map: "map",
  /** A value that may also be `null`. */
  optional: "optional",
  /** A set of layer names. */
  layerMask: "layerMask",
  /** An animation curve. */
  curve: "curve",
  /** A value with a hand-written encoder and decoder. */
  custom: "custom",
} as const;

/**
 * The union of every field kind.
 *
 * @public
 */
export type FieldKind = (typeof FieldKind)[keyof typeof FieldKind];

/**
 * Inspector and serializer metadata carried by every field
 * (`docs/architecture/03-scripting-and-components.md` §3,
 * `docs/architecture/06-serialization-and-scene-format.md` §5). Options never change a field's
 * value type; they constrain and present it.
 *
 * @public
 */
export interface FieldOptions {
  /** Help text shown next to the field in the inspector. */
  readonly tooltip?: string;
  /** Lowest accepted value for numeric kinds; validation reports `IGX-0606` below it. */
  readonly min?: number;
  /** Highest accepted value for numeric kinds; validation reports `IGX-0606` above it. */
  readonly max?: number;
  /** Increment used by the inspector's drag and spinner controls. */
  readonly step?: number;
  /** Hides the field from the inspector while still serializing it. */
  readonly hidden?: boolean;
  /** Shows the field in the inspector but forbids editing it there. */
  readonly readonly?: boolean;
  /** Name of the inspector group the field is folded into. */
  readonly group?: string;
  /** Excludes the field from saved games and scene files; it always takes its default on load. */
  readonly transient?: boolean;
}

/**
 * How a component class is named in a schema. A class satisfies it structurally through its
 * `prototype`, so `componentRef(Camera)` infers `Camera` without the class having to implement
 * anything. The optional `typeId` is the namespaced registration id from
 * `docs/architecture/03-scripting-and-components.md` §4 when the class carries one.
 *
 * @typeParam C - The component instance type the token stands for.
 *
 * @public
 */
export interface ComponentTypeToken<C> {
  /** The component's namespaced registration id, when it declares one. */
  readonly typeId?: string;
  /** The instance shape the token names. */
  readonly prototype: C;
}

/**
 * How an asset class is named in a schema. Like {@link ComponentTypeToken}, a class satisfies it
 * structurally; `assetType` supplies the `type` discriminator written into `{ "$asset": … }` when
 * the loader cannot infer it from the address extension
 * (`docs/architecture/05-assets-and-loading.md` §2).
 *
 * @typeParam A - The asset value type the token stands for.
 *
 * @public
 */
export interface AssetTypeToken<A> {
  /** The asset type name written into files when the extension is ambiguous. */
  readonly assetType?: string;
  /**
   * The instance shape the token names. A class token carries it for free; a plain token for an
   * asset that has no class (a scene, a prefab) leaves it out and fixes `A` through its annotation —
   * see `SceneAssetToken`. Nothing reads it at runtime.
   */
  readonly prototype?: A;
}

/**
 * The plain, serializable form of an asset reference: what `{ "$asset": … }` decodes to before the
 * asset service turns it into a handle, and what a tool that reads a scene file without an app
 * works with (`docs/architecture/05-assets-and-loading.md` §2).
 *
 * @remarks
 * It is **not** the runtime value of an `asset()` field. Since Phase 2 that value is
 * `AssetHandle<A> | null`: a component receives the handle already loaded
 * (`docs/architecture/05-assets-and-loading.md` §3), so `this.mesh?.value` reaches the asset with no
 * second lookup. The two shapes overlap on `address`/`type`, which is why the encoder accepts
 * either.
 *
 * @typeParam A - The asset value type this reference points at. It is a compile-time marker only:
 * `assetOf` is never assigned at runtime and is never serialized. It exists so that
 * `AssetRefValue<Texture>` and `AssetRefValue<Mesh>` are different types.
 *
 * @public
 */
export interface AssetRefValue<A> {
  /** The address the asset is registered under, for example `models/hero.glb#mesh:Body`. */
  readonly address: string;
  /** The asset type name, when the address alone does not identify it. */
  readonly type?: string;
  /** Compile-time marker for the asset type; never present at runtime. */
  readonly assetOf?: A;
}

/**
 * One key of an animation curve: time, value, incoming tangent, outgoing tangent
 * (`docs/architecture/06-serialization-and-scene-format.md` §3).
 *
 * @public
 */
export type CurveKey = readonly [time: number, value: number, inTangent: number, outTangent: number];

/**
 * The value a `curve()` field holds.
 *
 * @public
 */
export interface CurveValue {
  /** The curve's keys, ordered by time. */
  readonly keys: readonly CurveKey[];
}

/**
 * The hand-written encoder and decoder behind a `custom()` field. The codec owns both the default
 * value and the JSON representation, so `custom` is the escape hatch for value types the built-in
 * kinds cannot express.
 *
 * @typeParam T - The runtime value type.
 *
 * @public
 */
export interface CustomFieldCodec<T> {
  /**
   * Builds a fresh default value. It is a factory, not a constant, so two components never share
   * one mutable default object.
   *
   * @returns A newly allocated default value.
   */
  createDefault(): T;
  /**
   * Converts a runtime value into JSON.
   *
   * @param value - The value to serialize.
   * @returns The JSON representation written into the file.
   */
  serialize(value: T): JsonValue;
  /**
   * Rebuilds a runtime value from JSON.
   *
   * @param json - The JSON previously produced by `serialize`.
   * @returns The runtime value.
   */
  deserialize(json: JsonValue): T;
  /** A JSON Schema fragment describing the encoded form, merged into the generated document. */
  readonly jsonSchema?: JsonObject;
}

/**
 * Kind-specific data for the numeric kinds.
 *
 * @public
 */
export interface NumberFieldSpec {
  /** The numeric kind. */
  readonly kind: "f32" | "f64" | "i32" | "u32";
}

/**
 * Kind-specific data for `bool`.
 *
 * @public
 */
export interface BoolFieldSpec {
  /** The boolean kind. */
  readonly kind: "bool";
}

/**
 * Kind-specific data for `str`.
 *
 * @public
 */
export interface StringFieldSpec {
  /** The string kind. */
  readonly kind: "str";
}

/**
 * Kind-specific data for the vector kinds. `components` says how many numbers the encoded array
 * holds, so encoders do not have to re-derive it from the kind.
 *
 * @public
 */
export interface VectorFieldSpec {
  /** The vector kind. */
  readonly kind: "vec2" | "vec3" | "vec4" | "quat";
  /** How many components the value has: 2, 3, or 4. */
  readonly components: 2 | 3 | 4;
}

/**
 * Kind-specific data for `color`.
 *
 * @public
 */
export interface ColorFieldSpec {
  /** The color kind. */
  readonly kind: "color";
}

/**
 * Kind-specific data for `enumOf`.
 *
 * @public
 */
export interface EnumFieldSpec {
  /** The enumeration kind. */
  readonly kind: "enum";
  /** Every accepted string value, in declaration order. */
  readonly values: readonly string[];
}

/**
 * Kind-specific data for `entityRef`.
 *
 * @public
 */
export interface EntityRefFieldSpec {
  /** The entity-reference kind. */
  readonly kind: "entityRef";
}

/**
 * Kind-specific data for `componentRef`.
 *
 * @public
 */
export interface ComponentRefFieldSpec {
  /** The component-reference kind. */
  readonly kind: "componentRef";
  /** The component class the field may point at. */
  readonly componentType: ComponentTypeToken<unknown>;
}

/**
 * Kind-specific data for `asset`.
 *
 * @public
 */
export interface AssetFieldSpec {
  /** The asset-reference kind. */
  readonly kind: "asset";
  /** The asset class the field may point at. */
  readonly assetType: AssetTypeToken<unknown>;
  /** The `type` discriminator written into files, or `null` when the address is unambiguous. */
  readonly typeName: string | null;
}

/**
 * Kind-specific data for `array`.
 *
 * @public
 */
export interface ArrayFieldSpec {
  /** The array kind. */
  readonly kind: "array";
  /** The field definition every element follows. */
  readonly item: FieldDefinition<unknown>;
}

/**
 * Kind-specific data for `record`.
 *
 * @public
 */
export interface RecordFieldSpec {
  /** The record kind. */
  readonly kind: "record";
  /** The sub-fields, in declaration order. */
  readonly fields: Schema;
}

/**
 * Kind-specific data for `map`.
 *
 * @public
 */
export interface MapFieldSpec {
  /** The map kind. */
  readonly kind: "map";
  /** The field definition every entry's value follows. */
  readonly value: FieldDefinition<unknown>;
}

/**
 * Kind-specific data for `optional`.
 *
 * @public
 */
export interface OptionalFieldSpec {
  /** The optional kind. */
  readonly kind: "optional";
  /** The field definition a non-`null` value follows. */
  readonly inner: FieldDefinition<unknown>;
}

/**
 * Kind-specific data for `layerMask`.
 *
 * @public
 */
export interface LayerMaskFieldSpec {
  /** The layer-mask kind. */
  readonly kind: "layerMask";
}

/**
 * Kind-specific data for `curve`.
 *
 * @public
 */
export interface CurveFieldSpec {
  /** The curve kind. */
  readonly kind: "curve";
}

/**
 * Kind-specific data for `custom`.
 *
 * @public
 */
export interface CustomFieldSpec {
  /** The custom kind. */
  readonly kind: "custom";
  /** The hand-written codec that owns the value's default and JSON form. */
  readonly codec: CustomFieldCodec<unknown>;
}

/**
 * The discriminated union of kind-specific field data. Switching on `spec.kind` narrows to the
 * member that carries the extra information that kind needs — the enumeration's values, an array's
 * item definition, a component reference's class token — so no branch has to guess.
 *
 * @public
 */
export type FieldSpec =
  | NumberFieldSpec
  | BoolFieldSpec
  | StringFieldSpec
  | VectorFieldSpec
  | ColorFieldSpec
  | EnumFieldSpec
  | EntityRefFieldSpec
  | ComponentRefFieldSpec
  | AssetFieldSpec
  | ArrayFieldSpec
  | RecordFieldSpec
  | MapFieldSpec
  | OptionalFieldSpec
  | LayerMaskFieldSpec
  | CurveFieldSpec
  | CustomFieldSpec;

/**
 * One declared field of a component schema. Field definitions are plain, immutable data built by
 * the constructors in this module; nothing about them is reflective and nothing runs at import
 * time (ADR-0004, `CONSTITUTION.md` §3.5).
 *
 * The type parameter is the field's *runtime* value type, which is what
 * `Script.define({ … })` uses to type the generated properties.
 *
 * @typeParam T - The runtime value type of the field.
 *
 * @example
 * ```ts
 * const speed = f32(5, { min: 0, max: 50, tooltip: "Units per second" });
 * speed.kind; // "f32"
 * speed.createDefault(); // 5
 * ```
 *
 * @public
 */
export interface FieldDefinition<T> {
  /** The field kind, mirroring `spec.kind` for quick reads by tooling and the docs harness. */
  readonly kind: FieldKind;
  /** The kind-specific data, discriminated by `spec.kind`. */
  readonly spec: FieldSpec;
  /** Inspector and serializer metadata. */
  readonly options: FieldOptions;
  /**
   * Builds a fresh default value. Object-valued kinds allocate on every call, so two components
   * never share one mutable default.
   *
   * @returns A newly allocated default value.
   */
  createDefault(): T;
}

/**
 * A component's declared fields, keyed by property name and ordered by declaration. Declaration
 * order is the canonical key order used when writing files
 * (`docs/architecture/06-serialization-and-scene-format.md` §1).
 *
 * @public
 */
export type Schema = Readonly<Record<string, FieldDefinition<unknown>>>;

/**
 * The object type a schema describes: every field name mapped to its runtime value type. This is
 * what gives `this.speed` its `number` type inside a component declared with
 * `Script.define({ speed: f32(5) })`.
 *
 * @typeParam S - The schema to project.
 *
 * @example
 * ```ts
 * const schema = { speed: f32(5), label: str("") };
 * type Fields = FieldsOf<typeof schema>; // { speed: number; label: string }
 * ```
 *
 * @public
 */
export type FieldsOf<S extends Schema> = {
  -readonly [K in keyof S]: S[K] extends FieldDefinition<infer T> ? T : never;
};

/**
 * The field object of a schema with every property optional, and an explicit `undefined` allowed.
 * `exactOptionalPropertyTypes` normally separates "absent" from "present and `undefined`"; both
 * mean "take the schema default" here, so both are accepted (`applyInit`, `encodeProps`).
 *
 * @typeParam S - The schema to project.
 *
 * @public
 */
export type PartialFieldsOf<S extends Schema> = {
  [K in keyof FieldsOf<S>]?: FieldsOf<S>[K] | undefined;
};
