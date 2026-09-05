# ignifx

A code-first TypeScript game engine for the web, built on [Babylon Lite](https://github.com/BabylonJS/Babylon-Lite) (WebGPU only). Runs in WebGPU-capable browsers and in Electron. Designed for indie 2D (top-down, side-scrolling) and 3D (third-person, first-person) games, with a Unity-style script lifecycle, Godot-style scenes and signals, and first-class documentation for AI coding agents.

By [Astrum Forge Studios](https://astrumforge.com) · [ignifx.com](https://ignifx.com) · Apache-2.0

## Status

**Phase 0 complete; nothing published yet.** The repository contains the governing documents below plus the Phase 0 scaffold: the pnpm/Turborepo workspace, 13 `@ignifx/*` package skeletons (only `@ignifx/core` has code, the toolchain-spike adapter), CI workflows, the documentation-harness skeleton, the `create-ignifx` CLI skeleton, and the website shell. See [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.

| Document                                                                   | Purpose                                                                                                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CONSTITUTION.md`](CONSTITUTION.md)                                       | Principles, architecture tenets, versioning and documentation rules, process                                                                                                     |
| [`docs/standards/coding-standards.md`](docs/standards/coding-standards.md) | Toolchain, TypeScript configuration, lint, naming, testing, CI                                                                                                                   |
| [`docs/architecture/`](docs/architecture/)                                 | Design standards: overview, lifecycle, scene graph, scripting, extensions, assets, serialization, rendering, input, physics, audio, 2D, 3D, UI, platform, devtools, docs harness |
| [`docs/adr/`](docs/adr/)                                                   | Architecture decision records                                                                                                                                                    |
| [`docs/plan/engineering-plan.md`](docs/plan/engineering-plan.md)           | Phased plan from empty repo to 1.0                                                                                                                                               |
| [`skills/ignifx/SKILL.md`](skills/ignifx/SKILL.md)                         | The Agent Skill that ships with the engine (scaffold)                                                                                                                            |
| [`AGENTS.md`](AGENTS.md)                                                   | Entry point for agents and contributors                                                                                                                                          |

## Planned shape

```ts
import { createApp, Script, MeshRenderer, MeshAsset, f32 } from "@ignifx/core";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";

class Spinner extends Script.define({ speed: f32(90) }) {
  static typeId = "demo/Spinner";
  update(dt: number) {
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
