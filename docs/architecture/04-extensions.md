# 04 · Extensions

**Status:** Design standard; describes the engine as built (pre-1.0) · **Package:** `@ignifx/core` · **Related:** `03-scripting-and-components.md` §6–7, `05-assets-and-loading.md`, `CONSTITUTION.md` Article VIII

An extension is the unit of optional functionality. Input, physics, audio, the 2D and 3D toolkits, UI, Electron support, and devtools are all extensions; a game's own code can be one too. The design borrows Bevy's `Plugin::build(app)` (one registration entry point), Godot's add-on manifest (`plugin.cfg` → `package.json#ignifx`), and Unity's package layout (`Runtime/`, `Samples~/`, `Documentation~/` → `src/`, `examples/`, `skills/`).

**Source map**

- `packages/core/src/extension/host.ts`: Sorting, validation, the engine-range check, `register`/`onStart`/`onStop`/`dispose` order (§2).
- `packages/core/src/extension/extension-context.ts`, `define-extension.ts`, `service-registry.ts`: `ExtensionContext`, `defineExtension`, services (§1).
- `packages/core/src/extension/core-extension.ts`: What core registers through the same contract (§7).
- `packages/core/src/settings/`: The settings store, validation in the settings form, `describeSettings`, `settingsJsonSchema` (§5).
- `packages/vite-plugin/src/ignifx-config.ts`, `extension-assets.ts`: `ignifx.config.ts` and `ignifx.settings.json` to `import.meta.env.IGNIFX_CONFIG`; `ignifx.assets.public` (§4, §5).
- `packages/physics/src/extension.ts`: The extension §1 abridges.
- `packages/<name>/package.json` → `ignifx`: The manifest of §4.

Invariants:

- Nothing runs at module import; an extension acts only inside `register` and `onStart` (§2).
- `register` runs in dependency order, `onStop` and `dispose` in reverse; core is always first and never named in `requires` (§2).
- An extension object belongs to one app at a time (§2).
- Settings are validated against the registering extension's schema and frozen before the engine exists; vectors are `{ x, y, z }` and colours `{ r, g, b, a }` there (§5).
- An extension cannot add a phase, register a Lite frame callback or replace a core service (§3).

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

  registerComponent(type: ConcreteComponentType, options?: { typeId?: string }): void; // constructible classes only
  registerComponents(types: readonly ConcreteComponentType[]): void;
  registerSystem(system: System, options: { phase: Phase; order?: number; editMode?: "run" | "hold" | "skip" }): void; // 03 §6
  registerService<T>(key: ServiceKey<T>, instance: T): void;
  defineAppProperty(name: string, getter: () => unknown): void; // pairs with module augmentation of App
  registerAssetType(type: AssetTypeDefinition): void;
  registerAssetLoader(loader: AssetLoader): void;
  registerSettings<S>(section: string, schema: Schema, defaults: S): void; // project settings section
  requireRenderingFeature(feature: RenderingFeature): void; // 07 §1.1
  registerErrorCodes(codes: Record<string, string>): void; // IGX-#### → message template
  onDispose(callback: () => void): void;

  // Physics callbacks (@beta, for extension authors; see 09-physics.md §1, §2.1, §4).
  dispatchScriptCallback(entity: Entity, kind: PhysicsCallbackName, argument: unknown): void; // routed through the scheduler's guarded call site
  entityImplements(entity: Entity, kind: PhysicsCallbackName): boolean; // ignores `enabled`; drives Rigidbody.collisionEvents auto-detection
  setSimulationScene(scene: LiteScene | null): void; // publishes world.lite.simulationScene; throws IGX-0410 on a second, different scene

  require<T>(key: ServiceKey<T>): T; // service registered by an earlier extension; throws IGX-0405 if absent
  tryGet<T>(key: ServiceKey<T>): T | null; // `null` for absence (coding standards §5.5)
  settings<S>(section: string): S; // resolved project settings for a registered section
}

type PhysicsCallbackName =
  "onCollisionEnter" | "onCollisionStay" | "onCollisionExit" | "onTriggerEnter" | "onTriggerExit";

