# Security policy

ignifx is built by [Astrum Forge Studios](https://astrumforge.com). This document says how to report
a vulnerability and what is currently supported.

## Supported versions

`ignifx` and every `@ignifx/*` package are published on npm on a single fixed version line
(`CONSTITUTION.md` §4.1). The engine is pre-1.0, so only the latest minor is supported: a security
fix lands on `main` and ships as a patch on the current minor. Earlier minors receive no fixes.

| Version                   | Supported                         |
| ------------------------- | --------------------------------- |
| Latest `0.x` minor on npm | Yes — fixes ship as a patch on it |
| `main`                    | Yes — fixes land here first       |
| Earlier `0.x` minors      | No — upgrade to the latest minor  |

## Reporting a vulnerability

**Do not open a public issue for a security report.**

Use GitHub's private vulnerability reporting on this repository (the **Security** tab → _Report a
vulnerability_), which opens a private advisory only the maintainers can see. That is the only
reporting channel this project has set up; if you cannot use it, open a public issue that says
**only** that you have a security report and asks for a private channel — no details, no
reproduction — and a maintainer will open one with you.

Please include:

- what the vulnerability lets an attacker do, and who the attacker has to be;
- the affected package and the commit or version you tested;
- the platform (browser and version, or Electron version and OS);
- a minimal reproduction — a scene file, a snippet, or a repository.

What to expect (these are the maintainers' aims while the engine is pre-1.0 and maintained
part-time, not a service level):

- an acknowledgement, aiming for **3 working days**;
- an assessment, with a severity and a plan, aiming for **10 working days**;
- credit in the changelog entry that carries the fix, unless you ask us not to.

Please give us **90 days** before public disclosure, or less if we agree a shorter window.

## What is in scope

- `@ignifx/*` and `ignifx` package code in `packages/**`.
- The desktop host in `@ignifx/electron` and the `desktop/` variants of `templates/*` — the window
  hardening, the `ignifx://` protocol, the preload bridge, and the IPC handlers
  (`docs/architecture/14-platform-electron.md` §3).
- The build tooling that a game's own build runs: `@ignifx/vite-plugin` and `@ignifx/cli`.

## What is out of scope

- **A game's own code and content.** The renderer is sandboxed from Node, not from the player:
  everything a game ships in `dist/` is readable, and `asar: true` is an archive, not encryption.
  Anything that depends on hiding data from the person running the game is not a vulnerability here.
- **Unsigned desktop builds.** `pnpm dist:desktop` produces an unpacked, unsigned application on
  purpose (`docs/adr/0018-electron-tooling.md`). Signing and notarization belong to whoever ships
  the game.
- **Vulnerabilities in Babylon Lite, Chromium, or Electron themselves.** Report those upstream;
  tell us as well if ignifx makes one reachable that would not otherwise be.
- **Reports produced only by an automated scanner**, with no analysis of whether the finding is
  reachable in this codebase.

## What ignifx does not do

`CONSTITUTION.md` §9.1: **the engine and the templates send no data anywhere.** There is no
telemetry, no crash reporting, no update check, and no third-party request at runtime. If you find
one, that is a bug worth reporting.

## Dependency audit

`pnpm audit` is not a CI job, on purpose. An advisory-database or registry outage would turn every
unrelated pull request red, and so would an advisory against a transitive dependency that has no fix
yet; neither is actionable by the person whose pull request it blocks. A run that cannot reach the
registry also reports "no known vulnerabilities" rather than an error.

The audit is a manual step at each release instead. Run `pnpm audit` and `pnpm audit --prod` from a
machine that can reach the registry, and record the date and the result in that release's Version
Packages pull request. The advisory service returns no database version, so the date of the run is
the only statement of which advisory data it used. Renovate keeps versions moving between releases,
and the `licenses` CI check, which is deterministic, is a gate.
