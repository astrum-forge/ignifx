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
        { "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6WY", "type": "ignifx/MeshRenderer", "enabled": true,
          "props": { "mesh": { "$asset": "models/hero.glb#mesh:Body" }, "materials": [{ "$asset": "materials/hero.material.json" }] } },
        { "uid": "01J9Z6M7E5S3A0V2Q4R8T1Y6WZ", "type": "mygame/Mover",
          "props": { "speed": 5, "target": { "$entity": "01J9Z6M7E5S3A0V2Q4R8T1Y6X0" }, "follow": { "$component": "01J9Z6M7E5S3A0V2Q4R8T1Y6X1" } } }
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
          { "op": "add", "path": "01J9Z…ROOT/components", "value": { "uid": "01J9Z…NEW", "type": "mygame/Loot", "props": { "table": { "$asset": "data/loot.json" } } } }
        ]
      }
    }
  ]
}
```

Field rules:

- `uid`: ULID string; unique within the file. Instanced scenes keep their *own* uids; overrides address them by path.
- `parent`: uid of the parent entity or `null`. Sibling order is the order of appearance in `entities`.
- `active`, `static`, `layer`, `tags`, `enabled`: omitted when equal to defaults (`true`, `false`, `"Default"`, `[]`, `true`). `layer` is a layer **name** resolved against project settings at load; an unknown name resolves to `Default` with `IGX-0303`.
- `transform`: always present; arrays `[x, y, z]`, `[x, y, z, w]`, `[x, y, z]`.
- `components[i].props`: values according to the component's schema (§3). Omitted props take schema defaults.
- `instance`: present only on instance roots. An instance root may also carry its own `components` (added to the instanced root entity) and `transform` (applied to the instance root). `instance.hash` records the content hash of the instanced scene asset at save time; a mismatch at load logs `IGX-0604` by default or fails when the loader option `strictInstanceHashes` is set, so save games notice prefab changes instead of silently reinterpreting overrides.
- `settings`: scene-level values interpreted by systems (environment, clear color, 2D mode flags, physics overrides). Only the *first* loaded scene's settings apply in additive loads unless a setting is marked `mergeable`.

## 3. Value encoding

| Schema kind | JSON |
|---|---|
| `f32 f64 i32 u32` | number |
| `bool` | boolean |
| `str` | string |
| `vec2 vec3 vec4 quat` | array of numbers |
| `color` | `[r, g, b, a]` in sRGB 0–1 |
| `enumOf` | the string value |
| `entityRef` | `{ "$entity": "<uid>" }` or `null` |
| `componentRef` | `{ "$component": "<uid>" }` or `null` |
| `asset` | `{ "$asset": "<address>", "type"?: "<type>" }` or `null` |
| `array` | array |
| `record` / `map` | object |
| `layerMask` | array of layer names (not bit values, so renames survive) |
| `curve` | `{ "keys": [[t, v, inTangent, outTangent], …] }` |
| `custom` | whatever the field's `serialize` returns; must be JSON |

Numbers are canonicalized before writing: `x = Math.round(x * 1e6) / 1e6`, `-0` becomes `0`, and the value is emitted with JavaScript's shortest round-trip representation (`String(x)`), integers without a fraction. Loading stores the canonical value and the rule is idempotent, so save → load → save is byte-identical. `NaN`/`Infinity` are rejected (`IGX-0601`).

## 4. Loading algorithm

1. Parse and validate the file against the generated JSON Schema (development builds) and check `formatVersion` (§7).
2. Resolve every `$asset` in the file (including inside instanced scenes, recursively) through the asset system; wait for all handles. This guarantees `asset()` fields are loaded before `awake`.
3. Expand `instance` entries: load the referenced scene asset, clone its entity list under the instance root with a per-instance uid remap (file-local uid → runtime uid), apply overrides in order.
4. Create entities in file order (parents first, since tree order is guaranteed by the serializer; loaders tolerate any order by deferring parenting).
5. Create components, assign props from schema defaults then file values; `entityRef`/`componentRef` are resolved through the remap table; unresolved references are set to `null` with a diagnostic (`IGX-0602`).
6. Run `onAttach` hooks, then `awake`/`onEnable` in tree order (`01-lifecycle-and-time.md` §4).

## 5. Saving

- `serializeScene(instance | entities, options)` returns a scene file object. Runtime entities created in code are included if they belong to the instance. Entities that came from an `instance` are re-emitted as `instance` entries with computed overrides (diffing current props against the instanced asset's values), unless `options.flatten` is set.
- `serializeEntity(entity)` / `serializeComponent(component)` exist for tooling and tests.
- Save games use the same machinery: a game serializes the scene instances it considers "state" and stores the JSON through `app.storage` (`14-platform-electron.md` §2). Fields that must not be saved are marked `transient: true` in the schema.

## 6. Other file formats

All share the `format`/`formatVersion` header and JSON Schema validation:

| Format | Extension | Owner |
|---|---|---|
| `ignifx.material` | `.material.json` | core |
| `ignifx.environment` | `.environment.json` | core |
| `ignifx.spriteatlas` | `.atlas.json` | `@ignifx/2d` |
| `ignifx.spriteanimation` | `.spriteanim.json` | `@ignifx/2d` |
| `ignifx.tilemap` | `.tilemap.json` (import from Tiled `.tmj` / LDtk `.ldtk`) | `@ignifx/2d` |
| `ignifx.inputactions` | `.input.json` | `@ignifx/input` |
| `ignifx.animator` | `.animator.json` | `@ignifx/3d` |
| `ignifx.audiobuses` | `.audio.json` | `@ignifx/audio` |
| `ignifx.manifest` | `assets.manifest.json` | vite plugin |

## 7. Versioning and migration

- `formatVersion` is an integer per format. Before 1.0 it stays `1` and incompatible changes simply invalidate files (`CONSTITUTION.md` §4.2); the loader reports `IGX-0603` with the offending component and field.
- After 1.0, a format bump ships with a migration function registered by the owning extension (`registerFileMigration(format, from, to, fn)`) and a document in `docs/migrations/`. Loaders migrate in memory; tooling (`ignifx migrate`) rewrites files.
- Components version their schema independently with `static schemaVersion = 1` and `static migrate(fromVersion, props)`. The file records the schema version per component only when it differs from `1`, keeping files terse.
- Layer and sorting-layer names in files are validated against `ignifx.config.ts` by the Vite plugin at build time and by the loader at runtime; `ignifx rename-layer` and `ignifx rename-sorting-layer` rewrite files when settings change.

## 8. Generated JSON Schemas

The Vite plugin (and `ignifx schemas` CLI command) emits `ignifx.schemas.json` from every registered component schema and file format. These schemas drive build-time validation, editor autocompletion, and are linked from the Agent Skill so that agents can author scene files without guessing field names.
