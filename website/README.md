# ignifx.com (website)

The public site: a **prerendered static site** built by one Vite command and served as files. No
framework, no client-side router, no runtime. `ADR-0019` records why it is built this way and
`DESIGN.md` records how it looks and why.

```sh
pnpm --filter @ignifx/website build      # → website/dist, every route as an HTML file
pnpm --filter @ignifx/website test       # asserts the built output (run after build)
pnpm --filter @ignifx/website typecheck
pnpm --filter @ignifx/website preview    # serve dist locally
```

The site reads the repository at build time — `AGENTS.md`, `benchmarks/baselines.json`,
`packages/core/**`, the template and example `README.md` files, and every `SKILL.md` — and states
nothing that is not in one of them. It imports **no** `@ignifx/*` package, because Cloudflare builds
it from a fresh clone where none of them has been built.

## Layout

| Path        | What it is                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `scripts/`  | The build: the Vite plugin, the page renderers, Markdown → HTML, the skill tree, the fonts.     |
| `src/`      | What ships to the browser: `main.ts` (≈ 4 KB), `theme.ts`, and `styles/`.                       |
| `public/`   | Copied verbatim: `llms.txt`, `robots.txt`, `favicon.svg`, `_headers`, `_redirects`, `gallery/`. |
| `test/`     | Assertions over `dist/`: links, weight, contrast, headers, the no-third-party scan.             |
| `DESIGN.md` | The design plan — palette with measured contrast ratios, typography, layout, motion, IA.        |

`public/gallery/*.png` are copies of the visual suite's goldens
(`tests/visual/tests/__screenshots__/`). The gallery lays them out with `aspect-ratio: 16 / 9` and
`object-fit: cover`, so replacing a 512×288 capture with a 1280×720 one needs no change here.

## `public/llms.txt` and the `/skill/` routes

`public/llms.txt` is **generated** by `pnpm docs:llms` (`scripts/docs-llms.ts`) and must never be
hand-edited: the `docs-harness` job regenerates it and fails on a diff. It indexes the Agent Skill in
the `llms.txt` convention, with every URL relative to the site root under `/skill/`:

| Repository path                            | URL                              |
| ------------------------------------------ | -------------------------------- |
| `skills/ignifx/SKILL.md`                   | `/skill/`                        |
| `skills/ignifx/references/<dir>/<name>.md` | `/skill/references/<dir>/<name>` |
| `skills/ignifx/references/gotchas.md`      | `/skill/references/gotchas`      |
| `packages/<pkg>/skills/<name>/SKILL.md`    | `/skill/<name>/`                 |

`scripts/skill-tree.ts` re-implements that mapping (it cannot import `scripts/lib/llms-index.ts`
from a workspace that has not been built), the build **fails** when an `llms.txt` URL has no page,
and `test/site.test.ts` asserts the same thing over `dist/`. `README.md` pages under `references/`
are repository navigation and are not served.

## No third-party requests

`CONSTITUTION.md` §9.1: the site loads nothing from anywhere else and asks nothing of the network at
runtime. No analytics, no CDN, no web-font link — the three faces are `@fontsource-variable/*` npm
packages and their latin `woff2` subsets (102 KB in total) are copied into the build with their SIL
Open Font Licences under `/licenses/`. `public/_headers` sets `connect-src 'none'` and neither
`script-src` nor `style-src` carries `unsafe-inline`, so the build emits no inline `<script>`, no
`<style>` element and no `style` attribute. `test/site.test.ts` scans the built output for all of it.

## Hosting (Cloudflare Pages)

The site is hosted on **Cloudflare Pages**, connected directly to this repository and built by
Cloudflare on every push to `main`. `.github/workflows/website.yml` checks the build; it does not
deploy.

| Pages setting          | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| Production branch      | `main`                                                                            |
| Framework preset       | None                                                                              |
| Build command          | `pnpm --filter @ignifx/website build`                                             |
| Build output directory | `website/dist`                                                                    |
| Root directory         | `/` (the repository root — the build must run there so pnpm sees the workspace)   |
| Node version           | From `.nvmrc` (24). Set `NODE_VERSION=24` as well if the preset ignores the file. |
| Package manager        | From `packageManager` in the root `package.json` (pnpm 11.17.0), via corepack     |

**Environment variables.** Set both in the Pages project:

| Variable                        | Value | Why                                                                                                                                                                |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1`   | `electron` is an allowed build script (`pnpm-workspace.yaml`) for the desktop templates. Without this, every Pages build downloads a ~100 MB binary it never runs. |
| `NODE_VERSION`                  | `24`  | Belt and braces with `.nvmrc`; dependency-cruiser and the toolchain are pinned to Node 24.                                                                         |

Pages serves `dist/404.html` for anything that does not match a file, applies `dist/_headers` for
response headers and `dist/_redirects` for the three aliases. `/assets/*` is content-hashed and
served `immutable`; HTML is `max-age=0, must-revalidate`.

## The build, in one paragraph

`vite build` has two JavaScript entries and no HTML entry, so Vite's HTML pipeline — and the inline
module-preload polyfill it injects, which the CSP would refuse — never runs. The `ignifx-site` plugin
renders every route in `generateBundle`, once Rollup has hashed `assets/main-<hash>.js` and
`assets/style-<hash>.css`, and emits the pages, the fonts, a generated stylesheet (the `@font-face`
rules plus one class per Shiki token colour), `sitemap.xml`, `404.html`, and `search-index.js`.
Markdown is rendered with `marked` and highlighted with `shiki` at build time; `src/main.ts` only
enhances a page that is already complete — a theme toggle, a copy button per code block, and a search
dialog over the skill.
