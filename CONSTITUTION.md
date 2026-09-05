# The ignifx Constitution

**Status:** Ratified draft v1 (2026-09-05) · **Owner:** Astrum Forge Studios · **Precedence:** highest

This document governs how ignifx is designed, built, documented, released, and changed. It is short on purpose. Anything that is a _rule_ lives here; anything that is a _how-to_ lives in the standards and architecture documents that this constitution ranks below itself (see Article X).

Clauses are numbered `§A.n` so that pull requests, ADRs, and reviews can cite them.

---

## Article I — Identity and Scope

- **§1.1 What ignifx is.** ignifx is a code-first, TypeScript game engine for the web. It renders exclusively through WebGPU by way of Babylon Lite (`@babylonjs/lite`), and it runs in WebGPU-capable browsers and in Electron.
- **§1.2 Who it is for.** Independent developers and small teams building 2D games (top-down, side-scrolling) and 3D games (third-person, first-person) with maximum flexibility, and the AI coding agents that work alongside them.
- **§1.3 What ignifx is not.** ignifx is not a WebGL engine, not a fork of Babylon.js, not an editor-first engine, and not a general-purpose 3D viewer. Editor tooling may come after 1.0 and must build on the runtime, never the reverse.
- **§1.4 Inspiration, not imitation.** The scripting and component model draws on Unity's `MonoBehaviour` lifecycle; the scene tree, signals, resources, and add-on model draw on Godot. Where the two disagree, ignifx chooses the option that is more explicit and more type-safe.
- **§1.5 Naming.** The engine is written `ignifx` (always lowercase). Published packages use the `@ignifx/*` npm scope plus the umbrella package `ignifx`. The studio is Astrum Forge Studios (astrumforge.com); the project site is ignifx.com.

## Article II — Ranked Principles

When principles conflict, the higher-ranked one wins. Reviews cite the rank when resolving a disagreement.

1. **§2.1 Correctness and determinism.** The engine must do what its types and documentation say, every frame, on every supported platform. Simulation must be reproducible under a fixed timestep.
2. **§2.2 Clarity for humans and agents.** APIs are explicit, discoverable, and fully typed. There is one obvious way to do each common task, and that way is documented in `SKILL.md`.
3. **§2.3 Flexibility through extension.** Every optional capability is an extension. The core stays small; games compose what they need.
4. **§2.4 Performance.** Frame budgets and allocation budgets are part of the definition of done for runtime code.
5. **§2.5 Pay only for what you use.** Unused features cost zero bytes and zero frame time. ignifx inherits and respects Babylon Lite's tree-shaking discipline.

## Article III — Architecture Tenets

- **§3.1 Explicit lifecycle.** Scripts receive engine callbacks in a documented, deterministic order (`awake`, `onEnable`, `start`, `fixedUpdate`, `update`, `lateUpdate`, `onDisable`, `onDestroy`, and the collision/trigger family). Every per-frame callback receives delta time as an argument; scaled and unscaled time are always distinguishable.
- **§3.2 Fixed timestep for simulation, variable timestep for presentation.** Physics and gameplay that must be deterministic run in `fixedUpdate`; rendering and presentation logic run in `update`/`lateUpdate`. The accumulator loop is defined once in the core and is not reimplemented by extensions.
- **§3.3 One scene tree, one owner.** The ignifx scene tree owns entities and components. Babylon Lite's `SceneContext` owns render data. ignifx mirrors into Lite through adapter components; nothing outside the adapter layer touches Lite scene arrays directly.
- **§3.4 Adapter boundary around Babylon Lite.** `@babylonjs/lite` moves fast and declares its API "young". Only modules under a designated adapter directory in each package may import it. Public ignifx APIs expose Lite objects only through explicitly named, documented escape hatches, and those escape hatches carry no stability guarantee.
- **§3.5 No import-time side effects.** No module executes code, registers globals, or allocates at import time. Registration happens inside `App` construction or an extension's `register` function.
- **§3.6 No ambient singletons.** Engine services are reached through the `App` (or the `World`/`Entity` a script belongs to), never through module-level globals. Test code must be able to run two independent apps in one process.
- **§3.7 Serialization is schema-driven.** Every serializable component declares a schema. Scene and prefab files are versioned JSON. There is no reflection-based, undeclared serialization.
- **§3.8 Headless is a supported target.** Everything that does not need a GPU (scene tree, scripting, physics, animation, assets metadata) must run under Babylon Lite's null engine in Node for tests and servers.
- **§3.9 Errors are loud in development and structured in production.** Misuse throws with an actionable message in development builds. Production builds may compact messages but must keep an error code.
- **§3.10 2D is first-class, not a camera trick.** 2D projects use a 2D-specific toolkit (sprites, tilemaps, pixel-perfect camera, sorting layers, 2D physics) built on the same entity model, not a thin wrapper over the 3D path.

