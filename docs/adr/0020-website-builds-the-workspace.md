# ADR-0020 · The site builds the workspace to run the examples

**Status:** Accepted · **Date:** 2026-09-07 · **Deciders:** Astrum Forge Studios (owner), website build coordinator
**Supersedes in part:** ADR-0019 §1 ("imports **no workspace package**"), §2 ("no inline script"), §3's route list, and the "Impossible for now" paragraph of its Consequences. Everything else in ADR-0019 stands.
**Related:** `CONSTITUTION.md` §9.1 (no third-party requests), §9.2 (the Electron security baseline), §1.5 (the name) · `docs/architecture/16-docs-harness-and-skill.md` §3 · `website/plan/06-engineering.md` §2, `website/plan/08-execution.md` §4

---

## Context

ADR-0019 built ignifx.com as a prerendered static site that imports nothing from the workspace,
because Cloudflare Pages clones the repository, runs `pnpm install`, then runs **one** build command,
and at that moment no `@ignifx/*` package has been built. Its Consequences recorded the price:

> **Impossible for now.** Live engine demos on the marketing pages. The site is WebGPU-free by
> construction… The gallery shows the visual suite's golden captures instead.

The overhaul planned in `website/plan/` reverses that priority. The site's job is to make a developer
want to build on ignifx, and the single most persuasive thing it can do is run the engine in the
visitor's browser, three.js style, with the source beside it (`01-strategy-and-ia.md` §1). A poster
cannot do that.

Four facts constrain how:

1. **The examples must be built by the workspace.** An example imports `ignifx` and
   `@ignifx/devtools` and is bundled by `@ignifx/vite-plugin`, which generates its asset manifest and
   validates its JSON. There is no way to run an ignifx app without the packages.
2. **Turborepo can order the build.** `pnpm turbo run build --filter=@ignifx/website...` builds the
   dependencies first. This is still **one** command, which is all the Cloudflare requirement asked
   for; ADR-0019 read "one command" as "one command that needs nothing built", which was stricter
   than the constraint.
3. **`@ignifx/ui` and `@ignifx/devtools` install their stylesheets by appending a `<style>` element**
   (`packages/ui/src/dom/styles.ts`, `packages/devtools/src/dom/styles.ts`). A policy with
   `style-src 'self'` and no `unsafe-inline` drops those rules and the overlays render unstyled.
   `packages/electron/src/main/csp.ts` already allows `'unsafe-inline'` for **styles, and only
   styles**, for exactly this reason, and the engine is tested against that policy
   (`CONSTITUTION.md` §9.2).
4. **The sixty-two rendered skill pages are in the way.** They are the "agentic stuff" the brief asks
   to keep off the visitor's site; two of them are 1.6 MB and 609 KB of generated Markdown and were
   the only routes that could not meet the page-weight budget; and the repository already serves the
   same files, which `npx skills add astrum-forge/ignifx` distributes.

## Options considered

1. **Keep ADR-0019 and ship posters only.** No build change, no CSP change, no new dependency.
   Rejected: it is the status quo the overhaul exists to replace, and a static gallery is exactly the
   thing every competing engine's site beats.
