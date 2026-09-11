# ignifx Constitution

**Status:** Revision proposed 2026-09-11 ([ADR-0021](docs/adr/0021-clear-development-guidance.md)); ratified baseline v1 (2026-09-05) · **Owner:** Astrum Forge Studios · **Precedence:** highest

This document sets the project's rules. The [coding standards](docs/standards/coding-standards.md) explain how to apply them.
Clause numbers are stable so reviews and ADRs can cite them, for example `§3.4`.

For daily work: read the relevant design, make the smallest complete change, test its behaviour, and update the docs affected by it.
Keep code and writing easy to read. The standards' [development workflow](docs/standards/coding-standards.md#development-workflow) lists the steps.

## 1. Purpose and scope

- **§1.1 Engine.** ignifx is a code-first TypeScript game engine. It uses Babylon Lite (`@babylonjs/lite`) to render through WebGPU in browsers and Electron.
- **§1.2 Audience.** Build for independent developers, small teams, and their coding agents making 2D and 3D games.
- **§1.3 Scope.** No WebGL fallback, Babylon.js fork, or general-purpose 3D viewer. A visual editor may follow 1.0; it must build on the runtime.
- **§1.4 Design influences.** Use Unity-style script lifecycles and Godot-style scene trees, signals, resources, and extensions. When those models conflict, prefer explicit, type-safe behaviour.
- **§1.5 Names.** Write `ignifx` in lowercase. Publish as `@ignifx/*` and the `ignifx` umbrella. The studio is Astrum Forge Studios (`astrumforge.com`); the project site is `ignifx.com`.

## 2. Priorities

When priorities conflict, the earlier one wins. Cite its clause when explaining the tradeoff.

1. **§2.1 Correctness.** Behaviour must match the types and docs on supported platforms. Fixed-step simulation must be reproducible.
2. **§2.2 Clarity.** Use explicit, fully typed APIs and straightforward code. Document one clear way to do each common task in the engine skill. Prefer clear names and control flow over explanatory comments or extra abstractions.
3. **§2.3 Extension.** Keep core small. Put optional capabilities in extensions that games choose to register.
4. **§2.4 Performance.** Runtime changes must meet frame-time and allocation budgets.
5. **§2.5 Pay for use.** Unused features must add no bundle bytes or frame work. Preserve tree shaking.

## 3. Architecture

- **§3.1 Lifecycle.** Run script callbacks in the documented, deterministic order. Pass delta time to per-frame callbacks and distinguish scaled from unscaled time.
- **§3.2 Timing.** Run physics and deterministic gameplay in `fixedUpdate`; run presentation in `update` and `lateUpdate`. Core owns the fixed-step accumulator. Extensions must not build their own.
- **§3.3 Ownership.** The ignifx scene tree owns entities and components. Lite's `SceneContext` owns render data. Only adapters may change Lite scene arrays.
- **§3.4 Lite boundary.** Only `src/lite/**` in each package may import `@babylonjs/lite`. Expose Lite objects only through named, documented `.lite` escape hatches, which have no stability guarantee.
- **§3.5 Module loading.** No import-time registration, I/O, global mutation, or service creation. Module scope may contain declarations and immutable constants as defined in standards §4. Initialise services in app construction or extension registration.
- **§3.6 Services.** Reach services through `App`, `World`, or `Entity`; no ambient singletons. Two apps must run independently in one process.
- **§3.7 Serialization.** Serializable components declare schemas. Scene and prefab files are versioned JSON. Do not infer serialized fields through reflection.
- **§3.8 Headless support.** Code that needs no GPU must run in Node with Lite's null engine, including the scene tree, scripts, physics, animation, and asset metadata.
- **§3.9 Errors.** API misuse throws an actionable error in development. Production may shorten the message but must keep a stable error code.
- **§3.10 2D support.** Provide dedicated sprites, tilemaps, pixel-perfect cameras, sorting layers, and physics on the shared entity model.

## 4. Versions and compatibility

- **§4.1 Versions.** Follow SemVer 2.0.0. Release all published packages together on one version line using Changesets fixed versioning.
- **§4.2 Before 1.0.** Breaking changes may ship in minor releases, never patches. List each under **Breaking** in its changelog entry. Do not write migration documents under `docs/migrations/`; keep the current API docs and skill accurate.
- **§4.3 Releasing 1.0.** All of these must be true:
  - Every MVP phase in the engineering plan is complete.
  - The public API reports have been reviewed and frozen.
  - All four reference templates build and pass CI.
  - The documentation harness passes.
  - Performance and bundle budgets pass on the supported browser matrix.
  - Two consecutive minor releases have shipped without breaking changes.
- **§4.4 After 1.0.** Breaking API, behaviour, or file-format changes require a major release and a migration document in the same release. Include the reason and exact before/after code. Announce deprecations in a minor release with `@deprecated` and a replacement; keep them working for at least one further minor release and remove them only in the next major. Version scene, prefab, and asset-manifest formats and provide an upgrade path across at least one major version boundary.
- **§4.5 API reports.** Every published package has a generated API report. Report changes require a changeset at the correct version level. CI checks for a changeset; reviewers check its level.
- **§4.6 Lite upgrades.** Pin Lite to an exact catalog version. Upgrade it in a dedicated, reviewed change with the full visual and headless suites.

## 5. Documentation

