# 08 · Execution: decisions, contracts and ownership

**Written:** 2026-09-07 by the build coordinator, at the start of implementation. **Read after** `README.md`
and `06-engineering.md`. Where this document and `01`–`07` disagree, this document wins: it records
what was decided when the plan met the repository.

## 1. Facts checked on 2026-09-07

| Fact                                                                                                                                                                                                                                                                                                      | Consequence                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/*/package.json` are at `0.1.0` (the "Version Packages" pull request merged), but `npm view ignifx version` and `npm view @ignifx/core version` still return the `0.0.0` placeholders.                                                                                                           | `site.published = false`. The version chip reads the repository version; the install surfaces show the pre-release variant. Flipping the flag is the release-day step in `06` §8 and is not done here.                                                                     |
| `astrum-forge/ignifx` is **private** (`gh repo view`).                                                                                                                                                                                                                                                    | Every GitHub link the plan relies on (`/llms.txt`, "View on GitHub", the API reference, the `/skill/*` redirects) is dead for a visitor until the repository is public. This is a **launch blocker** recorded in §8 below, not a reason to change the design.              |
| The local machine runs Node 25; `.nvmrc` says 24 and CI uses 24.                                                                                                                                                                                                                                          | Build and tests run on both. `pnpm deps` (dependency-cruiser) is the only tool that refuses Node 25 and is not part of `pnpm check`.                                                                                                                                       |
| Babylon Lite 1.27.0's glTF loader declares `KHR_texture_basisu`, `KHR_texture_transform`, `EXT_meshopt_compression`, `KHR_materials_{clearcoat,sheen,transmission,volume,iridescence,anisotropy,emissive_strength,unlit}`. It declares **no** `KHR_draco_mesh_compression` and **no** `EXT_texture_webp`. | Sample models are compressed with meshopt and quantisation (`@gltf-transform/functions`) and with resized PNG/JPEG textures. Never ship a Draco or WebP-textured glTF. KTX2 only if `toktx` is on the machine that runs the pipeline; the committed asset is what matters. |
| `@ignifx/ui` and `@ignifx/devtools` install their stylesheets by appending a `<style>` element (`packages/ui/src/dom/styles.ts`, `packages/devtools/src/dom/styles.ts`). `packages/electron/src/main/csp.ts` already allows `'unsafe-inline'` for styles, and only styles, for exactly this reason.       | The example-frame CSP is `style-src 'self' 'unsafe-inline'`; `script-src` stays `'self' 'wasm-unsafe-eval'`. The site pages keep the strict policy with no `unsafe-inline` anywhere. Recorded in ADR-0020.                                                                 |
| `@ignifx/vite-plugin` reads `resolvedConfig.base` for the URLs it writes (`plugin.ts`), so a build under `base: "/examples/"` resolves the manifest and the hashed assets correctly.                                                                                                                      | Examples and templates can be built under a sub-path without touching the plugin. Verified by the kit milestone.                                                                                                                                                           |
| Chrome for Android enabled WebGPU by default in Chrome 121 on Android 12+ with Qualcomm and ARM GPUs (developer.chrome.com, "What's New in WebGPU (Chrome 121)").                                                                                                                                         | The browser-support row stays, worded exactly so: "Chrome (Android) — 121, Android 12 and later on Qualcomm and ARM GPUs".                                                                                                                                                 |
| `raw.githubusercontent.com` and the npm registry are reachable from the build machine; Playwright's Chromium is installed.                                                                                                                                                                                | Assets can be downloaded, compressed and committed; posters can be captured locally.                                                                                                                                                                                       |

## 2. The open decisions of `06` §7, resolved

| #   | Decision               | Taken                                                                                                                                                             |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hero headline          | **"Ignite your next game."**                                                                                                                                      |
| 2   | Hero model             | **Corset** if it compresses under 4 MB; otherwise BoomBox. Decided by the kit milestone from measured sizes and written into `catalogue.ts`.                      |
| 3   | Skill pages            | **Removed.** `/skill/*` and `/docs/skill/*` redirect to the file in the repository.                                                                               |
| 4   | Search                 | **Removed.** `src/search.ts`, `search-index.js`, the button and the `s` shortcut go.                                                                              |
| 5   | Capitalisation         | **Lowercase always**, `CONSTITUTION.md` §1.5 unchanged.                                                                                                           |
| 6   | Structured data        | **Included.** One JSON-LD block (`Organization` + `SoftwareSourceCode`), byte-identical on every page, its SHA-256 written into the site CSP by the build (§4.5). |
| 7   | Launch timing          | **Pre-release variant.** The site is complete without npm; `published` flips on release day.                                                                      |
| 8   | Chrome for Android row | **Kept**, confirmed (§1).                                                                                                                                         |
| 9   | Wishlist items to fund | **None** for this build. `07-wishlist.md` is untouched.                                                                                                           |

Further decisions the plan left implicit:

- **GitHub star count:** not shown. A build must never depend on a third party being up (`04` §5.1 rule 4 applied to the build), and the repository is private. The header button reads "GitHub".
- **Categories:** the chip list gains **Basics** (for `hello-cube`, `cameras`, `transforms`, …) and **Templates** (for the four templates), because a visitor looks for those words. `CATEGORIES` in `catalogue.ts` is the list.
- **Templates as examples:** built from `templates/<name>` with `vite build --base /examples/<name>/run/ --outDir website/dist/examples/<name>/run`, by `website/examples/_tools/build-templates.ts`. No change to the templates themselves.
- **Environments:** Babylon's prefiltered `.env` files from `BabylonJS/Assets` (CC-BY-4.0) are acceptable alongside Poly Haven HDRIs (CC0). Either is inside the CC0/CC-BY rule; both are attributed with digests.
- **Posters:** PNG, WebP and AVIF, derived with `sharp`. The WebP and AVIF are 1280×720 and under 120 KB each. The PNG fallback may be downscaled or palette-quantised to fit its 120 KB; it exists for `<picture>` fallback only.
- **Goldens for examples** live in `tests/visual/tests/__screenshots__/examples/<slug>.png` at 640×360, following the repository's rule that a test never writes into `website/public/`. Posters are written by a script (§4.4), the way `capture-gallery.ts` already works.
- **Build-time dependencies** added to `website/package.json` (all `devDependencies`, all MIT or Apache-2.0, none runs an install script, none reaches the browser): `sharp` (posters, PNG exports of the press SVGs), `fontkit` (Archivo and Public Sans glyph outlines for the wordmark and badges), `fflate` (the press-kit zip), `@gltf-transform/{core,extensions,functions}` and `meshoptimizer` (sample-model compression). `playwright` is a devDependency because the poster capture script lives in this package. The coordinator ran the one `pnpm install`; agents do not install anything.

## 3. Route → file → owner

| Route                                                     | Source of the copy                                      | Data read at build time                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                                                       | `03` §2                                                 | `catalogue.ts`, `skills/ignifx/SKILL.md` "First app", `site.config.ts`                      |
| `/features/`                                              | `03` §3                                                 | `catalogue.ts` (the "See it" chips resolve to real slugs)                                   |
| `/examples/`                                              | `03` §4 + `catalogue.ts`                                | posters under `public/examples/`                                                            |
| `/examples/<slug>/`                                       | `catalogue.ts`                                          | `website/examples/<slug>/<sourceFiles>` or `templates/<name>/src/…`, highlighted with Shiki |
| `/examples/<slug>/run/`                                   | the examples build (§4.2), not a site page              | —                                                                                           |
| `/examples/attribution/`                                  | `03` §4                                                 | `website/examples/assets/ATTRIBUTION.md`                                                    |
| `/docs/`                                                  | `03` §5                                                 | `skills/ignifx/references/recipes/README.md` for the guide groups                           |
| `/docs/getting-started/`                                  | `03` §6                                                 | `site.config.ts`                                                                            |
| `/docs/guides/`                                           | `03` §5 grouping                                        | `skills/ignifx/references/recipes/*.md`                                                     |
| `/docs/guides/<name>/`                                    | the recipe page, rendered as before                     | `skills/ignifx/references/recipes/<name>.md`, `catalogue.ts` (`guide` back-links)           |
| `/docs/browser-support/`                                  | `03` §7 (Android row as §1 words it)                    | —                                                                                           |
| `/press/`                                                 | `05` §2                                                 | `public/press/**` (file list per `05` §3)                                                   |
| `/404.html`                                               | `03` §9                                                 | —                                                                                           |
| `/llms.txt`                                               | generated by `pnpm docs:llms` with absolute GitHub URLs | —                                                                                           |
| `/sitemap.xml`, `/robots.txt`, `/_headers`, `/_redirects` | build output (§4.5)                                     | —                                                                                           |

## 4. Build and runtime contracts

### 4.1 Order of the one build

`website/package.json`:

```
build          = vite build && pnpm run build:examples && node examples/_tools/build-templates.ts
build:examples = vite build --config examples/vite.config.ts
dev            = vite                                  (the site; run pages come from a built dist)
dev:examples   = vite --config examples/vite.config.ts (the examples, at /examples/<slug>/ in dev)
press-kit      = node press/build.ts                    (writes public/press/**, run locally, output committed)
```

1. `vite build` (the site) runs **first** and empties `dist/`. It emits every page, `404.html`,
   `sitemap.xml`, `_headers` and `_redirects`, and the fonts. It fails when a catalogue entry has no
   directory, no first source file, or no poster in all three formats.
2. `vite build --config examples/vite.config.ts` writes into `dist/examples/` with
   `emptyOutDir: false`: `dist/examples/<slug>/run/index.html` per kit example, shared hashed chunks
   under `dist/examples/assets/`, the asset manifest and the vendored sample assets.
3. `build-templates.ts` builds each `template` entry of the catalogue with
   `vite build --base /examples/<name>/run/ --outDir <abs>/dist/examples/<name>/run --emptyOutDir`
   from `templates/<name>`, and fails when a template's build does.

Cloudflare's build command becomes `pnpm turbo run build --filter=@ignifx/website...`; the `...`
builds the workspace packages first. `website.yml` runs the same, then the website tests.

### 4.2 The examples Vite build (`website/examples/vite.config.ts`)

- `root: website/examples`, `base: "/examples/"`, `build.outDir: "../dist/examples"`,
  `build.emptyOutDir: false`, `build.target: "esnext"`, `build.modulePreload: false`.
- Inputs: `{ [slug]: "<slug>/index.html" }` for every catalogue entry without `template`.
- A tiny inline plugin renames each emitted `<slug>/index.html` to `<slug>/run/index.html` in
  `generateBundle`. URLs inside are absolute under `/examples/`, so the move is safe.
- Plugins: `ignifx({ assetRoot: "assets", config: false })`. Settings are passed per example through
  `bootExample({ settings })`, not through a shared `ignifx.config.ts`.
- Rollup's default chunking shares Babylon Lite between examples; the kit milestone records the
  gzipped size of the shared vendor chunk in its report (recorded, not capped — `06` §2.4).
- Every `<slug>/index.html` is minimal and identical in shape: `<canvas id="game">`, the kit
  stylesheet, `<script type="module" src="./main.ts">`, a `<title>`, `lang="en"`. No inline
  `<script>`; a `<style>` element is tolerated in the frames by their CSP but the kit uses a linked
  stylesheet anyway.

### 4.3 The kit contract (`website/examples/_kit/`)

Module list as `04` §4. The bridge and the flags are load-bearing for the viewer, the visual suite and
the frame-budget suite, so they are fixed here:

| Item                         | Contract                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.__ignifxReady`       | `Promise<"ready" \| "unsupported">`, assigned before the first `await`, resolved after `app.start()` and one settled frame. Same shape as `examples/hello-cube/src/main.ts`; the visual suite waits on it.                                                              |
| `postMessage` frame → viewer | `{ type: "ignifx:ready" }` once; `{ type: "ignifx:stats", frameMs: number, drawCalls: number }` every 500 ms while running; `{ type: "ignifx:unsupported", code: "IGX-0701" }` when WebGPU is missing. Posted to `window.parent` with `targetOrigin = location.origin`. |
| `postMessage` viewer → frame | `{ type: "ignifx:pause" }`, `{ type: "ignifx:resume" }`. The kit also pauses on `visibilitychange` to hidden and resumes on visible.                                                                                                                                    |
| `?static=1`                  | `time.timeScale = 0` after the first frame; anything random is pinned; the orbit camera holds its start pose.                                                                                                                                                           |
| `?seed=<n>`                  | Seeds the kit's PRNG (`kit.random()`); examples never call `Math.random`.                                                                                                                                                                                               |
| `?nopanel=1`                 | The parameter panel is not mounted.                                                                                                                                                                                                                                     |
| `?autoplay=0`                | The app is created but `start()` waits for a click on the canvas or a `ignifx:resume` message. The viewer sends this when `prefers-reduced-motion` is set.                                                                                                              |
| `?bench=1`                   | Same probe protocol as `templates/*/src/frame-time-probe.ts`, so `tests/visual/tests/frame-time.spec.ts` can measure an example the way it measures a template.                                                                                                         |
| Fallback panel               | On `IGX-0701`: the canvas is replaced by the kit's panel (`fallback.ts`), copy "WebGPU is not available in this browser" with a link to `/docs/browser-support/`, and `ignifx:unsupported` is posted.                                                                   |
| Devtools                     | `devtools()` is registered in every example; backtick opens it. Never `openOnStart` except in the `devtools` example.                                                                                                                                                   |
| Panel                        | `panel.ts` builds on `@ignifx/ui`'s overlay; controls are keyboard-operable and 44 px tall on touch. Styled with the site's tokens in `kit.css` (both themes via `prefers-color-scheme`; the frame has no theme toggle).                                                |

`main.ts` of an example is under 200 lines, imports only from `ignifx`, `@ignifx/*` and `../_kit/*`,
and reads top to bottom as a lesson (`04` §9).

### 4.4 Posters, goldens and budgets

- `pnpm --filter @ignifx/website exec node examples/_tools/capture-posters.ts [slug…]` builds the
  examples into a **temporary** directory, previews them on an ephemeral port, opens each
  `/examples/<slug>/run/?static=1&nopanel=1&seed=1` at 1280×720 in Chromium on SwiftShader (the
  flags from `tests/visual/playwright.config.ts`, platform switch included), waits for
  `__ignifxReady`, and writes `website/public/examples/<slug>.{png,webp,avif}` with `sharp`. It never
  touches `website/dist/`, so several people can run it at once for different slugs.
- `tests/visual/tests/examples.spec.ts` compares each ready slug at 640×360 against
  `__screenshots__/examples/<slug>.png` with a per-example tolerance, served from a `webServer` entry
  that builds the website and previews `website/dist` on port `4179`.
- `tests/visual/tests/frame-time.spec.ts` gains the examples with rows under
  `frameTime.examples.<slug>` in `benchmarks/baselines.json`, recorded the way the template rows are
  (`tests/visual/README.md`), ceiling 4 ms for 3D and 2 ms for 2D as coding standards §7 says.
- `website/test/site.test.ts` asserts: a run page for every ready slug; posters in three formats under
  120 KB each; no directory under `website/examples/` without an entry and no entry without a
  directory; the shared vendor chunk exists; example own chunks under 60 KB gzipped; assets under
  `website/examples/assets/` each under 4 MB and 48 MB in total; every asset file named in
  `ATTRIBUTION.md` with a matching SHA-256.

### 4.5 Headers, redirects, structured data

- `_headers` and `_redirects` are **emitted by the site build** from `website/headers.txt` and
  `website/redirects.txt` (they leave `public/`, which Vite copies after the bundle is written and
  would overwrite an emitted file). The build substitutes the JSON-LD hash into the site CSP and
  appends one redirect per skill file from the tree (`skill-tree.ts` survives for this alone).
- Site pages: the current CSP plus `'sha256-<hash>'` on `script-src`. Frames (`/examples/*/run/*`):
  the block in `06` §2.2 with `style-src 'self' 'unsafe-inline'` (§1). `/press/badges/*`: the block in
  `06` §2.2. `/examples/assets/*`: `Cache-Control: public, max-age=31536000, immutable`.
- Redirect table: the five rules of `01` §7 with absolute GitHub targets, plus one line per subsystem
  skill. `/skill/references/<path>` maps to `skills/ignifx/references/<path>.md`.
- The JSON-LD block is the only `<script>` without `src` the tests permit, and only with
  `type="application/ld+json"`.

### 4.6 `site.config.ts`

Exactly `06` §2.6, exporting `site` with `published`, `version` (read from `packages/core/package.json`),
`repo`, `npm`, plus `blob` and `tree` URL prefixes. Nothing else in `website/` hard-codes a GitHub URL.

## 5. File ownership during the build

| Owner                     | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator               | `website/plan/**`, `website/examples/catalogue.ts` **types** (the interfaces and `CATEGORIES`), `website/package.json` (others may add a script line or a devDependency they were told about; nothing else), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, the final `pnpm check`, commits.                                                                                                                                                                                                                                            |
| Site shell                | `website/scripts/**`, `website/src/**`, `website/test/**`, `website/vite.config.ts`, `website/vitest.config.ts`, `website/tsconfig.json`, `website/site.config.ts`, `website/headers.txt`, `website/redirects.txt`, `website/public/{robots.txt,favicon.svg,_headers,_redirects}`, `website/README.md`, `website/DESIGN.md`, `scripts/docs-llms.ts`, `scripts/lib/llms-index.ts`, `docs/adr/0020-*.md`, `docs/architecture/16-docs-harness-and-skill.md` §3, `.github/workflows/website.yml`, `website/public/gallery/` (delete). |
| Examples kit and pipeline | `website/examples/**` (entries in `catalogue.ts`, `_kit/`, `_tools/`, `vite.config.ts`, `assets/**`, `hello-cube/`, `pbr-model/`), `website/public/examples/**`, `tests/visual/tests/examples.spec.ts`, `tests/visual/tests/frame-time.spec.ts` (examples half), `tests/visual/playwright.config.ts`, `tests/visual/README.md`, `benchmarks/baselines.json` (`frameTime.examples` rows only).                                                                                                                                     |
| Press kit                 | `website/press/**` (generator source), `website/public/press/**` (generated, committed).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Example authors (wave 2)  | `website/examples/<slug>/**` for their slugs, their `catalogue.ts` entries, their assets and `ATTRIBUTION.md` sections, their posters and goldens, their baseline rows.                                                                                                                                                                                                                                                                                                                                                           |

Rules for everyone: never `git commit`, `git checkout`, `git stash` or anything else that changes the
tree's history or another owner's files; never `pnpm install` or add a dependency (report the need);
never run `pnpm check` or the root `pnpm build` (the coordinator does); test builds of the examples go
to a scratch `--outDir`, never to `website/dist/` unless you own the site build; preview servers use
the port range you were given.

## 6. Definition of done, per milestone

Unchanged from `06` §4 and `04` §9. In addition every agent's final report lists: files written,
each command run with PASS or FAIL and the exact command line, deviations from `01`–`08` with the
reason, and anything claimed but not verified.

## 7. Wave plan

1. **Wave 1, in parallel:** site shell (foundation + design system + pages and copy), examples kit and
   pipeline (with `hello-cube` and the hero `pbr-model`, one template embedded as proof), press kit.
2. **Integration:** the coordinator runs the full build, the website tests, the visual suite and
   `pnpm check`, fixes or sends back.
3. **Wave 2, in parallel by category:** the remaining P0 examples and the four templates, each agent
   owning its slugs end to end (code, assets, attribution, poster, golden, baseline row).
4. **Wave 3:** integration again, a review of every page in both themes at 320, 800, 1040 and
   1440 px, reduced-motion and keyboard passes, the OG image, the launch checklist.

## 8. Launch blockers outside this build

- The repository must be **public** before the site goes live, or every GitHub link on it is dead.
- `site.published` flips only after `npm view ignifx version` returns the release.
- Cloudflare Pages: build command `pnpm turbo run build --filter=@ignifx/website...`, output
  `website/dist`, `NODE_VERSION=24`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, and a raised build timeout
  if the first preview needs it (`06` §6).
- Safari, Firefox and Android testing needs hardware this build does not have (`06` §8).

## 9. Brand mark change (owner, 2026-09-07 19:23)

The owner supplied a professionally designed mark, `pro_icon.svg`, and asked for it to replace the
generated flame everywhere, with the icon and the wordmark aligned properly. Facts and decisions:

- The file is an SVG wrapper around one 1024×1024 PNG (SHA-256 of the wrapper
  `da3647e7683072942ace83241b3daf35dd8168344b795a6fe3f966ce37099cb0`). It was moved, unchanged, to
  `website/brand/source/pro_icon.svg`; the PNG inside it was extracted byte for byte to
  `website/brand/ignifx-mark.png`, which is the source of truth (`02` §2.1).
- Because the artwork is raster: colour SVGs embed the PNG; single-colour variants are a traced
  **silhouette**; there is no `currentColor` colour mark. `favicon.svg` is retired in favour of
  `favicon.ico` + PNGs. The site's header uses `<img src="/brand/mark-64.png" srcset="… 2x">`.
- The coordinator bootstrapped `public/favicon.ico`, `favicon-16.png`, `favicon-32.png`,
  `apple-touch-icon.png` and `public/brand/mark-*.png` by hand so the site shell could switch at
  once; `website/press/build.ts` regenerates the same files deterministically and is the owner of
  them from now on.
- Lockup alignment is decided from rendered candidates (`02` §2.2), not from the old cap-height rule,
  because the new mark is tall and pointed. The chosen construction and its numbers live in
  `website/press/README.md`.
- Badge labels are Archivo 600 rather than Public Sans 600: fontkit 2.0.4 cannot instance a WOFF2
  variable font, and `@fontsource-variable/public-sans` defaults to weight 100. Accepted for now; the
  fix, if wanted, is adding the static `@fontsource/public-sans` package. The product name in a badge
  is the real wordmark.
- The mark's palette (magenta-red, orange, yellow) sits beside the site's `--flame` accent without a
  token change; nothing else on a page is orange (`02` §1).

### 9.1 Outcome (press kit rebuilt 2026-09-07, reviewed by the coordinator)

- **Horizontal lockup:** candidate **B** — the mark's ink at 1.15× cap height (78.89 units per 100/em),
  its ink box centred on the wordmark's ink box, **0.45 em** ink-to-ink gap (the extra 0.1 em because
  the mark's widest facet sits at two-thirds of its height and crowds the `i` at 0.35 em). Chosen from
  the rendered sheet against A (full ink height: the mark outweighs the letters) and C (cap height on
  the baseline: an ornament with a hole under it). Lockup 335.55 × 91.3 units.
- **Stacked lockup:** mark at 1.6× cap height centred above the wordmark, 0.35 em gap, 235.7 × 236.06
  (square). Legible at the 64 px minimum.
- **Silhouette:** alpha ≥ 128, boundary walk, Douglas–Peucker at 1 px → 25 vertices; 0.516% of ink
  pixels disagree with the master's mask (the antialiasing band, not the simplification).
- **Badges:** the full-colour raster at 14 px inside the 20 px pill reads as the flame; no silhouette
  fallback needed. `BADGE_MARK_STYLE` in `website/press/brand.ts` switches it if that is revisited.
- **`ignifx-mark-1024.png`** upscales the 964 px master by 1.062× to keep the same 4% margin as
  every other size. `-black` is the ink token, not pure black. Embedded images use `xlink:href`.
- **Site brand files** (`favicon.ico`, the two PNG favicons, `apple-touch-icon.png`, `public/brand/mark-*.png`)
  are now written by the same generator; the coordinator's bootstrap copies were replaced by it.
- **Still to regenerate** once the hero poster and the remaining template posters exist:
  `pnpm --filter @ignifx/website press-kit` rebuilds the social image and the screenshots folder.

### 9.2 The mascot (owner, 2026-09-07 20:18)

The owner supplied `unique_glb.glb`, a PBR spaceship, as the ignifx mascot for hero shots and
socials. Kept unchanged at `website/brand/source/spaceship.glb` (SHA-256
`4d164cf0…80794e`); measured: 1,942,544 triangles, three 4096² JPEG textures (3.48 MB), meshopt +
quantisation, bounds 0.49 × 0.50 × 0.98 m. Decisions:

- The ship replaces the Corset as the **default subject of the hero example** `pbr-model`; the
  Corset stays as a second model in the panel's select. The social image follows the hero poster.
- It is compressed at build time by `_tools/compress-model.ts` (meshopt decoded with the
  `meshoptimizer` decoder, simplified with the meshopt simplifier, textures resized, extensions
  dropped) to `assets/models/ignifx-ship.glb`, target ≤ 3 MB, cap 4 MB. Runtime meshopt decoding
  is refused because Babylon's decoder is fetched from a CDN (`CONSTITUTION.md` §9.1).
- Attribution: © 2026 Astrum Forge Studios Pty Ltd, a brand asset under the trademark rules on
  `/press/`, not a sample asset. **The owner should confirm this wording**; the attribution page's
  lead ("every capture on this site is Apache-2.0") still holds for captures, and the model itself is
  listed as the one non-Apache, non-CC asset.

**Owner, 2026-09-07 20:30:** the ship is used only for hero shots — the `pbr-model` example, its
poster, the social card and press screenshots — and never as a prop in another example. The hero is
composed as key art (cinematic framing, low key lighting with a strong rim, dark falling-off backdrop),
not as a turntable product shot. The rest of the plan runs to completion without further check-ins.

## 10. Wave 1 outcome (integrated 2026-09-08)

All three wave-1 agents delivered; the coordinator reran their commands and reviewed the built site
in both themes at 390, 800, 1040 and 1440 px. Numbers: 29 routes, largest route 26.1 KB gzipped,
client JavaScript 2.9 KB gzipped, fonts 99.8 KB, shared example vendor chunk 326 KB gzipped, example
own chunks about 1 KB gzipped each. Deviations accepted, beyond §9:

- **`_headers` structure.** Cloudflare merges every matching rule and allows one splat per pattern,
  so the plan's `/examples/*/run/*` is invalid. The build emits `/examples/*run/` and
  `/examples/*run/index.html`, each detaching the site policy with `! Content-Security-Policy`
  before setting the frame policy; every cache rule detaches `Cache-Control` the same way. The build
  and the test refuse a slug that ends in `run`.
- **`_redirects`** names every skill file explicitly (64 generated lines) because a suffix after
  `:splat` is undocumented; the two splat rules remain as a safety net.
- **`--ok`** clears AA on `--surface` (4.89) but not on `--bg` (4.44); the support pill is always on
  `--surface`, and the test asserts the surface pairs.
- **Home teaser and template cards** fall back honestly while the catalogue is small: a template with
  no catalogue entry shows a bordered well and the copy button, never a dead link; a "See it" link for
  a slug that does not exist yet goes to its category section, then to the gallery.
- **The kit's `?static=1` freezes the clock before `app.start()`**, as the templates do, so the
  first frame is reproducible.
- **`Environment` cannot swap a loaded `.env` at runtime and ignores its `skybox` field** (engine
  finding; `packages/core/src/render/environment.ts`). `pbr-model` ships rotation and blur; the P0
  `ibl` example is built with one environment until the wave-2 core fix lands (§11).
- **Template atlases reference their sheets root-relatively** (`"image": "/hero.png"` in
  `public/`), which breaks any deploy under a sub-path. `build-templates.ts` rebases them for the
  site; the upstream fix (sheets under `assets/`, relative references, which the 2D loader now
  resolves through the manifest) is a wave-2 task.
- **The example frames use system fonts** in the kit panel, because the site's font URLs are
  content-hashed by the other build. Accepted; the panel is an in-game overlay.
- **The examples build stages into `dist/.examples-build/`** and moves its tree into
  `dist/examples/` in `closeBundle`, because writing `<slug>/index.html` in place overwrote the
  viewer pages.
- **The live figure is engine CPU time**, labelled "engine CPU" with a title explaining the median
  window, not frame time; the kit's `bridge.ts` header records why.
- **The kit panel starts collapsed** in frames narrower than 720 px or shorter than 480 px;
  `?panel=open|collapsed` overrides; the home hero passes `?nopanel=1`.
- **Hero composition** (`website/examples/pbr-model/shot.ts`): candidate C of the second sheet —
  camera pitch −8° below the centre line, fov 26, ship nose-down 14° and banked 8°, warm key 24, cool
  fill 10, warm rim 36, exposure 0.80, ACES, bloom 0.35/0.24/48, a generated neutral backdrop whose
  corners sit at `--bg`. The ship is 67,983 triangles / 3,057,368 bytes after simplification.

## 11. Wave 2 plan (launched 2026-09-08)

Eight example agents by category (assignments in the coordinator's briefs, ownership = the
`entries/<category>.ts` file plus the slug directories, assets, posters, goldens and baseline rows)
and one core agent for the `Environment` runtime swap and `skybox` field. The templates agent also
carries the upstream atlas fix and removes the rebase from `build-templates.ts`.

**Gate, 2026-09-08 00:40:** `pnpm check` passes on the wave-1 tree (build 21/21, format, lint, typecheck
23/23, unit tests 3916 — `benchmarks/devtools-closed.test.ts` is load-sensitive and passed on rerun —
API reports 34/34, docs harness 5/5). The visual suite and the frame budgets run at wave-2 integration,
when every golden is generated in one pass.

**Core fix landed, 2026-09-08:** `Environment` swaps a loaded `.env` at runtime (`packages/core`,
changeset `@ignifx/core` patch; API report, schemas and docs regenerated). It works by writing the one
Lite field `loadEnvironment` itself installs (`scene._envTextures`, undeclared in `index.d.ts`, read by
every Lite consumer and by Lite's own device-loss recovery); a browser test fails loudly if the pinned
Lite ever renames it, which is the recorded upgrade risk. The skybox cannot be toggled or resized at
runtime (Lite owns that renderable); setting `Environment.skybox` away from its default logs `IGX-0711`,
and a skybox-enabled declaration with no explicit image now draws the `.env`'s own cube map. The `ibl`
example therefore ships with an environment switch; §10's bullet on this is superseded.

## 12. Engine and plan follow-ups surfaced by wave 2 (running list)

- **Havok wasm under a sub-path.** `@ignifx/physics` resolves `HavokPhysics.wasm` through the manifest,
  misses (the plugin does not put extension public assets in the manifest), and falls back to a
  relative `assets/HavokPhysics.wasm`, which under `/examples/<slug>/run/` is wrong (`IGX-0903`).
  Every kit example that registers `physics()` sets `havokWasm` to
  `` `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm` `` by hand. Proper fix: the Vite plugin
  lists extension public assets in the manifest, or `@ignifx/physics` resolves against `BASE_URL`.
- **`rendering.clearColor` is decoded from sRGB and presented without re-encoding**: a literal
  `#14181F` renders as bytes 2,2,4. Examples that want a page-token ground pass the inverse
  (`linearToSrgb`) and say so. Engine ticket: document or fix the colour space of `clearColor`.
- **`Animator` has no seek**; `skinned-animation` scrubs by `machine.speed = 1; machine.advance(t)`.
  An `Animator.seek(t)` would remove the helper.
- **Plan rows stale:** `MeshAsset.sphere/capsule/cylinder/plane/torus` exist (`04` §7.1 marks
  `primitives` as `engine` and §8 lists the factories as work; both are wrong).
- **`features.skeletons`**: Lite's `enableStandardSkeleton()` is scoped to Standard-material meshes;
  the 3D template skins a PBR rig without the flag. Whether the flag is needed for a PBR skinned
  glTF is unverified; examples declare it because the plan says so.
- **`.env` under Playwright's headless shell** fails with `IGX-0505` + "Invalid Texture";
  `chromium.launch({ channel: "chromium" })` is required (the visual suite already does this; worth a
  line in `tests/visual/README.md`).
- **Example length.** Wave-2 `main.ts` files run 200–320 lines with TSDoc; the plan's "under 200"
  is kept as the target for the code proper, not the comments.
- **`Light` has no visibility path**: `render-sync-system.ts` calls `Light.sync` unconditionally, so
  `enabled = false` or a deactivated entity keeps shading. Examples switch a lamp off with
  `intensity = 0`.
- **Shadow technique cannot change at runtime**: a renderable bakes the shadow bind-group layout and
  `rebuildSceneRenderables` does not re-pick it (PCF→ESM binds a float map where the shader declares
  depth; PCF→CSM binds an array view and the frame goes black; the exact validation messages are in
  `website/examples/shadows/rebuild.ts`). The `shadows` example reloads the frame per technique.
- **The `shadows` record is read once**: `mapSize`, `bias`, `normalBias`, `darkness`, `cascades`,
  `maxDistance` need a two-frame generator rebuild to apply; a `Light.rebuildShadows()` or a diffing
  `Light.sync` would remove that dance from every settings menu.
- **Only one camera renders** (`RenderSyncSystem.#selectCamera`), so a split-view comparison needs an
  A/B flip; `tone-mapping` does that.
- **Kit polish wanted**: fold the two new probes into `_kit/stage.ts` `ENVIRONMENTS`; a
  `reloadWith(flags)` helper so an example never touches `window.location` itself.
- **Recast's WebAssembly is inlined as a `data:` URL that Emscripten fetches**
  (`@babylonjs/lite/lib/_chunks/vendor/recast-navigation-*.js`), so the frame CSP needs
  `connect-src 'self' data:` or a navmesh bake fails on the deployed site while working in dev.
  The third-person template bakes one; integration adds `data:` and verifies every frame under the
  real `_headers`.
- **`ThirdPersonController.isGrounded`** returns the raw `CharacterController.isGrounded`, not the
  slope-classified value `fixedUpdate` computes (`packages/3d/src/character/third-person-controller.ts`).
- **`Animator.setFloat` before the first frame is dropped**: the machine is built inside `advance()`
  during `app.start()`; a start value has to live in the document. Gotcha row wanted.
- **A capsule wedged into two overlapping static boxes** is depenetrated along the summed normals,
  through the wall; level geometry should not overlap at corners.
- **Slug-local data files** (an `.animator.json` beside `main.ts`) load through `?url` +
  `new URL(url, import.meta.url)`, because the slug directory is not the plugin's asset root; a kit
  helper would tidy that.
- **`@ignifx/2d` sprite mode ignores `rendering.clearColor`** (`packages/2d/src/extension.ts` passes a
  hard-coded black to `createRegisteredSpriteRenderer`); every 2D scene has a black sky and the 2D
  templates' configured clear colour does nothing.
- **`overlapBox` wholly inside a tilemap's merged collision outline returns nothing** while
  `overlapCircle` at the same point finds it; `templates/2d-sidescroller`'s drop-through probe uses
  that shape and may drop the player through solid ground — check.
- **A `Rigidbody2D` written in the frame its entity was created loses the write** (bodies are built
  at the next fixed step); a pending-velocity cache on the component would remove the footgun.
- **`IGX-0706` (no enabled camera) is logged by every 2D-only scene** that has a `Camera2D` but no
  3D `Camera`; a warning on a correct scene.
- **Kit panel refreshes readouts once before `app.start()`**, so a readout touching `app.physics2d`
  throws `IGX-1150`; defer the first refresh. Also wanted: a 2D stage helper, and no `grab` cursor in
  2D scenes.
- **`.oxfmtignore`** gained `website/examples/assets/2d/*.json` and `website/examples/*/*.tmj.json`
  (generator output, same precedent as the templates' atlases). Accepted.
- **Rapier lands in one shared chunk** (786 KB gzipped) imported only by the three 2D-physics
  examples; 3D examples no longer pay for it, but the plan's dynamic-import follow-up (`04` §2)
  stands for the 2D ones.
- **Kit panel controls do not re-read their source** (`toggle`, `slider`, `select`, `color` write the
  DOM once at mount), so any flag the scene can also change must be shown as a `readout` today. A
  `read?: () => T` refreshed by the existing timer would remove the trap.
- **`dev:examples` restarts on every `entries/*.ts` save** because the examples Vite config imports
  the catalogue; with many agents editing entries it restarted constantly. A documented scratch config
  with a fixed input list, or excluding `entries/**` from config-file dependencies, would help.
- **`Ray` literals default `length` to what you type**; `createRay()` sets `Number.MAX_VALUE`. A
  literal with a short length makes every `raycastRender` miss silently.
- **`isWebGpuAvailable()` probes `"gpu" in navigator`**, so a no-WebGPU test must delete the accessor
  from `Navigator.prototype`; shadowing with an own `undefined` property crashes instead of `IGX-0701`.
- **Requesting `features.shadows` with nothing casting** made Dawn refuse the frame in `audio-mixer`
  (`Depth32Float` usage conflict in one synchronisation scope) — engine ticket: a shadow pass with no
  casters should be a no-op.
- **Kit `bind(target, key)` reads once at mount**, so a toggle bound to an effect switched on in
  `afterStart` renders unchecked over a frame that has the effect (`pbr-model`'s bloom toggle; fixed
  at integration with a literal binding). The `read?: () => T` refresh above would fix the class.
- **The recipe `show-diagnostics-in-devtools` overstates the overlay**: custom `app.diagnostics` groups
  are readable through `app.diagnostics.group(name)` but the Stats panel renders a fixed list and never
  shows them. Recipe prose to correct (`examples/recipes/show-diagnostics-in-devtools/main.ts`, then
  `pnpm docs:recipes`).
- **The material format cannot express an HDR emitter**: `emissive` is sRGB and clamped, so linear
  emissive stops at 1.0 while Lite's `setPbrEmissive` accepts more and its loader reads
  `KHR_materials_emissive_strength`. An `emissiveIntensity` field would close the gap.
- **WebGPU detection uses `"gpu" in navigator`**; `typeof navigator.gpu === "object"` would also catch
  a shimmed `undefined` and reach `IGX-0701` instead of a `TypeError`.
- **Plan `04` §5.3 lists EmissiveStrengthTest as CC0; it is CC-BY-4.0** (AGI, Ed Mackey), recorded
  correctly in `ATTRIBUTION.md`.
- **`chromium.launch()` must pass `channel: "chromium"`** for any WebGPU run (the headless shell has
  no compositor and loses the device after two or three frames); every ad-hoc harness must copy it.

## 13. Wave 2 outcome (2026-09-08)

Twenty-four kit examples and the four templates are in the catalogue — every P0 row of `04` §7 plus
`rebinding` (P1) — each with three poster formats under 120 KB, a `GOLDENS` row, and a
`frameTime.examples` row measured at 1280×720 on SwiftShader. Own chunks run 1–20 KB gzipped
(`audio-mixer` is the largest, being the only example that pulls `@ignifx/audio`); the shared vendor
chunk is 329–336 KB gzipped; Rapier is a separate 786 KB chunk imported only by the three 2D-physics
examples. Sample assets total 9,029,839 bytes across 37 files, every one attributed with a digest;
licences confirmed from each source's own metadata on 2026-09-08. Three engine fixes landed with
changesets: the `Environment` runtime swap (§9.2 note above), sprite-mode `clearColor`, extension
public assets in the manifest (and one Havok wasm per build), and the `IGX-0706` camera probe.

Deviations accepted beyond §10–§12:

- **Copy corrected against the engine.** The features page said the 3D `CharacterController` does
  "slopes, steps, snap-to-ground"; Lite's controller has neither steps nor snap. The line now reads
  "collide-and-slide, a slope limit, support detection and body pushing"; the missing features are
  wishlist row W-R31. Plan `03` §3.5 carries the correction.
- **`shadows` reloads its frame to change technique**, **`tone-mapping` is an A/B flip**, and the
  **`ibl` switch** is explained in §12; each page says so.
- **Art choices.** `sprite-animation` and `platformer-controller` use the repository's own
  generated sheets (Kenney's platformer characters have two frames and no slopes); `tilemap` uses
  Kenney Tiny Town and `physics-2d` Kenney Pixel Platformer props, both CC0, cropped to the tiles
  used. `emissive-strength-test.glb`, `fox.glb` and `rig.glb` ship unmodified (compression grew or
  risked them). `ui-overlay` vendors the OFL Share Tech Mono fixture for `HudText`.
- **Slug-local documents** (`.input.json`, `.audio.json`, `.animator.json`, Tiled maps) live beside
  `main.ts` as source tabs and are parsed by the engine's own validators at runtime rather than by the
  Vite plugin (which validates only under the asset root).
- **Example length** runs 100–300 lines of `main.ts` with helpers split into sibling files listed
  in `sourceFiles`.
- **Frame-budget rows** were measured from scratch builds by their authors and are confirmed by the
  coordinator's `frame-budget` run at integration (below).

## 14. Integration gates and launch checklist (2026-09-08)

| Check (`06` §8 and §3)                                                 | Result                                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ignifx/website build`                                  | PASS — 54 pages, 28 examples, 16 guides; `dist/` 62 MB, one `HavokPhysics.wasm`                     |
| `pnpm --filter @ignifx/website test`                                   | PASS — 43 tests                                                                                     |
| Goldens (`playwright --project=goldens`, every spec)                   | PASS — 70 tests; 28 example goldens generated at 640×360, no committed golden changed               |
| Frame budgets (`--project=frame-budget --grep "website example"`)      | PASS — 24 examples inside their ceilings on the site build (medians 0.1–0.4 ms engine CPU)          |
| Every run page under the emitted `_headers` (coordinator's CSP probe)  | PASS — 28 of 28 `ready`, zero page errors, zero CSP violations, zero `IGX-` warnings                |
| Pages at 390/1440 in both themes, lazy posters scrolled into view      | PASS — zero horizontal overflow, zero broken images, every card has its poster                      |
| `pnpm check`                                                           | see the line appended below                                                                         |
| Reduced-motion and keyboard pass (site-shell agent, Chromium)          | PASS — `?autoplay=0` + Play; 16 focus stops with visible rings on a viewer page                     |
| `ATTRIBUTION.md` against upstream licences                             | PASS — 37 files, every digest matches disk, every licence confirmed from its source on 2026-09-08   |
| Press kit                                                              | zip built (52 entries) and deterministic; six screenshots and the social card present               |
| Cloudflare Pages settings, custom domain, preview deployments          | **owner** — build command `pnpm turbo run build --filter=@ignifx/website...`, output `website/dist` |
| Safari 26, Firefox, Chrome on Android, a no-WebGPU browser on hardware | **owner / hardware** — only Chromium (real and SwiftShader) was exercised here                      |
| Badge hot-linked from another origin; OG image in a link preview       | **after deploy** — the headers are asserted, the behaviour needs the live site                      |
| `site.published`                                                       | `false` (npm still serves the `0.0.0` placeholders); flips on release day                           |
| Repository public                                                      | **owner** — every GitHub link on the site is dead until it is                                       |
| Fact sheet "First release"                                             | release day                                                                                         |

**`pnpm check`, 2026-09-08, integrated tree:** PASS — build 21/21, format, lint (0 errors), typecheck
23/23, unit tests 3,957 in 283 files, API reports 34/34, docs harness 5/5 (`llms.txt`, recipes, schemas
and API pages regenerate to the committed bytes; 79 skill blocks compile, 49 run).
