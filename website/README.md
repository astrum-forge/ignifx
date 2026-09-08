# ignifx.com (website)

The public site: a **prerendered static site** built by one command and served as files. No
framework, no client-side router, no runtime. It shows the engine running — every example on the site
is a real ignifx app, built from source in this repository and embedded in an `<iframe>`.

`ADR-0019` records why the site is built as a Vite plugin that writes HTML; **`ADR-0020`** records the
two things that changed when the examples arrived (the build depends on the workspace, and the example
frames get their own Content-Security-Policy). `plan/02-design-system.md` is the design system and
`plan/08-execution.md` is the decisions log.

```sh
pnpm turbo run build --filter=@ignifx/website...   # the whole thing: packages, then the site
pnpm --filter @ignifx/website test                 # asserts the built output (run after a build)
pnpm --filter @ignifx/website typecheck
pnpm --filter @ignifx/website dev                  # the site, on Vite's dev server
pnpm --filter @ignifx/website dev:examples         # the examples, at /examples/<slug>/
pnpm --filter @ignifx/website preview              # serve dist locally
pnpm --filter @ignifx/website press-kit            # regenerate public/press/** (output committed)
```

While the examples' posters or the press kit are still being produced, `pnpm --filter
@ignifx/website exec vite build --mode development` turns the build's "this claim has nothing behind
it" errors into warnings. A production build never does.

## What the build reads, and what it refuses to say

Every fact on the site comes out of the tree at build time: the version from
`packages/core/package.json` (through `site.config.ts`), the "First app" sample from
`skills/ignifx/SKILL.md`, the sixteen guides from `skills/ignifx/references/recipes/`, the example
catalogue from `examples/catalogue.ts`, the sample-asset credits from
`examples/assets/ATTRIBUTION.md`, and the press files from `public/press/`. A **production** build
fails when the tree cannot back a page:

- a catalogue entry with no directory, no first source file, or no poster in all three formats;
- a recipe with no group in `scripts/repo-content.ts`;
- a missing `ATTRIBUTION.md`;
- a press file the page lists;
- an `llms.txt` URL that is not an absolute link to a file in the working tree.

## Layout

| Path             | What it is                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `site.config.ts` | Release state (`published`), the version, and every GitHub and npm URL. Nothing else hard-codes one.     |
| `scripts/`       | The build: the Vite plugin, the page renderers, the copy tables, the icon sprite, Markdown, fonts.       |
| `src/`           | What ships to the browser: `main.ts`, `viewer.ts` (a chunk), `theme.ts`, and `styles/`.                  |
| `examples/`      | The runnable examples: `catalogue.ts`, the shared `_kit/`, one directory per example, `assets/`.         |
| `press/`         | The press-kit generator; its output is committed under `public/press/`.                                  |
| `public/`        | Copied verbatim: `llms.txt`, `robots.txt`, `favicon.svg`, `examples/<slug>.{png,webp,avif}`, `press/**`. |
| `headers.txt`    | Template for `dist/_headers`. The build substitutes the JSON-LD hash.                                    |
| `redirects.txt`  | Template for `dist/_redirects`. The build appends one line per Agent Skill file.                         |
| `test/`          | Assertions over `dist/`: routes, links, weight, contrast, headers, the no-third-party scan.              |
| `plan/`          | The overhaul plan: strategy, design system, copy, examples, press kit, engineering, execution.           |

`_headers` and `_redirects` are **not** in `public/`: Vite copies `public/` after the bundle is
written and would overwrite the emitted file.

## Routes

Twelve fixed routes, plus one page per catalogue example and one per guide:

```
/                          /features/                 /examples/
/examples/<slug>/          /examples/<slug>/run/      /examples/attribution/
/docs/                     /docs/getting-started/     /docs/guides/
/docs/guides/<name>/       /docs/browser-support/     /press/
404.html  ·  sitemap.xml  ·  robots.txt  ·  llms.txt  ·  _headers  ·  _redirects
```

`/examples/<slug>/` is the viewer page the site shell writes; `/examples/<slug>/run/` is the example's
own build, which the viewer embeds and which also opens standalone. Everything else is a page from
`scripts/pages-*.ts`. Adding a route is adding a function and one `add(…)` call in `scripts/site.ts`.

## The build, in three steps

`pnpm --filter @ignifx/website build` runs:

1. **`vite build`** — the site. Two JavaScript entries and no HTML entry, so Vite's HTML pipeline —
   and the inline module-preload polyfill it injects, which the CSP would refuse — never runs. The
   `ignifx-site` plugin renders every page in `generateBundle`, once Rollup has hashed
   `assets/main-<hash>.js` and `assets/style-<hash>.css`, and emits the pages, the fonts and their
   licences, a generated stylesheet (the `@font-face` rules plus one class per Shiki token colour),
   `sitemap.xml`, `404.html`, `_headers` and `_redirects`. This step empties `dist/`.
2. **`vite build --config examples/vite.config.ts`** — every kit example, into `dist/examples/` with
   `emptyOutDir: false`. Rollup shares Babylon Lite between them.
3. **`node examples/_tools/build-templates.ts`** — each template that has a catalogue entry, built
   from `templates/<name>` into `dist/examples/<name>/run/`.

Markdown is rendered with `marked` and highlighted with `shiki` at build time. `src/main.ts` only
enhances a page that is already complete: the theme toggle, the copy buttons, the WebGPU support pill,
the gallery filter, the source tabs, and — dynamically imported, on the home page and the viewer pages
only — the `postMessage` bridge in `src/viewer.ts`.

## `llms.txt` and the retired `/skill/**` routes

`public/llms.txt` is **generated** by `pnpm docs:llms` (`scripts/docs-llms.ts`) and must never be
hand-edited: the `docs-harness` job regenerates it and fails on a diff. Since ADR-0020 every URL in it
is an **absolute link to the file in this repository**, and the site renders no skill page:

| Repository path             | URL in `llms.txt`                                                    |
| --------------------------- | -------------------------------------------------------------------- |
| any skill or reference file | `https://github.com/astrum-forge/ignifx/blob/main/<repository path>` |

`scripts/skill-tree.ts` keeps the retired route → repository-path mapping for one purpose: generating
the `_redirects` block, one line per file, so every `/skill/…` URL an agent already holds lands on the
same document. The build fails when an `llms.txt` URL does not resolve to a file in the working tree,
and `test/site.test.ts` asserts the same thing.

## No third-party requests

`CONSTITUTION.md` §9.1: the site loads nothing from anywhere else and asks nothing of the network at
runtime. No analytics, no CDN, no web-font link — the three faces are `@fontsource-variable/*` npm
packages and their latin `woff2` subsets (102 KB in total) are copied into the build with their SIL
Open Font Licences under `/licenses/`.

Three policies are emitted from `headers.txt`:

| Rule              | Policy                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/*`              | `connect-src 'none'`, `frame-ancestors 'none'`, `style-src 'self'`, `script-src 'self' 'sha256-…'` — the one JSON-LD block, by hash.     |
| `/examples/*run/` | `script-src 'self' 'wasm-unsafe-eval'` (Havok, Rapier, Recast) and `style-src 'self' 'unsafe-inline'` for `@ignifx/ui`'s injected sheet. |
| `/press/badges/*` | `Access-Control-Allow-Origin: *` and a one-day cache: other sites hot-link these.                                                        |

Cloudflare applies **every** matching rule and comma-joins a repeated header, so a rule that needs a
different value detaches the `/*` one with `! Header-Name` first; and a pattern may hold only one
splat, which is why the frame rule is `/examples/*run/` rather than `/examples/*/run/*`.
`test/site.test.ts` scans the built output for all of it, run pages included.

## Release gating

`site.config.ts` holds `published: false`. Every install surface, the header npm button, the footer
npm row and the footer version chip branch on it (`plan/03-pages-and-copy.md` §8). Flipping that one
line is the release-day step; `test/site.test.ts` asserts that no page links to npmjs.com while it is
`false`.

## Budgets

| Budget                                  | Value  |
| --------------------------------------- | ------ |
| Route weight (HTML + CSS + site JS, gz) | 120 KB |
| Site JavaScript, gzipped                | 30 KB  |
| Fonts                                   | 120 KB |
| Poster, per format per example          | 120 KB |
| Example own chunk, gzipped              | 60 KB  |

## Hosting (Cloudflare Pages)

The site is hosted on **Cloudflare Pages**, connected directly to this repository and built by
Cloudflare on every push to `main`. `.github/workflows/website.yml` checks the build; it does not
deploy.

| Pages setting          | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Production branch      | `main`                                                                             |
| Framework preset       | None                                                                               |
| Build command          | `pnpm turbo run build --filter=@ignifx/website...`                                 |
| Build output directory | `website/dist`                                                                     |
| Root directory         | `/` (the repository root — the build must run there so pnpm sees the workspace)    |
| Node version           | From `.nvmrc` (24). Set `NODE_VERSION=24` as well if the preset ignores the file.  |
| Package manager        | From `packageManager` in the root `package.json` (pnpm 11.17.0), via corepack      |
| Build timeout          | Raise it if the first preview hits the default: the build now compiles the engine. |

**Environment variables.** Set both in the Pages project:

| Variable                        | Value | Why                                                                                                                                                                |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1`   | `electron` is an allowed build script (`pnpm-workspace.yaml`) for the desktop templates. Without this, every Pages build downloads a ~100 MB binary it never runs. |
| `NODE_VERSION`                  | `24`  | Belt and braces with `.nvmrc`; dependency-cruiser and the toolchain are pinned to Node 24.                                                                         |

Pages serves `dist/404.html` for anything that does not match a file, applies `dist/_headers` for
response headers and `dist/_redirects` for the aliases. `/assets/*` and `/examples/assets/*` are
content-hashed and served `immutable`; HTML is `max-age=0, must-revalidate`.
