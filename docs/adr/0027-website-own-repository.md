# ADR-0027 · The website moves to its own repository

**Status:** Accepted · **Date:** 2026-10-04 · **Deciders:** Astrum Forge Studios (owner)
**Supersedes in part:** ADR-0019 (the site lives at `website/` in this repository; `website.yml`; `llms.txt` generated here) and ADR-0020 (the site builds the workspace). The site's own design decisions in both move with it.

## Context

ignifx.com lived at `website/` as a workspace member. Since ADR-0020 it built the workspace packages, read `skills/`, `templates/` and `packages/core/package.json` from the tree, and the engine in turn imported its example catalogue into `tests/visual` and generated its `llms.txt`. A site change ran engine CI, an engine change could break the site, and the site's build-only dependencies sat in the engine's catalog and lockfile.

The packages, the skills and the templates are all published to npm (`ignifx` ships `skills/ignifx`, each `@ignifx/*` ships its subsystem skill, `@ignifx/cli` ships `templates/`), so the site no longer needs the source tree to show what a user installs.

## Options considered

1. Keep the site in the workspace — one repository, but the coupling above stays.
2. Move it to its own repository and pin the engine as a git submodule — reproducible, but a private submodule complicates the Cloudflare Pages build.
3. Move it to its own repository and build it from the published npm packages — the site shows exactly what a user can install; it lags `main` until a release.

## Decision

Option 3. The site lives in `astrum-forge/ignifx-website` and depends on the published `ignifx` and `@ignifx/*` packages. This repository has no `website/` directory, no `website.yml`, no `docs:llms` generator, and no visual goldens or frame budgets for the site's examples.

## Consequences

- Engine CI no longer builds or checks the site, and the website-only build tools leave the catalog and lockfile.
- The site documents the latest release, not `main`. An engine change reaches it through a publish and a dependency bump.
- The site's runnable examples lose their goldens (`tests/visual/tests/examples.spec.ts`) and frame budgets (`frameTime.examples` in `benchmarks/baselines.json`). The templates keep theirs. Coverage for the examples, if wanted, belongs in the website repository.
- `llms.txt` is no longer regenerated from this tree; the website repository owns it.
