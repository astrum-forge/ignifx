# 06 · Engineering hand-over

What changes in the build, what stays, what the tests must assert, the work breakdown, the launch
checklist, and the decisions the owner still has to make.

## 1. What stays exactly as it is

- One Vite build, every route prerendered to a file, no client-side router, no framework
  (ADR-0019 §1). Adding a page is still adding a function and a route.
- No inline `<script>`, no `<style>` element, no `style` attribute in site pages; Shiki classes, a
  real `/theme.js` (ADR-0019 §2).
- No third-party request at runtime, anywhere on the site, including inside the example frames
  (`CONSTITUTION.md` §9.1). The test that scans `dist/` for off-origin references stays and now
  covers `dist/examples/**`.
- The three self-hosted faces, their subsets and their licences under `/licenses/`.
- Cloudflare Pages, connected to the repository, building `main`; `website.yml` checks and does not
  deploy.
- `test/site.test.ts` as the definition of correct output: links resolve, sitemap complete, headers
  parse, landmarks and alt text present, token pairs clear AA, budgets hold.

## 2. What changes

### 2.1 The build depends on the workspace

The examples import `ignifx`, `@ignifx/devtools` and build with `@ignifx/vite-plugin`, so the site
can no longer build from an unbuilt clone. Changes:

- `website/package.json` gains `ignifx`, `@ignifx/devtools`, `@ignifx/vite-plugin` as
  `workspace:*` dependencies, and its `build` script becomes `pnpm build:examples && vite build`
  (`build:examples` = `vite build --config examples/vite.config.ts`).
- The Cloudflare **build command** becomes `pnpm turbo run build --filter=@ignifx/website...`
  (the `...` suffix builds dependencies first). Root directory, output directory, Node 24 and
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1` are unchanged. Expect the build to take several minutes; raise
  the Pages build timeout if the default is hit.
- `website.yml` runs the same command, and its `paths` filter gains `packages/**`, `examples/**`
  and `tests/visual/**`, because an engine change can now break the site.
- **ADR-0020** records this: "The site builds the workspace to run the examples", superseding
  ADR-0019 §1's "imports no workspace package" and Consequences. Everything else in ADR-0019
  stands.

### 2.2 Headers

`public/_headers` gains two blocks. The site-wide block is unchanged.

```
# Example frames: same-origin asset fetches, WebAssembly (Havok, Rapier, Recast), embeddable by our own pages.
/examples/*/run/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
  Cross-Origin-Opener-Policy: same-origin
  Cache-Control: public, max-age=0, must-revalidate

