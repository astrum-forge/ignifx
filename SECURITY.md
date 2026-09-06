# Security policy

ignifx is built by [Astrum Forge Studios](https://astrumforge.com). This document says how to report
a vulnerability and what is currently supported.

## Supported versions

**Nothing is published yet.** No `@ignifx/*` package and no `ignifx` release exists on npm, so there
is no released version to patch. Until the first release, `main` is the only supported code, and a
fix lands there.

| Version   | Supported             |
| --------- | --------------------- |
| `main`    | Yes — fixes land here |
| Published | None yet              |

Once releases begin, this table is replaced with the real support window. The project follows
Semantic Versioning on a single fixed version line (`CONSTITUTION.md` §4.1), so a security fix ships
as a patch on the current minor.

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

What to expect (these are the maintainers' aims while the engine is unreleased and maintained
part-time, not a service level):

- an acknowledgement, aiming for **3 working days**;
- an assessment, with a severity and a plan, aiming for **10 working days**;
- credit in the changelog entry that carries the fix, unless you ask us not to.

Please give us **90 days** before public disclosure, or less if we agree a shorter window.

## What is in scope

- `@ignifx/*` and `ignifx` package code in `packages/**`.
- The desktop host in `@ignifx/electron` and the `desktop/` variants of `templates/*` — the window
  hardening, the `ignifx://` protocol, the preload bridge, and the IPC handlers. The standing review
  is [`docs/security/electron-review-2026-09.md`](docs/security/electron-review-2026-09.md).
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
