# 15 · Devtools and Diagnostics

**Status:** Design standard (pre-1.0) · **Packages:** `@ignifx/core` (`app.diagnostics`, errors, logging), `@ignifx/devtools`, `@ignifx/vite-plugin` (HMR)

---

## 1. Errors

- `IgnifxError extends Error` with `code: "IGX-####"`, `context` (entity/component/asset identifiers), and `hint`. Development builds format the full message; production builds keep the code and context. Ranges: `01xx` lifecycle, `02xx` components, `03xx` scenes, `04xx` extensions, `05xx` assets, `06xx` serialization, `07xx` rendering, `08xx` input, `09xx` physics, `10xx` audio, `11xx` 2D, `12xx` 3D, `13xx` UI, `14xx` platform, `15xx` devtools, `9xxx` reserved for third parties.
- `app.onError: Signal<ErrorReport>` receives every error thrown from a lifecycle callback, coroutine, system, or asset loader, with the source identified; the default handler logs and, in development, shows an overlay. Babylon Lite coded errors are decoded (`enableErrorDecoding` in dev; lazy `decodeError` in prod).

## 2. Logging

`app.log` (and `ctx.log` per extension) with levels `debug/info/warn/error`, scoped prefixes, rate limiting for per-frame warnings ("warned once" helper), and a pluggable sink (console by default; devtools console panel; file sink in Electron).

## 3. Diagnostics (`app.diagnostics`)

A frame-sampled, allocation-free set of counters grouped by subsystem (`frame`, `render`, `physics`, `assets`, `input`, `audio`, `twoD`, `animation`) plus per-phase CPU timings in development. Consumers read the latest sample; a ring buffer of the last 300 frames supports graphs.

## 4. Devtools overlay (`@ignifx/devtools`)

Toggled with a configurable key (default backtick) or `app.devtools.open()`; DOM-based, mounted in its own `app.ui` layer, zero cost when closed.

Panels: **Stats** (FPS, frame/CPU/GPU ms, draw calls, fixed steps, entities, components, assets, memory), **Scene tree** (search, select, toggle active, destroy), **Inspector** (schema-driven editing of any component's fields live; copy component/entity as JSON; "select in world" via GPU pick), **Assets** (handles, refcounts, sizes, force reload), **Input** (live action values, devices, scheme), **Audio** (buses, instances), **Physics** (Lite physics viewer toggle, counts), **Console** (log sink), **Timeline** (phase timings graph).

## 5. Script hot reload

- The Vite plugin generates the game's script registry (`scripts/index.ts` barrel) and accepts HMR updates for script modules. On update, for each changed class (matched by `typeId`):
  - default policy `"patch"`: live instances get their prototype swapped to the new class; state is preserved; no lifecycle callbacks re-run; static fields are re-read. Good for iterating on logic.
  - policy `"recreate"` (`static hotReload = "recreate"`): each live instance is serialized through its schema, destroyed (`onDisable`/`onDestroy`), and re-created with the same uid and props (`awake`/`onEnable`/`start` run again). Required when field layouts change.
  - `static onHotReload?(previous)` lets a class migrate transient state (PlayCanvas `swap` lesson).
- Asset hot reload is handled by the assets service (`05-assets-and-loading.md` §7); scene files reload by re-instantiating the affected `SceneInstance` when `devtools.reloadScenes` is enabled.

## 6. Performance tooling

- `app.diagnostics.profile(name)` scopes in development add `performance.mark/measure` entries visible in browser profilers.
- Benchmark scenes under `benchmarks/` run with Vitest `bench` (headless simulation) and a Playwright GPU job (frame time, draw calls) whose results are compared against committed baselines (`CONSTITUTION.md` §6.4).
