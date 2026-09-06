# Visual golden tests

Playwright screenshots of the Phase 2 and Phase 6 exit-criterion scenes, compared against committed
goldens with a per-scene tolerance (coding standards §10).

```sh
pnpm test:visual                                              # from the repository root
pnpm --filter ignifx-visual-tests run test:visual:update      # regenerate the goldens
```

`playwright.config.ts` builds and previews four apps before the first test, so a golden is always
taken of a production build:

| Scene file          | App                         | Port   | Viewport  |
| ------------------- | --------------------------- | ------ | --------- |
| `scenes.spec.ts`    | `examples/hello-cube`       | `4173` | 512 x 512 |
| `scenes.spec.ts`    | `examples/gltf-viewer`      | `4174` | 512 x 512 |
| `templates.spec.ts` | `templates/2d-topdown`      | `4175` | 512 x 288 |
| `templates.spec.ts` | `templates/2d-sidescroller` | `4176` | 512 x 288 |

The 2D templates use 16:9 because both are authored against a 320 x 180 reference resolution, and
the side-scroller's pixel-perfect camera derives its whole-number zoom from `viewportHeight / 180`:
at 288 pixels that is a zoom of 1, so one source texel is exactly one screen pixel.

**`reuseExistingServer` is on outside CI**, which means a `vite preview` left running from an
earlier invocation is reused and _no rebuild happens_. When a golden looks stale, it is: stop the
previews (they listen on 4173-4176) before regenerating. And `--update-snapshots` alone only
rewrites a golden whose comparison **failed** — pass `--update-snapshots=all` to rewrite one whose
change is inside the tolerance.

## How a frame is made deterministic

Every scene is opened with `?static=1`, which sets `time.timeScale = 0` and pins the animated
transforms, and each app resolves `window.__ignifxReady` only after it has presented a settled
frame. Nothing here sleeps on wall-clock time.

The templates go one step further and stop the clock **before** `app.start()`, so not one fixed step
ever runs: no body falls, no clip advances, and the camera never chases its target. The frame is the
authored scene rather than the scene a few hundred milliseconds after it loaded.

Chromium runs as the full browser (`channel: "chromium"`), not `chrome-headless-shell`, which has no
compositor and loses the WebGPU device after two or three presented frames — the same finding that
pins `vitest.config.ts`. `--use-webgpu-adapter=swiftshader` keeps the image off the host GPU.

## One golden per scene, not one per platform

`snapshotPathTemplate` drops Playwright's default `{platform}` segment, so macOS and Linux CI compare
against the same image and `maxDiffPixelRatio` has to absorb the difference between two SwiftShader
builds. The trade-off is a looser tolerance in exchange for a golden that cannot rot on the platform
nobody runs locally. The committed images were generated on macOS arm64 with Playwright 1.63.

Goldens are regenerated **only** by a pull request that shows before and after images.

## Four engine defects these goldens found (2026-09-06)

All four were found while generating goldens, and all four have been fixed in `@ignifx/core`. The
write-ups live in `docs/adr/0002-adapter-boundary.md`, "Corrections after the visual suite" and the
section that follows it; the short version is here because this suite is what caught them.

### A post-process chain presented a black frame

`PostProcessStack` recorded a first task whose `sourceTexture` was the surface's swapchain target.
Babylon Lite configures the canvas context with no `usage` field (`lib/engine/surface.js` line 30),
so the swapchain texture has `RENDER_ATTACHMENT` only; binding it as a sampled texture is rejected,
and Chromium then rejected the whole frame's command buffer:

```
[TextureView of Texture (unlabeled 512x512 px, TextureFormat::BGRA8Unorm)] usage
(TextureUsage::RenderAttachment) doesn't include TextureUsage::TextureBinding.
 - While validating [BindGroupDescriptor "ignifx:bloom-extract-highlights-bind-group"]
```

**The fix.** Post-processing is now a declared rendering feature,
`rendering.features.postProcessing`. With it on, the scene is rendered into an offscreen colour
target and a copy task composites that onto the swapchain; a chain reads the offscreen target and
its last effect writes the swapchain, at which point the copy is switched off. The old browser suite
was green throughout because it asserted only that the image _changed_, and going black is a change;
it now asserts brightness.

### A shadow-casting light shaded from the wrong direction

`Light` created its Lite light with local direction `[0, 0, 1]`, parented it under the entity's node,
and — when the light cast shadows — also wrote the entity's **world-space** forward into
`light.direction` so the shadow frustum was aimed. Lite builds a directional light's world matrix as
`parentWorld × localMatrixFromDirection(light.direction)` and writes that matrix's third column into
the lights uniform buffer (`lib/light/directional-light.js` lines 8-10 and 20-22), so the parent
rotation was applied twice.

**The fix.** ignifx no longer parents a Lite light. The adapter creates every light with
`parent = null` and the component writes the entity's world pose — forward for a directional or spot
light, up for a hemispheric light's sky direction, position for anything that has one — onto the
light's own observables each frame the entity moves. Shading, the lights uniform buffer, and the
shadow frustum then all read the same pose.

### A `Model` cast no shadow

`Model` declared `castShadows` and `receiveShadows` and applied neither. The render-sync system's
caster rebuild walked only the world's `MeshRenderer`s — `collectCasters` existed on that component
and on no other — so a glTF model was never in any generator's caster list. The glTF viewer's floor
was `receiveShadows: true` with nothing to catch, which is why the first `gltf-viewer.png` showed no
shadow while `hello-cube.png` — whose cube is a `MeshRenderer` — showed a clear one.

**The fix.** A `Model`'s instantiated subtree is walked once, at instantiation, and every mesh in it
now contributes to the caster lists and takes the component's `receiveShadows`. `gltf-viewer.png`
and `gltf-viewer-post.png` were regenerated afterwards and the Box's shadow is on the floor in both.

### `rendering.clearColor` was ignored

The `rendering` settings section declared `clearColor` and nothing ever read it, so a project that
named one and left `Camera.clearColor` at `null` with no `Environment` got Babylon Lite's mid grey.
It is now applied to the render scene as the scene is created, under a documented precedence:
`Camera.clearColor` on the main camera beats `Environment.clearColor`, which beats the setting, which
beats Lite's default (`docs/architecture/07-rendering.md` §2.1).

## Files

| Path                          | What it is                                |
| ----------------------------- | ----------------------------------------- |
| `playwright.config.ts`        | Browser, flags, viewport, preview servers |
| `tests/scenes.spec.ts`        | The four scenes and their tolerances      |
| `tests/__screenshots__/*.png` | The goldens                               |
