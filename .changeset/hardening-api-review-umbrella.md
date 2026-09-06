---
"ignifx": minor
---

API review: the umbrella stops re-exporting other packages' `@internal` symbols

**Breaking.** Fourteen symbols leave the umbrella's public surface. Ten were marked `@internal` in
the package that declared them and reached `ignifx` only because that package's barrel exported them
(`asDomCanvas`, `resolveDomTarget`, `resolveDevtoolsTarget`, `isValidLayer`, `TextRuntime`,
`TextRuntimeOptions`, `UiHostOptions`, `UiSystemOptions`, `I18nServiceOptions`,
`DevtoolsServiceOptions`); the other four are the duplicate or renamed names their own packages
retired in this release (`MATERIAL_ALPHA_MODE_NAMES`, `MaterialAlphaModeName`, `PlayStateOptions`,
and `Capsule2DDirection`/`CAPSULE_2D_DIRECTIONS`, now `CapsuleDirection2D`/`CAPSULE_DIRECTIONS_2D`).

`CONSTITUTION.md` §5.4 makes release tags mandatory, and the umbrella is the surface a game imports:
a symbol its own package calls internal has no business being re-exported from it. See each
package's own changeset for what replaced what.
