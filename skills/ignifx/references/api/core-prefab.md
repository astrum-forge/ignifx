# @ignifx/core

`@ignifx/core/prefab`: the scene-file and prefab helpers that need no renderer, so a tool such as
the editor's main process can apply or revert prefab overrides without loading Babylon Lite or
the rest of the engine. Every export here is also exported from `@ignifx/core`.

## Interfaces

### PrefabApplyOptions

What [applyOverridesToAsset](#applyoverridestoasset) acts on: the selected overrides and, optionally, the components
the instance root carries itself.

#### Extends

- [`PrefabOverrideSelection`](#prefaboverrideselection)

#### Properties

##### paths?

> `readonly` `optional` **paths?**: readonly `string`[]

Override paths to act on. A path selects every override at that path or below it, so
`"<entityUid>"` selects everything on that entity and `"<entityUid>/components/<componentUid>"`
selects a component's removal, its `enabled` flag, and its props. An `add` to
`<entityUid>/components` sits at `<entityUid>/components/<addedUid>`. Omitted, every override
is selected.

###### Inherited from

[`PrefabOverrideSelection`](#prefaboverrideselection).[`paths`](#paths-1)

##### rootComponents?

> `readonly` `optional` **rootComponents?**: readonly [`SceneFileComponent`](#scenefilecomponent)[]

The components the instance root carries itself: the `components` of the scene-file entity that
holds the `instance` entry. They are not overrides (the serializer writes a component added on
a single-root instance's root there), so they can only be applied when passed here. Each one
that `paths` selects, at `<prefabRootUid>/components/<componentUid>`, is appended to the
prefab's root after its own components, which is the order the instance already has them in.
Omitted, none is applied.

***

### PrefabApplyResult

What [applyOverridesToAsset](#applyoverridestoasset) returns.

#### Properties

##### applied

> `readonly` **applied**: readonly [`SceneFileOverride`](#scenefileoverride)[]

The overrides written into the prefab, in instance order.

##### appliedComponents

> `readonly` **appliedComponents**: readonly [`SceneFileComponent`](#scenefilecomponent)[]

The [PrefabApplyOptions.rootComponents](#rootcomponents) written into the prefab's root. Remove them from
the instance root: the prefab brings them now.

##### asset

> `readonly` **asset**: [`SceneFile`](#scenefile)

The new prefab file, with the applied overrides written into it.

##### hash

> `readonly` **hash**: `string`

The content hash of [PrefabApplyResult.asset](#asset), as [computeSceneHash](#computescenehash) writes it.

##### instance

> `readonly` **instance**: [`SceneFileInstance`](#scenefileinstance)

The instance entry without the applied overrides, recording [PrefabApplyResult.hash](#hash). It
expands to the same values it did before the apply; a component an applied `add` brought now
comes from the prefab, so like every prefab component it gets a fresh uid per instance.

##### rootComponents

> `readonly` **rootComponents**: readonly [`SceneFileComponent`](#scenefilecomponent)[]

The [PrefabApplyOptions.rootComponents](#rootcomponents) that stay on the instance root, in their order:
the unselected ones and the skipped ones.

##### skipped

> `readonly` **skipped**: readonly [`PrefabOverrideSkip`](#prefaboverrideskip)[]

The selected overrides that stay on the instance, in instance order.

##### skippedComponents

> `readonly` **skippedComponents**: readonly [`PrefabComponentSkip`](#prefabcomponentskip)[]

The selected [PrefabApplyOptions.rootComponents](#rootcomponents) that stay on the instance root, and why.

***

### PrefabComponentSkip

A component of the instance root that [applyOverridesToAsset](#applyoverridestoasset) left on the instance, and why.

#### Properties

##### component

> `readonly` **component**: [`SceneFileComponent`](#scenefilecomponent)

The component, as the instance root holds it.

##### reason

> `readonly` **reason**: `string`

Why it could not be written into the prefab file.

***

### PrefabOverrideSelection

Which overrides of an instance [applyOverridesToAsset](#applyoverridestoasset) and [revertOverrides](#revertoverrides) act on.

#### Extended by

- [`PrefabApplyOptions`](#prefabapplyoptions)

#### Properties

##### paths?

> `readonly` `optional` **paths?**: readonly `string`[]

Override paths to act on. A path selects every override at that path or below it, so
`"<entityUid>"` selects everything on that entity and `"<entityUid>/components/<componentUid>"`
selects a component's removal, its `enabled` flag, and its props. An `add` to
`<entityUid>/components` sits at `<entityUid>/components/<addedUid>`. Omitted, every override
is selected.

***

### PrefabOverrideSkip

An override [applyOverridesToAsset](#applyoverridestoasset) left on the instance, and why.

#### Properties

##### override

> `readonly` **override**: [`SceneFileOverride`](#scenefileoverride)

The override, as the instance entry holds it.

##### reason

> `readonly` **reason**: `string`

Why it could not be written into the prefab file.

***

### SceneFile

A whole scene or prefab file (`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Example

```ts
const file = serializeScene(world.activeScene);
await app.storage.write("save.scene.json", stringifySceneFile(file));
```

#### Properties

##### engineVersion?

> `readonly` `optional` **engineVersion?**: `string`

The `@ignifx/core` version that wrote the file; informational.

##### entities

> `readonly` **entities**: readonly [`SceneFileEntity`](#scenefileentity)[]

Every entity, in tree order.

##### format

> `readonly` **format**: `string`

Always [SCENE\_FILE\_FORMAT](#scene_file_format).

##### formatVersion

> `readonly` **formatVersion**: `number`

Always [SCENE\_FORMAT\_VERSION](#scene_format_version) for files this build writes.

##### name

> `readonly` **name**: `string`

The scene's name.

##### settings?

> `readonly` `optional` **settings?**: [`JsonObject`](#jsonobject)

Scene-level values interpreted by systems (environment, clear colour, physics overrides).

***

### SceneFileAssetRef

A serialized asset reference: `{ "$asset": "<address>", "type"?: "<type>" }`
(`docs/architecture/06-serialization-and-scene-format.md` §3).

#### Properties

##### $asset

> `readonly` **$asset**: `string`

The address the asset is registered under.

##### type?

> `readonly` `optional` **type?**: `string`

The asset type name, written only when the address extension does not identify it.

***

### SceneFileComponent

One component of one entity.

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Omitted when `true`, the default.

##### props?

> `readonly` `optional` **props?**: [`JsonObject`](#jsonobject)

Values in the component schema's declaration order (§3).

##### schemaVersion?

> `readonly` `optional` **schemaVersion?**: `number`

Written only when the class's `schemaVersion` differs from `1` (§7).

##### type

> `readonly` **type**: `string`

The component class's registered `typeId`.

##### uid

> `readonly` **uid**: `string`

ULID, unique within the file.

***

### SceneFileEntity

One entity of a scene file. Entities appear in tree order — parents before children, siblings in
`children` order — and `parent` names the uid of the parent, or `null` for a root.

#### Properties

##### active?

> `readonly` `optional` **active?**: `boolean`

Omitted when `true`, the default.

##### components?

> `readonly` `optional` **components?**: readonly [`SceneFileComponent`](#scenefilecomponent)[]

The entity's own components; on an instance root, the ones added on top of the instance.

##### instance?

> `readonly` `optional` **instance?**: [`SceneFileInstance`](#scenefileinstance)

Present only on instance roots.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer **name**, omitted when `"Default"`. Names, never indices, so reordering is safe.

##### name

> `readonly` **name**: `string`

The display name.

##### parent

> `readonly` **parent**: `string` \| `null`

The parent's uid, or `null` for a root.

##### static?

> `readonly` `optional` **static?**: `boolean`

Omitted when `false`, the default.

##### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

The tags, omitted when empty.

##### transform

> `readonly` **transform**: [`SceneFileTransform`](#scenefiletransform)

Always present.

##### uid

> `readonly` **uid**: `string`

ULID, unique within the file.

***

### SceneFileInstance

The `instance` entry that turns an entity into the root of an instanced scene — what other
engines call a prefab instance (ADR-0005).

#### Remarks

When the instanced scene has exactly one root, the entity carrying the entry _is_ that root, as
with `world.instantiate`: it gets the root's components, then its own, and keeps its own uid,
name, and transform. A scene with several roots is expanded under the entity instead
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Properties

##### hash?

> `readonly` `optional` **hash?**: `string`

The content hash of that asset at save time; a mismatch reports `IGX-0604`.

##### overrides?

> `readonly` `optional` **overrides?**: readonly [`SceneFileOverride`](#scenefileoverride)[]

The patches applied to the instanced entities, in order.

##### scene

> `readonly` **scene**: [`SceneFileAssetRef`](#scenefileassetref)

The scene asset to instance.

***

### SceneFileOverride

One override patch applied to an instanced scene, addressed by the *instanced* file's uids
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Remarks

`op` defaults to `"replace"`, which is why the common case is the two-key
`{ path, value }` object shown in the format document.

#### Properties

##### op?

> `readonly` `optional` **op?**: `"replace"` \| `"remove"` \| `"add"`

`"replace"` (the default) patches a value, `"remove"` deletes a component, `"add"` appends one.

##### path

> `readonly` **path**: `string`

The path into the instanced file; see [parseOverridePath](#parseoverridepath).

##### value?

> `readonly` `optional` **value?**: [`JsonValue`](#jsonvalue)

The new value, for `"replace"` and `"add"`.

***

### SceneFileTransform

An entity's local transform, always present in the file and always three plain number arrays
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Remarks

The values are **local** — relative to `parent` — because the file already stores the tree and
local values are the ones that survive a parent being moved. The document says only "arrays
`[x, y, z]`, `[x, y, z, w]`, `[x, y, z]`"; this is the reading that round trips.

#### Properties

##### position

> `readonly` **position**: readonly \[`number`, `number`, `number`\]

Local position, `[x, y, z]`, in metres.

##### rotation

> `readonly` **rotation**: readonly \[`number`, `number`, `number`, `number`\]

Local rotation quaternion, `[x, y, z, w]`.

##### scale

> `readonly` **scale**: readonly \[`number`, `number`, `number`\]

Local scale, `[x, y, z]`.

## Type Aliases

### EntityOverrideField

> **EntityOverrideField** = `"name"` \| `"active"` \| `"static"` \| `"layer"` \| `"tags"`

The entity properties an override may patch directly.

***

### JsonArray

> **JsonArray** = readonly [`JsonValue`](#jsonvalue)[]

A JSON array. Read-only because encoded values are snapshots: callers copy before mutating.

***

### JsonObject

> **JsonObject** = `object`

A JSON object. Keys are emitted in the canonical order defined by
`docs/architecture/06-serialization-and-scene-format.md` §1, so two saves of the same state
produce byte-identical files.

#### Index Signature

\[`key`: `string`\]: [`JsonValue`](#jsonvalue)

***

### JsonValue

> **JsonValue** = `string` \| `number` \| `boolean` \| `null` \| [`JsonArray`](#jsonarray) \| [`JsonObject`](#jsonobject)

The JSON value model the serializer works in. Scene and prefab files are UTF-8 JSON
(`docs/architecture/06-serialization-and-scene-format.md` §1), so every encoded schema value is
one of these shapes. The type is recursive rather than `unknown` so that encoders cannot smuggle
a `Date`, a `Map`, or an `undefined` into a file (coding standards §5.2 bans `any`).

***

### OverridePath

> **OverridePath** = \{ `entity`: `string`; `kind`: `"entity"`; \} \| \{ `entity`: `string`; `field`: [`EntityOverrideField`](#entityoverridefield); `kind`: `"entityField"`; \} \| \{ `channel`: keyof [`SceneFileTransform`](#scenefiletransform); `entity`: `string`; `kind`: `"transform"`; \} \| \{ `entity`: `string`; `kind`: `"componentList"`; \} \| \{ `component`: `string`; `entity`: `string`; `kind`: `"component"`; \} \| \{ `component`: `string`; `entity`: `string`; `kind`: `"componentField"`; \} \| \{ `component`: `string`; `entity`: `string`; `kind`: `"prop"`; `steps`: readonly `string`[]; \}

The parsed form of an instance override `path`
(`docs/architecture/06-serialization-and-scene-format.md` §2). Every path starts with the uid of
an entity **of the instanced file**, so a path survives the per-instance uid remap
(`02-scene-graph.md` §10).

The grammar, in the order the parser tries it:

```text
<uid>                                              → entity      (whole entity, "remove" only)
<uid>/name | active | static | layer | tags        → entityField
<uid>/transform/position | rotation | scale        → transform
<uid>/components                                   → componentList ("add" only)
<uid>/components/<uid>                             → component   ("remove" only)
<uid>/components/<uid>/enabled                     → componentField
<uid>/components/<uid>/props/<field>[/<key>…]      → prop
```

## Variables

### SCENE\_FILE\_EXTENSIONS

> `const` **SCENE\_FILE\_EXTENSIONS**: readonly `string`[]

The file extensions the scene loader claims.

***

### SCENE\_FILE\_FORMAT

> `const` **SCENE\_FILE\_FORMAT**: `"ignifx.scene"` = `"ignifx.scene"`

The `format` discriminator every scene and prefab file carries
(`docs/architecture/06-serialization-and-scene-format.md` §2). Levels (`*.scene.json`) and
prefabs (`*.prefab.json`) share it: a prefab is a scene instanced inside another scene
(ADR-0005), not a second file type.

***

### SCENE\_FORMAT\_VERSION

> `const` **SCENE\_FORMAT\_VERSION**: `1` = `1`

The `formatVersion` this build writes and is the only one it can read. Before 1.0 the number
stays `1` and an incompatible change invalidates files rather than migrating them
(`CONSTITUTION.md` §4.2); a file declaring anything else is rejected with `IGX-0603`.

## Functions

### applyOverridesToAsset()

> **applyOverridesToAsset**(`instance`, `asset`, `selection?`): `Promise`\<[`PrefabApplyResult`](#prefabapplyresult)\>

Writes an instance's overrides into the prefab file it instances, so every instance of the prefab
gets them — Unity's "Apply to prefab" (ADR-0005).

#### Parameters

##### instance

[`SceneFileInstance`](#scenefileinstance)

The instance entry whose overrides to apply; its `scene` should name `asset`.

##### asset

[`SceneFile`](#scenefile)

The prefab file the entry instances.

##### selection?

[`PrefabApplyOptions`](#prefabapplyoptions)

Which overrides to apply, all of them by default, and the instance root's own
components to apply with them.

#### Returns

`Promise`\<[`PrefabApplyResult`](#prefabapplyresult)\>

The new prefab file and its hash, the instance entry without the applied overrides, and
what was applied or skipped.

#### Remarks

A pure function over the two files: nothing is loaded, and the same input always gives
byte-identical output through [stringifySceneFile](#stringifyscenefile). The rules:

- Property, `enabled`, transform, and entity-field overrides change the prefab's record. An `add`
  appends the component, keeping its uid; a `remove` deletes the component.
- On a prefab with exactly one root, the instance root's own `name`, `transform`, and other entity
  fields are its placement, not prefab content, so overrides of the root's entity fields and
  transform are skipped.
- Overrides reach only the prefab's own entities. Content of a scene the prefab itself instances
  is not addressable by an override path, so a nested prefab is never edited: an override that
  names something the prefab file does not hold is skipped.
- An override is skipped when an earlier override that stays on the instance overlaps its path, so
  the instance keeps the value it had.
- A skipped override stays on the returned instance.
- The instance root's own components are not overrides. Pass them as
  [PrefabApplyOptions.rootComponents](#rootcomponents) to apply them too: on a prefab with exactly one root
  each selected one is appended to that root, keeping its uid, and reported in
  [PrefabApplyResult.appliedComponents](#appliedcomponents); one whose uid the prefab already uses, or any when
  the prefab has several roots, is skipped.
- Other instances of the prefab keep their overrides, which still win over the new prefab values
  at the same path. Record [PrefabApplyResult.hash](#hash) on them, or loading them logs `IGX-0604`.
- References inside added components (`$entity`, `$component`) are copied unchanged.
- A component an apply moved into the prefab gets a fresh uid per instance from then on, like every
  prefab component; a scene reference to it uses the instance form
  `{ "$component": "<instanceRootUid>/<componentUid>" }`.

#### Throws

IgnifxError with code `IGX-0609` when a selected override path is outside the grammar.

#### Example

```ts
const result = await applyOverridesToAsset(spawn.instance, prefabFile, { rootComponents: spawn.components });
await app.storage.write("prefabs/enemy.prefab.json", stringifySceneFile(result.asset));
```

***

### canonicalizeNumber()

> **canonicalizeNumber**(`value`): `number`

Rounds a number to the file format's precision: six decimal places, with `-0` normalized to `0`
(`docs/architecture/06-serialization-and-scene-format.md` §3). The rule is idempotent, so
save → load → save is byte-identical.

#### Parameters

##### value

`number`

The number to canonicalize.

#### Returns

`number`

The canonical form of the number.

#### Example

```ts
canonicalizeNumber(0.1 + 0.2); // 0.3
canonicalizeNumber(-0); // 0
```

***

### computeSceneHash()

> **computeSceneHash**(`file`): `Promise`\<`string`\>

The content hash of a scene file: SHA-256 over the canonical JSON text, so two saves of the same
state hash the same and an edited prefab does not
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Parameters

##### file

[`SceneFile`](#scenefile)

The file to hash.

#### Returns

`Promise`\<`string`\>

The hash as `sha256:<64 lowercase hex digits>`.

#### Throws

IgnifxError with code `IGX-1420` when the host exposes no Web Crypto `subtle`.

#### Example

```ts
const hash = await computeSceneHash(serializeScene(instance)); // "sha256:9f2c…"
```

***

### isSceneFileHeader()

> **isSceneFileHeader**(`value`): `boolean`

Reports whether a parsed JSON value carries the `ignifx.scene` header. It is the cheap check the
loader runs before anything else, so a `.json` asset handed to the wrong loader fails with
`IGX-0308` rather than a confusing field error.

#### Parameters

##### value

`unknown`

The parsed JSON.

#### Returns

`boolean`

`true` when the value is an object whose `format` is [SCENE\_FILE\_FORMAT](#scene_file_format).

***

### parseOverridePath()

> **parseOverridePath**(`path`): [`OverridePath`](#overridepath)

Parses an override path.

#### Parameters

##### path

`string`

The `path` string from the file.

#### Returns

[`OverridePath`](#overridepath)

The parsed path.

#### Throws

IgnifxError with code `IGX-0609` when the path does not match the grammar, or when a
property step is `__proto__`.

#### Example

```ts
parseOverridePath("01J…ROOT/components/01J…AI/props/aggression");
// { kind: "prop", entity: "01J…ROOT", component: "01J…AI", steps: ["aggression"] }
```

***

### revertOverrides()

> **revertOverrides**(`instance`, `selection?`): [`SceneFileInstance`](#scenefileinstance)

Drops an instance's overrides so it follows its prefab again — Unity's "Revert".

#### Parameters

##### instance

[`SceneFileInstance`](#scenefileinstance)

The instance entry.

##### selection?

[`PrefabOverrideSelection`](#prefaboverrideselection)

Which overrides to drop; all of them by default.

#### Returns

[`SceneFileInstance`](#scenefileinstance)

The entry without the selected overrides, or `instance` itself when none was selected.

#### Remarks

A pure function: the entry's `scene` and `hash` are kept, and `overrides` is omitted when none
remain. Reverting an `add` also reverts the overrides below the added component when the
selection path covers them (`<entityUid>/components/<addedUid>` does).

#### Example

```ts
const reverted = revertOverrides(spawn.instance, { paths: [`${rootUid}/components/${aiUid}`] });
```

***

### stringifySceneFile()

> **stringifySceneFile**(`file`): `string`

Writes a scene file as the canonical UTF-8 JSON text: two-space indentation, keys in the order
the serializer built them, numbers already canonicalized by
[canonicalizeNumber](#canonicalizenumber). Two saves of the same state produce byte-identical text
(`docs/architecture/06-serialization-and-scene-format.md` §1).

#### Parameters

##### file

[`SceneFile`](#scenefile)

The file object, normally from `serializeScene`.

#### Returns

`string`

The JSON text, without a trailing newline.

#### Example

```ts
stringifySceneFile(serializeScene(instance)) === stringifySceneFile(serializeScene(instance));
```
