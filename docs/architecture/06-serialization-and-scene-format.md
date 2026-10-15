# 06 · Serialization and Scene Format

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/core` · **Related:** `02-scene-graph.md`, `03-scripting-and-components.md` §3, `05-assets-and-loading.md`, ADR-0004, ADR-0005

---

## 1. Principles

- **Schema-driven.** Only fields declared in a component's schema are serialized (`CONSTITUTION.md` §3.7). There is no reflection over class fields and no decorators.
- **JSON, versioned, diff-friendly.** Files are UTF-8 JSON with a `format` and `formatVersion`; entities are a flat list ordered in tree order; object keys are emitted in a canonical order; numbers are written with a bounded precision. Two saves of the same state produce byte-identical files.
- **References are explicit.** Entity, component, and asset references are tagged objects, never bare strings that might be paths or names.
- **One format for levels and prefabs.** A prefab is a scene instanced inside another scene (ADR-0005).

## 2. Scene file (`*.scene.json`, `*.prefab.json`)

```json
{
  "format": "ignifx.scene",
  "formatVersion": 1,
  "engineVersion": "0.4.0",
  "name": "Level01",
  "settings": {
    "environment": { "$asset": "env/studio.env" },
    "clearColor": [0.05, 0.05, 0.08, 1]
  },
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
        {
          "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6WZ",
          "type": "mygame/Mover",
          "props": {
            "speed": 5,
            "target": { "$entity": "01J9Z6M7E5S3A0V2Q4R8T1Y6X0" },
            "follow": { "$component": "01J9Z6M7E5S3A0V2Q4R8T1Y6X1" }
          }
        }
      ]
    },
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
          { "op": "remove", "path": "01J9Z…ROOT/components/01J9Z…DEBUG" },
          {
            "op": "add",
            "path": "01J9Z…ROOT/components",
            "value": { "uid": "01J9Z…NEW", "type": "mygame/Loot", "props": { "table": { "$asset": "data/loot.json" } } }
          }
        ]
      }
    }
  ]
}
```

Field rules:

- `uid`: ULID string; unique within the file. Instanced scenes keep their _own_ uids; overrides address them by path.
- `parent`: uid of the parent entity or `null`. Sibling order is the order of appearance in `entities`.
- `active`, `static`, `layer`, `tags`, `enabled`: omitted when equal to defaults (`true`, `false`, `"Default"`, `[]`, `true`). `layer` is a layer **name** resolved against project settings at load; an unknown name resolves to `Default` with `IGX-0303`.
- `transform`: always present; arrays `[x, y, z]`, `[x, y, z, w]`, `[x, y, z]`.
- `components[i].props`: values according to the component's schema (§3). Omitted props take schema defaults.
- `instance`: present only on instance roots. When the instanced scene has exactly one root, the instance root _is_ that root, as with `world.instantiate`: the root's components come first, then the entry's own `components`, and the entry's `uid`, `name`, `transform` and other entity fields replace the root's. Otherwise the instance root is a container: the instanced scene's roots become its children, and its own `components` and `transform` are its own. `instance.hash` records the content hash of the instanced scene asset at save time; a mismatch at load logs `IGX-0604` by default or fails when the loader option `strictInstanceHashes` is set, so save games notice prefab changes instead of silently reinterpreting overrides.
- `settings`: scene-level values interpreted by systems (environment, clear color, 2D mode flags, physics overrides). Only the _first_ loaded scene's settings apply in additive loads unless a setting is marked `mergeable`. Today only `@ignifx/2d` reads a key (`twoD`); core carries the block to `SceneInstance.settings` and nothing in 3D consumes it, so a 3D level's clear color, environment and gravity are still project settings or components.

## 3. Value encoding

| Schema kind           | JSON                                                      |
| --------------------- | --------------------------------------------------------- |
| `f32 f64 i32 u32`     | number                                                    |
| `bool`                | boolean                                                   |
| `str`                 | string                                                    |
| `vec2 vec3 vec4 quat` | array of numbers                                          |
| `color`               | `[r, g, b, a]` in sRGB 0–1                                |
| `enumOf`              | the string value                                          |
| `entityRef`           | `{ "$entity": "<uid>" }` or `null`                        |
| `componentRef`        | `{ "$component": "<uid>" }` or `null`                     |
| `asset`               | `{ "$asset": "<address>", "type"?: "<type>" }` or `null`  |
| `array`               | array                                                     |
| `record` / `map`      | object                                                    |
| `layerMask`           | array of layer names (not bit values, so renames survive) |
| `curve`               | `{ "keys": [[t, v, inTangent, outTangent], …] }`          |
| `custom`              | whatever the field's `serialize` returns; must be JSON    |

An `asset` value whose address is a `memory:` one — every primitive from `MeshAsset.box` and friends, every `createMaterialAsset` — names no file and is written as `null` with `IGX-0602`. A file names a primitive through a `.mesh.json` file instead (`{ "$asset": "meshes/crate.mesh.json" }`, ADR-0029), which round-trips. Publishing a primitive at a plain address with `Assets.register(value, { type, address })` before loading also works, but then the file loads only in an app that ran that code. A runtime `MaterialAsset.clone(app)` has no file either, so a level whose renderers each need a material of their own (the first-person template's pedestals) names the shared file and clones after the load. A runtime property that is not a schema field — `SpriteRenderer.frame`, `TilemapCollider2D.collisionData` — is not written at all.

Numbers are canonicalized before writing: `x = Math.round(x * 1e6) / 1e6`, `-0` becomes `0`, and the value is emitted with JavaScript's shortest round-trip representation (`String(x)`), integers without a fraction. Loading stores the canonical value and the rule is idempotent, so save → load → save is byte-identical. `NaN`/`Infinity` are rejected (`IGX-0601`).

## 4. Loading algorithm

1. Parse and validate the file against the generated JSON Schema (development builds) and check `formatVersion` (§7).
2. Resolve every `$asset` in the file (including inside instanced scenes, recursively) through the asset system; wait for all handles. This guarantees `asset()` fields are loaded before `awake`.
3. Expand `instance` entries: load the referenced scene asset, clone its entity list under the instance root with a per-instance uid remap (file-local uid → runtime uid), apply overrides in order. A single-root scene's root merges into the instance root (§2), so overrides addressing it patch the instance root.
4. Create entities in file order (parents first, since tree order is guaranteed by the serializer; loaders tolerate any order by deferring parenting).
5. Create components, assign props from schema defaults then file values; `entityRef`/`componentRef` are resolved through the remap table; unresolved references are set to `null` with a diagnostic (`IGX-0602`).
6. Run `onAttach` hooks, then `awake`/`onEnable` in tree order (`01-lifecycle-and-time.md` §4).

## 5. Saving

- `serializeScene(instance | entities, options)` returns a scene file object. Runtime entities created in code are included if they belong to the instance. Entities that came from an `instance` are re-emitted as `instance` entries with computed overrides (diffing current props against the instanced asset's values), unless `options.flatten` is set. An instance root that is its scene's single root writes its own entity fields, and the components it gained, on the entry; the components the scene gave it are written only as overrides, so loading the file rebuilds the same one entity.
- `serializeEntity(entity)` / `serializeComponent(component)` exist for tooling and tests.
- Save games use the same machinery: a game serializes the scene instances it considers "state" and stores the JSON through `app.storage` (`14-platform-electron.md` §2). Fields that must not be saved are marked `transient: true` in the schema.

## 6. Other file formats

All share the `format`/`formatVersion` header and JSON Schema validation:

| Format                   | Extension                                                 | Owner               |
| ------------------------ | --------------------------------------------------------- | ------------------- |
| `ignifx.material`        | `.material.json`                                          | core                |
| `ignifx.environment`     | `.environment.json`                                       | core                |
| `ignifx.mesh`            | `.mesh.json`                                              | core                |
| `ignifx.spriteatlas`     | `.atlas.json`                                             | `@ignifx/2d`        |
| `ignifx.spriteanimation` | `.spriteanim.json`                                        | `@ignifx/2d`        |
| `ignifx.tilemap`         | `.tilemap.json` (import from Tiled `.tmj` / LDtk `.ldtk`) | `@ignifx/2d`        |
| `ignifx.inputactions`    | `.input.json`                                             | `@ignifx/input`     |
| `ignifx.animator`        | `.animator.json`                                          | `@ignifx/3d`        |
| `ignifx.audiobuses`      | `.audio.json`                                             | `@ignifx/audio`     |
| `ignifx.particles`       | `.particles.json`                                         | `@ignifx/particles` |
| `ignifx.terrain`         | `.terrain.json` (heightmap as `.r16`, or PNG)             | `@ignifx/terrain`   |
| `ignifx.manifest`        | `assets.manifest.json`                                    | vite plugin         |

## 7. Versioning and migration

- `formatVersion` is an integer per format. Before 1.0 it stays `1` and incompatible changes simply invalidate files (`CONSTITUTION.md` §4.2); the loader reports `IGX-0603` for an unknown `formatVersion` and `IGX-0608` with the offending path for a file that fails structural validation.
- After 1.0, a format bump ships with a migration function registered by the owning extension (`registerFileMigration(format, from, to, fn)`) and a document in `docs/migrations/`. Loaders migrate in memory; tooling (`ignifx migrate`) rewrites files.
- Components version their schema independently with `static schemaVersion = 1` and `static migrate(fromVersion, props)`. The file records the schema version per component only when it differs from `1`, keeping files terse.
- Layer and sorting-layer names in files are validated against `ignifx.config.ts` by the Vite plugin at build time and by the loader at runtime; `ignifx rename-layer` and `ignifx rename-sorting-layer` rewrite files when settings change.

## 8. Generated JSON Schemas

`pnpm docs:schemas` (the docs harness, from `describeSchemas()` exports) and later the `ignifx schemas` CLI command emit `ignifx.schemas.json` from every registered component schema and file format; the Vite plugin consumes those schemas (`ignifx({ schemas })`) — it cannot produce them, since it does not depend on the engine. These schemas drive build-time validation, editor autocompletion, and are linked from the Agent Skill so that agents can author scene files without guessing field names.
