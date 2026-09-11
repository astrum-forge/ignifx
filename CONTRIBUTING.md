# Contributing to ignifx

Use this guide to set up the repository, validate a change, and open a pull request.
The [coding standards](docs/standards/coding-standards.md) hold the coding and writing rules.

## Read first

Start with [AGENTS.md](AGENTS.md), then read:

1. [Constitution](CONSTITUTION.md): project rules and priorities.
2. [Coding standards](docs/standards/coding-standards.md): daily workflow, code, tests, and writing.
3. [Architecture overview](docs/architecture/00-overview.md) and the subsystem you will change.
4. [Engineering plan](docs/plan/engineering-plan.md): current status and scope.
5. [Engine skill](skills/ignifx/SKILL.md): how to use the engine.

Read linked [ADRs](docs/adr/) when they affect your change. Document precedence is defined in constitution §10.1.

## Set up

Use Node 24 from [`.nvmrc`](.nvmrc) and the pnpm version in [`package.json`](package.json).
Install Chromium through Playwright for browser tests. Local GPU tests need a WebGPU-capable device; CI uses SwiftShader.

```sh
git clone git@github.com:astrum-forge/ignifx.git
cd ignifx
nvm use
pnpm install
pnpm exec playwright install chromium
pnpm check
```

`pnpm install` sets up the Git hooks. `pnpm check` builds first, then checks formatting, lint, types, unit tests with coverage, API reports, and docs.
The build is needed because workspace imports resolve to `dist/`. Browser, visual, frame-budget, dependency, and package checks are separate commands.

## Everyday commands

| Command                             | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `pnpm dev`                          | Run workspace development tasks                  |
| `pnpm build`                        | Build the workspace                              |
| `pnpm test`                         | Run headless unit tests with coverage            |
| `pnpm test:browser`                 | Run Chromium WebGPU tests                        |
| `pnpm test:visual`                  | Compare visual goldens                           |
| `pnpm test:frame-budget`            | Check template frame budgets                     |
| `pnpm typecheck`                    | Check TypeScript projects                        |
| `pnpm lint`                         | Run Oxlint and ESLint                            |
| `pnpm format` / `pnpm format:check` | Format files / check formatting                  |
| `pnpm deps`                         | Check dependency layers and cycles               |
| `pnpm pack-check`                   | Validate package exports and types               |
| `pnpm api-report`                   | Validate API reports; fails on drift or warnings |
| `pnpm docs:harness`                 | Regenerate and check docs, examples, and skills  |
| `pnpm changeset`                    | Record a user-visible change for release         |

Start with checks relevant to the change, then run `pnpm check` before opening a PR.
See [standards §10](docs/standards/coding-standards.md#10-testing) for which tests apply.

## Generated files

Edit the source, run the generator, and review the result. Never hand-edit generated output.

| Output                          | Command                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| Package API report              | `pnpm --filter @ignifx/core api-report:update` (replace the package name) |
| Skill API references            | `pnpm docs:api`                                                           |
| Format schemas and field tables | `pnpm docs:schemas`                                                       |
| Recipe pages                    | `pnpm docs:recipes`                                                       |
| `llms.txt`                      | `pnpm docs:llms`                                                          |
| License notices                 | `pnpm licenses:notices`                                                   |

Build changed packages before regenerating API reports. Run `pnpm api-report` afterwards; the update command alone does not validate the report.
For benchmark baselines, use the relevant benchmark's recording procedure and include measurements in the PR.
Use `pnpm docs:harness -- --no-regenerate` if another contributor is editing generated-doc sources at the same time.

## Make a change

1. Work on a short-lived branch. Use the branch and commit conventions in [standards §11](docs/standards/coding-standards.md#11-git-and-pull-requests); allowed commit scopes are in [`commitlint.config.ts`](commitlint.config.ts).
2. Keep the PR focused on one concern. Prefer clear names and simple control flow. Comments should explain a hidden reason or constraint in one or two short sentences; see [standards §9](docs/standards/coding-standards.md#9-documentation-and-writing).
3. Test changed behaviour. Update affected TSDoc and skill pages, then regenerate any changed public API reports and references.
4. Add a changeset for user-visible package, template, or shipped skill changes. Contributor-only documentation does not need a package release. Follow [the changeset guide](.changeset/README.md).
5. Run `pnpm check`. In the PR, explain the problem, resulting behaviour, and validation. Include the command's result and any checks not run.
6. Human maintainers approve merges. Squash-merge with the PR title; never force-push a shared branch. Hooks format and report lint without auto-fixing it, so run `pnpm lint` after committing.

Constitution amendments need an ADR, a `constitution: …` PR title, and project-owner approval (constitution §10.2).

## Release rules

Before 1.0, breaking changes use a **minor** changeset and a **Breaking** heading with the required user action.
Do not write migration documents under `docs/migrations/` while versions are `0.x`.
Write release notes as short descriptions of user-visible outcomes; keep implementation details and test logs in the PR.

The release workflow creates the **Version Packages** PR. Review its versions and notes before merging.
It uses `pnpm version-packages` to update package versions, skill versions, and schemas together.
After merge, CI publishes and runs `pnpm release:verify`. Do not publish manually.

## Report a problem

Include a reproduction, expected behaviour, and the browser/GPU involved.
For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Contributions use Apache License 2.0, the same license as ignifx.
