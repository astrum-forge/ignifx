# ADR-0009 · Monorepo tooling

**Status:** Accepted · **Date:** 2026-09-05 · **Revisit:** when a tool in the Decision is replaced

## Context

A multi-package TypeScript monorepo with published libraries, templates, examples, benchmarks and a docs harness, started in September 2026.

## Decision

- **pnpm workspaces** with `catalog:` for shared versions; **Turborepo** for task orchestration and caching.
- **tsdown** for library builds (ESM only, `isolatedDeclarations` declarations); **Vite** for apps and templates.
- **Vitest** for unit, performance and browser tests (projects `node`, `node-isolated`, `perf`, `browser`); **Playwright** for visual tests.
- **Oxlint with tsgolint** as the primary linter; **ESLint with typescript-eslint** only for gap rules and the repository's own `ignifx/*` rules; **oxfmt** for code and **Prettier** for Markdown.
- **Changesets** with fixed versioning; **npm Trusted Publishing** (OIDC); **Renovate** for updates; **lefthook**, lint-staged and **commitlint** for hooks.
- **API Extractor** reports and **TypeDoc** Markdown feeding the agent skill.

The public site is not part of this repository (ADR-0019, ADR-0027).

## Consequences

- Fast CI (native TypeScript, Rolldown) and reproducible installs.
- Tool churn is expected. Versions are recorded in one place, the `pnpm-workspace.yaml` catalog; documents do not repeat them.
- **Visual goldens, frame budgets and GPU budgets are not in CI** (owner decision, 2026-10-03). `ci.yml` has no visual or frame-budget job and no scheduled trigger: shared runners are too slow and too variable for a frame-time ceiling, and gameplay goldens failed on runner speed rather than on engine changes. The suites stay in `tests/visual/` and are run locally (`pnpm test:visual`, `pnpm test:frame-budget`, `pnpm test:gpu-budget`) when a change can affect rendering or frame time; the result goes in the pull request. `benchmarks/template-frame-time.test.ts` still holds the recorded rows in `benchmarks/baselines.json` to the coding-standards §7 budget in CI.
- **Provenance is off.** `publishConfig.provenance` is `false` in every package manifest, which deviates from `CONSTITUTION.md` §9.4. It was switched off on 2026-09-07 because npm cannot attest from a private source repository. The repository is public, so that reason no longer holds; restoring provenance is open work (`docs/plan/engineering-plan.md`).
- **A release bumps more than package versions.** `changeset version` knows nothing about the skills' `metadata.ignifx-version` or the `ignifxVersion` inside `skills/ignifx/references/formats/ignifx.schemas.json`, so the release workflow's version step is `pnpm version-packages`: `changeset version`, then `pnpm skills:version`, then `pnpm docs:schemas`. The values a skill may declare live in `scripts/lib/skill-version.ts`, which both the linter and the writer import.
- **A publish is verified, not trusted.** `changeset publish` reaches `pnpm publish` (Changesets picks the workspace's package manager), and `pnpm release:verify` (`scripts/verify-published.ts`) asks the registry for every version the tree carries and fails the release when one is missing. Trusted Publishing cannot create a package that does not exist yet; the header of `release.yml` records how the existing names were claimed.

## Validation

Deviations and tool behaviour the configuration depends on. Each was checked against the configuration files on 2026-11-16 unless marked as carried over.

- pnpm's `catalog:` accepts `npm:` alias specifiers, so the ADR-0007 pair lives in the catalog. The build allow-list key is `allowBuilds`. `minimumReleaseAge` is left at pnpm's default.
- TypeScript 6 ships only a `tsc6` bin, so the two installs do not clash. (carried over)
- tsdown: `external` is deprecated; the configuration uses `deps.neverBundle`.
- The Oxlint configuration file is `.oxlintrc.json`, the name Oxlint discovers.
- Type-aware Oxlint resolves the nearest `tsconfig.json` for each file. A package's tests therefore carry a non-emitting `test/tsconfig.json`, repository scripts carry `scripts/tsconfig.json`, and `tsconfig.tools.json` type-checks root configuration files (coding standards §3).
- ESLint and commitlint load their `.ts` configuration files natively, so `jiti` is not a dependency. (carried over)
- Vitest: `coverage` is a root-level option; nested under `projects[].test` it is silently ignored. The browser provider option is `launchOptions`; unknown keys are dropped silently. Coverage excludes `packages/*/src/lite/render.ts`, which needs a GPU and is covered by the browser project.
- API Extractor does not use the TypeScript 6 alias: it analyses with its own bundled TypeScript. TypeDoc does use the alias.
- TypeDoc needs `cleanOutputDir: false`, or it deletes the committed `references/api/README.md`; `disableSources: true` keeps its output stable across unrelated edits.
- `@arethetypeswrong/cli` runs with `--profile esm-only`: the default profile reports the intended consequences of ESM-only packages as errors.
- `tsc --build` is a type-checker here. Its output goes to `.tsbuild/` and `.tsbuild-test/`, because `dist/` belongs to tsdown and whichever ran last would clobber the other.
- Changesets' `fixed` group is `[["@ignifx/*", "ignifx"]]`.
- lint-staged runs oxfmt and Oxlint on staged files without `--fix`: an autofix at commit time rewrote code that had passed the gate (`.lintstagedrc.mjs`).
- dependency-cruiser declares `engines.node` as `^22||^24||>=26` and refuses to start on Node 25.
- Subsystem skills are discovered through each package's `ignifx.skill` manifest entry (`docs/architecture/04-extensions.md` §4), not by globbing, so the umbrella's pack-time copy of the entry skill is never linted twice.
- The `docs-harness` CI job checks out with `fetch-depth: 0`, because two of its checks diff against the base commit.
- Babylon Lite: `disposeEngine` throws on a null engine. `createNullEngine()` returns an engine with no `_context` and no `_device`, and `disposeEngine` uses both unconditionally, so the headless adapter disposes only the scene, which is the complete teardown for an engine that holds no GPU resources. (carried over; pinned by `packages/core/test/lite/engine.test.ts`, not re-run)
- Babylon Lite: `createEngine(canvas)` throws when `requestAdapter()` returns null, so the adapter probes first and raises `IGX-0701`. (carried over)
- Test input holds are counted in frames, not milliseconds. A wall-clock hold is a frame-rate assumption: on a slow runner the release lands in the same tick as the press and the input is lost (`waitForFrames` in `tests/visual/tests/templates.spec.ts`; coding standards §10).

### WebGPU flags

Measured with Playwright's bundled Chromium on macOS arm64. The outcome lives in `vitest.config.ts` and `tests/visual/playwright.config.ts`; change both together. (carried over; not re-measured)

- `--enable-unsafe-webgpu` is required: without it `navigator.gpu` exists and `requestAdapter()` returns null.
- `--use-webgpu-adapter=swiftshader` pins the software adapter, so results do not depend on the host GPU.
- `--enable-features=Vulkan --use-angle=vulkan` returns a null adapter on macOS.
- WebGPU needs a secure context: an adapter is handed out on `http://127.0.0.1`, localhost or https, never on `about:blank`.

### WebGPU flags on Linux (2026-09-06)

On Linux the two base flags give an adapter and a device, and the first present to a canvas destroys the device. Adding `--enable-features=Vulkan --use-vulkan=swiftshader --use-angle=swiftshader` keeps it alive, so both configuration files add those flags when `process.platform === "linux"` and keep the base pair elsewhere. Browser tests that never present to a canvas pass on Linux with the base flags alone. (carried over; not re-measured)
