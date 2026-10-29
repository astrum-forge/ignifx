# Scene and prefab files (`.scene.json`, `.prefab.json`)

Hand-written companion to the generated field table in
[`ignifx.scene.md`](ignifx.scene.md). One format, `ignifx.scene`, for both levels and prefabs
(ADR-0005): the extension only tells you what it is usually used for. Rationale in
`docs/architecture/06-serialization-and-scene-format.md`.

Loaded with `world.loadScene(address)` (or `world.loadSceneFile(file, { address })` for a file object
already in memory), instanced with `world.instantiate(sceneAsset)`, written with
`serializeScene(...)` + `stringifySceneFile(...)`, checked with `validateSceneFile(value)`, and
validated at build time by `@ignifx/vite-plugin` against the schema `sceneFileJsonSchema(registry)`
generates. `SCENE_FILE_FORMAT` is `"ignifx.scene"` and `SCENE_FORMAT_VERSION` is `1`.

## Shape

```json
{
  "format": "ignifx.scene",
  "formatVersion": 1,
  "engineVersion": "0.2.0",
  "name": "Level01",
  "settings": { "clearColor": [0.05, 0.05, 0.08, 1] },
  "entities": [
    {
      "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6WX",
      "name": "Player",
      "parent": null,
      "active": true,
      "static": false,
      "layer": "Player",
      "tags": ["player"],
      "transform": { "position": [0, 1, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "components": [
        {
          "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6WY",
          "type": "ignifx/MeshRenderer",
          "enabled": true,
          "props": {
            "mesh": { "$asset": "models/hero.glb#mesh:Body" },
            "materials": [{ "$asset": "materials/hero.material.json" }]
          }
        },
        { "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6WZ", "type": "mygame/Mover", "props": { "speed": 5 } }
      ]
    }
  ]
}
```

| Field                     | Rule                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `uid`                     | ULID, unique within the file. Instantiation gives every copy a fresh runtime uid                  |
| `parent`                  | The parent's uid, or `null`. Sibling order is the order of appearance in `entities`               |
| `transform`               | Always present: `[x, y, z]`, `[x, y, z, w]`, `[x, y, z]`                                          |
| `active` `static` `tags`  | Omitted when equal to `true`, `false`, `[]`                                                       |
| `layer`                   | A layer **name**, resolved against project settings; an unknown name falls back with `IGX-0303`   |
| `components[].type`       | The component's `typeId`; an unregistered one is `IGX-0307`                                       |
| `components[].props`      | Values per the component's schema; omitted props take schema defaults                             |
| `settings`                | Scene-level values systems interpret; only the first loaded scene's settings apply                |

A scene or prefab names a primitive through a `.mesh.json` file:
`"mesh": { "$asset": "meshes/crate.mesh.json" }` (`../concepts/assets.md` §5). `MeshAsset.box(app)`
lives at a `memory:` address no file can name, so a mesh built in code is assigned from a script's
`awake` instead (the `PreRender` sync coalesces the topology change), or published at a plain
address before the scene loads — `app.assets.register(box.value, { type: "mesh", address:
"meshes/crate" })` — in which case the file loads only in an app that ran that step first.

A 2D file names a still sprite's frame in `SpriteRenderer`'s `frameName` field
(`"frameName": "barrel"`; `""` is the first frame), next to the atlas in `sprite`. Do not put a
`#frame:` fragment in `sprite`: the renderer reports `IGX-1118` and draws nothing. `frame`, the
index drawn, is runtime-only. `TilemapCollider2D` reads the `Tilemap` on the same entity, so a file
that holds both has tile collision with no code. A tilemap's objects layer never spawns at runtime:
`ignifx import tilemap` moves it into the scene file once, as entities (ADR-0030).

## Value encoding

| Kind                       | JSON                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `f32 f64 i32 u32`          | number, canonicalized to 1e-6; `NaN`/`Infinity` are rejected with `IGX-0601`                |
| `bool` / `str` / `enumOf`  | boolean / string / the string value                                                         |
| `vec2 vec3 vec4 quat`      | array of numbers                                                                            |
| `color`                    | `[r, g, b, a]` in sRGB 0–1                                                                  |
| `entityRef`                | `{ "$entity": "<uid>" }` or `null`                                                          |
| `componentRef`             | `{ "$component": "<uid>" }` or `null`                                                       |
| `asset`                    | `{ "$asset": "<address>", "type"?: "<type>" }` or `null`                                    |
| `array` / `record` / `map` | array / object / object                                                                     |
| `optional`                 | the inner encoding, or `null`                                                               |
| `layerMask`                | array of layer **names**, so renames survive                                                |
| `curve` / `custom`         | `{ "keys": [[t, v, inTangent, outTangent], …] }` / whatever the codec's `serialize` returns |

