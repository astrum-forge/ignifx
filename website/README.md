# ignifx.com (website)

Public site for ignifx: a plain Vite + TypeScript single-page application, hosted separately from the engine packages (own deploy workflow `website.yml`). The Phase 0 shell exists — `index.html`, a DOM-only placeholder page in `src/`, and `public/llms.txt`, `public/robots.txt`, `public/favicon.svg` — with visual design deferred by decision; Phase 12 adds content pages (features, getting started, docs links, gallery).

Not a workspace package that is published; it consumes `@ignifx/*` from the workspace for live demos once those exist.

## `public/llms.txt` and the `/skill/` routes

`public/llms.txt` is **generated** by `pnpm docs:llms` (`scripts/docs-llms.ts`) and must never be
hand-edited: the `docs-harness` job regenerates it and fails on a diff. It indexes the Agent Skill
in the `llms.txt` convention, with every URL relative to the site root under `/skill/`:

| Repository path                            | URL                              |
| ------------------------------------------ | -------------------------------- |
| `skills/ignifx/SKILL.md`                   | `/skill/`                        |
| `skills/ignifx/references/<dir>/<name>.md` | `/skill/references/<dir>/<name>` |
| `skills/ignifx/references/gotchas.md`      | `/skill/references/gotchas`      |
| `packages/<pkg>/skills/<name>/SKILL.md`    | `/skill/<name>/`                 |

So the site owes those routes: `/skill/` and `/skill/<subsystem>/` render a `SKILL.md`, and
`/skill/references/<dir>/<name>` renders the matching Markdown page (no `.md` in the URL).
`README.md` pages under `references/` are repository navigation and are not served. Phase 12 builds
the pages; until then the file is the index and the links are the contract it has to keep.

## Commands

`pnpm --filter @ignifx/website dev` · `build` · `preview` · `typecheck`. The site makes no third-party requests: no analytics, no web fonts, no CDN (`CONSTITUTION.md` §9.1).

## Hosting

The site is hosted on Cloudflare Pages, connected to this repository and built on every push to
`main`. Pages settings: build command `pnpm --filter @ignifx/website build` (run from the repository
root), output directory `website/dist`, Node from `.nvmrc`. The output is static; add
`public/_redirects` for SPA routes and `public/_headers` for security headers when the site gains
content (Phase 12 of `docs/plan/engineering-plan.md`).
