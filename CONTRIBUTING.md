# Contributing to ignifx

ignifx is governed by written rules rather than convention. Read them before you write code; this
file only tells you how to get set up and what the loop looks like.

## Read first, in this order

Precedence when two documents disagree, highest first (`docs/README.md`, `CONSTITUTION.md` §10.1):

1. [`CONSTITUTION.md`](CONSTITUTION.md) — the rules, as numbered clauses you cite in review.
2. [`docs/standards/coding-standards.md`](docs/standards/coding-standards.md) — toolchain,
   TypeScript configuration, naming, testing, CI, pull requests.
3. [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md), then the document for
   the subsystem you are touching.
4. [`docs/adr/`](docs/adr/) — decisions, with the context that produced them.
5. [`docs/plan/engineering-plan.md`](docs/plan/engineering-plan.md) — what is being built now, and
   what is deliberately out of scope.
6. [`skills/ignifx/SKILL.md`](skills/ignifx/SKILL.md) — how to _use_ the engine.

## Prerequisites

| Need                 | Version            | How it is pinned                                                                                                                             |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js              | 24 LTS (`>=24.20`) | [`.nvmrc`](.nvmrc) and `engines` in `package.json`                                                                                           |
| pnpm                 | 11.x               | `packageManager` in `package.json`; install with `npm i -g pnpm@11` (CI installs it through `pnpm/action-setup`, which reads the same field) |
| Chrome / Chromium    | current            | Installed by Playwright (`pnpm exec playwright install chromium`); needed for the WebGPU browser tests                                       |
| A WebGPU-capable GPU | —                  | Only for running the browser tests locally; CI uses a software adapter                                                                       |

## Set up

```sh
git clone git@github.com:astrum-forge/ignifx.git
cd ignifx
pnpm install            # installs the workspace and the git hooks (lefthook)
pnpm check              # the full local gate; must be green before you push
```

`pnpm check` builds the workspace first (turbo-cached, so a no-op on a warm tree), then runs format
check, lint, typecheck, unit tests with coverage, the API report and the documentation harness — the
same things CI runs, in the same order (standards §12). The build is not optional: packages resolve
through `exports` to `dist/`, and on a fresh clone every `@ignifx/*` import is an `error` type
until it exists.

## Everyday commands

| Command                     | What it does                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                  | Runs the workspace's dev tasks                                                                    |
| `pnpm build`                | Builds every package with tsdown                                                                  |
| `pnpm test`                 | Vitest `node` project — headless unit tests on Babylon Lite's null engine                         |
| `pnpm test:browser`         | Vitest `browser` project — real Chromium with WebGPU, for GPU-touching code (`*.browser.test.ts`) |
| `pnpm typecheck`            | `tsc --build` across the project references                                                       |
| `pnpm lint` / `pnpm format` | Oxlint (+ ESLint for the gap rules) / oxfmt                                                       |
| `pnpm deps`                 | dependency-cruiser: no import cycles, and the package layering of `00-overview.md` §2.1           |
| `pnpm api-report`           | Regenerates `packages/*/api/*.api.md` — commit the result                                         |
| `pnpm docs:api`             | Regenerates the skill's API references — commit the result                                        |
| `pnpm changeset`            | Records a changeset for a user-visible change                                                     |

Visual regression tests (`tests/visual/`) and bundle-size baselines arrive in Phase 2; their CI
jobs exist today as placeholders so the required-check names are stable.

## The loop

1. **Branch.** `feat/<scope>-<topic>`, or `fix/`, `docs/`, `chore/`, `refactor/`, `perf/`, `test/`
   (standards §11). Branches are short-lived and merge into `main` (`CONSTITUTION.md` §7.1).
2. **Commit.** Conventional Commits, `type(scope): summary`. The scope is a package name and is
   validated by [`commitlint.config.ts`](commitlint.config.ts) — `core`, `input`, `physics`,
   `physics-2d`, `audio`, `2d`, `3d`, `ui`, `electron`, `devtools`, `vite-plugin`, `cli`, `ignifx`,
   `templates`, `examples`, `benchmarks`, `website`, `docs`, `skills`, `repo`. Breaking changes
   carry `!` and a `BREAKING CHANGE:` footer.
3. **Changeset.** Every user-visible change needs one (`pnpm changeset`, `CONSTITUTION.md` §7.3).
   Before 1.0 a "major" changeset produces a minor bump with the change listed under **Breaking**.
4. **One concern per pull request** (`CONSTITUTION.md` §7.5). Keep it under ~500 changed lines
   where you can; split a large feature into a sequence that follows the engineering plan.
5. **Open the pull request.** The template's checklist is the definition of done, not decoration.
   Paste your `pnpm check` output into "How tested" (standards §15).
6. **Merge.** Squash-merge with the pull request title as the commit subject. Never force-push a
   shared branch. A human maintainer approves every merge — agents may review but cannot approve
   (`CONSTITUTION.md` §7.4).

## Definition of done

A change is done when code, tests, TSDoc, `skills/**`, and a changeset are all present, CI is
green, and a maintainer has approved (`CONSTITUTION.md` §6.6). Concretely, that means:

- Public symbols carry TSDoc with a release tag; the API report is regenerated, not hand-edited.
- `skills/ignifx/SKILL.md` and its references describe the API **as of this change**
  (`CONSTITUTION.md` §5.2). The documentation harness fails the build if they drift.
- New runtime code has unit tests; GPU-touching code has a browser test; a bug fix has a
  regression test (`CONSTITUTION.md` §6.1). Coverage floors: 80% per package, 90% for core.
- `@babylonjs/lite` is imported only from `src/lite/**` (`CONSTITUTION.md` §3.4). If the adapter
  does not expose what you need, extend the adapter — with a test and TSDoc.

## Two rules that surprise people

- **No migration documents before 1.0.** `docs/migrations/` stays empty except for its README
  while the version is `0.x` (`CONSTITUTION.md` §4.2). Breaking changes are allowed in minor
  releases and are recorded in the changelog, not in a migration guide. CI enforces this.
- **Never hand-edit generated files** — `packages/*/api/*.api.md`,
  `skills/**/references/api/*`, `benchmarks/baselines.json`. Regenerate them (standards §15).

## Working with AI agents

Agents are contributors here and are held to every rule above (`CONSTITUTION.md` §7.4). Start at
[`AGENTS.md`](AGENTS.md), which is the tool-agnostic entry point, and read standards §15 for the
rules specific to agents: run `pnpm check` and include the result, cite clause numbers when
explaining a decision, and verify any Babylon Lite claim against the pinned version's `index.d.ts`
rather than from memory.

## Reporting a problem

Open an issue with the reproduction, the browser and GPU you saw it on, and what you expected.
For anything that looks security-relevant, do not open a public issue — email the maintainers at
the address on [astrumforge.com](https://astrumforge.com).

## Licence

Contributions are accepted under the Apache License 2.0, the same licence as the project
(`CONSTITUTION.md` §11.1).