# Badges are hot-linked by other sites.
/press/badges/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
```

Start from the Electron template's `cspFor` policy, which the engine is already tested against
(`CONSTITUTION.md` §9.2), and tighten from there. If `@ignifx/ui` or `@ignifx/devtools` turns out to
set `style` attributes through `setAttribute`, fix it in the package rather than adding
`unsafe-inline` here. Assets under `/examples/assets/` and the hashed chunks keep the `immutable`
rule.

### 2.3 Routes, redirects and the skill pages

- Routes: the map in `01-strategy-and-ia.md` §7. The `/skill/**` tree is removed.
- `_redirects` gains the five rules in `01` §7. Cloudflare Pages supports absolute targets, so
  `/skill/* https://github.com/astrum-forge/ignifx/blob/main/skills/ignifx/:splat 301` is one line;
  the subsystem skills (`/skill/2d/` → `packages/2d/skills/2d/SKILL.md`) need one line each, nine in
  total, generated from the same tree `docs:llms` reads.
- `scripts/docs-llms.ts` emits absolute GitHub URLs. `website/scripts/skill-tree.ts` and the
  "every llms.txt URL has a page" assertions in `site.ts` and `site.test.ts` are replaced by "every
  llms.txt URL is an absolute URL into the repository and the file exists in the working tree".
  `docs/architecture/16-docs-harness-and-skill.md` §3 gets a two-line amendment.
- Search (`src/search.ts`) indexed the skill; it now indexes examples and guides, or is removed if the
  index is under thirty entries. Recommendation: remove it; the category chips and the docs hub are
  enough at this size.

### 2.4 Budgets

| Budget                                      | Value                                                  | Applies to                                                          |
| ------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Route weight, HTML + CSS + site JS, gzipped | 120 KB                                                 | Every site page (unchanged)                                         |
| Site JavaScript                             | 30 KB gzipped (was 20)                                 | `main.js`; the viewer bridge and the WebGPU check are the additions |
| Fonts                                       | 120 KB (unchanged)                                     |                                                                     |
| Example own chunk                           | 60 KB gzipped                                          | Per example, excluding vendor                                       |
| Shared vendor chunk                         | Recorded, not capped; alarm at ×1.1 like the templates | Babylon Lite and friends                                            |
| Example assets                              | 4 MB per file, 48 MB total at launch                   | `examples/assets/`                                                  |
| Posters                                     | 120 KB per format per example                          | AVIF/WebP/PNG                                                       |
| Frame time                                  | 4 ms median at 1280×720 on CI                          | Per example                                                         |

The two generated API pages that broke the route budget by construction are gone with the skill tree,
so the budget has no exceptions any more.

### 2.5 Metadata, SEO, social

- Per-page `<title>` and `<meta name="description">` from `03-pages-and-copy.md`; canonical link;
  `og:title`, `og:description`, `og:image` (`/press/ignifx-social-1200x630.png`), `og:type`,
  `twitter:card=summary_large_image`.
- `sitemap.xml` lists every route including examples and guides; `robots.txt` unchanged.
- Structured data: an `Organization` and a `SoftwareSourceCode` JSON-LD block would help search
  results, but `<script type="application/ld+json">` is an inline script and the CSP refuses it.
  Either add its SHA-256 to `script-src` (the build can compute it) or omit it. Recommendation: add
  the hash; it is one static block.
- Analytics: Cloudflare Pages' server-side analytics, enabled in the dashboard. No script.

### 2.6 Release gating

`website/site.config.ts`:

```ts
export const site = {
  published: false, // flip on the day the packages are on npm
  version: readCoreVersion(), // packages/core/package.json
  repo: "https://github.com/astrum-forge/ignifx",
  npm: "https://www.npmjs.com/package/ignifx",
} as const;
```

Every variant in `03` §8 branches on `site.published`. `site.test.ts` asserts that, when
`published` is false, no page links to npmjs.com.

## 3. Tests to add or change (`website/test/`)

- **Routes.** The new route list; every catalogue slug has a viewer page and a run page; every guide
  has a page; the old routes redirect (parse `_redirects`).
- **Examples.** `dist/examples/<slug>/run/index.html` exists for every `ready` slug; its scripts and
  assets are same-origin; the poster exists in three formats and is under budget; the catalogue has no
  slug without a directory and no directory without a slug.
- **Headers.** The three `_headers` blocks parse; the example block carries `frame-ancestors 'self'`
  and `wasm-unsafe-eval`; the badge block carries `Access-Control-Allow-Origin: *`.
- **llms.txt.** Every URL is absolute into the repository and its file exists.
- **Gating.** No npm link while `published` is false.
- **Contrast.** The two new tokens join the twelve pairs.
- **Existing** checks continue unchanged.

Browser-level checks live in `tests/visual/tests/examples.spec.ts` (posters and goldens) and a new
`viewer.spec.ts` that opens one viewer page, waits for `ignifx:ready`, presses Pause, and asserts the
stats stop.

## 4. Work breakdown

Estimates are engineer-days of coordinated effort, ±40%, in the plan's convention. Each milestone
ends in a state that could ship.

| #   | Milestone                     | Work                                                                                                                                                                                                             | Days | Done when                                                                                     |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------- |
| 1   | **Foundation**                | ADR-0020; workspace dependency and build command; `site.config.ts`; the new route table with placeholder pages; redirects; `llms.txt` retargeted; tests updated; `DESIGN.md` replaced by a pointer to this plan. | 3    | Cloudflare preview builds green with the new command; old URLs redirect.                      |
| 2   | **Design system**             | Tokens, type, spacing, the component set from `02` §3, both themes, icons, header and footer.                                                                                                                    | 4    | A style page (not routed) shows every component in both themes; AA test passes.               |
| 3   | **Examples kit and pipeline** | `_kit/*`, the multi-page example build, the bridge, the fallback panel, the capture spec, poster script, budgets, the attribution page generator.                                                                | 5    | `hello-cube` runs at `/examples/hello-cube/` with source pane, stats, pause and poster.       |
| 4   | **Launch examples**           | The sixteen P0 examples plus the four templates as example pages; assets sourced, compressed, attributed.                                                                                                        | 12   | Every P0 row is `ready`, captured, under budget, reviewed on touch and gamepad.               |
| 5   | **Pages and copy**            | Home, features, examples index, docs hub, getting started, browser support, guides (from the recipe generator), 404, metadata.                                                                                   | 4    | Copy matches `03` verbatim; every link resolves; gated variants switch with the flag.         |
| 6   | **Press kit**                 | Wordmark outlines, lockups, badges, PNG exports, zip script, screenshots, the page, the header rules.                                                                                                            | 3    | The zip downloads; badges hot-link from another origin; the page shows every file it ships.   |
| 7   | **Polish and launch**         | Performance pass on the hero; reduced-motion path; accessibility pass with a screen reader; OG image; Pages settings; the checklist in §8.                                                                       | 3    | Checklist complete; owner sign-off.                                                           |
|     | **Total**                     |                                                                                                                                                                                                                  | 34   | About seven weeks for one engineer, four with two (examples parallelise cleanly by category). |

Engine follow-ups from `04` §8 are not in this total.

## 5. Suggested file ownership if agents build it

The repository's coordination lessons apply: one spike (milestone 3 by one agent), then fan-out by
directory. `website/examples/<category>/*` per agent; `website/scripts/*` and `website/src/*` owned
by one; `website/public/press/*` by one; copy pasted from `03` by whoever owns the page. The
coordinator runs `pnpm check`, the website tests and the visual suite before merging.

## 6. Risks

| Risk                                                      | Mitigation                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare build time or memory with the whole workspace  | Measure on the first preview; if needed, cache `node_modules/.cache` and skip the desktop templates' build with a turbo filter. |
| An engine change breaks an example and therefore the site | The visual goldens and `website.yml`'s wider path filter catch it in the pull request, not on `main`.                           |
| WebGPU missing for a large share of visitors              | The poster path sells without a canvas; the support pill explains; nothing on the page depends on the frame.                    |
| Sample asset licence recorded wrongly                     | Licence read from the asset's own metadata at download; recorded with the digest; reviewed at the launch checklist.             |
| Badge URLs change after other sites embed them            | `/press/badges/*` is declared stable in `05` and asserted by a test.                                                            |
| Search removal upsets a reader who used it                | The site has under fifty pages and a docs hub; revisit if analytics show `/docs/` bounce.                                       |

## 7. Open decisions for the owner

1. **Hero headline.** "Ignite your next game." (recommended) or the literal "The TypeScript game
   engine for WebGPU."
2. **Hero model.** Corset, BoomBox or SciFiHelmet, decided after KTX2 compression shows the sizes.
3. **Skill pages.** Remove and redirect to GitHub (recommended, §2.3) or keep them rendered but
   unlinked. Keeping them keeps the 1.6 MB page and the sixty-two routes.
4. **Search.** Remove (recommended) or re-index over examples and guides.
5. **Capitalisation.** Keep `CONSTITUTION.md` §1.5 (always lowercase, recommended; the copy is
   written for it) or amend it to allow "Ignifx" at sentence start.
6. **Structured data.** Hash one JSON-LD block into the CSP (recommended) or omit it.
7. **Launch timing.** Launch the new site before the first npm release in the pre-release variant
   (recommended: the examples and press kit stand on their own), or hold it for release day.
8. **Chrome for Android row** in the support table: confirm the version or drop the row.
9. **Which wishlist items to fund.** `07-wishlist.md` ranks them by usefulness and effort; the owner
   picks the ones that enter the engine backlog. None of them is required for launch.

## 8. Launch checklist

- [ ] `pnpm check`, `pnpm --filter @ignifx/website test`, `pnpm test:visual` green on `main`.
- [ ] Cloudflare Pages: build command updated, environment variables set, custom domain `ignifx.com`
      and `www` redirect configured, preview deployments enabled for pull requests.
- [ ] Every P0 example opened on: Chrome (macOS, Windows), Edge, Safari 26, Firefox 145 on Apple
      Silicon, Chrome on Android; a browser without WebGPU shows the poster and the pill.
- [ ] Reduced-motion and keyboard-only pass on the home page and one example page.
- [ ] `ATTRIBUTION.md` reviewed against each asset's upstream licence file.
- [ ] Press kit downloaded from the live site and opened; badge hot-linked from a test page on another
      origin.
- [ ] OG image renders in a link preview (Slack, X, Discord).
- [ ] `site.published` set correctly for the day; if true, `npm view ignifx` succeeds first.
- [ ] Fact sheet's first-release date filled in (release day only).
- [ ] `docs/plan/engineering-plan.md` "website launch content" line ticked.
