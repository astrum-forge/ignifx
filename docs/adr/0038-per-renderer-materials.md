# ADR-0038 · A renderer can own a copy of its material

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

`MeshRenderer.materials` can only name material files. A runtime copy made with `MaterialAsset.clone(app)` lives at a `memory:` address, so the serializer writes it as `null` with `IGX-0602` (`06-serialization-and-scene-format.md` §3). Recolouring a shared material with `setBaseColor` recolours every renderer that names it. In `templates/3d-first-person` each pedestal lights up on its own, so the scene names the shared `crate.material.json` and `src/pedestals.ts` swaps in a clone per pedestal after the load, before the first `PreRender` builds the mesh (engine PR #52, gap 16). The editor shows the shared material and cannot express "this renderer gets its own".

Constraints: files round-trip (`06` §1), core stays small (`CONSTITUTION.md` §2.3), unused features cost nothing (§2.5), and additive fields are allowed in a minor release (§4.2).

## Options considered

1. **A per-renderer flag.** A new schema field `MeshRenderer.uniqueMaterial` (default `false`). When `true`, the renderer draws a clone of `materials[0]` that it makes when it builds its mesh and releases with it; a read-only `renderer.material` returns that clone for code to recolour. The file still names the shared asset plus one boolean. This is Unity's `material` versus `sharedMaterial` split, chosen per renderer in data.
2. **Property overrides on the renderer.** A field such as `materialProps: { baseColor, emissive, … }` applied to a per-renderer clone. Tints become authorable per renderer in the editor, but the field must mirror every material kind's properties (PBR, unlit, shader uniforms), which duplicates the material format inside the renderer.
3. **No engine change: one material file per renderer that changes.** Works today (`pedestal-a.material.json`, …). Fine for three pedestals, but it multiplies files, and duplicating an entity in the editor silently shares the file again.

## Decision

Recommended: option 1. `uniqueMaterial: true` gives a renderer its own copy of its material, made and released by the renderer.

## Consequences

- `src/pedestals.ts` shrinks to finding the pedestals; the clone moves into the scene as `"uniqueMaterial": true`.
- Editor: one checkbox in the inspector; the scene view shows the same material as the game, since the clone starts identical to the file.
- A hot reload of the shared file does not reach existing clones until the renderer rebuilds; the TSDoc says so, and following `onReplaced` is possible later.
- A renderer with the flag costs one extra material; renderers without it pay nothing (§2.5).
- Follow-up, not part of this decision: the same flag for `Model.materialOverrides`, and option 2 if games ask to author per-renderer tints without code.
- If accepted: the field, the clone's life and the `material` getter in `packages/core/src/render/mesh-renderer.ts`, tests (clone per renderer, release on destroy, `setBaseColor` isolation, round trip), the template change, doc 06 §3 and `07-rendering.md` §2.3, the skill's `references/concepts/rendering.md` and `references/formats/components.md` (generated), the API report, and a minor changeset.
