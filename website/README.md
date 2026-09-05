# ignifx.com (website)

Public site for ignifx: a plain Vite + TypeScript single-page application, hosted separately from the engine packages (own deploy workflow `website.yml`). The Phase 0 shell exists — `index.html`, a DOM-only placeholder page in `src/`, and `public/llms.txt`, `public/robots.txt`, `public/favicon.svg` — with visual design deferred by decision; Phase 11 populates `public/llms.txt` with generated references for agents and Phase 12 adds content pages (features, getting started, docs links, gallery).

Not a workspace package that is published; it consumes `@ignifx/*` from the workspace for live demos once those exist.

## Commands

`pnpm --filter @ignifx/website dev` · `build` · `preview` · `typecheck`. The site makes no third-party requests: no analytics, no web fonts, no CDN (`CONSTITUTION.md` §9.1).
