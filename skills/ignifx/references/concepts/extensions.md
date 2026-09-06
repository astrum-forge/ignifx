# Extensions

An extension is the unit of optional functionality: it registers components, systems, services,
settings, and error codes with one app. Core features are extensions too. Rationale in
`docs/architecture/04-extensions.md`.

## 1. The contract

```ts run
import { Phase, defineExtension } from "@ignifx/core";
import type { App, Extension, ExtensionContext, System, SystemContext } from "@ignifx/core";

class WeatherService {
  windSpeed = 0;
}

/** Extensions add their service to `App` by declaration merging. */
declare module "@ignifx/core" {
  interface App {
    readonly weather: WeatherService;
  }
}

const weatherSystem: System = {
  name: "game/weather.apply",
  update(ctx: SystemContext): void {
    ctx.world.app.weather.windSpeed = Math.sin(ctx.time.time);
  },
};

export const weather: (options?: void) => Extension = defineExtension<void>(() => {
  const service = new WeatherService();
  return {
    name: "game/weather",
    version: "1.0.0",
    engine: ">=0.1.0 <1.0.0",
    requires: ["@ignifx/core"],
    register(ctx: ExtensionContext): void {
      ctx.registerService(WeatherService, service);
      ctx.defineAppProperty("weather", () => service);
      ctx.registerSystem(weatherSystem, { phase: Phase.Update, order: 1001 });
      ctx.onDispose(() => {
        service.windSpeed = 0;
      });
    },
    onStart(app: App): void {
      app.log.info("weather ready");
    },
  };
});
```

| Member                         | Required | Meaning                                                                         |
| ------------------------------ | -------- | ------------------------------------------------------------------------------- |
| `name`                         | yes      | Unique; the npm package name, or `game/<name>` for an in-game extension         |
| `version`                      | yes      | Semver of the extension itself                                                  |
| `engine`                       | no       | Semver range of `@ignifx/core` it supports; checked at registration             |
| `requires` / `optional`        | no       | Extension names that must / may register before it                              |
| `register(ctx)`                | yes      | Declare everything here; may be `async`, but keep it cheap and side-effect free |
| `onStart(app)`                 | no       | After every `register`, during `app.start()`; may be `async`                    |
| `onStop(app)` / `dispose(app)` | no       | Run in reverse registration order                                               |

`defineExtension(factory)` wraps a factory so a game writes `weather()` in the `extensions` array.
Nothing runs at module import time (`CONSTITUTION.md` §3.5).

## 2. `ExtensionContext`

| Member                                                              | Purpose                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `app`, `log`                                                        | The app being built and a logger scoped to the extension                     |
| `registerComponent(type, { typeId? })`, `registerComponents(types)` | Make component classes known to the registry                                 |
| `registerSystem(system, { phase, order? })`                         | `Phase.EndOfFrame`…`Phase.PreRender`; ascending `order` within a phase       |
| `registerService(key, instance)`                                    | Key is a class or a `createServiceKey<T>(name)` token                        |
| `defineAppProperty(name, getter)`                                   | Pairs with the `declare module` block; a second definition throws `IGX-0401` |
| `registerSettings(section, schema, defaults)`                       | Declares one project-settings section                                        |
| `settings<S>(section)`                                              | The resolved section, readable inside the same `register` call               |
| `require(key)` / `tryGet(key)`                                      | A service an earlier extension registered; `require` throws `IGX-0405`       |
| `registerAssetType({ type, extensions })`                           | Claims an asset type name and the extensions that imply it                   |
| `registerAssetLoader(loader)`                                       | The `AssetLoader` for that type; a second one is `IGX-0506`                  |
| `requireRenderingFeature(feature)`                                  | Declares a Babylon Lite opt-in the extension needs; too late is `IGX-0704`   |
| `registerErrorCodes(codes)`                                         | `IGX-####` → message template, in the extension's own range                  |
| `onDispose(callback)`                                               | Teardown hook run with the app                                               |

