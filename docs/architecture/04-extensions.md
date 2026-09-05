# 04 · Extensions

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/core` · **Related:** `03-scripting-and-components.md` §6–7, `05-assets-and-loading.md`, `CONSTITUTION.md` Article VIII

An extension is the unit of optional functionality. Input, physics, audio, the 2D and 3D toolkits, UI, Electron support, and devtools are all extensions; a game's own code can be one too. The design borrows Bevy's `Plugin::build(app)` (one registration entry point), Godot's add-on manifest (`plugin.cfg` → `package.json#ignifx`), and Unity's package layout (`Runtime/`, `Samples~/`, `Documentation~/` → `src/`, `examples/`, `skills/`).

---

## 1. The contract

```ts
interface Extension {
  readonly name: string; // unique; the npm package name for published extensions ("@ignifx/physics"), "game/<name>" for in-game ones
  readonly version: string; // semver of the extension itself
  readonly engine?: string; // semver range of @ignifx/core this extension supports; checked at registration
  readonly requires?: readonly string[]; // extensions that must be registered before this one
  readonly optional?: readonly string[]; // extensions this one integrates with when present (registered before it if present)

  register(ctx: ExtensionContext): void | Promise<void>; // declare components, systems, services, loaders, settings
  onStart?(app: App): void | Promise<void>; // after every extension registered and the Lite engine exists; before the first frame
  onStop?(app: App): void;
  dispose?(app: App): void;
}

interface ExtensionContext {
  readonly app: App;
  readonly log: Logger;

  registerComponent(type: ComponentType, options?: { typeId?: string }): void;
  registerComponents(types: readonly ComponentType[]): void;
  registerSystem(system: System, options: { phase: Phase; order?: number }): void;
  registerService<T>(key: ServiceKey<T>, instance: T): void;
  defineAppProperty(name: string, getter: () => unknown): void; // pairs with module augmentation of App
  registerAssetType(type: AssetTypeDefinition): void;
  registerAssetLoader(loader: AssetLoader): void;
  registerSettings<S>(section: string, schema: Schema<S>, defaults: S): void; // project settings section
  registerErrorCodes(codes: Record<string, string>): void; // IGX-#### → message template
  onDispose(callback: () => void): void;

  require<T>(key: ServiceKey<T>): T; // service registered by an earlier extension; throws IGX-0405 if absent
  tryGet<T>(key: ServiceKey<T>): T | undefined;
  settings<S>(section: string): S; // resolved project settings for a registered section
}

function defineExtension<O = void>(factory: (options: O) => Extension): (options?: O) => Extension;
```

Usage:

```ts
// @ignifx/physics/src/index.ts
export const physics = defineExtension<PhysicsOptions>((options = {}) => ({
  name: "@ignifx/physics",
  version: PKG_VERSION,
  engine: ">=0.1.0 <1.0.0",
  requires: ["@ignifx/core"],
  register(ctx) {
    ctx.registerSettings("physics", PhysicsSettingsSchema, defaultPhysicsSettings);
    ctx.registerComponents([
      Rigidbody,
      BoxCollider,
      SphereCollider,
      CapsuleCollider,
      MeshCollider,
      CharacterController,
    ]);
    const service = new PhysicsService(ctx.app, { ...ctx.settings("physics"), ...options });
    ctx.registerService(PhysicsService, service);
    ctx.defineAppProperty("physics", () => service);
    ctx.registerSystem(service.restorePosesSystem, { phase: Phase.FixedUpdate, order: -100 });
    ctx.registerSystem(service.stepSystem, { phase: Phase.FixedUpdate, order: 100 });
    ctx.registerSystem(service.interpolationSystem, { phase: Phase.PreRender, order: -500 });
  },
  async onStart(app) {
    await service.loadHavok();
  },
  dispose(app) {
    service.dispose();
  },
}));

// game code
const app = await createApp({
  canvas,
  extensions: [input(), physics({ gravity: { x: 0, y: -9.81, z: 0 } }), audio(), threeD()],
});
```

## 2. Registration order and validation

1. `createApp` builds the list: the implicit core extension first, then the user list.
2. Extensions are topologically sorted by `requires` (and `optional` edges when the optional extension is present). A `requires` cycle throws `IGX-0402`; a missing required extension throws `IGX-0403`; a duplicate name throws `IGX-0406`. `optional` edges that would form a cycle (two extensions optionally integrating with each other, as `physics` and `devtools` do) are dropped with a development note; the two then register in list order and must resolve each other lazily in `onStart` via `ctx.tryGet`.
3. `engine` ranges are checked against the core version: mismatch throws in development, warns in production (`IGX-0404`).
4. `register` runs in sorted order and may be `async` (for example to fetch a WASM binary), but heavy work should go in `onStart` so that registration stays fast and side-effect free.
5. After all `register` calls, the Lite engine and render scene are created (or the null engine in headless mode), the world is created, and settings are frozen. `onStart` hooks then run in order during `app.start()`.
6. `onStop` and `dispose` run in reverse order.