Canonicalization is idempotent, so save → load → save is byte-identical.

## Instances and overrides

An entity that carries an `instance` block is an instance root, and the overrides are applied in
order. When the referenced scene has exactly one root, the instance root _is_ that root, as with
`world.instantiate`: it gets the root's components and then its own `components`, keeps its own
`uid`, `name` and `transform`, and adopts the root's children. A scene with several roots is
expanded under the instance root instead.

```json
{
  "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6X2",
  "name": "Enemy_01",
  "parent": null,
  "transform": { "position": [4, 0, 2], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
  "instance": {
    "scene": { "$asset": "prefabs/enemy.prefab.json" },
    "hash": "sha256:9f2c…",
    "overrides": [
      { "path": "01J9Z…ROOT/components/01J9Z…AI/props/aggression", "value": 0.9 },
      { "op": "remove", "path": "01J9Z…ROOT/components/01J9Z…DEBUG" }
    ]
  }
}
```

- `op` is `"replace"` (the default), `"remove"`, or `"add"`.
- One override per identity — `path`, `op`, and for an `add` to `<uid>/components` the added
  component's uid. A second with the same identity (a merge conflict leaves them) fails validation
  with `IGX-0608`; keep one.
- `hash` is the instanced asset's content hash at save time (`computeSceneHash`). A mismatch logs
  `IGX-0604`, or throws when `strictInstanceHashes` is passed to `loadScene`/`instantiate`.
- The `path` grammar — every path starts with the uid of an entity **inside the instanced file**, so
  it survives the per-instance uid remap. `parseOverridePath(path)` parses one; a path outside the
  grammar, or one with a `__proto__` property step, is `IGX-0609`.

```text
<uid>                                         whole entity            ("remove" only)
<uid>/name | active | static | layer | tags   an entity property
<uid>/transform/position | rotation | scale   a transform channel
<uid>/components                              the component list      ("add" only)
<uid>/components/<uid>                        one component           ("remove" only)
<uid>/components/<uid>/enabled                a component's enabled flag
<uid>/components/<uid>/props/<field>[/<key>…] one prop, or a step into a record/map/array
```

## Loading order

1. Parse, check the `format`/`formatVersion` header (`IGX-0308`, `IGX-0603`), validate the document.
2. Resolve **every** `$asset` in the file, recursively through instanced scenes, and wait for the
   handles — which is what makes `asset()` fields readable in `awake`.
3. Expand `instance` entries with a per-instance uid remap and apply their overrides in order.
4. Create entities in file order, then components; props are schema defaults overwritten by file
   values, and `$entity`/`$component` references resolve through the remap (`IGX-0602` when they
   cannot, leaving the field `null`).
5. `onAttach`, then `awake`/`onEnable` in tree order — all before `loadScene` resolves.

`addComponentFromRecord(entity, record, { index?, references? })` runs steps 4–5 for one component
record on a live entity: its registered type (`IGX-0307` otherwise), its uid, `enabled`, and its
props decoded through the `references` you pass. Tools that mirror a document into a running world
use it; a game adds components with `addComponent`.

## Saving

`serializeScene(source, options?)` takes a `SceneInstance` or a list of root entities and answers
with a `SceneFile`. Entities that came from an instance are re-emitted as `instance` entries with
overrides recomputed by diffing against the asset, unless `options.flatten` is `true`. Fields marked
`transient: true` in their schema are never written. `serializeEntity` and `serializeComponent` do
the same for one object, for tooling and tests.

> An in-code asset — anything from `MeshAsset.box(app)`, `createMaterialAsset(app, …)`, or
> `Assets.register` — lives at a `memory:` address that names no file, so serializing a component
> holding one writes `null` and reports `IGX-0602`. Save it as a file if it must round-trip.
