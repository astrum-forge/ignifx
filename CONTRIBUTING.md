# Contributing to ignifx

Use this guide to set up the repository, validate a change, and open a pull request.
The [coding standards](docs/standards/coding-standards.md) hold the coding and writing rules.

## Read first

Start with [AGENTS.md](AGENTS.md): it maps a kind of task to the one document to read for it, and lists the rules and the lessons that prevent common mistakes. [docs/README.md](docs/README.md) is the full document index, with the status of every ADR. Document precedence is defined in constitution §10.1.

## Set up

Use Node 24 (CI's version, in [`.nvmrc`](.nvmrc)) or Node 26; the dependency checker refuses Node 25. The pnpm version is pinned in [`package.json`](package.json).
Install Chromium through Playwright for browser tests. Local GPU tests need a WebGPU-capable device; CI uses SwiftShader.

```sh
git clone git@github.com:astrum-forge/ignifx.git
cd ignifx
nvm use
pnpm install
pnpm exec playwright install chromium
pnpm check
```

`pnpm install` sets up the Git hooks. `pnpm check` builds, then checks formatting, lint, types, unit tests with coverage, API reports, and docs — in parallel, in about 20 s once Turborepo's cache is warm.
It prints one line per step; a failed step also prints the end of its log, and the full log is in `node_modules/.cache/ignifx-check/<step>.log`.
The build is needed because workspace imports resolve to `dist/`. `pnpm check --full` adds the package, perf, and browser checks; dependency checks are a separate command. Visual goldens, frame budgets and GPU budgets are not in CI and take minutes: run them only when a change can affect rendering or frame time.

## Everyday commands

| Command                             | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                          | Run workspace development tasks                      |
| `pnpm build`                        | Build the workspace                                  |
| `pnpm check --only lint,test`       | Run some `pnpm check` steps (`--skip` also works)    |
| `pnpm test`                         | Run headless unit tests (~7 s)                       |
| `pnpm test:coverage`                | Run them with coverage floors, as CI does            |
| `pnpm test:perf`                    | Run timing, heap, and bundle-size budgets; run alone |
| `pnpm test:browser`                 | Run Chromium WebGPU tests                            |
| `pnpm test:visual`                  | Compare visual goldens (only when needed; not in CI) |
| `pnpm test:frame-budget`            | Check frame budgets (only when needed; not in CI)    |
| `pnpm test:gpu-budget`              | Check GPU budgets on the host GPU (local only)       |
| `pnpm bench`                        | Report frame time for the benchmark scenes           |
| `pnpm typecheck`                    | Check TypeScript projects                            |
| `pnpm lint`                         | Run Oxlint (errors) and ESLint (cached)              |
| `pnpm lint:warnings`                | Also list Oxlint's pedantic warnings                 |
| `pnpm format` / `pnpm format:check` | Format files / check formatting                      |
| `pnpm deps`                         | Check dependency layers and cycles                   |
| `pnpm pack-check`                   | Validate package exports and types                   |
| `pnpm api-report`                   | Validate API reports; fails on drift or warnings     |
| `pnpm docs:harness`                 | Regenerate and check docs, examples, and skills      |
| `pnpm licenses:check`               | Check dependency licenses against the allowed list   |
| `pnpm changeset`                    | Record a user-visible change for release             |

Start with checks relevant to the change, then run `pnpm check` before opening a PR.
For one package: `pnpm vitest run --project node packages/<name>` or `pnpm --filter @ignifx/<name> test`.
See [standards §10](docs/standards/coding-standards.md#10-testing) for which tests apply.

## Generated files

Edit the source, run the generator, and review the result. Never hand-edit generated output.

| Output                                                         | Command                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Package API report (`packages/*/api/*.api.md`)                 | `pnpm --filter @ignifx/core api-report:update` (replace the package name)    |
| Skill API references (`skills/ignifx/references/api/`)         | `pnpm docs:api`                                                              |
| Format schemas and field tables (`references/formats/`)        | `pnpm docs:schemas`                                                          |
| Recipe pages (`references/recipes/`)                           | `pnpm docs:recipes`                                                          |
| The version each skill declares                                | `pnpm skills:version` (part of `pnpm version-packages`)                      |
| License notices (`THIRD_PARTY_NOTICES.md`)                     | `pnpm licenses:notices`                                                      |
| Vendored texture and mesh decoders (`packages/core/decoders/`) | `pnpm vendor:decoders`                                                       |
| Template art, levels and audio (`templates/*/assets/`)         | `pnpm assets` (or `assets:2d`, `assets:levels`, `assets:3d`, `assets:audio`) |
| `CHANGELOG.md` files                                           | The release workflow; edit the changeset before release instead              |

Build changed packages before regenerating API reports. Run `pnpm api-report` afterwards; the update command alone does not validate the report.
For benchmark baselines, use the relevant benchmark's recording procedure and include measurements in the PR.
Use `pnpm docs:harness --no-regenerate` if another contributor is editing generated-doc sources at the same time.

## Make a change

1. Work on a short-lived branch. Use the branch and commit conventions in [standards §11](docs/standards/coding-standards.md#11-git-and-pull-requests); allowed commit scopes are in [`commitlint.config.ts`](commitlint.config.ts).
2. Keep the PR focused on one concern. Prefer clear names and simple control flow. Comments should explain a hidden reason or constraint in one or two short sentences; see [standards §9](docs/standards/coding-standards.md#9-documentation-and-writing).
3. Test changed behaviour. Update affected TSDoc and skill pages, then regenerate any changed public API reports and references.
4. Add a changeset for user-visible package, template, or shipped skill changes, including a package's `README.md`. Contributor-only documentation does not need a package release. Follow [the changeset guide](.changeset/README.md).
5. Run `pnpm check`. In the PR, explain the problem, resulting behaviour, and validation. Include the command's result and any checks not run.
6. Human maintainers approve merges. Squash-merge with the PR title; never force-push a shared branch. Hooks format and report lint without auto-fixing it, so run `pnpm lint` after committing.

Constitution amendments need an ADR, a `constitution: …` PR title, and project-owner approval (constitution §10.2).

## Add a package

Copy the shape of `packages/3d`: `package.json` (the name, `keywords`, `files: ["dist", "skills"]`, the scripts, `catalog:` and `workspace:*` dependencies, `publishConfig`, and the `ignifx` manifest with its `skill` entry), `README.md`, `tsconfig.json`, `tsconfig.test.json`, `test/tsconfig.json`, `tsdown.config.ts`, `api-extractor.json` (`reportFileName`), `typedoc.json` (`entryFileName`), the `src/` entry files, and `skills/<name>/SKILL.md`.

These files hold a package list and must change too; nothing else does (Vitest, the workspace file, Changesets, the workflows and the scripts find packages by glob or manifest):

- Root `tsconfig.json`: a `references` entry.
- `.dependency-cruiser.cjs`: a key in `ALLOWED_IMPORTS`, and the `ignifx` list if the umbrella re-exports the package.
- `turbo.json`: a `<package>#docs:api` entry naming the package's generated API page as its output.
- `commitlint.config.ts`: the `scope-enum` list.
- The umbrella, if it re-exports the package: `packages/ignifx/package.json` `dependencies`, `tsdown.config.ts` `neverBundle`, the re-export block in `src/index.ts`, and the surface assertion in `test/index.test.ts`.
- A new asset type: `packages/vite-plugin/src/asset-types.ts`.
- A new error-code range, in three places: `packages/core/src/errors/error-codes.ts`, `REGISTERED_CODE` in `tools/eslint-plugin-ignifx/src/rules/error-code-format.ts`, and `docs/architecture/15-devtools-and-diagnostics.md` §1.
- Documents: the extensions table in `skills/ignifx/SKILL.md`, the package tables in `docs/architecture/00-overview.md` §2 and §2.1, and the package count in `AGENTS.md`.
- A changeset, and `pnpm licenses:notices` if the package adds a runtime dependency.

npm Trusted Publishing cannot create a package that does not exist yet; ask the owner to claim a new name before the release that first carries it.

## Release rules

Before 1.0, breaking changes use a **minor** changeset and a **Breaking** heading with the required user action.
Do not write migration documents under `docs/migrations/` while versions are `0.x`.
Write release notes as short descriptions of user-visible outcomes; keep implementation details and test logs in the PR.

The release workflow creates the **Version Packages** PR. Review its versions and notes before merging.
It uses `pnpm version-packages` to update package versions, skill versions, and schemas together.
After merge, CI publishes and runs `pnpm release:verify`. Do not publish manually.
Run the dependency audit for each release and record it; [SECURITY.md](SECURITY.md#dependency-audit) says how.

## Report a problem

Include a reproduction, expected behaviour, and the browser/GPU involved.
For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Contributions use Apache License 2.0, the same license as ignifx.
