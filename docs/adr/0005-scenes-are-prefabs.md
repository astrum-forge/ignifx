# ADR-0005 · One file format: scenes are prefabs

**Status:** Accepted · **Date:** 2026-09-05

## Context

Unity separates scenes and prefabs (with variants, nesting, overrides); Godot has one `PackedScene` concept that is instanced anywhere. ignifx needs levels, reusable objects, and instance overrides with a diff-friendly format (`docs/architecture/06-serialization-and-scene-format.md`).

## Options considered

1. **Separate scene and prefab formats** — familiar to Unity users. Cons: two loaders, two override models, duplicated tooling.
2. **Godot model: one scene format, instanced with overrides** — one loader; prefab = instanced scene; nesting free.

## Decision

Option 2. `*.scene.json` and `*.prefab.json` share the `ignifx.scene` format; an entity may be an `instance` of another scene asset with path-addressed overrides (set/add/remove). "Prefab" is vocabulary, not a type.

## Consequences

- `world.loadScene` and `world.instantiate` are the two operations; both use the same loader.
- Variants are scenes that instance another scene at their root with overrides.
- Live prefab links ("apply to prefab") are editor concerns deferred to post-1.0; the format already supports them.
