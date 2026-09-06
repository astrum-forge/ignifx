# ignifx.com (website)

Public site for ignifx: a plain Vite + TypeScript single-page application, hosted separately from the engine packages (own deploy workflow `website.yml`). The Phase 0 shell exists — `index.html`, a DOM-only placeholder page in `src/`, and `public/llms.txt`, `public/robots.txt`, `public/favicon.svg` — with visual design deferred by decision; Phase 11 populates `public/llms.txt` with generated references for agents and Phase 12 adds content pages (features, getting started, docs links, gallery).

Not a workspace package that is published; it consumes `@ignifx/*` from the workspace for live demos once those exist.

## Commands

`pnpm --filter @ignifx/website dev` · `build` · `preview` · `typecheck`. The site makes no third-party requests: no analytics, no web fonts, no CDN (`CONSTITUTION.md` §9.1).

## Hosting

The site is hosted on Cloudflare Pages, connected to this repository and built on every push to
`main`. Pages settings: build command `pnpm --filter @ignifx/website build` (run from the repository
root), output directory `website/dist`, Node from `.nvmrc`. The output is static; add
`public/_redirects` for SPA routes and `public/_headers` for security headers when the site gains
content (Phase 12 of `docs/plan/engineering-plan.md`).