## Article IV — Versioning and Compatibility

- **§4.1 Semantic Versioning.** All packages follow SemVer 2.0.0 and are released together with a single version line (fixed versioning via Changesets).
- **§4.2 Before 1.0 (the MVP era).**
  - Breaking changes are permitted in **minor** releases (`0.x` → `0.(x+1)`), never in patch releases.
  - Every breaking change is listed under a **Breaking** heading in the changelog entry that introduces it.
  - **No migration documents are written before 1.0.** Effort goes into getting the API right and keeping `SKILL.md` current, not into documenting churn.
- **§4.3 Reaching 1.0.** 1.0 is declared only when all of the following hold: every MVP phase in the engineering plan is complete; the public API report has been reviewed and frozen; the four reference templates (2D top-down, 2D side-scroller, 3D third-person, 3D first-person) build and pass CI; the documentation harness is green; performance and bundle budgets are met on the supported browser matrix; and at least two consecutive minor releases have shipped with no breaking change.
- **§4.4 After 1.0.**
  - Breaking changes ship only in **major** releases.
  - Every breaking change to a public interface, behaviour, or file format must ship with a migration document in `docs/migrations/` in the same release, describing what changed, why, and the exact before/after code.
  - Deprecations are announced in a minor release, marked `@deprecated` in TSDoc with a pointer to the replacement, kept working for at least one further minor release, and removed only in the next major.
  - Scene, prefab, and asset-manifest files carry a format version and remain loadable across at least one major version boundary via an upgrade path.
- **§4.5 API surface control.** Every published package has an API report generated from its declaration files. A change to the report requires a changeset of the matching semver level; CI blocks otherwise.
- **§4.6 Babylon Lite pinning.** `@babylonjs/lite` is pinned to an exact version in the workspace catalog. Upgrades are deliberate, reviewed changes that run the full visual and headless suites.

## Article V — Documentation and the Agent-First Mandate

- **§5.1 SKILL.md is the entry point.** The repository ships an Agent Skill (`skills/ignifx/SKILL.md` plus `references/`) that teaches an agent how to use the engine. It is published with the umbrella package.
- **§5.2 Always current.** `SKILL.md` and its references describe **only** the API of the current release. A pull request that changes a public interface, a lifecycle order, a file format, or a default value must update `SKILL.md`/references in the same pull request. CI enforces this through the documentation harness.
- **§5.3 Legacy stays out of the skill.** Migration guides, deprecated patterns, and historical context live under `docs/migrations/` and `docs/adr/`. The skill may contain at most a one-line "do not use X, use Y" pointer for an API that is inside its deprecation window, and nothing else about the past.
- **§5.4 Every public symbol is documented.** Public exports carry TSDoc with a summary, parameter and return documentation, and at least one example where usage is not obvious. Release tags (`@public`, `@beta`, `@alpha`, `@internal`) are mandatory.
- **§5.5 Examples must run.** Code in `SKILL.md`, references, and recipes is type-checked and, where headless execution is possible, executed in CI. Broken examples fail the build.
- **§5.6 Decisions are recorded.** Any decision that constrains future work is recorded as an ADR in `docs/adr/` with context, options, decision, and consequences.
- **§5.7 Agent instructions stay thin.** `CLAUDE.md`/`AGENTS.md` at the repository root contain only repository mechanics and pointers to the canonical documents; they never duplicate API documentation.

## Article VI — Quality Gates

