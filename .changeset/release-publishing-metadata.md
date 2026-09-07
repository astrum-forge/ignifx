---
"@ignifx/core": patch
"@ignifx/input": patch
"@ignifx/physics": patch
"@ignifx/physics-2d": patch
"@ignifx/audio": patch
"@ignifx/2d": patch
"@ignifx/3d": patch
"@ignifx/ui": patch
"@ignifx/electron": patch
"@ignifx/devtools": patch
"@ignifx/vite-plugin": patch
"@ignifx/cli": patch
"ignifx": patch
---

Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private

Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.

`publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.

No runtime code changed.
