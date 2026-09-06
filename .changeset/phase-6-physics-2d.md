---
"@ignifx/physics-2d": minor
"ignifx": minor
---

Implement Phase 6 2D physics on Rapier 2D (ADR-0006, `docs/architecture/11-2d-toolkit.md` §8).

`physics2d()` registers `app.physics2d`, the `physics2d` settings section, the `ignifx.physicsmaterial` loader, the `IGX-11xx` diagnostics, and the three systems that put 2D physics in the frame — restore poses at `FixedUpdate −100`, step Rapier and dispatch events at `FixedUpdate 100`, interpolate at `PreRender −500`.

- **Components:** `Rigidbody2D` (dynamic/kinematic/static, exact `mass`, gravity scale, per-body damping, frozen rotation, forces, impulses, torque, teleport), `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `EdgeCollider2D`, `TilemapCollider2D`, and `CharacterController2D` with slopes, autostep, snap-to-ground, and one-way platforms.
- **Events:** `onCollisionEnter`/`Stay`/`Exit` and `onTriggerEnter`/`Exit` — the 3D callback names, carrying pooled `Collision2D` / `TriggerEvent2D` payloads. Rapier reports both colliders, so both identities are always present and no ADR-0013-style waiver is needed.
- **Queries:** `raycast`, `raycastAll`, `overlapCircle`, `overlapBox`, and `shapeCast`, all shape-accurate and all reporting the exact collider they hit.
- **Layers:** the project collision matrix maps onto Rapier's interaction groups. Rapier's groups are 16 bits wide, so only the first sixteen layers filter; a collider above them reports `IGX-1152` and falls back to layer 0.
- **Determinism:** a committed baseline hash over 600 fixed steps, reproduced across apps and across processes. `@dimforge/rapier2d-compat` is Rapier's main build, which guarantees local determinism only.