- **§5.1 Entry point.** Ship `skills/ignifx/SKILL.md` and its references with the umbrella package to teach agents how to use the engine.
- **§5.2 Keep docs current.** The skill describes the current release. Changes to public APIs, lifecycle order, file formats, or defaults must update the affected skill pages in the same pull request. The documentation harness checks for drift.
- **§5.3 Keep history separate.** Record decisions in ADRs and, after 1.0, migrations in `docs/migrations/`. During a deprecation window, the skill may include one line per deprecated API pointing to its replacement.
- **§5.4 Public API docs.** Give every public symbol a short TSDoc summary and a release tag (`@public`, `@beta`, `@alpha`, or `@internal`). Document parameters and returns as required by lint, plus defaults, units, ownership, and failure behaviour where callers need them. Use an example when usage is unclear. Describe the contract, not the function's implementation steps.
- **§5.5 Working examples.** Type-check skill and recipe examples in CI; execute them where headless use is possible. Broken examples fail the build.
- **§5.6 Decisions.** Use an ADR for decisions that constrain future work. State the context, options, decision, and consequences. Routine implementation choices belong in the code or pull request.
- **§5.7 Agent entry files.** Keep root `AGENTS.md` and `CLAUDE.md` limited to repository mechanics and links. Do not duplicate API docs.
- **§5.8 Plain writing.** Keep comments, docs, and release notes short, simple, and direct. Explain as you would to a beginner (ELI5), while keeping technical facts exact. Comments explain a reason, constraint, or surprise; they do not narrate code. Release notes explain what changes for the user and any action they must take. Follow standards §9 for examples.

## 6. Quality

- **§6.1 Tests.** Runtime changes need headless unit tests and, when they touch the GPU, real Chromium WebGPU tests. Bug fixes need regression tests. Test observable behaviour, not the shape of the implementation.
- **§6.2 Coverage.** Keep line coverage at least 80% per package and 90% for core. These are minimums, not a reason to write low-value tests.
- **§6.3 Flaky tests.** Quarantine intermittent failures the same day. Fix or delete the test within one release cycle.
- **§6.4 Budgets.** CI checks template bundle sizes and benchmark frame times. A regression in a scene that does not use the changed feature is a defect; do not hide it by raising the baseline.
- **§6.5 Types.** Use strict TypeScript and the standards' additional checks everywhere. No `any`, non-null assertions, or `@ts-ignore`; use `unknown` and narrow it. Exceptions follow §10.3.
- **§6.6 Done.** A change is ready for review when its implementation and relevant tests pass, affected docs are current, and any required generated files, changeset, and post-1.0 migration notes are included. Prose-only changes need no runtime tests. Contributor-only docs need no package release. Completion requires green CI and human maintainer approval. Standards §15 lists the checks.

## 7. Development and review

- **§7.1 Branches.** Use short-lived branches and pull requests into `main`. Keep `main` releasable.
- **§7.2 Commits.** Use Conventional Commits for commits and pull-request titles, with a scope allowed by `commitlint.config.ts`. Constitution amendments use the title required by §10.2.
- **§7.3 Releases.** Every user-visible change needs a changeset. CI releases from accumulated changesets. Do not publish by hand.
- **§7.4 Approval.** Agents may implement and review changes and open pull requests. A human maintainer must approve every merge into `main`.
- **§7.5 Scope.** Each pull request addresses one concern. Split large features into reviewable steps following the plan. Do not add speculative features, abstractions, or unrelated cleanup.
- **§7.6 Plan.** Update the engineering plan when scope, order, or estimates change. Explain changes to phase exit criteria in the pull request.

## 8. Extensions

- **§8.1 Shared contract.** Input, physics, audio, 2D, 3D, UI, Electron, and devtools use the same extension contract as third-party packages.
- **§8.2 Compatibility.** The extension contract is public API and follows §4.
- **§8.3 Registration.** Register extensions explicitly when constructing an app. No runtime filesystem discovery or global registration.
- **§8.4 Manifests.** Extension packages declare an `ignifx` manifest in `package.json`: name, engine range, capabilities, and peer extensions. Validate it at registration in development builds.

## 9. Security and dependencies

- **§9.1 Privacy.** The engine and templates send no telemetry. Only a game developer may choose to add it.
- **§9.2 Electron.** Use context isolation, sandboxed renderers, no renderer Node integration, a strict Content Security Policy, and a typed preload bridge. Deviations require an ADR.
- **§9.3 Dependencies.** Keep runtime dependencies minimal. Justify additions in an ADR. Enforce a minimum age for new versions and allow install scripts only for reviewed packages.
- **§9.4 Builds and publishing.** Commit lockfiles and use frozen installs in CI. Publish with provenance. The existing private-repository exception is recorded in ADR-0009; restore provenance when the repository becomes public.

## 10. Governance

- **§10.1 Precedence.** Resolve conflicts in this order: constitution → coding standards → architecture → ADRs → engineering plan → skill and references → code comments. Lower documents may be stricter, never looser.
- **§10.2 Amendments.** Change this constitution through a pull request titled `constitution: …`, with an ADR and project-owner approval. Date the revision in the status line.
- **§10.3 Exceptions.** A waiver needs a written reason in the pull request and an issue tracking its removal.
- **§10.4 Ownership.** Astrum Forge Studios owns project direction. List maintainers in `MAINTAINERS.md` when there is more than one.

## 11. Licensing

- **§11.1 License.** ignifx and contributions use Apache License 2.0; see `LICENSE`.
- **§11.2 Third-party code.** Preserve notices for vendored or derived code in `THIRD_PARTY_NOTICES.md`. Do not copy Babylon.js or Babylon Lite source into ignifx; consume Lite as a dependency.
- **§11.3 Assets.** Sample assets must allow redistribution. Keep attribution beside each asset.
