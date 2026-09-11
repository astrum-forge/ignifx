# ignifx

A code-first TypeScript engine for 2D and 3D games in WebGPU-capable browsers and Electron.
Built on [Babylon Lite](https://github.com/BabylonJS/Babylon-Lite), with script lifecycles,
scene trees, signals, and documentation for developers and coding agents.

By [Astrum Forge Studios](https://astrumforge.com) · [ignifx.com](https://ignifx.com) · [Apache-2.0](LICENSE)

## Start a game

Use Node 24 and pnpm:

```sh
npx @ignifx/cli@latest my-game --template 2d-topdown
cd my-game
pnpm install
pnpm dev
```

Choose `2d-topdown`, `2d-sidescroller`, `3d-third-person`, or `3d-first-person`.
Each template includes menus, settings, input rebinding, and saves. Add `--desktop` when creating
the project to include Electron support, then run `pnpm dev:desktop`.
See the [CLI guide](packages/cli/README.md) for options.

ignifx requires WebGPU; there is no WebGL fallback. The engine is pre-1.0, so minor releases may
include breaking changes. See the [changelog](packages/ignifx/CHANGELOG.md) and
[engineering plan](docs/plan/engineering-plan.md) for release history and remaining work.

## What is included

- **Core:** scenes, entities, scripts, rendering, assets, tweens, storage, and hot reload.
- **2D:** sprites, tilemaps, animation, pixel-perfect cameras, and Rapier physics.
- **3D:** Havok physics, character controllers, camera rigs, animation, and navigation.
- **Game systems:** input actions, rebinding, audio, DOM UI, and devtools.
- **Tooling:** Vite integration, starter templates, and Electron builds.

Use `ignifx` for core and standard runtime extensions, or choose individual `@ignifx/*` packages.
Register the extensions your game needs when creating the app.

## A spinning cube

This browser example needs a `<canvas>` element and `@ignifx/core` installed. It creates a camera,
a directional light, and a cube that rotates each frame. `speed` is in degrees per second;
`dt` is the frame duration in seconds.

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

Explore the [runnable examples](examples/) and [compiled recipes](examples/recipes/) for scene
loading, prefabs, input, physics, audio, and UI.

## Documentation

- [Engine guide and agent skill](skills/ignifx/SKILL.md): setup, concepts, API references, and recipes.
- [Architecture](docs/architecture/00-overview.md): engine structure and subsystem design.
- [Contributing](CONTRIBUTING.md): repository setup, commands, and checks.
- [Coding standards](docs/standards/coding-standards.md) and [constitution](CONSTITUTION.md): development rules.
- [Agent entry point](AGENTS.md): instructions for working in this repository.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
