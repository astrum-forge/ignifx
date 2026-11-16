# Visual golden tests

Playwright screenshots of the two example apps and the four templates, compared against committed
goldens with a per-scene tolerance (coding standards §10).

```sh
pnpm test:visual                                              # from the repository root
pnpm test:frame-budget                                        # the template frame budgets
pnpm test:gpu-budget                                          # the 3D templates' GPU time, host GPU
pnpm --filter ignifx-visual-tests run test:visual:update      # regenerate the goldens
```

## Three projects, because they need different machines

`playwright.config.ts` splits this directory in three, and they are run separately.

| Project        | Files                                 | Command                  |
| -------------- | ------------------------------------- | ------------------------ |
| `goldens`      | `scenes.spec.ts`, `templates.spec.ts` | `pnpm test:visual`       |
| `frame-budget` | `frame-time.spec.ts`                  | `pnpm test:frame-budget` |
| `gpu-budget`   | `gpu-time.spec.ts`                    | `pnpm test:gpu-budget`   |

None runs in CI (ADR-0009). Each takes minutes; run them locally, and only when a
change can affect rendering or frame time (coding standards §12). `--grep <name>` runs one scene.

A golden is an image comparison, and SwiftShader makes it reproducible on any machine. A frame
budget is a **measurement** against ceilings recorded on one machine (`benchmarks/baselines.json`
records which), and a shared Linux runner is not that machine: enforcing a ceiling there measures
the runner, not the engine. So the budgets are only measured on a macOS arm64 machine like the one
that recorded them.

To re-record a budget: run `pnpm test:frame-budget`, take the `median` and `worst` the run prints
per template, and write them into the `frameTime.templates` rows in `baselines.json` with the
machine and the date.
`benchmarks/template-frame-time.test.ts` then holds those rows to the coding-standards §7 budget, in
`pnpm test` and the CI `test-unit` job.

`gpu-budget` is the one project without the SwiftShader flag: it measures the 3D templates' GPU
milliseconds per frame at 1920x1080 on the host GPU (an Apple M1 for the recorded rows) and fails if
the adapter is SwiftShader. GitHub's runners have no GPU, so it is local only. To re-record, copy
the `median` and `worst` it prints into the `gpuTime.templates` rows in `baselines.json`.

Each `rendering.quality` tier has its own rows under `gpuTime.tiers.<tier>.templates`, checked by
`IGNIFX_GPU_QUALITY=<tier> pnpm test:gpu-budget` (`low`, `medium`, `high`). To re-record them, run
the three tiers one after another while nothing else uses the GPU (`pgrep -fl 'playwright|vitest'`
shows no other Playwright or browser Vitest run, and no other preview holds ports 4173–4178, which
the config would reuse), copy each run's `median` and `worst`, and set the ceiling to about three
times the median, inside the tier's §7 whole-frame budget. `benchmarks/template-frame-time.test.ts`
checks every tier row against that budget.

All three tiers' rows are Apple M1 numbers, `high` included. The M1 is the `medium` tier's
reference device; `high`'s is an RTX 3060 / RX 6600 class desktop GPU, which has not been measured,
so the `high` rows only catch a regression on the recorded machine and say nothing about the
tier's budget on its own hardware. Re-record them there when one is available.

`playwright.config.ts` builds and previews **six** things before the first test, so a golden is
always taken of a production build:

| Scene file          | App                         | Port   | Viewport  | Tolerance |
| ------------------- | --------------------------- | ------ | --------- | --------- |
| `scenes.spec.ts`    | `examples/hello-cube`       | `4173` | 512 x 512 | 0.02      |
| `scenes.spec.ts`    | `examples/gltf-viewer`      | `4174` | 512 x 512 | 0.05      |
| `templates.spec.ts` | `templates/2d-topdown`      | `4175` | 512 x 288 | 0.02      |
| `templates.spec.ts` | `templates/2d-sidescroller` | `4176` | 512 x 288 | 0.02      |
| `templates.spec.ts` | `templates/3d-third-person` | `4177` | 512 x 288 | 0.05      |
| `templates.spec.ts` | `templates/3d-first-person` | `4178` | 512 x 288 | 0.05      |

