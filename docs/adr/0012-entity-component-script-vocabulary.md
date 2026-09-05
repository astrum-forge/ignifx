# ADR-0012 · Vocabulary: App, World, Scene, Entity, Component, Script, System, Extension

**Status:** Accepted · **Date:** 2026-09-05

## Context

Unity says GameObject/Component/MonoBehaviour; Godot says Node/Scene; ECS engines say Entity/Component/System with data-only components. ignifx is OOP-first (components carry data and behaviour) but wants ECS-style systems for engine work and clear words for agents.

## Decision

- `Entity` for the scene-tree node (not `GameObject`, not `Node`, to avoid confusion with Lite's `SceneNode` and DOM nodes).
- `Component` for attachable data/behaviour; `Script` for components with lifecycle callbacks (the MonoBehaviour role).
- `System` for engine-level per-phase logic; `Extension` for packages that register things; `Scene` for the file/instance; `World` for the running simulation; `App` for the root.
- A pure ECS with struct-of-arrays storage is not part of the core; hot subsystems use typed arrays internally.

## Consequences

- Names are unambiguous in prose and code, which matters for the Agent Skill.
- Unity/Godot mappings are documented in the skill's mental-model section.