function defineExtension<O = void>(factory: (options: O | undefined) => Extension): (options?: O) => Extension;
```

Usage, abridged from `packages/physics/src/extension.ts`:

```ts
export const physics = defineExtension<PhysicsOptions>((options = {}) => {
  const host = new PhysicsHost();
  let context: ExtensionContext | null = null;
  let service: PhysicsService | null = null;
  return {
    name: "@ignifx/physics",
    version: "0.0.0",
    engine: ">=0.0.0 <1.0.0",
    requires: [], // core is implicit (§2)
    optional: ["@ignifx/devtools"],
    register(ctx) {
      context = ctx;
      ctx.registerErrorCodes(PHYSICS_ERROR_MESSAGES);
      ctx.registerSettings<PhysicsSettings>("physics", physicsSettingsSchema(), defaultPhysicsSettings());
      ctx.registerComponents(PHYSICS_COMPONENTS); // Rigidbody, the colliders, CharacterController, …
      ctx.registerAssetLoader(createPhysicsMaterialLoader());
      service = new PhysicsService(ctx.app, host, ctx.settings<PhysicsSettings>("physics"));
      ctx.registerService(PhysicsService, service);
      ctx.defineAppProperty("physics", () => service);
      ctx.registerSystem(new PhysicsRestoreSystem(host), { phase: Phase.FixedUpdate, order: -100, editMode: "skip" });
      ctx.registerSystem(new PhysicsStepSystem(host), { phase: Phase.FixedUpdate, order: 100, editMode: "skip" });
      // Update, not PreRender: 01-lifecycle-and-time.md §3.
      ctx.registerSystem(new PhysicsInterpolationSystem(host), { phase: Phase.Update, order: -900, editMode: "skip" });
    },
    async onStart(app) {
      // Loads Havok (`options.havok`, `options.wasmBinary`, or the URL in the settings), creates the
      // simulation scene and the world with `settings.gravity`, then publishes the scene:
      // context.setSimulationScene(simulation.scene);
    },
    dispose() {
      context?.setSimulationScene(null);
      service?.dispose();
    },
  };
});