The 2D templates use 16:9 because both are authored against a 320 x 180 reference resolution, and
the side-scroller's pixel-perfect camera derives its whole-number zoom from `viewportHeight / 180`:
at 288 pixels that is a zoom of 1, so one source texel is exactly one screen pixel. The two 3D
templates frame their `?static=1` camera for the same aspect, and get the looser tolerance
`gltf-viewer` uses: they are lit through a 4x MSAA target by a shadow-casting directional light,
their textures are mip-mapped and filtered across a floor that runs to the horizon, and the shadow
map is resolved with PCF — every one of those is a place where two SwiftShader builds may round a
subpixel differently, and one shadow edge moving by a texel across a 24-metre floor is already more
than 2% of the frame.

**`reuseExistingServer` is on outside CI**, which means a `vite preview` left running from an
earlier invocation is reused and _no rebuild happens_. When a golden looks stale, it is: stop the
previews (they listen on 4173-4178) before regenerating. And `--update-snapshots` alone only
rewrites a golden whose comparison **failed** — pass `--update-snapshots=all` to rewrite one whose
change is inside the tolerance.

## How a frame is made deterministic

Every scene is opened with `?static=1`, which sets `time.timeScale = 0` and pins the animated
transforms, and each app resolves `window.__ignifxReady` only after it has presented a settled
frame. Nothing here sleeps on wall-clock time.

The templates go one step further and stop the clock **before** `app.start()`, so not one fixed step
ever runs: no body falls, no clip advances, no navmesh bakes, and the camera never chases its
target. The frame is the authored scene rather than the scene a few hundred milliseconds after it
loaded.

The two 3D templates go further still. A `?static=1` scene there keeps the character controllers
and the camera rig from running — both scene files carry them, so `3d-third-person` switches every
script off before the first frame and `3d-first-person` switches off its controller and its
crosshair ray, leaving `AttachToHand` to weld the prop to the hand — and places the camera by hand, because a rig that damps towards its target makes the picture a
function of how many frames elapsed before the screenshot; and it sets `app.ui.visible = false`, so a
golden never depends on how the runner draws
a system font. Everything else — the seeded crate scatter, the character at its spawn, the animator
at t = 0 — is the scene the game builds.

Chromium runs as the full browser (`channel: "chromium"`), not `chrome-headless-shell`, which has no
compositor and loses the WebGPU device after two or three presented frames — the same finding that
pins `vitest.config.ts`. `--use-webgpu-adapter=swiftshader` keeps the image off the host GPU.

## One golden per scene, not one per platform

`snapshotPathTemplate` drops Playwright's default `{platform}` segment, so macOS and Linux compare
against the same image and `maxDiffPixelRatio` has to absorb the difference between two SwiftShader
builds. The trade-off is a looser tolerance in exchange for a golden that cannot rot on the platform
nobody runs locally. The committed images were generated on macOS arm64.

Goldens are regenerated **only** by a pull request that shows before and after images.

## Files

| Path                           | What it is                                                                |
| ------------------------------ | ------------------------------------------------------------------------- |
| `playwright.config.ts`         | Browser, flags, viewport, preview servers, projects                       |
| `playwright.desktop.config.ts` | The Electron suite's own configuration                                    |
| `tests/scenes.spec.ts`         | The two workspace examples and their tolerances                           |
| `tests/templates.spec.ts`      | The four templates and their front ends                                   |
| `tests/frame-time.spec.ts`     | The `frame-budget` project: the templates                                 |
| `tests/gpu-time.spec.ts`       | The `gpu-budget` project: the 3D templates on the host GPU                |
| `tests/desktop.spec.ts`        | The Electron suite (`pnpm --filter ignifx-visual-tests run test:desktop`) |
| `tests/__screenshots__/*.png`  | The goldens for `scenes.spec.ts` and `templates.spec.ts`                  |
