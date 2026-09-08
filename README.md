# ignifx

A code-first TypeScript game engine for the web, built on [Babylon Lite](https://github.com/BabylonJS/Babylon-Lite) (WebGPU only). Runs in WebGPU-capable browsers and in Electron. Designed for indie 2D (top-down, side-scrolling) and 3D (third-person, first-person) games, with a Unity-style script lifecycle, Godot-style scenes and signals, and first-class documentation for AI coding agents.

By [Astrum Forge Studios](https://astrumforge.com) · [ignifx.com](https://ignifx.com) · Apache-2.0

## Status

**Phases 0–12 of the plan are delivered, and `ignifx` `0.2.0` with every `@ignifx/*` package is on npm (`npx @ignifx/cli@latest my-game` scaffolds a project).** Every `@ignifx/*` package is real: `core` (kernel, rendering on Babylon Lite, assets, the `ignifx.scene` format, tweens, platform, storage, hot reload), `vite-plugin`, `input`, `physics` (Havok), `audio`, `2d`, `physics-2d` (Rapier), `3d`, `ui`, `electron`, `devtools`, `cli` (`create-ignifx`), and the `ignifx` umbrella that re-exports all of them. Four playable templates live under `templates/`, real apps and sixteen compiled recipes under `examples/`, and the public site under `website/` (built for Cloudflare Pages). `AGENTS.md` carries the current status and `docs/plan/engineering-plan.md` says what is next. See [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.

| Document                                                                   | Purpose                                                                                                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CONSTITUTION.md`](CONSTITUTION.md)                                       | Principles, architecture tenets, versioning and documentation rules, process                                                                                                     |
| [`docs/standards/coding-standards.md`](docs/standards/coding-standards.md) | Toolchain, TypeScript configuration, lint, naming, testing, CI                                                                                                                   |
| [`docs/architecture/`](docs/architecture/)                                 | Design standards: overview, lifecycle, scene graph, scripting, extensions, assets, serialization, rendering, input, physics, audio, 2D, 3D, UI, platform, devtools, docs harness |
| [`docs/adr/`](docs/adr/)                                                   | Architecture decision records                                                                                                                                                    |
| [`docs/plan/engineering-plan.md`](docs/plan/engineering-plan.md)           | Phased plan from empty repo to 1.0                                                                                                                                               |
| [`skills/ignifx/SKILL.md`](skills/ignifx/SKILL.md)                         | The Agent Skill that ships with the engine                                                                                                                                       |
| [`AGENTS.md`](AGENTS.md)                                                   | Entry point for agents and contributors                                                                                                                                          |

## Today

Everything below compiles against `@ignifx/core` as it stands: a camera, a shadow-casting light, a spinning PBR cube, on screen.

```ts
import { Camera, Light, MeshAsset, MeshRenderer, Script, createApp, f32 } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

class Spinner extends Script.define({ speed: f32(90) }) implements ScriptCallbacks {
  static typeId = "demo/Spinner";

  update(dt: number): void {
    this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 });
  }
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx needs a <canvas> element on the page.");
}

const app = await createApp({ canvas, settings: { rendering: { features: { shadows: true } } } });
app.registerComponents([Spinner]);

const eye = app.world.createEntity("Main Camera");
eye.transform.localPosition.set(0, 2.5, -4.5);
eye.transform.lookAt({ x: 0, y: 0.6, z: 0 });
eye.addComponent(Camera, { fov: 55 });

const sun = app.world.createEntity("Sun");
sun.transform.lookAt({ x: 0, y: -1, z: 0.5 });
sun.addComponent(Light, { type: "directional", intensity: 3 });

const cube = app.world.createEntity("Cube");
cube.addComponent(MeshRenderer, { mesh: MeshAsset.box(app, { size: 1.3 }) });
cube.addComponent(Spinner, { speed: 120 });

await app.start();
```

Continuing from that app, loading a level and stamping out a prefab:

```ts
const level = await app.world.loadScene("levels/level01.scene.json");
const enemy = await app.world.instantiateAsync("prefabs/enemy.prefab.json", { position: { x: 4, y: 0, z: 2 } });
app.log.info("loaded", level.name, "and spawned", enemy.name);
```

Runnable versions live in [`examples/`](examples/), and the compiled recipes behind the Agent Skill's recipe pages are in [`examples/recipes/`](examples/recipes/).

## Repository layout

`packages/` published `@ignifx/*` packages · `templates/` starter games (planned) · `examples/` runnable apps and the compiled recipes · `benchmarks/` frame-time and heap baselines · `tests/visual/` golden images · `website/` public site (separate deploy) · `docs/` governing documents · `skills/` agent skills.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
