# ADR-0017 · How the Recast navigation WebAssembly is loaded

**Status:** Accepted · **Date:** 2026-09-06 · **Revisit:** Phase 12 (the bundle-size pass), and on every `@babylonjs/lite` bump

## Context

`@ignifx/3d`'s navigation (`docs/architecture/12-3d-toolkit.md` §5) is Recast, reached through Babylon Lite's `createNavigationPluginAsync` (`index.d.ts` 2736). Recast is a WebAssembly module, and Phase 4 had already taught the project that a WebAssembly dependency is a _deployment_ decision as much as a runtime one: `@babylonjs/havok` cannot `fetch` a `file:` URL, so `@ignifx/physics` copies `HavokPhysics.wasm` through the Vite plugin's `ignifx.assets.public` and resolves it through the asset manifest (`09-physics.md` §7, spike S4.1).

Spike S7.2 asked whether navigation needs the same machinery, whether it can run at all in a plain Node process (which is what a headless test and a server-side simulation are), and what a game pays for it in a production bundle.

## Decision

**Navigation loads the copy Babylon Lite inlines. ignifx adds no public-asset entry, no manifest address, and no build step.**

`threeD({ navigationWasmUrl })` — and the `threeD.navigationWasmUrl` settings key behind it — is the escape hatch: when it is set, ignifx passes a `locateFile` to `createNavigationPluginAsync` and Recast fetches the `.wasm` from that URL instead. It defaults to the empty string, which means "use the inlined copy".

Loading is **lazy**: `NavigationService` does not touch Recast until the first `NavMeshSurface` asks for a plugin, so a game with no navigation never downloads the chunk.

## Rationale, measured against `@babylonjs/lite@1.27.0` on 2026-09-06

**The WebAssembly is inlined as a `data:` URL.** `lib/_chunks/vendor/recast-navigation-Ddkygka3.js` contains exactly one `data:application/wasm;base64,` literal. `lib/navigation/navigation.js` 7-29 dynamically imports that chunk and calls `core.init()` with no arguments unless a `locateFile` was supplied — and `core.init()` with no arguments is what reaches the inlined binary. There is nothing to copy and nothing to serve.

**It therefore runs headlessly in Node with no configuration at all.** Node's `fetch` accepts `data:` URLs, so a plain `node` process loads the module and builds a navmesh:

```
plugin created in 33 ms
navmesh built
path points: 5   max |z| on path: 7.20   (a straight line would be 0)
agent reached its destination in 326 fixed steps
```

That is the whole basis for `@ignifx/3d`'s navigation suite running in the **node** Vitest project rather than the browser one: seventeen cases, including "a path routes around a wall", "an agent arrives and `onArrived` fires once", and "two runs of one seed produce identical positions", all in CI without a GPU.

**What it costs, in a real Vite 8 production build.** A fixture app whose only import is `createNavigationPluginAsync` + `createNavMeshFromSources` + `createNavCrowd`:

| Chunk                                                   |                            Raw |                gzip |              brotli |
| ------------------------------------------------------- | -----------------------------: | ------------------: | ------------------: |
| `recast-navigation-*.js` (Recast + the inlined `.wasm`) |         1,517,011 B (1.45 MiB) | 451,841 B (441 KiB) | 194,144 B (190 KiB) |
| Everything else the app pulled in                       | ~76 KB across 150 small chunks |              ~40 KB |              ~34 KB |

The chunk stays a **separate, dynamically imported** chunk — Lite's own `import()` is a code-split point that Rolldown preserves — so the cost is paid on the first `NavMeshSurface`, not on first paint. Base64 inflates the binary by a third before compression, but gzip and brotli recover most of it: the brotli figure is within a few per cent of what the raw `.wasm` would compress to.

## Consequences

- **Zero configuration is the default, and that is the point.** A game that adds `threeD()` and a `NavMeshSurface` works in `pnpm dev`, in a production build, in an Electron app, and in a Node test, with nothing copied anywhere. Navigation is the _only_ WebAssembly dependency in the engine that behaves this way; physics does not, and the asymmetry is deliberate rather than an oversight.
- **190 KB brotli is real, and it is deferred.** A game that never bakes a navmesh never fetches it.
- **Phase 12 follow-up.** If the bundle-size pass decides the base64 inflation is worth removing, the mechanism already exists: teach `@ignifx/vite-plugin` to copy `recast-navigation.wasm` into `ignifx.assets.public` the way it copies Havok's, and set `threeD({ navigationWasmUrl: app.assets.resolveUrl("recast-navigation.wasm") })`. That trades roughly 190 KB brotli for roughly 165 KB of raw `.wasm` plus one more request, and costs the "no configuration" property above. It is not obviously a win, which is why it is a follow-up and not this ADR.

## What Babylon Lite 1.27.0 does **not** offer

Two absences found while writing the surface, both recorded here because they change what `12-3d-toolkit.md` §5 can promise:

- **There is no navmesh serialization.** `index.d.ts` declares no `getNavMeshData`, no `buildFromNavMeshData`, and nothing else that turns a baked navmesh into bytes or back. The `.navmesh.bin` asset and the `ignifx bake navmesh` CLI command of §5 are therefore **not implementable** against this version. `NavMeshSurface.prebaked` exists as a field so a project can record its intent, but naming one logs a warning and the surface bakes at runtime instead. `@ignifx/cli`'s `bake navmesh` stays a stub.
- **There is no `removeAgent`.** `addAgent` (`index.d.ts` 15) hands out an index for the crowd's lifetime. A destroyed `NavMeshAgent` parks its agent rather than freeing the slot, so `NavMeshSurface.maxAgents` counts every agent that has ever joined; a level that spawns and kills agents indefinitely re-bakes its surface, which builds a fresh crowd.

Both are worth re-checking on the next Lite bump.
