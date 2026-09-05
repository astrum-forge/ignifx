# gltf-viewer

Loads a `.glb` through `app.assets`, lights it with an image-based environment probe, and lets you
orbit it with the mouse.

```sh
pnpm --filter ignifx-example-gltf-viewer dev     # http://localhost:5173
pnpm --filter ignifx-example-gltf-viewer build
```

The fixtures — `Box.glb`, `studio.env`, `brdf-lut.png` — are the repository's shared samples
(`tests/fixtures/assets/`, with its `ATTRIBUTION.md`). `vite.config.ts` points the plugin's
`assetRoot` at that directory instead of copying the binaries; `src/main.ts` hands the generated
manifest to `createApp` through `assets: { manifest }`. An asset handle settles at a frame's
delivery point, so `app.start()` comes **before** the first `loadAsync`, not after it.

`@ignifx/input` arrives in Phase 3; until then `OrbitCamera` listens to pointer events on the canvas
itself. That is the only part of this example a later phase will replace.

## Query flags

`?static=1` stops time, for the visual golden suite. `?post=1` turns the post-process chain on.

## Known engine defects (2026-09-06)

- **The post-process chain presents a black frame**, which is why it is off by default: its first
  task samples the swapchain texture, and a WebGPU canvas context is configured without
  `TEXTURE_BINDING` usage (`lib/engine/surface.js`), so the frame's command buffer is rejected.
- **Shadows do not appear** — see `examples/hello-cube/README.md`.
