---
name: ignifx
description: Builds 2D and 3D web games with the ignifx TypeScript game engine (WebGPU-only, Babylon Lite based, browser and Electron). Use when creating or editing ignifx apps, entities, scripts, scenes, prefabs, assets, input actions, physics, audio, sprites, or tilemaps, or when the user mentions ignifx, @ignifx packages, createApp, Script lifecycle, or ignifx scene JSON.
license: Apache-2.0
metadata:
  ignifx-version: "0.0.0-unreleased"
  babylon-lite-version: "1.27.0"
---

# ignifx

> **Scaffold notice.** ignifx is in the planning phase; no package has been released. Sections marked *(populated in Phase N)* are filled by the engineering plan's phases (`docs/plan/engineering-plan.md`). Everything in this file must describe only the current release once one exists (`CONSTITUTION.md` Article V).

## What this is / when to use

ignifx is a code-first TypeScript game engine for browsers and Electron. It renders exclusively through WebGPU via Babylon Lite (`@babylonjs/lite`), and it is designed for indie 2D (top-down, side-scrolling) and 3D (third-person, first-person) games. Use this skill whenever you write or modify code, scenes, or assets for an ignifx project.

## Environment

| Item | Value |
|---|---|
| Engine version | *(populated at release)* |
| Babylon Lite | 1.27.0 (pinned; do not call Lite APIs directly outside adapter code) |
| Node / pnpm | 24 LTS / 11 |
| Browser requirement | WebGPU (Chrome/Edge 113+, Safari 26+, Firefox 141+ Windows / 145+ Apple Silicon); Electron needs `--enable-unsafe-webgpu` (handled by `@ignifx/electron`) |
| Commands | `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm check` (all gates) |

## Mental model

```
App (createApp) ─ owns ─▶ World ─ owns ─▶ SceneInstance* ─ owns ─▶ Entity* ─ has ─▶ Transform + Component*
                                                                                     └─ Script = Component with lifecycle callbacks
Frame: PreUpdate → awake/onEnable → [fixedUpdate × N + physics] → start → update → animation → lateUpdate → destroy flush → PreRender → render
```

- One obvious way per task; no globals: reach everything from `this.app`, `this.world`, `this.entity`.
- Units: metres, seconds, degrees. Left-handed, Y up, +Z forward. 2D is Y up with pixels-per-unit.
- Unity mapping: GameObject → `Entity`, MonoBehaviour → `Script`, prefab → instanced scene. Godot mapping: Node → `Entity`, PackedScene → scene asset, signal → `Signal`.

## First app *(populated in Phase 1; shape fixed by docs/architecture)*

```ts ignore-check
// ignore-check: packages are not published yet; the tag is removed in Phase 1 when this compiles in the harness.
import { createApp, Script, MeshRenderer, MeshAsset, f32 } from "@ignifx/core";
import { input } from "@ignifx/input";

class Spinner extends Script.define({ speed: f32(90) }) {
  static typeId = "demo/Spinner";
  update(dt: number) { this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 }); }
}

const app = await createApp({ canvas: document.querySelector("canvas")!, extensions: [input()] });
app.registerComponents([Spinner]);
const cube = app.world.createEntity("Cube");
cube.addComponent(MeshRenderer, { mesh: MeshAsset.box() });
cube.addComponent(Spinner);
await app.start();
```

## Core APIs *(tables generated from references/api in Phase 11)*

| Area | Read |
|---|---|
| Lifecycle and time | `references/concepts/lifecycle.md` |
| Entities, transforms, scenes | `references/concepts/scene-graph.md` |
| Scripts, schemas, coroutines | `references/concepts/scripting.md` |
| Assets and loading | `references/concepts/assets.md` |
| Extensions | `references/concepts/extensions.md` |
| Generated API | `references/api/<package>.md` |

## Recipes *(populated from examples/recipes in Phase 11)*

| Recipe | Description |
|---|---|
| — | — |

## File formats

| Format | Reference |
|---|---|
| Scene / prefab (`ignifx.scene`) | `references/formats/scene.md` |
| Material, atlas, tilemap, input actions, animator, audio buses | `references/formats/*.md` |
| JSON Schemas | `ignifx.schemas.json` (generated) |

## Gotchas (top 10) *(seeded from architecture decisions; verified per release)*

1. WebGPU only: `createApp` rejects with `WebGpuUnavailableError` when unsupported; show a fallback page.
2. Hide entities with `active = false`; never remove a mesh from the Lite scene to hide it (Lite disposes it permanently).
3. `fixedUpdate` runs 0–N times per frame; use its `dt` argument, not `app.time.deltaTime`.
4. Frame sequencing uses generator coroutines (`yield waitSeconds(1)`), never `async` lifecycle methods.
5. Serialized fields come only from `Component.define({...})` schemas; plain class fields are runtime-only.
6. `typeId` must be explicit and namespaced (`mygame/Mover`) on every serializable component.
7. Audio needs a user gesture; the engine unlocks on the first click, or call `app.audio.unlock()` from a button.
8. Physics queries need one completed step first; body damping/gravity factor per body are not available.
9. Rendering feature opt-ins (shadows, stencil, lightmaps, …) are declared in `ignifx.config.ts` before start; they cannot be toggled later.
10. `.lite` escape hatches expose Babylon Lite objects with no stability guarantee.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`references/api/*.md` for exact signatures · `docs/architecture/` for design rationale · `docs/migrations/` exists only after 1.0.
