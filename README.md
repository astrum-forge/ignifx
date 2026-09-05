# ignifx

A code-first TypeScript game engine for the web, built on [Babylon Lite](https://github.com/BabylonJS/Babylon-Lite) (WebGPU only). Runs in WebGPU-capable browsers and in Electron. Designed for indie 2D (top-down, side-scrolling) and 3D (third-person, first-person) games, with a Unity-style script lifecycle, Godot-style scenes and signals, and first-class documentation for AI coding agents.

By [Astrum Forge Studios](https://astrumforge.com) · [ignifx.com](https://ignifx.com) · Apache-2.0

## Status

**Phase 1 (Kernel) complete; nothing published yet.** `@ignifx/core` holds the runtime kernel — `createApp` and the extension host, `Time` and the six-phase scheduler with its fixed-timestep loop, `World`/`SceneInstance`/`Entity`/`Transform`, `Component`/`Script` with schema-declared fields and generator coroutines, `Signal`, tags and layers, the math module, and the `IGX-####` error space — and the `ignifx` umbrella re-exports it. Nothing renders yet: cameras, meshes, materials, and the asset system arrive in Phase 2. The other twelve `@ignifx/*` packages are still skeletons. See [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.

| Document                                                                   | Purpose                                                                                                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CONSTITUTION.md`](CONSTITUTION.md)                                       | Principles, architecture tenets, versioning and documentation rules, process                                                                                                     |
| [`docs/standards/coding-standards.md`](docs/standards/coding-standards.md) | Toolchain, TypeScript configuration, lint, naming, testing, CI                                                                                                                   |
| [`docs/architecture/`](docs/architecture/)                                 | Design standards: overview, lifecycle, scene graph, scripting, extensions, assets, serialization, rendering, input, physics, audio, 2D, 3D, UI, platform, devtools, docs harness |
| [`docs/adr/`](docs/adr/)                                                   | Architecture decision records                                                                                                                                                    |
| [`docs/plan/engineering-plan.md`](docs/plan/engineering-plan.md)           | Phased plan from empty repo to 1.0                                                                                                                                               |
| [`skills/ignifx/SKILL.md`](skills/ignifx/SKILL.md)                         | The Agent Skill that ships with the engine                                                                                                                                       |
| [`AGENTS.md`](AGENTS.md)                                                   | Entry point for agents and contributors                                                                                                                                          |

## Today (Phase 1)

Everything below compiles against `@ignifx/core` as it stands. The app runs, the script ticks, the transform moves — there is simply nothing on screen yet.

```ts
import { Script, createApp, f32 } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

class Spinner extends Script.define({ speed: f32(90) }) implements ScriptCallbacks {
  static typeId = "demo/Spinner";

  update(dt: number): void {
    this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 });
  }
}

const app = await createApp({ headless: true });
app.registerComponents([Spinner]);
const cube = app.world.createEntity("Cube");
cube.addComponent(Spinner, { speed: 120 });

await app.start();
app.step(1 / 60);
```

## Planned shape (Phase 2, once rendering and assets land)

```ts
import { createApp, Script, MeshRenderer, MeshAsset, f32 } from "@ignifx/core";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";

class Spinner extends Script.define({ speed: f32(90) }) {
  static typeId = "demo/Spinner";
  update(dt: number): void {
    this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 });
  }
}

const app = await createApp({ canvas, extensions: [input(), physics()] });
app.registerComponents([Spinner]);
const cube = app.world.createEntity("Cube");
cube.addComponent(MeshRenderer, { mesh: MeshAsset.box() });
cube.addComponent(Spinner);
await app.start();
```

## Repository layout (planned)

`packages/` published `@ignifx/*` packages · `templates/` starter games · `examples/` recipes · `website/` public site (separate deploy) · `docs/` governing documents · `skills/` agent skills.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