- **§6.1 Tests are required.** Runtime code ships with unit tests (Vitest, headless) and, where it touches the GPU, browser tests that run in real Chrome with WebGPU. Bug fixes add a regression test.
- **§6.2 Coverage floor.** Line coverage per package does not drop below 80%, and the core package does not drop below 90%. Coverage is a floor, not a target.
- **§6.3 No flaky tests.** A test that fails intermittently is quarantined the same day and fixed or deleted within one release cycle.
- **§6.4 Budgets are tests.** Bundle-size ceilings per template and frame-time budgets per benchmark scene are checked in CI. A regression in a scene that does not use the changed feature is a design defect, not a new baseline.
- **§6.5 Type safety is absolute.** `strict` mode plus the additional flags in the coding standards are on everywhere; `any`, non-null assertions, and `@ts-ignore` require a justification comment and reviewer sign-off.
- **§6.6 Definition of done.** A change is done when: code, tests, TSDoc, `SKILL.md`/references, changeset, and (post-1.0) migration notes are all present; CI is green; and a maintainer has approved.

## Article VII — Process

- **§7.1 Trunk-based development.** Work happens on short-lived branches merged into `main` through pull requests. `main` is always releasable.
- **§7.2 Conventional Commits.** Commit messages and pull-request titles follow Conventional Commits; scopes are package names.
- **§7.3 Changesets.** Every user-visible change carries a changeset. Releases are cut from accumulated changesets by CI, never by hand.
- **§7.4 Agents are contributors, humans are approvers.** AI agents may open pull requests and are held to every rule in this constitution. Every merge into `main` requires approval from a human maintainer.
- **§7.5 Small, reviewable changes.** A pull request addresses one concern. Large features land behind a sequence of pull requests following the engineering plan.
- **§7.6 The plan is a living document.** `docs/plan/engineering-plan.md` is updated when scope, ordering, or estimates change. Phase exit criteria are edited only through a pull request that explains why.

## Article VIII — Extensions and Ecosystem

- **§8.1 Core features are extensions too.** Input, physics, audio, 2D, 3D toolkits, UI, Electron, and devtools are packages that register through the same extension contract available to third parties.
- **§8.2 The extension contract is a public API.** Its stability guarantees are the same as any other public API (Article IV).
- **§8.3 Declared, not discovered.** Extensions are registered explicitly when an `App` is constructed. There is no filesystem scanning or magic global registration at runtime.
- **§8.4 Manifests.** Each extension package declares an `ignifx` manifest in its `package.json` (name, compatible engine range, capabilities, peer extensions). The engine validates manifests at registration time in development builds.

## Article IX — Security, Privacy, and Supply Chain

- **§9.1 No telemetry by default.** The engine and templates send no data anywhere unless a game developer explicitly adds it.
- **§9.2 Electron baseline.** Electron templates use context isolation, sandboxed renderers, no Node integration in renderers, a strict Content Security Policy, and a typed preload bridge. Deviations require an ADR.
- **§9.3 Dependency discipline.** Runtime dependencies are minimal and justified in an ADR when added. The workspace enforces a minimum release age for new dependency versions and disallows lifecycle scripts from unknown packages.
- **§9.4 Reproducible builds.** Lockfiles are committed; CI installs with a frozen lockfile; packages are published with provenance.

## Article X — Governance and Precedence

- **§10.1 Order of precedence.** When documents conflict: (1) this constitution, (2) `docs/standards/coding-standards.md`, (3) `docs/architecture/*`, (4) ADRs, (5) the engineering plan, (6) `SKILL.md` and references, (7) code comments. A lower document may be stricter than a higher one but never looser.
- **§10.2 Amendment.** This constitution changes only through a pull request titled `constitution: …`, accompanied by an ADR, and approved by the project owner. Amendments are dated in the status line.
- **§10.3 Waivers.** A rule may be waived for a specific change only with a written justification in the pull request and an issue tracking removal of the waiver.
- **§10.4 Ownership.** Astrum Forge Studios owns the project direction. Maintainers are listed in `MAINTAINERS.md` once the project has more than one.

## Article XI — Licensing

- **§11.1 License.** ignifx is licensed under the Apache License 2.0 (see `LICENSE`). Contributions are accepted under the same license.
- **§11.2 Third-party code.** Vendored or derived code keeps its notice in `THIRD_PARTY_NOTICES.md`. Copying Babylon.js or Babylon Lite source into ignifx is prohibited; ignifx consumes Lite as a dependency.
- **§11.3 Assets.** Sample assets in templates and examples must be licensed for redistribution, with attribution recorded alongside the asset.