`requireRenderingFeature` works because registration happens **before** `app.start()` applies the
opt-ins and registers the render scene; the same call afterwards throws `IGX-0704`. The features are
`shadows`, `skeletons`, `boneControl`, `stencil`, `lightmaps`, `materialPlugins`, `asyncPipelines`,
and `deviceLostRecovery` ([`rendering.md`](rendering.md) §4).

An extension may not register a Babylon Lite frame callback, add a phase, or replace a core
service; cross-extension work goes through services and signals.

## 3. Registration order and its errors

1. `createApp` puts the implicit core extension (`coreExtension`, name `@ignifx/core`) first, then the list from `createApp({ extensions })`.
2. The list is topologically sorted by `requires`, plus `optional` edges when the optional extension is present. A `requires` cycle throws `IGX-0402`, a missing required extension `IGX-0403`, and a duplicate `name` `IGX-0406`. An `optional` edge that would close a cycle is dropped with a development note; those two extensions then resolve each other lazily in `onStart` through `ctx.tryGet`.
3. `engine` ranges are checked against `VERSION`: a mismatch throws `IGX-0404` in development and warns in production.
4. Settings are resolved and frozen, then `register` runs in sorted order.
5. The Lite engine and world are created; `app.start()` runs the `onStart` hooks in the same order.
6. `onStop` and `dispose` run in reverse order.

## 4. Settings sections

`createApp({ settings })` takes the object `ignifx.config.ts` supplies through
`import.meta.env.IGNIFX_CONFIG` (`@ignifx/vite-plugin`). The kernel registers five sections:

| Section         | Shape                                                                | Defaults                                                       |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `layers`        | `{ layers: string[] }`                                               | `["Default", "TransparentFX", "IgnoreRaycast", "Water", "UI"]` |
| `sortingLayers` | `{ sortingLayers: string[] }`                                        | `["Default"]`                                                  |
| `time`          | `{ fixedDeltaTime?, maximumDeltaTime?, timeScale? }`                 | `1/60`, `0.1`, `1`                                             |
| `assets`        | `{ root, preload, concurrency, gcDelay, retries }`                   | `"assets"`, `[]`, `6`, `5`, `2`                                |
| `rendering`     | `{ features, msaaSamples, alphaMode, srgb, clearColor, brdfLut, … }` | see [`rendering.md`](rendering.md) §4                          |

A section whose schema has exactly one field may be written as that field's value, so
`layers: ["Default", "Player"]` and `layers: { layers: ["Default", "Player"] }` are the same. A
partial section merges over its defaults. An unknown section throws `IGX-0407` in development (warns
in production), and a value that fails its schema throws `IGX-0408` (production falls back to the
defaults with a warning). Read a section back with `app.settings.section<S>(name)`, or the typed
`app.settings.layers` / `.sortingLayers` / `.time`.

```ts run
import { createApp } from "@ignifx/core";

const app = await createApp({
  headless: true,
  settings: { layers: ["Default", "Player", "Enemy"], time: { fixedDeltaTime: 1 / 120 } },
});
app.log.info("enemy layer", app.world.layers.requireIndex("Enemy"));
```

## 5. Typed service access

A published extension declares its member **required**, exactly as the block in §1 shows. Inside
this repository's own tests the augmented specifier is the barrel's relative path and the member is
declared optional, because an augmentation is program-wide and a required member would oblige every
hand-written `App` stand-in in the same compilation to provide it.

Game code that must work whether or not the extension is installed uses the untyped route instead:
`app.services.tryGet(WeatherService)` returns `null` when nothing registered it, while
`app.services.get(WeatherService)` throws `IGX-0405`.

## 6. What the core extension contributes

`coreExtension()` registers the five settings sections above; the components `Transform`, `Camera`,
`Light`, `MeshRenderer`, `Model`, `Environment`, and `PostProcessStack`; the `app.renderer` service;
the core asset loaders (texture, model, scene, material, environment, font, json, text, binary); the
`ignifx/asset-delivery` system in `PreUpdate` and the `ignifx/render-sync` system in `PreRender`; and
it starts the manifest groups listed in `assets.preload` during `app.start()`. Its error codes are
pre-loaded into the registry rather than registered, so registering `CORE_ERROR_MESSAGES` a second
time is `IGX-1501`.
