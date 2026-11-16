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

`OrbitCamera` listens to pointer events on the canvas itself, so the example needs no
`@ignifx/input`.

## Query flags

`?static=1` stops time, for the visual golden suite. `?post=1` turns the post-process chain on.
`?hdr=1` turns the HDR path on.