2. **Build the examples in CI and commit their `dist/` under `website/public/`.** Keeps the site's
   build independent of the workspace (ADR-0019's own suggested escape hatch). Rejected: it commits
   several megabytes of hashed build output per change, makes every engine change a two-pull-request
   dance, and the committed bundle is unverifiable against the source at review time.
3. **A second Cloudflare build command.** Rejected by the owner requirement, and unnecessary.
4. **Build the workspace first with a turbo filter.** Chosen.

## Decision

### 1. The site depends on the workspace, and one command still builds it

`website/package.json` declares `ignifx` as a dependency and `@ignifx/vite-plugin` as a
devDependency. `pnpm --filter @ignifx/website build` runs three steps in order — the site, the
examples, the templates (`08-execution.md` §4.1) — and the **Cloudflare build command becomes**

```
pnpm turbo run build --filter=@ignifx/website...
```

with output directory `website/dist`, `NODE_VERSION=24` and `ELECTRON_SKIP_BINARY_DOWNLOAD=1`
unchanged. `.github/workflows/website.yml` runs the same command, and its `paths` filter gains
`packages/**`, `examples/**`, `templates/**` and `tests/visual/**`, because an engine change can now
break the site.

The site build still reads the repository for everything it **states** — the version from
`packages/core/package.json` through `website/site.config.ts`, the "First app" sample from
`skills/ignifx/SKILL.md`, the sixteen recipes, the catalogue — and still fails rather than shipping a
claim the tree does not back. What changed is only that the _examples_ are compiled code rather than
committed pictures.

### 2. The example frames get `style-src 'unsafe-inline'`; the site pages do not

`_headers` is emitted by the build from `website/headers.txt` (§4 below) and carries three policies:

- **Site pages (`/*`)**: unchanged from ADR-0019 §2, plus the JSON-LD hash on `script-src` (§3).
  No `unsafe-inline` for scripts or for styles, anywhere.
- **Example frames (`/examples/*run/`)**: the policy below. `'wasm-unsafe-eval'` is Havok, Rapier and
  Recast; `'unsafe-inline'` is for **styles only**, following the `cspFor` precedent in
  `packages/electron/src/main/csp.ts`. Scripts are never allowed inline, not even in a frame.
  `connect-src` admits `data:` because Babylon Lite inlines Recast's WebAssembly as a `data:` URL
  that Emscripten loads with `fetch`; without it a navmesh bake fails only on the deployed site.

  ```
  default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
  ```

- **`/press/badges/*`**: `Access-Control-Allow-Origin: *` and a one-day cache, because those URLs are
  the one thing on the site that other sites hot-link (`05-press-kit.md` §4).

Cloudflare Pages applies **every** matching rule and comma-joins a repeated header, and a pattern may
hold only **one** splat. So a rule that needs a different value detaches the one `/*` set with
`! Header-Name` first, and the frame policy is matched as `/examples/*run/` rather than the plan's
`/examples/*/run/*`. `website/test/site.test.ts` asserts that no catalogue slug ends in `run`, so the
pattern cannot catch a viewer page by accident.

### 3. One inline script is allowed: the JSON-LD block, by hash

Search results are materially better with an `Organization` plus `SoftwareSourceCode` block, and
`<script type="application/ld+json">` is an inline script. The block is a constant in
`website/scripts/layout.ts`, byte-identical on every page; the build computes its SHA-256 and
substitutes it into `script-src` in the emitted `_headers`. The test asserts that the hash in
`_headers` is the hash of the block the pages actually carry, and that no page has any other inline
script. This is the whole of the amendment to ADR-0019 §2.

### 4. `_headers` and `_redirects` are build output

They move out of `public/` — which Vite copies **after** the bundle is written, and would overwrite an
emitted file — into `website/headers.txt` and `website/redirects.txt`, and the build emits the final
files. Both need something only the build knows: the JSON-LD hash, and one redirect per Agent Skill
file.

### 5. The site serves no skill page

The sixty-two `/skill/**` routes are removed. `pnpm docs:llms` now writes **absolute** URLs into
`website/public/llms.txt` (`https://github.com/astrum-forge/ignifx/blob/main/<path>`), and
`_redirects` sends every retired route to the same file: one explicit line per skill file, generated
from the tree, then `/skill/references/*` and `/skill/*` splat rules as a safety net, then the
`/docs/skill/*` alias. The build's assertion changes from "every `llms.txt` URL has a page" to "every
`llms.txt` URL is an absolute link into this repository and the file exists in the working tree".

The site's own search went with them (`08-execution.md` §2, decision 4): it indexed the skill, the
site now has under fifty pages, and the category chips and the docs hub are enough at that size.

### 6. Build-time dependencies

`website/package.json` gains, all as `devDependencies`, all MIT or Apache-2.0, none with an install
script, none reaching the browser: `sharp` (poster and PNG export), `fontkit` (glyph outlines for the
wordmark and badges), `fflate` (the press-kit zip), `@gltf-transform/{core,extensions,functions}` and
`meshoptimizer` (sample-model compression), `playwright` (poster capture) and `@webgpu/types`. The
runtime dependency is `ignifx`; `@ignifx/vite-plugin` is a devDependency
(`CONSTITUTION.md` §9.3 justification: each is used by a build step named in `08-execution.md` §2).

## Consequences

**Easier.** The site can show the engine running, which is the point of the overhaul. The examples are
real source in the repository, reviewed like any other code, captured by the visual suite and held to
a frame-time budget — so a page can no longer promise something the engine does not do. Adding an
example is adding a directory and a catalogue entry.

**Harder.** A cold Cloudflare build now compiles thirteen packages plus the examples and the four
templates, and takes minutes rather than seconds; the Pages build timeout may need raising. An engine
change can break the site, which is why `website.yml`'s path filter widened. The example frames run on
a looser policy than the pages that embed them, so the two blocks must be read together — and if a
package can be fixed to stop appending a `<style>` element, the frame block should tighten again.

**Impossible.** Building the site from a clone that has not built the workspace. `pnpm --filter
@ignifx/website build` alone now fails on an unbuilt tree; `pnpm turbo run build
--filter=@ignifx/website...` is the command everywhere, including in the README's hosting table.

**How to revisit.** If the Pages build time becomes the problem, the cheapest step is a turbo filter
that skips the desktop template builds, then Cloudflare's build cache over `node_modules/.cache`. If
the frame CSP becomes the problem, the fix belongs in `@ignifx/ui` and `@ignifx/devtools` — a
constructable stylesheet or a hashed `<link>` — not in a looser policy here.
