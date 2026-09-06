---
"@ignifx/core": minor
---

API review: the render name tables are `@public`, the duplicate alpha-mode spellings are gone, and
`Quat`'s radian helpers use the abbreviation the coding standard prescribes

**Breaking.**

- `MaterialAlphaModeName` is removed. It was a bare alias of `MaterialAlphaMode`, which the barrel
  already exported; use `MaterialAlphaMode`.
- `MATERIAL_ALPHA_MODE_NAMES` is removed. It was a re-typing of `MATERIAL_ALPHA_MODES`, which the
  barrel already exported and which now carries the same `@public` tag; use `MATERIAL_ALPHA_MODES`.
- `Quat.fromEulerRadians`, `Quat.fromEulerRadiansToRef` and `Quat.toEulerRadiansToRef` are renamed to
  `Quat.fromEulerRad`, `Quat.fromEulerRadToRef` and `Quat.toEulerRadToRef`, and their `xRadians`,
  `yRadians`, `zRadians` parameters to `xRad`, `yRad`, `zRad`. `docs/standards/coding-standards.md`
  §5.1's units row gives `fromEulerRad` as its own literal example of the rule; the shipped names
  spelled the unit out instead. The degree-taking `Quat.fromEuler`/`fromEulerToRef`/`toEulerToRef`
  are unchanged.
- `isValidLayer` is no longer exported from the barrel. It is `@internal`, nothing outside
  `@ignifx/core` used it, and `packages/ignifx` re-exported it into the umbrella's public surface.
  Layer names and indices are validated by `LayerTable`.

**Changed.** `MATERIAL_ALPHA_MODES`, `MaterialAlphaMode`, `SHADOW_TECHNIQUES` and
`TONE_MAPPING_NAMES` are `@public`. All four were already exported from the barrel and from the
umbrella, and three public types are derived from them (`MaterialAlphaMode`, `ShadowTechniqueName`,
`ToneMappingCurve`), so API Extractor reported five `ae-incompatible-release-tags` /
`ae-internal-missing-underscore` contradictions on a surface that was public in fact. The seven
sibling tables in `src/render/**` (`LIGHT_TYPES`, `MATERIAL_KINDS`, `CANVAS_ALPHA_MODES`,
`PROJECTIONS`, `FOG_MODE_NAMES`, `EASING_NAMES`, `TWEEN_VALUE_KINDS`) were already `@public`.
Nothing about the values, the derived unions or the runtime changed.
