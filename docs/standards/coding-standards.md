# ignifx Coding Standards

**Status:** v1 (2026-09-05) · **Precedence:** below `CONSTITUTION.md`, above architecture docs · **Applies to:** every file in this repository, written by humans or agents

These standards are enforced by tooling wherever possible. Where a rule cannot be automated, reviewers cite the section number.

---

## 1. Toolchain

Versions are pinned in `pnpm-workspace.yaml` (`catalog:`) and `.nvmrc`; this table records the baseline chosen on 2026-09-05 and is updated by tooling-upgrade pull requests.

| Concern | Tool | Baseline | Notes |
|---|---|---|---|
| Language | TypeScript | 7.0.x (native compiler) | `tsc --build` for type-checking and project references |
| Compiler API shim | `@typescript/typescript6` | 6.0.x | Aliased as `typescript` for tools that still need the programmatic API (typescript-eslint, TypeDoc, API Extractor, knip). Dropped when TS 7.1's API lands (ADR-0007) |
| Runtime | Node.js | 24 LTS (`>=24.20`) | Move to 26 LTS after 2026-10-28 |
| Package manager | pnpm | 11.x | Installed by the CI action, not Corepack (Corepack is leaving Node) |
| Task runner | Turborepo | 2.x | `turbo.json` tasks with remote cache |
| Bundler (apps/site) | Vite | 8.x (Rolldown) | Vite has no dependency on the TypeScript package |
| Library build | tsdown | 0.23+ | `isolatedDeclarations: true` → declaration emit without the TS API |
| Tests | Vitest 5 + `@vitest/browser-playwright` | 5.x / Playwright 1.63+ | Headless (Node) and real-Chrome WebGPU projects |
| Lint | Oxlint + tsgolint (type-aware) | 1.81+ | Primary linter; TS 7-native |
| Lint (gap filler) | ESLint 10 + typescript-eslint 8 (+ `eslint-plugin-jsdoc`, `eslint-plugin-import-x`) | via TS6 alias | Only for rules Oxlint lacks and for the custom ignifx rules (§6.5) |
| Format | oxfmt (Prettier fallback for Markdown) | 0.66+ | 2 spaces, double quotes, semicolons, trailing commas, 120 columns |
| API reports | `@microsoft/api-extractor` | 7.59+ (TS6 alias) | `api/<pkg>.api.md` committed |
| API docs | TypeDoc + `typedoc-plugin-markdown` | 0.28+ (TS6 alias) | Generates skill references |
| Versioning | Changesets | 3.x | Fixed versioning across `@ignifx/*` |
| Hooks | lefthook + lint-staged + commitlint | — | Conventional Commits |
| Dependencies | Renovate | — | Grouped, weekly; Lite pinned exact |
| Desktop | Electron 44+ with electron-vite + electron-builder | — | Quarterly major bump |
| Package checks | publint, `@arethetypeswrong/cli` | — | On every build |
| WebGPU types | `@webgpu/types` | 0.1.72+ | Required; TypeScript's bundled WebGPU declarations are still partial |

`pnpm check` runs format check, lint, typecheck, unit tests, API report, and docs harness locally and is the pre-push gate.

## 2. Repository layout

```
CONSTITUTION.md  AGENTS.md  CLAUDE.md  README.md  LICENSE
package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  tsconfig.json (references)  lefthook.yml  renovate.json  .nvmrc
packages/<name>/         published packages (see docs/architecture/00-overview.md §2)
templates/<name>/        create-ignifx templates (workspace members, never published)
examples/<name>/         runnable examples and recipes (workspace members)
benchmarks/              perf scenes with committed baselines
website/                 public site (Vite SPA), deployed separately
docs/                    constitution-governed documents: standards/, architecture/, plan/, adr/, migrations/
skills/                  Agent Skills (entry skill); per-package skills live in packages/<name>/skills/
tests/visual/            Playwright visual regression (goldens) — GPU job
.github/workflows/       CI
```

## 3. TypeScript configuration

