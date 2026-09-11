# ignifx Coding Standards

**Updated:** 2026-09-11 · **Applies to:** humans and agents, across the repository

The [constitution](../../CONSTITUTION.md) takes precedence. These standards explain the daily workflow and coding rules.
Section numbers are kept stable for existing references. Tool configuration holds exact settings; this document explains their purpose.

## Development workflow

1. Follow `AGENTS.md`'s reading order. Read the relevant code, tests, and design before editing.
2. Check the working tree and installed dependencies. Keep other contributors' changes intact.
3. Make the smallest complete change. Test its behaviour (§10) and update affected docs (§9).
4. Review the diff for mistakes, unnecessary code, and wordy comments. Run `pnpm check` before opening a PR (§15).

[CONTRIBUTING.md](../../CONTRIBUTING.md) covers setup and commands. [§9](#9-documentation-and-writing) covers writing.

## 1. Toolchain

Use Node 24 from [`.nvmrc`](../../.nvmrc); the dependency checker does not support Node 25.
[`package.json`](../../package.json) pins pnpm and defines commands. [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) holds dependency ranges; the lockfile records installed versions.

- TypeScript 7 checks types; the TS6 alias supports compiler-API tools (ADR-0007).
- Turborepo runs tasks; tsdown builds packages; Vite builds apps and the site.
- Vitest and Playwright run tests. Oxlint/tsgolint and ESLint lint code.
- oxfmt and Prettier format files. API Extractor and TypeDoc produce API reports and docs.
- Changesets handles releases; Renovate updates dependencies; lefthook runs commit checks.

Do not duplicate version tables or upgrade tools in unrelated work.
`pnpm check` runs build → format → lint → typecheck → unit tests with coverage → API report → docs harness.
Build comes first because workspace imports resolve to `dist/`. CI adds the checks in §12.

## 2. Repository layout

- `packages/`: published packages and subsystem skills.
- `templates/`, `examples/`: playable apps and recipe sources.
- `benchmarks/`, `tests/visual/`: performance budgets and visual goldens.
- `website/`: prerendered public site, built separately.
- `docs/`: standards, architecture, ADRs, reviews, and the engineering plan.
- `skills/ignifx/`: engine skill and references.
- `scripts/`, `.github/workflows/`: generators, checks, and release automation.

Package layers are defined in architecture `00-overview.md` §2.

## 3. TypeScript configuration

Extend [`tsconfig.base.json`](../../tsconfig.base.json). Do not weaken its checks to silence errors.

- Keep its strictness, indexed-access, optional-property, override, unused-code, and module checks.
- `isolatedDeclarations` requires exported return types. `erasableSyntaxOnly` forbids enums, namespaces, and parameter properties.
- Packages use `nodenext`; apps use `module: "preserve"` and `moduleResolution: "bundler"`.
- Keep the explicit `es2023` target; review browser compatibility at release time.
- Set each project's `rootDir` and `types`: WebGPU for browser code, Node for tools, Node/Electron for main-process code.
- tsdown owns `dist/`. TypeScript declarations go to `.tsbuild/` or `.tsbuild-test/`.
- Packages with tests need `test/tsconfig.json` for type-aware lint. Copy `packages/core/test/tsconfig.json`: it extends `../tsconfig.test.json`, sets `noEmit`, and disables `composite`. Build references still use `tsconfig.test.json`.

## 4. Modules and packages

- Use ESM, `"type": "module"`, and explicit `.js` relative imports. Sandboxed Electron preloads build as CommonJS (ADR-0018).
- Use one public `src/index.ts` barrel with named re-exports. No `export *` or feature barrels. Subpaths need a tooling/platform purpose: `/main`, `/preload`, `/client`, `/config`, or `./package.json`.
- Default exports are allowed only in configuration files.
- No import-time side effects (constitution §3.5). Module scope holds declarations and immutable constants, including typed arrays. Create caches and services inside functions. Set `sideEffects: false`.
- Lite and native/WASM backend imports stay inside each package's `src/lite/**` adapters.
- Import only from lower layers and declared peers (architecture `00-overview.md` §2.1). No cycles.
- Separate `import type` from value imports. Order: Node built-ins, external, workspace, relative.

## 5. Language rules

### 5.1 Naming

| Use                          | Convention                                       | Example                   |
| ---------------------------- | ------------------------------------------------ | ------------------------- |
| Files and directories        | kebab-case                                       | `scene-instance.ts`       |
| Classes, interfaces, types   | PascalCase; no `I` prefix                        | `SceneInstance`           |
| Functions, variables, fields | camelCase                                        | `loadScene`               |
| Fixed constants              | UPPER_SNAKE_CASE                                 | `MAX_LAYERS`              |
| Component type IDs           | `<package-or-game>/<Name>`                       | `mygame/Mover`            |
| Error codes                  | Registered `IGX-####` range                      | `IGX-0501`                |
| Boolean queries              | `is`, `has`, `can`, or `should`                  | `isGrounded`              |
| Schema toggles               | Plain verb or adjective                          | `enabled`, `castShadows`  |
| Signals                      | `on` + past-tense event                          | `onDestroyed`             |
| Non-default units            | Suffix `Ms`, `Px`, or `Rad`                      | `positionPx`              |
| Async functions              | No `Async` suffix                                | `loadScene(): Promise<…>` |
| Private members              | `#field`; `_field` only for adapter Lite mirrors | `#handles`                |

Public APIs use seconds, metres, and degrees unless the name says otherwise.
Error-code ranges live in architecture `15-devtools-and-diagnostics.md` §1.

### 5.2 Type safety

- No `any`, non-null assertions, or `@ts-ignore`. Use `unknown` and narrow it. `@ts-expect-error` needs a reason and an issue link.
- Use `as` assertions only at system boundaries, such as JSON, DOM, or Lite integration. State the invariant in one short comment. `as const` is allowed for literal types.
- Prefer discriminated unions and `as const` objects to enums. Derive unions from those objects.
- Public fields, arrays, and tuples are `readonly` by default. Make mutable views explicit, such as `MutableVec3`.
- Handle every union case; use `assertNever` in a `switch` default.
- Give public functions explicit return types.

### 5.3 Syntax to avoid

- Decorators; use schemas (ADR-0004).
- Enums, namespaces, and constructor parameter properties.
- Inheritance deeper than `Component → Script → your subclass`; use composition and `requires`.
- `async` lifecycle callbacks or promise-based frame ordering (ADR-0010).
- Allocating getters in hot paths without a `ToRef` alternative.
- `eval`, `new Function`, prototype mutation, or `Object.defineProperty` tricks. The existing exceptions are `ExtensionContext.defineAppProperty` and core's hot-reload patcher.

### 5.4 Classes and functions

- Use classes for game-facing model objects such as `Entity`, `Script`, and `Vec3`. Prefer plain data and functions for internals.
- Keep each class or function focused on one job. Systems implement `System`; avoid all-purpose manager objects.
- Prefer options objects for more than three parameters, with a `readonly` interface and documented defaults.
- An output parameter comes last, is named `out`, and is returned.
- Choose names that explain intent. Prefer guard clauses and straightforward control flow to deep nesting or clever expressions.
- Add a helper when it names a useful operation or removes meaningful duplication. Do not create wrappers, factories, or generic frameworks for hypothetical future use.
- If code needs a paragraph to explain each step, simplify the code first. Keep comments for facts that names and types cannot express (§9.2).

### 5.5 Nullability and errors

- Use `null` for absent data and return values; reserve `undefined` for optional parameters and fields.
- Throw `IgnifxError` with a registered code for misuse. Use `null` or a result object for expected absence.
- Do not swallow errors. Catch to add context and rethrow, or report through `app.onError` at a documented boundary such as the frame loop or asset loader.
- Use `app.log` or `ctx.log`; no `console.*` outside the logging sink.

## 6. Lint and formatting

Use oxfmt for supported files and Prettier for Markdown: two spaces, double quotes, semicolons, trailing commas, and 120 columns where configured.
Let the formatter decide layout.

[`.oxlintrc.json`](../../.oxlintrc.json) and [`eslint.config.ts`](../../eslint.config.ts) define checks for correctness, performance, types, documentation, and imports.

### 6.5 Repository lint rules

| Rule (`ignifx/` prefix)   | Checks                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `no-lite-outside-adapter` | Lite imports stay in adapters                                                                 |
| `no-module-side-effects`  | Module loading has no side effects                                                            |
| `no-async-lifecycle`      | Lifecycle callbacks are synchronous                                                           |
| `signal-connect-owner`    | Signal connections in scripts have an owner                                                   |
| `no-entity-find-in-src`   | No entity path searches in runtime source; configured service and array receivers are allowed |
| `schema-field-shadowing`  | Class fields do not shadow schema fields                                                      |
| `error-code-format`       | Error codes use the registered format and range                                               |
| `no-console`              | Logging goes through the engine sink                                                          |

Hooks format staged files and report lint; they do not auto-fix lint. Generators format their own output, which hooks skip.
Run `pnpm lint` after committing. Inline rule overrides need a short reason; they do not waive the constitution.

## 7. Runtime performance

- Allocate nothing in per-frame engine paths: systems, engine script updates, and adapters. Reuse `out` parameters, `ToRef` methods, pools, and typed arrays.
- Use indexed `for` loops in hot paths. Avoid per-frame `forEach`, `map`, spread, destructuring, and new closures.
- Resolve string keys to handles or references during `awake` or registration. Do not look up string-keyed maps for each entity each frame.
- Store bulk data such as sprites, particles, and interpolation poses in separate typed arrays per field.
- Expose subsystem counters through `app.diagnostics`.
- Meet template budgets: 60 fps on the reference machine, with engine CPU time at most 2 ms in 2D and 4 ms in 3D. Per-scene and bundle limits live in `benchmarks/baselines.json`.
- Allocation tests run 600 headless steps with `--expose-gc` and check bounded heap growth. Browser memory checks use `performance.measureUserAgentSpecificMemory()` where available.
- Measure before optimising. Include a before/after benchmark result when changing hot code. Do not raise budgets to conceal a regression.

## 8. Async work and resource cleanup

- Await or return each promise. Use `void` only for intentional background work, with a short reason and an error-handling path.
- Cancellable operations accept `AbortSignal`; long operations report progress.
- Disposable resources implement `Symbol.dispose`. Use `using` for scoped ownership; otherwise document who calls `dispose` or `release` in the type's TSDoc.
- Do not rely on microtask timing for gameplay order. Use the engine's lifecycle and coroutines (ADR-0010).

## 9. Documentation and writing

### 9.1 Public API docs

Document what callers need to use the API correctly:

- One short summary and exactly one release tag: `@public`, `@beta`, `@alpha`, or `@internal`.
- Concise `@param` and `@returns` descriptions where lint requires them. Explain meaning, units, or ownership; do not repeat the TypeScript type.
- Defaults, valid ranges, timing, cleanup, and errors when they affect use.
- One small `@example` when usage is unclear. Put full walkthroughs in a skill or recipe.
- After 1.0, `@deprecated` names the replacement and planned removal version.

Keep implementation details out of public TSDoc unless they explain an observable constraint.
Do not add `@remarks`, examples, or repeated summaries just to make a comment look complete.

### 9.2 Comments

Write comments in simple, beginner-friendly language (ELI5). Keep technical names and important details accurate.
Aim for one or two short sentences. Use more only when a real constraint needs it.

Add a comment for a reason the code cannot show: a backend limitation, ordering requirement, ownership rule, unit conversion, or unusual algorithm.
Prefer a clear name or simpler code when that makes the comment unnecessary.

```ts
// Redundant: narrates the next line.
// Increment the frame count.
frameCount += 1;

// Useful: explains an ordering constraint.
// Deliver loaded assets at the frame boundary so scripts see them together.
```

Do not add line-by-line narration, decorative banners, change histories, commented-out code, or docblocks on obvious private helpers.
Keep required safety and invariant comments. Link to an ADR for long reasoning instead of copying it into source.
When changing code, remove or update nearby comments that no longer match it.

### 9.3 Guides and generated docs

- Start with the task or rule. Use short sentences, active verbs, and concrete examples. Explain unfamiliar terms once.
- Keep one source for each fact. Link to configuration, API references, or an ADR instead of repeating them.
- Update affected TSDoc and skill pages in the same pull request as public API, lifecycle, format, or default changes.
- Regenerate API reports and references; never hand-edit generator output. Commands are in [CONTRIBUTING.md](../../CONTRIBUTING.md#generated-files).
- Fix generated prose at its source: TSDoc, schema descriptions, recipe sources, or the generator template. Check the rendered result for duplication.
- Use `docs/adr/0000-template.md` for lasting design decisions. Keep routine implementation explanations in the pull request.
- Write no migration documents under `docs/migrations/` before 1.0 (constitution §4.2).

### 9.4 Changesets and release notes

Write for the developer deciding whether to upgrade. This applies to agents writing changesets, changelog summaries, and GitHub release notes.

- Lead with what users can do, what is fixed, or what changes for them. Name the affected feature or API.
- Use one short bullet per distinct change. Usually one sentence is enough; add a second for a required action or limitation.
- Describe fixes as the trigger and corrected result. Avoid vague claims such as “improved robustness” or “enhanced performance”. Include measurements for performance claims.
- Put breaking changes under **Breaking**. Say what changed and exactly what callers must do. Before 1.0, keep that action in the release note; do not create a migration guide.
- Omit internal file lists, implementation walkthroughs, test logs, planning history, marketing language, and repeated package summaries. Link to a PR or guide when more detail helps.
- Keep generated version headings and traceability links. Edit unreleased changeset text before generation; do not hand-rewrite published changelogs.

Examples of concise entries (illustrative, not release claims):

- **Fix:** “Camera collision checks wait for the first physics step, preventing an error at startup.”
- **Feature:** “Add `MenuStack` to manage nested menus and restore focus when a menu closes.”
- **Breaking:** “Rename `oldMethod()` to `newMethod()`. Update calls to use `newMethod()`.”

Use [the changeset guide](../../.changeset/README.md) when adding an entry. Check the generated Version Packages pull request before release; concise source text should produce concise notes.

## 10. Testing

Test the observable result and important failure cases. A regression test should fail before the fix and pass after it.
Do not copy the implementation into a test or assert private steps that can change without affecting behaviour.

| Change                             | Validation                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| Runtime behaviour or bug fix       | Headless unit tests; add a regression test for a bug            |
| GPU behaviour                      | Real Chromium WebGPU tests in addition to headless coverage     |
| Rendering appearance               | Visual tests with reviewed before/after goldens                 |
| Hot path or bundle impact          | Relevant benchmarks and budget checks                           |
| Public API or usage examples       | API report and docs harness, plus behaviour tests               |
| Prose or contributor guidance only | Formatting, links, and consistency; no artificial runtime tests |

Unit tests use Vitest, a headless app, a manual clock, and `*.test.ts`. Name tests as behaviours, such as “destroys children before parents”.
Browser tests use `*.browser.test.ts` and must pass with CI's SwiftShader adapter; skip GPU timing assertions there.
Visual goldens use per-scene tolerances and change only in a pull request showing before/after images.

Keep coverage at 80% per package and 90% for core. Do not sleep on wall-clock time; use `app.step` or fake timers.
Quarantine flaky tests with `test.skip` and an issue link, then fix or delete them within one release cycle. Do not mask flakes with CI retries.

## 11. Git and pull requests

- Use short-lived `feat/<scope>-<topic>`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `perf/…`, or `test/…` branches. Codex defaults to `codex/<topic>`.
- Commits and PR titles use `type(scope): summary`; scopes come from `commitlint.config.ts`. Breaking changes carry `!` and a `BREAKING CHANGE:` footer. Constitution PR titles use `constitution: …` (§10.2).
- Keep one concern per PR; aim for fewer than 500 changed lines.
- Describe the problem, resulting behaviour, and validation. Link the issue, plan item, or ADR. Cite rules only when they explain a decision.
- User-visible package, template, or shipped skill changes need a changeset. Contributor-only docs and internal changes without user impact do not.
- Before 1.0, select **minor** for breaking changes and include **Breaking** in the note. Changesets does not convert `major` to a pre-1.0 minor.
- Humans approve merges. Squash-merge with the PR title; never force-push shared branches.

## 12. CI and releases

[`ci.yml`](../../.github/workflows/ci.yml) defines the jobs: frozen install, build, formatting, lint, types, unit/browser/visual tests, frame/bundle budgets, package checks, API reports, docs, licenses, and dependency layers.
Frame budgets use `macos-latest`, matching the recorded machine class (ADR-0009).

[`release.yml`](../../.github/workflows/release.yml) creates the **Version Packages** PR.
Its `pnpm version-packages` step updates package versions, skill versions, and schemas.
After merge, CI builds, publishes through npm Trusted Publishing, runs `pnpm release:verify`, and creates tags and GitHub releases.
Provenance is off while the repository is private (constitution §9.4; ADR-0009).

`website.yml` checks the site; Cloudflare Pages builds and deploys it.

## 13. Dependencies and licenses

- Justify new runtime dependencies in an ADR: purpose, size, license, and maintenance. Link it in the PR.
- Pin Lite exactly. Other dependency ranges and exceptions live in `pnpm-workspace.yaml`; Renovate groups updates weekly.
- Preserve pnpm's minimum release age and reviewed `allowBuilds` list. Do not broadly enable install scripts.
- Allowed licenses: Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, Zlib. Other licenses need approval.
- Generate `THIRD_PARTY_NOTICES.md` with `pnpm licenses:notices`; check it with `pnpm licenses:check`.
- Commit the lockfile. CI installs with `--frozen-lockfile`.

## 14. Security

- Electron uses context isolation, sandboxing, no renderer Node integration, a strict CSP, and a typed preload bridge (architecture `14-platform-electron.md` §3).
- No `eval` or `new Function`. Shader assets are validated at build time.
- Engine network calls are limited to asset fetches from configured origins. No telemetry.
- Keep secrets out of the repository. Release credentials use OIDC.

## 15. Finishing a task

- Review the diff and run §10's relevant checks, then `pnpm check` before opening a PR. Report failures and checks not run; do not imply untested hardware or browsers passed.
- Public API changes need tests, TSDoc, affected skills, regenerated reports/references, and a changeset. Run `pnpm api-report`; `api-report:update` alone is not validation.
- Regenerate API docs, schemas, recipes, and benchmark baselines from their sources; never hand-edit them.
- Verify Lite claims against the pinned `index.d.ts`. Extend a missing adapter API there, with tests and TSDoc.
- Report the outcome, validation, and remaining limitations briefly. Humans approve merges.
