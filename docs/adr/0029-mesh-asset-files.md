# ADR-0029 · Primitive meshes as `.mesh.json` files

**Status:** Proposed · **Date:** 2026-10-15 · **Deciders:** Astrum Forge Studios (owner)

## Context

A scene file names an asset by address (`06-serialization-and-scene-format.md` §3). A primitive mesh had no address a file could name: `MeshAsset.box(app)` and its siblings publish at a `memory:` address, the serializer writes such a reference as `null` (`IGX-0602`), and core's `mesh` type had no loader, so a `"mesh"` address failed with `IGX-0504`.

Converting `templates/3d-third-person` to a scene file (engine PR #46, editor plan ask E2) hit this. The template publishes each primitive a second time at a plain address (`src/level-meshes.ts`) before `loadScene`. The scene then loads only in an app that ran that code. `@ignifx/editor-host` creates the app from the extensions and scripts only, so the editor's scene view cannot open the level at all (editor plan ask E15, "format gap 1").

Constraints: core stays small (`CONSTITUTION.md` §2.3), unused features cost nothing (§2.5), only `src/lite/**` imports Lite (§3.4), file formats are versioned JSON with a schema (§3.7, `06` §6 and §8), and a headless app must load the same files (§3.8).

## Options considered

1. **Keep publishing in code.** No engine change, but every scene that uses a primitive needs game code to run first, and no editor can open it.
2. **A `.mesh.json` file per primitive, loaded by core's `mesh` type.** One small loader. The file's address is its path, like every other asset.
3. **Inline primitives in the scene file** (a `MeshRenderer.mesh` value of `{ "primitive": "box", … }`). No extra files, but it adds a second encoding to the `asset` field kind, and two entities can no longer share one template.
4. **Option 2, but addressable without the suffix** (`meshes/crate` resolving to `meshes/crate.mesh.json`). This is what PR #46's scene already writes. But every other address is a file path. The manifest lists the file under its full name, so production `resolveUrl` would miss it. Hot reload matches changed files by address. Two spellings of one file would also be two cache entries and two GPU templates.

## Decision

Option 2.

- A `<name>.mesh.json` file holds `{ "format": "ignifx.mesh", "formatVersion": 1, "primitive": …, "options": { … }, "name"?: … }`. It uses the same `format`/`formatVersion` header every other ignifx file uses.
- `primitive` is one of `box`, `sphere`, `plane`, `ground`, `cylinder`, `capsule`, `torus`, which are exactly the `MeshAsset` factories. `options` is exactly that factory's options type. Omitted options take the factory's defaults.
- `createMeshLoader()` (`packages/core/src/render/loaders/mesh-loader.ts`) is the loader for core's existing `mesh` type. It claims the `.mesh.json` suffix. It builds the asset through the same code path as the factories, so a file and a factory call give the same mesh. The same type still holds code-built meshes, and its `unload` frees both.
- The address is the file path: `{ "$asset": "meshes/crate.mesh.json" }`, `app.assets.load("meshes/crate.mesh.json")`.
- One table, `MESH_PRIMITIVE_OPTIONS`, drives the runtime check and `meshFileJsonSchema()`. The compiler checks that the table matches the options types. A wrong header is `IGX-0709`, a wrong version is `IGX-0603`, and an unknown primitive, an unknown option, or a value an option cannot hold is the new `IGX-0507`. Lengths are finite and zero or more; counts are whole numbers, one or more.
- `@ignifx/vite-plugin` classifies the suffix as `mesh`, so the manifest records the type and the header check requires one. The format joins `describeSchemas()` as `ignifx/mesh-file`.

This lives in core because core already owns the `mesh` type, the factories, and `MeshRenderer`. The loader is under 40 lines and its format module about 300, mostly TSDoc, and it calls the existing factory path, so it adds no Lite imports outside `src/lite/**` (§3.4). A project with no `.mesh.json` file never runs the loader (§2.5); its bytes are the loader table entry and the option table, which the core extension registers either way.

### Non-goals

- Procedural meshes, merged meshes, and raw vertex data (`MeshAsset.fromData`). Those stay code.
- Lite primitives ignifx does not wrap (torus knot, polyhedra, text). Each would need a `MeshAsset` factory first.
- glTF meshes. They already load through `ModelAsset` and the `#mesh:` fragment.

## Consequences

- A scene or prefab can name a primitive, the scene loads in any app that registers the core extension, and saving it writes the address back instead of `null`.
- `templates/3d-third-person` can delete `src/level-meshes.ts` and add seven `assets/meshes/*.mesh.json` files. In its scene, each `{ "$asset": "meshes/<name>", "type": "mesh" }` becomes `{ "$asset": "meshes/<name>.mesh.json" }`. That is a follow-up to PR #46, not part of this change.
- A `.mesh.json` edit reloads through the default hot-reload path, and `onReplaced` fires. `MeshRenderer` does not listen for it, so a renderer keeps drawing its old clone until its `mesh` field is assigned again or the scene reloads. Rebuilding on `onReplaced` is possible follow-up work.
- Adding a primitive means adding a factory, a `MeshPrimitiveDefinition` member, and a table row. The compiler checks the last two against each other.
- Revisit if games want vertex data in files. That would be a binary format, not more JSON fields.