`tsconfig.base.json` (every package extends it):

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "isolatedDeclarations": true,
    "erasableSyntaxOnly": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["@webgpu/types"],
    "skipLibCheck": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rewriteRelativeImportExtensions": true
  }
}
```

- Each package sets `rootDir: "./src"`, `outDir: "./dist"`, and its `types` explicitly (TS 7 defaults `types` to `[]`): browser packages `["@webgpu/types"]`, Node tooling `["node"]`, Electron main `["node", "electron"]`.
- Apps and the website use `module: "preserve"` + `moduleResolution: "bundler"`; published packages keep `nodenext`.
- `target` is reviewed each release against the supported browser matrix; it never floats with the compiler default.
- `erasableSyntaxOnly` bans enums, namespaces, and parameter properties (§5.3). `isolatedDeclarations` requires explicit return types on exported functions (§5.2).

## 4. Modules and packages

- **ESM only.** `"type": "module"`, explicit `.js` extensions in relative imports (rewritten from `.ts` by the compiler), no CommonJS output.
- **One public barrel per package** (`src/index.ts`) with explicit named re-exports; no `export *`. Subpath exports only for platform entry points (`@ignifx/electron/main`, `/preload`, `ignifx/config`).
- **No default exports** except configuration files (`ignifx.config.ts`, `vite.config.ts`).
- **No import-time side effects** (`CONSTITUTION.md` §3.5). Module scope holds only declarations and immutable constants (typed-array constants are fine). Lazily create caches inside functions.
- **`sideEffects: false`** in every package; a lint rule flags top-level calls.
- **Adapter boundary.** `@babylonjs/lite` is importable only from `src/lite/**` (custom rule `ignifx/no-lite-outside-adapter`). `@babylonjs/havok`, `@dimforge/rapier2d-compat`, and other native/WASM libraries follow the same rule inside their extension.
- **Dependency direction.** Packages import only from lower layers (`docs/architecture/00-overview.md` §2.1); `dependency-cruiser` runs in CI.
- **Type-only imports** use `import type`; values and types are not mixed in one statement.
- Import order: node builtins, external, workspace packages, relative; enforced by the formatter/linter.

## 5. Language rules

### 5.1 Naming

| Thing | Convention | Example |
|---|---|---|
| Files, directories | kebab-case | `scene-instance.ts`, `sprite-sync-system.ts` |
| Classes, interfaces, types, components | PascalCase, no `I` prefix | `SceneInstance`, `MeshRenderer` |
| Functions, methods, variables, fields | camelCase | `loadScene`, `fixedDeltaTime` |
| True constants | UPPER_SNAKE_CASE | `MAX_LAYERS` |
| Component type ids | `<package-or-game>/<Name>` | `ignifx/MeshRenderer`, `mygame/Mover` |
| Error codes | `IGX-####` in the ranges of `15-devtools-and-diagnostics.md` §1 | `IGX-0501` |
| Booleans | Computed properties and query methods take an `is`/`has`/`can`/`should` prefix; schema-declared toggle fields are plain adjectives or verbs | `isGrounded`, `hasComponent` · `enabled`, `castShadows`, `loop` |
| Signals | `on` + past-tense event | `onDestroyed`, `onSceneLoaded` |
| Units | seconds, metres, degrees in public APIs; suffix when not (`Ms`, `Px`, `Rad`) | `fixedDeltaTime`, `positionPx`, `fromEulerRad` |
| Async functions | no `Async` suffix (return type says it) | `loadScene(): Promise<…>` |
| Private members | `#field` for true privates; `_field` only for adapter-internal Lite mirrors | `#handles` |

### 5.2 Type safety

- No `any` (use `unknown` and narrow). No non-null assertions (`!`). No `@ts-ignore`; `@ts-expect-error` only with a reason and an issue link.
- Type assertions (`as`) only at system boundaries (JSON parsing, DOM, Lite escape hatches) with a comment stating the invariant.
- Prefer discriminated unions and `as const` objects over enums; derive union types from the object (`type Foo = (typeof Foo)[keyof typeof Foo]`), the same pattern Lite uses.
- `readonly` by default for fields, arrays, and tuples in public types; expose mutable views deliberately (`MutableVec3`).
- Exhaustive `switch` over unions with `assertNever` in the default branch.
- Public functions declare explicit return types (required by `isolatedDeclarations`).

### 5.3 Syntax we do not use

- Decorators (not lowered by the Vite 8/Oxc pipeline; runtime support unverified) — schemas replace them (ADR-0004).
- `enum`, `namespace`, constructor parameter properties (`erasableSyntaxOnly`).
- Class inheritance deeper than `Component → Script → your subclass`; prefer composition and `requires`.
- `async` lifecycle callbacks; `Promise`-based frame sequencing (ADR-0010).
- Getters that allocate on hot paths without a `ToRef` alternative (§7).
- `Object.defineProperty` tricks, prototype mutation (except the devtools hot-reload patcher), `eval`/`new Function`.

### 5.4 Classes and functions

- User-facing model objects (`Entity`, `Component`, `Script`, `Signal`, `Vec3`) are classes because that is what game code expects. Engine internals prefer plain data plus functions, in the spirit of Lite.
- Keep classes small and single-purpose; no "Manager" god objects. Systems are objects implementing `System`.
- Prefer `options` objects for functions with more than three parameters; make them `readonly` interfaces with documented defaults.
- Functions that write into an output take it as the last parameter named `out`, and return it.

### 5.5 Nullability and errors

- Use `null` for "absent value" in data structures and return types; `undefined` only for optional parameters and optional object fields.
- Throw `IgnifxError` with a code for API misuse; return `null`/result objects for expected absence (a query that finds nothing is not an error).
- Never swallow errors. Catch only to add context and rethrow, or at a documented boundary (frame loop, asset loader) that reports through `app.onError`.
- No `console.*` outside the logging sink; use `app.log`/`ctx.log`.

## 6. Linting and formatting

- **oxfmt** formats everything it supports; Prettier formats Markdown. Formatting is never discussed in review.
- **Oxlint** runs the `correctness`, `suspicious`, `perf`, and `pedantic` categories plus type-aware rules through tsgolint (`no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`, `strict-boolean-expressions`, `switch-exhaustiveness-check`, `restrict-template-expressions`, `no-unsafe-*`).
- **ESLint (TS6 alias)** runs a small config for `eslint-plugin-jsdoc` (public API documentation completeness), `eslint-plugin-import-x` cycle/ordering rules, and the ignifx custom rules:

| Rule | Enforces |
|---|---|
| `ignifx/no-lite-outside-adapter` | §4 adapter boundary |
| `ignifx/no-module-side-effects` | §4 no import-time side effects |
| `ignifx/no-async-lifecycle` | `async awake/start/update…` are errors |
| `ignifx/signal-connect-owner` | `Signal.connect` inside a `Script` passes `owner` |
| `ignifx/no-entity-find-in-src` | `entity.find("…")` is allowed only in tests, examples, and tools; the rule flags it anywhere else |
| `ignifx/schema-field-shadowing` | class fields named like schema fields |
| `ignifx/error-code-format` | `IgnifxError` codes match `IGX-####` and a registered range |
| `ignifx/no-console` | console calls outside the log sink |

- Lint and format run on staged files through lefthook; CI runs them on the whole tree. A rule can be disabled inline only with a justification comment.

## 7. Performance rules for runtime code

- **Zero allocations in per-frame paths** (systems, `update`/`fixedUpdate` of engine scripts, adapters). Use `out` parameters, `ToRef` variants, pooled objects, and preallocated typed arrays. Lite's math functions allocate; ignifx's math module provides in-place variants and hot code uses them.
- Iterate with indexed `for` loops over arrays in hot paths; no `forEach`/`map`/spread/destructuring in per-frame code.
- No string-keyed `Map` lookups per entity per frame; resolve to handles or direct references at `awake`/registration.
- Avoid closures created per frame; bind once.
- Structure of arrays (typed arrays) for bulk data (sprite instances, particles, interpolation poses).
- Every subsystem exposes counters to `app.diagnostics`; benchmark scenes guard budgets (`CONSTITUTION.md` §6.4): 60 fps on the reference machine for each template, ≤ 2 ms CPU per frame for the engine itself in the 2D templates, ≤ 4 ms in the 3D templates, and bundle ceilings per template recorded in `benchmarks/baselines.json`.
- Allocation budgets are enforced, not only reviewed: designated hot-path benchmark scenes run headless for 600 steps under Node with `--expose-gc` and assert bounded heap growth (`benchmarks/alloc.test.ts`); a browser variant samples `performance.measureUserAgentSpecificMemory()` where available.
- Measure before optimizing; include the benchmark delta in the pull request when touching hot code.

## 8. Asynchrony and resources

- `no-floating-promises`: every promise is awaited, returned, or explicitly `void`ed with a comment.
- Cancellable operations accept an `AbortSignal`; long operations report progress.
- Disposable resources implement `Symbol.dispose` and are used with `using` where scoped; otherwise paired create/dispose calls are documented in the type's TSDoc.
- Never rely on microtask timing for gameplay ordering (ADR-0010).

## 9. Documentation

- Every exported symbol has TSDoc: summary sentence, `@param`/`@returns` where not obvious, `@example` for anything non-trivial, and exactly one release tag (`@public`, `@beta`, `@alpha`, `@internal`). `@deprecated` includes the replacement and the version it will be removed in (post-1.0 only).
- Comments explain *why*, not *what*. No commented-out code.
- A change to public API updates: TSDoc, the package's `api/*.api.md` (regenerated), `skills/**` (entry or subsystem skill), and a changeset. The docs harness (`docs/architecture/16-docs-harness-and-skill.md`) blocks otherwise.
- Architecture decisions go in `docs/adr/NNNN-title.md` using the template in `docs/adr/0000-template.md`.
- Before 1.0 nothing is written under `docs/migrations/` (`CONSTITUTION.md` §4.2); CI fails if a file appears there while the version is `0.x`.

## 10. Testing

- **Unit tests** (`*.test.ts`, Vitest node project): headless app, fake clock, deterministic; one behaviour per test; names read as sentences (`"destroys children before parents"`).
- **Browser tests** (`*.browser.test.ts`, Vitest browser project on Chromium with `--enable-unsafe-webgpu`): only for code that needs a real GPU (adapter, 2D sync, picking). They must pass on a software adapter (SwiftShader) in CI; GPU-timing assertions are skipped there.
- **Visual tests** (`tests/visual/`, Playwright): golden images per template and benchmark scene, compared with a per-scene tolerance; goldens are updated only by a pull request that shows before/after images.
- **Benchmarks** (`vitest bench` + Playwright GPU job) with committed baselines and a tolerance; regressions block.
- **Doc tests**: harness-extracted examples (`16-docs-harness-and-skill.md` §4).
- Coverage floors (`CONSTITUTION.md` §6.2) are enforced by Vitest thresholds per package.
- No test may sleep on wall-clock time; use `app.step` and fake timers. Flaky tests are quarantined with `test.skip` plus an issue link, never retried in CI.

## 11. Git and pull requests

- Branch names: `feat/<scope>-<topic>`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `perf/…`, `test/…`.
- Conventional Commits: `type(scope): summary` with `scope` = package name (`core`, `physics`, `2d`, `website`, `docs`, `repo`). Breaking changes carry `!` and a `BREAKING CHANGE:` footer.
- One concern per pull request; keep under ~500 changed lines where possible; the description states what, why, how tested, and links the plan item or ADR.
- A changeset is required for every user-visible change (`pnpm changeset`); before 1.0 a "major" changeset produces a minor bump with the change listed under **Breaking**.
- Reviews: at least one human maintainer approval; agents may review but cannot approve (`CONSTITUTION.md` §7.4). Reviewers check the definition of done (`CONSTITUTION.md` §6.6).
- Never force-push shared branches; squash-merge with the PR title as the commit subject.

## 12. Continuous integration

Workflow `ci.yml` on every pull request and on `main`:

1. `install` (pnpm, frozen lockfile, store cache)
2. `format` · `lint` (oxlint, eslint) · `typecheck` (`tsc --build`)
3. `test:unit` (Node) · `test:browser` (Chromium + WebGPU flags) · `test:visual` (GPU job; required on `main`, optional label on PRs)
4. `build` (tsdown per package; publint; arethetypeswrong) · `bundle-size` (per template against `benchmarks/baselines.json`)
5. `api-report` (API Extractor diff) · `docs-harness`
6. `deps` (dependency-cruiser; no cycles; layering)

`release.yml` on `main`: Changesets version PR → on merge, build, publish with npm Trusted Publishing (OIDC, provenance), tag, GitHub release notes, website docs refresh. `website.yml` deploys `website/` separately.

## 13. Dependencies and supply chain

- Runtime dependencies are minimal; adding one requires an ADR paragraph (why, size, license, maintenance) in the pull request.
- `@babylonjs/lite` is pinned exactly in the catalog; every other dependency uses caret ranges with Renovate grouping (weekly), `minimumReleaseAge` left at pnpm's default (one day), and `allowBuilds` listing the few packages allowed to run install scripts (`electron`, `esbuild`-free; review each).
- Licenses allowed: Apache-2.0, MIT, BSD-2/3, ISC, 0BSD, Unlicense, Zlib; anything else needs approval. `THIRD_PARTY_NOTICES.md` is generated at release.
- Lockfile committed; CI uses `--frozen-lockfile`.

## 14. Security baseline

- Electron: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, typed preload bridge (`docs/architecture/14-platform-electron.md` §3).
- No `eval`/`new Function`; shader source comes from assets validated at build time.
- No network calls from the engine except asset fetches to configured origins; no telemetry.
- Secrets never enter the repository; CI uses OIDC.

## 15. Rules for AI agents working in this repository

- Read `AGENTS.md`, then the constitution and this document, before changing code.
- Run `pnpm check` and include its result in the pull request description.
- Never modify `api/*.api.md`, `skills/**/references/api/*`, or `benchmarks/baselines.json` by hand; regenerate them with the documented commands.
- Never write under `docs/migrations/` while the version is `0.x`.
- When a Lite API is needed that the adapter does not expose, add it to the adapter with a test and TSDoc; do not import Lite elsewhere.
- Cite constitution or standards section numbers when explaining a decision in a pull request.