// Game code. Gravity is a project setting (§5), not a factory option.
const app = await createApp({ canvas, extensions: [input(), physics(), audio(), threeD()] });
```

First-party extensions write `engine: ">=0.0.0 <1.0.0"` and their package's build-stamped `VERSION` (`src/version.ts`) as `version`; `physics` and `physics-2d` write the literal `"0.0.0"`. They ship on core's version line, and a core run from source reports `0.0.0`, so the range only has to admit every `0.x` core.

## 2. Registration order and validation

1. `createApp` builds the list: the implicit core extension first, then the user list.
2. Extensions are topologically sorted by `requires` (and `optional` edges when the optional extension is present). A `requires` cycle throws `IGX-0402`; a missing required extension throws `IGX-0403`; a duplicate name throws `IGX-0406`. An extension object belongs to one app at a time: handing it to a second app while the first is not disposed throws `IGX-0411`, because a factory may keep that app's state in its closure (`physics()` does). Call the factory once per app. `optional` edges that would form a cycle (two extensions optionally integrating with each other, as `physics` and `devtools` do) are dropped with a development note; the two then register in list order and must resolve each other lazily in `onStart` via `ctx.tryGet`.
3. `engine` ranges are checked against the core version: mismatch throws in development, warns in production (`IGX-0404`).
4. `register` runs in sorted order and may be `async` (for example to fetch a WASM binary), but heavy work should go in `onStart` so that registration stays fast and side-effect free.
5. After all `register` calls, the Lite engine and render scene are created (or the null engine in headless mode), the world is created, and settings are frozen. `onStart` hooks then run in order during the first `app.start()`; a start after `app.stop()` does not run them again. `onStart` runs before the frame loop starts, so awaiting an asset handle there deadlocks (assets are delivered in a stepped frame's `PreUpdate`): start the load in `onStart` and install the value at delivery.
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
| Physics callbacks       | `dispatchScriptCallback`, `entityImplements`, `setSimulationScene`        | routed through the scheduler; `09-physics.md` §4                       |

An extension **cannot**: register frame callbacks with Babylon Lite directly, add phases, replace core services, or reach into another extension's internals. Cross-extension integration goes through services (`ctx.require`) and signals.

## 4. Package manifest

Published extensions declare an `ignifx` block in `package.json`:

```json
{
  "name": "@ignifx/physics",
  "type": "module",
  "sideEffects": false,
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "peerDependencies": { "@ignifx/core": "workspace:*", "@babylonjs/havok": "catalog:", "@babylonjs/lite": "catalog:" },
  "keywords": ["ignifx", "ignifx-extension"],
  "ignifx": {
    "extension": true,
    "engine": ">=0.0.0 <1.0.0",
    "requires": [],
    "optional": ["@ignifx/devtools"],
    "capabilities": [],
    "skill": "./skills/physics/SKILL.md",
    "assets": { "public": ["node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm"] }
  }
}
```

- `engine`/`requires`/`optional` mirror the runtime `Extension` fields. No tool checks that the two agree; keep them equal by hand.
- `assets.public` lists files the Vite plugin copies, unhashed, next to the app's assets (WASM binaries, decoders); paths are relative to the package.
- `skill` points at the extension's Agent Skill; the docs harness finds the skill through this entry and type-checks its examples (`scripts/lib/skill-files.ts`).
- First-party packages ship one version line; third-party extensions pin `@ignifx/core` with a caret range and set `engine` accordingly.

## 5. Project settings

Games configure engine and extension settings in `ignifx.config.ts`:

```ts
import { defineConfig } from "@ignifx/vite-plugin";
export default defineConfig({
  layers: ["Default", "Ground", "Player", "Enemy", "Projectile"],
  sortingLayers: ["Background", "Default", "Foreground", "UI"],
  time: { fixedDeltaTime: 1 / 60, maximumDeltaTime: 0.1 },
  physics: {
    gravity: { x: 0, y: -9.81, z: 0 },
    collisionMatrix: { Player: ["Ground", "Enemy"], Projectile: ["Enemy", "Ground"] },
  },
  input: { actions: "input/default.input.json" },
  assets: { root: "assets", preload: ["boot"] },
});
```

- The Vite plugin resolves the config at build time and injects it as `import.meta.env.IGNIFX_CONFIG`; `createApp` also accepts `settings` directly (tests, Electron main-process tooling).
- Each top-level key is a section, an object validated against the schema the owning extension registered. A section whose schema declares exactly one field of a non-object kind may be written as that field's value: `layers: [...]` is short for `layers: { layers: [...] }`. Unknown sections are an error in development (`IGX-0407`); a bad value or key is `IGX-0408`.

**Settings as data.** The same object may live in `ignifx.settings.json` at the Vite root, which is the form a tool writes (the ignifx editor's Settings panel). The plugin reads both files and merges them a section at a time: **`ignifx.config.ts` wins a section both define, whole**, nothing of the JSON section is merged into it, and the plugin warns when the two differ. A project that keeps its settings as data needs no config file; one that wants both spreads the JSON in code (`defineConfig({ ...settings, time: { … } })`). Editing either file restarts the dev server, because the settings are a `define` that only the plugin's `config` hook computes.

**Describing the sections.** `ctx.registerSettings(section, schema, defaults)` is the only registration seam: `describeSettings(app)` returns every registered section, core's and each extension's, as a `SchemaDescription` (`format: "settings"`, `package` = the registering extension, field `default` = the registered default, absent when the owner's defaults leave the field out), the shape `describeRegisteredSchemas` gives components, so a settings panel is generated the way the inspector is. Both are in the **settings form** `createApp` validates, which is not the scene file's: a vector is `{ x, y, z }` and a colour `{ r, g, b, a }`, so a value written from a description loads. `settingsJsonSchema(app)` is the JSON Schema of the whole settings object; passed to the plugin as `schemas.settings`, it validates the merged settings at dev-server start and build time (`IGX-0554` with the key's JSON pointer); a section the schema does not list is only a warning there, since `createApp` reports it as `IGX-0407`. The plugin cannot compute it itself: it does not depend on core (`00-overview.md` §2), and only a constructed app knows which extensions registered which sections.

## 6. Third-party extension guidelines

- Name published packages `ignifx-extension-<name>` or use your own scope; add the `ignifx-extension` keyword.
- Use `defineExtension`; expose a factory that accepts an options object; never export mutable singletons.
- Import Babylon Lite only under `src/lite/`; expose Lite objects only through documented `.lite` escape hatches.
- Ship: ESM + types, `sideEffects: false`, a `skills/<name>/SKILL.md` with runnable examples, an `examples/` folder, and a changelog.
- Declare `engine` conservatively (`>=x.y.0 <x.(y+1).0` before 1.0, `^N` after).
- Test against the headless app (`createApp({ headless: true })`) so CI needs no GPU.

## 7. The core extension

`@ignifx/core` registers itself through the same contract as everything else (`packages/core/src/extension/core-extension.ts`):

- **Components:** `Transform`, `Camera`, `Light`, `MeshRenderer`, `InstancedMeshRenderer`, `Model`, `Environment`, `PostProcessStack`, `ReflectionProbe`, `LightProbeVolume`.
- **Asset loaders:** the generic ones (json, text, binary) and scene, texture, model, material, environment, font, shader, mesh, light probes, lightmap; the storage-buffer type is registered for code-built buffers and has no file format (`05-assets-and-loading.md` §5).
- **Settings sections:** `layers`, `sortingLayers`, `time`, `assets`, `rendering`.
- **Systems and services:** the renderer service, asset delivery in `PreUpdate`, tweens in `PostUpdate`, the shader-uniform and render-sync systems in `PreRender`.

This keeps one code path and one set of guarantees.