Extensions never execute code at module import time (`CONSTITUTION.md` §3.5). Everything happens inside `register`/`onStart`.

## 3. What an extension can contribute

| Contribution            | API                                                                       | Notes                                                                  |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Components and scripts  | `registerComponent(s)`                                                    | Makes `typeId`s known to the serializer and inspector                  |
| Systems                 | `registerSystem`                                                          | Phase and order; see `03-scripting-and-components.md` §6               |
| Services                | `registerService` + `defineAppProperty` + module augmentation             | The typed entry point scripts use (`app.input`)                        |
| Asset types and loaders | `registerAssetType`, `registerAssetLoader`                                | `05-assets-and-loading.md`                                             |
| Project settings        | `registerSettings`                                                        | Validated from `ignifx.config.ts`                                      |
| Error codes             | `registerErrorCodes`                                                      | Namespaced ranges are assigned in `docs/standards/coding-standards.md` |
| Devtools panels         | via the devtools service, when present (`optional: ["@ignifx/devtools"]`) | `15-devtools-and-diagnostics.md`                                       |
| Agent documentation     | `skills/<name>/SKILL.md` in the package                                   | `16-docs-harness-and-skill.md`                                         |

An extension **cannot**: register frame callbacks with Babylon Lite directly, add phases, replace core services, or reach into another extension's internals. Cross-extension integration goes through services (`ctx.require`) and signals.

## 4. Package manifest

Published extensions declare an `ignifx` block in `package.json`:

```json
{
  "name": "@ignifx/physics",
  "version": "0.4.0",
  "type": "module",
  "sideEffects": false,
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "peerDependencies": { "@ignifx/core": "0.4.0", "@babylonjs/havok": "^1.3.0" },
  "keywords": ["ignifx", "ignifx-extension"],
  "ignifx": {
    "extension": true,
    "engine": ">=0.4.0 <1.0.0",
    "requires": [],
    "optional": ["@ignifx/devtools"],
    "capabilities": ["components", "systems", "services", "settings"],
    "skill": "./skills/physics/SKILL.md",
    "assets": { "public": ["./wasm/HavokPhysics.wasm"] }
  }
}
```

- `engine`/`requires`/`optional` mirror the runtime `Extension` fields; the CLI validates that the two agree.
- `assets.public` lists files the Vite plugin must copy into the app's public directory (WASM binaries, default fonts).
- `skill` points at the extension's Agent Skill; the umbrella skill links to it and the docs harness type-checks its examples.
- First-party packages ship one version line; third-party extensions pin `@ignifx/core` with a caret range and set `engine` accordingly.

## 5. Project settings

Games configure engine and extension settings in `ignifx.config.ts`:

```ts
import { defineConfig } from "ignifx/config";
export default defineConfig({
  layers: ["Default", "Ground", "Player", "Enemy", "Projectile"],
  sortingLayers: ["Background", "Default", "Foreground", "UI"],
  time: { fixedDeltaTime: 1 / 60, maximumDeltaTime: 0.1 },
  physics: {
    gravity: [0, -9.81, 0],
    collisionMatrix: { Player: ["Ground", "Enemy"], Projectile: ["Enemy", "Ground"] },
  },
  input: { actions: "./input/default.input.json" },
  assets: { root: "./assets", preload: ["boot"] },
});
```

- The Vite plugin resolves the config at build time and injects it as `import.meta.env.IGNIFX_CONFIG`; `createApp` also accepts `settings` directly (tests, Electron main-process tooling).
- Each section is validated against the schema the owning extension registered. Unknown sections are an error in development (`IGX-0407`).

## 6. Third-party extension guidelines

- Name published packages `ignifx-extension-<name>` or use your own scope; add the `ignifx-extension` keyword.
- Use `defineExtension`; expose a factory that accepts an options object; never export mutable singletons.
- Import Babylon Lite only under `src/lite/`; expose Lite objects only through documented `.lite` escape hatches.
- Ship: ESM + types, `sideEffects: false`, a `skills/<name>/SKILL.md` with runnable examples, an `examples/` folder, and a changelog.
- Declare `engine` conservatively (`>=x.y.0 <x.(y+1).0` before 1.0, `^N` after).
- Test against the headless app (`createApp({ headless: true })`) so CI needs no GPU.

## 7. The core extension

`@ignifx/core` registers itself through the same contract as everything else (`coreExtension`): `Transform`, `Camera`, `Light`, `MeshRenderer`, `Model`, `Environment`, `Material` assets, the scene/asset/time/scheduler services, the core asset loaders (texture, model, scene, material, json, text, binary, environment, font), and the core settings sections (`layers`, `sortingLayers`, `time`, `assets`, `rendering`). This keeps one code path and one set of guarantees.
