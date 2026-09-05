# hello-cube

The smallest complete ignifx app: a camera, a shadow-casting directional light, a ground plane, and
a spinning PBR cube, every asset created in code. Start here.

```sh
pnpm --filter ignifx-example-hello-cube dev     # http://localhost:5173
pnpm --filter ignifx-example-hello-cube build
```

WebGPU only. A browser without it gets the fallback panel in `index.html`: `createApp` rejects with
`IGX-0701`, and `src/main.ts` catches exactly that code.

`ignifx.config.ts` holds the project settings, which `@ignifx/vite-plugin` injects as
`import.meta.env.IGNIFX_CONFIG`. `features.shadows` belongs there rather than in code: the flag is
read once, when `app.start()` registers the scene with Babylon Lite, and asking for it afterwards
throws `IGX-0704`.

## Query flags

`?static=1` stops time and pins the cube's angle; `?ortho=1` switches the camera to an orthographic
projection. Both exist for the visual golden suite in `tests/visual/`.

## Known engine defect (2026-09-06)

**The shadow is missing and the cube is lit from the wrong side.** A shadow-casting `Light` writes
its entity's _world-space_ forward onto a Lite light that is _parented_ under that same entity, and
Lite composes the parent's rotation over it again (`lib/light/directional-light.js`), so the shading
direction is rotated twice. The code here is what a game should write; the picture is wrong until
`packages/core/src/render/light.ts` is fixed. See `tests/visual/README.md`.
